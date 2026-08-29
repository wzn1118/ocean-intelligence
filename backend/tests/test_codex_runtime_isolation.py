import hashlib
import hmac
import base64
import json
import time

import pytest

from app.agents import codex_mcp
from app.agents.memory_store import AgentMemoryStore
from app.codex_runtime_proxy import _tenant_headers


def test_codex_proxy_signs_authenticated_user_scope(monkeypatch) -> None:
    monkeypatch.setenv("OCEAN_CODEX_TENANT_SECRET", "tenant-test-secret")
    monkeypatch.setattr("app.codex_runtime_proxy.time.time", lambda: 1_787_904_000)

    headers = _tenant_headers("user-a", "post", "threads")

    payload = b"user-a\nPOST\nthreads\n1787904000"
    expected = hmac.new(b"tenant-test-secret", payload, hashlib.sha256).hexdigest()
    assert headers["X-Ocean-Codex-User"] == "user-a"
    assert headers["X-Ocean-Codex-Timestamp"] == "1787904000"
    assert headers["X-Ocean-Codex-Signature"] == expected


def test_codex_mcp_memories_are_owner_scoped(monkeypatch, tmp_path) -> None:
    secret = "tenant-test-secret"
    monkeypatch.setenv("OCEAN_CODEX_TENANT_SECRET", secret)
    monkeypatch.setattr(codex_mcp, "memory_store", AgentMemoryStore(tmp_path / "memory.sqlite3"))

    def scope(owner_id: str) -> dict[str, str]:
        now = int(time.time())
        body = base64.urlsafe_b64encode(json.dumps({"sub": owner_id, "aud": "ocean-intelligence-mcp", "iat": now, "exp": now + 60}, separators=(",", ":")).encode()).decode().rstrip("=")
        signature = base64.urlsafe_b64encode(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest()).decode().rstrip("=")
        return {"__tenant_token": f"{body}.{signature}"}

    codex_mcp._store_memory({
        **scope("user-a"),
        "kind": "focus",
        "content": "北部湾风速",
        "region_id": "global_ocean",
    })

    assert codex_mcp._search_memories({**scope("user-a"), "query": "北部湾风速"})["count"] == 1
    assert codex_mcp._search_memories({**scope("user-b"), "query": "北部湾风速"})["count"] == 0
    with pytest.raises(ValueError, match="signature is invalid"):
        codex_mcp._search_memories({"__tenant_token": scope("user-a")["__tenant_token"] + "tampered", "query": "北部湾风速"})
