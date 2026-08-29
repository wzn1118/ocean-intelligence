"""One-shot, resource-bounded publication of the daily Copernicus event index."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import time
from collections import Counter, defaultdict, deque
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable
from uuid import uuid4

from pydantic import ValidationError
from app.data.marine_area_catalog import MARINE_AREA_CATALOG, locate_marine_area
from app.models import OceanEvent


BACKEND_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INDEX_PATH = Path(os.getenv("COPERNICUS_DAILY_INDEX_PATH", str(BACKEND_ROOT / ".cache" / "copernicus_daily_index" / "active.sqlite3")))
DEFAULT_SOURCE_CACHE = Path(os.getenv("COPERNICUS_DAILY_SOURCE_CACHE", str(BACKEND_ROOT / ".cache" / "realtime" / "global_ocean.json")))
DEFAULT_TARGET = int(os.getenv("COPERNICUS_DAILY_TARGET", "10000"))
GEOGRAPHY_QUOTAS = {"china_mainland": 5500, "taiwan_related": 1000, "global": 2500}
CONFIRMED_STATES = {"corroborated", "confirmed"}
MARINE_AREAS_BY_ID = {str(area["id"]): area for area in MARINE_AREA_CATALOG}


def _is_copernicus_event(event: dict[str, Any]) -> bool:
    return any("COPERNICUS" in str(source).upper() or "CMEMS" in str(source).upper() for source in event.get("sources", []))


def _score(event: dict[str, Any]) -> tuple[float, float, float, str]:
    return (
        float(event.get("severity") or 0),
        float(event.get("confidence") or 0),
        float(event.get("observation_count") or 0),
        str(event.get("started_at") or ""),
    )


def _decorate(event: dict[str, Any]) -> dict[str, Any]:
    centroid = event.get("centroid") or [None, None]
    area = MARINE_AREAS_BY_ID.get(str(event.get("marine_area_id") or ""))
    if area is None and len(centroid) >= 2 and centroid[0] is not None and centroid[1] is not None:
        area = locate_marine_area(float(centroid[0]), float(centroid[1]))
    geography = str(event.get("geography") or (area["geography"] if area else "global"))
    return {
        "event": event,
        "area": area,
        "geography": geography,
        "score": _score(event),
    }


def _coverage_first(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[str, deque[dict[str, Any]]] = defaultdict(deque)
    for row in sorted(rows, key=lambda item: item["score"], reverse=True):
        area = row.get("area")
        key = str(area["id"]) if area else "unclassified"
        groups[key].append(row)
    ordered: list[dict[str, Any]] = []
    while groups:
        for key in list(groups):
            ordered.append(groups[key].popleft())
            if not groups[key]:
                del groups[key]
    return ordered


def select_daily_events(events: Iterable[dict[str, Any]], target: int = DEFAULT_TARGET) -> list[dict[str, Any]]:
    unique: dict[str, dict[str, Any]] = {}
    for event in events:
        if not _is_copernicus_event(event):
            continue
        event_id = str(event.get("id") or "").strip()
        if event_id:
            unique[event_id] = event
    rows = [_decorate(event) for event in unique.values()]
    anomalies = _coverage_first(row for row in rows if row["event"].get("event_kind") == "anomaly")
    selected = anomalies[: min(1000, target)]
    selected_ids = {row["event"]["id"] for row in selected}
    remaining_target = max(0, target - len(selected))

    for geography, configured_quota in GEOGRAPHY_QUOTAS.items():
        if remaining_target <= 0:
            break
        quota = min(configured_quota, remaining_target)
        candidates = _coverage_first(
            row
            for row in rows
            if row["geography"] == geography and row["event"]["id"] not in selected_ids
        )
        chosen = candidates[:quota]
        selected.extend(chosen)
        selected_ids.update(row["event"]["id"] for row in chosen)
        remaining_target -= len(chosen)

    if remaining_target:
        fill = _coverage_first(row for row in rows if row["event"]["id"] not in selected_ids)
        selected.extend(fill[:remaining_target])
    selected.sort(
        key=lambda row: (
            row["event"].get("event_kind") == "anomaly",
            row["geography"] == "china_mainland",
            row["geography"] == "taiwan_related",
            row["score"],
        ),
        reverse=True,
    )
    return selected[:target]


def _primary_reading(event: dict[str, Any]) -> str:
    evidence = list(event.get("evidence") or [])
    if not evidence:
        return ""
    primary = evidence[0]
    unit = str(primary.get("unit") or "")
    if event.get("event_kind") == "observation":
        return f"{primary.get('variable', '')} {primary.get('observed', '')} {unit}".strip()
    anomaly = float(primary.get("anomaly") or 0)
    return f"较基线{'高' if anomaly >= 0 else '低'} {abs(anomaly):g} {unit}".strip()


def _summary(event: dict[str, Any]) -> dict[str, Any]:
    keys = (
        "id", "type", "event_kind", "title", "summary", "region", "centroid", "radius_km",
        "radius_basis", "started_at", "status", "severity", "severity_label", "confidence",
        "variables", "region_id", "data_mode", "validation_state", "observation_count",
        "source_updated_at", "lifecycle_state", "first_detected_at", "last_seen_at",
        "lifecycle_revision", "consecutive_updates", "lifecycle_duration_hours",
        "category", "marine_area_id", "geography", "source_dataset_id",
    )
    return {key: event.get(key) for key in keys if key in event} | {"primary_reading": _primary_reading(event)}


def load_source_cache(path: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        document = json.load(handle)
    bundle = document.get("bundle", document)
    events = list(bundle.get("events") or [])
    return events, {
        "source_path": str(path),
        "source_saved_at": document.get("saved_at"),
        "source_refreshed_at": bundle.get("refreshed_at"),
    }


def _create_database(path: Path, rows: list[dict[str, Any]], source_meta: dict[str, Any], target: int) -> dict[str, Any]:
    generated_at = datetime.now(UTC).isoformat()
    run_id = uuid4().hex
    counts = Counter(row["geography"] for row in rows)
    kinds = Counter(row["event"].get("event_kind") for row in rows)
    categories = Counter(row["event"].get("category") for row in rows)
    covered_area_ids = {row["area"]["id"] for row in rows if row.get("area")}
    manifest = {
        "run_id": run_id,
        "generated_at": generated_at,
        "target": target,
        "total": len(rows),
        "shortfall": max(0, target - len(rows)),
        "observations": kinds.get("observation", 0),
        "signals": kinds.get("anomaly", 0),
        "wind": categories.get("wind", 0),
        "wave": categories.get("wave", 0),
        "current": categories.get("current", 0),
        "china_mainland": counts.get("china_mainland", 0),
        "taiwan_related": counts.get("taiwan_related", 0),
        "global": counts.get("global", 0),
        "catalogue_total": len(MARINE_AREA_CATALOG),
        "catalogue_with_geometry": sum(area["geometry_status"] != "missing" for area in MARINE_AREA_CATALOG),
        "catalogue_covered": len(covered_area_ids),
        **source_meta,
    }
    connection = sqlite3.connect(path)
    try:
        connection.executescript(
            """
            PRAGMA journal_mode=DELETE;
            PRAGMA synchronous=FULL;
            CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE marine_areas (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, name_en TEXT NOT NULL,
                kind TEXT NOT NULL, parent TEXT NOT NULL, geography TEXT NOT NULL,
                geometry_status TEXT NOT NULL, covered INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE events (
                position INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL,
                event_kind TEXT NOT NULL, validation_state TEXT NOT NULL,
                marine_area_id TEXT, marine_area_name TEXT, geography TEXT NOT NULL,
                severity REAL NOT NULL, started_at TEXT NOT NULL,
                summary_json TEXT NOT NULL, event_json TEXT NOT NULL
            );
            CREATE INDEX events_filter_idx ON events(event_kind, validation_state, geography, position);
            CREATE INDEX events_area_idx ON events(marine_area_id, position);
            """
        )
        connection.executemany(
            "INSERT INTO metadata(key, value) VALUES (?, ?)",
            [(key, json.dumps(value, ensure_ascii=False, separators=(",", ":"))) for key, value in manifest.items()],
        )
        connection.executemany(
            "INSERT INTO marine_areas VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    area["id"], area["name"], area["name_en"], area["kind"], area["parent"],
                    area["geography"], area["geometry_status"], int(area["id"] in covered_area_ids),
                )
                for area in MARINE_AREA_CATALOG
            ],
        )
        connection.executemany(
            "INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    position,
                    row["event"]["id"],
                    row["event"].get("event_kind", "anomaly"),
                    row["event"].get("validation_state", "screening"),
                    row["area"]["id"] if row.get("area") else None,
                    row["area"]["name"] if row.get("area") else None,
                    row["geography"],
                    float(row["event"].get("severity") or 0),
                    str(row["event"].get("started_at") or generated_at),
                    json.dumps(_summary(row["event"]), ensure_ascii=False, separators=(",", ":")),
                    json.dumps(row["event"], ensure_ascii=False, separators=(",", ":")),
                )
                for position, row in enumerate(rows)
            ],
        )
        connection.commit()
        result = connection.execute("PRAGMA integrity_check").fetchone()
        if not result or result[0] != "ok":
            raise RuntimeError("Copernicus daily index integrity check failed")
    finally:
        connection.close()
    return manifest


def publish_daily_index(source_cache: Path, index_path: Path = DEFAULT_INDEX_PATH, target: int = DEFAULT_TARGET) -> dict[str, Any]:
    started = time.monotonic()
    events, source_meta = load_source_cache(source_cache)
    rows = select_daily_events(events, target=target)
    index_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = index_path.with_name(f".{index_path.name}.{os.getpid()}.{uuid4().hex}.tmp")
    try:
        manifest = _create_database(temporary, rows, source_meta, target)
        temporary.replace(index_path)
    finally:
        temporary.unlink(missing_ok=True)
    manifest["elapsed_seconds"] = round(time.monotonic() - started, 3)
    return manifest


def _where_clause(view: str, area: str | None, geography: str | None) -> tuple[str, list[Any]]:
    clauses: list[str] = []
    parameters: list[Any] = []
    if view == "observations":
        clauses.append("event_kind = 'observation'")
    elif view == "signals":
        clauses.append("event_kind = 'anomaly'")
    elif view == "events":
        clauses.append("event_kind = 'anomaly' AND validation_state IN ('corroborated', 'confirmed')")
    elif view != "all":
        raise ValueError("unsupported view")
    if area:
        clauses.append("marine_area_id = ?")
        parameters.append(area)
    if geography:
        clauses.append("geography = ?")
        parameters.append(geography)
    return (" WHERE " + " AND ".join(clauses) if clauses else ""), parameters


def index_status(index_path: Path = DEFAULT_INDEX_PATH) -> dict[str, Any]:
    if not index_path.exists():
        return {"available": False, "path": str(index_path)}
    connection = sqlite3.connect(index_path)
    try:
        metadata = {key: json.loads(value) for key, value in connection.execute("SELECT key, value FROM metadata")}
    finally:
        connection.close()
    return {"available": True, **metadata}


def read_event_page(
    *, cursor: int = 0, limit: int = 100, view: str = "all", area: str | None = None,
    geography: str | None = None, index_path: Path = DEFAULT_INDEX_PATH,
) -> dict[str, Any]:
    if not index_path.exists():
        return {"available": False, "events": [], "cursor": cursor, "next_cursor": None, "total": 0}
    where, parameters = _where_clause(view, area, geography)
    connection = sqlite3.connect(index_path)
    try:
        total = int(connection.execute(f"SELECT COUNT(*) FROM events{where}", parameters).fetchone()[0])
        count_row = connection.execute(
            """
            SELECT
                COUNT(*),
                SUM(event_kind = 'observation'),
                SUM(event_kind = 'anomaly'),
                SUM(event_kind = 'anomaly' AND validation_state IN ('corroborated', 'confirmed'))
            FROM events
            """
        ).fetchone()
        records = connection.execute(
            f"SELECT summary_json, marine_area_id, marine_area_name, geography FROM events{where} ORDER BY position LIMIT ? OFFSET ?",
            [*parameters, limit, cursor],
        ).fetchall()
    finally:
        connection.close()
    events = []
    for summary_json, area_id, area_name, row_geography in records:
        summary = json.loads(summary_json)
        summary["marine_area_id"] = area_id
        summary["marine_area_name"] = area_name
        summary["geography"] = row_geography
        events.append(summary)
    next_cursor = cursor + len(events) if cursor + len(events) < total else None
    return {
        "available": True,
        "events": events,
        "cursor": cursor,
        "next_cursor": next_cursor,
        "has_more": next_cursor is not None,
        "total": total,
        "event_counts": {
            "total": int(count_row[0] or 0),
            "observations": int(count_row[1] or 0),
            "signals": int(count_row[2] or 0),
            "events": int(count_row[3] or 0),
            "by_variable": {},
            "by_type": {},
            "by_kind": {
                "observation": int(count_row[1] or 0),
                "anomaly": int(count_row[2] or 0),
            },
            "by_lifecycle": {},
            "by_filter": {},
        },
    }


def get_index_event(event_id: str, index_path: Path = DEFAULT_INDEX_PATH) -> OceanEvent | None:
    if not index_path.exists():
        return None
    connection = sqlite3.connect(index_path)
    try:
        row = connection.execute("SELECT event_json FROM events WHERE id = ?", (event_id,)).fetchone()
    finally:
        connection.close()
    if not row:
        return None
    try:
        return OceanEvent.model_validate_json(row[0])
    except ValidationError as error:
        raise RuntimeError(f"Copernicus index event validation failed for {event_id}") from error


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the daily Copernicus event index from a persisted cache.")
    parser.add_argument("--source-cache", type=Path, default=DEFAULT_SOURCE_CACHE)
    parser.add_argument("--index-path", type=Path, default=DEFAULT_INDEX_PATH)
    parser.add_argument("--target", type=int, default=DEFAULT_TARGET)
    args = parser.parse_args()
    manifest = publish_daily_index(args.source_cache, args.index_path, max(1, min(args.target, 10000)))
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
