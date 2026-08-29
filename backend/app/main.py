import os
from datetime import UTC, datetime
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from time import perf_counter
from typing import Any, Literal
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.agents.event_detection import OceanEventDetectionAgent
from app.agents.report_generation import ReportGenerationAgent
from app.agents.science_reasoning import OceanScienceReasoningAgent
from app.agents.explanation import explain_event, explanation_api_configured
from app.agents.agent_graph import answer_agent_question, clear_agent_thread, delete_agent_memory_from_store
from app.agents.data_context import build_agent_manifest, model_runtime_snapshot
from app.agents.codex_mcp import router as codex_mcp_router
from app.codex_runtime_proxy import close_codex_proxy_client, router as codex_runtime_proxy_router
from app.agents.memory_store import AgentMemoryStore
from app.data.demo import EVENTS
from app.data.argo_client import ArgoDataError, get_argo_float, get_argo_float_history, get_argo_region, get_event_argo, get_nearest_argo
from app.data.bathymetry import BathymetryDataError, get_bathymetry
from app.data.copernicus_client import CopernicusMarineError, get_current_field, get_global_daily_data_volume, get_wave_point, get_wind_point
from app.data.copernicus_history import append_point_records, query_point_history, sync_point_history
from app.data.literature_client import search_literature
from app.data.marine_context import get_marine_context
from app.data.marine_atlas import ATLAS_VERSION, MARINE_ATLAS, atlas_search
from app.data.marine_knowledge import get_marine_knowledge
from app.data.realtime_service import (
    find_live_event,
    get_argo_realtime_status,
    get_event_lifecycle_records,
    get_realtime_bundle,
    preload_realtime_caches,
    start_argo_realtime_collector,
    stop_argo_realtime_collector,
)
from app.copernicus_daily_index import get_index_event, index_status, read_event_page
from app.data.regions import DEFAULT_REGION_ID, REGIONS, get_region
from app.data.daily_dashboard import get_daily_dashboard
from app.daily_briefing import (
    get_daily_briefing,
    local_schedule,
    start_daily_briefing_scheduler,
    stop_daily_briefing_scheduler,
)
from app.performance import PERFORMANCE
from app.refresh_jobs import enqueue_refresh, get_refresh_job
from app.auth import (
    UserApiCredentials,
    get_auth_service,
    get_current_user,
    install_auth,
)
from app.models import (
    CoverageStatus,
    DetectionRequest,
    DetectionResult,
    EventSummary,
    EventCounts,
    EventLifecycleRecord,
    EventType,
    ArgoExplanation,
    ArgoEventCoverage,
    ArgoFloatSnapshot,
    ArgoFloatHistory,
    ArgoPointSelection,
    BathymetryProfile,
    MarineContext,
    MarineKnowledge,
    ArgoRegionSnapshot,
    CopernicusWavePoint,
    CopernicusWindPoint,
    CopernicusCurrentField,
    CopernicusGlobalDataVolume,
    CopernicusHistoryPage,
    DailyBriefing,
    DailyBriefingEnvelope,
    Metrics,
    RegionalObservationSummary,
    EventExplanation,
    OceanEvent,
    OceanRegion,
    RefreshJob,
    RefreshResult,
    ScientificReport,
    SourceHealth,
    LiteratureSearchResponse,
    TimelineItem,
    WorkspaceSnapshot,
    AgentChatRequest,
    AgentChatResponse,
    AgentContextManifest,
    AgentMemory,
    AgentMemoryCreate,
    AgentMemoryUpdate,
    AgentSessionCreate,
    AgentSessionDetail,
    AgentSessionUpdate,
    AgentSession,
    UserPublic,
)


IS_PRODUCTION = os.getenv("APP_ENV", "development").strip().lower() == "production"
configured_origins = [
    item.strip()
    for item in os.getenv("ALLOWED_ORIGINS", "").split(",")
    if item.strip()
]
cors_origins = configured_origins or (
    [] if IS_PRODUCTION else ["http://localhost:5173", "http://127.0.0.1:5173"]
)
app = FastAPI(
    title="海洋智能分析平台 API",
    version="0.1.0",
    description="基于可追溯证据的海洋异常识别与科学研判服务。",
    docs_url=None if IS_PRODUCTION else "/docs",
    redoc_url=None if IS_PRODUCTION else "/redoc",
    openapi_url=None if IS_PRODUCTION else "/openapi.json",
)


@app.on_event("startup")
def preload_ocean_observation_caches() -> None:
    preload_realtime_caches()
    start_argo_realtime_collector()
    start_daily_briefing_scheduler()


@app.on_event("shutdown")
async def stop_ocean_observation_collectors() -> None:
    stop_daily_briefing_scheduler()
    stop_argo_realtime_collector()
    await close_codex_proxy_client()


app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=4)
app.include_router(codex_mcp_router)
app.include_router(codex_runtime_proxy_router)
install_auth(app)
if IS_PRODUCTION:
    allowed_hosts = [
        item.strip()
        for item in os.getenv("ALLOWED_HOSTS", "").split(",")
        if item.strip()
    ]
    if not allowed_hosts:
        raise RuntimeError("ALLOWED_HOSTS is required when APP_ENV=production")
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=list(dict.fromkeys([*allowed_hosts, "app", "localhost", "127.0.0.1"])),
    )

FRONTEND_DIST_DIR = Path(
    os.getenv(
        "FRONTEND_DIST_DIR",
        str(Path(__file__).resolve().parents[2] / "frontend" / "dist"),
    )
).resolve()
FRONTEND_INDEX = FRONTEND_DIST_DIR / "index.html"


@app.middleware("http")
async def request_telemetry(request, call_next):
    """Attach trace/timing headers and record bounded endpoint metrics."""
    request_id = request.headers.get("x-request-id") or uuid4().hex
    started = perf_counter()
    PERFORMANCE.begin()
    try:
        response = await call_next(request)
    except Exception:
        route = getattr(request.scope.get("route"), "path", request.url.path)
        PERFORMANCE.end(route, (perf_counter() - started) * 1000, 500)
        raise
    elapsed_ms = (perf_counter() - started) * 1000
    route = getattr(request.scope.get("route"), "path", request.url.path)
    PERFORMANCE.end(route, elapsed_ms, response.status_code)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Response-Time-Ms"] = f"{elapsed_ms:.1f}"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    if IS_PRODUCTION:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; "
            "form-action 'self'; script-src 'self' https://static.cloudflareinsights.com; "
            "style-src 'self' 'unsafe-inline'; "
            "font-src 'self' data:; img-src 'self' data: blob: https:; "
            "connect-src 'self' https:; worker-src 'self' blob:; upgrade-insecure-requests"
        )
    return response

detection_agent = OceanEventDetectionAgent()
reasoning_agent = OceanScienceReasoningAgent()
report_agent = ReportGenerationAgent()
agent_memory_store = AgentMemoryStore()


@dataclass(frozen=True)
class RequestUserContext:
    owner_id: str
    user: UserPublic | None
    api_config: tuple[str, str, str] | None


def request_user_context(
    request: Request,
    user: UserPublic | None = Depends(get_current_user),
) -> RequestUserContext:
    if user is None:
        return RequestUserContext(owner_id="local", user=None, api_config=None)
    credentials: UserApiCredentials | None = get_auth_service(request).get_api_credentials(user.id)
    api_config = None
    if credentials and credentials.api_key:
        api_config = (
            credentials.base_url,
            credentials.api_key.get_secret_value(),
            credentials.model,
        )
    return RequestUserContext(owner_id=user.id, user=user, api_config=api_config)

VARIABLE_LABELS = {
    "SST": "海表温度",
    "SLA": "海面高度异常",
    "CHLA": "叶绿素 a",
    "PCO2": "海表二氧化碳分压",
    "DIC": "溶解无机碳",
    "NITRATE": "硝酸盐",
    "SALINITY": "盐度",
    "TEMPERATURE": "温度",
    "CURRENT": "海流",
    "SSH_GRADIENT": "海面高度梯度",
}
UNIT_LABELS = {
    "degC": "°C",
    "PSU": "PSU",
    "mg m-3": "mg m⁻³",
    "umol kg-1": "μmol kg⁻¹",
    "uatm": "μatm",
    "m s-1": "m s⁻¹",
    "m per 100 km": "m/100 km",
}


def _summary(event: OceanEvent) -> EventSummary:
    primary = event.evidence[0]
    return EventSummary(
        id=event.id,
        type=event.type,
        event_kind=event.event_kind,
        title=event.title,
        summary=event.summary,
        region=event.region,
        centroid=event.centroid,
        radius_km=event.radius_km,
        radius_basis=event.radius_basis,
        started_at=event.started_at,
        status=event.status,
        severity=event.severity,
        severity_label=event.severity_label,
        confidence=event.confidence,
        variables=event.variables,
        primary_reading=(
            f"{VARIABLE_LABELS.get(primary.variable, primary.variable)} {primary.observed:g} "
            f"{UNIT_LABELS.get(primary.unit, primary.unit)}"
            if event.event_kind == "observation"
            else (
                f"比附近{'高' if primary.anomaly >= 0 else '低'} "
                f"{abs(primary.anomaly):g} {UNIT_LABELS.get(primary.unit, primary.unit)}"
            )
        ),
        region_id=event.region_id,
        data_mode=event.data_mode,
        validation_state=event.validation_state,
        lifecycle_state=event.lifecycle_state,
        first_detected_at=event.first_detected_at,
        last_seen_at=event.last_seen_at,
        lifecycle_revision=event.lifecycle_revision,
        consecutive_updates=event.consecutive_updates,
        lifecycle_duration_hours=event.lifecycle_duration_hours,
        observation_count=event.observation_count,
        source_updated_at=event.source_updated_at,
    )


def _get_event(event_id: str) -> OceanEvent:
    event = find_live_event(event_id) or get_index_event(event_id) or next((item for item in EVENTS if item.id == event_id), None)
    if event is None:
        raise HTTPException(status_code=404, detail="未找到该海洋事件")
    return reasoning_agent.validate(event)


@app.get("/api/health")
def health() -> dict[str, object]:
    return {
        "status": "operational",
        "service": "ocean-intelligence-agent",
        "timestamp": datetime.now(UTC),
        "event_count": len(EVENTS),
        "region_count": len(REGIONS),
        "interpretation_api": "configured" if explanation_api_configured() else "evidence_engine",
    }


@app.get("/api/regions", response_model=list[OceanRegion])
def regions() -> list[OceanRegion]:
    return [OceanRegion(**region) for region in REGIONS.values()]


def _require_region(region_id: str) -> dict[str, object]:
    if region_id not in REGIONS:
        raise HTTPException(status_code=404, detail="未找到该海域配置")
    return get_region(region_id)


def _metrics_from_bundle(bundle: dict[str, object]) -> Metrics:
    events = bundle["events"]
    argo_region = bundle.get("argo_region")
    latest_times = [
        source["latest_observation_at"]
        for source in bundle["sources"]
        if source.get("latest_observation_at")
    ]
    if latest_times:
        latest = max(datetime.fromisoformat(value.replace("Z", "+00:00")) for value in latest_times)
        freshness = max(0.0, (datetime.now(UTC) - latest).total_seconds() / 3600)
    else:
        freshness = None
    anomaly_events = [event for event in events if event.event_kind == "anomaly"]
    return Metrics(
        active_events=sum(event.status == "active" for event in anomaly_events),
        critical_events=sum(event.severity_label == "critical" for event in anomaly_events),
        observing_assets=(argo_region["float_count"] if argo_region else 0),
        observation_count=bundle["observation_count"],
        data_freshness_hours=round(freshness, 1) if freshness is not None else None,
        coverage_percent=None,
        coverage_basis="undefined",
        last_analysis_at=datetime.now(UTC),
        source_count=len(bundle["sources"]),
        region_count=len(REGIONS),
        live_event_count=len(anomaly_events),
    )


def _event_counts(bundle: dict[str, object]) -> EventCounts:
    """Expose record, kind, type, lifecycle, and variable coverage counts."""
    records = list(bundle.get("events") or [])
    observations = [item for item in records if item.event_kind == "observation"]
    signals = [item for item in records if item.event_kind == "anomaly"]
    confirmed_states = {"corroborated", "confirmed"}
    events = [item for item in signals if item.validation_state in confirmed_states]
    by_variable: dict[str, int] = {}
    for item in records:
        for variable in item.variables:
            by_variable[variable] = by_variable.get(variable, 0) + 1
    lifecycle_counts: dict[str, int] = {}
    type_counts: dict[str, int] = {}
    kind_counts: dict[str, int] = {}
    for item in records:
        type_counts[item.type] = type_counts.get(item.type, 0) + 1
        kind_counts[item.event_kind] = kind_counts.get(item.event_kind, 0) + 1
    for item in signals:
        if item.lifecycle_state:
            lifecycle_counts[item.lifecycle_state] = lifecycle_counts.get(item.lifecycle_state, 0) + 1
    filter_counts = dict(type_counts)
    wave_point_count = int(bundle.get("copernicus_wave_grid_count") or 0)
    wind_point_count = int(bundle.get("copernicus_wind_grid_count") or 0)
    if wave_point_count:
        filter_counts["wave_anomaly"] = wave_point_count
    if wind_point_count:
        filter_counts["wind_anomaly"] = wind_point_count
    return EventCounts(
        total=len(records),
        observations=len(observations),
        signals=len(signals),
        events=len(events),
        by_variable=by_variable,
        by_type=type_counts,
        by_kind=kind_counts,
        by_lifecycle=lifecycle_counts,
        by_filter=filter_counts,
    )


def _coverage_from_bundle(bundle: dict[str, object]) -> CoverageStatus:
    summary = bundle.get("observation_summary") or {}
    variables = {
        item["id"]: (
            "unavailable"
            if not item.get("available_count")
            else "sparse"
            if float(item.get("availability_fraction") or 0) < 0.2
            else "available"
        )
        for item in summary.get("variables") or []
    }
    chlorophyll_grid_count = int(bundle.get("chlorophyll_grid_count") or 0)
    if chlorophyll_grid_count > 0:
        variables["CHLA"] = "available"
    argo_region = bundle.get("argo_region") or {}
    bgc_count = int(argo_region.get("bgc_float_count") or 0)
    sampled_profiles = int(bundle.get("sampled_bgc_profile_count") or 0)
    if sampled_profiles == 0:
        # Older persisted bundles did not store this field. Use the observed
        # BGC counts as a conservative migration fallback until refresh.
        sampled_profiles = max(
            int(next((item.get("available_count") or 0 for item in summary.get("variables", []) if item.get("id") == "CHLA"), 0)),
            int(next((item.get("available_count") or 0 for item in summary.get("variables", []) if item.get("id") == "NITRATE"), 0)),
        )
    notes: list[str] = []
    for variable, label in (("CHLA", "叶绿素 a"), ("NITRATE", "硝酸盐")):
        if variables.get(variable) == "unavailable":
            notes.append(f"{label}当前没有合格剖面，不能据此判断没有事件")
        elif variables.get(variable) == "sparse":
            notes.append(f"{label}当前样本较少，结果仅作候选筛查")
    if chlorophyll_grid_count > 0 and sampled_profiles == 0:
        notes.append("叶绿素 a 已有卫星空间网格，但本轮没有合格 BGC-Argo 剖面完成点位复核")
    source_labels = {
        "argo_core": "Argo Core",
        "bgc_argo": "BGC-Argo",
        "noaa_sst": "NOAA 海温",
        "noaa_chlorophyll": "NOAA 叶绿素",
        "woa23_nitrate": "WOA23 硝酸盐气候态",
    }
    cached_sources = [
        source_labels.get(str(source.get("id")), str(source.get("id")))
        for source in bundle.get("sources") or []
        if source.get("status") == "cached"
    ]
    if cached_sources:
        notes.append(f"以下来源使用最近有效缓存：{' / '.join(cached_sources)}")
    if not bundle.get("sources"):
        state = "unavailable"
    elif bundle.get("errors") or any(source.get("status") == "cached" for source in bundle.get("sources") or []):
        state = "stale"
    elif notes:
        state = "partial"
    else:
        state = "complete"
    return CoverageStatus(
        state=state,
        notes=notes,
        bgc_float_count=bgc_count,
        sampled_bgc_profile_count=sampled_profiles,
        variables=variables,
    )


def _sources_from_bundle(bundle: dict[str, object]) -> list[SourceHealth]:
    sources = list(bundle["sources"])
    sources.append(
        {
            "id": "interpretation_api",
            "name": "interpretation_api",
            "category": "interpretation",
            "status": "live" if explanation_api_configured() else "configured",
            "observation_count": len(bundle["events"]),
            "checked_at": datetime.now(UTC),
            "detail": "external model API configured" if explanation_api_configured() else "local evidence engine",
        }
    )
    return [SourceHealth(**source) for source in sources]


@app.get("/api/metrics", response_model=Metrics)
def metrics(region: str | None = Query(default=None)) -> Metrics:
    if region is None:
        return Metrics(
            active_events=sum(event.status == "active" for event in EVENTS),
            critical_events=sum(event.severity_label == "critical" for event in EVENTS),
            observing_assets=0,
            observation_count=0,
            data_freshness_hours=None,
            coverage_percent=None,
            coverage_basis="undefined",
            last_analysis_at=datetime.now(UTC),
            source_count=0,
            region_count=len(REGIONS),
            live_event_count=0,
        )
    _require_region(region)
    return _metrics_from_bundle(get_realtime_bundle(region))


@app.get("/api/observations/summary", response_model=RegionalObservationSummary)
def observation_summary(region: str = Query(default=DEFAULT_REGION_ID)) -> RegionalObservationSummary:
    _require_region(region)
    return RegionalObservationSummary(**get_realtime_bundle(region)["observation_summary"])


@app.get("/api/events", response_model=list[EventSummary])
def list_events(
    event_type: EventType | None = Query(default=None, alias="type"),
    min_severity: float = Query(default=0, ge=0, le=1),
    region: str | None = Query(default=None),
    mode: Literal["live", "scenario", "all"] = Query(default="live"),
    kind: Literal["all", "observation", "signal", "event"] = Query(default="all"),
    refresh: bool = Query(default=False),
) -> list[EventSummary]:
    catalog: list[OceanEvent] = list(EVENTS) if region is None or mode in {"scenario", "all"} else []
    if region is not None:
        _require_region(region)
        if mode in {"live", "all"}:
            catalog = list(get_realtime_bundle(region, force_refresh=refresh)["events"]) + (
                catalog if region == DEFAULT_REGION_ID and mode == "all" else []
            )
        elif region != DEFAULT_REGION_ID:
            catalog = []
    filtered = [
        event
        for event in catalog
        if event.severity >= min_severity
        and (event_type is None or event.type == event_type)
        and (
            kind == "all"
            or (kind == "observation" and event.event_kind == "observation")
            or (kind == "signal" and event.event_kind == "anomaly")
            or (
                kind == "event"
                and event.event_kind == "anomaly"
                and event.validation_state in {"corroborated", "confirmed"}
            )
        )
    ]
    return [_summary(event) for event in sorted(filtered, key=lambda item: item.severity, reverse=True)]


@app.get("/api/signals", response_model=list[EventSummary])
def list_signals(
    region: str = Query(default=DEFAULT_REGION_ID),
    event_type: EventType | None = Query(default=None, alias="type"),
    min_severity: float = Query(default=0, ge=0, le=1),
    refresh: bool = Query(default=False),
) -> list[EventSummary]:
    """Return algorithmic anomaly candidates, never routine observations."""
    return list_events(
        event_type=event_type,
        min_severity=min_severity,
        region=region,
        mode="live",
        kind="signal",
        refresh=refresh,
    )


@app.get("/api/observations", response_model=list[EventSummary])
def list_observations(
    region: str = Query(default=DEFAULT_REGION_ID),
    variable: str | None = Query(default=None),
    min_severity: float = Query(default=0, ge=0, le=1),
    refresh: bool = Query(default=False),
) -> list[EventSummary]:
    """Return measured records; a measured record is not an anomaly."""
    records = list_events(
        event_type=None,
        min_severity=min_severity,
        region=region,
        mode="live",
        kind="observation",
        refresh=refresh,
    )
    if not variable:
        return records
    normalized = variable.strip().upper()
    return [item for item in records if normalized in {entry.upper() for entry in item.variables}]


@app.get("/api/event-stats", response_model=EventCounts)
def event_stats(region: str = Query(default=DEFAULT_REGION_ID)) -> EventCounts:
    _require_region(region)
    return _event_counts(get_realtime_bundle(region))


@app.get("/api/event-lifecycle", response_model=list[EventLifecycleRecord])
def event_lifecycle(region: str = Query(default=DEFAULT_REGION_ID)) -> list[EventLifecycleRecord]:
    """Return active and recently closed signal state without promoting scientific validation."""
    _require_region(region)
    get_realtime_bundle(region)
    return [EventLifecycleRecord.model_validate(item) for item in get_event_lifecycle_records(region)]


@app.get("/api/data-coverage", response_model=CoverageStatus)
def data_coverage(region: str = Query(default=DEFAULT_REGION_ID)) -> CoverageStatus:
    _require_region(region)
    return _coverage_from_bundle(get_realtime_bundle(region))


@app.get("/api/sources", response_model=list[SourceHealth])
def source_health(
    region: str = Query(default=DEFAULT_REGION_ID),
    context: RequestUserContext = Depends(request_user_context),
) -> list[SourceHealth]:
    _require_region(region)
    bundle = get_realtime_bundle(region)
    sources = list(bundle["sources"])
    external_configured = bool(context.api_config) or explanation_api_configured()
    sources.append(
        {
            "id": "interpretation_api",
            "name": "海洋证据解读 API",
            "category": "interpretation",
            "status": "live" if external_configured else "configured",
            "observation_count": len(bundle["events"]),
            "checked_at": datetime.now(UTC),
            "detail": "当前账户的模型 API 已配置。" if context.api_config else (
                "服务端模型 API 已配置。" if explanation_api_configured()
                else "当前使用内置证据约束解读引擎；可在账户设置中接入模型 API。"
            ),
        }
    )
    return [SourceHealth(**source) for source in sources]


@app.get("/api/workspace/snapshot", response_model=WorkspaceSnapshot)
def workspace_snapshot(
    request: Request,
    response: Response,
    region: str = Query(default=DEFAULT_REGION_ID),
    refresh: bool = Query(default=False),
    compact: bool = Query(default=False),
) -> WorkspaceSnapshot | Response:
    """Return all first-screen read models from one cached data snapshot."""
    region_config = _require_region(region)
    bundle = get_realtime_bundle(region, force_refresh=refresh)
    cache = bundle.get("cache") or {}
    argo_region = bundle.get("argo_region")
    events = bundle["events"]
    observation_summary = bundle["observation_summary"]
    if compact:
        events = events[:300]
        observation_summary = {
            **observation_summary,
            "sst_latest_points": observation_summary.get("sst_latest_points", [])[::max(
                1,
                len(observation_summary.get("sst_latest_points", [])) // 400,
            )][:400],
        }
        if argo_region:
            argo_region = {
                **argo_region,
                "profiles": argo_region.get("profiles", [])[::max(
                    1,
                    len(argo_region.get("profiles", [])) // 400,
                )][:400],
                "floats": argo_region.get("floats", [])[::max(
                    1,
                    len(argo_region.get("floats", [])) // 400,
                )][:400],
            }
    etag = f'"workspace:{region}:{"compact" if compact else "full"}:{bundle["refreshed_at"]}"'
    cache_headers = {
        "ETag": etag,
        "Cache-Control": "private, max-age=0, must-revalidate",
    }
    if not refresh and request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={**cache_headers, "Vary": "Accept-Encoding"})
    for name, value in cache_headers.items():
        response.headers[name] = value
    return WorkspaceSnapshot(
        snapshot_id=f"{region}:{bundle['refreshed_at']}",
        region=OceanRegion(**region_config),
        events=[_summary(event) for event in events],
        event_counts=_event_counts(bundle),
        coverage=_coverage_from_bundle(bundle),
        metrics=_metrics_from_bundle(bundle),
        sources=_sources_from_bundle(bundle),
        observations=RegionalObservationSummary(**observation_summary),
        argo_region=ArgoRegionSnapshot(**argo_region) if argo_region else None,
        refreshed_at=bundle["refreshed_at"],
        cache_state="fresh" if cache.get("state") == "fresh" else "stale",
        errors=list(bundle.get("errors") or []),
    )


@app.get("/api/copernicus/events/page")
def copernicus_event_page(
    cursor: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    view: Literal["all", "observations", "signals", "events"] = Query(default="all"),
    area: str | None = Query(default=None),
    geography: Literal["china_mainland", "taiwan_related", "global"] | None = Query(default=None),
) -> dict[str, object]:
    return read_event_page(
        cursor=cursor,
        limit=limit,
        view=view,
        area=area,
        geography=geography,
    )


@app.get("/api/copernicus/index/status")
def copernicus_index_status() -> dict[str, object]:
    return index_status()


@app.get("/api/argo/realtime/status")
def argo_realtime_status() -> dict[str, object]:
    return get_argo_realtime_status()


@app.get("/api/agent/context", response_model=AgentContextManifest)
def agent_context(
    region: str = Query(default=DEFAULT_REGION_ID),
    context: RequestUserContext = Depends(request_user_context),
) -> AgentContextManifest:
    """Describe the complete regional index available to the in-product agent."""
    region_config = _require_region(region)
    return build_agent_manifest(region_config, get_realtime_bundle(region), context.api_config)


@app.get("/api/agent/model-health")
def agent_model_health(
    context: RequestUserContext = Depends(request_user_context),
) -> dict[str, object]:
    """Expose relay reliability metrics without returning credentials or endpoint details."""
    return model_runtime_snapshot(context.api_config)


@app.post("/api/agent/chat", response_model=AgentChatResponse)
def agent_chat(
    request: AgentChatRequest,
    context: RequestUserContext = Depends(request_user_context),
) -> AgentChatResponse:
    """Answer from the regional index with server-side session and memory continuity."""
    region_config = _require_region(request.region_id)
    bundle = get_realtime_bundle(request.region_id)
    if request.selected_event_id and not any(item.id == request.selected_event_id for item in bundle["events"]):
        raise HTTPException(status_code=404, detail="当前区域索引中未找到所选记录")
    session = (
        agent_memory_store.get_session(request.session_id, owner_id=context.owner_id)
        if request.session_id
        else None
    )
    if request.session_id and session is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session and session.region_id != request.region_id:
        raise HTTPException(status_code=400, detail="会话所属海域与当前请求不一致")
    if session is None:
        session = agent_memory_store.create_session(
            request.region_id,
            selected_event_id=request.selected_event_id,
            owner_id=context.owner_id,
        )
    stored_history = agent_memory_store.conversation_window(
        session.id,
        max_messages=16,
        max_chars=9000,
        owner_id=context.owner_id,
    )
    user_message = agent_memory_store.add_message(
        session.id,
        "user",
        request.question,
        owner_id=context.owner_id,
    )
    if request.remember:
        for kind, content, confidence in agent_memory_store.extract_explicit_memories(request.question):
            agent_memory_store.upsert_memory(
                kind,
                content,
                region_id=request.region_id,
                source_session_id=session.id,
                source_message_id=user_message.id,
                confidence=confidence,
                owner_id=context.owner_id,
            )
    memories = agent_memory_store.relevant_memories(
        request.question,
        request.region_id,
        limit=8,
        owner_id=context.owner_id,
    )
    enriched_request = request.model_copy(update={"session_id": session.id, "history": stored_history})
    response = answer_agent_question(
        region_config,
        bundle,
        enriched_request,
        memories,
        owner_id=context.owner_id,
        api_config=context.api_config,
    )
    agent_memory_store.add_message(
        session.id,
        "assistant",
        response.answer,
        citations=response.citations,
        provider=response.provider,
        model=response.model,
        retrieved_record_count=response.retrieved_record_count,
        query_plan=response.query_plan,
        runtime_profile=response.runtime_profile,
        notes=response.notes,
        owner_id=context.owner_id,
    )
    response.session = agent_memory_store.get_session(session.id, owner_id=context.owner_id)
    response.memories_used = memories
    agent_memory_store.mark_memories_used(
        [memory.id for memory in memories],
        owner_id=context.owner_id,
    )
    return response


@app.get("/api/agent/sessions", response_model=list[AgentSession])
def agent_sessions(
    region: str = Query(default=DEFAULT_REGION_ID),
    include_archived: bool = Query(default=False),
    limit: int = Query(default=80, ge=1, le=200),
    context: RequestUserContext = Depends(request_user_context),
) -> list[AgentSession]:
    _require_region(region)
    return agent_memory_store.list_sessions(
        region,
        include_archived=include_archived,
        limit=limit,
        owner_id=context.owner_id,
    )


@app.post("/api/agent/sessions", response_model=AgentSession, status_code=201)
def create_agent_session(
    request: AgentSessionCreate,
    context: RequestUserContext = Depends(request_user_context),
) -> AgentSession:
    _require_region(request.region_id)
    if request.selected_event_id:
        bundle = get_realtime_bundle(request.region_id)
        if not any(item.id == request.selected_event_id for item in bundle["events"]):
            raise HTTPException(status_code=404, detail="当前区域索引中未找到所选记录")
    return agent_memory_store.create_session(
        request.region_id,
        request.title,
        request.selected_event_id,
        owner_id=context.owner_id,
    )


@app.get("/api/agent/sessions/{session_id}", response_model=AgentSessionDetail)
def agent_session(
    session_id: str,
    context: RequestUserContext = Depends(request_user_context),
) -> AgentSessionDetail:
    detail = agent_memory_store.get_session(session_id, owner_id=context.owner_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    return detail


@app.patch("/api/agent/sessions/{session_id}", response_model=AgentSession)
def update_agent_session(
    session_id: str,
    request: AgentSessionUpdate,
    context: RequestUserContext = Depends(request_user_context),
) -> AgentSession:
    updated = agent_memory_store.update_session(
        session_id,
        title=request.title,
        archived=request.archived,
        owner_id=context.owner_id,
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    return updated


@app.delete("/api/agent/sessions/{session_id}", status_code=204)
def delete_agent_session(
    session_id: str,
    context: RequestUserContext = Depends(request_user_context),
) -> None:
    if not agent_memory_store.delete_session(session_id, owner_id=context.owner_id):
        raise HTTPException(status_code=404, detail="会话不存在")
    clear_agent_thread(session_id)


@app.get("/api/agent/memories", response_model=list[AgentMemory])
def agent_memories(
    region: str = Query(default=DEFAULT_REGION_ID),
    include_disabled: bool = Query(default=True),
    limit: int = Query(default=100, ge=1, le=300),
    context: RequestUserContext = Depends(request_user_context),
) -> list[AgentMemory]:
    _require_region(region)
    return agent_memory_store.list_memories(
        region,
        include_disabled=include_disabled,
        limit=limit,
        owner_id=context.owner_id,
    )


@app.post("/api/agent/memories", response_model=AgentMemory, status_code=201)
def create_agent_memory(
    request: AgentMemoryCreate,
    context: RequestUserContext = Depends(request_user_context),
) -> AgentMemory:
    if request.region_id:
        _require_region(request.region_id)
    return agent_memory_store.upsert_memory(
        request.kind,
        request.content,
        region_id=request.region_id,
        confidence=request.confidence,
        owner_id=context.owner_id,
    )


@app.patch("/api/agent/memories/{memory_id}", response_model=AgentMemory)
def update_agent_memory(
    memory_id: str,
    request: AgentMemoryUpdate,
    context: RequestUserContext = Depends(request_user_context),
) -> AgentMemory:
    updated = agent_memory_store.update_memory(
        memory_id,
        content=request.content,
        enabled=request.enabled,
        confidence=request.confidence,
        owner_id=context.owner_id,
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="记忆不存在")
    if not updated.enabled:
        delete_agent_memory_from_store(memory_id)
    return updated


@app.delete("/api/agent/memories/{memory_id}", status_code=204)
def delete_agent_memory(
    memory_id: str,
    context: RequestUserContext = Depends(request_user_context),
) -> None:
    if not agent_memory_store.delete_memory(memory_id, owner_id=context.owner_id):
        raise HTTPException(status_code=404, detail="记忆不存在")
    delete_agent_memory_from_store(memory_id)


@app.get("/api/performance")
def performance() -> dict[str, object]:
    return PERFORMANCE.snapshot()


@app.post("/api/refresh", response_model=RefreshResult)
def refresh_region(region: str = Query(default=DEFAULT_REGION_ID)) -> RefreshResult:
    _require_region(region)
    bundle = get_realtime_bundle(region, force_refresh=True)
    return RefreshResult(
        region_id=region,
        refreshed_at=bundle["refreshed_at"],
        event_count=len(bundle["events"]),
        observation_count=bundle["observation_count"],
        source_count=len(bundle["sources"]),
        status="partial" if bundle["errors"] else "completed",
    )


@app.post("/api/refresh/jobs", response_model=RefreshJob, status_code=202)
def enqueue_region_refresh(region: str = Query(default=DEFAULT_REGION_ID)) -> RefreshJob:
    _require_region(region)
    return RefreshJob(**enqueue_refresh(region))


@app.get("/api/refresh/jobs/{job_id}", response_model=RefreshJob)
def refresh_job(job_id: str) -> RefreshJob:
    job = get_refresh_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="refresh job not found")
    return RefreshJob(**job)


@app.get("/api/events/{event_id}", response_model=OceanEvent)
def event_detail(event_id: str) -> OceanEvent:
    return _get_event(event_id)


@app.get("/api/events/{event_id}/timeline", response_model=list[TimelineItem])
def event_timeline(event_id: str) -> list[TimelineItem]:
    return _get_event(event_id).timeline


@app.get("/api/events/{event_id}/report", response_model=ScientificReport)
def event_report(event_id: str) -> ScientificReport:
    return report_agent.create(_get_event(event_id))


@app.get("/api/events/{event_id}/explanation", response_model=EventExplanation)
def event_explanation(
    event_id: str,
    refresh: bool = Query(default=False),
    context: RequestUserContext = Depends(request_user_context),
) -> EventExplanation:
    return explain_event(
        _get_event(event_id),
        force_refresh=refresh,
        api_config=context.api_config,
        cache_scope=context.owner_id,
    )


@app.get("/api/events/{event_id}/literature", response_model=LiteratureSearchResponse)
def event_literature(event_id: str, refresh: bool = Query(default=False)) -> LiteratureSearchResponse:
    """Search current scholarly metadata APIs using the live event context."""
    try:
        return search_literature(_get_event(event_id), force_refresh=refresh)
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post("/api/detect", response_model=DetectionResult)
def detect(request: DetectionRequest) -> DetectionResult:
    return detection_agent.analyze(request)


@app.get("/api/argo/float/{platform}", response_model=ArgoFloatSnapshot)
def argo_float(platform: str, refresh: bool = Query(default=False)) -> ArgoFloatSnapshot:
    """读取真实 Argo/BGC-Argo 浮标剖面，并返回现场解释与轨迹。"""
    try:
        return ArgoFloatSnapshot(**get_argo_float(platform, force_refresh=refresh))
    except ArgoDataError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.get("/api/argo/float/{platform}/explanation", response_model=ArgoExplanation)
def argo_explanation(platform: str, refresh: bool = Query(default=False)) -> ArgoExplanation:
    """Return the generated explanation separately for API clients and automations."""
    try:
        return ArgoExplanation(**get_argo_float(platform, force_refresh=refresh)["explanation"])
    except ArgoDataError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.get("/api/argo/float/{platform}/history", response_model=ArgoFloatHistory)
def argo_float_history(platform: str, date_count: int = Query(default=7, ge=1, le=30), refresh: bool = Query(default=False)) -> ArgoFloatHistory:
    """Return complete profiles from the most recent observation dates."""
    try:
        return ArgoFloatHistory(**get_argo_float_history(platform, date_count=date_count, force_refresh=refresh))
    except ArgoDataError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.get("/api/argo/region", response_model=ArgoRegionSnapshot)
def argo_region(
    refresh: bool = Query(default=False),
    region: str = Query(default=DEFAULT_REGION_ID),
) -> ArgoRegionSnapshot:
    """Return every compact Argo profile plus the latest active-float view."""
    try:
        region_config = _require_region(region)
        return ArgoRegionSnapshot(
            **get_argo_region(
                region_id=region,
                bounds=region_config["bounds"],
                region_name=region_config["name"],
                force_refresh=refresh,
            )
        )
    except ArgoDataError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.get("/api/argo/nearest", response_model=ArgoPointSelection)
def argo_nearest(
    longitude: float = Query(ge=-180, le=180),
    latitude: float = Query(ge=-80, le=80),
    region: str = Query(default=DEFAULT_REGION_ID),
    platform: str | None = Query(default=None),
    refresh: bool = Query(default=False),
    include_context: bool = Query(default=True),
) -> ArgoPointSelection:
    """Resolve an arbitrary map coordinate to nearby active Argo floats."""
    try:
        region_config = _require_region(region)
        # These are independent remote reads. Running them together keeps a
        # point click responsive when the marine gazetteer is slow.
        with ThreadPoolExecutor(max_workers=2) as executor:
            argo_future = executor.submit(
                get_nearest_argo,
                longitude,
                latitude,
                platform=platform,
                region_id=region,
                bounds=region_config["bounds"],
                region_name=region_config["name"],
                force_refresh=refresh,
            )
            context_future = executor.submit(get_marine_context, longitude, latitude, force_refresh=refresh) if include_context else None
            selection = argo_future.result()
            marine_context_result = context_future.result() if context_future else None
        # Keep point-name and fisheries context in the same click response so
        # the UI never has to guess which coordinate the educational card uses.
        selection["marine_context"] = marine_context_result
        return ArgoPointSelection(**selection)
    except ArgoDataError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.get("/api/marine/context", response_model=MarineContext)
def marine_context(
    longitude: float = Query(ge=-180, le=180),
    latitude: float = Query(ge=-80, le=80),
    refresh: bool = Query(default=False),
) -> MarineContext:
    """Resolve a clicked point to a standardized sea name and nearby fisheries evidence."""
    return MarineContext(**get_marine_context(longitude, latitude, force_refresh=refresh))


@app.get("/api/marine/bathymetry", response_model=BathymetryProfile)
def marine_bathymetry(
    longitude: float = Query(ge=-180, le=180),
    latitude: float = Query(ge=-90, le=90),
    refresh: bool = Query(default=False),
) -> BathymetryProfile:
    """Return point water depth and a five-point local relief summary."""
    try:
        return BathymetryProfile(**get_bathymetry(longitude, latitude, force_refresh=refresh))
    except BathymetryDataError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.get("/api/copernicus/waves/point", response_model=CopernicusWavePoint)
def copernicus_wave_point(
    longitude: float = Query(ge=-180, le=180),
    latitude: float = Query(ge=-90, le=90),
    days: int = Query(default=3, ge=1, le=7),
) -> CopernicusWavePoint:
    """Return Copernicus Marine wave variables around one map point."""
    try:
        payload = get_wave_point(longitude, latitude, days=days)
        append_point_records("wave", payload["dataset_id"], longitude, latitude, payload["records"])
        return CopernicusWavePoint(**payload)
    except CopernicusMarineError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.get("/api/copernicus/wind/point", response_model=CopernicusWindPoint)
def copernicus_wind_point(
    longitude: float = Query(ge=-180, le=180),
    latitude: float = Query(ge=-90, le=90),
    days: int = Query(default=3, ge=1, le=7),
) -> CopernicusWindPoint:
    """Return Copernicus Marine sea-surface wind around one map point."""
    try:
        payload = get_wind_point(longitude, latitude, days=days)
        append_point_records("wind", payload["dataset_id"], longitude, latitude, payload["records"])
        return CopernicusWindPoint(**payload)
    except CopernicusMarineError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.get("/api/copernicus/currents/field", response_model=CopernicusCurrentField)
def copernicus_current_field(
    west: float = Query(ge=-540, le=540),
    south: float = Query(ge=-80, le=90),
    east: float = Query(ge=-540, le=540),
    north: float = Query(ge=-80, le=90),
    width: int = Query(default=96, ge=24, le=160),
    height: int = Query(default=64, ge=16, le=120),
    refresh: bool = Query(default=False),
) -> CopernicusCurrentField:
    """Return a display-ready Copernicus Marine surface-current vector field."""
    try:
        return CopernicusCurrentField(**get_current_field(
            west=west,
            south=south,
            east=east,
            north=north,
            width=width,
            height=height,
            force_refresh=refresh,
        ))
    except CopernicusMarineError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.get("/api/copernicus/global/daily-volume", response_model=CopernicusGlobalDataVolume)
def copernicus_global_daily_volume(refresh: bool = Query(default=False)) -> CopernicusGlobalDataVolume:
    """Return today's global gridded record count for connected Copernicus Marine products."""
    try:
        return CopernicusGlobalDataVolume(**get_global_daily_data_volume(force_refresh=refresh))
    except CopernicusMarineError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.get("/api/daily-briefing", response_model=DailyBriefingEnvelope)
def daily_briefing(report_date: str | None = Query(default=None, alias="date")) -> DailyBriefingEnvelope:
    briefing = get_daily_briefing(report_date)
    return DailyBriefingEnvelope(
        schedule=local_schedule(),
        briefing=DailyBriefing(**briefing) if briefing is not None else None,
    )


@app.get("/api/daily-briefing/dashboard")
def daily_briefing_dashboard(refresh: bool = Query(default=False)) -> dict[str, Any]:
    return get_daily_dashboard(force_refresh=refresh)


@app.get("/api/copernicus/history/point", response_model=CopernicusHistoryPage)
def copernicus_history_point(
    source: Literal["wave", "wind"] = Query(default="wave"),
    longitude: float = Query(ge=-180, le=180),
    latitude: float = Query(ge=-90, le=90),
    limit: int = Query(default=200, ge=1, le=5000),
    offset: int = Query(default=0, ge=0),
    sync: bool = Query(default=False),
) -> CopernicusHistoryPage:
    """Synchronize or page through the complete available point history."""
    try:
        payload = (
            sync_point_history(source, longitude, latitude)
            if sync
            else query_point_history(source, longitude, latitude, limit=limit, offset=offset)
        )
        if sync and (limit != 200 or offset != 0):
            payload = query_point_history(source, longitude, latitude, limit=limit, offset=offset)
        return CopernicusHistoryPage(**payload)
    except CopernicusMarineError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.get("/api/marine/knowledge", response_model=MarineKnowledge)
def marine_knowledge(
    longitude: float = Query(ge=-180, le=180),
    latitude: float = Query(ge=-80, le=80),
    refresh: bool = Query(default=False),
) -> MarineKnowledge:
    """Return human-geography, history and maritime knowledge for a map point."""
    return MarineKnowledge(**get_marine_knowledge(longitude, latitude, force_refresh=refresh))


@app.get("/api/marine/atlas")
def marine_atlas(
    query: str | None = Query(default=None, max_length=120),
    limit: int = Query(default=50, ge=1, le=500),
) -> dict[str, object]:
    """Return the versioned offline sea/strait encyclopedia index."""
    return {
        "version": ATLAS_VERSION,
        "count": len(MARINE_ATLAS),
        "items": atlas_search(query, limit=limit),
    }


@app.get("/api/events/{event_id}/argo", response_model=ArgoEventCoverage)
def event_argo(
    event_id: str,
    platform: str | None = Query(default=None),
    refresh: bool = Query(default=False),
) -> ArgoEventCoverage:
    """Match an event to real nearby Argo floats and return the selected full profile."""
    event = _get_event(event_id)
    try:
        region_config = get_region(event.region_id)
        return ArgoEventCoverage(
            **get_event_argo(
                event.id,
                event.title,
                event.centroid,
                event.radius_km,
                radius_basis=event.radius_basis,
                platform=platform,
                region_id=region_config["id"],
                bounds=region_config["bounds"],
                region_name=region_config["name"],
                force_refresh=refresh,
            )
        )
    except ArgoDataError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


if FRONTEND_INDEX.is_file():
    def _frontend_response(path: Path, *, index: bool = False) -> FileResponse:
        headers = {
            "Cache-Control": "no-cache" if index else "public, max-age=3600",
        }
        if "assets" in path.relative_to(FRONTEND_DIST_DIR).parts:
            headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return FileResponse(path, headers=headers)


    @app.get("/", include_in_schema=False)
    def frontend_index() -> FileResponse:
        return _frontend_response(FRONTEND_INDEX, index=True)


    @app.get("/{frontend_path:path}", include_in_schema=False)
    def frontend_asset_or_route(frontend_path: str) -> FileResponse:
        if frontend_path == "api" or frontend_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API route not found")
        candidate = (FRONTEND_DIST_DIR / frontend_path).resolve()
        if candidate.is_relative_to(FRONTEND_DIST_DIR) and candidate.is_file():
            return _frontend_response(candidate)
        if Path(frontend_path).suffix:
            raise HTTPException(status_code=404, detail="Frontend asset not found")
        return _frontend_response(FRONTEND_INDEX, index=True)
