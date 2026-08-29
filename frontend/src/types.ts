export type EventType =
  | "surface_observation"
  | "hydrographic_observation"
  | "biogeochemical_observation"
  | "marine_heatwave"
  | "cold_anomaly"
  | "eddy"
  | "current_anomaly"
  | "phytoplankton_bloom"
  | "carbon_anomaly"
  | "salinity_anomaly"
  | "nutrient_anomaly"
  | "chlorophyll_anomaly"
  | "surface_temperature_anomaly"
  | "wave_anomaly"
  | "wind_anomaly"
  | "typhoon_warning";

export type EventStatus = "active" | "watch" | "recovering";
export type EventValidationState = "observed" | "screening" | "corroborated" | "confirmed" | "scenario";
export type EventLifecycleState = "detected" | "monitoring" | "corroborated" | "confirmed" | "weakening" | "closed";
export type EventKind = "observation" | "anomaly";
export type RadiusBasis = "observation_footprint" | "screening_search" | "reported_extent" | "scenario_extent";

export interface DataPoint {
  timestamp: string;
  value: number;
  baseline: number;
}

export interface Evidence {
  id: string;
  source: string;
  variable: string;
  observed: number;
  baseline: number;
  anomaly: number;
  unit: string;
  timestamp: string;
  method: string;
  confidence: number;
  validation_state: EventValidationState;
  series: DataPoint[];
  sample_count: number;
  temporal_span_hours: number;
  spatial_peer_count: number | null;
  qc_pass_fraction: number | null;
  measurement_uncertainty: number | null;
  comparison_uncertainty: number | null;
  value_mode: "raw" | "adjusted" | "analysis" | "derived" | "scenario" | null;
}

export interface ReasoningStep {
  order: number;
  claim: string;
  mechanism: string;
  evidence_ids: string[];
  reference_ids: string[];
  confidence: number;
  validation_state: EventValidationState;
}

export interface TimelineItem {
  timestamp: string;
  label: string;
  state: "detected" | "intensified" | "observed" | "forecast";
}

export interface ScientificReference {
  id: string;
  citation: string;
  year: number;
  doi: string | null;
  relevance: string;
  variables: string[];
}

export interface LiteratureReference {
  id: string;
  title: string;
  citation: string;
  year: number;
  doi: string | null;
  relevance: string;
  variables: string[];
  provider: "OpenAlex" | "Crossref";
  url: string | null;
  authors: string;
  journal: string;
  cited_by_count: number;
  open_access: boolean;
}

export interface LiteratureSearchResponse {
  event_id: string;
  query: string;
  provider: "OpenAlex" | "Crossref";
  searched_at: string;
  results: LiteratureReference[];
  total: number;
  cached: boolean;
  fallback_error: string | null;
}

export interface EventSummary {
  id: string;
  type: EventType;
  event_kind: EventKind;
  title: string;
  summary: string;
  region: string;
  centroid: [number, number];
  radius_km: number;
  radius_basis: RadiusBasis;
  started_at: string;
  status: EventStatus;
  severity: number;
  severity_label: string;
  confidence: number;
  variables: string[];
  primary_reading: string;
  region_id: string;
  data_mode: "live" | "cached" | "scenario";
  validation_state: EventValidationState;
  observation_count: number;
  source_updated_at: string | null;
  lifecycle_state?: EventLifecycleState | null;
  lifecycle_revision: number;
  first_detected_at: string | null;
  consecutive_updates: number;
}

export interface CopernicusEventPage {
  events: EventSummary[];
  next_cursor: number | null;
  has_more: boolean;
  total: number;
  event_counts: EventCounts;
  tile_index?: number;
  bounds?: [[number, number], [number, number]];
  latest_observation_at?: string | null;
}

export interface EventLifecycleRecord {
  event_id: string;
  lifecycle_state: EventLifecycleState;
  lifecycle_revision: number;
  first_detected_at: string | null;
  consecutive_updates: number;
  updated_at?: string | null;
}

export interface CoverageStatus {
  state: "complete" | "partial" | "stale" | "unavailable";
  notes: string[];
  observed_count?: number;
  expected_count?: number;
}

export interface EventCounts {
  total: number;
  observations: number;
  signals: number;
  events: number;
  by_variable: Record<string, number>;
  by_type: Record<string, number>;
  by_kind: Record<string, number>;
  by_lifecycle: Record<string, number>;
  by_filter: Record<string, number>;
}

export interface OceanEvent extends Omit<EventSummary, "primary_reading"> {
  ended_at: string | null;
  affected_area_km2: number | null;
  sources: string[];
  references: ScientificReference[];
  evidence: Evidence[];
  reasoning_chain: ReasoningStep[];
  timeline: TimelineItem[];
  potential_impacts: string[];
  uncertainty: string;
}

export interface Metrics {
  active_events: number;
  critical_events: number;
  observing_assets: number;
  data_freshness_hours: number | null;
  coverage_percent: number | null;
  last_analysis_at: string;
  source_count: number;
  region_count: number;
  live_event_count: number;
  observation_count: number;
  coverage_basis: "undefined" | "source_availability";
}

export interface ObservationVariableSummary {
  id: "SST" | "TEMPERATURE" | "SALINITY" | "CHLA" | "NITRATE";
  label: string;
  unit: string;
  source: string;
  value_mode: "raw" | "adjusted" | "mixed" | "analysis" | "unavailable";
  available_count: number;
  total_count: number;
  availability_fraction: number | null;
  minimum: number | null;
  median: number | null;
  maximum: number | null;
}

export interface ObservationTimePoint {
  timestamp: string;
  minimum: number;
  median: number;
  maximum: number;
  sample_count: number;
}

export interface SstGridPoint {
  timestamp: string;
  latitude: number;
  longitude: number;
  temperature: number;
  analysis_error: number | null;
  sea_ice_fraction: number | null;
  quality_valid: boolean;
}

export interface RegionalObservationConclusion {
  state: "no_candidate" | "candidate_present";
  headline: string;
  summary: string;
  evidence: string[];
  interpretation_scope: string[];
  screening_rules: string[];
}

export interface RegionalObservationSummary {
  region_id: string;
  region: string;
  generated_at: string;
  bounds: [[number, number], [number, number]];
  observation_count: number;
  source_count: number;
  argo_profile_count: number;
  float_count: number;
  bgc_float_count: number;
  sampled_profile_count: number;
  profile_request_failures: number;
  profile_success_fraction: number | null;
  median_profile_depth: number | null;
  maximum_profile_depth: number | null;
  sst_lookback_days: number;
  sst_daily_steps: number;
  sst_latest_grid_count: number;
  sst_latest_points: SstGridPoint[];
  sst_native_resolution_degrees: number;
  sst_latitude_step_degrees: number | null;
  sst_longitude_step_degrees: number | null;
  noaa_quality_valid_count: number;
  noaa_point_count: number;
  noaa_quality_pass_fraction: number | null;
  quality_fields_complete: boolean;
  adjusted_surface_fraction: number | null;
  latest_observation_at: string | null;
  screening_event_count: number;
  variables: ObservationVariableSummary[];
  sst_timeline: ObservationTimePoint[];
  conclusion: RegionalObservationConclusion;
}

export interface ScientificReport {
  event_id: string;
  title: string;
  generated_at: string;
  confidence: number;
  executive_summary: string;
  situation: string;
  evidence_assessment: string[];
  mechanism: string[];
  uncertainty: string;
  monitoring_actions: string[];
  evidence_ids: string[];
}

export interface ArgoProfilePoint {
  pressure: number;
  pressure_mode?: "raw" | "adjusted";
  temperature: number | null;
  temperature_qc: number | null;
  salinity: number | null;
  salinity_qc: number | null;
  chla: number | null;
  chla_qc: number | null;
  nitrate: number | null;
  nitrate_qc: number | null;
  temperature_mode: "raw" | "adjusted" | null;
  salinity_mode: "raw" | "adjusted" | null;
  chla_mode: "raw" | "adjusted" | null;
  nitrate_mode: "raw" | "adjusted" | null;
}

export interface ArgoProfile {
  cycle: number;
  timestamp: string;
  updated_at: string | null;
  longitude: number;
  latitude: number;
  position_qc: number | null;
  timestamp_qc: number | null;
  direction: string | null;
  vertical_sampling_scheme: string | null;
  max_pressure: number | null;
  sample_count: number;
  surface: Record<string, number | null>;
  variable_modes: Record<string, "raw" | "adjusted" | "mixed" | "unavailable">;
  surface_modes: Record<string, "raw" | "adjusted" | "unavailable">;
  points: ArgoProfilePoint[];
  source_urls: string[];
  metadata_ids: string[];
}

export interface ArgoTrackPoint {
  cycle: number;
  timestamp: string;
  longitude: number;
  latitude: number;
}

export interface ArgoSource {
  name: string;
  url: string;
  gdac_url: string;
  source_urls: string[];
  credit: string;
}

export interface ArgoExplanation {
  headline: string;
  summary: string;
  findings: string[];
  caveats: string[];
  generated_at: string;
  method: string;
}

export interface ArgoCacheStatus {
  state: "fresh" | "stale";
  age_seconds: number;
  ttl_seconds: number;
}

export interface ArgoFloatSnapshot {
  platform: string;
  network: string;
  source: ArgoSource;
  fetched_at: string;
  source_updated_at: string | null;
  profile_count: number;
  profile_scope: "lifetime" | "regional_window";
  profile_window_days: number | null;
  latest: ArgoProfile;
  track: ArgoTrackPoint[];
  explanation: ArgoExplanation;
  cache: ArgoCacheStatus;
}

export interface ArgoFloatHistory {
  platform: string;
  requested_date_count: number;
  date_count: number;
  observation_dates: string[];
  fetched_at: string;
  profiles: ArgoProfile[];
  source_url: string;
}

export interface MonitoredBuoy {
  platform: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface CopernicusWaveRecord {
  timestamp: string | null;
  VHM0: number | null;
  VTM02: number | null;
  VMDR: number | null;
  VHM0_SW1: number | null;
  VTM01_SW1: number | null;
  VMDR_SW1: number | null;
  VHM0_WW: number | null;
  VTM01_WW: number | null;
  VMDR_WW: number | null;
}

export interface CopernicusWavePoint {
  dataset_id: string;
  longitude: number;
  latitude: number;
  requested_longitude: number;
  requested_latitude: number;
  grid_longitude: number;
  grid_latitude: number;
  grid_distance_km: number;
  coordinates_selection_method: string;
  spatial_interpolation_method: string;
  temporal_interpolation_method: string;
  horizontal_resolution_degrees: number;
  horizontal_resolution_km: number;
  temporal_resolution_hours: number;
  latest_valid_time: string | null;
  latency_reference_at: string;
  data_latency_seconds: number | null;
  data_latency_hours: number | null;
  physical_derivation: string;
  start_datetime: string;
  end_datetime: string;
  records: CopernicusWaveRecord[];
  fetched_at: string;
}

export interface CopernicusWindRecord {
  timestamp: string | null;
  eastward_wind: number | null;
  northward_wind: number | null;
  wind_speed: number | null;
  wind_direction_from: number | null;
}

export interface CopernicusWindPoint {
  dataset_id: string;
  longitude: number;
  latitude: number;
  requested_longitude: number;
  requested_latitude: number;
  grid_longitude: number;
  grid_latitude: number;
  grid_distance_km: number;
  coordinates_selection_method: string;
  spatial_interpolation_method: string;
  temporal_interpolation_method: string;
  horizontal_resolution_degrees: number;
  horizontal_resolution_km: number;
  temporal_resolution_hours: number;
  latest_valid_time: string | null;
  latency_reference_at: string;
  data_latency_seconds: number | null;
  data_latency_hours: number | null;
  physical_derivation: string;
  start_datetime: string;
  end_datetime: string;
  records: CopernicusWindRecord[];
  fetched_at: string;
}

export interface CopernicusCurrentField {
  dataset_id: string;
  product_id: string;
  fetched_at: string;
  timestamp: string | null;
  time_role: "latest_available_analysis" | "forecast";
  latency_seconds: number | null;
  latency_hours: number | null;
  depth: number | null;
  bounds: [[number, number], [number, number]];
  width: number;
  height: number;
  longitudes: number[];
  latitudes: number[];
  u: Array<number | null>;
  v: Array<number | null>;
  speed: Array<number | null>;
  valid_point_count: number;
  maximum_speed: number;
  mean_speed: number;
  variables: Record<string, { label: string; unit: string; meaning: string }>;
  data_class: string;
  animation_time_scale: string;
  source: { name: string; dataset_url: string };
  cache: { state: "fresh" | "stale"; age_seconds: number };
}

export interface CopernicusHistoryPage {
  source: "wave" | "wind";
  dataset_id: string;
  longitude: number;
  latitude: number;
  total: number;
  offset: number;
  limit: number;
  start_datetime: string | null;
  end_datetime: string | null;
  synced_at: string | null;
  records: Array<Record<string, string | number | null>>;
}

export interface ArgoRegionalFloat {
  platform: string;
  latest_profile_id: string;
  cycle: number;
  timestamp: string;
  longitude: number;
  latitude: number;
  profile_count: number;
  networks: string[];
  has_bgc: boolean;
  distance_km: number | null;
  within_event_radius: boolean;
}

export interface ArgoRegionSnapshot {
  region_id: string;
  region: string;
  bounds: [[number, number], [number, number]];
  lookback_days: number;
  fetched_at: string;
  profile_count: number;
  float_count: number;
  bgc_float_count: number;
  latest_observation_at: string | null;
  profiles: ArgoRegionalFloat[];
  floats: ArgoRegionalFloat[];
  source: ArgoSource;
  cache: ArgoCacheStatus;
}

export interface ArgoEventCoverage {
  event_id: string;
  event_title: string;
  event_center: [number, number];
  event_radius_km: number;
  radius_basis: RadiusBasis;
  regional_float_count: number;
  matched_count: number;
  match_mode: "within_event" | "nearest";
  candidates: ArgoRegionalFloat[];
  selected_platform: string;
  snapshot: ArgoFloatSnapshot;
  fetched_at: string;
}

export interface ArgoPointSelection {
  query_point: [number, number];
  region_id: string;
  region: string;
  regional_float_count: number;
  candidates: ArgoRegionalFloat[];
  nearest_platform: string;
  nearest_distance_km: number;
  selected_platform: string;
  selected_distance_km: number;
  snapshot: ArgoFloatSnapshot;
  fetched_at: string;
  marine_context: MarineContext | null;
}

export interface MarinePlace {
  name: string;
  name_en: string | null;
  mrgid: string | null;
  place_type: string;
  source_url: string | null;
  confidence: "high" | "medium" | "low";
}

export interface MarineKnowledgeReference {
  id: string;
  title: string;
  source_name: string;
  url: string | null;
}

export interface MarineEncyclopediaArticle {
  title: string;
  source_title: string | null;
  language: string;
  content_scope: "introduction" | "full" | "translated_introduction" | "translated_section";
  original_language: string | null;
  translation_method: string | null;
  extract: string;
  paragraphs: string[];
  url: string;
  page_id: number;
  revision_id: number;
  page_updated_at: string | null;
  snapshot_at: string;
  source_name: string;
  license: string;
  offline: boolean;
}

export interface MarineKnowledge {
  query_point: { longitude: number; latitude: number };
  sea_name: string;
  sea_name_en: string;
  display_name: string;
  place_type: string;
  parent_ocean?: string;
  fao_area: { code: string; name: string; name_en: string; source_url: string };
  overview: string;
  embedded: boolean;
  live_summary: string | null;
  encyclopedia: MarineEncyclopediaArticle | null;
  historical_significance: string[];
  human_geography: string[];
  maritime_routes: string[];
  coastal_livelihoods: string[];
  marine_culture: string[];
  fact_sheet: string[];
  physical_geography: string[];
  oceanographic_processes: string[];
  ecosystems: string[];
  learning_prompts: string[];
  key_terms: string[];
  references: MarineKnowledgeReference[];
  provider: string;
  live_retrieved: boolean;
  atlas_count: number;
  atlas_version: string;
  retrieved_at: string;
  errors: string[];
  caveats: string[];
  cache: ArgoCacheStatus;
}

export interface FisheryResource {
  scientific_name: string;
  scientific_name_authorship: string | null;
  chinese_name: string | null;
  chinese_name_source?: string | null;
  chinese_name_source_url?: string | null;
  common_name: string | null;
  english_name: string | null;
  taxon_rank: "species" | "subspecies";
  taxonomic_status: "accepted";
  taxon_class: string | null;
  taxon_order: string | null;
  family: string | null;
  taxon_group: string;
  aphia_id: number | null;
  fao_alpha3_code: string | null;
  fao_isscaap_group: string | null;
  fao_asfis_version: string;
  fao_fishstat_data: boolean;
  fishery_relevance: "fao_fishstat" | "fao_asfis";
  evidence_count: number;
  dataset_count: number;
  first_year: number | null;
  latest_year: number | null;
  minimum_distance_km: number;
  evidence_strength: "high" | "medium" | "limited";
  evidence_kind: "nearby_observation" | "regional_reference";
  source_url: string;
  asfis_source_url: string;
  worms_source_url: string | null;
}

export interface MarineContext {
  query_point: { longitude: number; latitude: number };
  sea_name: string;
  sea_name_en: string;
  display_name?: string | null;
  region_codes: string[];
  region_label?: string | null;
  place_type: string;
  place_source: string;
  place_source_url: string;
  confidence: "high" | "medium" | "low";
  matched_places: MarinePlace[];
  fisheries: FisheryResource[];
  fisheries_total_records: number;
  fisheries_species_count: number;
  fisheries_scanned_records: number;
  biodiversity_total_records: number;
  fisheries_results_complete: boolean;
  fisheries_search_radius_km: number;
  fisheries_radius_degrees: number;
  fisheries_source: string;
  fisheries_source_url: string;
  fisheries_asfis_version: string;
  fisheries_asfis_source_url: string;
  fao_area: { code: string; name: string; name_en: string; source_url: string };
  fetched_at: string;
  errors: string[];
  caveats: string[];
  cache: ArgoCacheStatus;
}

export interface BathymetrySample {
  direction: "center" | "north" | "east" | "south" | "west";
  longitude: number;
  latitude: number;
  elevation_m: number;
  water_depth_m: number;
  provider: string;
}

export interface BathymetryProfile {
  query_point: { longitude: number; latitude: number };
  query_radius_m: number;
  value_basis: "bilinear_grid_interpolation" | "point_service_grid_estimate";
  seafloor_elevation_m: number;
  water_depth_m: number;
  is_ocean: boolean;
  depth_zone: "land_or_intertidal" | "continental_shelf" | "continental_slope" | "abyssal" | "hadal";
  depth_zone_name: string;
  explanation: string;
  sample_radius_km: number;
  shallowest_depth_m: number;
  deepest_depth_m: number;
  local_relief_m: number;
  sample_count: number;
  samples: BathymetrySample[];
  provider: string;
  dataset: string;
  source_url: string;
  fallback_source_url: string;
  precision_mode: "gmrt_100m_grid" | "gmrt_point" | "gebco_grid";
  horizontal_resolution_m: number | null;
  interpolation_method: string;
  high_resolution_coverage: boolean;
  grid_node_count: number;
  micro_radius_m: number | null;
  micro_shallowest_depth_m: number | null;
  micro_deepest_depth_m: number | null;
  micro_relief_m: number | null;
  verification_provider: string | null;
  verification_elevation_m: number | null;
  verification_depth_m: number | null;
  source_difference_m: number | null;
  confidence: "high" | "medium" | "low";
  confidence_name: string;
  confidence_note: string;
  resolution_note: string;
  retrieved_at: string;
  errors: string[];
  cache: ArgoCacheStatus;
}

export interface OceanRegion {
  id: string;
  name: string;
  short_name: string;
  description: string;
  bounds: [[number, number], [number, number]];
  center: [number, number];
  zoom: number;
}

export interface SourceHealth {
  id: string;
  name: string;
  category: "in_situ" | "satellite" | "reanalysis" | "interpretation";
  status: "live" | "cached" | "configured" | "unavailable";
  observation_count: number;
  latest_observation_at: string | null;
  checked_at: string;
  latency_seconds: number | null;
  detail: string;
  url: string | null;
}

export interface CopernicusDatasetVolume {
  dataset_id: string;
  product_id: string;
  name: string;
  date: string;
  is_current_day: boolean;
  variable_count: number;
  time_count: number;
  spatial_point_count: number;
  record_count: number;
  value_count: number;
  latest_observation_at: string | null;
}

export interface CopernicusGlobalDataVolume {
  date: string;
  dataset_count: number;
  record_count: number;
  value_count: number;
  latest_observation_at: string | null;
  fetched_at: string;
  status: "live" | "partial";
  datasets: CopernicusDatasetVolume[];
  errors: string[];
  cache: { state: "fresh" | "stale"; age_seconds: number };
}

export interface DailyBriefing {
  date: string;
  region_id: string;
  status: "generated" | "published";
  generated_at: string;
  publish_at: string;
  published_at: string | null;
  headline: string;
  summary: string;
  highlights: string[];
  evidence: string[];
  anomaly_count: number;
  copernicus: {
    date: string | null;
    dataset_count: number;
    current_dataset_count: number;
    record_count: number;
    value_count: number;
    latest_observation_at: string | null;
    status: string | null;
  };
  argo: {
    window_start: string;
    window_end: string;
    uses_latest_available_window: boolean;
    profile_count: number;
    float_count: number;
    bgc_float_count: number;
    latest_observation_at: string | null;
    catalog_profile_count: number;
    catalog_float_count: number;
  };
  delivery: {
    in_app: string;
    webhook_configured: boolean;
    webhook_delivered_at: string | null;
    webhook_last_attempt_at: string | null;
    webhook_error: string | null;
  };
}

export interface DailyBriefingEnvelope {
  schedule: {
    time_zone: string;
    generate_time: string;
    publish_time: string;
  };
  briefing: DailyBriefing | null;
}

export interface DailyDashboardSeriesItem {
  id?: string;
  name: string;
  average: number;
  minimum: number;
  maximum: number;
  sample_count: number;
  coverage_mode?: "within_area" | "nearest_grid";
  center?: [number, number];
  minimum_anomaly?: number;
  maximum_anomaly?: number;
  minimum_point?: Record<string, string | number | boolean | null>;
  maximum_point?: Record<string, string | number | boolean | null>;
}

export interface DailyBriefingDashboard {
  generated_at: string;
  china_coastal_sst: DailyDashboardSeriesItem[];
  china_coastal_sea_state: DailyDashboardSeriesItem[];
  ocean_sst: DailyDashboardSeriesItem[];
  weather_anomalies: EventSummary[];
  news: {
    date: string;
    count: number;
    is_today_complete: boolean;
    items: Array<{ title: string; summary: string; source: string; url: string; published_at: string | null }>;
    errors: string[];
    sources: string[];
  };
  sources: { sst_latest_at: string | null; currents_latest_at: string | null; sea_state_definition: string };
}

export interface EventExplanation {
  event_id: string;
  provider: "external_api" | "evidence_engine";
  model: string;
  generated_at: string;
  headline: string;
  summary: string;
  findings: string[];
  mechanisms: string[];
  impacts: string[];
  caveats: string[];
  evidence_ids: string[];
  source_links: string[];
  method: string;
}

export interface RefreshResult {
  region_id: string;
  refreshed_at: string;
  event_count: number;
  observation_count: number;
  source_count: number;
  status: "completed" | "partial";
}

export interface RefreshJob {
  job_id: string;
  region_id: string;
  status: "queued" | "running" | "completed" | "partial" | "failed";
  created_at: string;
  updated_at: string;
  refreshed_at: string | null;
  result: RefreshResult | null;
  error: string | null;
}

export interface WorkspaceSnapshot {
  snapshot_id: string;
  region: OceanRegion;
  events: EventSummary[];
  event_counts: EventCounts;
  metrics: Metrics;
  sources: SourceHealth[];
  observations: RegionalObservationSummary;
  argo_region: ArgoRegionSnapshot | null;
  refreshed_at: string;
  cache_state: "fresh" | "stale";
  errors: string[];
  coverage: CoverageStatus;
}

export interface AgentConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentSourceContext {
  id: string;
  name: string;
  status: "live" | "cached" | "configured" | "unavailable";
  observation_count: number;
  latest_observation_at: string | null;
}

export interface AgentContextManifest {
  region_id: string;
  region: string;
  indexed_at: string;
  index_revision: string;
  full_index: boolean;
  record_count: number;
  observation_count: number;
  candidate_count: number;
  confirmed_event_count: number;
  source_count: number;
  live_source_count: number;
  variable_counts: Record<string, number>;
  data_mode_counts: Record<string, number>;
  earliest_record_at: string | null;
  latest_record_at: string | null;
  indexed_fields: string[];
  sources: AgentSourceContext[];
  answer_engine: "local_retrieval" | "external_model";
  model: string;
  external_model: string | null;
  model_status: "available" | "cooldown" | "unconfigured";
  model_retry_after_seconds: number;
}

export interface AgentCitation {
  id: string;
  kind: "record" | "source" | "statistic";
  title: string;
  subtitle: string;
  event_id: string | null;
  source_id: string | null;
  variables: string[];
  observed_at: string | null;
  relevance: number;
}

export interface AgentResearchStep {
  key: "interpret" | "retrieve" | "cross_check" | "synthesize";
  label: string;
  detail: string;
  evidence_count: number;
}

export interface AgentQueryPlan {
  mode: "quick" | "research";
  intent: "latest_observations" | "candidate_review" | "source_health" | "coverage_audit" | "comparison" | "record_explanation" | "general_research";
  intent_label: string;
  time_scope: string;
  variables: string[];
  evidence_strategy: string;
  steps: AgentResearchStep[];
}

export interface AgentRuntimeProfile {
  architecture: "langgraph_state_graph";
  framework: "LangGraph";
  framework_version: string;
  checkpoint_backend: "sqlite";
  long_term_store: "langgraph_sqlite_store";
  durable_execution: boolean;
  memory_layers: Array<"working" | "episodic" | "semantic" | "procedural">;
  reply_strategy: "evidence_first";
  nodes: string[];
  execution_trace: string[];
}

export interface AgentChatRequest {
  region_id: string;
  question: string;
  selected_event_id?: string | null;
  session_id?: string | null;
  remember?: boolean;
  analysis_mode?: "quick" | "research";
  history?: AgentConversationMessage[];
}

export interface AgentStoredMessage extends AgentConversationMessage {
  id: string;
  session_id: string;
  created_at: string;
  citations: AgentCitation[];
  provider: "local_retrieval" | "external_model" | null;
  model: string | null;
  retrieved_record_count: number;
  query_plan: AgentQueryPlan | null;
  runtime_profile: AgentRuntimeProfile | null;
  notes: string[];
}

export interface AgentSession {
  id: string;
  title: string;
  region_id: string;
  selected_event_id: string | null;
  summary: string;
  message_count: number;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  archived: boolean;
}

export interface AgentSessionDetail extends AgentSession {
  messages: AgentStoredMessage[];
}

export interface AgentMemory {
  id: string;
  kind: "preference" | "instruction" | "focus";
  content: string;
  region_id: string | null;
  source_session_id: string | null;
  source_message_id: string | null;
  confidence: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  use_count: number;
}

export interface AgentChatResponse {
  answer: string;
  generated_at: string;
  provider: "local_retrieval" | "external_model";
  model: string;
  context: AgentContextManifest;
  citations: AgentCitation[];
  retrieved_record_count: number;
  follow_up_questions: string[];
  notes: string[];
  session: AgentSession | null;
  memories_used: AgentMemory[];
  query_plan: AgentQueryPlan;
  runtime_profile: AgentRuntimeProfile;
}

export type ApiProviderName = "openai" | "deepseek" | "custom";
export type ProviderApiMode = "responses" | "chat_completions";

export interface UserPublic {
  id: string;
  email: string;
  display_name: string;
  created_at: string;
}

export interface AuthSession {
  user: UserPublic | null;
  csrf_token: string | null;
  expires_at?: string | null;
}

export interface AuthenticatedSession extends AuthSession {
  user: UserPublic;
  csrf_token: string;
}

export interface ProviderPreset {
  id: ApiProviderName;
  label: string;
  base_url: string | null;
  api_mode: ProviderApiMode;
}

export interface UserApiConfig {
  provider: ApiProviderName;
  base_url: string;
  model: string;
  has_api_key: boolean;
  api_mode: ProviderApiMode;
  updated_at: string;
}

export interface UserApiConfigUpdate {
  provider: ApiProviderName;
  model: string;
  base_url?: string | null;
  api_key?: string;
  api_mode?: ProviderApiMode;
}

export interface ProviderModelDiscoveryRequest {
  provider: ApiProviderName;
  base_url?: string | null;
  api_key?: string;
  api_mode?: ProviderApiMode;
}

export interface ProviderConnectionTestResult {
  ok: true;
  base_url: string;
  model: string;
  api_mode: ProviderApiMode;
  latency_ms: number;
  message: string;
}

export interface ProviderModelDiscoveryResult {
  ok: true;
  provider: ApiProviderName;
  base_url: string;
  models: string[];
  fetched_at: string;
  message: string;
}
