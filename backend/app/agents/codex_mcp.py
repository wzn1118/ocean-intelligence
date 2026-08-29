from __future__ import annotations

import asyncio
import csv
import hashlib
import hmac
import io
import json
import math
import os
import statistics
import base64
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

from fastapi import APIRouter, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, StreamingResponse

from app.agents.data_context import build_agent_manifest, model_runtime_snapshot
from app.agents.memory_store import AgentMemoryStore
from app.agents.agent_graph import answer_agent_question
from app.agents.event_detection import OceanEventDetectionAgent
from app.agents.explanation import explain_event
from app.agents.report_generation import ReportGenerationAgent
from app.data.argo_client import get_argo_float, get_argo_float_history, get_argo_region, get_nearest_argo, get_event_argo
from app.data.copernicus_client import (
    COPERNICUS_DATASET_ID,
    COPERNICUS_WIND_DATASET_ID,
    WAVE_VARIABLES,
    WIND_VARIABLES,
    get_wave_point,
    get_wave_region,
    get_wind_point,
    get_wind_region,
    get_current_field,
    get_global_daily_data_volume,
)
from app.data.copernicus_history import query_point_history, sync_point_history
from app.data.copernicus_universal import analyze_dataset, describe_dataset, search_catalogue
from app.data.mainland_ocean_news import get_mainland_ocean_news
from app.data.literature_client import search_literature
from app.data.marine_area_resolver import resolve_marine_area
from app.data.marine_context import get_marine_context
from app.data.marine_knowledge import get_marine_knowledge
from app.data.marine_atlas import ATLAS_VERSION, MARINE_ATLAS, atlas_entry, atlas_profile, atlas_search, atlas_supplement
from app.data.bathymetry import get_bathymetry
from app.data.daily_dashboard import get_daily_dashboard
from app.data.noaa_currents_client import get_noaa_currents
from app.data.noaa_client import get_noaa_sst
from app.data.noaa_carbon_client import get_noaa_carbon
from app.data.noaa_ocean_color_client import get_noaa_chlorophyll_anomaly, get_noaa_chlorophyll_observations
from app.data.woa_nitrate import get_woa_nitrate
from app.data.woa_salinity import get_woa_salinity
from app.data.realtime_service import get_argo_realtime_status, get_event_lifecycle_records, get_global_copernicus_event_page
from app.data.realtime_service import get_realtime_bundle
from app.daily_briefing import get_daily_briefing, local_schedule
from app.copernicus_daily_index import index_status, read_event_page
from app.data.ocean_physics import calculate_ocean_physics
from app.data.ocean_statistics import calculate_ocean_statistics
from app.data.anomaly_linkage import analyze_anomaly_linkages
from app.data.regions import DEFAULT_REGION_ID, REGIONS, get_region
from app.data.spatial_grid import build_nine_zone_grid, summarize_nine_zone_points
from app.models import AgentChatRequest, DetectionRequest
from app.refresh_jobs import enqueue_refresh, get_refresh_job
from app.performance import PERFORMANCE
from app.agents.mcp_infrastructure import McpStateStore, SignedCursor, ToolGovernor, ToolGovernorError


router = APIRouter(tags=["Codex MCP"])
memory_store = AgentMemoryStore()
report_agent = ReportGenerationAgent()
detection_agent = OceanEventDetectionAgent()

SERVER_NAME = "ocean-intelligence"
SERVER_VERSION = "2.1.0"
SUPPORTED_PROTOCOLS = {"2024-11-05", "2025-03-26", "2025-06-18"}
MCP_STATE = McpStateStore()
MCP_GOVERNOR = ToolGovernor()
MCP_JOB_EXECUTOR = ThreadPoolExecutor(max_workers=max(2, int(os.getenv("OCEAN_MCP_JOB_WORKERS", "4"))), thread_name_prefix="ocean-mcp-job")
MCP_CANCELLED_REQUESTS: set[str] = set()
MCP_CANCEL_LOCK = threading.RLock()
MCP_INTERNAL_OWNER = threading.local()
MCP_SNAPSHOT_TTL = max(60, int(os.getenv("OCEAN_MCP_SNAPSHOT_TTL_SECONDS", "1800")))
MCP_TOOL_TIMEOUT = max(1, int(os.getenv("OCEAN_MCP_TOOL_TIMEOUT_SECONDS", "45")))
MCP_MAX_RESPONSE_BYTES = max(65536, int(os.getenv("OCEAN_MCP_MAX_RESPONSE_BYTES", "8388608")))
PROMPTS = [
    {
        "name": "regional_ocean_assessment",
        "description": "Perform a traceable, nine-zone regional ocean assessment.",
        "arguments": [
            {"name": "area", "description": "Chinese or English sea-area name, or a registered region id.", "required": True},
            {"name": "focus", "description": "Optional scientific focus such as SST, wave, wind, current, ecology or carbon.", "required": False},
        ],
    },
    {
        "name": "event_evidence_review",
        "description": "Review an event or observation record without overstating its validation status.",
        "arguments": [{"name": "event_id", "description": "Product event or observation identifier.", "required": True}],
    },
]
RESOURCE_TEMPLATES = [
    {"uriTemplate": "ocean://regions/{region_id}/manifest", "name": "Regional data manifest", "description": "Current regional counts, variables, coverage and source status.", "mimeType": "application/json"},
    {"uriTemplate": "ocean://regions/{region_id}/datasets", "name": "Regional pageable dataset catalogue", "description": "Exact counts and schemas for every MCP-pageable regional dataset.", "mimeType": "application/json"},
    {"uriTemplate": "ocean://regions/{region_id}/copernicus/waves", "name": "Regional wave snapshot", "description": "Copernicus Marine wave snapshot for a registered region.", "mimeType": "application/json"},
    {"uriTemplate": "ocean://regions/{region_id}/copernicus/wind", "name": "Regional wind snapshot", "description": "Copernicus Marine wind snapshot for a registered region.", "mimeType": "application/json"},
]


def _tool(
    name: str,
    description: str,
    properties: dict[str, Any],
    *,
    required: list[str] | None = None,
) -> dict[str, Any]:
    visible_properties = {key: value for key, value in properties.items() if key not in {"owner_id", "owner_signature", "__tenant_token"}}
    visible_required = [key for key in (required or []) if key in visible_properties]
    return {
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": visible_properties,
            "required": visible_required,
            "additionalProperties": False,
        },
        "outputSchema": {"oneOf": [{"type": "object"}, {"type": "array"}]},
    }


TOOLS = [
    _tool(
        "ocean_list_regions",
        "List every ocean observation region available to the product.",
        {},
    ),
    _tool(
        "ocean_resolve_marine_area",
        "Recognize any named ocean, sea, gulf, bay, strait or channel from free text and/or locate the marine area containing a point. Text names take priority; conflicts are returned explicitly.",
        {
            "query": {"type": "string", "default": "", "description": "Full user text or a Chinese/English marine-area name."},
            "longitude": {"type": "number", "minimum": -180, "maximum": 180},
            "latitude": {"type": "number", "minimum": -90, "maximum": 90},
        },
    ),
    _tool(
        "ocean_region_nine_zone_grid",
        "Locate the analysis center point and divide any sea-area bounds into northwest, north, northeast, west, center, east, southwest, south and southeast zones for fine-grained reporting.",
        {
            "region_id": {"type": "string", "description": "Optional registered product region id."},
            "minimum_longitude": {"type": "number", "minimum": -180, "maximum": 180},
            "maximum_longitude": {"type": "number", "minimum": -180, "maximum": 180},
            "minimum_latitude": {"type": "number", "minimum": -90, "maximum": 90},
            "maximum_latitude": {"type": "number", "minimum": -90, "maximum": 90},
        },
    ),
    _tool(
        "ocean_nine_zone_point_inventory",
        "Assign point observations to the report's nine zones and calculate raw records, valid records, unique platforms, platform types, variables, QC fractions, latest times, density and unassigned-record audit.",
        {
            "region_id": {"type": "string", "description": "Optional registered product region id."},
            "minimum_longitude": {"type": "number", "minimum": -180, "maximum": 180},
            "maximum_longitude": {"type": "number", "minimum": -180, "maximum": 180},
            "minimum_latitude": {"type": "number", "minimum": -90, "maximum": 90},
            "maximum_latitude": {"type": "number", "minimum": -90, "maximum": 90},
            "source_complete": {"type": "boolean", "default": True, "description": "True only when every intended point source completed successfully."},
            "source_errors": {"type": "array", "maxItems": 30, "items": {"type": "string"}},
            "ocean_areas": {
                "type": "array",
                "maxItems": 9,
                "description": "Optional effective ocean area by zone for density calculation.",
                "items": {
                    "type": "object",
                    "properties": {
                        "zone": {"type": "string", "enum": ["西北", "北", "东北", "西", "中间", "东", "西南", "南", "东南"]},
                        "area_km2": {"type": "number", "exclusiveMinimum": 0},
                    },
                    "required": ["zone", "area_km2"],
                    "additionalProperties": False,
                },
            },
            "points": {
                "type": "array",
                "minItems": 0,
                "maxItems": 5000,
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "platform_id": {"type": "string"},
                        "platform_type": {"type": "string"},
                        "longitude": {"type": ["number", "null"]},
                        "latitude": {"type": ["number", "null"]},
                        "variable": {"type": "string"},
                        "observed_at": {"type": "string"},
                        "record_count": {"type": "integer", "minimum": 0, "default": 1},
                        "valid_record_count": {"type": "integer", "minimum": 0},
                        "qc_passed": {"type": "boolean", "default": True},
                    },
                    "additionalProperties": False,
                },
            },
        },
        required=["points"],
    ),
    _tool(
        "ocean_anomaly_point_linkage",
        "Rank anomaly candidates and collocate nearby observations using great-circle distance, UTC time difference, optional depth difference, source independence and L1-L5 linkage levels. Use this for global/zone anomaly rankings, nearby-platform inventories and direct-validation eligibility.",
        {
            "core_radius_km": {"type": "number", "exclusiveMinimum": 0, "default": 25},
            "local_radius_km": {"type": "number", "exclusiveMinimum": 0, "default": 75},
            "background_radius_km": {"type": "number", "exclusiveMinimum": 0, "default": 150},
            "time_tolerance_hours": {"type": "number", "exclusiveMinimum": 0, "default": 24},
            "depth_tolerance_m": {"type": "number", "minimum": 0, "default": 10},
            "candidates": {
                "type": "array",
                "minItems": 1,
                "maxItems": 500,
                "items": {
                    "type": "object",
                    "properties": {
                        "candidate_id": {"type": "string"},
                        "id": {"type": "string"},
                        "variable": {"type": "string"},
                        "value": {"type": "number"},
                        "unit": {"type": "string"},
                        "baseline_value": {"type": "number"},
                        "anomaly_value": {"type": "number"},
                        "robust_z_score": {"type": "number"},
                        "percentile": {"type": "number", "minimum": 0, "maximum": 100},
                        "persistence_hours": {"type": "number", "minimum": 0},
                        "spatial_support_count": {"type": "integer", "minimum": 0},
                        "source_agreement_count": {"type": "integer", "minimum": 0},
                        "qc_confidence": {"type": "number", "minimum": 0, "maximum": 1},
                        "latency_hours": {"type": "number", "minimum": 0},
                        "missing_fraction": {"type": "number", "minimum": 0, "maximum": 1},
                        "edge_effect_penalty": {"type": "number", "minimum": 0, "maximum": 1},
                        "longitude": {"type": "number", "minimum": -180, "maximum": 180},
                        "latitude": {"type": "number", "minimum": -90, "maximum": 90},
                        "depth": {"type": "number"},
                        "valid_time": {"type": "string"},
                        "zone": {"type": "string"},
                        "source_id": {"type": "string"},
                        "source_family": {"type": "string"},
                        "platform_id": {"type": "string"},
                    },
                    "required": ["variable", "longitude", "latitude"],
                    "additionalProperties": False,
                },
            },
            "points": {
                "type": "array",
                "maxItems": 5000,
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "platform_id": {"type": "string"},
                        "platform_type": {"type": "string"},
                        "variable": {"type": "string"},
                        "longitude": {"type": "number", "minimum": -180, "maximum": 180},
                        "latitude": {"type": "number", "minimum": -90, "maximum": 90},
                        "depth": {"type": "number"},
                        "observed_at": {"type": "string"},
                        "valid_time": {"type": "string"},
                        "source_id": {"type": "string"},
                        "source_family": {"type": "string"},
                        "is_independent": {"type": "boolean"},
                        "qc_passed": {"type": "boolean", "default": True},
                    },
                    "required": ["variable", "longitude", "latitude"],
                    "additionalProperties": False,
                },
            },
        },
        required=["candidates", "points"],
    ),
    _tool(
        "ocean_context_manifest",
        "Return a compact manifest of record counts, variables, time coverage, and source health for one region.",
        {"region_id": {"type": "string", "description": "Ocean region id."}},
        required=["region_id"],
    ),
    _tool(
        "ocean_search_records",
        "Search measured observations and anomaly candidates without loading the full dataset. Routine observations remain neutrally labelled; only event_kind=anomaly is an anomaly candidate.",
        {
            "region_id": {"type": "string"},
            "query": {"type": "string", "default": ""},
            "variable": {"type": "string", "description": "Optional variable such as SST, SALINITY, CHLA, NITRATE, CURRENT, PCO2, WAVE_HEIGHT, SWELL_HEIGHT, or WIND_WAVE_HEIGHT."},
            "kind": {"type": "string", "enum": ["all", "observation", "candidate"], "default": "all"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 25},
        },
        required=["region_id"],
    ),
    _tool(
        "ocean_get_event",
        "Return the complete evidence record for one observation or anomaly candidate.",
        {
            "event_id": {"type": "string"},
            "region_id": {"type": "string", "default": DEFAULT_REGION_ID},
        },
        required=["event_id"],
    ),
    _tool(
        "ocean_source_health",
        "Return current source availability, observation counts, timestamps, and latency for one region.",
        {"region_id": {"type": "string"}},
        required=["region_id"],
    ),
    _tool(
        "ocean_mainland_news",
        "Reuse the product's current 早报 news module and return filtered Chinese mainland media ocean news for the report's 新闻页面. News is contextual media information, never a substitute for measured or modelled ocean evidence.",
        {
            "query": {"type": "string", "default": "", "description": "Optional relevance terms, e.g. 北部湾 广西 湛江 防城港 钦州 海南 航运 渔业."},
            "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 15},
            "force_refresh": {"type": "boolean", "default": False},
        },
    ),
    _tool(
        "ocean_get_argo_profile",
        "Return the latest measured Argo float profile, QC fields, position history, and depth dimensions for one platform.",
        {"platform": {"type": "string", "description": "Seven-digit Argo platform number."}},
        required=["platform"],
    ),
    _tool(
        "ocean_copernicus_catalog_search",
        "Dynamically search the complete Copernicus Marine catalogue by scientific topic, product id or dataset id. Use this before analysis when the correct dataset is not already known.",
        {
            "query": {"type": "string", "default": "", "description": "Scientific search text such as wind, chlorophyll, nitrate, sea level, wave, current, oxygen or temperature."},
            "product_id": {"type": "string", "default": ""},
            "dataset_id": {"type": "string", "default": ""},
            "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20},
            "offset": {"type": "integer", "minimum": 0, "default": 0},
        },
    ),
    _tool(
        "ocean_copernicus_dataset_describe",
        "Describe any Copernicus Marine dataset, including every available variable short name, unit, coordinate coverage, version and service. Call this before a generic dataset analysis.",
        {"dataset_id": {"type": "string"}},
        required=["dataset_id"],
    ),
    _tool(
        "ocean_copernicus_dataset_analyze",
        "Query and statistically analyse a bounded subset of any Copernicus Marine dataset. Supports arbitrary catalogue dataset ids, variables, longitude/latitude bounds, time ranges and optional depth bounds. Returns report-ready statistics, timelines, samples, exact/downsample scope, valid time, fetch time and evidence limitations.",
        {
            "dataset_id": {"type": "string"},
            "variables": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 12},
            "minimum_longitude": {"type": "number", "minimum": -180, "maximum": 180},
            "maximum_longitude": {"type": "number", "minimum": -180, "maximum": 180},
            "minimum_latitude": {"type": "number", "minimum": -90, "maximum": 90},
            "maximum_latitude": {"type": "number", "minimum": -90, "maximum": 90},
            "start_datetime": {"type": "string", "description": "ISO 8601 UTC timestamp. Defaults to 24 hours before end_datetime."},
            "end_datetime": {"type": "string", "description": "ISO 8601 UTC timestamp. Defaults to now."},
            "minimum_depth": {"type": "number"},
            "maximum_depth": {"type": "number"},
            "coordinates_selection_method": {"type": "string", "enum": ["inside", "strict-inside", "nearest", "outside"], "default": "inside"},
            "derived_vectors": {
                "type": "array",
                "maxItems": 4,
                "description": "Optional vector magnitudes calculated before aggregation, for example wind_speed from eastward_wind and northward_wind.",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "eastward": {"type": "string"},
                        "northward": {"type": "string"},
                        "long_name": {"type": "string"},
                        "units": {"type": "string"},
                    },
                    "required": ["name", "eastward", "northward"],
                    "additionalProperties": False,
                },
            },
            "maximum_values": {"type": "integer", "minimum": 5000, "maximum": 250000, "default": 80000},
            "timeline_limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 48},
            "sample_limit": {"type": "integer", "minimum": 0, "maximum": 50, "default": 12},
        },
        required=[
            "dataset_id",
            "variables",
            "minimum_longitude",
            "maximum_longitude",
            "minimum_latitude",
            "maximum_latitude",
        ],
    ),
    _tool(
        "ocean_physics_diagnostics",
        "Calculate reproducible physical-oceanography diagnostics with equations, units, assumptions, textbook reference basis and validity limits. Supports rotation, geostrophy, Ekman transport/pumping and coastal upwelling-favourable transport, Sverdrup balance, stratification, Richardson and Eady diagnostics, thermal wind, kinematics, finite-depth wave-current interaction, mixed-layer heat budgets and nondimensional scale analysis. Use measured or analysed inputs; never invent missing gradients or scales.",
        {
            "operation": {
                "type": "string",
                "enum": ["rotation", "geostrophic_velocity", "wind_stress_ekman_transport", "coastal_upwelling_transport", "deep_water_wave_energy_flux", "stratification", "thermal_wind_shear", "scale_analysis", "gradient_richardson_number", "eady_growth_rate", "ekman_pumping", "sverdrup_transport", "kinematic_diagnostics", "finite_depth_wave", "wave_current_interaction", "mixed_layer_heat_tendency", "mixed_layer_budget"],
            },
            "latitude": {"type": "number", "minimum": -90, "maximum": 90, "description": "Degrees north; negative in the Southern Hemisphere."},
            "sea_surface_height_gradient_east": {"type": "number", "description": "d(SSH)/dx in metres per metre, positive eastward."},
            "sea_surface_height_gradient_north": {"type": "number", "description": "d(SSH)/dy in metres per metre, positive northward."},
            "eastward_wind": {"type": "number", "description": "10 m eastward wind component in m/s."},
            "northward_wind": {"type": "number", "description": "10 m northward wind component in m/s."},
            "wind_stress_curl": {"type": "number", "description": "Vertical curl of wind stress, d(tau_y)/dx - d(tau_x)/dy, in N/m3 using metric distances."},
            "eastward_wind_stress": {"type": "number", "description": "Optional tau_x in N/m2 for beta correction in Ekman pumping."},
            "northward_wind_stress": {"type": "number", "description": "Tau_y in N/m2 for coastline-projected Ekman transport."},
            "offshore_direction_degrees": {"type": "number", "description": "Local offshore direction clockwise from true north; document how the coastline normal was estimated."},
            "significant_wave_height": {"type": "number", "exclusiveMinimum": 0, "description": "Hs in metres."},
            "energy_period": {"type": "number", "exclusiveMinimum": 0, "description": "Wave energy period Te in seconds, not peak period unless explicitly approximated."},
            "wave_period": {"type": "number", "exclusiveMinimum": 0, "description": "Representative wave period in seconds for finite-depth dispersion."},
            "current_along_wave": {"type": "number", "description": "Current component along wave propagation in m/s; positive following, negative opposing."},
            "water_depth": {"type": "number", "exclusiveMinimum": 0, "description": "Optional depth in metres for checking deep-water validity."},
            "upper_density": {"type": "number", "exclusiveMinimum": 0, "description": "Potential density of upper level in kg/m3."},
            "lower_density": {"type": "number", "exclusiveMinimum": 0, "description": "Potential density of deeper level in kg/m3."},
            "vertical_separation": {"type": "number", "exclusiveMinimum": 0, "description": "Positive-downward level separation in metres."},
            "density_gradient_east": {"type": "number", "description": "Horizontal potential-density gradient d(rho)/dx in kg/m4."},
            "density_gradient_north": {"type": "number", "description": "Horizontal potential-density gradient d(rho)/dy in kg/m4."},
            "velocity_scale": {"type": "number", "exclusiveMinimum": 0, "description": "Observed feature velocity scale U in m/s."},
            "horizontal_length_scale": {"type": "number", "exclusiveMinimum": 0, "description": "Observed feature horizontal scale L in metres."},
            "vertical_scale": {"type": "number", "exclusiveMinimum": 0, "description": "Observed layer or feature scale H in metres."},
            "buoyancy_frequency": {"type": "number", "exclusiveMinimum": 0, "description": "Representative N in s-1."},
            "eastward_shear": {"type": "number", "description": "du/dz in s-1 using z positive upward."},
            "northward_shear": {"type": "number", "description": "dv/dz in s-1 using z positive upward."},
            "reynolds_number": {"type": "number", "exclusiveMinimum": 0, "description": "Optional Reynolds number used when interpreting Ri."},
            "reduced_gravity": {"type": "number", "exclusiveMinimum": 0, "description": "Reduced gravity g-prime in m/s2."},
            "du_dx": {"type": "number", "description": "Eastward velocity x-gradient in s-1."},
            "du_dy": {"type": "number", "description": "Eastward velocity y-gradient in s-1."},
            "dv_dx": {"type": "number", "description": "Northward velocity x-gradient in s-1."},
            "dv_dy": {"type": "number", "description": "Northward velocity y-gradient in s-1."},
            "net_surface_heat_flux": {"type": "number", "description": "Net surface heat flux in W/m2, positive into the ocean."},
            "mixed_layer_depth": {"type": "number", "exclusiveMinimum": 0, "description": "Mixed-layer depth in metres, with criterion documented by the caller."},
            "horizontal_advection_temperature_tendency": {"type": "number", "description": "Horizontal-advection contribution to mixed-layer temperature tendency in K/day."},
            "vertical_advection_temperature_tendency": {"type": "number", "description": "Vertical-advection contribution to mixed-layer temperature tendency in K/day."},
            "entrainment_temperature_tendency": {"type": "number", "description": "Entrainment contribution to mixed-layer temperature tendency in K/day."},
            "diffusion_temperature_tendency": {"type": "number", "description": "Resolved diffusion/mixing contribution to mixed-layer temperature tendency in K/day."},
            "observed_temperature_tendency": {"type": "number", "description": "Observed or analysed mixed-layer temperature tendency in K/day for residual closure."},
            "heat_capacity": {"type": "number", "exclusiveMinimum": 0, "default": 3990.0, "description": "Seawater heat capacity in J/(kg K)."},
            "air_density": {"type": "number", "exclusiveMinimum": 0, "default": 1.225},
            "seawater_density": {"type": "number", "exclusiveMinimum": 0, "default": 1025.0},
            "gravity": {"type": "number", "exclusiveMinimum": 0, "default": 9.80665},
        },
        required=["operation"],
    ),
    _tool(
        "ocean_statistical_diagnostics",
        "Calculate reproducible weighted summaries, robust short-window trends, vector/directional statistics, lag correlations and robust anomaly candidates for report charts. Returns sample counts, methods and limitations.",
        {
            "operation": {"type": "string", "enum": ["weighted_summary", "robust_trend", "vector_summary", "lag_correlation", "anomaly_detection"]},
            "values": {"type": "array", "items": {"type": "number"}, "minItems": 1, "maxItems": 10000},
            "weights": {"type": "array", "items": {"type": "number"}, "minItems": 1, "maxItems": 10000},
            "time_step_hours": {"type": "number", "exclusiveMinimum": 0},
            "eastward_values": {"type": "array", "items": {"type": "number"}, "minItems": 1, "maxItems": 10000},
            "northward_values": {"type": "array", "items": {"type": "number"}, "minItems": 1, "maxItems": 10000},
            "x_values": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 10000},
            "y_values": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 10000},
            "maximum_lag": {"type": "integer", "minimum": 0, "maximum": 1000},
            "baseline_values": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 10000},
            "z_threshold": {"type": "number", "exclusiveMinimum": 0},
        },
        required=["operation"],
    ),
    _tool(
        "ocean_copernicus_wave_point",
        "Query Copernicus Marine global wave analysis/forecast at the nearest model grid point. Returns total wave, swell and wind-wave height, period and direction. This is numerical model output, not an in-situ measurement or official warning.",
        {
            "longitude": {"type": "number", "minimum": -180, "maximum": 180},
            "latitude": {"type": "number", "minimum": -90, "maximum": 90},
            "days_back": {"type": "integer", "minimum": 1, "maximum": 7, "default": 3},
            "forecast_hours": {"type": "integer", "minimum": 0, "maximum": 240, "default": 0},
            "limit": {"type": "integer", "minimum": 1, "maximum": 160, "default": 80},
        },
        required=["longitude", "latitude"],
    ),
    _tool(
        "ocean_copernicus_wave_region",
        "Return a bounded five-point Copernicus Marine wave snapshot for a product region, including model valid times, cache state, variable definitions and total-wave/swell/wind-wave fields.",
        {
            "region_id": {"type": "string"},
            "days_back": {"type": "integer", "minimum": 1, "maximum": 7, "default": 3},
            "forecast_hours": {"type": "integer", "minimum": 0, "maximum": 240, "default": 0},
            "force_refresh": {"type": "boolean", "default": False},
        },
        required=["region_id"],
    ),
    _tool(
        "ocean_copernicus_wave_audit",
        "Audit how Copernicus Marine wave data is represented in the regional evidence index. Separates model records, automated anomaly candidates, source freshness, cache state and scientific limitations.",
        {"region_id": {"type": "string"}},
        required=["region_id"],
    ),
    _tool(
        "ocean_copernicus_wind_point",
        "Query the Copernicus Marine hourly sea-surface wind L4 blended analysis at the nearest grid point. Returns vector components, derived speed and meteorological from-direction. This is not an in-situ anemometer reading or official warning.",
        {
            "longitude": {"type": "number", "minimum": -180, "maximum": 180},
            "latitude": {"type": "number", "minimum": -90, "maximum": 90},
            "days_back": {"type": "integer", "minimum": 1, "maximum": 7, "default": 3},
            "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 100},
        },
        required=["longitude", "latitude"],
    ),
    _tool(
        "ocean_copernicus_wind_region",
        "Return a bounded five-point Copernicus Marine hourly sea-surface wind snapshot for a product region with cache, valid-time and evidence-class metadata.",
        {
            "region_id": {"type": "string"},
            "days_back": {"type": "integer", "minimum": 1, "maximum": 7, "default": 3},
            "force_refresh": {"type": "boolean", "default": False},
        },
        required=["region_id"],
    ),
    _tool(
        "ocean_copernicus_history",
        "Synchronize or read a bounded page from the local Copernicus Marine point-history store for wave or wind. Sync may be expensive and should be used only when the user asks for historical coverage, trend analysis or export.",
        {
            "source": {"type": "string", "enum": ["wave", "wind"]},
            "longitude": {"type": "number", "minimum": -180, "maximum": 180},
            "latitude": {"type": "number", "minimum": -90, "maximum": 90},
            "sync": {"type": "boolean", "default": False},
            "limit": {"type": "integer", "minimum": 1, "maximum": 500, "default": 100},
            "offset": {"type": "integer", "minimum": 0, "default": 0},
        },
        required=["source", "longitude", "latitude"],
    ),
    _tool(
        "ocean_copernicus_audit",
        "Audit all Copernicus Marine evidence in one region: wave analysis/forecast, blended wind analysis, source freshness, routine records, threshold candidates and joint strong-wind/high-wave risk candidates.",
        {"region_id": {"type": "string"}},
        required=["region_id"],
    ),
    _tool(
        "ocean_memory_search",
        "Retrieve explicit long-term product preferences, instructions, and research focus relevant to the current question.",
        {
            "query": {"type": "string", "description": "The current user question or research task."},
            "region_id": {"type": "string", "description": "Optional ocean region id."},
            "limit": {"type": "integer", "minimum": 1, "maximum": 24, "default": 8},
            "owner_id": {"type": "string", "description": "Internal signed user scope."},
            "owner_signature": {"type": "string", "description": "Internal user-scope signature."},
        },
        required=["query", "owner_id", "owner_signature"],
    ),
    _tool(
        "ocean_memory_store",
        "Persist an explicit user preference, instruction, or durable research focus for future sessions. Use only when the user clearly asks to remember it.",
        {
            "kind": {"type": "string", "enum": ["preference", "instruction", "focus"]},
            "content": {"type": "string", "minLength": 1, "maxLength": 500},
            "region_id": {"type": "string", "description": "Optional ocean region id."},
            "owner_id": {"type": "string", "description": "Internal signed user scope."},
            "owner_signature": {"type": "string", "description": "Internal user-scope signature."},
        },
        required=["kind", "content", "owner_id", "owner_signature"],
    ),
    _tool("ocean_product_health", "Return product health and connected event count.", {}),
    _tool("ocean_product_metrics", "Return regional product metrics and source bundles.", {"region_id": {"type": "string"}}),
    _tool("ocean_observation_summary", "Return the observation summary for a registered region.", {"region_id": {"type": "string"}}, required=["region_id"]),
    _tool("ocean_event_catalog", "List product events and observation records for a region.", {"region_id": {"type": "string"}, "variable": {"type": "string"}, "limit": {"type": "integer", "minimum": 1, "maximum": 500}}, required=["region_id"]),
    _tool("ocean_event_lifecycle", "Return lifecycle transitions for a registered region.", {"region_id": {"type": "string"}}, required=["region_id"]),
    _tool("ocean_marine_context", "Resolve a coordinate to marine geography and local context.", {"longitude": {"type": "number", "minimum": -180, "maximum": 180}, "latitude": {"type": "number", "minimum": -90, "maximum": 90}, "refresh": {"type": "boolean"}}, required=["longitude", "latitude"]),
    _tool("ocean_marine_knowledge", "Return human geography, maritime history and knowledge for a point.", {"longitude": {"type": "number", "minimum": -180, "maximum": 180}, "latitude": {"type": "number", "minimum": -80, "maximum": 80}, "refresh": {"type": "boolean"}}, required=["longitude", "latitude"]),
    _tool("ocean_bathymetry", "Return point depth and local relief summary.", {"longitude": {"type": "number", "minimum": -180, "maximum": 180}, "latitude": {"type": "number", "minimum": -90, "maximum": 90}, "refresh": {"type": "boolean"}}, required=["longitude", "latitude"]),
    _tool("ocean_current_field", "Return a display-ready Copernicus surface-current vector field.", {"west": {"type": "number"}, "south": {"type": "number"}, "east": {"type": "number"}, "north": {"type": "number"}, "width": {"type": "integer", "minimum": 24, "maximum": 160}, "height": {"type": "integer", "minimum": 16, "maximum": 120}, "refresh": {"type": "boolean"}}, required=["west", "south", "east", "north"]),
    _tool("ocean_argo_float_history", "Return recent complete profiles for an Argo platform.", {"platform": {"type": "string"}, "date_count": {"type": "integer", "minimum": 1, "maximum": 30}, "refresh": {"type": "boolean"}}, required=["platform"]),
    _tool("ocean_argo_region", "Return compact Argo profiles and active floats in a region.", {"region_id": {"type": "string"}, "refresh": {"type": "boolean"}}, required=["region_id"]),
    _tool("ocean_argo_nearest", "Find active Argo floats nearest to a coordinate.", {"longitude": {"type": "number", "minimum": -180, "maximum": 180}, "latitude": {"type": "number", "minimum": -80, "maximum": 80}, "region_id": {"type": "string"}, "platform": {"type": "string"}, "refresh": {"type": "boolean"}}, required=["longitude", "latitude"]),
    _tool("ocean_daily_briefing", "Return the dated product daily briefing and schedule.", {"date": {"type": "string"}}),
    _tool("ocean_daily_dashboard", "Return the product daily dashboard snapshot.", {"refresh": {"type": "boolean"}}),
    _tool("ocean_marine_atlas", "Search the versioned offline marine atlas.", {"query": {"type": "string"}, "limit": {"type": "integer", "minimum": 1, "maximum": 500}}),
    _tool("ocean_copernicus_event_page", "Return a paged global Copernicus event index.", {"cursor": {"type": "integer", "minimum": 0}, "refresh": {"type": "boolean"}}),
    _tool("ocean_argo_realtime_status", "Return Argo realtime collector status.", {}),
    _tool("ocean_copernicus_index_status", "Return Copernicus named-area index status.", {}),
    _tool("ocean_workspace_snapshot", "Return the complete first-screen read model for a region.", {"region_id": {"type": "string"}, "refresh": {"type": "boolean"}, "compact": {"type": "boolean"}}, required=["region_id"]),
    _tool("ocean_detect_anomaly", "Run the product's validated anomaly screening model over timestamped observations.", {"variable": {"type": "string", "enum": ["SST", "SLA", "CHLA", "PCO2", "CURRENT"]}, "latitude": {"type": "number", "minimum": -90, "maximum": 90}, "longitude": {"type": "number", "minimum": -180, "maximum": 180}, "baseline_kind": {"type": "string"}, "unit": {"type": "string"}, "observations": {"type": "array", "minItems": 3, "maxItems": 500}}, required=["variable", "latitude", "longitude", "observations"]),
    _tool("ocean_event_report", "Generate the product's evidence-traceable scientific report for an event or observation.", {"event_id": {"type": "string"}, "region_id": {"type": "string"}}, required=["event_id"]),
    _tool("ocean_event_explanation", "Generate the product's evidence-constrained plain-language explanation.", {"event_id": {"type": "string"}, "refresh": {"type": "boolean"}}, required=["event_id"]),
    _tool("ocean_event_literature", "Search current scholarly metadata for an event.", {"event_id": {"type": "string"}, "refresh": {"type": "boolean"}}, required=["event_id"]),
    _tool("ocean_refresh", "Synchronously refresh a region's realtime data bundle.", {"region_id": {"type": "string"}}, required=["region_id"]),
    _tool("ocean_refresh_job_submit", "Submit a deduplicated background regional refresh job.", {"region_id": {"type": "string"}}, required=["region_id"]),
    _tool("ocean_refresh_job_status", "Read a background regional refresh job.", {"job_id": {"type": "string"}}, required=["job_id"]),
    _tool("ocean_agent_context", "Return the in-product agent context manifest for a region.", {"region_id": {"type": "string"}}, required=["region_id"]),
    _tool("ocean_agent_model_health", "Return model relay health without credentials.", {}),
    _tool("ocean_agent_chat", "Answer a product question with regional evidence, citations and memory continuity.", {"region_id": {"type": "string"}, "question": {"type": "string", "minLength": 1, "maxLength": 2400}, "selected_event_id": {"type": "string"}, "session_id": {"type": "string"}, "remember": {"type": "boolean"}, "analysis_mode": {"type": "string", "enum": ["quick", "research"]}, "owner_id": {"type": "string"}, "owner_signature": {"type": "string"}}, required=["region_id", "question"]),
    _tool("ocean_data_catalog", "List every pageable product dataset for a region with exact current record counts.", {"region_id": {"type": "string"}}, required=["region_id"]),
    _tool("ocean_data_page", "Read any product dataset from an expiring consistent snapshot. Continue with next_cursor_token; numeric cursor remains compatibility-only.", {"region_id": {"type": "string"}, "dataset_id": {"type": "string", "enum": ["events", "observations", "anomaly_candidates", "event_coordinates", "event_evidence", "sst_latest_points", "sst_timeline", "variable_summaries", "argo_floats", "argo_profiles", "sources", "lifecycle", "all_coordinates"]}, "snapshot_id": {"type": "string"}, "cursor_token": {"type": "string"}, "cursor": {"type": "integer", "minimum": 0, "description": "Deprecated compatibility offset."}, "limit": {"type": "integer", "minimum": 1, "maximum": 1000}, "minimum_longitude": {"type": "number", "minimum": -180, "maximum": 180}, "maximum_longitude": {"type": "number", "minimum": -180, "maximum": 180}, "minimum_latitude": {"type": "number", "minimum": -90, "maximum": 90}, "maximum_latitude": {"type": "number", "minimum": -90, "maximum": 90}}, required=["region_id", "dataset_id"]),
    _tool("ocean_source_catalog", "Load one underlying source and list every array collection and its exact record count.", {"region_id": {"type": "string"}, "source": {"type": "string", "enum": ["noaa_sst", "noaa_chlorophyll_anomaly", "noaa_chlorophyll_observations", "noaa_currents", "noaa_carbon", "woa_nitrate", "woa_salinity", "argo"]}, "refresh": {"type": "boolean"}}, required=["region_id", "source"]),
    _tool("ocean_source_data_page", "Read a named source collection from an expiring consistent snapshot with source metadata.", {"region_id": {"type": "string"}, "source": {"type": "string", "enum": ["noaa_sst", "noaa_chlorophyll_anomaly", "noaa_chlorophyll_observations", "noaa_currents", "noaa_carbon", "woa_nitrate", "woa_salinity", "argo"]}, "collection": {"type": "string"}, "snapshot_id": {"type": "string"}, "cursor_token": {"type": "string"}, "cursor": {"type": "integer", "minimum": 0}, "limit": {"type": "integer", "minimum": 1, "maximum": 1000}, "refresh": {"type": "boolean"}, "minimum_longitude": {"type": "number", "minimum": -180, "maximum": 180}, "maximum_longitude": {"type": "number", "minimum": -180, "maximum": 180}, "minimum_latitude": {"type": "number", "minimum": -90, "maximum": 90}, "maximum_latitude": {"type": "number", "minimum": -90, "maximum": 90}}, required=["region_id", "source", "collection"]),
    _tool("ocean_agent_sessions", "List signed-tenant Agent sessions.", {"region_id": {"type": "string"}, "include_archived": {"type": "boolean"}, "limit": {"type": "integer", "minimum": 1, "maximum": 200}, "owner_id": {"type": "string"}, "owner_signature": {"type": "string"}}),
    _tool("ocean_agent_session_get", "Read one signed-tenant Agent session and its messages.", {"session_id": {"type": "string"}, "owner_id": {"type": "string"}, "owner_signature": {"type": "string"}}, required=["session_id"]),
    _tool("ocean_agent_session_create", "Create a signed-tenant Agent session.", {"region_id": {"type": "string"}, "title": {"type": "string", "maxLength": 80}, "selected_event_id": {"type": "string"}, "owner_id": {"type": "string"}, "owner_signature": {"type": "string"}}, required=["region_id"]),
    _tool("ocean_agent_session_update", "Rename or archive a signed-tenant Agent session.", {"session_id": {"type": "string"}, "title": {"type": "string", "maxLength": 80}, "archived": {"type": "boolean"}, "owner_id": {"type": "string"}, "owner_signature": {"type": "string"}}, required=["session_id"]),
    _tool("ocean_agent_session_delete", "Delete a signed-tenant Agent session.", {"session_id": {"type": "string"}, "owner_id": {"type": "string"}, "owner_signature": {"type": "string"}}, required=["session_id"]),
    _tool("ocean_memories", "List signed-tenant Agent memories.", {"region_id": {"type": "string"}, "include_disabled": {"type": "boolean"}, "limit": {"type": "integer", "minimum": 1, "maximum": 200}, "owner_id": {"type": "string"}, "owner_signature": {"type": "string"}}),
    _tool("ocean_memory_update", "Update a signed-tenant Agent memory.", {"memory_id": {"type": "string"}, "content": {"type": "string", "maxLength": 500}, "enabled": {"type": "boolean"}, "confidence": {"type": "number", "minimum": 0, "maximum": 1}, "owner_id": {"type": "string"}, "owner_signature": {"type": "string"}}, required=["memory_id"]),
    _tool("ocean_memory_delete", "Delete a signed-tenant Agent memory.", {"memory_id": {"type": "string"}, "owner_id": {"type": "string"}, "owner_signature": {"type": "string"}}, required=["memory_id"]),
    _tool("ocean_data_schema", "Return field names, inferred JSON types and coordinate/time capabilities for a product dataset.", {"region_id": {"type": "string"}, "dataset_id": {"type": "string"}}, required=["region_id", "dataset_id"]),
    _tool("ocean_data_search", "Search any pageable product dataset and continue through a signed consistent snapshot cursor.", {"region_id": {"type": "string"}, "dataset_id": {"type": "string"}, "query": {"type": "string"}, "variable": {"type": "string"}, "start_time": {"type": "string"}, "end_time": {"type": "string"}, "snapshot_id": {"type": "string"}, "cursor_token": {"type": "string"}, "cursor": {"type": "integer", "minimum": 0}, "limit": {"type": "integer", "minimum": 1, "maximum": 1000}, "minimum_longitude": {"type": "number"}, "maximum_longitude": {"type": "number"}, "minimum_latitude": {"type": "number"}, "maximum_latitude": {"type": "number"}}, required=["region_id", "dataset_id"]),
    _tool("ocean_data_changes", "Read inserted, updated and deleted records since a prior snapshot or timestamp, including deletion tombstones.", {"region_id": {"type": "string"}, "dataset_id": {"type": "string"}, "base_snapshot_id": {"type": "string"}, "updated_after": {"type": "string"}, "revision_after": {"type": "string"}, "snapshot_id": {"type": "string"}, "cursor_token": {"type": "string"}, "limit": {"type": "integer", "minimum": 1, "maximum": 1000}}, required=["region_id", "dataset_id"]),
    _tool("ocean_job_submit", "Submit an approved long-running ocean tool to the persistent MCP job queue.", {"tool_name": {"type": "string"}, "arguments": {"type": "object"}}, required=["tool_name"]),
    _tool("ocean_job_status", "Read persistent MCP job status and cancellation state.", {"job_id": {"type": "string"}}, required=["job_id"]),
    _tool("ocean_job_result_page", "Read a completed MCP job result with bounded pagination.", {"job_id": {"type": "string"}, "cursor": {"type": "integer", "minimum": 0}, "limit": {"type": "integer", "minimum": 1, "maximum": 1000}}, required=["job_id"]),
    _tool("ocean_job_cancel", "Request cancellation of a queued or running MCP job.", {"job_id": {"type": "string"}}, required=["job_id"]),
    _tool("ocean_batch_points_submit", "Submit up to 500 coordinates for asynchronous marine-area, bathymetry, Argo, knowledge, wave or wind enrichment.", {"points": {"type": "array", "minItems": 1, "maxItems": 500, "items": {"type": "object", "properties": {"id": {"type": "string"}, "longitude": {"type": "number", "minimum": -180, "maximum": 180}, "latitude": {"type": "number", "minimum": -90, "maximum": 90}}, "required": ["longitude", "latitude"], "additionalProperties": False}}, "operations": {"type": "array", "minItems": 1, "items": {"type": "string", "enum": ["marine_area", "marine_context", "bathymetry", "nearest_argo", "marine_knowledge", "wave", "wind"]}}, "region_id": {"type": "string"}}, required=["points", "operations"]),
    _tool("ocean_export_submit", "Export a dataset snapshot asynchronously as CSV, GeoJSON, NDJSON, Parquet or NetCDF.", {"region_id": {"type": "string"}, "dataset_id": {"type": "string"}, "snapshot_id": {"type": "string"}, "format": {"type": "string", "enum": ["csv", "geojson", "ndjson", "parquet", "netcdf"]}}, required=["region_id", "dataset_id", "format"]),
    _tool("ocean_export_result", "Read a completed export file in bounded text or base64 chunks.", {"job_id": {"type": "string"}, "offset": {"type": "integer", "minimum": 0}, "max_bytes": {"type": "integer", "minimum": 1, "maximum": 1048576}}, required=["job_id"]),
    _tool("ocean_audit_page", "Read the current tenant's redacted MCP audit trail.", {"cursor": {"type": "integer", "minimum": 0}, "limit": {"type": "integer", "minimum": 1, "maximum": 500}}),
    _tool("ocean_coordinate_nearest", "Return the nearest coordinate records from any coordinate-bearing product dataset.", {"region_id": {"type": "string"}, "dataset_id": {"type": "string"}, "longitude": {"type": "number", "minimum": -180, "maximum": 180}, "latitude": {"type": "number", "minimum": -90, "maximum": 90}, "limit": {"type": "integer", "minimum": 1, "maximum": 100}, "maximum_distance_km": {"type": "number", "minimum": 0}}, required=["region_id", "dataset_id", "longitude", "latitude"]),
    _tool("ocean_data_aggregate", "Calculate exact numeric count, missing count, minimum, mean, median and maximum over a filtered product dataset field.", {"region_id": {"type": "string"}, "dataset_id": {"type": "string"}, "field": {"type": "string"}, "minimum_longitude": {"type": "number"}, "maximum_longitude": {"type": "number"}, "minimum_latitude": {"type": "number"}, "maximum_latitude": {"type": "number"}}, required=["region_id", "dataset_id", "field"]),
    _tool("ocean_copernicus_global_daily_volume", "Return the current global gridded record count for connected Copernicus products.", {"refresh": {"type": "boolean"}}),
    _tool("ocean_copernicus_indexed_events", "Read the persistent Copernicus event index with view, sea-area and geography filters.", {"cursor": {"type": "integer", "minimum": 0}, "limit": {"type": "integer", "minimum": 1, "maximum": 500}, "view": {"type": "string", "enum": ["all", "observations", "signals", "events"]}, "area": {"type": "string"}, "geography": {"type": "string", "enum": ["china_mainland", "taiwan_related", "global"]}}),
    _tool("ocean_event_argo", "Match an event to nearby Argo floats and return the selected full profile.", {"event_id": {"type": "string"}, "platform": {"type": "string"}, "refresh": {"type": "boolean"}}, required=["event_id"]),
    _tool("ocean_argo_explanation", "Return the generated explanation embedded in an Argo float snapshot.", {"platform": {"type": "string"}, "refresh": {"type": "boolean"}}, required=["platform"]),
    _tool("ocean_atlas_entry", "Return a complete offline marine-atlas entry, profile and supplement by name.", {"name": {"type": "string"}}, required=["name"]),
    _tool("ocean_performance", "Return bounded in-process endpoint performance and error metrics.", {}),
    _tool("ocean_mcp_coverage", "Return the explicit product API-to-MCP coverage matrix and security exclusions.", {}),
]

WRITE_TOOLS = {
    "ocean_memory_store", "ocean_memory_update", "ocean_memory_delete", "ocean_agent_chat",
    "ocean_agent_session_create", "ocean_agent_session_update", "ocean_agent_session_delete",
    "ocean_refresh", "ocean_refresh_job_submit", "ocean_job_submit", "ocean_job_cancel",
    "ocean_batch_points_submit", "ocean_export_submit",
}
DESTRUCTIVE_TOOLS = {"ocean_memory_delete", "ocean_agent_session_delete", "ocean_job_cancel"}
NON_IDEMPOTENT_TOOLS = WRITE_TOOLS - {"ocean_refresh", "ocean_job_cancel"}
OPEN_WORLD_TOOLS = {
    tool["name"] for tool in TOOLS
    if any(marker in tool["name"] for marker in ("copernicus", "noaa", "argo", "literature", "news", "refresh", "marine_context", "marine_knowledge", "bathymetry"))
}
for tool in TOOLS:
    name = tool["name"]
    tool["annotations"] = {
        "readOnlyHint": name not in WRITE_TOOLS,
        "destructiveHint": name in DESTRUCTIVE_TOOLS,
        "idempotentHint": name not in NON_IDEMPOTENT_TOOLS,
        "openWorldHint": name in OPEN_WORLD_TOOLS,
    }


def _configured_token() -> str:
    return os.getenv("OCEAN_CODEX_MCP_TOKEN", "").strip()


def _authorized(request: Request) -> bool:
    token = _configured_token()
    authorization = request.headers.get("authorization", "")
    supplied = authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""
    return bool(token and supplied and hmac.compare_digest(token, supplied))


def _rpc_result(request_id: Any, result: Any) -> JSONResponse:
    return JSONResponse({"jsonrpc": "2.0", "id": request_id, "result": result})


def _rpc_error(request_id: Any, code: int, message: str, data: Any = None) -> JSONResponse:
    error: dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        error["data"] = data
    return JSONResponse({"jsonrpc": "2.0", "id": request_id, "error": error})


def _mcp_response(response: JSONResponse, *, protocol: str | None = None, session_id: str | None = None) -> JSONResponse:
    if protocol:
        response.headers["MCP-Protocol-Version"] = protocol
    if session_id:
        response.headers["Mcp-Session-Id"] = session_id
    return response


def _prompt(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    if name == "regional_ocean_assessment":
        area = str(arguments.get("area") or "").strip()
        if not area:
            raise ValueError("area is required")
        focus = str(arguments.get("focus") or "all available variables").strip()
        text = (
            f"Assess {area} with focus on {focus}. First resolve geography, then read the regional manifest or product capabilities. "
            "Build the nine-zone grid before analysis. Use bounded data calls, reconcile coverage/QC/freshness, and distinguish measured observations, numerical products, derived diagnostics, media context and hypotheses. "
            "Do not call a candidate a confirmed event without independent validation."
        )
    elif name == "event_evidence_review":
        event_id = str(arguments.get("event_id") or "").strip()
        if not event_id:
            raise ValueError("event_id is required")
        text = (
            f"Review record {event_id}. Call ocean_get_event, trace each claim to evidence and references, inspect source health, and clearly state validation state, uncertainty and what additional evidence would falsify or confirm the interpretation."
        )
    else:
        raise LookupError(f"Unknown prompt: {name}")
    return {"description": next(item["description"] for item in PROMPTS if item["name"] == name), "messages": [{"role": "user", "content": {"type": "text", "text": text}}]}


def _region_nine_zone_grid(arguments: dict[str, Any]) -> dict[str, Any]:
    region_id = str(arguments.get("region_id") or "").strip()
    coordinate_keys = ("minimum_longitude", "maximum_longitude", "minimum_latitude", "maximum_latitude")
    has_coordinates = all(arguments.get(key) is not None for key in coordinate_keys)
    if region_id:
        if region_id not in REGIONS:
            raise ValueError(f"Unknown region_id: {region_id}")
        region = get_region(region_id)
        bounds = region["bounds"]
        source = {"type": "registered_region", "region_id": region_id, "region_name": region["name"]}
    elif has_coordinates:
        bounds = (
            (float(arguments["minimum_longitude"]), float(arguments["minimum_latitude"])),
            (float(arguments["maximum_longitude"]), float(arguments["maximum_latitude"])),
        )
        source = {"type": "custom_bounds"}
    else:
        raise ValueError("provide region_id or all four longitude/latitude bounds")
    return {**build_nine_zone_grid(bounds), "source": source, "input_bounds": bounds}


def _resolve_marine_area(arguments: dict[str, Any]) -> dict[str, Any]:
    query = str(arguments.get("query") or "").strip()
    longitude = arguments.get("longitude")
    latitude = arguments.get("latitude")
    if not query and (longitude is None or latitude is None):
        raise ValueError("provide query text or both longitude and latitude")
    return resolve_marine_area(
        query=query,
        longitude=float(longitude) if longitude is not None else None,
        latitude=float(latitude) if latitude is not None else None,
    )


def _nine_zone_point_inventory(arguments: dict[str, Any]) -> dict[str, Any]:
    region_id = str(arguments.get("region_id") or "").strip()
    coordinate_keys = ("minimum_longitude", "maximum_longitude", "minimum_latitude", "maximum_latitude")
    if region_id:
        if region_id not in REGIONS:
            raise ValueError(f"Unknown region_id: {region_id}")
        bounds = get_region(region_id)["bounds"]
    elif all(arguments.get(key) is not None for key in coordinate_keys):
        bounds = (
            (float(arguments["minimum_longitude"]), float(arguments["minimum_latitude"])),
            (float(arguments["maximum_longitude"]), float(arguments["maximum_latitude"])),
        )
    else:
        raise ValueError("provide region_id or all four longitude/latitude bounds")
    ocean_areas = {
        str(item.get("zone")): float(item.get("area_km2"))
        for item in list(arguments.get("ocean_areas") or [])
    }
    return summarize_nine_zone_points(
        bounds,
        list(arguments.get("points") or []),
        source_complete=bool(arguments.get("source_complete", True)),
        source_errors=[str(error) for error in list(arguments.get("source_errors") or [])],
        ocean_area_km2_by_zone=ocean_areas,
    )


def _compact_record(record: Any) -> dict[str, Any]:
    evidence = []
    for item in list(record.evidence or [])[:4]:
        evidence.append(
            {
                "id": item.id,
                "variable": item.variable,
                "observed": item.observed,
                "unit": item.unit,
                "quality_control": {
                    "pass_fraction": item.qc_pass_fraction,
                    "validation_state": item.validation_state,
                    "value_mode": item.value_mode,
                },
                "observed_at": item.timestamp,
                "source": item.source,
                "method": item.method,
            }
        )
    return {
        "id": record.id,
        "record_class": "anomaly_candidate" if record.event_kind == "anomaly" else "observation",
        "event_kind": record.event_kind,
        "title": record.title,
        "summary": record.summary,
        "region": record.region,
        "centroid": record.centroid,
        "started_at": record.started_at,
        "source_updated_at": record.source_updated_at,
        "variables": record.variables,
        "validation_state": record.validation_state,
        "confidence": record.confidence,
        "data_mode": record.data_mode,
        "sources": record.sources,
        "evidence": evidence,
    }


def _search_records(arguments: dict[str, Any]) -> dict[str, Any]:
    region_id = str(arguments.get("region_id") or DEFAULT_REGION_ID)
    if region_id not in REGIONS:
        raise ValueError(f"Unknown region_id: {region_id}")
    query = str(arguments.get("query") or "").strip().lower()
    variable = str(arguments.get("variable") or "").strip().upper()
    kind = str(arguments.get("kind") or "all").strip().lower()
    limit = max(1, min(int(arguments.get("limit") or 25), 100))
    records = list(get_realtime_bundle(region_id).get("events") or [])

    def matches(record: Any) -> bool:
        if kind == "observation" and record.event_kind != "observation":
            return False
        if kind == "candidate" and record.event_kind != "anomaly":
            return False
        if variable and variable not in {str(item).upper() for item in record.variables}:
            return False
        if query:
            searchable = " ".join(
                [record.id, record.title, record.summary, record.region, *record.variables, *record.sources]
            ).lower()
            if all(term not in searchable for term in query.split() if term):
                return False
        return True

    matched = [record for record in records if matches(record)]
    matched.sort(key=lambda item: item.source_updated_at or item.started_at, reverse=True)
    return {
        "region_id": region_id,
        "query": query,
        "variable": variable or None,
        "kind": kind,
        "matched_count": len(matched),
        "returned_count": min(len(matched), limit),
        "records": [_compact_record(record) for record in matched[:limit]],
        "scientific_label_rule": "Routine measurements are observations. Only records with event_kind=anomaly are anomaly candidates.",
    }


def _get_event(arguments: dict[str, Any]) -> dict[str, Any]:
    event_id = str(arguments.get("event_id") or "").strip()
    region_id = str(arguments.get("region_id") or DEFAULT_REGION_ID).strip()
    if not event_id:
        raise ValueError("event_id is required")
    if region_id not in REGIONS:
        raise ValueError(f"Unknown region_id: {region_id}")
    record = next((item for item in get_realtime_bundle(region_id).get("events") or [] if item.id == event_id), None)
    if record is None:
        for candidate_region_id in REGIONS:
            record = next(
                (item for item in get_realtime_bundle(candidate_region_id).get("events") or [] if item.id == event_id),
                None,
            )
            if record is not None:
                region_id = candidate_region_id
                break
    if record is None:
        raise LookupError(f"Record not found: {event_id}")
    payload = record.model_dump(mode="json")
    payload["region_id"] = region_id
    payload["record_class"] = "anomaly_candidate" if record.event_kind == "anomaly" else "observation"
    return payload


def _source_health(arguments: dict[str, Any]) -> dict[str, Any]:
    region_id = str(arguments.get("region_id") or DEFAULT_REGION_ID)
    if region_id not in REGIONS:
        raise ValueError(f"Unknown region_id: {region_id}")
    bundle = get_realtime_bundle(region_id)
    return {
        "region_id": region_id,
        "refreshed_at": bundle.get("refreshed_at"),
        "cache": bundle.get("cache"),
        "errors": bundle.get("errors") or [],
        "sources": bundle.get("sources") or [],
    }


def _copernicus_catalog_search(arguments: dict[str, Any]) -> dict[str, Any]:
    return search_catalogue(
        query=str(arguments.get("query") or ""),
        product_id=str(arguments.get("product_id") or ""),
        dataset_id=str(arguments.get("dataset_id") or ""),
        limit=int(arguments.get("limit") or 20),
        offset=int(arguments.get("offset") or 0),
    )


def _copernicus_dataset_describe(arguments: dict[str, Any]) -> dict[str, Any]:
    return describe_dataset(str(arguments.get("dataset_id") or ""))


def _copernicus_dataset_analyze(arguments: dict[str, Any]) -> dict[str, Any]:
    raw_variables = arguments.get("variables")
    if not isinstance(raw_variables, list):
        raise ValueError("variables must be an array of Copernicus Marine variable short names")
    raw_vectors = arguments.get("derived_vectors") or []
    if not isinstance(raw_vectors, list) or any(not isinstance(vector, dict) for vector in raw_vectors):
        raise ValueError("derived_vectors must be an array of vector specifications")
    return analyze_dataset(
        dataset_id=str(arguments.get("dataset_id") or ""),
        variables=[str(variable) for variable in raw_variables],
        minimum_longitude=float(arguments.get("minimum_longitude")),
        maximum_longitude=float(arguments.get("maximum_longitude")),
        minimum_latitude=float(arguments.get("minimum_latitude")),
        maximum_latitude=float(arguments.get("maximum_latitude")),
        start_datetime=arguments.get("start_datetime"),
        end_datetime=arguments.get("end_datetime"),
        minimum_depth=float(arguments["minimum_depth"]) if arguments.get("minimum_depth") is not None else None,
        maximum_depth=float(arguments["maximum_depth"]) if arguments.get("maximum_depth") is not None else None,
        coordinates_selection_method=str(arguments.get("coordinates_selection_method") or "inside"),
        derived_vectors=[{str(key): str(value) for key, value in vector.items()} for vector in raw_vectors],
        maximum_values=int(arguments.get("maximum_values") or 80_000),
        timeline_limit=int(arguments.get("timeline_limit") or 48),
        sample_limit=int(arguments.get("sample_limit") or 12),
    )


def _copernicus_wave_point(arguments: dict[str, Any]) -> dict[str, Any]:
    longitude = float(arguments.get("longitude"))
    latitude = float(arguments.get("latitude"))
    days_back = max(1, min(int(arguments.get("days_back") or 3), 7))
    forecast_hours = max(0, min(int(arguments.get("forecast_hours") or 0), 240))
    limit = max(1, min(int(arguments.get("limit") or 80), 160))
    result = get_wave_point(
        longitude,
        latitude,
        days=days_back,
        forecast_hours=forecast_hours,
    )
    records = list(result.get("records") or [])
    peak = max(
        (record for record in records if record.get("VHM0") is not None),
        key=lambda record: float(record["VHM0"]),
        default=None,
    )
    return {
        **result,
        "records": records[-limit:],
        "returned_count": min(len(records), limit),
        "peak_total_wave": peak,
        "interpretation_rules": [
            "这些字段是 Copernicus Marine 数值模式分析预报，不是浮标、船舶或卫星的原位实测读数。",
            "VHM0 是总波有效波高；VHM0_SW1 是一级涌浪有效波高；VHM0_WW 是风浪有效波高。",
            "VMDR、VMDR_SW1、VMDR_WW 表示波浪来向，即波从该方位传播而来。",
            "时间字段是模式有效时间；fetched_at 是本平台获取时间，两者不能混用。",
            "模式阈值筛查只能形成异常候选，不能替代原位观测、主管机构预警或科学确认。",
        ],
    }


def _copernicus_wave_region(arguments: dict[str, Any]) -> dict[str, Any]:
    region_id = str(arguments.get("region_id") or DEFAULT_REGION_ID)
    if region_id not in REGIONS:
        raise ValueError(f"Unknown region_id: {region_id}")
    region = get_region(region_id)
    return get_wave_region(
        region_id,
        region["bounds"],
        force_refresh=bool(arguments.get("force_refresh", False)),
        days=max(1, min(int(arguments.get("days_back") or 3), 7)),
        forecast_hours=max(0, min(int(arguments.get("forecast_hours") or 0), 240)),
    )


def _copernicus_wave_audit(arguments: dict[str, Any]) -> dict[str, Any]:
    region_id = str(arguments.get("region_id") or DEFAULT_REGION_ID)
    if region_id not in REGIONS:
        raise ValueError(f"Unknown region_id: {region_id}")
    bundle = get_realtime_bundle(region_id)
    source = next((item for item in bundle.get("sources") or [] if item.get("id") == "copernicus_wave"), None)
    latest_valid_time = source.get("latest_observation_at") if source else None
    records = [
        record for record in bundle.get("events") or []
        if any("Copernicus Marine" in str(source_name) for source_name in record.sources)
        or any(str(variable).upper() in {"WAVE_HEIGHT", "SWELL_HEIGHT", "WIND_WAVE_HEIGHT"} for variable in record.variables)
    ]
    observations = [record for record in records if record.event_kind == "observation"]
    candidates = [record for record in records if record.event_kind == "anomaly"]
    return {
        "region_id": region_id,
        "dataset_id": COPERNICUS_DATASET_ID,
        "source": source,
        "latest_valid_time": latest_valid_time,
        "latest_time_semantics": "Copernicus Marine 时间是模式有效时间；如果晚于当前时间则属于预报时次，不是已经发生的观测。",
        "bundle_refreshed_at": bundle.get("refreshed_at"),
        "bundle_cache": bundle.get("cache"),
        "errors": [error for error in bundle.get("errors") or [] if "Copernicus" in str(error)],
        "model_record_count": len(records),
        "observation_record_count": len(observations),
        "anomaly_candidate_count": len(candidates),
        "records": [_compact_record(record) for record in records[:40]],
        "variables": WAVE_VARIABLES,
        "scientific_status": {
            "data_class": "numerical_model_analysis_forecast",
            "routine_records": "模式海况记录",
            "candidate_rule": "仅超过产品自动阈值且 event_kind=anomaly 的记录属于异常候选",
            "confirmation_rule": "不能仅凭 Copernicus Marine 单一模式网格确认海洋事件或发布预警",
        },
    }


def _copernicus_wind_point(arguments: dict[str, Any]) -> dict[str, Any]:
    longitude = float(arguments.get("longitude"))
    latitude = float(arguments.get("latitude"))
    limit = max(1, min(int(arguments.get("limit") or 100), 200))
    result = get_wind_point(
        longitude,
        latitude,
        days=max(1, min(int(arguments.get("days_back") or 3), 7)),
    )
    records = list(result.get("records") or [])
    peak = max(records, key=lambda record: float(record.get("wind_speed") or 0), default=None)
    return {
        **result,
        "records": records[-limit:],
        "returned_count": min(len(records), limit),
        "peak_wind": peak,
        "interpretation_rules": [
            "该产品是散射计观测与模式信息形成的 L4 融合风场分析，不是现场风速仪原位读数。",
            "wind_speed 由东向和北向风分量合成；wind_direction_from 是气象学来向。",
            "必须同时报告 latest_valid_time、fetched_at 和 data_latency_hours，不能用获取时间伪装成产品最新时次。",
            "强风阈值只能形成自动异常候选，不能替代气象机构大风、风暴或台风预警。",
        ],
    }


def _copernicus_wind_region(arguments: dict[str, Any]) -> dict[str, Any]:
    region_id = str(arguments.get("region_id") or DEFAULT_REGION_ID)
    if region_id not in REGIONS:
        raise ValueError(f"Unknown region_id: {region_id}")
    region = get_region(region_id)
    return get_wind_region(
        region_id,
        region["bounds"],
        force_refresh=bool(arguments.get("force_refresh", False)),
        days=max(1, min(int(arguments.get("days_back") or 3), 7)),
    )


def _copernicus_history(arguments: dict[str, Any]) -> dict[str, Any]:
    source = str(arguments.get("source") or "").strip().lower()
    if source not in {"wave", "wind"}:
        raise ValueError("source must be wave or wind")
    longitude = float(arguments.get("longitude"))
    latitude = float(arguments.get("latitude"))
    limit = max(1, min(int(arguments.get("limit") or 100), 500))
    offset = max(0, int(arguments.get("offset") or 0))
    if bool(arguments.get("sync", False)):
        sync_point_history(source, longitude, latitude)
    result = query_point_history(source, longitude, latitude, limit=limit, offset=offset)
    return {
        **result,
        "data_class": "numerical_model_analysis_forecast" if source == "wave" else "satellite_model_blended_analysis",
        "time_semantics": "历史库时间为产品有效时间；synced_at 是本地同步时间。",
        "scientific_limit": "历史序列适用于趋势和过程分析，但单一网格不能代表整个海域，也不能单独确认灾害事件。",
    }


def _copernicus_audit(arguments: dict[str, Any]) -> dict[str, Any]:
    region_id = str(arguments.get("region_id") or DEFAULT_REGION_ID)
    if region_id not in REGIONS:
        raise ValueError(f"Unknown region_id: {region_id}")
    bundle = get_realtime_bundle(region_id)
    sources = [item for item in bundle.get("sources") or [] if str(item.get("id") or "").startswith("copernicus_")]
    records = [
        record for record in bundle.get("events") or []
        if any(str(source_name).upper().startswith("COPERNICUS_") or "COPERNICUS MARINE" in str(source_name).upper() for source_name in record.sources)
    ]
    observations = [record for record in records if record.event_kind == "observation"]
    candidates = [record for record in records if record.event_kind == "anomaly"]
    joint_candidates = [
        record for record in candidates
        if {"WIND_SPEED", "WAVE_HEIGHT"}.issubset({str(variable).upper() for variable in record.variables})
    ]
    return {
        "region_id": region_id,
        "bundle_refreshed_at": bundle.get("refreshed_at"),
        "bundle_cache": bundle.get("cache"),
        "sources": sources,
        "errors": [error for error in bundle.get("errors") or [] if "Copernicus" in str(error)],
        "record_count": len(records),
        "routine_record_count": len(observations),
        "anomaly_candidate_count": len(candidates),
        "joint_wind_wave_candidate_count": len(joint_candidates),
        "by_variable": {
            variable: sum(variable in {str(item).upper() for item in record.variables} for record in records)
            for variable in ["WAVE_HEIGHT", "SWELL_HEIGHT", "WIND_WAVE_HEIGHT", "WIND_SPEED", "WIND_DIRECTION"]
        },
        "records": [_compact_record(record) for record in records[:60]],
        "products": {
            "wave": {"dataset_id": COPERNICUS_DATASET_ID, "variables": WAVE_VARIABLES, "data_class": "numerical_model_analysis_forecast"},
            "wind": {"dataset_id": COPERNICUS_WIND_DATASET_ID, "variables": WIND_VARIABLES, "data_class": "satellite_model_blended_analysis"},
        },
        "scientific_limits": [
            "波浪产品为数值模式分析预报；风场产品为 L4 卫星—模式融合分析；两者都不是现场原位测量。",
            "未来波浪时次必须标记为 forecast，不能写成已经发生的观测。",
            "联合强风高浪记录仍是自动风险候选，不能替代官方台风路径、警报或海事预警。",
        ],
    }


def _mainland_news(arguments: dict[str, Any]) -> dict[str, Any]:
    query = str(arguments.get("query") or "").strip()
    limit = max(1, min(int(arguments.get("limit") or 15), 50))
    result = get_mainland_ocean_news(
        limit,
        force_refresh=bool(arguments.get("force_refresh", False)),
        query=query,
    )
    return {
        **result,
        "page_title": "新闻页面",
        "media_scope": "中国大陆媒体",
        "evidence_role": "背景信息层，不作为海洋变量观测、模式结果或官方预警证据",
        "relevance_terms": query,
    }


def _search_memories(arguments: dict[str, Any]) -> dict[str, Any]:
    owner_id = _validated_memory_owner(arguments)
    query = str(arguments.get("query") or "").strip()
    if not query:
        raise ValueError("query is required")
    region_id = str(arguments.get("region_id") or "").strip() or None
    if region_id and region_id not in REGIONS:
        raise ValueError(f"Unknown region_id: {region_id}")
    limit = max(1, min(int(arguments.get("limit") or 8), 24))
    memories = memory_store.relevant_memories(query, region_id=region_id, limit=limit, owner_id=owner_id)
    memory_store.mark_memories_used([memory.id for memory in memories], owner_id=owner_id)
    return {
        "query": query,
        "region_id": region_id,
        "count": len(memories),
        "memories": [memory.model_dump(mode="json") for memory in memories],
    }


def _store_memory(arguments: dict[str, Any]) -> dict[str, Any]:
    owner_id = _validated_memory_owner(arguments)
    kind = str(arguments.get("kind") or "").strip()
    content = str(arguments.get("content") or "").strip()
    region_id = str(arguments.get("region_id") or "").strip() or None
    if kind not in {"preference", "instruction", "focus"}:
        raise ValueError("kind must be preference, instruction, or focus")
    if not content:
        raise ValueError("content is required")
    if len(content) > 500:
        raise ValueError("content must not exceed 500 characters")
    if region_id and region_id not in REGIONS:
        raise ValueError(f"Unknown region_id: {region_id}")
    memory = memory_store.upsert_memory(kind, content, region_id=region_id, confidence=1.0, owner_id=owner_id)
    return {
        "stored": True,
        "memory": memory.model_dump(mode="json"),
        "policy": "Only explicit preferences, instructions, and durable research focus are persisted.",
    }


def _region_id(arguments: dict[str, Any]) -> str:
    region_id = str(arguments.get("region_id") or DEFAULT_REGION_ID).strip()
    if region_id not in REGIONS:
        raise ValueError(f"Unknown region_id: {region_id}")
    return region_id


def _product_health(_: dict[str, Any]) -> dict[str, Any]:
    return {"status": "ok", "service": SERVER_NAME, "version": SERVER_VERSION, "region_count": len(REGIONS), "data_access": "deferred_until_tool_call"}


def _product_metrics(arguments: dict[str, Any]) -> dict[str, Any]:
    region_id = str(arguments.get("region_id") or "").strip()
    if region_id and region_id not in REGIONS:
        raise ValueError(f"Unknown region_id: {region_id}")
    region_ids = [region_id] if region_id else list(REGIONS)
    bundles = [jsonable_encoder(get_realtime_bundle(item)) for item in region_ids]
    return {"region_id": region_id or None, "regions": region_ids, "bundles": bundles}


def _observation_summary(arguments: dict[str, Any]) -> dict[str, Any]:
    region_id = _region_id(arguments)
    bundle = get_realtime_bundle(region_id)
    return {"region_id": region_id, "summary": bundle.get("observation_summary"), "refreshed_at": bundle.get("refreshed_at"), "sources": bundle.get("sources") or []}


def _event_catalog(arguments: dict[str, Any]) -> dict[str, Any]:
    region_id = _region_id(arguments)
    bundle = get_realtime_bundle(region_id)
    events = list(bundle.get("events") or [])
    variable = str(arguments.get("variable") or "").strip().upper()
    limit = max(1, min(int(arguments.get("limit") or 50), 500))
    if variable:
        events = [item for item in events if variable in {str(value).upper() for value in item.variables}]
    events.sort(key=lambda item: item.source_updated_at or item.started_at, reverse=True)
    return {"region_id": region_id, "count": len(events), "events": [_compact_record(item) for item in events[:limit]]}


def _event_lifecycle(arguments: dict[str, Any]) -> dict[str, Any]:
    region_id = _region_id(arguments)
    return {"region_id": region_id, "records": get_event_lifecycle_records(region_id)}


def _marine_point(arguments: dict[str, Any], getter: Callable[..., Any]) -> dict[str, Any]:
    longitude = float(arguments["longitude"])
    latitude = float(arguments["latitude"])
    if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
        raise ValueError("longitude/latitude is out of range")
    return jsonable_encoder(getter(longitude, latitude, force_refresh=bool(arguments.get("refresh", False))))


def _argo_region(arguments: dict[str, Any]) -> dict[str, Any]:
    region_id = _region_id(arguments)
    region = get_region(region_id)
    return jsonable_encoder(get_argo_region(region_id=region_id, bounds=region["bounds"], region_name=region["name"], force_refresh=bool(arguments.get("refresh", False))))


def _argo_nearest(arguments: dict[str, Any]) -> dict[str, Any]:
    region_id = _region_id(arguments)
    region = get_region(region_id)
    longitude = float(arguments["longitude"])
    latitude = float(arguments["latitude"])
    return jsonable_encoder(get_nearest_argo(longitude, latitude, platform=arguments.get("platform"), region_id=region_id, bounds=region["bounds"], region_name=region["name"], force_refresh=bool(arguments.get("refresh", False))))


def _daily_briefing(arguments: dict[str, Any]) -> dict[str, Any]:
    report_date = str(arguments.get("date") or "").strip() or None
    return {"schedule": local_schedule(), "briefing": jsonable_encoder(get_daily_briefing(report_date))}


def _marine_atlas(arguments: dict[str, Any]) -> dict[str, Any]:
    query = str(arguments.get("query") or "").strip() or None
    limit = max(1, min(int(arguments.get("limit") or 50), 500))
    return {"version": ATLAS_VERSION, "count": len(MARINE_ATLAS), "items": atlas_search(query, limit=limit)}


def _copernicus_events(arguments: dict[str, Any]) -> dict[str, Any]:
    cursor = max(0, int(arguments.get("cursor") or 0))
    return jsonable_encoder(get_global_copernicus_event_page(cursor, force_refresh=bool(arguments.get("refresh", False))))


def _workspace_snapshot(arguments: dict[str, Any]) -> dict[str, Any]:
    region_id = _region_id(arguments)
    bundle = get_realtime_bundle(region_id, force_refresh=bool(arguments.get("refresh", False)))
    region = get_region(region_id)
    events = list(bundle.get("events") or [])
    if bool(arguments.get("compact", False)):
        events = events[:300]
    return {
        "snapshot_id": f"{region_id}:{bundle.get('refreshed_at')}",
        "region": region,
        "events": [_compact_record(item) for item in events],
        "event_counts": bundle.get("event_counts"),
        "coverage": bundle.get("coverage"),
        "metrics": bundle.get("metrics"),
        "sources": bundle.get("sources") or [],
        "observations": bundle.get("observation_summary"),
        "argo_region": bundle.get("argo_region"),
        "refreshed_at": bundle.get("refreshed_at"),
        "cache_state": (bundle.get("cache") or {}).get("state"),
        "errors": bundle.get("errors") or [],
    }


def _detect_anomaly(arguments: dict[str, Any]) -> dict[str, Any]:
    payload = dict(arguments)
    payload.pop("owner_id", None)
    payload.pop("owner_signature", None)
    return detection_agent.analyze(DetectionRequest.model_validate(payload)).model_dump(mode="json")


def _find_event_for_tool(arguments: dict[str, Any]) -> Any:
    event_id = str(arguments.get("event_id") or "").strip()
    if not event_id:
        raise ValueError("event_id is required")
    region_id = str(arguments.get("region_id") or DEFAULT_REGION_ID).strip()
    if region_id not in REGIONS:
        raise ValueError(f"Unknown region_id: {region_id}")
    for candidate_region_id in [region_id, *[item for item in REGIONS if item != region_id]]:
        for event in get_realtime_bundle(candidate_region_id).get("events") or []:
            if event.id == event_id:
                return event
    raise LookupError(f"Record not found: {event_id}")


def _event_report(arguments: dict[str, Any]) -> dict[str, Any]:
    return report_agent.create(_find_event_for_tool(arguments)).model_dump(mode="json")


def _event_explanation(arguments: dict[str, Any]) -> dict[str, Any]:
    return explain_event(_find_event_for_tool(arguments), force_refresh=bool(arguments.get("refresh", False))).model_dump(mode="json")


def _event_literature(arguments: dict[str, Any]) -> dict[str, Any]:
    return search_literature(_find_event_for_tool(arguments), force_refresh=bool(arguments.get("refresh", False))).model_dump(mode="json")


def _refresh(arguments: dict[str, Any]) -> dict[str, Any]:
    region_id = _region_id(arguments)
    bundle = get_realtime_bundle(region_id, force_refresh=True)
    return {"region_id": region_id, "refreshed_at": bundle.get("refreshed_at"), "event_count": len(bundle.get("events") or []), "observation_count": bundle.get("observation_count"), "source_count": len(bundle.get("sources") or []), "status": "partial" if bundle.get("errors") else "completed", "errors": bundle.get("errors") or []}


def _refresh_job_status(arguments: dict[str, Any]) -> dict[str, Any]:
    job_id = str(arguments.get("job_id") or "").strip()
    if not job_id:
        raise ValueError("job_id is required")
    job = get_refresh_job(job_id)
    if job is None:
        raise LookupError(f"Refresh job not found: {job_id}")
    return jsonable_encoder(job)


def _agent_chat(arguments: dict[str, Any]) -> dict[str, Any]:
    region_id = _region_id(arguments)
    question = str(arguments.get("question") or "").strip()
    if not question:
        raise ValueError("question is required")
    owner_id = _validated_memory_owner(arguments)
    bundle = get_realtime_bundle(region_id)
    selected_event_id = str(arguments.get("selected_event_id") or "").strip() or None
    if selected_event_id and not any(item.id == selected_event_id for item in bundle.get("events") or []):
        raise LookupError(f"Record not found in region: {selected_event_id}")
    request = AgentChatRequest.model_validate({
        "region_id": region_id,
        "question": question,
        "selected_event_id": selected_event_id,
        "session_id": str(arguments.get("session_id") or "").strip() or None,
        "remember": bool(arguments.get("remember", True)),
        "analysis_mode": str(arguments.get("analysis_mode") or "research"),
    })
    session = memory_store.get_session(request.session_id, owner_id=owner_id) if request.session_id else memory_store.create_session(region_id, selected_event_id=selected_event_id, owner_id=owner_id)
    if session is None:
        raise LookupError("Session not found")
    memories = memory_store.relevant_memories(question, region_id, limit=8, owner_id=owner_id)
    response = answer_agent_question(get_region(region_id), bundle, request.model_copy(update={"session_id": session.id}), memories, owner_id=owner_id, api_config=None)
    return response.model_dump(mode="json")


def _product_datasets(region_id: str, bundle: dict[str, Any] | None = None) -> dict[str, list[Any]]:
    bundle = bundle or get_realtime_bundle(region_id)
    events = list(bundle.get("events") or [])
    summary = bundle.get("observation_summary") or {}
    argo = bundle.get("argo_region") or {}
    event_coordinates = [
        {
            "id": event.id,
            "longitude": event.centroid[0],
            "latitude": event.centroid[1],
            "timestamp": event.source_updated_at or event.started_at,
            "record_class": "anomaly_candidate" if event.event_kind == "anomaly" else "observation",
            "variables": event.variables,
            "source_dataset": "events",
        }
        for event in events
    ]
    event_evidence = []
    for event in events:
        for evidence in event.evidence:
            payload = evidence.model_dump(mode="json")
            payload.update({"event_id": event.id, "longitude": event.centroid[0], "latitude": event.centroid[1], "source_dataset": "event_evidence"})
            event_evidence.append(payload)
    sst_points = [dict(item, source_dataset="sst_latest_points") for item in list(summary.get("sst_latest_points") or [])]
    argo_floats = [dict(item, source_dataset="argo_floats") for item in list(argo.get("floats") or [])]
    all_coordinates = [*event_coordinates, *sst_points, *argo_floats]
    return {
        "events": events,
        "observations": [item for item in events if item.event_kind == "observation"],
        "anomaly_candidates": [item for item in events if item.event_kind == "anomaly"],
        "event_coordinates": event_coordinates,
        "event_evidence": event_evidence,
        "sst_latest_points": list(summary.get("sst_latest_points") or []),
        "sst_timeline": list(summary.get("sst_timeline") or []),
        "variable_summaries": list(summary.get("variables") or []),
        "argo_floats": list(argo.get("floats") or []),
        "argo_profiles": list(argo.get("profiles") or []),
        "sources": list(bundle.get("sources") or []),
        "lifecycle": list(get_event_lifecycle_records(region_id)),
        "all_coordinates": all_coordinates,
    }


def _data_catalog(arguments: dict[str, Any]) -> dict[str, Any]:
    region_id = _region_id(arguments)
    datasets = _product_datasets(region_id)
    return {
        "region_id": region_id,
        "datasets": [
            {
                "dataset_id": dataset_id,
                "record_count": len(records),
                "pageable": True,
                "coordinate_fields": any(isinstance(item, dict) and "longitude" in item and "latitude" in item for item in records[:10]),
                "sample_fields": sorted(jsonable_encoder(records[0]).keys()) if records and isinstance(jsonable_encoder(records[0]), dict) else [],
            }
            for dataset_id, records in datasets.items()
        ],
        "pagination": {"cursor": "zero-based offset", "maximum_limit": 1000},
    }


def _coordinate_value(record: Any, key: str) -> float | None:
    payload = jsonable_encoder(record)
    if not isinstance(payload, dict):
        return None
    value = payload.get(key)
    if value is None and isinstance(payload.get("centroid"), (list, tuple)) and len(payload["centroid"]) >= 2:
        value = payload["centroid"][0 if key == "longitude" else 1]
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _bounded_records(records: list[Any], arguments: dict[str, Any]) -> list[Any]:
    bounds = (
        arguments.get("minimum_longitude"), arguments.get("maximum_longitude"),
        arguments.get("minimum_latitude"), arguments.get("maximum_latitude"),
    )
    if all(value is None for value in bounds):
        return records
    minimum_longitude = float(bounds[0]) if bounds[0] is not None else -180.0
    maximum_longitude = float(bounds[1]) if bounds[1] is not None else 180.0
    minimum_latitude = float(bounds[2]) if bounds[2] is not None else -90.0
    maximum_latitude = float(bounds[3]) if bounds[3] is not None else 90.0
    result = []
    for record in records:
        longitude = _coordinate_value(record, "longitude")
        latitude = _coordinate_value(record, "latitude")
        if longitude is not None and latitude is not None and minimum_longitude <= longitude <= maximum_longitude and minimum_latitude <= latitude <= maximum_latitude:
            result.append(record)
    return result


def _page(records: list[Any], arguments: dict[str, Any]) -> dict[str, Any]:
    filtered = _bounded_records(records, arguments)
    cursor = max(0, int(arguments.get("cursor") or 0))
    limit = max(1, min(int(arguments.get("limit") or 200), 1000))
    items = filtered[cursor : cursor + limit]
    next_cursor = cursor + len(items) if cursor + len(items) < len(filtered) else None
    return {"total": len(filtered), "cursor": cursor, "limit": limit, "returned": len(items), "next_cursor": next_cursor, "has_more": next_cursor is not None, "items": jsonable_encoder(items)}


def _request_owner(arguments: dict[str, Any]) -> str:
    internal_owner = getattr(MCP_INTERNAL_OWNER, "value", None)
    if internal_owner:
        return str(internal_owner)
    return _validated_memory_owner(arguments) if arguments.get("__tenant_token") else "service"


def _cursor_signer() -> SignedCursor:
    secret = os.getenv("OCEAN_CODEX_TENANT_SECRET") or os.getenv("OCEAN_CODEX_MCP_TOKEN") or "ocean-mcp-development-cursor"
    return SignedCursor(secret)


def _requested_bounds(arguments: dict[str, Any]) -> dict[str, float] | None:
    keys = ("minimum_longitude", "maximum_longitude", "minimum_latitude", "maximum_latitude")
    if all(arguments.get(key) is None for key in keys):
        return None
    return {
        "minimum_longitude": float(arguments.get("minimum_longitude", -180)),
        "maximum_longitude": float(arguments.get("maximum_longitude", 180)),
        "minimum_latitude": float(arguments.get("minimum_latitude", -90)),
        "maximum_latitude": float(arguments.get("maximum_latitude", 90)),
    }


def _page_metadata(*, region_id: str, dataset_id: str, data_version: str | None, arguments: dict[str, Any], records: list[Any], total: int, complete: bool) -> dict[str, Any]:
    encoded = jsonable_encoder(records)
    missing = 0
    masked = 0
    valid_times: list[str] = []
    units: set[str] = set()
    for record in encoded:
        if not isinstance(record, dict):
            continue
        missing += sum(value is None for value in record.values())
        masked += int(bool(record.get("masked") or record.get("is_masked")))
        timestamp = _record_time(record)
        if timestamp:
            valid_times.append(timestamp)
        unit = record.get("unit") or record.get("units")
        if unit:
            units.add(str(unit))
    return {
        "dataset_id": dataset_id,
        "product_id": SERVER_NAME,
        "data_class": "product-derived" if dataset_id in {"events", "anomaly_candidates", "lifecycle"} else "observation",
        "processing_level": "product-normalized",
        "original_units": sorted(units),
        "requested_bounds": _requested_bounds(arguments),
        "effective_bounds": get_region(region_id).get("bounds"),
        "valid_time": {"start": min(valid_times) if valid_times else None, "end": max(valid_times) if valid_times else None},
        "fetch_time": datetime.now(UTC).isoformat(),
        "data_version": data_version,
        "data_latency_seconds": None,
        "quality_control": "source QC fields preserved; no implicit promotion to validated event",
        "missing_value_count": missing,
        "masked_record_count": masked,
        "complete": complete,
        "sampled": len(records) < total,
    }


def _snapshot_page(region_id: str, dataset_id: str, records: list[Any], arguments: dict[str, Any], data_version: str | None) -> dict[str, Any]:
    owner_id = _request_owner(arguments)
    snapshot_id = str(arguments.get("snapshot_id") or "").strip()
    cursor_token = str(arguments.get("cursor_token") or "").strip()
    offset = max(0, int(arguments.get("cursor") or 0))
    if cursor_token:
        cursor_payload = _cursor_signer().decode(cursor_token)
        if cursor_payload.get("owner_id") != owner_id or cursor_payload.get("region_id") != region_id or cursor_payload.get("dataset_id") != dataset_id:
            raise ValueError("cursor token scope does not match this request")
        snapshot_id = str(cursor_payload.get("snapshot_id") or "")
        offset = max(0, int(cursor_payload.get("offset") or 0))
    snapshot = MCP_STATE.get_snapshot(snapshot_id, owner_id, region_id, dataset_id) if snapshot_id else None
    if snapshot_id and snapshot is None:
        raise LookupError("snapshot is missing or expired")
    if snapshot is None:
        filtered = jsonable_encoder(_bounded_records(records, arguments))
        snapshot = MCP_STATE.create_snapshot(owner_id, region_id, dataset_id, data_version, filtered, MCP_SNAPSHOT_TTL)
    stable_records = list(snapshot["records"])
    limit = max(1, min(int(arguments.get("limit") or 200), 1000))
    items = stable_records[offset : offset + limit]
    next_offset = offset + len(items) if offset + len(items) < len(stable_records) else None
    cursor_base = {
        "owner_id": owner_id, "region_id": region_id, "dataset_id": dataset_id,
        "snapshot_id": snapshot["snapshot_id"], "exp": snapshot["expires_at"],
    }
    return {
        "total": len(stable_records), "cursor": offset, "limit": limit, "returned": len(items),
        "next_cursor": next_offset, "has_more": next_offset is not None, "items": items,
        "snapshot_id": snapshot["snapshot_id"], "snapshot_expires_at": snapshot["expires_at"],
        "data_version": snapshot.get("data_version"),
        "cursor_token": _cursor_signer().encode({**cursor_base, "offset": offset}),
        "next_cursor_token": _cursor_signer().encode({**cursor_base, "offset": next_offset}) if next_offset is not None else None,
        "source_metadata": _page_metadata(region_id=region_id, dataset_id=dataset_id, data_version=snapshot.get("data_version"), arguments=arguments, records=items, total=len(stable_records), complete=next_offset is None),
    }


def _data_page(arguments: dict[str, Any]) -> dict[str, Any]:
    region_id = _region_id(arguments)
    dataset_id = str(arguments.get("dataset_id") or "").strip()
    bundle = get_realtime_bundle(region_id)
    datasets = _product_datasets(region_id, bundle)
    if dataset_id not in datasets:
        raise ValueError(f"Unknown dataset_id: {dataset_id}")
    data_version = str(bundle.get("refreshed_at") or bundle.get("updated_at") or "") or None
    return {"region_id": region_id, "dataset_id": dataset_id, **_snapshot_page(region_id, dataset_id, datasets[dataset_id], arguments, data_version)}


def _source_payload(arguments: dict[str, Any]) -> dict[str, Any]:
    region_id = _region_id(arguments)
    source = str(arguments.get("source") or "").strip()
    region = get_region(region_id)
    bounds = region["bounds"]
    refresh = bool(arguments.get("refresh", False))
    loaders: dict[str, Callable[[], dict[str, Any]]] = {
        "noaa_sst": lambda: get_noaa_sst(region_id, bounds, force_refresh=refresh),
        "noaa_chlorophyll_anomaly": lambda: get_noaa_chlorophyll_anomaly(region_id, bounds, force_refresh=refresh),
        "noaa_chlorophyll_observations": lambda: get_noaa_chlorophyll_observations(region_id, bounds, force_refresh=refresh),
        "noaa_currents": lambda: get_noaa_currents(region_id, bounds, force_refresh=refresh),
        "noaa_carbon": lambda: get_noaa_carbon(bounds, limit=5000),
        "woa_nitrate": lambda: get_woa_nitrate(bounds, limit=5000),
        "woa_salinity": lambda: get_woa_salinity(bounds, limit=5000),
        "argo": lambda: get_argo_region(region_id=region_id, bounds=bounds, region_name=region["name"], force_refresh=refresh),
    }
    loader = loaders.get(source)
    if loader is None:
        raise ValueError(f"Unknown source: {source}")
    return jsonable_encoder(loader())


def _array_collections(value: Any, prefix: str = "") -> dict[str, list[Any]]:
    collections: dict[str, list[Any]] = {}
    if isinstance(value, list):
        collections[prefix or "items"] = value
    elif isinstance(value, dict):
        for key, child in value.items():
            child_prefix = f"{prefix}.{key}" if prefix else str(key)
            collections.update(_array_collections(child, child_prefix))
    return collections


def _source_catalog(arguments: dict[str, Any]) -> dict[str, Any]:
    payload = _source_payload(arguments)
    collections = _array_collections(payload)
    return {
        "region_id": _region_id(arguments),
        "source": str(arguments.get("source") or ""),
        "collections": [{"collection": path, "record_count": len(records), "sample_fields": sorted(records[0].keys()) if records and isinstance(records[0], dict) else []} for path, records in collections.items()],
        "metadata": {key: value for key, value in payload.items() if not isinstance(value, (list, dict))},
    }


def _source_data_page(arguments: dict[str, Any]) -> dict[str, Any]:
    source = str(arguments.get("source") or "").strip()
    collection = str(arguments.get("collection") or "").strip()
    region_id = _region_id(arguments)
    snapshot_dataset_id = f"source:{source}:{collection}"
    owner_id = _request_owner(arguments)
    existing_snapshot_id = str(arguments.get("snapshot_id") or "").strip()
    cursor_token = str(arguments.get("cursor_token") or "").strip()
    if cursor_token:
        decoded = _cursor_signer().decode(cursor_token)
        existing_snapshot_id = str(decoded.get("snapshot_id") or "")
    if existing_snapshot_id:
        snapshot = MCP_STATE.get_snapshot(existing_snapshot_id, owner_id, region_id, snapshot_dataset_id)
        if snapshot is None:
            raise LookupError("source snapshot is missing or expired")
        return {"region_id": region_id, "source": source, "collection": collection, **_snapshot_page(region_id, snapshot_dataset_id, [], arguments, snapshot.get("data_version"))}
    if source in {"noaa_carbon", "woa_nitrate", "woa_salinity"} and collection == "points":
        region = get_region(region_id)
        (default_west, default_south), (default_east, default_north) = region["bounds"]
        bounds = (
            (
                float(arguments.get("minimum_longitude")) if arguments.get("minimum_longitude") is not None else default_west,
                float(arguments.get("minimum_latitude")) if arguments.get("minimum_latitude") is not None else default_south,
            ),
            (
                float(arguments.get("maximum_longitude")) if arguments.get("maximum_longitude") is not None else default_east,
                float(arguments.get("maximum_latitude")) if arguments.get("maximum_latitude") is not None else default_north,
            ),
        )
        records: list[Any] = []
        offset = 0
        page_size = 5000
        max_records = max(1000, int(os.getenv("OCEAN_MCP_SOURCE_SNAPSHOT_MAX_RECORDS", "200000")))
        metadata: dict[str, Any] = {}
        while offset < max_records:
            loaders = {
                "noaa_carbon": lambda: get_noaa_carbon(bounds, limit=page_size, offset=offset, page=True),
                "woa_nitrate": lambda: get_woa_nitrate(bounds, limit=page_size, offset=offset, page=True),
                "woa_salinity": lambda: get_woa_salinity(bounds, limit=page_size, offset=offset, page=True),
            }
            payload = jsonable_encoder(loaders[source]())
            page_records = list(payload.get("points") or [])
            records.extend(page_records)
            metadata = payload
            available = int(payload.get("available_count") or len(records))
            offset += len(page_records)
            if not page_records or offset >= available:
                break
        result = _snapshot_page(region_id, snapshot_dataset_id, records, arguments, str(metadata.get("refreshed_at") or metadata.get("fetched_at") or "") or None)
        result["source_metadata"].update({"source": source, "effective_bounds": bounds, "upstream_available_count": int(metadata.get("available_count") or len(records)), "truncated_by_server_cap": len(records) >= max_records})
        return {"region_id": region_id, "source": source, "collection": collection, "complete_source_pagination": len(records) < max_records, **result}
    payload = _source_payload(arguments)
    collections = _array_collections(payload)
    if collection not in collections:
        raise ValueError(f"Unknown collection: {collection}")
    version = str(payload.get("refreshed_at") or payload.get("fetched_at") or payload.get("updated_at") or "") or None
    result = _snapshot_page(region_id, snapshot_dataset_id, collections[collection], arguments, version)
    result["source_metadata"].update({"source": source, "source_product_id": payload.get("product_id") or payload.get("dataset_id"), "processing_level": payload.get("processing_level") or result["source_metadata"]["processing_level"]})
    return {"region_id": region_id, "source": source, "collection": collection, **result}


def _dataset(arguments: dict[str, Any]) -> tuple[str, str, list[Any]]:
    region_id = _region_id(arguments)
    dataset_id = str(arguments.get("dataset_id") or "").strip()
    datasets = _product_datasets(region_id)
    if dataset_id not in datasets:
        raise ValueError(f"Unknown dataset_id: {dataset_id}")
    return region_id, dataset_id, datasets[dataset_id]


def _data_schema(arguments: dict[str, Any]) -> dict[str, Any]:
    region_id, dataset_id, records = _dataset(arguments)
    fields: dict[str, set[str]] = {}
    for record in records[:100]:
        payload = jsonable_encoder(record)
        if not isinstance(payload, dict):
            continue
        for key, value in payload.items():
            fields.setdefault(key, set()).add("null" if value is None else type(value).__name__)
    return {"region_id": region_id, "dataset_id": dataset_id, "record_count": len(records), "fields": [{"name": key, "types": sorted(types)} for key, types in sorted(fields.items())], "has_coordinates": "longitude" in fields and "latitude" in fields or "centroid" in fields, "time_fields": [key for key in fields if "time" in key or key.endswith("_at") or key == "timestamp"]}


def _record_time(payload: dict[str, Any]) -> str:
    for key in ("timestamp", "source_updated_at", "started_at", "observed_at", "fetched_at", "updated_at"):
        if payload.get(key):
            return str(payload[key])
    return ""


def _data_search(arguments: dict[str, Any]) -> dict[str, Any]:
    region_id, dataset_id, records = _dataset(arguments)
    query = str(arguments.get("query") or "").strip().casefold()
    variable = str(arguments.get("variable") or "").strip().casefold()
    start_time = str(arguments.get("start_time") or "").strip()
    end_time = str(arguments.get("end_time") or "").strip()
    matches = []
    for record in _bounded_records(records, arguments):
        payload = jsonable_encoder(record)
        if not isinstance(payload, dict):
            continue
        serialized = json.dumps(payload, ensure_ascii=False).casefold()
        if query and query not in serialized:
            continue
        variables = payload.get("variables") or payload.get("variable") or ""
        if variable and variable not in json.dumps(variables, ensure_ascii=False).casefold():
            continue
        timestamp = _record_time(payload)
        if start_time and timestamp and timestamp < start_time:
            continue
        if end_time and timestamp and timestamp > end_time:
            continue
        matches.append(record)
    search_id = f"{dataset_id}:search:{hashlib.sha256(json.dumps({key: arguments.get(key) for key in ('query', 'variable', 'start_time', 'end_time', 'minimum_longitude', 'maximum_longitude', 'minimum_latitude', 'maximum_latitude')}, sort_keys=True, default=str).encode()).hexdigest()[:16]}"
    page = _snapshot_page(region_id, search_id, matches, arguments, str(get_realtime_bundle(region_id).get("refreshed_at") or "") or None)
    return {"region_id": region_id, "dataset_id": dataset_id, "query": query or None, "variable": variable or None, **page}


def _record_identity(record: Any) -> str:
    payload = jsonable_encoder(record)
    if isinstance(payload, dict):
        for key in ("id", "event_id", "platform_id", "platform", "wmo", "profile_id", "source_id"):
            if payload.get(key) not in (None, ""):
                return f"{key}:{payload[key]}"
        stable = {key: payload.get(key) for key in ("longitude", "latitude", "timestamp", "observed_at", "variable", "depth") if key in payload}
        if stable:
            return "record:" + hashlib.sha256(json.dumps(stable, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()
    return "record:" + hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def _data_changes(arguments: dict[str, Any]) -> dict[str, Any]:
    region_id = _region_id(arguments)
    dataset_id = str(arguments.get("dataset_id") or "").strip()
    owner_id = _request_owner(arguments)
    bundle = get_realtime_bundle(region_id)
    datasets = _product_datasets(region_id, bundle)
    if dataset_id not in datasets:
        raise ValueError(f"Unknown dataset_id: {dataset_id}")
    current_records = jsonable_encoder(datasets[dataset_id])
    current_by_id = {_record_identity(record): record for record in current_records}
    base_snapshot_id = str(arguments.get("base_snapshot_id") or "").strip()
    base_snapshot = MCP_STATE.get_snapshot(base_snapshot_id, owner_id, region_id, dataset_id) if base_snapshot_id else None
    if base_snapshot_id and base_snapshot is None:
        raise LookupError("base snapshot is missing or expired")
    base_by_id = {_record_identity(record): record for record in (base_snapshot or {}).get("records", [])}
    updated_after = str(arguments.get("updated_after") or "").strip()
    revision_after = str(arguments.get("revision_after") or "").strip()
    changes: list[dict[str, Any]] = []
    for record_id, record in current_by_id.items():
        previous = base_by_id.get(record_id)
        timestamp = _record_time(record) if isinstance(record, dict) else ""
        is_changed = previous is None or previous != record
        if updated_after and timestamp and timestamp <= updated_after:
            is_changed = False
        if revision_after and str(bundle.get("refreshed_at") or "") <= revision_after:
            is_changed = False
        if is_changed:
            changes.append({"change_type": "insert" if previous is None else "update", "record_id": record_id, "record": record, "updated_at": timestamp or bundle.get("refreshed_at")})
    for record_id in base_by_id.keys() - current_by_id.keys():
        changes.append({"change_type": "delete", "record_id": record_id, "tombstone": True, "deleted_at": bundle.get("refreshed_at")})
    changes.sort(key=lambda item: (str(item.get("updated_at") or item.get("deleted_at") or ""), item["record_id"]))
    change_dataset_id = f"{dataset_id}:changes:{base_snapshot_id or updated_after or revision_after or 'initial'}"
    page = _snapshot_page(region_id, change_dataset_id, changes, arguments, str(bundle.get("refreshed_at") or "") or None)
    return {
        "region_id": region_id,
        "dataset_id": dataset_id,
        "base_snapshot_id": base_snapshot_id or None,
        "updated_after": updated_after or None,
        "revision_after": revision_after or None,
        "inserted": sum(item["change_type"] == "insert" for item in changes),
        "updated": sum(item["change_type"] == "update" for item in changes),
        "deleted": sum(item["change_type"] == "delete" for item in changes),
        **page,
    }


def _distance_km(longitude: float, latitude: float, target_longitude: float, target_latitude: float) -> float:
    radius = 6371.0088
    lat1, lat2 = math.radians(latitude), math.radians(target_latitude)
    delta_latitude = lat2 - lat1
    delta_longitude = math.radians(target_longitude - longitude)
    value = math.sin(delta_latitude / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta_longitude / 2) ** 2
    return 2 * radius * math.asin(min(1.0, math.sqrt(value)))


def _coordinate_nearest(arguments: dict[str, Any]) -> dict[str, Any]:
    region_id, dataset_id, records = _dataset(arguments)
    longitude = float(arguments["longitude"])
    latitude = float(arguments["latitude"])
    maximum_distance = float(arguments.get("maximum_distance_km")) if arguments.get("maximum_distance_km") is not None else None
    ranked = []
    for record in records:
        record_longitude = _coordinate_value(record, "longitude")
        record_latitude = _coordinate_value(record, "latitude")
        if record_longitude is None or record_latitude is None:
            continue
        distance = _distance_km(longitude, latitude, record_longitude, record_latitude)
        if maximum_distance is None or distance <= maximum_distance:
            ranked.append((distance, record))
    ranked.sort(key=lambda item: item[0])
    limit = max(1, min(int(arguments.get("limit") or 10), 100))
    return {"region_id": region_id, "dataset_id": dataset_id, "query_point": {"longitude": longitude, "latitude": latitude}, "matched_count": len(ranked), "items": [{"distance_km": round(distance, 3), "record": jsonable_encoder(record)} for distance, record in ranked[:limit]]}


def _data_aggregate(arguments: dict[str, Any]) -> dict[str, Any]:
    region_id, dataset_id, records = _dataset(arguments)
    field = str(arguments.get("field") or "").strip()
    values = []
    missing = 0
    for record in _bounded_records(records, arguments):
        payload = jsonable_encoder(record)
        value = payload.get(field) if isinstance(payload, dict) else None
        try:
            number = float(value)
        except (TypeError, ValueError):
            missing += 1
            continue
        if math.isfinite(number):
            values.append(number)
        else:
            missing += 1
    if not values:
        raise ValueError(f"No finite numeric values found for field: {field}")
    return {"region_id": region_id, "dataset_id": dataset_id, "field": field, "count": len(values), "missing_count": missing, "minimum": min(values), "mean": statistics.fmean(values), "median": statistics.median(values), "maximum": max(values), "population_standard_deviation": statistics.pstdev(values)}


def _event_argo(arguments: dict[str, Any]) -> dict[str, Any]:
    event = _find_event_for_tool(arguments)
    region = get_region(event.region_id)
    return jsonable_encoder(get_event_argo(event.id, event.title, event.centroid, event.radius_km, radius_basis=event.radius_basis, platform=str(arguments.get("platform") or "").strip() or None, region_id=region["id"], bounds=region["bounds"], region_name=region["name"], force_refresh=bool(arguments.get("refresh", False))))


def _atlas_entry(arguments: dict[str, Any]) -> dict[str, Any]:
    name = str(arguments.get("name") or "").strip()
    entry = atlas_entry(name)
    if entry is None:
        raise LookupError(f"Marine atlas entry not found: {name}")
    return {"version": ATLAS_VERSION, "entry": entry, "profile": atlas_profile(entry), "supplement": atlas_supplement(entry)}


def _mcp_coverage(_: dict[str, Any]) -> dict[str, Any]:
    return {
        "server_version": SERVER_VERSION,
        "tool_count": len(TOOLS),
        "covered_domains": ["health", "regions", "metrics", "observations", "events", "signals", "coverage", "sources", "workspace", "Copernicus", "Argo", "marine context", "bathymetry", "daily briefing", "literature", "detection", "reports", "agent chat", "sessions", "memories", "refresh jobs", "performance", "raw source pagination"],
        "security_exclusions": ["passwords", "session cookies", "API key plaintext", "database credentials", "deployment secrets", "unrestricted filesystem access"],
        "data_guarantee": "Every exposed collection has an exact count or an upstream available_count and can be traversed through cursor pagination; intrinsically remote datasets remain subject to upstream availability.",
    }


def _owner_scope(arguments: dict[str, Any]) -> str:
    return _validated_memory_owner(arguments)


def _session_list(arguments: dict[str, Any]) -> list[dict[str, Any]]:
    region_id = str(arguments.get("region_id") or "").strip() or None
    if region_id and region_id not in REGIONS:
        raise ValueError(f"Unknown region_id: {region_id}")
    sessions = memory_store.list_sessions(region_id, include_archived=bool(arguments.get("include_archived", False)), limit=max(1, min(int(arguments.get("limit") or 80), 200)), owner_id=_owner_scope(arguments))
    return [item.model_dump(mode="json") for item in sessions]


def _session_get(arguments: dict[str, Any]) -> dict[str, Any]:
    session_id = str(arguments.get("session_id") or "").strip()
    session = memory_store.get_session(session_id, owner_id=_owner_scope(arguments))
    if session is None:
        raise LookupError(f"Session not found: {session_id}")
    return session.model_dump(mode="json")


def _session_create(arguments: dict[str, Any]) -> dict[str, Any]:
    region_id = _region_id(arguments)
    session = memory_store.create_session(region_id, str(arguments.get("title") or "新对话"), str(arguments.get("selected_event_id") or "").strip() or None, owner_id=_owner_scope(arguments))
    return session.model_dump(mode="json")


def _session_update(arguments: dict[str, Any]) -> dict[str, Any]:
    session_id = str(arguments.get("session_id") or "").strip()
    session = memory_store.update_session(session_id, title=arguments.get("title"), archived=arguments.get("archived"), owner_id=_owner_scope(arguments))
    if session is None:
        raise LookupError(f"Session not found: {session_id}")
    return session.model_dump(mode="json")


def _session_delete(arguments: dict[str, Any]) -> dict[str, Any]:
    session_id = str(arguments.get("session_id") or "").strip()
    return {"deleted": memory_store.delete_session(session_id, owner_id=_owner_scope(arguments)), "session_id": session_id}


def _memory_list(arguments: dict[str, Any]) -> list[dict[str, Any]]:
    region_id = str(arguments.get("region_id") or "").strip() or None
    if region_id and region_id not in REGIONS:
        raise ValueError(f"Unknown region_id: {region_id}")
    memories = memory_store.list_memories(region_id, include_disabled=bool(arguments.get("include_disabled", True)), limit=max(1, min(int(arguments.get("limit") or 100), 200)), owner_id=_owner_scope(arguments))
    return [item.model_dump(mode="json") for item in memories]


def _memory_update(arguments: dict[str, Any]) -> dict[str, Any]:
    memory_id = str(arguments.get("memory_id") or "").strip()
    memory = memory_store.update_memory(memory_id, content=arguments.get("content"), enabled=arguments.get("enabled"), confidence=arguments.get("confidence"), owner_id=_owner_scope(arguments))
    if memory is None:
        raise LookupError(f"Memory not found: {memory_id}")
    return memory.model_dump(mode="json")


def _memory_delete(arguments: dict[str, Any]) -> dict[str, Any]:
    memory_id = str(arguments.get("memory_id") or "").strip()
    return {"deleted": memory_store.delete_memory(memory_id, owner_id=_owner_scope(arguments)), "memory_id": memory_id}


def _tenant_claims(arguments: dict[str, Any]) -> dict[str, Any]:
    token = str(arguments.get("__tenant_token") or "").strip()
    secret = os.getenv("OCEAN_CODEX_TENANT_SECRET", "").strip()
    if not token or not secret or "." not in token:
        raise ValueError("valid runtime-injected tenant identity is required")
    payload_part, signature = token.split(".", 1)
    expected = base64.urlsafe_b64encode(
        hmac.new(secret.encode("utf-8"), payload_part.encode("ascii"), hashlib.sha256).digest()
    ).decode("ascii").rstrip("=")
    if not hmac.compare_digest(expected, signature):
        raise ValueError("tenant identity signature is invalid")
    try:
        padded = payload_part + "=" * (-len(payload_part) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("tenant identity payload is invalid") from error
    now = int(datetime.now(UTC).timestamp())
    if payload.get("aud") != "ocean-intelligence-mcp" or not str(payload.get("sub") or "").strip():
        raise ValueError("tenant identity scope is invalid")
    if int(payload.get("iat") or 0) > now + 15 or int(payload.get("exp") or 0) < now:
        raise ValueError("tenant identity is expired")
    return payload


def _validated_memory_owner(arguments: dict[str, Any]) -> str:
    return str(_tenant_claims(arguments)["sub"]).strip()


LONG_RUNNING_TOOLS = {
    "ocean_copernicus_dataset_analyze", "ocean_copernicus_wave_region", "ocean_copernicus_wind_region",
    "ocean_current_field", "ocean_copernicus_global_daily_volume", "ocean_argo_region", "ocean_refresh",
    "ocean_data_page", "ocean_data_search", "ocean_data_changes", "ocean_source_data_page",
}


def _job_is_cancelled(job_id: str, owner_id: str) -> bool:
    job = MCP_STATE.get_job(job_id, owner_id)
    return job is None or bool(job.get("cancel_requested"))


def _flatten_record(record: Any) -> dict[str, Any]:
    payload = jsonable_encoder(record)
    if not isinstance(payload, dict):
        return {"value": payload}
    flattened: dict[str, Any] = {}
    for key, value in payload.items():
        flattened[key] = json.dumps(value, ensure_ascii=False, default=str) if isinstance(value, (dict, list)) else value
    return flattened


def _export_records(job_id: str, owner_id: str, request: dict[str, Any]) -> dict[str, Any]:
    region_id = _region_id(request)
    dataset_id = str(request.get("dataset_id") or "").strip()
    export_format = str(request.get("format") or "").lower()
    snapshot_id = str(request.get("snapshot_id") or "").strip()
    snapshot = MCP_STATE.get_snapshot(snapshot_id, owner_id, region_id, dataset_id) if snapshot_id else None
    if snapshot_id and snapshot is None:
        raise LookupError("export snapshot is missing or expired")
    if snapshot is None:
        bundle = get_realtime_bundle(region_id)
        datasets = _product_datasets(region_id, bundle)
        if dataset_id not in datasets:
            raise ValueError(f"Unknown dataset_id: {dataset_id}")
        snapshot = MCP_STATE.create_snapshot(owner_id, region_id, dataset_id, str(bundle.get("refreshed_at") or "") or None, jsonable_encoder(datasets[dataset_id]), MCP_SNAPSHOT_TTL)
    records = list(snapshot["records"])
    export_root = Path(os.getenv("OCEAN_MCP_EXPORT_DIR", str(Path(__file__).resolve().parents[2] / ".runtime" / "mcp-exports")))
    owner_dir = export_root / hashlib.sha256(owner_id.encode()).hexdigest()[:24]
    owner_dir.mkdir(parents=True, exist_ok=True)
    suffix = {"csv": "csv", "geojson": "geojson", "ndjson": "ndjson", "parquet": "parquet", "netcdf": "nc"}.get(export_format)
    if suffix is None:
        raise ValueError(f"Unsupported export format: {export_format}")
    path = owner_dir / f"{job_id}.{suffix}"
    flattened = [_flatten_record(record) for record in records]
    if export_format == "csv":
        fieldnames = sorted({key for record in flattened for key in record})
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(flattened)
    elif export_format == "ndjson":
        with path.open("w", encoding="utf-8") as handle:
            for record in records:
                handle.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")
    elif export_format == "geojson":
        features = []
        for record in records:
            longitude = _coordinate_value(record, "longitude")
            latitude = _coordinate_value(record, "latitude")
            properties = jsonable_encoder(record)
            features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [longitude, latitude]} if longitude is not None and latitude is not None else None, "properties": properties})
        path.write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, default=str), encoding="utf-8")
    elif export_format == "parquet":
        import pyarrow as pa
        import pyarrow.parquet as pq
        pq.write_table(pa.Table.from_pylist(flattened), path)
    else:
        from netCDF4 import Dataset
        with Dataset(path, "w", format="NETCDF4") as dataset:
            dataset.createDimension("record", len(flattened))
            keys = sorted({key for record in flattened for key in record})
            for key in keys:
                values = [record.get(key) for record in flattened]
                numeric = all(value is None or isinstance(value, (int, float, bool)) for value in values)
                variable_name = "v_" + "".join(character if character.isalnum() or character == "_" else "_" for character in key)
                variable = dataset.createVariable(variable_name, "f8" if numeric else str, ("record",), fill_value=float("nan") if numeric else None)
                variable.source_field = key
                if numeric:
                    variable[:] = [float(value) if value is not None else float("nan") for value in values]
                else:
                    for index, value in enumerate(values):
                        variable[index] = str(value or "")
            dataset.dataset_id = dataset_id
            dataset.snapshot_id = snapshot["snapshot_id"]
            dataset.data_version = str(snapshot.get("data_version") or "")
    return {
        "job_id": job_id, "format": export_format, "record_count": len(records), "size_bytes": path.stat().st_size,
        "file_name": path.name, "resource_uri": f"ocean://exports/{job_id}", "snapshot_id": snapshot["snapshot_id"],
        "data_version": snapshot.get("data_version"),
    }


def _batch_points(job_id: str, owner_id: str, request: dict[str, Any]) -> dict[str, Any]:
    points = list(request.get("points") or [])
    operations = list(dict.fromkeys(request.get("operations") or []))
    if not 1 <= len(points) <= 500:
        raise ValueError("points must contain 1 to 500 coordinates")
    tool_map = {
        "marine_area": "ocean_resolve_marine_area", "marine_context": "ocean_marine_context",
        "bathymetry": "ocean_bathymetry", "nearest_argo": "ocean_argo_nearest",
        "marine_knowledge": "ocean_marine_knowledge", "wave": "ocean_copernicus_wave_point", "wind": "ocean_copernicus_wind_point",
    }
    if not operations or any(operation not in tool_map for operation in operations):
        raise ValueError("one or more batch operations are invalid")
    results = []
    for index, point in enumerate(points):
        if _job_is_cancelled(job_id, owner_id):
            return {"results": results, "processed": index, "total": len(points), "cancelled": True}
        arguments = {"longitude": float(point["longitude"]), "latitude": float(point["latitude"])}
        if request.get("region_id"):
            arguments["region_id"] = request["region_id"]
        enriched: dict[str, Any] = {}
        for operation in operations:
            try:
                enriched[operation] = jsonable_encoder(_call_tool(tool_map[operation], arguments))
            except Exception as error:
                enriched[operation] = {"error": f"{type(error).__name__}: {error}"}
        results.append({"id": point.get("id") or str(index), **arguments, "data": enriched})
    return {"results": results, "processed": len(results), "total": len(points), "cancelled": False}


def _run_mcp_job(job_id: str, owner_id: str) -> None:
    job = MCP_STATE.get_job(job_id, owner_id)
    if job is None or job.get("cancel_requested"):
        return
    MCP_STATE.update_job(job_id, status="running")
    MCP_INTERNAL_OWNER.value = owner_id
    try:
        if job["kind"] == "tool":
            tool_name = str(job["request"].get("tool_name") or "")
            if tool_name not in LONG_RUNNING_TOOLS:
                raise ValueError("tool is not approved for generic background execution")
            result = _call_tool(tool_name, dict(job["request"].get("arguments") or {}))
        elif job["kind"] == "batch_points":
            result = _batch_points(job_id, owner_id, job["request"])
        elif job["kind"] == "export":
            result = _export_records(job_id, owner_id, job["request"])
        else:
            raise ValueError(f"Unknown job kind: {job['kind']}")
        if _job_is_cancelled(job_id, owner_id):
            MCP_STATE.update_job(job_id, status="cancelled", result_json=jsonable_encoder(result))
        else:
            MCP_STATE.update_job(job_id, status="completed", result_json=jsonable_encoder(result))
    except Exception as error:
        MCP_STATE.update_job(job_id, status="failed", error=f"{type(error).__name__}: {error}")
    finally:
        MCP_INTERNAL_OWNER.value = None


def _submit_job(owner_id: str, kind: str, request: dict[str, Any]) -> dict[str, Any]:
    job = MCP_STATE.create_job(owner_id, kind, request)
    MCP_JOB_EXECUTOR.submit(_run_mcp_job, job["job_id"], owner_id)
    return {key: value for key, value in job.items() if key not in {"owner_id", "request", "result"}}


def _job_submit(arguments: dict[str, Any]) -> dict[str, Any]:
    return _submit_job(_validated_memory_owner(arguments), "tool", {"tool_name": str(arguments.get("tool_name") or ""), "arguments": dict(arguments.get("arguments") or {})})


def _batch_points_submit(arguments: dict[str, Any]) -> dict[str, Any]:
    return _submit_job(_validated_memory_owner(arguments), "batch_points", {key: arguments.get(key) for key in ("points", "operations", "region_id")})


def _export_submit(arguments: dict[str, Any]) -> dict[str, Any]:
    return _submit_job(_validated_memory_owner(arguments), "export", {key: arguments.get(key) for key in ("region_id", "dataset_id", "snapshot_id", "format")})


def _export_result(arguments: dict[str, Any]) -> dict[str, Any]:
    owner_id = _validated_memory_owner(arguments)
    job = MCP_STATE.get_job(str(arguments.get("job_id") or ""), owner_id)
    if job is None or job.get("kind") != "export":
        raise LookupError("export job not found")
    if job.get("status") != "completed" or not isinstance(job.get("result"), dict):
        return {"job_id": job["job_id"], "status": job.get("status"), "error": job.get("error")}
    file_name = str(job["result"].get("file_name") or "")
    if not file_name or Path(file_name).name != file_name:
        raise LookupError("export artifact is unavailable")
    export_root = Path(os.getenv("OCEAN_MCP_EXPORT_DIR", str(Path(__file__).resolve().parents[2] / ".runtime" / "mcp-exports")))
    path = export_root / hashlib.sha256(owner_id.encode()).hexdigest()[:24] / file_name
    if not path.is_file():
        raise LookupError("export artifact is unavailable")
    offset = max(0, int(arguments.get("offset") or 0))
    max_bytes = max(1, min(int(arguments.get("max_bytes") or 262144), 1048576))
    with path.open("rb") as handle:
        handle.seek(offset)
        content = handle.read(max_bytes)
    next_offset = offset + len(content) if offset + len(content) < path.stat().st_size else None
    text_format = path.suffix in {".csv", ".geojson", ".ndjson"}
    return {
        "job_id": job["job_id"], "format": job["result"].get("format"), "offset": offset,
        "returned_bytes": len(content), "total_bytes": path.stat().st_size, "next_offset": next_offset,
        "encoding": "utf-8" if text_format else "base64",
        "content": content.decode("utf-8", errors="replace") if text_format else base64.b64encode(content).decode("ascii"),
    }


def _job_status(arguments: dict[str, Any]) -> dict[str, Any]:
    job = MCP_STATE.get_job(str(arguments.get("job_id") or ""), _validated_memory_owner(arguments))
    if job is None:
        raise LookupError("job not found")
    return {key: value for key, value in job.items() if key not in {"owner_id", "request", "result"}}


def _job_cancel(arguments: dict[str, Any]) -> dict[str, Any]:
    owner_id = _validated_memory_owner(arguments)
    job_id = str(arguments.get("job_id") or "")
    job = MCP_STATE.get_job(job_id, owner_id)
    if job is None:
        raise LookupError("job not found")
    MCP_STATE.update_job(job_id, cancel_requested=1, status="cancelled" if job["status"] == "queued" else job["status"])
    return {"job_id": job_id, "cancel_requested": True}


def _job_result_page(arguments: dict[str, Any]) -> dict[str, Any]:
    owner_id = _validated_memory_owner(arguments)
    job = MCP_STATE.get_job(str(arguments.get("job_id") or ""), owner_id)
    if job is None:
        raise LookupError("job not found")
    if job["status"] not in {"completed", "cancelled"}:
        return {"job_id": job["job_id"], "status": job["status"], "error": job.get("error")}
    result = job.get("result")
    sequence = result if isinstance(result, list) else next((value for key in ("results", "items", "records", "points") if isinstance(result, dict) and isinstance((value := result.get(key)), list)), None)
    if sequence is None:
        return {"job_id": job["job_id"], "status": job["status"], "result": result}
    cursor = max(0, int(arguments.get("cursor") or 0))
    limit = max(1, min(int(arguments.get("limit") or 200), 1000))
    items = sequence[cursor : cursor + limit]
    next_cursor = cursor + len(items) if cursor + len(items) < len(sequence) else None
    metadata = {key: value for key, value in result.items() if key not in {"results", "items", "records", "points"}} if isinstance(result, dict) else {}
    return {"job_id": job["job_id"], "status": job["status"], "total": len(sequence), "cursor": cursor, "limit": limit, "returned": len(items), "next_cursor": next_cursor, "result_metadata": metadata, "items": items}


def _audit_page(arguments: dict[str, Any]) -> dict[str, Any]:
    return MCP_STATE.audit_page(_validated_memory_owner(arguments), max(0, int(arguments.get("cursor") or 0)), max(1, min(int(arguments.get("limit") or 100), 500)))


def _call_tool(name: str, arguments: dict[str, Any]) -> Any:
    handlers: dict[str, Callable[[dict[str, Any]], Any]] = {
        "ocean_list_regions": lambda _: [dict(region) for region in REGIONS.values()],
        "ocean_resolve_marine_area": _resolve_marine_area,
        "ocean_region_nine_zone_grid": _region_nine_zone_grid,
        "ocean_nine_zone_point_inventory": _nine_zone_point_inventory,
        "ocean_anomaly_point_linkage": analyze_anomaly_linkages,
        "ocean_context_manifest": lambda args: build_agent_manifest(
            get_region(str(args.get("region_id") or DEFAULT_REGION_ID)),
            get_realtime_bundle(str(args.get("region_id") or DEFAULT_REGION_ID)),
        ).model_dump(mode="json"),
        "ocean_search_records": _search_records,
        "ocean_get_event": _get_event,
        "ocean_source_health": _source_health,
        "ocean_mainland_news": _mainland_news,
        "ocean_get_argo_profile": lambda args: get_argo_float(str(args.get("platform") or "")).model_dump(mode="json"),
        "ocean_copernicus_catalog_search": _copernicus_catalog_search,
        "ocean_copernicus_dataset_describe": _copernicus_dataset_describe,
        "ocean_copernicus_dataset_analyze": _copernicus_dataset_analyze,
        "ocean_physics_diagnostics": calculate_ocean_physics,
        "ocean_statistical_diagnostics": calculate_ocean_statistics,
        "ocean_copernicus_wave_point": _copernicus_wave_point,
        "ocean_copernicus_wave_region": _copernicus_wave_region,
        "ocean_copernicus_wave_audit": _copernicus_wave_audit,
        "ocean_copernicus_wind_point": _copernicus_wind_point,
        "ocean_copernicus_wind_region": _copernicus_wind_region,
        "ocean_copernicus_history": _copernicus_history,
        "ocean_copernicus_audit": _copernicus_audit,
        "ocean_memory_search": _search_memories,
        "ocean_memory_store": _store_memory,
        "ocean_product_health": _product_health,
        "ocean_product_metrics": _product_metrics,
        "ocean_observation_summary": _observation_summary,
        "ocean_event_catalog": _event_catalog,
        "ocean_event_lifecycle": _event_lifecycle,
        "ocean_marine_context": lambda args: _marine_point(args, get_marine_context),
        "ocean_marine_knowledge": lambda args: _marine_point(args, get_marine_knowledge),
        "ocean_bathymetry": lambda args: _marine_point(args, get_bathymetry),
        "ocean_current_field": lambda args: get_current_field(
            west=float(args["west"]), south=float(args["south"]), east=float(args["east"]), north=float(args["north"]),
            width=max(24, min(int(args.get("width") or 96), 160)), height=max(16, min(int(args.get("height") or 64), 120)),
            force_refresh=bool(args.get("refresh", False)),
        ),
        "ocean_argo_float_history": lambda args: get_argo_float_history(str(args.get("platform") or ""), date_count=max(1, min(int(args.get("date_count") or 7), 30)), force_refresh=bool(args.get("refresh", False))),
        "ocean_argo_region": _argo_region,
        "ocean_argo_nearest": _argo_nearest,
        "ocean_daily_briefing": _daily_briefing,
        "ocean_daily_dashboard": lambda args: get_daily_dashboard(force_refresh=bool(args.get("refresh", False))),
        "ocean_marine_atlas": _marine_atlas,
        "ocean_copernicus_event_page": _copernicus_events,
        "ocean_argo_realtime_status": lambda _: get_argo_realtime_status(),
        "ocean_copernicus_index_status": lambda _: index_status(),
        "ocean_workspace_snapshot": _workspace_snapshot,
        "ocean_detect_anomaly": _detect_anomaly,
        "ocean_event_report": _event_report,
        "ocean_event_explanation": _event_explanation,
        "ocean_event_literature": _event_literature,
        "ocean_refresh": _refresh,
        "ocean_refresh_job_submit": lambda args: jsonable_encoder(enqueue_refresh(_region_id(args))),
        "ocean_refresh_job_status": _refresh_job_status,
        "ocean_agent_context": lambda args: build_agent_manifest(get_region(_region_id(args)), get_realtime_bundle(_region_id(args))).model_dump(mode="json"),
        "ocean_agent_model_health": lambda _: model_runtime_snapshot(None),
        "ocean_agent_chat": _agent_chat,
        "ocean_data_catalog": _data_catalog,
        "ocean_data_page": _data_page,
        "ocean_source_catalog": _source_catalog,
        "ocean_source_data_page": _source_data_page,
        "ocean_agent_sessions": _session_list,
        "ocean_agent_session_get": _session_get,
        "ocean_agent_session_create": _session_create,
        "ocean_agent_session_update": _session_update,
        "ocean_agent_session_delete": _session_delete,
        "ocean_memories": _memory_list,
        "ocean_memory_update": _memory_update,
        "ocean_memory_delete": _memory_delete,
        "ocean_data_schema": _data_schema,
        "ocean_data_search": _data_search,
        "ocean_data_changes": _data_changes,
        "ocean_job_submit": _job_submit,
        "ocean_job_status": _job_status,
        "ocean_job_result_page": _job_result_page,
        "ocean_job_cancel": _job_cancel,
        "ocean_batch_points_submit": _batch_points_submit,
        "ocean_export_submit": _export_submit,
        "ocean_export_result": _export_result,
        "ocean_audit_page": _audit_page,
        "ocean_coordinate_nearest": _coordinate_nearest,
        "ocean_data_aggregate": _data_aggregate,
        "ocean_copernicus_global_daily_volume": lambda args: get_global_daily_data_volume(force_refresh=bool(args.get("refresh", False))),
        "ocean_copernicus_indexed_events": lambda args: read_event_page(cursor=max(0, int(args.get("cursor") or 0)), limit=max(1, min(int(args.get("limit") or 100), 500)), view=str(args.get("view") or "all"), area=str(args.get("area") or "").strip() or None, geography=str(args.get("geography") or "").strip() or None),
        "ocean_event_argo": _event_argo,
        "ocean_argo_explanation": lambda args: jsonable_encoder(get_argo_float(str(args.get("platform") or ""), force_refresh=bool(args.get("refresh", False))).get("explanation")),
        "ocean_atlas_entry": _atlas_entry,
        "ocean_performance": lambda _: PERFORMANCE.snapshot(),
        "ocean_mcp_coverage": _mcp_coverage,
    }
    handler = handlers.get(name)
    if handler is None:
        raise KeyError(f"Unknown tool: {name}")
    return handler(arguments)


def _resource_catalog() -> list[dict[str, Any]]:
    resources: list[dict[str, Any]] = []
    resources.extend([{
        "uri": "ocean://copernicus/capabilities",
        "name": "Copernicus Marine universal data capabilities",
        "description": "Dynamic catalogue discovery and bounded analysis workflow for any Copernicus Marine dataset and variable.",
        "mimeType": "application/json",
    }, {
        "uri": "ocean://product/capabilities",
        "name": "Ocean Intelligence product MCP capabilities",
        "description": "Capability catalogue, safe usage policy and recommended investigation workflow.",
        "mimeType": "application/json",
    }, {
        "uri": "ocean://product/health",
        "name": "Ocean Intelligence product health",
        "description": "Live product health and connected data status.",
        "mimeType": "application/json",
    }])
    for region_id, region in REGIONS.items():
        resources.extend([
            {
                "uri": f"ocean://regions/{region_id}/manifest",
                "name": f"{region['name']} data manifest",
                "description": "Counts, variables, time coverage, and source status. Fetches current cached data on read.",
                "mimeType": "application/json",
            },
            {
                "uri": f"ocean://regions/{region_id}/datasets",
                "name": f"{region['name']} pageable dataset catalogue",
                "description": "Exact current record counts for events, coordinates, SST grids, Argo, sources and lifecycle data.",
                "mimeType": "application/json",
            },
            {
                "uri": f"ocean://regions/{region_id}/copernicus/waves",
                "name": f"{region['name']} Copernicus Marine wave snapshot",
                "description": "Five-point Copernicus Marine numerical wave analysis snapshot with cache and valid-time metadata.",
                "mimeType": "application/json",
            },
            {
                "uri": f"ocean://regions/{region_id}/copernicus/wind",
                "name": f"{region['name']} Copernicus Marine wind snapshot",
                "description": "Five-point Copernicus Marine hourly L4 sea-surface wind snapshot with cache and evidence-class metadata.",
                "mimeType": "application/json",
            },
        ])
    return resources


def _read_resource(uri: str) -> dict[str, Any]:
    if uri == "ocean://product/capabilities":
        payload = {
            "server": {"name": SERVER_NAME, "version": SERVER_VERSION},
            "tool_groups": {
                "product": [tool["name"] for tool in TOOLS if tool["name"].startswith("ocean_product_") or tool["name"].startswith("ocean_daily_")],
                "science": [tool["name"] for tool in TOOLS if tool["name"].startswith("ocean_copernicus_") or tool["name"] in {"ocean_physics_diagnostics", "ocean_statistical_diagnostics", "ocean_anomaly_point_linkage"}],
                "geography": ["ocean_resolve_marine_area", "ocean_marine_context", "ocean_marine_knowledge", "ocean_bathymetry", "ocean_marine_atlas"],
                "argo": [tool["name"] for tool in TOOLS if tool["name"].startswith("ocean_argo_")],
            },
            "safety": {"writes": ["ocean_memory_store"], "all_other_tools": "read-only", "data_rule": "Never present contextual news or hypotheses as ocean evidence."},
            "workflow": ["Read this resource or the regional manifest.", "Resolve geography.", "Use bounded tool queries.", "Separate observations, model output, derived diagnostics and hypotheses."],
        }
        return {"contents": [{"uri": uri, "mimeType": "application/json", "text": json.dumps(payload, ensure_ascii=False)}]}
    if uri == "ocean://product/health":
        return {"contents": [{"uri": uri, "mimeType": "application/json", "text": json.dumps(jsonable_encoder(_product_health({})), ensure_ascii=False)}]}
    if uri == "ocean://copernicus/capabilities":
        payload = {
            "catalogue": "Complete Copernicus Marine catalogue is discoverable dynamically by topic, product id and dataset id.",
            "analysis": "Any discovered dataset can be queried by variable, longitude, latitude, time and optional depth bounds.",
            "tools": [
                "ocean_copernicus_catalog_search",
                "ocean_copernicus_dataset_describe",
                "ocean_copernicus_dataset_analyze",
            ],
            "workflow": [
                "Search catalogue when dataset id is unknown.",
                "Describe the selected dataset and choose exact variable short names.",
                "Run bounded analysis and preserve sampling, time and processing-level metadata in the report.",
            ],
        }
        return {"contents": [{"uri": uri, "mimeType": "application/json", "text": json.dumps(payload, ensure_ascii=False)}]}
    dataset_prefix, dataset_suffix = "ocean://regions/", "/datasets"
    if uri.startswith(dataset_prefix) and uri.endswith(dataset_suffix):
        region_id = uri[len(dataset_prefix) : -len(dataset_suffix)]
        if region_id not in REGIONS:
            raise LookupError(f"Unknown region resource: {uri}")
        payload = _data_catalog({"region_id": region_id})
        return {"contents": [{"uri": uri, "mimeType": "application/json", "text": json.dumps(jsonable_encoder(payload), ensure_ascii=False)}]}
    wind_prefix, wind_suffix = "ocean://regions/", "/copernicus/wind"
    if uri.startswith(wind_prefix) and uri.endswith(wind_suffix):
        region_id = uri[len(wind_prefix) : -len(wind_suffix)]
        if region_id not in REGIONS:
            raise LookupError(f"Unknown region resource: {uri}")
        region = get_region(region_id)
        snapshot = get_wind_region(region_id, region["bounds"])
        return {"contents": [{"uri": uri, "mimeType": "application/json", "text": json.dumps(jsonable_encoder(snapshot), ensure_ascii=False)}]}
    wave_prefix, wave_suffix = "ocean://regions/", "/copernicus/waves"
    if uri.startswith(wave_prefix) and uri.endswith(wave_suffix):
        region_id = uri[len(wave_prefix) : -len(wave_suffix)]
        if region_id not in REGIONS:
            raise LookupError(f"Unknown region resource: {uri}")
        region = get_region(region_id)
        snapshot = get_wave_region(region_id, region["bounds"])
        return {"contents": [{"uri": uri, "mimeType": "application/json", "text": json.dumps(jsonable_encoder(snapshot), ensure_ascii=False)}]}
    prefix, suffix = "ocean://regions/", "/manifest"
    if not uri.startswith(prefix) or not uri.endswith(suffix):
        raise LookupError(f"Unknown resource: {uri}")
    region_id = uri[len(prefix) : -len(suffix)]
    if region_id not in REGIONS:
        raise LookupError(f"Unknown region resource: {uri}")
    manifest = build_agent_manifest(get_region(region_id), get_realtime_bundle(region_id)).model_dump(mode="json")
    return {
        "contents": [
            {
                "uri": uri,
                "mimeType": "application/json",
                "text": json.dumps(manifest, ensure_ascii=False),
            }
        ]
    }


async def _legacy_codex_mcp_get(request: Request) -> Response:
    if not _authorized(request):
        return JSONResponse({"detail": "Codex MCP authentication failed"}, status_code=401)
    return JSONResponse(
        {
            "service": SERVER_NAME,
            "version": SERVER_VERSION,
            "transport": "streamable-http-json",
            "status": "ready",
        }
    )


async def _legacy_codex_mcp(request: Request) -> Response:
    if not _authorized(request):
        return JSONResponse({"detail": "Codex MCP authentication failed"}, status_code=401)
    try:
        payload = await request.json()
    except (ValueError, json.JSONDecodeError):
        return _rpc_error(None, -32700, "Parse error")
    if not isinstance(payload, dict):
        return _rpc_error(None, -32600, "Invalid Request")

    request_id = payload.get("id")
    method = str(payload.get("method") or "")
    params = payload.get("params") if isinstance(payload.get("params"), dict) else {}
    session_id = request.headers.get("Mcp-Session-Id", "").strip()
    if session_id and not MCP_STATE.session_exists(session_id) and method != "initialize":
        return _rpc_error(request_id, -32001, "MCP session is not found")
    if method.startswith("notifications/") or method == "initialized":
        return Response(status_code=204)
    if method == "initialize":
        requested = str(params.get("protocolVersion") or "2025-03-26")
        protocol = requested if requested in SUPPORTED_PROTOCOLS else "2025-03-26"
        session_id = MCP_STATE.create_session(protocol)
        return _mcp_response(_rpc_result(
            request_id,
            {
                "protocolVersion": protocol,
                "capabilities": {"tools": {"listChanged": False}, "resources": {"subscribe": False, "listChanged": False}, "prompts": {"listChanged": False}, "logging": {}},
                "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
                "instructions": (
                    "Use the manifest first, then query bounded record slices. Treat routine observations neutrally. "
                    "Resolve report geography before data queries: pass the user's full text to ocean_resolve_marine_area; if a point or selected record is present, resolve its centroid too. Explicit text geography takes priority, point geography is the fallback, and conflicts must be disclosed. "
                    "For every regional report, call ocean_region_nine_zone_grid before variable analysis, render the center point and the northwest/north/northeast/west/center/east/southwest/south/southeast index map, and aggregate every available gridded variable by those same nine zones. "
                    "For point observations, reconcile raw records, valid records and unique platforms; count Argo, buoy, coastal and other platforms in every zone; report point density, QC, freshness, duplicates, invalid coordinates, out-of-area and unassigned records; distinguish a verified zero from unknown or not fetched. "
                    "The complete Copernicus Marine catalogue is available through ocean_copernicus_catalog_search. When a dataset is not already known, search the catalogue, describe the selected dataset, then call ocean_copernicus_dataset_analyze with bounded variables, space, time and depth. "
                    "For common wave and sea-state questions the optimized Copernicus Marine wave tools may be used. Distinguish model valid time from fetch time, and numerical model, reanalysis or satellite-fusion output from in-situ observations. "
                    "For wind reports, distinguish 24-hour duration from timestamp count, vector count from component-value count, scalar mean speed from resultant mean-vector speed, and meteorological from-direction from vector toward-direction. Audit static zero masks, spatial weighting, nine-zone coverage, previous-window change and concurrent in-situ validation. "
                    "Apply the same numerical rigor to every variable: reconcile raw, sampled, valid, missing, masked, zero and negative counts; distinguish requested from effective space/time/depth coverage; state weighting; provide nine-zone distributions, extrema with coordinates/time/depth, previous-window or baseline comparison, and concurrent point validation or an explicit downgrade. "
                    "For SST state skin/foundation/bulk or depth definition and cloud/land/ice masks. For salinity and temperature profiles state PSS-78 versus Absolute Salinity, profile/platform/level counts, depth/QC/interpolation and layer criteria. For currents report u/v, per-value speed, toward-direction, directional constancy and representative depth. For waves separate total sea, swell and wind waves and distinguish analysis from forecast valid time. For chlorophyll/ecology use distribution-aware statistics, optical/QC masks and do not equate a high value with a bloom or red tide. "
                    "For coupling, report common space-time-depth coverage and matched sample count before angles or correlations, and never promote correlation to causation. For anomaly candidates, require a baseline, threshold, persistence, spatial continuity and independent validation status. "
                    "For every full report, use ocean_statistical_diagnostics for weighted summaries, robust trends, vector statistics, lag correlations and robust anomaly candidates; preserve sample counts, weights, time spacing and limitations. "
                    "Call ocean_anomaly_point_linkage to rank global and nine-zone anomaly candidates, collocate nearby platforms, preserve distance/time/depth differences, and distinguish L1 independent-validation eligibility from L2-L4 support. "
                    "Use ocean_physics_diagnostics to calculate center-point f, beta and inertial period, then perform evidence-based U-L-H-T scale analysis and Rossby-number diagnosis. Where inputs permit, calculate geostrophic velocity, wind stress and Ekman/coastal upwelling-favourable transport, N-squared, Richardson number, Eady growth rate, thermal-wind shear, Froude/Burger/deformation-radius scales, finite-depth wave-current interaction and a mixed-layer heat budget. Preserve equations, units, input provenance, coordinate conventions, applicability limits and warnings. Never invent gradients, density, periods, mixed-layer depth, coastline normals or feature scales. "
                    "Use the Stewart 2008 textbook framework as theory, not as present-ocean evidence: conservation and momentum (chapter 7), stability and Richardson number (chapter 8), Ekman transport/pumping (chapter 9), geostrophy (chapter 10), Sverdrup balance (chapter 11), vorticity/potential vorticity (chapter 12), model limits (chapter 15), and finite-depth wave dispersion/group velocity (chapter 16). Cite chapter, section and textbook page for each applied diagnostic, while keeping dataset evidence separate. "
                    "When inputs permit, also calculate gradient Richardson number, Ekman pumping, Sverdrup transport, divergence/vorticity/strain/Okubo-Weiss, finite-depth wave properties and mixed-layer surface-flux temperature tendency. Treat Ri below 0.25, Okubo-Weiss regimes, Ekman upwelling and Sverdrup transport as conditional diagnostics with their additional validity requirements, not confirmed events. "
                    "Rank candidate momentum, heat, salt and wave-balance terms by scale; distinguish observations, derived diagnostics and mechanism hypotheses; compare all nine zones; include sensitivity, uncertainty propagation, alternative mechanisms and a falsifiable condition. Near the equator, in shallow water or near complex coasts, explicitly test whether standard mid-latitude or deep-water approximations fail. "
                    "For reports, include product and dataset ids, variable units, query coverage, sampling scope, latest valid time, fetch time, data latency and scientific limitations. "
                    "For every regional ocean report, create the exact top-level section 新闻页面 and call ocean_mainland_news with the current sea area, coastal city, port, shipping, fisheries and ecology terms; label each item as Chinese mainland media context, not ocean evidence. "
                    "Only event_kind=anomaly may be described as an anomaly candidate, and do not promote a candidate to a confirmed event or warning without independent validation evidence."
                ),
            },
        ), protocol=protocol, session_id=session_id)
    if method == "ping":
        return _rpc_result(request_id, {})
    if method == "tools/list":
        return _rpc_result(request_id, {"tools": TOOLS})
    if method == "prompts/list":
        return _rpc_result(request_id, {"prompts": PROMPTS})
    if method == "prompts/get":
        try:
            return _rpc_result(request_id, _prompt(str(params.get("name") or ""), params.get("arguments") if isinstance(params.get("arguments"), dict) else {}))
        except (ValueError, LookupError) as error:
            return _rpc_error(request_id, -32002, str(error))
    if method == "logging/setLevel":
        return _rpc_result(request_id, {})
    if method == "resources/list":
        return _rpc_result(request_id, {"resources": _resource_catalog()})
    if method == "resources/templates/list":
        return _rpc_result(request_id, {"resourceTemplates": RESOURCE_TEMPLATES})
    if method == "resources/read":
        try:
            return _rpc_result(request_id, await run_in_threadpool(_read_resource, str(params.get("uri") or "")))
        except LookupError as error:
            return _rpc_error(request_id, -32002, str(error))
    if method == "tools/call":
        name = str(params.get("name") or "")
        arguments = params.get("arguments") if isinstance(params.get("arguments"), dict) else {}
        try:
            result = await run_in_threadpool(_call_tool, name, arguments)
            safe_result = jsonable_encoder(result)
            serialized = json.dumps(safe_result, ensure_ascii=False)
            return _rpc_result(
                request_id,
                {
                    "content": [{"type": "text", "text": serialized}],
                    "structuredContent": safe_result,
                    "isError": False,
                },
            )
        except (KeyError, ValueError, LookupError) as error:
            return _rpc_result(
                request_id,
                {"content": [{"type": "text", "text": str(error)}], "isError": True},
            )
        except Exception as error:
            return _rpc_result(
                request_id,
                {
                    "content": [{"type": "text", "text": f"Ocean data tool failed: {type(error).__name__}"}],
                    "isError": True,
                },
            )
    return _rpc_error(request_id, -32601, f"Method not found: {method}")


async def _legacy_codex_mcp_delete(request: Request) -> Response:
    if not _authorized(request):
        return JSONResponse({"detail": "Codex MCP authentication failed"}, status_code=401)
    session_id = request.headers.get("Mcp-Session-Id", "").strip()
    if session_id:
        MCP_STATE.delete_session(session_id)
    return Response(status_code=204)


def _rpc_object(request_id: Any, result: Any = None, *, code: int | None = None, message: str | None = None, data: Any = None) -> dict[str, Any]:
    if code is None:
        return {"jsonrpc": "2.0", "id": request_id, "result": result}
    error: dict[str, Any] = {"code": code, "message": message or "Error"}
    if data is not None:
        error["data"] = data
    return {"jsonrpc": "2.0", "id": request_id, "error": error}


def _result_count(result: Any) -> int | None:
    if isinstance(result, list):
        return len(result)
    if isinstance(result, dict):
        for key in ("returned", "record_count", "event_count", "matched_count", "processed"):
            if isinstance(result.get(key), int):
                return int(result[key])
        for key in ("items", "results", "records", "points"):
            if isinstance(result.get(key), list):
                return len(result[key])
    return None


async def _dispatch_rpc(payload: dict[str, Any], session_id: str, protocol_header: str) -> tuple[dict[str, Any] | None, str, str]:
    request_id = payload.get("id")
    method = str(payload.get("method") or "")
    params = payload.get("params") if isinstance(payload.get("params"), dict) else {}
    if payload.get("jsonrpc") != "2.0" or not method:
        return _rpc_object(request_id, code=-32600, message="Invalid Request"), session_id, protocol_header
    if method == "initialize":
        requested = str(params.get("protocolVersion") or "2025-03-26")
        protocol = requested if requested in SUPPORTED_PROTOCOLS else "2025-03-26"
        session_id = MCP_STATE.create_session(protocol)
        return _rpc_object(request_id, {
            "protocolVersion": protocol,
            "capabilities": {"tools": {"listChanged": False}, "resources": {"subscribe": True, "listChanged": False}, "prompts": {"listChanged": False}, "logging": {}},
            "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
            "instructions": "Use signed snapshot cursors for paging, persistent jobs for heavy or bulk work, and source_metadata for units, bounds, valid time, latency and QC. Tenant identity is runtime-injected; never submit owner_id.",
        }), session_id, protocol
    session = MCP_STATE.session(session_id) if session_id else None
    if session is None or not MCP_STATE.session_exists(session_id):
        return _rpc_object(request_id, code=-32001, message="MCP session is not found or expired"), session_id, protocol_header
    if protocol_header not in SUPPORTED_PROTOCOLS or protocol_header != session["protocol"]:
        return _rpc_object(request_id, code=-32600, message="Missing or unsupported MCP-Protocol-Version header"), session_id, protocol_header
    if method in {"notifications/initialized", "initialized"}:
        return None, session_id, protocol_header
    if method == "notifications/cancelled":
        cancelled_id = str(params.get("requestId") or "")
        if cancelled_id:
            with MCP_CANCEL_LOCK:
                MCP_CANCELLED_REQUESTS.add(cancelled_id)
        return None, session_id, protocol_header
    if method == "ping":
        return _rpc_object(request_id, {}), session_id, protocol_header
    if method == "tools/list":
        return _rpc_object(request_id, {"tools": TOOLS}), session_id, protocol_header
    if method == "prompts/list":
        return _rpc_object(request_id, {"prompts": PROMPTS}), session_id, protocol_header
    if method == "prompts/get":
        try:
            return _rpc_object(request_id, _prompt(str(params.get("name") or ""), params.get("arguments") if isinstance(params.get("arguments"), dict) else {})), session_id, protocol_header
        except (ValueError, LookupError) as error:
            return _rpc_object(request_id, code=-32002, message=str(error)), session_id, protocol_header
    if method == "logging/setLevel":
        return _rpc_object(request_id, {}), session_id, protocol_header
    if method == "resources/list":
        return _rpc_object(request_id, {"resources": _resource_catalog()}), session_id, protocol_header
    if method == "resources/templates/list":
        return _rpc_object(request_id, {"resourceTemplates": RESOURCE_TEMPLATES}), session_id, protocol_header
    if method in {"resources/subscribe", "resources/unsubscribe"}:
        try:
            MCP_STATE.subscribe(session_id, str(params.get("uri") or ""), enabled=method == "resources/subscribe")
            return _rpc_object(request_id, {}), session_id, protocol_header
        except LookupError as error:
            return _rpc_object(request_id, code=-32002, message=str(error)), session_id, protocol_header
    if method == "resources/read":
        try:
            result = await asyncio.wait_for(run_in_threadpool(_read_resource, str(params.get("uri") or "")), timeout=MCP_TOOL_TIMEOUT)
            return _rpc_object(request_id, result), session_id, protocol_header
        except (LookupError, asyncio.TimeoutError) as error:
            return _rpc_object(request_id, code=-32002, message=str(error) or "resource read timed out"), session_id, protocol_header
    if method != "tools/call":
        return _rpc_object(request_id, code=-32601, message=f"Method not found: {method}"), session_id, protocol_header

    name = str(params.get("name") or "")
    arguments = params.get("arguments") if isinstance(params.get("arguments"), dict) else {}
    owner_id = _request_owner(arguments)
    started = time.perf_counter()
    success = False
    result_count = None
    error_code = None
    safe_result: Any = None
    try:
        with MCP_CANCEL_LOCK:
            if str(request_id) in MCP_CANCELLED_REQUESTS:
                MCP_CANCELLED_REQUESTS.discard(str(request_id))
                raise asyncio.CancelledError()
        with MCP_GOVERNOR.permit(owner_id, name, external=name in OPEN_WORLD_TOOLS):
            result = await asyncio.wait_for(run_in_threadpool(_call_tool, name, arguments), timeout=MCP_TOOL_TIMEOUT)
        safe_result = jsonable_encoder(result)
        serialized = json.dumps(safe_result, ensure_ascii=False, separators=(",", ":"))
        if len(serialized.encode("utf-8")) > MCP_MAX_RESPONSE_BYTES:
            raise ToolGovernorError("MCP_RESPONSE_TOO_LARGE", "Result exceeds MCP response limit; use snapshot paging or export")
        success = True
        result_count = _result_count(safe_result)
        return _rpc_object(request_id, {"content": [{"type": "text", "text": serialized}], "structuredContent": safe_result, "isError": False}), session_id, protocol_header
    except asyncio.CancelledError:
        error_code = "MCP_REQUEST_CANCELLED"
        return _rpc_object(request_id, {"content": [{"type": "text", "text": "MCP request cancelled"}], "isError": True}), session_id, protocol_header
    except asyncio.TimeoutError:
        error_code = "MCP_TOOL_TIMEOUT"
        return _rpc_object(request_id, {"content": [{"type": "text", "text": "MCP tool timed out; submit it as a background job"}], "isError": True}), session_id, protocol_header
    except ToolGovernorError as error:
        error_code = error.code
        return _rpc_object(request_id, {"content": [{"type": "text", "text": str(error)}], "isError": True, "errorCode": error.code, "retryAfterSeconds": error.retry_after_seconds}), session_id, protocol_header
    except (KeyError, ValueError, LookupError) as error:
        error_code = type(error).__name__
        return _rpc_object(request_id, {"content": [{"type": "text", "text": str(error)}], "isError": True}), session_id, protocol_header
    except Exception as error:
        error_code = type(error).__name__
        return _rpc_object(request_id, {"content": [{"type": "text", "text": f"Ocean data tool failed: {type(error).__name__}"}], "isError": True}), session_id, protocol_header
    finally:
        claims = _tenant_claims(arguments) if arguments.get("__tenant_token") else {}
        result_payload = safe_result if isinstance(safe_result, dict) else {}
        source = str(arguments.get("source") or result_payload.get("source") or "") or None
        data_version = str(result_payload.get("data_version") or result_payload.get("refreshed_at") or "") or None
        MCP_STATE.audit(owner_id=owner_id, request_id=request_id, tool_name=name, arguments=arguments, duration_ms=(time.perf_counter() - started) * 1000, success=success, result_count=result_count, error_code=error_code, write_operation=name in WRITE_TOOLS, task_id=str(claims.get("tid") or "") or None, external_source=source, data_version=data_version)


@router.get("/api/codex/mcp")
async def codex_mcp_get(request: Request) -> Response:
    if not _authorized(request):
        return JSONResponse({"detail": "Codex MCP authentication failed"}, status_code=401)
    accept = request.headers.get("accept", "")
    if "text/event-stream" not in accept:
        return JSONResponse({"service": SERVER_NAME, "version": SERVER_VERSION, "transport": "streamable-http", "status": "ready"})
    session_id = request.headers.get("Mcp-Session-Id", "").strip()
    protocol = request.headers.get("MCP-Protocol-Version", "").strip()
    if not session_id or not MCP_STATE.session_exists(session_id) or protocol not in SUPPORTED_PROTOCOLS:
        return JSONResponse({"detail": "Valid MCP session and protocol headers are required"}, status_code=400)

    async def events():
        yield "event: ready\ndata: {}\n\n"
        session = MCP_STATE.session(session_id) or {}
        for uri in session.get("subscriptions", []):
            message = {"jsonrpc": "2.0", "method": "notifications/resources/updated", "params": {"uri": uri}}
            yield f"event: message\ndata: {json.dumps(message, separators=(',', ':'))}\n\n"
        while not await request.is_disconnected():
            await asyncio.sleep(15)
            yield ": keepalive\n\n"

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Mcp-Session-Id": session_id, "MCP-Protocol-Version": protocol, "Cache-Control": "no-cache"})


@router.post("/api/codex/mcp")
async def codex_mcp(request: Request) -> Response:
    if not _authorized(request):
        return JSONResponse({"detail": "Codex MCP authentication failed"}, status_code=401)
    if not request.headers.get("content-type", "").lower().startswith("application/json"):
        return JSONResponse(_rpc_object(None, code=-32600, message="Content-Type must be application/json"), status_code=415)
    accept = request.headers.get("accept", "application/json")
    if "application/json" not in accept and "text/event-stream" not in accept and "*/*" not in accept:
        return JSONResponse(_rpc_object(None, code=-32600, message="Accept must include application/json or text/event-stream"), status_code=406)
    try:
        payload = await request.json()
    except (ValueError, json.JSONDecodeError):
        return JSONResponse(_rpc_object(None, code=-32700, message="Parse error"))
    batch = payload if isinstance(payload, list) else [payload]
    if not batch or len(batch) > 20 or any(not isinstance(item, dict) for item in batch):
        return JSONResponse(_rpc_object(None, code=-32600, message="Invalid Request"))
    session_id = request.headers.get("Mcp-Session-Id", "").strip()
    protocol = request.headers.get("MCP-Protocol-Version", "").strip()
    responses = []
    for item in batch:
        response, session_id, protocol = await _dispatch_rpc(item, session_id, protocol)
        if response is not None and item.get("id") is not None:
            responses.append(response)
    if not responses:
        headers = {"Mcp-Session-Id": session_id, "MCP-Protocol-Version": protocol} if session_id else None
        return Response(status_code=204, headers=headers)
    body: Any = responses if isinstance(payload, list) else responses[0]
    return JSONResponse(body, headers={"Mcp-Session-Id": session_id, "MCP-Protocol-Version": protocol})


@router.delete("/api/codex/mcp")
async def codex_mcp_delete(request: Request) -> Response:
    if not _authorized(request):
        return JSONResponse({"detail": "Codex MCP authentication failed"}, status_code=401)
    session_id = request.headers.get("Mcp-Session-Id", "").strip()
    if session_id:
        MCP_STATE.delete_session(session_id)
    return Response(status_code=204)
