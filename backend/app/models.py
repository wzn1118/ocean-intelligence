from datetime import datetime
from enum import Enum
from math import isfinite
from typing import Any, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator


class EventType(str, Enum):
    SURFACE_OBSERVATION = "surface_observation"
    HYDROGRAPHIC_OBSERVATION = "hydrographic_observation"
    BIOGEOCHEMICAL_OBSERVATION = "biogeochemical_observation"
    MARINE_HEATWAVE = "marine_heatwave"
    COLD_ANOMALY = "cold_anomaly"
    EDDY = "eddy"
    CURRENT_ANOMALY = "current_anomaly"
    PHYTOPLANKTON_BLOOM = "phytoplankton_bloom"
    CARBON_ANOMALY = "carbon_anomaly"
    SALINITY_ANOMALY = "salinity_anomaly"
    NUTRIENT_ANOMALY = "nutrient_anomaly"
    CHLOROPHYLL_ANOMALY = "chlorophyll_anomaly"
    SURFACE_TEMPERATURE_ANOMALY = "surface_temperature_anomaly"
    WAVE_ANOMALY = "wave_anomaly"
    WIND_ANOMALY = "wind_anomaly"
    TYPHOON_WARNING = "typhoon_warning"


class EventStatus(str, Enum):
    ACTIVE = "active"
    WATCH = "watch"
    RECOVERING = "recovering"


EventLifecycleState = Literal["detected", "monitoring", "corroborated", "confirmed", "weakening", "closed"]


EventValidationState = Literal["observed", "screening", "corroborated", "confirmed", "scenario"]
EventKind = Literal["observation", "anomaly"]
RadiusBasis = Literal["observation_footprint", "screening_search", "reported_extent", "scenario_extent"]


class DataPoint(BaseModel):
    timestamp: datetime
    value: float
    baseline: float


class Evidence(BaseModel):
    id: str
    source: str
    variable: str
    observed: float
    baseline: float
    anomaly: float
    unit: str
    timestamp: datetime
    method: str
    confidence: float = Field(ge=0, le=1)
    series: list[DataPoint] = Field(default_factory=list)
    sample_count: int = Field(default=1, ge=1)
    temporal_span_hours: float = Field(default=0, ge=0)
    spatial_peer_count: int | None = Field(default=None, ge=0)
    qc_pass_fraction: float | None = Field(default=None, ge=0, le=1)
    measurement_uncertainty: float | None = Field(default=None, ge=0)
    comparison_uncertainty: float | None = Field(default=None, ge=0)
    value_mode: Literal["raw", "adjusted", "analysis", "derived", "scenario"] | None = None
    validation_state: EventValidationState = "screening"


class ReasoningStep(BaseModel):
    order: int
    claim: str
    mechanism: str
    evidence_ids: list[str]
    reference_ids: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0, le=1)


class TimelineItem(BaseModel):
    timestamp: datetime
    label: str
    state: Literal["detected", "intensified", "observed", "forecast", "monitoring", "corroborated", "confirmed", "weakening", "closed"]


class ScientificReference(BaseModel):
    id: str
    citation: str
    year: int = Field(ge=1900, le=2100)
    doi: str | None = None
    relevance: str
    variables: list[str] = Field(default_factory=list)


class LiteratureReference(BaseModel):
    id: str
    title: str
    citation: str
    year: int = Field(ge=1900, le=2100)
    doi: str | None = None
    relevance: str
    variables: list[str] = Field(default_factory=list)
    provider: Literal["OpenAlex", "Crossref"]
    url: str | None = None
    authors: str = ""
    journal: str = ""
    cited_by_count: int = 0
    open_access: bool = False


class LiteratureSearchResponse(BaseModel):
    event_id: str
    query: str
    provider: Literal["OpenAlex", "Crossref"]
    searched_at: datetime
    results: list[LiteratureReference] = Field(default_factory=list)
    total: int = 0
    cached: bool = False
    fallback_error: str | None = None


class OceanEvent(BaseModel):
    model_config = ConfigDict(use_enum_values=True)

    id: str
    type: EventType
    event_kind: EventKind = "anomaly"
    title: str
    summary: str
    region: str
    centroid: tuple[float, float]
    radius_km: float
    radius_basis: RadiusBasis = "scenario_extent"
    started_at: datetime
    ended_at: datetime | None = None
    status: EventStatus
    severity: float = Field(ge=0, le=1)
    severity_label: Literal["low", "moderate", "high", "critical"]
    confidence: float = Field(ge=0, le=1)
    affected_area_km2: float | None = None
    variables: list[str]
    sources: list[str]
    references: list[ScientificReference] = Field(default_factory=list)
    evidence: list[Evidence]
    reasoning_chain: list[ReasoningStep]
    timeline: list[TimelineItem]
    potential_impacts: list[str]
    uncertainty: str
    region_id: str = "northwest_pacific"
    data_mode: Literal["live", "cached", "scenario"] = "scenario"
    validation_state: EventValidationState = "screening"
    observation_count: int = 0
    source_updated_at: datetime | None = None
    lifecycle_state: EventLifecycleState | None = None
    first_detected_at: datetime | None = None
    last_seen_at: datetime | None = None
    lifecycle_revision: int = 1
    consecutive_updates: int = 0
    lifecycle_duration_hours: float = 0.0


class EventSummary(BaseModel):
    model_config = ConfigDict(use_enum_values=True)

    id: str
    type: EventType
    event_kind: EventKind = "anomaly"
    title: str
    summary: str
    region: str
    centroid: tuple[float, float]
    radius_km: float
    radius_basis: RadiusBasis = "scenario_extent"
    started_at: datetime
    status: EventStatus
    severity: float
    severity_label: str
    confidence: float
    variables: list[str]
    primary_reading: str
    region_id: str = "northwest_pacific"
    data_mode: Literal["live", "cached", "scenario"] = "scenario"
    validation_state: EventValidationState = "screening"
    observation_count: int = 0
    source_updated_at: datetime | None = None
    lifecycle_state: EventLifecycleState | None = None
    first_detected_at: datetime | None = None
    last_seen_at: datetime | None = None
    lifecycle_revision: int = 1
    consecutive_updates: int = 0
    lifecycle_duration_hours: float = 0.0


class EventCounts(BaseModel):
    total: int = 0
    observations: int = 0
    signals: int = 0
    events: int = 0
    by_variable: dict[str, int] = Field(default_factory=dict)
    by_type: dict[str, int] = Field(default_factory=dict)
    by_kind: dict[str, int] = Field(default_factory=dict)
    by_lifecycle: dict[str, int] = Field(default_factory=dict)
    by_filter: dict[str, int] = Field(default_factory=dict)


class EventLifecycleRecord(BaseModel):
    event_id: str
    region_id: str
    state: EventLifecycleState
    first_detected_at: datetime | None = None
    last_observed_at: datetime | None = None
    lifecycle_revision: int = 1
    consecutive_updates: int = 0
    updated_at: datetime | None = None


class CoverageStatus(BaseModel):
    state: Literal["complete", "partial", "stale", "unavailable"]
    notes: list[str] = Field(default_factory=list)
    bgc_float_count: int = Field(default=0, ge=0)
    sampled_bgc_profile_count: int = Field(default=0, ge=0)
    variables: dict[str, str] = Field(default_factory=dict)


class Metrics(BaseModel):
    active_events: int
    critical_events: int
    observing_assets: int
    observation_count: int = 0
    data_freshness_hours: float | None = None
    coverage_percent: float | None = None
    coverage_basis: Literal["undefined", "source_availability"] = "undefined"
    last_analysis_at: datetime
    source_count: int = 1
    region_count: int = 1
    live_event_count: int = 0


class ObservationVariableSummary(BaseModel):
    id: Literal["SST", "TEMPERATURE", "SALINITY", "CHLA", "NITRATE"]
    label: str
    unit: str
    source: str
    value_mode: Literal["raw", "adjusted", "mixed", "analysis", "unavailable"]
    available_count: int = Field(ge=0)
    total_count: int = Field(ge=0)
    availability_fraction: float | None = Field(default=None, ge=0, le=1)
    minimum: float | None = None
    median: float | None = None
    maximum: float | None = None


class ObservationTimePoint(BaseModel):
    timestamp: datetime
    minimum: float
    median: float
    maximum: float
    sample_count: int = Field(ge=1)


class SstGridPoint(BaseModel):
    timestamp: datetime
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    temperature: float
    analysis_error: float | None = Field(default=None, ge=0)
    sea_ice_fraction: float | None = Field(default=None, ge=0, le=1)
    quality_valid: bool


class RegionalObservationConclusion(BaseModel):
    state: Literal["no_candidate", "candidate_present"]
    headline: str
    summary: str
    evidence: list[str]
    interpretation_scope: list[str]
    screening_rules: list[str]


class RegionalObservationSummary(BaseModel):
    region_id: str
    region: str
    generated_at: datetime
    bounds: tuple[tuple[float, float], tuple[float, float]]
    observation_count: int = Field(ge=0)
    source_count: int = Field(ge=0)
    argo_profile_count: int = Field(default=0, ge=0)
    float_count: int = Field(ge=0)
    bgc_float_count: int = Field(ge=0)
    sampled_profile_count: int = Field(ge=0)
    profile_request_failures: int = Field(ge=0)
    profile_success_fraction: float | None = Field(default=None, ge=0, le=1)
    median_profile_depth: float | None = Field(default=None, ge=0)
    maximum_profile_depth: float | None = Field(default=None, ge=0)
    sst_lookback_days: int = Field(ge=0)
    sst_daily_steps: int = Field(ge=0)
    sst_latest_grid_count: int = Field(ge=0)
    sst_latest_points: list[SstGridPoint] = Field(default_factory=list)
    sst_native_resolution_degrees: float = Field(default=0.05, gt=0)
    sst_latitude_step_degrees: float | None = Field(default=None, gt=0)
    sst_longitude_step_degrees: float | None = Field(default=None, gt=0)
    noaa_quality_valid_count: int = Field(ge=0)
    noaa_point_count: int = Field(ge=0)
    noaa_quality_pass_fraction: float | None = Field(default=None, ge=0, le=1)
    quality_fields_complete: bool
    adjusted_surface_fraction: float | None = Field(default=None, ge=0, le=1)
    latest_observation_at: datetime | None = None
    screening_event_count: int = Field(ge=0)
    variables: list[ObservationVariableSummary]
    sst_timeline: list[ObservationTimePoint]
    conclusion: RegionalObservationConclusion


class ScientificReport(BaseModel):
    event_id: str
    title: str
    generated_at: datetime
    confidence: float
    executive_summary: str
    situation: str
    evidence_assessment: list[str]
    mechanism: list[str]
    uncertainty: str
    monitoring_actions: list[str]
    evidence_ids: list[str]


class Observation(BaseModel):
    timestamp: datetime
    value: float
    baseline: float

    @field_validator("timestamp")
    @classmethod
    def timestamp_must_be_timezone_aware(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("observation timestamps must include a timezone")
        return value

    @field_validator("value", "baseline")
    @classmethod
    def values_must_be_finite(cls, value: float) -> float:
        if not isfinite(value):
            raise ValueError("observation values must be finite")
        return value


class DetectionRequest(BaseModel):
    variable: Literal["SST", "SLA", "CHLA", "PCO2", "CURRENT"]
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    observations: list[Observation] = Field(min_length=3)
    baseline_kind: Literal[
        "climatological_upper_threshold",
        "climatological_lower_threshold",
        "climatology",
        "reference_series",
        "spatial_screen",
        "unspecified",
    ] = "unspecified"
    unit: str | None = None

    @model_validator(mode="after")
    def observations_must_have_unique_timestamps(self) -> "DetectionRequest":
        timestamps = [item.timestamp for item in self.observations]
        if len(set(timestamps)) != len(timestamps):
            raise ValueError("observation timestamps must be unique")
        compatible_units = {
            "SST": {"degC", "C", "°C"},
            "SLA": {"m", "meter", "metre"},
            "CHLA": {"mg m-3", "mg/m3"},
            "PCO2": {"uatm", "µatm", "μatm"},
            "CURRENT": {"m s-1", "m/s"},
        }
        if self.unit is not None and self.unit not in compatible_units[self.variable]:
            raise ValueError(f"unit {self.unit!r} is incompatible with {self.variable}")
        if self.baseline_kind.startswith("climatological_") and self.variable != "SST":
            raise ValueError("climatological upper/lower threshold baselines are only supported for SST")
        return self


class DetectionResult(BaseModel):
    detected: bool
    event_type: EventType | None = None
    anomaly: float
    robust_z_score: float
    severity: float
    confidence: float
    rationale: str
    validation_state: EventValidationState = "screening"
    baseline_kind: Literal[
        "climatological_upper_threshold",
        "climatological_lower_threshold",
        "climatology",
        "reference_series",
        "spatial_screen",
        "unspecified",
    ] = "unspecified"
    unit: str | None = None
    sample_count: int = Field(default=0, ge=0)
    persistence_count: int = Field(default=0, ge=0)
    persistence_fraction: float = Field(default=0, ge=0, le=1)
    temporal_span_hours: float = Field(default=0, ge=0)
    persistence_span_hours: float = Field(default=0, ge=0)
    cadence_valid: bool = False


class ArgoProfilePoint(BaseModel):
    pressure: float
    temperature: float | None = None
    temperature_qc: float | None = None
    salinity: float | None = None
    salinity_qc: float | None = None
    chla: float | None = None
    chla_qc: float | None = None
    nitrate: float | None = None
    nitrate_qc: float | None = None
    temperature_mode: Literal["raw", "adjusted"] | None = None
    salinity_mode: Literal["raw", "adjusted"] | None = None
    chla_mode: Literal["raw", "adjusted"] | None = None
    nitrate_mode: Literal["raw", "adjusted"] | None = None


class ArgoProfile(BaseModel):
    cycle: int
    timestamp: datetime
    updated_at: datetime | None = None
    longitude: float
    latitude: float
    position_qc: float | None = None
    timestamp_qc: float | None = None
    direction: str | None = None
    vertical_sampling_scheme: str | None = None
    max_pressure: float | None = None
    sample_count: int
    surface: dict[str, float | None]
    variable_modes: dict[str, Literal["raw", "adjusted", "mixed", "unavailable"]]
    surface_modes: dict[str, Literal["raw", "adjusted", "unavailable"]]
    points: list[ArgoProfilePoint]
    source_urls: list[str] = Field(default_factory=list)
    metadata_ids: list[str] = Field(default_factory=list)


class ArgoTrackPoint(BaseModel):
    cycle: int
    timestamp: datetime
    longitude: float
    latitude: float


class ArgoSource(BaseModel):
    name: str
    url: str
    gdac_url: str
    source_urls: list[str] = Field(default_factory=list)
    credit: str


class ArgoExplanation(BaseModel):
    headline: str
    summary: str
    findings: list[str]
    caveats: list[str]
    generated_at: datetime
    method: str


class ArgoCacheStatus(BaseModel):
    state: Literal["fresh", "stale"]
    age_seconds: float
    ttl_seconds: float


class ArgoFloatSnapshot(BaseModel):
    platform: str
    network: str
    source: ArgoSource
    fetched_at: datetime
    source_updated_at: datetime | None = None
    profile_count: int
    profile_scope: Literal["lifetime", "regional_window"]
    profile_window_days: int | None = None
    latest: ArgoProfile
    track: list[ArgoTrackPoint]
    explanation: ArgoExplanation
    cache: ArgoCacheStatus


class ArgoFloatHistory(BaseModel):
    platform: str
    requested_date_count: int
    date_count: int
    observation_dates: list[str]
    fetched_at: datetime
    profiles: list[ArgoProfile]
    source_url: str


class ArgoRegionalFloat(BaseModel):
    platform: str
    latest_profile_id: str
    cycle: int
    timestamp: datetime
    longitude: float
    latitude: float
    profile_count: int
    networks: list[str] = Field(default_factory=list)
    has_bgc: bool = False
    distance_km: float | None = None
    within_event_radius: bool = False


class MonitoredBuoy(BaseModel):
    platform: str
    enabled: bool = True
    created_at: datetime
    updated_at: datetime


class CopernicusWaveRecord(BaseModel):
    timestamp: str | None = None
    VHM0: float | None = None
    VTM02: float | None = None
    VMDR: float | None = None
    VHM0_SW1: float | None = None
    VTM01_SW1: float | None = None
    VMDR_SW1: float | None = None
    VHM0_WW: float | None = None
    VTM01_WW: float | None = None
    VMDR_WW: float | None = None


class CopernicusWavePoint(BaseModel):
    dataset_id: str
    longitude: float
    latitude: float
    requested_longitude: float
    requested_latitude: float
    grid_longitude: float
    grid_latitude: float
    grid_distance_km: float
    coordinates_selection_method: str
    spatial_interpolation_method: str
    temporal_interpolation_method: str
    horizontal_resolution_degrees: float
    horizontal_resolution_km: float
    temporal_resolution_hours: int
    latest_valid_time: str | None = None
    latency_reference_at: datetime
    data_latency_seconds: float | None = None
    data_latency_hours: float | None = None
    physical_derivation: str
    start_datetime: datetime
    end_datetime: datetime
    records: list[CopernicusWaveRecord]
    fetched_at: datetime


class CopernicusWindRecord(BaseModel):
    timestamp: str | None = None
    eastward_wind: float | None = None
    northward_wind: float | None = None
    wind_speed: float | None = None
    wind_direction_from: float | None = None


class CopernicusWindPoint(BaseModel):
    dataset_id: str
    longitude: float
    latitude: float
    requested_longitude: float
    requested_latitude: float
    grid_longitude: float
    grid_latitude: float
    grid_distance_km: float
    coordinates_selection_method: str
    spatial_interpolation_method: str
    temporal_interpolation_method: str
    horizontal_resolution_degrees: float
    horizontal_resolution_km: float
    temporal_resolution_hours: int
    latest_valid_time: str | None = None
    latency_reference_at: datetime
    data_latency_seconds: float | None = None
    data_latency_hours: float | None = None
    physical_derivation: str
    start_datetime: datetime
    end_datetime: datetime
    records: list[CopernicusWindRecord]
    fetched_at: datetime


class CopernicusCurrentField(BaseModel):
    dataset_id: str
    product_id: str
    fetched_at: datetime
    timestamp: datetime | None = None
    time_role: Literal["latest_available_analysis", "forecast"]
    latency_seconds: float | None = Field(default=None, ge=0)
    latency_hours: float | None = Field(default=None, ge=0)
    depth: float | None = None
    bounds: list[list[float]]
    width: int = Field(ge=1)
    height: int = Field(ge=1)
    longitudes: list[float]
    latitudes: list[float]
    u: list[float | None]
    v: list[float | None]
    speed: list[float | None]
    valid_point_count: int = Field(ge=0)
    maximum_speed: float = Field(ge=0)
    mean_speed: float = Field(ge=0)
    variables: dict[str, dict[str, str]]
    data_class: str
    animation_time_scale: str
    source: dict[str, str]
    cache: dict[str, Any]


class CopernicusDatasetVolume(BaseModel):
    dataset_id: str
    product_id: str
    name: str
    date: str
    is_current_day: bool
    variable_count: int = Field(ge=0)
    time_count: int = Field(ge=0)
    spatial_point_count: int = Field(ge=0)
    record_count: int = Field(ge=0)
    value_count: int = Field(ge=0)
    latest_observation_at: datetime | None = None


class CopernicusGlobalDataVolume(BaseModel):
    date: str
    dataset_count: int = Field(ge=0)
    record_count: int = Field(ge=0)
    value_count: int = Field(ge=0)
    latest_observation_at: datetime | None = None
    fetched_at: datetime
    status: Literal["live", "partial"]
    datasets: list[CopernicusDatasetVolume] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    cache: dict[str, Any]


class DailyBriefing(BaseModel):
    date: str
    region_id: str
    status: Literal["generated", "published"]
    generated_at: datetime
    publish_at: datetime
    published_at: datetime | None = None
    headline: str
    summary: str
    highlights: list[str] = Field(default_factory=list)
    evidence: list[str] = Field(default_factory=list)
    anomaly_count: int = Field(ge=0)
    copernicus: dict[str, Any]
    argo: dict[str, Any]
    delivery: dict[str, Any]


class DailyBriefingEnvelope(BaseModel):
    schedule: dict[str, str]
    briefing: DailyBriefing | None = None


class CopernicusHistoryPage(BaseModel):
    source: Literal["wave", "wind"]
    dataset_id: str
    longitude: float
    latitude: float
    total: int = Field(ge=0)
    offset: int = Field(ge=0)
    limit: int = Field(ge=1)
    start_datetime: datetime | None = None
    end_datetime: datetime | None = None
    synced_at: datetime | None = None
    records: list[dict[str, Any]] = Field(default_factory=list)


class ArgoRegionSnapshot(BaseModel):
    region_id: str = "northwest_pacific"
    region: str
    bounds: tuple[tuple[float, float], tuple[float, float]]
    lookback_days: int
    fetched_at: datetime
    profile_count: int
    float_count: int
    bgc_float_count: int
    latest_observation_at: datetime | None = None
    profiles: list[ArgoRegionalFloat] = Field(default_factory=list)
    floats: list[ArgoRegionalFloat]
    source: ArgoSource
    cache: ArgoCacheStatus


class ArgoEventCoverage(BaseModel):
    event_id: str
    event_title: str
    event_center: tuple[float, float]
    event_radius_km: float
    radius_basis: RadiusBasis = "reported_extent"
    regional_float_count: int
    matched_count: int
    match_mode: Literal["within_event", "nearest"]
    candidates: list[ArgoRegionalFloat]
    selected_platform: str
    snapshot: ArgoFloatSnapshot
    fetched_at: datetime


class MarinePlace(BaseModel):
    name: str
    name_en: str | None = None
    mrgid: str | None = None
    place_type: str = "海域"
    source_url: str | None = None
    confidence: Literal["high", "medium", "low"] = "medium"


class FisheryResource(BaseModel):
    scientific_name: str = Field(min_length=3)
    scientific_name_authorship: str | None = None
    chinese_name: str | None = None
    chinese_name_source: str | None = None
    chinese_name_source_url: str | None = None
    common_name: str | None = None
    english_name: str | None = None
    taxon_rank: Literal["species", "subspecies"] = "species"
    taxonomic_status: Literal["accepted"] = "accepted"
    taxon_class: str | None = None
    taxon_order: str | None = None
    family: str | None = None
    taxon_group: str
    aphia_id: int | None = None
    fao_alpha3_code: str | None = None
    fao_isscaap_group: str | None = None
    fao_asfis_version: str
    fao_fishstat_data: bool = False
    fishery_relevance: Literal["fao_fishstat", "fao_asfis"]
    evidence_count: int = Field(default=0, ge=0)
    dataset_count: int = Field(default=0, ge=0)
    first_year: int | None = None
    latest_year: int | None = None
    minimum_distance_km: float = Field(ge=0)
    evidence_strength: Literal["high", "medium", "limited"]
    evidence_kind: Literal["nearby_observation", "regional_reference"]
    source_url: str
    asfis_source_url: str
    worms_source_url: str | None = None


class FaoFishingArea(BaseModel):
    code: str
    name: str
    name_en: str
    source_url: str


class MarineKnowledgeReference(BaseModel):
    id: str
    title: str
    source_name: str
    url: str | None = None


class MarineEncyclopediaArticle(BaseModel):
    title: str
    source_title: str | None = None
    language: str = "zh-CN"
    content_scope: str = "introduction"
    original_language: str | None = None
    translation_method: str | None = None
    extract: str
    paragraphs: list[str] = Field(default_factory=list)
    url: str
    page_id: int = Field(ge=1)
    revision_id: int = Field(ge=1)
    page_updated_at: datetime | None = None
    snapshot_at: datetime
    source_name: str
    license: str
    offline: bool = True


class MarineKnowledge(BaseModel):
    query_point: dict[str, float]
    sea_name: str
    sea_name_en: str
    display_name: str
    place_type: str
    parent_ocean: str = ""
    fao_area: FaoFishingArea
    overview: str
    embedded: bool = True
    live_summary: str | None = None
    encyclopedia: MarineEncyclopediaArticle | None = None
    historical_significance: list[str] = Field(default_factory=list)
    human_geography: list[str] = Field(default_factory=list)
    maritime_routes: list[str] = Field(default_factory=list)
    coastal_livelihoods: list[str] = Field(default_factory=list)
    marine_culture: list[str] = Field(default_factory=list)
    fact_sheet: list[str] = Field(default_factory=list)
    physical_geography: list[str] = Field(default_factory=list)
    oceanographic_processes: list[str] = Field(default_factory=list)
    ecosystems: list[str] = Field(default_factory=list)
    learning_prompts: list[str] = Field(default_factory=list)
    key_terms: list[str] = Field(default_factory=list)
    references: list[MarineKnowledgeReference] = Field(default_factory=list)
    provider: str
    live_retrieved: bool = False
    atlas_count: int = Field(default=0, ge=0)
    atlas_version: str = ""
    retrieved_at: datetime
    errors: list[str] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)
    cache: ArgoCacheStatus


class MarineContext(BaseModel):
    query_point: dict[str, float]
    sea_name: str
    sea_name_en: str
    display_name: str | None = None
    region_codes: list[str] = Field(default_factory=list)
    region_label: str | None = None
    place_type: str
    place_source: str
    place_source_url: str
    confidence: Literal["high", "medium", "low"]
    matched_places: list[MarinePlace] = Field(default_factory=list)
    fisheries: list[FisheryResource] = Field(default_factory=list)
    fisheries_total_records: int = Field(default=0, ge=0)
    fisheries_species_count: int = Field(default=0, ge=0)
    fisheries_scanned_records: int = Field(default=0, ge=0)
    biodiversity_total_records: int = Field(default=0, ge=0)
    fisheries_results_complete: bool = False
    fisheries_search_radius_km: float = Field(default=100.0, gt=0)
    fisheries_radius_degrees: float = Field(default=1.0, gt=0)
    fisheries_source: str
    fisheries_source_url: str
    fisheries_asfis_version: str
    fisheries_asfis_source_url: str
    fao_area: FaoFishingArea
    fetched_at: datetime
    errors: list[str] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)
    cache: ArgoCacheStatus


class BathymetrySample(BaseModel):
    direction: Literal["center", "north", "east", "south", "west"]
    longitude: float = Field(ge=-180, le=180)
    latitude: float = Field(ge=-90, le=90)
    elevation_m: float
    water_depth_m: float = Field(ge=0)
    provider: str


class BathymetryProfile(BaseModel):
    query_point: dict[str, float]
    query_radius_m: float = Field(default=0.0, ge=0)
    value_basis: Literal["bilinear_grid_interpolation", "point_service_grid_estimate"]
    seafloor_elevation_m: float
    water_depth_m: float = Field(ge=0)
    is_ocean: bool
    depth_zone: Literal["land_or_intertidal", "continental_shelf", "continental_slope", "abyssal", "hadal"]
    depth_zone_name: str
    explanation: str
    sample_radius_km: float = Field(ge=0)
    shallowest_depth_m: float = Field(ge=0)
    deepest_depth_m: float = Field(ge=0)
    local_relief_m: float = Field(ge=0)
    sample_count: int = Field(ge=1, le=5)
    samples: list[BathymetrySample]
    provider: str
    dataset: str
    source_url: str
    fallback_source_url: str
    precision_mode: Literal["gmrt_100m_grid", "gmrt_point", "gebco_grid"]
    horizontal_resolution_m: float | None = Field(default=None, gt=0)
    interpolation_method: str
    high_resolution_coverage: bool
    grid_node_count: int = Field(ge=1)
    micro_radius_m: float | None = Field(default=None, gt=0)
    micro_shallowest_depth_m: float | None = Field(default=None, ge=0)
    micro_deepest_depth_m: float | None = Field(default=None, ge=0)
    micro_relief_m: float | None = Field(default=None, ge=0)
    verification_provider: str | None = None
    verification_elevation_m: float | None = None
    verification_depth_m: float | None = Field(default=None, ge=0)
    source_difference_m: float | None = Field(default=None, ge=0)
    confidence: Literal["high", "medium", "low"]
    confidence_name: str
    confidence_note: str
    resolution_note: str
    retrieved_at: datetime
    errors: list[str] = Field(default_factory=list)
    cache: ArgoCacheStatus


class ArgoPointSelection(BaseModel):
    query_point: tuple[float, float]
    region_id: str
    region: str
    regional_float_count: int
    candidates: list[ArgoRegionalFloat]
    nearest_platform: str
    nearest_distance_km: float
    selected_platform: str
    selected_distance_km: float
    snapshot: ArgoFloatSnapshot
    fetched_at: datetime
    marine_context: MarineContext | None = None


class OceanRegion(BaseModel):
    id: str
    name: str
    short_name: str
    description: str
    bounds: tuple[tuple[float, float], tuple[float, float]]
    center: tuple[float, float]
    zoom: float


class SourceHealth(BaseModel):
    id: str
    name: str
    category: Literal["in_situ", "satellite", "reanalysis", "interpretation"]
    status: Literal["live", "cached", "configured", "unavailable"]
    observation_count: int = 0
    latest_observation_at: datetime | None = None
    checked_at: datetime
    latency_seconds: float | None = None
    detail: str
    url: str | None = None


class EventExplanation(BaseModel):
    event_id: str
    provider: Literal["external_api", "evidence_engine"]
    model: str
    generated_at: datetime
    headline: str
    summary: str
    findings: list[str]
    mechanisms: list[str]
    impacts: list[str]
    caveats: list[str]
    evidence_ids: list[str]
    source_links: list[str]
    method: str


class RefreshResult(BaseModel):
    region_id: str
    refreshed_at: datetime
    event_count: int
    observation_count: int
    source_count: int
    status: Literal["completed", "partial"]


class RefreshJob(BaseModel):
    """Asynchronous refresh state exposed to the UI and automation clients."""

    job_id: str
    region_id: str
    status: Literal["queued", "running", "completed", "partial", "failed"]
    created_at: datetime
    updated_at: datetime
    refreshed_at: datetime | None = None
    result: RefreshResult | None = None
    error: str | None = None


class WorkspaceSnapshot(BaseModel):
    """Single-request read model for the operational workspace."""

    snapshot_id: str
    region: OceanRegion
    events: list[EventSummary]
    event_counts: EventCounts = Field(default_factory=EventCounts)
    coverage: CoverageStatus
    metrics: Metrics
    sources: list[SourceHealth]
    observations: RegionalObservationSummary
    argo_region: ArgoRegionSnapshot | None = None
    refreshed_at: datetime
    cache_state: Literal["fresh", "stale"] = "fresh"
    errors: list[str] = Field(default_factory=list)


class AgentConversationMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=6000)


class AgentSourceContext(BaseModel):
    id: str
    name: str
    status: Literal["live", "cached", "configured", "unavailable"]
    observation_count: int = Field(default=0, ge=0)
    latest_observation_at: datetime | None = None


class AgentContextManifest(BaseModel):
    region_id: str
    region: str
    indexed_at: datetime
    index_revision: str
    full_index: bool = True
    record_count: int = Field(ge=0)
    observation_count: int = Field(ge=0)
    candidate_count: int = Field(ge=0)
    confirmed_event_count: int = Field(ge=0)
    source_count: int = Field(ge=0)
    live_source_count: int = Field(ge=0)
    variable_counts: dict[str, int] = Field(default_factory=dict)
    data_mode_counts: dict[str, int] = Field(default_factory=dict)
    earliest_record_at: datetime | None = None
    latest_record_at: datetime | None = None
    indexed_fields: list[str] = Field(default_factory=list)
    sources: list[AgentSourceContext] = Field(default_factory=list)
    answer_engine: Literal["local_retrieval", "external_model"]
    model: str
    external_model: str | None = None
    model_status: Literal["available", "cooldown", "unconfigured"] = "unconfigured"
    model_retry_after_seconds: int = Field(default=0, ge=0)


class AgentCitation(BaseModel):
    id: str
    kind: Literal["record", "source", "statistic"]
    title: str
    subtitle: str
    event_id: str | None = None
    source_id: str | None = None
    variables: list[str] = Field(default_factory=list)
    observed_at: datetime | None = None
    relevance: float = Field(default=0, ge=0, le=1)


class AgentResearchStep(BaseModel):
    key: Literal["interpret", "retrieve", "cross_check", "synthesize"]
    label: str
    detail: str
    evidence_count: int = Field(default=0, ge=0)


class AgentQueryPlan(BaseModel):
    mode: Literal["quick", "research"] = "research"
    intent: Literal[
        "latest_observations",
        "candidate_review",
        "source_health",
        "coverage_audit",
        "comparison",
        "record_explanation",
        "general_research",
    ]
    intent_label: str
    time_scope: str
    variables: list[str] = Field(default_factory=list)
    evidence_strategy: str
    steps: list[AgentResearchStep] = Field(default_factory=list)


class AgentRuntimeProfile(BaseModel):
    architecture: Literal["langgraph_state_graph"] = "langgraph_state_graph"
    framework: str = "LangGraph"
    framework_version: str
    checkpoint_backend: Literal["sqlite"] = "sqlite"
    long_term_store: Literal["langgraph_sqlite_store"] = "langgraph_sqlite_store"
    durable_execution: bool = True
    memory_layers: list[Literal["working", "episodic", "semantic", "procedural"]] = Field(
        default_factory=lambda: ["working", "episodic", "semantic", "procedural"]
    )
    reply_strategy: Literal["evidence_first"] = "evidence_first"
    nodes: list[str] = Field(default_factory=list)
    execution_trace: list[str] = Field(default_factory=list)


class AgentStoredMessage(BaseModel):
    id: str
    session_id: str
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime
    citations: list[AgentCitation] = Field(default_factory=list)
    provider: Literal["local_retrieval", "external_model"] | None = None
    model: str | None = None
    retrieved_record_count: int = Field(default=0, ge=0)
    query_plan: AgentQueryPlan | None = None
    runtime_profile: AgentRuntimeProfile | None = None
    notes: list[str] = Field(default_factory=list)


class AgentSession(BaseModel):
    id: str
    title: str
    region_id: str
    selected_event_id: str | None = None
    summary: str = ""
    message_count: int = Field(default=0, ge=0)
    created_at: datetime
    updated_at: datetime
    last_message_at: datetime | None = None
    archived: bool = False


class AgentSessionDetail(AgentSession):
    messages: list[AgentStoredMessage] = Field(default_factory=list)


class AgentSessionCreate(BaseModel):
    region_id: str = "global_ocean"
    title: str = Field(default="新对话", min_length=1, max_length=80)
    selected_event_id: str | None = None


class AgentSessionUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=80)
    archived: bool | None = None


class AgentMemory(BaseModel):
    id: str
    kind: Literal["preference", "instruction", "focus"]
    content: str
    region_id: str | None = None
    source_session_id: str | None = None
    source_message_id: str | None = None
    confidence: float = Field(default=1, ge=0, le=1)
    enabled: bool = True
    created_at: datetime
    updated_at: datetime
    last_used_at: datetime | None = None
    use_count: int = Field(default=0, ge=0)


class AgentMemoryCreate(BaseModel):
    kind: Literal["preference", "instruction", "focus"] = "preference"
    content: str = Field(min_length=1, max_length=500)
    region_id: str | None = None
    confidence: float = Field(default=1, ge=0, le=1)


class AgentMemoryUpdate(BaseModel):
    content: str | None = Field(default=None, min_length=1, max_length=500)
    enabled: bool | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)


class AgentChatRequest(BaseModel):
    region_id: str = "global_ocean"
    question: str = Field(min_length=1, max_length=2400)
    selected_event_id: str | None = None
    session_id: str | None = None
    remember: bool = True
    analysis_mode: Literal["quick", "research"] = "research"
    history: list[AgentConversationMessage] = Field(default_factory=list, max_length=12)


class AgentChatResponse(BaseModel):
    answer: str
    generated_at: datetime
    provider: Literal["local_retrieval", "external_model"]
    model: str
    context: AgentContextManifest
    citations: list[AgentCitation] = Field(default_factory=list)
    retrieved_record_count: int = Field(default=0, ge=0)
    follow_up_questions: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    session: AgentSession | None = None
    memories_used: list[AgentMemory] = Field(default_factory=list)
    query_plan: AgentQueryPlan
    runtime_profile: AgentRuntimeProfile


ProviderName = Literal["openai", "deepseek", "custom"]
ProviderApiMode = Literal["responses", "chat_completions"]


class UserRegistrationRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: SecretStr = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=1, max_length=80)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().casefold()
        if value.count("@") != 1 or any(character.isspace() for character in value):
            raise ValueError("invalid email address")
        local_part, domain = value.rsplit("@", 1)
        if not local_part or not domain or "." not in domain or domain.startswith(".") or domain.endswith("."):
            raise ValueError("invalid email address")
        return value

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("display name cannot be blank")
        return value


class UserLoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: SecretStr = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return UserRegistrationRequest.normalize_email(value)


class UserPublic(BaseModel):
    id: str
    email: str
    display_name: str
    created_at: datetime


class AuthSessionResponse(BaseModel):
    user: UserPublic
    csrf_token: str
    expires_at: datetime


class AuthStateResponse(BaseModel):
    user: UserPublic | None = None
    csrf_token: str | None = None
    expires_at: datetime | None = None


class CsrfTokenResponse(BaseModel):
    csrf_token: str


class ProviderPresetPublic(BaseModel):
    id: ProviderName
    label: str
    base_url: str | None = None
    api_mode: ProviderApiMode


class ProviderConnectionInput(BaseModel):
    provider: ProviderName
    base_url: str | None = Field(default=None, max_length=2048)
    api_key: SecretStr | None = Field(default=None, max_length=4096)
    api_mode: ProviderApiMode | None = None

    @field_validator("base_url")
    @classmethod
    def normalize_base_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip().rstrip("/")
        if not value:
            return None
        if not value.startswith("https://"):
            raise ValueError("base URL must use https")
        parsed = urlsplit(value)
        if not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("base URL cannot contain credentials")
        if parsed.query or parsed.fragment:
            raise ValueError("base URL cannot contain a query or fragment")
        return value

    @model_validator(mode="after")
    def custom_provider_requires_base_url(self) -> "ProviderConnectionInput":
        if self.provider == "custom" and not self.base_url:
            raise ValueError("custom provider requires a base URL")
        return self


class UserProviderConfigUpdate(ProviderConnectionInput):
    model: str = Field(min_length=1, max_length=160)

    @field_validator("model")
    @classmethod
    def normalize_model(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("model cannot be blank")
        return value


class ProviderModelDiscoveryRequest(ProviderConnectionInput):
    pass


class UserProviderConfigPublic(BaseModel):
    provider: ProviderName
    base_url: str
    model: str
    has_api_key: bool
    api_mode: ProviderApiMode
    updated_at: datetime


class ProviderConnectionTestResult(BaseModel):
    ok: Literal[True] = True
    base_url: str
    model: str
    api_mode: ProviderApiMode
    latency_ms: int = Field(ge=0)
    message: str


class ProviderModelDiscoveryResult(BaseModel):
    ok: Literal[True] = True
    provider: ProviderName
    base_url: str
    models: list[str]
    fetched_at: datetime
    message: str
