from __future__ import annotations

import pickle
from dataclasses import dataclass
from typing import Any, Callable

OPT_NON_STR_KEYS = 1 << 0
OPT_PASSTHROUGH_DATACLASS = 1 << 1
OPT_PASSTHROUGH_DATETIME = 1 << 2
OPT_PASSTHROUGH_ENUM = 1 << 3
OPT_PASSTHROUGH_UUID = 1 << 4
OPT_REPLACE_SURROGATES = 1 << 5


class MsgpackEncodeError(TypeError):
    pass


class MsgpackDecodeError(ValueError):
    pass


@dataclass(frozen=True)
class Ext:
    tag: int
    data: bytes


def _encode_value(value: Any, default: Callable[[Any], Any] | None) -> Any:
    if value is None or isinstance(value, (bool, int, float, str, bytes)):
        return value
    if isinstance(value, Ext):
        return value
    if isinstance(value, list):
        return [_encode_value(item, default) for item in value]
    if isinstance(value, tuple):
        return tuple(_encode_value(item, default) for item in value)
    if isinstance(value, dict):
        return {
            _encode_value(key, default): _encode_value(item, default)
            for key, item in value.items()
        }
    if default is None:
        raise MsgpackEncodeError(f"unsupported type: {type(value)!r}")
    return _encode_value(default(value), default)


def packb(
    value: Any,
    *,
    default: Callable[[Any], Any] | None = None,
    option: int = 0,
) -> bytes:
    del option
    try:
        return pickle.dumps(_encode_value(value, default), protocol=5)
    except Exception as exc:
        if isinstance(exc, MsgpackEncodeError):
            raise
        raise MsgpackEncodeError(str(exc)) from exc


def _decode_value(value: Any, ext_hook: Callable[[int, bytes], Any] | None) -> Any:
    if isinstance(value, Ext):
        return ext_hook(value.tag, value.data) if ext_hook else value
    if isinstance(value, list):
        return [_decode_value(item, ext_hook) for item in value]
    if isinstance(value, tuple):
        return tuple(_decode_value(item, ext_hook) for item in value)
    if isinstance(value, dict):
        return {
            _decode_value(key, ext_hook): _decode_value(item, ext_hook)
            for key, item in value.items()
        }
    return value


def unpackb(
    payload: bytes,
    *,
    ext_hook: Callable[[int, bytes], Any] | None = None,
    option: int = 0,
) -> Any:
    del option
    try:
        return _decode_value(pickle.loads(payload), ext_hook)
    except Exception as exc:
        raise MsgpackDecodeError(str(exc)) from exc
