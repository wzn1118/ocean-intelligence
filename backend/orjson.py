from __future__ import annotations

import dataclasses
import json
from datetime import date, datetime, time
from enum import Enum
from typing import Any, Callable
from uuid import UUID

OPT_NON_STR_KEYS = 1 << 0
OPT_SERIALIZE_NUMPY = 1 << 1
OPT_SERIALIZE_DATACLASS = 1 << 2
OPT_SERIALIZE_UUID = 1 << 3

JSONDecodeError = json.JSONDecodeError
JSONEncodeError = TypeError


class Fragment:
    def __init__(self, value: bytes | bytearray | memoryview | str) -> None:
        self.value = bytes(value).decode("utf-8") if not isinstance(value, str) else value


def _fallback(value: Any, default: Callable[[Any], Any] | None) -> Any:
    if isinstance(value, Fragment):
        return json.loads(value.value)
    if dataclasses.is_dataclass(value):
        return dataclasses.asdict(value)
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, (UUID, Enum)):
        return str(value)
    if hasattr(value, "tolist"):
        return value.tolist()
    if default is not None:
        return default(value)
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def dumps(
    value: Any,
    default: Callable[[Any], Any] | None = None,
    option: int = 0,
) -> bytes:
    del option
    return json.dumps(
        value,
        default=lambda item: _fallback(item, default),
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")


def loads(value: bytes | bytearray | memoryview | str) -> Any:
    if not isinstance(value, str):
        value = bytes(value).decode("utf-8")
    return json.loads(value)
