"""Point bathymetry and local relief from authoritative global terrain grids."""

from __future__ import annotations

import json
import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from urllib.parse import urlencode
from urllib.request import Request, urlopen


GMRT_POINT_URL = "https://www.gmrt.org/services/PointServer"
GMRT_GRID_URL = "https://www.gmrt.org/services/GridServer"
GMRT_SOURCE_URL = "https://www.gmrt.org/services/"
GEBCO_API_URL = "https://api.opentopodata.org/v1/gebco2020"
GEBCO_SOURCE_URL = "https://www.opentopodata.org/datasets/gebco2020/"
PRECISION_RADIUS_M = 750.0
PRECISION_TARGET_RESOLUTION_M = 100.0
CACHE_TTL_SECONDS = 86_400.0
CACHE_MAX_ENTRIES = 2_048

_cache: dict[str, tuple[float, dict[str, object]]] = {}
_cache_lock = threading.Lock()


class BathymetryDataError(RuntimeError):
    """Raised when neither bathymetry source returns the selected point."""


def _number(value: object) -> float | None:
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _http_bytes(url: str, timeout: float = 8.0, *, accept: str = "application/json") -> bytes:
    request = Request(
        url,
        headers={"Accept": accept, "User-Agent": "ocean-intelligence-agent/1.0"},
    )
    with urlopen(request, timeout=timeout) as response:
        return response.read()


def _http_json(url: str, timeout: float = 8.0) -> object:
    return json.loads(_http_bytes(url, timeout=timeout).decode("utf-8"))


def _cache_key(longitude: float, latitude: float) -> str:
    # Version the key so legacy 25 km neighbourhood responses cannot be reused.
    return f"point-v2:{round(longitude, 5):.5f}:{round(latitude, 5):.5f}"


def _parse_esri_ascii(payload: bytes) -> dict[str, object]:
    lines = [line.strip() for line in payload.decode("utf-8-sig").splitlines() if line.strip()]
    header: dict[str, float] = {}
    data_start = 0
    header_names = {"ncols", "nrows", "xllcorner", "xllcenter", "yllcorner", "yllcenter", "cellsize", "nodata_value"}
    for index, line in enumerate(lines):
        parts = line.split()
        if len(parts) < 2 or parts[0].lower() not in header_names:
            data_start = index
            break
        header[parts[0].lower()] = float(parts[1])
    else:
        data_start = len(lines)

    required = {"ncols", "nrows", "cellsize"}
    if not required.issubset(header) or not ({"xllcorner", "xllcenter"} & header.keys()) or not ({"yllcorner", "yllcenter"} & header.keys()):
        raise BathymetryDataError("GMRT 精细网格缺少必要的空间参考信息")

    ncols = int(header["ncols"])
    nrows = int(header["nrows"])
    cellsize = header["cellsize"]
    xllcorner = header["xllcorner"] if "xllcorner" in header else header["xllcenter"] - cellsize / 2
    yllcorner = header["yllcorner"] if "yllcorner" in header else header["yllcenter"] - cellsize / 2
    values = [float(value) for line in lines[data_start:] for value in line.split()]
    if ncols < 2 or nrows < 2 or len(values) != ncols * nrows:
        raise BathymetryDataError("GMRT 精细网格尺寸与数据量不一致")
    rows = [values[index * ncols:(index + 1) * ncols] for index in range(nrows)]
    return {
        "ncols": ncols,
        "nrows": nrows,
        "xllcorner": xllcorner,
        "yllcorner": yllcorner,
        "cellsize": cellsize,
        "nodata": header.get("nodata_value", -99999.0),
        "rows": rows,
    }


def _grid_value_at(grid: dict[str, object], longitude: float, latitude: float) -> float:
    ncols = int(grid["ncols"])
    nrows = int(grid["nrows"])
    xllcorner = float(grid["xllcorner"])
    yllcorner = float(grid["yllcorner"])
    cellsize = float(grid["cellsize"])
    nodata = float(grid["nodata"])
    rows = grid["rows"]
    if not isinstance(rows, list):
        raise BathymetryDataError("GMRT 精细网格内容无效")

    x = min(ncols - 1.0, max(0.0, (longitude - xllcorner) / cellsize - 0.5))
    y = min(nrows - 1.0, max(0.0, (latitude - yllcorner) / cellsize - 0.5))
    x0, y0 = math.floor(x), math.floor(y)
    x1, y1 = min(ncols - 1, x0 + 1), min(nrows - 1, y0 + 1)
    tx = x - x0 if x1 != x0 else 0.0
    ty = y - y0 if y1 != y0 else 0.0
    weighted: dict[tuple[int, int], float] = {}
    for col, row_from_bottom, weight in (
        (x0, y0, (1 - tx) * (1 - ty)),
        (x1, y0, tx * (1 - ty)),
        (x0, y1, (1 - tx) * ty),
        (x1, y1, tx * ty),
    ):
        weighted[(col, row_from_bottom)] = weighted.get((col, row_from_bottom), 0.0) + weight

    total = 0.0
    total_weight = 0.0
    for (col, row_from_bottom), weight in weighted.items():
        value = float(rows[nrows - 1 - row_from_bottom][col])
        if not math.isfinite(value) or math.isclose(value, nodata, abs_tol=1e-6):
            continue
        total += value * weight
        total_weight += weight
    if total_weight <= 0:
        raise BathymetryDataError("GMRT 精细网格在所选坐标附近没有有效节点")
    return total / total_weight


def _gmrt_high_resolution(longitude: float, latitude: float) -> dict[str, object]:
    latitude_delta = PRECISION_RADIUS_M / 111_320.0
    longitude_delta = PRECISION_RADIUS_M / (111_320.0 * max(0.08, math.cos(math.radians(latitude))))
    longitude_delta = min(longitude_delta, 0.25)
    west = max(-180.0, longitude - longitude_delta)
    east = min(180.0, longitude + longitude_delta)
    south = max(-89.9, latitude - latitude_delta)
    north = min(89.9, latitude + latitude_delta)
    parameters = {
        "west": f"{west:.7f}",
        "east": f"{east:.7f}",
        "south": f"{south:.7f}",
        "north": f"{north:.7f}",
        "format": "esriascii",
        "mresolution": f"{PRECISION_TARGET_RESOLUTION_M:.0f}",
    }

    def fetch_grid(layer: str) -> dict[str, object]:
        query = urlencode({**parameters, "layer": layer})
        payload = _http_bytes(f"{GMRT_GRID_URL}?{query}", timeout=15.0, accept="application/octet-stream")
        return _parse_esri_ascii(payload)

    try:
        grid = fetch_grid("topo-mask")
        elevation = _grid_value_at(grid, longitude, latitude)
        high_resolution_coverage = True
    except Exception:  # noqa: BLE001 - a masked-grid miss is expected outside survey coverage
        grid = fetch_grid("topo")
        elevation = _grid_value_at(grid, longitude, latitude)
        high_resolution_coverage = False
    rows = grid["rows"]
    nodata = float(grid["nodata"])
    valid_values = [
        float(value)
        for row in rows if isinstance(row, list)
        for value in row
        if math.isfinite(float(value)) and not math.isclose(float(value), nodata, abs_tol=1e-6)
    ]
    if not valid_values:
        raise BathymetryDataError("GMRT 精细网格没有有效地形节点")
    cellsize = float(grid["cellsize"])
    resolution_y = cellsize * 111_320.0
    resolution_x = resolution_y * max(0.0, math.cos(math.radians(latitude)))
    micro_depths = [max(0.0, -value) for value in valid_values]
    return {
        "elevation": elevation,
        "horizontal_resolution_m": max(resolution_x, resolution_y),
        "interpolation_method": "双线性插值",
        "high_resolution_coverage": high_resolution_coverage,
        "grid_node_count": len(valid_values),
        "micro_radius_m": PRECISION_RADIUS_M,
        "micro_shallowest_depth_m": min(micro_depths),
        "micro_deepest_depth_m": max(micro_depths),
        "micro_relief_m": max(micro_depths) - min(micro_depths),
    }


def _gmrt_elevation(longitude: float, latitude: float) -> float:
    query = urlencode({"longitude": f"{longitude:.6f}", "latitude": f"{latitude:.6f}", "format": "json"})
    payload = _http_json(f"{GMRT_POINT_URL}?{query}")
    if not isinstance(payload, dict):
        raise BathymetryDataError("GMRT 返回格式不正确")
    elevation = _number(payload.get("elevation"))
    if elevation is None:
        raise BathymetryDataError("GMRT 未返回有效海床高程")
    return elevation


def _gebco_elevations(points: list[tuple[str, float, float]]) -> dict[str, float]:
    locations = "|".join(f"{latitude:.6f},{longitude:.6f}" for _, longitude, latitude in points)
    payload = _http_json(f"{GEBCO_API_URL}?{urlencode({'locations': locations})}", timeout=10.0)
    if not isinstance(payload, dict) or payload.get("status") != "OK":
        raise BathymetryDataError("GEBCO 2020 降级服务未返回有效结果")
    raw_results = payload.get("results")
    if not isinstance(raw_results, list):
        raise BathymetryDataError("GEBCO 2020 返回格式不正确")
    elevations: dict[str, float] = {}
    for point, item in zip(points, raw_results, strict=False):
        if not isinstance(item, dict):
            continue
        elevation = _number(item.get("elevation"))
        if elevation is not None:
            elevations[point[0]] = elevation
    return elevations


def _depth_zone(depth_m: float, is_ocean: bool) -> tuple[str, str, str]:
    if not is_ocean:
        return "land_or_intertidal", "陆地或潮间带", "该点海床高程不低于平均海平面，不能标记为海洋水深。"
    if depth_m <= 200:
        return "continental_shelf", "大陆架与浅海", "水深不超过 200 米，通常属于大陆架或近岸浅海范围。"
    if depth_m <= 3_000:
        return "continental_slope", "大陆坡与半深海", "水深位于 200 至 3,000 米之间，常见于大陆坡或半深海环境。"
    if depth_m <= 6_000:
        return "abyssal", "深海带", "水深位于 3,000 至 6,000 米之间，属于典型深海范围。"
    return "hadal", "超深渊带", "水深超过 6,000 米，属于海沟相关的超深渊环境。"


def _accuracy_assessment(
    primary_elevation: float,
    verification_elevation: float | None,
    *,
    precision_mode: str,
    high_resolution_coverage: bool,
) -> tuple[str, str, str, float | None]:
    if verification_elevation is None:
        if precision_mode == "gmrt_100m_grid" and high_resolution_coverage:
            return "medium", "中等", "存在 GMRT 高分辨率测线覆盖，但第二数据源暂未完成交叉校验。", None
        return "low", "有限", "当前只有一个全球地形来源，深度值应视为网格模型估算。", None

    difference = abs(primary_elevation - verification_elevation)
    sign_consistent = (primary_elevation < 0) == (verification_elevation < 0)
    if not sign_consistent:
        return "low", "有限", "GMRT 与 GEBCO 对该点的海陆判断不一致，建议放大地图后重新选点。", difference
    if precision_mode == "gmrt_100m_grid" and high_resolution_coverage and difference <= 100:
        return "high", "较高", "该点存在 GMRT 高分辨率测线覆盖，且与 GEBCO 的高程差不超过 100 米。", difference
    if difference <= 200:
        return "medium", "中等", "GMRT 与 GEBCO 对该点的结果接近；节点间距不代表实测误差。", difference
    return "low", "有限", "两套全球地形模型在该点差异较大，应结合局地测深资料复核。", difference


def _build_result(longitude: float, latitude: float) -> dict[str, object]:
    # The primary value is always resolved at the selected coordinate. Wider
    # context comes only from the explicitly labelled 750 m precision grid.
    points = [("center", longitude, latitude)]
    elevations: dict[str, float] = {}
    providers: dict[str, str] = {}
    gmrt_errors: list[str] = []
    precision_result: dict[str, object] | None = None
    verification_elevation: float | None = None
    verification_error: str | None = None

    with ThreadPoolExecutor(max_workers=len(points) + 2) as executor:
        futures = {
            executor.submit(_gmrt_elevation, point_longitude, point_latitude): ("point", label)
            for label, point_longitude, point_latitude in points
        }
        futures[executor.submit(_gmrt_high_resolution, longitude, latitude)] = ("precision", "center")
        futures[executor.submit(_gebco_elevations, [points[0]])] = ("verification", "center")
        for future in as_completed(futures):
            task, label = futures[future]
            try:
                value = future.result()
                if task == "precision":
                    precision_result = value
                elif task == "verification":
                    verification_elevation = value.get("center")
                else:
                    elevations[label] = value
                    providers[label] = "GMRT PointServer"
            except Exception as error:  # noqa: BLE001 - upstream errors are normalized below
                if task == "verification":
                    verification_error = str(error)
                else:
                    gmrt_errors.append(f"{task}/{label}: {error}")

    if precision_result is not None:
        elevations["center"] = float(precision_result["elevation"])
        providers["center"] = "GMRT 100 m GridServer"

    missing = [point for point in points if point[0] not in elevations]
    if missing and verification_elevation is not None and any(point[0] == "center" for point in missing):
        elevations["center"] = verification_elevation
        providers["center"] = "GEBCO 2020"
        missing = [point for point in missing if point[0] != "center"]
    if missing:
        try:
            fallback = _gebco_elevations(missing)
            for label, elevation in fallback.items():
                elevations[label] = elevation
                providers[label] = "GEBCO 2020"
        except Exception as error:  # noqa: BLE001 - keep the center error user-readable
            gmrt_errors.append(f"GEBCO: {error}")

    if "center" not in elevations:
        raise BathymetryDataError("全球海底地形服务暂未返回该坐标的有效深度")

    samples: list[dict[str, object]] = []
    for label, point_longitude, point_latitude in points:
        elevation = elevations.get(label)
        if elevation is None:
            continue
        samples.append({
            "direction": label,
            "longitude": round(point_longitude, 6),
            "latitude": round(point_latitude, 6),
            "elevation_m": round(elevation, 1),
            "water_depth_m": round(max(0.0, -elevation), 1),
            "provider": providers[label],
        })

    center_elevation = elevations["center"]
    is_ocean = center_elevation < 0
    water_depth = max(0.0, -center_elevation)
    zone, zone_name, explanation = _depth_zone(water_depth, is_ocean)
    shallowest = water_depth
    deepest = water_depth
    used_providers = {str(sample["provider"]) for sample in samples}
    if all(item.startswith("GMRT") for item in used_providers):
        provider = "GMRT 100 m GridServer" if precision_result is not None else "GMRT PointServer"
        dataset = "Global Multi-Resolution Topography Synthesis"
        source_url = GMRT_SOURCE_URL
    elif used_providers == {"GEBCO 2020"}:
        provider = "GEBCO 2020 via OpenTopoData"
        dataset = "GEBCO 2020 Grid"
        source_url = GEBCO_SOURCE_URL
    else:
        provider = "GMRT + GEBCO 2020"
        dataset = "GMRT Synthesis / GEBCO 2020 Grid"
        source_url = GMRT_SOURCE_URL

    precision_mode = (
        "gmrt_100m_grid"
        if precision_result is not None
        else "gmrt_point"
        if providers.get("center", "").startswith("GMRT")
        else "gebco_grid"
    )
    high_resolution_coverage = bool(precision_result and precision_result.get("high_resolution_coverage"))
    if precision_mode == "gebco_grid":
        verification_elevation = None
    confidence, confidence_name, confidence_note, source_difference = _accuracy_assessment(
        center_elevation,
        verification_elevation,
        precision_mode=precision_mode,
        high_resolution_coverage=high_resolution_coverage,
    )

    errors = []
    if gmrt_errors and not any(item.startswith("GMRT") for item in used_providers):
        errors.append("GMRT 当前不可用，已使用 GEBCO 2020 全球网格返回深度。")
    elif gmrt_errors:
        errors.append("部分 GMRT 点位请求未返回；系统已保留精细网格主值并补齐可用邻域。")
    if precision_result is None and providers.get("center", "").startswith("GMRT"):
        errors.append("GMRT 100 米精细网格暂不可用，所选点已降级为 PointServer 查询。")
    if verification_error:
        errors.append("GEBCO 交叉校验暂不可用；当前结果只依据主数据源。")

    horizontal_resolution = (
        round(float(precision_result["horizontal_resolution_m"]), 1)
        if precision_result is not None
        else 450.0
        if precision_mode == "gebco_grid"
        else None
    )
    if precision_result is not None:
        resolution_note = (
            f"点击坐标采用 GMRT GridServer 约 {horizontal_resolution:.0f} 米节点间距网格并进行双线性插值。"
            + ("该点存在高分辨率测线覆盖。" if high_resolution_coverage else "该点没有识别到高分辨率测线覆盖，精细节点可能来自较粗全球模型的重采样。")
            + "节点间距不是垂向测深误差，结果仍是地形模型估算值。"
        )
    elif precision_mode == "gmrt_point":
        resolution_note = "点击坐标由 GMRT PointServer 返回；服务未提供该点的节点间距，结果按整数米展示。"
    else:
        resolution_note = "点击坐标由 GEBCO 2020 全球网格返回；典型节点间距约 450 米，结果为网格模型估算。"

    now = datetime.now(UTC)
    return {
        "query_point": {"longitude": longitude, "latitude": latitude},
        "seafloor_elevation_m": round(center_elevation, 1),
        "water_depth_m": round(water_depth, 1),
        "is_ocean": is_ocean,
        "depth_zone": zone,
        "depth_zone_name": zone_name,
        "explanation": explanation,
        "query_radius_m": 0.0,
        "value_basis": "bilinear_grid_interpolation" if precision_result is not None else "point_service_grid_estimate",
        "sample_radius_km": 0.0,
        "shallowest_depth_m": round(shallowest, 1),
        "deepest_depth_m": round(deepest, 1),
        "local_relief_m": round(deepest - shallowest, 1),
        "sample_count": len(samples),
        "samples": samples,
        "provider": provider,
        "dataset": dataset,
        "source_url": source_url,
        "fallback_source_url": GEBCO_SOURCE_URL,
        "precision_mode": precision_mode,
        "horizontal_resolution_m": horizontal_resolution,
        "interpolation_method": str(precision_result["interpolation_method"]) if precision_result else "服务端点值",
        "high_resolution_coverage": high_resolution_coverage,
        "grid_node_count": int(precision_result["grid_node_count"]) if precision_result else 1,
        "micro_radius_m": float(precision_result["micro_radius_m"]) if precision_result else None,
        "micro_shallowest_depth_m": round(float(precision_result["micro_shallowest_depth_m"]), 1) if precision_result else None,
        "micro_deepest_depth_m": round(float(precision_result["micro_deepest_depth_m"]), 1) if precision_result else None,
        "micro_relief_m": round(float(precision_result["micro_relief_m"]), 1) if precision_result else None,
        "verification_provider": "GEBCO 2020" if verification_elevation is not None else None,
        "verification_elevation_m": round(verification_elevation, 1) if verification_elevation is not None else None,
        "verification_depth_m": round(max(0.0, -verification_elevation), 1) if verification_elevation is not None else None,
        "source_difference_m": round(source_difference, 1) if source_difference is not None else None,
        "confidence": confidence,
        "confidence_name": confidence_name,
        "confidence_note": confidence_note,
        "resolution_note": resolution_note,
        "retrieved_at": now,
        "errors": errors,
        "cache": {"state": "fresh", "age_seconds": 0.0, "ttl_seconds": CACHE_TTL_SECONDS},
    }


def get_bathymetry(longitude: float, latitude: float, *, force_refresh: bool = False) -> dict[str, object]:
    key = _cache_key(longitude, latitude)
    now = time.monotonic()
    with _cache_lock:
        cached = _cache.get(key)
    if cached and not force_refresh and now - cached[0] < CACHE_TTL_SECONDS:
        result = dict(cached[1])
        result["cache"] = {
            "state": "fresh",
            "age_seconds": round(now - cached[0], 1),
            "ttl_seconds": CACHE_TTL_SECONDS,
        }
        return result

    result = _build_result(longitude, latitude)
    with _cache_lock:
        if len(_cache) >= CACHE_MAX_ENTRIES:
            oldest_key = min(_cache, key=lambda item: _cache[item][0])
            _cache.pop(oldest_key, None)
        _cache[key] = (now, result)
    return result
