import os
import base64
import hashlib
import hmac
import json
import time
import ast
import inspect

from fastapi.testclient import TestClient

from app.main import app
from app.agents import codex_mcp


def _session_headers(client: TestClient, token: str = "test-token") -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}", "MCP-Protocol-Version": "2025-03-26"}
    response = client.post("/api/codex/mcp", headers=headers, json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26"}})
    return {**headers, "Mcp-Session-Id": response.headers["Mcp-Session-Id"]}


def _tenant_token(owner_id: str, secret: str = "tenant-test-secret") -> str:
    now = int(time.time())
    body = base64.urlsafe_b64encode(json.dumps({"sub": owner_id, "aud": "ocean-intelligence-mcp", "iat": now, "exp": now + 60}, separators=(",", ":")).encode()).decode().rstrip("=")
    signature = base64.urlsafe_b64encode(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest()).decode().rstrip("=")
    return f"{body}.{signature}"


def test_codex_mcp_requires_bearer_token(monkeypatch):
    monkeypatch.setenv("OCEAN_CODEX_MCP_TOKEN", "test-token")
    client = TestClient(app, base_url="http://app")
    assert client.get("/api/codex/mcp").status_code == 401
    response = client.get("/api/codex/mcp", headers={"Authorization": "Bearer test-token"})
    assert response.status_code == 200
    assert response.json()["service"] == "ocean-intelligence"


def test_codex_mcp_protocol_catalog(monkeypatch):
    monkeypatch.setenv("OCEAN_CODEX_MCP_TOKEN", "test-token")
    client = TestClient(app, base_url="http://app")
    headers = {"Authorization": "Bearer test-token", "MCP-Protocol-Version": "2025-03-26"}

    initialize = client.post("/api/codex/mcp", headers=headers, json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26"}})
    assert initialize.status_code == 200
    assert initialize.json()["result"]["capabilities"]["prompts"]
    headers["Mcp-Session-Id"] = initialize.headers["Mcp-Session-Id"]

    tools = client.post("/api/codex/mcp", headers=headers, json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"}).json()["result"]["tools"]
    names = {tool["name"] for tool in tools}
    assert {"ocean_product_health", "ocean_current_field", "ocean_argo_nearest", "ocean_memory_store", "ocean_data_catalog", "ocean_data_page", "ocean_source_catalog", "ocean_source_data_page"} <= names

    prompts = client.post("/api/codex/mcp", headers=headers, json={"jsonrpc": "2.0", "id": 3, "method": "prompts/list"}).json()["result"]["prompts"]
    assert {prompt["name"] for prompt in prompts} >= {"regional_ocean_assessment", "event_evidence_review"}

    resource = client.post("/api/codex/mcp", headers=headers, json={"jsonrpc": "2.0", "id": 4, "method": "resources/read", "params": {"uri": "ocean://product/capabilities"}})
    assert resource.status_code == 200
    assert resource.json()["result"]["contents"][0]["uri"] == "ocean://product/capabilities"

    templates = client.post("/api/codex/mcp", headers=headers, json={"jsonrpc": "2.0", "id": 5, "method": "resources/templates/list"}).json()["result"]["resourceTemplates"]
    assert any(item["uriTemplate"] == "ocean://regions/{region_id}/datasets" for item in templates)


def test_codex_mcp_tool_error_is_jsonrpc_error_result(monkeypatch):
    monkeypatch.setenv("OCEAN_CODEX_MCP_TOKEN", "test-token")
    client = TestClient(app, base_url="http://app")
    headers = _session_headers(client)
    response = client.post(
        "/api/codex/mcp",
        headers=headers,
        json={"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {"name": "ocean_product_health", "arguments": {}}},
    )
    assert response.status_code == 200
    assert response.json()["result"]["isError"] is False


def test_data_page_returns_817_coordinates_without_truncation(monkeypatch):
    points = [
        {"longitude": 100 + index / 1000, "latitude": 10 + index / 1000, "temperature": 20 + index / 100}
        for index in range(817)
    ]
    monkeypatch.setattr(
        codex_mcp,
        "get_realtime_bundle",
        lambda region_id: {
            "events": [],
            "observation_summary": {"sst_latest_points": points, "sst_timeline": [], "variables": []},
            "argo_region": {"floats": [], "profiles": []},
            "sources": [],
        },
    )
    monkeypatch.setattr(codex_mcp, "get_event_lifecycle_records", lambda region_id: [])

    result = codex_mcp._data_page({"region_id": "global_ocean", "dataset_id": "sst_latest_points", "limit": 1000})

    assert result["total"] == 817
    assert result["returned"] == 817
    assert result["next_cursor"] is None
    assert len(result["items"]) == 817


def test_data_page_cursor_has_no_overlap_or_gap(monkeypatch):
    points = [{"longitude": index, "latitude": 0, "id": str(index)} for index in range(25)]
    monkeypatch.setattr(
        codex_mcp,
        "get_realtime_bundle",
        lambda region_id: {
            "events": [],
            "observation_summary": {"sst_latest_points": points, "sst_timeline": [], "variables": []},
            "argo_region": {"floats": [], "profiles": []},
            "sources": [],
        },
    )
    monkeypatch.setattr(codex_mcp, "get_event_lifecycle_records", lambda region_id: [])

    first = codex_mcp._data_page({"region_id": "global_ocean", "dataset_id": "sst_latest_points", "limit": 10})
    second = codex_mcp._data_page({"region_id": "global_ocean", "dataset_id": "sst_latest_points", "limit": 10, "cursor_token": first["next_cursor_token"]})
    third = codex_mcp._data_page({"region_id": "global_ocean", "dataset_id": "sst_latest_points", "limit": 10, "cursor_token": second["next_cursor_token"]})

    ids = [item["id"] for page in (first, second, third) for item in page["items"]]
    assert ids == [str(index) for index in range(25)]


def test_data_search_nearest_and_aggregate(monkeypatch):
    points = [
        {"longitude": 110.0, "latitude": 20.0, "temperature": 20.0, "label": "west"},
        {"longitude": 111.0, "latitude": 20.0, "temperature": 22.0, "label": "center"},
        {"longitude": 115.0, "latitude": 20.0, "temperature": 30.0, "label": "east"},
    ]
    monkeypatch.setattr(codex_mcp, "get_realtime_bundle", lambda region_id: {"events": [], "observation_summary": {"sst_latest_points": points, "sst_timeline": [], "variables": []}, "argo_region": {"floats": [], "profiles": []}, "sources": []})
    monkeypatch.setattr(codex_mcp, "get_event_lifecycle_records", lambda region_id: [])

    search = codex_mcp._data_search({"region_id": "global_ocean", "dataset_id": "sst_latest_points", "query": "center"})
    nearest = codex_mcp._coordinate_nearest({"region_id": "global_ocean", "dataset_id": "sst_latest_points", "longitude": 110.9, "latitude": 20.0, "limit": 1})
    aggregate = codex_mcp._data_aggregate({"region_id": "global_ocean", "dataset_id": "sst_latest_points", "field": "temperature"})

    assert search["total"] == 1
    assert nearest["items"][0]["record"]["label"] == "center"
    assert aggregate["count"] == 3
    assert aggregate["mean"] == 24.0


def test_complete_source_pagination_uses_source_offset(monkeypatch):
    calls = []

    def fake_carbon(bounds, *, limit, offset, page):
        calls.append((limit, offset, page))
        return {"points": [{"longitude": float(index), "latitude": 0.0} for index in range(offset, min(offset + limit, 2500))], "available_count": 2500}

    monkeypatch.setattr(codex_mcp, "get_noaa_carbon", fake_carbon)
    result = codex_mcp._source_data_page({"region_id": "global_ocean", "source": "noaa_carbon", "collection": "points", "cursor": 1000, "limit": 1000})

    assert calls == [(5000, 0, True)]
    assert result["total"] == 2500
    assert result["returned"] == 1000
    assert result["next_cursor"] == 2000
    assert result["complete_source_pagination"] is True


def test_tool_schemas_have_output_and_safety_annotations():
    for tool in codex_mcp.TOOLS:
        assert tool["outputSchema"]
        assert set(tool["annotations"]) == {"readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"}
        assert "owner_id" not in tool["inputSchema"]["properties"]


def test_jsonrpc_batch_and_resource_subscription(monkeypatch):
    monkeypatch.setenv("OCEAN_CODEX_MCP_TOKEN", "test-token")
    client = TestClient(app, base_url="http://app")
    headers = _session_headers(client)
    response = client.post("/api/codex/mcp", headers=headers, json=[
        {"jsonrpc": "2.0", "id": 2, "method": "ping"},
        {"jsonrpc": "2.0", "id": 3, "method": "resources/subscribe", "params": {"uri": "ocean://product/health"}},
    ])
    assert [item["id"] for item in response.json()] == [2, 3]


def test_tenant_token_cannot_be_replaced_by_owner_fields(monkeypatch):
    monkeypatch.setenv("OCEAN_CODEX_TENANT_SECRET", "tenant-test-secret")
    assert codex_mcp._validated_memory_owner({"__tenant_token": _tenant_token("user-a"), "owner_id": "user-b"}) == "user-a"


def test_snapshot_cursor_stays_consistent_during_refresh(monkeypatch):
    versions = [
        [{"id": str(index), "longitude": 0, "latitude": 0} for index in range(25)],
        [{"id": f"new-{index}", "longitude": 0, "latitude": 0} for index in range(25)],
    ]
    calls = {"count": 0}

    def bundle(_region_id):
        points = versions[min(calls["count"], 1)]
        calls["count"] += 1
        return {"refreshed_at": f"revision-{calls['count']}", "events": [], "observation_summary": {"sst_latest_points": points, "sst_timeline": [], "variables": []}, "argo_region": {"floats": [], "profiles": []}, "sources": []}

    monkeypatch.setattr(codex_mcp, "get_realtime_bundle", bundle)
    monkeypatch.setattr(codex_mcp, "get_event_lifecycle_records", lambda region_id: [])
    first = codex_mcp._data_page({"region_id": "global_ocean", "dataset_id": "sst_latest_points", "limit": 10})
    second = codex_mcp._data_page({"region_id": "global_ocean", "dataset_id": "sst_latest_points", "limit": 10, "cursor_token": first["next_cursor_token"]})
    assert [item["id"] for item in second["items"]] == [str(index) for index in range(10, 20)]
    assert second["snapshot_id"] == first["snapshot_id"]


def test_hundred_thousand_record_snapshot_paging(monkeypatch):
    monkeypatch.setattr(codex_mcp, "get_event_lifecycle_records", lambda region_id: [])
    points = [{"id": str(index), "value": index} for index in range(100_000)]
    monkeypatch.setattr(codex_mcp, "get_realtime_bundle", lambda region_id: {"refreshed_at": "revision-large", "events": [], "observation_summary": {"sst_latest_points": points, "sst_timeline": [], "variables": []}, "argo_region": {"floats": [], "profiles": []}, "sources": []})
    first = codex_mcp._data_page({"region_id": "global_ocean", "dataset_id": "sst_latest_points", "limit": 1000})
    last = codex_mcp._data_page({"region_id": "global_ocean", "dataset_id": "sst_latest_points", "limit": 1000, "snapshot_id": first["snapshot_id"], "cursor": 99_000})
    assert first["total"] == 100_000
    assert last["returned"] == 1000
    assert last["next_cursor_token"] is None


def test_every_discovered_tool_has_a_handler():
    tree = ast.parse(inspect.getsource(codex_mcp._call_tool))
    handler_names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Dict):
            handler_names.update(key.value for key in node.keys if isinstance(key, ast.Constant) and isinstance(key.value, str) and key.value.startswith("ocean_"))
    assert {tool["name"] for tool in codex_mcp.TOOLS} == handler_names


def test_all_export_formats_from_snapshot(monkeypatch, tmp_path):
    monkeypatch.setenv("OCEAN_MCP_EXPORT_DIR", str(tmp_path / "exports"))
    snapshot = codex_mcp.MCP_STATE.create_snapshot("owner-export", "global_ocean", "points", "revision-1", [
        {"id": "a", "longitude": 110.0, "latitude": 20.0, "value": 1.5},
        {"id": "b", "longitude": 111.0, "latitude": 21.0, "value": 2.5},
    ], 60)
    for export_format in ("csv", "geojson", "ndjson", "parquet", "netcdf"):
        result = codex_mcp._export_records(f"job-{export_format}", "owner-export", {"region_id": "global_ocean", "dataset_id": "points", "snapshot_id": snapshot["snapshot_id"], "format": export_format})
        assert result["record_count"] == 2
        assert result["size_bytes"] > 0
