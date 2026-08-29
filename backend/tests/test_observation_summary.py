from app.data import realtime_service
from app.models import RegionalObservationSummary


REGION = {
    "id": "northwest_pacific",
    "name": "中国近海及西北太平洋",
    "bounds": ((100.0, 0.0), (179.0, 60.0)),
}


def _sample(platform: str, temperature: float, temperature_mode: str, depth: float, salinity: float | None) -> dict:
    return {
        "platform": platform,
        "latest": {
            "max_pressure": depth,
            "surface": {
                "temperature": temperature,
                "temperature_qc": 1.0,
                "salinity": salinity,
                "salinity_qc": 1.0 if salinity is not None else None,
                "chla": None,
                "chla_qc": None,
                "nitrate": None,
                "nitrate_qc": None,
            },
            "surface_modes": {
                "temperature": temperature_mode,
                "salinity": "raw" if salinity is not None else "unavailable",
                "chla": "unavailable",
                "nitrate": "unavailable",
            },
        },
    }


def test_regional_summary_exposes_time_variable_quality_and_depth_dimensions() -> None:
    samples = [
        _sample("A", 10.0, "raw", 1000.0, 34.5),
        _sample("B", 12.0, "adjusted", 2000.0, None),
    ]
    noaa = {
        "latest_observation_at": "2026-08-20T12:00:00Z",
        "lookback_days": 7,
        "time_count": 2,
        "latest_point_count": 2,
        "quality_valid_count": 3,
        "point_count": 4,
        "quality_fields_complete": True,
        "points": [
            {"timestamp": "2026-08-19T12:00:00Z", "temperature": 20.0, "quality_valid": True},
            {"timestamp": "2026-08-20T12:00:00Z", "temperature": 21.0, "quality_valid": True},
            {"timestamp": "2026-08-20T12:00:00Z", "temperature": 23.0, "quality_valid": True},
            {"timestamp": "2026-08-20T12:00:00Z", "temperature": 99.0, "quality_valid": False},
        ],
    }
    argo_region = {
        "profile_count": 40,
        "float_count": 20,
        "bgc_float_count": 4,
        "latest_observation_at": "2026-08-21T01:00:00Z",
    }

    payload = realtime_service._regional_observation_summary(  # noqa: SLF001
        REGION,
        argo_region,
        samples,
        1,
        noaa,
        24,
        3,
        0,
    )
    summary = RegionalObservationSummary(**payload)
    variables = {item.id: item for item in summary.variables}

    assert summary.observation_count == 24
    assert summary.argo_profile_count == 40
    assert summary.profile_success_fraction == 0.6667
    assert summary.median_profile_depth == 1500.0
    assert summary.maximum_profile_depth == 2000.0
    assert summary.noaa_quality_pass_fraction == 0.75
    assert summary.adjusted_surface_fraction == 0.3333
    assert len(summary.sst_timeline) == 2
    assert summary.sst_timeline[-1].median == 22.0
    assert variables["SST"].available_count == 2
    assert variables["SST"].value_mode == "analysis"
    assert variables["TEMPERATURE"].value_mode == "mixed"
    assert variables["SALINITY"].availability_fraction == 0.5
    assert variables["CHLA"].value_mode == "unavailable"
    assert summary.conclusion.state == "no_candidate"
    assert summary.conclusion.headline == "本轮实时筛查未触发异常候选"
    assert summary.conclusion.interpretation_scope
    assert summary.conclusion.screening_rules


def test_regional_summary_counts_qc_bgc_depth_points() -> None:
    samples = [
        {
            "latest": {
                "points": [
                    {"pressure": 5.0, "nitrate": 1.0, "nitrate_qc": 1.0, "nitrate_mode": "raw"},
                    {"pressure": 50.0, "nitrate": 4.0, "nitrate_qc": 1.0, "nitrate_mode": "adjusted"},
                    {"pressure": 100.0, "nitrate": 8.0, "nitrate_qc": 4.0, "nitrate_mode": "raw"},
                ],
                "surface": {"nitrate": 1.0},
                "position_qc": 1.0,
                "timestamp_qc": 1.0,
                "longitude": 140.0,
                "latitude": 30.0,
            }
        }
    ]
    payload = realtime_service._regional_observation_summary(REGION, None, samples, 0, None, 2, 1, 0)  # noqa: SLF001
    nitrate = next(item for item in payload["variables"] if item["id"] == "NITRATE")

    assert nitrate["available_count"] == 2
    assert nitrate["total_count"] == 3
    assert nitrate["value_mode"] == "mixed"


def test_summary_preserves_unavailable_dimensions_instead_of_zero_filling() -> None:
    payload = realtime_service._regional_observation_summary(  # noqa: SLF001
        REGION,
        None,
        [],
        0,
        None,
        0,
        0,
        0,
    )
    summary = RegionalObservationSummary(**payload)

    assert summary.latest_observation_at is None
    assert summary.profile_success_fraction is None
    assert summary.noaa_quality_pass_fraction is None
    assert summary.median_profile_depth is None
    assert all(item.median is None for item in summary.variables)
    assert summary.conclusion.state == "no_candidate"
    conclusion_text = " ".join(
        [
            summary.conclusion.headline,
            summary.conclusion.summary,
            *summary.conclusion.evidence,
            *summary.conclusion.interpretation_scope,
            *summary.conclusion.screening_rules,
        ]
    )
    for prohibited in ("数据受限", "覆盖不足", "待补充", "暂不形成", "后续监测", "结论边界"):
        assert prohibited not in conclusion_text


def test_ready_multisource_summary_distinguishes_no_candidate_from_candidate_present() -> None:
    samples = [
        _sample(str(index), 10.0 + index, "raw", 1900.0 + index, 34.0 + index / 10)
        for index in range(4)
    ]
    noaa = {
        "latest_observation_at": "2026-08-20T12:00:00Z",
        "lookback_days": 7,
        "time_count": 3,
        "latest_point_count": 6,
        "quality_valid_count": 3,
        "point_count": 3,
        "quality_fields_complete": True,
        "points": [
            {"timestamp": f"2026-08-{day:02d}T12:00:00Z", "temperature": 20.0 + day / 10, "quality_valid": True}
            for day in (18, 19, 20)
        ],
    }
    argo_region = {
        "float_count": 20,
        "bgc_float_count": 4,
        "latest_observation_at": "2026-08-21T01:00:00Z",
    }

    quiet = RegionalObservationSummary(
        **realtime_service._regional_observation_summary(  # noqa: SLF001
            REGION, argo_region, samples, 0, noaa, 23, 3, 0
        )
    )
    candidate = RegionalObservationSummary(
        **realtime_service._regional_observation_summary(  # noqa: SLF001
            REGION, argo_region, samples, 0, noaa, 23, 3, 2
        )
    )

    assert quiet.conclusion.state == "no_candidate"
    assert "未触发" in quiet.conclusion.headline
    assert len(quiet.conclusion.evidence) >= 3
    assert candidate.conclusion.state == "candidate_present"
    assert "2 个" in candidate.conclusion.headline
