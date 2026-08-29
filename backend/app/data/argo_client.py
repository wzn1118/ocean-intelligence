from __future__ import annotations

import json
import math
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from heapq import nsmallest
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ARGO_API_ROOT = os.getenv("ARGO_API_ROOT", "https://argovis-api.colorado.edu").rstrip("/")
ARGO_DEFAULT_PLATFORM = os.getenv("ARGO_PLATFORM", "5906518")
ARGO_CACHE_TTL_SECONDS = max(float(os.getenv("ARGO_CACHE_TTL_SECONDS", "300")), 30.0)
ARGO_PROFILE_CACHE_TTL_SECONDS = max(float(os.getenv("ARGO_PROFILE_CACHE_TTL_SECONDS", "86400")), 300.0)
ARGO_PROFILE_CACHE_MAX_ENTRIES = max(int(os.getenv("ARGO_PROFILE_CACHE_MAX_ENTRIES", "96")), 16)
ARGO_PROFILE_CACHE_DIR = Path(
    os.getenv("ARGO_PROFILE_CACHE_DIR", str(Path(__file__).resolve().parents[2] / ".cache" / "argo_profiles"))
)
ARGO_DATA_KEYS = "temperature,temperature_adjusted,pressure,pressure_adjusted,salinity,salinity_adjusted,chla,chla_adjusted,nitrate,nitrate_adjusted,temperature_argoqc,temperature_adjusted_argoqc,pressure_argoqc,pressure_adjusted_argoqc,salinity_argoqc,salinity_adjusted_argoqc,chla_argoqc,chla_adjusted_argoqc,nitrate_argoqc,nitrate_adjusted_argoqc"
ARGO_REGION_BOUNDS = ((100.0, 0.0), (179.0, 60.0))
ARGO_REGION_LOOKBACK_DAYS = max(int(os.getenv("ARGO_REGION_LOOKBACK_DAYS", "35")), 14)
ARGO_EVENT_CANDIDATE_LIMIT = max(int(os.getenv("ARGO_EVENT_CANDIDATE_LIMIT", "18")), 6)
ARGO_POINT_CANDIDATE_LIMIT = max(3, min(int(os.getenv("ARGO_POINT_CANDIDATE_LIMIT", "8")), 20))
ARGO_BGC_SAMPLE_TARGET = max(int(os.getenv("ARGO_BGC_SAMPLE_TARGET", "20")), 1)


class ArgoDataError(RuntimeError):
    """Raised when the remote Argo service cannot provide a valid snapshot."""


_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_cache_lock = threading.Lock()
_fetch_lock = threading.Lock()
_profile_fetch_locks: dict[str, threading.Lock] = {}
_profile_fetch_locks_lock = threading.Lock()
_region_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_region_cache_lock = threading.Lock()
_region_fetch_lock = threading.Lock()
_region_revalidation_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="argo-region-revalidate")
_region_revalidating: set[str] = set()
_region_revalidating_lock = threading.Lock()


def _profile_cache_key(platform: str, scope: str) -> str:
    return f"{scope}:{platform}"


def _profile_fetch_lock(cache_key: str) -> threading.Lock:
    """Coalesce requests for one platform without serialising other floats."""
    with _profile_fetch_locks_lock:
        return _profile_fetch_locks.setdefault(cache_key, threading.Lock())


def prime_argo_region_cache(region_id: str, snapshot: dict[str, Any], *, age_seconds: float = 0.0) -> None:
    """Seed the regional catalog from the persistent workspace snapshot."""
    if not snapshot.get("floats"):
        return
    cached_at = time.monotonic() - max(0.0, age_seconds)
    value = deepcopy(snapshot)
    value.pop("cache", None)
    with _region_cache_lock:
        current = _region_cache.get(region_id)
        if current and current[0] >= cached_at:
            return
        _region_cache[region_id] = (cached_at, value)


def _schedule_region_revalidation(
    region_id: str,
    bounds: tuple[tuple[float, float], tuple[float, float]],
    region_name: str,
) -> None:
    with _region_revalidating_lock:
        if region_id in _region_revalidating:
            return
        _region_revalidating.add(region_id)

    def refresh() -> None:
        try:
            result = _fetch_region(region_id, bounds, region_name)
            result["cache"] = {"state": "fresh", "age_seconds": 0.0, "ttl_seconds": ARGO_CACHE_TTL_SECONDS}
            with _region_cache_lock:
                _region_cache[region_id] = (time.monotonic(), result)
        except ArgoDataError:
            pass
        finally:
            with _region_revalidating_lock:
                _region_revalidating.discard(region_id)

    _region_revalidation_executor.submit(refresh)


def _store_profile_cache(cache_key: str, snapshot: dict[str, Any]) -> None:
    with _cache_lock:
        _cache[cache_key] = (time.monotonic(), snapshot)
        if len(_cache) <= ARGO_PROFILE_CACHE_MAX_ENTRIES:
            return
        stale_keys = sorted(_cache, key=lambda key: _cache[key][0])[:-ARGO_PROFILE_CACHE_MAX_ENTRIES]
        for stale_key in stale_keys:
            _cache.pop(stale_key, None)
    _persist_profile_cache(cache_key, snapshot)


def _profile_cache_path(cache_key: str) -> Path | None:
    scope, separator, platform = cache_key.partition(":")
    if not separator or scope not in {"lifetime", "regional_window"} or not platform.isdigit():
        return None
    return ARGO_PROFILE_CACHE_DIR / f"{scope}-{platform}.json"


def _persist_profile_cache(cache_key: str, snapshot: dict[str, Any]) -> None:
    path = _profile_cache_path(cache_key)
    if path is None:
        return
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(
            json.dumps({"saved_at": time.time(), "snapshot": snapshot}, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        temporary.replace(path)
    except OSError:
        # The in-memory cache remains authoritative if local persistence is unavailable.
        return


def _load_persisted_profile(cache_key: str) -> tuple[float, dict[str, Any]] | None:
    path = _profile_cache_path(cache_key)
    if path is None or not path.exists():
        return None
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
        saved_at = float(document["saved_at"])
        snapshot = document["snapshot"]
        if not isinstance(snapshot, dict) or not isinstance(snapshot.get("latest"), dict):
            return None
        age_seconds = max(0.0, time.time() - saved_at)
        return time.monotonic() - age_seconds, snapshot
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
        return None


def preload_argo_profile_cache() -> dict[str, int]:
    """Load all persisted Argo profile snapshots into process memory."""
    loaded: dict[str, int] = {}
    for path in ARGO_PROFILE_CACHE_DIR.glob("*.json"):
        scope, separator, platform = path.stem.partition("-")
        if not separator or scope not in {"lifetime", "regional_window"} or not platform.isdigit():
            continue
        cache_key = _profile_cache_key(platform, scope)
        persisted = _load_persisted_profile(cache_key)
        if persisted is None:
            continue
        cached_at, snapshot = persisted
        with _cache_lock:
            _cache[cache_key] = (cached_at, snapshot)
        loaded[cache_key] = len(snapshot.get("profiles", []))
    return loaded


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return None
    return parsed.astimezone(UTC)


def _timestamp_key(value: Any) -> datetime:
    return _timestamp(value) or datetime.min.replace(tzinfo=UTC)


def _column_map(record: dict[str, Any]) -> dict[str, list[Any]]:
    info = record.get("data_info") or []
    names = info[0] if len(info) > 0 and isinstance(info[0], list) else []
    values = record.get("data") or []
    return {
        str(name): column
        for name, column in zip(names, values)
        if isinstance(column, list)
    }


def _source_urls(record: dict[str, Any]) -> list[str]:
    urls: list[str] = []
    for item in record.get("source") or []:
        if not isinstance(item, dict):
            continue
        url = item.get("url")
        if isinstance(url, str) and url and url not in urls:
            urls.append(url)
    return urls


def _profile_points(
    record: dict[str, Any],
) -> tuple[
    list[dict[str, Any]],
    dict[str, float | None],
    dict[str, str],
    dict[str, str],
]:
    columns = _column_map(record)
    pressure = columns.get("pressure") or []
    adjusted_pressure = columns.get("pressure_adjusted") or []
    adjusted_pressure_qc = columns.get("pressure_adjusted_argoqc") or []
    raw_pressure_qc = columns.get("pressure_argoqc") or []
    variable_names = ("temperature", "salinity", "chla", "nitrate")
    length = len(pressure)
    points: list[dict[str, Any]] = []
    for index in range(length):
        adjusted_depth = _number(adjusted_pressure[index]) if index < len(adjusted_pressure) else None
        adjusted_depth_qc = _number(adjusted_pressure_qc[index]) if index < len(adjusted_pressure_qc) else None
        raw_depth = _number(pressure[index])
        raw_depth_qc = _number(raw_pressure_qc[index]) if index < len(raw_pressure_qc) else None
        depth = adjusted_depth if adjusted_depth is not None and adjusted_depth_qc in (1.0, 2.0) else raw_depth
        depth_mode = "adjusted" if depth == adjusted_depth and adjusted_depth is not None else "raw"
        if depth is None or depth < 0 or depth > 2000:
            continue
        point: dict[str, Any] = {"pressure": round(depth, 3), "pressure_mode": depth_mode}
        for variable in variable_names:
            adjusted_values = columns.get(f"{variable}_adjusted") or []
            adjusted_quality_values = columns.get(f"{variable}_adjusted_argoqc") or []
            raw_values = columns.get(variable) or []
            raw_quality_values = columns.get(f"{variable}_argoqc") or []
            adjusted_value = _number(adjusted_values[index]) if index < len(adjusted_values) else None
            raw_value = _number(raw_values[index]) if index < len(raw_values) else None
            adjusted_quality = (
                _number(adjusted_quality_values[index])
                if index < len(adjusted_quality_values)
                else None
            )
            raw_quality = (
                _number(raw_quality_values[index])
                if index < len(raw_quality_values)
                else None
            )
            if adjusted_value is not None and adjusted_quality in (1.0, 2.0):
                point[variable] = adjusted_value
                point[f"{variable}_qc"] = adjusted_quality
                point[f"{variable}_mode"] = "adjusted"
            elif raw_value is not None and raw_quality in (1.0, 2.0):
                point[variable] = raw_value
                point[f"{variable}_qc"] = raw_quality
                point[f"{variable}_mode"] = "raw"
            elif adjusted_value is not None:
                point[variable] = adjusted_value
                point[f"{variable}_qc"] = adjusted_quality
                point[f"{variable}_mode"] = "adjusted"
            elif raw_value is not None:
                point[variable] = raw_value
                point[f"{variable}_qc"] = raw_quality
                point[f"{variable}_mode"] = "raw"
            else:
                point[variable] = None
                point[f"{variable}_qc"] = None
                point[f"{variable}_mode"] = None
        if any(point[variable] is not None for variable in variable_names):
            points.append(point)

    points.sort(key=lambda item: item["pressure"])
    surface: dict[str, float | None] = {}
    variable_modes: dict[str, str] = {}
    surface_modes: dict[str, str] = {}
    for variable in variable_names:
        surface_point = next(
            (
                item
                for item in points
                if item[variable] is not None and item[f"{variable}_qc"] in (1.0, 2.0)
            ),
            None,
        )
        surface[variable] = surface_point[variable] if surface_point else None
        surface[f"{variable}_qc"] = surface_point[f"{variable}_qc"] if surface_point else None
        surface[f"{variable}_pressure"] = surface_point["pressure"] if surface_point else None
        surface_modes[variable] = surface_point[f"{variable}_mode"] if surface_point else "unavailable"
        modes = {
            item[f"{variable}_mode"]
            for item in points
            if item[variable] is not None and item[f"{variable}_mode"] is not None
        }
        variable_modes[variable] = (
            "unavailable"
            if not modes
            else "mixed"
            if len(modes) > 1
            else next(iter(modes))
        )
    return points, surface, variable_modes, surface_modes


def _downsample(points: list[dict[str, Any]], limit: int = 180) -> list[dict[str, Any]]:
    if len(points) <= limit:
        return points
    stride = (len(points) - 1) / (limit - 1)
    return [points[round(index * stride)] for index in range(limit)]


def _normalize_profile(record: dict[str, Any], *, full_points: bool = False) -> dict[str, Any]:
    coordinates = (record.get("geolocation") or {}).get("coordinates") or [None, None]
    points, surface, variable_modes, surface_modes = _profile_points(record)
    return {
        "cycle": int(record.get("cycle_number") or 0),
        "timestamp": record.get("timestamp"),
        "updated_at": record.get("date_updated_argovis"),
        "longitude": _number(coordinates[0]),
        "latitude": _number(coordinates[1]),
        "position_qc": _number(record.get("geolocation_argoqc")),
        "timestamp_qc": _number(record.get("timestamp_argoqc")),
        "direction": record.get("profile_direction"),
        "vertical_sampling_scheme": record.get("vertical_sampling_scheme"),
        "max_pressure": max((point["pressure"] for point in points), default=None),
        "sample_count": len(points),
        "surface": surface,
        "variable_modes": variable_modes,
        "surface_modes": surface_modes,
        "points": points if full_points else _downsample(points),
        "source_urls": _source_urls(record),
        "metadata_ids": record.get("metadata") or [],
    }


def _explain(platform: str, profiles: list[dict[str, Any]]) -> dict[str, Any]:
    latest = profiles[-1]
    surface = latest["surface"]
    temp = surface.get("temperature")
    salinity = surface.get("salinity")
    chla = surface.get("chla")
    nitrate = surface.get("nitrate")
    findings: list[str] = [
        f"浮标 {platform} 最新为第 {latest['cycle']} 周期，观测时间 {latest['timestamp']}，位置 {latest['latitude']:.3f}°N、{latest['longitude']:.3f}°E。",
    ]
    if temp is not None:
        findings.append(f"近表层海温为 {temp:.2f} °C；该剖面最大有效压力约 {latest['max_pressure']:.0f} dbar。")
    if salinity is not None:
        findings.append(f"近表层盐度为 {salinity:.3f} PSU，可与温度共同判断水团变化。")
    if chla is not None:
        findings.append(f"近表层叶绿素 a 为 {chla:.3f} mg/m³；该指标用于识别生物光学响应，不直接等同于生物量。")
    if nitrate is not None:
        findings.append(f"近表层硝酸盐为 {nitrate:.3f} μmol/kg，可作为营养盐补给的现场约束。")
    caveats = [
        "这是单个 Argo 浮标的现场剖面，不代表整个网格区域的平均状态。",
        "数值已保留 Argo 质量标识；业务解释仍需结合卫星、再分析和邻近剖面。",
        "实时资料与延迟模式资料的更新节奏不同，页面会显示来源更新时间。",
    ]
    return {
        "headline": f"Argo 第 {latest['cycle']} 周期现场剖面已接入",
        "summary": "；".join(findings[:2]),
        "findings": findings,
        "caveats": caveats,
        "generated_at": datetime.now(UTC).isoformat(),
        "method": "基于最新 Argo 剖面、近表层值、剖面深度和质量标识生成的规则化解释。",
    }


def _explain_legacy(platform: str, profiles: list[dict[str, Any]]) -> dict[str, Any]:
    latest = profiles[-1]
    surface = latest["surface"]
    surface_modes = latest.get("surface_modes") or {}
    latitude = latest.get("latitude")
    longitude = latest.get("longitude")
    location = (
        f"{latitude:.3f}\u00b0N、{longitude:.3f}\u00b0E"
        if latitude is not None and longitude is not None
        else "\u4f4d\u7f6e\u672a\u77e5"
    )
    maximum_pressure = latest.get("max_pressure")
    pressure_text = f"{maximum_pressure:.0f} dbar" if maximum_pressure is not None else "\u672a\u77e5\u6df1\u5ea6"
    findings = [
        f"\u6d6e\u6807 {platform} \u6700\u65b0\u4e3a\u7b2c {latest['cycle']} \u5468\u671f\uff0c\u89c2\u6d4b\u65f6\u95f4 {latest['timestamp']}\uff0c\u4f4d\u7f6e {location}\u3002",
    ]
    temperature = surface.get("temperature")
    salinity = surface.get("salinity")
    chla = surface.get("chla")
    nitrate = surface.get("nitrate")
    mode_labels = {"raw": "原始值", "adjusted": "调整值", "unavailable": "不可用"}
    available_modes = [
        f"{label}{mode_labels.get(surface_modes.get(key), '模式未知')}"
        for key, label in (("temperature", "温度"), ("salinity", "盐度"), ("chla", "叶绿素 a"), ("nitrate", "硝酸盐"))
        if surface.get(key) is not None
    ]
    if temperature is not None:
        findings.append(f"\u8fd1\u8868\u5c42\u6d77\u6e29\u4e3a {temperature:.2f} \u00b0C\uff0c\u672c\u5256\u9762\u6700\u5927\u6709\u6548\u538b\u529b\u4e3a {pressure_text}\u3002")
    if salinity is not None:
        findings.append(f"\u8fd1\u8868\u5c42\u76d0\u5ea6\u4e3a {salinity:.3f} PSU\uff0c\u53ef\u4e0e\u6e29\u5ea6\u4e00\u8d77\u5224\u65ad\u6c34\u56e2\u53d8\u5316\u3002")
    if chla is not None:
        findings.append(f"\u8fd1\u8868\u5c42\u53f6\u7eff\u7d20 a \u4e3a {chla:.3f} mg m\u207b\u00b3\uff0c\u7528\u4e8e\u8bc6\u522b\u751f\u7269\u5149\u5b66\u54cd\u5e94\uff0c\u4e0d\u76f4\u63a5\u7b49\u540c\u4e8e\u751f\u7269\u91cf\u3002")
    if nitrate is not None:
        findings.append(f"\u8fd1\u8868\u5c42\u785d\u9178\u76d0\u4e3a {nitrate:.3f} \u03bcmol kg\u207b\u00b9\uff0c\u53ef\u4f5c\u4e3a\u8425\u517b\u76d0\u8865\u7ed9\u7684\u73b0\u573a\u7ea6\u675f\u3002")
    if available_modes:
        findings.append(f"当前近表层数据模式：{'、'.join(available_modes)}；调整值仅在上游逐点提供时采用。")
    caveats = [
        "\u8fd9\u662f\u5355\u4e2a Argo \u6d6e\u6807\u7684\u73b0\u573a\u5256\u9762\uff0c\u4e0d\u4ee3\u8868\u6574\u4e2a\u7f51\u683c\u533a\u57df\u7684\u5e73\u5747\u72b6\u6001\u3002",
        "数值按样本逐点优先采用通过 QC 的调整值；上游未提供调整值时回退至通过 QC 的原始值，并在页面标明数据模式。",
        "\u5b9e\u65f6\u8d44\u6599\u4e0e\u5ef6\u8fdf\u6a21\u5f0f\u8d44\u6599\u7684\u66f4\u65b0\u8282\u594f\u4e0d\u540c\uff0c\u9875\u9762\u4f1a\u663e\u793a\u6765\u6e90\u66f4\u65b0\u65f6\u95f4\u3002",
    ]
    return {
        "headline": f"Argo \u7b2c {latest['cycle']} \u5468\u671f\u73b0\u573a\u5256\u9762\u5df2\u63a5\u5165",
        "summary": "\uff1b".join(item.rstrip("\u3002") for item in findings[:2]) + "\u3002",
        "findings": findings,
        "caveats": caveats,
        "generated_at": datetime.now(UTC).isoformat(),
        "method": "\u57fa\u4e8e\u6700\u65b0 Argo \u5256\u9762\u3001\u8fd1\u8868\u5c42\u503c\u3001\u5256\u9762\u6df1\u5ea6\u548c\u8d28\u91cf\u6807\u8bc6\u751f\u6210\u7684\u89c4\u5219\u5316\u89e3\u91ca\u3002",
    }


def _explain_clean(
    platform: str,
    profiles: list[dict[str, Any]],
    *,
    track: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Describe one profile without turning it into an event conclusion."""
    latest = profiles[-1]
    surface = latest["surface"]
    surface_modes = latest.get("surface_modes") or {}
    latitude = latest.get("latitude")
    longitude = latest.get("longitude")
    location = (
        f"{latitude:.3f}\u00b0N / {longitude:.3f}\u00b0E"
        if latitude is not None and longitude is not None
        else "位置未知"
    )
    maximum_pressure = latest.get("max_pressure")
    pressure_text = f"{maximum_pressure:.0f} dbar" if maximum_pressure is not None else "未知深度"

    def shallowest_pressure_text(variable: str) -> str:
        pressure = surface.get(f"{variable}_pressure")
        return f"{pressure:.1f} dbar" if isinstance(pressure, (int, float)) else "压力未知"

    def valid_profile_points(variable: str) -> list[dict[str, Any]]:
        return [
            point
            for point in latest.get("points") or []
            if isinstance(point.get(variable), (int, float))
            and point.get(f"{variable}_qc") in (1.0, 2.0)
        ]

    findings = [
        f"浮标 {platform} 最新为第 {latest['cycle']} 周期，观测时间 {latest['timestamp']}，位置 {location}。",
    ]
    temperature = surface.get("temperature")
    salinity = surface.get("salinity")
    chla = surface.get("chla")
    nitrate = surface.get("nitrate")
    mode_labels = {"raw": "原始值", "adjusted": "调整值", "unavailable": "不可用"}
    available_modes = [
        f"{label}{mode_labels.get(surface_modes.get(key), '模式未知')}"
        for key, label in (("temperature", "温度"), ("salinity", "盐度"), ("chla", "叶绿素 a"), ("nitrate", "硝酸盐"))
        if surface.get(key) is not None
    ]
    if temperature is not None:
        findings.append(
            f"最浅有效温度样本位于 {shallowest_pressure_text('temperature')}，温度为 {temperature:.2f} °C；"
            f"当前载入范围的最深有效压力为 {pressure_text}。"
        )
    if salinity is not None:
        findings.append(
            f"最浅有效盐度样本位于 {shallowest_pressure_text('salinity')}，盐度为 {salinity:.3f} PSU；"
            "它描述单个剖面的当前热盐状态，不能单独判定水团变化。"
        )
        salinity_points = valid_profile_points("salinity")
        if salinity_points:
            minimum = min(salinity_points, key=lambda point: point["salinity"])
            deepest = max(salinity_points, key=lambda point: point["pressure"])
            findings.append(
                f"载入剖面的盐度极小值为 {minimum['salinity']:.3f} PSU，位于约 {minimum['pressure']:.0f} dbar；"
                f"到 {deepest['pressure']:.0f} dbar 时盐度为 {deepest['salinity']:.3f} PSU。"
                "这表明单剖面内存在中层低盐结构，不代表相对于气候态的盐度异常。"
            )
    if chla is not None:
        findings.append(
            f"最浅有效叶绿素 a 样本位于 {shallowest_pressure_text('chla')}，值为 {chla:.3f} mg m⁻³；不直接等同于生物量。"
        )
    if nitrate is not None:
        findings.append(
            f"最浅有效硝酸盐样本位于 {shallowest_pressure_text('nitrate')}，值为 {nitrate:.3f} μmol kg⁻¹；仅作为现场营养盐约束。"
        )
    if available_modes:
        findings.append(
            f"当前最浅有效样本的数据模式：{'、'.join(available_modes)}；调整值仅在上游逐点提供且 QC 通过时采用。"
        )
    caveats = [
        "最浅有效样本不等同于海表观测；若最浅压力明显大于 10 dbar，不能将其作为 SST 或 0 dbar 表层状态使用。",
        "这是单个 Argo 浮标的单时次剖面；没有同位置时间序列、逐日历气候基线或独立观测时，不能据此确认水团变化、海洋热浪或盐度异常。",
        "数值按样本逐点优先采用通过 QC 的调整值；上游未提供调整值时回退至通过 QC 的原始值，并在页面标明数据模式。",
        "实时资料与延迟模式资料的更新节奏不同；延迟模式调整值发布前，不将原始值用于定量长期趋势或传感器漂移归因。",
    ]
    raw_realtime = any(
        url.rsplit("/", 1)[-1].startswith("R") and url.rsplit("/", 1)[-1].endswith(".nc")
        for url in latest.get("source_urls") or []
    )
    if raw_realtime:
        caveats.append("本剖面源文件为实时模式 R 文件，当前温盐均为 QC 1 原始值，源记录尚未提供调整值。")
    track_cycles = [
        int(item["cycle"])
        for item in (track or [])
        if isinstance(item.get("cycle"), int)
    ]
    if any(current - previous != 1 for previous, current in zip(track_cycles, track_cycles[1:])):
        caveats.append("当前时间窗内的源周期标识存在跳号，轨迹按观测时间排序；不得用周期编号差推断采样频率或缺测数量。")
    return {
        "headline": f"Argo 第 {latest['cycle']} 周期现场剖面已接入",
        "summary": "；".join(item.rstrip("。") for item in findings[:2]) + "。",
        "findings": findings,
        "caveats": caveats,
        "generated_at": datetime.now(UTC).isoformat(),
        "method": "基于最新 Argo 剖面、最浅有效样本、载入深度范围和 QC 标识生成的规则化研读；不执行水团分类或事件确认。",
    }


def _fetch(platform: str) -> dict[str, Any]:
    query = urlencode(
        {
            "platform": platform,
            "data": ARGO_DATA_KEYS,
            "verticalRange": "0,2000",
        }
    )
    endpoint = f"{ARGO_API_ROOT}/argo?{query}"
    request = Request(
        endpoint,
        headers={
            "Accept": "application/json",
            "User-Agent": "OceanIntelligenceAgent/1.0 (Argo data client)",
        },
    )
    try:
        with urlopen(request, timeout=45) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as error:  # noqa: BLE001 - converts network failures to one domain error
        raise ArgoDataError(f"Argo 数据服务请求失败：{error}") from error
    if not isinstance(payload, list) or not payload:
        raise ArgoDataError(f"Argo 数据服务未返回浮标 {platform} 的剖面")

    normalized = [_normalize_profile(item) for item in payload if isinstance(item, dict)]
    normalized = [
        item
        for item in normalized
        if _timestamp(item["timestamp"]) is not None
        and item["longitude"] is not None
        and item["latitude"] is not None
        and -180 <= item["longitude"] <= 180
        and -90 <= item["latitude"] <= 90
    ]
    normalized.sort(key=lambda item: _timestamp_key(item["timestamp"]))
    if not normalized:
        raise ArgoDataError(f"Argo 浮标 {platform} 没有可用剖面")
    latest = normalized[-1]
    updated_at = max((item["updated_at"] for item in normalized if item["updated_at"]), default=None)
    source_urls = sorted({url for item in normalized for url in item["source_urls"]})
    fetched_at = datetime.now(UTC).isoformat()
    return {
        "platform": platform,
        "network": "BGC-Argo",
        "source": {
            "name": "国际 Argo 计划 / Argovis",
            "url": endpoint,
            "gdac_url": "https://argo.ucsd.edu/data/data-from-gdacs/",
            "source_urls": source_urls[:8],
            "credit": "数据来自国际 Argo 计划及参与国家计划，经 Argovis API 提供。",
        },
        "fetched_at": fetched_at,
        "source_updated_at": updated_at,
        "profile_count": len(normalized),
        "latest": latest,
        "track": [
            {
                "cycle": item["cycle"],
                "timestamp": item["timestamp"],
                "longitude": item["longitude"],
                "latitude": item["latitude"],
            }
            for item in normalized[-180:]
        ],
        "explanation": _explain_clean(platform, normalized),
    }


def _get_json(endpoint: str) -> Any:
    request = Request(
        endpoint,
        headers={
            "Accept": "application/json",
            "User-Agent": "OceanIntelligenceAgent/1.0 (Argo data client)",
        },
    )
    try:
        with urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as error:  # noqa: BLE001 - converts network failures to one domain error
        raise ArgoDataError(f"Argo \u6570\u636e\u670d\u52a1\u8bf7\u6c42\u5931\u8d25\uff1a{error}") from error


def _fetch_profile_snapshot(
    platform: str,
    latest_id: str,
    track: list[dict[str, Any]],
    networks: list[str],
    profile_count: int,
    *,
    profile_scope: str,
    profile_window_days: int | None,
) -> dict[str, Any]:
    profile_endpoint = f"{ARGO_API_ROOT}/argo?{urlencode({'id': latest_id, 'data': 'all', 'verticalRange': '0,2000'})}"
    payload = _get_json(profile_endpoint)
    records = [item for item in payload if isinstance(item, dict)] if isinstance(payload, list) else []
    if not records:
        raise ArgoDataError(f"Argo \u6570\u636e\u670d\u52a1\u672a\u8fd4\u56de\u6700\u65b0\u5256\u9762 {latest_id}")
    matching = [
        item
        for item in records
        if str(item.get("_id") or item.get("id") or item.get("profile_id") or "") == latest_id
    ]
    selected_record = matching[0] if matching else max(
        records,
        key=lambda item: _timestamp_key(item.get("timestamp") or item.get("date")),
    )
    latest = _normalize_profile(selected_record)
    if _timestamp(latest["timestamp"]) is None or latest["longitude"] is None or latest["latitude"] is None:
        raise ArgoDataError(f"Argo \u6700\u65b0\u5256\u9762 {latest_id} \u7f3a\u5c11\u4f4d\u7f6e\u6216\u65f6\u95f4")
    cleaned_track = [
        {key: item[key] for key in ("cycle", "timestamp", "longitude", "latitude")}
        for item in sorted(track, key=lambda item: _timestamp_key(item["timestamp"]))[-180:]
    ]
    return {
        "platform": platform,
        "network": "BGC-Argo" if "argo_bgc" in networks else "Core Argo",
        "source": {
            "name": "\u56fd\u9645 Argo \u8ba1\u5212 / Argovis",
            "url": profile_endpoint,
            "gdac_url": "https://argo.ucsd.edu/data/data-from-gdacs/",
            "source_urls": sorted(latest["source_urls"])[:8],
            "credit": "\u6570\u636e\u6765\u81ea\u56fd\u9645 Argo \u8ba1\u5212\u53ca\u53c2\u4e0e\u56fd\u5bb6\u8ba1\u5212\uff0c\u7ecf Argovis API \u63d0\u4f9b\u3002",
        },
        "fetched_at": datetime.now(UTC).isoformat(),
        "source_updated_at": latest["updated_at"],
        "profile_count": profile_count,
        "profile_scope": profile_scope,
        "profile_window_days": profile_window_days,
        "latest": latest,
        "track": cleaned_track,
        "explanation": _explain_clean(platform, [latest], track=cleaned_track),
    }


def _fetch_compact(platform: str) -> dict[str, Any]:
    track_endpoint = f"{ARGO_API_ROOT}/argo?{urlencode({'platform': platform, 'compression': 'minimal'})}"
    compact_profiles = _get_json(track_endpoint)
    if not isinstance(compact_profiles, list) or not compact_profiles:
        raise ArgoDataError(f"Argo \u6570\u636e\u670d\u52a1\u672a\u8fd4\u56de\u6d6e\u6807 {platform} \u7684\u8f68\u8ff9")

    track: list[dict[str, Any]] = []
    for item in compact_profiles:
        if not isinstance(item, list) or len(item) < 4:
            continue
        profile_id, longitude, latitude, timestamp = item[:4]
        networks = [str(value) for value in item[4]] if len(item) > 4 and isinstance(item[4], list) else []
        lon = _number(longitude)
        lat = _number(latitude)
        if not isinstance(profile_id, str) or lon is None or lat is None or _timestamp(timestamp) is None:
            continue
        try:
            cycle = int(profile_id.rsplit("_", 1)[-1])
        except ValueError:
            continue
        track.append({"id": profile_id, "cycle": cycle, "timestamp": timestamp, "longitude": lon, "latitude": lat, "networks": networks})
    track.sort(key=lambda item: _timestamp_key(item["timestamp"]))
    if not track:
        raise ArgoDataError(f"Argo \u6d6e\u6807 {platform} \u6ca1\u6709\u53ef\u7528\u8f68\u8ff9")

    return _fetch_profile_snapshot(
        platform,
        track[-1]["id"],
        track,
        track[-1]["networks"],
        len(track),
        profile_scope="lifetime",
        profile_window_days=None,
    )


def get_argo_float(platform: str = ARGO_DEFAULT_PLATFORM, *, force_refresh: bool = False) -> dict[str, Any]:
    platform = platform.strip()
    if not platform.isdigit() or not 5 <= len(platform) <= 8:
        raise ArgoDataError("Argo \u6d6e\u6807\u7f16\u53f7\u5fc5\u987b\u662f 5 \u81f3 8 \u4f4d\u6570\u5b57")
    if not platform.isdigit() or not 5 <= len(platform) <= 8:
        raise ArgoDataError("Argo 浮标编号必须是 5 至 8 位数字")
    cache_key = _profile_cache_key(platform, "lifetime")
    now = time.monotonic()
    with _cache_lock:
        cached = _cache.get(cache_key)
    if cached and not force_refresh and now - cached[0] < ARGO_CACHE_TTL_SECONDS:
        snapshot = deepcopy(cached[1])
        snapshot["cache"] = {"state": "fresh", "age_seconds": round(now - cached[0], 1), "ttl_seconds": ARGO_CACHE_TTL_SECONDS}
        return snapshot

    with _profile_fetch_lock(cache_key):
        with _cache_lock:
            current = _cache.get(cache_key)
        current_now = time.monotonic()
        if current and not force_refresh and current_now - current[0] < ARGO_CACHE_TTL_SECONDS:
            snapshot = deepcopy(current[1])
            snapshot["cache"] = {"state": "fresh", "age_seconds": round(current_now - current[0], 1), "ttl_seconds": ARGO_CACHE_TTL_SECONDS}
            return snapshot

        try:
            snapshot = _fetch_compact(platform)
        except ArgoDataError:
            fallback = current or cached
            if not fallback:
                raise
            snapshot = deepcopy(fallback[1])
            snapshot["cache"] = {"state": "stale", "age_seconds": round(current_now - fallback[0], 1), "ttl_seconds": ARGO_CACHE_TTL_SECONDS}
            return snapshot

        snapshot["source"]["name"] = "\u56fd\u9645 Argo \u8ba1\u5212 / Argovis"
        snapshot["source"]["credit"] = "\u6570\u636e\u6765\u81ea\u56fd\u9645 Argo \u8ba1\u5212\u53ca\u53c2\u4e0e\u56fd\u5bb6\u8ba1\u5212\uff0c\u7ecf Argovis API \u63d0\u4f9b\u3002"
        _store_profile_cache(cache_key, deepcopy(snapshot))
        snapshot["cache"] = {"state": "fresh", "age_seconds": 0.0, "ttl_seconds": ARGO_CACHE_TTL_SECONDS}
        return snapshot


def get_argo_float_history(
    platform: str,
    *,
    date_count: int = 7,
    force_refresh: bool = False,
) -> dict[str, Any]:
    platform = platform.strip()
    if not platform.isdigit() or not 5 <= len(platform) <= 8:
        raise ArgoDataError("Argo 浮标编号必须是 5 至 8 位数字")
    date_count = max(1, min(date_count, 30))
    now = datetime.now(UTC)
    lookback_days = max(90, date_count * 14)
    maximum_lookback_days = 1460
    profiles: list[dict[str, Any]] = []
    observation_dates: list[str] = []
    endpoint = ""

    while True:
        started_at = now - timedelta(days=lookback_days)
        endpoint = f"{ARGO_API_ROOT}/argo?{urlencode({'platform': platform, 'startDate': _iso_z(started_at), 'data': 'all', 'verticalRange': '0,2000'})}"
        payload = _get_json(endpoint)
        records = [item for item in payload if isinstance(item, dict)] if isinstance(payload, list) else []
        candidates = []
        for record in records:
            profile = _normalize_profile(record, full_points=True)
            timestamp = _timestamp(profile.get("timestamp"))
            if timestamp is None or timestamp < started_at or profile["longitude"] is None or profile["latitude"] is None:
                continue
            candidates.append(profile)
        profiles, observation_dates = _select_recent_observation_dates(candidates, date_count)
        if len(observation_dates) >= date_count or lookback_days >= maximum_lookback_days:
            break
        lookback_days = min(lookback_days * 2, maximum_lookback_days)

    if not profiles:
        raise ArgoDataError(f"浮标 {platform} 没有可导出的完整剖面数据")
    return {
        "platform": platform,
        "requested_date_count": date_count,
        "date_count": len(observation_dates),
        "observation_dates": observation_dates,
        "fetched_at": datetime.now(UTC),
        "profiles": profiles,
        "source_url": endpoint,
    }


def _select_recent_observation_dates(
    profiles: list[dict[str, Any]],
    date_count: int,
) -> tuple[list[dict[str, Any]], list[str]]:
    dated_profiles = [
        (timestamp, profile)
        for profile in profiles
        if (timestamp := _timestamp(profile.get("timestamp"))) is not None
    ]
    dated_profiles.sort(key=lambda item: item[0], reverse=True)
    selected_dates: list[str] = []
    for timestamp, _profile in dated_profiles:
        observation_date = timestamp.date().isoformat()
        if observation_date not in selected_dates:
            selected_dates.append(observation_date)
        if len(selected_dates) >= date_count:
            break
    selected_date_set = set(selected_dates)
    selected_profiles = [
        profile
        for timestamp, profile in dated_profiles
        if timestamp.date().isoformat() in selected_date_set
    ]
    selected_profiles.sort(key=lambda item: _timestamp_key(item["timestamp"]))
    return selected_profiles, sorted(selected_dates)


def _iso_z(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _region_source(endpoint: str) -> dict[str, Any]:
    return {
        "name": "\u56fd\u9645 Argo \u8ba1\u5212 / Argovis",
        "url": endpoint,
        "gdac_url": "https://argo.ucsd.edu/data/data-from-gdacs/",
        "source_urls": [],
        "credit": "\u6570\u636e\u6765\u81ea\u56fd\u9645 Argo \u8ba1\u5212\u53ca\u53c2\u4e0e\u56fd\u5bb6\u8ba1\u5212\uff0c\u7ecf Argovis API \u63d0\u4f9b\u3002",
    }


def _parse_regional_row(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, list) or len(item) < 4:
        return None
    profile_id, longitude, latitude, timestamp = item[:4]
    lon = _number(longitude)
    lat = _number(latitude)
    parsed_timestamp = _timestamp(timestamp)
    if (
        not isinstance(profile_id, str)
        or "_" not in profile_id
        or lon is None
        or lat is None
        or parsed_timestamp is None
        or parsed_timestamp > datetime.now(UTC) + timedelta(days=2)
        or not -180 <= lon <= 180
        or not -90 <= lat <= 90
    ):
        return None
    platform, cycle_text = profile_id.rsplit("_", 1)
    if not platform.isdigit():
        return None
    try:
        cycle = int(cycle_text)
    except ValueError:
        return None
    if cycle <= 0:
        return None
    networks = [str(value) for value in item[4]] if len(item) > 4 and isinstance(item[4], list) else []
    return {
        "platform": platform,
        "latest_profile_id": profile_id,
        "cycle": cycle,
        "timestamp": timestamp,
        "longitude": lon,
        "latitude": lat,
        "profile_count": 1,
        "networks": networks,
        "has_bgc": "argo_bgc" in networks,
        "distance_km": None,
        "within_event_radius": False,
    }


def _fetch_region(
    region_id: str,
    bounds: tuple[tuple[float, float], tuple[float, float]],
    region_name: str,
) -> dict[str, Any]:
    now = datetime.now(UTC)
    started_at = now - timedelta(days=ARGO_REGION_LOOKBACK_DAYS)
    query: dict[str, str] = {
        "startDate": _iso_z(started_at),
        "compression": "minimal",
    }
    # Argovis treats a missing box as the global catalog. The global UI must
    # not silently inherit the default northwest-Pacific rectangle.
    if region_id != "global_ocean":
        query["box"] = json.dumps(bounds, separators=(",", ":"))
    endpoint = f"{ARGO_API_ROOT}/argo?{urlencode(query)}"
    payload = _get_json(endpoint)
    if not isinstance(payload, list):
        raise ArgoDataError("Argo \u533a\u57df\u76ee\u5f55\u672a\u8fd4\u56de\u53ef\u7528\u6570\u636e")

    latest_by_platform: dict[str, dict[str, Any]] = {}
    counts: dict[str, int] = {}
    recent_tracks: dict[str, list[dict[str, Any]]] = {}
    profiles: list[dict[str, Any]] = []
    valid_profile_count = 0
    for item in payload:
        row = _parse_regional_row(item)
        if row is None:
            continue
        valid_profile_count += 1
        # Preserve every valid compact profile from the regional catalog.
        # The latest-per-platform view remains available separately as floats.
        profiles.append(row.copy())
        platform = row["platform"]
        counts[platform] = counts.get(platform, 0) + 1
        recent_tracks.setdefault(platform, []).append(
            {key: row[key] for key in ("cycle", "timestamp", "longitude", "latitude")}
        )
        current = latest_by_platform.get(platform)
        if current is None or _timestamp_key(row["timestamp"]) > _timestamp_key(current["timestamp"]):
            latest_by_platform[platform] = row

    if not latest_by_platform:
        raise ArgoDataError("Argo \u533a\u57df\u76ee\u5f55\u5728\u5f53\u524d\u65f6\u95f4\u7a97\u5185\u6ca1\u6709\u6d3b\u8dc3\u6d6e\u6807")

    floats = list(latest_by_platform.values())
    for item in floats:
        item["profile_count"] = counts[item["platform"]]
        item["_recent_track"] = sorted(
            recent_tracks[item["platform"]],
            key=lambda point: _timestamp_key(point["timestamp"]),
        )[-12:]
    floats.sort(key=lambda item: _timestamp_key(item["timestamp"]), reverse=True)
    profiles.sort(key=lambda item: _timestamp_key(item["timestamp"]), reverse=True)
    return {
        "region_id": region_id,
        "region": f"{region_name}\u6d3b\u8dc3 Argo \u89c2\u6d4b\u7f51",
        "bounds": bounds,
        "lookback_days": ARGO_REGION_LOOKBACK_DAYS,
        "fetched_at": now.isoformat(),
        "profile_count": valid_profile_count,
        "float_count": len(floats),
        "bgc_float_count": sum(item["has_bgc"] for item in floats),
        "latest_observation_at": floats[0]["timestamp"],
        "profiles": profiles,
        "floats": floats,
        "source": _region_source(endpoint),
    }


def get_argo_region(
    *,
    region_id: str = "northwest_pacific",
    bounds: tuple[tuple[float, float], tuple[float, float]] = ARGO_REGION_BOUNDS,
    region_name: str = "\u4e2d\u56fd\u53ca\u897f\u5317\u592a\u5e73\u6d0b",
    force_refresh: bool = False,
) -> dict[str, Any]:
    now = time.monotonic()
    with _region_cache_lock:
        cached = _region_cache.get(region_id)
    if cached and not force_refresh:
        age_seconds = max(0.0, now - cached[0])
        result = deepcopy(cached[1])
        result["cache"] = {
            "state": "fresh" if age_seconds < ARGO_CACHE_TTL_SECONDS else "stale",
            "age_seconds": round(age_seconds, 1),
            "ttl_seconds": ARGO_CACHE_TTL_SECONDS,
        }
        if age_seconds >= ARGO_CACHE_TTL_SECONDS:
            _schedule_region_revalidation(region_id, bounds, region_name)
        return result

    with _region_fetch_lock:
        with _region_cache_lock:
            current = _region_cache.get(region_id)
        current_now = time.monotonic()
        if current and not force_refresh:
            age_seconds = max(0.0, current_now - current[0])
            result = deepcopy(current[1])
            result["cache"] = {
                "state": "fresh" if age_seconds < ARGO_CACHE_TTL_SECONDS else "stale",
                "age_seconds": round(age_seconds, 1),
                "ttl_seconds": ARGO_CACHE_TTL_SECONDS,
            }
            if age_seconds >= ARGO_CACHE_TTL_SECONDS:
                _schedule_region_revalidation(region_id, bounds, region_name)
            return result
        try:
            result = _fetch_region(region_id, bounds, region_name)
        except ArgoDataError:
            fallback = current or cached
            if not fallback:
                raise
            result = fallback[1].copy()
            result["cache"] = {"state": "stale", "age_seconds": round(current_now - fallback[0], 1), "ttl_seconds": ARGO_CACHE_TTL_SECONDS}
            return result
        result["cache"] = {"state": "fresh", "age_seconds": 0.0, "ttl_seconds": ARGO_CACHE_TTL_SECONDS}
        with _region_cache_lock:
            _region_cache[region_id] = (time.monotonic(), result)
        return result


def _get_argo_float_from_region(candidate: dict[str, Any], *, force_refresh: bool = False) -> dict[str, Any]:
    platform = candidate["platform"]
    cache_key = _profile_cache_key(platform, "regional_window")
    now = time.monotonic()
    with _cache_lock:
        cached = _cache.get(cache_key)
    if cached is None and not force_refresh:
        persisted = _load_persisted_profile(cache_key)
        if persisted is not None:
            cached = persisted
            with _cache_lock:
                _cache[cache_key] = persisted
    cache_matches_latest = cached and cached[1]["latest"]["timestamp"] == candidate["timestamp"]
    if cache_matches_latest and not force_refresh and now - cached[0] < ARGO_PROFILE_CACHE_TTL_SECONDS:
        snapshot = deepcopy(cached[1])
        snapshot["cache"] = {"state": "fresh", "age_seconds": round(now - cached[0], 1), "ttl_seconds": ARGO_PROFILE_CACHE_TTL_SECONDS}
        return snapshot

    with _profile_fetch_lock(cache_key):
        with _cache_lock:
            current = _cache.get(cache_key)
        current_now = time.monotonic()
        current_matches_latest = current and current[1]["latest"]["timestamp"] == candidate["timestamp"]
        if current_matches_latest and not force_refresh and current_now - current[0] < ARGO_PROFILE_CACHE_TTL_SECONDS:
            snapshot = deepcopy(current[1])
            snapshot["cache"] = {"state": "fresh", "age_seconds": round(current_now - current[0], 1), "ttl_seconds": ARGO_PROFILE_CACHE_TTL_SECONDS}
            return snapshot
        track = candidate.get("_recent_track") or [
            {key: candidate[key] for key in ("cycle", "timestamp", "longitude", "latitude")}
        ]
        try:
            snapshot = _fetch_profile_snapshot(
                platform,
                candidate["latest_profile_id"],
                track,
                candidate["networks"],
                candidate["profile_count"],
                profile_scope="regional_window",
                profile_window_days=ARGO_REGION_LOOKBACK_DAYS,
            )
        except ArgoDataError:
            fallback = current or cached
            if not fallback:
                raise
            snapshot = deepcopy(fallback[1])
            snapshot["cache"] = {"state": "stale", "age_seconds": round(current_now - fallback[0], 1), "ttl_seconds": ARGO_PROFILE_CACHE_TTL_SECONDS}
            return snapshot
        _store_profile_cache(cache_key, deepcopy(snapshot))
        snapshot["cache"] = {"state": "fresh", "age_seconds": 0.0, "ttl_seconds": ARGO_PROFILE_CACHE_TTL_SECONDS}
        return snapshot


def _haversine_km(longitude_a: float, latitude_a: float, longitude_b: float, latitude_b: float) -> float:
    radius = 6371.0088
    phi_a = math.radians(latitude_a)
    phi_b = math.radians(latitude_b)
    delta_phi = math.radians(latitude_b - latitude_a)
    delta_lambda = math.radians(longitude_b - longitude_a)
    value = math.sin(delta_phi / 2) ** 2 + math.cos(phi_a) * math.cos(phi_b) * math.sin(delta_lambda / 2) ** 2
    value = min(1.0, max(0.0, value))
    return radius * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def _rank_region_floats(region: dict[str, Any], longitude: float, latitude: float) -> list[dict[str, Any]]:
    ranked: list[dict[str, Any]] = []
    for item in region["floats"]:
        candidate = deepcopy(item)
        candidate["distance_km"] = round(
            _haversine_km(longitude, latitude, candidate["longitude"], candidate["latitude"]),
            3,
        )
        ranked.append(candidate)
    ranked.sort(key=lambda item: item["distance_km"])
    return ranked


def _nearest_region_floats(
    region: dict[str, Any],
    longitude: float,
    latitude: float,
    limit: int,
) -> list[dict[str, Any]]:
    """Find top-k candidates in O(n log k) while retaining exact Haversine distances."""
    nearest = nsmallest(
        limit,
        (
            (
                round(_haversine_km(longitude, latitude, item["longitude"], item["latitude"]), 3),
                index,
                item,
            )
            for index, item in enumerate(region["floats"])
        ),
        key=lambda ranked_item: (ranked_item[0], ranked_item[1]),
    )
    candidates: list[dict[str, Any]] = []
    for distance_km, _index, item in nearest:
        candidate = deepcopy(item)
        candidate["distance_km"] = distance_km
        candidates.append(candidate)
    return candidates


def get_nearest_argo(
    longitude: float,
    latitude: float,
    *,
    platform: str | None = None,
    region_id: str = "northwest_pacific",
    bounds: tuple[tuple[float, float], tuple[float, float]] = ARGO_REGION_BOUNDS,
    region_name: str = "\u4e2d\u56fd\u53ca\u897f\u5317\u592a\u5e73\u6d0b",
    force_refresh: bool = False,
) -> dict[str, Any]:
    """Return the nearest active Argo floats and one full profile for an arbitrary map point."""
    region = get_argo_region(
        region_id=region_id,
        bounds=bounds,
        region_name=region_name,
        force_refresh=force_refresh,
    )
    candidates = _nearest_region_floats(region, longitude, latitude, ARGO_POINT_CANDIDATE_LIMIT)
    if not candidates:
        raise ArgoDataError("\u5f53\u524d\u6d77\u57df\u6ca1\u6709\u53ef\u7528 Argo \u6d6e\u6807")

    nearest_item = candidates[0]
    selected = platform.strip() if platform else nearest_item["platform"]
    known_platforms = {item["platform"]: item for item in region["floats"]}
    if selected not in known_platforms:
        raise ArgoDataError(f"Argo \u6d6e\u6807 {selected} \u4e0d\u5728\u5f53\u524d\u6d77\u57df\u6d3b\u8dc3\u76ee\u5f55\u4e2d")
    if selected not in {item["platform"] for item in candidates}:
        selected_item = deepcopy(known_platforms[selected])
        selected_item["distance_km"] = round(
            _haversine_km(longitude, latitude, selected_item["longitude"], selected_item["latitude"]),
            3,
        )
        candidates = [*candidates[:-1], selected_item]

    selected_item = next(item for item in candidates if item["platform"] == selected)
    snapshot = _get_argo_float_from_region(selected_item, force_refresh=force_refresh)
    return {
        "query_point": (longitude, latitude),
        "region_id": region_id,
        "region": region_name,
        "regional_float_count": region["float_count"],
        "candidates": candidates,
        "nearest_platform": nearest_item["platform"],
        "nearest_distance_km": nearest_item["distance_km"],
        "selected_platform": selected,
        "selected_distance_km": selected_item["distance_km"],
        "snapshot": snapshot,
        "fetched_at": datetime.now(UTC).isoformat(),
    }


def get_event_argo(
    event_id: str,
    event_title: str,
    event_center: tuple[float, float],
    event_radius_km: float,
    *,
    radius_basis: str = "reported_extent",
    platform: str | None = None,
    region_id: str = "northwest_pacific",
    bounds: tuple[tuple[float, float], tuple[float, float]] = ARGO_REGION_BOUNDS,
    region_name: str = "\u4e2d\u56fd\u53ca\u897f\u5317\u592a\u5e73\u6d0b",
    force_refresh: bool = False,
) -> dict[str, Any]:
    region = get_argo_region(
        region_id=region_id,
        bounds=bounds,
        region_name=region_name,
        force_refresh=force_refresh,
    )
    longitude, latitude = event_center
    ranked = _rank_region_floats(region, longitude, latitude)
    for candidate in ranked:
        candidate["within_event_radius"] = candidate["distance_km"] <= event_radius_km
    matched = [item for item in ranked if item["within_event_radius"]]
    candidates = (matched if matched else ranked)[:ARGO_EVENT_CANDIDATE_LIMIT]
    if not candidates:
        raise ArgoDataError("\u5f53\u524d\u533a\u57df\u6ca1\u6709\u53ef\u7528 Argo \u6d6e\u6807")

    selected = platform.strip() if platform else candidates[0]["platform"]
    known_platforms = {item["platform"] for item in region["floats"]}
    if selected not in known_platforms:
        raise ArgoDataError(f"Argo \u6d6e\u6807 {selected} \u4e0d\u5728\u5f53\u524d\u533a\u57df\u6d3b\u8dc3\u76ee\u5f55\u4e2d")
    if selected not in {item["platform"] for item in candidates}:
        selected_item = next(item for item in ranked if item["platform"] == selected)
        candidates = [selected_item, *candidates[:-1]]

    selected_item = next(item for item in ranked if item["platform"] == selected)
    snapshot = _get_argo_float_from_region(selected_item, force_refresh=force_refresh)
    return {
        "event_id": event_id,
        "event_title": event_title,
        "event_center": event_center,
        "event_radius_km": event_radius_km,
        "radius_basis": radius_basis,
        "regional_float_count": region["float_count"],
        "matched_count": len(matched),
        "match_mode": "within_event" if matched else "nearest",
        "candidates": candidates,
        "selected_platform": selected,
        "snapshot": snapshot,
        "fetched_at": datetime.now(UTC).isoformat(),
    }


def get_argo_region_samples(
    *,
    region_id: str,
    bounds: tuple[tuple[float, float], tuple[float, float]],
    region_name: str,
    sample_limit: int = 12,
    force_refresh: bool = False,
) -> tuple[dict[str, Any], list[dict[str, Any]], int]:
    """Fetch a bounded, recent set of full profiles for regional anomaly screening."""
    region = get_argo_region(
        region_id=region_id,
        bounds=bounds,
        region_name=region_name,
        force_refresh=force_refresh,
    )
    # Keep the recent profile budget bounded, but reserve the first slots for
    # BGC floats so the nutrient and chlorophyll dimensions are represented.
    limit = max(8, min(sample_limit, 96))
    candidates = _select_region_sample_candidates(region["floats"], limit)
    samples: list[dict[str, Any]] = []
    failures = 0

    def fetch_candidate(candidate: dict[str, Any]) -> dict[str, Any]:
        track = candidate.get("_recent_track") or [
            {key: candidate[key] for key in ("cycle", "timestamp", "longitude", "latitude")}
        ]
        snapshot = _fetch_profile_snapshot(
            candidate["platform"],
            candidate["latest_profile_id"],
            track,
            candidate["networks"],
            candidate["profile_count"],
            profile_scope="regional_window",
            profile_window_days=ARGO_REGION_LOOKBACK_DAYS,
        )
        snapshot["cache"] = {
            "state": "fresh",
            "age_seconds": 0.0,
            "ttl_seconds": ARGO_CACHE_TTL_SECONDS,
        }
        _store_profile_cache(
            _profile_cache_key(candidate["platform"], "regional_window"),
            deepcopy(snapshot),
        )
        return snapshot

    with ThreadPoolExecutor(max_workers=min(6, len(candidates))) as executor:
        futures = [executor.submit(fetch_candidate, candidate) for candidate in candidates]
        for future in as_completed(futures):
            try:
                samples.append(future.result())
            except ArgoDataError:
                failures += 1

    samples.sort(key=lambda item: _timestamp_key(item["latest"]["timestamp"]), reverse=True)
    return region, samples, failures


def _select_region_sample_candidates(
    floats: list[dict[str, Any]],
    limit: int,
) -> list[dict[str, Any]]:
    """Select spatially distinct recent floats while guaranteeing BGC slots."""
    bounded_limit = max(1, min(limit, 96))
    bgc_target = min(
        bounded_limit,
        ARGO_BGC_SAMPLE_TARGET,
        sum(item.get("has_bgc") is True for item in floats),
    )
    # Regional catalog rows expose their observation time as ``timestamp``.
    # Keep the full-profile fetch budget focused on the newest measurements;
    # the BGC minimum is applied separately below.
    ranked = sorted(
        floats,
        key=lambda item: _timestamp_key(item.get("timestamp")),
        reverse=True,
    )
    candidates: list[dict[str, Any]] = []
    selected_platforms: set[str] = set()
    occupied: set[tuple[int, int]] = set()

    def add(candidate: dict[str, Any], *, respect_cell: bool) -> bool:
        platform = str(candidate.get("platform") or "")
        if not platform or platform in selected_platforms:
            return False
        try:
            cell = (math.floor(float(candidate["latitude"]) / 8), math.floor(float(candidate["longitude"]) / 12))
        except (KeyError, TypeError, ValueError):
            return False
        if respect_cell and cell in occupied:
            return False
        selected_platforms.add(platform)
        occupied.add(cell)
        candidates.append(candidate)
        return True

    bgc_selected = 0
    bgc_floats = [item for item in ranked if item.get("has_bgc") is True]
    for candidate in bgc_floats:
        if bgc_selected >= bgc_target or len(candidates) >= bounded_limit:
            break
        if add(candidate, respect_cell=True):
            bgc_selected += 1
    for candidate in bgc_floats:
        if bgc_selected >= bgc_target or len(candidates) >= bounded_limit:
            break
        if add(candidate, respect_cell=False):
            bgc_selected += 1
    for candidate in ranked:
        if len(candidates) >= bounded_limit:
            break
        add(candidate, respect_cell=True)
    for candidate in ranked:
        if len(candidates) >= bounded_limit:
            break
        add(candidate, respect_cell=False)
    return candidates
