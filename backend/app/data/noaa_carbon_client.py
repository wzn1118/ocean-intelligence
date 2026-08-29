from __future__ import annotations

import math
import os
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

URL = "https://data.pmel.noaa.gov/socat/erddap/griddap/SOCAT_v2026_tracks_gridded_decadal.nc?fco2_ave_weighted_decade%5B%5D%5B%5D%5B%5D"
DATASET_URL = "https://data.pmel.noaa.gov/socat/erddap/griddap/SOCAT_v2026_tracks_gridded_decadal.html"
CACHE_DIR = Path(os.getenv("NOAA_CARBON_CACHE_DIR", str(Path(__file__).resolve().parents[2] / ".cache" / "carbon")))
FILE = CACHE_DIR / "socat_v2026_decadal_all.nc"
_lock = threading.Lock()


class NoaaCarbonError(RuntimeError):
    pass


def _download() -> Path:
    if FILE.exists() and FILE.stat().st_size > 100_000:
        return FILE
    with _lock:
        if FILE.exists() and FILE.stat().st_size > 100_000:
            return FILE
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        temporary = FILE.with_suffix(".tmp")
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                request = Request(URL, headers={"Accept": "application/x-netcdf", "User-Agent": "OceanIntelligenceAgent/1.0"})
                with urlopen(request, timeout=120) as response, temporary.open("wb") as target:
                    while chunk := response.read(256 * 1024):
                        target.write(chunk)
                if temporary.stat().st_size <= 100_000:
                    raise NoaaCarbonError("NOAA SOCAT returned an incomplete NetCDF file")
                temporary.replace(FILE)
                return FILE
            except Exception as error:  # noqa: BLE001
                last_error = error
                temporary.unlink(missing_ok=True)
                if attempt < 2:
                    time.sleep(1.5 * (attempt + 1))
        if isinstance(last_error, NoaaCarbonError):
            raise last_error
        raise NoaaCarbonError(f"NOAA SOCAT carbon download failed after 3 attempts: {last_error}") from last_error


def _normalized_longitude(value: float) -> float:
    return ((value + 180.0) % 360.0) - 180.0


def _inside_longitude(value: float, west: float, east: float) -> bool:
    return west <= value <= east if west <= east else value >= west or value <= east


def get_noaa_carbon(
    bounds: tuple[tuple[float, float], tuple[float, float]],
    *,
    limit: int = 240,
    offset: int = 0,
    page: bool = False,
) -> dict[str, Any]:
    if Dataset is None:
        raise NoaaCarbonError("NOAA SPCO2 requires the optional netCDF4 reader")
    path = _download()
    (west, south), (east, north) = bounds
    try:
        with Dataset(path, "r") as dataset:
            longitude_name = "longitude" if "longitude" in dataset.variables else "lon"
            latitude_name = "latitude" if "latitude" in dataset.variables else "lat"
            variable_name = "fco2_ave_weighted_decade" if "fco2_ave_weighted_decade" in dataset.variables else "spco2_clim"
            lon = np.asarray(dataset.variables[longitude_name][:], dtype=float)
            lat = np.asarray(dataset.variables[latitude_name][:], dtype=float)
            variable = dataset.variables[variable_name]
            values = np.ma.asarray(variable[:])
            dimensions = tuple(variable.dimensions)
            normalized_lon = np.asarray([_normalized_longitude(value) for value in lon])
            lon_idx = np.asarray([index for index, value in enumerate(normalized_lon) if _inside_longitude(float(value), west, east)])
            lat_idx = np.flatnonzero((lat >= south) & (lat <= north))
    except Exception as error:  # noqa: BLE001
        raise NoaaCarbonError(f"NOAA carbon grid could not be read: {error}") from error
    if not len(lon_idx) or not len(lat_idx):
        raise NoaaCarbonError("NOAA carbon grid has no points in this region")
    points: list[dict[str, float]] = []
    longitude_axis = dimensions.index(longitude_name)
    latitude_axis = dimensions.index(latitude_name)
    time_axis = dimensions.index("time") if "time" in dimensions else None
    for li in lon_idx:
        for lati in lat_idx:
            index = [0] * values.ndim
            index[longitude_axis] = int(li)
            index[latitude_axis] = int(lati)
            time_indices = range(values.shape[time_axis] - 1, -1, -1) if time_axis is not None else (None,)
            value = math.nan
            for time_index in time_indices:
                if time_axis is not None and time_index is not None:
                    index[time_axis] = time_index
                candidate = values[tuple(index)]
                if np.ma.is_masked(candidate):
                    continue
                candidate_value = float(candidate)
                if math.isfinite(candidate_value) and 100 < candidate_value < 1000:
                    value = candidate_value
                    break
            if math.isfinite(value) and 100 < value < 1000:
                points.append({"longitude": float(normalized_lon[li]), "latitude": float(lat[lati]), "pco2": value})
    if not points:
        raise NoaaCarbonError("NOAA carbon grid has no valid CO2 values in this region")
    available_count = len(points)
    if page:
        points = points[max(0, offset) : max(0, offset) + max(1, limit)]
    elif len(points) > limit and limit > 1:
        stride = (len(points) - 1) / (limit - 1)
        points = [points[round(i * stride)] for i in range(limit)]
    return {
        "points": points,
        "available_count": available_count,
        "returned_count": len(points),
        "offset": max(0, offset) if page else 0,
        "page_mode": page,
        "latest_observation_at": "2024-12-31T12:00:00Z",
        "temporal_label": "SOCAT v2026 1970—2024 十年网格综合背景",
        "source": {
            "name": "NOAA PMEL SOCAT v2026 gridded surface-ocean fCO2",
            "url": URL,
            "dataset_url": DATASET_URL,
            "period": "1970-2024",
            "resolution": "1 degree decadal grid",
        },
    }
