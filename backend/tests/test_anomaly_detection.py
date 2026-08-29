from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def _payload(
    anomalies: list[float],
    *,
    baseline_kind: str = "climatological_upper_threshold",
    reverse: bool = False,
    spacing_hours: int = 24,
) -> dict:
    start = datetime(2026, 8, 1, tzinfo=UTC)
    observations = [
        {
            "timestamp": (start + timedelta(hours=spacing_hours * index)).isoformat(),
            "value": 20.0 + anomaly,
            "baseline": 20.0,
        }
        for index, anomaly in enumerate(anomalies)
    ]
    if reverse:
        observations.reverse()
    return {
        "variable": "SST",
        "unit": "degC",
        "baseline_kind": baseline_kind,
        "latitude": 35,
        "longitude": 150,
        "observations": observations,
    }


def test_detector_sorts_observations_and_requires_trailing_persistence() -> None:
    response = client.post("/api/detect", json=_payload([-0.2, -0.1, 0.1, 0.2, 0.3, 0.4, 0.5], reverse=True))

    assert response.status_code == 200
    result = response.json()
    assert result["detected"] is True
    assert result["anomaly"] == 0.5
    assert result["persistence_count"] == 5
    assert result["temporal_span_hours"] == 144.0
    assert result["persistence_span_hours"] == 96.0
    assert result["cadence_valid"] is True


def test_detector_recognizes_persistent_cold_anomaly() -> None:
    response = client.post(
        "/api/detect",
        json=_payload([0.2, 0.1, -0.1, -0.2, -0.3, -0.4, -0.5], baseline_kind="climatological_lower_threshold"),
    )

    assert response.status_code == 200
    result = response.json()
    assert result["detected"] is True
    assert result["event_type"] == "cold_anomaly"
    assert result["validation_state"] == "corroborated"


def test_single_spike_and_short_time_window_do_not_create_event() -> None:
    spike = client.post("/api/detect", json=_payload([-0.1, -0.1, -0.1, -0.1, -0.1, -0.1, 2.6])).json()
    short = client.post(
        "/api/detect",
        json=_payload([-0.2, -0.1, 0.1, 0.2, 0.3, 0.4, 0.5], spacing_hours=6),
    ).json()

    assert spike["detected"] is False
    assert spike["persistence_count"] == 1
    assert short["detected"] is False
    assert short["temporal_span_hours"] == 36.0


def test_non_climatology_sst_stays_a_screening_anomaly() -> None:
    result = client.post(
        "/api/detect",
        json=_payload([0.2, 0.4, 1.2, 1.3, 1.5, 1.8, 2.0], baseline_kind="spatial_screen"),
    ).json()

    assert result["detected"] is True
    assert result["event_type"] == "surface_temperature_anomaly"
    assert result["validation_state"] == "screening"
    assert result["severity"] <= 0.69
    assert result["confidence"] <= 0.68


def test_climatology_mean_is_not_mislabeled_as_a_marine_heatwave_threshold() -> None:
    result = client.post(
        "/api/detect",
        json=_payload([0.2, 0.4, 1.2, 1.3, 1.5, 1.8, 2.0], baseline_kind="climatology"),
    ).json()

    assert result["detected"] is True
    assert result["event_type"] == "surface_temperature_anomaly"
    assert result["validation_state"] == "screening"


def test_negative_sea_level_anomaly_can_screen_a_cyclonic_eddy() -> None:
    start = datetime(2026, 8, 1, tzinfo=UTC)
    response = client.post(
        "/api/detect",
        json={
            "variable": "SLA",
            "unit": "m",
            "baseline_kind": "reference_series",
            "latitude": 28,
            "longitude": 136,
            "observations": [
                {
                    "timestamp": (start + timedelta(days=index)).isoformat(),
                    "value": anomaly,
                    "baseline": 0,
                }
                for index, anomaly in enumerate([-0.03, -0.08, -0.14, -0.20, -0.25])
            ],
        },
    )

    assert response.status_code == 200
    result = response.json()
    assert result["detected"] is True
    assert result["event_type"] == "eddy"
    assert result["validation_state"] == "screening"


def test_invalid_time_and_unit_contracts_are_rejected() -> None:
    duplicate = _payload([0.2, 0.4, 1.2, 1.3, 1.5, 1.8, 2.0])
    duplicate["observations"][1]["timestamp"] = duplicate["observations"][0]["timestamp"]
    wrong_unit = _payload([0.2, 0.4, 1.2, 1.3, 1.5, 1.8, 2.0])
    wrong_unit["unit"] = "kelvin"
    naive_time = _payload([0.2, 0.4, 1.2, 1.3, 1.5, 1.8, 2.0])
    naive_time["observations"][0]["timestamp"] = "2026-08-01T00:00:00"

    assert client.post("/api/detect", json=duplicate).status_code == 422
    assert client.post("/api/detect", json=wrong_unit).status_code == 422
    assert client.post("/api/detect", json=naive_time).status_code == 422
