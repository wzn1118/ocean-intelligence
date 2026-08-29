from __future__ import annotations

import math
import os
import shutil
import threading
import time
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

import numpy as np

try:
    from netCDF4 import Dataset
except ModuleNotFoundError:  # Optional: this source degrades independently.
    Dataset = None  # type: ignore[assignment]


WOA_NITRATE_URL = (
    "https://www.ncei.noaa.gov/data/oceans/woa/WOA23/DATA/nitrate/"
    "netcdf/all/1.00/woa23_all_n00_01.nc"
)
WOA_CACHE_DIR = Path(
    os.getenv("WOA_CACHE_DIR", str(Path(__file__).resolve().parents[2] / ".cache" / "woa23"))
)
WOA_NITRATE_FILE = WOA_CACHE_DIR / "woa23_all_n00_01.nc"
WOA_DOWNLOAD_ATTEMPTS = 3
WOA_MINIMUM_FILE_BYTES = 1_000_000
WOA_MAX_DISPLAY_DEPTH_METERS = 2_000.0
_download_lock = threading.Lock()


class WoaNitrateError(RuntimeError):
    pass


def _valid_netcdf_file(path: Path) -> bool:
    try:
        if path.stat().st_size < WOA_MINIMUM_FILE_BYTES:
            return False
        with path.open("rb") as handle:
            return handle.read(8) == b"\x89HDF\r\n\x1a\n"
    except OSError:
        return False


def _download_nitrate_file() -> Path:
    if _valid_netcdf_file(WOA_NITRATE_FILE):
        return WOA_NITRATE_FILE
    with _download_lock:
        if _valid_netcdf_file(WOA_NITRATE_FILE):
            return WOA_NITRATE_FILE
        WOA_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        temporary = WOA_NITRATE_FILE.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
        last_error: Exception | None = None
        for attempt in range(WOA_DOWNLOAD_ATTEMPTS):
            temporary.unlink(missing_ok=True)
            request = Request(
                WOA_NITRATE_URL,
                headers={"Accept": "application/x-netcdf", "User-Agent": "OceanIntelligenceAgent/1.0"},
            )
            try:
                with urlopen(request, timeout=90) as response, temporary.open("wb") as target:
                    shutil.copyfileobj(response, target, length=1024 * 1024)
                if not _valid_netcdf_file(temporary):
                    raise WoaNitrateError("NOAA WOA23 nitrate file failed NetCDF validation")
                temporary.replace(WOA_NITRATE_FILE)
                return WOA_NITRATE_FILE
            except Exception as error:  # noqa: BLE001 - normalized to the domain error below
                last_error = error
                temporary.unlink(missing_ok=True)
                if attempt + 1 < WOA_DOWNLOAD_ATTEMPTS:
                    time.sleep(1.0 + attempt)
        raise WoaNitrateError(f"NOAA WOA23 nitrate download failed: {last_error}") from last_error


def _longitude_indices(longitudes: np.ndarray, west: float, east: float) -> np.ndarray:
    if west <= east:
        return np.flatnonzero((longitudes >= west) & (longitudes <= east))
    return np.flatnonzero((longitudes >= west) | (longitudes <= east))


def _even_sample(points: list[dict[str, float]], limit: int) -> list[dict[str, float]]:
    if len(points) <= limit:
        return points
    stride = (len(points) - 1) / (limit - 1)
    return [points[round(index * stride)] for index in range(limit)]


def _read_nitrate_grid(
    path: Path,
    bounds: tuple[tuple[float, float], tuple[float, float]],
) -> list[dict[str, float]]:
    (west, south), (east, north) = bounds
    try:
        with Dataset(path, "r") as dataset:
            longitudes = np.asarray(dataset.variables["lon"][:], dtype=float)
            latitudes = np.asarray(dataset.variables["lat"][:], dtype=float)
            depths = np.asarray(dataset.variables["depth"][:], dtype=float)
            longitude_indices = _longitude_indices(longitudes, west, east)
            latitude_indices = np.flatnonzero((latitudes >= south) & (latitudes <= north))
            depth_indices = np.flatnonzero((depths >= 0.0) & (depths <= WOA_MAX_DISPLAY_DEPTH_METERS))
            if not len(longitude_indices) or not len(latitude_indices) or not len(depth_indices):
                return []
            values = dataset.variables["n_an"][
                0,
                depth_indices,
                latitude_indices,
                longitude_indices,
            ]
    except Exception as error:  # noqa: BLE001 - malformed cache is reported as one data-source error
        raise WoaNitrateError(f"NOAA WOA23 nitrate file could not be read: {error}") from error

    value_array = np.ma.asarray(values)
    mask = np.ma.getmaskarray(value_array)
    numeric = np.asarray(value_array.filled(np.nan), dtype=float)
    points: list[dict[str, float]] = []
    for depth_offset, latitude_offset, longitude_offset in np.argwhere(~mask & np.isfinite(numeric)):
        value = float(numeric[depth_offset, latitude_offset, longitude_offset])
        if value < 0.0 or not math.isfinite(value):
            continue
        points.append(
            {
                "longitude": float(longitudes[longitude_indices[longitude_offset]]),
                "latitude": float(latitudes[latitude_indices[latitude_offset]]),
                "depth": float(depths[depth_indices[depth_offset]]),
                "nitrate": value,
            }
        )
    return points


def get_woa_nitrate(
    bounds: tuple[tuple[float, float], tuple[float, float]],
    *,
    limit: int = 240,
    offset: int = 0,
    page: bool = False,
) -> dict[str, Any]:
    if Dataset is None:
        raise WoaNitrateError("NOAA WOA23 nitrate requires the optional netCDF4 reader")
    path = _download_nitrate_file()
    points = _read_nitrate_grid(path, bounds)
    if not points:
        raise WoaNitrateError("NOAA WOA23 returned no valid nitrate grid points for this region")
    selected = points[max(0, offset) : max(0, offset) + max(1, limit)] if page else _even_sample(points, max(100, limit))
    return {
        "points": selected,
        "available_count": len(points),
        "returned_count": len(selected),
        "offset": max(0, offset) if page else 0,
        "page_mode": page,
        "source": {
            "name": "NOAA World Ocean Atlas 2023 nitrate climatology",
            "url": WOA_NITRATE_URL,
            "period": "1965-2022",
            "resolution": "1 degree",
            "cached_file": str(path),
        },
        "latest_observation_at": "2022-12-31T00:00:00Z",
    }
