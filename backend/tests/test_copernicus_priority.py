from datetime import UTC, datetime
from collections import OrderedDict

import pandas as pd

from app.data import copernicus_client
from app.data.china_coastal_areas import lookup_china_marine_area


def _cached_point(grid_longitude: float, grid_latitude: float) -> dict[str, object]:
    return {
        "longitude": grid_longitude,
        "latitude": grid_latitude,
        "requested_longitude": grid_longitude,
        "requested_latitude": grid_latitude,
        "grid_longitude": grid_longitude,
        "grid_latitude": grid_latitude,
        "grid_distance_km": 0.0,
        "records": [{"timestamp": "2026-08-28T00:00:00Z"}],
    }


def test_wave_point_reuses_nearby_cached_grid(monkeypatch) -> None:
    cache: OrderedDict[tuple[int, int, float, float], tuple[float, dict[str, object]]] = OrderedDict()
    monkeypatch.setattr(copernicus_client, "_wave_point_cache", cache)
    monkeypatch.setattr(copernicus_client, "COPERNICUS_USERNAME", "user")
    monkeypatch.setattr(copernicus_client, "COPERNICUS_PASSWORD", "password")
    monkeypatch.setattr(
        copernicus_client,
        "_copernicusmarine_client",
        lambda: (_ for _ in ()).throw(AssertionError("cache hit should avoid a remote client")),
    )
    copernicus_client._store_point_result(  # noqa: SLF001
        cache,
        days=1,
        forecast_hours=0,
        result=_cached_point(120.0, 20.0),
    )

    result = copernicus_client.get_wave_point(120.02, 20.01, days=1)

    assert result["longitude"] == 120.02
    assert result["latitude"] == 20.01
    assert result["grid_longitude"] == 120.0
    assert result["grid_latitude"] == 20.0
    assert result["grid_distance_km"] > 0


def test_wind_point_does_not_reuse_different_grid(monkeypatch) -> None:
    cache: OrderedDict[tuple[int, int, float, float], tuple[float, dict[str, object]]] = OrderedDict()
    monkeypatch.setattr(copernicus_client, "_wind_point_cache", cache)
    copernicus_client._store_point_result(  # noqa: SLF001
        cache,
        days=1,
        forecast_hours=0,
        result=_cached_point(120.0, 20.0),
    )

    result = copernicus_client._cached_point_result(  # noqa: SLF001
        cache,
        longitude=120.08,
        latitude=20.0,
        days=1,
        forecast_hours=0,
        resolution=0.125,
    )

    assert result is None


def test_latest_grid_points_put_china_marine_samples_first() -> None:
    timestamp = datetime(2026, 8, 28, tzinfo=UTC)
    frame = pd.DataFrame({
        "longitude": [-40.0, -30.0, -20.0, -10.0, 10.0, 20.0, 108.9, 113.8, 119.5, 121.3, 114.0],
        "latitude": [30.0, 25.0, 20.0, 15.0, 10.0, 5.0, 21.1, 22.2, 24.0, 30.4, 12.0],
        "time": [timestamp] * 11,
        "VHM0": [1.0] * 11,
    })

    point_count, points, _ = copernicus_client._latest_grid_points(  # noqa: SLF001
        frame,
        variables=["VHM0"],
        required_variables=["VHM0"],
        prioritize_china_marine=True,
        display_point_limit=7,
    )

    assert point_count == 11
    assert len(points) == 7
    assert all(lookup_china_marine_area(point["longitude"], point["latitude"]) for point in points[:5])
    assert all(lookup_china_marine_area(point["longitude"], point["latitude"]) is None for point in points[5:])


def test_latest_grid_points_fills_display_quota_with_china_marine_samples() -> None:
    timestamp = datetime(2026, 8, 28, tzinfo=UTC)
    frame = pd.DataFrame({
        "longitude": [-40.0, -30.0, 108.9, 113.8, 119.5, 121.3, 114.0],
        "latitude": [30.0, 25.0, 21.1, 22.2, 24.0, 30.4, 12.0],
        "time": [timestamp] * 7,
        "VHM0": [1.0] * 7,
    })

    _, points, _ = copernicus_client._latest_grid_points(  # noqa: SLF001
        frame,
        variables=["VHM0"],
        required_variables=["VHM0"],
        prioritize_china_marine=True,
        display_point_limit=4,
    )

    assert len(points) == 4
    assert all(lookup_china_marine_area(point["longitude"], point["latitude"]) for point in points)


def test_global_initial_and_paged_regions_enable_china_marine_priority() -> None:
    assert copernicus_client._prioritize_china_marine_for_region("global_ocean_china_initial")  # noqa: SLF001
    assert copernicus_client._prioritize_china_marine_for_region("global_ocean_tile_00")  # noqa: SLF001
