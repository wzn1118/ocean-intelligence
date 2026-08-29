from __future__ import annotations

import json
import os
import threading
from datetime import UTC, datetime
from hashlib import sha256
from typing import Any
from urllib.request import Request, urlopen

from app.agents.data_context import _model_answer_text
from app.models import EventExplanation, OceanEvent
from app.provider_http import PROVIDER_USER_AGENT


EXPLANATION_API_URL = os.getenv("OCEAN_EXPLANATION_API_URL", "").strip()
EXPLANATION_API_KEY = os.getenv("OCEAN_EXPLANATION_API_KEY", "").strip()
EXPLANATION_API_MODEL = os.getenv("OCEAN_EXPLANATION_API_MODEL", "ocean-evidence-model").strip()

_cache: dict[str, EventExplanation] = {}
_cache_lock = threading.Lock()


SOURCE_LINKS = {
    "NOAA_SST": "https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDsstDaily.html",
    "ARGO_CORE": "https://argo.ucsd.edu/data/data-from-gdacs/",
    "BGC_ARGO": "https://biogeochemical-argo.org/data-access.php",
}


def _explanation_api_config(
    api_config: tuple[str, str, str] | None = None,
) -> tuple[str, str, str]:
    return api_config or (
        EXPLANATION_API_URL,
        EXPLANATION_API_KEY,
        EXPLANATION_API_MODEL,
    )


def explanation_api_configured(
    api_config: tuple[str, str, str] | None = None,
) -> bool:
    return all(_explanation_api_config(api_config))


def _evidence_payload(event: OceanEvent) -> dict[str, Any]:
    return {
        "event_id": event.id,
        "title": event.title,
        "region": event.region,
        "observed_at": event.source_updated_at.isoformat() if event.source_updated_at else event.started_at.isoformat(),
        "data_mode": event.data_mode,
        "validation_state": event.validation_state,
        "confidence": event.confidence,
        "sources": event.sources,
        "evidence": [item.model_dump(mode="json") for item in event.evidence],
        "uncertainty": event.uncertainty,
    }


def _external_explanation(
    event: OceanEvent,
    api_config: tuple[str, str, str] | None = None,
) -> EventExplanation:
    api_url, api_key, api_model = _explanation_api_config(api_config)
    schema_instruction = (
        "只依据 evidence JSON 用简洁自然的中文解释海洋观测，写给没有海洋学背景的读者。"
        "使用短句，先说时间、地点、测量内容和数值；解释 QC、误差和适用范围。"
        "不要使用‘该条目’‘本轮’‘系统记录’‘观测锚点’‘证据约束’等机器化表达。"
        "返回 JSON，字段为 headline、summary、findings、mechanisms、impacts、caveats；"
        "findings 必须包含数值和单位，不得把区域空间中位数称为气候态，"
        "validation_state=screening 时必须明确称为候选筛查且不得写成已确认事件；"
        "validation_state=observed 时说明数据已经质检，并提醒单条记录不能直接判断整个海域是否异常。"
    )
    evidence_json = json.dumps(_evidence_payload(event), ensure_ascii=False)
    if api_url.rstrip("/").endswith("/responses"):
        request_payload = {
            "model": api_model,
            "instructions": schema_instruction,
            "input": evidence_json,
            "max_output_tokens": 900,
            "store": False,
        }
    else:
        request_payload = {
            "model": api_model,
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": schema_instruction},
                {"role": "user", "content": evidence_json},
            ],
        }
    body = json.dumps(request_payload, ensure_ascii=False).encode("utf-8")
    request = Request(
        api_url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": PROVIDER_USER_AGENT,
        },
    )
    with urlopen(request, timeout=35) as response:
        payload = json.loads(response.read().decode("utf-8"))
    content = _model_answer_text(payload)
    if content.startswith("```"):
        content = content.removeprefix("```json").removeprefix("```")
        content = content.removesuffix("```").strip()
    result = json.loads(content)
    return EventExplanation(
        event_id=event.id,
        provider="external_api",
        model=api_model,
        generated_at=datetime.now(UTC),
        headline=str(result["headline"]),
        summary=str(result["summary"]),
        findings=[str(item) for item in result.get("findings", [])],
        mechanisms=[str(item) for item in result.get("mechanisms", [])],
        impacts=[str(item) for item in result.get("impacts", [])],
        caveats=[str(item) for item in result.get("caveats", [])],
        evidence_ids=[item.id for item in event.evidence],
        source_links=[SOURCE_LINKS[source] for source in event.sources if source in SOURCE_LINKS],
        method="根据当前记录的测量值、时间、位置和质量信息整理。",
    )


def _evidence_explanation(event: OceanEvent) -> EventExplanation:
    evidence = event.evidence[0]
    if event.event_kind == "observation":
        mode_label = {"live": "实时数据", "cached": "缓存数据", "scenario": "示例数据"}.get(event.data_mode, event.data_mode)
        variable_label = {
            "SST": "海面温度",
            "TEMPERATURE": "温度",
            "SALINITY": "盐度",
            "CHLA": "叶绿素",
            "NITRATE": "硝酸盐",
        }.get(evidence.variable, evidence.variable)
        unit_label = {"degC": "°C", "mg m-3": "mg/m³", "umol kg-1": "μmol/kg"}.get(evidence.unit, evidence.unit)
        return EventExplanation(
            event_id=event.id,
            provider="evidence_engine",
            model="regional-evidence-v1",
            generated_at=datetime.now(UTC),
            headline="先看数值，再结合当地历史判断变化",
            summary=event.summary,
            findings=[
                f"测量结果：{variable_label} {evidence.observed:.3f} {unit_label}。",
                f"质量检查已通过，数据可信度为 {evidence.confidence:.0%}。",
                f"同一数据集中共有 {event.observation_count} 条相关记录；当前使用{mode_label}。",
            ],
            mechanisms=[step.mechanism for step in event.reasoning_chain],
            impacts=event.potential_impacts,
            caveats=[event.uncertainty],
            evidence_ids=[item.id for item in event.evidence],
            source_links=[SOURCE_LINKS[source] for source in event.sources if source in SOURCE_LINKS],
            method="根据测量值、时间、位置和质量信息整理，没有加入来源之外的推测。",
        )
    direction = "高于" if evidence.anomaly >= 0 else "低于"
    findings = [
        f"测量值为 {evidence.observed:.3f} {evidence.unit}。",
        f"与同一时间的邻近测点相比，这个数值{direction} {abs(evidence.anomaly):.3f} {evidence.unit}。",
        f"筛查可信度为 {evidence.confidence:.0%}；同一数据集中有 {event.observation_count} 条相关记录。",
    ]
    return EventExplanation(
        event_id=event.id,
        provider="evidence_engine",
        model="regional-evidence-v1",
        generated_at=datetime.now(UTC),
        headline="这组数据为什么被标为异常",
        summary=event.summary,
        findings=findings,
        mechanisms=[step.mechanism for step in event.reasoning_chain],
        impacts=event.potential_impacts,
        caveats=[event.uncertainty, "空间偏差用于快速筛查，连续事件认定仍需要后续时次支持。"],
        evidence_ids=[item.id for item in event.evidence],
        source_links=[SOURCE_LINKS[source] for source in event.sources if source in SOURCE_LINKS],
        method="将测量值与同一时间的邻近测点比较，并检查是否连续达到筛查阈值。",
    )


def explain_event(
    event: OceanEvent,
    *,
    force_refresh: bool = False,
    api_config: tuple[str, str, str] | None = None,
    cache_scope: str = "shared",
) -> EventExplanation:
    api_url, _, api_model = _explanation_api_config(api_config)
    config_fingerprint = sha256(f"{api_url}|{api_model}".encode("utf-8")).hexdigest()[:16]
    cache_key = (
        f"{cache_scope}:{config_fingerprint}:{event.id}:"
        f"{event.source_updated_at or event.started_at}"
    )
    with _cache_lock:
        cached = _cache.get(cache_key)
    if cached and not force_refresh:
        return cached.model_copy(deep=True)
    explanation: EventExplanation
    if event.event_kind == "observation":
        explanation = _evidence_explanation(event)
    elif explanation_api_configured(api_config):
        try:
            explanation = _external_explanation(event, api_config)
        except Exception:  # noqa: BLE001 - evidence engine keeps the endpoint operational
            explanation = _evidence_explanation(event)
    else:
        explanation = _evidence_explanation(event)
    with _cache_lock:
        _cache[cache_key] = explanation.model_copy(deep=True)
    return explanation
