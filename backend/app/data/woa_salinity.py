from __future__ import annotations

import math
import os
import shutil
import threading
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

import numpy as np

try:
    from netCDF4 import Dataset
except ModuleNotFoundError:  # Optional: this source degrades independently.
    Dataset = None  # type: ignore[assignment]


WOA_SALINITY_URL = (
    "https://www.ncei.noaa.gov/data/oceans/woa/WOA23/DATA/salinity/"
    "netcdf/decav/1.00/woa23_decav_s00_01.nc"
)
WOA_CACHE_DIR = Path(os.getenv("WOA_CACHE_DIR", str(Path(__file__).resolve().parents[2] / ".cache" / "woa23")))
WOA_SALINITY_FILE = WOA_CACHE_DIR / "woa23_decav_s00_01.nc"
_download_lock = threading.Lock()


class WoaSalinityError(RuntimeError):
    pass


def _valid_file(path: Path) -> bool:
    try:
        with path.open("rb") as handle:
            return path.stat().st_size > 1_000_000 and handle.read(8) == b"\x89HDF\r\n\x1a\n"
    except OSError:
        return False


def _download() -> Path:
    if _valid_file(WOA_SALINITY_FILE):
        return WOA_SALINITY_FILE
    with _download_lock:
        if _valid_file(WOA_SALINITY_FILE):
            return WOA_SALINITY_FILE
        WOA_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        temporary = WOA_SALINITY_FILE.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
        try:
            request = Request(WOA_SALINITY_URL, headers={"Accept": "application/x-netcdf", "User-Agent": "OceanIntelligenceAgent/1.0"})
            with urlopen(request, timeout=120) as response, temporary.open("wb") as target:
                shutil.copyfileobj(response, target, length=1024 * 1024)
            if not _valid_file(temporary):
                raise WoaSalinityError("NOAA WOA23 salinity file failed NetCDF validation")
            temporary.replace(WOA_SALINITY_FILE)
            return WOA_SALINITY_FILE
        except Exception as error:  # noqa: BLE001
            temporary.unlink(missing_ok=True)
            raise WoaSalinityError(f"NOAA WOA23 salinity download failed: {error}") from error


def _even_sample(points: list[dict[str, float]], limit: int) -> list[dict[str, float]]:
    if len(points) <= limit:
        return points
    stride = (len(points) - 1) / (limit - 1)
    return [points[round(index * stride)] for index in range(limit)]


def get_woa_salinity(
    bounds: tuple[tuple[float, float], tuple[float, float]],
    *,
    limit: int = 240,
    offset: int = 0,
    page: bool = False,
) -> dict[str, Any]:
    if Dataset is None:
        raise WoaSalinityError("NOAA WOA23 salinity requires the optional netCDF4 reader")
    path = _download()
    (west, south), (east, north) = bounds
    try:
        with Dataset(path, "r") as dataset:
            lon = np.asarray(dataset.variables["lon"][:], dtype=float)
            lat = np.asarray(dataset.variables["lat"][:], dtype=float)
            depth = np.asarray(dataset.variables["depth"][:], dtype=float)
            lon_idx = np.flatnonzero((lon >= west) & (lon <= east)) if west <= east else np.flatnonzero((lon >= west) | (lon <= east))
            lat_idx = np.flatnonzero((lat >= south) & (lat <= north))
            depth_idx = np.flatnonzero((depth >= 0) & (depth <= 2000))
            if not len(lon_idx) or not len(lat_idx) or not len(depth_idx):
                return {"points": [], "available_count": 0}
            values = dataset.variables["s_an"][0, depth_idx, lat_idx, lon_idx]
    except Exception as error:  # noqa: BLE001
        raise WoaSalinityError(f"NOAA WOA23 salinity file could not be read: {error}") from error
    array = np.ma.asarray(values)
    numeric = np.asarray(array.filled(np.nan), dtype=float)
    points: list[dict[str, float]] = []
    for di, lati, loni in np.argwhere(np.ma.getmaskarray(array) == 0):
        value = float(numeric[di, lati, loni])
        if math.isfinite(value) and 0 < value < 50:
            points.append({"longitude": float(lon[lon_idx[loni]]), "latitude": float(lat[lat_idx[lati]]), "depth": float(depth[depth_idx[di]]), "salinity": value})
    if not points:
        raise WoaSalinityError("NOAA WOA23 returned no valid salinity points")
    selected = points[max(0, offset) : max(0, offset) + max(1, limit)] if page else _even_sample(points, max(100, limit))
    return {
        "points": selected,
        "available_count": len(points),
        "returned_count": len(selected),
        "offset": max(0, offset) if page else 0,
        "page_mode": page,
        "source": {"name": "NOAA World Ocean Atlas 2023 salinity climatology", "url": WOA_SALINITY_URL, "period": "1991-2020", "resolution": "1 degree", "cached_file": str(path)},
        "latest_observation_at": "2020-12-31T00:00:00Z",
    }
