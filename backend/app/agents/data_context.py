from __future__ import annotations

import json
import os
import random
import re
import threading
import time
from collections import Counter
from datetime import UTC, datetime, timedelta
from hashlib import sha1, sha256
from typing import Any
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from app.models import (
    AgentChatRequest,
    AgentCitation,
    AgentContextManifest,
    AgentMemory,
    AgentQueryPlan,
    AgentResearchStep,
    AgentSourceContext,
    OceanEvent,
)
from app.provider_http import PROVIDER_USER_AGENT


VARIABLE_ALIASES = {
    "SST": ("sst", "海温", "海面温度", "表层温度"),
    "TEMPERATURE": ("temperature", "温度", "水温"),
    "SALINITY": ("salinity", "盐度"),
    "CHLA": ("chla", "叶绿素", "叶绿素a", "叶绿素 a"),
    "NITRATE": ("nitrate", "硝酸盐", "营养盐"),
    "CURRENT": ("current", "海流", "流速"),
    "PCO2": ("pco2", "二氧化碳分压", "碳"),
    "DIC": ("dic", "溶解无机碳", "碳"),
    "WAVE_HEIGHT": ("wave height", "vhm0", "有效波高", "显著波高", "总浪", "海况"),
    "SWELL_HEIGHT": ("swell", "vhm0_sw1", "涌浪", "一级涌浪"),
    "WIND_WAVE_HEIGHT": ("wind wave", "vhm0_ww", "风浪"),
    "WIND_SPEED": ("wind speed", "eastward_wind", "northward_wind", "风速", "海面风"),
    "WIND_DIRECTION": ("wind direction", "wind_direction_from", "风向", "风来向"),
}

_RETRYABLE_MODEL_STATUS = {400, 404, 405, 408, 409, 415, 422, 429, 500, 502, 503, 504}
_MODEL_CIRCUIT_LOCK = threading.Lock()
_MODEL_CIRCUITS: dict[str, dict[str, Any]] = {}
_MODEL_RUNTIMES: dict[str, dict[str, Any]] = {}


class ModelCircuitOpenError(RuntimeError):
    """Raised when the shared external-model circuit is cooling down."""


def _bounded_env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        value = default
    return max(minimum, min(value, maximum))


def _bounded_env_float(name: str, default: float, minimum: float, maximum: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except ValueError:
        value = default
    return max(minimum, min(value, maximum))


def _model_scope(api_config: tuple[str, str, str] | None = None) -> str:
    api_url, api_key, api_model = _resolve_agent_api_config(api_config)
    material = f"{api_url}\0{api_model}\0{api_key}".encode("utf-8")
    return sha256(material).hexdigest()


def _new_circuit_state() -> dict[str, Any]:
    return {
        "consecutive_failures": 0,
        "open_until": 0.0,
        "probe_in_flight": False,
    }


def _new_runtime_state() -> dict[str, Any]:
    return {
        "request_count": 0,
        "success_count": 0,
        "failure_count": 0,
        "failover_count": 0,
        "last_route": None,
        "last_latency_ms": None,
        "last_status": None,
        "last_request_id": None,
        "last_success_at": None,
        "last_failure_at": None,
        "last_error": None,
    }


def _acquire_model_circuit(api_config: tuple[str, str, str] | None = None) -> None:
    now = time.monotonic()
    scope = _model_scope(api_config)
    with _MODEL_CIRCUIT_LOCK:
        circuit = _MODEL_CIRCUITS.setdefault(scope, _new_circuit_state())
        open_until = float(circuit["open_until"])
        if open_until > now:
            raise ModelCircuitOpenError("external model is cooling down")
        if open_until > 0:
            if bool(circuit["probe_in_flight"]):
                raise ModelCircuitOpenError("external model recovery probe is already running")
            circuit["probe_in_flight"] = True


def _record_model_success(api_config: tuple[str, str, str] | None = None) -> None:
    scope = _model_scope(api_config)
    with _MODEL_CIRCUIT_LOCK:
        _MODEL_CIRCUITS.setdefault(scope, _new_circuit_state()).update(
            consecutive_failures=0,
            open_until=0.0,
            probe_in_flight=False,
        )


def _record_model_failure(api_config: tuple[str, str, str] | None = None) -> None:
    threshold = _bounded_env_int("OCEAN_AGENT_CIRCUIT_FAILURES", 2, 1, 5)
    cooldown = _bounded_env_float("OCEAN_AGENT_CIRCUIT_COOLDOWN_SECONDS", 30.0, 10.0, 600.0)
    scope = _model_scope(api_config)
    with _MODEL_CIRCUIT_LOCK:
        circuit = _MODEL_CIRCUITS.setdefault(scope, _new_circuit_state())
        failures = int(circuit["consecutive_failures"]) + 1
        circuit["consecutive_failures"] = failures
        circuit["probe_in_flight"] = False
        if failures >= threshold:
            circuit["open_until"] = time.monotonic() + cooldown


def _reset_model_circuit() -> None:
    with _MODEL_CIRCUIT_LOCK:
        _MODEL_CIRCUITS.clear()
        _MODEL_RUNTIMES.clear()


def _record_model_attempt(
    *,
    route: str,
    latency_ms: int,
    status: int | None,
    request_id: str | None,
    success: bool,
    failover: bool,
    error: str | None = None,
    api_config: tuple[str, str, str] | None = None,
) -> None:
    now = datetime.now(UTC).isoformat()
    scope = _model_scope(api_config)
    with _MODEL_CIRCUIT_LOCK:
        runtime = _MODEL_RUNTIMES.setdefault(scope, _new_runtime_state())
        runtime["request_count"] = int(runtime["request_count"]) + 1
        runtime["last_route"] = route
        runtime["last_latency_ms"] = latency_ms
        runtime["last_status"] = status
        runtime["last_request_id"] = request_id
        if failover:
            runtime["failover_count"] = int(runtime["failover_count"]) + 1
        if success:
            runtime["success_count"] = int(runtime["success_count"]) + 1
            runtime["last_success_at"] = now
            runtime["last_error"] = None
        else:
            runtime["failure_count"] = int(runtime["failure_count"]) + 1
            runtime["last_failure_at"] = now
            runtime["last_error"] = error


def model_runtime_snapshot(api_config: tuple[str, str, str] | None = None) -> dict[str, Any]:
    status, retry_after = model_circuit_status(api_config)
    scope = _model_scope(api_config)
    with _MODEL_CIRCUIT_LOCK:
        runtime = dict(_MODEL_RUNTIMES.get(scope, _new_runtime_state()))
        failures = int(_MODEL_CIRCUITS.get(scope, _new_circuit_state())["consecutive_failures"])
    attempts = int(runtime["request_count"])
    successes = int(runtime["success_count"])
    return {
        "configured": agent_api_configured(api_config),
        "status": status,
        "retry_after_seconds": retry_after,
        "consecutive_failures": failures,
        "success_rate": round(successes / attempts, 4) if attempts else None,
        **runtime,
    }


def model_circuit_status(api_config: tuple[str, str, str] | None = None) -> tuple[str, int]:
    if not agent_api_configured(api_config):
        return "unconfigured", 0
    now = time.monotonic()
    scope = _model_scope(api_config)
    with _MODEL_CIRCUIT_LOCK:
        circuit = _MODEL_CIRCUITS.get(scope, _new_circuit_state())
        remaining = max(0.0, float(circuit["open_until"]) - now)
        probing = bool(circuit["probe_in_flight"])
    if remaining > 0 or probing:
        return "cooldown", max(1, int(remaining + 0.999)) if remaining > 0 else 1
    return "available", 0


def _environment_value(name: str) -> str:
    value = os.getenv(name, "").strip()
    if value or os.name != "nt":
        return value
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as key:
            registry_value, _ = winreg.QueryValueEx(key, name)
        return str(registry_value).strip()
    except (FileNotFoundError, OSError):
        return ""


def _agent_api_config() -> tuple[str, str, str]:
    return (
        _environment_value("OCEAN_AGENT_API_URL"),
        _environment_value("OCEAN_AGENT_API_KEY"),
        _environment_value("OCEAN_AGENT_API_MODEL"),
    )


def _resolve_agent_api_config(api_config: tuple[str, str, str] | None = None) -> tuple[str, str, str]:
    return api_config if api_config is not None else _agent_api_config()


def agent_api_configured(api_config: tuple[str, str, str] | None = None) -> bool:
    return all(_resolve_agent_api_config(api_config))


def build_agent_manifest(
    region: dict[str, Any],
    bundle: dict[str, Any],
    api_config: tuple[str, str, str] | None = None,
) -> AgentContextManifest:
    records: list[OceanEvent] = list(bundle.get("events") or [])
    sources = [AgentSourceContext.model_validate(item) for item in bundle.get("sources") or []]
    variables = Counter(variable for record in records for variable in record.variables)
    modes = Counter(record.data_mode for record in records)
    observed_times = [
        record.source_updated_at or record.started_at
        for record in records
        if record.source_updated_at or record.started_at
    ]
    refreshed_at = bundle.get("refreshed_at") or datetime.now(UTC)
    revision_seed = "|".join(
        [str(region["id"]), str(refreshed_at), str(len(records))]
        + [f"{item.id}:{item.source_updated_at or item.started_at}" for item in records[-32:]]
    )
    _, _, configured_model = _resolve_agent_api_config(api_config)
    model_status, retry_after = model_circuit_status(api_config)
    return AgentContextManifest(
        region_id=str(region["id"]),
        region=str(region["name"]),
        indexed_at=refreshed_at,
        index_revision=sha1(revision_seed.encode("utf-8")).hexdigest()[:12],
        record_count=len(records),
        observation_count=sum(record.event_kind == "observation" for record in records),
        candidate_count=sum(record.event_kind == "anomaly" for record in records),
        confirmed_event_count=sum(
            record.event_kind == "anomaly" and record.validation_state in {"corroborated", "confirmed"}
            for record in records
        ),
        source_count=len(sources),
        live_source_count=sum(source.status == "live" for source in sources),
        variable_counts=dict(sorted(variables.items(), key=lambda item: (-item[1], item[0]))),
        data_mode_counts=dict(modes),
        earliest_record_at=min(observed_times) if observed_times else None,
        latest_record_at=max(observed_times) if observed_times else None,
        indexed_fields=[
            "记录标题与摘要",
            "变量、测量值与单位",
            "时间、经纬度与海域",
            "数据来源与质量状态",
            "候选筛查与验证状态",
            "区域统计与数据源状态",
        ],
        sources=sources,
        answer_engine="external_model" if model_status == "available" else "local_retrieval",
        model=configured_model if model_status != "unconfigured" else "ocean-index-local-v1",
        external_model=configured_model or None,
        model_status=model_status,
        model_retry_after_seconds=retry_after,
    )


def _record_time(record: OceanEvent) -> datetime:
    return record.source_updated_at or record.started_at


def _reading(record: OceanEvent) -> str:
    if not record.evidence:
        return "暂无测量值"
    item = record.evidence[0]
    return f"{item.variable} {item.observed:g} {item.unit}"


def _query_variables(question: str) -> set[str]:
    lowered = question.lower().replace("－", "-")
    return {
        variable
        for variable, aliases in VARIABLE_ALIASES.items()
        if any(alias in lowered for alias in aliases)
    }


def _query_terms(question: str) -> list[str]:
    lowered = question.lower()
    latin = re.findall(r"[a-z0-9][a-z0-9_.:-]{1,}", lowered)
    chinese_chunks = re.findall(r"[\u4e00-\u9fff]{2,}", lowered)
    chinese = [chunk for value in chinese_chunks for chunk in (value, *[value[index:index + 2] for index in range(len(value) - 1)])]
    stop = {"什么", "现在", "里面", "一下", "数据", "记录", "情况", "可以", "当前", "请问"}
    return list(dict.fromkeys(term for term in latin + chinese if term not in stop))[:40]


def _query_intent(request: AgentChatRequest) -> tuple[str, str]:
    question = request.question.lower()
    if any(term in question for term in ("异常", "候选", "筛查", "anomaly", "signal")):
        return "candidate_review", "异常候选复核"
    if any(term in question for term in ("对比", "比较", "差异", "变化", "趋势", "compare", "versus", "trend")):
        return "comparison", "时空对比分析"
    if any(term in question for term in ("最新", "最近", "24小时", "24 小时", "今天", "latest", "recent")):
        return "latest_observations", "最新观测扫描"
    if any(term in question for term in ("数据源", "接口", "管线", "source health", "pipeline", "是否正常")):
        return "source_health", "数据源健康核验"
    if any(term in question for term in ("覆盖", "完整", "缺失", "质量", "多少", "数量", "qc", "coverage", "missing", "count")):
        return "coverage_audit", "数据覆盖审计"
    if request.selected_event_id or any(term in question for term in ("这条", "该记录", "解释", "为什么", "record")):
        return "record_explanation", "记录证据解释"
    return "general_research", "综合数据研判"


def _query_time_scope(question: str) -> tuple[str, timedelta | None]:
    lowered = question.lower()
    if any(term in lowered for term in ("24小时", "24 小时", "今天", "latest", "最近一天")):
        return "过去 24 小时", timedelta(hours=24)
    if any(term in lowered for term in ("7天", "7 天", "一周", "本周", "week")):
        return "过去 7 天", timedelta(days=7)
    if any(term in lowered for term in ("30天", "30 天", "一个月", "本月", "month")):
        return "过去 30 天", timedelta(days=30)
    if any(term in lowered for term in ("最新", "最近", "recent")):
        return "按最新记录优先", None
    return "当前完整索引", None


def _rank_records(
    records: list[OceanEvent],
    request: AgentChatRequest,
    *,
    limit: int = 18,
) -> list[OceanEvent]:
    question = request.question.lower()
    variables = _query_variables(question)
    terms = _query_terms(question)
    wants_candidates = any(term in question for term in ("异常", "候选", "筛查", "signal", "anomaly"))
    wants_latest = any(term in question for term in ("最新", "最近", "24小时", "24 小时", "latest", "recent"))
    ranked: list[tuple[float, datetime, OceanEvent]] = []
    for record in records:
        searchable = " ".join(
            [record.id, record.title, record.summary, record.region, record.type, record.validation_state, *record.variables]
        ).lower()
        score = 0.0
        if request.selected_event_id and record.id == request.selected_event_id:
            score += 30
        if record.id.lower() in question:
            score += 24
        if variables.intersection(record.variables):
            score += 12 + 3 * len(variables.intersection(record.variables))
        score += sum(1.5 for term in terms if term in searchable)
        if wants_candidates and record.event_kind == "anomaly":
            score += 8
        if not wants_candidates and record.event_kind == "observation":
            score += 1
        if wants_latest:
            score += 2
        ranked.append((score, _record_time(record), record))
    ranked.sort(key=lambda item: (item[0], item[1]), reverse=True)
    if ranked and ranked[0][0] <= 1:
        ranked.sort(key=lambda item: item[1], reverse=True)
    _, lookback = _query_time_scope(request.question)
    if lookback is not None:
        cutoff = datetime.now(UTC) - lookback
        recent = [item for item in ranked if _record_time(item[2]) >= cutoff]
        if recent:
            ranked = recent
    if wants_latest and ranked:
        buckets: dict[str, list[tuple[float, datetime, OceanEvent]]] = {}
        for item in ranked:
            source_key = item[2].sources[0] if item[2].sources else "未标注来源"
            buckets.setdefault(source_key, []).append(item)
        diversified: list[tuple[float, datetime, OceanEvent]] = []
        while any(buckets.values()):
            for source_key in list(buckets):
                if buckets[source_key]:
                    diversified.append(buckets[source_key].pop(0))
        ranked = diversified
    return [item[2] for item in ranked[:limit]]


def _build_query_plan(
    request: AgentChatRequest,
    manifest: AgentContextManifest,
    records: list[OceanEvent],
) -> AgentQueryPlan:
    intent, intent_label = _query_intent(request)
    time_scope, _ = _query_time_scope(request.question)
    variables = sorted(_query_variables(request.question))
    variable_text = "、".join(variables) if variables else "全部相关变量"
    source_ids = {source for record in records for source in record.sources}
    candidate_count = sum(record.event_kind == "anomaly" for record in records)
    if intent == "candidate_review":
        strategy = "候选记录优先，并用普通观测、验证状态和邻近记录交叉核对"
    elif intent == "comparison":
        strategy = "按时间、海域与变量组织可比记录，避免把单点差异解释成长期趋势"
    elif intent == "source_health":
        strategy = "联合数据源状态、更新时间与索引记录量判断当前可用性"
    elif intent == "coverage_audit":
        strategy = "检查变量、来源、时间跨度与质量状态，定位覆盖强项和证据空缺"
    else:
        strategy = "先锁定问题范围，再按相关性、时效和证据状态组织记录"
    return AgentQueryPlan(
        mode=request.analysis_mode,
        intent=intent,
        intent_label=intent_label,
        time_scope=time_scope,
        variables=variables,
        evidence_strategy=strategy,
        steps=[
            AgentResearchStep(
                key="interpret",
                label="理解问题",
                detail=f"识别为{intent_label}，范围为{time_scope}，关注{variable_text}",
            ),
            AgentResearchStep(
                key="retrieve",
                label="检索索引",
                detail=f"从 {manifest.record_count:,} 条记录中选择 {len(records)} 条高相关证据",
                evidence_count=len(records),
            ),
            AgentResearchStep(
                key="cross_check",
                label="交叉核验",
                detail=f"覆盖 {max(1, len(source_ids))} 个记录来源，其中 {candidate_count} 条为异常候选",
                evidence_count=len(source_ids),
            ),
            AgentResearchStep(
                key="synthesize",
                label="形成研判",
                detail="深度模式将区分事实、推断和科学边界" if request.analysis_mode == "research" else "快速模式优先返回关键结论与数字",
                evidence_count=min(8, len(records)),
            ),
        ],
    )


def _citations(records: list[OceanEvent]) -> list[AgentCitation]:
    if not records:
        return []
    top_score = max(1, len(records))
    return [
        AgentCitation(
            id=f"record:{record.id}",
            kind="record",
            title=record.title,
            subtitle=f"{record.region} · {_reading(record)} · {'异常候选' if record.event_kind == 'anomaly' else '观测记录'}",
            event_id=record.id,
            variables=record.variables,
            observed_at=_record_time(record),
            relevance=max(0.35, 1 - index / top_score),
        )
        for index, record in enumerate(records[:8])
    ]


def _local_answer(
    request: AgentChatRequest,
    manifest: AgentContextManifest,
    records: list[OceanEvent],
    memories: list[AgentMemory],
) -> str:
    question = request.question.lower()
    variables = _query_variables(question)
    if any(term in question for term in ("记忆", "记得", "偏好", "remember", "memory")):
        if not memories:
            return "当前没有启用的跨会话记忆。你可以明确说“记住……”或在记忆页手动添加。"
        remembered = "；".join(memory.content for memory in memories[:8])
        return f"当前启用的跨会话记忆有 {len(memories)} 条：{remembered}。"
    if any(term in question for term in ("多少", "数量", "几条", "统计", "总数", "count")):
        if variables:
            details = "、".join(f"{item} {manifest.variable_counts.get(item, 0)} 条" for item in sorted(variables))
            return f"{manifest.region}完整索引中，{details}。这些数量按当前记录的变量字段统计，一条多变量记录会分别计入相应变量。"
        return (
            f"{manifest.region}当前完整索引共 {manifest.record_count} 条记录："
            f"{manifest.observation_count} 条普通观测、{manifest.candidate_count} 条异常候选，"
            f"其中 {manifest.confirmed_event_count} 条达到佐证或确认状态。"
        )
    if any(term in question for term in ("异常", "候选", "筛查", "anomaly", "signal")):
        candidates = [record for record in records if record.event_kind == "anomaly"]
        if not candidates:
            return f"{manifest.region}当前完整索引中有 {manifest.candidate_count} 条异常候选，但本次问题没有匹配到更具体的候选记录。"
        names = "；".join(f"{record.title}（{_reading(record)}）" for record in candidates[:4])
        return (
            f"{manifest.region}当前有 {manifest.candidate_count} 条异常候选，"
            f"其中 {manifest.confirmed_event_count} 条已达到佐证或确认状态。本次最相关的是：{names}。"
            "候选表示达到筛查条件，不等同于已确认海洋事件。"
        )
    if any(term in question for term in ("最新", "最近", "24小时", "24 小时", "今天", "latest", "recent")):
        cutoff = datetime.now(UTC) - timedelta(hours=24)
        recent_records = [record for record in records if _record_time(record) >= cutoff]
        if not recent_records:
            latest = max((_record_time(record) for record in records), default=manifest.latest_record_at)
            latest_text = latest.astimezone(UTC).strftime("%m月%d日 %H:%M UTC") if latest else "未知"
            return f"当前召回记录中没有过去 24 小时的新观测；索引内最近更新时间为 {latest_text}。"
        source_names = {source.id: source.name for source in manifest.sources}
        records_by_source: dict[str, list[OceanEvent]] = {}
        for record in recent_records:
            source_ids = record.sources or ["未标注来源"]
            for source_id in source_ids:
                records_by_source.setdefault(source_id, []).append(record)
        source_details = []
        for source_id, source_records in records_by_source.items():
            latest_at = max(_record_time(record) for record in source_records)
            source_details.append(
                f"{source_names.get(source_id, source_id)} {len(source_records)} 条，"
                f"最新 {latest_at.astimezone(UTC).strftime('%m月%d日 %H:%M UTC')}"
            )
        details = "；".join(
            f"{record.title}，{_record_time(record).astimezone(UTC).strftime('%m月%d日 %H:%M UTC')}，{_reading(record)}"
            for record in recent_records[:6]
        )
        source_note = f"按来源：{'；'.join(source_details)}。" if source_details else ""
        return (
            f"过去 24 小时的高相关召回中有 {len(recent_records)} 条新观测。{details}。"
            f"{source_note}这些是当前索引的最新观测，不等同于异常候选。"
        )
    if any(term in question for term in ("来源", "数据源", "source")):
        live = [source.name for source in manifest.sources if source.status == "live"]
        cached = [source.name for source in manifest.sources if source.status == "cached"]
        answer = f"{manifest.region}当前索引了 {manifest.source_count} 个数据源，其中 {manifest.live_source_count} 个为实时状态。"
        if live:
            answer += f" 实时来源包括：{'、'.join(live)}。"
        if cached:
            answer += f" 使用最近有效缓存的来源包括：{'、'.join(cached)}。"
        return answer
    if records:
        prefix = "最新匹配记录" if any(term in question for term in ("最新", "最近", "24小时", "latest")) else "最相关记录"
        details = "；".join(
            f"{record.title}，{_record_time(record).astimezone(UTC).strftime('%m月%d日 %H:%M UTC')}，{_reading(record)}"
            for record in records[:5]
        )
        variable_note = ""
        if variables:
            variable_note = " 当前索引数量为" + "、".join(
                f"{item} {manifest.variable_counts.get(item, 0)} 条" for item in sorted(variables)
            ) + "。"
        return f"我检索了{manifest.region}的 {manifest.record_count} 条完整索引。{prefix}：{details}。{variable_note}"
    return f"{manifest.region}当前索引已建立，但没有找到与这个问题直接相关的记录。可以改用变量、海域、时间或记录编号继续查找。"


def _requires_model(request: AgentChatRequest, query_plan: AgentQueryPlan) -> bool:
    question = request.question.lower()
    if any(term in question for term in ("记忆", "记得", "偏好", "remember", "memory")):
        return False
    if query_plan.intent in {"latest_observations", "source_health"}:
        return False
    if query_plan.intent == "coverage_audit" and any(
        term in question for term in ("多少", "数量", "几条", "统计", "总数", "count")
    ):
        return False
    return True


def _model_routes(api_url: str) -> list[tuple[str, str]]:
    endpoint = api_url.rstrip("/")
    if endpoint.endswith("/responses"):
        root = endpoint.removesuffix("/responses")
        return [(endpoint, "responses"), (f"{root}/chat/completions", "chat")]
    if endpoint.endswith("/chat/completions"):
        root = endpoint.removesuffix("/chat/completions")
        return [(endpoint, "chat"), (f"{root}/responses", "responses")]
    return [(endpoint, "chat")]


def _model_body(
    *,
    route: str,
    model: str,
    instructions: str,
    payload: dict[str, Any],
    research: bool,
    fallback: bool,
) -> dict[str, Any]:
    serialized = json.dumps(payload, ensure_ascii=False)
    output_tokens = 500 if fallback else (800 if research else 500)
    if route == "responses":
        body: dict[str, Any] = {
            "model": model,
            "instructions": instructions,
            "input": serialized,
            "max_output_tokens": output_tokens,
            "store": False,
        }
        if not fallback:
            body["reasoning"] = {
                "effort": _environment_value("OCEAN_AGENT_REASONING_EFFORT")
                or ("high" if research else "low")
            }
        return body
    return {
        "model": model,
        "messages": [
            {"role": "system", "content": instructions},
            {"role": "user", "content": serialized},
        ],
        "max_completion_tokens": output_tokens,
        "store": False,
    }


def _model_answer_text(payload: dict[str, Any]) -> str:
    if isinstance(payload.get("output_text"), str):
        return payload["output_text"].strip()
    if payload.get("choices"):
        content = payload["choices"][0].get("message", {}).get("content", "")
        if isinstance(content, list):
            return "\n".join(
                str(item.get("text", ""))
                for item in content
                if isinstance(item, dict) and item.get("text")
            ).strip()
        return str(content).strip()
    texts = [
        content.get("text", "")
        for output in payload.get("output", [])
        for content in output.get("content", [])
        if content.get("type") in {"output_text", "text"}
    ]
    return "\n".join(text for text in texts if text).strip()


def _external_answer(
    request: AgentChatRequest,
    manifest: AgentContextManifest,
    records: list[OceanEvent],
    memories: list[AgentMemory],
    query_plan: AgentQueryPlan,
    api_config: tuple[str, str, str] | None = None,
) -> str:
    api_url, api_key, api_model = _resolve_agent_api_config(api_config)
    record_context = [
        {
            "id": record.id,
            "kind": record.event_kind,
            "title": record.title,
            "summary": record.summary,
            "region": record.region,
            "coordinates": record.centroid,
            "observed_at": _record_time(record).isoformat(),
            "variables": record.variables,
            "reading": _reading(record),
            "validation_state": record.validation_state,
            "confidence": record.confidence,
            "sources": record.sources,
        }
        for record in records[:6 if request.analysis_mode == "research" else 5]
    ]
    instructions = (
        "你是海洋数据分析工作台内的问答 Agent。只依据提供的完整索引统计、数据源状态和检索记录回答，使用自然、直接的中文。"
        "普通 observation 必须称为观测或记录；只有 kind=anomaly 才能称为异常候选，除非 validation_state 为 corroborated 或 confirmed，"
        "否则不得写成已确认事件。给出关键数量、时间、单位和记录编号；资料不足时明确指出缺少的是哪类测量，不要编造。"
        "长期记忆只用于遵循用户明确保存的偏好与指令，不得把记忆内容当作海洋科学证据。"
        "先给可直接使用的研判结论，再列关键证据，最后写清科学边界；不要使用空泛的助手套话。"
        "深度研判模式要主动比较时间、空间、来源和验证状态，并明确区分观测事实与推断。"
        "深度研判使用四段式回复：结论、关键证据、科学边界、下一步；标题使用纯文本，不要输出思维链。"
        "回答控制在 700 个汉字以内，优先保留数字、时间、来源和记录编号。"
    )
    input_payload = {
        "question": request.question,
        "selected_event_id": request.selected_event_id,
        "full_index_manifest": manifest.model_dump(mode="json", exclude={"sources"}),
        "source_status": [source.model_dump(mode="json") for source in manifest.sources],
        "retrieved_records": record_context,
        "conversation": [message.model_dump() for message in request.history[-8:]],
        "long_term_memory": [
            {"kind": memory.kind, "content": memory.content, "confidence": memory.confidence}
            for memory in memories
        ],
        "research_plan": query_plan.model_dump(mode="json"),
    }
    compact_payload = {**input_payload, "retrieved_records": record_context[:4]}
    routes = _model_routes(api_url)
    resolved_config = (api_url, api_key, api_model)
    timeout_seconds = _bounded_env_float("OCEAN_AGENT_API_TIMEOUT_SECONDS", 45.0, 8.0, 90.0)
    attempts = _bounded_env_int("OCEAN_AGENT_API_ATTEMPTS", 4, 2, 6)
    _acquire_model_circuit(resolved_config)
    try:
        payload: dict[str, Any] | None = None
        for attempt in range(attempts):
            route_url, route = routes[attempt % len(routes)]
            fallback = attempt > 0
            request_body = _model_body(
                route=route,
                model=api_model,
                instructions=instructions,
                payload=compact_payload if fallback else input_payload,
                research=request.analysis_mode == "research",
                fallback=fallback,
            )
            api_request = Request(
                route_url,
                data=json.dumps(request_body, ensure_ascii=False).encode("utf-8"),
                method="POST",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "User-Agent": PROVIDER_USER_AGENT,
                },
            )
            started_at = time.monotonic()
            try:
                with urlopen(api_request, timeout=timeout_seconds) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                    status = response.getcode()
                    request_id = response.headers.get("x-request-id")
                _record_model_attempt(
                    route=route,
                    latency_ms=round((time.monotonic() - started_at) * 1000),
                    status=status,
                    request_id=request_id,
                    success=True,
                    failover=attempt > 0,
                    api_config=resolved_config,
                )
                break
            except HTTPError as error:
                _record_model_attempt(
                    route=route,
                    latency_ms=round((time.monotonic() - started_at) * 1000),
                    status=error.code,
                    request_id=error.headers.get("x-request-id") if error.headers else None,
                    success=False,
                    failover=attempt > 0,
                    error=f"HTTP {error.code}",
                    api_config=resolved_config,
                )
                if error.code not in _RETRYABLE_MODEL_STATUS or attempt == attempts - 1:
                    raise
                retry_after = error.headers.get("Retry-After") if error.headers else None
                try:
                    delay = float(retry_after) if retry_after else (0.15 if len(routes) > 1 else 0.6 * (2 ** attempt))
                except ValueError:
                    delay = 0.6 * (2 ** attempt)
                time.sleep(min(4.0, max(0.25, delay)) + random.uniform(0.0, 0.2))
            except (URLError, TimeoutError) as error:
                _record_model_attempt(
                    route=route,
                    latency_ms=round((time.monotonic() - started_at) * 1000),
                    status=None,
                    request_id=None,
                    success=False,
                    failover=attempt > 0,
                    error=type(error).__name__,
                    api_config=resolved_config,
                )
                if attempt == attempts - 1:
                    raise
                time.sleep((0.15 if len(routes) > 1 else min(3.0, 0.5 * (2 ** attempt))) + random.uniform(0.0, 0.2))
        if payload is None:
            raise RuntimeError("模型接口没有返回响应")
        answer = _model_answer_text(payload)
        if not answer:
            raise ValueError("模型响应中没有可显示文本")
    except Exception:
        _record_model_failure(resolved_config)
        raise
    _record_model_success(resolved_config)
    return answer
