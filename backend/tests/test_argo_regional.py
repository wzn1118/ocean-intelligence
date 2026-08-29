from app.data import argo_client


def test_profile_cache_scopes_are_isolated() -> None:
    lifetime = argo_client._profile_cache_key("5906354", "lifetime")  # noqa: SLF001
    regional = argo_client._profile_cache_key("5906354", "regional_window")  # noqa: SLF001

    assert lifetime == "lifetime:5906354"
    assert regional == "regional_window:5906354"
    assert lifetime != regional


def test_surface_value_skips_bad_qc_and_records_its_pressure() -> None:
    points, surface, variable_modes, surface_modes = argo_client._profile_points(  # noqa: SLF001
        {
            "data_info": [["pressure", "salinity", "salinity_argoqc"]],
            "data": [[4.0, 8.0], [30.0, 32.7], [4, 1]],
        }
    )

    assert len(points) == 2
    assert surface["salinity"] == 32.7
    assert surface["salinity_qc"] == 1.0
    assert surface["salinity_pressure"] == 8.0
    assert variable_modes["salinity"] == "raw"
    assert surface_modes["salinity"] == "raw"


def test_adjusted_profile_value_takes_precedence_when_available() -> None:
    points, surface, variable_modes, surface_modes = argo_client._profile_points(  # noqa: SLF001
        {
            "data_info": [[
                "pressure",
                "salinity",
                "salinity_argoqc",
                "salinity_adjusted",
                "salinity_adjusted_argoqc",
            ]],
            "data": [[5.0], [34.1], [1], [34.25], [1]],
        }
    )

    assert surface["salinity"] == 34.25
    assert surface["salinity_qc"] == 1.0
    assert points[0]["salinity_mode"] == "adjusted"
    assert variable_modes["salinity"] == "adjusted"
    assert surface_modes["salinity"] == "adjusted"


def test_partially_missing_adjusted_values_fall_back_per_sample_without_losing_provenance() -> None:
    points, surface, variable_modes, surface_modes = argo_client._profile_points(  # noqa: SLF001
        {
            "data_info": [[
                "pressure",
                "salinity",
                "salinity_argoqc",
                "salinity_adjusted",
                "salinity_adjusted_argoqc",
            ]],
            "data": [
                [5.0, 100.0],
                [34.1, 34.5],
                [1, 1],
                [34.2, None],
                [1, None],
            ],
        }
    )

    assert [point["salinity"] for point in points] == [34.2, 34.5]
    assert [point["salinity_mode"] for point in points] == ["adjusted", "raw"]
    assert surface["salinity"] == 34.2
    assert surface_modes["salinity"] == "adjusted"
    assert variable_modes["salinity"] == "mixed"


def test_bad_adjusted_qc_falls_back_to_good_raw_sample() -> None:
    points, surface, variable_modes, surface_modes = argo_client._profile_points(  # noqa: SLF001
        {
            "data_info": [[
                "pressure",
                "salinity",
                "salinity_argoqc",
                "salinity_adjusted",
                "salinity_adjusted_argoqc",
            ]],
            "data": [[81.1], [34.884], [1], [35.9], [4]],
        }
    )

    assert points[0]["salinity"] == 34.884
    assert points[0]["salinity_qc"] == 1.0
    assert points[0]["salinity_mode"] == "raw"
    assert surface["salinity_pressure"] == 81.1
    assert variable_modes["salinity"] == "raw"
    assert surface_modes["salinity"] == "raw"


def test_profile_explanation_distinguishes_shallowest_sample_from_sea_surface() -> None:
    points, surface, variable_modes, surface_modes = argo_client._profile_points(  # noqa: SLF001
        {
            "data_info": [["pressure", "temperature", "temperature_argoqc", "salinity", "salinity_argoqc"]],
            "data": [[81.1, 500.0], [27.688, 9.447], [1, 1], [34.884, 34.212], [1, 1]],
        }
    )
    latest = {
        "cycle": 166,
        "timestamp": "2026-08-19T06:12:40.999Z",
        "latitude": 20.938,
        "longitude": 140.365,
        "max_pressure": 500.0,
        "surface": surface,
        "surface_modes": surface_modes,
        "variable_modes": variable_modes,
        "points": points,
        "source_urls": ["https://example.test/R7902333_166.nc"],
    }

    explanation = argo_client._explain_clean(  # noqa: SLF001
        "7902333",
        [latest],
        track=[
            {"cycle": 115, "timestamp": "2026-07-21T00:00:00Z"},
            {"cycle": 166, "timestamp": "2026-08-19T00:00:00Z"},
        ],
    )

    combined = " ".join([explanation["summary"], *explanation["findings"], *explanation["caveats"]])
    assert "81.1 dbar" in combined
    assert "最浅有效" in combined
    assert "不等同于海表观测" in combined
    assert "不能单独判定水团变化" in combined
    assert "盐度极小值为 34.212 PSU" in combined
    assert "中层低盐结构" in combined
    assert "实时模式 R 文件" in combined
    assert "源周期标识存在跳号" in combined
    assert "近表层海温" not in combined


def test_regional_row_is_normalized_and_identifies_bgc() -> None:
    row = argo_client._parse_regional_row(  # noqa: SLF001 - focused parser contract test
        [
            "5906518_152",
            144.7798,
            34.4579,
            "2026-08-14T17:57:17.001Z",
            ["argo_core", "argo_bgc"],
            ["5906518_m0"],
        ]
    )

    assert row is not None
    assert row["platform"] == "5906518"
    assert row["cycle"] == 152
    assert row["has_bgc"] is True


def test_regional_row_rejects_invalid_time_coordinates_and_cycle() -> None:
    assert argo_client._parse_regional_row(["5906518_152", 181, 34, "2026-08-14T00:00:00Z"]) is None  # noqa: SLF001
    assert argo_client._parse_regional_row(["5906518_152", 144, 34, "not-a-date"]) is None  # noqa: SLF001
    assert argo_client._parse_regional_row(["5906518_000", 144, 34, "2026-08-14T00:00:00Z"]) is None  # noqa: SLF001
    assert argo_client._parse_regional_row(["5906518_999", 144, 34, "2099-08-14T00:00:00Z"]) is None  # noqa: SLF001


def test_recent_observation_dates_keeps_all_profiles_on_selected_dates() -> None:
    profiles = [
        {"cycle": 60 + index, "timestamp": timestamp}
        for index, timestamp in enumerate(
            [
                "2026-06-18T04:00:00Z",
                "2026-06-28T04:00:00Z",
                "2026-07-08T04:00:00Z",
                "2026-07-18T04:00:00Z",
                "2026-07-28T04:00:00Z",
                "2026-08-07T04:00:00Z",
                "2026-08-17T04:00:00Z",
                "2026-08-27T04:00:00Z",
                "2026-08-27T18:00:00Z",
            ]
        )
    ]

    selected, observation_dates = argo_client._select_recent_observation_dates(profiles, 7)  # noqa: SLF001

    assert observation_dates == [
        "2026-06-28",
        "2026-07-08",
        "2026-07-18",
        "2026-07-28",
        "2026-08-07",
        "2026-08-17",
        "2026-08-27",
    ]
    assert [profile["cycle"] for profile in selected] == [61, 62, 63, 64, 65, 66, 67, 68]


def test_region_catalog_preserves_every_valid_profile_position(monkeypatch) -> None:
    monkeypatch.setattr(
        argo_client,
        "_get_json",
        lambda _endpoint: [
            ["5906518_151", 144.0, 34.0, "2026-08-10T00:00:00Z", ["argo_core"]],
            ["5906518_152", 145.0, 35.0, "2026-08-20T00:00:00Z", ["argo_core", "argo_bgc"]],
            ["7902333_010", 150.0, 30.0, "2026-08-18T00:00:00Z", ["argo_core"]],
            ["bad-profile", 150.0, 30.0, "2026-08-18T00:00:00Z", ["argo_core"]],
        ],
    )

    result = argo_client._fetch_region(  # noqa: SLF001
        "northwest_pacific",
        ((100.0, 0.0), (180.0, 60.0)),
        "test region",
    )

    assert result["profile_count"] == 3
    assert len(result["profiles"]) == result["profile_count"]
    assert [item["latest_profile_id"] for item in result["profiles"]] == [
        "5906518_152",
        "7902333_010",
        "5906518_151",
    ]
    assert result["float_count"] == 2
    assert result["floats"][0]["platform"] == "5906518"
    assert result["floats"][0]["profile_count"] == 2
    assert "_recent_track" not in result["profiles"][0]


def test_region_sample_selection_reserves_bgc_profiles_without_increasing_limit(monkeypatch) -> None:
    monkeypatch.setattr(argo_client, "ARGO_BGC_SAMPLE_TARGET", 2)
    floats = [
        {
            "platform": "CORE-1",
            "latitude": 30.0,
            "longitude": 140.0,
            "has_bgc": False,
        },
        {
            "platform": "CORE-2",
            "latitude": 31.0,
            "longitude": 141.0,
            "has_bgc": False,
        },
        {
            "platform": "BGC-1",
            "latitude": 45.0,
            "longitude": 160.0,
            "has_bgc": True,
        },
        {
            "platform": "BGC-2",
            "latitude": 50.0,
            "longitude": 170.0,
            "has_bgc": True,
        },
        {
            "platform": "CORE-3",
            "latitude": 55.0,
            "longitude": 175.0,
            "has_bgc": False,
        },
    ]

    selected = argo_client._select_region_sample_candidates(floats, 4)  # noqa: SLF001

    assert len(selected) == 4
    assert sum(item["has_bgc"] for item in selected) == 2
    assert {item["platform"] for item in selected[:2]} == {"BGC-1", "BGC-2"}


def test_region_sample_selection_uses_latest_catalog_timestamps(monkeypatch) -> None:
    monkeypatch.setattr(argo_client, "ARGO_BGC_SAMPLE_TARGET", 1)
    floats = [
        {
            "platform": "CORE-OLDER",
            "latitude": 8.0,
            "longitude": 12.0,
            "timestamp": "2026-08-23T02:00:00Z",
            "has_bgc": False,
        },
        {
            "platform": "CORE-LATEST",
            "latitude": 24.0,
            "longitude": 48.0,
            "timestamp": "2026-08-25T00:10:00Z",
            "has_bgc": False,
        },
        {
            "platform": "CORE-RECENT",
            "latitude": 40.0,
            "longitude": 84.0,
            "timestamp": "2026-08-24T23:40:00Z",
            "has_bgc": False,
        },
        {
            "platform": "BGC-LATEST",
            "latitude": 56.0,
            "longitude": 120.0,
            "timestamp": "2026-08-24T22:30:00Z",
            "has_bgc": True,
        },
        {
            "platform": "BGC-OLDER",
            "latitude": -24.0,
            "longitude": -120.0,
            "timestamp": "2026-08-22T00:00:00Z",
            "has_bgc": True,
        },
    ]

    selected = argo_client._select_region_sample_candidates(floats, 3)  # noqa: SLF001

    assert [item["platform"] for item in selected] == [
        "BGC-LATEST",
        "CORE-LATEST",
        "CORE-RECENT",
    ]


def test_event_matching_selects_nearest_float_in_event_radius(monkeypatch) -> None:
    region = {
        "float_count": 2,
        "floats": [
            {
                "platform": "1111111",
                "latest_profile_id": "1111111_010",
                "cycle": 10,
                "timestamp": "2026-08-20T00:00:00Z",
                "longitude": 151.9,
                "latitude": 36.4,
                "profile_count": 3,
                "networks": ["argo_core"],
                "has_bgc": False,
                "distance_km": None,
                "within_event_radius": False,
            },
            {
                "platform": "2222222",
                "latest_profile_id": "2222222_020",
                "cycle": 20,
                "timestamp": "2026-08-19T00:00:00Z",
                "longitude": 160.0,
                "latitude": 42.0,
                "profile_count": 4,
                "networks": ["argo_core", "argo_bgc"],
                "has_bgc": True,
                "distance_km": None,
                "within_event_radius": False,
            },
        ],
    }
    monkeypatch.setattr(argo_client, "get_argo_region", lambda **_: region)
    monkeypatch.setattr(
        argo_client,
        "_get_argo_float_from_region",
        lambda candidate, **_: {"platform": candidate["platform"]},
    )

    result = argo_client.get_event_argo(
        "EVENT-1",
        "Test event",
        (151.8, 36.4),
        100.0,
    )

    assert result["regional_float_count"] == 2
    assert result["matched_count"] == 1
    assert result["match_mode"] == "within_event"
    assert result["selected_platform"] == "1111111"
    assert result["snapshot"]["platform"] == "1111111"
    assert result["candidates"][0]["distance_km"] < 10
