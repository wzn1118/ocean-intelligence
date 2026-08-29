from datetime import UTC, datetime
from types import SimpleNamespace

from app.data import realtime_service


def _event(
    event_id: str,
    kind: str,
    severity: float,
    timestamp: str,
    *,
    centroid: tuple[float, float] = (-30.0, 30.0),
    sources: list[str] | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=event_id,
        event_kind=kind,
        severity=severity,
        centroid=centroid,
        sources=sources or ["NOAA_SST"],
        source_updated_at=datetime.fromisoformat(timestamp).replace(tzinfo=UTC),
        started_at=datetime.fromisoformat(timestamp).replace(tzinfo=UTC),
    )


def test_event_queue_orders_anomalies_by_severity_and_observations_by_recency() -> None:
    events = [
        _event("observation-old-high-priority", "observation", 0.99, "2026-08-22T12:00:00"),
        _event("anomaly-moderate", "anomaly", 0.60, "2026-08-24T05:00:00"),
        _event("observation-latest", "observation", 0.20, "2026-08-24T06:00:00"),
        _event("anomaly-severe", "anomaly", 0.90, "2026-08-23T05:00:00"),
    ]

    ordered = sorted(events, key=realtime_service._event_queue_sort_key, reverse=True)  # noqa: SLF001

    assert [event.id for event in ordered] == [
        "anomaly-severe",
        "anomaly-moderate",
        "observation-latest",
        "observation-old-high-priority",
    ]


def test_event_queue_prioritizes_china_marine_and_copernicus_records() -> None:
    events = [
        _event("foreign-anomaly", "anomaly", 0.95, "2026-08-28T01:00:00"),
        _event(
            "china-noaa",
            "observation",
            0.20,
            "2026-08-28T00:00:00",
            centroid=(113.8, 22.2),
        ),
        _event(
            "china-copernicus",
            "observation",
            0.20,
            "2026-08-27T23:00:00",
            centroid=(108.916221, 21.106730),
            sources=["COPERNICUS_WIND"],
        ),
    ]

    ordered = sorted(events, key=realtime_service._event_queue_sort_key, reverse=True)  # noqa: SLF001

    assert [event.id for event in ordered] == ["china-copernicus", "china-noaa", "foreign-anomaly"]


def test_event_queue_prioritizes_taiwan_coastal_copernicus_event() -> None:
    events = [
        _event("foreign-copernicus", "anomaly", 0.98, "2026-08-28T05:00:00", sources=["Copernicus Marine"]),
        _event(
            "taiwan-coastal-copernicus",
            "observation",
            0.20,
            "2026-08-28T04:00:00",
            centroid=(122.2, 23.5),
            sources=["Copernicus Marine 全球海面风场"],
        ),
    ]

    ordered = sorted(events, key=realtime_service._event_queue_sort_key, reverse=True)  # noqa: SLF001

    assert [event.id for event in ordered] == ["taiwan-coastal-copernicus", "foreign-copernicus"]


def test_global_copernicus_pages_start_with_china_coastal_latitudes() -> None:
    first_two_tiles = realtime_service.GLOBAL_COPERNICUS_PAGE_TILES[:2]

    assert all(bounds[0][1] == 0.0 and bounds[1][1] == 35.0 for bounds in first_two_tiles)
    assert ((120.0, 0.0), (180.0, 35.0)) in first_two_tiles
