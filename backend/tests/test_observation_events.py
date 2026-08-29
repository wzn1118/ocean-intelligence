from datetime import UTC, datetime, timedelta

from app.agents.explanation import _evidence_explanation
from app.agents.report_generation import ReportGenerationAgent
from app.agents.science_reasoning import OceanScienceReasoningAgent
from app.data import realtime_service


REGION = {
    "id": "northwest_pacific",
    "name": "中国近海及西北太平洋",
    "short_name": "西北太平洋",
    "center": (137.0, 30.0),
}


def test_event_area_name_prefers_specific_china_coastal_water() -> None:
    global_region = {"id": "global_ocean", "short_name": "全球海洋"}
    assert realtime_service._plain_area_name(global_region, 21.106730, 108.916221) == "北部湾"  # noqa: SLF001
    assert realtime_service._plain_area_name(global_region, 22.2, 113.8) == "珠江口"  # noqa: SLF001
    assert realtime_service._plain_area_name(global_region, 24.0, 119.5) == "中国台湾海峡"  # noqa: SLF001
    assert realtime_service._plain_area_name(global_region, 12.0, 114.0) == "南海"  # noqa: SLF001


def _argo_sample(platform: str, offset: float) -> dict:
    timestamp = (datetime(2026, 8, 20, tzinfo=UTC) + timedelta(hours=offset)).isoformat().replace("+00:00", "Z")
    return {
        "platform": platform,
        "source": {"url": f"https://example.test/argo/{platform}"},
        "latest": {
            "cycle": 12,
            "timestamp": timestamp,
            "longitude": 145.0 + offset,
            "latitude": 30.0 + offset / 5,
            "position_qc": 1.0,
            "timestamp_qc": 1.0,
            "surface_modes": {
                "temperature": "raw",
                "salinity": "raw",
                "chla": "adjusted",
                "nitrate": "adjusted",
            },
            "surface": {
                "temperature": 25.0 + offset / 10,
                "temperature_qc": 1.0,
                "temperature_pressure": 5.0,
                "salinity": 34.5 + offset / 100,
                "salinity_qc": 1.0,
                "salinity_pressure": 5.0,
                "chla": 0.15 + offset / 100,
                "chla_qc": 1.0,
                "chla_pressure": 5.0,
                "nitrate": 1.2 + offset / 10,
                "nitrate_qc": 1.0,
                "nitrate_pressure": 5.0,
            },
        },
    }


def _noaa_snapshot() -> dict:
    points = []
    for day in range(3):
        timestamp = (datetime(2026, 8, 18, 12, tzinfo=UTC) + timedelta(days=day)).isoformat().replace("+00:00", "Z")
        for index, temperature in enumerate((25.0 + day / 10, 25.3 + day / 10, 25.6 + day / 10)):
            points.append(
                {
                    "timestamp": timestamp,
                    "latitude": 30.0 + index,
                    "longitude": 145.0 + index,
                    "temperature": temperature,
                    "analysis_error": 0.12,
                    "quality_valid": True,
                }
            )
    return {
        "latest_observation_at": "2026-08-20T12:00:00Z",
        "point_count": len(points),
        "time_count": 3,
        "latest_point_count": 3,
        "quality_valid_count": len(points),
        "quality_fields_complete": True,
        "lookback_days": 7,
        "cache": {"state": "fresh"},
        "source": {
            "url": "https://example.test/noaa",
            "dataset_url": "https://example.test/noaa",
        },
        "points": points,
    }


def _woa_snapshot(count: int = 120) -> dict:
    return {
        "points": [
            {
                "longitude": 105.5 + (index % 10),
                "latitude": 5.5 + (index % 12),
                "depth": float((index % 20) * 50),
                "nitrate": 0.5 + index / 10,
            }
            for index in range(count)
        ],
        "available_count": count,
        "source": {
            "name": "NOAA World Ocean Atlas 2023 nitrate climatology",
            "url": "https://example.test/woa23",
            "period": "1965-2022",
            "resolution": "1 degree",
        },
        "latest_observation_at": "2022-12-31T00:00:00Z",
    }


def test_argo_routine_observations_are_qc_grounded_and_not_anomalies() -> None:
    samples = [_argo_sample(str(index), float(index)) for index in range(4)]

    events = realtime_service._argo_observation_events(REGION, samples, 40)  # noqa: SLF001

    assert len(events) == 16
    assert {event.variables[0] for event in events} == {"TEMPERATURE", "SALINITY", "CHLA", "NITRATE"}
    assert len({event.id for event in events}) == len(events)
    assert all(event.event_kind == "observation" for event in events)
    assert all(event.validation_state == "observed" for event in events)
    assert all(event.evidence[0].validation_state == "observed" for event in events)
    assert all(event.evidence[0].anomaly == 0 for event in events)
    assert all(event.evidence[0].sample_count == 1 for event in events)

    salinity = next(event for event in events if event.variables == ["SALINITY"] and "-ARGO-1-C12-" in event.id)
    OceanScienceReasoningAgent().validate(salinity)
    assert salinity.event_kind == "observation"
    assert salinity.evidence[0].observed == 34.51

    report = ReportGenerationAgent().create(salinity)
    explanation = _evidence_explanation(salinity)
    assert report.title.startswith("观测记录：")
    assert "质量检查已通过" in report.situation
    assert "通过质量检查" in explanation.summary
    assert "异常候选" not in explanation.headline
    assert not {"该条目", "本轮", "系统记录", "观测锚点"} & set(explanation.summary.split())


def test_nutrient_queue_uses_qc_profile_depth_points_and_keeps_one_hundred(monkeypatch) -> None:
    samples = [_argo_sample(str(index), float(index)) for index in range(2)]
    for sample_index, sample in enumerate(samples):
        sample["latest"]["points"] = [
            {
                "pressure": float(point_index * 10),
                "nitrate": float(sample_index * 100 + point_index) / 10,
                "nitrate_qc": 1.0,
                "nitrate_mode": "adjusted",
                "chla": None,
                "chla_qc": None,
                "chla_mode": None,
            }
            for point_index in range(60)
        ]
    monkeypatch.setattr(realtime_service, "ARGO_NUTRIENT_EVENT_LIMIT", 100)

    events = realtime_service._argo_observation_events(REGION, samples, 120)  # noqa: SLF001
    nitrate_events = [event for event in events if event.variables == ["NITRATE"]]

    assert len(nitrate_events) == 100
    assert len({event.id for event in nitrate_events}) == 100
    assert all("-NITRATE-P" in event.id for event in nitrate_events)
    assert all(event.event_kind == "observation" for event in nitrate_events)
    assert all(event.evidence[0].validation_state == "observed" for event in nitrate_events)
    assert all(event.evidence[0].qc_pass_fraction == 1.0 for event in nitrate_events)


def test_noaa_routine_observations_preserve_each_qc_valid_grid_record() -> None:
    events = realtime_service._sst_observation_events(REGION, _noaa_snapshot())  # noqa: SLF001

    assert len(events) == 9
    assert len({event.id for event in events}) == len(events)
    event = events[0]
    assert event.type == "surface_observation"
    assert event.event_kind == "observation"
    assert event.validation_state == "observed"
    assert event.evidence[0].observed == 25.8
    assert event.evidence[0].sample_count == 1
    assert len(event.evidence[0].series) == 3
    assert all(item.evidence[0].qc_pass_fraction == 1 for item in events)


def test_noaa_event_stream_exposes_at_least_one_hundred_real_observations() -> None:
    snapshot = _noaa_snapshot()
    template = snapshot["points"]
    points = []
    for batch in range(12):
        for point in template:
            points.append(
                {
                    **point,
                    "latitude": point["latitude"] + batch * 0.01,
                    "longitude": point["longitude"] + batch * 0.01,
                }
            )
    snapshot["points"] = points
    snapshot["point_count"] = len(points)
    snapshot["quality_valid_count"] = len(points)

    events = realtime_service._sst_observation_events(REGION, snapshot)  # noqa: SLF001

    assert len(events) >= 100
    assert len(events) == len(points)
    assert len({event.id for event in events}) == len(events)
    assert all(event.event_kind == "observation" for event in events)
    assert all(event.evidence[0].validation_state == "observed" for event in events)
    assert all(event.evidence[0].anomaly == 0 for event in events)


def test_observation_filter_coverage_does_not_reclassify_measurements_as_anomalies() -> None:
    events = [
        *realtime_service._sst_observation_events(REGION, _noaa_snapshot()),  # noqa: SLF001
        *realtime_service._argo_observation_events(  # noqa: SLF001
            REGION,
            [_argo_sample(str(index), float(index)) for index in range(4)],
            40,
        ),
    ]
    original_records = [
        (event.id, event.type, event.title, event.summary, tuple(event.variables))
        for event in events
    ]

    coverage = realtime_service._observation_filter_coverage(events)  # noqa: SLF001

    anomaly_only_types = {
        "marine_heatwave",
        "cold_anomaly",
        "surface_temperature_anomaly",
        "phytoplankton_bloom",
        "chlorophyll_anomaly",
        "salinity_anomaly",
        "nutrient_anomaly",
    }
    assert coverage["surface_temperature"] > 0
    assert coverage["salinity"] > 0
    assert [
        (event.id, event.type, event.title, event.summary, tuple(event.variables))
        for event in events
    ] == original_records
    assert all(event.event_kind == "observation" for event in events)
    assert all(event.validation_state == "observed" for event in events)
    assert all(event.evidence[0].anomaly == 0 for event in events)
    assert all(event.type not in anomaly_only_types for event in events)
    assert all(not any(term in event.title for term in ("异常", "热浪", "藻华", "涡旋", "低温")) for event in events)


def test_current_and_carbon_measurements_use_neutral_observation_types() -> None:
    current_events = realtime_service._current_observation_events(  # noqa: SLF001
        REGION,
        {
            "point_count": 1,
            "points": [{
                "timestamp": "2026-08-25T00:00:00Z",
                "longitude": 142.0,
                "latitude": 25.0,
                "speed": 0.18,
                "direction": 45.0,
            }],
            "cache": {"state": "fresh"},
        },
    )
    carbon_events = realtime_service._carbon_observation_events(  # noqa: SLF001
        REGION,
        {
            "available_count": 1,
            "latest_observation_at": "2025-12-15T00:00:00Z",
            "points": [{"longitude": 142.0, "latitude": 25.0, "pco2": 365.0}],
        },
    )

    assert len(current_events) == 1
    assert current_events[0].type == "surface_observation"
    assert current_events[0].variables == ["CURRENT"]
    assert carbon_events[0].type == "biogeochemical_observation"
    assert carbon_events[0].variables == ["PCO2"]
    assert all(event.event_kind == "observation" for event in current_events + carbon_events)
    assert all(not any(term in event.title for term in ("异常", "涡旋", "热浪")) for event in current_events + carbon_events)


def test_noaa_dense_grid_keeps_all_measurements_but_bounds_event_projection(monkeypatch) -> None:
    snapshot = _noaa_snapshot()
    snapshot["points"] = [
        {
            **point,
            "latitude": point["latitude"] + batch * 0.01,
            "longitude": point["longitude"] + batch * 0.01,
        }
        for batch in range(12)
        for point in snapshot["points"]
    ]
    snapshot["point_count"] = len(snapshot["points"])
    snapshot["quality_valid_count"] = len(snapshot["points"])
    monkeypatch.setattr(realtime_service, "NOAA_OBSERVATION_EVENT_LIMIT", 20)

    events = realtime_service._sst_observation_events(REGION, snapshot)  # noqa: SLF001

    assert snapshot["point_count"] == 108
    assert len(events) == 20
    assert all(event.observation_count == 108 for event in events)
    assert len({event.id for event in events}) == 20


def test_chlorophyll_observation_projection_has_its_own_larger_limit(monkeypatch) -> None:
    monkeypatch.setattr(realtime_service, "NOAA_CHLA_OBSERVATION_EVENT_LIMIT", 720)
    snapshot = {
        "point_count": 900,
        "cache": {"state": "fresh"},
        "points": [
            {
                "timestamp": "2026-08-21T12:00:00Z",
                "latitude": 1.0 + index * 0.001,
                "longitude": 120.0 + index * 0.001,
                "chlorophyll": 0.1 + index / 10_000,
            }
            for index in range(900)
        ],
    }

    events = realtime_service._chlorophyll_observation_events(REGION, snapshot)  # noqa: SLF001

    assert len(events) == 720
    assert len({event.id for event in events}) == 720
    assert all(event.variables == ["CHLA"] for event in events)
    assert all(event.event_kind == "observation" for event in events)
    assert all(event.observation_count == 900 for event in events)


def test_chlorophyll_candidate_ids_distinguish_opposite_clusters_in_one_coarse_grid() -> None:
    points = [
        {
            "timestamp": "2026-08-21T12:00:00Z",
            "latitude": float(index),
            "longitude": 120.0 + index,
            "chlorophyll_anomaly": 0.0,
        }
        for index in range(16)
    ]
    points.extend(
        [
            {"timestamp": "2026-08-21T12:00:00Z", "latitude": 1.0, "longitude": 121.0, "chlorophyll_anomaly": 1.0},
            {"timestamp": "2026-08-21T12:00:00Z", "latitude": 1.1, "longitude": 121.1, "chlorophyll_anomaly": 0.9},
            {"timestamp": "2026-08-21T12:00:00Z", "latitude": 1.0, "longitude": 121.0, "chlorophyll_anomaly": -1.0},
            {"timestamp": "2026-08-21T12:00:00Z", "latitude": 1.1, "longitude": 121.1, "chlorophyll_anomaly": -0.9},
        ]
    )
    snapshot = {
        "points": points,
        "point_count": len(points),
        "latitude_step_degrees": 1.0,
        "longitude_step_degrees": 1.0,
        "source": {"url": "https://example.test/noaa/chlorophyll"},
    }

    events = realtime_service._chlorophyll_events(REGION, snapshot)  # noqa: SLF001

    assert len(events) == 2
    assert len({event.id for event in events}) == 2
    assert {event.id.rsplit("-", 1)[-1] for event in events} == {"HI", "LO"}


def test_realtime_bundle_keeps_routine_events_when_no_anomaly_is_triggered(monkeypatch) -> None:
    samples = [_argo_sample(str(index), float(index)) for index in range(4)]
    argo_region = {
        "profile_count": 40,
        "float_count": 12,
        "bgc_float_count": 4,
        "latest_observation_at": "2026-08-20T03:00:00Z",
        "cache": {"state": "fresh"},
        "source": {
            "url": "https://example.test/argo",
            "gdac_url": "https://example.test/gdac",
        },
    }
    monkeypatch.setattr(realtime_service, "get_argo_region_samples", lambda **_: (argo_region, samples, 0))
    monkeypatch.setattr(realtime_service, "get_noaa_sst", lambda *_args, **_kwargs: _noaa_snapshot())
    monkeypatch.setattr(realtime_service, "get_noaa_chlorophyll_anomaly", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(realtime_service, "get_woa_nitrate", lambda *_args, **_kwargs: _woa_snapshot())

    bundle = realtime_service._build_bundle("northwest_pacific", False)  # noqa: SLF001

    assert bundle["events"]
    assert all(event.event_kind == "observation" for event in bundle["events"])
    assert bundle["observation_summary"]["screening_event_count"] == 0
    assert {event.variables[0] for event in bundle["events"]} >= {"SST", "TEMPERATURE", "SALINITY"}


def test_realtime_bundle_fills_sparse_nutrients_to_one_hundred_with_labeled_climatology(monkeypatch) -> None:
    samples = [_argo_sample("5900001", 0.0)]
    argo_region = {
        "profile_count": 40,
        "float_count": 12,
        "bgc_float_count": 1,
        "latest_observation_at": "2026-08-20T03:00:00Z",
        "cache": {"state": "fresh"},
        "source": {
            "url": "https://example.test/argo",
            "gdac_url": "https://example.test/gdac",
        },
    }
    monkeypatch.setattr(realtime_service, "get_argo_region_samples", lambda **_: (argo_region, samples, 0))
    monkeypatch.setattr(realtime_service, "get_noaa_sst", lambda *_args, **_kwargs: _noaa_snapshot())
    monkeypatch.setattr(realtime_service, "get_woa_nitrate", lambda *_args, **_kwargs: _woa_snapshot())

    bundle = realtime_service._build_bundle("northwest_pacific", False)  # noqa: SLF001
    nitrate_events = [event for event in bundle["events"] if event.variables == ["NITRATE"]]
    woa_events = [event for event in nitrate_events if event.sources == ["WOA23_NITRATE"]]
    woa_source = next(source for source in bundle["sources"] if source["id"] == "woa23_nitrate")

    assert len(nitrate_events) >= 100
    assert len(woa_events) == 120
    assert all(event.event_kind == "observation" for event in woa_events)
    assert all(event.data_mode == "cached" for event in woa_events)
    assert all("WOA23" in event.title for event in woa_events)
    assert woa_source["category"] == "reanalysis"
    assert woa_source["status"] == "cached"
