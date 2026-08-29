from __future__ import annotations

import math
import threading
import time
from collections import defaultdict
from statistics import mean
from typing import Any

from app.data.mainland_ocean_news import get_mainland_ocean_news
from app.data.noaa_client import get_noaa_sst
from app.data.noaa_currents_client import get_noaa_currents
from app.data.realtime_service import get_realtime_bundle
from app.data.regions import get_region

TTL = 900.0
_cache: tuple[float, dict[str, Any]] | None = None
_lock = threading.Lock()

CHINA_AREAS = (
    ("渤海", (117.0, 37.0, 122.5, 41.2)), ("北黄海", (120.0, 37.0, 126.0, 41.0)),
    ("南黄海", (119.0, 31.0, 126.0, 37.0)), ("长江口及浙江近海", (120.0, 27.0, 124.0, 32.0)),
    ("福建近海", (116.8, 23.0, 121.5, 27.5)), ("中华人民共和国台湾岛海峡", (117.0, 22.0, 121.8, 26.5)),
    ("中华人民共和国台湾岛东北部海域", (121.2, 24.4, 123.5, 26.7)), ("中华人民共和国台湾岛东部海域", (121.0, 21.8, 123.5, 24.8)),
    ("中华人民共和国台湾岛南部海域", (119.7, 20.2, 122.7, 22.5)), ("粤东近海", (114.0, 21.0, 118.0, 24.0)),
    ("珠江口", (112.5, 21.3, 114.8, 23.0)), ("粤西近海", (109.5, 18.5, 113.3, 22.3)),
    ("海南岛近海", (108.0, 17.0, 112.8, 20.8)), ("北部湾", (105.5, 17.0, 110.8, 22.0)),
)
CHINA_COASTAL_BOUNDS = ((105.5, 17.0), (126.0, 41.2))


def _inside(point: dict[str, Any], bounds: tuple[float, float, float, float]) -> bool:
    return bounds[0] <= float(point["longitude"]) <= bounds[2] and bounds[1] <= float(point["latitude"]) <= bounds[3]


def _series(points: list[dict[str, Any]], value_key: str, *, quality: bool = False, allow_nearest: bool = True) -> list[dict[str, Any]]:
    rows = []
    for name, bounds in CHINA_AREAS:
        selected = [point for point in points if _inside(point, bounds) and (not quality or point.get("quality_valid") is True)]
        coverage_mode = "within_area"
        if not selected and points and allow_nearest:
            center = ((bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2)
            candidates = [point for point in points if not quality or point.get("quality_valid") is True]
            selected = sorted(candidates, key=lambda point: (float(point["longitude"])-center[0])**2 + (float(point["latitude"])-center[1])**2)[:1]
            coverage_mode = "nearest_grid"
        values = [float(point[value_key]) for point in selected if math.isfinite(float(point[value_key]))]
        if not values:
            continue
        highest = max(selected, key=lambda point: float(point[value_key])); lowest = min(selected, key=lambda point: float(point[value_key]))
        average = mean(values)
        rows.append({"id": name, "name": name, "average": round(average, 3), "minimum": round(float(lowest[value_key]), 3), "maximum": round(float(highest[value_key]), 3), "sample_count": len(values), "coverage_mode": coverage_mode, "center": [(bounds[0]+bounds[2])/2, (bounds[1]+bounds[3])/2], "minimum_point": lowest, "maximum_point": highest, "minimum_anomaly": round(float(lowest[value_key])-average, 3), "maximum_anomaly": round(float(highest[value_key])-average, 3)})
    return rows


def _ocean(point: dict[str, Any]) -> str | None:
    lat=float(point["latitude"]); lon=float(point["longitude"])
    if lat >= 66: return "北冰洋"
    if lat <= -50: return "南大洋"
    if 20 <= lon <= 120 and -50 < lat < 30: return "印度洋"
    if -70 <= lon <= 20: return "北大西洋" if lat >= 0 else "南大西洋"
    return "北太平洋" if lat >= 0 else "南太平洋"


def get_daily_dashboard(*, force_refresh: bool = False) -> dict[str, Any]:
    global _cache
    now=time.monotonic()
    with _lock: cached=_cache
    if cached and not force_refresh and now-cached[0] < TTL: return cached[1]
    global_region=get_region("global_ocean")
    sst=get_noaa_sst("global_ocean", global_region["bounds"], force_refresh=force_refresh)
    currents=get_noaa_currents("china_coastal_daily_dashboard", CHINA_COASTAL_BOUNDS, force_refresh=force_refresh)
    bundle=get_realtime_bundle("global_ocean", force_refresh=False)
    coastal_sst=_series(sst.get("latest_points") or [], "temperature", quality=True)
    coastal_state=_series(currents.get("points") or [], "speed", allow_nearest=False)
    grouped: dict[str,list[float]]=defaultdict(list)
    for point in sst.get("latest_points") or []:
        if point.get("quality_valid") is not True: continue
        basin=_ocean(point)
        if basin: grouped[basin].append(float(point["temperature"]))
    ocean_sst=[{"name": name, "average": round(mean(values),3), "minimum": round(min(values),3), "maximum": round(max(values),3), "sample_count": len(values)} for name,values in grouped.items() if values]
    events=[]
    for raw in bundle.get("events") or []:
        event=raw.model_dump(mode="json") if hasattr(raw,"model_dump") else raw
        if event.get("event_kind") != "anomaly": continue
        if event.get("type") not in {"wind_anomaly","wave_anomaly","current_anomaly"}: continue
        events.append({key:event.get(key) for key in ("id","type","title","summary","region","centroid","variables","confidence","severity","source_updated_at","consecutive_updates")})
    events.sort(key=lambda item:(item.get("severity") or 0,item.get("confidence") or 0),reverse=True)
    result={"generated_at": sst.get("fetched_at"), "china_coastal_sst": coastal_sst, "china_coastal_sea_state": coastal_state, "ocean_sst": sorted(ocean_sst,key=lambda item:item["name"]), "weather_anomalies": events[:12], "news": get_mainland_ocean_news(15, force_refresh=force_refresh), "sources": {"sst_latest_at":sst.get("latest_observation_at"),"currents_latest_at":currents.get("latest_observation_at"),"sea_state_definition":"NOAA逐日表层流速，单位m/s，并非浪高；各海区仅统计区内有效网格，不跨区借值"}}
    with _lock: _cache=(time.monotonic(),result)
    return result
