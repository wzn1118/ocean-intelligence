from datetime import UTC, datetime
import json
from urllib.error import HTTPError

import pytest
from fastapi.testclient import TestClient

from app.data.demo import EVENTS
from app.main import app
from app.agents.agent_graph import _CHECKPOINTER, _LONG_TERM_STORE
from app.agents.memory_store import AgentMemoryStore
from app.agents.data_context import (
    ModelCircuitOpenError,
    _build_query_plan,
    _external_answer,
    _model_body,
    _model_routes,
    _rank_records,
    _acquire_model_circuit,
    _record_model_failure,
    _record_model_success,
    _reset_model_circuit,
    build_agent_manifest,
    model_circuit_status,
    model_runtime_snapshot,
)
from app.models import AgentChatRequest


client = TestClient(app)


@pytest.fixture(autouse=True)
def disable_external_agent_for_unit_tests(monkeypatch) -> None:
    monkeypatch.setattr("app.agents.data_context._agent_api_config", lambda: ("", "", ""))
    _reset_model_circuit()


def _bundle():
    observation = EVENTS[0].model_copy(
        update={
            "id": "OBS-TEST-SST-1",
            "event_kind": "observation",
            "type": "surface_observation",
            "title": "海面温度观测",
            "validation_state": "observed",
            "variables": ["SST"],
            "data_mode": "live",
        }
    )
    candidate = EVENTS[1].model_copy(
        update={
            "id": "SIG-TEST-CHLA-1",
            "event_kind": "anomaly",
            "type": "chlorophyll_anomaly",
            "title": "叶绿素偏高候选",
            "validation_state": "screening",
            "variables": ["CHLA"],
            "data_mode": "live",
        }
    )
    now = datetime.now(UTC)
    return {
        "events": [observation, candidate],
        "sources": [
            {
                "id": "test-source",
                "name": "测试数据源",
                "status": "live",
                "observation_count": 2,
                "latest_observation_at": now,
            }
        ],
        "refreshed_at": now,
    }


def test_agent_context_indexes_every_regional_record(monkeypatch) -> None:
    monkeypatch.setattr("app.main.get_realtime_bundle", lambda *args, **kwargs: _bundle())

    response = client.get("/api/agent/context?region=global_ocean")

    assert response.status_code == 200
    context = response.json()
    assert context["full_index"] is True
    assert context["record_count"] == 2
    assert context["observation_count"] == 1
    assert context["candidate_count"] == 1
    assert context["confirmed_event_count"] == 0
    assert context["variable_counts"] == {"CHLA": 1, "SST": 1}
    assert context["model_status"] == "unconfigured"
    assert context["model_retry_after_seconds"] == 0


def test_agent_answer_keeps_observations_and_candidates_distinct(monkeypatch) -> None:
    monkeypatch.setattr("app.main.get_realtime_bundle", lambda *args, **kwargs: _bundle())

    counts = client.post(
        "/api/agent/chat",
        json={"region_id": "global_ocean", "question": "现在一共有多少数据？", "history": []},
    )
    candidates = client.post(
        "/api/agent/chat",
        json={"region_id": "global_ocean", "question": "当前异常候选是什么？", "history": []},
    )

    assert counts.status_code == 200
    assert "1 条普通观测、1 条异常候选" in counts.json()["answer"]
    assert counts.json()["query_plan"]["intent"] == "coverage_audit"
    assert counts.json()["query_plan"]["mode"] == "research"
    assert len(counts.json()["query_plan"]["steps"]) == 4
    assert counts.json()["runtime_profile"]["architecture"] == "langgraph_state_graph"
    assert counts.json()["runtime_profile"]["checkpoint_backend"] == "sqlite"
    assert counts.json()["runtime_profile"]["long_term_store"] == "langgraph_sqlite_store"
    assert counts.json()["runtime_profile"]["reply_strategy"] == "evidence_first"
    assert counts.json()["runtime_profile"]["execution_trace"] == [
        "scope",
        "retrieve",
        "plan",
        "reason",
        "verify",
        "respond",
    ]
    assert candidates.status_code == 200
    assert "候选表示达到筛查条件，不等同于已确认海洋事件" in candidates.json()["answer"]
    assert candidates.json()["citations"][0]["event_id"] == "SIG-TEST-CHLA-1"
    assert candidates.json()["query_plan"]["intent"] == "candidate_review"
    assert candidates.json()["query_plan"]["variables"] == []


def test_latest_observations_with_evidence_word_keeps_latest_intent(monkeypatch) -> None:
    bundle = _bundle()
    now = datetime.now(UTC)
    bundle["events"] = [
        record.model_copy(update={"started_at": now, "source_updated_at": now})
        for record in bundle["events"]
    ]
    monkeypatch.setattr("app.main.get_realtime_bundle", lambda *args, **kwargs: bundle)

    response = client.post(
        "/api/agent/chat",
        json={
            "region_id": "global_ocean",
            "question": "汇总最近 24 小时的新观测，并按来源和时间列出证据",
            "analysis_mode": "research",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["query_plan"]["intent"] == "latest_observations"
    assert payload["query_plan"]["time_scope"] == "过去 24 小时"
    assert "过去 24 小时的高相关召回" in payload["answer"]
    assert "按来源" in payload["answer"]
    assert "不等同于异常候选" in payload["answer"]


def test_external_model_circuit_opens_and_recovers(monkeypatch) -> None:
    monkeypatch.setattr("app.agents.data_context._agent_api_config", lambda: ("https://model.test/v1/responses", "key", "model"))
    monkeypatch.setenv("OCEAN_AGENT_CIRCUIT_FAILURES", "1")
    monkeypatch.setenv("OCEAN_AGENT_CIRCUIT_COOLDOWN_SECONDS", "60")

    _acquire_model_circuit()
    _record_model_failure()
    status, retry_after = model_circuit_status()
    assert status == "cooldown"
    assert retry_after > 0
    with pytest.raises(ModelCircuitOpenError):
        _acquire_model_circuit()

    _record_model_success()
    assert model_circuit_status() == ("available", 0)
    _acquire_model_circuit()
    _record_model_success()


def test_model_routes_and_fallback_payload_are_relay_compatible() -> None:
    assert _model_routes("https://model.test/v1/responses") == [
        ("https://model.test/v1/responses", "responses"),
        ("https://model.test/v1/chat/completions", "chat"),
    ]
    fallback = _model_body(
        route="chat",
        model="model",
        instructions="system",
        payload={"question": "test"},
        research=True,
        fallback=True,
    )
    assert fallback["store"] is False
    assert fallback["max_completion_tokens"] == 500
    assert "reasoning" not in fallback


def test_external_model_fails_over_from_responses_to_chat(monkeypatch) -> None:
    bundle = _bundle()
    region = {"id": "global_ocean", "name": "全球"}
    request = AgentChatRequest(region_id="global_ocean", question="研判当前叶绿素候选")
    manifest = build_agent_manifest(region, bundle)
    records = _rank_records(bundle["events"], request)
    query_plan = _build_query_plan(request, manifest, records)
    calls: list[str] = []
    user_agents: list[str | None] = []

    class FakeResponse:
        headers = {"x-request-id": "req-fallback-ok"}

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def getcode(self) -> int:
            return 200

        def read(self) -> bytes:
            return json.dumps({"choices": [{"message": {"content": "中转热备已接管"}}]}).encode()

    def fake_urlopen(api_request, timeout):
        del timeout
        calls.append(api_request.full_url)
        user_agents.append(api_request.get_header("User-agent"))
        if len(calls) == 1:
            raise HTTPError(api_request.full_url, 502, "gateway", {}, None)
        return FakeResponse()

    monkeypatch.setattr(
        "app.agents.data_context._agent_api_config",
        lambda: ("https://model.test/v1/responses", "key", "model"),
    )
    monkeypatch.setattr("app.agents.data_context.urlopen", fake_urlopen)
    monkeypatch.setattr("app.agents.data_context.time.sleep", lambda *_: None)
    monkeypatch.setenv("OCEAN_AGENT_API_ATTEMPTS", "2")

    answer = _external_answer(request, manifest, records, [], query_plan)

    assert answer == "中转热备已接管"
    assert calls == [
        "https://model.test/v1/responses",
        "https://model.test/v1/chat/completions",
    ]
    assert user_agents == [
        "Ocean-Intelligence/1.0 (OpenAI-Compatible Client)",
        "Ocean-Intelligence/1.0 (OpenAI-Compatible Client)",
    ]
    health = model_runtime_snapshot()
    assert health["status"] == "available"
    assert health["request_count"] == 2
    assert health["success_count"] == 1
    assert health["failure_count"] == 1
    assert health["failover_count"] == 1
    assert health["last_route"] == "chat"


def test_agent_rejects_selected_record_outside_current_index(monkeypatch) -> None:
    monkeypatch.setattr("app.main.get_realtime_bundle", lambda *args, **kwargs: _bundle())

    response = client.post(
        "/api/agent/chat",
        json={
            "region_id": "global_ocean",
            "question": "解释当前记录",
            "selected_event_id": "NOT-IN-REGION",
            "history": [],
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "当前区域索引中未找到所选记录"


def test_agent_persists_session_history_and_explicit_memory(monkeypatch, tmp_path) -> None:
    store = AgentMemoryStore(tmp_path / "agent-test.sqlite3")
    monkeypatch.setattr("app.main.agent_memory_store", store)
    monkeypatch.setattr("app.main.get_realtime_bundle", lambda *args, **kwargs: _bundle())

    first = client.post(
        "/api/agent/chat",
        json={
            "region_id": "global_ocean",
            "question": "记住以后回答要先给关键数量。",
            "remember": True,
        },
    )

    assert first.status_code == 200
    first_payload = first.json()
    session_id = first_payload["session"]["id"]
    assert first_payload["session"]["message_count"] == 2
    assert first_payload["memories_used"][0]["content"] == "以后回答要先给关键数量"
    stored_memory_id = first_payload["memories_used"][0]["id"]
    assert _LONG_TERM_STORE.get(("ocean-agent", "global_ocean", "long-term-memory"), stored_memory_id)

    continued = client.post(
        "/api/agent/chat",
        json={
            "region_id": "global_ocean",
            "session_id": session_id,
            "question": "你记得我的偏好吗？",
        },
    )
    assert continued.status_code == 200
    assert "以后回答要先给关键数量" in continued.json()["answer"]

    history = client.get(f"/api/agent/sessions/{session_id}")
    assert history.status_code == 200
    assert history.json()["message_count"] == 4
    assert [message["role"] for message in history.json()["messages"]] == [
        "user",
        "assistant",
        "user",
        "assistant",
    ]
    assert history.json()["messages"][-1]["query_plan"]["mode"] == "research"
    assert history.json()["messages"][-1]["runtime_profile"]["framework"] == "LangGraph"
    assert history.json()["messages"][-1]["runtime_profile"]["memory_layers"] == [
        "working",
        "episodic",
        "semantic",
        "procedural",
    ]
    assert history.json()["messages"][-1]["notes"] == []

    memories = client.get("/api/agent/memories?region=global_ocean")
    assert memories.status_code == 200
    memory_id = memories.json()[0]["id"]
    disabled = client.patch(f"/api/agent/memories/{memory_id}", json={"enabled": False})
    assert disabled.status_code == 200
    assert disabled.json()["enabled"] is False
    assert _LONG_TERM_STORE.get(("ocean-agent", "global_ocean", "long-term-memory"), memory_id) is None


def test_agent_rejects_unknown_session(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr("app.main.agent_memory_store", AgentMemoryStore(tmp_path / "unknown.sqlite3"))
    monkeypatch.setattr("app.main.get_realtime_bundle", lambda *args, **kwargs: _bundle())

    response = client.post(
        "/api/agent/chat",
        json={
            "region_id": "global_ocean",
            "session_id": "missing-session",
            "question": "继续",
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "会话不存在"


def test_agent_quick_mode_persists_compact_research_plan(monkeypatch, tmp_path) -> None:
    store = AgentMemoryStore(tmp_path / "quick-mode.sqlite3")
    monkeypatch.setattr("app.main.agent_memory_store", store)
    monkeypatch.setattr("app.main.get_realtime_bundle", lambda *args, **kwargs: _bundle())

    response = client.post(
        "/api/agent/chat",
        json={
            "region_id": "global_ocean",
            "question": "对比 SST 和叶绿素最近一周的变化",
            "analysis_mode": "quick",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["query_plan"]["mode"] == "quick"
    assert payload["query_plan"]["intent"] == "comparison"
    assert payload["query_plan"]["time_scope"] == "过去 7 天"
    assert payload["query_plan"]["variables"] == ["CHLA", "SST"]
    assert payload["retrieved_record_count"] <= 14

    history = client.get(f"/api/agent/sessions/{payload['session']['id']}").json()
    assert history["messages"][-1]["query_plan"]["intent_label"] == "时空对比分析"


def test_agent_checkpoint_is_deleted_with_session(monkeypatch, tmp_path) -> None:
    store = AgentMemoryStore(tmp_path / "checkpoint-session.sqlite3")
    monkeypatch.setattr("app.main.agent_memory_store", store)
    monkeypatch.setattr("app.main.get_realtime_bundle", lambda *args, **kwargs: _bundle())

    response = client.post(
        "/api/agent/chat",
        json={"region_id": "global_ocean", "question": "最近 24 小时有哪些新观测？"},
    )
    assert response.status_code == 200
    session_id = response.json()["session"]["id"]
    config = {"configurable": {"thread_id": session_id}}
    assert _CHECKPOINTER.get_tuple(config) is not None

    deleted = client.delete(f"/api/agent/sessions/{session_id}")
    assert deleted.status_code == 204
    assert _CHECKPOINTER.get_tuple(config) is None
