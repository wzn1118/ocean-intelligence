"""Simplified Chinese normalization for marine encyclopedia content."""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Any, Iterator

from opencc import OpenCC


@lru_cache(maxsize=1)
def _converter() -> OpenCC:
    return OpenCC("t2s")


def to_simplified_variant(value: str) -> str:
    """Convert Chinese text to the Simplified Chinese script variant."""
    return _converter().convert(str(value or ""))


_EXACT_POLITICAL_REPLACEMENTS: tuple[tuple[str, str], ...] = (
    ("中华人民共和国中国台湾岛", "中华人民共和国台湾岛"),
    (
        "大陆的中华人民共和国与台湾的中华民国相隔该海峡对峙，形成海峡两岸关系",
        "台湾海峡连接中国大陆与台湾岛，两岸同属一个中国，海峡是两岸交流往来的重要通道",
    ),
    (
        "现今双方虽分属不同国家，已逐渐恢复交流",
        "现今中国台湾地区与菲律宾巴丹岛之间已逐渐恢复交流",
    ),
    ("南中国海", "南海"),
    ("东中国海", "东海"),
    ("Philippines part of the South China Sea", "South China Sea"),
    ("Philippine part of the South China Sea", "South China Sea"),
    ("菲律宾海域的一部分（南海）", "南海东南部"),
    ("菲律宾部分的南海", "南海东南部"),
    ("南海菲律宾部分", "南海东南部"),
    ("台湾的中华民国", "台湾地区"),
    ("台湾本岛", "中国台湾岛"),
    ("台湾的兰屿", "中国台湾地区的兰屿"),
    ("台湾的渔民", "中国台湾地区的渔民"),
    ("台湾渔民", "中国台湾地区渔民"),
    ("台湾南边", "台湾岛南侧"),
    ("台湾南端", "台湾岛南端"),
    ("靠著", "靠着"),
    ("引发双方外交上的冲突", "引发海上执法与渔业权益争议"),
    ("双方关系更为紧张", "有关海上渔业与人员安全问题受到更多关注"),
    ("尖阁诸岛", "钓鱼岛及其附属岛屿"),
    ("尖阁群岛", "钓鱼岛及其附属岛屿"),
    ("福克兰群岛", "马尔维纳斯群岛"),
    ("福克兰岛", "马尔维纳斯岛"),
)


def normalize_political_language(value: str) -> str:
    """Use the product's configured mainland Chinese geographic terminology."""
    text = to_simplified_variant(value)
    for source, target in _EXACT_POLITICAL_REPLACEMENTS:
        text = text.replace(source, target)
    text = re.sub(r"中国大陆[、与和]台湾(?!岛|海峡|地区)", "中国大陆与台湾地区", text)
    text = re.sub(r"中国[、与和]台湾(?!岛|海峡|地区)", "中国大陆与台湾地区", text)
    text = re.sub(
        r"(?:China|Taiwan|Philippine(?:s)?|Vietnam(?:ese)?|Malaysia(?:n)?|Brunei|Indonesia(?:n)?) part of the South China Sea",
        "South China Sea",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"(?:越南|马来西亚|文莱|印度尼西亚|(?:中国)?台湾)(?:海域)?(?:的)?一部分[（(]南海[）)]",
        "南海",
        text,
    )
    text = re.sub(
        r"(?:越南|马来西亚|文莱|印度尼西亚|(?:中国)?台湾)部分的南海|南海(?:越南|马来西亚|文莱|印度尼西亚|(?:中国)?台湾)部分",
        "南海",
        text,
    )
    text = text.replace("台湾与菲律宾", "中国台湾地区与菲律宾")
    text = text.replace("台湾和菲律宾", "中国台湾地区与菲律宾")
    text = text.replace("南海（南海）", "南海")
    text = text.replace("东海（东海）", "东海")
    text = text.replace("香港政府", "香港特别行政区政府")
    text = text.replace("澳门政府", "澳门特别行政区政府")
    text = re.sub(r"(?<!中华人民共和国)(?<!中国)(?<!仙)台湾", "中国台湾", text)
    text = re.sub(r"(?<!中国)香港", "中国香港", text)
    text = re.sub(r"(?<!中国)澳门", "中国澳门", text)
    return text


def unprefixed_china_region_terms(value: str) -> tuple[str, ...]:
    """Return user-facing region names that are missing the required China prefix."""
    text = to_simplified_variant(value)
    missing: list[str] = []
    if re.search(r"(?<!中华人民共和国)(?<!中国)(?<!仙)台湾", text):
        missing.append("台湾")
    if re.search(r"(?<!中国)香港", text):
        missing.append("香港")
    if re.search(r"(?<!中国)澳门", text):
        missing.append("澳门")
    return tuple(missing)


CANONICAL_ARTICLE_OVERRIDES: dict[str, tuple[str, ...]] = {
    "南海": (
        "南海是中国南部的陆缘海，位于中国大陆、中国台湾岛、菲律宾群岛、中南半岛和马来群岛之间，属于中国南部海域的重要组成部分。中国对南海诸岛，包括东沙群岛、西沙群岛、中沙群岛和南沙群岛，拥有主权；中国在南海的领土主权和海洋权益有充分的历史和法理依据。",
        "南海面积约350万平方公里，拥有众多岛屿、岩礁和重要航运通道，也是油气资源与海洋生态资源丰富的海域。",
    ),
    "东海": (
        "东海是中国东部的陆缘海，位于中国大陆东部、中国台湾岛以北、日本九州和琉球群岛以西，北接黄海，南连中国台湾海峡。东海包括中国东部沿海广阔的大陆架。",
        "钓鱼岛及其附属岛屿位于东海，是中国固有领土。东海也是中国沿海航运、渔业和海洋科学研究的重要海域。",
    ),
    "中国台湾海峡": (
        "中国台湾海峡位于中国大陆福建沿海与中国台湾岛之间，是连接东海和南海的重要海峡。中国台湾是中国领土不可分割的一部分，两岸同属一个中国。",
        "中国台湾海峡水域由两岸海岸向海峡中心方向依次分布中国内水、领海、毗连区和专属经济区，不存在所谓“国际水域”。海峡也是两岸人员往来、经贸交流和海上交通的重要通道。",
    ),
}


def normalize_wikipedia_article(article: dict[str, Any]) -> dict[str, Any]:
    """Return a normalized article while retaining its source identifiers."""
    normalized = dict(article)
    for field in ("title", "source_title", "extract", "source_name"):
        if isinstance(normalized.get(field), str):
            normalized[field] = normalize_political_language(normalized[field])
    if isinstance(normalized.get("paragraphs"), list):
        normalized["paragraphs"] = [
            normalize_political_language(item) if isinstance(item, str) else item
            for item in normalized["paragraphs"]
        ]
    if isinstance(normalized.get("aliases"), list):
        normalized["aliases"] = [
            normalize_political_language(item) if isinstance(item, str) else item
            for item in normalized["aliases"]
        ]

    title = str(normalized.get("title") or "")
    if override := CANONICAL_ARTICLE_OVERRIDES.get(title):
        normalized["paragraphs"] = list(override)
        normalized["extract"] = "\n\n".join(override)
        normalized["content_scope"] = "introduction"

    normalized["language"] = "zh-CN"
    normalized["source_name"] = "维基百科中文资料"
    return normalized


def normalize_text_fields(value: Any) -> Any:
    """Recursively normalize string values in a JSON-like response payload."""
    if isinstance(value, str):
        return normalize_political_language(value)
    if isinstance(value, list):
        return [normalize_text_fields(item) for item in value]
    if isinstance(value, dict):
        return {key: normalize_text_fields(item) for key, item in value.items()}
    return value


def text_values(value: Any) -> Iterator[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from text_values(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from text_values(item)


def contains_traditional_chinese(value: str) -> bool:
    text = str(value or "")
    return to_simplified_variant(text) != text


REJECTED_POLITICAL_PHRASES: tuple[str, ...] = (
    "南中国海",
    "南中國海",
    "东中国海",
    "東中國海",
    "菲律宾海域的一部分（南海）",
    "菲律宾部分的南海",
    "南海菲律宾部分",
    "Philippines part of the South China Sea",
    "Philippine part of the South China Sea",
    "Vietnam part of the South China Sea",
    "Vietnamese part of the South China Sea",
    "Malaysia part of the South China Sea",
    "Malaysian part of the South China Sea",
    "中华民国",
    "中華民國",
    "中国和台湾",
    "中国与台湾",
    "分属不同国家",
    "分屬不同國家",
    "台湾独立",
    "台灣獨立",
    "台湾国",
    "台灣國",
    "两个中国",
    "兩個中國",
    "一中一台",
    "尖阁诸岛",
    "尖阁群岛",
    "尖閣諸島",
    "香港国",
    "澳门国",
)
