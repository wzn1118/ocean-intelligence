from __future__ import annotations

import os
import threading
import time
from datetime import UTC, datetime
from hashlib import sha1
from typing import Any

import httpx

from app.models import LiteratureReference, LiteratureSearchResponse, OceanEvent


OPENALEX_URL = "https://api.openalex.org/works"
CROSSREF_URL = "https://api.crossref.org/works"
LITERATURE_CACHE_TTL_SECONDS = max(float(os.getenv("LITERATURE_CACHE_TTL_SECONDS", "900")), 60.0)
LITERATURE_RESULT_LIMIT = max(3, min(int(os.getenv("LITERATURE_RESULT_LIMIT", "6")), 12))
LITERATURE_MAILTO = os.getenv("LITERATURE_API_MAILTO", "").strip()

_cache: dict[str, tuple[float, LiteratureSearchResponse]] = {}
_cache_lock = threading.Lock()

REGION_TERMS = {
    "northwest_pacific": "Northwest Pacific China marginal seas Kuroshio",
    "south_china_sea": "South China Sea monsoon oceanography",
    "indian_ocean": "Indian Ocean monsoon oceanography",
    "north_atlantic": "North Atlantic Gulf Stream oceanography",
    "south_pacific": "South Pacific oceanography subtropical gyre",
    "mediterranean": "Mediterranean Sea oceanography",
}

VARIABLE_TERMS = {
    "SST": "sea surface temperature",
    "SALINITY": "ocean salinity",
    "CHLA": "chlorophyll phytoplankton",
    "NITRATE": "ocean nitrate nutrients",
    "PCO2": "ocean carbon dioxide pCO2",
    "DIC": "dissolved inorganic carbon ocean",
    "SLA": "sea level anomaly eddy",
    "CURRENT": "ocean current",
    "SSH_GRADIENT": "sea surface height gradient",
}

TYPE_TERMS = {
    "surface_observation": "sea surface observation",
    "hydrographic_observation": "ocean temperature salinity profile observation",
    "biogeochemical_observation": "biogeochemical ocean profile observation",
    "marine_heatwave": "marine heatwave",
    "cold_anomaly": "ocean temperature anomaly",
    "surface_temperature_anomaly": "sea surface temperature anomaly",
    "salinity_anomaly": "salinity anomaly",
    "phytoplankton_bloom": "phytoplankton bloom",
    "nutrient_anomaly": "ocean nutrient anomaly",
    "carbon_anomaly": "ocean carbon cycle",
    "eddy": "mesoscale eddy",
    "current_anomaly": "ocean circulation anomaly",
}


def build_query(event: OceanEvent) -> str:
    region_term = REGION_TERMS.get(event.region_id, event.region_id.replace("_", " "))
    variable_terms = " ".join(VARIABLE_TERMS.get(variable, variable) for variable in event.variables)
    type_term = "ocean observation" if event.event_kind == "observation" else TYPE_TERMS.get(event.type, "ocean anomaly")
    return " ".join(part for part in (region_term, type_term, variable_terms) if part).strip()


def _year(item: dict[str, Any]) -> int:
    for key in ("publication_year", "year"):
        value = item.get(key)
        if isinstance(value, int) and 1900 <= value <= 2100:
            return value
    for key in ("published-print", "published-online", "published"):
        date_parts = item.get(key, {}).get("date-parts", []) if isinstance(item.get(key), dict) else []
        if date_parts and date_parts[0] and isinstance(date_parts[0][0], int):
            return date_parts[0][0]
    return datetime.now(UTC).year


def _doi(value: str | None) -> str | None:
    if not value:
        return None
    normalized = value.strip()
    if normalized.lower().startswith("https://doi.org/"):
        normalized = normalized[16:]
    if normalized.lower().startswith("http://doi.org/"):
        normalized = normalized[15:]
    return normalized or None


def _authors(authorships: list[dict[str, Any]] | None, authors: list[dict[str, Any]] | None) -> str:
    names: list[str] = []
    for item in (authorships or []):
        author = item.get("author", {})
        if author.get("display_name"):
            names.append(str(author["display_name"]))
    for item in (authors or []):
        name = item.get("family") or item.get("name")
        if name:
            names.append(str(name))
    unique = list(dict.fromkeys(names))
    return ", ".join(unique[:3]) + (" et al." if len(unique) > 3 else "")


def _openalex_reference(item: dict[str, Any], event: OceanEvent, query: str) -> LiteratureReference | None:
    title = str(item.get("title") or "").strip()
    if not title:
        return None
    doi = _doi(item.get("doi"))
    location = item.get("primary_location") or {}
    source = location.get("source") or {}
    best_location = item.get("best_oa_location") or location or {}
    url = best_location.get("landing_page_url") or best_location.get("pdf_url") or (f"https://doi.org/{doi}" if doi else item.get("id"))
    journal = source.get("display_name") or "OpenAlex indexed source"
    cited = int(item.get("cited_by_count") or 0)
    variables = list(dict.fromkeys(event.variables))
    relevance = f"OpenAlex 实时检索匹配；{journal}，引用 {cited} 次。检索词：{query}。"
    return LiteratureReference(
        id=f"OPENALEX-{str(item.get('id', '')).rstrip('/').split('/')[-1]}",
        title=title,
        citation=f"{_authors(item.get('authorships'), None)}. {title}. {journal}.",
        year=_year(item),
        doi=doi,
        relevance=relevance,
        variables=variables,
        provider="OpenAlex",
        url=str(url) if url else None,
        authors=_authors(item.get("authorships"), None),
        journal=journal,
        cited_by_count=cited,
        open_access=bool((item.get("open_access") or {}).get("is_oa") or best_location.get("is_oa")),
    )


def _crossref_reference(item: dict[str, Any], event: OceanEvent, query: str) -> LiteratureReference | None:
    title = str((item.get("title") or [""])[0]).strip()
    if not title:
        return None
    doi = _doi(item.get("DOI"))
    journal = str((item.get("container-title") or ["Crossref indexed source"])[0])
    url = item.get("URL") or (f"https://doi.org/{doi}" if doi else None)
    cited = int(item.get("is-referenced-by-count") or 0)
    authors = _authors(None, item.get("author"))
    stable_id = (doi or sha1(title.encode("utf-8")).hexdigest()[:14]).replace("/", "-")
    return LiteratureReference(
        id=f"CROSSREF-{stable_id}",
        title=title,
        citation=f"{authors}. {title}. {journal}.",
        year=_year(item),
        doi=doi,
        relevance=f"Crossref 实时检索匹配；{journal}，引用 {cited} 次。检索词：{query}。",
        variables=list(dict.fromkeys(event.variables)),
        provider="Crossref",
        url=str(url) if url else None,
        authors=authors,
        journal=journal,
        cited_by_count=cited,
        open_access=False,
    )


def _request_openalex(query: str, event: OceanEvent) -> list[LiteratureReference]:
    params = {
        "search": query,
        "per-page": LITERATURE_RESULT_LIMIT,
        "select": "id,title,publication_year,doi,authorships,primary_location,best_oa_location,open_access,cited_by_count",
    }
    if LITERATURE_MAILTO:
        params["mailto"] = LITERATURE_MAILTO
    response = httpx.get(OPENALEX_URL, params=params, timeout=20.0, headers={"Accept": "application/json"})
    response.raise_for_status()
    return [reference for item in response.json().get("results", []) if (reference := _openalex_reference(item, event, query))]


def _request_crossref(query: str, event: OceanEvent) -> list[LiteratureReference]:
    params = {"query.bibliographic": query, "rows": LITERATURE_RESULT_LIMIT, "select": "DOI,title,author,container-title,published,URL,is-referenced-by-count"}
    response = httpx.get(CROSSREF_URL, params=params, timeout=20.0, headers={"Accept": "application/json"})
    response.raise_for_status()
    items = response.json().get("message", {}).get("items", [])
    return [reference for item in items if (reference := _crossref_reference(item, event, query))]


def search_literature(event: OceanEvent, *, force_refresh: bool = False) -> LiteratureSearchResponse:
    query = build_query(event)
    cache_key = f"{event.id}:{query}"
    now = time.monotonic()
    with _cache_lock:
        cached = _cache.get(cache_key)
    if cached and not force_refresh and now - cached[0] < LITERATURE_CACHE_TTL_SECONDS:
        result = cached[1].model_copy(deep=True)
        result.cached = True
        return result

    provider = "OpenAlex"
    error: str | None = None
    try:
        results = _request_openalex(query, event)
    except Exception as openalex_error:  # noqa: BLE001 - public metadata fallback
        provider = "Crossref"
        error = str(openalex_error)
        try:
            results = _request_crossref(query, event)
        except Exception as crossref_error:  # noqa: BLE001 - endpoint returns a visible error state
            raise RuntimeError(f"Literature providers unavailable: {crossref_error}") from crossref_error

    result = LiteratureSearchResponse(
        event_id=event.id,
        query=query,
        provider=provider,
        searched_at=datetime.now(UTC),
        results=results,
        total=len(results),
        cached=False,
        fallback_error=error,
    )
    with _cache_lock:
        _cache[cache_key] = (time.monotonic(), result.model_copy(deep=True))
    return result
