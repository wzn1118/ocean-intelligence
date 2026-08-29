from pathlib import Path

import numpy as np
from netCDF4 import Dataset

from app.data import woa_nitrate


def _write_fixture(path: Path) -> None:
    with Dataset(path, "w") as dataset:
        dataset.createDimension("time", 1)
        dataset.createDimension("depth", 3)
        dataset.createDimension("lat", 3)
        dataset.createDimension("lon", 4)
        dataset.createVariable("depth", "f4", ("depth",))[:] = [0.0, 100.0, 2500.0]
        dataset.createVariable("lat", "f4", ("lat",))[:] = [10.5, 11.5, 12.5]
        dataset.createVariable("lon", "f4", ("lon",))[:] = [100.5, 101.5, 102.5, 103.5]
        nitrate = dataset.createVariable(
            "n_an",
            "f4",
            ("time", "depth", "lat", "lon"),
            fill_value=np.float32(9.96921e36),
        )
        values = np.arange(36, dtype=np.float32).reshape(1, 3, 3, 4) / 10
        nitrate[:] = values
        nitrate[0, 0, 1, 1] = nitrate._FillValue


def test_read_nitrate_grid_applies_bounds_depth_limit_and_land_mask(tmp_path) -> None:
    path = tmp_path / "woa.nc"
    _write_fixture(path)

    points = woa_nitrate._read_nitrate_grid(  # noqa: SLF001
        path,
        ((101.0, 10.0), (103.0, 12.0)),
    )

    assert len(points) == 7
    assert all(101.0 <= point["longitude"] <= 103.0 for point in points)
    assert all(10.0 <= point["latitude"] <= 12.0 for point in points)
    assert {point["depth"] for point in points} == {0.0, 100.0}
    assert not any(
        point["longitude"] == 101.5 and point["latitude"] == 11.5 and point["depth"] == 0.0
        for point in points
    )


def test_even_sample_keeps_requested_number_and_endpoints() -> None:
    points = [{"nitrate": float(index)} for index in range(1_000)]

    selected = woa_nitrate._even_sample(points, 240)  # noqa: SLF001

    assert len(selected) == 240
    assert selected[0] == points[0]
    assert selected[-1] == points[-1]
    assert len({point["nitrate"] for point in selected}) == 240
