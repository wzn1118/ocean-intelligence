from __future__ import annotations

from pathlib import Path

import pytest

from app.data import noaa_carbon_client

netCDF4 = pytest.importorskip("netCDF4")


def test_socat_grid_uses_dimension_names_and_normalizes_longitude(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = tmp_path / "socat.nc"
    with netCDF4.Dataset(path, "w") as dataset:
        dataset.createDimension("time", 2)
        dataset.createDimension("latitude", 2)
        dataset.createDimension("longitude", 2)
        dataset.createVariable("time", "f8", ("time",))[:] = [0, 1]
        dataset.createVariable("latitude", "f8", ("latitude",))[:] = [-5.5, 10.5]
        dataset.createVariable("longitude", "f8", ("longitude",))[:] = [140.5, 220.5]
        dataset.createVariable(
            "fco2_ave_weighted_decade",
            "f4",
            ("time", "latitude", "longitude"),
            fill_value=-1e34,
        )[:] = [
            [[380.0, 390.0], [400.0, 410.0]],
            [[420.0, -1e34], [-1e34, 430.0]],
        ]

    monkeypatch.setattr(noaa_carbon_client, "_download", lambda: path)

    result = noaa_carbon_client.get_noaa_carbon(((130.0, -10.0), (-130.0, 20.0)), limit=10)

    assert result["available_count"] == 4
    assert {point["longitude"] for point in result["points"]} == {140.5, -139.5}
    assert {point["pco2"] for point in result["points"]} == {390.0, 400.0, 420.0, 430.0}


def test_socat_grid_rejects_region_without_valid_values(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = tmp_path / "socat-empty.nc"
    with netCDF4.Dataset(path, "w") as dataset:
        dataset.createDimension("time", 1)
        dataset.createDimension("latitude", 1)
        dataset.createDimension("longitude", 1)
        dataset.createVariable("time", "f8", ("time",))[:] = [0]
        dataset.createVariable("latitude", "f8", ("latitude",))[:] = [10.5]
        dataset.createVariable("longitude", "f8", ("longitude",))[:] = [140.5]
        dataset.createVariable(
            "fco2_ave_weighted_decade",
            "f4",
            ("time", "latitude", "longitude"),
            fill_value=-1e34,
        )[:] = [[[-1e34]]]

    monkeypatch.setattr(noaa_carbon_client, "_download", lambda: path)

    with pytest.raises(noaa_carbon_client.NoaaCarbonError, match="no valid CO2 values"):
        noaa_carbon_client.get_noaa_carbon(((130.0, 0.0), (150.0, 20.0)), limit=10)
