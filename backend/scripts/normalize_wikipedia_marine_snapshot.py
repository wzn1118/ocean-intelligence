"""Normalize and audit the bundled marine Wikipedia snapshot."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from app.data.chinese_text import (  # noqa: E402
    CANONICAL_ARTICLE_OVERRIDES,
    REJECTED_POLITICAL_PHRASES,
    contains_traditional_chinese,
    normalize_political_language,
    normalize_wikipedia_article,
    unprefixed_china_region_terms,
)


DEFAULT_SNAPSHOT = BACKEND_ROOT / "app" / "data" / "wikipedia_marine_zh.json"


def _deduplicate(values: list[Any]) -> list[Any]:
    deduplicated: list[Any] = []
    for value in values:
        if value not in deduplicated:
            deduplicated.append(value)
    return deduplicated


def normalize_snapshot(payload: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(payload)
    metadata = dict(payload.get("metadata") or {})
    metadata["schema_version"] = max(2, int(metadata.get("schema_version") or 1))
    metadata["source_name"] = "维基百科中文资料"
    metadata["language_variant"] = "zh-CN"
    if isinstance(metadata.get("missing_titles"), list):
        metadata["missing_titles"] = [
            normalize_political_language(str(title)) for title in metadata["missing_titles"]
        ]
    normalized["metadata"] = metadata

    articles: list[dict[str, Any]] = []
    for raw_article in payload.get("articles", []):
        if not isinstance(raw_article, dict):
            continue
        article = normalize_wikipedia_article(raw_article)
        article["aliases"] = _deduplicate(list(article.get("aliases") or []))
        article["paragraphs"] = [
            paragraph for paragraph in article.get("paragraphs", []) if str(paragraph).strip()
        ]
        articles.append(article)
    normalized["articles"] = sorted(articles, key=lambda item: (item.get("title", ""), item.get("source_title", "")))
    metadata["verified_article_count"] = len(articles)
    return normalized


def audit_snapshot(payload: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    for article in payload.get("articles", []):
        title = str(article.get("title") or "<untitled>")
        visible_values = [
            str(article.get("title") or ""),
            str(article.get("source_title") or ""),
            str(article.get("extract") or ""),
            *(str(item) for item in article.get("paragraphs", [])),
            *(str(item) for item in article.get("aliases", [])),
        ]
        if any(contains_traditional_chinese(value) for value in visible_values):
            issues.append(f"{title}: contains Traditional Chinese")
        joined = "\n".join(visible_values)
        rejected = [phrase for phrase in REJECTED_POLITICAL_PHRASES if phrase in joined]
        if rejected:
            issues.append(f"{title}: rejected phrasing {', '.join(rejected)}")
        unprefixed = unprefixed_china_region_terms(joined)
        if unprefixed:
            issues.append(f"{title}: China prefix missing from {', '.join(unprefixed)}")
        required = CANONICAL_ARTICLE_OVERRIDES.get(title)
        if required and list(required) != list(article.get("paragraphs") or []):
            issues.append(f"{title}: canonical wording is missing")
    return issues


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", type=Path, default=DEFAULT_SNAPSHOT)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()

    payload = json.loads(args.snapshot.read_text(encoding="utf-8"))
    normalized = normalize_snapshot(payload)
    issues = audit_snapshot(normalized)
    if issues:
        raise SystemExit("\n".join(issues))
    changed = payload != normalized
    if args.write:
        args.snapshot.write_text(
            json.dumps(normalized, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    elif changed:
        raise SystemExit("Snapshot is not normalized; rerun with --write")
    print(f"articles={len(normalized['articles'])} changed={str(changed).lower()} audit=passed")


if __name__ == "__main__":
    main()
