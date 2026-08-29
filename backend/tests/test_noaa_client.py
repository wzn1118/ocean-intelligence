from datetime import UTC, datetime

from app.data import noaa_client
from app.data import realtime_service


def test_noaa_client_preserves_quality_metadata_and_filters_event_eligibility(monkeypatch) -> None:
    monkeypatch.setattr(
        noaa_client,
        "_latest_dataset_timestamp",
        lambda: datetime(2026, 8, 20, 12, tzinfo=UTC),
    )
    seen_endpoint: list[str] = []

    def fake_request(endpoint: str) -> dict:
        seen_endpoint.append(endpoint)
        return {
            "table": {
                "columnNames": [
                    "time",
                    "latitude",
                    "longitude",
                    "analysed_sst",
                    "analysis_error",
                    "mask",
                    "sea_ice_fraction",
                ],
                "rows": [
                    ["2026-08-20T12:00:00Z", 35.0, 150.0, 293.15, 0.2, 1, 0.0],
                    ["2026-08-20T12:00:00Z", 35.0, 151.0, 293.15, 0.2, 4, 0.5],
                    ["2026-08-20T12:00:00Z", 35.0, 152.0, 293.15, 6.0, 1, 0.0],
                    ["2026-08-20T12:00:00Z", 35.0, 153.0, 293.15, 0.2, 1, 0.2],
                ],
            }
        }

    monkeypatch.setattr(noaa_client, "_request_json", fake_request)

    snapshot = noaa_client._fetch_sst(  # noqa: SLF001
        "northwest_pacific",
        ((140.0, 30.0), (160.0, 40.0)),
    )

    assert snapshot["point_count"] == 4
    assert snapshot["quality_valid_count"] == 1
    assert snapshot["quality_fields_complete"] is True
    assert snapshot["native_resolution_degrees"] == 0.05
    assert snapshot["latitude_step_degrees"] > 0
    assert snapshot["longitude_step_degrees"] > 0
    assert snapshot["analysis_latitude_step_degrees"] >= snapshot["latitude_step_degrees"]
    assert snapshot["analysis_longitude_step_degrees"] >= snapshot["longitude_step_degrees"]
    assert snapshot["latest_point_count"] == len(snapshot["latest_points"])
    assert snapshot["points"][0]["temperature"] == 20.0
    assert snapshot["points"][0]["analysis_error"] == 0.2
    assert snapshot["points"][0]["quality_valid"] is True
    assert all(not point["quality_valid"] for point in snapshot["points"][1:])
    assert all(name in seen_endpoint[0] for name in ("analysis_error", "mask", "sea_ice_fraction"))
    assert len(seen_endpoint) == 2


def test_noaa_client_uses_coarse_latest_grid_when_dense_map_request_fails(monkeypatch) -> None:
    monkeypatch.setattr(
        noaa_client,
        "_latest_dataset_timestamp",
        lambda: datetime(2026, 8, 20, 12, tzinfo=UTC),
    )
    calls = 0

    def fake_request(_endpoint: str) -> dict:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise noaa_client.NoaaDataError("dense map timeout")
        return {
            "table": {
                "columnNames": ["time", "latitude", "longitude", "analysed_sst", "analysis_error", "mask", "sea_ice_fraction"],
                "rows": [["2026-08-20T12:00:00Z", 20.0, 140.0, 300.15, 0.2, 1, 0.0]],
            }
        }

    monkeypatch.setattr(noaa_client, "_request_json", fake_request)
    snapshot = noaa_client._fetch_sst("global_ocean", ((-179.0, -70.0), (179.0, 70.0)))  # noqa: SLF001

    assert calls == 2
    assert snapshot["latest_point_count"] == 1
    assert snapshot["latest_points"][0]["temperature"] == 27.0


def test_noaa_client_restores_persisted_snapshot_after_restart_and_timeout(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(noaa_client, "NOAA_CACHE_DIR", tmp_path)
    noaa_client._cache.clear()  # noqa: SLF001
    snapshot = {
        "region_id": "global_ocean",
        "latest_point_count": 1,
        "latest_points": [{"timestamp": "2026-08-20T12:00:00Z", "latitude": 20.0, "longitude": 140.0, "temperature": 27.0}],
        "point_count": 1,
    }
    monkeypatch.setattr(noaa_client, "_fetch_sst", lambda *_args, **_kwargs: snapshot.copy())
    first = noaa_client.get_noaa_sst("global_ocean", ((-179.0, -70.0), (179.0, 70.0)), force_refresh=True)
    assert first["cache"]["state"] == "fresh"
    assert (tmp_path / "global_ocean.json").exists()

    noaa_client._cache.clear()  # noqa: SLF001
    monkeypatch.setattr(
        noaa_client,
        "_fetch_sst",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(noaa_client.NoaaDataError("timeout")),
    )
    restored = noaa_client.get_noaa_sst("global_ocean", ((-179.0, -70.0), (179.0, 70.0)), force_refresh=True)
    assert restored["cache"]["state"] == "stale"
    assert restored["latest_point_count"] == 1


def test_workspace_refresh_retains_previous_noaa_snapshot_when_upstream_is_missing() -> None:
    previous = {
        "events": [],
        "sources": [{"id": "noaa_sst", "status": "live", "detail": "100 valid points"}],
        "observation_summary": {"sst_latest_grid_count": 100},
        "refreshed_at": "2026-08-20T12:00:00Z",
        "errors": [],
    }
    current = {
        "events": [],
        "sources": [{"id": "argo_core", "status": "live"}],
        "observation_summary": {"sst_latest_grid_count": 0},
        "refreshed_at": "2026-08-21T12:00:00Z",
        "errors": ["NOAA timeout"],
    }

    retained = realtime_service._retain_previous_noaa_snapshot(current, previous)  # noqa: SLF001

    assert retained["observation_summary"]["sst_latest_grid_count"] == 100
    assert retained["sources"][0]["status"] == "cached"
    assert retained["errors"] == ["NOAA timeout"]
