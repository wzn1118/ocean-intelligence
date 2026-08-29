from app.models import OceanEvent


class OceanScienceReasoningAgent:
    """验证每项科学解释均关联到已知证据和文献。"""

    def validate(self, event: OceanEvent) -> OceanEvent:
        evidence_ids = {item.id for item in event.evidence}
        reference_ids = {item.id for item in event.references}
        if not event.evidence:
            raise ValueError("事件没有可追溯证据")
        if event.event_kind == "observation":
            if event.validation_state != "observed":
                raise ValueError("常态观测事件必须使用 observed 验证状态")
            if event.status == "active" or event.affected_area_km2 is not None:
                raise ValueError("常态观测事件不得标记为活动异常或估算影响面积")
            if any(abs(item.anomaly) > 1e-9 for item in event.evidence):
                raise ValueError("常态观测证据不得携带异常偏差")
        elif event.validation_state == "observed":
            raise ValueError("异常事件不得使用 observed 验证状态")
        if event.validation_state == "screening":
            if event.status == "active":
                raise ValueError("单时次筛查结果不得标记为活动事件")
            if event.affected_area_km2 is not None:
                raise ValueError("筛查结果没有足够证据估算影响面积")
            if event.confidence > 0.68:
                raise ValueError("筛查结果置信度超过证据上限")
        for step in event.reasoning_chain:
            if not step.evidence_ids:
                raise ValueError(f"研判步骤 {step.order} 未关联证据")
            unknown = set(step.evidence_ids) - evidence_ids
            if unknown:
                raise ValueError(f"发现未知证据 ID：{sorted(unknown)}")
            if not step.reference_ids:
                raise ValueError(f"研判步骤 {step.order} 未关联文献依据")
            unknown_references = set(step.reference_ids) - reference_ids
            if unknown_references:
                raise ValueError(f"发现未知文献 ID：{sorted(unknown_references)}")
        for evidence in event.evidence:
            if evidence.validation_state != event.validation_state:
                raise ValueError(f"证据 {evidence.id} 的验证状态与事件不一致")
        return event
