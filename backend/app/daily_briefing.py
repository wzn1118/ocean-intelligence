from __future__ import annotations

import json
import logging
import os
import threading
from copy import deepcopy
from datetime import UTC, date, datetime, time as datetime_time, timedelta
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from app.data.argo_client import get_argo_region
from app.data.copernicus_client import get_global_daily_data_volume
from app.data.realtime_service import get_realtime_bundle
from app.data.regions import DEFAULT_REGION_ID, get_region


DAILY_BRIEF_TIME_ZONE = ZoneInfo(os.getenv("DAILY_BRIEF_TIME_ZONE", "Asia/Shanghai"))
DAILY_BRIEF_GENERATE_HOUR = min(max(int(os.getenv("DAILY_BRIEF_GENERATE_HOUR", "8")), 0), 23)
DAILY_BRIEF_PUBLISH_HOUR = min(max(int(os.getenv("DAILY_BRIEF_PUBLISH_HOUR", "9")), 0), 23)
DAILY_BRIEF_POLL_SECONDS = max(float(os.getenv("DAILY_BRIEF_POLL_SECONDS", "30")), 5.0)
DAILY_BRIEF_WEBHOOK_URL = os.getenv("DAILY_BRIEF_WEBHOOK_URL", "").strip()
DAILY_BRIEF_CACHE_DIR = Path(
    os.getenv("DAILY_BRIEF_CACHE_DIR", str(Path(__file__).resolve().parents[1] / ".cache" / "daily_briefings"))
)

_stop_event = threading.Event()
_scheduler_thread: threading.Thread | None = None
_scheduler_lock = threading.Lock()
_generation_lock = threading.Lock()
logger = logging.getLogger(__name__)


def _utc_iso(value: datetime | None = None) -> str:
    return (value or datetime.now(UTC)).astimezone(UTC).isoformat()


def _brief_path(report_date: str) -> Path:
    return DAILY_BRIEF_CACHE_DIR / f"{report_date}.json"


def _read_brief(report_date: str) -> dict[str, Any] | None:
    path = _brief_path(report_date)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return None
    return payload if isinstance(payload, dict) else None


def _write_brief(payload: dict[str, Any]) -> None:
    DAILY_BRIEF_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = _brief_path(str(payload["date"]))
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    temporary.replace(path)


def _parse_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def _latest_argo_window(argo_region: dict[str, Any] | None, now: datetime) -> dict[str, Any]:
    profiles = list((argo_region or {}).get("profiles") or [])
    profiles.sort(key=lambda item: _parse_datetime(item.get("timestamp")) or datetime.min.replace(tzinfo=UTC), reverse=True)
    current_start = now - timedelta(hours=24)
    current_profiles = [
        profile for profile in profiles
        if (timestamp := _parse_datetime(profile.get("timestamp"))) is not None and current_start <= timestamp <= now
    ]
    latest = _parse_datetime(profiles[0].get("timestamp")) if profiles else None
    uses_latest_available = not current_profiles and latest is not None and latest < current_start
    window_end = latest if uses_latest_available and latest is not None else now
    window_start = window_end - timedelta(hours=24)
    selected = [
        profile for profile in profiles
        if (timestamp := _parse_datetime(profile.get("timestamp"))) is not None and window_start <= timestamp <= window_end
    ] if uses_latest_available else current_profiles
    platforms = {str(profile.get("platform")) for profile in selected if profile.get("platform")}
    bgc_platforms = {
        str(profile.get("platform")) for profile in selected
        if profile.get("platform") and profile.get("has_bgc") is True
    }
    return {
        "window_start": _utc_iso(window_start),
        "window_end": _utc_iso(window_end),
        "uses_latest_available_window": uses_latest_available,
        "profile_count": len(selected),
        "float_count": len(platforms),
        "bgc_float_count": len(bgc_platforms),
        "latest_observation_at": _utc_iso(latest) if latest is not None else None,
        "catalog_profile_count": int((argo_region or {}).get("profile_count") or 0),
        "catalog_float_count": int((argo_region or {}).get("float_count") or 0),
    }


def _event_time(event: Any) -> datetime | None:
    if hasattr(event, "model_dump"):
        event = event.model_dump(mode="json")
    if not isinstance(event, dict):
        return None
    return _parse_datetime(event.get("source_updated_at") or event.get("started_at"))


def _event_payload(event: Any) -> dict[str, Any]:
    if hasattr(event, "model_dump"):
        return event.model_dump(mode="json")
    return event if isinstance(event, dict) else {}


def generate_daily_briefing(now: datetime | None = None) -> dict[str, Any]:
    generated_at = (now or datetime.now(UTC)).astimezone(UTC)
    local_now = generated_at.astimezone(DAILY_BRIEF_TIME_ZONE)
    report_date = local_now.date().isoformat()
    with _generation_lock:
        existing = _read_brief(report_date)
        if existing is not None:
            return existing

        region = get_region(DEFAULT_REGION_ID)
        argo_region = get_argo_region(
            region_id=DEFAULT_REGION_ID,
            bounds=region["bounds"],
            region_name=region["name"],
            force_refresh=True,
        )
        copernicus = get_global_daily_data_volume(force_refresh=True)
        bundle = get_realtime_bundle(DEFAULT_REGION_ID, force_refresh=False)
        argo = _latest_argo_window(argo_region, generated_at)
        current_start = generated_at - timedelta(hours=24)
        recent_events = []
        for raw_event in bundle.get("events") or []:
            event = _event_payload(raw_event)
            observed_at = _event_time(event)
            if observed_at is None or not current_start <= observed_at <= generated_at:
                continue
            recent_events.append(event)
        recent_events.sort(
            key=lambda event: (
                event.get("event_kind") == "anomaly",
                float(event.get("severity") or 0),
                float(event.get("confidence") or 0),
            ),
            reverse=True,
        )
        anomaly_count = sum(event.get("event_kind") == "anomaly" for event in recent_events)
        current_products = [dataset for dataset in copernicus.get("datasets") or [] if dataset.get("is_current_day")]
        if anomaly_count:
            headline = f"全球海洋出现 {anomaly_count} 个需持续复核的变化信号"
        elif argo["profile_count"]:
            headline = f"Copernicus 今日场与 {argo['float_count']} 个 Argo 浮标共同更新"
        else:
            headline = "Copernicus Marine 今日全球场已更新"
        argo_window_name = "最新可用24小时" if argo["uses_latest_available_window"] else "过去24小时"
        summary = (
            f"Copernicus Marine 已汇总 {len(current_products)}/{copernicus.get('dataset_count', 0)} 个当日产品、"
            f"{int(copernicus.get('record_count') or 0):,} 条全球网格时次记录。"
            f"Argo {argo_window_name}包含 {argo['profile_count']} 条剖面，来自 {argo['float_count']} 个浮标，"
            f"其中 BGC 浮标 {argo['bgc_float_count']} 个。"
        )
        evidence = [
            f"Copernicus 当日有效产品 {len(current_products)} 个，变量值 {int(copernicus.get('value_count') or 0):,} 个。",
            f"Argo 近 {int(argo_region.get('lookback_days') or 0)} 天全量目录共 {argo['catalog_profile_count']:,} 条剖面、{argo['catalog_float_count']:,} 个浮标。",
            f"Argo {argo_window_name}统计窗为 {argo['window_start']} 至 {argo['window_end']}。",
        ]
        if argo["uses_latest_available_window"]:
            evidence.append("Argovis 发布存在延迟，已自动采用该数据源最新可用的完整24小时窗口，未将延迟误判为无数据。")
        evidence.extend(str(error) for error in copernicus.get("errors") or [])
        evidence.extend(str(error) for error in bundle.get("errors") or [])
        publish_local = datetime.combine(local_now.date(), datetime_time(DAILY_BRIEF_PUBLISH_HOUR), DAILY_BRIEF_TIME_ZONE)
        payload = {
            "date": report_date,
            "region_id": DEFAULT_REGION_ID,
            "status": "generated",
            "generated_at": _utc_iso(generated_at),
            "publish_at": _utc_iso(publish_local),
            "published_at": None,
            "headline": headline,
            "summary": summary,
            "highlights": [str(event.get("title")) for event in recent_events[:5] if event.get("title")],
            "evidence": evidence,
            "anomaly_count": anomaly_count,
            "copernicus": {
                "date": copernicus.get("date"),
                "dataset_count": int(copernicus.get("dataset_count") or 0),
                "current_dataset_count": len(current_products),
                "record_count": int(copernicus.get("record_count") or 0),
                "value_count": int(copernicus.get("value_count") or 0),
                "latest_observation_at": copernicus.get("latest_observation_at"),
                "status": copernicus.get("status"),
            },
            "argo": argo,
            "delivery": {
                "in_app": "scheduled",
                "webhook_configured": bool(DAILY_BRIEF_WEBHOOK_URL),
                "webhook_delivered_at": None,
                "webhook_last_attempt_at": None,
                "webhook_error": None,
            },
        }
        _write_brief(payload)
        return deepcopy(payload)


def _deliver_webhook(payload: dict[str, Any]) -> dict[str, Any]:
    delivery = payload.setdefault("delivery", {})
    if not DAILY_BRIEF_WEBHOOK_URL:
        return payload
    delivery["webhook_last_attempt_at"] = _utc_iso()
    request = Request(
        DAILY_BRIEF_WEBHOOK_URL,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "ocean-intelligence-daily-brief/1.0"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=15) as response:
            if not 200 <= response.status < 300:
                raise RuntimeError(f"webhook returned HTTP {response.status}")
        delivery["webhook_delivered_at"] = _utc_iso()
        delivery["webhook_error"] = None
    except Exception as error:  # noqa: BLE001 - persisted for retry and operations visibility
        delivery["webhook_error"] = str(error)
    return payload


def publish_daily_briefing(report_date: str, now: datetime | None = None) -> dict[str, Any] | None:
    payload = _read_brief(report_date)
    if payload is None:
        return None
    published_at = (now or datetime.now(UTC)).astimezone(UTC)
    if payload.get("status") != "published":
        payload["status"] = "published"
        payload["published_at"] = _utc_iso(published_at)
        payload.setdefault("delivery", {})["in_app"] = "published"
    payload = _deliver_webhook(payload)
    _write_brief(payload)
    return deepcopy(payload)


def get_daily_briefing(report_date: str | None = None) -> dict[str, Any] | None:
    target_date = report_date or datetime.now(UTC).astimezone(DAILY_BRIEF_TIME_ZONE).date().isoformat()
    payload = _read_brief(target_date)
    return deepcopy(payload) if payload is not None else None


def run_daily_briefing_tick(now: datetime | None = None) -> dict[str, Any] | None:
    current = (now or datetime.now(UTC)).astimezone(UTC)
    local_now = current.astimezone(DAILY_BRIEF_TIME_ZONE)
    report_date = local_now.date().isoformat()
    generate_at = datetime.combine(local_now.date(), datetime_time(DAILY_BRIEF_GENERATE_HOUR), DAILY_BRIEF_TIME_ZONE)
    publish_at = datetime.combine(local_now.date(), datetime_time(DAILY_BRIEF_PUBLISH_HOUR), DAILY_BRIEF_TIME_ZONE)
    payload = _read_brief(report_date)
    if local_now >= generate_at and payload is None:
        payload = generate_daily_briefing(current)
    if local_now >= publish_at and payload is not None:
        delivery = payload.get("delivery") or {}
        last_attempt = _parse_datetime(delivery.get("webhook_last_attempt_at"))
        should_retry_webhook = bool(DAILY_BRIEF_WEBHOOK_URL) and not delivery.get("webhook_delivered_at") and (
            last_attempt is None or current - last_attempt >= timedelta(minutes=5)
        )
        if payload.get("status") != "published" or should_retry_webhook:
            payload = publish_daily_briefing(report_date, current)
    return payload


def _scheduler_loop() -> None:
    while not _stop_event.is_set():
        try:
            run_daily_briefing_tick()
        except Exception:  # noqa: BLE001 - next scheduler tick retries and API remains available
            logger.exception("daily briefing scheduler tick failed")
        _stop_event.wait(DAILY_BRIEF_POLL_SECONDS)


def start_daily_briefing_scheduler() -> None:
    global _scheduler_thread
    with _scheduler_lock:
        if _scheduler_thread is not None and _scheduler_thread.is_alive():
            return
        _stop_event.clear()
        _scheduler_thread = threading.Thread(target=_scheduler_loop, name="daily-briefing-scheduler", daemon=True)
        _scheduler_thread.start()


def stop_daily_briefing_scheduler() -> None:
    global _scheduler_thread
    _stop_event.set()
    with _scheduler_lock:
        thread = _scheduler_thread
        _scheduler_thread = None
    if thread is not None:
        thread.join(timeout=5)


def local_schedule() -> dict[str, Any]:
    return {
        "time_zone": str(DAILY_BRIEF_TIME_ZONE),
        "generate_time": f"{DAILY_BRIEF_GENERATE_HOUR:02d}:00",
        "publish_time": f"{DAILY_BRIEF_PUBLISH_HOUR:02d}:00",
    }
