from __future__ import annotations

import math
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from statistics import median
from typing import Any

from app.data.argo_client import ArgoDataError, get_argo_region_samples, preload_argo_profile_cache, prime_argo_region_cache
from app.data.china_coastal_areas import CHINA_MARINE_BAIKE_NAMES, lookup_china_marine_area
from app.data.copernicus_client import CopernicusMarineError, get_wave_region, get_wind_region
from app.data.copernicus_history import append_region_snapshot
from app.data.noaa_client import NoaaDataError, get_noaa_sst, preload_noaa_sst_cache
from app.data.noaa_carbon_client import NoaaCarbonError, get_noaa_carbon
from app.data.noaa_currents_client import NoaaCurrentsError, get_noaa_currents
from app.data.noaa_ocean_color_client import (
    NoaaOceanColorError,
    get_noaa_chlorophyll_anomaly,
    get_noaa_chlorophyll_observations,
)
from app.data.regions import get_region
from app.data.woa_nitrate import WoaNitrateError, get_woa_nitrate
from app.data.woa_salinity import WoaSalinityError, get_woa_salinity
from app.models import (
    DataPoint,
    Evidence,
    OceanEvent,
    ReasoningStep,
    ScientificReference,
    TimelineItem,
)


REALTIME_CACHE_TTL_SECONDS = max(float(os.getenv("REALTIME_CACHE_TTL_SECONDS", "300")), 60.0)
REALTIME_CACHE_DIR = Path(
    os.getenv("REALTIME_CACHE_DIR", str(Path(__file__).resolve().parents[2] / ".cache" / "realtime"))
)
REALTIME_PROFILE_SAMPLE_LIMIT = max(int(os.getenv("REALTIME_PROFILE_SAMPLE_LIMIT", "48")), 16)
NOAA_OBSERVATION_EVENT_LIMIT = max(int(os.getenv("NOAA_OBSERVATION_EVENT_LIMIT", "600")), 100)
ARGO_SURFACE_MAX_PRESSURE_DBAR = 20.0
ARGO_LOCAL_BASELINE_RADIUS_KM = 2000.0
ARGO_LOCAL_BASELINE_LATITUDE_DEGREES = 7.0
ARGO_LOCAL_BASELINE_MIN_PEERS = 3
NOAA_LOCAL_BASELINE_RADIUS_KM = 600.0
NOAA_LOCAL_BASELINE_MIN_PEERS = 5
NOAA_MIN_ABSOLUTE_DEVIATION_C = 1.5
NOAA_MIN_PERSISTENT_DAYS = 3
NOAA_MIN_DAILY_GAP_HOURS = 18.0
NOAA_MAX_DAILY_GAP_HOURS = 30.0
ARGO_MIN_ABSOLUTE_DEVIATION = {
    "SALINITY": 0.3,
    "CHLA": 0.2,
    "NITRATE": 1.0,
}
NOAA_CHLA_MIN_ABSOLUTE_DEVIATION = max(float(os.getenv("NOAA_CHLA_MIN_ABSOLUTE_DEVIATION", "0.2")), 0.05)
NOAA_CHLA_MIN_ROBUST_SCORE = max(float(os.getenv("NOAA_CHLA_MIN_ROBUST_SCORE", "3.5")), 2.5)
NOAA_CHLA_EVENT_LIMIT = max(int(os.getenv("NOAA_CHLA_EVENT_LIMIT", "12")), 4)
ARGO_NUTRIENT_EVENT_LIMIT = max(int(os.getenv("ARGO_NUTRIENT_EVENT_LIMIT", "240")), 100)
OBSERVATION_CATEGORY_TARGET = max(int(os.getenv("OBSERVATION_CATEGORY_TARGET", "240")), 100)
OBSERVATION_FILTER_RECORD_TARGET = max(
    int(os.getenv("OBSERVATION_FILTER_RECORD_TARGET", os.getenv("EVENT_TYPE_RECORD_TARGET", "100"))),
    100,
)
NOAA_CHLA_OBSERVATION_EVENT_LIMIT = max(
    int(os.getenv("NOAA_CHLA_OBSERVATION_EVENT_LIMIT", "720")),
    OBSERVATION_CATEGORY_TARGET,
)

_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_cache_lock = threading.Lock()
_region_locks: dict[str, threading.Lock] = {}
_revalidation_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ocean-revalidate")
_revalidating: set[str] = set()
REALTIME_CACHE_FORMAT_VERSION = 3
GLOBAL_COPERNICUS_INITIAL_BOUNDS = ((102.5, -0.5), (132.0, 41.5))
_GLOBAL_COPERNICUS_PAGE_TILES = tuple(
    ((west, south), (min(west + 60.0, 180.0), min(south + 35.0, 70.0)))
    for south in (-70.0, -35.0, 0.0, 35.0)
    for west in (-180.0, -120.0, -60.0, 0.0, 60.0, 120.0)
)


def _bounds_overlap_area(
    bounds: tuple[tuple[float, float], tuple[float, float]],
    priority_bounds: tuple[tuple[float, float], tuple[float, float]],
) -> float:
    overlap_width = max(0.0, min(bounds[1][0], priority_bounds[1][0]) - max(bounds[0][0], priority_bounds[0][0]))
    overlap_height = max(0.0, min(bounds[1][1], priority_bounds[1][1]) - max(bounds[0][1], priority_bounds[0][1]))
    return overlap_width * overlap_height


GLOBAL_COPERNICUS_PAGE_TILES = tuple(sorted(
    _GLOBAL_COPERNICUS_PAGE_TILES,
    key=lambda bounds: -_bounds_overlap_area(bounds, GLOBAL_COPERNICUS_INITIAL_BOUNDS),
))
_paged_events: dict[str, OceanEvent] = {}
_fixed_events_cache: dict[str, list[OceanEvent]] = {}
_fixed_events_lock = threading.Lock()
ARGO_REALTIME_INTERVAL_SECONDS = max(float(os.getenv("ARGO_REALTIME_INTERVAL_SECONDS", "600")), 60.0)
ARGO_REALTIME_SAMPLE_LIMIT = max(int(os.getenv("ARGO_REALTIME_SAMPLE_LIMIT", "16")), 8)
ARGO_REALTIME_REGIONS = tuple(
    region_id.strip()
    for region_id in os.getenv("ARGO_REALTIME_REGIONS", "south_china_sea,northwest_pacific,global_ocean").split(",")
    if region_id.strip()
)
_argo_collector_stop = threading.Event()
_argo_collector_thread: threading.Thread | None = None
_argo_collector_status: dict[str, Any] = {
    "running": False,
    "interval_seconds": ARGO_REALTIME_INTERVAL_SECONDS,
    "regions": list(ARGO_REALTIME_REGIONS),
    "last_started_at": None,
    "last_completed_at": None,
    "last_error": None,
    "current_region": None,
    "current_region_started_at": None,
    "sample_limit": ARGO_REALTIME_SAMPLE_LIMIT,
    "region_status": {},
}


def _region_lock(region_id: str) -> threading.Lock:
    with _cache_lock:
        return _region_locks.setdefault(region_id, threading.Lock())


def _persistent_cache_path(region_id: str) -> Path:
    return REALTIME_CACHE_DIR / f"{region_id}.json"


def _fixed_cache_path(region_id: str) -> Path:
    return REALTIME_CACHE_DIR / "fixed" / f"{region_id}.json"


def _load_fixed_events(region_id: str) -> list[OceanEvent]:
    with _fixed_events_lock:
        cached = _fixed_events_cache.get(region_id)
        if cached is not None:
            return cached
        try:
            with _fixed_cache_path(region_id).open("r", encoding="utf-8") as handle:
                document = json.load(handle)
            if document.get("region_id") != region_id:
                return []
            events = [
                _normalize_event_marine_name(OceanEvent.model_validate(event))
                for event in document.get("bundle", {}).get("events", [])
            ]
        except (OSError, ValueError, TypeError, KeyError):
            events = []
        _fixed_events_cache[region_id] = events
        return events


def _merge_fixed_events(region_id: str, events: list[OceanEvent]) -> list[OceanEvent]:
    fixed_events = _load_fixed_events(region_id)
    if not fixed_events:
        return events
    merged = {event.id: event for event in fixed_events}
    merged.update({event.id: event for event in events})
    result = list(merged.values())
    result.sort(key=_event_queue_sort_key, reverse=True)
    return result


def _persist_bundle(region_id: str, bundle: dict[str, Any]) -> None:
    payload = {
        **bundle,
        "events": [event.model_dump(mode="json") for event in bundle["events"]],
    }
    document = {
        "format_version": REALTIME_CACHE_FORMAT_VERSION,
        "region_id": region_id,
        "saved_at": time.time(),
        "bundle": payload,
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


def _load_persisted_bundle(region_id: str) -> tuple[float, dict[str, Any]] | None:
    path = _persistent_cache_path(region_id)
    try:
        with path.open("r", encoding="utf-8") as handle:
            document = json.load(handle)
        if document.get("format_version") != REALTIME_CACHE_FORMAT_VERSION or document.get("region_id") != region_id:
            return None
        bundle = document["bundle"]
        bundle["events"] = [OceanEvent.model_validate(event) for event in bundle["events"]]
        bundle["events"] = _merge_fixed_events(region_id, bundle["events"])
        bundle["fixed_cache_event_count"] = len(_load_fixed_events(region_id))
        age_seconds = max(0.0, time.time() - float(document["saved_at"]))
        return age_seconds, bundle
    except (OSError, ValueError, TypeError, KeyError):
        return None


def preload_realtime_caches() -> dict[str, Any]:
    """Load complete workspace, NOAA SST and Argo caches into process memory."""
    loaded_bundles: dict[str, dict[str, int]] = {}
    now = time.monotonic()
    for path in REALTIME_CACHE_DIR.glob("*.json"):
        region_id = path.stem
        persisted = _load_persisted_bundle(region_id)
        if persisted is None:
            continue
        age_seconds, bundle = persisted
        with _cache_lock:
            _cache[region_id] = (now - age_seconds, bundle)
        argo_region = bundle.get("argo_region")
        if isinstance(argo_region, dict):
            prime_argo_region_cache(region_id, argo_region, age_seconds=age_seconds)
        observation_summary = bundle.get("observation_summary") or {}
        loaded_bundles[region_id] = {
            "events": len(bundle.get("events", [])),
            "sst_points": len(observation_summary.get("sst_latest_points", [])),
            "argo_profiles": len((argo_region or {}).get("profiles", [])),
            "argo_floats": len((argo_region or {}).get("floats", [])),
        }
    return {
        "workspace": loaded_bundles,
        "noaa_sst": preload_noaa_sst_cache(),
        "argo_profiles": preload_argo_profile_cache(),
    }


def _argo_source_health(argo_region: dict[str, Any], samples: list[dict[str, Any]], failures: int) -> list[dict[str, Any]]:
    checked_at = datetime.now(UTC).isoformat()
    state = argo_region.get("cache", {}).get("state")
    return [
        {
            "id": "argo_core", "name": "Argo Core 全球剖面网", "category": "in_situ",
            "status": "live" if state == "fresh" else "cached",
            "observation_count": argo_region["profile_count"], "latest_observation_at": argo_region["latest_observation_at"],
            "checked_at": checked_at,
            "detail": f"后台实时采集 {argo_region['profile_count']} 个剖面点位、{argo_region['float_count']} 个活跃浮标；本轮分析 {len(samples)} 个完整剖面，失败 {failures} 个。",
            "url": argo_region["source"]["url"],
        },
        {
            "id": "bgc_argo", "name": "BGC-Argo 生物地球化学网", "category": "in_situ",
            "status": "live" if state == "fresh" else "cached",
            "observation_count": argo_region["bgc_float_count"], "latest_observation_at": argo_region["latest_observation_at"],
            "checked_at": checked_at, "detail": f"后台实时识别 {argo_region['bgc_float_count']} 个 BGC 活跃浮标。",
            "url": argo_region["source"]["gdac_url"],
        },
    ]


def refresh_argo_realtime(region_id: str) -> dict[str, Any]:
    region = get_region(region_id)
    argo_region, samples, failures = get_argo_region_samples(
        region_id=region["id"], bounds=region["bounds"], region_name=region["name"],
        sample_limit=ARGO_REALTIME_SAMPLE_LIMIT, force_refresh=True,
    )
    argo_events = [*_argo_events(region, samples, argo_region["profile_count"]), *_argo_observation_events(region, samples, argo_region["profile_count"])]
    with _region_lock(region["id"]):
        with _cache_lock:
            cached = _cache.get(region["id"])
        if cached is None:
            persisted = _load_persisted_bundle(region["id"])
            if persisted is None:
                return {"region_id": region["id"], "updated": False, "reason": "workspace_cache_missing"}
            cached = (time.monotonic() - persisted[0], persisted[1])
        bundle = cached[1].copy()
        previous_sources = list(bundle.get("sources") or [])
        previous_argo_count = next((int(source.get("observation_count") or 0) for source in previous_sources if source.get("id") == "argo_core"), 0)
        retained_events = [event for event in bundle.get("events", []) if not set(event.sources).intersection({"ARGO_CORE", "BGC_ARGO"})]
        bundle["events"] = _merge_fixed_events(region["id"], [*argo_events, *retained_events])
        bundle["sources"] = [source for source in previous_sources if source.get("id") not in {"argo_core", "bgc_argo"}] + _argo_source_health(argo_region, samples, failures)
        bundle["argo_region"] = argo_region
        bundle["sampled_bgc_profile_count"] = sum(
            any(sample.get("latest", {}).get("surface", {}).get(variable) is not None for variable in ("chla", "nitrate"))
            for sample in samples
        )
        bundle["observation_count"] = max(0, int(bundle.get("observation_count") or 0) - previous_argo_count) + int(argo_region["profile_count"])
        bundle["refreshed_at"] = datetime.now(UTC).isoformat()
        with _cache_lock:
            _cache[region["id"]] = (time.monotonic(), bundle)
        _persist_bundle(region["id"], bundle)
    return {
        "region_id": region["id"], "updated": True, "profile_count": argo_region["profile_count"],
        "float_count": argo_region["float_count"], "sample_count": len(samples), "failures": failures,
        "latest_observation_at": argo_region["latest_observation_at"], "completed_at": datetime.now(UTC).isoformat(),
    }


def get_argo_realtime_status() -> dict[str, Any]:
    return deepcopy(_argo_collector_status)


def start_argo_realtime_collector() -> None:
    global _argo_collector_thread
    if _argo_collector_thread and _argo_collector_thread.is_alive():
        return
    _argo_collector_stop.clear()

    def collect() -> None:
        _argo_collector_status["running"] = True
        while not _argo_collector_stop.is_set():
            _argo_collector_status["last_started_at"] = datetime.now(UTC).isoformat()
            _argo_collector_status["last_error"] = None
            for region_id in ARGO_REALTIME_REGIONS:
                if _argo_collector_stop.is_set():
                    break
                started_at = datetime.now(UTC).isoformat()
                _argo_collector_status["current_region"] = region_id
                _argo_collector_status["current_region_started_at"] = started_at
                _argo_collector_status["region_status"][region_id] = {
                    "region_id": region_id,
                    "state": "running",
                    "started_at": started_at,
                }
                try:
                    result = refresh_argo_realtime(region_id)
                    result["state"] = "completed" if result.get("updated") else "skipped"
                    _argo_collector_status["region_status"][region_id] = result
                except Exception as error:  # noqa: BLE001
                    _argo_collector_status["last_error"] = str(error)
                    _argo_collector_status["region_status"][region_id] = {
                        "region_id": region_id,
                        "state": "failed",
                        "updated": False,
                        "error": str(error),
                    }
            _argo_collector_status["current_region"] = None
            _argo_collector_status["current_region_started_at"] = None
            _argo_collector_status["last_completed_at"] = datetime.now(UTC).isoformat()
            _argo_collector_stop.wait(ARGO_REALTIME_INTERVAL_SECONDS)
        _argo_collector_status["running"] = False

    _argo_collector_thread = threading.Thread(target=collect, name="argo-realtime-collector", daemon=True)
    _argo_collector_thread.start()


def stop_argo_realtime_collector() -> None:
    _argo_collector_stop.set()


def _inside_region(longitude: Any, latitude: Any, bounds: list[list[float]]) -> bool:
    return (
        isinstance(longitude, (int, float))
        and isinstance(latitude, (int, float))
        and bounds[0][0] <= float(longitude) <= bounds[1][0]
        and bounds[0][1] <= float(latitude) <= bounds[1][1]
    )


def _regionalized_global_fallback(region: dict[str, Any]) -> dict[str, Any] | None:
    persisted = _load_persisted_bundle("global_ocean")
    if persisted is None:
        return None
    _, global_bundle = persisted
    bounds = region["bounds"]
    events = [
        event
        for event in global_bundle.get("events", [])
        if _inside_region(event.centroid[0], event.centroid[1], bounds)
    ]
    observation_summary = dict(global_bundle.get("observation_summary") or {})
    sst_points = [
        point
        for point in observation_summary.get("sst_latest_points", [])
        if _inside_region(point.get("longitude"), point.get("latitude"), bounds)
    ]
    observation_summary.update({
        "region_id": region["id"],
        "region": region["name"],
        "bounds": bounds,
        "sst_latest_points": sst_points,
        "sst_latest_grid_count": len(sst_points),
        "screening_event_count": len(events),
    })
    argo_region = global_bundle.get("argo_region")
    if argo_region:
        argo_region = dict(argo_region)
        profiles = [
            profile
            for profile in argo_region.get("profiles", [])
            if _inside_region(profile.get("longitude"), profile.get("latitude"), bounds)
        ]
        floats = [
            item
            for item in argo_region.get("floats", [])
            if _inside_region(item.get("longitude"), item.get("latitude"), bounds)
        ]
        argo_region.update({
            "region_id": region["id"],
            "region": region["name"],
            "bounds": bounds,
            "profiles": profiles,
            "floats": floats,
            "profile_count": len(profiles),
            "float_count": len(floats),
            "bgc_float_count": sum(1 for item in floats if item.get("has_bgc")),
        })
    result = dict(global_bundle)
    result.update({
        "region": region,
        "events": events,
        "observation_summary": observation_summary,
        "argo_region": argo_region,
        "errors": list(dict.fromkeys([
            *global_bundle.get("errors", []),
            "当前处于缓存恢复模式，使用全球快照裁剪结果，未发起上游更新。",
        ])),
        "_defer_revalidation": True,
    })
    return result


def _schedule_revalidation(region_id: str) -> None:
    with _cache_lock:
        if region_id in _revalidating:
            return
        _revalidating.add(region_id)

    def refresh() -> None:
        try:
            get_realtime_bundle(region_id, force_refresh=True)
        except Exception:  # noqa: BLE001 - stale data remains available on upstream failure
            pass
        finally:
            with _cache_lock:
                _revalidating.discard(region_id)

    _revalidation_executor.submit(refresh)


def _event_queue_sort_key(item: OceanEvent) -> tuple[bool, bool, bool, float, datetime]:
    """Prioritize Chinese waters and Copernicus before normal event triage."""
    centroid = getattr(item, "centroid", None)
    is_china_marine = bool(
        centroid
        and len(centroid) >= 2
        and lookup_china_marine_area(float(centroid[0]), float(centroid[1]))
    )
    sources = getattr(item, "sources", []) or []
    is_copernicus = any(str(source).upper().startswith("COPERNICUS") for source in sources)
    is_anomaly = item.event_kind == "anomaly"
    return (
        is_china_marine,
        is_copernicus,
        is_anomaly,
        item.severity if is_anomaly else 0.0,
        item.source_updated_at or item.started_at,
    )


ARGO_REFERENCE = ScientificReference(
    id="REF-ARGO-2020",
    citation="Argo Program. Argo: A Global Array of Profiling Floats Observing the Ocean.",
    year=2020,
    doi="10.3389/fmars.2020.00700",
    relevance="说明 Argo 剖面观测、全球阵列和资料使用边界。",
    variables=["SST", "SALINITY", "CHLA", "NITRATE"],
)
NOAA_REFERENCE = ScientificReference(
    id="REF-NOAA-SST",
    citation="NOAA CoastWatch Geo-polar Blended Sea Surface Temperature Product.",
    year=2024,
    doi=None,
    relevance="提供逐日全球融合海表温度网格，用于区域空间偏差筛查。",
    variables=["SST"],
)
NOAA_CHLA_REFERENCE = ScientificReference(
    id="REF-NOAA-VIIRS-CHLA",
    citation="NOAA CoastWatch. VIIRS daily chlorophyll-a anomaly difference product.",
    year=2026,
    doi=None,
    relevance="提供全球逐日叶绿素 a 与 61 日合成场的差值，用于海洋水色空间异常筛查。",
    variables=["CHLA"],
)
WOA_NITRATE_REFERENCE = ScientificReference(
    id="REF-NOAA-WOA23-NITRATE",
    citation="NOAA NCEI. World Ocean Atlas 2023, Volume 4: Dissolved Inorganic Nutrients.",
    year=2023,
    doi="10.25923/39qw-7j08",
    relevance="提供 1965-2022 年一度网格硝酸盐气候态，用于 BGC-Argo 覆盖不足时的历史背景参照。",
    variables=["NITRATE"],
)
WOA_SALINITY_REFERENCE = ScientificReference(
    id="REF-NOAA-WOA23-SALINITY",
    citation="NOAA NCEI. World Ocean Atlas 2023, Volume 2: Salinity.",
    year=2023,
    doi="10.25923/70qt-9574",
    relevance="提供全球一度网格盐度气候态，用于实时 Argo 覆盖不足时补充海域背景观测。",
    variables=["SALINITY"],
)
NOAA_CHLA_OBSERVATION_REFERENCE = ScientificReference(
    id="REF-NOAA-VIIRS-CHLA-OBS",
    citation="NOAA CoastWatch. VIIRS daily DINEOF chlorophyll-a product.",
    year=2026,
    doi=None,
    relevance="提供全球逐日卫星叶绿素 a 网格观测，用于展示海洋生物光学状态。",
    variables=["CHLA"],
)
NOAA_CURRENTS_REFERENCE = ScientificReference(
    id="REF-NOAA-SURFACE-CURRENTS",
    citation="NOAA CoastWatch. Global daily blended near-real-time surface currents.",
    year=2026,
    doi=None,
    relevance="提供全球逐日表层流速矢量，用于海流状态展示与涡旋结构研判输入。",
    variables=["CURRENT"],
)
NOAA_CARBON_REFERENCE = ScientificReference(
    id="REF-NOAA-SPCO2",
    citation="NOAA NCEI OCADS. Observation-based global monthly gridded sea-surface pCO2 product.",
    year=2026,
    doi=None,
    relevance="提供一度网格海表二氧化碳分压气候态，用于展示海气碳循环空间背景。",
    variables=["PCO2"],
)
COPERNICUS_WAVE_REFERENCE = ScientificReference(
    id="REF-COPERNICUS-WAVE",
    citation="Copernicus Marine Service. Global Ocean Waves Analysis and Forecast.",
    year=2026,
    doi=None,
    relevance="提供约 0.083°、3 小时间隔的全球波浪分析预报，用于总浪、涌浪和风浪状态展示与自动筛查。",
    variables=["WAVE_HEIGHT", "WAVE_PERIOD", "WAVE_DIRECTION", "SWELL_HEIGHT", "WIND_WAVE_HEIGHT"],
)
COPERNICUS_WIND_REFERENCE = ScientificReference(
    id="REF-COPERNICUS-WIND",
    citation="Copernicus Marine Service. Global Ocean Hourly Sea Surface Wind and Stress from Scatterometer and Model.",
    year=2026,
    doi=None,
    relevance="提供 0.125°、小时级海面风矢量，用于风速、风向展示和强风自动筛查。",
    variables=["WIND_SPEED", "WIND_DIRECTION"],
)


def _label(value: float, positive: str, negative: str) -> str:
    return positive if value >= 0 else negative


def _severity(deviation: float, scale: float) -> float:
    robust_score = abs(deviation) / max(scale, 0.08)
    return round(min(0.96, 0.42 + 0.18 * robust_score), 3)


def _severity_label(value: float) -> str:
    if value >= 0.86:
        return "critical"
    if value >= 0.7:
        return "high"
    if value >= 0.52:
        return "moderate"
    return "low"


def _location(latitude: float, longitude: float) -> str:
    lat_text = f"{abs(latitude):.1f}°{'N' if latitude >= 0 else 'S'}"
    lon_text = f"{abs(longitude):.1f}°{'E' if longitude >= 0 else 'W'}"
    return f"{lat_text}, {lon_text}"


def _plain_area_name(region: dict[str, Any], latitude: float, longitude: float) -> str:
    china_area = lookup_china_marine_area(longitude, latitude)
    if china_area:
        return str(china_area["name"])
    if region["id"] == "global_ocean":
        if latitude <= -50:
            return "南大洋"
        if latitude >= 60:
            return "北冰洋周边"
        if -100 <= longitude < 20:
            return "北大西洋" if latitude >= 0 else "南大西洋"
        if 20 <= longitude < 120 and latitude < 30:
            return "北印度洋" if latitude >= 0 else "南印度洋"
        return "北太平洋" if latitude >= 0 else "南太平洋"
    if region["id"] == "northwest_pacific":
        if latitude >= 45:
            return "西北太平洋北部"
        if longitude <= 125 and latitude <= 42:
            return "中国近海"
        if 125 <= longitude <= 155 and 25 <= latitude <= 45:
            return "日本以东海域"
        if latitude < 20:
            return "热带西北太平洋"
    return region["short_name"]


_LEGACY_MARINE_NAMES = tuple(sorted({
    *CHINA_MARINE_BAIKE_NAMES,
    "中国近海",
    "西北太平洋北部",
    "热带西北太平洋",
    "西北太平洋",
    "北太平洋",
    "全球海洋",
}, key=len, reverse=True))


def _normalize_event_marine_name(event: OceanEvent) -> OceanEvent:
    centroid = event.centroid
    if not centroid or len(centroid) < 2:
        return event
    marine_area = lookup_china_marine_area(float(centroid[0]), float(centroid[1]))
    if not marine_area:
        return event
    area_name = str(marine_area["name"])
    title = event.title
    summary = event.summary
    if area_name not in title:
        previous_name = next((name for name in _LEGACY_MARINE_NAMES if name != area_name and name in title), None)
        if previous_name:
            title = title.replace(previous_name, area_name, 1)
        elif title.startswith("浮标 ") and "：" in title:
            heading, detail = title.split("：", 1)
            title = f"{heading}：{area_name} {detail}"
        else:
            title = f"{area_name} · {title}"
    if area_name not in summary:
        previous_name = next((name for name in _LEGACY_MARINE_NAMES if name != area_name and name in summary), None)
        if previous_name:
            summary = summary.replace(previous_name, area_name, 1)
    if title == event.title and summary == event.summary:
        return event
    return event.model_copy(update={"title": title, "summary": summary})


def _short_date(value: str) -> str:
    parsed = _parse_timestamp(value)
    return f"{parsed.month}月{parsed.day}日" if parsed else value[:10]


def _plain_variable(variable: str) -> str:
    return {
        "SST": "海面温度",
        "TEMPERATURE": "温度",
        "SALINITY": "盐度",
        "CHLA": "叶绿素",
        "NITRATE": "硝酸盐",
        "CURRENT": "表层流速",
        "PCO2": "海表二氧化碳分压",
        "WAVE_HEIGHT": "有效波高",
        "SWELL_HEIGHT": "一级涌浪波高",
        "WIND_WAVE_HEIGHT": "风浪波高",
    }.get(variable, variable)


def _plain_unit(unit: str) -> str:
    return {
        "degC": "°C",
        "mg m-3": "mg/m³",
        "umol kg-1": "μmol/kg",
        "m s-1": "m/s",
        "uatm": "μatm",
        "m": "m",
        "degree": "°",
        "s": "s",
    }.get(unit, unit)


def _haversine_km(longitude_a: float, latitude_a: float, longitude_b: float, latitude_b: float) -> float:
    radius = 6371.0088
    phi_a = math.radians(latitude_a)
    phi_b = math.radians(latitude_b)
    delta_phi = math.radians(latitude_b - latitude_a)
    delta_lambda = math.radians(longitude_b - longitude_a)
    value = math.sin(delta_phi / 2) ** 2 + math.cos(phi_a) * math.cos(phi_b) * math.sin(delta_lambda / 2) ** 2
    return radius * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


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


def _lifecycle_path(region_id: str) -> Path:
    return REALTIME_CACHE_DIR / "lifecycle" / f"{region_id}.json"


def _load_lifecycle_records(region_id: str) -> dict[str, dict[str, Any]]:
    try:
        with _lifecycle_path(region_id).open("r", encoding="utf-8") as handle:
            document = json.load(handle)
        if document.get("format_version") != 1 or document.get("region_id") != region_id:
            return {}
        records = document.get("records")
        return records if isinstance(records, dict) else {}
    except (OSError, ValueError, TypeError):
        return {}


def _persist_lifecycle_records(region_id: str, records: dict[str, dict[str, Any]]) -> None:
    path = _lifecycle_path(region_id)
    temporary = path.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
    document = {
        "format_version": 1,
        "region_id": region_id,
        "saved_at": time.time(),
        "records": records,
    }
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with temporary.open("w", encoding="utf-8") as handle:
            json.dump(document, handle, ensure_ascii=False, separators=(",", ":"))
        temporary.replace(path)
    except OSError:
        temporary.unlink(missing_ok=True)


def _lifecycle_label(state: str) -> str:
    return {
        "detected": "首次进入异常候选队列",
        "monitoring": "后续刷新仍检测到同一候选",
        "corroborated": "独立证据完成交叉复核",
        "confirmed": "满足事件确认条件",
        "weakening": "本轮未再次检测到，进入减弱观察",
        "closed": "连续多轮未检出，生命周期关闭",
    }[state]


def _apply_event_lifecycle(region_id: str, events: list[OceanEvent], observed_at: datetime) -> None:
    records = _load_lifecycle_records(region_id)
    current_ids = {event.id for event in events if event.event_kind == "anomaly"}
    observed_at_text = observed_at.isoformat().replace("+00:00", "Z")

    for event in events:
        if event.event_kind != "anomaly":
            continue
        previous = records.get(event.id)
        previous_missing = int((previous or {}).get("missing_updates") or 0)
        if event.validation_state == "confirmed":
            state = "confirmed"
        elif event.validation_state == "corroborated":
            state = "corroborated"
        elif previous and previous.get("state") not in {"closed"}:
            state = "monitoring"
        else:
            state = "detected"

        first_detected_at = (
            str(previous.get("first_detected_at"))
            if previous and previous.get("state") != "closed" and previous.get("first_detected_at")
            else observed_at_text
        )
        revision = int((previous or {}).get("revision") or 0) + 1
        consecutive_updates = (
            int((previous or {}).get("consecutive_updates") or 0) + 1
            if previous and previous_missing == 0 and previous.get("state") != "closed"
            else 1
        )
        history = list((previous or {}).get("history") or [])
        if not history or history[-1].get("state") != state:
            history.append({"timestamp": observed_at_text, "label": _lifecycle_label(state), "state": state})
        history = history[-12:]
        record = {
            "id": event.id,
            "state": state,
            "first_detected_at": first_detected_at,
            "last_seen_at": observed_at_text,
            "revision": revision,
            "consecutive_updates": consecutive_updates,
            "missing_updates": 0,
            "source_count": len(set(event.sources)),
            "history": history,
        }
        records[event.id] = record

        first_detected = _parse_timestamp(first_detected_at) or observed_at
        event.lifecycle_state = state
        event.first_detected_at = first_detected
        event.last_seen_at = observed_at
        event.lifecycle_revision = revision
        event.consecutive_updates = consecutive_updates
        event.lifecycle_duration_hours = round(max(0.0, (observed_at - first_detected).total_seconds() / 3600), 2)
        lifecycle_items = [TimelineItem.model_validate(item) for item in history]
        existing_keys = {(item.timestamp, item.state, item.label) for item in lifecycle_items}
        event.timeline = lifecycle_items + [
            item for item in event.timeline if (item.timestamp, item.state, item.label) not in existing_keys
        ]

    for event_id, previous in list(records.items()):
        if event_id in current_ids or previous.get("state") == "closed":
            continue
        missing_updates = int(previous.get("missing_updates") or 0) + 1
        state = "closed" if missing_updates >= 3 else "weakening"
        history = list(previous.get("history") or [])
        if not history or history[-1].get("state") != state:
            history.append({"timestamp": observed_at_text, "label": _lifecycle_label(state), "state": state})
        previous.update(
            {
                "state": state,
                "revision": int(previous.get("revision") or 0) + 1,
                "consecutive_updates": 0,
                "missing_updates": missing_updates,
                "history": history[-12:],
            }
        )

    _persist_lifecycle_records(region_id, records)


def get_event_lifecycle_records(region_id: str) -> list[dict[str, Any]]:
    records = _load_lifecycle_records(region_id)
    return sorted(
        records.values(),
        key=lambda item: _parse_timestamp(item.get("last_seen_at")) or datetime.min.replace(tzinfo=UTC),
        reverse=True,
    )


def _argo_surface_observation(snapshot: dict[str, Any], surface_key: str) -> dict[str, Any] | None:
    latest = snapshot.get("latest") or {}
    surface = latest.get("surface") or {}
    value = surface.get(surface_key)
    quality = surface.get(f"{surface_key}_qc")
    pressure = surface.get(f"{surface_key}_pressure")
    longitude = latest.get("longitude")
    latitude = latest.get("latitude")
    position_quality = latest.get("position_qc")
    timestamp_quality = latest.get("timestamp_qc")
    value_mode = (latest.get("surface_modes") or {}).get(surface_key)
    numeric_values = (value, pressure, longitude, latitude)
    if any(item is None or not math.isfinite(float(item)) for item in numeric_values):
        return None
    if float(pressure) > ARGO_SURFACE_MAX_PRESSURE_DBAR or quality not in (1, 1.0, 2, 2.0):
        return None
    if position_quality not in (None, 1, 1.0, 2, 2.0) or timestamp_quality not in (None, 1, 1.0, 2, 2.0):
        return None
    if value_mode not in {"raw", "adjusted"}:
        return None
    return {
        "snapshot": snapshot,
        "value": float(value),
        "pressure": float(pressure),
        "quality": int(float(quality)),
        "longitude": float(longitude),
        "latitude": float(latitude),
        "value_mode": value_mode,
    }


def _local_argo_baseline(observation: dict[str, Any], observations: list[dict[str, Any]]) -> tuple[float, float, int] | None:
    peers = [
        candidate
        for candidate in observations
        if candidate is not observation
        and abs(candidate["latitude"] - observation["latitude"]) <= ARGO_LOCAL_BASELINE_LATITUDE_DEGREES
        and _haversine_km(
            observation["longitude"],
            observation["latitude"],
            candidate["longitude"],
            candidate["latitude"],
        ) <= ARGO_LOCAL_BASELINE_RADIUS_KM
    ]
    if len(peers) < ARGO_LOCAL_BASELINE_MIN_PEERS:
        return None
    values = [candidate["value"] for candidate in peers]
    baseline = median(values)
    mad = median(abs(value - baseline) for value in values)
    return baseline, mad, len(peers)


def _regional_bgc_baseline(
    observation: dict[str, Any],
    observations: list[dict[str, Any]],
) -> tuple[float, float, int] | None:
    """Use a broad BGC screen only when local peers are too sparse.

    This deliberately remains a screening signal: it never upgrades a record
    to a confirmed event and its method states that spatial corroboration is
    still required.
    """
    peers = [candidate for candidate in observations if candidate is not observation]
    if len(peers) < 7:
        return None
    values = [candidate["value"] for candidate in peers]
    baseline = median(values)
    mad = median(abs(value - baseline) for value in values)
    return baseline, mad, len(peers)


def _make_event(
    *,
    event_id: str,
    event_type: str,
    title: str,
    summary: str,
    region: dict[str, Any],
    longitude: float,
    latitude: float,
    timestamp: str,
    variable: str,
    observed: float,
    baseline: float,
    unit: str,
    source: str,
    source_url: str,
    method: str,
    confidence: float,
    observation_count: int,
    validation_state: str = "screening",
    sample_count: int = 1,
    temporal_span_hours: float = 0.0,
    spatial_peer_count: int | None = None,
    qc_pass_fraction: float | None = None,
    measurement_uncertainty: float | None = None,
    comparison_uncertainty: float | None = None,
    value_mode: str | None = None,
    evidence_series: list[DataPoint] | None = None,
    started_at: str | None = None,
) -> OceanEvent:
    anomaly = observed - baseline
    natural_scale = {
        "SST": 0.75,
        "SALINITY": 0.25,
        "CHLA": 0.15,
        "NITRATE": 0.8,
    }.get(variable, 1.0)
    severity = _severity(anomaly, natural_scale)
    if validation_state == "screening":
        # A one-time spatial comparison is a lead, not an active event.
        severity = min(severity, 0.69)
        confidence = min(confidence, 0.68)
    label = _severity_label(severity)
    evidence_id = f"{event_id}-E1"
    reference = (
        NOAA_REFERENCE
        if source == "NOAA_SST"
        else NOAA_CHLA_REFERENCE
        if source == "NOAA_CHLA_ANOMALY"
        else ARGO_REFERENCE
    )
    source_name = {
        "NOAA_SST": "NOAA 融合卫星海温",
        "NOAA_CHLA_ANOMALY": "NOAA VIIRS 叶绿素 a 日异常",
        "ARGO_CORE": "Argo 实测剖面",
        "BGC_ARGO": "BGC-Argo 实测剖面",
    }.get(source, source)
    satellite_source = source in {"NOAA_SST", "NOAA_CHLA_ANOMALY"}
    has_temporal_persistence = bool(evidence_series and len(evidence_series) >= NOAA_MIN_PERSISTENT_DAYS and temporal_span_hours > 0)
    return OceanEvent(
        id=event_id,
        type=event_type,
        event_kind="anomaly",
        title=title,
        summary=summary,
        region=f"{_plain_area_name(region, latitude, longitude)} · {_location(latitude, longitude)}",
        centroid=(longitude, latitude),
        radius_km=220 if satellite_source else 150,
        radius_basis="screening_search",
        started_at=started_at or timestamp,
        status=("active" if validation_state in {"corroborated", "confirmed"} and severity >= 0.65 else "watch"),
        severity=severity,
        severity_label=label,
        confidence=confidence,
        affected_area_km2=(
            round(math.pi * (220 if satellite_source else 150) ** 2)
            if validation_state in {"corroborated", "confirmed"}
            else None
        ),
        variables=[variable],
        sources=[source],
        references=[reference],
        evidence=[
            Evidence(
                id=evidence_id,
                source=source_name,
                variable=variable,
                observed=round(observed, 3),
                baseline=round(baseline, 3),
                anomaly=round(anomaly, 3),
                unit=unit,
                timestamp=timestamp,
                method=method,
                confidence=confidence,
                series=evidence_series or [DataPoint(timestamp=timestamp, value=round(observed, 3), baseline=round(baseline, 3))],
                sample_count=max(1, sample_count),
                temporal_span_hours=max(0.0, temporal_span_hours),
                spatial_peer_count=spatial_peer_count,
                qc_pass_fraction=qc_pass_fraction,
                measurement_uncertainty=(round(measurement_uncertainty, 3) if measurement_uncertainty is not None else None),
                comparison_uncertainty=(round(comparison_uncertainty, 3) if comparison_uncertainty is not None else None),
                value_mode=value_mode,
                validation_state=validation_state,
            )
        ],
        reasoning_chain=[
            ReasoningStep(
                order=1,
                claim=f"{source_name}显示 {variable} 相对当前区域基线偏差 {anomaly:+.2f} {unit}。",
                mechanism="系统先进行质量筛选，再与同一时次的邻近观测稳健中位数比较；这不是长期气候基线。",
                evidence_ids=[evidence_id],
                reference_ids=[reference.id],
                confidence=confidence,
            ),
            ReasoningStep(
                order=2,
                claim=(
                    "该信号已通过短期连续日时次筛查，但仍需要气候阈值和独立来源复核。"
                    if has_temporal_persistence
                    else "该信号进入实时异常候选队列，需要结合连续时间和邻近资料复核。"
                ),
                mechanism=(
                    "连续空间离群能够排除部分瞬时噪声，但不能替代逐日历气候百分位事件认定。"
                    if has_temporal_persistence
                    else "单时次空间偏差用于快速筛查，不直接替代气候态事件认定。"
                ),
                evidence_ids=[evidence_id],
                reference_ids=[reference.id],
                confidence=max(0.55, confidence - 0.08),
            ),
        ],
        timeline=(
            [
                TimelineItem(timestamp=started_at, label="连续空间异常筛查开始", state="detected"),
                TimelineItem(timestamp=timestamp, label="最新观测进入数据管线", state="observed"),
            ]
            if started_at and started_at != timestamp
            else [TimelineItem(timestamp=timestamp, label="实时观测进入数据管线", state="observed")]
        ),
        potential_impacts=[
            "提示当前海域水团或上层海洋状态存在空间差异。",
            "建议结合后续时次、邻近浮标和卫星网格持续跟踪。",
        ],
        uncertainty=(
            (
                "当前结果已通过短期连续日时次筛查，但仍未接入逐日历气候百分位阈值和独立来源复核，"
                "不能解释为已确认海洋事件；局地空间中位数不是长期气候态。"
                if has_temporal_persistence
                else "当前结果为实时自动筛查，尚未满足连续时间复核，不能解释为已确认海洋事件；"
                "区域中位数也不是长期气候态，事件等级会随新观测更新。"
            )
            if validation_state == "screening"
            else "该事件已通过连续观测与基线条件复核，但影响范围仍需结合独立资料确认。"
        ),
        region_id=region["id"],
        data_mode="live",
        validation_state=validation_state,
        observation_count=observation_count,
        source_updated_at=timestamp,
    )


def _make_observation_event(
    *,
    event_id: str,
    event_type: str,
    title: str,
    summary: str,
    region: dict[str, Any],
    longitude: float,
    latitude: float,
    timestamp: str,
    variable: str,
    observed: float,
    minimum: float,
    maximum: float,
    unit: str,
    source: str,
    method: str,
    confidence: float,
    observation_count: int,
    sample_count: int,
    priority: float,
    value_mode: str | None = None,
    qc_pass_fraction: float | None = None,
    measurement_uncertainty: float | None = None,
    temporal_span_hours: float = 0.0,
    evidence_series: list[DataPoint] | None = None,
    radius_km: float | None = None,
) -> OceanEvent:
    evidence_id = f"{event_id}-E1"
    reference = {
        "NOAA_SST": NOAA_REFERENCE,
        "WOA23_NITRATE": WOA_NITRATE_REFERENCE,
        "WOA23_SALINITY": WOA_SALINITY_REFERENCE,
        "NOAA_CHLA_DINEOF": NOAA_CHLA_OBSERVATION_REFERENCE,
        "NOAA_CURRENTS": NOAA_CURRENTS_REFERENCE,
        "NOAA_SPCO2": NOAA_CARBON_REFERENCE,
        "COPERNICUS_WAVE": COPERNICUS_WAVE_REFERENCE,
        "COPERNICUS_WIND": COPERNICUS_WIND_REFERENCE,
    }.get(source, ARGO_REFERENCE)
    source_name = {
        "NOAA_SST": "NOAA 融合卫星海温",
        "ARGO_CORE": "Argo 实测剖面",
        "BGC_ARGO": "BGC-Argo 实测剖面",
        "WOA23_NITRATE": "NOAA WOA23 硝酸盐气候态",
        "WOA23_SALINITY": "NOAA WOA23 盐度气候态",
        "NOAA_CHLA_DINEOF": "NOAA VIIRS 卫星叶绿素 a",
        "NOAA_CURRENTS": "NOAA 全球逐日表层流场",
        "NOAA_SPCO2": "NOAA OCADS 海表 pCO2 气候态",
        "COPERNICUS_WAVE": "Copernicus Marine 全球波浪模式",
        "COPERNICUS_WIND": "Copernicus Marine 全球海面风场",
    }[source]
    variable_name = _plain_variable(variable)
    unit_label = _plain_unit(unit)
    observation_radius_km = radius_km if radius_km is not None else (260 if source == "NOAA_SST" else 180)
    is_single_record = sample_count == 1 and math.isclose(minimum, maximum, rel_tol=0.0, abs_tol=1e-12)
    value_claim = (
        f"{source_name}在这个位置测得{variable_name} {observed:.3f} {unit_label}。"
        if is_single_record
        else (
            f"{source_name}测得{variable_name}代表值 {observed:.3f} {unit_label}，"
            f"这批记录的范围是 {minimum:.3f}–{maximum:.3f} {unit_label}。"
        )
    )
    quality_mechanism = (
        "变量、位置和时间都通过质量检查后，这条数据才会显示在列表中。"
        if is_single_record
        else "这里只统计通过质量检查的数据，中位数表示这批数据的大致水平。"
    )
    return OceanEvent(
        id=event_id,
        type=event_type,
        event_kind="observation",
        title=title,
        summary=summary,
        region=f"{_plain_area_name(region, latitude, longitude)} · {_location(latitude, longitude)}",
        centroid=(longitude, latitude),
        radius_km=observation_radius_km,
        radius_basis="observation_footprint",
        started_at=timestamp,
        status="watch",
        severity=priority,
        severity_label="low",
        confidence=confidence,
        affected_area_km2=None,
        variables=[variable],
        sources=[source],
        references=[reference],
        evidence=[
            Evidence(
                id=evidence_id,
                source=source_name,
                variable=variable,
                observed=round(observed, 3),
                baseline=round(observed, 3),
                anomaly=0.0,
                unit=unit,
                timestamp=timestamp,
                method=method,
                confidence=confidence,
                series=evidence_series or [DataPoint(timestamp=timestamp, value=round(observed, 3), baseline=round(observed, 3))],
                sample_count=max(1, sample_count),
                temporal_span_hours=max(0.0, temporal_span_hours),
                qc_pass_fraction=qc_pass_fraction,
                measurement_uncertainty=(round(measurement_uncertainty, 3) if measurement_uncertainty is not None else None),
                value_mode=value_mode,
                validation_state="observed",
            )
        ],
        reasoning_chain=[
            ReasoningStep(
                order=1,
                claim=value_claim,
                mechanism=quality_mechanism,
                evidence_ids=[evidence_id],
                reference_ids=[reference.id],
                confidence=confidence,
            ),
            ReasoningStep(
                order=2,
                claim="这条数据说明的是当时、当地的海洋状态。",
                mechanism="与当地历史范围、邻近测点和连续观测对比，可以识别空间与时间变化。",
                evidence_ids=[evidence_id],
                reference_ids=[reference.id],
                confidence=max(0.55, confidence - 0.05),
            ),
        ],
        timeline=[TimelineItem(timestamp=timestamp, label="数据通过质量检查并进入观测列表", state="observed")],
        potential_impacts=[
            "查看这个时间和位置的实际海况。",
            "与邻近测点或后续观测对比，了解海洋状态怎样变化。",
        ],
        uncertainty="这条数据只代表当时当地，不能直接代表整个海域或长期气候。",
        region_id=region["id"],
        data_mode="live",
        validation_state="observed",
        observation_count=observation_count,
        source_updated_at=timestamp,
    )


def _sst_observation_events(region: dict[str, Any], snapshot: dict[str, Any]) -> list[OceanEvent]:
    valid_points = [
        point
        for point in snapshot.get("points", [])
        if point.get("quality_valid") is True
        and isinstance(point.get("timestamp"), str)
        and isinstance(point.get("temperature"), (int, float))
        and math.isfinite(float(point["temperature"]))
    ]
    if not valid_points:
        return []
    point_count = int(snapshot.get("point_count") or len(valid_points))
    points_by_location: dict[tuple[float, float], list[dict[str, Any]]] = {}
    for point in valid_points:
        coordinate = (float(point["latitude"]), float(point["longitude"]))
        points_by_location.setdefault(coordinate, []).append(point)
    for location_points in points_by_location.values():
        location_points.sort(key=lambda item: _parse_timestamp(item["timestamp"]) or datetime.min.replace(tzinfo=UTC))

    event_points = sorted(
        valid_points,
        key=lambda item: (
            _parse_timestamp(item["timestamp"]) or datetime.min.replace(tzinfo=UTC),
            float(item["latitude"]),
            float(item["longitude"]),
        ),
        reverse=True,
    )
    if len(event_points) > NOAA_OBSERVATION_EVENT_LIMIT:
        last_index = len(event_points) - 1
        event_points = [
            event_points[round(index * last_index / (NOAA_OBSERVATION_EVENT_LIMIT - 1))]
            for index in range(NOAA_OBSERVATION_EVENT_LIMIT)
        ]

    events: list[OceanEvent] = []
    for point in event_points:
        timestamp = point["timestamp"]
        parsed_timestamp = _parse_timestamp(timestamp)
        latitude = float(point["latitude"])
        longitude = float(point["longitude"])
        temperature = float(point["temperature"])
        analysis_error = (
            float(point["analysis_error"])
            if isinstance(point.get("analysis_error"), (int, float))
            and math.isfinite(float(point["analysis_error"]))
            else None
        )
        history_points = [
            item
            for item in points_by_location[(latitude, longitude)]
            if parsed_timestamp is None
            or (_parse_timestamp(item["timestamp"]) or datetime.min.replace(tzinfo=UTC)) <= parsed_timestamp
        ]
        series = [
            DataPoint(
                timestamp=item["timestamp"],
                value=round(float(item["temperature"]), 3),
                baseline=round(float(item["temperature"]), 3),
            )
            for item in history_points
        ]
        history_times = [_parse_timestamp(item["timestamp"]) for item in history_points]
        temporal_span_hours = 0.0
        if history_times and history_times[0] and history_times[-1]:
            temporal_span_hours = max(0.0, (history_times[-1] - history_times[0]).total_seconds() / 3600)
        date_token = timestamp[:10].replace("-", "")
        latitude_token = f"{'N' if latitude >= 0 else 'S'}{abs(round(latitude * 10_000)):07d}"
        longitude_token = f"{'E' if longitude >= 0 else 'W'}{abs(round(longitude * 10_000)):07d}"
        ice_fraction = point.get("sea_ice_fraction")
        confidence = max(0.72, min(0.96, 0.96 - (analysis_error or 0.0) * 0.05))
        area_name = _plain_area_name(region, latitude, longitude)
        error_sentence = f"产品误差约为 ±{analysis_error:.2f} °C。" if analysis_error is not None else ""
        ice_sentence = (
            f"海冰比例为 {float(ice_fraction) * 100:.1f}%。"
            if isinstance(ice_fraction, (int, float)) and math.isfinite(float(ice_fraction))
            else ""
        )
        event = _make_observation_event(
            event_id=f"OBS-{region['id'].upper()}-SST-{date_token}-{latitude_token}-{longitude_token}",
            event_type="surface_observation",
            title=f"{area_name}海面温度 {temperature:.1f} °C",
            summary=(
                f"{_short_date(timestamp)}，NOAA 卫星在{area_name}测得海面温度 {temperature:.2f} °C。"
                f"{error_sentence}{ice_sentence}数据已通过质量检查，可与当地历史和邻近测点进行比较。"
            ),
            region=region,
            longitude=longitude,
            latitude=latitude,
            timestamp=timestamp,
            variable="SST",
            observed=temperature,
            minimum=temperature,
            maximum=temperature,
            unit="degC",
            source="NOAA_SST",
            method="NOAA 每日融合海温数据；分析误差有效、水体标记通过，海冰比例不高于 15%。",
            confidence=confidence,
            observation_count=point_count,
            sample_count=1,
            priority=0.40,
            value_mode="analysis",
            qc_pass_fraction=1.0,
            measurement_uncertainty=analysis_error,
            temporal_span_hours=temporal_span_hours,
            evidence_series=series,
            radius_km=25.0,
        )
        if snapshot.get("cache", {}).get("state") != "fresh":
            event.data_mode = "cached"
        events.append(event)
    return events


def _argo_observation_events(
    region: dict[str, Any],
    samples: list[dict[str, Any]],
    profile_count: int,
) -> list[OceanEvent]:
    specifications = [
        ("temperature", "TEMPERATURE", "degC", "hydrographic_observation", "温度", "ARGO_CORE", 0.36),
        ("salinity", "SALINITY", "PSU", "hydrographic_observation", "盐度", "ARGO_CORE", 0.35),
        ("chla", "CHLA", "mg m-3", "biogeochemical_observation", "叶绿素", "BGC_ARGO", 0.33),
        ("nitrate", "NITRATE", "umol kg-1", "biogeochemical_observation", "硝酸盐", "BGC_ARGO", 0.32),
    ]
    events: list[OceanEvent] = []
    for surface_key, variable, unit, event_type, noun, source, priority in specifications:
        # Each Argo variable is a vertical profile. Expose a representative,
        # QC-passing depth sample instead of collapsing temperature and
        # salinity to one surface value per float.
        if variable in {"TEMPERATURE", "SALINITY", "CHLA", "NITRATE"}:
            depth_records: list[tuple[dict[str, Any], dict[str, Any]]] = []
            for sample in samples:
                snapshot = sample
                latest = snapshot.get("latest") or {}
                for point in latest.get("points") or []:
                    value = point.get(surface_key)
                    quality = point.get(f"{surface_key}_qc")
                    mode = point.get(f"{surface_key}_mode")
                    pressure = point.get("pressure")
                    if (
                        isinstance(value, (int, float))
                        and math.isfinite(float(value))
                        and isinstance(pressure, (int, float))
                        and math.isfinite(float(pressure))
                        and quality in (1, 1.0, 2, 2.0)
                        and mode in {"raw", "adjusted"}
                    ):
                        depth_records.append((snapshot, point))
            if depth_records:
                depth_limit = (
                    ARGO_NUTRIENT_EVENT_LIMIT
                    if variable == "NITRATE"
                    else OBSERVATION_CATEGORY_TARGET
                )
                depth_records = _evenly_spaced_pairs(depth_records, depth_limit)
                for snapshot, point in depth_records:
                    latest = snapshot["latest"]
                    platform = str(snapshot.get("platform") or "UNKNOWN")
                    platform_token = "".join(character for character in platform.upper() if character.isalnum()) or "UNKNOWN"
                    cycle = latest.get("cycle")
                    cycle_token = str(cycle) if cycle is not None else latest["timestamp"][:10].replace("-", "")
                    value = float(point[surface_key])
                    pressure = float(point["pressure"])
                    quality = int(float(point[f"{surface_key}_qc"]))
                    value_mode = str(point.get(f"{surface_key}_mode") or "raw")
                    area_name = _plain_area_name(region, float(latest["latitude"]), float(latest["longitude"]))
                    value_precision = 3 if variable == "CHLA" else 1 if variable == "TEMPERATURE" else 2
                    events.append(
                        _make_observation_event(
                            event_id=f"OBS-{region['id'].upper()}-ARGO-{platform_token}-C{cycle_token}-{variable}-P{pressure:.1f}".replace(".", "_"),
                            event_type=event_type,
                            title=f"浮标 {platform}：{area_name} {noun} {value:.{value_precision}f}（{pressure:.0f} dbar）",
                            summary=(
                                f"{_short_date(latest['timestamp'])}，Argo 浮标 {platform} 在 {area_name} 的 {pressure:.1f} dbar 深度"
                                f"测得{noun} {value:.{value_precision}f} {_plain_unit(unit)}。这是垂向剖面中的 QC {quality} 记录，"
                                "用于了解水体随深度的变化，不代表整个海域平均值。"
                            ),
                            region=region,
                            longitude=float(latest["longitude"]),
                            latitude=float(latest["latitude"]),
                            timestamp=latest["timestamp"],
                            variable=variable,
                            observed=value,
                            minimum=value,
                            maximum=value,
                            unit=unit,
                            source=source,
                            method=(
                                f"Argo 垂向剖面；压力 {pressure:.1f} dbar；变量 QC {quality}；"
                                f"采用{('校正后的数据' if value_mode == 'adjusted' else '仪器原始数据')}。"
                            ),
                            confidence=0.92 if quality == 1 else 0.84,
                            observation_count=profile_count,
                            sample_count=1,
                            priority=priority,
                            value_mode=value_mode,
                            qc_pass_fraction=1.0,
                            radius_km=25.0,
                        )
                    )
                continue
        observations = [
            observation
            for sample in samples
            if (observation := _argo_surface_observation(sample, surface_key)) is not None
        ]
        if not observations:
            continue
        for observation in observations:
            snapshot = observation["snapshot"]
            latest = snapshot["latest"]
            platform = str(snapshot.get("platform") or "UNKNOWN")
            platform_token = "".join(character for character in platform.upper() if character.isalnum()) or "UNKNOWN"
            cycle = latest.get("cycle")
            cycle_token = str(cycle) if cycle is not None else latest["timestamp"][:10].replace("-", "")
            value = observation["value"]
            quality = observation["quality"]
            value_mode = observation["value_mode"]
            mode_label = "经校正的数据" if value_mode == "adjusted" else "仪器原始数据"
            quality_label = "质量良好" if quality == 1 else "质量基本可靠"
            unit_label = _plain_unit(unit)
            value_precision = 1 if variable == "TEMPERATURE" else 3 if variable == "CHLA" else 2
            area_name = _plain_area_name(region, observation["latitude"], observation["longitude"])
            confidence = 0.92 if quality == 1 else 0.84
            event = _make_observation_event(
                event_id=f"OBS-{region['id'].upper()}-ARGO-{platform_token}-C{cycle_token}-{variable}",
                event_type=event_type,
                title=f"浮标 {platform}：{area_name}近表层{noun} {value:.{value_precision}f} {unit_label}",
                summary=(
                    f"{_short_date(latest['timestamp'])}，Argo 浮标 {platform} 在{area_name}的近表层"
                    f"（压力 {observation['pressure']:.1f} dbar）测得{noun} {value:.{value_precision}f} {unit_label}。"
                    f"这是{mode_label}，QC {quality} 表示{quality_label}，位置和时间也通过质量检查。"
                    "判断变化时，应和同海域、相近时间的观测一起看。"
                ),
                region=region,
                longitude=observation["longitude"],
                latitude=observation["latitude"],
                timestamp=latest["timestamp"],
                variable=variable,
                observed=value,
                minimum=value,
                maximum=value,
                unit=unit,
                source=source,
                method=(
                    f"Argo 最新完整剖面的近表层数据；压力 {observation['pressure']:.1f} dbar，"
                    f"变量 QC {quality}，位置和时间质量检查通过；使用{mode_label}。"
                ),
                confidence=confidence,
                observation_count=profile_count,
                sample_count=1,
                priority=priority,
                value_mode=value_mode,
                qc_pass_fraction=1.0,
                radius_km=25.0,
            )
            events.append(event)
    return events


def _evenly_spaced_pairs(
    records: list[tuple[dict[str, Any], dict[str, Any]]],
    limit: int,
) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    if len(records) <= limit:
        return records
    stride = (len(records) - 1) / max(1, limit - 1)
    return [records[round(index * stride)] for index in range(limit)]


def _sst_events(region: dict[str, Any], snapshot: dict[str, Any]) -> list[OceanEvent]:
    points = [
        {**item, "parsed_timestamp": _parse_timestamp(item.get("timestamp"))}
        for item in snapshot.get("points", [])
        if isinstance(item, dict)
        and isinstance(item.get("temperature"), (int, float))
        and math.isfinite(float(item["temperature"]))
        and -2.0 <= float(item["temperature"]) <= 45.0
        and item.get("quality_valid") is True
        and _parse_timestamp(item.get("timestamp")) is not None
    ]
    if not snapshot.get("quality_fields_complete") or not points:
        return []

    analyses_by_location: dict[tuple[float, float], list[dict[str, Any]]] = {}
    points_by_timestamp: dict[str, list[dict[str, Any]]] = {}
    for point in points:
        points_by_timestamp.setdefault(point["timestamp"], []).append(point)

    cell_degrees = NOAA_LOCAL_BASELINE_RADIUS_KM / 111.0
    longitude_bucket_count = math.ceil(360.0 / cell_degrees)
    for timestamp_points in points_by_timestamp.values():
        buckets: dict[tuple[int, int], list[dict[str, Any]]] = {}
        for point in timestamp_points:
            latitude_bucket = math.floor((point["latitude"] + 90.0) / cell_degrees)
            longitude_bucket = math.floor((point["longitude"] + 180.0) / cell_degrees) % longitude_bucket_count
            buckets.setdefault((latitude_bucket, longitude_bucket), []).append(point)

        for point in timestamp_points:
            latitude_bucket = math.floor((point["latitude"] + 90.0) / cell_degrees)
            longitude_bucket = math.floor((point["longitude"] + 180.0) / cell_degrees) % longitude_bucket_count
            longitude_radius = NOAA_LOCAL_BASELINE_RADIUS_KM / (
                111.0 * max(math.cos(math.radians(point["latitude"])), 0.1)
            )
            longitude_bucket_span = max(1, math.ceil(longitude_radius / cell_degrees))
            candidates = (
                candidate
                for latitude_offset in (-1, 0, 1)
                for longitude_offset in range(-longitude_bucket_span, longitude_bucket_span + 1)
                for candidate in buckets.get(
                    (
                        latitude_bucket + latitude_offset,
                        (longitude_bucket + longitude_offset) % longitude_bucket_count,
                    ),
                    [],
                )
            )
            peers = [
                candidate
                for candidate in candidates
                if candidate is not point
                and _haversine_km(
                    point["longitude"],
                    point["latitude"],
                    candidate["longitude"],
                    candidate["latitude"],
                ) <= NOAA_LOCAL_BASELINE_RADIUS_KM
            ]
            if len(peers) < NOAA_LOCAL_BASELINE_MIN_PEERS:
                continue
            peer_values = [float(candidate["temperature"]) for candidate in peers]
            peer_errors = [float(candidate["analysis_error"]) for candidate in peers]
            baseline = median(peer_values)
            mad = median(abs(value - baseline) for value in peer_values)
            anomaly = float(point["temperature"]) - baseline
            robust_scale = max(1.4826 * mad, NOAA_MIN_ABSOLUTE_DEVIATION_C / 3)
            robust_score = abs(anomaly) / robust_scale
            comparison_uncertainty = math.hypot(float(point["analysis_error"]), median(peer_errors))
            uncertainty_score = abs(anomaly) / max(comparison_uncertainty, 1e-6)
            if (
                abs(anomaly) < NOAA_MIN_ABSOLUTE_DEVIATION_C
                or robust_score < 3.0
                or uncertainty_score < 3.0
            ):
                continue
            location_key = (round(float(point["latitude"]), 4), round(float(point["longitude"]), 4))
            analyses_by_location.setdefault(location_key, []).append(
                {
                    **point,
                    "baseline": baseline,
                    "anomaly": anomaly,
                    "peer_count": len(peers),
                    "robust_score": robust_score,
                    "comparison_uncertainty": comparison_uncertainty,
                    "uncertainty_score": uncertainty_score,
                }
            )

    latest_timestamp = max(point["parsed_timestamp"] for point in points)
    candidates: list[dict[str, Any]] = []
    for history in analyses_by_location.values():
        ordered = sorted(history, key=lambda item: item["parsed_timestamp"])
        if ordered[-1]["parsed_timestamp"] != latest_timestamp:
            continue
        direction = 1 if ordered[-1]["anomaly"] >= 0 else -1
        persistent = [ordered[-1]]
        current = ordered[-1]
        for previous in reversed(ordered[:-1]):
            gap_hours = (current["parsed_timestamp"] - previous["parsed_timestamp"]).total_seconds() / 3600
            if not NOAA_MIN_DAILY_GAP_HOURS <= gap_hours <= NOAA_MAX_DAILY_GAP_HOURS:
                break
            if direction * previous["anomaly"] < NOAA_MIN_ABSOLUTE_DEVIATION_C or previous["robust_score"] < 3.0:
                break
            persistent.append(previous)
            current = previous
        if len(persistent) < NOAA_MIN_PERSISTENT_DAYS:
            continue
        persistent.reverse()
        candidates.append(
            {
                **ordered[-1],
                "persistent": persistent,
                "persistence_days": len(persistent),
                "persistence_hours": (
                    persistent[-1]["parsed_timestamp"] - persistent[0]["parsed_timestamp"]
                ).total_seconds()
                / 3600,
            }
        )

    selected = sorted(
        candidates,
        key=lambda item: (item["persistence_days"], item["robust_score"]),
        reverse=True,
    )[:10]
    events: list[OceanEvent] = []
    for point in selected:
        baseline = point["baseline"]
        anomaly = point["temperature"] - baseline
        warm = anomaly >= 0
        persistent = point["persistent"]
        area_name = _plain_area_name(region, point["latitude"], point["longitude"])
        title = f"{area_name}海温连续{'偏高' if warm else '偏低'}"
        event_type = "surface_temperature_anomaly"
        location_token = f"{point['latitude']:+07.2f}-{point['longitude']:+08.2f}".replace("+", "P").replace("-", "M").replace(".", "")
        event_id = f"SIG-NOAA-SST-{location_token}"
        events.append(
            _make_event(
                event_id=event_id,
                event_type=event_type,
                title=title,
                summary=(
                    f"{_short_date(point['timestamp'])}，{area_name}这一位置的海面温度为 "
                    f"{point['temperature']:.2f} °C，比同一天附近测点{'高' if warm else '低'} "
                    f"{abs(anomaly):.2f} °C。这种差异已连续 {point['persistence_days']} 天出现，因此标为异常候选。"
                ),
                region=region,
                longitude=point["longitude"],
                latitude=point["latitude"],
                timestamp=point["timestamp"],
                variable="SST",
                observed=point["temperature"],
                baseline=baseline,
                unit="degC",
                source="NOAA_SST",
                source_url=snapshot["source"]["url"],
                method=(
                    f"NOAA 连续逐日融合 SST 网格；仅使用水面、海冰比例不高于 15%、分析误差有效的记录；"
                    f"逐日与 {NOAA_LOCAL_BASELINE_RADIUS_KM:.0f} km 内 {point['peer_count']} 个空间邻居的"
                    f"中位数及 MAD 比较，异常差值还须达到格点与邻域误差合成值的 3σ，"
                    f"并要求至少连续 {NOAA_MIN_PERSISTENT_DAYS} 天通过全部阈值。"
                ),
                confidence=min(0.64, 0.56 + 0.02 * (point["persistence_days"] - NOAA_MIN_PERSISTENT_DAYS)),
                observation_count=snapshot["point_count"],
                sample_count=point["persistence_days"],
                temporal_span_hours=point["persistence_hours"],
                spatial_peer_count=point["peer_count"],
                qc_pass_fraction=1.0,
                measurement_uncertainty=point.get("analysis_error"),
                comparison_uncertainty=point.get("comparison_uncertainty"),
                value_mode="analysis",
                evidence_series=[
                    DataPoint(
                        timestamp=item["timestamp"],
                        value=round(item["temperature"], 3),
                        baseline=round(item["baseline"], 3),
                    )
                    for item in persistent
                ],
                started_at=persistent[0]["timestamp"],
            )
        )
    return events


def _chlorophyll_events(region: dict[str, Any], snapshot: dict[str, Any]) -> list[OceanEvent]:
    points = [
        point
        for point in snapshot.get("points", [])
        if isinstance(point, dict)
        and isinstance(point.get("chlorophyll_anomaly"), (int, float))
        and math.isfinite(float(point["chlorophyll_anomaly"]))
        and isinstance(point.get("latitude"), (int, float))
        and isinstance(point.get("longitude"), (int, float))
        and isinstance(point.get("timestamp"), str)
    ]
    if len(points) < 20:
        return []

    values = [float(point["chlorophyll_anomaly"]) for point in points]
    center = median(values)
    mad = median(abs(value - center) for value in values)
    robust_scale = max(1.4826 * mad, NOAA_CHLA_MIN_ABSOLUTE_DEVIATION / 3)
    eligible = [
        {
            **point,
            "anomaly": float(point["chlorophyll_anomaly"]),
            "robust_score": abs(float(point["chlorophyll_anomaly"]) - center) / robust_scale,
        }
        for point in points
        if abs(float(point["chlorophyll_anomaly"])) >= NOAA_CHLA_MIN_ABSOLUTE_DEVIATION
        and abs(float(point["chlorophyll_anomaly"]) - center) / robust_scale >= NOAA_CHLA_MIN_ROBUST_SCORE
    ]
    if not eligible:
        return []

    grid_step = max(
        float(snapshot.get("latitude_step_degrees") or 0),
        float(snapshot.get("longitude_step_degrees") or 0),
    )
    cluster_radius_km = max(180.0, min(650.0, grid_step * 111.0 * 1.75))
    remaining = sorted(eligible, key=lambda point: point["robust_score"], reverse=True)
    clusters: list[list[dict[str, Any]]] = []
    while remaining and len(clusters) < NOAA_CHLA_EVENT_LIMIT:
        seed = remaining.pop(0)
        direction = 1 if seed["anomaly"] >= 0 else -1
        cluster = [seed]
        retained: list[dict[str, Any]] = []
        for candidate in remaining:
            same_direction = (candidate["anomaly"] >= 0) == (direction > 0)
            distance = _haversine_km(
                float(seed["longitude"]),
                float(seed["latitude"]),
                float(candidate["longitude"]),
                float(candidate["latitude"]),
            )
            if same_direction and distance <= cluster_radius_km:
                cluster.append(candidate)
            else:
                retained.append(candidate)
        clusters.append(cluster)
        remaining = retained

    events: list[OceanEvent] = []
    for cluster in clusters:
        representative = max(cluster, key=lambda point: point["robust_score"])
        cluster_values = [float(point["anomaly"]) for point in cluster]
        anomaly = median(cluster_values)
        weights = [max(abs(value), 0.01) for value in cluster_values]
        latitude = sum(float(point["latitude"]) * weight for point, weight in zip(cluster, weights, strict=True)) / sum(weights)
        longitude = sum(float(point["longitude"]) * weight for point, weight in zip(cluster, weights, strict=True)) / sum(weights)
        timestamp = str(representative["timestamp"])
        area_name = _plain_area_name(region, latitude, longitude)
        positive = anomaly >= 0
        direction_label = "偏高" if positive else "偏低"
        representative_token = (
            f"{float(representative['latitude']):+08.4f}-{float(representative['longitude']):+09.4f}"
            .replace("+", "P")
            .replace("-", "M")
            .replace(".", "")
        )
        direction_token = "HI" if positive else "LO"
        event_id = f"SIG-NOAA-CHLA-{representative_token}-{direction_token}"
        events.append(
            _make_event(
                event_id=event_id,
                event_type="chlorophyll_anomaly",
                title=f"{area_name}叶绿素 a {direction_label}候选",
                summary=(
                    f"{_short_date(timestamp)}，NOAA VIIRS 海洋水色网格显示，{area_name}附近的叶绿素 a "
                    f"相对 61 日合成场{direction_label}约 {abs(anomaly):.3f} mg m-3。"
                    f"相邻 {len(cluster)} 个有效像元被合并为空间候选；这表示水色变化线索，不等同于已确认藻华。"
                ),
                region=region,
                longitude=longitude,
                latitude=latitude,
                timestamp=timestamp,
                variable="CHLA",
                observed=anomaly,
                baseline=0.0,
                unit="mg m-3",
                source="NOAA_CHLA_ANOMALY",
                source_url=snapshot["source"]["url"],
                method=(
                    "NOAA CoastWatch VIIRS 日叶绿素 a 差值产品；逐像元表示当日场与 61 日合成场的差值。"
                    f"系统剔除缺失与非有限值，以区域中位数和 MAD 计算稳健分数，要求绝对差值不小于 "
                    f"{NOAA_CHLA_MIN_ABSOLUTE_DEVIATION:.2f} mg m-3 且稳健分数不小于 {NOAA_CHLA_MIN_ROBUST_SCORE:.1f}；"
                    f"同方向且相距不超过 {cluster_radius_km:.0f} km 的像元合并为空间候选。"
                ),
                confidence=min(0.64, 0.52 + 0.015 * min(len(cluster), 8)),
                observation_count=int(snapshot.get("point_count") or len(points)),
                sample_count=len(cluster),
                spatial_peer_count=max(0, len(cluster) - 1),
                value_mode="analysis",
            )
        )
    return events


def _argo_events(region: dict[str, Any], samples: list[dict[str, Any]], profile_count: int) -> list[OceanEvent]:
    specifications = [
        ("salinity", "SALINITY", "PSU", "salinity_anomaly", 4),
        ("chla", "CHLA", "mg m-3", "chlorophyll_anomaly", 8),
        ("nitrate", "NITRATE", "umol kg-1", "nutrient_anomaly", 8),
    ]
    events: list[OceanEvent] = []
    for surface_key, variable, unit, event_type, limit in specifications:
        observations = [
            observation
            for item in samples
            if (observation := _argo_surface_observation(item, surface_key)) is not None
        ]
        if len(observations) <= ARGO_LOCAL_BASELINE_MIN_PEERS:
            continue
        candidates: list[dict[str, Any]] = []
        minimum_deviation = ARGO_MIN_ABSOLUTE_DEVIATION[variable]
        for observation in observations:
            baseline_scope = "local"
            local = _local_argo_baseline(observation, observations)
            if local is None and variable in {"CHLA", "NITRATE"}:
                local = _regional_bgc_baseline(observation, observations)
                baseline_scope = "regional_bgc"
            if local is None:
                continue
            baseline, mad, peer_count = local
            anomaly = observation["value"] - baseline
            robust_scale = max(1.4826 * mad, minimum_deviation / 3)
            robust_score = abs(anomaly) / robust_scale
            if abs(anomaly) < minimum_deviation or robust_score < 3.0:
                continue
            candidates.append(
                {
                    **observation,
                    "baseline": baseline,
                    "anomaly": anomaly,
                    "peer_count": peer_count,
                    "robust_score": robust_score,
                    "baseline_scope": baseline_scope,
                }
            )
        ranked = sorted(candidates, key=lambda item: item["robust_score"], reverse=True)[:limit]
        for candidate in ranked:
            snapshot = candidate["snapshot"]
            latest = snapshot["latest"]
            observed = candidate["value"]
            baseline = candidate["baseline"]
            anomaly = candidate["anomaly"]
            peer_count = candidate["peer_count"]
            value_mode = candidate["value_mode"]
            value_mode_label = "调整值" if value_mode == "adjusted" else "原始值"
            noun = {"SALINITY": "盐度", "CHLA": "叶绿素 a", "NITRATE": "硝酸盐"}[variable]
            baseline_method = (
                f"同纬带、{ARGO_LOCAL_BASELINE_RADIUS_KM:.0f} km 内 {peer_count} 个邻近浮标中位数比较，"
                if candidate["baseline_scope"] == "local"
                else f"使用区域生地化基线与 {peer_count} 个参考浮标中位数比较，"
            )
            event_id = f"SIG-ARGO-{variable}-{snapshot['platform']}"
            events.append(
                _make_event(
                    event_id=event_id,
                    event_type=event_type,
                    title=f"{_plain_area_name(region, latest['latitude'], latest['longitude'])}{noun}{_label(anomaly, '偏高', '偏低')}候选",
                    summary=(
                        f"{_short_date(latest['timestamp'])}，Argo 浮标 {snapshot['platform']} 在"
                        f"{_plain_area_name(region, latest['latitude'], latest['longitude'])}测得{noun} {observed:.3f} {_plain_unit(unit)}。"
                        f"这个数值比附近 {peer_count} 个浮标的中位数{'高' if anomaly >= 0 else '低'} "
                        f"{abs(anomaly):.3f} {_plain_unit(unit)}；数据使用{value_mode_label}并通过 QC 1/2 检查。"
                    ),
                    region=region,
                    longitude=latest["longitude"],
                    latitude=latest["latitude"],
                    timestamp=latest["timestamp"],
                    variable=variable,
                    observed=observed,
                    baseline=baseline,
                    unit=unit,
                    source="BGC_ARGO" if variable in {"CHLA", "NITRATE"} else "ARGO_CORE",
                    source_url=snapshot["source"]["url"],
                    method=(
                        f"最新 Argo 近表层剖面的{value_mode_label}（不深于 {ARGO_SURFACE_MAX_PRESSURE_DBAR:.0f} dbar，QC 1/2）；"
                        + baseline_method
                        + "并通过最小绝对偏差和稳健 MAD 离群阈值筛选。"
                    ),
                    confidence=min(0.66, 0.50 + 0.02 * peer_count),
                    observation_count=profile_count,
                    sample_count=peer_count + 1,
                    spatial_peer_count=peer_count,
                    qc_pass_fraction=1.0,
                    value_mode=value_mode,
                )
            )
    return events


def _value_summary(
    variable_id: str,
    label: str,
    unit: str,
    source: str,
    values: list[float],
    total_count: int,
    modes: list[str],
) -> dict[str, Any]:
    unique_modes = set(modes)
    value_mode = (
        "unavailable"
        if not values
        else "mixed"
        if len(unique_modes) > 1
        else next(iter(unique_modes), "unavailable")
    )
    return {
        "id": variable_id,
        "label": label,
        "unit": unit,
        "source": source,
        "value_mode": value_mode,
        "available_count": len(values),
        "total_count": total_count,
        "availability_fraction": round(len(values) / total_count, 4) if total_count else None,
        "minimum": round(min(values), 3) if values else None,
        "median": round(median(values), 3) if values else None,
        "maximum": round(max(values), 3) if values else None,
    }


def _woa_nitrate_events(region: dict[str, Any], snapshot: dict[str, Any]) -> list[OceanEvent]:
    events: list[OceanEvent] = []
    timestamp = str(snapshot.get("latest_observation_at") or "2022-12-31T00:00:00Z")
    available_count = int(snapshot.get("available_count") or 0)
    for index, point in enumerate(snapshot.get("points") or []):
        longitude = point.get("longitude")
        latitude = point.get("latitude")
        depth = point.get("depth")
        nitrate = point.get("nitrate")
        if not all(
            isinstance(value, (int, float)) and math.isfinite(float(value))
            for value in (longitude, latitude, depth, nitrate)
        ):
            continue
        area_name = _plain_area_name(region, float(latitude), float(longitude))
        event = _make_observation_event(
            event_id=f"OBS-{region['id'].upper()}-WOA23-NITRATE-{index:04d}",
            event_type="biogeochemical_observation",
            title=f"WOA23 · {area_name}：{float(depth):.0f} m 硝酸盐气候态 {float(nitrate):.2f} μmol kg⁻¹",
            summary=(
                f"NOAA WOA23 在 {float(latitude):.2f}°, {float(longitude):.2f}° 的 "
                f"{float(depth):.0f} m 层给出硝酸盐历史气候态 {float(nitrate):.2f} μmol kg⁻¹。"
                "这是 1965-2022 年的一度网格背景场，不代表当日实时观测。"
            ),
            region=region,
            longitude=float(longitude),
            latitude=float(latitude),
            timestamp=timestamp,
            variable="NITRATE",
            observed=float(nitrate),
            minimum=float(nitrate),
            maximum=float(nitrate),
            unit="umol kg-1",
            source="WOA23_NITRATE",
            method="NOAA World Ocean Atlas 2023 nitrate climatology; 1 degree grid, 1965-2022.",
            confidence=0.72,
            observation_count=max(available_count, 1),
            sample_count=1,
            priority=0.28,
            value_mode="derived",
            radius_km=80.0,
        )
        event.data_mode = "cached"
        events.append(event)
    return events


def _woa_salinity_events(region: dict[str, Any], snapshot: dict[str, Any]) -> list[OceanEvent]:
    events: list[OceanEvent] = []
    timestamp = str(snapshot.get("latest_observation_at") or "2020-12-31T00:00:00Z")
    available_count = int(snapshot.get("available_count") or 0)
    for index, point in enumerate(snapshot.get("points") or []):
        try:
            longitude = float(point["longitude"]); latitude = float(point["latitude"]); depth = float(point["depth"]); value = float(point["salinity"])
        except (KeyError, TypeError, ValueError):
            continue
        if not all(math.isfinite(item) for item in (longitude, latitude, depth, value)):
            continue
        area_name = _plain_area_name(region, latitude, longitude)
        event = _make_observation_event(
            event_id=f"OBS-{region['id'].upper()}-WOA23-SALINITY-{index:04d}",
            event_type="hydrographic_observation",
            title=f"WOA23 · {area_name}：{depth:.0f} m 盐度气候态 {value:.2f} PSU",
            summary=f"NOAA WOA23 在 {latitude:.2f}°, {longitude:.2f}° 的 {depth:.0f} m 层给出盐度气候态 {value:.2f} PSU。这是 1991-2020 年的一度网格背景场，不代表当日实时观测。",
            region=region, longitude=longitude, latitude=latitude, timestamp=timestamp,
            variable="SALINITY", observed=value, minimum=value, maximum=value, unit="PSU", source="WOA23_SALINITY",
            method="NOAA World Ocean Atlas 2023 salinity decadal climatology; 1 degree grid, 1991-2020.",
            confidence=0.74, observation_count=max(available_count, 1), sample_count=1, priority=0.29, value_mode="derived", radius_km=80.0,
        )
        event.data_mode = "cached"
        events.append(event)
    return events


def _chlorophyll_observation_events(region: dict[str, Any], snapshot: dict[str, Any]) -> list[OceanEvent]:
    events: list[OceanEvent] = []
    point_count = int(snapshot.get("point_count") or 0)
    points = list(snapshot.get("points") or [])
    if len(points) > NOAA_CHLA_OBSERVATION_EVENT_LIMIT:
        stride = (len(points) - 1) / (NOAA_CHLA_OBSERVATION_EVENT_LIMIT - 1)
        points = [points[round(index * stride)] for index in range(NOAA_CHLA_OBSERVATION_EVENT_LIMIT)]
    for index, point in enumerate(points):
        try:
            timestamp = str(point["timestamp"]); longitude = float(point["longitude"]); latitude = float(point["latitude"]); value = float(point["chlorophyll"])
        except (KeyError, TypeError, ValueError):
            continue
        if not all(math.isfinite(item) for item in (longitude, latitude, value)):
            continue
        area_name = _plain_area_name(region, latitude, longitude)
        event = _make_observation_event(
            event_id=f"OBS-{region['id'].upper()}-VIIRS-CHLA-{index:04d}",
            event_type="biogeochemical_observation",
            title=f"VIIRS · {area_name}叶绿素 a {value:.3f} mg/m³",
            summary=f"{_short_date(timestamp)}，NOAA VIIRS 在{area_name}网格给出叶绿素 a {value:.3f} mg/m³，用于展示海表叶绿素 a 的空间分布。",
            region=region, longitude=longitude, latitude=latitude, timestamp=timestamp,
            variable="CHLA", observed=value, minimum=value, maximum=value, unit="mg m-3", source="NOAA_CHLA_DINEOF",
            method="NOAA VIIRS daily DINEOF chlorophyll-a grid; finite ocean pixels within the regional bounds.",
            confidence=0.84, observation_count=max(point_count, 1), sample_count=1, priority=0.34, value_mode="analysis", radius_km=9.0,
        )
        if snapshot.get("cache", {}).get("state") != "fresh":
            event.data_mode = "cached"
        events.append(event)
    return events


def _current_observation_events(region: dict[str, Any], snapshot: dict[str, Any]) -> list[OceanEvent]:
    events: list[OceanEvent] = []
    point_count = int(snapshot.get("point_count") or 0)
    points = list(snapshot.get("points") or [])
    if len(points) > OBSERVATION_CATEGORY_TARGET:
        stride = (len(points) - 1) / (OBSERVATION_CATEGORY_TARGET - 1)
        points = [points[round(index * stride)] for index in range(OBSERVATION_CATEGORY_TARGET)]
    for index, point in enumerate(points):
        try:
            timestamp = str(point["timestamp"]); longitude = float(point["longitude"]); latitude = float(point["latitude"]); speed = float(point["speed"]); direction = float(point["direction"])
        except (KeyError, TypeError, ValueError):
            continue
        if not all(math.isfinite(item) for item in (longitude, latitude, speed, direction)):
            continue
        area_name = _plain_area_name(region, latitude, longitude)
        common = dict(
            region=region, longitude=longitude, latitude=latitude, timestamp=timestamp,
            variable="CURRENT", observed=speed, minimum=speed, maximum=speed, unit="m s-1", source="NOAA_CURRENTS",
            confidence=0.82, observation_count=max(point_count, 1), sample_count=1, value_mode="analysis", radius_km=25.0,
        )
        current = _make_observation_event(
            event_id=f"OBS-{region['id'].upper()}-CURRENT-{index:04d}", event_type="surface_observation",
            title=f"{area_name}表层流速 {speed:.2f} m/s",
            summary=f"{_short_date(timestamp)}，NOAA 全球逐日表层流场在此网格给出流速 {speed:.2f} m/s、流向 {direction:.0f}°，用于展示局地表层流场。",
            method="NOAA blended daily near-real-time surface current vector; speed derived from u and v components.", priority=0.32, **common,
        )
        if snapshot.get("cache", {}).get("state") != "fresh":
            current.data_mode = "cached"
        events.append(current)
    return events


def _carbon_observation_events(region: dict[str, Any], snapshot: dict[str, Any]) -> list[OceanEvent]:
    events: list[OceanEvent] = []
    available_count = int(snapshot.get("available_count") or 0)
    timestamp = str(snapshot.get("latest_observation_at") or "2024-12-31T12:00:00Z")
    temporal_label = str(snapshot.get("temporal_label") or "海表 CO2 分压背景")
    for index, point in enumerate(snapshot.get("points") or []):
        try:
            longitude = float(point["longitude"]); latitude = float(point["latitude"]); value = float(point["pco2"])
        except (KeyError, TypeError, ValueError):
            continue
        if not all(math.isfinite(item) for item in (longitude, latitude, value)):
            continue
        area_name = _plain_area_name(region, latitude, longitude)
        event = _make_observation_event(
            event_id=f"OBS-{region['id'].upper()}-SPCO2-{index:04d}", event_type="biogeochemical_observation",
            title=f"{area_name}海表 CO2 分压背景 {value:.1f} μatm",
            summary=f"NOAA PMEL {temporal_label}在该一度网格给出海表 CO2 分压 {value:.1f} μatm，用于描述碳循环空间背景。",
            region=region, longitude=longitude, latitude=latitude, timestamp=timestamp,
            variable="PCO2", observed=value, minimum=value, maximum=value, unit="uatm", source="NOAA_SPCO2",
            method="NOAA PMEL SOCAT v2026 quality-controlled surface-ocean fCO2 observations aggregated to the latest 1-degree decadal grid.",
            confidence=0.76, observation_count=max(available_count, 1), sample_count=1, priority=0.30, value_mode="derived", radius_km=80.0,
        )
        event.data_mode = "cached"
        events.append(event)
    return events


def _copernicus_wave_event(
    *,
    region: dict[str, Any],
    point: dict[str, Any],
    index: int,
    variable: str,
    value_key: str,
    direction_key: str,
    period_key: str,
    label: str,
    threshold: float,
    point_count: int,
) -> tuple[OceanEvent | None, OceanEvent | None]:
    try:
        longitude = float(point["longitude"])
        latitude = float(point["latitude"])
        timestamp = str(point["timestamp"])
        value = float(point[value_key])
    except (KeyError, TypeError, ValueError):
        return None, None
    if not all(math.isfinite(item) for item in (longitude, latitude, value)):
        return None, None
    direction = point.get(direction_key)
    period = point.get(period_key)
    direction_text = f"、方向 {float(direction):.0f}°" if isinstance(direction, (int, float)) and math.isfinite(float(direction)) else ""
    period_text = f"、周期 {float(period):.1f} s" if isinstance(period, (int, float)) and math.isfinite(float(period)) else ""
    area_name = _plain_area_name(region, latitude, longitude)
    event_id = f"OBS-{region['id'].upper()}-COP-WAVE-{variable}-{index:02d}"
    observation = _make_observation_event(
        event_id=event_id,
        event_type="surface_observation",
        title=f"{area_name}{label} {value:.2f} m",
        summary=(
            f"{_short_date(timestamp)}，Copernicus Marine 最近模式网格给出{label} {value:.2f} m"
            f"{period_text}{direction_text}。空间分辨率约 0.083°（约 9 km），时间分辨率 3 小时。"
        ),
        region=region,
        longitude=longitude,
        latitude=latitude,
        timestamp=timestamp,
        variable=variable,
        observed=value,
        minimum=value,
        maximum=value,
        unit="m",
        source="COPERNICUS_WAVE",
        method="Copernicus Marine global wave analysis/forecast; nearest 0.083 degree model grid, 3-hour cadence.",
        confidence=0.82,
        observation_count=max(point_count, 1),
        sample_count=1,
        priority=min(0.65, 0.28 + value / max(threshold, 0.1) * 0.18),
        value_mode="analysis",
        radius_km=9.0,
    )
    observation.references = [COPERNICUS_WAVE_REFERENCE]
    observation.sources = ["COPERNICUS_WAVE"]
    observation.evidence[0].source = "Copernicus Marine 全球波浪模式"
    observation.reasoning_chain[0].reference_ids = [COPERNICUS_WAVE_REFERENCE.id]
    observation.reasoning_chain[1].reference_ids = [COPERNICUS_WAVE_REFERENCE.id]

    if value < threshold:
        return observation, None
    severity = min(0.9, 0.5 + (value - threshold) / max(threshold, 0.1) * 0.38)
    anomaly_id = f"SIG-{region['id'].upper()}-COP-WAVE-{variable}-{index:02d}"
    evidence_id = f"{anomaly_id}-E1"
    anomaly = OceanEvent(
        id=anomaly_id,
        type="wave_anomaly",
        event_kind="anomaly",
        title=f"{area_name}{label}偏高候选",
        summary=f"Copernicus Marine 模式网格中的{label}达到 {value:.2f} m，超过自动筛查阈值 {threshold:.1f} m，进入异常候选队列。",
        region=f"{area_name} · {_location(latitude, longitude)}",
        centroid=(longitude, latitude),
        radius_km=90.0,
        radius_basis="screening_search",
        started_at=timestamp,
        status="watch",
        severity=round(severity, 3),
        severity_label=_severity_label(severity),
        confidence=0.66,
        affected_area_km2=None,
        variables=[variable],
        sources=["COPERNICUS_WAVE"],
        references=[COPERNICUS_WAVE_REFERENCE],
        evidence=[Evidence(
            id=evidence_id,
            source="Copernicus Marine 全球波浪模式",
            variable=variable,
            observed=round(value, 3),
            baseline=threshold,
            anomaly=round(value - threshold, 3),
            unit="m",
            timestamp=timestamp,
            method=f"绝对阈值筛查：{label} ≥ {threshold:.1f} m；模式网格约 9 km，3 小时时间分辨率。",
            confidence=0.66,
            series=[DataPoint(timestamp=timestamp, value=round(value, 3), baseline=threshold)],
            sample_count=1,
            temporal_span_hours=0.0,
            value_mode="analysis",
            validation_state="screening",
        )],
        reasoning_chain=[ReasoningStep(
            order=1,
            claim=f"{label}高出筛查阈值 {value - threshold:.2f} m。",
            mechanism="当前仅依据单一模式网格和绝对阈值识别，需要后续时次持续性及浮标或其他来源交叉复核。",
            evidence_ids=[evidence_id],
            reference_ids=[COPERNICUS_WAVE_REFERENCE.id],
            confidence=0.66,
        )],
        timeline=[TimelineItem(timestamp=timestamp, label="进入高海况异常候选队列", state="detected")],
        potential_impacts=["海上航行与作业风险上升", "浮标和沿海设施受浪载荷增强"],
        uncertainty="这是约 9 km 模式网格的自动筛查结果，不是浮标原位实测，也不是台风官方预警。",
        region_id=region["id"],
        data_mode="live",
        validation_state="screening",
        observation_count=max(point_count, 1),
        source_updated_at=timestamp,
    )
    return observation, anomaly


def _copernicus_wave_events(region: dict[str, Any], snapshot: dict[str, Any]) -> tuple[list[OceanEvent], list[OceanEvent]]:
    observations: list[OceanEvent] = []
    anomalies: list[OceanEvent] = []
    point_count = int(snapshot.get("point_count") or 0)
    definitions = (
        ("WAVE_HEIGHT", "VHM0", "VMDR", "VTM02", "有效波高", 4.0),
        ("SWELL_HEIGHT", "VHM0_SW1", "VMDR_SW1", "VTM01_SW1", "一级涌浪波高", 3.0),
        ("WIND_WAVE_HEIGHT", "VHM0_WW", "VMDR_WW", "VTM01_WW", "风浪波高", 3.0),
    )
    for index, point in enumerate(snapshot.get("points") or []):
        for definition in definitions:
            observation, anomaly = _copernicus_wave_event(
                region=region,
                point=point,
                index=index,
                variable=definition[0],
                value_key=definition[1],
                direction_key=definition[2],
                period_key=definition[3],
                label=definition[4],
                threshold=definition[5],
                point_count=point_count,
            )
            if observation:
                observations.append(observation)
            if anomaly:
                anomalies.append(anomaly)
    if snapshot.get("cache", {}).get("state") != "fresh":
        for event in [*observations, *anomalies]:
            event.data_mode = "cached"
    return observations, anomalies


def _copernicus_wind_events(
    region: dict[str, Any],
    snapshot: dict[str, Any],
    wave_snapshot: dict[str, Any] | None,
) -> tuple[list[OceanEvent], list[OceanEvent], list[OceanEvent]]:
    observations: list[OceanEvent] = []
    anomalies: list[OceanEvent] = []
    typhoon_risks: list[OceanEvent] = []
    point_count = int(snapshot.get("point_count") or 0)
    wave_points = list((wave_snapshot or {}).get("points") or [])
    for index, point in enumerate(snapshot.get("points") or []):
        try:
            longitude = float(point["longitude"])
            latitude = float(point["latitude"])
            timestamp = str(point["timestamp"])
            speed = float(point["wind_speed"])
            direction = float(point["wind_direction_from"])
        except (KeyError, TypeError, ValueError):
            continue
        if not all(math.isfinite(item) for item in (longitude, latitude, speed, direction)):
            continue
        area_name = _plain_area_name(region, latitude, longitude)
        observation = _make_observation_event(
            event_id=f"OBS-{region['id'].upper()}-COP-WIND-{index:02d}",
            event_type="surface_observation",
            title=f"{area_name}海面风速 {speed:.1f} m/s",
            summary=(
                f"{_short_date(timestamp)}，Copernicus Marine 海面风场给出风速 {speed:.2f} m/s、"
                f"来向 {direction:.0f}°。空间分辨率 0.125°（约 14 km），时间分辨率 1 小时。"
            ),
            region=region,
            longitude=longitude,
            latitude=latitude,
            timestamp=timestamp,
            variable="WIND_SPEED",
            observed=speed,
            minimum=speed,
            maximum=speed,
            unit="m s-1",
            source="COPERNICUS_WIND",
            method="Copernicus Marine L4 hourly sea-surface wind; speed derived from eastward and northward components, direction reported as meteorological from-direction.",
            confidence=0.84,
            observation_count=max(point_count, 1),
            sample_count=1,
            priority=min(0.68, 0.28 + speed / 25.0 * 0.35),
            value_mode="analysis",
            radius_km=14.0,
        )
        observations.append(observation)

        if speed >= 13.9:
            severity = min(0.9, 0.54 + (speed - 13.9) / 18.0 * 0.36)
            event_id = f"SIG-{region['id'].upper()}-COP-WIND-{index:02d}"
            evidence_id = f"{event_id}-E1"
            anomalies.append(OceanEvent(
                id=event_id,
                type="wind_anomaly",
                event_kind="anomaly",
                title=f"{area_name}强风异常候选",
                summary=f"海面风速达到 {speed:.1f} m/s、来向 {direction:.0f}°，超过强风自动筛查阈值 13.9 m/s。",
                region=f"{area_name} · {_location(latitude, longitude)}",
                centroid=(longitude, latitude),
                radius_km=100.0,
                radius_basis="screening_search",
                started_at=timestamp,
                status="watch",
                severity=round(severity, 3),
                severity_label=_severity_label(severity),
                confidence=0.68,
                affected_area_km2=None,
                variables=["WIND_SPEED", "WIND_DIRECTION"],
                sources=["COPERNICUS_WIND"],
                references=[COPERNICUS_WIND_REFERENCE],
                evidence=[Evidence(
                    id=evidence_id,
                    source="Copernicus Marine 全球海面风场",
                    variable="WIND_SPEED",
                    observed=round(speed, 3),
                    baseline=13.9,
                    anomaly=round(speed - 13.9, 3),
                    unit="m s-1",
                    timestamp=timestamp,
                    method="海面风速绝对阈值筛查；0.125° 网格，小时级资料。",
                    confidence=0.68,
                    series=[DataPoint(timestamp=timestamp, value=round(speed, 3), baseline=13.9)],
                    sample_count=1,
                    value_mode="analysis",
                    validation_state="screening",
                )],
                reasoning_chain=[ReasoningStep(
                    order=1,
                    claim=f"海面风速超过强风筛查阈值 {speed - 13.9:.1f} m/s。",
                    mechanism="单时次模式分析先进入异常候选，等待连续时次和独立来源复核。",
                    evidence_ids=[evidence_id],
                    reference_ids=[COPERNICUS_WIND_REFERENCE.id],
                    confidence=0.68,
                )],
                timeline=[TimelineItem(timestamp=timestamp, label="进入强风异常候选队列", state="detected")],
                potential_impacts=["海上航行和甲板作业风险上升", "风浪快速发展概率增加"],
                uncertainty="风场为约 14 km 模式融合网格，不等同于现场风速仪观测。",
                region_id=region["id"],
                data_mode="live",
                validation_state="screening",
                observation_count=max(point_count, 1),
                source_updated_at=timestamp,
            ))

        nearby_wave = min(
            wave_points,
            key=lambda wave: _haversine_km(longitude, latitude, float(wave["longitude"]), float(wave["latitude"])),
            default=None,
        )
        wave_height = float(nearby_wave.get("VHM0") or 0.0) if nearby_wave else 0.0
        wave_distance = (
            _haversine_km(longitude, latitude, float(nearby_wave["longitude"]), float(nearby_wave["latitude"]))
            if nearby_wave else math.inf
        )
        if speed >= 17.2 and wave_height >= 4.0 and wave_distance <= 250:
            event_id = f"SIG-{region['id'].upper()}-COP-TYPHOON-RISK-{index:02d}"
            wind_evidence_id = f"{event_id}-E1"
            wave_evidence_id = f"{event_id}-E2"
            severity = min(0.94, 0.68 + (speed - 17.2) / 20.0 * 0.16 + (wave_height - 4.0) / 8.0 * 0.10)
            typhoon_risks.append(OceanEvent(
                id=event_id,
                type="typhoon_warning",
                event_kind="anomaly",
                title=f"{area_name}台风影响风险候选",
                summary=f"同一海域同时出现 {speed:.1f} m/s 强风与 {wave_height:.1f} m 高浪，系统将其标记为台风或强风暴影响风险候选。",
                region=f"{area_name} · {_location(latitude, longitude)}",
                centroid=(longitude, latitude),
                radius_km=180.0,
                radius_basis="screening_search",
                started_at=timestamp,
                status="watch",
                severity=round(severity, 3),
                severity_label=_severity_label(severity),
                confidence=0.70,
                affected_area_km2=None,
                variables=["TYPHOON", "WIND_SPEED", "WAVE_HEIGHT"],
                sources=["COPERNICUS_WIND", "COPERNICUS_WAVE"],
                references=[COPERNICUS_WIND_REFERENCE, COPERNICUS_WAVE_REFERENCE],
                evidence=[
                    Evidence(id=wind_evidence_id, source="Copernicus Marine 全球海面风场", variable="WIND_SPEED", observed=round(speed, 3), baseline=17.2, anomaly=round(speed - 17.2, 3), unit="m s-1", timestamp=timestamp, method="强风与高浪联合风险筛查。", confidence=0.70, series=[DataPoint(timestamp=timestamp, value=round(speed, 3), baseline=17.2)], sample_count=1, value_mode="analysis", validation_state="screening"),
                    Evidence(id=wave_evidence_id, source="Copernicus Marine 全球波浪模式", variable="WAVE_HEIGHT", observed=round(wave_height, 3), baseline=4.0, anomaly=round(wave_height - 4.0, 3), unit="m", timestamp=str(nearby_wave["timestamp"]), method="强风与高浪联合风险筛查。", confidence=0.70, series=[DataPoint(timestamp=str(nearby_wave["timestamp"]), value=round(wave_height, 3), baseline=4.0)], sample_count=1, value_mode="analysis", validation_state="screening"),
                ],
                reasoning_chain=[ReasoningStep(order=1, claim="强风和高浪在相邻模式网格同时达到风险阈值。", mechanism="联合条件比单一风速或波高更适合识别热带气旋或强风暴海况，但不能替代官方台风定位与预警。", evidence_ids=[wind_evidence_id, wave_evidence_id], reference_ids=[COPERNICUS_WIND_REFERENCE.id, COPERNICUS_WAVE_REFERENCE.id], confidence=0.70)],
                timeline=[TimelineItem(timestamp=timestamp, label="进入台风影响风险候选队列", state="detected")],
                potential_impacts=["船舶避险需求上升", "近海作业和沿岸设施面临强风高浪复合风险"],
                uncertainty="这是自动风险候选，不是气象机构发布的台风预警；需结合官方台风路径、中心气压和最大风速复核。",
                region_id=region["id"],
                data_mode="live",
                validation_state="screening",
                observation_count=max(point_count, 1),
                source_updated_at=timestamp,
            ))
    if snapshot.get("cache", {}).get("state") != "fresh":
        for event in [*observations, *anomalies, *typhoon_risks]:
            event.data_mode = "cached"
    return observations, anomalies, typhoon_risks


def _observation_filter_coverage(events: list[OceanEvent]) -> dict[str, int]:
    """Count neutral observations available to each variable filter.

    A measurement can support more than one variable view, but its event type,
    title, and scientific meaning are never rewritten to satisfy a UI count.
    """
    filter_variables: dict[str, set[str]] = {
        "carbon": {"PCO2", "DIC"},
        "current": {"CURRENT"},
        "salinity": {"SALINITY"},
        "nutrient": {"NITRATE"},
        "chlorophyll": {"CHLA"},
        "surface_temperature": {"SST", "TEMPERATURE"},
    }
    return {
        filter_name: sum(
            event.event_kind == "observation"
            and event.validation_state == "observed"
            and bool(variables.intersection(event.variables))
            for event in events
        )
        for filter_name, variables in filter_variables.items()
    }


def _regional_observation_summary(
    region: dict[str, Any],
    argo_region: dict[str, Any] | None,
    samples: list[dict[str, Any]],
    profile_failures: int,
    noaa_result: dict[str, Any] | None,
    observation_count: int,
    source_count: int,
    screening_event_count: int,
) -> dict[str, Any]:
    argo_variables = {
        "TEMPERATURE": ("temperature", "温度", "°C"),
        "SALINITY": ("salinity", "盐度", "PSU"),
        "CHLA": ("chla", "叶绿素 a", "mg m⁻³"),
        "NITRATE": ("nitrate", "硝酸盐", "μmol kg⁻¹"),
    }
    variables: list[dict[str, Any]] = []
    adjusted_surfaces = 0
    mode_surfaces = 0
    for variable_id, (key, label, unit) in argo_variables.items():
        values: list[float] = []
        modes: list[str] = []
        total_count = 0
        for snapshot in samples:
            latest = snapshot.get("latest") or {}
            if variable_id in {"TEMPERATURE", "SALINITY", "CHLA", "NITRATE"} and latest.get("points"):
                point_records = [
                    point
                    for point in latest.get("points") or []
                    if isinstance(point.get(key), (int, float))
                    and math.isfinite(float(point[key]))
                ]
                total_count += len(point_records)
                for point in point_records:
                    qc = point.get(f"{key}_qc")
                    mode = point.get(f"{key}_mode")
                    if qc in (1, 1.0, 2, 2.0) and mode in {"raw", "adjusted"}:
                        values.append(float(point[key]))
                        modes.append(mode)
                continue
            total_count += 1
            surface = latest.get("surface") or {}
            value = surface.get(key)
            qc = surface.get(f"{key}_qc")
            mode = (latest.get("surface_modes") or {}).get(key)
            if (
                isinstance(value, (int, float))
                and math.isfinite(float(value))
                and qc in (1, 1.0, 2, 2.0)
                and mode in {"raw", "adjusted"}
            ):
                values.append(float(value))
                modes.append(mode)
                mode_surfaces += 1
                adjusted_surfaces += mode == "adjusted"
        variables.append(
            _value_summary(variable_id, label, unit, "Argo 剖面抽样", values, len(samples), modes)
        )

        variables[-1]["total_count"] = total_count
        variables[-1]["availability_fraction"] = (
            round(len(values) / total_count, 4) if total_count else None
        )

    sst_timeline: list[dict[str, Any]] = []
    sst_values: list[float] = []
    sst_latest_points: list[dict[str, Any]] = []
    sst_total = 0
    if noaa_result:
        latest_timestamp = noaa_result.get("latest_observation_at")
        dedicated_latest_points = noaa_result.get("latest_points") or []
        for point in dedicated_latest_points:
            if (
                point.get("timestamp") == latest_timestamp
                and isinstance(point.get("latitude"), (int, float))
                and isinstance(point.get("longitude"), (int, float))
                and isinstance(point.get("temperature"), (int, float))
            ):
                sst_latest_points.append(
                    {
                        key: point.get(key)
                        for key in (
                            "timestamp",
                            "latitude",
                            "longitude",
                            "temperature",
                            "analysis_error",
                            "sea_ice_fraction",
                            "quality_valid",
                        )
                    }
                )
                if point.get("quality_valid") is True:
                    sst_values.append(float(point["temperature"]))
        by_timestamp: dict[str, list[float]] = {}
        for point in noaa_result.get("points", []):
            value = point.get("temperature")
            timestamp = point.get("timestamp")
            if not isinstance(timestamp, str) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
                continue
            if (
                not dedicated_latest_points
                and timestamp == latest_timestamp
                and isinstance(point.get("latitude"), (int, float))
                and isinstance(point.get("longitude"), (int, float))
            ):
                sst_latest_points.append(
                    {
                        key: point.get(key)
                        for key in (
                            "timestamp",
                            "latitude",
                            "longitude",
                            "temperature",
                            "analysis_error",
                            "sea_ice_fraction",
                            "quality_valid",
                        )
                    }
                )
            if point.get("quality_valid") is not True:
                continue
            by_timestamp.setdefault(timestamp, []).append(float(value))
            if timestamp == latest_timestamp and not dedicated_latest_points:
                sst_values.append(float(value))
        if dedicated_latest_points and isinstance(latest_timestamp, str):
            by_timestamp[latest_timestamp] = sst_values
        for timestamp, values in sorted(by_timestamp.items(), key=lambda item: _parse_timestamp(item[0]) or datetime.min.replace(tzinfo=UTC)):
            sst_timeline.append(
                {
                    "timestamp": timestamp,
                    "minimum": round(min(values), 3),
                    "median": round(median(values), 3),
                    "maximum": round(max(values), 3),
                    "sample_count": len(values),
                }
            )
        sst_total = int(noaa_result.get("latest_point_count") or 0)
    variables.insert(
        0,
        _value_summary("SST", "海表温度", "°C", "NOAA 融合格点", sst_values, sst_total, ["analysis"] * len(sst_values)),
    )

    profile_depths = [
        float(snapshot["latest"]["max_pressure"])
        for snapshot in samples
        if isinstance((snapshot.get("latest") or {}).get("max_pressure"), (int, float))
        and math.isfinite(float(snapshot["latest"]["max_pressure"]))
        and float(snapshot["latest"]["max_pressure"]) >= 0
    ]
    latest_candidates = [
        value
        for value in (
            (argo_region or {}).get("latest_observation_at"),
            (noaa_result or {}).get("latest_observation_at"),
        )
        if _parse_timestamp(value) is not None
    ]
    profile_attempts = len(samples) + profile_failures
    noaa_points = int((noaa_result or {}).get("point_count") or 0)
    noaa_valid = int((noaa_result or {}).get("quality_valid_count") or 0)
    noaa_quality_fraction = round(noaa_valid / noaa_points, 4) if noaa_points else None
    profile_success_fraction = round(len(samples) / profile_attempts, 4) if profile_attempts else None
    adjusted_surface_fraction = round(adjusted_surfaces / mode_surfaces, 4) if mode_surfaces else None
    variable_by_id = {item["id"]: item for item in variables}
    if screening_event_count > 0:
        conclusion_state = "candidate_present"
        conclusion_headline = f"本轮发现 {screening_event_count} 个实时异常候选，已进入证据复核"
    else:
        conclusion_state = "no_candidate"
        conclusion_headline = "本轮实时筛查未触发异常候选"

    conclusion_evidence: list[str] = []
    if len(sst_timeline) >= 2:
        first_sst = sst_timeline[0]
        latest_sst = sst_timeline[-1]
        delta = latest_sst["median"] - first_sst["median"]
        conclusion_evidence.append(
            f"NOAA {len(sst_timeline)} 个日时次的区域格点中位数由 {first_sst['median']:.2f} °C 变为 "
            f"{latest_sst['median']:.2f} °C，窗口变化 {delta:+.2f} °C；最新格点范围为 "
            f"{latest_sst['minimum']:.2f}–{latest_sst['maximum']:.2f} °C。"
        )
    if noaa_points:
        conclusion_evidence.append(
            f"NOAA 有 {noaa_valid}/{noaa_points} 条记录通过分析误差、水体掩膜和海冰过滤，"
            f"质量通过率为 {(noaa_quality_fraction or 0) * 100:.0f}%。"
        )
    temperature_summary = variable_by_id["TEMPERATURE"]
    salinity_summary = variable_by_id["SALINITY"]
    conclusion_evidence.append(
        f"抽样完整剖面中，温度有效 {temperature_summary['available_count']}/{temperature_summary['total_count']}，"
        f"盐度有效 {salinity_summary['available_count']}/{salinity_summary['total_count']}；"
        f"典型最大压力为 {median(profile_depths):.0f} dbar。"
        if profile_depths
        else "本轮 Argo 温盐剖面有效样本数为 0。"
    )
    chla_summary = variable_by_id["CHLA"]
    nitrate_summary = variable_by_id["NITRATE"]
    conclusion_evidence.append(
        f"生地化抽样覆盖为叶绿素 {chla_summary['available_count']}/{chla_summary['total_count']}、"
        f"硝酸盐 {nitrate_summary['available_count']}/{nitrate_summary['total_count']}；"
        f"区域活动 BGC 浮标 {int((argo_region or {}).get('bgc_float_count') or 0)}/"
        f"{int((argo_region or {}).get('float_count') or 0)}。"
    )
    interpretation_scope = [
        "SST 区域范围跨越明显纬度梯度，最小值与最大值描述空间分布，不等同于相对气候态的异常幅度。",
        f"Argo 变量统计口径为本轮抽样的 {len(samples)} 个完整剖面；区域活动浮标总数作为观测网络背景展示。",
        "实时异常候选与长期气候事件分层判读；海洋热浪或冷事件归入长期气候诊断。",
    ]
    if adjusted_surface_fraction is not None and adjusted_surface_fraction < 0.5:
        interpretation_scope.append(
            f"近表层有效抽样中，调整值占比为 {adjusted_surface_fraction * 100:.0f}%；其余数值按 QC 通过的实时原始值标示。"
        )
    if chla_summary["availability_fraction"] is None or chla_summary["availability_fraction"] < 0.5:
        interpretation_scope.append("叶绿素与硝酸盐按实际传感器记录展示，判读范围限定在对应剖面及子海域。")
    screening_rules = [
        "同一格点连续时次保持同方向并通过 3σ 门槛时，进入 NOAA 实时候选队列。",
        "候选筛查与事件确认分层显示；气候百分位、独立卫星、再分析和人工审核归入确认层。",
    ]
    if chla_summary["available_count"] > 0 or nitrate_summary["available_count"] > 0:
        screening_rules.append("BGC 变量仅在通过质量标识的传感器实测剖面内参与筛查。")
    return {
        "region_id": region["id"],
        "region": region["name"],
        "generated_at": datetime.now(UTC).isoformat(),
        "bounds": region["bounds"],
        "observation_count": observation_count,
        "source_count": source_count,
        "argo_profile_count": int((argo_region or {}).get("profile_count") or 0),
        "float_count": int((argo_region or {}).get("float_count") or 0),
        "bgc_float_count": int((argo_region or {}).get("bgc_float_count") or 0),
        "sampled_profile_count": len(samples),
        "profile_request_failures": profile_failures,
        "profile_success_fraction": profile_success_fraction,
        "median_profile_depth": round(median(profile_depths), 1) if profile_depths else None,
        "maximum_profile_depth": round(max(profile_depths), 1) if profile_depths else None,
        "sst_lookback_days": int((noaa_result or {}).get("lookback_days") or 0),
        "sst_daily_steps": int((noaa_result or {}).get("time_count") or 0),
        "sst_latest_grid_count": int((noaa_result or {}).get("latest_point_count") or 0),
        "sst_latest_points": sst_latest_points,
        "sst_native_resolution_degrees": float((noaa_result or {}).get("native_resolution_degrees") or 0.05),
        "sst_latitude_step_degrees": (noaa_result or {}).get("latitude_step_degrees"),
        "sst_longitude_step_degrees": (noaa_result or {}).get("longitude_step_degrees"),
        "noaa_quality_valid_count": noaa_valid,
        "noaa_point_count": noaa_points,
        "noaa_quality_pass_fraction": noaa_quality_fraction,
        "quality_fields_complete": bool((noaa_result or {}).get("quality_fields_complete")),
        "adjusted_surface_fraction": adjusted_surface_fraction,
        "latest_observation_at": max(latest_candidates, key=lambda value: _parse_timestamp(value) or datetime.min.replace(tzinfo=UTC)) if latest_candidates else None,
        "screening_event_count": screening_event_count,
        "variables": variables,
        "sst_timeline": sst_timeline,
        "conclusion": {
            "state": conclusion_state,
            "headline": conclusion_headline,
            "summary": (
                "结论综合 NOAA 多日格点、产品质量、Argo 温盐剖面、BGC 实测变量和数据模式，"
                "直接报告当前实时筛查的候选队列状态。"
            ),
            "evidence": conclusion_evidence,
            "interpretation_scope": interpretation_scope,
            "screening_rules": screening_rules,
        },
    }


def _build_bundle(region_id: str, force_refresh: bool) -> dict[str, Any]:
    region = get_region(region_id)
    copernicus_bounds = GLOBAL_COPERNICUS_INITIAL_BOUNDS if region["id"] == "global_ocean" else region["bounds"]
    copernicus_region_key = "global_ocean_china_initial" if region["id"] == "global_ocean" else region["id"]
    argo_result: tuple[dict[str, Any], list[dict[str, Any]], int] | None = None
    noaa_result: dict[str, Any] | None = None
    chlorophyll_result: dict[str, Any] | None = None
    chlorophyll_observations: dict[str, Any] | None = None
    currents_result: dict[str, Any] | None = None
    copernicus_wave_result: dict[str, Any] | None = None
    copernicus_wind_result: dict[str, Any] | None = None
    carbon_result: dict[str, Any] | None = None
    woa_nitrate_result: dict[str, Any] | None = None
    woa_salinity_result: dict[str, Any] | None = None
    errors: list[str] = []

    with ThreadPoolExecutor(max_workers=8) as executor:
        argo_future = executor.submit(
            get_argo_region_samples,
            region_id=region["id"],
            bounds=region["bounds"],
            region_name=region["name"],
            sample_limit=REALTIME_PROFILE_SAMPLE_LIMIT,
            force_refresh=force_refresh,
        )
        noaa_future = executor.submit(get_noaa_sst, region["id"], region["bounds"], force_refresh=force_refresh)
        chlorophyll_future = executor.submit(
            get_noaa_chlorophyll_anomaly,
            region["id"],
            region["bounds"],
            force_refresh=force_refresh,
        )
        chlorophyll_observations_future = executor.submit(
            get_noaa_chlorophyll_observations,
            region["id"],
            region["bounds"],
            force_refresh=force_refresh,
        )
        currents_future = executor.submit(
            get_noaa_currents,
            region["id"],
            region["bounds"],
            force_refresh=force_refresh,
        )
        carbon_future = executor.submit(get_noaa_carbon, region["bounds"], limit=OBSERVATION_CATEGORY_TARGET)
        copernicus_wave_future = executor.submit(
            get_wave_region,
            copernicus_region_key,
            copernicus_bounds,
            force_refresh=force_refresh,
        )
        copernicus_wind_future = executor.submit(
            get_wind_region,
            copernicus_region_key,
            copernicus_bounds,
            force_refresh=force_refresh,
        )
        try:
            argo_result = argo_future.result()
        except ArgoDataError as error:
            errors.append(str(error))
        try:
            noaa_result = noaa_future.result()
        except NoaaDataError as error:
            errors.append(str(error))
        try:
            chlorophyll_result = chlorophyll_future.result()
        except NoaaOceanColorError as error:
            errors.append(str(error))
        try:
            chlorophyll_observations = chlorophyll_observations_future.result()
        except NoaaOceanColorError as error:
            errors.append(str(error))
        try:
            currents_result = currents_future.result()
        except NoaaCurrentsError as error:
            errors.append(str(error))
        try:
            carbon_result = carbon_future.result()
        except NoaaCarbonError as error:
            errors.append(str(error))
        try:
            copernicus_wave_result = copernicus_wave_future.result()
        except CopernicusMarineError as error:
            errors.append(str(error))
        try:
            copernicus_wind_result = copernicus_wind_future.result()
        except CopernicusMarineError as error:
            errors.append(str(error))

    events: list[OceanEvent] = []
    screening_event_count = 0
    source_health: list[dict[str, Any]] = []
    observation_count = 0
    argo_region = None
    samples: list[dict[str, Any]] = []
    failures = 0
    sampled_bgc_profile_count = 0
    if argo_result:
        argo_region, samples, failures = argo_result
        sampled_bgc_profile_count = sum(
            1
            for sample in samples
            if any(
                (sample.get("latest", {}).get("surface", {}).get(variable) is not None)
                for variable in ("chla", "nitrate")
            )
        )
        observation_count += argo_region["profile_count"]
        state = argo_region["cache"]["state"]
        argo_events = _argo_events(region, samples, argo_region["profile_count"])
        screening_event_count += len(argo_events)
        observation_events = _argo_observation_events(region, samples, argo_region["profile_count"])
        if state != "fresh":
            for event in [*argo_events, *observation_events]:
                event.data_mode = "cached"
        events.extend([*argo_events, *observation_events])
        source_health.extend(
            [
                {
                    "id": "argo_core",
                    "name": "Argo Core 全球剖面网",
                    "category": "in_situ",
                    "status": "live" if state == "fresh" else "cached",
                    "observation_count": argo_region["profile_count"],
                    "latest_observation_at": argo_region["latest_observation_at"],
                    "checked_at": datetime.now(UTC).isoformat(),
                    "detail": (
                        f"已接入时间窗内全部 {argo_region['profile_count']} 个剖面点位，"
                        f"覆盖 {argo_region['float_count']} 个活跃浮标；"
                        f"其中 {len(samples)} 个最新完整剖面进入多变量分析，{failures} 个剖面请求失败。"
                    ),
                    "url": argo_region["source"]["url"],
                },
                {
                    "id": "bgc_argo",
                    "name": "BGC-Argo 生物地球化学网",
                    "category": "in_situ",
                    "status": "live" if state == "fresh" else "cached",
                    "observation_count": argo_region["bgc_float_count"],
                    "latest_observation_at": argo_region["latest_observation_at"],
                    "checked_at": datetime.now(UTC).isoformat(),
                    "detail": f"当前海域识别 {argo_region['bgc_float_count']} 个 BGC 活跃浮标。",
                    "url": argo_region["source"]["gdac_url"],
                },
            ]
        )
    if noaa_result:
        observation_count += noaa_result["point_count"]
        sst_events = _sst_events(region, noaa_result)
        screening_event_count += len(sst_events)
        observation_events = _sst_observation_events(region, noaa_result)
        if noaa_result["cache"]["state"] != "fresh":
            for event in [*sst_events, *observation_events]:
                event.data_mode = "cached"
        events.extend([*sst_events, *observation_events])
        source_health.append(
            {
                "id": "noaa_sst",
                "name": "NOAA 全球逐日融合海温",
                "category": "satellite",
                "status": "live" if noaa_result["cache"]["state"] == "fresh" else "cached",
                "observation_count": noaa_result["point_count"],
                "latest_observation_at": noaa_result["latest_observation_at"],
                "checked_at": datetime.now(UTC).isoformat(),
                "detail": (
                    f"当前海域读取 {noaa_result['time_count']} 个日时次、{noaa_result['point_count']} 条 SST 网格记录；"
                    f"其中 {noaa_result['quality_valid_count']} 条通过误差、水体与海冰过滤，"
                    f"最新时次包含 {noaa_result['latest_point_count']} 个网格点。"
                ),
                "url": noaa_result["source"]["dataset_url"],
            }
        )

    if chlorophyll_result:
        observation_count += int(chlorophyll_result.get("point_count") or 0)
        chlorophyll_events = _chlorophyll_events(region, chlorophyll_result)
        screening_event_count += len(chlorophyll_events)
        chlorophyll_latest = _parse_timestamp(chlorophyll_result.get("latest_observation_at"))
        chlorophyll_age_hours = max(0.0, (datetime.now(UTC) - chlorophyll_latest).total_seconds() / 3600) if chlorophyll_latest else math.inf
        chlorophyll_is_current = chlorophyll_age_hours <= 72
        if chlorophyll_result["cache"]["state"] != "fresh" or not chlorophyll_is_current:
            for event in chlorophyll_events:
                event.data_mode = "cached"
        events.extend(chlorophyll_events)
        source_health.append({
            "id": "noaa_chlorophyll", "name": "NOAA VIIRS 叶绿素 a 日异常", "category": "satellite",
            "status": "live" if chlorophyll_result["cache"]["state"] == "fresh" and chlorophyll_is_current else "cached",
            "observation_count": chlorophyll_result["point_count"], "latest_observation_at": chlorophyll_result["latest_observation_at"],
            "checked_at": datetime.now(UTC).isoformat(), "detail": "逐日叶绿素差值仅用于异常候选筛查。", "url": chlorophyll_result["source"]["dataset_url"],
        })

    if chlorophyll_observations:
        chla_observation_events = _chlorophyll_observation_events(region, chlorophyll_observations)
        events.extend(chla_observation_events)
        observation_count += int(chlorophyll_observations.get("point_count") or len(chla_observation_events))
        source_health.append({
            "id": "noaa_chlorophyll_observations", "name": "NOAA VIIRS 逐日叶绿素 a", "category": "satellite",
            "status": "live" if chlorophyll_observations.get("cache", {}).get("state") == "fresh" else "cached",
            "observation_count": int(chlorophyll_observations.get("point_count") or 0), "latest_observation_at": chlorophyll_observations.get("latest_observation_at"),
            "checked_at": datetime.now(UTC).isoformat(), "detail": f"展示 {len(chla_observation_events)} 个卫星叶绿素 a 网格；普通观测与异常候选分开标注。", "url": (chlorophyll_observations.get("source") or {}).get("dataset_url"),
        })

    if currents_result:
        current_events = _current_observation_events(region, currents_result)
        events.extend(current_events)
        observation_count += int(currents_result.get("point_count") or len(current_events) // 2)
        source_health.append({
            "id": "noaa_surface_currents", "name": "NOAA 全球逐日表层流场", "category": "satellite",
            "status": "live" if currents_result.get("cache", {}).get("state") == "fresh" else "cached",
            "observation_count": int(currents_result.get("point_count") or 0), "latest_observation_at": currents_result.get("latest_observation_at"),
            "checked_at": datetime.now(UTC).isoformat(), "detail": f"接入 {int(currents_result.get('point_count') or 0)} 个表层流速矢量，用于展示局地流速和流向。", "url": (currents_result.get("source") or {}).get("dataset_url"),
        })

    if carbon_result:
        carbon_events = _carbon_observation_events(region, carbon_result)
        events.extend(carbon_events)
        observation_count += int(carbon_result.get("available_count") or len(carbon_events))
        source_health.append({
            "id": "noaa_spco2", "name": "NOAA PMEL SOCAT 海表 CO2", "category": "reanalysis", "status": "cached",
            "observation_count": int(carbon_result.get("available_count") or len(carbon_events)), "latest_observation_at": carbon_result.get("latest_observation_at"),
            "checked_at": datetime.now(UTC).isoformat(), "detail": f"展示 {len(carbon_events)} 个一度网格 CO2 分压背景点；不作为当日异常结论。", "url": (carbon_result.get("source") or {}).get("dataset_url"),
        })

    if copernicus_wave_result:
        append_region_snapshot("wave", copernicus_wave_result)
        wave_observations, wave_anomalies = _copernicus_wave_events(region, copernicus_wave_result)
        events.extend([*wave_anomalies, *wave_observations])
        screening_event_count += len(wave_anomalies)
        observation_count += int(copernicus_wave_result.get("point_count") or 0)
        source_health.append({
            "id": "copernicus_wave",
            "name": "Copernicus Marine 全球波浪分析预报",
            "category": "reanalysis",
            "status": "live" if copernicus_wave_result.get("cache", {}).get("state") == "fresh" else "cached",
            "observation_count": int(copernicus_wave_result.get("point_count") or 0),
            "latest_observation_at": copernicus_wave_result.get("latest_observation_at"),
            "checked_at": datetime.now(UTC).isoformat(),
            "detail": f"最新时次包含 {int(copernicus_wave_result.get('point_count') or 0)} 个有效海况网格点；事件队列展示 {len(wave_observations)} 条均匀抽样的总浪、一级涌浪和风浪记录，识别 {len(wave_anomalies)} 条高海况异常候选。每 15 分钟检查，空间约 9 km、时间 3 小时。",
            "url": (copernicus_wave_result.get("source") or {}).get("dataset_url"),
        })

    if copernicus_wind_result:
        append_region_snapshot("wind", copernicus_wind_result)
        wind_observations, wind_anomalies, typhoon_risks = _copernicus_wind_events(
            region,
            copernicus_wind_result,
            copernicus_wave_result,
        )
        events.extend([*typhoon_risks, *wind_anomalies, *wind_observations])
        screening_event_count += len(wind_anomalies) + len(typhoon_risks)
        observation_count += int(copernicus_wind_result.get("point_count") or 0)
        source_health.append({
            "id": "copernicus_wind",
            "name": "Copernicus Marine 全球小时级海面风场",
            "category": "reanalysis",
            "status": "live" if copernicus_wind_result.get("cache", {}).get("state") == "fresh" else "cached",
            "observation_count": int(copernicus_wind_result.get("point_count") or 0),
            "latest_observation_at": copernicus_wind_result.get("latest_observation_at"),
            "checked_at": datetime.now(UTC).isoformat(),
            "detail": f"最新时次包含 {int(copernicus_wind_result.get('point_count') or 0)} 个有效风场网格点；事件队列展示 {len(wind_observations)} 条均匀抽样的风速与风向记录，识别 {len(wind_anomalies)} 条强风异常和 {len(typhoon_risks)} 条强风高浪复合风险候选。每 15 分钟检查，空间约 14 km。",
            "url": (copernicus_wind_result.get("source") or {}).get("dataset_url"),
        })

    realtime_nitrate_count = sum(event.event_kind == "observation" and event.variables == ["NITRATE"] for event in events)
    if realtime_nitrate_count < OBSERVATION_CATEGORY_TARGET:
        try:
            woa_nitrate_result = get_woa_nitrate(region["bounds"], limit=max(100, OBSERVATION_CATEGORY_TARGET - realtime_nitrate_count))
        except WoaNitrateError as error:
            errors.append(str(error))
        if woa_nitrate_result:
            woa_events = _woa_nitrate_events(region, woa_nitrate_result)
            events.extend(woa_events)
            observation_count += int(woa_nitrate_result.get("available_count") or len(woa_events))
            source_health.append({
                "id": "woa23_nitrate", "name": "NOAA WOA23 硝酸盐气候态", "category": "reanalysis", "status": "cached",
                "observation_count": int(woa_nitrate_result.get("available_count") or len(woa_events)), "latest_observation_at": woa_nitrate_result.get("latest_observation_at"),
                "checked_at": datetime.now(UTC).isoformat(), "detail": f"提供 {len(woa_events)} 个硝酸盐背景点，补足实时 BGC-Argo 覆盖空缺。", "url": (woa_nitrate_result.get("source") or {}).get("url"),
            })

    realtime_salinity_count = sum(event.event_kind == "observation" and event.variables == ["SALINITY"] for event in events)
    if realtime_salinity_count < OBSERVATION_CATEGORY_TARGET:
        try:
            woa_salinity_result = get_woa_salinity(region["bounds"], limit=max(100, OBSERVATION_CATEGORY_TARGET - realtime_salinity_count))
        except WoaSalinityError as error:
            errors.append(str(error))
        if woa_salinity_result:
            woa_salinity_events = _woa_salinity_events(region, woa_salinity_result)
            events.extend(woa_salinity_events)
            observation_count += int(woa_salinity_result.get("available_count") or len(woa_salinity_events))
            source_health.append({
                "id": "woa23_salinity", "name": "NOAA WOA23 盐度气候态", "category": "reanalysis", "status": "cached",
                "observation_count": int(woa_salinity_result.get("available_count") or len(woa_salinity_events)), "latest_observation_at": woa_salinity_result.get("latest_observation_at"),
                "checked_at": datetime.now(UTC).isoformat(), "detail": f"提供 {len(woa_salinity_events)} 个盐度背景点，补足实时 Argo 覆盖空缺。", "url": (woa_salinity_result.get("source") or {}).get("url"),
            })

    observation_filter_coverage = _observation_filter_coverage(events)

    refreshed_at = datetime.now(UTC)
    _apply_event_lifecycle(region["id"], events, refreshed_at)

    events.sort(key=_event_queue_sort_key, reverse=True)
    observation_summary = _regional_observation_summary(
        region,
        argo_region,
        samples,
        failures,
        noaa_result,
        observation_count,
        len(source_health),
        screening_event_count,
    )
    return {
        "region": region,
        "argo_region": argo_region,
        "events": events,
        "sources": source_health,
        "observation_count": observation_count,
        "observation_summary": observation_summary,
        "sampled_bgc_profile_count": sampled_bgc_profile_count,
        "chlorophyll_grid_count": int((chlorophyll_result or {}).get("point_count") or 0),
        "chlorophyll_latest_observation_at": (chlorophyll_result or {}).get("latest_observation_at"),
        "woa_nitrate_grid_count": int((woa_nitrate_result or {}).get("available_count") or 0),
        "woa_salinity_grid_count": int((woa_salinity_result or {}).get("available_count") or 0),
        "chlorophyll_observation_grid_count": int((chlorophyll_observations or {}).get("point_count") or 0),
        "surface_current_grid_count": int((currents_result or {}).get("point_count") or 0),
        "carbon_grid_count": int((carbon_result or {}).get("available_count") or 0),
        "copernicus_wave_grid_count": int((copernicus_wave_result or {}).get("point_count") or 0),
        "copernicus_wind_grid_count": int((copernicus_wind_result or {}).get("point_count") or 0),
        "observation_filter_target": OBSERVATION_FILTER_RECORD_TARGET,
        "observation_filter_coverage": observation_filter_coverage,
        "refreshed_at": refreshed_at.isoformat(),
        "errors": errors,
    }


def _retain_previous_noaa_snapshot(
    current: dict[str, Any],
    previous: dict[str, Any] | None,
) -> dict[str, Any]:
    if previous is None:
        return current
    current_sst_count = int(current.get("observation_summary", {}).get("sst_latest_grid_count") or 0)
    previous_sst_count = int(previous.get("observation_summary", {}).get("sst_latest_grid_count") or 0)
    previous_has_source = any(source.get("id") == "noaa_sst" for source in previous.get("sources", []))
    if current_sst_count > 0 or previous_sst_count <= 0 or not previous_has_source:
        return current

    retained = deepcopy(previous)
    retained["refreshed_at"] = current.get("refreshed_at", datetime.now(UTC).isoformat())
    retained["errors"] = list(dict.fromkeys(current.get("errors", [])))
    for source in retained.get("sources", []):
        if source.get("id") == "noaa_sst":
            source["status"] = "cached"
            source["checked_at"] = retained["refreshed_at"]
            source["detail"] = f"上游刷新失败，继续显示最近一次有效海温。{source.get('detail', '')}"
    for event in retained.get("events", []):
        if "NOAA_SST" in event.sources:
            event.data_mode = "cached"
    retained["degraded_sources"] = ["noaa_sst"]
    return retained


def get_realtime_bundle(region_id: str, *, force_refresh: bool = False) -> dict[str, Any]:
    region = get_region(region_id)
    key = region["id"]

    def cached_response(cached_item: tuple[float, dict[str, Any]], now_value: float) -> dict[str, Any]:
        age_seconds = max(0.0, now_value - cached_item[0])
        response = cached_item[1].copy()
        defer_revalidation = bool(response.pop("_defer_revalidation", False))
        is_fresh = age_seconds < REALTIME_CACHE_TTL_SECONDS
        response["cache"] = {
            "state": "fresh" if is_fresh else "stale",
            "age_seconds": round(age_seconds, 1),
            "ttl_seconds": REALTIME_CACHE_TTL_SECONDS,
        }
        if not is_fresh or defer_revalidation:
            _schedule_revalidation(key)
        return response

    now = time.monotonic()
    with _cache_lock:
        cached = _cache.get(key)
    if cached is None:
        persisted = _load_persisted_bundle(key)
        if persisted is not None:
            persisted_age, persisted_bundle = persisted
            cached = (now - persisted_age, persisted_bundle)
            with _cache_lock:
                _cache.setdefault(key, cached)
                cached = _cache[key]
        elif not force_refresh:
            fallback = _regionalized_global_fallback(region)
            if fallback is not None:
                cached = (now - REALTIME_CACHE_TTL_SECONDS - 1, fallback)
                with _cache_lock:
                    _cache.setdefault(key, cached)
                    cached = _cache[key]

    # Reads never wait behind a slow upstream refresh. Stale data is returned
    # immediately while the single-flight revalidation runs in the background.
    if cached and not force_refresh:
        return cached_response(cached, now)

    with _region_lock(key):
        now = time.monotonic()
        with _cache_lock:
            cached = _cache.get(key)
        if cached and not force_refresh:
            return cached_response(cached, now)
        # Source clients already provide explicit stale-cache fallback for data
        # outages. Unexpected programming/data-contract errors must surface here
        # instead of silently returning an old bundle.
        previous_bundle = cached[1] if cached else None
        result = _retain_previous_noaa_snapshot(_build_bundle(key, force_refresh), previous_bundle)
        result["events"] = _merge_fixed_events(key, result["events"])
        result["fixed_cache_event_count"] = len(_load_fixed_events(key))
        with _cache_lock:
            _cache[key] = (time.monotonic(), result)
        _persist_bundle(key, result)
        response = result.copy()
        response["cache"] = {
            "state": "fresh",
            "age_seconds": 0.0,
            "ttl_seconds": REALTIME_CACHE_TTL_SECONDS,
        }
        return response


def find_live_event(event_id: str) -> OceanEvent | None:
    paged_event = _paged_events.get(event_id)
    if paged_event is not None:
        return deepcopy(paged_event)
    with _cache_lock:
        bundles = [item[1] for item in _cache.values()]
    for bundle in bundles:
        for event in bundle["events"]:
            if event.id == event_id:
                return deepcopy(event)
    return None


def get_global_copernicus_event_page(cursor: int, *, force_refresh: bool = False) -> dict[str, Any]:
    tile_index = max(0, cursor)
    if tile_index >= len(GLOBAL_COPERNICUS_PAGE_TILES):
        return {"events": [], "next_cursor": None, "has_more": False, "tile_index": tile_index}
    bounds = GLOBAL_COPERNICUS_PAGE_TILES[tile_index]
    region = get_region("global_ocean")
    tile_key = f"global_ocean_tile_{tile_index:02d}"
    with ThreadPoolExecutor(max_workers=2) as executor:
        wave_future = executor.submit(get_wave_region, tile_key, bounds, force_refresh=force_refresh)
        wind_future = executor.submit(get_wind_region, tile_key, bounds, force_refresh=force_refresh)
        wave_result = wave_future.result()
        wind_result = wind_future.result()
    wave_observations, wave_anomalies = _copernicus_wave_events(region, wave_result)
    wind_observations, wind_anomalies, typhoon_risks = _copernicus_wind_events(region, wind_result, wave_result)
    events = [*typhoon_risks, *wind_anomalies, *wave_anomalies, *wind_observations, *wave_observations]
    for event in events:
        event.id = f"{event.id}-T{tile_index:02d}"
    events.sort(key=_event_queue_sort_key, reverse=True)
    for event in events:
        _paged_events[event.id] = event
    next_cursor = tile_index + 1 if tile_index + 1 < len(GLOBAL_COPERNICUS_PAGE_TILES) else None
    return {
        "events": events,
        "next_cursor": next_cursor,
        "has_more": next_cursor is not None,
        "tile_index": tile_index,
        "bounds": bounds,
        "latest_observation_at": max(
            (value for value in (wave_result.get("latest_observation_at"), wind_result.get("latest_observation_at")) if value),
            default=None,
        ),
    }
