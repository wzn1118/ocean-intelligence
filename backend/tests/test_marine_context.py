from app.data import marine_context


def test_fallback_sea_name_is_deterministic() -> None:
    result = marine_context._fallback_sea(120.0, 20.0)  # noqa: SLF001
    assert result["name"] == "南海"
    assert result["name_en"] == "South China Sea"


def test_china_coastal_polygons_prefer_named_local_waters() -> None:
    cases = [
        ((108.916221, 21.106730), "北部湾"),
        ((121.0, 40.3), "辽东湾"),
        ((118.3, 38.4), "渤海湾"),
        ((119.3, 37.4), "莱州湾"),
        ((120.2, 36.1), "胶州湾"),
        ((121.3, 30.4), "杭州湾"),
        ((118.1, 24.45), "厦门湾"),
        ((113.8, 22.2), "珠江口"),
        ((110.1, 20.05), "琼州海峡"),
        ((119.5, 24.0), "中国台湾海峡"),
        ((122.2, 23.5), "中国台湾东部海域"),
    ]
    for (longitude, latitude), expected in cases:
        result = marine_context._fallback_sea(longitude, latitude)  # noqa: SLF001
        assert result["name"] == expected


def test_external_gulf_beats_broad_iho_sea() -> None:
    fallback = {"name": "南海", "name_en": "South China Sea", "place_type": "海", "confidence": "medium"}
    places = [
        {"name": "北部湾", "name_en": "Gulf of Tonkin", "place_type": "海域", "place_type_en": "SeaVoX SeaArea - sub-region", "confidence": "high"},
        {"name": "南海", "name_en": "South China Sea", "place_type": "海域", "place_type_en": "IHO Sea Area", "confidence": "high"},
    ]
    assert marine_context._select_primary_place(places, fallback)["name"] == "北部湾"


def test_context_normalizes_external_names_to_chinese() -> None:
    assert marine_context._sea_name_zh("Philippine part of the South China Sea") == "南海东南部"
    assert marine_context._sea_name_zh("Taiwan Strait") == "中国台湾海峡"
    assert marine_context._normalize_fao_area({"name": "legacy", "name_en": "Pacific, Northwest"})["name"] == "西北太平洋"


def test_primary_place_prefers_named_sea_and_keeps_region_codes() -> None:
    fallback = marine_context._fallback_sea(120.0, 20.0)
    places = [
        {"name": "海洋区域", "name_en": "50Hz", "place_type": "海洋省"},
        {"name": "海洋区域", "name_en": "AB14", "place_type": "海洋省"},
        {"name": "南海", "name_en": "South China Sea", "place_type": "海域", "confidence": "high"},
    ]

    selected = marine_context._select_primary_place(places, fallback)

    assert selected["name"] == "南海"
    assert marine_context._region_codes(places) == ["50Hz", "AB14"]


def test_high_confidence_atlas_strait_beats_broad_remote_sea() -> None:
    fallback = marine_context._fallback_sea(119.5, 24.0)
    places = [{
        "name": "Northern South China Sea",
        "name_en": "Northern South China Sea",
        "place_type": "sea",
        "place_type_en": "sea",
        "confidence": "high",
    }]
    selected = marine_context._select_primary_place(places, fallback)
    assert selected["name_en"] == "Taiwan Strait"


def test_context_adds_china_prefix_to_taiwan_strait(monkeypatch) -> None:
    monkeypatch.setattr(marine_context, "_marine_regions", lambda *_: ([], None))
    monkeypatch.setattr(
        marine_context,
        "_obis_fisheries",
        lambda *_: ([], {
            "biodiversity_total_records": 0,
            "scanned_records": 0,
            "results_complete": True,
            "fishery_occurrence_records": 0,
            "fishery_species_count": 0,
            "search_radius_km": 100.0,
        }, None),
    )

    result = marine_context.get_marine_context(119.5, 24.0, force_refresh=True)

    assert result["sea_name"] == "中国台湾海峡"
    assert result["display_name"] == "中国台湾海峡"


def test_context_combines_region_codes_with_its_named_sea(monkeypatch) -> None:
    monkeypatch.setattr(
        marine_context,
        "_marine_regions",
        lambda *_: ([
            {"name": "50Hz", "name_en": "50Hz", "place_type": "海洋省", "confidence": "high"},
            {"name": "South China Sea", "name_en": "South China Sea", "place_type": "海域", "confidence": "high"},
        ], None),
    )
    monkeypatch.setattr(
        marine_context,
        "_obis_fisheries",
        lambda *_: ([], {
            "biodiversity_total_records": 0,
            "scanned_records": 0,
            "results_complete": True,
            "fishery_occurrence_records": 0,
            "fishery_species_count": 0,
            "search_radius_km": 100.0,
        }, None),
    )

    result = marine_context.get_marine_context(120.0, 20.0, force_refresh=True)

    assert result["display_name"] == "南海"
    assert result["region_codes"] == ["50Hz"]
    assert result["region_label"] == "50Hz · 南海"


def test_context_removes_external_south_china_sea_ownership_label(monkeypatch) -> None:
    monkeypatch.setattr(
        marine_context,
        "_marine_regions",
        lambda *_: ([{
            "name": "Philippines part of the South China Sea",
            "name_en": "Philippines part of the South China Sea",
            "place_type": "sea",
            "confidence": "high",
        }], None),
    )
    monkeypatch.setattr(
        marine_context,
        "_obis_fisheries",
        lambda *_: ([], {
            "biodiversity_total_records": 0,
            "scanned_records": 0,
            "results_complete": True,
            "fishery_occurrence_records": 0,
            "fishery_species_count": 0,
            "search_radius_km": 100.0,
        }, None),
    )

    result = marine_context.get_marine_context(114.0, 12.0, force_refresh=True)

    assert result["sea_name"] == "南海东南部"
    assert result["sea_name_en"] == "South China Sea"
    assert "Philippines part" not in repr(result)


def test_marine_context_keeps_obis_evidence_and_caveats(monkeypatch) -> None:
    monkeypatch.setattr(marine_context, "_marine_regions", lambda *_: ([], "gazetteer timeout"))
    monkeypatch.setattr(
        marine_context,
        "_obis_fisheries",
        lambda *_: ([{
            "scientific_name": "Auxis thazard",
            "chinese_name": "扁舵鲣",
            "taxon_group": "Actinopteri",
            "evidence_count": 3,
            "latest_year": 2024,
            "evidence_kind": "nearby_observation",
            "source_url": "https://api.obis.org/",
        }], {
            "biodiversity_total_records": 100,
            "scanned_records": 100,
            "results_complete": True,
            "fishery_occurrence_records": 12,
            "fishery_species_count": 4,
            "search_radius_km": 100.0,
        }, None),
    )
    result = marine_context.get_marine_context(120.0, 20.0, force_refresh=True)
    assert result["sea_name"] == "南海"
    assert result["place_source"] == "本地海域索引"
    assert result["fisheries_total_records"] == 12
    assert result["fisheries"][0]["scientific_name"] == "Auxis thazard"
    assert result["fisheries_species_count"] == 4
    assert result["fisheries_scanned_records"] == 100
    assert result["errors"] == ["gazetteer timeout"]
    assert result["caveats"]


def test_fisheries_require_species_rank_asfis_match_and_real_distance(monkeypatch) -> None:
    records = [
        {
            "id": "one",
            "dataset_id": "dataset-a",
            "marine": True,
            "occurrenceStatus": "present",
            "scientificName": "Acanthurus lineatus",
            "scientificNameAuthorship": "(Linnaeus, 1758)",
            "species": "Acanthurus lineatus",
            "speciesid": 219640,
            "aphiaID": 219640,
            "decimalLongitude": 120.1,
            "decimalLatitude": 20.0,
            "date_year": 2023,
            "class": "Actinopteri",
            "order": "Acanthuriformes",
            "family": "Acanthuridae",
        },
        {
            "id": "two",
            "dataset_id": "dataset-b",
            "marine": True,
            "occurrenceStatus": "present",
            "scientificName": "Acanthurus lineatus",
            "species": "Acanthurus lineatus",
            "speciesid": 219640,
            "decimalLongitude": 120.2,
            "decimalLatitude": 20.0,
            "date_year": 2025,
            "class": "Actinopteri",
            "order": "Acanthuriformes",
            "family": "Acanthuridae",
        },
        {
            "id": "family-only",
            "dataset_id": "dataset-c",
            "marine": True,
            "scientificName": "Epitoniidae",
            "decimalLongitude": 120.0,
            "decimalLatitude": 20.0,
        },
        {
            "id": "not-asfis",
            "dataset_id": "dataset-d",
            "marine": True,
            "occurrenceStatus": "present",
            "scientificName": "Calycopsis bigelowi",
            "species": "Calycopsis bigelowi",
            "speciesid": 284297,
            "decimalLongitude": 120.0,
            "decimalLatitude": 20.0,
            "date_year": 2024,
        },
    ]
    monkeypatch.setattr(marine_context, "_http_json", lambda *_args, **_kwargs: {"total": 4, "results": records})
    monkeypatch.setattr(
        marine_context,
        "_worms_vernaculars",
        lambda *_: {"chinese": "横纹刺尾鱼", "english": "Lined surgeonfish"},
    )

    resources, stats, error = marine_context._obis_fisheries(120.0, 20.0)

    assert error is None
    assert len(resources) == 1
    resource = resources[0]
    assert resource["scientific_name"] == "Acanthurus lineatus"
    assert resource["taxon_rank"] == "species"
    assert resource["fao_alpha3_code"] == "AQI"
    assert resource["fao_fishstat_data"] is True
    assert resource["dataset_count"] == 2
    assert resource["first_year"] == 2023
    assert resource["latest_year"] == 2025
    assert 10.0 < resource["minimum_distance_km"] < 12.0
    assert "鱼类/贝类/甲壳类等渔业相关类群" not in resource.values()
    assert stats["fishery_occurrence_records"] == 2
    assert stats["fishery_species_count"] == 1
    assert stats["results_complete"] is True


def test_search_geometry_handles_antimeridian_and_distance_is_geodesic() -> None:
    assert marine_context._search_geometry(179.8, 5.0, 100.0).startswith("MULTIPOLYGON")
    distance = marine_context._haversine_km(179.8, 0.0, -179.8, 0.0)
    assert 44.0 < distance < 45.0


def test_offline_species_index_adds_exact_traceable_chinese_names() -> None:
    index = marine_context._species_chinese_index()  # noqa: SLF001

    assert len(index) >= 8_500
    assert index["thunnus albacares"]["name"] == "黄鳍金枪鱼"
    assert index["nomeus gronovii"]["name"] == "水母双鳍鲳"
    assert index["thunnus albacares"]["source_url"].startswith("https://www.wikidata.org/entity/")
    assert index["flavocaranx bajad"]["name"] == "橙点若鲹"
    assert index["flavocaranx bajad"]["source_name"] == "FishBase 官方中文名称表"
    assert index["flavocaranx bajad"]["source_url"].startswith("https://www.fishbase.se/summary/")


def test_offline_chinese_name_precedes_worms_network_fallback(monkeypatch) -> None:
    record = {
        "id": "yellowfin",
        "dataset_id": "dataset-a",
        "marine": True,
        "occurrenceStatus": "present",
        "scientificName": "Thunnus albacares",
        "species": "Thunnus albacares",
        "speciesid": 127029,
        "decimalLongitude": 120.0,
        "decimalLatitude": 20.0,
        "date_year": 2025,
        "class": "Actinopteri",
        "order": "Scombriformes",
        "family": "Scombridae",
    }
    monkeypatch.setattr(marine_context, "_http_json", lambda *_args, **_kwargs: {"total": 1, "results": [record]})
    monkeypatch.setattr(
        marine_context,
        "_worms_vernaculars",
        lambda *_args: (_ for _ in ()).throw(AssertionError("offline Chinese name should avoid a WoRMS request")),
    )

    resources, _stats, error = marine_context._obis_fisheries(120.0, 20.0)

    assert error is None
    assert resources[0]["chinese_name"] == "黄鳍金枪鱼"
    assert str(resources[0]["chinese_name_source"]).startswith("Wikidata P225")
    assert str(resources[0]["chinese_name_source_url"]).startswith("https://www.wikidata.org/entity/")


def test_fisheries_returns_more_than_legacy_twelve_species_without_unbounded_worms_calls(monkeypatch) -> None:
    species_count = 30
    records = [
        {
            "id": f"record-{index}",
            "dataset_id": f"dataset-{index % 3}",
            "marine": True,
            "occurrenceStatus": "present",
            "scientificName": f"Testus species{index}",
            "species": f"Testus species{index}",
            "speciesid": 100_000 + index,
            "decimalLongitude": 120.0 + index / 10_000,
            "decimalLatitude": 20.0,
            "date_year": 2025,
            "class": "Actinopteri",
            "order": "Testiformes",
            "family": "Testidae",
        }
        for index in range(species_count)
    ]
    asfis = {
        str(record["species"]).casefold(): {
            "Scientific_name": record["species"],
            "Chinese_name": "",
            "English_name": "",
            "Alpha3_Code": f"T{index:02d}",
            "ISSCAAP_Group": "33",
            "FishStat_Data": "YES",
            "Family": "TESTIDAE",
            "Order or higher taxa": "TESTIFORMES",
            "Author": "",
        }
        for index, record in enumerate(records)
    }
    worms_calls: list[int] = []
    monkeypatch.setattr(marine_context, "_http_json", lambda *_args, **_kwargs: {"total": species_count, "results": records})
    monkeypatch.setattr(marine_context, "_asfis_index", lambda: asfis)
    monkeypatch.setattr(
        marine_context,
        "_worms_vernaculars",
        lambda aphia_id: worms_calls.append(aphia_id) or {"chinese": None, "english": None},
    )

    resources, stats, error = marine_context._obis_fisheries(120.0, 20.0)

    assert error is None
    assert len(resources) == species_count
    assert len(resources) > 12
    assert stats["fishery_species_count"] == species_count
    assert len(worms_calls) == marine_context.WORMS_VERNACULAR_LOOKUP_LIMIT
