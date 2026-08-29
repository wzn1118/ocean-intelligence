from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import sqlite3
import threading
import time
from collections import defaultdict, deque
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterator
from uuid import uuid4


def _now() -> int:
    return int(time.time())


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        redacted = {}
        for key, child in value.items():
            normalized = str(key).casefold().replace("-", "_")
            if any(marker in normalized for marker in ("authorization", "cookie", "password", "secret", "api_key", "apikey", "token", "credential")):
                redacted[key] = "[REDACTED]"
            else:
                redacted[key] = _redact(child)
        return redacted
    if isinstance(value, list):
        return [_redact(item) for item in value]
    return value


class _Connection:
    def __init__(self, raw: Any, postgres: bool) -> None:
        self.raw = raw
        self.postgres = postgres

    def execute(self, sql: str, parameters: tuple[Any, ...] = ()) -> Any:
        return self.raw.execute(sql.replace("?", "%s") if self.postgres else sql, parameters)

    def executescript(self, script: str) -> None:
        if self.postgres:
            for statement in script.split(";"):
                if statement.strip():
                    self.raw.execute(statement)
        else:
            self.raw.executescript(script)

    def __enter__(self) -> "_Connection":
        self.raw.__enter__()
        return self

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> Any:
        return self.raw.__exit__(exc_type, exc, traceback)


class McpStateStore:
    def __init__(self, path: str | Path | None = None) -> None:
        default = Path(__file__).resolve().parents[2] / ".runtime" / "mcp-state.sqlite3"
        self.database_url = "" if path is not None else os.getenv("OCEAN_MCP_STATE_DATABASE_URL", "").strip()
        self.postgres = self.database_url.startswith(("postgresql://", "postgres://"))
        self.path = Path(path or os.getenv("OCEAN_MCP_STATE_DB", str(default)))
        if not self.postgres:
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._initialize()

    def _connect(self) -> _Connection:
        if self.postgres:
            import psycopg
            from psycopg.rows import dict_row
            return _Connection(psycopg.connect(self.database_url, row_factory=dict_row), True)
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA busy_timeout=30000")
        return _Connection(connection, False)

    def _initialize(self) -> None:
        with self._connect() as connection:
            audit_primary_key = "BIGSERIAL PRIMARY KEY" if self.postgres else "INTEGER PRIMARY KEY AUTOINCREMENT"
            connection.executescript(
                f"""
                CREATE TABLE IF NOT EXISTS mcp_sessions (
                    id TEXT PRIMARY KEY,
                    protocol TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    expires_at INTEGER NOT NULL,
                    subscriptions_json TEXT NOT NULL DEFAULT '[]'
                );
                CREATE TABLE IF NOT EXISTS mcp_snapshots (
                    id TEXT PRIMARY KEY,
                    owner_id TEXT NOT NULL,
                    region_id TEXT NOT NULL,
                    dataset_id TEXT NOT NULL,
                    data_version TEXT,
                    payload_json TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    expires_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_mcp_snapshots_expiry ON mcp_snapshots(expires_at);
                CREATE TABLE IF NOT EXISTS mcp_jobs (
                    id TEXT PRIMARY KEY,
                    owner_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    status TEXT NOT NULL,
                    request_json TEXT NOT NULL,
                    result_json TEXT,
                    error TEXT,
                    cancel_requested INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_mcp_jobs_owner ON mcp_jobs(owner_id, created_at DESC);
                CREATE TABLE IF NOT EXISTS mcp_audit (
                    id {audit_primary_key},
                    occurred_at INTEGER NOT NULL,
                    owner_id TEXT NOT NULL,
                    request_id TEXT,
                    tool_name TEXT NOT NULL,
                    argument_hash TEXT NOT NULL,
                    argument_summary TEXT NOT NULL,
                    duration_ms REAL NOT NULL,
                    success INTEGER NOT NULL,
                    result_count INTEGER,
                    error_code TEXT,
                    write_operation INTEGER NOT NULL,
                    task_id TEXT,
                    external_source TEXT,
                    data_version TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_mcp_audit_time ON mcp_audit(occurred_at DESC);
                """
            )
            if self.postgres:
                for column in ("task_id TEXT", "external_source TEXT", "data_version TEXT"):
                    connection.execute(f"ALTER TABLE mcp_audit ADD COLUMN IF NOT EXISTS {column}")
            else:
                existing_columns = {row[1] for row in connection.execute("PRAGMA table_info(mcp_audit)")}
                for column in ("task_id TEXT", "external_source TEXT", "data_version TEXT"):
                    if column.split()[0] not in existing_columns:
                        connection.execute(f"ALTER TABLE mcp_audit ADD COLUMN {column}")
            connection.execute("UPDATE mcp_jobs SET status='interrupted', updated_at=? WHERE status IN ('queued','running')", (_now(),))

    def cleanup(self) -> None:
        now = _now()
        with self._connect() as connection:
            connection.execute("DELETE FROM mcp_sessions WHERE expires_at < ?", (now,))
            connection.execute("DELETE FROM mcp_snapshots WHERE expires_at < ?", (now,))

    def create_session(self, protocol: str, ttl_seconds: int = 3600) -> str:
        self.cleanup()
        session_id = uuid4().hex
        now = _now()
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO mcp_sessions(id, protocol, created_at, updated_at, expires_at) VALUES(?,?,?,?,?)",
                (session_id, protocol, now, now, now + ttl_seconds),
            )
        return session_id

    def session_exists(self, session_id: str, ttl_seconds: int = 3600) -> bool:
        now = _now()
        with self._connect() as connection:
            row = connection.execute("SELECT expires_at FROM mcp_sessions WHERE id=?", (session_id,)).fetchone()
            if row is None or int(row["expires_at"]) < now:
                if row is not None:
                    connection.execute("DELETE FROM mcp_sessions WHERE id=?", (session_id,))
                return False
            connection.execute("UPDATE mcp_sessions SET updated_at=?, expires_at=? WHERE id=?", (now, now + ttl_seconds, session_id))
        return True

    def delete_session(self, session_id: str) -> None:
        with self._connect() as connection:
            connection.execute("DELETE FROM mcp_sessions WHERE id=?", (session_id,))

    def subscribe(self, session_id: str, uri: str, enabled: bool = True) -> None:
        with self._connect() as connection:
            row = connection.execute("SELECT subscriptions_json FROM mcp_sessions WHERE id=?", (session_id,)).fetchone()
            if row is None:
                raise LookupError("MCP session is not found")
            subscriptions = set(json.loads(row["subscriptions_json"] or "[]"))
            if enabled:
                subscriptions.add(uri)
            else:
                subscriptions.discard(uri)
            connection.execute("UPDATE mcp_sessions SET subscriptions_json=?, updated_at=? WHERE id=?", (_json(sorted(subscriptions)), _now(), session_id))

    def session(self, session_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM mcp_sessions WHERE id=?", (session_id,)).fetchone()
        if row is None or int(row["expires_at"]) < _now():
            return None
        return {"session_id": row["id"], "protocol": row["protocol"], "expires_at": int(row["expires_at"]), "subscriptions": json.loads(row["subscriptions_json"] or "[]")}

    def create_snapshot(self, owner_id: str, region_id: str, dataset_id: str, data_version: str | None, records: list[Any], ttl_seconds: int) -> dict[str, Any]:
        self.cleanup()
        snapshot_id = uuid4().hex
        now = _now()
        expires_at = now + ttl_seconds
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO mcp_snapshots(id, owner_id, region_id, dataset_id, data_version, payload_json, created_at, expires_at) VALUES(?,?,?,?,?,?,?,?)",
                (snapshot_id, owner_id, region_id, dataset_id, data_version, _json(records), now, expires_at),
            )
        return {"snapshot_id": snapshot_id, "created_at": now, "expires_at": expires_at, "data_version": data_version, "records": records}

    def get_snapshot(self, snapshot_id: str, owner_id: str, region_id: str, dataset_id: str) -> dict[str, Any] | None:
        self.cleanup()
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM mcp_snapshots WHERE id=? AND owner_id=? AND region_id=? AND dataset_id=?",
                (snapshot_id, owner_id, region_id, dataset_id),
            ).fetchone()
        if row is None:
            return None
        return {
            "snapshot_id": row["id"],
            "created_at": int(row["created_at"]),
            "expires_at": int(row["expires_at"]),
            "data_version": row["data_version"],
            "records": json.loads(row["payload_json"]),
        }

    def create_job(self, owner_id: str, kind: str, request: dict[str, Any]) -> dict[str, Any]:
        job_id = uuid4().hex
        now = _now()
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO mcp_jobs(id, owner_id, kind, status, request_json, created_at, updated_at) VALUES(?,?,?,?,?,?,?)",
                (job_id, owner_id, kind, "queued", _json(request), now, now),
            )
        return self.get_job(job_id, owner_id) or {}

    def update_job(self, job_id: str, **changes: Any) -> None:
        allowed = {"status", "result_json", "error", "cancel_requested"}
        updates = []
        values = []
        for key, value in changes.items():
            if key not in allowed:
                continue
            updates.append(f"{key}=?")
            values.append(_json(value) if key == "result_json" and value is not None else value)
        if not updates:
            return
        updates.append("updated_at=?")
        values.append(_now())
        values.append(job_id)
        with self._connect() as connection:
            connection.execute(f"UPDATE mcp_jobs SET {', '.join(updates)} WHERE id=?", values)

    def get_job(self, job_id: str, owner_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM mcp_jobs WHERE id=? AND owner_id=?", (job_id, owner_id)).fetchone()
        if row is None:
            return None
        return {
            "job_id": row["id"], "owner_id": row["owner_id"], "kind": row["kind"], "status": row["status"],
            "request": json.loads(row["request_json"]), "result": json.loads(row["result_json"]) if row["result_json"] else None,
            "error": row["error"], "cancel_requested": bool(row["cancel_requested"]),
            "created_at": int(row["created_at"]), "updated_at": int(row["updated_at"]),
        }

    def audit(self, *, owner_id: str, request_id: Any, tool_name: str, arguments: dict[str, Any], duration_ms: float, success: bool, result_count: int | None, error_code: str | None, write_operation: bool, task_id: str | None = None, external_source: str | None = None, data_version: str | None = None) -> None:
        safe_arguments = _redact(arguments)
        summary = _json(safe_arguments)
        if len(summary) > 2000:
            summary = summary[:2000] + "…"
        digest = hashlib.sha256(summary.encode("utf-8")).hexdigest()
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO mcp_audit(occurred_at, owner_id, request_id, tool_name, argument_hash, argument_summary, duration_ms, success, result_count, error_code, write_operation, task_id, external_source, data_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (_now(), owner_id, str(request_id) if request_id is not None else None, tool_name, digest, summary, duration_ms, int(success), result_count, error_code, int(write_operation), task_id, external_source, data_version),
            )

    def audit_page(self, owner_id: str, cursor: int = 0, limit: int = 100) -> dict[str, Any]:
        limit = max(1, min(limit, 500))
        cursor = max(0, cursor)
        with self._connect() as connection:
            count_row = connection.execute("SELECT COUNT(*) AS total FROM mcp_audit WHERE owner_id=?", (owner_id,)).fetchone()
            total = int(count_row["total"])
            rows = connection.execute("SELECT * FROM mcp_audit WHERE owner_id=? ORDER BY id DESC LIMIT ? OFFSET ?", (owner_id, limit, cursor)).fetchall()
        items = [dict(row) for row in rows]
        next_cursor = cursor + len(items) if cursor + len(items) < total else None
        return {"total": total, "cursor": cursor, "limit": limit, "next_cursor": next_cursor, "items": items}


class SignedCursor:
    def __init__(self, secret: str) -> None:
        self.secret = secret.encode("utf-8")

    def encode(self, payload: dict[str, Any]) -> str:
        body = base64.urlsafe_b64encode(_json(payload).encode("utf-8")).decode("ascii").rstrip("=")
        signature = base64.urlsafe_b64encode(hmac.new(self.secret, body.encode("ascii"), hashlib.sha256).digest()).decode("ascii").rstrip("=")
        return f"{body}.{signature}"

    def decode(self, token: str) -> dict[str, Any]:
        try:
            body, signature = token.split(".", 1)
        except ValueError as error:
            raise ValueError("cursor token is invalid") from error
        expected = base64.urlsafe_b64encode(hmac.new(self.secret, body.encode("ascii"), hashlib.sha256).digest()).decode("ascii").rstrip("=")
        if not hmac.compare_digest(expected, signature):
            raise ValueError("cursor token signature is invalid")
        try:
            padded = body + "=" * (-len(body) % 4)
            payload = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError("cursor token payload is invalid") from error
        if int(payload.get("exp") or 0) < _now():
            raise ValueError("cursor token is expired")
        return payload


class ToolGovernorError(RuntimeError):
    def __init__(self, code: str, message: str, retry_after_seconds: float | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.retry_after_seconds = retry_after_seconds


@dataclass
class _Circuit:
    failures: int = 0
    opened_until: float = 0.0


class ToolGovernor:
    def __init__(self) -> None:
        self.window_seconds = max(1, int(os.getenv("OCEAN_MCP_RATE_WINDOW_SECONDS", "60")))
        self.calls_per_window = max(1, int(os.getenv("OCEAN_MCP_RATE_CALLS", "120")))
        self.tenant_concurrency = max(1, int(os.getenv("OCEAN_MCP_TENANT_CONCURRENCY", "4")))
        self.tool_concurrency = max(1, int(os.getenv("OCEAN_MCP_TOOL_CONCURRENCY", "8")))
        self.circuit_threshold = max(1, int(os.getenv("OCEAN_MCP_CIRCUIT_FAILURES", "3")))
        self.circuit_cooldown = max(5, int(os.getenv("OCEAN_MCP_CIRCUIT_COOLDOWN_SECONDS", "60")))
        self._lock = threading.RLock()
        self._calls: dict[tuple[str, str], deque[float]] = defaultdict(deque)
        self._tenant_active: dict[str, int] = defaultdict(int)
        self._tool_active: dict[str, int] = defaultdict(int)
        self._circuits: dict[str, _Circuit] = defaultdict(_Circuit)

    @contextmanager
    def permit(self, owner_id: str, tool_name: str, external: bool = False) -> Iterator[None]:
        now = time.monotonic()
        key = (owner_id, tool_name)
        with self._lock:
            calls = self._calls[key]
            while calls and calls[0] <= now - self.window_seconds:
                calls.popleft()
            if len(calls) >= self.calls_per_window:
                retry = max(0.1, self.window_seconds - (now - calls[0]))
                raise ToolGovernorError("MCP_RATE_LIMITED", "MCP tool rate limit exceeded", retry)
            if self._tenant_active[owner_id] >= self.tenant_concurrency:
                raise ToolGovernorError("MCP_TENANT_CONCURRENCY", "MCP tenant concurrency limit exceeded", 1.0)
            if self._tool_active[tool_name] >= self.tool_concurrency:
                raise ToolGovernorError("MCP_TOOL_CONCURRENCY", "MCP tool concurrency limit exceeded", 1.0)
            circuit = self._circuits[tool_name]
            if external and circuit.opened_until > now:
                raise ToolGovernorError("MCP_CIRCUIT_OPEN", "External data source circuit is temporarily open", circuit.opened_until - now)
            calls.append(now)
            self._tenant_active[owner_id] += 1
            self._tool_active[tool_name] += 1
        try:
            yield
        except Exception:
            if external:
                with self._lock:
                    circuit = self._circuits[tool_name]
                    circuit.failures += 1
                    if circuit.failures >= self.circuit_threshold:
                        circuit.opened_until = time.monotonic() + self.circuit_cooldown
            raise
        else:
            if external:
                with self._lock:
                    self._circuits[tool_name] = _Circuit()
        finally:
            with self._lock:
                self._tenant_active[owner_id] = max(0, self._tenant_active[owner_id] - 1)
                self._tool_active[tool_name] = max(0, self._tool_active[tool_name] - 1)
