from __future__ import annotations

import threading
from datetime import UTC, datetime, time as datetime_time
from email.utils import parsedate_to_datetime
from typing import Any
import re
from urllib.request import Request, urlopen
from xml.etree import ElementTree
from zoneinfo import ZoneInfo

FEEDS = (
    ("新华网", "https://www.news.cn/local/news_province.xml"),
    ("新华网", "https://www.news.cn/tech/news_tech.xml"),
    ("新华网", "https://www.news.cn/fortune/news_fortune.xml"),
    ("新华网", "https://www.news.cn/world/news_world.xml"),
    ("中国新闻网", "https://www.chinanews.com.cn/rss/scroll-news.xml"),
    ("中国新闻网", "https://www.chinanews.com.cn/rss/finance.xml"),
    ("中国新闻网", "https://www.chinanews.com.cn/rss/society.xml"),
)
KEYWORDS = ("海洋", "海域", "海岛", "海岸", "海上", "海事", "渔业", "台风", "潮汐", "海浪", "海温", "珊瑚", "红树林", "港口", "航运", "深海")
NMC_PERMANENT_PAGES = (
    ("远海海区预报", "https://www.nmc.cn/publish/marine/ocean.html"),
    ("近海海区预报", "https://www.nmc.cn/publish/marine/offshore.html"),
    ("沿岸海区预报", "https://www.nmc.cn/publish/marine/newcoastal.html"),
    ("海洋天气公报", "https://www.nmc.cn/publish/marine/forecast.htm"),
    ("海区风力预报", "https://www.nmc.cn/publish/taifenghaiyang/haiqufengliyubao/index.html"),
)
_cache: tuple[str, list[dict[str, Any]]] | None = None
_lock = threading.Lock()


def _published(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return parsedate_to_datetime(value).astimezone(UTC)
    except (TypeError, ValueError, OverflowError):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)
        except ValueError:
            return None


def _feed(source: str, url: str) -> list[dict[str, Any]]:
    request = Request(url, headers={"User-Agent": "OceanIntelligenceAgent/1.0", "Accept": "application/rss+xml, application/xml, text/xml"})
    with urlopen(request, timeout=15) as response:
        root = ElementTree.fromstring(response.read())
    items = []
    for item in root.findall(".//item"):
        title = (item.findtext("title") or "").strip()
        description = (item.findtext("description") or "").strip()
        if not title or not any(keyword in f"{title} {description}" for keyword in KEYWORDS):
            continue
        link = (item.findtext("link") or "").strip()
        published = _published(item.findtext("pubDate") or item.findtext("date"))
        items.append({"title": title, "summary": description[:240], "source": source, "url": link, "published_at": published.isoformat() if published else None})
    return items


def get_mainland_ocean_news(limit: int = 15, *, force_refresh: bool = False, query: str = "") -> dict[str, Any]:
    global _cache
    china_time = ZoneInfo("Asia/Shanghai")
    local_date = datetime.now(UTC).astimezone(china_time).date()
    date_key = local_date.isoformat()
    with _lock:
        cached = _cache
    if cached and not force_refresh and cached[0] == date_key:
        items = cached[1]
    else:
        collected: list[dict[str, Any]] = []
        errors: list[str] = []
        for source, url in FEEDS:
            try:
                collected.extend(_feed(source, url))
            except Exception as error:  # noqa: BLE001
                errors.append(f"{source}: {error}")
        unique: dict[str, dict[str, Any]] = {}
        for item in collected:
            unique.setdefault(item["url"] or item["title"], item)
        items = sorted(unique.values(), key=lambda item: item.get("published_at") or "", reverse=True)
        with _lock:
            _cache = (date_key, items)
        get_mainland_ocean_news.last_errors = errors
    query_terms = [term for term in re.split(r"[\s,，、|]+", query.strip()) if term]
    matched_items = items
    if query_terms:
        matched_items = [
            item for item in items
            if any(term.casefold() in f"{item.get('title', '')} {item.get('summary', '')}".casefold() for term in query_terms)
        ]
    today_items = [item for item in matched_items if item.get("published_at") and datetime.fromisoformat(item["published_at"]).astimezone(china_time).date() == local_date]
    older_items = [item for item in matched_items if item not in today_items]
    permanent_items: list[dict[str, Any]] = []
    if not query_terms:
        published_at = datetime.combine(local_date, datetime_time(hour=8), tzinfo=china_time).astimezone(UTC).isoformat()
        permanent_items = [
            {
                "title": f"{local_date:%Y年%m月%d日} · 中央气象台{title}",
                "summary": "中央气象台每日常驻海洋预报入口",
                "source": "中央气象台",
                "url": url,
                "published_at": published_at,
            }
            for title, url in NMC_PERMANENT_PAGES
        ][:limit]
    remaining = max(0, limit - len(permanent_items))
    selected = permanent_items + (today_items + older_items)[:remaining]
    return {
        "date": local_date.isoformat(),
        "query": query,
        "matched_count": len(matched_items),
        "count": len(selected),
        "is_today_complete": len(permanent_items) + len(today_items) >= limit,
        "items": selected,
        "errors": getattr(get_mainland_ocean_news, "last_errors", []),
        "sources": sorted({item["source"] for item in selected}),
    }


get_mainland_ocean_news.last_errors = []
