from datetime import UTC, datetime, timedelta

from app.data import realtime_service


REGION = {
    "id": "northwest_pacific",
    "name": "西北太平洋",
    "short_name": "西北太平洋",
}


def _snapshot(daily_values: list[list[float]]) -> dict:
    start = datetime(2026, 8, 18, 12, tzinfo=UTC)
    points = []
    for day_index, values in enumerate(daily_values):
        timestamp = (start + timedelta(days=day_index)).isoformat().replace("+00:00", "Z")
        points.extend(
            {
                "timestamp": timestamp,
                "latitude": 35.0 + (index % 2) * 0.25,
                "longitude": 150.0 + index * 0.3,
                "temperature": value,
                "analysis_error": 0.1,
                "mask": 1,
                "sea_ice_fraction": 0.0,
                "quality_valid": True,
            }
            for index, value in enumerate(values)
        )
    return {
        "point_count": len(points),
        "time_count": len(daily_values),
        "quality_fields_complete": True,
        "quality_valid_count": len(points),
        "latest_point_count": len(daily_values[-1]),
        "source": {"url": "https://example.test/noaa"},
        "points": points,
    }


def test_noaa_persistent_local_outlier_is_only_a_screening_candidate() -> None:
    events = realtime_service._sst_events(  # noqa: SLF001
        REGION,
        _snapshot(
            [
                [20.0, 20.1, 19.9, 20.2, 20.0, 20.1, 23.0],
                [20.1, 20.2, 20.0, 20.3, 20.1, 20.2, 23.2],
                [20.2, 20.3, 20.1, 20.4, 20.2, 20.3, 23.4],
            ]
        ),
    )

    assert len(events) == 1
    event = events[0]
    assert event.validation_state == "screening"
    assert event.status == "watch"
    assert event.affected_area_km2 is None
    assert event.confidence <= 0.68
    assert event.evidence[0].sample_count == 3
    assert event.evidence[0].temporal_span_hours == 48
    assert event.evidence[0].spatial_peer_count == 6
    assert event.evidence[0].measurement_uncertainty == 0.1
    assert event.evidence[0].comparison_uncertainty == 0.141
    assert event.evidence[0].value_mode == "analysis"
    assert len(event.evidence[0].series) == 3
    assert "连续 3 天" in event.summary
    assert "短期连续日时次" in event.uncertainty


def test_single_day_outlier_and_smooth_gradient_do_not_create_events() -> None:
    single_day = realtime_service._sst_events(  # noqa: SLF001
        REGION,
        _snapshot(
            [
                [20.0, 20.1, 19.9, 20.2, 20.0, 20.1, 20.2],
                [20.1, 20.2, 20.0, 20.3, 20.1, 20.2, 20.3],
                [20.2, 20.3, 20.1, 20.4, 20.2, 20.3, 24.0],
            ]
        ),
    )
    smooth = realtime_service._sst_events(  # noqa: SLF001
        REGION,
        _snapshot(
            [
                [20.0, 20.1, 20.2, 20.3, 20.4, 20.5, 20.6],
                [20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7],
                [20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8],
            ]
        ),
    )

    assert single_day == []
    assert smooth == []


def test_incomplete_or_failed_quality_fields_block_noaa_events() -> None:
    incomplete = _snapshot([[20, 20, 20, 20, 20, 20, 23]] * 3)
    incomplete["quality_fields_complete"] = False
    failed = _snapshot([[20, 20, 20, 20, 20, 20, 23]] * 3)
    for point in failed["points"]:
        if point["longitude"] == 151.8:
            point["quality_valid"] = False

    assert realtime_service._sst_events(REGION, incomplete) == []  # noqa: SLF001
    assert realtime_service._sst_events(REGION, failed) == []  # noqa: SLF001


def test_high_analysis_uncertainty_blocks_an_apparent_persistent_outlier() -> None:
    snapshot = _snapshot(
        [
            [20.0, 20.1, 19.9, 20.2, 20.0, 20.1, 22.0],
            [20.1, 20.2, 20.0, 20.3, 20.1, 20.2, 22.1],
            [20.2, 20.3, 20.1, 20.4, 20.2, 20.3, 22.2],
        ]
    )
    for point in snapshot["points"]:
        if point["longitude"] == 151.8:
            point["analysis_error"] = 0.8

    assert realtime_service._sst_events(REGION, snapshot) == []  # noqa: SLF001
