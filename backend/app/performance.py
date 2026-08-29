"""Small, dependency-free request telemetry for the local ocean workspace."""

from __future__ import annotations

from collections import defaultdict
from threading import Lock
from time import monotonic
from typing import Any


class PerformanceRegistry:
    """Bounded in-process metrics suitable for a single Uvicorn worker."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._started = monotonic()
        self._active = 0
        self._total = 0
        self._routes: dict[str, dict[str, Any]] = defaultdict(
            lambda: {
                "count": 0,
                "errors": 0,
                "total_ms": 0.0,
                "max_ms": 0.0,
                "last_ms": 0.0,
                "last_status": 200,
                "samples_ms": [],
            }
        )

    def begin(self) -> None:
        with self._lock:
            self._active += 1

    def end(self, route: str, elapsed_ms: float, status_code: int) -> None:
        with self._lock:
            self._active = max(0, self._active - 1)
            self._total += 1
            metric = self._routes[route]
            metric["count"] += 1
            metric["errors"] += int(status_code >= 400)
            metric["total_ms"] += elapsed_ms
            metric["max_ms"] = max(metric["max_ms"], elapsed_ms)
            metric["last_ms"] = elapsed_ms
            metric["last_status"] = status_code
            samples: list[float] = metric["samples_ms"]
            samples.append(round(elapsed_ms, 3))
            if len(samples) > 100:
                del samples[:-100]

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            routes: dict[str, Any] = {}
            for route, metric in self._routes.items():
                samples = sorted(metric["samples_ms"])
                p95_index = min(len(samples) - 1, max(0, int(len(samples) * 0.95) - 1)) if samples else 0
                routes[route] = {
                    "count": metric["count"],
                    "errors": metric["errors"],
                    "average_ms": round(metric["total_ms"] / metric["count"], 3) if metric["count"] else 0.0,
                    "p95_ms": samples[p95_index] if samples else 0.0,
                    "max_ms": round(metric["max_ms"], 3),
                    "last_ms": round(metric["last_ms"], 3),
                    "last_status": metric["last_status"],
                }
            return {
                "uptime_seconds": round(monotonic() - self._started, 1),
                "active_requests": self._active,
                "total_requests": self._total,
                "routes": routes,
            }


PERFORMANCE = PerformanceRegistry()
