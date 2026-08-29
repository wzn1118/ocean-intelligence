from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import socket
import sqlite3
import threading
import time
from collections import deque
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Iterator, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlsplit
from urllib.request import Request as UrlRequest, urlopen
from uuid import uuid4

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import SecretStr
from starlette.types import ASGIApp, Receive, Scope, Send

from app.models import (
    AuthSessionResponse,
    AuthStateResponse,
    CsrfTokenResponse,
    ProviderConnectionInput,
    ProviderConnectionTestResult,
    ProviderModelDiscoveryRequest,
    ProviderModelDiscoveryResult,
    ProviderPresetPublic,
    MonitoredBuoy,
    UserLoginRequest,
    UserProviderConfigPublic,
    UserProviderConfigUpdate,
    UserPublic,
    UserRegistrationRequest,
)
from app.provider_http import PROVIDER_USER_AGENT


SESSION_COOKIE_NAME = os.getenv("SESSION_COOKIE_NAME", "ocean_session")
CSRF_HEADER_NAME = "X-CSRF-Token"
UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
CSRF_EXEMPT_PATHS = frozenset({"/api/auth/register", "/api/auth/login"})
AUTH_PUBLIC_PATHS = frozenset(
    {
        "/api/health",
        "/api/auth/register",
        "/api/auth/login",
        "/api/auth/session",
        "/api/codex/mcp",
    }
)
DEFAULT_DATABASE_PATH = Path(__file__).resolve().parents[1] / ".runtime" / "auth.db"

PROVIDER_PRESETS: dict[str, dict[str, str | None]] = {
    "openai": {
        "label": "OpenAI",
        "base_url": "https://api.openai.com/v1/responses",
        "api_mode": "responses",
    },
    "deepseek": {
        "label": "DeepSeek",
        "base_url": "https://api.deepseek.com/chat/completions",
        "api_mode": "chat_completions",
    },
    "custom": {
        "label": "自定义中转站",
        "base_url": None,
        "api_mode": "responses",
    },
}


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _timestamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="microseconds")


def _parse_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _normalize_email(email: str) -> str:
    return email.strip().casefold()


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


class AuthConfigurationError(RuntimeError):
    pass


class _Argon2PasswordHasher:
    memory_cost = 64 * 1024
    iterations = 3
    lanes = 4
    length = 32

    def hash(self, password: str) -> str:
        from cryptography.hazmat.primitives.kdf.argon2 import Argon2id

        return Argon2id(
            salt=secrets.token_bytes(16),
            length=self.length,
            iterations=self.iterations,
            lanes=self.lanes,
            memory_cost=self.memory_cost,
        ).derive_phc_encoded(password.encode("utf-8"))

    @staticmethod
    def verify(encoded: str, password: str) -> None:
        from cryptography.hazmat.primitives.kdf.argon2 import Argon2id

        Argon2id.verify_phc_encoded(password.encode("utf-8"), encoded)

    def check_needs_rehash(self, encoded: str) -> bool:
        expected = f"$argon2id$v=19$m={self.memory_cost},t={self.iterations},p={self.lanes}$"
        return not encoded.startswith(expected)


class AuthAttemptLimiter:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._attempts: dict[str, deque[float]] = {}

    @staticmethod
    def _client_address(request: Request) -> str:
        if _env_bool("TRUST_PROXY_HEADERS", False):
            forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
            if forwarded:
                return forwarded[:128]
        return (request.client.host if request.client else "unknown")[:128]

    def check(self, request: Request, action: str, identity: str) -> None:
        if action == "register":
            limit = max(1, int(os.getenv("AUTH_REGISTER_ATTEMPTS", "6")))
            window = max(60, int(os.getenv("AUTH_REGISTER_WINDOW_SECONDS", "3600")))
        else:
            limit = max(1, int(os.getenv("AUTH_LOGIN_ATTEMPTS", "12")))
            window = max(60, int(os.getenv("AUTH_LOGIN_WINDOW_SECONDS", "900")))
        now = time.monotonic()
        address = self._client_address(request)
        identity_hash = hashlib.sha256(identity.casefold().encode("utf-8")).hexdigest()[:20]
        keys = (f"{action}:ip:{address}", f"{action}:identity:{identity_hash}")
        with self._lock:
            for key in keys:
                attempts = self._attempts.setdefault(key, deque())
                while attempts and attempts[0] <= now - window:
                    attempts.popleft()
                if len(attempts) >= limit:
                    retry_after = max(1, int(window - (now - attempts[0])))
                    raise HTTPException(
                        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                        detail="too many authentication attempts",
                        headers={"Retry-After": str(retry_after)},
                    )
            for key in keys:
                self._attempts[key].append(now)


_AUTH_ATTEMPT_LIMITER = AuthAttemptLimiter()


def _enforce_same_origin(request: Request) -> None:
    if request.headers.get("sec-fetch-site", "").casefold() == "cross-site":
        raise HTTPException(status_code=403, detail="cross-site authentication request rejected")
    origin = request.headers.get("origin", "").strip()
    if not origin:
        return
    origin_host = urlsplit(origin).netloc.casefold()
    request_host = request.headers.get("host", "").casefold()
    configured = {
        urlsplit(item.strip()).netloc.casefold()
        for item in os.getenv("ALLOWED_ORIGINS", "").split(",")
        if item.strip()
    }
    if not origin_host or (origin_host != request_host and origin_host not in configured):
        raise HTTPException(status_code=403, detail="authentication origin is not allowed")


class _Database:
    def __init__(self, database_url: str | None = None) -> None:
        value = (database_url or os.getenv("DATABASE_URL") or "").strip()
        if not value:
            value = f"sqlite:///{DEFAULT_DATABASE_PATH.as_posix()}"
        if value.startswith("sqlite:///"):
            self.dialect = "sqlite"
            location = unquote(value[len("sqlite:///") :])
            self.sqlite_path = location or str(DEFAULT_DATABASE_PATH)
            self.database_url = value
        elif value.startswith(("postgresql://", "postgres://")):
            self.dialect = "postgres"
            self.sqlite_path = None
            self.database_url = "postgresql://" + value.split("://", 1)[1]
        else:
            raise AuthConfigurationError("DATABASE_URL must use sqlite:/// or postgresql://")
        self._initialized = False
        self._initialize_lock = threading.Lock()
        self._memory_lock = threading.RLock()
        self._memory_connection: sqlite3.Connection | None = None

    def _sqlite_connect(self) -> sqlite3.Connection:
        path = self.sqlite_path or str(DEFAULT_DATABASE_PATH)
        if path != ":memory:":
            path_object = Path(path)
            if not path_object.is_absolute():
                path_object = Path.cwd() / path_object
            path_object.parent.mkdir(parents=True, exist_ok=True)
            path = str(path_object)
        connection = sqlite3.connect(path, timeout=10, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 10000")
        return connection

    def _postgres_connect(self) -> Any:
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError as error:
            raise AuthConfigurationError(
                "PostgreSQL DATABASE_URL requires the psycopg[binary] package"
            ) from error
        return psycopg.connect(self.database_url, row_factory=dict_row)

    @contextmanager
    def transaction(self) -> Iterator[Any]:
        if self.dialect == "sqlite" and self.sqlite_path == ":memory:":
            with self._memory_lock:
                if self._memory_connection is None:
                    self._memory_connection = self._sqlite_connect()
                connection = self._memory_connection
                try:
                    yield connection
                    connection.commit()
                except Exception:
                    connection.rollback()
                    raise
            return

        connection = self._sqlite_connect() if self.dialect == "sqlite" else self._postgres_connect()
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def execute(self, connection: Any, sql: str, params: tuple[Any, ...] = ()) -> Any:
        if self.dialect == "postgres":
            sql = sql.replace("?", "%s")
        return connection.execute(sql, params)

    def initialize(self) -> None:
        if self._initialized:
            return
        with self._initialize_lock:
            if self._initialized:
                return
            with self.transaction() as connection:
                self.execute(
                    connection,
                    """
                    CREATE TABLE IF NOT EXISTS auth_users (
                        id TEXT PRIMARY KEY,
                        email TEXT NOT NULL UNIQUE,
                        display_name TEXT NOT NULL,
                        password_hash TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """,
                )
                self.execute(
                    connection,
                    """
                    CREATE TABLE IF NOT EXISTS user_monitored_buoys (
                        user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
                        platform TEXT NOT NULL,
                        enabled INTEGER NOT NULL DEFAULT 1,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        PRIMARY KEY (user_id, platform)
                    )
                    """,
                )
                self.execute(
                    connection,
                    """
                    CREATE TABLE IF NOT EXISTS auth_email_aliases (
                        email TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
                        created_at TEXT NOT NULL
                    )
                    """,
                )
                self.execute(
                    connection,
                    """
                    CREATE TABLE IF NOT EXISTS auth_sessions (
                        token_hash TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
                        csrf_hash TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        expires_at TEXT NOT NULL,
                        last_seen_at TEXT NOT NULL
                    )
                    """,
                )
                self.execute(
                    connection,
                    """
                    CREATE TABLE IF NOT EXISTS user_provider_configs (
                        user_id TEXT PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
                        provider TEXT NOT NULL,
                        base_url TEXT NOT NULL,
                        model TEXT NOT NULL,
                        encrypted_api_key TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """,
                )
                self.execute(
                    connection,
                    """
                    CREATE TABLE IF NOT EXISTS user_monitored_buoys (
                        user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
                        platform TEXT NOT NULL,
                        enabled INTEGER NOT NULL DEFAULT 1,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        PRIMARY KEY (user_id, platform)
                    )
                    """,
                )
                self.execute(
                    connection,
                    "CREATE INDEX IF NOT EXISTS auth_email_aliases_user_id_idx ON auth_email_aliases(user_id)",
                )
                self.execute(
                    connection,
                    "CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON auth_sessions(user_id)",
                )
                self.execute(
                    connection,
                    "CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx ON auth_sessions(expires_at)",
                )
            self._initialized = True


@dataclass(frozen=True)
class UserApiCredentials:
    provider: str
    base_url: str
    model: str
    api_key: SecretStr | None


@dataclass(frozen=True)
class _SessionContext:
    user: UserPublic
    token_hash: str
    csrf_hash: str
    expires_at: datetime
    last_seen_at: datetime


class AuthService:
    def __init__(
        self,
        database_url: str | None = None,
        *,
        encryption_key: str | None = None,
        session_ttl: timedelta | None = None,
        cookie_secure: bool | None = None,
        cookie_name: str | None = None,
    ) -> None:
        self.database = _Database(database_url)
        self.encryption_key = encryption_key if encryption_key is not None else os.getenv("ENCRYPTION_KEY")
        self.session_ttl = session_ttl or timedelta(
            seconds=max(300, int(os.getenv("SESSION_TTL_SECONDS", str(30 * 24 * 60 * 60))))
        )
        secure_default = _env_bool("AUTH_REQUIRED", False)
        self.cookie_secure = _env_bool("SESSION_COOKIE_SECURE", secure_default) if cookie_secure is None else cookie_secure
        self.cookie_name = cookie_name or SESSION_COOKIE_NAME
        self._password_hasher: Any | None = None
        self._fernet: Any | None = None
        self.database.initialize()

    def _hasher(self) -> Any:
        if self._password_hasher is None:
            try:
                from cryptography.hazmat.primitives.kdf.argon2 import Argon2id
            except ImportError as error:
                raise AuthConfigurationError("password hashing requires cryptography with Argon2id support") from error
            del Argon2id
            self._password_hasher = _Argon2PasswordHasher()
        return self._password_hasher

    def _cipher(self) -> Any:
        if self._fernet is None:
            if not self.encryption_key:
                raise AuthConfigurationError("ENCRYPTION_KEY is required to store API credentials")
            try:
                from cryptography.fernet import Fernet

                self._fernet = Fernet(self.encryption_key.encode("ascii"))
            except (ImportError, ValueError, UnicodeError) as error:
                raise AuthConfigurationError("ENCRYPTION_KEY must be a valid Fernet key") from error
        return self._fernet

    @staticmethod
    def _user_from_row(row: Mapping[str, Any]) -> UserPublic:
        return UserPublic(
            id=row["id"],
            email=row["email"],
            display_name=row["display_name"],
            created_at=_parse_timestamp(row["created_at"]),
        )

    def create_user(self, payload: UserRegistrationRequest) -> UserPublic:
        now = _utcnow()
        user = UserPublic(
            id=uuid4().hex,
            email=_normalize_email(str(payload.email)),
            display_name=payload.display_name,
            created_at=now,
        )
        password_hash = self._hasher().hash(payload.password.get_secret_value())
        try:
            with self.database.transaction() as connection:
                alias = self.database.execute(
                    connection,
                    "SELECT user_id FROM auth_email_aliases WHERE email = ?",
                    (str(user.email),),
                ).fetchone()
                if alias is not None:
                    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="email is already registered")
                self.database.execute(
                    connection,
                    """
                    INSERT INTO auth_users (id, email, display_name, password_hash, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        user.id,
                        str(user.email),
                        user.display_name,
                        password_hash,
                        _timestamp(now),
                        _timestamp(now),
                    ),
                )
        except Exception as error:
            if self._is_unique_violation(error):
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="email is already registered") from error
            raise
        return user

    def add_email_alias(self, user_id: str, email: str) -> None:
        normalized = _normalize_email(email)
        with self.database.transaction() as connection:
            primary = self.database.execute(
                connection,
                "SELECT id FROM auth_users WHERE email = ?",
                (normalized,),
            ).fetchone()
            if primary is not None and primary["id"] != user_id:
                raise ValueError("email belongs to another user")
            existing = self.database.execute(
                connection,
                "SELECT user_id FROM auth_email_aliases WHERE email = ?",
                (normalized,),
            ).fetchone()
            if existing is not None:
                if existing["user_id"] != user_id:
                    raise ValueError("email alias belongs to another user")
                return
            self.database.execute(
                connection,
                "INSERT INTO auth_email_aliases (email, user_id, created_at) VALUES (?, ?, ?)",
                (normalized, user_id, _timestamp(_utcnow())),
            )

    def authenticate(self, payload: UserLoginRequest) -> UserPublic:
        email = _normalize_email(str(payload.email))
        with self.database.transaction() as connection:
            row = self.database.execute(
                connection,
                """
                SELECT users.id, users.email, users.display_name, users.password_hash, users.created_at
                FROM auth_users AS users
                LEFT JOIN auth_email_aliases AS aliases ON aliases.user_id = users.id
                WHERE users.email = ? OR aliases.email = ?
                LIMIT 1
                """,
                (email, email),
            ).fetchone()
        if row is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid email or password")
        try:
            self._hasher().verify(row["password_hash"], payload.password.get_secret_value())
        except Exception as error:
            try:
                from cryptography.exceptions import InvalidKey
            except ImportError:
                raise AuthConfigurationError("password hashing requires cryptography") from error
            if isinstance(error, (InvalidKey, ValueError)):
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid email or password") from error
            raise
        if self._hasher().check_needs_rehash(row["password_hash"]):
            new_hash = self._hasher().hash(payload.password.get_secret_value())
            with self.database.transaction() as connection:
                self.database.execute(
                    connection,
                    "UPDATE auth_users SET password_hash = ?, updated_at = ? WHERE id = ?",
                    (new_hash, _timestamp(_utcnow()), row["id"]),
                )
        return self._user_from_row(row)

    @staticmethod
    def _is_unique_violation(error: Exception) -> bool:
        if isinstance(error, sqlite3.IntegrityError):
            return "unique" in str(error).lower()
        return getattr(error, "sqlstate", None) == "23505"

    def create_session(self, user: UserPublic) -> tuple[str, str, datetime]:
        now = _utcnow()
        expires_at = now + self.session_ttl
        token = secrets.token_urlsafe(48)
        csrf = secrets.token_urlsafe(32)
        with self.database.transaction() as connection:
            self.database.execute(
                connection,
                "DELETE FROM auth_sessions WHERE expires_at <= ?",
                (_timestamp(now),),
            )
            self.database.execute(
                connection,
                """
                INSERT INTO auth_sessions
                    (token_hash, user_id, csrf_hash, created_at, expires_at, last_seen_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    _token_hash(token),
                    user.id,
                    _token_hash(csrf),
                    _timestamp(now),
                    _timestamp(expires_at),
                    _timestamp(now),
                ),
            )
        return token, csrf, expires_at

    def set_session_cookie(self, response: Response, token: str) -> None:
        response.set_cookie(
            key=self.cookie_name,
            value=token,
            max_age=int(self.session_ttl.total_seconds()),
            httponly=True,
            secure=self.cookie_secure,
            samesite="lax",
            path="/",
        )
        response.headers["Cache-Control"] = "no-store"

    def clear_session_cookie(self, response: Response) -> None:
        response.delete_cookie(
            key=self.cookie_name,
            httponly=True,
            secure=self.cookie_secure,
            samesite="lax",
            path="/",
        )
        response.headers["Cache-Control"] = "no-store"

    def session_from_token(self, token: str | None) -> _SessionContext | None:
        if not token or len(token) > 512:
            return None
        hashed = _token_hash(token)
        with self.database.transaction() as connection:
            row = self.database.execute(
                connection,
                """
                SELECT u.id, u.email, u.display_name, u.created_at,
                       s.csrf_hash, s.expires_at, s.last_seen_at
                FROM auth_sessions AS s
                JOIN auth_users AS u ON u.id = s.user_id
                WHERE s.token_hash = ?
                """,
                (hashed,),
            ).fetchone()
            if row is None:
                return None
            expires_at = _parse_timestamp(row["expires_at"])
            if expires_at <= _utcnow():
                self.database.execute(connection, "DELETE FROM auth_sessions WHERE token_hash = ?", (hashed,))
                return None
            last_seen_at = _parse_timestamp(row["last_seen_at"])
            if _utcnow() - last_seen_at >= timedelta(minutes=5):
                last_seen_at = _utcnow()
                self.database.execute(
                    connection,
                    "UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?",
                    (_timestamp(last_seen_at), hashed),
                )
        return _SessionContext(
            user=self._user_from_row(row),
            token_hash=hashed,
            csrf_hash=row["csrf_hash"],
            expires_at=expires_at,
            last_seen_at=last_seen_at,
        )

    def session_from_request(self, request: Request) -> _SessionContext | None:
        return self.session_from_token(request.cookies.get(self.cookie_name))

    def delete_session(self, token: str | None) -> None:
        if not token or len(token) > 512:
            return
        with self.database.transaction() as connection:
            self.database.execute(
                connection,
                "DELETE FROM auth_sessions WHERE token_hash = ?",
                (_token_hash(token),),
            )

    def rotate_csrf(self, context: _SessionContext) -> str:
        token = secrets.token_urlsafe(32)
        with self.database.transaction() as connection:
            self.database.execute(
                connection,
                "UPDATE auth_sessions SET csrf_hash = ? WHERE token_hash = ?",
                (_token_hash(token), context.token_hash),
            )
        return token

    def validate_csrf(self, request: Request, context: _SessionContext | None = None) -> _SessionContext:
        context = context or self.session_from_request(request)
        if context is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
        token = request.headers.get(CSRF_HEADER_NAME)
        if not token or len(token) > 512 or not hmac.compare_digest(_token_hash(token), context.csrf_hash):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="invalid CSRF token")
        return context

    def provider_presets(self) -> list[ProviderPresetPublic]:
        return [ProviderPresetPublic(id=key, **value) for key, value in PROVIDER_PRESETS.items()]

    def list_monitored_buoys(self, user_id: str) -> list[MonitoredBuoy]:
        with self.database.transaction() as connection:
            rows = self.database.execute(
                connection,
                "SELECT platform, enabled, created_at, updated_at FROM user_monitored_buoys WHERE user_id = ? AND enabled = 1 ORDER BY updated_at DESC",
                (user_id,),
            ).fetchall()
        return [
            MonitoredBuoy(
                platform=row["platform"],
                enabled=bool(row["enabled"]),
                created_at=_parse_timestamp(row["created_at"]),
                updated_at=_parse_timestamp(row["updated_at"]),
            )
            for row in rows
        ]

    def set_monitored_buoy(self, user_id: str, platform: str, enabled: bool) -> MonitoredBuoy:
        clean_platform = platform.strip()
        if not clean_platform.isdigit() or not 5 <= len(clean_platform) <= 8:
            raise HTTPException(status_code=422, detail="Argo 浮标编号必须是 5 至 8 位数字")
        now = _utcnow()
        timestamp = _timestamp(now)
        with self.database.transaction() as connection:
            existing = self.database.execute(
                connection,
                "SELECT created_at FROM user_monitored_buoys WHERE user_id = ? AND platform = ?",
                (user_id, clean_platform),
            ).fetchone()
            if existing:
                self.database.execute(
                    connection,
                    "UPDATE user_monitored_buoys SET enabled = ?, updated_at = ? WHERE user_id = ? AND platform = ?",
                    (1 if enabled else 0, timestamp, user_id, clean_platform),
                )
                created_at = _parse_timestamp(existing["created_at"])
            else:
                self.database.execute(
                    connection,
                    "INSERT INTO user_monitored_buoys(user_id, platform, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                    (user_id, clean_platform, 1 if enabled else 0, timestamp, timestamp),
                )
                created_at = now
        return MonitoredBuoy(platform=clean_platform, enabled=enabled, created_at=created_at, updated_at=now)

    def get_provider_config(self, user_id: str) -> UserProviderConfigPublic | None:
        with self.database.transaction() as connection:
            row = self.database.execute(
                connection,
                """
                SELECT provider, base_url, model, encrypted_api_key, updated_at
                FROM user_provider_configs WHERE user_id = ?
                """,
                (user_id,),
            ).fetchone()
        if row is None:
            return None
        return UserProviderConfigPublic(
            provider=row["provider"],
            base_url=row["base_url"],
            model=row["model"],
            has_api_key=bool(row["encrypted_api_key"]),
            api_mode=provider_api_mode(row["base_url"]),
            updated_at=_parse_timestamp(row["updated_at"]),
        )

    def save_provider_config(
        self,
        user_id: str,
        payload: UserProviderConfigUpdate,
    ) -> UserProviderConfigPublic:
        preset_url = PROVIDER_PRESETS[payload.provider]["base_url"]
        base_url = payload.base_url or preset_url
        if not base_url:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="base URL is required")
        api_mode = payload.api_mode or PROVIDER_PRESETS[payload.provider]["api_mode"]
        base_url = validate_provider_url(base_url, str(api_mode))
        now = _utcnow()
        with self.database.transaction() as connection:
            existing = self.database.execute(
                connection,
                "SELECT base_url, encrypted_api_key, created_at FROM user_provider_configs WHERE user_id = ?",
                (user_id,),
            ).fetchone()
            encrypted_key = existing["encrypted_api_key"] if existing else None
            if "api_key" in payload.model_fields_set:
                raw_key = payload.api_key.get_secret_value().strip() if payload.api_key else ""
                encrypted_key = self._cipher().encrypt(raw_key.encode("utf-8")).decode("ascii") if raw_key else None
            elif (
                existing
                and encrypted_key
                and provider_credential_scope(existing["base_url"]) != provider_credential_scope(base_url)
            ):
                raise HTTPException(status_code=422, detail="更换 Base URL 后请重新填写 API 密钥")
            created_at = existing["created_at"] if existing else _timestamp(now)
            if existing:
                self.database.execute(
                    connection,
                    """
                    UPDATE user_provider_configs
                    SET provider = ?, base_url = ?, model = ?, encrypted_api_key = ?, updated_at = ?
                    WHERE user_id = ?
                    """,
                    (payload.provider, base_url, payload.model, encrypted_key, _timestamp(now), user_id),
                )
            else:
                self.database.execute(
                    connection,
                    """
                    INSERT INTO user_provider_configs
                        (user_id, provider, base_url, model, encrypted_api_key, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        user_id,
                        payload.provider,
                        base_url,
                        payload.model,
                        encrypted_key,
                        created_at,
                        _timestamp(now),
                    ),
                )
        return UserProviderConfigPublic(
            provider=payload.provider,
            base_url=base_url,
            model=payload.model,
            has_api_key=bool(encrypted_key),
            api_mode=provider_api_mode(base_url),
            updated_at=now,
        )

    def test_provider_config(
        self,
        user_id: str,
        payload: UserProviderConfigUpdate,
    ) -> ProviderConnectionTestResult:
        preset_url = PROVIDER_PRESETS[payload.provider]["base_url"]
        base_url = payload.base_url or preset_url
        if not base_url:
            raise HTTPException(status_code=422, detail="请填写中转站地址")
        api_mode = payload.api_mode or PROVIDER_PRESETS[payload.provider]["api_mode"]
        base_url = validate_provider_url(base_url, str(api_mode))
        api_key = self._request_api_key(user_id, payload, base_url)
        if not api_key:
            raise HTTPException(status_code=422, detail="请填写 API 密钥后再测试连接")
        return _probe_provider_connection(base_url, api_key, payload.model)

    def discover_provider_models(
        self,
        user_id: str,
        payload: ProviderModelDiscoveryRequest,
    ) -> ProviderModelDiscoveryResult:
        preset_url = PROVIDER_PRESETS[payload.provider]["base_url"]
        requested_url = payload.base_url or preset_url
        if not requested_url:
            raise HTTPException(status_code=422, detail="请填写中转站地址")
        api_mode = payload.api_mode or PROVIDER_PRESETS[payload.provider]["api_mode"]
        base_url = validate_provider_url(requested_url, str(api_mode))
        api_key = self._request_api_key(user_id, payload, base_url)
        if not api_key:
            raise HTTPException(status_code=422, detail="请填写 API 密钥后再检测模型")
        roots = provider_model_roots(requested_url, base_url)
        models = _fetch_provider_models(roots, api_key)
        return ProviderModelDiscoveryResult(
            provider=payload.provider,
            base_url=base_url,
            models=models,
            fetched_at=_utcnow(),
            message=f"已检测到 {len(models)} 个可用模型",
        )

    def _request_api_key(
        self,
        user_id: str,
        payload: ProviderConnectionInput,
        base_url: str,
    ) -> str:
        if "api_key" in payload.model_fields_set:
            return payload.api_key.get_secret_value().strip() if payload.api_key else ""
        existing = self.get_api_credentials(user_id)
        if existing is None or existing.api_key is None:
            return ""
        if provider_credential_scope(existing.base_url) != provider_credential_scope(base_url):
            raise HTTPException(status_code=422, detail="更换 Base URL 后请重新填写 API 密钥")
        return existing.api_key.get_secret_value().strip()

    def delete_provider_config(self, user_id: str) -> None:
        with self.database.transaction() as connection:
            self.database.execute(
                connection,
                "DELETE FROM user_provider_configs WHERE user_id = ?",
                (user_id,),
            )

    def get_api_credentials(self, user_id: str) -> UserApiCredentials | None:
        with self.database.transaction() as connection:
            row = self.database.execute(
                connection,
                """
                SELECT provider, base_url, model, encrypted_api_key
                FROM user_provider_configs WHERE user_id = ?
                """,
                (user_id,),
            ).fetchone()
        if row is None:
            return None
        base_url = validate_provider_url(row["base_url"])
        api_key = None
        if row["encrypted_api_key"]:
            try:
                raw_key = self._cipher().decrypt(row["encrypted_api_key"].encode("ascii")).decode("utf-8")
            except Exception as error:
                raise AuthConfigurationError("stored API credential cannot be decrypted") from error
            api_key = SecretStr(raw_key)
        return UserApiCredentials(
            provider=row["provider"],
            base_url=base_url,
            model=row["model"],
            api_key=api_key,
        )


def provider_api_mode(value: str) -> str:
    return "responses" if value.rstrip("/").endswith("/responses") else "chat_completions"


def provider_api_root(value: str) -> str:
    value = value.strip().rstrip("/")
    lowered = value.casefold()
    for suffix in ("/chat/completions", "/responses"):
        if lowered.endswith(suffix):
            return value[: -len(suffix)].rstrip("/")
    return value


def provider_credential_scope(value: str) -> str:
    return provider_api_root(value).casefold()


def provider_model_roots(requested_url: str, normalized_url: str) -> list[str]:
    roots = [provider_api_root(normalized_url)]
    requested_url = requested_url.strip().rstrip("/")
    if not urlsplit(requested_url).path.rstrip("/"):
        roots.append(requested_url)
    return list(dict.fromkeys(root for root in roots if root))


def validate_provider_url(value: str, api_mode: str | None = None) -> str:
    value = value.strip().rstrip("/")
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname:
        raise HTTPException(status_code=422, detail="API URL must use https")
    if parsed.username or parsed.password:
        raise HTTPException(status_code=422, detail="API URL cannot contain credentials")
    if parsed.query or parsed.fragment:
        raise HTTPException(status_code=422, detail="API URL cannot contain a query or fragment")
    try:
        port = parsed.port or 443
    except ValueError as error:
        raise HTTPException(status_code=422, detail="API URL port is invalid") from error
    hostname = parsed.hostname.casefold().rstrip(".")
    metadata_names = {
        "localhost",
        "metadata",
        "metadata.google.internal",
        "metadata.azure.internal",
        "instance-data.ec2.internal",
    }
    if hostname in metadata_names or hostname.endswith(".localhost"):
        raise HTTPException(status_code=422, detail="API URL host is not allowed")
    try:
        literal_address = ipaddress.ip_address(hostname.strip("[]"))
        addresses = [literal_address]
    except ValueError:
        try:
            resolved = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
        except OSError as error:
            raise HTTPException(status_code=422, detail="API URL host could not be resolved") from error
        addresses = []
        for item in resolved:
            try:
                addresses.append(ipaddress.ip_address(item[4][0]))
            except ValueError:
                continue
    if not addresses or any(not address.is_global for address in addresses):
        raise HTTPException(status_code=422, detail="API URL cannot resolve to a private or special-use address")
    if parsed.path.endswith(("/responses", "/chat/completions")):
        return value
    if api_mode not in {"responses", "chat_completions"}:
        raise HTTPException(status_code=422, detail="请选择中转站接口模式")
    root = f"{value}/v1" if not parsed.path.rstrip("/") else value
    suffix = "/responses" if api_mode == "responses" else "/chat/completions"
    return f"{root}{suffix}"


def _provider_response_text(payload: dict[str, Any]) -> str:
    if isinstance(payload.get("output_text"), str):
        return payload["output_text"].strip()
    choices = payload.get("choices")
    if isinstance(choices, list) and choices:
        message = choices[0].get("message", {}) if isinstance(choices[0], dict) else {}
        content = message.get("content", "") if isinstance(message, dict) else ""
        if isinstance(content, list):
            return "\n".join(
                str(item.get("text", ""))
                for item in content
                if isinstance(item, dict) and item.get("text")
            ).strip()
        return str(content).strip()
    output = payload.get("output")
    if not isinstance(output, list):
        return ""
    texts: list[str] = []
    for item in output:
        if not isinstance(item, dict) or not isinstance(item.get("content"), list):
            continue
        for content in item["content"]:
            if isinstance(content, dict) and content.get("type") in {"output_text", "text"}:
                texts.append(str(content.get("text", "")))
    return "\n".join(text for text in texts if text).strip()


def _upstream_error_message(error: HTTPError) -> str:
    messages = {
        400: "中转站拒绝了测试请求，请检查模型 ID 与接口模式",
        401: "中转站拒绝了 API 密钥，请检查后重试",
        403: "当前 API 密钥没有访问该模型的权限",
        404: "中转站未找到所选接口，请检查地址与接口模式",
        429: "中转站当前限流或余额不足，请稍后重试",
    }
    message = messages.get(error.code, f"中转站返回 HTTP {error.code}")
    try:
        payload = json.loads(error.read(8192).decode("utf-8", errors="replace"))
        detail = payload.get("error", {}).get("message") if isinstance(payload, dict) else None
        if isinstance(detail, str) and detail.strip():
            clean_detail = " ".join(detail.split())[:240]
            message = f"{message}：{clean_detail}"
    except (OSError, ValueError, AttributeError):
        pass
    return message


def _provider_model_ids(payload: Any) -> list[str]:
    collections: list[list[Any]] = []
    if isinstance(payload, list):
        collections.append(payload)
    elif isinstance(payload, dict):
        for key in ("data", "models"):
            if isinstance(payload.get(key), list):
                collections.append(payload[key])
        result = payload.get("result")
        if isinstance(result, dict):
            for key in ("data", "models"):
                if isinstance(result.get(key), list):
                    collections.append(result[key])

    model_ids: set[str] = set()
    for collection in collections:
        for item in collection:
            value: Any = item
            if isinstance(item, dict):
                value = item.get("id") or item.get("name") or item.get("model")
            if not isinstance(value, str):
                continue
            model_id = value.strip()
            if not model_id or len(model_id) > 160 or any(character.isspace() for character in model_id):
                continue
            model_ids.add(model_id)

    def natural_key(value: str) -> tuple[tuple[int, int | str], ...]:
        return tuple(
            (0, int(part)) if part.isdigit() else (1, part.casefold())
            for part in re.split(r"(\d+)", value)
            if part
        )

    return sorted(model_ids, key=natural_key)


def _model_discovery_error_message(error: HTTPError) -> str:
    messages = {
        400: "中转站拒绝了模型列表请求，请检查 Base URL",
        401: "中转站拒绝了 API 密钥，请检查后重试",
        403: "当前 API 密钥没有读取模型列表的权限",
        404: "中转站未提供模型列表接口",
        429: "中转站当前限流或余额不足，请稍后重试",
    }
    message = messages.get(error.code, f"中转站返回 HTTP {error.code}")
    try:
        payload = json.loads(error.read(8192).decode("utf-8", errors="replace"))
        detail = payload.get("error", {}).get("message") if isinstance(payload, dict) else None
        if isinstance(detail, str) and detail.strip():
            message = f"{message}：{' '.join(detail.split())[:240]}"
    except (OSError, ValueError, AttributeError):
        pass
    return message


def _fetch_provider_models(roots: list[str], api_key: str) -> list[str]:
    last_error = "中转站未返回可用模型"
    for index, root in enumerate(roots):
        request = UrlRequest(
            f"{root.rstrip('/')}/models",
            method="GET",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Accept": "application/json",
                "User-Agent": PROVIDER_USER_AGENT,
            },
        )
        try:
            with urlopen(request, timeout=15) as response:
                payload = json.loads(response.read(2_000_000).decode("utf-8"))
        except HTTPError as error:
            last_error = _model_discovery_error_message(error)
            if index + 1 < len(roots) and error.code not in {401, 403, 429}:
                continue
            raise HTTPException(status_code=502, detail=last_error) from error
        except (URLError, TimeoutError, OSError) as error:
            raise HTTPException(status_code=502, detail="无法连接中转站，请检查 Base URL 或稍后重试") from error
        except (ValueError, UnicodeDecodeError) as error:
            last_error = "中转站返回了无法识别的模型列表"
            if index + 1 < len(roots):
                continue
            raise HTTPException(status_code=502, detail=last_error) from error
        models = _provider_model_ids(payload)
        if models:
            return models
        last_error = "中转站未返回可用模型"
    raise HTTPException(status_code=502, detail=last_error)


def _probe_provider_connection(base_url: str, api_key: str, model: str) -> ProviderConnectionTestResult:
    api_mode = provider_api_mode(base_url)
    if api_mode == "responses":
        body = {
            "model": model,
            "input": "Reply with OK.",
            "max_output_tokens": 64,
            "store": False,
        }
    else:
        body = {
            "model": model,
            "messages": [{"role": "user", "content": "Reply with OK."}],
            "max_tokens": 16,
            "stream": False,
        }
    request = UrlRequest(
        base_url,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": PROVIDER_USER_AGENT,
        },
    )
    started = time.monotonic()
    try:
        with urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        raise HTTPException(status_code=502, detail=_upstream_error_message(error)) from error
    except (URLError, TimeoutError, OSError) as error:
        raise HTTPException(status_code=502, detail="无法连接中转站，请检查地址或稍后重试") from error
    except (ValueError, UnicodeDecodeError) as error:
        raise HTTPException(status_code=502, detail="中转站返回了无法识别的响应") from error
    if not isinstance(payload, dict) or not _provider_response_text(payload):
        raise HTTPException(status_code=502, detail="中转站已响应，但返回格式与所选接口不兼容")
    latency_ms = round((time.monotonic() - started) * 1000)
    return ProviderConnectionTestResult(
        base_url=base_url,
        model=model,
        api_mode=api_mode,
        latency_ms=latency_ms,
        message="连接成功，地址、密钥与模型均可用",
    )


_default_service: AuthService | None = None
_default_service_lock = threading.Lock()


def get_auth_service(request: Request | None = None) -> AuthService:
    if request is not None:
        configured = getattr(request.app.state, "auth_service", None)
        if configured is not None:
            return configured
    global _default_service
    if _default_service is None:
        with _default_service_lock:
            if _default_service is None:
                _default_service = AuthService()
    return _default_service


def get_current_user(request: Request) -> UserPublic | None:
    context = get_auth_service(request).session_from_request(request)
    return context.user if context else None


current_user = get_current_user


def require_user(request: Request) -> UserPublic:
    user = get_current_user(request)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
    return user


def require_csrf(request: Request) -> UserPublic:
    return get_auth_service(request).validate_csrf(request).user


csrf_protect = require_csrf


def csrf_token(request: Request, user: UserPublic = Depends(require_user)) -> str:
    del user
    context = get_auth_service(request).session_from_request(request)
    if context is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
    return get_auth_service(request).rotate_csrf(context)


def user_provider_config(
    request: Request,
    user: UserPublic = Depends(require_user),
) -> UserApiCredentials | None:
    return get_auth_service(request).get_api_credentials(user.id)


def get_user_api_credentials(user_id: str, *, service: AuthService | None = None) -> UserApiCredentials | None:
    return (service or get_auth_service()).get_api_credentials(user_id)


def _start_session(
    response: Response,
    service: AuthService,
    user: UserPublic,
) -> AuthSessionResponse:
    token, csrf, expires_at = service.create_session(user)
    service.set_session_cookie(response, token)
    return AuthSessionResponse(user=user, csrf_token=csrf, expires_at=expires_at)


def register_user(
    payload: UserRegistrationRequest,
    request: Request,
    response: Response,
) -> AuthSessionResponse:
    service = get_auth_service(request)
    return _start_session(response, service, service.create_user(payload))


def login_user(
    payload: UserLoginRequest,
    request: Request,
    response: Response,
) -> AuthSessionResponse:
    service = get_auth_service(request)
    user = service.authenticate(payload)
    service.delete_session(request.cookies.get(service.cookie_name))
    return _start_session(response, service, user)


def logout_user(request: Request, response: Response) -> None:
    service = get_auth_service(request)
    service.delete_session(request.cookies.get(service.cookie_name))
    service.clear_session_cookie(response)


def create_auth_router() -> APIRouter:
    router = APIRouter(tags=["account"])

    @router.post("/api/auth/register", response_model=AuthSessionResponse, status_code=201)
    def register_endpoint(
        payload: UserRegistrationRequest,
        request: Request,
        response: Response,
    ) -> AuthSessionResponse:
        _enforce_same_origin(request)
        _AUTH_ATTEMPT_LIMITER.check(request, "register", str(payload.email))
        return register_user(payload, request, response)

    @router.post("/api/auth/login", response_model=AuthSessionResponse)
    def login_endpoint(
        payload: UserLoginRequest,
        request: Request,
        response: Response,
    ) -> AuthSessionResponse:
        _enforce_same_origin(request)
        _AUTH_ATTEMPT_LIMITER.check(request, "login", str(payload.email))
        return login_user(payload, request, response)

    @router.get("/api/auth/session", response_model=AuthStateResponse)
    def session_endpoint(
        request: Request,
        response: Response,
    ) -> AuthStateResponse:
        context = get_auth_service(request).session_from_request(request)
        if context is None:
            response.headers["Cache-Control"] = "no-store"
            return AuthStateResponse()
        token = get_auth_service(request).rotate_csrf(context)
        response.headers["Cache-Control"] = "no-store"
        return AuthStateResponse(user=context.user, csrf_token=token, expires_at=context.expires_at)

    @router.get("/api/auth/csrf", response_model=CsrfTokenResponse)
    def csrf_endpoint(response: Response, token: str = Depends(csrf_token)) -> CsrfTokenResponse:
        response.headers["Cache-Control"] = "no-store"
        return CsrfTokenResponse(csrf_token=token)

    @router.post("/api/auth/logout", status_code=204, dependencies=[Depends(require_csrf)])
    def logout_endpoint(request: Request, response: Response) -> None:
        logout_user(request, response)

    @router.get("/api/account/provider-presets", response_model=list[ProviderPresetPublic])
    def provider_presets_endpoint(
        request: Request,
        user: UserPublic = Depends(require_user),
    ) -> list[ProviderPresetPublic]:
        del user
        return get_auth_service(request).provider_presets()

    @router.get(
        "/api/account/api-config",
        response_model=UserProviderConfigPublic | None,
        dependencies=[Depends(require_user)],
    )
    def provider_config_endpoint(request: Request, user: UserPublic = Depends(require_user)) -> UserProviderConfigPublic | None:
        return get_auth_service(request).get_provider_config(user.id)

    @router.put("/api/account/api-config", response_model=UserProviderConfigPublic)
    def save_provider_config_endpoint(
        payload: UserProviderConfigUpdate,
        request: Request,
        user: UserPublic = Depends(require_csrf),
    ) -> UserProviderConfigPublic:
        try:
            return get_auth_service(request).save_provider_config(user.id, payload)
        except AuthConfigurationError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    @router.post("/api/account/api-config/test", response_model=ProviderConnectionTestResult)
    def test_provider_config_endpoint(
        payload: UserProviderConfigUpdate,
        request: Request,
        user: UserPublic = Depends(require_csrf),
    ) -> ProviderConnectionTestResult:
        try:
            return get_auth_service(request).test_provider_config(user.id, payload)
        except AuthConfigurationError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    @router.post("/api/account/api-config/models", response_model=ProviderModelDiscoveryResult)
    def discover_provider_models_endpoint(
        payload: ProviderModelDiscoveryRequest,
        request: Request,
        user: UserPublic = Depends(require_csrf),
    ) -> ProviderModelDiscoveryResult:
        try:
            return get_auth_service(request).discover_provider_models(user.id, payload)
        except AuthConfigurationError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    @router.delete("/api/account/api-config", status_code=204)
    def delete_provider_config_endpoint(
        request: Request,
        user: UserPublic = Depends(require_csrf),
    ) -> None:
        get_auth_service(request).delete_provider_config(user.id)

    @router.get("/api/account/monitored-buoys", response_model=list[MonitoredBuoy])
    def monitored_buoys_endpoint(
        request: Request,
        user: UserPublic = Depends(require_user),
    ) -> list[MonitoredBuoy]:
        return get_auth_service(request).list_monitored_buoys(user.id)

    @router.put("/api/account/monitored-buoys/{platform}", response_model=MonitoredBuoy)
    def set_monitored_buoy_endpoint(
        platform: str,
        request: Request,
        user: UserPublic = Depends(require_csrf),
        enabled: bool = True,
    ) -> MonitoredBuoy:
        return get_auth_service(request).set_monitored_buoy(user.id, platform, enabled)

    return router


auth_router = create_auth_router()
router = auth_router


class CSRFMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        service: AuthService,
        exempt_paths: frozenset[str] = CSRF_EXEMPT_PATHS,
    ) -> None:
        self.app = app
        self.service = service
        self.exempt_paths = exempt_paths

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"].upper() in UNSAFE_METHODS:
            request = Request(scope, receive=receive)
            if request.url.path not in self.exempt_paths and request.cookies.get(self.service.cookie_name):
                try:
                    self.service.validate_csrf(request)
                except HTTPException as error:
                    response = JSONResponse(
                        status_code=error.status_code,
                        content={"detail": error.detail},
                        headers={"Cache-Control": "no-store"},
                    )
                    await response(scope, receive, send)
                    return
        await self.app(scope, receive, send)


class AuthenticationRequiredMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        service: AuthService,
        public_paths: frozenset[str] = AUTH_PUBLIC_PATHS,
    ) -> None:
        self.app = app
        self.service = service
        self.public_paths = public_paths

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            method = scope["method"].upper()
            path = scope.get("path", "")
            if (
                method != "OPTIONS"
                and path.startswith("/api/")
                and path not in self.public_paths
            ):
                request = Request(scope, receive=receive)
                if self.service.session_from_request(request) is None:
                    response = JSONResponse(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        content={"detail": "authentication required"},
                        headers={"Cache-Control": "no-store"},
                    )
                    await response(scope, receive, send)
                    return
        await self.app(scope, receive, send)


def install_auth(
    app: FastAPI,
    *,
    service: AuthService | None = None,
    protect_cookie_writes: bool = True,
) -> AuthService:
    if getattr(app.state, "auth_installed", False):
        return app.state.auth_service
    configured_service = service or get_auth_service()
    app.state.auth_service = configured_service
    app.state.auth_installed = True
    app.include_router(auth_router)
    if protect_cookie_writes:
        app.add_middleware(CSRFMiddleware, service=configured_service)
    if _env_bool("AUTH_REQUIRED", False):
        app.add_middleware(AuthenticationRequiredMiddleware, service=configured_service)
    return configured_service


__all__ = [
    "AuthConfigurationError",
    "AuthService",
    "AuthenticationRequiredMiddleware",
    "CSRF_HEADER_NAME",
    "CSRFMiddleware",
    "SESSION_COOKIE_NAME",
    "UserApiCredentials",
    "auth_router",
    "create_auth_router",
    "csrf_protect",
    "csrf_token",
    "current_user",
    "get_auth_service",
    "get_current_user",
    "get_user_api_credentials",
    "install_auth",
    "login_user",
    "logout_user",
    "register_user",
    "require_csrf",
    "require_user",
    "router",
    "user_provider_config",
    "validate_provider_url",
]
