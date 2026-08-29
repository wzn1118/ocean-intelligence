from __future__ import annotations

import math
import time
from datetime import UTC, datetime, timedelta
from threading import Lock
from typing import Any

import numpy as np

from app.data.copernicus_client import (
    COPERNICUS_PASSWORD,
    COPERNICUS_USERNAME,
    CopernicusMarineError,
    _copernicusmarine_client,
    _dataset_end_from_error,
)


CATALOGUE_CACHE_TTL_SECONDS = 900.0
MAX_QUERY_DAYS = 366
MAX_QUERY_VARIABLES = 12
MAX_QUERY_VALUES = 250_000
_catalogue_cache: dict[tuple[str, str, str], tuple[float, Any]] = {}
_catalogue_cache_lock = Lock()
QUERY_ALIASES = {
    "风": "wind",
    "风场": "wind",
    "海浪": "wave",
    "波浪": "wave",
    "海温": "temperature",
    "温度": "temperature",
    "盐度": "salinity",
    "叶绿素": "chlorophyll",
    "营养盐": "nutrient",
    "硝酸盐": "nitrate",
    "磷酸盐": "phosphate",
    "硅酸盐": "silicate",
    "溶解氧": "oxygen",
    "海流": "current",
    "流场": "current",
    "海平面": "sea level",
    "二氧化碳": "carbon dioxide",
    "酸化": "ph",
}


def _catalogue(*, query: str = "", product_id: str = "", dataset_id: str = "") -> Any:
    key = (query.strip().lower(), product_id.strip(), dataset_id.strip())
    now = time.time()
    with _catalogue_cache_lock:
        cached = _catalogue_cache.get(key)
    if cached and now - cached[0] < CATALOGUE_CACHE_TTL_SECONDS:
        return cached[1]
    client = _copernicusmarine_client()
    try:
        catalogue = client.describe(
            contains=[query.strip()] if query.strip() else [],
            product_id=product_id.strip() or None,
            dataset_id=dataset_id.strip() or None,
            disable_progress_bar=True,
            raise_on_error=True,
        )
    except Exception as error:  # noqa: BLE001
        raise CopernicusMarineError(f"Copernicus Marine 目录请求失败：{error}") from error
    with _catalogue_cache_lock:
        _catalogue_cache[key] = (now, catalogue)
    return catalogue


def _text(value: Any, limit: int) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    return text if len(text) <= limit else f"{text[:limit].rstrip()}…"


def _normalized_query(query: str) -> str:
    stripped = query.strip()
    return QUERY_ALIASES.get(stripped, stripped)


def _versions(dataset: Any) -> list[Any]:
    return list(getattr(dataset, "versions", None) or [])


def _latest_version(dataset: Any) -> Any | None:
    versions = _versions(dataset)
    return versions[-1] if versions else None


def _parts(version: Any | None) -> list[Any]:
    return list(getattr(version, "parts", None) or []) if version is not None else []


def _services(dataset: Any) -> list[Any]:
    version = _latest_version(dataset)
    services: list[Any] = []
    for part in _parts(version):
        services.extend(list(getattr(part, "services", None) or []))
    return services


def _coordinate_value(value: Any, unit: str) -> Any:
    if value is None:
        return None
    if "milliseconds since 1970" in unit.lower():
        try:
            return datetime.fromtimestamp(float(value) / 1000, UTC).isoformat()
        except (TypeError, ValueError, OverflowError):
            return value
    return value


def _variable_catalog(dataset: Any) -> list[dict[str, Any]]:
    variables: dict[str, dict[str, Any]] = {}
    for service in _services(dataset):
        service_name = str(getattr(service, "service_short_name", None) or getattr(service, "service_name", ""))
        for variable in list(getattr(service, "variables", None) or []):
            short_name = str(getattr(variable, "short_name", "") or "").strip()
            if not short_name:
                continue
            coordinates = []
            for coordinate in list(getattr(variable, "coordinates", None) or []):
                unit = str(getattr(coordinate, "coordinate_unit", "") or "")
                coordinates.append({
                    "id": getattr(coordinate, "coordinate_id", None),
                    "unit": unit or None,
                    "minimum": _coordinate_value(getattr(coordinate, "minimum_value", None), unit),
                    "maximum": _coordinate_value(getattr(coordinate, "maximum_value", None), unit),
                    "step": getattr(coordinate, "step", None),
                    "axis": getattr(coordinate, "axis", None),
                })
            candidate = {
                "short_name": short_name,
                "standard_name": getattr(variable, "standard_name", None),
                "units": getattr(variable, "units", None),
                "bbox": getattr(variable, "bbox", None),
                "coordinates": coordinates,
                "services": [service_name] if service_name else [],
            }
            current = variables.get(short_name)
            if current is None:
                variables[short_name] = candidate
            else:
                current["services"] = sorted(set([*current["services"], *candidate["services"]]))
                if len(candidate["coordinates"]) > len(current["coordinates"]):
                    current["coordinates"] = candidate["coordinates"]
    return sorted(variables.values(), key=lambda item: item["short_name"].lower())


def search_catalogue(
    *,
    query: str = "",
    product_id: str = "",
    dataset_id: str = "",
    limit: int = 20,
    offset: int = 0,
) -> dict[str, Any]:
    limit = max(1, min(int(limit), 100))
    offset = max(0, int(offset))
    normalized_query = _normalized_query(query)
    catalogue = _catalogue(query=normalized_query, product_id=product_id, dataset_id=dataset_id)
    matches: list[dict[str, Any]] = []
    for product in list(getattr(catalogue, "products", None) or []):
        for dataset in list(getattr(product, "datasets", None) or []):
            variables = _variable_catalog(dataset)
            latest_version = _latest_version(dataset)
            item = {
                "product_id": getattr(product, "product_id", None),
                "product_title": _text(getattr(product, "title", None), 500),
                "product_description": _text(getattr(product, "description", None), 800),
                "processing_level": getattr(product, "processing_level", None),
                "production_center": getattr(product, "production_center", None),
                "dataset_id": getattr(dataset, "dataset_id", None),
                "dataset_name": getattr(dataset, "dataset_name", None),
                "dataset_version": getattr(latest_version, "label", None),
                "variable_count": len(variables),
                "variables": variables[:20],
                "service_types": sorted({
                    str(getattr(service, "service_short_name", None) or getattr(service, "service_name", ""))
                    for service in _services(dataset)
                    if getattr(service, "service_short_name", None) or getattr(service, "service_name", None)
                }),
                "digital_object_identifier": getattr(dataset, "digital_object_identifier", None),
            }
            searchable = " ".join([
                str(item.get("product_id") or ""),
                str(item.get("product_title") or ""),
                str(item.get("dataset_id") or ""),
                " ".join(
                    f"{variable.get('short_name') or ''} {variable.get('standard_name') or ''}"
                    for variable in variables
                ),
                str(item.get("product_description") or ""),
            ]).lower()
            terms = [term for term in normalized_query.lower().split() if term]
            item["relevance_score"] = sum(searchable.count(term) for term in terms)
            matches.append(item)
    matches.sort(key=lambda item: (-int(item["relevance_score"]), str(item.get("dataset_id") or "")))
    page = matches[offset : offset + limit]
    return {
        "query": query,
        "normalized_query": normalized_query,
        "product_id": product_id or None,
        "dataset_id": dataset_id or None,
        "total": len(matches),
        "offset": offset,
        "limit": limit,
        "next_offset": offset + limit if offset + limit < len(matches) else None,
        "datasets": page,
        "catalogue_scope": "Copernicus Marine catalogue dynamic discovery; results are not restricted to the product's preconfigured wave, wind or current datasets.",
    }


def describe_dataset(dataset_id: str) -> dict[str, Any]:
    dataset_id = dataset_id.strip()
    if not dataset_id:
        raise ValueError("dataset_id is required")
    catalogue = _catalogue(dataset_id=dataset_id)
    for product in list(getattr(catalogue, "products", None) or []):
        for dataset in list(getattr(product, "datasets", None) or []):
            if str(getattr(dataset, "dataset_id", "")) != dataset_id:
                continue
            versions = []
            for version in _versions(dataset):
                versions.append({
                    "label": getattr(version, "label", None),
                    "released_date": getattr(version, "released_date", None),
                    "arco_updated_date": getattr(version, "arco_updated_date", None),
                    "parts": [
                        {
                            "name": getattr(part, "name", None),
                            "services": [
                                str(getattr(service, "service_short_name", None) or getattr(service, "service_name", ""))
                                for service in list(getattr(part, "services", None) or [])
                            ],
                        }
                        for part in _parts(version)
                    ],
                })
            return {
                "product_id": getattr(product, "product_id", None),
                "product_title": _text(getattr(product, "title", None), 500),
                "product_description": _text(getattr(product, "description", None), 2000),
                "processing_level": getattr(product, "processing_level", None),
                "production_center": getattr(product, "production_center", None),
                "keywords": getattr(product, "keywords", None),
                "dataset_id": dataset_id,
                "dataset_name": getattr(dataset, "dataset_name", None),
                "digital_object_identifier": getattr(dataset, "digital_object_identifier", None),
                "versions": versions,
                "variables": _variable_catalog(dataset),
                "query_guidance": {
                    "workflow": [
                        "Select exact variable short names from variables.",
                        "Use a bounded longitude/latitude/time/depth subset.",
                        "Call ocean_copernicus_dataset_analyze for statistics and report evidence.",
                    ],
                    "evidence_rule": "Preserve the product processing level and distinguish model, satellite fusion, reanalysis and in-situ observations in the final report.",
                },
            }
    raise LookupError(f"Copernicus Marine dataset not found: {dataset_id}")


def _parse_datetime(value: str | datetime | None, *, fallback: datetime) -> datetime:
    if value is None or value == "":
        return fallback
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _safe_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _as_iso(value: Any) -> str | None:
    if isinstance(value, tuple) and value:
        value = value[0]
    if hasattr(value, "to_pydatetime"):
        value = value.to_pydatetime()
    if isinstance(value, datetime):
        parsed = value if value.tzinfo else value.replace(tzinfo=UTC)
        return parsed.astimezone(UTC).isoformat()
    if isinstance(value, np.datetime64):
        if np.isnat(value):
            return None
        return f"{np.datetime_as_string(value, unit='s')}+00:00"
    if isinstance(value, str) and value:
        return value
    return None


def _coordinate_summary(dataset: Any, coordinate: str) -> dict[str, Any] | None:
    if coordinate not in dataset.coords or int(dataset.sizes.get(coordinate, 0)) == 0:
        return None
    values = dataset.coords[coordinate].values
    return {
        "count": int(dataset.sizes.get(coordinate, 0)),
        "minimum": _as_iso(values[0]) if coordinate == "time" else _safe_number(values[0]),
        "maximum": _as_iso(values[-1]) if coordinate == "time" else _safe_number(values[-1]),
        "unit": dataset.coords[coordinate].attrs.get("units"),
    }


def _sample_positions(size: int, limit: int) -> list[int]:
    if size <= limit:
        return list(range(size))
    return sorted(set(np.linspace(0, size - 1, limit, dtype=int).tolist()))


def _variable_analysis(data_array: Any, *, timeline_limit: int, sample_limit: int) -> dict[str, Any]:
    values = np.asarray(data_array.values, dtype=float)
    finite = values[np.isfinite(values)]
    result: dict[str, Any] = {
        "standard_name": data_array.attrs.get("standard_name"),
        "long_name": data_array.attrs.get("long_name"),
        "units": data_array.attrs.get("units"),
        "dimensions": list(data_array.dims),
        "shape": list(values.shape),
        "value_count": int(values.size),
        "valid_count": int(finite.size),
        "missing_count": int(values.size - finite.size),
        "zero_count": int(np.count_nonzero(finite == 0)),
        "negative_count": int(np.count_nonzero(finite < 0)),
        "valid_fraction": float(finite.size / values.size) if values.size else None,
        "aggregation_note": "Timeline means and summary statistics are unweighted over returned finite values unless the caller applies variable-appropriate area, time or depth weights.",
    }
    if finite.size:
        result["statistics"] = {
            "mean": float(np.mean(finite)),
            "minimum": float(np.min(finite)),
            "maximum": float(np.max(finite)),
            "standard_deviation": float(np.std(finite)),
            "p05": float(np.percentile(finite, 5)),
            "median": float(np.percentile(finite, 50)),
            "p95": float(np.percentile(finite, 95)),
        }
    else:
        result["statistics"] = None

    timeline: list[dict[str, Any]] = []
    if "time" in data_array.dims and int(data_array.sizes.get("time", 0)) > 0:
        reduce_dimensions = [dimension for dimension in data_array.dims if dimension != "time"]
        series = data_array.mean(dim=reduce_dimensions, skipna=True) if reduce_dimensions else data_array
        positions = _sample_positions(int(series.sizes.get("time", 0)), timeline_limit)
        for position in positions:
            value = _safe_number(series.isel(time=position).values)
            if value is not None:
                timeline.append({"timestamp": _as_iso(series.coords["time"].values[position]), "mean": value})
    result["timeline"] = timeline

    samples: list[dict[str, Any]] = []
    finite_positions = np.argwhere(np.isfinite(values))
    for position_index in _sample_positions(len(finite_positions), sample_limit):
        position = finite_positions[position_index]
        sample: dict[str, Any] = {"value": float(values[tuple(position)])}
        for dimension, index in zip(data_array.dims, position, strict=False):
            if dimension in data_array.coords:
                coordinate_value = data_array.coords[dimension].values[int(index)]
                sample[dimension] = _as_iso(coordinate_value) if dimension == "time" else _safe_number(coordinate_value)
            else:
                sample[dimension] = int(index)
        samples.append(sample)
    result["samples"] = samples
    return result


def analyze_dataset(
    *,
    dataset_id: str,
    variables: list[str],
    minimum_longitude: float,
    maximum_longitude: float,
    minimum_latitude: float,
    maximum_latitude: float,
    start_datetime: str | datetime | None = None,
    end_datetime: str | datetime | None = None,
    minimum_depth: float | None = None,
    maximum_depth: float | None = None,
    coordinates_selection_method: str = "inside",
    derived_vectors: list[dict[str, str]] | None = None,
    maximum_values: int = 80_000,
    timeline_limit: int = 48,
    sample_limit: int = 12,
) -> dict[str, Any]:
    if not COPERNICUS_USERNAME or not COPERNICUS_PASSWORD:
        raise CopernicusMarineError("Copernicus Marine 凭证未配置")
    dataset_id = dataset_id.strip()
    selected_variables = list(dict.fromkeys(str(variable).strip() for variable in variables if str(variable).strip()))
    vector_specs = list(derived_vectors or [])
    if not dataset_id:
        raise ValueError("dataset_id is required")
    if not selected_variables:
        raise ValueError("At least one variable is required")
    if len(selected_variables) > MAX_QUERY_VARIABLES:
        raise ValueError(f"A maximum of {MAX_QUERY_VARIABLES} variables may be queried at once")
    if len(vector_specs) > 4:
        raise ValueError("A maximum of 4 derived vectors may be requested at once")
    if not -180 <= minimum_longitude <= maximum_longitude <= 180:
        raise ValueError("Longitude bounds are invalid")
    if not -90 <= minimum_latitude <= maximum_latitude <= 90:
        raise ValueError("Latitude bounds are invalid")
    if coordinates_selection_method not in {"inside", "strict-inside", "nearest", "outside"}:
        raise ValueError("Unsupported coordinates_selection_method")

    now = datetime.now(UTC)
    requested_end = _parse_datetime(end_datetime, fallback=now)
    requested_start = _parse_datetime(start_datetime, fallback=requested_end - timedelta(days=1))
    if requested_start > requested_end:
        raise ValueError("start_datetime must not be after end_datetime")
    if requested_end - requested_start > timedelta(days=MAX_QUERY_DAYS):
        raise ValueError(f"A single analysis request is limited to {MAX_QUERY_DAYS} days")
    maximum_values = max(5_000, min(int(maximum_values), MAX_QUERY_VALUES))
    timeline_limit = max(1, min(int(timeline_limit), 200))
    sample_limit = max(0, min(int(sample_limit), 50))

    description = describe_dataset(dataset_id)
    available_variables = {item["short_name"] for item in description["variables"]}
    missing_variables = [variable for variable in selected_variables if variable not in available_variables]
    if missing_variables:
        raise ValueError(f"Variables are not present in {dataset_id}: {', '.join(missing_variables)}")
    for vector in vector_specs:
        name = str(vector.get("name") or "").strip()
        eastward = str(vector.get("eastward") or "").strip()
        northward = str(vector.get("northward") or "").strip()
        if not name or not eastward or not northward:
            raise ValueError("Each derived vector requires name, eastward and northward fields")
        if eastward not in selected_variables or northward not in selected_variables:
            raise ValueError("Derived vector components must also be present in variables")

    client = _copernicusmarine_client()
    query_arguments = {
        "dataset_id": dataset_id,
        "username": COPERNICUS_USERNAME,
        "password": COPERNICUS_PASSWORD,
        "variables": selected_variables,
        "minimum_longitude": minimum_longitude,
        "maximum_longitude": maximum_longitude,
        "minimum_latitude": minimum_latitude,
        "maximum_latitude": maximum_latitude,
        "start_datetime": requested_start,
        "end_datetime": requested_end,
        "coordinates_selection_method": coordinates_selection_method,
    }
    if minimum_depth is not None:
        query_arguments["minimum_depth"] = minimum_depth
    if maximum_depth is not None:
        query_arguments["maximum_depth"] = maximum_depth

    effective_start = requested_start
    effective_end = requested_end
    try:
        dataset = client.open_dataset(**query_arguments)
    except Exception as error:  # noqa: BLE001
        available_end = _dataset_end_from_error(error)
        if available_end is None or available_end >= requested_end:
            raise CopernicusMarineError(f"Copernicus Marine 数据请求失败：{error}") from error
        duration = requested_end - requested_start
        effective_end = available_end
        effective_start = available_end - duration
        query_arguments["start_datetime"] = effective_start
        query_arguments["end_datetime"] = effective_end
        try:
            dataset = client.open_dataset(**query_arguments)
        except Exception as retry_error:  # noqa: BLE001
            raise CopernicusMarineError(f"Copernicus Marine 数据请求失败：{retry_error}") from retry_error

    try:
        available = [variable for variable in selected_variables if variable in dataset.data_vars]
        if not available:
            raise CopernicusMarineError("Copernicus Marine 子集没有返回任何请求变量")
        original_sizes = {name: int(size) for name, size in dataset.sizes.items()}
        original_value_count = sum(math.prod(int(size) for size in dataset[variable].shape) for variable in available)
        strides: dict[str, int] = {}
        if original_value_count > maximum_values:
            reducible = [dimension for dimension, size in dataset.sizes.items() if int(size) > 1]
            factor = (original_value_count / maximum_values) ** (1 / max(1, len(reducible)))
            strides = {dimension: max(1, int(math.ceil(factor))) for dimension in reducible}
            dataset = dataset.isel({dimension: slice(None, None, stride) for dimension, stride in strides.items()})
        dataset.load()
        sampled_sizes = {name: int(size) for name, size in dataset.sizes.items()}
        sampled_value_count = sum(math.prod(int(size) for size in dataset[variable].shape) for variable in available)
        analyses = {
            variable: _variable_analysis(dataset[variable], timeline_limit=timeline_limit, sample_limit=sample_limit)
            for variable in available
        }
        for vector in vector_specs:
            name = str(vector["name"]).strip()
            eastward = str(vector["eastward"]).strip()
            northward = str(vector["northward"]).strip()
            if eastward not in dataset.data_vars or northward not in dataset.data_vars:
                continue
            magnitude = np.hypot(dataset[eastward], dataset[northward])
            static_zero_masked = False
            if "time" in magnitude.dims and int(magnitude.sizes.get("time", 0)) > 1:
                non_time_dimensions = [dimension for dimension in magnitude.dims if dimension != "time"]
                if non_time_dimensions:
                    static_zero = magnitude.fillna(0).max(dim="time") == 0
                    static_zero_masked = bool(np.asarray(static_zero.values).any())
                    magnitude = magnitude.where(~static_zero)
            magnitude.attrs = {
                "standard_name": name,
                "long_name": str(vector.get("long_name") or name),
                "units": str(vector.get("units") or dataset[eastward].attrs.get("units") or ""),
            }
            analyses[name] = {
                **_variable_analysis(magnitude, timeline_limit=timeline_limit, sample_limit=sample_limit),
                "derived_from": [eastward, northward],
                "derivation": "sqrt(eastward^2 + northward^2) calculated for every sampled grid value before aggregation",
                "static_zero_cells_masked": static_zero_masked,
                "mask_rule": "Grid cells with zero vector magnitude at every returned time are excluded as persistent non-data/land-mask cells.",
            }
        fetched_at = datetime.now(UTC)
        latest_valid_time = None
        if "time" in dataset.coords and int(dataset.sizes.get("time", 0)) > 0:
            latest_valid_time = _as_iso(dataset.coords["time"].values[-1])
        latency_hours = None
        if latest_valid_time:
            parsed_latest = _parse_datetime(latest_valid_time, fallback=fetched_at)
            latency_hours = max(0.0, (fetched_at - parsed_latest).total_seconds() / 3600)
        return {
            "product": {
                "product_id": description["product_id"],
                "title": description["product_title"],
                "processing_level": description["processing_level"],
                "production_center": description["production_center"],
            },
            "dataset_id": dataset_id,
            "query": {
                "variables": selected_variables,
                "bounds": {
                    "minimum_longitude": minimum_longitude,
                    "maximum_longitude": maximum_longitude,
                    "minimum_latitude": minimum_latitude,
                    "maximum_latitude": maximum_latitude,
                    "minimum_depth": minimum_depth,
                    "maximum_depth": maximum_depth,
                },
                "requested_start_datetime": requested_start.isoformat(),
                "requested_end_datetime": requested_end.isoformat(),
                "effective_start_datetime": effective_start.isoformat(),
                "effective_end_datetime": effective_end.isoformat(),
                "coordinates_selection_method": coordinates_selection_method,
                "derived_vectors": vector_specs,
            },
            "coverage": {
                coordinate: summary
                for coordinate in ("time", "longitude", "latitude", "depth", "elevation")
                if (summary := _coordinate_summary(dataset, coordinate)) is not None
            },
            "latest_valid_time": latest_valid_time,
            "fetched_at": fetched_at.isoformat(),
            "data_latency_hours": round(latency_hours, 3) if latency_hours is not None else None,
            "sampling": {
                "statistics_scope": "exact" if not strides else "systematic_downsample",
                "original_sizes": original_sizes,
                "sampled_sizes": sampled_sizes,
                "original_value_count": original_value_count,
                "sampled_value_count": sampled_value_count,
                "maximum_values": maximum_values,
                "strides": strides,
            },
            "variables": analyses,
            "report_guidance": {
                "required_fields": [
                    "product_id and dataset_id",
                    "variable names and units",
                    "spatial, temporal and depth coverage",
                    "latest_valid_time, fetched_at and data_latency_hours",
                    "sampling.statistics_scope",
                    "per-variable value_count, valid_count, missing_count, zero_count, negative_count and valid_fraction",
                    "time span versus timestamp count",
                    "valid vector count versus component-value count for vector variables",
                    "land/static-zero mask and spatial weighting method",
                    "same nine-zone statistics for every spatial variable, including coverage, median, p05/p95 and extrema",
                    "previous equal-length window or documented baseline-unavailable reason",
                    "concurrent point-platform count and independent-validation limit",
                    "processing level and evidence limitations",
                ],
                "variable_specific_rules": {
                    "sea_surface_temperature": "State skin/sub-skin/foundation/bulk or depth definition, temperature scale, cloud/land/ice masks, weighting, baseline and in-situ validation.",
                    "salinity_and_profiles": "State Practical Salinity PSS-78 versus Absolute Salinity, profile/platform/level counts, depth coverage, QC, interpolation and mixed-layer/thermocline/halocline criteria.",
                    "surface_current": "Derive magnitude per grid-time value from u/v, distinguish vectors from component values, report toward-direction, directional constancy, representative depth and point validation.",
                    "waves": "Separate total sea, swell partitions and wind waves; state Hs/period/direction conventions, analysis versus forecast valid time, masks and buoy validation; do not linearly add component Hs.",
                    "chlorophyll_and_ecology": "Report units, median and quantiles for skewed values, cloud/coastal-optics/QC masks, zero/negative audit, baseline and field validation; high chlorophyll alone is not a bloom or red tide.",
                },
                "scientific_limit": "These statistics describe the selected Copernicus Marine product subset. They do not automatically constitute an in-situ observation, causal attribution, confirmed event or official warning.",
            },
        }
    finally:
        close = getattr(dataset, "close", None)
        if callable(close):
            close()
