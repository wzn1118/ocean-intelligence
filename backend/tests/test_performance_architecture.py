from datetime import UTC, datetime
import json
from threading import Event, Timer
from time import monotonic, sleep

from fastapi.testclient import TestClient

from app import refresh_jobs
from app.data import realtime_service
from app.main import app


client = TestClient(app)


def _observation_summary() -> dict:
    now = datetime.now(UTC).isoformat()
    return {
        "region_id": "northwest_pacific",
        "region": "Northwest Pacific",
        "generated_at": now,
        "bounds": [[100, 0], [179, 60]],
        "observation_count": 0,
        "source_count": 1,
        "float_count": 0,
        "bgc_float_count": 0,
        "sampled_profile_count": 0,
        "profile_request_failures": 0,
        "profile_success_fraction": None,
        "median_profile_depth": None,
        "maximum_profile_depth": None,
        "sst_lookback_days": 0,
        "sst_daily_steps": 0,
        "sst_latest_grid_count": 0,
        "noaa_quality_valid_count": 0,
        "noaa_point_count": 0,
        "noaa_quality_pass_fraction": None,
        "quality_fields_complete": False,
        "adjusted_surface_fraction": None,
        "latest_observation_at": None,
        "screening_event_count": 0,
        "variables": [],
        "sst_timeline": [],
        "conclusion": {
            "state": "no_candidate",
            "headline": "No candidate triggered in this screening cycle",
            "summary": "No external request is used in this contract test.",
            "evidence": [],
            "interpretation_scope": ["fixture"],
            "screening_rules": ["screen"],
        },
    }


def test_workspace_snapshot_collapses_first_screen_contract(monkeypatch) -> None:
    now = datetime.now(UTC).isoformat()
    calls = 0

    def fake_bundle(region_id: str, *, force_refresh: bool = False) -> dict:
        nonlocal calls
        calls += 1
        assert region_id == "northwest_pacific"
        assert force_refresh is False
        return {
            "events": [],
            "sources": [
                {
                    "id": "argo_core",
                    "name": "Argo",
                    "category": "in_situ",
                    "status": "cached",
                    "observation_count": 0,
                    "checked_at": now,
                    "detail": "contract fixture",
                }
            ],
            "observation_count": 0,
            "observation_summary": _observation_summary(),
            "argo_region": None,
            "refreshed_at": now,
            "errors": [],
            "cache": {"state": "fresh", "age_seconds": 1.0},
        }

    monkeypatch.setattr("app.main.get_realtime_bundle", fake_bundle)
    response = client.get("/api/workspace/snapshot?region=northwest_pacific")

    assert response.status_code == 200
    assert calls == 1
    assert response.json()["region"]["id"] == "northwest_pacific"
    assert response.json()["metrics"]["observation_count"] == 0
    assert response.json()["observations"]["conclusion"]["state"] == "no_candidate"
    assert response.headers["x-request-id"]
    assert float(response.headers["x-response-time-ms"]) >= 0


def test_performance_endpoint_reports_route_latency() -> None:
    client.get("/api/health")
    response = client.get("/api/performance")

    assert response.status_code == 200
    payload = response.json()
    assert payload["total_requests"] >= 1
    assert "/api/health" in payload["routes"]
    assert payload["routes"]["/api/health"]["count"] >= 1


def test_large_api_responses_are_compressed_without_changing_payload() -> None:
    response = client.get("/api/marine/atlas", headers={"Accept-Encoding": "gzip"})

    assert response.status_code == 200
    assert response.headers["content-encoding"] == "gzip"
    assert response.json()["count"] > 0


def test_workspace_snapshot_etag_skips_unchanged_response_body(monkeypatch) -> None:
    now = datetime.now(UTC).isoformat()

    def fake_bundle(region_id: str, *, force_refresh: bool = False) -> dict:
        assert region_id == "northwest_pacific"
        assert force_refresh is False
        return {
            "events": [],
            "sources": [],
            "observation_count": 0,
            "observation_summary": _observation_summary(),
            "argo_region": None,
            "refreshed_at": now,
            "errors": [],
            "cache": {"state": "fresh", "age_seconds": 1.0},
        }

    monkeypatch.setattr("app.main.get_realtime_bundle", fake_bundle)
    first = client.get("/api/workspace/snapshot?region=northwest_pacific")
    second = client.get(
        "/api/workspace/snapshot?region=northwest_pacific",
        headers={"If-None-Match": first.headers["etag"]},
    )

    assert first.status_code == 200
    assert first.headers["cache-control"] == "private, max-age=0, must-revalidate"
    assert second.status_code == 304
    assert second.content == b""
    assert second.headers["etag"] == first.headers["etag"]


def test_background_refresh_coalesces_same_region(monkeypatch) -> None:
    release = Event()
    calls = 0
    region_id = "coalesce-test-region"

    def fake_bundle(requested_region: str, *, force_refresh: bool = False) -> dict:
        nonlocal calls
        calls += 1
        assert requested_region == region_id
        assert force_refresh is True
        release.wait(timeout=2)
        return {
            "events": [],
            "sources": [],
            "observation_count": 0,
            "refreshed_at": datetime.now(UTC).isoformat(),
            "errors": [],
        }

    monkeypatch.setattr(refresh_jobs, "get_realtime_bundle", fake_bundle)
    first = refresh_jobs.enqueue_refresh(region_id)
    second = refresh_jobs.enqueue_refresh(region_id)
    assert first["job_id"] == second["job_id"]
    release.set()

    deadline = monotonic() + 2
    job = refresh_jobs.get_refresh_job(first["job_id"])
    while job and job["status"] in {"queued", "running"} and monotonic() < deadline:
        sleep(0.01)
        job = refresh_jobs.get_refresh_job(first["job_id"])

    assert calls == 1
    assert job is not None
    assert job["status"] == "completed"


def test_persisted_stale_snapshot_returns_immediately_and_revalidates(monkeypatch, tmp_path) -> None:
    region_id = "northwest_pacific"
    bundle = {
        "events": [],
        "sources": [],
        "observation_count": 0,
        "observation_summary": _observation_summary(),
        "argo_region": None,
        "refreshed_at": datetime.now(UTC).isoformat(),
        "errors": [],
    }
    monkeypatch.setattr(realtime_service, "REALTIME_CACHE_DIR", tmp_path)
    realtime_service._persist_bundle(region_id, bundle)  # noqa: SLF001
    cache_path = realtime_service._persistent_cache_path(region_id)  # noqa: SLF001
    document = json.loads(cache_path.read_text(encoding="utf-8"))
    document["saved_at"] = 1
    cache_path.write_text(json.dumps(document), encoding="utf-8")
    with realtime_service._cache_lock:  # noqa: SLF001
        realtime_service._cache.pop(region_id, None)  # noqa: SLF001
    scheduled: list[str] = []
    monkeypatch.setattr(realtime_service, "_schedule_revalidation", scheduled.append)

    result = realtime_service.get_realtime_bundle(region_id)

    assert result["cache"]["state"] == "stale"
    assert result["observation_count"] == 0
    assert scheduled == [region_id]
    with realtime_service._cache_lock:  # noqa: SLF001
        realtime_service._cache.pop(region_id, None)  # noqa: SLF001


def test_previous_persisted_snapshot_format_is_rejected(monkeypatch, tmp_path) -> None:
    region_id = "northwest_pacific"
    bundle = {
        "events": [],
        "sources": [],
        "observation_count": 0,
        "observation_summary": _observation_summary(),
        "argo_region": None,
        "refreshed_at": datetime.now(UTC).isoformat(),
        "errors": [],
    }
    monkeypatch.setattr(realtime_service, "REALTIME_CACHE_DIR", tmp_path)
    realtime_service._persist_bundle(region_id, bundle)  # noqa: SLF001
    cache_path = realtime_service._persistent_cache_path(region_id)  # noqa: SLF001
    document = json.loads(cache_path.read_text(encoding="utf-8"))
    document["format_version"] = 2
    cache_path.write_text(json.dumps(document), encoding="utf-8")

    loaded = realtime_service._load_persisted_bundle(region_id)  # noqa: SLF001

    assert loaded is None


def test_stale_snapshot_read_does_not_wait_for_refresh_region_lock(monkeypatch) -> None:
    region_id = "global_ocean"
    bundle = {
        "events": [],
        "sources": [],
        "observation_count": 7,
        "observation_summary": _observation_summary(),
        "argo_region": None,
        "refreshed_at": datetime.now(UTC).isoformat(),
        "errors": [],
    }
    with realtime_service._cache_lock:  # noqa: SLF001
        realtime_service._cache[region_id] = (  # noqa: SLF001
            monotonic() - realtime_service.REALTIME_CACHE_TTL_SECONDS - 1,
            bundle,
        )
    scheduled: list[str] = []
    monkeypatch.setattr(realtime_service, "_schedule_revalidation", scheduled.append)
    region_lock = realtime_service._region_lock(region_id)  # noqa: SLF001
    region_lock.acquire()
    fallback_release = Timer(0.4, region_lock.release)
    fallback_release.start()
    started = monotonic()
    try:
        result = realtime_service.get_realtime_bundle(region_id)
    finally:
        elapsed = monotonic() - started
        if region_lock.locked():
            region_lock.release()
        fallback_release.cancel()
        with realtime_service._cache_lock:  # noqa: SLF001
            realtime_service._cache.pop(region_id, None)  # noqa: SLF001

    assert elapsed < 0.2
    assert result["observation_count"] == 7
    assert result["cache"]["state"] == "stale"
    assert scheduled == [region_id]
