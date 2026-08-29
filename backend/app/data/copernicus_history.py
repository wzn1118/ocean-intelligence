from __future__ import annotations

import json
import os
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock
from typing import Any

from app.data.copernicus_client import get_full_point_history


HISTORY_DB_PATH = Path(
    os.getenv(
        "COPERNICUSMARINE_HISTORY_DB_PATH",
        str(Path(__file__).resolve().parents[3] / ".runtime" / "copernicus_history.sqlite3"),
    )
)
_schema_lock = Lock()
_sync_locks: dict[str, Lock] = {}


def _connect() -> sqlite3.Connection:
    HISTORY_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(HISTORY_DB_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA busy_timeout=30000")
    return connection


def _ensure_schema() -> None:
    with _schema_lock, _connect() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS copernicus_history_records (
                source TEXT NOT NULL,
                dataset_id TEXT NOT NULL,
                point_key TEXT NOT NULL,
                longitude REAL NOT NULL,
                latitude REAL NOT NULL,
                timestamp TEXT NOT NULL,
                payload TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (source, dataset_id, point_key, timestamp)
            );
            CREATE INDEX IF NOT EXISTS idx_copernicus_history_lookup
                ON copernicus_history_records (source, point_key, timestamp DESC);
            CREATE TABLE IF NOT EXISTS copernicus_history_syncs (
                source TEXT NOT NULL,
                dataset_id TEXT NOT NULL,
                point_key TEXT NOT NULL,
                longitude REAL NOT NULL,
                latitude REAL NOT NULL,
                record_count INTEGER NOT NULL,
                start_datetime TEXT,
                end_datetime TEXT,
                synced_at TEXT NOT NULL,
                PRIMARY KEY (source, dataset_id, point_key)
            );
            """
        )


def _point_key(source: str, longitude: float, latitude: float) -> str:
    resolution = 1 / 12 if source == "wave" else 0.125
    grid_longitude = round(longitude / resolution) * resolution
    grid_latitude = round(latitude / resolution) * resolution
    return f"{grid_longitude:.5f}:{grid_latitude:.5f}"


def sync_point_history(source: str, longitude: float, latitude: float) -> dict[str, Any]:
    _ensure_schema()
    point_key = _point_key(source, longitude, latitude)
    lock_key = f"{source}:{point_key}"
    lock = _sync_locks.setdefault(lock_key, Lock())
    with lock:
        result = get_full_point_history(source, longitude, latitude)
        updated_at = datetime.now(UTC).isoformat()
        rows = [
            (
                source,
                result["dataset_id"],
                point_key,
                longitude,
                latitude,
                record["timestamp"],
                json.dumps(record, ensure_ascii=False, separators=(",", ":")),
                updated_at,
            )
            for record in result["records"]
        ]
        with _connect() as connection:
            connection.execute(
                "DELETE FROM copernicus_history_records WHERE source=? AND dataset_id=? AND point_key=?",
                (source, result["dataset_id"], point_key),
            )
            connection.executemany(
                """
                INSERT INTO copernicus_history_records
                    (source, dataset_id, point_key, longitude, latitude, timestamp, payload, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(source, dataset_id, point_key, timestamp)
                DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at
                """,
                rows,
            )
            connection.execute(
                """
                INSERT INTO copernicus_history_syncs
                    (source, dataset_id, point_key, longitude, latitude, record_count, start_datetime, end_datetime, synced_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(source, dataset_id, point_key)
                DO UPDATE SET record_count=excluded.record_count,
                    start_datetime=excluded.start_datetime,
                    end_datetime=excluded.end_datetime,
                    synced_at=excluded.synced_at
                """,
                (
                    source,
                    result["dataset_id"],
                    point_key,
                    longitude,
                    latitude,
                    result["record_count"],
                    result["start_datetime"],
                    result["end_datetime"],
                    updated_at,
                ),
            )
        return query_point_history(source, longitude, latitude, limit=200, offset=0)


def append_point_records(
    source: str,
    dataset_id: str,
    longitude: float,
    latitude: float,
    records: list[dict[str, Any]],
) -> None:
    valid_records = [record for record in records if isinstance(record.get("timestamp"), str)]
    if not valid_records:
        return
    _ensure_schema()
    point_key = _point_key(source, longitude, latitude)
    updated_at = datetime.now(UTC).isoformat()
    rows = [
        (
            source,
            dataset_id,
            point_key,
            longitude,
            latitude,
            record["timestamp"],
            json.dumps(record, ensure_ascii=False, separators=(",", ":")),
            updated_at,
        )
        for record in valid_records
    ]
    with _connect() as connection:
        connection.executemany(
            """
            INSERT INTO copernicus_history_records
                (source, dataset_id, point_key, longitude, latitude, timestamp, payload, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source, dataset_id, point_key, timestamp)
            DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at
            """,
            rows,
        )
        statistics = connection.execute(
            """
            SELECT COUNT(*) AS record_count, MIN(timestamp) AS start_datetime, MAX(timestamp) AS end_datetime
            FROM copernicus_history_records
            WHERE source=? AND dataset_id=? AND point_key=?
            """,
            (source, dataset_id, point_key),
        ).fetchone()
        connection.execute(
            """
            INSERT INTO copernicus_history_syncs
                (source, dataset_id, point_key, longitude, latitude, record_count, start_datetime, end_datetime, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source, dataset_id, point_key)
            DO UPDATE SET longitude=excluded.longitude,
                latitude=excluded.latitude,
                record_count=excluded.record_count,
                start_datetime=excluded.start_datetime,
                end_datetime=excluded.end_datetime,
                synced_at=excluded.synced_at
            """,
            (
                source,
                dataset_id,
                point_key,
                longitude,
                latitude,
                int(statistics["record_count"]),
                statistics["start_datetime"],
                statistics["end_datetime"],
                updated_at,
            ),
        )


def append_region_snapshot(source: str, snapshot: dict[str, Any]) -> None:
    dataset_id = str(snapshot.get("dataset_id") or "")
    if not dataset_id:
        return
    for point in snapshot.get("points") or []:
        try:
            longitude = float(point["longitude"])
            latitude = float(point["latitude"])
        except (KeyError, TypeError, ValueError):
            continue
        record = {key: value for key, value in point.items() if key not in {"longitude", "latitude"}}
        append_point_records(source, dataset_id, longitude, latitude, [record])


def query_point_history(
    source: str,
    longitude: float,
    latitude: float,
    *,
    limit: int = 200,
    offset: int = 0,
) -> dict[str, Any]:
    _ensure_schema()
    point_key = _point_key(source, longitude, latitude)
    with _connect() as connection:
        sync = connection.execute(
            """
            SELECT * FROM copernicus_history_syncs
            WHERE source=? AND point_key=?
            ORDER BY synced_at DESC LIMIT 1
            """,
            (source, point_key),
        ).fetchone()
        if sync is None:
            return {
                "source": source,
                "dataset_id": "",
                "longitude": longitude,
                "latitude": latitude,
                "total": 0,
                "offset": offset,
                "limit": limit,
                "start_datetime": None,
                "end_datetime": None,
                "synced_at": None,
                "records": [],
            }
        rows = connection.execute(
            """
            SELECT payload FROM copernicus_history_records
            WHERE source=? AND dataset_id=? AND point_key=?
            ORDER BY timestamp DESC LIMIT ? OFFSET ?
            """,
            (source, sync["dataset_id"], point_key, limit, offset),
        ).fetchall()
    return {
        "source": source,
        "dataset_id": sync["dataset_id"],
        "longitude": sync["longitude"],
        "latitude": sync["latitude"],
        "total": sync["record_count"],
        "offset": offset,
        "limit": limit,
        "start_datetime": sync["start_datetime"],
        "end_datetime": sync["end_datetime"],
        "synced_at": sync["synced_at"],
        "records": [json.loads(row["payload"]) for row in rows],
    }
