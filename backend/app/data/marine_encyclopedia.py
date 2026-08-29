"""Versioned, offline encyclopedia snapshots for named marine regions."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.data.chinese_text import (
    normalize_political_language,
    normalize_text_fields,
    normalize_wikipedia_article,
)


SNAPSHOT_PATH = Path(__file__).with_name("wikipedia_marine_zh.json")


def _normalise_title(value: str) -> str:
    normalized = normalize_political_language(str(value).replace("_", " "))
    return " ".join(normalized.strip().casefold().split())


def _snapshot_signature() -> tuple[int, int]:
    if not SNAPSHOT_PATH.exists():
        return (0, 0)
    stat = SNAPSHOT_PATH.stat()
    return (stat.st_mtime_ns, stat.st_size)


@lru_cache(maxsize=2)
def _snapshot_for_version(_mtime_ns: int, _size: int) -> dict[str, Any]:
    if not SNAPSHOT_PATH.exists():
        return {"metadata": {}, "articles": []}
    with SNAPSHOT_PATH.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        return {"metadata": {}, "articles": []}
    metadata = normalize_text_fields(dict(payload.get("metadata") or {}))
    metadata["language_variant"] = "zh-CN"
    metadata["source_name"] = "维基百科中文资料"
    articles = [
        normalize_wikipedia_article(article)
        for article in payload.get("articles", [])
        if isinstance(article, dict)
    ]
    return {**payload, "metadata": metadata, "articles": articles}


def _snapshot() -> dict[str, Any]:
    return _snapshot_for_version(*_snapshot_signature())


@lru_cache(maxsize=2)
def _article_index_for_version(mtime_ns: int, size: int) -> dict[str, dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    for raw_article in _snapshot_for_version(mtime_ns, size).get("articles", []):
        if not isinstance(raw_article, dict):
            continue
        article = dict(raw_article)
        aliases = [article.get("title"), *(article.get("aliases") or [])]
        for alias in aliases:
            key = _normalise_title(str(alias or ""))
            if key:
                index[key] = article
    return index


def _article_index() -> dict[str, dict[str, Any]]:
    return _article_index_for_version(*_snapshot_signature())


def offline_wikipedia_article(*titles: str | None) -> dict[str, Any] | None:
    """Return an exact bundled article by canonical title or saved alias."""
    index = _article_index()
    for title in titles:
        key = _normalise_title(str(title or ""))
        if key and key in index:
            return dict(index[key])
    return None


def encyclopedia_snapshot_metadata() -> dict[str, Any]:
    return dict(_snapshot().get("metadata") or {})


def clear_encyclopedia_cache() -> None:
    """Reload a newly generated snapshot in long-running development servers."""
    _snapshot_for_version.cache_clear()
    _article_index_for_version.cache_clear()
