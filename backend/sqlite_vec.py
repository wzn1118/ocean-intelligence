from __future__ import annotations

import array
from pathlib import Path
from typing import Any, Iterable


def serialize_float32(values: Iterable[float]) -> bytes:
    return array.array("f", values).tobytes()


def load(connection: Any) -> None:
    del connection
    raise RuntimeError("sqlite-vec is unavailable; configure the store without vector indexing")


def loadable_path() -> str:
    raise RuntimeError("sqlite-vec is unavailable; configure the store without vector indexing")
