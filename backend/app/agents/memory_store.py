from __future__ import annotations

import json
import os
import re
import sqlite3
from datetime import UTC, datetime
from hashlib import sha1
from pathlib import Path
from uuid import uuid4

from app.models import (
    AgentCitation,
    AgentConversationMessage,
    AgentMemory,
    AgentQueryPlan,
    AgentRuntimeProfile,
    AgentSession,
    AgentSessionDetail,
    AgentStoredMessage,
)


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(value: datetime | None = None) -> str:
    return (value or _now()).isoformat()


def _datetime(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


class AgentMemoryStore:
    """SQLite-backed conversation history and explicit cross-session memory."""

    def __init__(self, path: str | Path | None = None) -> None:
        configured = path or os.getenv("OCEAN_AGENT_DB_PATH")
        self.path = Path(configured) if configured else Path(__file__).resolve().parents[3] / ".runtime" / "agent_memory.sqlite3"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=15)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS agent_sessions (
                    id TEXT PRIMARY KEY,
                    owner_id TEXT NOT NULL DEFAULT 'local',
                    title TEXT NOT NULL,
                    region_id TEXT NOT NULL,
                    selected_event_id TEXT,
                    summary TEXT NOT NULL DEFAULT '',
                    message_count INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_message_at TEXT,
                    archived INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS agent_messages (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    citations_json TEXT NOT NULL DEFAULT '[]',
                    provider TEXT,
                    model TEXT,
                    retrieved_record_count INTEGER NOT NULL DEFAULT 0,
                    query_plan_json TEXT,
                    runtime_profile_json TEXT,
                    notes_json TEXT NOT NULL DEFAULT '[]'
                );
                CREATE INDEX IF NOT EXISTS idx_agent_messages_session_created
                    ON agent_messages(session_id, created_at ASC);

                CREATE TABLE IF NOT EXISTS agent_memories (
                    id TEXT PRIMARY KEY,
                    owner_id TEXT NOT NULL DEFAULT 'local',
                    normalized_key TEXT NOT NULL UNIQUE,
                    kind TEXT NOT NULL CHECK(kind IN ('preference', 'instruction', 'focus')),
                    content TEXT NOT NULL,
                    region_id TEXT,
                    source_session_id TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL,
                    source_message_id TEXT,
                    confidence REAL NOT NULL DEFAULT 1,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_used_at TEXT,
                    use_count INTEGER NOT NULL DEFAULT 0
                );
                """
            )
            message_columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(agent_messages)").fetchall()
            }
            if "query_plan_json" not in message_columns:
                connection.execute("ALTER TABLE agent_messages ADD COLUMN query_plan_json TEXT")
            if "runtime_profile_json" not in message_columns:
                connection.execute("ALTER TABLE agent_messages ADD COLUMN runtime_profile_json TEXT")
            if "notes_json" not in message_columns:
                connection.execute("ALTER TABLE agent_messages ADD COLUMN notes_json TEXT NOT NULL DEFAULT '[]'")
            session_columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(agent_sessions)").fetchall()
            }
            if "owner_id" not in session_columns:
                connection.execute("ALTER TABLE agent_sessions ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'local'")
            memory_columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(agent_memories)").fetchall()
            }
            if "owner_id" not in memory_columns:
                connection.execute("ALTER TABLE agent_memories ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'local'")
            connection.execute(
                """CREATE INDEX IF NOT EXISTS idx_agent_sessions_owner_region_updated
                ON agent_sessions(owner_id, region_id, archived, updated_at DESC)"""
            )
            connection.execute(
                """CREATE INDEX IF NOT EXISTS idx_agent_memories_owner_region_updated
                ON agent_memories(owner_id, enabled, region_id, updated_at DESC)"""
            )

    @staticmethod
    def _session(row: sqlite3.Row) -> AgentSession:
        return AgentSession(
            id=row["id"],
            title=row["title"],
            region_id=row["region_id"],
            selected_event_id=row["selected_event_id"],
            summary=row["summary"],
            message_count=row["message_count"],
            created_at=_datetime(row["created_at"]),
            updated_at=_datetime(row["updated_at"]),
            last_message_at=_datetime(row["last_message_at"]),
            archived=bool(row["archived"]),
        )

    @staticmethod
    def _message(row: sqlite3.Row) -> AgentStoredMessage:
        citations = [AgentCitation.model_validate(item) for item in json.loads(row["citations_json"] or "[]")]
        raw_plan = row["query_plan_json"]
        query_plan = AgentQueryPlan.model_validate(json.loads(raw_plan)) if raw_plan else None
        raw_profile = row["runtime_profile_json"]
        runtime_profile = AgentRuntimeProfile.model_validate(json.loads(raw_profile)) if raw_profile else None
        return AgentStoredMessage(
            id=row["id"],
            session_id=row["session_id"],
            role=row["role"],
            content=row["content"],
            created_at=_datetime(row["created_at"]),
            citations=citations,
            provider=row["provider"],
            model=row["model"],
            retrieved_record_count=row["retrieved_record_count"],
            query_plan=query_plan,
            runtime_profile=runtime_profile,
            notes=list(json.loads(row["notes_json"] or "[]")),
        )

    @staticmethod
    def _memory(row: sqlite3.Row) -> AgentMemory:
        return AgentMemory(
            id=row["id"],
            kind=row["kind"],
            content=row["content"],
            region_id=row["region_id"],
            source_session_id=row["source_session_id"],
            source_message_id=row["source_message_id"],
            confidence=row["confidence"],
            enabled=bool(row["enabled"]),
            created_at=_datetime(row["created_at"]),
            updated_at=_datetime(row["updated_at"]),
            last_used_at=_datetime(row["last_used_at"]),
            use_count=row["use_count"],
        )

    def create_session(
        self,
        region_id: str,
        title: str = "新对话",
        selected_event_id: str | None = None,
        *,
        owner_id: str = "local",
    ) -> AgentSession:
        session_id = uuid4().hex
        timestamp = _iso()
        clean_title = re.sub(r"\s+", " ", title).strip()[:80] or "新对话"
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO agent_sessions(id, owner_id, title, region_id, selected_event_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (session_id, owner_id, clean_title, region_id, selected_event_id, timestamp, timestamp),
            )
            row = connection.execute("SELECT * FROM agent_sessions WHERE id = ?", (session_id,)).fetchone()
        return self._session(row)

    def list_sessions(
        self,
        region_id: str | None = None,
        include_archived: bool = False,
        limit: int = 80,
        *,
        owner_id: str = "local",
    ) -> list[AgentSession]:
        clauses: list[str] = ["owner_id = ?"]
        values: list[object] = [owner_id]
        if region_id:
            clauses.append("region_id = ?")
            values.append(region_id)
        if not include_archived:
            clauses.append("archived = 0")
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        values.append(max(1, min(limit, 200)))
        with self._connect() as connection:
            rows = connection.execute(
                f"SELECT * FROM agent_sessions {where} ORDER BY COALESCE(last_message_at, updated_at) DESC LIMIT ?",
                values,
            ).fetchall()
        return [self._session(row) for row in rows]

    def get_session(self, session_id: str, *, owner_id: str = "local") -> AgentSessionDetail | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM agent_sessions WHERE id = ? AND owner_id = ?",
                (session_id, owner_id),
            ).fetchone()
            if row is None:
                return None
            messages = connection.execute(
                "SELECT * FROM agent_messages WHERE session_id = ? ORDER BY created_at ASC",
                (session_id,),
            ).fetchall()
        return AgentSessionDetail(**self._session(row).model_dump(), messages=[self._message(item) for item in messages])

    def update_session(
        self,
        session_id: str,
        *,
        title: str | None = None,
        archived: bool | None = None,
        owner_id: str = "local",
    ) -> AgentSession | None:
        updates: list[str] = []
        values: list[object] = []
        if title is not None:
            updates.append("title = ?")
            values.append(re.sub(r"\s+", " ", title).strip()[:80] or "新对话")
        if archived is not None:
            updates.append("archived = ?")
            values.append(int(archived))
        if not updates:
            detail = self.get_session(session_id, owner_id=owner_id)
            return AgentSession(**detail.model_dump(exclude={"messages"})) if detail else None
        updates.append("updated_at = ?")
        values.extend([_iso(), session_id, owner_id])
        with self._connect() as connection:
            connection.execute(f"UPDATE agent_sessions SET {', '.join(updates)} WHERE id = ? AND owner_id = ?", values)
            row = connection.execute(
                "SELECT * FROM agent_sessions WHERE id = ? AND owner_id = ?",
                (session_id, owner_id),
            ).fetchone()
        return self._session(row) if row else None

    def delete_session(self, session_id: str, *, owner_id: str = "local") -> bool:
        with self._connect() as connection:
            cursor = connection.execute(
                "DELETE FROM agent_sessions WHERE id = ? AND owner_id = ?",
                (session_id, owner_id),
            )
        return cursor.rowcount > 0

    def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        *,
        citations: list[AgentCitation] | None = None,
        provider: str | None = None,
        model: str | None = None,
        retrieved_record_count: int = 0,
        query_plan: AgentQueryPlan | None = None,
        runtime_profile: AgentRuntimeProfile | None = None,
        notes: list[str] | None = None,
        owner_id: str = "local",
    ) -> AgentStoredMessage:
        message_id = uuid4().hex
        timestamp = _iso()
        encoded_citations = json.dumps(
            [item.model_dump(mode="json") for item in citations or []], ensure_ascii=False
        )
        encoded_plan = json.dumps(query_plan.model_dump(mode="json"), ensure_ascii=False) if query_plan else None
        encoded_profile = (
            json.dumps(runtime_profile.model_dump(mode="json"), ensure_ascii=False) if runtime_profile else None
        )
        encoded_notes = json.dumps(notes or [], ensure_ascii=False)
        with self._connect() as connection:
            session = connection.execute(
                "SELECT * FROM agent_sessions WHERE id = ? AND owner_id = ?",
                (session_id, owner_id),
            ).fetchone()
            if session is None:
                raise KeyError(session_id)
            connection.execute(
                """INSERT INTO agent_messages(
                    id, session_id, role, content, created_at, citations_json, provider, model,
                    retrieved_record_count, query_plan_json, runtime_profile_json, notes_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    message_id,
                    session_id,
                    role,
                    content,
                    timestamp,
                    encoded_citations,
                    provider,
                    model,
                    retrieved_record_count,
                    encoded_plan,
                    encoded_profile,
                    encoded_notes,
                ),
            )
            title = session["title"]
            if role == "user" and session["message_count"] == 0 and title == "新对话":
                title = re.sub(r"\s+", " ", content).strip()[:36]
            summary_rows = connection.execute(
                "SELECT content FROM agent_messages WHERE session_id = ? AND role = 'user' ORDER BY created_at DESC LIMIT 3",
                (session_id,),
            ).fetchall()
            summary = " / ".join(row["content"] for row in reversed(summary_rows))[:600]
            connection.execute(
                """UPDATE agent_sessions SET title = ?, summary = ?, message_count = message_count + 1,
                    last_message_at = ?, updated_at = ? WHERE id = ?""",
                (title, summary, timestamp, timestamp, session_id),
            )
            row = connection.execute("SELECT * FROM agent_messages WHERE id = ?", (message_id,)).fetchone()
        return self._message(row)

    def conversation(
        self,
        session_id: str,
        limit: int = 12,
        *,
        owner_id: str = "local",
    ) -> list[AgentConversationMessage]:
        with self._connect() as connection:
            rows = connection.execute(
                """SELECT m.role, m.content FROM agent_messages m
                JOIN agent_sessions s ON s.id = m.session_id
                WHERE m.session_id = ? AND s.owner_id = ? ORDER BY m.created_at DESC LIMIT ?""",
                (session_id, owner_id, max(1, min(limit, 40))),
            ).fetchall()
        return [AgentConversationMessage(role=row["role"], content=row["content"]) for row in reversed(rows)]

    def conversation_window(
        self,
        session_id: str,
        *,
        max_messages: int = 16,
        max_chars: int = 9000,
        owner_id: str = "local",
    ) -> list[AgentConversationMessage]:
        """Return a bounded working-memory window while preserving complete turns."""
        messages = self.conversation(session_id, limit=max_messages, owner_id=owner_id)
        selected: list[AgentConversationMessage] = []
        used = 0
        for message in reversed(messages):
            size = len(message.content)
            if selected and used + size > max_chars:
                break
            selected.append(message)
            used += size
        return list(reversed(selected))

    @staticmethod
    def extract_explicit_memories(content: str) -> list[tuple[str, str, float]]:
        compact = re.sub(r"\s+", " ", content).strip()
        patterns = (
            ("instruction", r"(?:请)?记住[：:，,\s]*(.{2,240})", 1.0),
            ("instruction", r"(?:以后请|请始终|不要再|请不要)[：:，,\s]*(.{2,240})", 0.96),
            ("preference", r"(?:我希望|我偏好|我喜欢)[：:，,\s]*(.{2,240})", 0.92),
        )
        extracted: list[tuple[str, str, float]] = []
        for kind, pattern, confidence in patterns:
            match = re.search(pattern, compact)
            if not match:
                continue
            value = re.split(r"[。！？!?]", match.group(1), maxsplit=1)[0].strip(" ，,：:")
            if value:
                extracted.append((kind, value[:500], confidence))
        return list(dict.fromkeys(extracted))

    def upsert_memory(
        self,
        kind: str,
        content: str,
        *,
        region_id: str | None = None,
        source_session_id: str | None = None,
        source_message_id: str | None = None,
        confidence: float = 1.0,
        owner_id: str = "local",
    ) -> AgentMemory:
        clean = re.sub(r"\s+", " ", content).strip()[:500]
        normalized = clean.casefold()
        key = sha1(f"{owner_id}|{kind}|{region_id or '*'}|{normalized}".encode("utf-8")).hexdigest()
        timestamp = _iso()
        memory_id = uuid4().hex
        with self._connect() as connection:
            connection.execute(
                """INSERT INTO agent_memories(
                    id, owner_id, normalized_key, kind, content, region_id, source_session_id, source_message_id,
                    confidence, enabled, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                ON CONFLICT(normalized_key) DO UPDATE SET
                    content = excluded.content,
                    confidence = MAX(agent_memories.confidence, excluded.confidence),
                    enabled = 1,
                    updated_at = excluded.updated_at,
                    source_session_id = COALESCE(excluded.source_session_id, agent_memories.source_session_id),
                    source_message_id = COALESCE(excluded.source_message_id, agent_memories.source_message_id)""",
                (memory_id, owner_id, key, kind, clean, region_id, source_session_id, source_message_id, confidence, timestamp, timestamp),
            )
            row = connection.execute("SELECT * FROM agent_memories WHERE normalized_key = ?", (key,)).fetchone()
        return self._memory(row)

    def list_memories(
        self,
        region_id: str | None = None,
        include_disabled: bool = True,
        limit: int = 100,
        *,
        owner_id: str = "local",
    ) -> list[AgentMemory]:
        clauses: list[str] = ["owner_id = ?"]
        values: list[object] = [owner_id]
        if region_id:
            clauses.append("(region_id IS NULL OR region_id = ?)")
            values.append(region_id)
        if not include_disabled:
            clauses.append("enabled = 1")
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        values.append(max(1, min(limit, 300)))
        with self._connect() as connection:
            rows = connection.execute(
                f"SELECT * FROM agent_memories {where} ORDER BY enabled DESC, updated_at DESC LIMIT ?",
                values,
            ).fetchall()
        return [self._memory(row) for row in rows]

    def relevant_memories(
        self,
        question: str,
        region_id: str | None = None,
        limit: int = 8,
        *,
        owner_id: str = "local",
    ) -> list[AgentMemory]:
        """Retrieve explicit long-term memories by relevance, confidence, and memory type."""
        candidates = self.list_memories(region_id, include_disabled=False, limit=120, owner_id=owner_id)
        terms = set(re.findall(r"[a-z0-9_]{2,}|[\u4e00-\u9fff]{2,}", question.casefold()))
        ranked: list[tuple[float, AgentMemory]] = []
        for memory in candidates:
            content = memory.content.casefold()
            overlap = sum(term in content for term in terms)
            kind_weight = 1.25 if memory.kind == "instruction" else 1.0
            score = overlap * 3 + memory.confidence * kind_weight + min(memory.use_count, 10) * 0.02
            ranked.append((score, memory))
        ranked.sort(key=lambda item: (item[0], item[1].updated_at), reverse=True)
        relevant = [memory for score, memory in ranked if score > 0.45]
        return relevant[:max(1, min(limit, 24))]

    def update_memory(
        self,
        memory_id: str,
        *,
        content: str | None = None,
        enabled: bool | None = None,
        confidence: float | None = None,
        owner_id: str = "local",
    ) -> AgentMemory | None:
        updates: list[str] = []
        values: list[object] = []
        if content is not None:
            updates.append("content = ?")
            values.append(re.sub(r"\s+", " ", content).strip()[:500])
        if enabled is not None:
            updates.append("enabled = ?")
            values.append(int(enabled))
        if confidence is not None:
            updates.append("confidence = ?")
            values.append(max(0, min(confidence, 1)))
        if not updates:
            return self.get_memory(memory_id, owner_id=owner_id)
        updates.append("updated_at = ?")
        values.extend([_iso(), memory_id, owner_id])
        with self._connect() as connection:
            connection.execute(f"UPDATE agent_memories SET {', '.join(updates)} WHERE id = ? AND owner_id = ?", values)
            row = connection.execute(
                "SELECT * FROM agent_memories WHERE id = ? AND owner_id = ?",
                (memory_id, owner_id),
            ).fetchone()
        return self._memory(row) if row else None

    def get_memory(self, memory_id: str, *, owner_id: str = "local") -> AgentMemory | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM agent_memories WHERE id = ? AND owner_id = ?",
                (memory_id, owner_id),
            ).fetchone()
        return self._memory(row) if row else None

    def delete_memory(self, memory_id: str, *, owner_id: str = "local") -> bool:
        with self._connect() as connection:
            cursor = connection.execute(
                "DELETE FROM agent_memories WHERE id = ? AND owner_id = ?",
                (memory_id, owner_id),
            )
        return cursor.rowcount > 0

    def mark_memories_used(self, memory_ids: list[str], *, owner_id: str = "local") -> None:
        if not memory_ids:
            return
        placeholders = ",".join("?" for _ in memory_ids)
        with self._connect() as connection:
            connection.execute(
                f"UPDATE agent_memories SET last_used_at = ?, use_count = use_count + 1 WHERE owner_id = ? AND id IN ({placeholders})",
                [_iso(), owner_id, *memory_ids],
            )
