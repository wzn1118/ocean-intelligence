"""Short, traceable Baidu Baike introductions for named coastal waters."""

from __future__ import annotations

import html
import json
import re
import threading
import time
from datetime import UTC, datetime
from urllib.parse import quote
from urllib.request import Request, urlopen

from app.data.chinese_text import normalize_political_language


BAIDU_BAIKE_BASE_URL = "https://wapbaike.baidu.com/item/"
CACHE_TTL_SECONDS = 6 * 60 * 60
INTRODUCTION_MAX_CHARACTERS = 120
TITLE_ALIASES = {
    "中国台湾海峡": "台湾海峡",
    "中国台湾东北部海域": "东海",
    "中国台湾东部海域": "菲律宾海",
    "中国台湾南部海域": "巴士海峡",
    "南黄海": "黄海",
    "浙江近海": "东海",
    "福建近海": "台湾海峡",
    "粤东近海": "南海",
    "粤西近海": "南海",
    "海南岛东部近海": "南海",
    "澎湖水道": "台湾海峡",
}
_cache: dict[str, tuple[float, dict[str, object] | None]] = {}
_cache_lock = threading.Lock()


def _clean_text(value: str) -> str:
    text = re.sub(r"<[^>]+>", "", html.unescape(value))
    text = re.sub(r"\s+", " ", text).strip()
    return normalize_political_language(text)


def _short_introduction(value: str) -> str:
    text = _clean_text(value)
    if len(text) <= INTRODUCTION_MAX_CHARACTERS:
        return text
    sentences = re.findall(r".*?[。！？；;]", text)
    selected: list[str] = []
    for sentence in sentences:
        if selected and len("".join(selected)) + len(sentence) > INTRODUCTION_MAX_CHARACTERS:
            break
        selected.append(sentence)
    introduction = "".join(selected).strip() or f"{text[:INTRODUCTION_MAX_CHARACTERS].rstrip('，,；;')}。"
    if len(introduction) > INTRODUCTION_MAX_CHARACTERS + 1:
        introduction = f"{introduction[:INTRODUCTION_MAX_CHARACTERS].rstrip('，,；;')}。"
    return introduction


def _next_page_data(document: str) -> dict[str, object]:
    match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', document, re.S)
    if not match:
        return {}
    try:
        payload = json.loads(match.group(1))
    except json.JSONDecodeError:
        return {}
    page_data = ((payload.get("props") or {}).get("pageProps") or {}).get("pageData") if isinstance(payload, dict) else None
    return page_data if isinstance(page_data, dict) else {}


def _meta_description(document: str) -> str:
    match = re.search(r'<meta[^>]+name="description"[^>]+content="([^"]*)"', document, re.I)
    if not match:
        match = re.search(r'<meta[^>]+content="([^"]*)"[^>]+name="description"', document, re.I)
    return _short_introduction(match.group(1)) if match else ""


def get_baidu_baike_introduction(title: str, *, force_refresh: bool = False) -> dict[str, object] | None:
    normalized_title = title.strip()
    if not normalized_title:
        return None
    now = time.monotonic()
    with _cache_lock:
        cached = _cache.get(normalized_title)
    if cached and not force_refresh and now - cached[0] < CACHE_TTL_SECONDS:
        return dict(cached[1]) if cached[1] else None

    search_title = TITLE_ALIASES.get(normalized_title, normalized_title)
    url = f"{BAIDU_BAIKE_BASE_URL}{quote(search_title)}"
    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Mobile Safari/537.36",
            "Referer": "https://www.baidu.com/",
            "Accept-Language": "zh-CN,zh;q=0.9",
        },
    )
    article: dict[str, object] | None = None
    try:
        with urlopen(request, timeout=8.0) as response:
            document = response.read().decode("utf-8", errors="replace")
            final_url = response.geturl()
        page_data = _next_page_data(document)
        source_title = str(page_data.get("lemmaTitle") or normalized_title).strip()
        introduction = _meta_description(document)
        if introduction:
            page_id = int(page_data.get("lemmaId") or 1)
            update_timestamp = int(page_data.get("updateTime") or 0)
            article = {
                "title": normalize_political_language(normalized_title),
                "source_title": source_title,
                "language": "zh-CN",
                "content_scope": "introduction",
                "original_language": "zh-CN",
                "translation_method": None,
                "extract": introduction,
                "paragraphs": [introduction],
                "url": final_url,
                "page_id": max(page_id, 1),
                "revision_id": max(update_timestamp, 1),
                "page_updated_at": datetime.fromtimestamp(update_timestamp, UTC).isoformat() if update_timestamp else None,
                "snapshot_at": datetime.now(UTC).isoformat(),
                "source_name": "百度百科",
                "license": "内容版权与使用条款以百度百科原词条页面为准",
                "offline": False,
            }
    except Exception:  # noqa: BLE001 - encyclopedia enrichment is optional
        article = None

    with _cache_lock:
        _cache[normalized_title] = (now, article)
    return dict(article) if article else None


def clear_baidu_baike_cache() -> None:
    with _cache_lock:
        _cache.clear()
