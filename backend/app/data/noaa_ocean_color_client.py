from __future__ import annotations

import json
import math
import os
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen


NOAA_ERDDAP_ROOT = "https://coastwatch.noaa.gov/erddap"
NOAA_CHLA_ANOMALY_DATASET = "noaacwN20VIIRSSCIchlanomdifDaily"
NOAA_CHLA_OBSERVATION_DATASET = "noaacwNPPN20VIIRSDINEOFDaily"
NOAA_CHLA_NATIVE_RESOLUTION_DEGREES = 360.0 / 17281.0
NOAA_CHLA_TARGET_STEPS = max(int(os.getenv("NOAA_CHLA_TARGET_STEPS", "110")), 48)
NOAA_CHLA_OBSERVATION_TARGET_STEPS = max(
    int(os.getenv("NOAA_CHLA_OBSERVATION_TARGET_STEPS", "64")),
    32,
)
NOAA_CHLA_CACHE_TTL_SECONDS = max(float(os.getenv("NOAA_CHLA_CACHE_TTL_SECONDS", "900")), 300.0)
NOAA_CHLA_CACHE_DIR = Path(
    os.getenv(
        "NOAA_CHLA_CACHE_DIR",
        str(Path(__file__).resolve().parents[2] / ".cache" / "noaa_chlorophyll"),
    )
)
NOAA_CHLA_OBSERVATION_CACHE_DIR = NOAA_CHLA_CACHE_DIR / "observations"


class NoaaOceanColorError(RuntimeError):
    pass


_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_cache_lock = threading.Lock()


def _cache_path(region_id: str) -> Path:
    return NOAA_CHLA_CACHE_DIR / f"{region_id}.json"


def _request_json(endpoint: str) -> dict[str, Any]:
    request = Request(
        endpoint,
        headers={"Accept": "application/json", "User-Agent": "OceanIntelligenceAgent/1.0"},
    )
    try:
        with urlopen(request, timeout=75) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as error:  # noqa: BLE001 - normalize upstream transport failures
        raise NoaaOceanColorError(f"NOAA 海洋水色数据请求失败：{error}") from error
    if not isinstance(payload, dict):
        raise NoaaOceanColorError("NOAA 海洋水色接口返回了无效格式")
    return payload


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


def _latest_dataset_timestamp() -> datetime:
    endpoint = f"{NOAA_ERDDAP_ROOT}/griddap/{NOAA_CHLA_ANOMALY_DATASET}.json?time[(last)]"
    rows = ((_request_json(endpoint).get("table") or {}).get("rows") or [])
    timestamps = [_parse_timestamp(row[0]) for row in rows if isinstance(row, list) and row]
    latest = max((item for item in timestamps if item is not None), default=None)
    if latest is None:
        raise NoaaOceanColorError("NOAA 海洋水色接口没有返回有效的最新时间")
    return latest


def _grid_stride(span: float) -> int:
    requested_step = max(span / NOAA_CHLA_TARGET_STEPS, NOAA_CHLA_NATIVE_RESOLUTION_DEGREES)
    return max(1, round(requested_step / NOAA_CHLA_NATIVE_RESOLUTION_DEGREES))


def _persist(region_id: str, snapshot: dict[str, Any]) -> None:
    if not snapshot.get("points"):
        return
    document = {
        "format_version": 1,
        "region_id": region_id,
        "saved_at": time.time(),
        "snapshot": {key: value for key, value in snapshot.items() if key != "cache"},
    }
    path = _cache_path(region_id)
    temporary = path.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with temporary.open("w", encoding="utf-8") as handle:
            json.dump(document, handle, ensure_ascii=False, separators=(",", ":"))
        temporary.replace(path)
    except OSError:
        temporary.unlink(missing_ok=True)


def _load_persisted(region_id: str) -> tuple[float, dict[str, Any]] | None:
    try:
        with _cache_path(region_id).open("r", encoding="utf-8") as handle:
            document = json.load(handle)
        snapshot = document["snapshot"]
        if (
            document.get("format_version") != 1
            or document.get("region_id") != region_id
            or not isinstance(snapshot, dict)
            or not snapshot.get("points")
        ):
            return None
        age_seconds = max(0.0, time.time() - float(document["saved_at"]))
        return age_seconds, snapshot
    except (OSError, ValueError, TypeError, KeyError):
        return None


def _fetch_chlorophyll_anomaly(
    region_id: str,
    bounds: tuple[tuple[float, float], tuple[float, float]],
) -> dict[str, Any]:
    (west, south), (east, north) = bounds
    latest = _latest_dataset_timestamp()
    lat_stride = _grid_stride(north - south)
    lon_stride = _grid_stride(east - west)
    subset = (
        "chlor_a_diff"
        f"[({latest.isoformat().replace('+00:00', 'Z')})]"
        "[(0.0)]"
        f"[({south}):{lat_stride}:({north})]"
        f"[({west}):{lon_stride}:({east})]"
    )
    endpoint = f"{NOAA_ERDDAP_ROOT}/griddap/{NOAA_CHLA_ANOMALY_DATASET}.json?{subset}"
    table = _request_json(endpoint).get("table") or {}
    names = [str(name) for name in table.get("columnNames") or []]
    indexes = {name: index for index, name in enumerate(names)}
    required = {"time", "latitude", "longitude", "chlor_a_diff"}
    if not required <= indexes.keys():
        raise NoaaOceanColorError("NOAA 海洋水色结果缺少时间、坐标或叶绿素异常字段")

    points: list[dict[str, Any]] = []
    for row in table.get("rows") or []:
        if not isinstance(row, list):
            continue
        try:
            timestamp = str(row[indexes["time"]])
            latitude = float(row[indexes["latitude"]])
            longitude = float(row[indexes["longitude"]])
            anomaly = float(row[indexes["chlor_a_diff"]])
        except (IndexError, TypeError, ValueError):
            continue
        if (
            _parse_timestamp(timestamp) is None
            or not all(math.isfinite(item) for item in (latitude, longitude, anomaly))
            or not -90 <= latitude <= 90
            or not -180 <= longitude <= 180
            or abs(anomaly) > 100
        ):
            continue
        points.append(
            {
                "timestamp": timestamp,
                "latitude": round(latitude, 5),
                "longitude": round(longitude, 5),
                "chlorophyll_anomaly": round(anomaly, 6),
            }
        )
    if not points:
        raise NoaaOceanColorError("NOAA 最新叶绿素异常网格在当前海域没有有效像元")

    return {
        "region_id": region_id,
        "dataset": NOAA_CHLA_ANOMALY_DATASET,
        "fetched_at": datetime.now(UTC).isoformat(),
        "latest_observation_at": latest.isoformat().replace("+00:00", "Z"),
        "point_count": len(points),
        "native_resolution_degrees": round(NOAA_CHLA_NATIVE_RESOLUTION_DEGREES, 6),
        "latitude_step_degrees": round(lat_stride * NOAA_CHLA_NATIVE_RESOLUTION_DEGREES, 4),
        "longitude_step_degrees": round(lon_stride * NOAA_CHLA_NATIVE_RESOLUTION_DEGREES, 4),
        "points": points,
        "source": {
            "name": "NOAA CoastWatch VIIRS 叶绿素 a 日异常",
            "url": endpoint,
            "dataset_url": f"{NOAA_ERDDAP_ROOT}/griddap/{NOAA_CHLA_ANOMALY_DATASET}.html",
        },
    }


def get_noaa_chlorophyll_anomaly(
    region_id: str,
    bounds: tuple[tuple[float, float], tuple[float, float]],
    *,
    force_refresh: bool = False,
) -> dict[str, Any]:
    now = time.monotonic()
    with _cache_lock:
        cached = _cache.get(region_id)
    if cached is None:
        persisted = _load_persisted(region_id)
        if persisted is not None:
            persisted_age, persisted_snapshot = persisted
            cached = (now - persisted_age, persisted_snapshot)
            with _cache_lock:
                _cache[region_id] = cached
    if cached and not force_refresh and now - cached[0] < NOAA_CHLA_CACHE_TTL_SECONDS:
        result = cached[1].copy()
        result["cache"] = {"state": "fresh", "age_seconds": round(now - cached[0], 1)}
        return result
    try:
        result = _fetch_chlorophyll_anomaly(region_id, bounds)
    except NoaaOceanColorError:
        if not cached:
            raise
        result = cached[1].copy()
        result["cache"] = {"state": "stale", "age_seconds": round(now - cached[0], 1)}
        return result
    result["cache"] = {"state": "fresh", "age_seconds": 0.0}
    with _cache_lock:
        _cache[region_id] = (time.monotonic(), result)
    _persist(region_id, result)
    return result


def _fetch_chlorophyll_observations(
    region_id: str,
    bounds: tuple[tuple[float, float], tuple[float, float]],
) -> dict[str, Any]:
    (west, south), (east, north) = bounds
    lat_stride = max(1, round((north - south) / NOAA_CHLA_OBSERVATION_TARGET_STEPS / 0.05))
    lon_stride = max(1, round((east - west) / NOAA_CHLA_OBSERVATION_TARGET_STEPS / 0.05))
    subset = (
        "chlor_a[last][(0.0)]"
        f"[({south}):{lat_stride}:({north})]"
        f"[({west}):{lon_stride}:({east})]"
    )
    endpoint = f"{NOAA_ERDDAP_ROOT}/griddap/{NOAA_CHLA_OBSERVATION_DATASET}.json?{subset}"
    table = (_request_json(endpoint).get("table") or {})
    names = [str(name) for name in table.get("columnNames") or []]
    indexes = {name: index for index, name in enumerate(names)}
    required = {"time", "latitude", "longitude", "chlor_a"}
    if not required <= indexes.keys():
        raise NoaaOceanColorError("NOAA VIIRS chlorophyll observation response is incomplete")
    points: list[dict[str, Any]] = []
    for row in table.get("rows") or []:
        try:
            timestamp = str(row[indexes["time"]]); latitude = float(row[indexes["latitude"]]); longitude = float(row[indexes["longitude"]]); value = float(row[indexes["chlor_a"]])
        except (IndexError, TypeError, ValueError):
            continue
        if _parse_timestamp(timestamp) is None or not all(math.isfinite(item) for item in (latitude, longitude, value)):
            continue
        if not 0.001 <= value <= 100:
            continue
        points.append({"timestamp": timestamp, "latitude": round(latitude, 5), "longitude": round(longitude, 5), "chlorophyll": round(value, 6)})
    if not points:
        raise NoaaOceanColorError("NOAA VIIRS chlorophyll observation grid contains no valid points")
    return {"region_id": region_id, "dataset": NOAA_CHLA_OBSERVATION_DATASET, "fetched_at": datetime.now(UTC).isoformat(), "latest_observation_at": points[0]["timestamp"], "point_count": len(points), "points": points, "source": {"name": "NOAA VIIRS daily chlorophyll-a observations", "url": endpoint, "dataset_url": f"{NOAA_ERDDAP_ROOT}/griddap/{NOAA_CHLA_OBSERVATION_DATASET}.html"}}


def get_noaa_chlorophyll_observations(
    region_id: str,
    bounds: tuple[tuple[float, float], tuple[float, float]],
    *,
    force_refresh: bool = False,
) -> dict[str, Any]:
    now = time.monotonic()
    cache_path = NOAA_CHLA_OBSERVATION_CACHE_DIR / f"{region_id}.json"
    cached: tuple[float, dict[str, Any]] | None = None
    with _cache_lock:
        cached = _cache.get(f"obs:{region_id}")
    if cached is None:
        try:
            document = json.loads(cache_path.read_text(encoding="utf-8"))
            cached = (now - max(0.0, time.time() - float(document["saved_at"])), document["snapshot"])
            with _cache_lock:
                _cache[f"obs:{region_id}"] = cached
        except (OSError, ValueError, TypeError, KeyError):
            cached = None
    if cached and not force_refresh and now - cached[0] < NOAA_CHLA_CACHE_TTL_SECONDS:
        result = cached[1].copy(); result["cache"] = {"state": "fresh", "age_seconds": round(now - cached[0], 1)}; return result
    try:
        result = _fetch_chlorophyll_observations(region_id, bounds)
    except NoaaOceanColorError:
        if not cached:
            raise
        result = cached[1].copy(); result["cache"] = {"state": "stale", "age_seconds": round(now - cached[0], 1)}; return result
    result["cache"] = {"state": "fresh", "age_seconds": 0.0}
    with _cache_lock:
        _cache[f"obs:{region_id}"] = (time.monotonic(), result)
    try:
        NOAA_CHLA_OBSERVATION_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps({"saved_at": time.time(), "snapshot": {key: value for key, value in result.items() if key != "cache"}}, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass
    return result
