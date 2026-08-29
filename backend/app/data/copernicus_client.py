from __future__ import annotations

import math
import os
import re
import json
import urllib.request
import urllib.error
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Lock
from typing import Any

from app.data.china_coastal_areas import lookup_china_marine_area


COPERNICUS_DATASET_ID = os.getenv("COPERNICUSMARINE_WAVE_DATASET_ID", "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i")
COPERNICUS_WIND_DATASET_ID = os.getenv("COPERNICUSMARINE_WIND_DATASET_ID", "cmems_obs-wind_glo_phy_nrt_l4_0.125deg_PT1H")
COPERNICUS_CURRENT_DATASET_ID = os.getenv(
    "COPERNICUSMARINE_CURRENT_DATASET_ID",
    "cmems_mod_glo_phy_anfc_merged-uv_PT1H-i",
)
COPERNICUS_CURRENT_U_VARIABLE = os.getenv("COPERNICUSMARINE_CURRENT_U_VARIABLE", "utotal")
COPERNICUS_CURRENT_V_VARIABLE = os.getenv("COPERNICUSMARINE_CURRENT_V_VARIABLE", "vtotal")
COPERNICUS_CURRENT_ARCO_URL = os.getenv(
    "COPERNICUSMARINE_CURRENT_ARCO_URL",
    "https://s3.waw4-1.cloudferro.com/mdl-arco-time-015/arco/GLOBAL_ANALYSISFORECAST_PHY_001_024/"
    "cmems_mod_glo_phy_anfc_merged-uv_PT1H-i_202211/timeChunked.zarr",
).rstrip("/")
COPERNICUS_CURRENT_ARCO_URLS = tuple(dict.fromkeys((
    COPERNICUS_CURRENT_ARCO_URL,
    "https://s3.waw4-1.cloudferro.com/mdl-arco-time-015/arco/GLOBAL_ANALYSISFORECAST_PHY_001_024/"
    "cmems_mod_glo_phy_anfc_merged-uv_PT1H-i_202211/timeChunked.zarr",
    "https://s3.waw3-1.cloudferro.com/mdl-arco-time-015/arco/GLOBAL_ANALYSISFORECAST_PHY_001_024/"
    "cmems_mod_glo_phy_anfc_merged-uv_PT1H-i_202211/timeChunked.zarr",
)))
COPERNICUS_CURRENT_CACHE_DIR = Path(
    os.getenv("COPERNICUSMARINE_CURRENT_CACHE_DIR", str(Path(__file__).resolve().parents[2] / ".cache" / "copernicus_currents"))
)
COPERNICUS_USERNAME = os.getenv("COPERNICUSMARINE_USERNAME", "").strip()
COPERNICUS_PASSWORD = os.getenv("COPERNICUSMARINE_PASSWORD", "")
_region_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_wind_region_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_wave_point_cache: OrderedDict[tuple[int, int, float, float], tuple[float, dict[str, Any]]] = OrderedDict()
_wind_point_cache: OrderedDict[tuple[int, int, float, float], tuple[float, dict[str, Any]]] = OrderedDict()
_current_field_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_current_field_compute_lock = Lock()
_current_arco_metadata: dict[str, Any] | None = None
_current_arco_chunk_cache: OrderedDict[str, Any] = OrderedDict()
CURRENT_ARCO_CHUNK_CACHE_LIMIT = max(8, min(int(os.getenv("COPERNICUSMARINE_CURRENT_CHUNK_CACHE_LIMIT", "24")), 64))
_global_daily_volume_cache: tuple[float, dict[str, Any]] | None = None
_region_cache_lock = Lock()
_global_volume_compute_lock = Lock()
REGION_CACHE_TTL_SECONDS = max(float(os.getenv("COPERNICUSMARINE_REGION_CACHE_TTL_SECONDS", "900")), 300.0)
POINT_CACHE_TTL_SECONDS = max(float(os.getenv("COPERNICUSMARINE_POINT_CACHE_TTL_SECONDS", "900")), 60.0)
POINT_CACHE_LIMIT = max(32, min(int(os.getenv("COPERNICUSMARINE_POINT_CACHE_LIMIT", "512")), 4096))
REGION_DISPLAY_POINT_LIMIT = max(
    100,
    min(int(os.getenv("COPERNICUSMARINE_REGION_DISPLAY_POINT_LIMIT", "500")), 2000),
)
GLOBAL_VOLUME_CACHE_TTL_SECONDS = max(float(os.getenv("COPERNICUSMARINE_GLOBAL_VOLUME_CACHE_TTL_SECONDS", "300")), 300.0)
CURRENT_FIELD_CACHE_TTL_SECONDS = max(float(os.getenv("COPERNICUSMARINE_CURRENT_CACHE_TTL_SECONDS", "300")), 60.0)
COPERNICUS_PRODUCT_ID = "GLOBAL_ANALYSISFORECAST_WAV_001_027"
COPERNICUS_PRODUCT_URL = f"https://data.marine.copernicus.eu/product/{COPERNICUS_PRODUCT_ID}"
COPERNICUS_WIND_PRODUCT_ID = "WIND_GLO_PHY_L4_NRT_012_004"
COPERNICUS_WIND_PRODUCT_URL = f"https://data.marine.copernicus.eu/product/{COPERNICUS_WIND_PRODUCT_ID}"
COPERNICUS_CURRENT_PRODUCT_ID = "GLOBAL_ANALYSISFORECAST_PHY_001_024"
COPERNICUS_CURRENT_PRODUCT_URL = f"https://data.marine.copernicus.eu/product/{COPERNICUS_CURRENT_PRODUCT_ID}"
WAVE_VARIABLES = {
    "VHM0": {"label": "有效波高", "unit": "m", "meaning": "总波谱显著波高"},
    "VTM02": {"label": "平均波周期", "unit": "s", "meaning": "总波谱二阶矩平均周期"},
    "VMDR": {"label": "平均来向", "unit": "degree", "meaning": "总波平均来向，表示波从该方向传播而来"},
    "VHM0_SW1": {"label": "一级涌浪有效波高", "unit": "m", "meaning": "一级涌浪分区显著波高"},
    "VTM01_SW1": {"label": "一级涌浪平均周期", "unit": "s", "meaning": "一级涌浪分区平均周期"},
    "VMDR_SW1": {"label": "一级涌浪来向", "unit": "degree", "meaning": "一级涌浪从该方向传播而来"},
    "VHM0_WW": {"label": "风浪有效波高", "unit": "m", "meaning": "风浪分区显著波高"},
    "VTM01_WW": {"label": "风浪平均周期", "unit": "s", "meaning": "风浪分区平均周期"},
    "VMDR_WW": {"label": "风浪来向", "unit": "degree", "meaning": "风浪从该方向传播而来"},
}
WIND_VARIABLES = {
    "eastward_wind": {"label": "东向风分量", "unit": "m s-1", "meaning": "海面风矢量向东分量"},
    "northward_wind": {"label": "北向风分量", "unit": "m s-1", "meaning": "海面风矢量向北分量"},
    "wind_speed": {"label": "海面风速", "unit": "m s-1", "meaning": "由东向和北向分量合成的风速"},
    "wind_direction_from": {"label": "风来向", "unit": "degree", "meaning": "气象学风向，表示风从该方位吹来"},
}
CURRENT_VARIABLES = {
    "u": {"label": "东向海流分量", "unit": "m s-1", "meaning": "环流、潮流和波致漂移合成后的向东速度分量"},
    "v": {"label": "北向海流分量", "unit": "m s-1", "meaning": "环流、潮流和波致漂移合成后的向北速度分量"},
    "speed": {"label": "海流速度", "unit": "m s-1", "meaning": "由东向和北向分量合成的流速"},
}


class CopernicusMarineError(RuntimeError):
    """Raised when Copernicus Marine cannot return a valid dataset."""


def _rewrite_copernicus_mirror(value: Any) -> Any:
    if isinstance(value, str):
        return value.replace("https://s3.waw3-1.cloudferro.com/", "https://s3.waw4-1.cloudferro.com/")
    if isinstance(value, list):
        return [_rewrite_copernicus_mirror(item) for item in value]
    if isinstance(value, dict):
        return {key: _rewrite_copernicus_mirror(item) for key, item in value.items()}
    return value


def _copernicusmarine_client() -> Any:
    try:
        import copernicusmarine
        from copernicusmarine.core_functions.sessions import JsonParserConnection
    except ImportError as error:
        raise CopernicusMarineError("Copernicus Marine 客户端未安装") from error

    if not getattr(JsonParserConnection, "_ocean_mirror_enabled", False):
        original_get_json_file = JsonParserConnection.get_json_file

        def get_json_file(connection: Any, url: str) -> dict[str, Any]:
            payload = original_get_json_file(connection, _rewrite_copernicus_mirror(url))
            return _rewrite_copernicus_mirror(payload)

        JsonParserConnection.get_json_file = get_json_file
        JsonParserConnection._ocean_mirror_enabled = True
    return copernicusmarine


def _dimension_product(sizes: Any) -> int:
    result = 1
    for size in sizes.values():
        result *= int(size)
    return result


def _coordinate_iso(value: Any) -> str | None:
    parsed = _iso(value)
    if parsed:
        return parsed
    text = str(value).strip().replace(" ", "T")
    if not text or text.lower() in {"nat", "none"}:
        return None
    if text.endswith("Z") or "+" in text[10:]:
        return text
    return f"{text}Z"


def _daily_dataset_volume(
    dataset: Any,
    *,
    dataset_id: str,
    product_id: str,
    name: str,
    requested_variables: list[str],
    data_date: str,
    is_current_day: bool,
) -> dict[str, Any]:
    available_variables = [variable for variable in requested_variables if variable in dataset.data_vars]
    if not available_variables:
        raise CopernicusMarineError(f"Copernicus Marine 数据集 {dataset_id} 未返回请求变量")
    record_count = max(_dimension_product(dataset[variable].sizes) for variable in available_variables)
    value_count = sum(_dimension_product(dataset[variable].sizes) for variable in available_variables)
    time_count = int(dataset.sizes.get("time", 1))
    spatial_point_count = max(1, record_count // max(1, time_count))
    latest_observation_at = None
    if "time" in dataset.coords and int(dataset.sizes.get("time", 0)) > 0:
        latest_observation_at = _coordinate_iso(dataset.coords["time"].values[-1])
    return {
        "dataset_id": dataset_id,
        "product_id": product_id,
        "name": name,
        "date": data_date,
        "is_current_day": is_current_day,
        "variable_count": len(available_variables),
        "time_count": time_count,
        "spatial_point_count": spatial_point_count,
        "record_count": record_count,
        "value_count": value_count,
        "latest_observation_at": latest_observation_at,
    }


def _open_daily_global_volume(
    *,
    dataset_id: str,
    product_id: str,
    name: str,
    variables: list[str],
    day_start: datetime,
    end: datetime,
) -> dict[str, Any]:
    copernicusmarine = _copernicusmarine_client()
    request_kwargs = {
        "dataset_id": dataset_id,
        "username": COPERNICUS_USERNAME,
        "password": COPERNICUS_PASSWORD,
        "variables": variables,
        "minimum_longitude": -180.0,
        "maximum_longitude": 180.0,
        "minimum_latitude": -90.0,
        "maximum_latitude": 90.0,
        "start_datetime": day_start,
        "end_datetime": end,
    }
    effective_day_start = day_start
    try:
        dataset = copernicusmarine.open_dataset(**request_kwargs)
    except Exception as error:  # noqa: BLE001
        dataset_end = _dataset_end_from_error(error)
        if dataset_end is None or dataset_end >= end:
            raise CopernicusMarineError(f"Copernicus Marine 全球数据量读取失败：{error}") from error
        effective_day_start = dataset_end.replace(hour=0, minute=0, second=0, microsecond=0)
        request_kwargs["start_datetime"] = effective_day_start
        request_kwargs["end_datetime"] = dataset_end
        try:
            dataset = copernicusmarine.open_dataset(**request_kwargs)
        except Exception as retry_error:  # noqa: BLE001
            raise CopernicusMarineError(f"Copernicus Marine 全球数据量读取失败：{retry_error}") from retry_error
    try:
        return _daily_dataset_volume(
            dataset,
            dataset_id=dataset_id,
            product_id=product_id,
            name=name,
            requested_variables=variables,
            data_date=effective_day_start.date().isoformat(),
            is_current_day=effective_day_start.date() == day_start.date(),
        )
    finally:
        close = getattr(dataset, "close", None)
        if callable(close):
            close()


def get_global_daily_data_volume(*, force_refresh: bool = False) -> dict[str, Any]:
    global _global_daily_volume_cache
    if not COPERNICUS_USERNAME or not COPERNICUS_PASSWORD:
        raise CopernicusMarineError("Copernicus Marine 凭证未配置")
    now = datetime.now(UTC)
    now_timestamp = now.timestamp()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    with _region_cache_lock:
        cached = _global_daily_volume_cache
    if (
        cached
        and not force_refresh
        and now_timestamp - cached[0] < GLOBAL_VOLUME_CACHE_TTL_SECONDS
        and cached[1].get("date") == day_start.date().isoformat()
    ):
        result = dict(cached[1])
        result["cache"] = {"state": "fresh", "age_seconds": round(now_timestamp - cached[0], 1)}
        return result

    with _global_volume_compute_lock:
        with _region_cache_lock:
            cached = _global_daily_volume_cache
        if (
            cached
            and not force_refresh
            and now_timestamp - cached[0] < GLOBAL_VOLUME_CACHE_TTL_SECONDS
            and cached[1].get("date") == day_start.date().isoformat()
        ):
            result = dict(cached[1])
            result["cache"] = {"state": "fresh", "age_seconds": round(now_timestamp - cached[0], 1)}
            return result
        return _compute_global_daily_data_volume(now, now_timestamp, day_start)


def _compute_global_daily_data_volume(now: datetime, now_timestamp: float, day_start: datetime) -> dict[str, Any]:
    global _global_daily_volume_cache
    with _region_cache_lock:
        cached = _global_daily_volume_cache
    products = [
        {
            "dataset_id": COPERNICUS_DATASET_ID,
            "product_id": COPERNICUS_PRODUCT_ID,
            "name": "全球波浪分析预报",
            "variables": list(WAVE_VARIABLES),
        },
        {
            "dataset_id": COPERNICUS_WIND_DATASET_ID,
            "product_id": COPERNICUS_WIND_PRODUCT_ID,
            "name": "全球小时级海面风场",
            "variables": ["eastward_wind", "northward_wind"],
        },
        {
            "dataset_id": COPERNICUS_CURRENT_DATASET_ID,
            "product_id": COPERNICUS_CURRENT_PRODUCT_ID,
            "name": "全球小时级表层流场",
            "variables": [COPERNICUS_CURRENT_U_VARIABLE, COPERNICUS_CURRENT_V_VARIABLE],
        },
    ]
    datasets: list[dict[str, Any]] = []
    errors: list[str] = []
    with ThreadPoolExecutor(max_workers=len(products), thread_name_prefix="copernicus-global-volume") as executor:
        futures = {
            executor.submit(
                _open_daily_global_volume,
                dataset_id=product["dataset_id"],
                product_id=product["product_id"],
                name=product["name"],
                variables=product["variables"],
                day_start=day_start,
                end=now,
            ): product
            for product in products
        }
        for future in as_completed(futures):
            product = futures[future]
            try:
                datasets.append(future.result())
            except CopernicusMarineError as error:
                errors.append(f"{product['name']}：{error}")
    datasets.sort(key=lambda item: item["dataset_id"])
    if not datasets:
        if cached:
            result = dict(cached[1])
            result["cache"] = {"state": "stale", "age_seconds": round(now_timestamp - cached[0], 1)}
            result["errors"] = errors
            return result
        raise CopernicusMarineError("；".join(errors) or "Copernicus Marine 当天全球数据暂不可用")
    current_day_datasets = [item for item in datasets if item["is_current_day"]]
    latest_times = [item["latest_observation_at"] for item in current_day_datasets if item.get("latest_observation_at")]
    delayed_datasets = [item for item in datasets if not item["is_current_day"]]
    errors.extend(
        f"{item['name']}最新可用日期为 {item['date']}，尚未更新到 {day_start.date().isoformat()}"
        for item in delayed_datasets
    )
    result = {
        "date": day_start.date().isoformat(),
        "dataset_count": len(datasets),
        "record_count": sum(int(item["record_count"]) for item in current_day_datasets),
        "value_count": sum(int(item["value_count"]) for item in current_day_datasets),
        "latest_observation_at": max(latest_times) if latest_times else None,
        "fetched_at": datetime.now(UTC).isoformat(),
        "status": "live" if len(current_day_datasets) == len(products) else "partial",
        "datasets": datasets,
        "errors": errors,
    }
    with _region_cache_lock:
        _global_daily_volume_cache = (now_timestamp, result)
    result = dict(result)
    result["cache"] = {"state": "fresh", "age_seconds": 0.0}
    return result


def _finite(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _iso(value: Any) -> str | None:
    if isinstance(value, tuple) and value:
        value = value[0]
    if hasattr(value, "to_pydatetime"):
        value = value.to_pydatetime()
    if isinstance(value, datetime):
        parsed = value if value.tzinfo else value.replace(tzinfo=UTC)
        return parsed.astimezone(UTC).isoformat()
    if isinstance(value, str) and value:
        return value
    return None


def _time_role(value: str | None, reference: datetime) -> str:
    if not value:
        return "unknown"
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return "unknown"
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return "forecast" if parsed.astimezone(UTC) > reference else "analysis"


def _parse_utc(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(UTC) if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _haversine_km(longitude_a: float, latitude_a: float, longitude_b: float, latitude_b: float) -> float:
    earth_radius_km = 6371.0088
    latitude_a_rad = math.radians(latitude_a)
    latitude_b_rad = math.radians(latitude_b)
    latitude_delta = math.radians(latitude_b - latitude_a)
    longitude_delta = math.radians(longitude_b - longitude_a)
    haversine = (
        math.sin(latitude_delta / 2) ** 2
        + math.cos(latitude_a_rad) * math.cos(latitude_b_rad) * math.sin(longitude_delta / 2) ** 2
    )
    return earth_radius_km * 2 * math.asin(min(1.0, math.sqrt(haversine)))


def _point_metadata(
    *,
    longitude: float,
    latitude: float,
    grid_longitude: float,
    grid_latitude: float,
    latest_valid_time: str | None,
    fetched_at: datetime,
    horizontal_resolution_degrees: float,
    horizontal_resolution_km: float,
    temporal_resolution_hours: int,
    physical_derivation: str,
) -> dict[str, Any]:
    latest = _parse_utc(latest_valid_time)
    latency_seconds = max(0.0, (fetched_at - latest).total_seconds()) if latest else None
    return {
        "requested_longitude": longitude,
        "requested_latitude": latitude,
        "grid_longitude": grid_longitude,
        "grid_latitude": grid_latitude,
        "grid_distance_km": round(_haversine_km(longitude, latitude, grid_longitude, grid_latitude), 3),
        "coordinates_selection_method": "nearest",
        "spatial_interpolation_method": "nearest_grid_node_no_interpolation",
        "temporal_interpolation_method": "native_time_step_no_interpolation",
        "horizontal_resolution_degrees": horizontal_resolution_degrees,
        "horizontal_resolution_km": horizontal_resolution_km,
        "temporal_resolution_hours": temporal_resolution_hours,
        "latest_valid_time": latest_valid_time,
        "latency_reference_at": fetched_at,
        "data_latency_seconds": round(latency_seconds, 3) if latency_seconds is not None else None,
        "data_latency_hours": round(latency_seconds / 3600, 6) if latency_seconds is not None else None,
        "physical_derivation": physical_derivation,
    }


def _cached_point_result(
    cache: OrderedDict[tuple[int, int, float, float], tuple[float, dict[str, Any]]],
    *,
    longitude: float,
    latitude: float,
    days: int,
    forecast_hours: int,
    resolution: float,
) -> dict[str, Any] | None:
    now = datetime.now(UTC).timestamp()
    with _region_cache_lock:
        expired_keys = [key for key, (cached_at, _) in cache.items() if now - cached_at >= POINT_CACHE_TTL_SECONDS]
        for key in expired_keys:
            cache.pop(key, None)
        for key in reversed(cache):
            cached_days, cached_forecast_hours, grid_longitude, grid_latitude = key
            if cached_days != days or cached_forecast_hours != forecast_hours:
                continue
            longitude_delta = abs(longitude - grid_longitude)
            longitude_delta = min(longitude_delta, 360.0 - longitude_delta)
            if longitude_delta > resolution * 0.51 or abs(latitude - grid_latitude) > resolution * 0.51:
                continue
            _, cached_result = cache[key]
            cache.move_to_end(key)
            result = dict(cached_result)
            result["longitude"] = longitude
            result["latitude"] = latitude
            result["requested_longitude"] = longitude
            result["requested_latitude"] = latitude
            result["grid_distance_km"] = round(_haversine_km(longitude, latitude, grid_longitude, grid_latitude), 3)
            return result
    return None


def _store_point_result(
    cache: OrderedDict[tuple[int, int, float, float], tuple[float, dict[str, Any]]],
    *,
    days: int,
    forecast_hours: int,
    result: dict[str, Any],
) -> None:
    key = (
        days,
        forecast_hours,
        float(result["grid_longitude"]),
        float(result["grid_latitude"]),
    )
    with _region_cache_lock:
        cache[key] = (datetime.now(UTC).timestamp(), result)
        cache.move_to_end(key)
        while len(cache) > POINT_CACHE_LIMIT:
            cache.popitem(last=False)


def _dataset_end_from_error(error: Exception) -> datetime | None:
    match = re.search(r"dataset coordinates \[[^,]+,\s*([^\]]+)\]", str(error))
    if not match:
        return None
    try:
        parsed = datetime.fromisoformat(match.group(1).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(UTC) if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _latest_grid_points(
    frame: Any,
    *,
    variables: list[str],
    required_variables: list[str],
    derived_wind: bool = False,
    prioritize_china_marine: bool = False,
    display_point_limit: int = REGION_DISPLAY_POINT_LIMIT,
) -> tuple[int, list[dict[str, Any]], dict[str, int]]:
    table = frame.reset_index()
    if not all(variable in table.columns for variable in required_variables):
        return 0, [], {}
    valid_mask = table[required_variables].notna().all(axis=1)
    valid_table = table.loc[valid_mask]
    point_count = int(len(valid_table.index))
    if point_count == 0:
        return 0, [], {}
    available_count_by_variable = {
        variable: int(table[variable].notna().sum())
        for variable in variables
        if variable in table.columns
    }
    point_limit = max(1, display_point_limit)

    def sample_indices(source_table: Any, limit: int) -> list[Any]:
        if limit <= 0 or len(source_table.index) == 0:
            return []
        source_count = len(source_table.index)
        if source_count <= limit:
            return list(source_table.index)
        positions = [math.floor(index * source_count / limit) for index in range(limit)]
        return list(source_table.iloc[positions].index)

    selected_indices: list[Any] = []
    if prioritize_china_marine and {"longitude", "latitude"}.issubset(valid_table.columns):
        china_mask = [
            lookup_china_marine_area(float(longitude), float(latitude)) is not None
            for longitude, latitude in valid_table[["longitude", "latitude"]].itertuples(index=False, name=None)
        ]
        china_table = valid_table.loc[china_mask]
        other_table = valid_table.loc[[not matched for matched in china_mask]]
        selected_indices.extend(sample_indices(china_table, point_limit))
        selected_indices.extend(sample_indices(other_table, point_limit - len(selected_indices)))
    else:
        selected_indices.extend(sample_indices(valid_table, point_limit))
    display_table = valid_table.loc[selected_indices]
    points: list[dict[str, Any]] = []
    for _, row in display_table.iterrows():
        longitude = _finite(row.get("longitude"))
        latitude = _finite(row.get("latitude"))
        timestamp = _iso(row.get("time"))
        if longitude is None or latitude is None or not timestamp:
            continue
        point: dict[str, Any] = {
            "longitude": longitude,
            "latitude": latitude,
            "timestamp": timestamp,
            "time_role": "analysis",
        }
        for variable in variables:
            if variable in row:
                point[variable] = _finite(row[variable])
        if derived_wind:
            eastward = point.get("eastward_wind")
            northward = point.get("northward_wind")
            if eastward is None or northward is None:
                continue
            point["wind_speed"] = math.hypot(eastward, northward)
            point["wind_direction_from"] = (math.degrees(math.atan2(-eastward, -northward)) + 360) % 360
        points.append(point)
    return point_count, points, available_count_by_variable


def _prioritize_china_marine_for_region(region_id: str) -> bool:
    return (
        region_id in {"northwest_pacific", "south_china_sea"}
        or region_id.startswith("global_ocean")
    )


def _read_latest_region_frame(
    *,
    dataset_id: str,
    variables: list[str],
    bounds: tuple[tuple[float, float], tuple[float, float]],
    latest_valid_time: str,
) -> Any:
    copernicusmarine = _copernicusmarine_client()
    (west, south), (east, north) = bounds
    try:
        return copernicusmarine.read_dataframe(
            dataset_id=dataset_id,
            username=COPERNICUS_USERNAME,
            password=COPERNICUS_PASSWORD,
            variables=variables,
            minimum_longitude=west,
            maximum_longitude=east,
            minimum_latitude=south,
            maximum_latitude=north,
            start_datetime=latest_valid_time,
            end_datetime=latest_valid_time,
            disable_progress_bar=True,
        )
    except Exception as error:  # noqa: BLE001
        raise CopernicusMarineError(f"Copernicus Marine 最新区域网格请求失败：{error}") from error


def get_wave_point(
    longitude: float,
    latitude: float,
    *,
    days: int = 3,
    forecast_hours: int = 0,
) -> dict[str, Any]:
    if not COPERNICUS_USERNAME or not COPERNICUS_PASSWORD:
        raise CopernicusMarineError("Copernicus Marine 凭证未配置")
    if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
        raise CopernicusMarineError("坐标超出有效范围")
    days = max(1, min(days, 7))
    forecast_hours = max(0, min(forecast_hours, 240))
    cached = _cached_point_result(
        _wave_point_cache,
        longitude=longitude,
        latitude=latitude,
        days=days,
        forecast_hours=forecast_hours,
        resolution=1 / 12,
    )
    if cached is not None:
        return cached
    copernicusmarine = _copernicusmarine_client()

    now = datetime.now(UTC)
    end = now + timedelta(hours=forecast_hours)
    start = now - timedelta(days=days)
    variables = list(WAVE_VARIABLES)
    minimum_longitude = max(-180.0, longitude - 0.01)
    maximum_longitude = min(180.0, longitude + 0.01)
    minimum_latitude = max(-90.0, latitude - 0.01)
    maximum_latitude = min(90.0, latitude + 0.01)
    try:
        frame = copernicusmarine.read_dataframe(
            dataset_id=COPERNICUS_DATASET_ID,
            username=COPERNICUS_USERNAME,
            password=COPERNICUS_PASSWORD,
            variables=variables,
            minimum_longitude=minimum_longitude,
            maximum_longitude=maximum_longitude,
            minimum_latitude=minimum_latitude,
            maximum_latitude=maximum_latitude,
            start_datetime=start,
            end_datetime=end,
            coordinates_selection_method="nearest",
            disable_progress_bar=True,
        )
    except Exception as error:  # noqa: BLE001 - normalize provider errors
        raise CopernicusMarineError(f"Copernicus Marine 数据请求失败：{error}") from error
    if frame is None or len(frame.index) == 0:
        raise CopernicusMarineError("Copernicus Marine 未返回该点位的海况数据")

    table = frame.reset_index()
    records: list[dict[str, Any]] = []
    grid_longitude: float | None = None
    grid_latitude: float | None = None
    for _, row in table.iterrows():
        valid_time = _iso(row.get("time"))
        record: dict[str, Any] = {"timestamp": valid_time, "time_role": _time_role(valid_time, now)}
        for column in variables:
            if column in row:
                record[column] = _finite(row[column])
        if any(value is not None for key, value in record.items() if key not in {"timestamp", "time_role"}):
            records.append(record)
            grid_longitude = grid_longitude if grid_longitude is not None else _finite(row.get("longitude"))
            grid_latitude = grid_latitude if grid_latitude is not None else _finite(row.get("latitude"))
    if not records:
        raise CopernicusMarineError("Copernicus Marine 该点位没有有效海浪值，可能位于陆地、近岸掩膜区或产品覆盖空洞")
    records.sort(key=lambda item: item.get("timestamp") or "")
    valid_times = [record["timestamp"] for record in records if record.get("timestamp")]
    fetched_at = datetime.now(UTC)
    latest_valid_time = max(valid_times) if valid_times else None
    result = {
        "product_id": COPERNICUS_PRODUCT_ID,
        "dataset_id": COPERNICUS_DATASET_ID,
        "longitude": longitude,
        "latitude": latitude,
        "start_datetime": start,
        "end_datetime": end,
        "records": records,
        "record_count": len(records),
        "latest_valid_time": latest_valid_time,
        "variables": WAVE_VARIABLES,
        "data_class": "numerical_model_analysis_forecast",
        "scientific_scope": "Copernicus Marine 数值模式海浪分析预报；不是浮标原位实测，也不是官方海洋灾害预警。",
        "source": {"name": "Copernicus Marine 全球海浪分析预报", "product_url": COPERNICUS_PRODUCT_URL},
        "fetched_at": fetched_at,
        **_point_metadata(
            longitude=longitude,
            latitude=latitude,
            grid_longitude=grid_longitude if grid_longitude is not None else longitude,
            grid_latitude=grid_latitude if grid_latitude is not None else latitude,
            latest_valid_time=latest_valid_time,
            fetched_at=fetched_at,
            horizontal_resolution_degrees=1 / 12,
            horizontal_resolution_km=9.0,
            temporal_resolution_hours=3,
            physical_derivation="原生波浪模式变量；目标坐标匹配最近网格节点，未进行空间或时间插值。",
        ),
    }
    _store_point_result(
        _wave_point_cache,
        days=days,
        forecast_hours=forecast_hours,
        result=result,
    )
    return result


def get_wave_region(
    region_id: str,
    bounds: tuple[tuple[float, float], tuple[float, float]],
    *,
    force_refresh: bool = False,
    days: int = 3,
    forecast_hours: int = 0,
) -> dict[str, Any]:
    now = datetime.now(UTC).timestamp()
    cache_key = f"{region_id}:{max(1, min(days, 7))}:{max(0, min(forecast_hours, 240))}"
    with _region_cache_lock:
        cached = _region_cache.get(cache_key)
    if cached and not force_refresh and now - cached[0] < REGION_CACHE_TTL_SECONDS:
        result = dict(cached[1])
        result["cache"] = {"state": "fresh", "age_seconds": round(now - cached[0], 1)}
        return result

    (west, south), (east, north) = bounds
    candidates = [
        (west + (east - west) * 0.25, south + (north - south) * 0.25),
        (west + (east - west) * 0.75, south + (north - south) * 0.25),
        (west + (east - west) * 0.25, south + (north - south) * 0.75),
        (west + (east - west) * 0.75, south + (north - south) * 0.75),
        ((west + east) / 2, (south + north) / 2),
    ]
    seed_points: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=5, thread_name_prefix="copernicus-wave") as executor:
        futures = {
            executor.submit(
                get_wave_point,
                longitude,
                latitude,
                days=days,
                forecast_hours=forecast_hours,
            ): (longitude, latitude)
            for longitude, latitude in candidates
        }
        for future in as_completed(futures):
            try:
                point = future.result()
            except CopernicusMarineError:
                continue
            latest = next(
                (record for record in reversed(point["records"]) if record.get("timestamp")),
                None,
            )
            if latest:
                seed_points.append({
                    "longitude": point["longitude"],
                    "latitude": point["latitude"],
                    "timestamp": latest["timestamp"],
                    **latest,
                })
    if not seed_points:
        if cached:
            result = dict(cached[1])
            result["cache"] = {"state": "stale", "age_seconds": round(now - cached[0], 1)}
            return result
        raise CopernicusMarineError("Copernicus Marine 未返回该海域的波浪数据")
    latest_valid_time = max(point["timestamp"] for point in seed_points)
    frame = _read_latest_region_frame(
        dataset_id=COPERNICUS_DATASET_ID,
        variables=list(WAVE_VARIABLES),
        bounds=bounds,
        latest_valid_time=latest_valid_time,
    )
    point_count, points, available_count_by_variable = _latest_grid_points(
        frame,
        variables=list(WAVE_VARIABLES),
        required_variables=["VHM0"],
        prioritize_china_marine=_prioritize_china_marine_for_region(region_id),
    )
    if not points:
        raise CopernicusMarineError("Copernicus Marine 最新时次没有有效波浪网格点")
    result = {
        "region_id": region_id,
        "product_id": COPERNICUS_PRODUCT_ID,
        "dataset_id": COPERNICUS_DATASET_ID,
        "fetched_at": datetime.now(UTC).isoformat(),
        "latest_valid_time": latest_valid_time,
        "latest_observation_at": latest_valid_time,
        "point_count": point_count,
        "returned_point_count": len(points),
        "available_count_by_variable": available_count_by_variable,
        "points": points,
        "variables": WAVE_VARIABLES,
        "data_class": "numerical_model_analysis_forecast",
        "scientific_scope": "点位总数统计最新时次约 0.083° 数值模式网格中的全部有效点；事件列表使用均匀抽样记录，不等于原位观测或官方预警。",
        "source": {
            "name": "Copernicus Marine 全球 3 小时波浪分析预报",
            "url": COPERNICUS_PRODUCT_URL,
            "dataset_url": COPERNICUS_PRODUCT_URL,
        },
    }
    with _region_cache_lock:
        _region_cache[cache_key] = (now, result)
    result["cache"] = {"state": "fresh", "age_seconds": 0.0}
    return result


def get_wind_point(longitude: float, latitude: float, *, days: int = 3) -> dict[str, Any]:
    if not COPERNICUS_USERNAME or not COPERNICUS_PASSWORD:
        raise CopernicusMarineError("Copernicus Marine 凭证未配置")
    if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
        raise CopernicusMarineError("坐标超出有效范围")
    days = max(1, min(days, 7))
    cached = _cached_point_result(
        _wind_point_cache,
        longitude=longitude,
        latitude=latitude,
        days=days,
        forecast_hours=0,
        resolution=0.125,
    )
    if cached is not None:
        return cached
    copernicusmarine = _copernicusmarine_client()
    requested_end = datetime.now(UTC)
    end = requested_end
    lookback = timedelta(days=days)
    start = end - lookback
    request_kwargs = {
        "dataset_id": COPERNICUS_WIND_DATASET_ID,
        "username": COPERNICUS_USERNAME,
        "password": COPERNICUS_PASSWORD,
        "variables": ["eastward_wind", "northward_wind"],
        "minimum_longitude": max(-180.0, longitude - 0.01),
        "maximum_longitude": min(180.0, longitude + 0.01),
        "minimum_latitude": max(-90.0, latitude - 0.01),
        "maximum_latitude": min(90.0, latitude + 0.01),
        "coordinates_selection_method": "nearest",
        "disable_progress_bar": True,
    }
    try:
        frame = copernicusmarine.read_dataframe(**request_kwargs, start_datetime=start, end_datetime=end)
    except Exception as error:  # noqa: BLE001
        dataset_end = _dataset_end_from_error(error)
        if dataset_end is None or dataset_end >= end:
            raise CopernicusMarineError(f"Copernicus Marine 风场请求失败：{error}") from error
        end = dataset_end
        start = end - lookback
        try:
            frame = copernicusmarine.read_dataframe(**request_kwargs, start_datetime=start, end_datetime=end)
        except Exception as retry_error:  # noqa: BLE001
            raise CopernicusMarineError(f"Copernicus Marine 风场请求失败：{retry_error}") from retry_error
    table = frame.reset_index()
    records: list[dict[str, Any]] = []
    grid_longitude: float | None = None
    grid_latitude: float | None = None
    for _, row in table.iterrows():
        eastward = _finite(row.get("eastward_wind"))
        northward = _finite(row.get("northward_wind"))
        if eastward is None or northward is None:
            continue
        records.append({
            "timestamp": _iso(row.get("time")),
            "time_role": "analysis",
            "eastward_wind": eastward,
            "northward_wind": northward,
            "wind_speed": math.hypot(eastward, northward),
            "wind_direction_from": (math.degrees(math.atan2(-eastward, -northward)) + 360) % 360,
        })
        grid_longitude = grid_longitude if grid_longitude is not None else _finite(row.get("longitude"))
        grid_latitude = grid_latitude if grid_latitude is not None else _finite(row.get("latitude"))
    if not records:
        raise CopernicusMarineError("Copernicus Marine 未返回该点位的风场数据")
    fetched_at = datetime.now(UTC)
    latest_valid_time = max(record["timestamp"] for record in records if record.get("timestamp"))
    result = {
        "product_id": COPERNICUS_WIND_PRODUCT_ID,
        "dataset_id": COPERNICUS_WIND_DATASET_ID,
        "longitude": longitude,
        "latitude": latitude,
        "start_datetime": start,
        "end_datetime": end,
        "requested_end_datetime": requested_end,
        "records": records,
        "record_count": len(records),
        "latest_valid_time": latest_valid_time,
        "variables": WIND_VARIABLES,
        "data_class": "satellite_model_blended_analysis",
        "scientific_scope": "Copernicus Marine L4 海面风融合分析；不是现场风速仪原位观测，也不是官方大风或台风预警。",
        "source": {"name": "Copernicus Marine 全球小时级海面风场", "product_url": COPERNICUS_WIND_PRODUCT_URL},
        "fetched_at": fetched_at,
        **_point_metadata(
            longitude=longitude,
            latitude=latitude,
            grid_longitude=grid_longitude if grid_longitude is not None else longitude,
            grid_latitude=grid_latitude if grid_latitude is not None else latitude,
            latest_valid_time=latest_valid_time,
            fetched_at=fetched_at,
            horizontal_resolution_degrees=0.125,
            horizontal_resolution_km=14.0,
            temporal_resolution_hours=1,
            physical_derivation="风速由东向、北向风分量按矢量模长计算；风向按气象学来向换算。目标坐标匹配最近网格节点，未进行空间或时间插值。",
        ),
    }
    _store_point_result(
        _wind_point_cache,
        days=days,
        forecast_hours=0,
        result=result,
    )
    return result


def get_wind_region(
    region_id: str,
    bounds: tuple[tuple[float, float], tuple[float, float]],
    *,
    force_refresh: bool = False,
    days: int = 3,
) -> dict[str, Any]:
    now = datetime.now(UTC).timestamp()
    cache_key = f"{region_id}:{max(1, min(days, 7))}"
    with _region_cache_lock:
        cached = _wind_region_cache.get(cache_key)
    if cached and not force_refresh and now - cached[0] < REGION_CACHE_TTL_SECONDS:
        result = dict(cached[1])
        result["cache"] = {"state": "fresh", "age_seconds": round(now - cached[0], 1)}
        return result
    (west, south), (east, north) = bounds
    candidates = [
        (west + (east - west) * 0.25, south + (north - south) * 0.25),
        (west + (east - west) * 0.75, south + (north - south) * 0.25),
        (west + (east - west) * 0.25, south + (north - south) * 0.75),
        (west + (east - west) * 0.75, south + (north - south) * 0.75),
        ((west + east) / 2, (south + north) / 2),
    ]
    seed_points: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=5, thread_name_prefix="copernicus-wind") as executor:
        futures = {
            executor.submit(get_wind_point, longitude, latitude, days=days): (longitude, latitude)
            for longitude, latitude in candidates
        }
        for future in as_completed(futures):
            longitude, latitude = futures[future]
            try:
                point = future.result()
            except CopernicusMarineError:
                continue
            latest = next((record for record in reversed(point["records"]) if record.get("timestamp")), None)
            if latest:
                seed_points.append({
                    "longitude": longitude,
                    "latitude": latitude,
                    "data_latency_hours": point.get("data_latency_hours"),
                    **latest,
                })
    if not seed_points:
        if cached:
            result = dict(cached[1])
            result["cache"] = {"state": "stale", "age_seconds": round(now - cached[0], 1)}
            return result
        raise CopernicusMarineError("Copernicus Marine 未返回该海域的风场数据")
    latest_valid_time = max(point["timestamp"] for point in seed_points)
    frame = _read_latest_region_frame(
        dataset_id=COPERNICUS_WIND_DATASET_ID,
        variables=["eastward_wind", "northward_wind"],
        bounds=bounds,
        latest_valid_time=latest_valid_time,
    )
    point_count, points, available_count_by_variable = _latest_grid_points(
        frame,
        variables=["eastward_wind", "northward_wind"],
        required_variables=["eastward_wind", "northward_wind"],
        derived_wind=True,
        prioritize_china_marine=_prioritize_china_marine_for_region(region_id),
    )
    if not points:
        raise CopernicusMarineError("Copernicus Marine 最新时次没有有效风场网格点")
    for point in points:
        point["data_latency_hours"] = next(
            (seed.get("data_latency_hours") for seed in seed_points if seed.get("data_latency_hours") is not None),
            None,
        )
    result = {
        "region_id": region_id,
        "product_id": COPERNICUS_WIND_PRODUCT_ID,
        "dataset_id": COPERNICUS_WIND_DATASET_ID,
        "fetched_at": datetime.now(UTC).isoformat(),
        "latest_valid_time": latest_valid_time,
        "latest_observation_at": latest_valid_time,
        "point_count": point_count,
        "returned_point_count": len(points),
        "available_count_by_variable": available_count_by_variable,
        "points": points,
        "data_latency_hours": max(float(point.get("data_latency_hours") or 0) for point in seed_points),
        "variables": WIND_VARIABLES,
        "data_class": "satellite_model_blended_analysis",
        "scientific_scope": "点位总数统计最新时次 0.125° L4 融合网格中的全部有效点；事件列表使用均匀抽样记录，不等同于现场风速仪观测或官方台风预警。",
        "source": {
            "name": "Copernicus Marine 全球小时级海面风场",
            "dataset_url": COPERNICUS_WIND_PRODUCT_URL,
        },
    }
    with _region_cache_lock:
        _wind_region_cache[cache_key] = (now, result)
    result["cache"] = {"state": "fresh", "age_seconds": 0.0}
    return result


def _normalized_current_bounds(
    west: float,
    south: float,
    east: float,
    north: float,
) -> tuple[float, float, float, float]:
    south = max(-80.0, min(89.5, south))
    north = max(-80.0, min(89.5, north))
    if north <= south:
        raise CopernicusMarineError("海流视窗纬度范围无效")
    if east - west >= 350 or west < -180 or east > 180 or east <= west:
        return -180.0, south, 180.0, north
    return max(-180.0, west), south, min(180.0, east), north


def _sample_indices(size: int, target: int) -> list[int]:
    if size <= target:
        return list(range(size))
    return sorted({round(index * (size - 1) / (target - 1)) for index in range(target)})


def _arco_bytes(path: str) -> bytes:
    last_error: Exception | None = None
    for base_url in COPERNICUS_CURRENT_ARCO_URLS:
        request = urllib.request.Request(
            f"{base_url}/{path.lstrip('/')}",
            headers={"User-Agent": "ocean-intelligence/1.0"},
        )
        for attempt in range(2):
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    return response.read()
            except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
                last_error = error
                if attempt < 1:
                    time.sleep(0.35)
    assert last_error is not None
    raise last_error


def _arco_metadata() -> dict[str, Any]:
    global _current_arco_metadata
    with _region_cache_lock:
        cached = _current_arco_metadata
    if cached is not None:
        return cached
    metadata = json.loads(_arco_bytes(".zmetadata"))["metadata"]
    with _region_cache_lock:
        _current_arco_metadata = metadata
    return metadata


def _decode_arco_array(name: str, chunk_key: str, metadata: dict[str, Any]) -> Any:
    import numpy as np
    from numcodecs import get_codec

    cache_key = f"{name}:{chunk_key}"
    with _region_cache_lock:
        cached = _current_arco_chunk_cache.get(cache_key)
        if cached is not None:
            _current_arco_chunk_cache.move_to_end(cache_key)
            return cached
    config = metadata[f"{name}/.zarray"]
    decoded = get_codec(config["compressor"]).decode(_arco_bytes(f"{name}/{chunk_key}"))
    array = np.frombuffer(decoded, dtype=np.dtype(config["dtype"]))
    with _region_cache_lock:
        _current_arco_chunk_cache[cache_key] = array
        _current_arco_chunk_cache.move_to_end(cache_key)
        while len(_current_arco_chunk_cache) > CURRENT_ARCO_CHUNK_CACHE_LIMIT:
            _current_arco_chunk_cache.popitem(last=False)
    return array


def _arco_coordinate(name: str, metadata: dict[str, Any]) -> Any:
    import numpy as np

    config = metadata[f"{name}/.zarray"]
    chunk_size = int(config["chunks"][0])
    chunk_count = math.ceil(int(config["shape"][0]) / chunk_size)
    arrays = [_decode_arco_array(name, str(index), metadata) for index in range(chunk_count)]
    return np.concatenate(arrays)[: int(config["shape"][0])]


def _arco_current_grid(
    *,
    west: float,
    south: float,
    east: float,
    north: float,
    width: int,
    height: int,
) -> dict[str, Any]:
    import numpy as np

    metadata = _arco_metadata()
    longitudes_all = _arco_coordinate("longitude", metadata)
    latitudes_all = _arco_coordinate("latitude", metadata)
    time_config = metadata["time/.zarray"]
    time_first = float(_decode_arco_array("time", "0", metadata)[0])
    hours_since_epoch = (datetime.now(UTC) - datetime(1950, 1, 1, tzinfo=UTC)).total_seconds() / 3600
    time_index = max(0, min(int(time_config["shape"][0]) - 1, math.floor(hours_since_epoch - time_first)))
    selected_hours = time_first + time_index
    selected_time = datetime(1950, 1, 1, tzinfo=UTC) + timedelta(hours=selected_hours)

    longitude_start = int(np.searchsorted(longitudes_all, west, side="left"))
    longitude_end = int(np.searchsorted(longitudes_all, east, side="right")) - 1
    latitude_start = int(np.searchsorted(latitudes_all, south, side="left"))
    latitude_end = int(np.searchsorted(latitudes_all, north, side="right")) - 1
    longitude_start = max(0, min(longitude_start, len(longitudes_all) - 1))
    longitude_end = max(longitude_start, min(longitude_end, len(longitudes_all) - 1))
    latitude_start = max(0, min(latitude_start, len(latitudes_all) - 1))
    latitude_end = max(latitude_start, min(latitude_end, len(latitudes_all) - 1))
    longitude_indices = np.linspace(longitude_start, longitude_end, min(width, longitude_end - longitude_start + 1)).round().astype(int)
    latitude_indices = np.linspace(latitude_start, latitude_end, min(height, latitude_end - latitude_start + 1)).round().astype(int)
    longitude_indices = np.unique(longitude_indices)
    latitude_indices = np.unique(latitude_indices)

    variable_config = metadata[f"{COPERNICUS_CURRENT_U_VARIABLE}/.zarray"]
    latitude_chunk_size = int(variable_config["chunks"][2])
    longitude_chunk_size = int(variable_config["chunks"][3])
    chunk_pairs = sorted({
        (int(latitude_index // latitude_chunk_size), int(longitude_index // longitude_chunk_size))
        for latitude_index in latitude_indices
        for longitude_index in longitude_indices
    })

    def load_chunk(variable: str, latitude_chunk: int, longitude_chunk: int) -> tuple[tuple[str, int, int], Any]:
        raw = _decode_arco_array(
            variable,
            f"{time_index}.0.{latitude_chunk}.{longitude_chunk}",
            metadata,
        )
        return (variable, latitude_chunk, longitude_chunk), raw.reshape(latitude_chunk_size, longitude_chunk_size)

    chunks: dict[tuple[str, int, int], Any] = {}
    with ThreadPoolExecutor(max_workers=min(4, len(chunk_pairs) * 2), thread_name_prefix="copernicus-current") as executor:
        futures = [
            executor.submit(load_chunk, variable, latitude_chunk, longitude_chunk)
            for variable in (COPERNICUS_CURRENT_U_VARIABLE, COPERNICUS_CURRENT_V_VARIABLE)
            for latitude_chunk, longitude_chunk in chunk_pairs
        ]
        for future in as_completed(futures):
            key, values = future.result()
            chunks[key] = values

    fill_value = float(variable_config["fill_value"])
    u_values = np.full((len(latitude_indices), len(longitude_indices)), np.nan, dtype=float)
    v_values = np.full_like(u_values, np.nan)
    for row, latitude_index in enumerate(latitude_indices):
        latitude_chunk = int(latitude_index // latitude_chunk_size)
        local_latitude = int(latitude_index % latitude_chunk_size)
        for column, longitude_index in enumerate(longitude_indices):
            longitude_chunk = int(longitude_index // longitude_chunk_size)
            local_longitude = int(longitude_index % longitude_chunk_size)
            u_value = float(chunks[(COPERNICUS_CURRENT_U_VARIABLE, latitude_chunk, longitude_chunk)][local_latitude, local_longitude])
            v_value = float(chunks[(COPERNICUS_CURRENT_V_VARIABLE, latitude_chunk, longitude_chunk)][local_latitude, local_longitude])
            if abs(u_value) < fill_value * 0.5 and abs(v_value) < fill_value * 0.5:
                u_values[row, column] = u_value
                v_values[row, column] = v_value
    return {
        "timestamp": selected_time,
        "depth": 0.494,
        "longitudes": [float(longitudes_all[index]) for index in longitude_indices],
        "latitudes": [float(latitudes_all[index]) for index in latitude_indices],
        "u_values": u_values,
        "v_values": v_values,
    }


def get_current_field(
    *,
    west: float,
    south: float,
    east: float,
    north: float,
    width: int = 96,
    height: int = 64,
    force_refresh: bool = False,
) -> dict[str, Any]:
    if not COPERNICUS_USERNAME or not COPERNICUS_PASSWORD:
        raise CopernicusMarineError("Copernicus Marine 凭证未配置")
    west, south, east, north = _normalized_current_bounds(west, south, east, north)
    width = max(24, min(width, 72))
    height = max(16, min(height, 48))
    cache_key = f"{west:.2f}:{south:.2f}:{east:.2f}:{north:.2f}:{width}:{height}"
    now_timestamp = datetime.now(UTC).timestamp()
    cache_path = COPERNICUS_CURRENT_CACHE_DIR / f"{cache_key.replace(':', '_')}.json"
    with _region_cache_lock:
        cached = _current_field_cache.get(cache_key)
    if cached is None and not force_refresh:
        try:
            with cache_path.open("r", encoding="utf-8") as handle:
                cached_result = json.load(handle)
            cached_at = float(cached_result.pop("_cached_at", now_timestamp))
            cached = (cached_at, cached_result)
            with _region_cache_lock:
                _current_field_cache[cache_key] = cached
        except (OSError, ValueError, TypeError):
            cached = None
    if cached and not force_refresh and now_timestamp - cached[0] < CURRENT_FIELD_CACHE_TTL_SECONDS:
        result = dict(cached[1])
        result["cache"] = {"state": "fresh", "age_seconds": round(now_timestamp - cached[0], 1)}
        return result

    try:
        import numpy as np
    except ImportError as error:
        raise CopernicusMarineError("NumPy 未安装") from error

    try:
        with _current_field_compute_lock:
            with _region_cache_lock:
                refreshed_cached = _current_field_cache.get(cache_key)
            if refreshed_cached and not force_refresh and now_timestamp - refreshed_cached[0] < CURRENT_FIELD_CACHE_TTL_SECONDS:
                result = dict(refreshed_cached[1])
                result["cache"] = {"state": "fresh", "age_seconds": round(now_timestamp - refreshed_cached[0], 1)}
                return result
            target_time = datetime.now(UTC)
            grid = _arco_current_grid(
                west=west,
                south=south,
                east=east,
                north=north,
                width=width,
                height=height,
            )
        longitudes = grid["longitudes"]
        latitudes = grid["latitudes"]
        u_values = grid["u_values"]
        v_values = grid["v_values"]
        valid = np.isfinite(u_values) & np.isfinite(v_values)
        speeds = np.hypot(u_values, v_values)
        u_flat = [round(float(value), 5) if finite else None for value, finite in zip(u_values.ravel(), valid.ravel())]
        v_flat = [round(float(value), 5) if finite else None for value, finite in zip(v_values.ravel(), valid.ravel())]
        speed_flat = [round(float(value), 5) if finite else None for value, finite in zip(speeds.ravel(), valid.ravel())]
        selected_time = grid["timestamp"]
        timestamp = selected_time.isoformat().replace("+00:00", "Z")
        latency_seconds = max(0.0, (target_time - selected_time).total_seconds())
        valid_speeds = speeds[valid]
        result = {
            "dataset_id": COPERNICUS_CURRENT_DATASET_ID,
            "product_id": COPERNICUS_CURRENT_PRODUCT_ID,
            "fetched_at": datetime.now(UTC).isoformat(),
            "timestamp": timestamp,
            "time_role": "latest_available_analysis" if selected_time <= target_time else "forecast",
            "latency_seconds": round(latency_seconds, 1),
            "latency_hours": round(latency_seconds / 3600, 2),
            "depth": grid["depth"],
            "bounds": [[west, south], [east, north]],
            "width": len(longitudes),
            "height": len(latitudes),
            "longitudes": longitudes,
            "latitudes": latitudes,
            "u": u_flat,
            "v": v_flat,
            "speed": speed_flat,
            "valid_point_count": int(valid.sum()),
            "maximum_speed": round(float(valid_speeds.max()), 5) if valid_speeds.size else 0.0,
            "mean_speed": round(float(valid_speeds.mean()), 5) if valid_speeds.size else 0.0,
            "variables": CURRENT_VARIABLES,
            "data_class": "surface_merged_ocean_current_analysis_forecast",
            "animation_time_scale": "粒子按瞬时表层速度场积分，播放时间经过视觉加速，不代表实时时钟。",
            "source": {
                "name": "Copernicus Marine 全球表层合成海流（环流、潮流与波致漂移）",
                "dataset_url": COPERNICUS_CURRENT_PRODUCT_URL,
            },
            "cache": {"state": "fresh", "age_seconds": 0.0},
        }
    except Exception as error:  # noqa: BLE001
        if cached:
            result = dict(cached[1])
            result["cache"] = {"state": "stale", "age_seconds": round(now_timestamp - cached[0], 1)}
            return result
        raise CopernicusMarineError(f"Copernicus Marine 海流场读取失败：{error}") from error
    if not result["valid_point_count"]:
        raise CopernicusMarineError("Copernicus Marine 当前视窗没有有效海流网格点")
    with _region_cache_lock:
        _current_field_cache[cache_key] = (now_timestamp, result)
    try:
        COPERNICUS_CURRENT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        with cache_path.open("w", encoding="utf-8") as handle:
            json.dump({**result, "_cached_at": now_timestamp}, handle, ensure_ascii=False, separators=(",", ":"))
    except OSError:
        pass
    return result


def get_full_point_history(source: str, longitude: float, latitude: float) -> dict[str, Any]:
    if source not in {"wave", "wind"}:
        raise CopernicusMarineError("不支持的 Copernicus Marine 历史数据类型")
    if not COPERNICUS_USERNAME or not COPERNICUS_PASSWORD:
        raise CopernicusMarineError("Copernicus Marine 凭证未配置")
    copernicusmarine = _copernicusmarine_client()

    dataset_id = COPERNICUS_DATASET_ID if source == "wave" else COPERNICUS_WIND_DATASET_ID
    variables = list(WAVE_VARIABLES) if source == "wave" else ["eastward_wind", "northward_wind"]
    try:
        frame = copernicusmarine.read_dataframe(
            dataset_id=dataset_id,
            username=COPERNICUS_USERNAME,
            password=COPERNICUS_PASSWORD,
            variables=variables,
            minimum_longitude=longitude,
            maximum_longitude=longitude,
            minimum_latitude=latitude,
            maximum_latitude=latitude,
            end_datetime=datetime.now(UTC) - timedelta(hours=3 if source == "wave" else 0),
            coordinates_selection_method="nearest",
            disable_progress_bar=True,
        )
    except Exception as error:  # noqa: BLE001
        raise CopernicusMarineError(f"Copernicus Marine 全历史请求失败：{error}") from error
    if frame is None or len(frame.index) == 0:
        raise CopernicusMarineError("Copernicus Marine 未返回该点位的历史数据")

    by_timestamp: dict[str, dict[str, Any]] = {}
    for index, row in frame.iterrows():
        timestamp = _iso(row.get("time", index))
        if not timestamp:
            continue
        if source == "wave":
            record = {"timestamp": timestamp}
            for variable in variables:
                record[variable] = _finite(row.get(variable))
            if not any(record.get(variable) is not None for variable in variables):
                continue
        else:
            eastward = _finite(row.get("eastward_wind"))
            northward = _finite(row.get("northward_wind"))
            if eastward is None or northward is None:
                continue
            record = {
                "timestamp": timestamp,
                "eastward_wind": eastward,
                "northward_wind": northward,
                "wind_speed": math.hypot(eastward, northward),
                "wind_direction_from": (math.degrees(math.atan2(-eastward, -northward)) + 360) % 360,
            }
        by_timestamp[timestamp] = record
    records = sorted(by_timestamp.values(), key=lambda item: item["timestamp"])
    if not records:
        raise CopernicusMarineError("Copernicus Marine 该点位没有有效历史记录")
    return {
        "source": source,
        "dataset_id": dataset_id,
        "longitude": longitude,
        "latitude": latitude,
        "records": records,
        "record_count": len(records),
        "start_datetime": records[0]["timestamp"],
        "end_datetime": records[-1]["timestamp"],
        "fetched_at": datetime.now(UTC).isoformat(),
    }
