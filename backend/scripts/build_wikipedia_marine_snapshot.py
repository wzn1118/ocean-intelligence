"""Build the bundled Chinese Wikipedia snapshot for every marine-atlas name.

Run from ``backend``:
    python scripts/build_wikipedia_marine_snapshot.py
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx


BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from app.data.marine_atlas import MARINE_ATLAS  # noqa: E402
from app.data.chinese_text import normalize_political_language, normalize_wikipedia_article  # noqa: E402


API_URL = "https://zh.wikipedia.org/w/api.php"
OUTPUT_PATH = BACKEND_ROOT / "app" / "data" / "wikipedia_marine_zh.json"
USER_AGENT = "OceanIntelligenceOfflineEncyclopedia/1.0 (educational local snapshot)"


def _chunks(values: list[str], size: int) -> list[list[str]]:
    return [values[index:index + size] for index in range(0, len(values), size)]


def _paragraphs(extract: str) -> list[str]:
    values: list[str] = []
    for block in extract.replace("\r\n", "\n").split("\n"):
        value = " ".join(block.strip().split())
        if not value or value.startswith("=="):
            continue
        if len(value) >= 20:
            values.append(value)
    return values


def _fetch_batch(titles: list[str], timeout: float) -> dict[str, Any]:
    params = {
        "action": "query",
        "format": "json",
        "formatversion": "2",
        "prop": "extracts|info",
        "explaintext": "1",
        "exintro": "1",
        "exsectionformat": "plain",
        "inprop": "url",
        "redirects": "1",
        "converttitles": "1",
        "variant": "zh-cn",
        "uselang": "zh-cn",
        "titles": "|".join(titles),
        "origin": "*",
    }
    last_error: Exception | None = None
    for attempt in range(1, 4):
        try:
            response = httpx.get(
                API_URL,
                params=params,
                headers={"User-Agent": USER_AGENT},
                timeout=timeout,
                follow_redirects=True,
            )
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError) as error:
            last_error = error
            if attempt < 3:
                time.sleep(float(attempt))
    raise RuntimeError(f"Wikipedia batch failed after 3 attempts: {last_error}")


def _resolution_map(query: dict[str, Any], requested: list[str]) -> dict[str, str]:
    resolved = {title: title for title in requested}
    for item in query.get("normalized", []) or []:
        source, target = item.get("from"), item.get("to")
        if source and target:
            resolved[str(source)] = str(target)
    for item in query.get("redirects", []) or []:
        source, target = item.get("from"), item.get("to")
        if source and target:
            for original, current in list(resolved.items()):
                if current == source:
                    resolved[original] = str(target)
            resolved[str(source)] = str(target)
    return resolved


def build_snapshot(*, timeout: float = 45.0, pause: float = 0.15) -> dict[str, Any]:
    names = list(dict.fromkeys(str(entry["name"]).strip() for entry in MARINE_ATLAS if str(entry.get("name") or "").strip()))
    articles_by_page: dict[int, dict[str, Any]] = {}
    missing: list[str] = []

    batches = _chunks(names, 40)
    for number, titles in enumerate(batches, start=1):
        payload = _fetch_batch(titles, timeout)
        query = payload.get("query") or {}
        resolution = _resolution_map(query, titles)
        pages = {str(page.get("title")): page for page in query.get("pages", []) if isinstance(page, dict)}
        for requested in titles:
            resolved_title = resolution.get(requested, requested)
            page = pages.get(resolved_title)
            if not page or page.get("missing") is True or not str(page.get("extract") or "").strip():
                missing.append(requested)
                continue
            page_id = int(page["pageid"])
            article = articles_by_page.setdefault(page_id, {
                "page_id": page_id,
                "revision_id": int(page.get("lastrevid") or 0),
                "title": str(page.get("title") or requested),
                "language": "zh",
                "content_scope": "introduction",
                "url": str(page.get("canonicalurl") or page.get("fullurl") or ""),
                "page_updated_at": page.get("touched"),
                "extract": str(page.get("extract") or "").strip(),
                "paragraphs": _paragraphs(str(page.get("extract") or "")),
                "aliases": [],
            })
            for alias in (requested, resolved_title):
                if alias and alias not in article["aliases"]:
                    article["aliases"].append(alias)
        print(f"Wikipedia batch {number}/{len(batches)}: {len(articles_by_page)} verified pages", flush=True)
        if pause:
            time.sleep(pause)

    generated_at = datetime.now(UTC).isoformat()
    articles = sorted(
        (normalize_wikipedia_article(item) for item in articles_by_page.values()),
        key=lambda item: item["title"],
    )
    return {
        "metadata": {
            "schema_version": 2,
            "source_name": "维基百科中文资料",
            "source_api": API_URL,
            "license": "CC BY-SA 4.0 / GFDL（以原页面标注为准）",
            "language_variant": "zh-CN",
            "generated_at": generated_at,
            "atlas_names_requested": len(names),
            "verified_article_count": len(articles),
            "missing_title_count": len(missing),
            "missing_titles": [normalize_political_language(title) for title in missing],
        },
        "articles": articles,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--timeout", type=float, default=45.0)
    parser.add_argument("--pause", type=float, default=0.15)
    args = parser.parse_args()
    payload = build_snapshot(timeout=args.timeout, pause=args.pause)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    metadata = payload["metadata"]
    print(
        f"Saved {metadata['verified_article_count']} verified pages for "
        f"{metadata['atlas_names_requested']} atlas names to {args.output}",
        flush=True,
    )


if __name__ == "__main__":
    main()
