import time

import pytest

from app.agents.mcp_infrastructure import McpStateStore, SignedCursor, ToolGovernor, ToolGovernorError


def test_sessions_and_snapshots_survive_store_recreation(tmp_path):
    path = tmp_path / "mcp.sqlite3"
    first = McpStateStore(path)
    session_id = first.create_session("2025-03-26")
    snapshot = first.create_snapshot("owner-a", "global_ocean", "points", "revision-1", [{"id": 1}], 60)

    second = McpStateStore(path)
    assert second.session_exists(session_id)
    assert second.get_snapshot(snapshot["snapshot_id"], "owner-a", "global_ocean", "points")["records"] == [{"id": 1}]


def test_signed_cursor_rejects_tampering_and_expiry():
    signer = SignedCursor("secret")
    token = signer.encode({"offset": 10, "exp": int(time.time()) + 60})
    assert signer.decode(token)["offset"] == 10
    with pytest.raises(ValueError, match="signature"):
        signer.decode(token + "x")
    with pytest.raises(ValueError, match="expired"):
        signer.decode(signer.encode({"offset": 0, "exp": int(time.time()) - 1}))


def test_governor_enforces_rate_and_concurrency(monkeypatch):
    monkeypatch.setenv("OCEAN_MCP_RATE_CALLS", "1")
    monkeypatch.setenv("OCEAN_MCP_TENANT_CONCURRENCY", "1")
    governor = ToolGovernor()
    with governor.permit("owner", "tool"):
        with pytest.raises(ToolGovernorError, match="rate limit"):
            with governor.permit("owner", "tool"):
                pass
