"""Resource-bounded sampling of latest Copernicus Marine ARCO grids."""

from __future__ import annotations

import json
import math
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Iterable


@dataclass(frozen=True)
class ArcoDataset:
    category: str
    dataset_id: str
    base_urls: tuple[str, ...]
    variables: tuple[str, ...]


WAVE_DATASET = ArcoDataset(
    category="wave",
    dataset_id="cmems_mod_glo_wav_anfc_0.083deg_PT3H-i",
    base_urls=(
        "https://s3.waw4-1.cloudferro.com/mdl-arco-time-015/arco/GLOBAL_ANALYSISFORECAST_WAV_001_027/cmems_mod_glo_wav_anfc_0.083deg_PT3H-i_202411/timeChunked.zarr",
        "https://s3.waw3-1.cloudferro.com/mdl-arco-time-015/arco/GLOBAL_ANALYSISFORECAST_WAV_001_027/cmems_mod_glo_wav_anfc_0.083deg_PT3H-i_202411/timeChunked.zarr",
    ),
    variables=("VHM0", "VTM02", "VMDR"),
)

WIND_DATASET = ArcoDataset(
    category="wind",
    dataset_id="cmems_obs-wind_glo_phy_nrt_l4_0.125deg_PT1H",
    base_urls=(
        "https://s3.waw3-1.cloudferro.com/mdl-arco-time-050/arco/WIND_GLO_PHY_L4_NRT_012_004/cmems_obs-wind_glo_phy_nrt_l4_0.125deg_PT1H_202207/timeChunked.zarr",
        "https://s3.waw4-1.cloudferro.com/mdl-arco-time-050/arco/WIND_GLO_PHY_L4_NRT_012_004/cmems_obs-wind_glo_phy_nrt_l4_0.125deg_PT1H_202207/timeChunked.zarr",
    ),
    variables=("eastward_wind", "northward_wind"),
)

CURRENT_DATASET = ArcoDataset(
    category="current",
    dataset_id="cmems_mod_glo_phy_anfc_merged-uv_PT1H-i",
    base_urls=(
        "https://s3.waw4-1.cloudferro.com/mdl-arco-time-015/arco/GLOBAL_ANALYSISFORECAST_PHY_001_024/cmems_mod_glo_phy_anfc_merged-uv_PT1H-i_202211/timeChunked.zarr",
        "https://s3.waw3-1.cloudferro.com/mdl-arco-time-015/arco/GLOBAL_ANALYSISFORECAST_PHY_001_024/cmems_mod_glo_phy_anfc_merged-uv_PT1H-i_202211/timeChunked.zarr",
    ),
    variables=("utotal", "vtotal"),
)


class ArcoSamplingError(RuntimeError):
    """Raised when a remote ARCO dataset cannot be sampled."""


class ArcoSampler:
    def __init__(self, dataset: ArcoDataset, *, request_timeout: int = 60) -> None:
        self.dataset = dataset
        self.request_timeout = request_timeout
        self.requests = 0
        self.bytes_downloaded = 0
        self.base_url: str | None = None
        self.metadata = json.loads(self._read_bytes(".zmetadata"))["metadata"]
        self.longitudes = self._coordinate("longitude")
        self.latitudes = self._coordinate("latitude")
        self.times = self._coordinate("time")
        self.time_index, self.timestamp = self._latest_time()
        variable_config = self.metadata[f"{dataset.variables[0]}/.zarray"]
        dimensions = self.metadata[f"{dataset.variables[0]}/.zattrs"]["_ARRAY_DIMENSIONS"]
        self.latitude_dimension = dimensions.index("latitude")
        self.longitude_dimension = dimensions.index("longitude")
        self.latitude_chunk_size = int(variable_config["chunks"][self.latitude_dimension])
        self.longitude_chunk_size = int(variable_config["chunks"][self.longitude_dimension])

    def _read_bytes(self, path: str) -> bytes:
        last_error: Exception | None = None
        base_urls = (self.base_url,) if self.base_url else self.dataset.base_urls
        for base_url in base_urls:
            if base_url is None:
                continue
            request = urllib.request.Request(
                f"{base_url}/{path.lstrip('/')}",
                headers={"User-Agent": "ocean-intelligence/1.0"},
            )
            for attempt in range(8):
                try:
                    with urllib.request.urlopen(request, timeout=self.request_timeout) as response:
                        content = response.read()
                    self.requests += 1
                    self.bytes_downloaded += len(content)
                    if self.base_url is None:
                        self.base_url = base_url
                    return content
                except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
                    last_error = error
                    if attempt < 7:
                        time.sleep(min(8.0, 1.0 * (attempt + 1)))
        raise ArcoSamplingError(f"Unable to read {self.dataset.dataset_id}/{path}: {last_error}")

    def _decode(self, name: str, chunk_key: str) -> Any:
        import numpy as np
        from numcodecs import get_codec

        config = self.metadata[f"{name}/.zarray"]
        raw = get_codec(config["compressor"]).decode(self._read_bytes(f"{name}/{chunk_key}"))
        return np.frombuffer(raw, dtype=np.dtype(config["dtype"]))

    def _coordinate(self, name: str) -> Any:
        import numpy as np

        config = self.metadata[f"{name}/.zarray"]
        chunk_size = int(config["chunks"][0])
        chunk_count = math.ceil(int(config["shape"][0]) / chunk_size)
        values = [self._decode(name, str(index)) for index in range(chunk_count)]
        return np.concatenate(values)[: int(config["shape"][0])]

    def _latest_time(self) -> tuple[int, datetime]:
        import numpy as np

        attrs = self.metadata["time/.zattrs"]
        units = str(attrs["units"])
        unit, _, epoch_text = units.partition(" since ")
        epoch = datetime.fromisoformat(epoch_text.strip()).replace(tzinfo=UTC)
        divisor = 3600 if unit.startswith("hour") else 1
        now_value = (datetime.now(UTC) - epoch).total_seconds() / divisor
        index = int(np.searchsorted(self.times, now_value, side="right") - 1)
        index = max(0, min(index, len(self.times) - 1))
        delta = timedelta(hours=float(self.times[index])) if divisor == 3600 else timedelta(seconds=float(self.times[index]))
        return index, epoch + delta

    def _nearest_index(self, values: Any, value: float) -> int:
        import numpy as np

        index = int(np.searchsorted(values, value, side="left"))
        if index <= 0:
            return 0
        if index >= len(values):
            return len(values) - 1
        return index if abs(float(values[index]) - value) < abs(float(values[index - 1]) - value) else index - 1

    def _chunk_key(self, variable: str, latitude_chunk: int, longitude_chunk: int) -> str:
        dimensions = self.metadata[f"{variable}/.zattrs"]["_ARRAY_DIMENSIONS"]
        indexes = []
        for dimension in dimensions:
            if dimension == "time":
                indexes.append(self.time_index)
            elif dimension == "depth":
                indexes.append(0)
            elif dimension == "latitude":
                indexes.append(latitude_chunk)
            elif dimension == "longitude":
                indexes.append(longitude_chunk)
            else:
                indexes.append(0)
        return ".".join(str(index) for index in indexes)

    def _decode_variable_chunk(self, variable: str, latitude_chunk: int, longitude_chunk: int) -> Any:
        import numpy as np

        config = self.metadata[f"{variable}/.zarray"]
        dimensions = self.metadata[f"{variable}/.zattrs"]["_ARRAY_DIMENSIONS"]
        chunk_shape = tuple(int(config["chunks"][index]) for index in range(len(dimensions)))
        values = self._decode(variable, self._chunk_key(variable, latitude_chunk, longitude_chunk)).reshape(chunk_shape)
        latitude_axis = dimensions.index("latitude")
        longitude_axis = dimensions.index("longitude")
        selectors: list[Any] = [0] * len(dimensions)
        selectors[latitude_axis] = slice(None)
        selectors[longitude_axis] = slice(None)
        values = values[tuple(selectors)]
        if latitude_axis > longitude_axis:
            values = values.T
        attrs = self.metadata[f"{variable}/.zattrs"]
        fill_value = config.get("fill_value")
        missing_value = attrs.get("missing_value", fill_value)
        valid = np.ones(values.shape, dtype=bool)
        if missing_value is not None and not isinstance(missing_value, str):
            valid &= values != missing_value
        if fill_value is not None and not isinstance(fill_value, str):
            valid &= values != fill_value
        decoded = values.astype(float)
        decoded = decoded * float(attrs.get("scale_factor", 1.0)) + float(attrs.get("add_offset", 0.0))
        decoded[~valid] = np.nan
        return decoded

    def sample(self, points: Iterable[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        grouped: dict[tuple[int, int], list[dict[str, Any]]] = {}
        for order, point in enumerate(points):
            longitude_index = self._nearest_index(self.longitudes, float(point["longitude"]))
            latitude_index = self._nearest_index(self.latitudes, float(point["latitude"]))
            latitude_chunk = latitude_index // self.latitude_chunk_size
            longitude_chunk = longitude_index // self.longitude_chunk_size
            grouped.setdefault((latitude_chunk, longitude_chunk), []).append({
                **point,
                "sample_order": order,
                "longitude_index": longitude_index,
                "latitude_index": latitude_index,
            })

        output: list[dict[str, Any]] = []
        for (latitude_chunk, longitude_chunk), chunk_points in grouped.items():
            with ThreadPoolExecutor(max_workers=len(self.dataset.variables), thread_name_prefix=f"arco-{self.dataset.category}") as executor:
                chunks = dict(zip(
                    self.dataset.variables,
                    executor.map(
                        lambda variable: self._decode_variable_chunk(variable, latitude_chunk, longitude_chunk),
                        self.dataset.variables,
                    ),
                ))
            for point in chunk_points:
                local_latitude = point["latitude_index"] % self.latitude_chunk_size
                local_longitude = point["longitude_index"] % self.longitude_chunk_size
                selected: tuple[int, int] | None = None
                for radius in range(0, 9):
                    for latitude_offset in range(-radius, radius + 1):
                        for longitude_offset in range(-radius, radius + 1):
                            row = local_latitude + latitude_offset
                            column = local_longitude + longitude_offset
                            if row < 0 or column < 0:
                                continue
                            if any(row >= chunk.shape[0] or column >= chunk.shape[1] for chunk in chunks.values()):
                                continue
                            if all(math.isfinite(float(chunk[row, column])) for chunk in chunks.values()):
                                selected = row, column
                                break
                        if selected:
                            break
                    if selected:
                        break
                if selected is None:
                    continue
                row, column = selected
                latitude_index = latitude_chunk * self.latitude_chunk_size + row
                longitude_index = longitude_chunk * self.longitude_chunk_size + column
                if latitude_index >= len(self.latitudes) or longitude_index >= len(self.longitudes):
                    continue
                output.append({
                    **point,
                    "longitude": float(self.longitudes[longitude_index]),
                    "latitude": float(self.latitudes[latitude_index]),
                    "timestamp": self.timestamp.isoformat(),
                    "values": {variable: float(chunk[row, column]) for variable, chunk in chunks.items()},
                })
        output.sort(key=lambda item: int(item["sample_order"]))
        return output, {
            "category": self.dataset.category,
            "dataset_id": self.dataset.dataset_id,
            "timestamp": self.timestamp.isoformat(),
            "requested_points": sum(len(points) for points in grouped.values()),
            "valid_points": len(output),
            "remote_chunk_requests": self.requests,
            "bytes_downloaded": self.bytes_downloaded,
        }


__all__ = ["ArcoDataset", "ArcoSampler", "ArcoSamplingError", "CURRENT_DATASET", "WAVE_DATASET", "WIND_DATASET"]
