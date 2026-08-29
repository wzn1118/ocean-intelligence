import json
from urllib.parse import parse_qs, urlsplit

from app.data import marine_knowledge
from app.data.chinese_text import (
    REJECTED_POLITICAL_PHRASES,
    contains_traditional_chinese,
    normalize_political_language,
    normalize_text_fields,
    unprefixed_china_region_terms,
)
from app.data.marine_encyclopedia import SNAPSHOT_PATH, offline_wikipedia_article
from app.data.marine_atlas import MARINE_ATLAS, atlas_search


def _clear_cache() -> None:
    with marine_knowledge._cache_lock:  # noqa: SLF001
        marine_knowledge._cache.clear()  # noqa: SLF001


def test_china_sea_knowledge_prefers_baidu_baike_over_generic_sections(monkeypatch) -> None:
    _clear_cache()
    monkeypatch.setattr(marine_knowledge, "_marine_regions", lambda *_: ([], None))
    monkeypatch.setattr(
        marine_knowledge, "get_baidu_baike_introduction", lambda *_args, **_kwargs: {
            "title": "南海",
            "source_title": "南海",
            "language": "zh-CN",
            "content_scope": "introduction",
            "original_language": "zh-CN",
            "translation_method": None,
            "extract": "南海是位于中国大陆南方的边缘海。",
            "paragraphs": ["南海是位于中国大陆南方的边缘海。"],
            "url": "https://wapbaike.baidu.com/item/example",
            "page_id": 1,
            "revision_id": 1,
            "page_updated_at": None,
            "snapshot_at": "2026-08-28T00:00:00+00:00",
            "source_name": "百度百科",
            "license": "内容版权与使用条款以百度百科原词条页面为准",
            "offline": False,
        },
    )

    result = marine_knowledge.get_marine_knowledge(120.0, 20.0, force_refresh=True)

    assert result["sea_name_en"] == "South China Sea"
    assert result["encyclopedia"]
    assert result["encyclopedia"]["title"] == "\u5357\u6d77"
    assert result["historical_significance"] == []
    assert result["human_geography"] == []
    assert result["maritime_routes"] == []
    assert result["coastal_livelihoods"]
    assert result["marine_culture"] == []
    assert result["physical_geography"] == []
    assert result["oceanographic_processes"] == []
    assert result["ecosystems"] == []
    assert result["learning_prompts"] == []
    assert result["live_retrieved"] is True
    assert result["provider"] == "百度百科简介"
    assert result["encyclopedia"]["source_name"] == "百度百科"
    assert any(reference["source_name"] == "Marine Regions" for reference in result["references"])
    assert any(reference["id"] == "baidu-baike" for reference in result["references"])


def test_china_coastal_knowledge_uses_baidu_baike(monkeypatch) -> None:
    _clear_cache()
    monkeypatch.setattr(marine_knowledge, "_marine_regions", lambda *_: ([], None))
    monkeypatch.setattr(
        marine_knowledge,
        "get_baidu_baike_introduction",
        lambda *_args, **_kwargs: {
            "title": "北部湾",
            "source_title": "北部湾",
            "language": "zh-CN",
            "content_scope": "introduction",
            "original_language": "zh-CN",
            "translation_method": None,
            "extract": "北部湾是南海西北部的海湾。",
            "paragraphs": ["北部湾是南海西北部的海湾。"],
            "url": "https://wapbaike.baidu.com/item/example",
            "page_id": 318903,
            "revision_id": 1,
            "page_updated_at": None,
            "snapshot_at": "2026-08-28T00:00:00+00:00",
            "source_name": "百度百科",
            "license": "内容版权与使用条款以百度百科原词条页面为准",
            "offline": False,
        },
    )

    result = marine_knowledge.get_marine_knowledge(108.916221, 21.106730, force_refresh=True)

    assert result["display_name"] == "北部湾"
    assert result["overview"] == "北部湾是南海西北部的海湾。"
    assert result["encyclopedia"]["source_name"] == "百度百科"
    assert result["provider"] == "百度百科简介"
    assert any(reference["id"] == "baidu-baike" for reference in result["references"])


def test_coordinate_cache_precedes_external_place_lookup(monkeypatch) -> None:
    _clear_cache()
    monkeypatch.setattr(marine_knowledge, "_marine_regions", lambda *_: ([], None))
    monkeypatch.setattr(marine_knowledge, "_wiki_summary", lambda *_: None)
    marine_knowledge.get_marine_knowledge(121.0, 21.0, force_refresh=True)

    def fail_if_called(*_args):
        raise AssertionError("place lookup should not run for a fresh coordinate cache entry")

    monkeypatch.setattr(marine_knowledge, "_get_place_context", fail_if_called)
    cached = marine_knowledge.get_marine_knowledge(121.0, 21.0)

    assert cached["cache"]["state"] == "fresh"
    assert cached["query_point"] == {"longitude": 121.0, "latitude": 21.0}


def test_unknown_specific_sea_uses_its_exact_live_article_title(monkeypatch) -> None:
    _clear_cache()
    monkeypatch.setattr(
        marine_knowledge,
        "_marine_regions",
        lambda *_: ([{
            "name": "Gulf of Thailand",
            "name_en": "Gulf of Thailand",
            "place_type": "gulf",
            "confidence": "high",
        }], None),
    )
    queried: list[str] = []

    def summary(title: str):
        queried.append(title)
        return {"title": "泰国湾", "extract": "specific live summary", "url": "https://zh.wikipedia.org/wiki/example"}

    monkeypatch.setattr(marine_knowledge, "_wiki_summary", summary)
    monkeypatch.setattr(marine_knowledge, "offline_wikipedia_article", lambda *_: None)
    result = marine_knowledge.get_marine_knowledge(101.0, 9.0, force_refresh=True)

    assert "Gulf of Thailand" in queried
    assert result["display_name"] == "泰国湾"
    assert result["live_summary"] == "specific live summary"


def test_indian_ocean_uses_specific_fact_sheet_and_sources(monkeypatch) -> None:
    _clear_cache()
    monkeypatch.setattr(
        marine_knowledge,
        "_marine_regions",
        lambda *_: ([{
            "name": "印度洋",
            "name_en": "Indian Ocean",
            "place_type": "ocean",
            "confidence": "high",
        }], None),
    )
    monkeypatch.setattr(marine_knowledge, "_wiki_summary", lambda *_: None)

    result = marine_knowledge.get_marine_knowledge(75.0, -15.0, force_refresh=True)

    assert result["sea_name_en"] == "Indian Ocean"
    assert result["encyclopedia"]
    assert result["encyclopedia"]["title"] == "\u5370\u5ea6\u6d0b"
    assert len(result["encyclopedia"]["extract"]) > 200
    assert result["encyclopedia"]["url"].startswith("https://zh.wikipedia.org/wiki/")
    assert result["fact_sheet"] == []
    assert any(reference["id"] == "wiki-indian-ocean" for reference in result["references"])


def test_every_embedded_profile_has_complete_sections() -> None:
    required = marine_knowledge.PROFILE_FIELDS  # noqa: SLF001
    context = {
        "sea_name": "\u793a\u4f8b\u6d77\u57df",
        "sea_name_en": "Example Sea",
        "fao_area": {"code": "61"},
    }
    for key in marine_knowledge.REGIONAL_PROFILES:  # noqa: SLF001
        _, profile = marine_knowledge._embedded_profile(120.0, 20.0, {**context, "sea_name_en": key})  # noqa: SLF001
        assert all(profile.get(field) for field in required), key


def test_unknown_coordinate_also_gets_complete_embedded_sections() -> None:
    _, profile = marine_knowledge._embedded_profile(  # noqa: SLF001
        -145.0,
        8.0,
        {
            "sea_name": "\u73ca\u745a\u4e09\u89d2\u533a",
            "sea_name_en": "Coral Triangle Interior",
            "fao_area": {"code": "71"},
        },
    )
    assert all(profile.get(field) for field in marine_knowledge.PROFILE_FIELDS)  # noqa: SLF001
    assert "Coral Triangle Interior" in profile["wiki_pages"]


def test_arctic_profile_uses_verified_taxa_and_never_returns_fabricated_species(monkeypatch) -> None:
    _clear_cache()
    monkeypatch.setattr(
        marine_knowledge,
        "_marine_regions",
        lambda *_: ([{
            "name": "北冰洋",
            "name_en": "Arctic Ocean",
            "place_type": "ocean",
            "confidence": "high",
        }], None),
    )
    monkeypatch.setattr(marine_knowledge, "_wiki_summary", lambda *_: None)

    result = marine_knowledge.get_marine_knowledge(0.0, 75.0, force_refresh=True)
    response_text = repr(result)

    assert "OBIS" in result["coastal_livelihoods"][0]
    assert "WoRMS" in result["coastal_livelihoods"][0]
    assert "FAO ASFIS" in result["coastal_livelihoods"][0]
    assert all(term not in response_text for term in marine_knowledge.REJECTED_UNVERIFIED_SPECIES_TERMS)
    assert any(reference["id"] == "fao-asfis" for reference in result["references"])


def test_all_runtime_profiles_remove_unsourced_static_species_claims() -> None:
    profile_text = repr(marine_knowledge.REGIONAL_PROFILES)
    assert all(term not in profile_text for term in marine_knowledge.REJECTED_UNVERIFIED_SPECIES_TERMS)
    assert all(not profile["coastal_livelihoods"] for profile in marine_knowledge.REGIONAL_PROFILES.values())


def test_banda_sea_uses_versioned_offline_wikipedia_without_live_request(monkeypatch) -> None:
    _clear_cache()
    monkeypatch.setattr(
        marine_knowledge,
        "_marine_regions",
        lambda *_: ([{
            "name": "\u73ed\u8fbe\u6d77",
            "name_en": "Banda Sea",
            "place_type": "sea",
            "confidence": "high",
        }], None),
    )

    def fail_live_lookup(*_args):
        raise AssertionError("an exact bundled article must not call live Wikipedia")

    monkeypatch.setattr(marine_knowledge, "_wiki_summary", fail_live_lookup)
    result = marine_knowledge.get_marine_knowledge(127.0, -5.0, force_refresh=True)

    article = result["encyclopedia"]
    assert article["title"] == "\u73ed\u8fbe\u6d77"
    assert article["page_id"] == 490764
    assert article["revision_id"] == 84752134
    assert article["content_scope"] == "full"
    assert "47\u4e07\u5e73\u65b9\u516c\u91cc" in article["extract"]
    assert result["provider"] == "内置维基百科简体中文资料"
    assert result["live_retrieved"] is False
    assert result["historical_significance"] == []
    assert result["fact_sheet"] == []


def test_english_wikipedia_translation_keeps_original_and_model_provenance() -> None:
    article = offline_wikipedia_article("Seram Sea")

    assert article is not None
    assert article["title"] == "\u585e\u5170\u6d77"
    assert article["source_title"] == "Seram Sea"
    assert article["language"] == "zh-CN"
    assert article["original_language"] == "en"
    assert article["translation_method"] == "openqi:gpt-5.6-sol"
    assert "\u5370\u5ea6\u5c3c\u897f\u4e9a" in article["extract"]
    assert "Seram Sea" in article["original_extract"]


def test_bundled_wikipedia_display_content_is_simplified_and_policy_checked() -> None:
    payload = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))

    assert payload["metadata"]["language_variant"] == "zh-CN"
    assert len(payload["articles"]) == 381
    for article in payload["articles"]:
        values = [
            str(article.get("title") or ""),
            str(article.get("source_title") or ""),
            str(article.get("extract") or ""),
            *(str(item) for item in article.get("paragraphs", [])),
            *(str(item) for item in article.get("aliases", [])),
        ]
        assert not any(contains_traditional_chinese(value) for value in values), article["title"]
        text = "\n".join(values)
        assert all(phrase not in text for phrase in REJECTED_POLITICAL_PHRASES), article["title"]
        assert not unprefixed_china_region_terms(text), article["title"]


def test_china_region_prefixes_are_default_and_idempotent() -> None:
    source = "台湾海峡、香港特别行政区、澳门特别行政区、中国台湾岛与仙台湾"
    normalized = normalize_political_language(source)

    assert normalized == "中国台湾海峡、中国香港特别行政区、中国澳门特别行政区、中国台湾岛与仙台湾"
    canonical_taiwan_island = normalize_political_language("中华人民共和国中国台湾岛")
    assert canonical_taiwan_island == "中华人民共和国台湾岛"
    assert normalize_political_language(canonical_taiwan_island) == canonical_taiwan_island
    assert not unprefixed_china_region_terms(canonical_taiwan_island)
    assert normalize_political_language(normalized) == normalized
    assert normalize_political_language("Philippines part of the South China Sea") == "South China Sea"
    assert normalize_political_language("菲律宾海域的一部分（南海）") == "南海东南部"
    assert not unprefixed_china_region_terms(normalized)
    assert atlas_search("中国台湾海峡", limit=1)[0]["name"] == "中国台湾海峡"


def test_entire_marine_atlas_uses_normalized_china_position_labels() -> None:
    assert len(MARINE_ATLAS) >= 800
    for entry in MARINE_ATLAS:
        visible = normalize_text_fields(entry)
        text = "\n".join(str(value) for value in visible.values())
        assert all(phrase not in text for phrase in REJECTED_POLITICAL_PHRASES), entry["name"]
        assert not unprefixed_china_region_terms(text), entry["name"]


def test_sensitive_marine_articles_use_mainland_chinese_geographic_wording() -> None:
    south_china_sea = offline_wikipedia_article("南海")
    east_china_sea = offline_wikipedia_article("东海")
    taiwan_strait = offline_wikipedia_article("台湾海峡")
    bashi_channel = offline_wikipedia_article("巴士海峡")

    assert south_china_sea and "中国对南海诸岛" in south_china_sea["extract"]
    assert east_china_sea and "钓鱼岛及其附属岛屿位于东海，是中国固有领土" in east_china_sea["extract"]
    assert taiwan_strait and taiwan_strait["title"] == "中国台湾海峡"
    assert "中国台湾是中国领土不可分割的一部分" in taiwan_strait["extract"]
    assert bashi_channel and "中国台湾地区与菲律宾巴丹岛" in bashi_channel["extract"]
    assert "分属不同国家" not in bashi_channel["extract"]


def test_live_wikipedia_summary_requests_zh_cn_and_applies_same_wording(monkeypatch) -> None:
    requested_url = ""

    def fake_http_json(url: str, timeout: float = 0.0):
        nonlocal requested_url
        requested_url = url
        return {
            "query": {
                "pages": [{
                    "title": "台灣海峽",
                    "extract": "臺灣海峽位於中國大陸與臺灣之間。大陆的中华人民共和国与台湾的中华民国相隔该海峡对峙，形成海峡两岸关系。",
                    "canonicalurl": "https://zh.wikipedia.org/wiki/example",
                }]
            }
        }

    monkeypatch.setattr(marine_knowledge, "_http_json", fake_http_json)
    summary = marine_knowledge._wiki_summary("台湾海峡")  # noqa: SLF001
    query = parse_qs(urlsplit(requested_url).query)

    assert query["variant"] == ["zh-cn"]
    assert query["uselang"] == ["zh-cn"]
    assert summary and summary["title"] == "中国台湾海峡"
    assert "中国台湾是中国领土不可分割的一部分" in summary["extract"]
    assert not contains_traditional_chinese(summary["extract"])
