from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app.agents.explanation import _cache, _evidence_explanation, explain_event
from app.agents.data_context import (
    _acquire_model_circuit,
    _record_model_failure,
    _reset_model_circuit,
    model_circuit_status,
)
from app.agents.memory_store import AgentMemoryStore
from app.data.demo import EVENTS
from app.main import RequestUserContext, app, request_user_context


client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_dependency_override() -> None:
    app.dependency_overrides.pop(request_user_context, None)
    yield
    app.dependency_overrides.pop(request_user_context, None)


def _as_user(owner_id: str) -> None:
    app.dependency_overrides[request_user_context] = lambda: RequestUserContext(
        owner_id=owner_id,
        user=None,
        api_config=None,
    )


def test_agent_sessions_and_memories_are_owner_scoped(monkeypatch, tmp_path) -> None:
    store = AgentMemoryStore(tmp_path / "owners.sqlite3")
    monkeypatch.setattr("app.main.agent_memory_store", store)

    _as_user("user-a")
    created_session = client.post(
        "/api/agent/sessions",
        json={"region_id": "global_ocean", "title": "A private session"},
    )
    assert created_session.status_code == 201
    session_id = created_session.json()["id"]
    created_memory = client.post(
        "/api/agent/memories",
        json={
            "kind": "preference",
            "content": "A private preference",
            "region_id": "global_ocean",
        },
    )
    assert created_memory.status_code == 201

    _as_user("user-b")
    assert client.get(f"/api/agent/sessions/{session_id}").status_code == 404
    assert client.get("/api/agent/sessions?region=global_ocean").json() == []
    assert client.get("/api/agent/memories?region=global_ocean").json() == []

    own_session = client.post(
        "/api/agent/sessions",
        json={"region_id": "global_ocean", "title": "B private session"},
    )
    assert own_session.status_code == 201
    assert own_session.json()["id"] != session_id

    _as_user("user-a")
    assert client.get(f"/api/agent/sessions/{session_id}").status_code == 200
    assert [item["content"] for item in client.get(
        "/api/agent/memories?region=global_ocean"
    ).json()] == ["A private preference"]


def test_explanation_cache_is_scoped_by_user_and_api_config(monkeypatch) -> None:
    event = EVENTS[0].model_copy(
        update={
            "id": "CACHE-SCOPE-TEST",
            "event_kind": "anomaly",
            "source_updated_at": datetime.now(UTC),
        }
    )
    calls: list[tuple[str, str, str]] = []

    def fake_external(current_event, api_config):
        calls.append(api_config)
        return _evidence_explanation(current_event).model_copy(
            update={
                "provider": "external_api",
                "model": api_config[2],
                "headline": f"result from {api_config[2]}",
            }
        )

    monkeypatch.setattr("app.agents.explanation._external_explanation", fake_external)
    _cache.clear()

    first = explain_event(
        event,
        api_config=("https://first.example/v1/responses", "secret-a", "model-a"),
        cache_scope="user-a",
    )
    second = explain_event(
        event,
        api_config=("https://second.example/v1/responses", "secret-b", "model-b"),
        cache_scope="user-b",
    )
    first_cached = explain_event(
        event,
        api_config=("https://first.example/v1/responses", "secret-a", "model-a"),
        cache_scope="user-a",
    )

    assert first.headline == "result from model-a"
    assert second.headline == "result from model-b"
    assert first_cached.headline == first.headline
    assert calls == [
        ("https://first.example/v1/responses", "secret-a", "model-a"),
        ("https://second.example/v1/responses", "secret-b", "model-b"),
    ]


def test_model_circuit_is_isolated_by_api_credentials(monkeypatch) -> None:
    first = ("https://provider.example/v1/responses", "secret-a", "model")
    second = ("https://provider.example/v1/responses", "secret-b", "model")
    monkeypatch.setenv("OCEAN_AGENT_CIRCUIT_FAILURES", "1")
    monkeypatch.setenv("OCEAN_AGENT_CIRCUIT_COOLDOWN_SECONDS", "60")
    _reset_model_circuit()

    _acquire_model_circuit(first)
    _record_model_failure(first)

    assert model_circuit_status(first)[0] == "cooldown"
    assert model_circuit_status(second) == ("available", 0)
