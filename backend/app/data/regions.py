from __future__ import annotations

from typing import Any


REGIONS: dict[str, dict[str, Any]] = {
    "northwest_pacific": {
        "id": "northwest_pacific",
        "name": "中国近海及西北太平洋",
        "short_name": "西北太平洋",
        "description": "覆盖中国近海、黑潮延伸体、日本海及西北太平洋副热带海域。",
        "bounds": ((100.0, 0.0), (179.0, 60.0)),
        "center": (137.0, 30.0),
        "zoom": 2.25,
    },
    "south_china_sea": {
        "id": "south_china_sea",
        "name": "南海及邻近海域",
        "short_name": "南海",
        "description": "覆盖南海、吕宋海峡、北部湾和巽他陆架北部。",
        "bounds": ((103.0, 0.0), (125.0, 25.0)),
        "center": (114.0, 13.0),
        "zoom": 3.55,
    },
    "indian_ocean": {
        "id": "indian_ocean",
        "name": "印度洋",
        "short_name": "印度洋",
        "description": "覆盖阿拉伯海、孟加拉湾、赤道印度洋和南印度洋。",
        "bounds": ((20.0, -60.0), (120.0, 30.0)),
        "center": (72.0, -12.0),
        "zoom": 1.8,
    },
    "north_atlantic": {
        "id": "north_atlantic",
        "name": "北大西洋",
        "short_name": "北大西洋",
        "description": "覆盖湾流、北大西洋副热带环流和亚极地海域。",
        "bounds": ((-80.0, 0.0), (20.0, 70.0)),
        "center": (-31.0, 35.0),
        "zoom": 1.8,
    },
    "south_pacific": {
        "id": "south_pacific",
        "name": "南太平洋",
        "short_name": "南太平洋",
        "description": "覆盖南太平洋副热带环流、珊瑚海和东太平洋南部。",
        "bounds": ((-179.0, -60.0), (-70.0, 10.0)),
        "center": (-124.0, -25.0),
        "zoom": 1.7,
    },
    "mediterranean": {
        "id": "mediterranean",
        "name": "地中海",
        "short_name": "地中海",
        "description": "覆盖西地中海、亚得里亚海、爱琴海及东地中海。",
        "bounds": ((-6.0, 30.0), (37.0, 47.0)),
        "center": (16.0, 38.5),
        "zoom": 3.25,
    },
    "global_ocean": {
        "id": "global_ocean",
        "name": "全球",
        "short_name": "全球海洋",
        "description": "覆盖南北纬 70 度之间的全球主要海洋，统一接入 Argo 活动网络与 NOAA 海温格点。",
        "bounds": ((-179.0, -70.0), (179.0, 70.0)),
        "center": (10.0, 0.0),
        "zoom": 1.15,
    },
}


DEFAULT_REGION_ID = "global_ocean"


def get_region(region_id: str) -> dict[str, Any]:
    return REGIONS.get(region_id, REGIONS[DEFAULT_REGION_ID])


def region_for_point(longitude: float, latitude: float) -> dict[str, Any]:
    for region in REGIONS.values():
        (west, south), (east, north) = region["bounds"]
        if west <= longitude <= east and south <= latitude <= north:
            return region
    return REGIONS[DEFAULT_REGION_ID]
