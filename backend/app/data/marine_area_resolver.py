from __future__ import annotations

from math import cos, radians
from typing import Any

from app.data.marine_area_catalog import MARINE_AREA_CATALOG, locate_marine_area


def resolve_marine_area(*, query: str = "", longitude: float | None = None, latitude: float | None = None) -> dict[str, Any]:
    text = str(query or "").strip()
    folded = text.casefold()
    text_matches: list[tuple[int, float, dict[str, Any]]] = []
    for area in MARINE_AREA_CATALOG:
        labels = [str(area.get("name") or ""), str(area.get("name_en") or "")]
        matched_lengths = [len(label) for label in labels if label and label.casefold() in folded]
        if not matched_lengths:
            continue
        geometry_rank = {"polygon": 0.0, "approximate": 1.0, "missing": 2.0}.get(str(area.get("geometry_status")), 3.0)
        text_matches.append((max(matched_lengths), geometry_rank, area))
    text_matches.sort(key=lambda item: (-item[0], item[1], -float(item[2].get("priority_weight") or 0)))

    point_match = None
    if longitude is not None and latitude is not None:
        longitude_value = float(longitude)
        latitude_value = float(latitude)
        if not -180 <= longitude_value <= 180 or not -90 <= latitude_value <= 90:
            raise ValueError("point coordinates are outside valid longitude/latitude ranges")
        point_match = locate_marine_area(longitude_value, latitude_value)

    text_match = text_matches[0][2] if text_matches else None
    selected = text_match or point_match
    selected_by = "text" if text_match else ("point" if point_match else "none")
    conflict = bool(text_match and point_match and text_match.get("id") != point_match.get("id"))
    return {
        "query": text,
        "input_point": {"longitude": longitude, "latitude": latitude} if longitude is not None and latitude is not None else None,
        "selected_by": selected_by,
        "selected": _public_area(selected) if selected else None,
        "text_matches": [_public_area(item[2]) for item in text_matches[:10]],
        "point_match": _public_area(point_match) if point_match else None,
        "text_point_conflict": conflict,
        "resolution_rule": "明确文本海域优先；没有文本海域时使用点位定位；二者冲突时必须在报告中说明并确认分析范围。",
        "recognized": selected is not None,
    }


def _public_area(area: dict[str, Any] | None) -> dict[str, Any] | None:
    if not area:
        return None
    geometry_status = str(area.get("geometry_status") or "missing")
    bounds = _area_bounds(area)
    return {
        "id": area.get("id"),
        "name": area.get("name"),
        "name_en": area.get("name_en"),
        "kind": area.get("kind"),
        "parent": area.get("parent"),
        "geometry_status": geometry_status,
        "center": {
            "longitude": area.get("center_longitude"),
            "latitude": area.get("center_latitude"),
        } if area.get("center_longitude") is not None and area.get("center_latitude") is not None else None,
        "bounds": bounds,
        "bounds_status": "polygon_bbox" if geometry_status == "polygon" else ("radius_derived_approximation" if bounds else "unavailable"),
        "requires_bounds_confirmation": geometry_status != "polygon",
        "source": area.get("source"),
        "source_version": area.get("source_version"),
    }


def _area_bounds(area: dict[str, Any]) -> dict[str, float] | None:
    polygon = area.get("polygon")
    if polygon:
        longitudes = [float(point[0]) for point in polygon]
        latitudes = [float(point[1]) for point in polygon]
        return {
            "west": round(min(longitudes), 6),
            "south": round(min(latitudes), 6),
            "east": round(max(longitudes), 6),
            "north": round(max(latitudes), 6),
        }
    longitude = area.get("center_longitude")
    latitude = area.get("center_latitude")
    radius_km = area.get("radius_km")
    if longitude is None or latitude is None or radius_km is None:
        return None
    latitude_delta = float(radius_km) / 111.2
    longitude_delta = float(radius_km) / (111.2 * max(0.15, cos(radians(float(latitude)))))
    return {
        "west": round(_normalize_longitude(float(longitude) - longitude_delta), 6),
        "south": round(max(-90.0, float(latitude) - latitude_delta), 6),
        "east": round(_normalize_longitude(float(longitude) + longitude_delta), 6),
        "north": round(min(90.0, float(latitude) + latitude_delta), 6),
    }


def _normalize_longitude(value: float) -> float:
    normalized = (value + 180) % 360 - 180
    return 180.0 if normalized == -180 and value > 0 else normalized
