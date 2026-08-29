from collections import Counter
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from app.main import app
from app.models import LiteratureReference, LiteratureSearchResponse


client = TestClient(app)


def test_health_and_metrics() -> None:
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["event_count"] == 18

    metrics = client.get("/api/metrics")
    assert metrics.status_code == 200
    assert metrics.json()["active_events"] >= 1
    assert metrics.json()["coverage_percent"] is None
    assert metrics.json()["coverage_basis"] == "undefined"


def test_event_catalog_has_balanced_type_coverage() -> None:
    response = client.get("/api/events")
    assert response.status_code == 200
    events = response.json()
    assert len(events) == 18
    assert len({event["id"] for event in events}) == len(events)
    assert all(event["validation_state"] == "scenario" for event in events)
    assert Counter(event["type"] for event in events) == {
        "marine_heatwave": 3,
        "phytoplankton_bloom": 3,
        "eddy": 3,
        "carbon_anomaly": 3,
        "cold_anomaly": 3,
        "current_anomaly": 3,
    }


def test_events_are_sorted_and_traceable() -> None:
    response = client.get("/api/events")
    assert response.status_code == 200
    events = response.json()
    assert events[0]["severity"] >= events[-1]["severity"]

    detail = client.get(f"/api/events/{events[0]['id']}")
    assert detail.status_code == 200
    payload = detail.json()
    evidence_ids = {item["id"] for item in payload["evidence"]}
    reference_ids = {item["id"] for item in payload["references"]}
    assert evidence_ids
    assert reference_ids
    assert all(set(step["evidence_ids"]) <= evidence_ids for step in payload["reasoning_chain"])
    assert all(step["reference_ids"] for step in payload["reasoning_chain"])
    assert all(set(step["reference_ids"]) <= reference_ids for step in payload["reasoning_chain"])


def test_event_literature_is_traceable() -> None:
    response = client.get("/api/events/NWP-2026-0817-BLOOM-02")
    assert response.status_code == 200
    references = response.json()["references"]
    assert len(references) >= 3
    assert any(reference["doi"] == "10.13155/46601" for reference in references)
    assert all(reference["citation"] and reference["relevance"] for reference in references)
    assert all(reference["variables"] for reference in references)

    for summary in client.get("/api/events").json():
        event = client.get(f"/api/events/{summary['id']}").json()
        reference_ids = {reference["id"] for reference in event["references"]}
        assert len(reference_ids) >= 2
        assert all(set(step["reference_ids"]) <= reference_ids for step in event["reasoning_chain"])


def test_report_references_event_evidence() -> None:
    for event in client.get("/api/events").json():
        event_id = event["id"]
        report = client.get(f"/api/events/{event_id}/report")
        assert report.status_code == 200
        payload = report.json()
        assert payload["event_id"] == event_id
        assert payload["evidence_ids"]


def test_detection_uses_scientific_model() -> None:
    start = datetime(2026, 8, 15, tzinfo=UTC)
    observations = [
        {
            "timestamp": (start + timedelta(days=index)).isoformat(),
            "value": value,
            "baseline": 26.0,
        }
        for index, value in enumerate([25.8, 25.9, 26.1, 26.2, 26.3, 26.4, 26.5])
    ]
    response = client.post(
        "/api/detect",
        json={
            "variable": "SST",
            "latitude": 36.4,
            "longitude": 151.8,
            "baseline_kind": "climatological_upper_threshold",
            "observations": observations,
        },
    )
    assert response.status_code == 200
    result = response.json()
    assert result["detected"] is True
    assert result["event_type"] == "marine_heatwave"


def test_argo_endpoint_rejects_invalid_platform_without_network() -> None:
    response = client.get("/api/argo/float/not-a-float")
    assert response.status_code == 502
    assert "Argo 浮标编号" in response.json()["detail"]


def test_nearest_argo_endpoint_validates_map_coordinates_without_network() -> None:
    response = client.get("/api/argo/nearest?longitude=181&latitude=20")
    assert response.status_code == 422


def test_regions_expose_multiple_operational_areas() -> None:
    response = client.get("/api/regions")
    assert response.status_code == 200
    regions = response.json()
    assert len(regions) >= 6
    assert {item["id"] for item in regions} >= {
        "northwest_pacific",
        "south_china_sea",
        "indian_ocean",
        "north_atlantic",
        "global_ocean",
    }
    assert all(len(item["bounds"]) == 2 for item in regions)


def test_event_explanation_api_is_evidence_traceable() -> None:
    event_id = client.get("/api/events").json()[0]["id"]
    response = client.get(f"/api/events/{event_id}/explanation")
    assert response.status_code == 200
    explanation = response.json()
    assert explanation["event_id"] == event_id
    assert explanation["provider"] in {"external_api", "evidence_engine"}
    assert explanation["evidence_ids"]
    assert explanation["findings"]


def test_event_literature_endpoint_uses_realtime_search_and_refresh(monkeypatch) -> None:
    calls: list[tuple[str, bool]] = []

    def fake_search(event, *, force_refresh: bool = False) -> LiteratureSearchResponse:
        calls.append((event.id, force_refresh))
        return LiteratureSearchResponse(
            event_id=event.id,
            query="South China Sea phytoplankton bloom chlorophyll",
            provider="OpenAlex",
            searched_at=datetime.now(UTC),
            total=1,
            cached=False,
            results=[
                LiteratureReference(
                    id="OPENALEX-W123",
                    title="Realtime scholarly result",
                    citation="Researcher. Realtime scholarly result. Ocean Journal.",
                    year=2026,
                    doi="10.1234/realtime",
                    relevance="当前事件上下文实时检索匹配。",
                    variables=["CHLA"],
                    provider="OpenAlex",
                    url="https://doi.org/10.1234/realtime",
                    authors="Researcher",
                    journal="Ocean Journal",
                    cited_by_count=12,
                    open_access=True,
                )
            ],
        )

    monkeypatch.setattr("app.main.search_literature", fake_search)
    response = client.get("/api/events/NWP-2026-0817-BLOOM-02/literature?refresh=true")

    assert response.status_code == 200
    payload = response.json()
    assert calls == [("NWP-2026-0817-BLOOM-02", True)]
    assert payload["provider"] == "OpenAlex"
    assert payload["query"] == "South China Sea phytoplankton bloom chlorophyll"
    assert payload["results"][0]["id"] == "OPENALEX-W123"
