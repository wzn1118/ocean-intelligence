from __future__ import annotations

import hashlib
from typing import Any


class _Digest128:
    def __init__(self, value: bytes | bytearray | memoryview | str = b"") -> None:
        if isinstance(value, str):
            value = value.encode("utf-8")
        self._hash = hashlib.blake2b(bytes(value), digest_size=16)

    def update(self, value: bytes | bytearray | memoryview | str) -> None:
        if isinstance(value, str):
            value = value.encode("utf-8")
        self._hash.update(bytes(value))

    def digest(self) -> bytes:
        return self._hash.digest()

    def hexdigest(self) -> str:
        return self._hash.hexdigest()


def xxh3_128(value: Any = b"") -> _Digest128:
    return _Digest128(value)


def xxh3_128_digest(value: Any = b"") -> bytes:
    return xxh3_128(value).digest()


def xxh3_128_hexdigest(value: Any = b"") -> str:
    return xxh3_128(value).hexdigest()
