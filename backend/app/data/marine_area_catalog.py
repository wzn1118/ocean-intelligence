"""Named marine-area catalogue used by the daily Copernicus index.

The catalogue deliberately separates a known name from usable geometry.  A
name-only atlas row is retained for coverage auditing, but observations are
never assigned to it until a polygon or approximate centre is available.
"""

from __future__ import annotations

from hashlib import sha1
from math import asin, cos, radians, sin, sqrt
from typing import Any

from app.data.china_coastal_areas import CHINA_COASTAL_AREAS, CHINA_MARGINAL_SEAS
from app.data.marine_atlas import ATLAS_VERSION, MARINE_ATLAS


TAIWAN_RELATED_NAMES = frozenset(
    {
        "中国台湾海峡",
        "澎湖水道",
        "巴士海峡",
        "中国台湾东北部海域",
        "中国台湾东部海域",
        "中国台湾南部海域",
    }
)


def _stable_id(namespace: str, name_en: str) -> str:
    digest = sha1(f"{namespace}:{name_en.casefold()}".encode("utf-8")).hexdigest()[:16]
    return f"marine-{digest}"


def _polygon_centroid(polygon: list[tuple[float, float]]) -> tuple[float, float]:
    longitude = sum(point[0] for point in polygon) / len(polygon)
    latitude = sum(point[1] for point in polygon) / len(polygon)
    return round(longitude, 6), round(latitude, 6)


def _polygon_area(polygon: list[tuple[float, float]]) -> float:
    return abs(
        sum(
            longitude_a * latitude_b - longitude_b * latitude_a
            for (longitude_a, latitude_a), (longitude_b, latitude_b) in zip(
                polygon, polygon[1:] + polygon[:1]
            )
        )
    ) / 2


def _point_in_polygon(longitude: float, latitude: float, polygon: list[tuple[float, float]]) -> bool:
    inside = False
    previous = polygon[-1]
    for current in polygon:
        x1, y1 = previous
        x2, y2 = current
        if (y1 > latitude) != (y2 > latitude):
            crossing = (x2 - x1) * (latitude - y1) / (y2 - y1) + x1
            if longitude < crossing:
                inside = not inside
        previous = current
    return inside


def _haversine_km(longitude_a: float, latitude_a: float, longitude_b: float, latitude_b: float) -> float:
    phi_a, phi_b = radians(latitude_a), radians(latitude_b)
    delta_phi = radians(latitude_b - latitude_a)
    delta_lambda = radians(longitude_b - longitude_a)
    value = sin(delta_phi / 2) ** 2 + cos(phi_a) * cos(phi_b) * sin(delta_lambda / 2) ** 2
    return 6371.0088 * 2 * asin(min(1.0, sqrt(value)))


def _china_record(area: dict[str, Any]) -> dict[str, Any]:
    polygon = [(float(longitude), float(latitude)) for longitude, latitude in area["polygon"]]
    name = str(area["name"])
    geography = "taiwan_related" if name in TAIWAN_RELATED_NAMES else "china_mainland"
    longitude, latitude = _polygon_centroid(polygon)
    return {
        "id": _stable_id("china", str(area["name_en"])),
        "name": name,
        "name_en": str(area["name_en"]),
        "kind": str(area["place_type"]),
        "parent": str(area["parent"]),
        "geography": geography,
        "priority_weight": 8.0 if geography == "china_mainland" else 6.0,
        "geometry_status": "polygon",
        "center_longitude": longitude,
        "center_latitude": latitude,
        "radius_km": None,
        "polygon": polygon,
        "source": "china_coastal_areas",
        "source_version": "2026.08",
    }


def _atlas_record(entry: dict[str, Any]) -> dict[str, Any]:
    center = entry.get("center") if isinstance(entry.get("center"), dict) else None
    return {
        "id": _stable_id("atlas", str(entry["name_en"])),
        "name": str(entry["name"]),
        "name_en": str(entry["name_en"]),
        "kind": str(entry["place_type"]),
        "parent": str(entry.get("parent_zh") or entry.get("parent") or "海洋"),
        "geography": "global",
        "priority_weight": 1.0,
        "geometry_status": "approximate" if center else "missing",
        "center_longitude": float(center["longitude"]) if center else None,
        "center_latitude": float(center["latitude"]) if center else None,
        "radius_km": float(entry["radius_km"]) if entry.get("radius_km") is not None else None,
        "polygon": None,
        "source": "marine_atlas",
        "source_version": ATLAS_VERSION,
    }


def build_marine_area_catalog() -> tuple[dict[str, Any], ...]:
    china_rows = [_china_record(area) for area in (*CHINA_COASTAL_AREAS, *CHINA_MARGINAL_SEAS)]
    china_names_en = {row["name_en"].casefold() for row in china_rows}
    atlas_rows = [
        _atlas_record(entry)
        for entry in MARINE_ATLAS
        if str(entry["name_en"]).casefold() not in china_names_en
    ]
    return tuple([*china_rows, *atlas_rows])


MARINE_AREA_CATALOG = build_marine_area_catalog()


def locate_marine_area(longitude: float, latitude: float) -> dict[str, Any] | None:
    polygon_matches: list[tuple[float, dict[str, Any]]] = []
    approximate_matches: list[tuple[float, float, dict[str, Any]]] = []
    for area in MARINE_AREA_CATALOG:
        polygon = area.get("polygon")
        if polygon and _point_in_polygon(longitude, latitude, polygon):
            polygon_matches.append((_polygon_area(polygon), area))
            continue
        radius_km = area.get("radius_km")
        center_longitude = area.get("center_longitude")
        center_latitude = area.get("center_latitude")
        if radius_km is None or center_longitude is None or center_latitude is None:
            continue
        distance = _haversine_km(longitude, latitude, center_longitude, center_latitude)
        if distance <= radius_km:
            approximate_matches.append((radius_km, distance, area))
    if polygon_matches:
        return dict(min(polygon_matches, key=lambda item: item[0])[1])
    if approximate_matches:
        return dict(min(approximate_matches, key=lambda item: (item[0], item[1]))[2])
    return None


__all__ = ["MARINE_AREA_CATALOG", "TAIWAN_RELATED_NAMES", "build_marine_area_catalog", "locate_marine_area"]
