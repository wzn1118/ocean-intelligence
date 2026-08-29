from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MAP_DIR = ROOT / "frontend" / "public" / "maps"


def _coordinates(geometry):
    if geometry["type"] == "Point":
        yield geometry["coordinates"]
        return
    for item in geometry["coordinates"]:
        if geometry["type"] == "LineString" and item and isinstance(item[0], (int, float)):
            yield item
        else:
            yield from _coordinates({"type": "LineString", "coordinates": item})


def test_world_reference_covers_global_land_without_duplicate_mainland_context() -> None:
    payload = json.loads((MAP_DIR / "world-reference.geojson").read_text(encoding="utf-8"))

    assert payload["metadata"]["source"].startswith("Natural Earth 1:110m")
    assert payload["metadata"]["version"] == "5.1.1"
    assert len(payload["features"]) >= 170
    assert all(feature["properties"]["isoA3"] not in {"CHN", "TWN"} for feature in payload["features"])
    assert all(feature["properties"]["nameZh"] for feature in payload["features"])
    assert all(
        isinstance(feature["properties"]["labelLongitude"], (int, float))
        and isinstance(feature["properties"]["labelLatitude"], (int, float))
        for feature in payload["features"]
    )

    points = [point for feature in payload["features"] for point in _coordinates(feature["geometry"])]
    longitudes = [point[0] for point in points]
    latitudes = [point[1] for point in points]
    assert min(longitudes) <= -179
    assert max(longitudes) >= 179
    assert min(latitudes) <= -55
    assert max(latitudes) >= 80


def test_official_china_layer_keeps_taiwan_province_in_same_province_collection() -> None:
    payload = json.loads((MAP_DIR / "china-reference.geojson").read_text(encoding="utf-8"))
    provinces = [feature for feature in payload["features"] if feature["properties"].get("category") == "china-province"]
    labels = [feature for feature in payload["features"] if feature["properties"].get("category") == "province-label"]

    assert len(provinces) == 34
    assert any(feature["properties"].get("name") == "台湾省" for feature in labels)
    assert any(
        feature["geometry"]["type"] == "Polygon"
        and 120 < feature["geometry"]["coordinates"][0][0][0] < 122
        for feature in provinces
    )
    assert any(
        120 < feature["geometry"]["coordinates"][0] < 122
        and 21 < feature["geometry"]["coordinates"][1] < 26
        for feature in labels
    )


def test_frontend_fallback_translation_uses_china_taiwan_strait() -> None:
    source = (ROOT / "frontend" / "src" / "components" / "OceanMap.tsx").read_text(encoding="utf-8")

    assert '"taiwan strait": "\\u4e2d\\u56fd\\u53f0\\u6e7e\\u6d77\\u5ce1"' in source
    assert '"巴勒斯坦": "巴勒斯坦国"' in source
    assert '"索马里兰": "索马里兰地区"' in source
    assert '"科索沃": "科索沃地区"' in source
