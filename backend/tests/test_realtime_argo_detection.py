from app.data import realtime_service


REGION = {
    "id": "northwest_pacific",
    "name": "中国近海及西北太平洋",
    "short_name": "西北太平洋",
}


def _sample(
    platform: str,
    longitude: float,
    latitude: float,
    salinity: float,
    *,
    salinity_qc: float = 1.0,
    pressure: float = 5.0,
    value_mode: str | None = "raw",
) -> dict:
    return {
        "platform": platform,
        "source": {"url": f"https://example.test/argo/{platform}"},
        "latest": {
            "cycle": 1,
            "timestamp": "2026-08-21T00:00:00Z",
            "longitude": longitude,
            "latitude": latitude,
            "position_qc": 1.0,
            "timestamp_qc": 1.0,
            "surface_modes": {"salinity": value_mode} if value_mode is not None else {},
            "surface": {
                "salinity": salinity,
                "salinity_qc": salinity_qc,
                "salinity_pressure": pressure,
            },
        },
    }


def test_high_latitude_fresh_surface_water_is_not_compared_with_subtropics() -> None:
    samples = [
        _sample("5906354", 177.7081, 48.6594, 32.695),
        _sample("4903505", 162.0577, 50.3036, 32.559),
        _sample("5906939", 153.9, 46.4, 32.797),
        _sample("4902938", 176.6, 51.0, 32.726),
        _sample("7000001", 145.0, 30.0, 34.41),
        _sample("7000002", 146.0, 31.0, 34.44),
        _sample("7000003", 147.0, 29.5, 34.39),
        _sample("7000004", 148.0, 30.5, 34.42),
    ]

    events = realtime_service._argo_events(REGION, samples, len(samples))  # noqa: SLF001

    assert not [event for event in events if event.variables == ["SALINITY"]]


def test_local_qc_checked_salinity_outlier_is_detected() -> None:
    samples = [
        _sample("8000001", 150.0, 35.0, 34.40),
        _sample("8000002", 150.5, 35.2, 34.42),
        _sample("8000003", 149.5, 34.8, 34.39),
        _sample("8000004", 150.2, 35.1, 33.70),
    ]

    events = realtime_service._argo_events(REGION, samples, len(samples))  # noqa: SLF001
    salinity_events = [event for event in events if event.variables == ["SALINITY"]]

    assert len(salinity_events) == 1
    assert salinity_events[0].id.startswith("SIG-ARGO-SALINITY-8000004")
    assert salinity_events[0].evidence[0].baseline == 34.40
    assert "3 个邻近浮标" in salinity_events[0].evidence[0].method
    assert salinity_events[0].validation_state == "screening"
    assert salinity_events[0].status == "watch"
    assert salinity_events[0].affected_area_km2 is None
    assert salinity_events[0].confidence <= 0.68
    assert salinity_events[0].evidence[0].qc_pass_fraction == 1.0
    assert salinity_events[0].evidence[0].value_mode == "raw"
    assert "原始值" in salinity_events[0].evidence[0].method


def test_bad_qc_surface_value_is_excluded_from_detection() -> None:
    samples = [
        _sample("9000001", 150.0, 35.0, 34.40),
        _sample("9000002", 150.5, 35.2, 34.42),
        _sample("9000003", 149.5, 34.8, 34.39),
        _sample("9000004", 150.2, 35.1, 31.00, salinity_qc=4.0),
    ]

    events = realtime_service._argo_events(REGION, samples, len(samples))  # noqa: SLF001

    assert not [event for event in events if event.variables == ["SALINITY"]]


def test_unknown_surface_value_mode_is_excluded_from_detection() -> None:
    samples = [
        _sample("9100001", 150.0, 35.0, 34.40),
        _sample("9100002", 150.5, 35.2, 34.42),
        _sample("9100003", 149.5, 34.8, 34.39),
        _sample("9100004", 150.2, 35.1, 33.70, value_mode=None),
    ]

    events = realtime_service._argo_events(REGION, samples, len(samples))  # noqa: SLF001

    assert not [event for event in events if event.variables == ["SALINITY"]]
