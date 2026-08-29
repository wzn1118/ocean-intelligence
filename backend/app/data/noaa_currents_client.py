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

ROOT = "https://coastwatch.noaa.gov/erddap"
DATASET = "noaacwBLENDEDNRTcurrentsDaily"
CACHE_DIR = Path(os.getenv("NOAA_CURRENTS_CACHE_DIR", str(Path(__file__).resolve().parents[2] / ".cache" / "noaa_currents")))
TTL = max(float(os.getenv("NOAA_CURRENTS_CACHE_TTL_SECONDS", "1800")), 300.0)
TARGET_STEPS = max(int(os.getenv("NOAA_CURRENTS_TARGET_STEPS", "32")), 8)
_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_lock = threading.Lock()


class NoaaCurrentsError(RuntimeError):
    pass


def _request(endpoint: str) -> dict[str, Any]:
    try:
        request = Request(endpoint, headers={"Accept": "application/json", "User-Agent": "OceanIntelligenceAgent/1.0"})
        with urlopen(request, timeout=75) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as error:  # noqa: BLE001
        raise NoaaCurrentsError(f"NOAA currents request failed: {error}") from error
    if not isinstance(payload, dict):
        raise NoaaCurrentsError("NOAA currents returned an invalid response")
    return payload


def _persist(region_id: str, snapshot: dict[str, Any]) -> None:
    if not snapshot.get("points"):
        return
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f"{region_id}.json"
    path.write_text(json.dumps({"saved_at": time.time(), "snapshot": snapshot}, ensure_ascii=False), encoding="utf-8")


def _load(region_id: str) -> tuple[float, dict[str, Any]] | None:
    try:
        document = json.loads((CACHE_DIR / f"{region_id}.json").read_text(encoding="utf-8"))
        snapshot = document["snapshot"]
        return max(0.0, time.time() - float(document["saved_at"])), snapshot
    except (OSError, ValueError, TypeError, KeyError):
        return None


def _fetch(region_id: str, bounds: tuple[tuple[float, float], tuple[float, float]]) -> dict[str, Any]:
    (west, south), (east, north) = bounds
    lat_stride = max(1, round((north - south) / TARGET_STEPS / 0.25))
    lon_stride = max(1, round((east - west) / TARGET_STEPS / 0.25))
    query = (
        f"u_current[last][({south}):{lat_stride}:({north})][({west}):{lon_stride}:({east})],"
        f"v_current[last][({south}):{lat_stride}:({north})][({west}):{lon_stride}:({east})]"
    )
    endpoint = f"{ROOT}/griddap/{DATASET}.json?{query}"
    table = (_request(endpoint).get("table") or {})
    names = [str(name) for name in table.get("columnNames") or []]
    idx = {name: i for i, name in enumerate(names)}
    required = {"time", "latitude", "longitude", "u_current", "v_current"}
    if not required <= idx.keys():
        raise NoaaCurrentsError("NOAA currents response is missing vector fields")
    points: list[dict[str, Any]] = []
    for row in table.get("rows") or []:
        try:
            timestamp = str(row[idx["time"]]); latitude = float(row[idx["latitude"]]); longitude = float(row[idx["longitude"]])
            u = float(row[idx["u_current"]]); v = float(row[idx["v_current"]])
        except (IndexError, TypeError, ValueError):
            continue
        if not all(math.isfinite(vv) for vv in (latitude, longitude, u, v)):
            continue
        speed = math.hypot(u, v)
        if speed > 5:
            continue
        points.append({"timestamp": timestamp, "latitude": latitude, "longitude": longitude, "u": u, "v": v, "speed": speed, "direction": (math.degrees(math.atan2(u, v)) + 360) % 360})
    if not points:
        raise NoaaCurrentsError("NOAA currents returned no valid vector points")
    return {"region_id": region_id, "dataset": DATASET, "fetched_at": datetime.now(UTC).isoformat(), "latest_observation_at": points[0]["timestamp"], "point_count": len(points), "points": points, "source": {"name": "NOAA CoastWatch global daily surface currents", "url": endpoint, "dataset_url": f"{ROOT}/griddap/{DATASET}.html"}}


def get_noaa_currents(region_id: str, bounds: tuple[tuple[float, float], tuple[float, float]], *, force_refresh: bool = False) -> dict[str, Any]:
    now = time.monotonic()
    with _lock:
        cached = _cache.get(region_id)
    if cached is None:
        persisted = _load(region_id)
        if persisted:
            age, snapshot = persisted
            cached = (now - age, snapshot)
            with _lock:
                _cache[region_id] = cached
    if cached and not force_refresh and now - cached[0] < TTL:
        result = cached[1].copy(); result["cache"] = {"state": "fresh", "age_seconds": round(now - cached[0], 1)}; return result
    try:
        result = _fetch(region_id, bounds)
    except NoaaCurrentsError:
        if not cached:
            raise
        result = cached[1].copy(); result["cache"] = {"state": "stale", "age_seconds": round(now - cached[0], 1)}; return result
    result["cache"] = {"state": "fresh", "age_seconds": 0.0}
    with _lock:
        _cache[region_id] = (time.monotonic(), result)
    _persist(region_id, result)
    return result
