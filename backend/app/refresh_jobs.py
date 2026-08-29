"""Background refresh jobs with per-region coalescing.

The data clients already provide bounded source caches. This layer keeps the
HTTP request short while ensuring that two refresh clicks for the same region
share one upstream refresh instead of creating a request stampede.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import UTC, datetime
from threading import Lock
from typing import Any
from uuid import uuid4

from app.data.realtime_service import get_realtime_bundle


_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ocean-refresh")
_lock = Lock()
_jobs: dict[str, dict[str, Any]] = {}
_running_by_region: dict[str, str] = {}


def _now() -> datetime:
    return datetime.now(UTC)


def _new_job(region_id: str) -> dict[str, Any]:
    timestamp = _now()
    return {
        "job_id": uuid4().hex,
        "region_id": region_id,
        "status": "queued",
        "created_at": timestamp,
        "updated_at": timestamp,
        "refreshed_at": None,
        "result": None,
        "error": None,
    }


def _refresh_result(region_id: str, bundle: dict[str, Any]) -> dict[str, Any]:
    return {
        "region_id": region_id,
        "refreshed_at": bundle["refreshed_at"],
        "event_count": len(bundle["events"]),
        "observation_count": bundle["observation_count"],
        "source_count": len(bundle["sources"]),
        "status": "partial" if bundle["errors"] else "completed",
    }


def _run(job_id: str, region_id: str) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            return
        job["status"] = "running"
        job["updated_at"] = _now()
    try:
        bundle = get_realtime_bundle(region_id, force_refresh=True)
        result = _refresh_result(region_id, bundle)
        with _lock:
            job = _jobs.get(job_id)
            if job is not None:
                job["status"] = result["status"]
                job["updated_at"] = _now()
                job["refreshed_at"] = result["refreshed_at"]
                job["result"] = result
    except Exception as error:  # noqa: BLE001 - surface the job failure to the UI
        with _lock:
            job = _jobs.get(job_id)
            if job is not None:
                job["status"] = "failed"
                job["updated_at"] = _now()
                job["error"] = str(error)
    finally:
        with _lock:
            if _running_by_region.get(region_id) == job_id:
                _running_by_region.pop(region_id, None)


def enqueue_refresh(region_id: str) -> dict[str, Any]:
    with _lock:
        existing_id = _running_by_region.get(region_id)
        if existing_id and existing_id in _jobs:
            return deepcopy(_jobs[existing_id])
        job = _new_job(region_id)
        _jobs[job["job_id"]] = job
        _running_by_region[region_id] = job["job_id"]
        job_id = job["job_id"]
    _executor.submit(_run, job_id, region_id)
    return deepcopy(job)


def get_refresh_job(job_id: str) -> dict[str, Any] | None:
    with _lock:
        job = _jobs.get(job_id)
        return deepcopy(job) if job is not None else None
