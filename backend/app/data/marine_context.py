"""Point-level marine names and fisheries context.

Marine Regions supplies standardized marine place names. OBIS supplies open
marine occurrence records that are useful for explaining which fishery-related
taxonomic groups have been observed near a clicked point. Occurrence evidence
is deliberately labelled as distribution evidence, not live catch biomass.
"""

from __future__ import annotations

import csv
import json
import math
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.data.chinese_text import normalize_text_fields
from app.data.china_coastal_areas import lookup_china_coastal_area
from app.data.marine_atlas import ATLAS_SOURCE_URL, atlas_entry, lookup_marine_atlas


MARINE_REGIONS_URL = "https://www.marineregions.org/rest/getGazetteerRecordsByLatLong.json"
OBIS_URL = "https://api.obis.org/occurrence"
WORMS_URL = "https://www.marinespecies.org/rest"
ASFIS_SOURCE_URL = "https://www.fao.org/fishery/static/ASFIS/ASFIS_sp_2026.1.zip"
ASFIS_VERSION = "2026.1"
WIKIDATA_SOURCE_NAME = "Wikidata P225 中文分类标签"
FISHERY_SEARCH_RADIUS_KM = 100.0
OBIS_PAGE_SIZE = 1000
OBIS_MAX_RECORDS = 3000
FISHERY_RESOURCE_LIMIT = 80
WORMS_VERNACULAR_LOOKUP_LIMIT = 16
CONTEXT_CACHE_TTL_SECONDS = 3600.0
CONTEXT_CACHE_MAX_ENTRIES = 256
_cache: dict[str, tuple[float, dict[str, object]]] = {}
_cache_lock = threading.Lock()


def _http_json(url: str, timeout: float = 7.0) -> object:
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "ocean-intelligence-agent/1.0"})
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _number(value: object) -> float | None:
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _cache_key(longitude: float, latitude: float) -> str:
    # Names and nearby biodiversity are not point-metre precision products.
    return f"{round(longitude, 2):.2f}:{round(latitude, 2):.2f}"


def _fallback_sea(longitude: float, latitude: float) -> dict[str, object]:
    """Return a deterministic educational fallback when the gazetteer times out."""
    coastal_match = lookup_china_coastal_area(longitude, latitude)
    if coastal_match:
        return coastal_match
    atlas_match = lookup_marine_atlas(longitude, latitude)
    if atlas_match:
        return {
            "name": atlas_match["name"],
            "name_en": atlas_match["name_en"],
            "place_type": atlas_match["place_type"],
            "confidence": atlas_match.get("confidence", "medium"),
            "source": "内置全球海域图录",
            "source_url": ATLAS_SOURCE_URL,
            "distance_km": atlas_match.get("distance_km"),
        }
    rules = [
        ("渤海", "Bohai Sea", ((117, 37), (123, 42))),
        ("黄海", "Yellow Sea", ((118, 31), (127, 41))),
        ("中国台湾海峡", "Taiwan Strait", ((117, 21), (122, 26))),
        ("东海", "East China Sea", ((117, 23), (132, 34))),
        ("泰国湾", "Gulf of Thailand", ((99, 5), (105, 15))),
        ("北部湾", "Gulf of Tonkin", ((103, 16), (110, 23))),
        ("中国台湾海峡", "Taiwan Strait", ((117, 21), (122, 26))),
        ("吕宋海峡", "Luzon Strait", ((120, 17), (125, 19.5))),
        ("南海", "South China Sea", ((103, 0), (125, 25))),
        ("日本海", "Sea of Japan", ((127, 30), (146, 53))),
        ("菲律宾海", "Philippine Sea", ((126, 4), (165, 35))),
        ("孟加拉湾", "Bay of Bengal", ((78, 5), (100, 23))),
        ("阿拉伯海", "Arabian Sea", ((50, 5), (78, 30))),
        ("地中海", "Mediterranean Sea", ((-7, 30), (37, 47))),
        ("\u58a8\u897f\u54e5\u6e7e", "Gulf of Mexico", ((-98, 18), (-80, 31))),
        ("加勒比海", "Caribbean Sea", ((-90, 9), (-60, 25))),
        ("珊瑚海", "Coral Sea", ((142, -30), (175, -10))),
        ("塔斯曼海", "Tasman Sea", ((145, -50), (180, -25))),
        ("北海", "North Sea", ((-5, 50), (10, 62))),
        ("挪威海", "Norwegian Sea", ((-10, 60), (15, 72))),
        ("白令海", "Bering Sea", ((-180, 50), (-155, 72))),
    ]
    for name, name_en, ((west, south), (east, north)) in rules:
        if west <= longitude <= east and south <= latitude <= north:
            return {"name": name, "name_en": name_en, "place_type": "海域", "confidence": "medium"}
    if latitude >= 66:
        name, name_en = "北冰洋", "Arctic Ocean"
    elif latitude <= -60:
        name, name_en = "南大洋", "Southern Ocean"
    elif longitude < -30:
        name, name_en = "大西洋", "Atlantic Ocean"
    elif longitude < 60:
        name, name_en = "印度洋", "Indian Ocean"
    else:
        name, name_en = "太平洋", "Pacific Ocean"
    return {"name": name, "name_en": name_en, "place_type": "洋区", "confidence": "low"}


def _place_name_zh(name: str) -> str:
    """Translate common Marine Regions English labels for the Chinese UI."""
    exact_atlas = atlas_entry(name)
    if exact_atlas is not None:
        return str(exact_atlas["name"])
    exact_names = {
        "Northern South China Sea": "\u5357\u6d77\u5317\u90e8",
        "Southern South China Sea": "\u5357\u6d77\u5357\u90e8",
        "Gulf of Thailand": "\u6cf0\u56fd\u6e7e",
        "Gulf of Tonkin": "\u5317\u90e8\u6e7e",
        "Taiwan Strait": "\u4e2d\u56fd\u53f0\u6e7e\u6d77\u5ce1",
        "Luzon Strait": "\u5415\u5b8b\u6d77\u5ce1",
        "Sulu Sea": "\u82cf\u7984\u6d77",
        "Celebes Sea": "\u82cf\u62c9\u5a01\u897f\u6d77",
        "Java Sea": "\u722a\u54c7\u6d77",
        "Andaman Sea": "\u5b89\u8fbe\u66fc\u6d77",
        "Gulf of Mexico": "\u58a8\u897f\u54e5\u6e7e",
        "Mexico Gulf": "\u58a8\u897f\u54e5\u6e7e",
        "Gulf of America": "\u58a8\u897f\u54e5\u6e7e",
        "Bo Hai": "\u6e24\u6d77",
        "Bo Hai Sea": "\u6e24\u6d77",
    }
    if name in exact_names:
        return exact_names[name]
    replacements = (
        ("South China Sea", "南海"),
        ("East China Sea", "东海"),
        ("Yellow Sea", "黄海"),
        ("Bohai", "渤海"),
        ("Sea of Japan", "日本海"),
        ("Philippine Sea", "菲律宾海"),
        ("Bay of Bengal", "孟加拉湾"),
        ("Arabian Sea", "阿拉伯海"),
        ("Mediterranean Sea", "地中海"),
        ("Coral Sea", "珊瑚海"),
        ("Tasman Sea", "塔斯曼海"),
        ("North Sea", "北海"),
        ("Norwegian Sea", "挪威海"),
        ("Bering Sea", "白令海"),
        ("Pacific Ocean", "太平洋"),
        ("Atlantic Ocean", "大西洋"),
        ("Indian Ocean", "印度洋"),
        ("Arctic Ocean", "北冰洋"),
        ("Southern Ocean", "南大洋"),
    )
    translated = name
    translated = translated.replace("Philippines part of the South China Sea", "南海东南部")
    translated = translated.replace("Philippine part of the South China Sea", "南海东南部")
    translated = translated.replace("China part of the ", "中国海域的一部分")
    for english, chinese in replacements:
        translated = translated.replace(english, chinese)
    return translated


def _fao_area(longitude: float, latitude: float) -> dict[str, object]:
    """Approximate FAO Major Fishing Area for education and source navigation."""
    if latitude >= 66:
        return {"code": "18", "name": "北冰洋", "name_en": "Arctic Sea", "source_url": "https://www.fao.org/fishery/en/area/18"}
    if latitude <= -60:
        return {"code": "88", "name": "南太平洋南极区", "name_en": "Antarctic Pacific", "source_url": "https://www.fao.org/fishery/en/area/88"}
    if 100 <= longitude <= 180 and 0 <= latitude <= 62:
        return {"code": "61", "name": "西北太平洋", "name_en": "Pacific, Northwest", "source_url": "https://www.fao.org/fishery/en/area/61"}
    if 100 <= longitude <= 180 and -60 <= latitude < 0:
        return {"code": "81", "name": "西南太平洋", "name_en": "Pacific, Southwest", "source_url": "https://www.fao.org/fishery/en/area/81"}
    if 20 <= longitude < 100 and latitude >= 0:
        return {"code": "51", "name": "西印度洋", "name_en": "Indian Ocean, Western", "source_url": "https://www.fao.org/fishery/en/area/51"}
    if 20 <= longitude < 100 and latitude < 0:
        return {"code": "57", "name": "东印度洋", "name_en": "Indian Ocean, Eastern", "source_url": "https://www.fao.org/fishery/en/area/57"}
    if -100 <= longitude < -30 and latitude >= 0:
        return {"code": "31", "name": "中西大西洋", "name_en": "Atlantic, Western Central", "source_url": "https://www.fao.org/fishery/en/area/31"}
    if longitude < -30 and latitude < 0:
        return {"code": "41", "name": "西南大西洋", "name_en": "Atlantic, Southwest", "source_url": "https://www.fao.org/fishery/en/area/41"}
    if -30 <= longitude < 60 and latitude >= 30:
        return {"code": "27", "name": "东北大西洋", "name_en": "Atlantic, Northeast", "source_url": "https://www.fao.org/fishery/en/area/27"}
    if -30 <= longitude < 60:
        return {"code": "34", "name": "东中大西洋", "name_en": "Atlantic, Eastern Central", "source_url": "https://www.fao.org/fishery/en/area/34"}
    return {"code": "77", "name": "东中太平洋", "name_en": "Pacific, Eastern Central", "source_url": "https://www.fao.org/fishery/en/area/77"}


_SEA_NAME_ZH: tuple[tuple[str, str], ...] = (
    ("Philippines part of the South China Sea", "南海东南部"),
    ("Philippine part of the South China Sea", "南海东南部"),
    ("South China Sea", "南海"),
    ("East China Sea", "东海"),
    ("Yellow Sea", "黄海"),
    ("Bo Hai Sea", "渤海"),
    ("Bo Hai", "渤海"),
    ("Bohai Sea", "渤海"),
    ("Bohai", "渤海"),
    ("Sea of Japan", "日本海"),
    ("Philippine Sea", "菲律宾海"),
    ("Bay of Bengal", "孟加拉湾"),
    ("Arabian Sea", "阿拉伯海"),
    ("Mediterranean Sea", "地中海"),
    ("Coral Sea", "珊瑚海"),
    ("Tasman Sea", "塔斯曼海"),
    ("North Sea", "北海"),
    ("Norwegian Sea", "挪威海"),
    ("Bering Sea", "白令海"),
    ("Pacific Ocean", "太平洋"),
    ("Atlantic Ocean", "大西洋"),
    ("Indian Ocean", "印度洋"),
    ("Arctic Ocean", "北冰洋"),
    ("Southern Ocean", "南大洋"),
)


def _sea_name_zh(name_en: str) -> str:
    exact_atlas = atlas_entry(name_en)
    if exact_atlas is not None:
        return str(exact_atlas["name"])
    for english, chinese in _SEA_NAME_ZH:
        if english.lower() in name_en.lower():
            return chinese
    return "海洋区域"


def _place_type_zh(value: object) -> str:
    text = str(value or "").strip()
    if any(token in text for token in ("海域", "洋区", "海湾", "海峡", "海洋", "河口", "水道", "近海", "峡湾")):
        return text
    normalized = text.lower()
    if "ecoregion" in normalized:
        return "海洋生态区"
    if "province" in normalized:
        return "海洋省"
    if "basin" in normalized:
        return "海盆"
    if "bay" in normalized or "gulf" in normalized:
        return "海湾"
    if "strait" in normalized:
        return "海峡"
    if "estuary" in normalized:
        return "河口"
    if "channel" in normalized or "passage" in normalized:
        return "水道"
    return "海域"


def _normalize_place(place: dict[str, object]) -> dict[str, object]:
    name_en = str(place.get("name_en") or place.get("name") or "")
    normalized = dict(place)
    existing_name = str(place.get("name") or "").strip()
    translated = _sea_name_zh(name_en)
    normalized["name"] = existing_name if existing_name and existing_name != name_en else (
        name_en if translated == "\u6d77\u6d0b\u533a\u57df" and re.search(r"\b(sea|ocean|bay|gulf|strait)\b", name_en, re.I) else translated
    )
    normalized["place_type_en"] = str(place.get("place_type") or "")
    normalized["place_type"] = _place_type_zh(place.get("place_type"))
    return normalized


def _normalize_fao_area(area: dict[str, object]) -> dict[str, object]:
    normalized = dict(area)
    fao_names = {
        "Pacific, Northwest": "\u897f\u5317\u592a\u5e73\u6d0b",
        "Pacific, Southwest": "\u897f\u5357\u592a\u5e73\u6d0b",
        "Indian Ocean, Western": "\u897f\u5370\u5ea6\u6d0b",
        "Indian Ocean, Eastern": "\u4e1c\u5370\u5ea6\u6d0b",
        "Atlantic, Western Central": "\u4e2d\u897f\u5927\u897f\u6d0b",
        "Atlantic, Southwest": "\u897f\u5357\u5927\u897f\u6d0b",
        "Atlantic, Northeast": "\u4e1c\u5317\u5927\u897f\u6d0b",
        "Atlantic, Eastern Central": "\u4e1c\u4e2d\u5927\u897f\u6d0b",
        "Pacific, Eastern Central": "\u4e1c\u4e2d\u592a\u5e73\u6d0b",
        "Arctic Sea": "\u5317\u51b0\u6d0b",
        "Antarctic Pacific": "\u5357\u592a\u5e73\u6d0b\u5357\u6781\u533a",
    }
    name_en = str(area.get("name_en") or area.get("name") or "")
    normalized["name"] = fao_names.get(name_en, _sea_name_zh(name_en))
    return normalized


_CLEAN_SEA_NAME_ZH: tuple[tuple[str, str], ...] = (
    ("Philippines part of the South China Sea", "\u5357\u6d77\u4e1c\u5357\u90e8"),
    ("Philippine part of the South China Sea", "\u5357\u6d77\u4e1c\u5357\u90e8"),
    ("South China Sea", "\u5357\u6d77"),
    ("East China Sea", "\u4e1c\u6d77"),
    ("Yellow Sea", "\u9ec4\u6d77"),
    ("Bo Hai Sea", "\u6e24\u6d77"),
    ("Bo Hai", "\u6e24\u6d77"),
    ("Bohai Sea", "\u6e24\u6d77"),
    ("Bohai", "\u6e24\u6d77"),
    ("Sea of Japan", "\u65e5\u672c\u6d77"),
    ("Philippine Sea", "\u83f2\u5f8b\u5bbe\u6d77"),
    ("Bay of Bengal", "\u5b5f\u52a0\u62c9\u6e7e"),
    ("Arabian Sea", "\u963f\u62c9\u4f2f\u6d77"),
    ("Mediterranean Sea", "\u5730\u4e2d\u6d77"),
    ("Coral Sea", "\u73ca\u745a\u6d77"),
    ("Tasman Sea", "\u5854\u65af\u66fc\u6d77"),
    ("North Sea", "\u5317\u6d77"),
    ("Norwegian Sea", "\u632a\u5a01\u6d77"),
    ("Bering Sea", "\u767d\u4ee4\u6d77"),
    ("Gulf of Mexico", "\u58a8\u897f\u54e5\u6e7e"),
    ("Mexico Gulf", "\u58a8\u897f\u54e5\u6e7e"),
    ("Gulf of America", "\u58a8\u897f\u54e5\u6e7e"),
    ("Pacific Ocean", "\u592a\u5e73\u6d0b"),
    ("Atlantic Ocean", "\u5927\u897f\u6d0b"),
    ("Indian Ocean", "\u5370\u5ea6\u6d0b"),
    ("Arctic Ocean", "\u5317\u51b0\u6d0b"),
    ("Southern Ocean", "\u5357\u5927\u6d0b"),
)


def _sea_name_zh(name_en: str) -> str:
    exact_atlas = atlas_entry(name_en)
    if exact_atlas is not None:
        return str(exact_atlas["name"])
    for english, chinese in _CLEAN_SEA_NAME_ZH:
        if english.lower() in name_en.lower():
            return chinese
    return "\u6d77\u6d0b\u533a\u57df"


def _place_type_zh(value: object) -> str:
    text = str(value or "").strip()
    if any(token in text for token in ("海域", "洋区", "海湾", "海峡", "海洋", "河口", "水道", "近海", "峡湾")):
        return text
    normalized = text.lower()
    if "ecoregion" in normalized:
        return "\u6d77\u6d0b\u751f\u6001\u533a"
    if "province" in normalized:
        return "\u6d77\u6d0b\u7701"
    if "basin" in normalized:
        return "\u6d77\u76c6"
    if "bay" in normalized or "gulf" in normalized:
        return "海湾"
    if "strait" in normalized:
        return "海峡"
    if "estuary" in normalized:
        return "河口"
    if "channel" in normalized or "passage" in normalized:
        return "水道"
    return "海域"


def _normalize_place(place: dict[str, object]) -> dict[str, object]:
    name_en = str(place.get("name_en") or place.get("name") or "")
    normalized = dict(place)
    existing_name = str(place.get("name") or "").strip()
    translated = _sea_name_zh(name_en)
    normalized["name"] = existing_name if existing_name and existing_name != name_en else (
        name_en if translated == "\u6d77\u6d0b\u533a\u57df" and re.search(r"\b(sea|ocean|bay|gulf|strait)\b", name_en, re.I) else translated
    )
    normalized["place_type_en"] = str(place.get("place_type") or "")
    normalized["place_type"] = _place_type_zh(place.get("place_type"))
    return normalized


def _normalize_fao_area(area: dict[str, object]) -> dict[str, object]:
    normalized = dict(area)
    fao_names = {
        "Pacific, Northwest": "\u897f\u5317\u592a\u5e73\u6d0b",
        "Pacific, Southwest": "\u897f\u5357\u592a\u5e73\u6d0b",
        "Indian Ocean, Western": "\u897f\u5370\u5ea6\u6d0b",
        "Indian Ocean, Eastern": "\u4e1c\u5370\u5ea6\u6d0b",
        "Atlantic, Western Central": "\u4e2d\u897f\u5927\u897f\u6d0b",
        "Atlantic, Southwest": "\u897f\u5357\u5927\u897f\u6d0b",
        "Atlantic, Northeast": "\u4e1c\u5317\u5927\u897f\u6d0b",
        "Atlantic, Eastern Central": "\u4e1c\u4e2d\u5927\u897f\u6d0b",
        "Pacific, Eastern Central": "\u4e1c\u4e2d\u592a\u5e73\u6d0b",
        "Arctic Sea": "\u5317\u51b0\u6d0b",
        "Antarctic Pacific": "\u5357\u592a\u5e73\u6d0b\u5357\u6781\u533a",
    }
    name_en = str(area.get("name_en") or area.get("name") or "")
    normalized["name"] = fao_names.get(name_en, _sea_name_zh(name_en))
    return normalized


def _place_is_specific(place: dict[str, object]) -> bool:
    """Reject marine-region codes and generic labels as the primary sea name."""
    name_en = str(place.get("name_en") or place.get("name") or "").strip()
    if not name_en:
        return False
    has_marine_name = bool(re.search(r"\b(sea|ocean|bay|gulf|strait|estuary|channel|passage)\b", name_en, re.I))
    translated_name = _sea_name_zh(name_en)
    if translated_name == "\u6d77\u6d0b\u533a\u57df" and not has_marine_name:
        return False
    if translated_name == "\u6d77\u6d0b\u533a\u57df" and re.fullmatch(r"[A-Za-z0-9 _-]{1,12}", name_en) and not has_marine_name:
        return False
    return True


def _select_primary_place(places: list[dict[str, object]], fallback: dict[str, object]) -> dict[str, object]:
    specific = [place for place in places if _place_is_specific(place)]
    # A local high-confidence strait/bay/fjord is more spatially specific than
    # a broad remote sea polygon returned for the same click.  Keep the remote
    # matches in ``matched_places`` for provenance, but name the point with the
    # narrow feature the offline atlas actually resolved.
    fallback_type = str(fallback.get("place_type") or "")
    if fallback.get("confidence") == "high" and fallback_type in {"海峡", "海湾", "水道", "峡湾", "河口", "近海"}:
        return fallback
    if not specific:
        return fallback

    def score(place: dict[str, object]) -> tuple[int, int]:
        name_en = str(place.get("name_en") or "")
        type_text = str(place.get("place_type_en") or place.get("place_type") or "").lower()
        local_feature = bool(re.search(r"\b(bay|gulf|strait|estuary|channel|passage)\b", name_en, re.I))
        canonical_type_score = 1000 if local_feature else (300 if type_text in {"sea", "gulf", "bay", "strait"} else (220 if "iho sea area" in type_text else 0))
        name_score = 100 if re.search(r"\b(sea|ocean|bay|gulf|strait)\b", name_en, re.I) else 0
        type_score = 25 if any(token in type_text for token in ("sea", "ocean", "bay", "strait", "海域", "海湾", "海峡")) else 0
        fallback_match_score = 0
        fallback_name = str(fallback.get("name") or "")
        fallback_type = str(fallback.get("place_type") or "")
        if (
            fallback.get("confidence") in {"high", "medium"}
            and fallback_name
            and fallback_type not in {"洋区", "ocean"}
            and str(place.get("name") or _sea_name_zh(name_en)) == fallback_name
        ):
            # Some Marine Regions names use historical spellings without a
            # "Sea" suffix, such as "Bo Hai". If that standardized record
            # agrees with the point-resolved atlas, prefer it over a broader
            # overlapping sea polygon.
            fallback_match_score = 500
        return (canonical_type_score + name_score + type_score + fallback_match_score, -len(name_en))

    return max(specific, key=score)


def _region_codes(places: list[dict[str, object]]) -> list[str]:
    """Keep a short set of stable identifiers beside the named sea."""
    identifier_codes: list[str] = []
    for place in places:
        identifier = str(place.get("mrgid") or place.get("MRGID") or place.get("code") or "").strip()
        if identifier and f"MRGID {identifier}" not in identifier_codes:
            identifier_codes.append(f"MRGID {identifier}")
    if identifier_codes:
        return identifier_codes[:4]

    codes: list[str] = []
    for place in places:
        value = str(place.get("name_en") or place.get("name") or "").strip()
        if not value or _place_is_specific(place) or value in codes:
            continue
        codes.append(value)
        if len(codes) >= 4:
            break
    return codes


def _marine_regions(longitude: float, latitude: float) -> tuple[list[dict[str, object]], str | None]:
    url = f"{MARINE_REGIONS_URL}/{latitude:.6f}/{longitude:.6f}/"
    try:
        payload = _http_json(url, timeout=5.0)
    except Exception as exc:  # network outages must not block a map click
        return [], str(exc)
    records = payload if isinstance(payload, list) else (payload.get("records", []) if isinstance(payload, dict) else [])
    places: list[dict[str, object]] = []
    for item in records if isinstance(records, list) else []:
        if not isinstance(item, dict):
            continue
        name = item.get("preferredGazetteerName") or item.get("gazetteerName") or item.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        name_en = name.strip()
        places.append({
            "name": _place_name_zh(name_en),
            "name_en": name_en,
            "mrgid": str(item.get("MRGID") or item.get("mrgid") or "") or None,
            "place_type": str(item.get("placeType") or item.get("placeTypeName") or "海域"),
            "source_url": url,
            "confidence": "high",
        })
    return places, None


@lru_cache(maxsize=1)
def _asfis_index() -> dict[str, dict[str, str]]:
    """Load the official FAO ASFIS list bundled with the service."""
    path = Path(__file__).with_name("asfis_2026_1.csv")
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = csv.DictReader(handle)
        return {
            str(row.get("Scientific_Name") or "").strip().casefold(): {
                str(key).strip(): str(value or "").strip()
                for key, value in row.items()
                if key is not None
            }
            for row in rows
            if str(row.get("Scientific_Name") or "").strip()
        }


@lru_cache(maxsize=1)
def _species_chinese_index() -> dict[str, dict[str, str]]:
    """Load exact scientific-name Chinese labels generated from Wikidata P225."""
    path = Path(__file__).with_name("species_chinese_names.json")
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    entries = payload.get("entries") if isinstance(payload, dict) else None
    if not isinstance(entries, dict):
        return {}
    return {
        str(scientific_name).strip().casefold(): {
            "name": str(item.get("name") or "").strip(),
            "language": str(item.get("language") or "zh").strip(),
            "source_name": str(item.get("source_name") or "").strip(),
            "source_url": str(item.get("source_url") or "").strip(),
            "version": str(payload.get("version") or "").strip(),
        }
        for scientific_name, item in entries.items()
        if isinstance(item, dict)
        and str(scientific_name).strip()
        and str(item.get("name") or "").strip()
    }


def _haversine_km(longitude_a: float, latitude_a: float, longitude_b: float, latitude_b: float) -> float:
    radius_km = 6371.0088
    lat_a, lat_b = math.radians(latitude_a), math.radians(latitude_b)
    delta_lat = lat_b - lat_a
    delta_lon = math.radians(((longitude_b - longitude_a + 180.0) % 360.0) - 180.0)
    value = math.sin(delta_lat / 2.0) ** 2 + math.cos(lat_a) * math.cos(lat_b) * math.sin(delta_lon / 2.0) ** 2
    return radius_km * 2.0 * math.asin(min(1.0, math.sqrt(value)))


def _search_geometry(longitude: float, latitude: float, radius_km: float) -> str:
    """Build a latitude-aware bounding geometry, including antimeridian clicks."""
    lat_delta = radius_km / 111.32
    south = max(-90.0, latitude - lat_delta)
    north = min(90.0, latitude + lat_delta)
    cosine = max(0.01, abs(math.cos(math.radians(latitude))))
    lon_delta = min(180.0, radius_km / (111.32 * cosine))
    west = longitude - lon_delta
    east = longitude + lon_delta

    def polygon(left: float, right: float) -> str:
        return (
            f"(({left:.5f} {south:.5f},{right:.5f} {south:.5f},"
            f"{right:.5f} {north:.5f},{left:.5f} {north:.5f},"
            f"{left:.5f} {south:.5f}))"
        )

    if lon_delta >= 180.0:
        return f"POLYGON{polygon(-180.0, 180.0)}"
    if west < -180.0:
        return f"MULTIPOLYGON({polygon(west + 360.0, 180.0)},{polygon(-180.0, east)})"
    if east > 180.0:
        return f"MULTIPOLYGON({polygon(west, 180.0)},{polygon(-180.0, east - 360.0)})"
    return f"POLYGON{polygon(west, east)}"


def _is_species_occurrence(record: dict[str, object]) -> bool:
    species = str(record.get("species") or "").strip()
    scientific_name = str(record.get("scientificName") or "").strip()
    species_id = _number(record.get("speciesid"))
    longitude = _number(record.get("decimalLongitude"))
    latitude = _number(record.get("decimalLatitude"))
    return bool(
        record.get("marine")
        and not record.get("absence")
        and not record.get("dropped")
        and str(record.get("occurrenceStatus") or "present").lower() != "absent"
        and species
        and scientific_name == species
        and species_id is not None
        and longitude is not None
        and latitude is not None
    )


def _worms_vernaculars(aphia_id: int | None) -> dict[str, str | None]:
    names: dict[str, str | None] = {"chinese": None, "english": None}
    if not aphia_id:
        return names
    try:
        payload = _http_json(f"{WORMS_URL}/AphiaVernacularsByAphiaID/{aphia_id}", timeout=4.0)
    except Exception:
        return names
    for item in payload if isinstance(payload, list) else []:
        if not isinstance(item, dict) or not isinstance(item.get("vernacular"), str):
            continue
        code = str(item.get("language_code") or "").lower()
        language = str(item.get("language") or "").lower()
        if names["chinese"] is None and (code in {"chi", "zho", "zh"} or "chinese" in language):
            names["chinese"] = str(item["vernacular"]).strip()
        if names["english"] is None and (code == "eng" or language == "english"):
            names["english"] = str(item["vernacular"]).strip()
    return names


def _obis_fisheries(longitude: float, latitude: float) -> tuple[list[dict[str, object]], dict[str, object], str | None]:
    geometry = _search_geometry(longitude, latitude, FISHERY_SEARCH_RADIUS_KM)
    fields = ",".join((
        "id", "dataset_id", "marine", "absence", "dropped", "occurrenceStatus",
        "scientificName", "scientificNameAuthorship", "species", "speciesid", "aphiaID",
        "decimalLatitude", "decimalLongitude", "date_year", "year", "class", "order", "family",
    ))
    base_query = {"geometry": geometry, "size": OBIS_PAGE_SIZE, "fields": fields}
    source_url = f"{OBIS_URL}?{urlencode(base_query)}"
    results: list[dict[str, object]] = []
    total = 0
    after: str | None = None
    error: str | None = None

    while len(results) < OBIS_MAX_RECORDS:
        query = dict(base_query)
        if after:
            query["after"] = after
        try:
            payload = _http_json(f"{OBIS_URL}?{urlencode(query)}", timeout=15.0)
        except Exception as exc:
            error = str(exc)
            break
        if not isinstance(payload, dict):
            error = "OBIS returned an unexpected payload"
            break
        total = int(payload.get("total") or total)
        page = [item for item in (payload.get("results") or []) if isinstance(item, dict)]
        results.extend(page)
        if len(page) < OBIS_PAGE_SIZE or len(results) >= total:
            break
        next_after = str(page[-1].get("id") or "") if page else ""
        if not next_after or next_after == after:
            break
        after = next_after

    asfis = _asfis_index()
    chinese_index = _species_chinese_index()
    grouped: dict[str, dict[str, object]] = {}
    for item in results:
        if not _is_species_occurrence(item):
            continue
        record_longitude = _number(item.get("decimalLongitude"))
        record_latitude = _number(item.get("decimalLatitude"))
        if record_longitude is None or record_latitude is None:
            continue
        distance_km = _haversine_km(longitude, latitude, record_longitude, record_latitude)
        if distance_km > FISHERY_SEARCH_RADIUS_KM:
            continue
        scientific_name = str(item.get("species") or "").strip()
        asfis_row = asfis.get(scientific_name.casefold())
        if asfis_row is None:
            continue
        group = grouped.setdefault(scientific_name, {
            "record": item,
            "asfis": asfis_row,
            "count": 0,
            "datasets": set(),
            "first_year": None,
            "latest_year": None,
            "minimum_distance_km": distance_km,
        })
        group["count"] = int(group["count"]) + 1
        dataset_id = str(item.get("dataset_id") or "").strip()
        if dataset_id:
            datasets = group["datasets"]
            if isinstance(datasets, set):
                datasets.add(dataset_id)
        group["minimum_distance_km"] = min(float(group["minimum_distance_km"]), distance_km)
        year = _number(item.get("date_year") or item.get("year"))
        if year is not None:
            year_int = int(year)
            first_year = group["first_year"]
            latest_year = group["latest_year"]
            group["first_year"] = year_int if first_year is None else min(int(first_year), year_int)
            group["latest_year"] = year_int if latest_year is None else max(int(latest_year), year_int)

    ranked = sorted(
        grouped.items(),
        key=lambda pair: (
            not str(pair[1]["asfis"].get("FishStat_Data") or "").upper() == "YES",  # type: ignore[union-attr]
            float(pair[1]["minimum_distance_km"]),
            -int(pair[1]["count"]),
        ),
    )[:FISHERY_RESOURCE_LIMIT]
    vernaculars: dict[str, dict[str, str | None]] = {}
    # ASFIS already contains multilingual names for many taxa. Only spend
    # additional WoRMS requests on the first missing-name records so returning
    # more species does not multiply upstream latency.
    vernacular_candidates = [
        (name, group)
        for name, group in ranked
        if not (
            str(group["asfis"].get("Chinese_name") or "").strip()  # type: ignore[union-attr]
            or str(chinese_index.get(name.casefold(), {}).get("name") or "").strip()
        )
        or not str(group["asfis"].get("English_name") or "").strip()  # type: ignore[union-attr]
    ][:WORMS_VERNACULAR_LOOKUP_LIMIT]
    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = {
            executor.submit(_worms_vernaculars, int(_number(group["record"].get("speciesid")) or 0)): name  # type: ignore[union-attr]
            for name, group in vernacular_candidates
        }
        for future, name in ((future, name) for future, name in futures.items()):
            try:
                vernaculars[name] = future.result()
            except Exception:
                vernaculars[name] = {"chinese": None, "english": None}

    resources: list[dict[str, object]] = []
    for scientific_name, group in ranked:
        record = group["record"]
        asfis_row = group["asfis"]
        if not isinstance(record, dict) or not isinstance(asfis_row, dict):
            continue
        names = vernaculars.get(scientific_name, {})
        indexed_name = chinese_index.get(scientific_name.casefold(), {})
        asfis_chinese_name = str(asfis_row.get("Chinese_name") or "").strip()
        offline_chinese_name = str(indexed_name.get("name") or "").strip()
        worms_chinese_name = str(names.get("chinese") or "").strip()
        chinese_name = asfis_chinese_name or offline_chinese_name or worms_chinese_name or None
        if asfis_chinese_name:
            chinese_name_source = f"FAO ASFIS {ASFIS_VERSION}"
            chinese_name_source_url = ASFIS_SOURCE_URL
        elif offline_chinese_name:
            indexed_source_name = str(indexed_name.get("source_name") or WIKIDATA_SOURCE_NAME).strip()
            chinese_name_source = f"{indexed_source_name} · 快照 {indexed_name.get('version') or '未标注'}"
            chinese_name_source_url = str(indexed_name.get("source_url") or "") or None
        elif worms_chinese_name:
            chinese_name_source = "WoRMS 中文俗名"
            chinese_name_source_url = f"https://www.marinespecies.org/aphia.php?p=taxdetails&id={int(_number(record.get('speciesid')) or 0)}"
        else:
            chinese_name_source = None
            chinese_name_source_url = None
        english_name = str(asfis_row.get("English_name") or names.get("english") or "").strip() or None
        evidence_count = int(group["count"])
        dataset_count = len(group["datasets"]) if isinstance(group["datasets"], set) else 0
        evidence_strength = "high" if evidence_count >= 5 and dataset_count >= 2 else "medium" if evidence_count >= 2 or dataset_count >= 2 else "limited"
        aphia_id = int(_number(record.get("speciesid")) or 0) or None
        fao_fishstat_data = str(asfis_row.get("FishStat_Data") or "").upper() == "YES"
        resources.append({
            "scientific_name": scientific_name,
            "scientific_name_authorship": str(record.get("scientificNameAuthorship") or asfis_row.get("Author") or "").strip() or None,
            "chinese_name": chinese_name,
            "chinese_name_source": chinese_name_source,
            "chinese_name_source_url": chinese_name_source_url,
            "common_name": chinese_name or english_name,
            "english_name": english_name,
            "taxon_rank": "species",
            "taxonomic_status": "accepted",
            "taxon_class": str(record.get("class") or "").strip() or None,
            "taxon_order": str(record.get("order") or asfis_row.get("Order or higher taxa") or "").strip() or None,
            "family": str(record.get("family") or asfis_row.get("Family") or "").strip() or None,
            "taxon_group": str(record.get("class") or asfis_row.get("Order or higher taxa") or "species").strip(),
            "aphia_id": aphia_id,
            "fao_alpha3_code": str(asfis_row.get("Alpha3_Code") or "").strip() or None,
            "fao_isscaap_group": str(asfis_row.get("ISSCAAP_Group") or "").strip() or None,
            "fao_asfis_version": ASFIS_VERSION,
            "fao_fishstat_data": fao_fishstat_data,
            "fishery_relevance": "fao_fishstat" if fao_fishstat_data else "fao_asfis",
            "evidence_count": evidence_count,
            "dataset_count": dataset_count,
            "first_year": group["first_year"],
            "latest_year": group["latest_year"],
            "minimum_distance_km": round(float(group["minimum_distance_km"]), 2),
            "evidence_strength": evidence_strength,
            "evidence_kind": "nearby_observation",
            "source_url": source_url,
            "asfis_source_url": ASFIS_SOURCE_URL,
            "worms_source_url": f"https://www.marinespecies.org/aphia.php?p=taxdetails&id={aphia_id}" if aphia_id else None,
        })

    filtered_records = sum(int(group["count"]) for group in grouped.values())
    stats: dict[str, object] = {
        "biodiversity_total_records": total,
        "scanned_records": min(len(results), OBIS_MAX_RECORDS),
        "results_complete": len(results) >= total,
        "fishery_occurrence_records": filtered_records,
        "fishery_species_count": len(grouped),
        "search_radius_km": FISHERY_SEARCH_RADIUS_KM,
    }
    return resources, stats, error


def get_marine_context(longitude: float, latitude: float, *, force_refresh: bool = False) -> dict[str, object]:
    key = _cache_key(longitude, latitude)
    now = time.monotonic()
    with _cache_lock:
        cached = _cache.get(key)
    if cached and not force_refresh and now - cached[0] < CONTEXT_CACHE_TTL_SECONDS:
        result = dict(cached[1])
        result["cache"] = {"state": "fresh", "age_seconds": round(now - cached[0], 1), "ttl_seconds": CONTEXT_CACHE_TTL_SECONDS}
        return result

    fallback = _fallback_sea(longitude, latitude)
    translated_fallback_name = _sea_name_zh(str(fallback.get("name_en") or fallback.get("name") or ""))
    if translated_fallback_name != "海洋区域" or not fallback.get("name"):
        fallback["name"] = translated_fallback_name
    fallback["place_type"] = _place_type_zh(fallback.get("place_type"))
    with ThreadPoolExecutor(max_workers=2) as executor:
        places_future = executor.submit(_marine_regions, longitude, latitude)
        fisheries_future = executor.submit(_obis_fisheries, longitude, latitude)
        places, place_error = places_future.result()
        resources, fishery_stats, fishery_error = fisheries_future.result()
    places = [_normalize_place(place) for place in places]
    primary = _select_primary_place(places, fallback)
    if primary is not fallback:
        sea_name = primary["name"]
        sea_name_en = primary["name_en"]
        place_type = primary["place_type"]
        confidence = primary["confidence"]
        place_source = "Marine Regions"
    else:
        sea_name = fallback["name"]
        sea_name_en = fallback["name_en"]
        place_type = fallback["place_type"]
        confidence = fallback["confidence"]
        place_source = "本地海域索引"

    if place_source != "Marine Regions":
        place_source = "本地海域索引"
    errors = [item for item in (place_error, fishery_error) if item]
    caveats = [
        "仅展示查询点 100 km 内同时具备 OBIS 物种级出现记录和 FAO ASFIS 渔业统计用途条目的物种；分布记录不等同于实时渔获量、资源丰度、种群量或可捕捞配额。",
        "海域名称优先采用 Marine Regions 标准地名；网络不可用时显示本地分区索引，并在来源状态中标注。",
    ]
    if not resources:
        caveats.append("当前检索没有找到同时满足物种级定位、100 km 球面距离和 FAO ASFIS 名录匹配的记录；这不表示当地没有渔业资源。")
    if not bool(fishery_stats.get("results_complete")):
        caveats.append("该区域 OBIS 记录较多，本次结果达到扫描上限；界面会明确显示已扫描记录数，不把它表述为完整物种清单。")
    fao_area = _normalize_fao_area(_fao_area(longitude, latitude))
    region_codes = _region_codes(places)
    result: dict[str, object] = {
        "query_point": {"longitude": longitude, "latitude": latitude},
        "sea_name": sea_name,
        "sea_name_en": sea_name_en,
        "display_name": sea_name,
        "region_codes": region_codes,
        "region_label": " · ".join(region_codes + ([sea_name] if sea_name else [])),
        "place_type": place_type,
        "place_source": place_source,
        "place_source_url": str(primary.get("source_url") or MARINE_REGIONS_URL),
        "confidence": confidence,
        "matched_places": places[:8],
        "fisheries": resources,
        "fisheries_total_records": int(fishery_stats.get("fishery_occurrence_records") or 0),
        "fisheries_species_count": int(fishery_stats.get("fishery_species_count") or 0),
        "fisheries_scanned_records": int(fishery_stats.get("scanned_records") or 0),
        "biodiversity_total_records": int(fishery_stats.get("biodiversity_total_records") or 0),
        "fisheries_results_complete": bool(fishery_stats.get("results_complete")),
        "fisheries_search_radius_km": float(fishery_stats.get("search_radius_km") or FISHERY_SEARCH_RADIUS_KM),
        "fisheries_radius_degrees": 1.0,
        "fisheries_source": "OBIS + FAO ASFIS + WoRMS",
        "fisheries_source_url": "https://api.obis.org/",
        "fisheries_asfis_version": ASFIS_VERSION,
        "fisheries_asfis_source_url": ASFIS_SOURCE_URL,
        "fao_area": fao_area,
        "fetched_at": datetime.now(UTC).isoformat(),
        "errors": errors,
        "caveats": caveats,
        "cache": {"state": "fresh", "age_seconds": 0.0, "ttl_seconds": CONTEXT_CACHE_TTL_SECONDS},
    }
    result = normalize_text_fields(result)
    with _cache_lock:
        _cache[key] = (time.monotonic(), result)
        if len(_cache) > CONTEXT_CACHE_MAX_ENTRIES:
            oldest = sorted(_cache, key=lambda item: _cache[item][0])[:-CONTEXT_CACHE_MAX_ENTRIES]
            for old_key in oldest:
                _cache.pop(old_key, None)
    return result
