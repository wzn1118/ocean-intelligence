from __future__ import annotations

import secrets
import time
import uuid

UUID = uuid.UUID
SafeUUID = uuid.SafeUUID
NAMESPACE_DNS = uuid.NAMESPACE_DNS
NAMESPACE_OID = uuid.NAMESPACE_OID
NAMESPACE_URL = uuid.NAMESPACE_URL
NAMESPACE_X500 = uuid.NAMESPACE_X500
NIL = uuid.UUID(int=0)
MAX = uuid.UUID(int=(1 << 128) - 1)
RESERVED_NCS = uuid.RESERVED_NCS
RFC_4122 = uuid.RFC_4122
RESERVED_MICROSOFT = uuid.RESERVED_MICROSOFT
RESERVED_FUTURE = uuid.RESERVED_FUTURE
__version__ = "ocean-compat-1"

getnode = uuid.getnode
uuid1 = uuid.uuid1
uuid3 = uuid.uuid3
uuid4 = uuid.uuid4
uuid5 = uuid.uuid5


def uuid7(*, timestamp: float | None = None, nanos: int | None = None) -> uuid.UUID:
    if timestamp is None:
        timestamp = time.time()
    if nanos is not None:
        timestamp += nanos / 1_000_000_000
    milliseconds = int(timestamp * 1_000) & ((1 << 48) - 1)
    random_a = secrets.randbits(12)
    random_b = secrets.randbits(62)
    value = milliseconds << 80
    value |= 0x7 << 76
    value |= random_a << 64
    value |= 0b10 << 62
    value |= random_b
    return uuid.UUID(int=value)


def uuid6(*args: object, **kwargs: object) -> uuid.UUID:
    return uuid.uuid4()


def uuid8(*args: object, **kwargs: object) -> uuid.UUID:
    return uuid.uuid4()


def _uuid4_int() -> int:
    return uuid.uuid4().int


def _uuid7_int() -> int:
    return uuid7().int


def reseed_rng() -> None:
    return None


reseed = reseed_rng

