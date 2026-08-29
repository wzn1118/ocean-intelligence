from __future__ import annotations

import atexit
import os
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path
from typing import Any, TypedDict
from uuid import uuid4

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.runtime import Runtime
from langgraph.store.sqlite import SqliteStore

from app.agents.data_context import (
    _agent_api_config,
    _build_query_plan,
    _citations,
    _external_answer,
    _local_answer,
    _query_variables,
    _rank_records,
    _requires_model,
    ModelCircuitOpenError,
    agent_api_configured,
    build_agent_manifest,
    model_circuit_status,
)
from app.models import (
    AgentChatRequest,
    AgentChatResponse,
    AgentCitation,
    AgentContextManifest,
    AgentMemory,
    AgentQueryPlan,
    AgentRuntimeProfile,
    OceanEvent,
)


GRAPH_NODES = ["scope", "retrieve", "plan", "reason", "verify", "respond"]


class OceanAgentState(TypedDict, total=False):
    manifest: dict[str, Any]
    records: list[dict[str, Any]]
    query_plan: dict[str, Any]
    answer: str
    provider: str
    model: str
    notes: list[str]
    memory_context: list[dict[str, Any]]
    citations: list[dict[str, Any]]
    follow_ups: list[str]
    trace: list[str]


@dataclass(frozen=True)
class OceanAgentContext:
    region: dict[str, Any]
    bundle: dict[str, Any]
    request: AgentChatRequest
    memories: list[AgentMemory]
    owner_id: str = "local"
    api_config: tuple[str, str, str] | None = None


def _models(state: OceanAgentState) -> tuple[AgentContextManifest, list[OceanEvent], AgentQueryPlan]:
    return (
        AgentContextManifest.model_validate(state["manifest"]),
        [OceanEvent.model_validate(item) for item in state.get("records", [])],
        AgentQueryPlan.model_validate(state["query_plan"]),
    )


def _memory_namespace(owner_id: str, region_id: str) -> tuple[str, ...]:
    if owner_id == "local":
        return ("ocean-agent", region_id, "long-term-memory")
    return ("ocean-agent", owner_id, region_id, "long-term-memory")


def _state_memories(state: OceanAgentState) -> list[AgentMemory]:
    return [AgentMemory.model_validate(item) for item in state.get("memory_context", [])]


def _scope_node(_: OceanAgentState, runtime: Runtime[OceanAgentContext]) -> OceanAgentState:
    manifest = build_agent_manifest(
        runtime.context.region,
        runtime.context.bundle,
        runtime.context.api_config,
    )
    memories: list[dict[str, Any]] = []
    if runtime.store:
        namespace = _memory_namespace(runtime.context.owner_id, runtime.context.request.region_id)
        for memory in runtime.context.memories:
            item = runtime.store.get(namespace, memory.id)
            if item and isinstance(item.value.get("memory"), dict):
                memories.append(item.value["memory"])
    return {
        "manifest": manifest.model_dump(mode="json"),
        "memory_context": memories,
        "trace": ["scope"],
    }


def _retrieve_node(state: OceanAgentState, runtime: Runtime[OceanAgentContext]) -> OceanAgentState:
    request = runtime.context.request
    limit = 28 if request.analysis_mode == "research" else 14
    records = _rank_records(list(runtime.context.bundle.get("events") or []), request, limit=limit)
    return {
        "records": [record.model_dump(mode="json") for record in records],
        "trace": [*state.get("trace", []), "retrieve"],
    }


def _plan_node(state: OceanAgentState, runtime: Runtime[OceanAgentContext]) -> OceanAgentState:
    manifest = AgentContextManifest.model_validate(state["manifest"])
    records = [OceanEvent.model_validate(item) for item in state.get("records", [])]
    plan = _build_query_plan(runtime.context.request, manifest, records)
    return {
        "query_plan": plan.model_dump(mode="json"),
        "trace": [*state.get("trace", []), "plan"],
    }


def _reasoning_route(state: OceanAgentState, runtime: Runtime[OceanAgentContext]) -> str:
    plan = AgentQueryPlan.model_validate(state["query_plan"])
    if agent_api_configured(runtime.context.api_config) and _requires_model(runtime.context.request, plan):
        return "model_reason"
    return "local_reason"


def _local_reason_node(state: OceanAgentState, runtime: Runtime[OceanAgentContext]) -> OceanAgentState:
    manifest, records, _ = _models(state)
    answer = _local_answer(runtime.context.request, manifest, records, _state_memories(state))
    return {
        "answer": answer,
        "provider": "local_retrieval",
        "model": "ocean-index-local-v1",
        "notes": [],
        "trace": [*state.get("trace", []), "reason"],
    }


def _model_reason_node(state: OceanAgentState, runtime: Runtime[OceanAgentContext]) -> OceanAgentState:
    manifest, records, plan = _models(state)
    try:
        answer = _external_answer(
            runtime.context.request,
            manifest,
            records,
            _state_memories(state),
            plan,
            runtime.context.api_config,
        )
        provider = "external_model"
        model = (runtime.context.api_config or _agent_api_config())[2]
        notes: list[str] = []
    except Exception as error:  # noqa: BLE001 - deterministic retrieval preserves product availability
        answer = _local_answer(runtime.context.request, manifest, records, _state_memories(state))
        provider = "local_retrieval"
        model = "ocean-index-local-v1"
        if isinstance(error, ModelCircuitOpenError):
            notes = ["外部模型正在短时冷却，本轮已直接使用本地证据引擎，未重复等待。"]
        else:
            notes = ["外部模型连接暂时不稳定，本轮已由本地证据引擎完成；系统将在冷却后自动恢复探测。"]
    return {
        "answer": answer,
        "provider": provider,
        "model": model,
        "notes": notes,
        "trace": [*state.get("trace", []), "reason"],
    }


def _apply_evidence_first_reply(
    answer: str,
    request: AgentChatRequest,
    manifest: AgentContextManifest,
    records: list[OceanEvent],
) -> str:
    clean = answer.strip()
    if request.analysis_mode == "quick" or all(label in clean for label in ("结论", "证据", "边界")):
        return clean
    source_count = len({source for record in records for source in record.sources})
    candidate_count = sum(record.event_kind == "anomaly" for record in records)
    boundary = (
        "异常候选表示记录达到筛查条件，不等同于已确认海洋事件。"
        if candidate_count
        else "本次召回为普通观测；未达到异常候选条件的记录不作异常解释。"
    )
    return (
        f"结论\n{clean}\n\n"
        f"证据范围\n本次从 {manifest.record_count:,} 条索引中召回 {len(records)} 条相关记录，覆盖 {source_count} 个记录来源。\n\n"
        f"科学边界\n{boundary}\n\n"
        "下一步\n可继续按记录编号、海域、变量或时间窗口下钻复核。"
    )


def _verify_node(state: OceanAgentState, runtime: Runtime[OceanAgentContext]) -> OceanAgentState:
    manifest, records, _ = _models(state)
    answer = _apply_evidence_first_reply(state.get("answer", ""), runtime.context.request, manifest, records)
    notes = list(state.get("notes", []))
    if not records:
        notes.append("本次未召回记录，回复仅限索引级统计与数据源状态。")
    return {
        "answer": answer,
        "notes": notes,
        "trace": [*state.get("trace", []), "verify"],
    }


def _respond_node(state: OceanAgentState, runtime: Runtime[OceanAgentContext]) -> OceanAgentState:
    _, records, _ = _models(state)
    variables = _query_variables(runtime.context.request.question)
    follow_ups = [
        "最近 24 小时有哪些新观测？",
        "当前异常候选依据是什么？",
        "各数据源现在是否正常？",
    ]
    if variables:
        variable = sorted(variables)[0]
        follow_ups[0] = f"{variable} 的最新记录分布在哪里？"
    return {
        "citations": [item.model_dump(mode="json") for item in _citations(records)],
        "follow_ups": follow_ups,
        "trace": [*state.get("trace", []), "respond"],
    }


def _checkpoint_path() -> Path:
    configured = os.getenv("OCEAN_AGENT_CHECKPOINT_DB")
    path = Path(configured) if configured else Path(__file__).resolve().parents[3] / ".runtime" / "agent_checkpoints.sqlite3"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


_CHECKPOINT_CONNECTION = sqlite3.connect(_checkpoint_path(), timeout=30, check_same_thread=False)
_CHECKPOINT_CONNECTION.execute("PRAGMA journal_mode = WAL")
_CHECKPOINTER = SqliteSaver(_CHECKPOINT_CONNECTION)
_STORE_CONNECTION = sqlite3.connect(
    _checkpoint_path().with_name("agent_store.sqlite3"), timeout=30, check_same_thread=False
)
_STORE_CONNECTION.execute("PRAGMA journal_mode = WAL")
_LONG_TERM_STORE = SqliteStore(_STORE_CONNECTION)
_LONG_TERM_STORE.setup()
# SqliteStore.setup() applies schema migrations with direct connection writes.
# Commit them before the first store operation starts its own transaction.
_STORE_CONNECTION.commit()
atexit.register(_CHECKPOINT_CONNECTION.close)
atexit.register(_STORE_CONNECTION.close)


def _build_graph():
    builder = StateGraph(OceanAgentState, context_schema=OceanAgentContext)
    builder.add_node("scope", _scope_node)
    builder.add_node("retrieve", _retrieve_node)
    builder.add_node("plan", _plan_node)
    builder.add_node("local_reason", _local_reason_node)
    builder.add_node("model_reason", _model_reason_node)
    builder.add_node("verify", _verify_node)
    builder.add_node("respond", _respond_node)
    builder.add_edge(START, "scope")
    builder.add_edge("scope", "retrieve")
    builder.add_edge("retrieve", "plan")
    builder.add_conditional_edges(
        "plan",
        _reasoning_route,
        {"local_reason": "local_reason", "model_reason": "model_reason"},
    )
    builder.add_edge("local_reason", "verify")
    builder.add_edge("model_reason", "verify")
    builder.add_edge("verify", "respond")
    builder.add_edge("respond", END)
    return builder.compile(
        checkpointer=_CHECKPOINTER,
        store=_LONG_TERM_STORE,
        name="ocean-research-agent",
    )


OCEAN_AGENT_GRAPH = _build_graph()


def clear_agent_thread(session_id: str) -> None:
    _CHECKPOINTER.delete_thread(session_id)


def delete_agent_memory_from_store(memory_id: str) -> None:
    for item in _LONG_TERM_STORE.search(("ocean-agent",), limit=1000):
        if item.key == memory_id:
            _LONG_TERM_STORE.delete(item.namespace, item.key)


def answer_agent_question(
    region: dict[str, Any],
    bundle: dict[str, Any],
    request: AgentChatRequest,
    memories: list[AgentMemory] | None = None,
    *,
    owner_id: str = "local",
    api_config: tuple[str, str, str] | None = None,
) -> AgentChatResponse:
    active_memories = [memory for memory in memories or [] if memory.enabled]
    thread_id = request.session_id or f"ephemeral-{uuid4().hex}"
    memory_namespace = _memory_namespace(owner_id, request.region_id)
    for memory in active_memories:
        _LONG_TERM_STORE.put(
            memory_namespace,
            memory.id,
            {"memory": memory.model_dump(mode="json")},
            index=False,
        )
    context = OceanAgentContext(
        region=region,
        bundle=bundle,
        request=request,
        memories=active_memories,
        owner_id=owner_id,
        api_config=api_config,
    )
    result = OCEAN_AGENT_GRAPH.invoke(
        {},
        config={"configurable": {"thread_id": thread_id}, "recursion_limit": 16},
        context=context,
        durability="sync",
    )
    manifest = AgentContextManifest.model_validate(result["manifest"])
    provider = result.get("provider", "local_retrieval")
    model = result.get("model", "ocean-index-local-v1")
    manifest.answer_engine = provider
    manifest.model = model
    manifest.model_status, manifest.model_retry_after_seconds = model_circuit_status(api_config)
    trace = list(result.get("trace", []))
    runtime_profile = AgentRuntimeProfile(
        framework_version=version("langgraph"),
        nodes=GRAPH_NODES,
        execution_trace=trace,
    )
    return AgentChatResponse(
        answer=result["answer"],
        generated_at=datetime.now(UTC),
        provider=provider,
        model=model,
        context=manifest,
        citations=[AgentCitation.model_validate(item) for item in result.get("citations", [])],
        retrieved_record_count=len(result.get("records", [])),
        follow_up_questions=list(result.get("follow_ups", [])),
        notes=list(result.get("notes", [])),
        memories_used=active_memories,
        query_plan=AgentQueryPlan.model_validate(result["query_plan"]),
        runtime_profile=runtime_profile,
    )
