from datetime import UTC, datetime

from app.data import copernicus_client
from app.data.copernicus_client import _daily_dataset_volume
from app.main import app
from fastapi.testclient import TestClient


class _FakeVariable:
    def __init__(self, sizes: dict[str, int]) -> None:
        self.sizes = sizes


class _FakeCoordinate:
    def __init__(self, values: list[str]) -> None:
        self.values = values


class _FakeDataset:
    def __init__(self) -> None:
        self.data_vars = {
            "eastward_wind": _FakeVariable({"time": 2, "latitude": 3, "longitude": 4}),
            "northward_wind": _FakeVariable({"time": 2, "latitude": 3, "longitude": 4}),
        }
        self.coords = {"time": _FakeCoordinate(["2026-08-28T00:00:00Z", "2026-08-28T01:00:00Z"])}
        self.sizes = {"time": 2, "latitude": 3, "longitude": 4}

    def __getitem__(self, key: str) -> _FakeVariable:
        return self.data_vars[key]


def test_daily_dataset_volume_counts_full_grid_records_and_values() -> None:
    result = _daily_dataset_volume(
        _FakeDataset(),
        dataset_id="wind-test",
        product_id="wind-product",
        name="全球风场",
        requested_variables=["eastward_wind", "northward_wind"],
        data_date="2026-08-28",
        is_current_day=True,
    )

    assert result["time_count"] == 2
    assert result["spatial_point_count"] == 12
    assert result["record_count"] == 24
    assert result["value_count"] == 48
    assert result["latest_observation_at"] == "2026-08-28T01:00:00Z"
    assert result["date"] == "2026-08-28"
    assert result["is_current_day"] is True


def test_global_daily_volume_endpoint_returns_full_grid_summary(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.main.get_global_daily_data_volume",
        lambda force_refresh=False: {
            "date": "2026-08-28",
            "dataset_count": 1,
            "record_count": 24,
            "value_count": 48,
            "latest_observation_at": "2026-08-28T01:00:00Z",
            "fetched_at": "2026-08-28T01:01:00Z",
            "status": "live",
            "datasets": [{
                "dataset_id": "wind-test",
                "product_id": "wind-product",
                "name": "全球风场",
                "date": "2026-08-28",
                "is_current_day": True,
                "variable_count": 2,
                "time_count": 2,
                "spatial_point_count": 12,
                "record_count": 24,
                "value_count": 48,
                "latest_observation_at": "2026-08-28T01:00:00Z",
            }],
            "errors": [],
            "cache": {"state": "fresh", "age_seconds": 0.0},
        },
    )

    response = TestClient(app).get("/api/copernicus/global/daily-volume?refresh=true")

    assert response.status_code == 200
    assert response.json()["record_count"] == 24
    assert response.json()["datasets"][0]["spatial_point_count"] == 12


def test_global_daily_volume_excludes_delayed_products_from_today_total(monkeypatch) -> None:
    now = datetime(2026, 8, 28, 5, tzinfo=UTC)

    def fake_open_daily_global_volume(**kwargs):
        is_delayed = kwargs["name"] == "全球小时级海面风场"
        return {
            "dataset_id": kwargs["dataset_id"],
            "product_id": kwargs["product_id"],
            "name": kwargs["name"],
            "date": "2026-08-26" if is_delayed else "2026-08-28",
            "is_current_day": not is_delayed,
            "variable_count": len(kwargs["variables"]),
            "time_count": 1,
            "spatial_point_count": 10,
            "record_count": 10,
            "value_count": 20,
            "latest_observation_at": "2026-08-26T23:00:00Z" if is_delayed else "2026-08-28T05:00:00Z",
        }

    monkeypatch.setattr(copernicus_client, "_open_daily_global_volume", fake_open_daily_global_volume)
    monkeypatch.setattr(copernicus_client, "_global_daily_volume_cache", None)

    result = copernicus_client._compute_global_daily_data_volume(  # noqa: SLF001
        now,
        now.timestamp(),
        now.replace(hour=0),
    )

    assert result["dataset_count"] == 3
    assert result["record_count"] == 20
    assert result["value_count"] == 40
    assert result["status"] == "partial"
    assert any("2026-08-26" in error for error in result["errors"])
