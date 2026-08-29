from __future__ import annotations

from app.data import bathymetry


def precision_result(elevation: float, *, coverage: bool = True) -> dict[str, object]:
    return {
        "elevation": elevation,
        "horizontal_resolution_m": 96.0,
        "interpolation_method": "双线性插值",
        "high_resolution_coverage": coverage,
        "grid_node_count": 289,
        "micro_radius_m": 750.0,
        "micro_shallowest_depth_m": max(0.0, -elevation - 18.0),
        "micro_deepest_depth_m": max(0.0, -elevation + 22.0),
        "micro_relief_m": 40.0 if elevation < 0 else 0.0,
    }


def test_esri_ascii_bilinear_interpolation_targets_exact_coordinate() -> None:
    payload = b"""ncols 2
nrows 2
xllcorner 0
yllcorner 0
cellsize 1
NODATA_value -9999
10 20
30 40
"""
    grid = bathymetry._parse_esri_ascii(payload)

    assert bathymetry._grid_value_at(grid, 1.0, 1.0) == 25.0


def test_bathymetry_builds_depth_zone_and_local_relief(monkeypatch) -> None:
    requested_points: list[tuple[float, float]] = []

    def fake_elevation(longitude: float, latitude: float) -> float:
        requested_points.append((longitude, latitude))
        if latitude > 20.0:
            return -3550.0
        if latitude < 20.0:
            return -3410.0
        if longitude > 120.0:
            return -3890.0
        if longitude < 120.0:
            return -3725.0
        return -3626.0

    monkeypatch.setattr(bathymetry, "_gmrt_elevation", fake_elevation)
    monkeypatch.setattr(bathymetry, "_gmrt_high_resolution", lambda _longitude, _latitude: precision_result(-3626.4))
    monkeypatch.setattr(bathymetry, "_gebco_elevations", lambda _points: {"center": -3624.0})

    result = bathymetry._build_result(120.0, 20.0)

    assert result["water_depth_m"] == 3626.4
    assert result["seafloor_elevation_m"] == -3626.4
    assert result["depth_zone"] == "abyssal"
    assert result["depth_zone_name"] == "深海带"
    assert result["query_radius_m"] == 0.0
    assert result["value_basis"] == "bilinear_grid_interpolation"
    assert result["shallowest_depth_m"] == 3626.4
    assert result["deepest_depth_m"] == 3626.4
    assert result["local_relief_m"] == 0.0
    assert result["sample_count"] == 1
    assert requested_points == [(120.0, 20.0)]
    assert result["provider"] == "GMRT 100 m GridServer"
    assert result["precision_mode"] == "gmrt_100m_grid"
    assert result["horizontal_resolution_m"] == 96.0
    assert result["source_difference_m"] == 2.4
    assert result["confidence"] == "high"


def test_bathymetry_marks_land_without_inventing_water_depth(monkeypatch) -> None:
    monkeypatch.setattr(bathymetry, "_gmrt_elevation", lambda _longitude, _latitude: 126.0)
    monkeypatch.setattr(bathymetry, "_gmrt_high_resolution", lambda _longitude, _latitude: precision_result(125.5, coverage=False))
    monkeypatch.setattr(bathymetry, "_gebco_elevations", lambda _points: {"center": 130.0})

    result = bathymetry._build_result(116.4, 39.9)

    assert result["is_ocean"] is False
    assert result["water_depth_m"] == 0.0
    assert result["depth_zone"] == "land_or_intertidal"


def test_bathymetry_cache_avoids_duplicate_remote_reads(monkeypatch) -> None:
    bathymetry._cache.clear()
    calls = 0

    def fake_elevation(_longitude: float, _latitude: float) -> float:
        nonlocal calls
        calls += 1
        return -800.0

    monkeypatch.setattr(bathymetry, "_gmrt_elevation", fake_elevation)
    monkeypatch.setattr(bathymetry, "_gmrt_high_resolution", lambda _longitude, _latitude: precision_result(-800.0))
    monkeypatch.setattr(bathymetry, "_gebco_elevations", lambda _points: {"center": -810.0})
    first = bathymetry.get_bathymetry(130.0, 15.0)
    second = bathymetry.get_bathymetry(130.0, 15.0)

    assert calls == 1
    assert first["water_depth_m"] == second["water_depth_m"] == 800.0
    assert second["cache"]["state"] == "fresh"


def test_bathymetry_cache_key_preserves_nearby_clicks() -> None:
    assert bathymetry._cache_key(120.000001, 20.0) != bathymetry._cache_key(120.000049, 20.0)
