from __future__ import annotations

import json
import math
import os
import threading
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen


NOAA_ERDDAP_ROOT = "https://coastwatch.noaa.gov/erddap"
NOAA_SST_DATASET = "noaacwBLENDEDsstDaily"
NOAA_CACHE_TTL_SECONDS = 300.0
NOAA_CACHE_DIR = Path(
    os.getenv("NOAA_CACHE_DIR", str(Path(__file__).resolve().parents[2] / ".cache" / "noaa"))
)
NOAA_SST_LOOKBACK_DAYS = max(int(os.getenv("NOAA_SST_LOOKBACK_DAYS", "7")), 3)
NOAA_SST_TARGET_STEPS = max(int(os.getenv("NOAA_SST_TARGET_STEPS", "64")), 16)
NOAA_SST_MAP_TARGET_STEPS = max(int(os.getenv("NOAA_SST_MAP_TARGET_STEPS", "192")), 64)
NOAA_SST_NATIVE_RESOLUTION_DEGREES = 0.05
NOAA_SST_MAX_ANALYSIS_ERROR_C = 5.0
NOAA_MAX_SEA_ICE_FRACTION = 0.15


class NoaaDataError(RuntimeError):
    pass


_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_cache_lock = threading.Lock()


def _persistent_cache_path(region_id: str) -> Path:
    return NOAA_CACHE_DIR / f"{region_id}.json"


def _persist_snapshot(region_id: str, snapshot: dict[str, Any]) -> None:
    if not snapshot.get("latest_points") or int(snapshot.get("latest_point_count") or 0) <= 0:
        return
    document = {
        "format_version": 1,
        "region_id": region_id,
        "saved_at": time.time(),
        "snapshot": {key: value for key, value in snapshot.items() if key != "cache"},
    }
    path = _persistent_cache_path(region_id)
    temporary = path.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with temporary.open("w", encoding="utf-8") as handle:
            json.dump(document, handle, ensure_ascii=False, separators=(",", ":"))
        temporary.replace(path)
    except OSError:
        temporary.unlink(missing_ok=True)


def _load_persisted_snapshot(region_id: str) -> tuple[float, dict[str, Any]] | None:
    path = _persistent_cache_path(region_id)
    try:
        with path.open("r", encoding="utf-8") as handle:
            document = json.load(handle)
        snapshot = document["snapshot"]
        if (
            document.get("format_version") != 1
            or document.get("region_id") != region_id
            or not isinstance(snapshot, dict)
            or not snapshot.get("latest_points")
            or int(snapshot.get("latest_point_count") or 0) <= 0
        ):
            return None
        age_seconds = max(0.0, time.time() - float(document["saved_at"]))
        return age_seconds, snapshot
    except (OSError, ValueError, TypeError, KeyError):
        return None


def preload_noaa_sst_cache() -> dict[str, int]:
    """Load all persisted NOAA SST region snapshots into process memory."""
    loaded: dict[str, int] = {}
    now = time.monotonic()
    for path in NOAA_CACHE_DIR.glob("*.json"):
        region_id = path.stem
        persisted = _load_persisted_snapshot(region_id)
        if persisted is None:
            continue
        age_seconds, snapshot = persisted
        with _cache_lock:
            _cache[region_id] = (now - age_seconds, snapshot)
        loaded[region_id] = len(snapshot.get("latest_points", []))
    return loaded


def _grid_stride(span: float, target_steps: int = NOAA_SST_TARGET_STEPS) -> int:
    return max(1, round((span / target_steps) / 0.05))


def _parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return None
    return parsed.astimezone(UTC)


def _iso_z(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _request_json(endpoint: str) -> dict[str, Any]:
    request = Request(
        endpoint,
        headers={"Accept": "application/json", "User-Agent": "OceanIntelligenceAgent/1.0"},
    )
    try:
        with urlopen(request, timeout=45) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as error:  # noqa: BLE001 - converts network failures to one domain error
        raise NoaaDataError(f"NOAA ERDDAP 海温数据请求失败：{error}") from error
    if not isinstance(payload, dict):
        raise NoaaDataError("NOAA ERDDAP 返回格式无效")
    return payload


def _latest_dataset_timestamp() -> datetime:
    endpoint = f"{NOAA_ERDDAP_ROOT}/griddap/{NOAA_SST_DATASET}.json?time[(last)]"
    payload = _request_json(endpoint)
    rows = ((payload.get("table") or {}).get("rows") or [])
    timestamps = [_parse_timestamp(row[0]) for row in rows if isinstance(row, list) and row]
    latest = max((value for value in timestamps if value is not None), default=None)
    if latest is None:
        raise NoaaDataError("NOAA ERDDAP 没有返回有效的最新时间")
    return latest


def _parse_grid_points(payload: dict[str, Any]) -> tuple[list[dict[str, Any]], bool]:
    table = payload.get("table") or {}
    names = [str(name) for name in table.get("columnNames") or []]
    rows = table.get("rows") or []
    indexes = {name: index for index, name in enumerate(names)}
    required = {"time", "latitude", "longitude", "analysed_sst"}
    if not required <= indexes.keys():
        return [], False
    quality_fields_complete = {"analysis_error", "mask", "sea_ice_fraction"} <= indexes.keys()
    points: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, list):
            continue
        try:
            timestamp = str(row[indexes["time"]])
            parsed_timestamp = _parse_timestamp(timestamp)
            latitude = float(row[indexes["latitude"]])
            longitude = float(row[indexes["longitude"]])
            temperature = float(row[indexes["analysed_sst"]]) - 273.15
        except (IndexError, TypeError, ValueError):
            continue
        if (
            parsed_timestamp is None
            or not all(math.isfinite(item) for item in (temperature, latitude, longitude))
            or not -90 <= latitude <= 90
            or not -180 <= longitude <= 180
            or not -2.0 <= temperature <= 45.0
        ):
            continue

        analysis_error: float | None = None
        mask_value: int | None = None
        ice_fraction: float | None = None
        quality_valid = quality_fields_complete
        if quality_fields_complete:
            try:
                analysis_error = float(row[indexes["analysis_error"]])
                mask_value = int(row[indexes["mask"]])
                ice_fraction = float(row[indexes["sea_ice_fraction"]])
            except (IndexError, TypeError, ValueError):
                quality_valid = False
            if analysis_error is None or not math.isfinite(analysis_error) or not 0 <= analysis_error <= NOAA_SST_MAX_ANALYSIS_ERROR_C:
                quality_valid = False
            if mask_value is None or not (mask_value & 1) or (mask_value & 4):
                quality_valid = False
            if ice_fraction is None or not math.isfinite(ice_fraction) or not 0 <= ice_fraction <= NOAA_MAX_SEA_ICE_FRACTION:
                quality_valid = False
        points.append(
            {
                "timestamp": timestamp,
                "latitude": round(latitude, 4),
                "longitude": round(longitude, 4),
                "temperature": round(temperature, 3),
                "analysis_error": round(analysis_error, 3) if analysis_error is not None else None,
                "mask": mask_value,
                "sea_ice_fraction": round(ice_fraction, 4) if ice_fraction is not None else None,
                "quality_valid": quality_valid,
            }
        )
    return points, quality_fields_complete


def _fetch_sst(
    region_id: str,
    bounds: tuple[tuple[float, float], tuple[float, float]],
) -> dict[str, Any]:
    (west, south), (east, north) = bounds
    latest = _latest_dataset_timestamp()
    start = latest - timedelta(days=NOAA_SST_LOOKBACK_DAYS - 1)
    time_slice = f"[({_iso_z(start)}):1:({_iso_z(latest)})]"
    lat_stride = _grid_stride(north - south)
    lon_stride = _grid_stride(east - west)
    spatial_slice = f"[({south}):{lat_stride}:({north})][({west}):{lon_stride}:({east})]"
    subset = ",".join(
        f"{variable}{time_slice}{spatial_slice}"
        for variable in ("analysed_sst", "analysis_error", "mask", "sea_ice_fraction")
    )
    endpoint = f"{NOAA_ERDDAP_ROOT}/griddap/{NOAA_SST_DATASET}.json?{subset}"
    payload = _request_json(endpoint)
    table = payload.get("table") or {}
    names = [str(name) for name in table.get("columnNames") or []]
    rows = table.get("rows") or []
    indexes = {name: index for index, name in enumerate(names)}
    required = {"time", "latitude", "longitude", "analysed_sst"}
    if not required <= indexes.keys():
        raise NoaaDataError("NOAA ERDDAP 返回结果缺少海温坐标字段")
    quality_fields_complete = {"analysis_error", "mask", "sea_ice_fraction"} <= indexes.keys()

    points: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, list):
            continue
        try:
            timestamp = str(row[indexes["time"]])
            parsed_timestamp = _parse_timestamp(timestamp)
            lat = float(row[indexes["latitude"]])
            lon = float(row[indexes["longitude"]])
            value = float(row[indexes["analysed_sst"]]) - 273.15
        except (IndexError, TypeError, ValueError):
            continue
        if (
            parsed_timestamp is None
            or not all(math.isfinite(item) for item in (value, lat, lon))
            or not -90 <= lat <= 90
            or not -180 <= lon <= 180
            or not -2.0 <= value <= 45.0
        ):
            continue

        analysis_error: float | None = None
        mask_value: int | None = None
        ice_fraction: float | None = None
        quality_valid = quality_fields_complete
        if quality_fields_complete:
            try:
                analysis_error = float(row[indexes["analysis_error"]])
                mask_value = int(row[indexes["mask"]])
                ice_fraction = float(row[indexes["sea_ice_fraction"]])
            except (IndexError, TypeError, ValueError):
                quality_valid = False
            if analysis_error is None or not math.isfinite(analysis_error) or not 0 <= analysis_error <= NOAA_SST_MAX_ANALYSIS_ERROR_C:
                quality_valid = False
            if mask_value is None or not (mask_value & 1) or (mask_value & 4):
                quality_valid = False
            if ice_fraction is None or not math.isfinite(ice_fraction) or not 0 <= ice_fraction <= NOAA_MAX_SEA_ICE_FRACTION:
                quality_valid = False

        points.append(
            {
                "timestamp": timestamp,
                "latitude": round(lat, 4),
                "longitude": round(lon, 4),
                "temperature": round(value, 3),
                "analysis_error": round(analysis_error, 3) if analysis_error is not None else None,
                "mask": mask_value,
                "sea_ice_fraction": round(ice_fraction, 4) if ice_fraction is not None else None,
                "quality_valid": quality_valid,
            }
        )
    if not points:
        raise NoaaDataError("NOAA ERDDAP 当前区域没有返回有效海温网格")

    timestamps = sorted({point["timestamp"] for point in points}, key=lambda value: _parse_timestamp(value) or datetime.min.replace(tzinfo=UTC))
    latest_timestamp = timestamps[-1]
    map_lat_stride = _grid_stride(north - south, NOAA_SST_MAP_TARGET_STEPS)
    map_lon_stride = _grid_stride(east - west, NOAA_SST_MAP_TARGET_STEPS)
    latest_points = [point for point in points if point["timestamp"] == latest_timestamp]
    map_endpoint = endpoint
    if map_lat_stride < lat_stride or map_lon_stride < lon_stride:
        latest_slice = f"[({_iso_z(latest)}):1:({_iso_z(latest)})]"
        map_spatial_slice = f"[({south}):{map_lat_stride}:({north})][({west}):{map_lon_stride}:({east})]"
        map_subset = ",".join(
            f"{variable}{latest_slice}{map_spatial_slice}"
            for variable in ("analysed_sst", "analysis_error", "mask", "sea_ice_fraction")
        )
        map_endpoint = f"{NOAA_ERDDAP_ROOT}/griddap/{NOAA_SST_DATASET}.json?{map_subset}"
        try:
            dense_points, dense_quality_complete = _parse_grid_points(_request_json(map_endpoint))
        except NoaaDataError:
            dense_points = []
            dense_quality_complete = False
        if dense_points:
            latest_points = dense_points
            quality_fields_complete = quality_fields_complete and dense_quality_complete
    historical_points = [point for point in points if point["timestamp"] != latest_timestamp]
    monitoring_points = historical_points + latest_points
    return {
        "region_id": region_id,
        "dataset": NOAA_SST_DATASET,
        "fetched_at": datetime.now(UTC).isoformat(),
        "latest_observation_at": latest_timestamp,
        "time_count": len(timestamps),
        "lookback_days": NOAA_SST_LOOKBACK_DAYS,
        "native_resolution_degrees": NOAA_SST_NATIVE_RESOLUTION_DEGREES,
        "latitude_step_degrees": round(map_lat_stride * NOAA_SST_NATIVE_RESOLUTION_DEGREES, 4),
        "longitude_step_degrees": round(map_lon_stride * NOAA_SST_NATIVE_RESOLUTION_DEGREES, 4),
        "analysis_latitude_step_degrees": round(lat_stride * NOAA_SST_NATIVE_RESOLUTION_DEGREES, 4),
        "analysis_longitude_step_degrees": round(lon_stride * NOAA_SST_NATIVE_RESOLUTION_DEGREES, 4),
        "quality_fields_complete": quality_fields_complete,
        "point_count": len(monitoring_points),
        "analysis_point_count": len(points),
        "latest_point_count": len(latest_points),
        "quality_valid_count": sum(point["quality_valid"] for point in monitoring_points),
        "points": points,
        "latest_points": latest_points,
        "source": {
            "name": "NOAA CoastWatch ERDDAP / Geo-polar Blended SST",
            "url": endpoint,
            "map_url": map_endpoint,
            "dataset_url": f"{NOAA_ERDDAP_ROOT}/griddap/{NOAA_SST_DATASET}.html",
        },
    }


def get_noaa_sst(
    region_id: str,
    bounds: tuple[tuple[float, float], tuple[float, float]],
    *,
    force_refresh: bool = False,
) -> dict[str, Any]:
    now = time.monotonic()
    with _cache_lock:
        cached = _cache.get(region_id)
    if cached is None:
        persisted = _load_persisted_snapshot(region_id)
        if persisted is not None:
            persisted_age, persisted_snapshot = persisted
            cached = (now - persisted_age, persisted_snapshot)
            with _cache_lock:
                _cache[region_id] = cached
    if cached and not force_refresh and now - cached[0] < NOAA_CACHE_TTL_SECONDS:
        result = cached[1].copy()
        result["cache"] = {"state": "fresh", "age_seconds": round(now - cached[0], 1)}
        return result
    try:
        result = _fetch_sst(region_id, bounds)
    except NoaaDataError:
        if not cached:
            raise
        result = cached[1].copy()
        result["cache"] = {"state": "stale", "age_seconds": round(now - cached[0], 1)}
        return result
    result["cache"] = {"state": "fresh", "age_seconds": 0.0}
    with _cache_lock:
        _cache[region_id] = (time.monotonic(), result)
    _persist_snapshot(region_id, result)
    return result
