from datetime import UTC, datetime

from app.models import OceanEvent, ScientificReport


STATUS_LABELS = {
    "active": "活动中",
    "watch": "持续关注",
    "recovering": "恢复中",
}

VALIDATION_LABELS = {
    "observed": "质量检查已通过",
    "screening": "实时筛查候选",
    "corroborated": "交叉复核事件",
    "confirmed": "已确认事件",
    "scenario": "情景样本",
}


class ReportGenerationAgent:
    """根据结构化科学结果生成可追溯的中文研判报告。"""

    def create(self, event: OceanEvent) -> ScientificReport:
        is_observation = event.event_kind == "observation"
        evidence_assessment = [
            (
                f"[{item.id}] {item.variable}：测量值 {item.observed:g} {item.unit}，"
                f"原始记录 {item.sample_count} 条；来源：{item.source}。"
                if is_observation
                else (
                    f"[{item.id}] {item.variable}：观测值 {item.observed:g} {item.unit}，"
                    f"基线 {item.baseline:g} {item.unit}，"
                    f"异常 {item.anomaly:+g}；数据源：{item.source}。"
                )
            )
            for item in event.evidence
        ]
        mechanism = [
            (
                f"{step.claim} {step.mechanism}"
                if is_observation
                else f"{step.claim}{step.mechanism} 证据：{', '.join(step.evidence_ids)}。"
            )
            for step in sorted(event.reasoning_chain, key=lambda item: item.order)
        ]
        radius_action = (
            f"以候选中心为圆心，在 {event.radius_km:g} 千米筛查搜索半径内补充邻近观测；该半径不代表影响范围。"
            if event.radius_basis == "screening_search"
            else f"优先在事件半径 {event.radius_km:g} 千米范围内开展现场采样。"
        )
        actions = (
            [
                f"数据源更新后，同步更新 {', '.join(event.variables)} 的测量值。",
                "只有通过质量检查的记录才会进入观测列表。",
                "如果数据达到异常筛查阈值，列表会另外标注为“异常”。",
            ]
            if is_observation
            else [
                f"在 24 小时内更新 {', '.join(event.variables)} 观测。",
                radius_action,
                "下一轮数据接入后重新运行识别流程，并比较置信度变化。",
            ]
        )
        area_text = (
            f"估算影响面积约 {event.affected_area_km2:,.0f} 平方千米。"
            if event.affected_area_km2 is not None
            else "当前证据不足以估算影响面积，暂不输出面积数值。"
        )
        situation = (
            f"位置：{event.region}。{VALIDATION_LABELS.get(event.validation_state, event.validation_state)}，"
            f"数据可信度为 {event.confidence:.0%}；同一数据集中有 {event.observation_count} 条相关记录。"
            if is_observation
            else (
                f"{event.region}事件当前状态为{STATUS_LABELS.get(event.status, event.status)}，"
                f"验证状态为{VALIDATION_LABELS.get(event.validation_state, event.validation_state)}，"
                f"严重度为 {event.severity:.0%}，置信度为 {event.confidence:.0%}。"
                f"{area_text}"
            )
        )
        return ScientificReport(
            event_id=event.id,
            title=f"{'观测记录' if is_observation else '科学研判'}：{event.title}",
            generated_at=datetime.now(UTC),
            confidence=event.confidence,
            executive_summary=event.summary,
            situation=situation,
            evidence_assessment=evidence_assessment,
            mechanism=mechanism,
            uncertainty=event.uncertainty,
            monitoring_actions=actions,
            evidence_ids=[item.id for item in event.evidence],
        )
