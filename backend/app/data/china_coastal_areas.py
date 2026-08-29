"""Conservative point-in-polygon names for China's principal coastal waters.

These polygons are geographic naming aids, not baselines, administrative
boundaries, territorial-sea limits, navigation limits, or legal claims.
Smaller named features take precedence over broader marginal seas.
"""

from __future__ import annotations

from typing import Any


SOURCE_NAME = "中国近海地理名称索引"
SOURCE_URL = "https://www.marineregions.org/"
BOUNDARY_NOTE = "地理名称匹配边界，不作为行政、领海、航海或法律边界。"


def _area(name: str, name_en: str, place_type: str, parent: str, coordinates: list[tuple[float, float]]) -> dict[str, Any]:
    return {
        "name": name,
        "name_en": name_en,
        "place_type": place_type,
        "parent": parent,
        "polygon": coordinates,
    }


CHINA_COASTAL_AREAS: tuple[dict[str, Any], ...] = (
    _area("胶州湾", "Jiaozhou Bay", "海湾", "黄海", [(119.95, 35.92), (120.43, 35.92), (120.43, 36.28), (120.04, 36.28)]),
    _area("大连湾", "Dalian Bay", "海湾", "黄海", [(121.35, 38.72), (122.05, 38.72), (122.05, 39.18), (121.35, 39.18)]),
    _area("海州湾", "Haizhou Bay", "海湾", "黄海", [(118.75, 34.38), (120.15, 34.38), (120.15, 35.28), (119.15, 35.28)]),
    _area("辽东湾", "Liaodong Bay", "海湾", "渤海", [(119.45, 39.0), (121.65, 38.85), (122.25, 39.55), (121.95, 40.95), (120.45, 41.2), (119.45, 40.35)]),
    _area("渤海湾", "Bohai Bay", "海湾", "渤海", [(117.25, 37.65), (119.65, 37.55), (119.75, 39.05), (118.65, 39.45), (117.45, 39.05)]),
    _area("莱州湾", "Laizhou Bay", "海湾", "渤海", [(118.35, 36.85), (120.25, 36.65), (120.55, 37.55), (119.35, 38.15), (118.35, 37.75)]),
    _area("渤海海峡", "Bohai Strait", "海峡", "渤海", [(120.45, 37.45), (122.85, 37.45), (122.85, 39.25), (120.45, 39.25)]),
    _area("长江口", "Changjiang Estuary", "河口", "东海", [(121.0, 30.75), (123.15, 30.6), (123.15, 32.05), (121.1, 32.05)]),
    _area("杭州湾", "Hangzhou Bay", "海湾", "东海", [(120.5, 29.75), (121.0, 30.65), (122.3, 30.9), (122.3, 29.7), (121.1, 29.55)]),
    _area("象山港", "Xiangshan Bay", "海湾", "东海", [(121.35, 29.25), (122.0, 29.25), (122.0, 29.85), (121.35, 29.85)]),
    _area("三门湾", "Sanmen Bay", "海湾", "东海", [(121.25, 28.82), (121.95, 28.82), (121.95, 29.35), (121.25, 29.35)]),
    _area("乐清湾", "Yueqing Bay", "海湾", "东海", [(120.75, 27.82), (121.45, 27.82), (121.45, 28.55), (120.75, 28.55)]),
    _area("温州湾", "Wenzhou Bay", "海湾", "东海", [(120.62, 27.3), (121.58, 27.3), (121.58, 28.12), (120.62, 28.12)]),
    _area("海坛海峡", "Haitan Strait", "海峡", "中国台湾海峡", [(119.05, 25.25), (119.75, 25.25), (119.75, 26.2), (119.05, 26.2)]),
    _area("湄洲湾", "Meizhou Bay", "海湾", "中国台湾海峡", [(118.7, 24.72), (119.3, 24.72), (119.3, 25.35), (118.7, 25.35)]),
    _area("泉州湾", "Quanzhou Bay", "海湾", "中国台湾海峡", [(118.42, 24.62), (119.0, 24.62), (119.0, 25.12), (118.42, 25.12)]),
    _area("厦门湾", "Xiamen Bay", "海湾", "中国台湾海峡", [(117.82, 24.22), (118.5, 24.22), (118.5, 24.78), (117.82, 24.78)]),
    _area("东山湾", "Dongshan Bay", "海湾", "中国台湾海峡", [(117.18, 23.5), (117.82, 23.5), (117.82, 24.08), (117.18, 24.08)]),
    _area("柘林湾", "Zhelin Bay", "海湾", "南海", [(116.72, 23.42), (117.18, 23.42), (117.18, 23.82), (116.72, 23.82)]),
    _area("汕头湾", "Shantou Bay", "海湾", "南海", [(116.5, 23.08), (117.05, 23.08), (117.05, 23.58), (116.5, 23.58)]),
    _area("大鹏湾", "Mirs Bay", "海湾", "南海", [(114.12, 22.32), (114.68, 22.32), (114.68, 22.78), (114.12, 22.78)]),
    _area("大亚湾", "Daya Bay", "海湾", "南海", [(114.25, 22.3), (115.02, 22.3), (115.02, 22.95), (114.25, 22.95)]),
    _area("红海湾", "Red Bay", "海湾", "南海", [(114.65, 22.3), (116.05, 22.3), (116.05, 23.05), (114.65, 23.05)]),
    _area("珠江口", "Pearl River Estuary", "河口", "南海", [(112.75, 21.62), (114.72, 21.62), (114.72, 22.85), (113.78, 22.85), (113.05, 22.5)]),
    _area("雷州湾", "Leizhou Bay", "海湾", "南海", [(109.15, 20.38), (110.72, 20.38), (110.72, 21.48), (109.15, 21.48)]),
    _area("琼州海峡", "Qiongzhou Strait", "海峡", "南海", [(109.2, 19.62), (111.42, 19.62), (111.42, 20.55), (109.2, 20.55)]),
    _area("钦州湾", "Qinzhou Bay", "海湾", "北部湾", [(108.25, 21.25), (109.18, 21.25), (109.18, 22.12), (108.25, 22.12)]),
    _area("廉州湾", "Lianzhou Bay", "海湾", "北部湾", [(108.75, 21.15), (109.82, 21.15), (109.82, 21.85), (108.75, 21.85)]),
    _area("铁山港湾", "Tieshan Bay", "海湾", "北部湾", [(109.38, 21.32), (110.2, 21.32), (110.2, 22.05), (109.38, 22.05)]),
    _area("北部湾", "Gulf of Tonkin", "海湾", "南海", [(105.5, 17.0), (110.65, 17.0), (110.65, 20.55), (109.9, 21.75), (107.35, 22.0), (105.5, 21.25)]),
    _area("澎湖水道", "Penghu Channel", "水道", "中国台湾海峡", [(118.95, 22.35), (120.05, 22.35), (120.05, 23.85), (118.95, 23.85)]),
    _area("中国台湾海峡", "Taiwan Strait", "海峡", "东海与南海", [(116.9, 22.45), (117.75, 25.95), (119.8, 26.6), (122.15, 25.45), (121.65, 22.0), (119.0, 21.35)]),
    _area("巴士海峡", "Bashi Channel", "海峡", "南海与菲律宾海", [(120.0, 20.2), (122.65, 20.2), (122.65, 22.3), (120.0, 22.3)]),
    _area("中国台湾东北部海域", "Northeastern Taiwan Waters", "近海", "东海", [(121.25, 24.45), (123.4, 24.45), (123.4, 26.6), (121.25, 26.6)]),
    _area("中国台湾东部海域", "Eastern Taiwan Waters", "近海", "菲律宾海", [(121.0, 21.85), (123.35, 21.85), (123.35, 24.8), (121.0, 24.8)]),
    _area("中国台湾南部海域", "Southern Taiwan Waters", "近海", "巴士海峡", [(119.7, 20.35), (122.5, 20.35), (122.5, 22.45), (119.7, 22.45)]),
    _area("北黄海", "Northern Yellow Sea", "近海", "黄海", [(120.45, 37.0), (126.0, 37.0), (126.0, 41.0), (120.45, 41.0)]),
    _area("南黄海", "Southern Yellow Sea", "近海", "黄海", [(118.7, 31.0), (126.0, 31.0), (126.0, 37.0), (118.7, 37.0)]),
    _area("浙江近海", "Zhejiang Coastal Waters", "近海", "东海", [(120.2, 27.0), (124.0, 27.0), (124.0, 31.2), (120.2, 31.2)]),
    _area("福建近海", "Fujian Coastal Waters", "近海", "东海与南海", [(116.8, 22.8), (121.5, 22.8), (121.5, 27.4), (116.8, 27.4)]),
    _area("粤东近海", "Eastern Guangdong Coastal Waters", "近海", "南海", [(114.2, 21.0), (118.0, 21.0), (118.0, 24.0), (114.2, 24.0)]),
    _area("粤西近海", "Western Guangdong Coastal Waters", "近海", "南海", [(109.8, 18.8), (113.3, 18.8), (113.3, 22.2), (109.8, 22.2)]),
    _area("海南岛东部近海", "Eastern Hainan Coastal Waters", "近海", "南海", [(110.0, 17.3), (112.8, 17.3), (112.8, 20.4), (110.0, 20.4)]),
)

CHINA_MARINE_BAIKE_NAMES = frozenset(
    {str(area["name"]) for area in CHINA_COASTAL_AREAS}
    | {"渤海", "黄海", "东海", "南海", "中国台湾海峡", "北部湾"}
)

CHINA_MARGINAL_SEAS: tuple[dict[str, Any], ...] = (
    _area("渤海", "Bohai Sea", "海", "西北太平洋", [(117.0, 36.9), (123.0, 36.9), (123.0, 41.5), (117.0, 41.5)]),
    _area("黄海", "Yellow Sea", "海", "西北太平洋", [(118.0, 30.3), (126.8, 30.3), (126.8, 41.2), (123.0, 41.2), (123.0, 37.0), (118.0, 37.0)]),
    _area("东海", "East China Sea", "海", "西北太平洋", [(116.8, 22.5), (132.0, 22.5), (132.0, 34.2), (126.5, 34.2), (126.5, 30.3), (118.0, 30.3)]),
    _area("南海", "South China Sea", "海", "西北太平洋", [(102.5, -0.5), (125.5, -0.5), (125.5, 23.0), (121.5, 23.0), (119.0, 21.3), (116.8, 22.5), (110.0, 22.5), (102.5, 22.5)]),
)


def _point_in_polygon(longitude: float, latitude: float, polygon: list[tuple[float, float]]) -> bool:
    inside = False
    previous = polygon[-1]
    for current in polygon:
        x1, y1 = previous
        x2, y2 = current
        if (y1 > latitude) != (y2 > latitude):
            crossing_longitude = (x2 - x1) * (latitude - y1) / (y2 - y1) + x1
            if longitude < crossing_longitude:
                inside = not inside
        previous = current
    return inside


def _polygon_area(polygon: list[tuple[float, float]]) -> float:
    return abs(sum(
        longitude_a * latitude_b - longitude_b * latitude_a
        for (longitude_a, latitude_a), (longitude_b, latitude_b) in zip(polygon, polygon[1:] + polygon[:1])
    )) / 2


def lookup_china_coastal_area(longitude: float, latitude: float) -> dict[str, Any] | None:
    matches = [area for area in CHINA_COASTAL_AREAS if _point_in_polygon(longitude, latitude, area["polygon"])]
    if not matches:
        return None
    selected = min(matches, key=lambda area: _polygon_area(area["polygon"]))
    return {
        key: value
        for key, value in selected.items()
        if key != "polygon"
    } | {
        "confidence": "high",
        "source": SOURCE_NAME,
        "source_url": SOURCE_URL,
        "boundary_note": BOUNDARY_NOTE,
    }


def lookup_china_marine_area(longitude: float, latitude: float) -> dict[str, Any] | None:
    coastal_area = lookup_china_coastal_area(longitude, latitude)
    if coastal_area:
        return coastal_area
    for sea in CHINA_MARGINAL_SEAS:
        if _point_in_polygon(longitude, latitude, sea["polygon"]):
            return {
                key: value
                for key, value in sea.items()
                if key != "polygon"
            } | {
                "confidence": "high",
                "source": SOURCE_NAME,
                "source_url": SOURCE_URL,
                "boundary_note": BOUNDARY_NOTE,
            }
    return None
