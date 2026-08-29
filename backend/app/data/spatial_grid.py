from __future__ import annotations

from typing import Any


ZONE_LAYOUT = (
    ("northwest", "西北", 0, 2),
    ("north", "北", 1, 2),
    ("northeast", "东北", 2, 2),
    ("west", "西", 0, 1),
    ("center", "中间", 1, 1),
    ("east", "东", 2, 1),
    ("southwest", "西南", 0, 0),
    ("south", "南", 1, 0),
    ("southeast", "东南", 2, 0),
)


def build_nine_zone_grid(bounds: tuple[tuple[float, float], tuple[float, float]]) -> dict[str, Any]:
    (west, south), (east, north) = bounds
    if not -90 <= south < north <= 90:
        raise ValueError("latitude bounds must satisfy -90 <= south < north <= 90")
    if not -180 <= west <= 180 or not -180 <= east <= 180 or west == east:
        raise ValueError("longitude bounds must be distinct values between -180 and 180")

    crosses_antimeridian = east < west
    unwrapped_east = east + 360 if crosses_antimeridian else east
    longitude_edges = [west + (unwrapped_east - west) * index / 3 for index in range(4)]
    latitude_edges = [south + (north - south) * index / 3 for index in range(4)]
    center_unwrapped = (west + unwrapped_east) / 2
    center_longitude = _normalize_longitude(center_unwrapped)
    center_latitude = (south + north) / 2

    zones = []
    for zone_id, name, column, row in ZONE_LAYOUT:
        zone_west = longitude_edges[column]
        zone_east = longitude_edges[column + 1]
        zone_south = latitude_edges[row]
        zone_north = latitude_edges[row + 1]
        zones.append(
            {
                "id": zone_id,
                "name": name,
                "position": {"row": 2 - row, "column": column},
                "center": {
                    "longitude": round(_normalize_longitude((zone_west + zone_east) / 2), 6),
                    "latitude": round((zone_south + zone_north) / 2, 6),
                },
                "bounds": {
                    "west": round(_normalize_longitude(zone_west), 6),
                    "south": round(zone_south, 6),
                    "east": round(_normalize_longitude(zone_east), 6),
                    "north": round(zone_north, 6),
                },
                "query_bounds": _query_bounds(zone_west, zone_south, zone_east, zone_north),
            }
        )

    return {
        "method": "analysis bounds geometric midpoint plus equal-longitude/equal-latitude 3x3 partition",
        "center": {"longitude": round(center_longitude, 6), "latitude": round(center_latitude, 6)},
        "crosses_antimeridian": crosses_antimeridian,
        "longitude_edges": [round(_normalize_longitude(value), 6) for value in longitude_edges],
        "latitude_edges": [round(value, 6) for value in latitude_edges],
        "zone_order": [name for _, name, _, _ in ZONE_LAYOUT],
        "zones": zones,
        "assignment_rule": "边界点按西闭东开、南闭北开归属；最东列和最北行包含外边界。点观测只归入一个区域。",
        "scientific_limit": "九区是统一统计框架，不等同于水团、行政区、生态区或航区；必须结合海岸线、有效海洋网格比例和样本覆盖解释。",
    }


def summarize_nine_zone_points(
    bounds: tuple[tuple[float, float], tuple[float, float]],
    points: list[dict[str, Any]],
    *,
    source_complete: bool = True,
    source_errors: list[str] | None = None,
    ocean_area_km2_by_zone: dict[str, float] | None = None,
) -> dict[str, Any]:
    grid = build_nine_zone_grid(bounds)
    zone_lookup = {zone["name"]: zone for zone in grid["zones"]}
    summaries = {
        name: {
            "zone": name,
            "raw_records": 0,
            "valid_records": 0,
            "unique_platforms": set(),
            "platform_types": {"Argo": set(), "浮标": set(), "岸基站": set(), "其他": set()},
            "variables": set(),
            "latest_observed_at": None,
        }
        for name in grid["zone_order"]
    }
    audit = {
        "input_items": len(points),
        "coordinate_missing": 0,
        "coordinate_invalid": 0,
        "outside_region": 0,
        "qc_failed_records": 0,
        "duplicate_platform_items": 0,
        "unassigned_records": 0,
    }
    all_platform_keys: set[str] = set()
    assigned_platform_items = 0

    for index, point in enumerate(points):
        raw_records = max(0, int(point.get("record_count", 1) or 0))
        longitude = point.get("longitude")
        latitude = point.get("latitude")
        if longitude is None or latitude is None:
            audit["coordinate_missing"] += raw_records
            audit["unassigned_records"] += raw_records
            continue
        try:
            longitude_value = float(longitude)
            latitude_value = float(latitude)
        except (TypeError, ValueError):
            audit["coordinate_invalid"] += raw_records
            audit["unassigned_records"] += raw_records
            continue
        if not -180 <= longitude_value <= 180 or not -90 <= latitude_value <= 90:
            audit["coordinate_invalid"] += raw_records
            audit["unassigned_records"] += raw_records
            continue
        zone_name = _zone_for_point(bounds, longitude_value, latitude_value)
        if zone_name is None:
            audit["outside_region"] += raw_records
            audit["unassigned_records"] += raw_records
            continue

        summary = summaries[zone_name]
        qc_passed = point.get("qc_passed") is not False
        valid_records = point.get("valid_record_count")
        valid_count = max(0, int(valid_records)) if valid_records is not None else (raw_records if qc_passed else 0)
        valid_count = min(valid_count, raw_records)
        summary["raw_records"] += raw_records
        summary["valid_records"] += valid_count
        audit["qc_failed_records"] += raw_records - valid_count

        platform_type = _platform_type(point.get("platform_type"))
        platform_key = str(point.get("platform_id") or point.get("id") or f"{platform_type}:{longitude_value:.4f}:{latitude_value:.4f}:{index}")
        summary["unique_platforms"].add(platform_key)
        summary["platform_types"][platform_type].add(platform_key)
        all_platform_keys.add(platform_key)
        assigned_platform_items += 1
        variable = str(point.get("variable") or "").strip()
        if variable:
            summary["variables"].add(variable)
        observed_at = str(point.get("observed_at") or "").strip() or None
        if observed_at and (summary["latest_observed_at"] is None or observed_at > summary["latest_observed_at"]):
            summary["latest_observed_at"] = observed_at

    audit["duplicate_platform_items"] = max(0, assigned_platform_items - len(all_platform_keys))
    zone_rows = []
    for zone_name in grid["zone_order"]:
        summary = summaries[zone_name]
        area = (ocean_area_km2_by_zone or {}).get(zone_name)
        unique_count = len(summary["unique_platforms"])
        raw_count = summary["raw_records"]
        valid_count = summary["valid_records"]
        zone_rows.append(
            {
                "zone": zone_name,
                "bounds": zone_lookup[zone_name]["bounds"],
                "raw_records": raw_count,
                "valid_records": valid_count,
                "unique_platforms": unique_count,
                "argo_platforms": len(summary["platform_types"]["Argo"]),
                "buoy_platforms": len(summary["platform_types"]["浮标"]),
                "coastal_stations": len(summary["platform_types"]["岸基站"]),
                "other_platforms": len(summary["platform_types"]["其他"]),
                "variable_count": len(summary["variables"]),
                "variables": sorted(summary["variables"]),
                "latest_observed_at": summary["latest_observed_at"],
                "qc_pass_fraction": round(valid_count / raw_count, 4) if raw_count else None,
                "effective_ocean_area_km2": area,
                "point_density_per_10000_km2": round(unique_count / area * 10_000, 4) if area and area > 0 else None,
                "count_semantics": "verified_zero" if source_complete and unique_count == 0 else ("unknown_or_incomplete" if not source_complete and unique_count == 0 else "observed_count"),
            }
        )

    return {
        "grid": grid,
        "source_complete": source_complete,
        "source_errors": source_errors or [],
        "totals": {
            "raw_records": sum(row["raw_records"] for row in zone_rows) + audit["unassigned_records"],
            "assigned_raw_records": sum(row["raw_records"] for row in zone_rows),
            "assigned_valid_records": sum(row["valid_records"] for row in zone_rows),
            "unique_platforms": len(all_platform_keys),
            "unassigned_records": audit["unassigned_records"],
        },
        "zones": zone_rows,
        "audit": audit,
        "interpretation_rules": [
            "原始记录数、有效记录数和独立平台数是不同口径，不得混写。",
            "verified_zero 仅表示数据源完整且该区没有匹配点；unknown_or_incomplete 不得写成 0。",
            "点位密度仅在提供各区有效海洋面积时计算；单点不能代表整个分区。",
        ],
    }


def _normalize_longitude(value: float) -> float:
    normalized = (value + 180) % 360 - 180
    return 180.0 if normalized == -180 and value > 0 else normalized


def _zone_for_point(bounds: tuple[tuple[float, float], tuple[float, float]], longitude: float, latitude: float) -> str | None:
    (west, south), (east, north) = bounds
    if not south <= latitude <= north:
        return None
    unwrapped_east = east + 360 if east < west else east
    unwrapped_longitude = longitude + 360 if east < west and longitude < west else longitude
    if not west <= unwrapped_longitude <= unwrapped_east:
        return None
    column = min(2, int((unwrapped_longitude - west) / (unwrapped_east - west) * 3))
    row = min(2, int((latitude - south) / (north - south) * 3))
    for _, name, zone_column, zone_row in ZONE_LAYOUT:
        if column == zone_column and row == zone_row:
            return name
    return None


def _platform_type(value: Any) -> str:
    normalized = str(value or "").strip().casefold()
    if "argo" in normalized:
        return "Argo"
    if any(term in normalized for term in ("buoy", "浮标", "漂流")):
        return "浮标"
    if any(term in normalized for term in ("coast", "shore", "岸基", "岸站", "沿岸站")):
        return "岸基站"
    return "其他"


def _query_bounds(west: float, south: float, east: float, north: float) -> list[dict[str, float]]:
    if east <= 180:
        return [{"west": round(west, 6), "south": round(south, 6), "east": round(east, 6), "north": round(north, 6)}]
    if west >= 180:
        return [{"west": round(west - 360, 6), "south": round(south, 6), "east": round(east - 360, 6), "north": round(north, 6)}]
    return [
        {"west": round(west, 6), "south": round(south, 6), "east": 180.0, "north": round(north, 6)},
        {"west": -180.0, "south": round(south, 6), "east": round(east - 360, 6), "north": round(north, 6)},
    ]
