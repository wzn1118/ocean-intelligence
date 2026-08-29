from dataclasses import dataclass

import numpy as np

from app.models import DetectionRequest, EventType


@dataclass(frozen=True)
class Threshold:
    positive_event_type: EventType
    negative_event_type: EventType | None
    anomaly: float
    direction: int
    unit: str
    min_samples: int = 5
    min_consecutive: int = 3
    min_span_hours: float = 48.0


THRESHOLDS: dict[str, Threshold] = {
    "SST": Threshold(
        EventType.MARINE_HEATWAVE,
        EventType.COLD_ANOMALY,
        1.5,
        1,
        "degC",
        min_consecutive=5,
        min_span_hours=96.0,
    ),
    "SLA": Threshold(EventType.EDDY, EventType.EDDY, 0.18, 1, "m"),
    "CHLA": Threshold(EventType.PHYTOPLANKTON_BLOOM, None, 0.75, 1, "mg m-3"),
    "PCO2": Threshold(EventType.CARBON_ANOMALY, None, 35.0, 1, "uatm"),
    "CURRENT": Threshold(EventType.CURRENT_ANOMALY, None, 0.35, 1, "m s-1"),
}

UNIT_ALIASES: dict[str, set[str]] = {
    "SST": {"degC", "C", "°C"},
    "SLA": {"m", "meter", "metre"},
    "CHLA": {"mg m-3", "mg/m3"},
    "PCO2": {"uatm", "µatm", "μatm"},
    "CURRENT": {"m s-1", "m/s"},
}


def _reference_values(values: np.ndarray) -> np.ndarray:
    """Exclude the newest value so a single spike cannot inflate its own baseline."""
    return values[:-1] if values.size >= 4 else values


def robust_z_score(values: np.ndarray) -> float:
    if values.size == 0 or not np.isfinite(values).all():
        return 0.0
    reference = _reference_values(values)
    center = float(np.median(reference))
    mad = float(np.median(np.abs(reference - center)))
    if mad >= 1e-9:
        return float(0.6745 * (values[-1] - center) / mad)

    # IQR is a more stable fallback than the standard deviation for short series.
    q1, q3 = np.percentile(reference, [25, 75])
    iqr_scale = float(q3 - q1) / 1.349
    if iqr_scale >= 1e-9:
        return float((values[-1] - center) / iqr_scale)
    std = float(np.std(reference))
    return 0.0 if std < 1e-9 else float((values[-1] - center) / std)


def _trailing_consecutive_count(values: np.ndarray, threshold: float) -> int:
    count = 0
    for value in values[::-1]:
        if value >= threshold:
            count += 1
        else:
            break
    return count


def detect_anomaly(request: DetectionRequest) -> dict[str, object]:
    threshold = THRESHOLDS[request.variable]
    if request.unit is not None and request.unit not in UNIT_ALIASES[request.variable]:
        raise ValueError(
            f"unit {request.unit!r} is incompatible with {request.variable}; expected {threshold.unit}"
        )

    ordered = sorted(request.observations, key=lambda item: item.timestamp)
    observed = np.array([item.value for item in ordered], dtype=float)
    baseline = np.array([item.baseline for item in ordered], dtype=float)
    anomalies = observed - baseline
    if not np.isfinite(anomalies).all():
        raise ValueError("observation anomalies must be finite")

    current_anomaly = float(anomalies[-1])
    score = robust_z_score(anomalies)
    formal_upper = request.variable == "SST" and request.baseline_kind == "climatological_upper_threshold"
    formal_lower = request.variable == "SST" and request.baseline_kind == "climatological_lower_threshold"
    formal_climate_threshold = formal_upper or formal_lower
    if formal_upper:
        effective_direction = 1
    elif formal_lower:
        effective_direction = -1
    else:
        effective_direction = (
            -1 if threshold.negative_event_type is not None and current_anomaly < 0 else threshold.direction
        )
    directional = effective_direction * anomalies
    directional_current = effective_direction * current_anomaly
    detection_threshold = 1e-6 if formal_climate_threshold else threshold.anomaly
    persistence_threshold = detection_threshold if formal_climate_threshold else threshold.anomaly * 0.7
    persistence_count = _trailing_consecutive_count(directional, persistence_threshold)
    persistence_fraction = persistence_count / len(anomalies)
    temporal_span_hours = max(
        0.0,
        (ordered[-1].timestamp - ordered[0].timestamp).total_seconds() / 3600,
    )
    persistence_start = len(ordered) - persistence_count
    persistence_span_hours = (
        max(0.0, (ordered[-1].timestamp - ordered[persistence_start].timestamp).total_seconds() / 3600)
        if persistence_count > 0
        else 0.0
    )
    persistence_gaps = [
        (ordered[index].timestamp - ordered[index - 1].timestamp).total_seconds() / 3600
        for index in range(max(persistence_start + 1, 1), len(ordered))
    ]
    cadence_valid = request.variable != "SST" or (
        persistence_count >= threshold.min_consecutive
        and persistence_span_hours >= threshold.min_span_hours
        and all(12.0 <= gap <= 36.0 for gap in persistence_gaps)
    )
    has_history = len(anomalies) >= threshold.min_samples and temporal_span_hours >= threshold.min_span_hours
    detected = bool(
        directional_current >= detection_threshold
        and persistence_count >= threshold.min_consecutive
        and has_history
        and cadence_valid
    )

    if detected and request.variable == "SST" and not formal_climate_threshold:
        # A reference/spatial baseline can screen a temperature anomaly, but cannot
        # establish a marine heatwave without a documented daily percentile threshold.
        event_type = EventType.SURFACE_TEMPERATURE_ANOMALY
    elif detected and threshold.negative_event_type and effective_direction < 0:
        event_type = threshold.negative_event_type
    else:
        event_type = threshold.positive_event_type if detected else None

    raw_severity = float(np.clip(directional_current / (threshold.anomaly * 2.2), 0, 1))
    validation_state = (
        "corroborated"
        if detected and formal_climate_threshold
        else "screening"
    )
    severity = min(raw_severity, 0.85 if validation_state == "corroborated" else 0.69)
    history_factor = min(1.0, temporal_span_hours / 168.0)
    confidence = 0.34 + 0.22 * history_factor + 0.16 * min(1.0, persistence_fraction) + 0.08 * min(abs(score), 2.5) / 2.5
    confidence = float(np.clip(confidence, 0.0, 0.84 if validation_state == "corroborated" else 0.68))
    baseline_label = {
        "climatological_upper_threshold": "逐日历气候上分位阈值",
        "climatological_lower_threshold": "逐日历气候下分位阈值",
        "climatology": "气候基线",
        "reference_series": "参考序列",
        "spatial_screen": "空间筛查基线",
        "unspecified": "未说明基线",
    }[request.baseline_kind]
    rationale = (
        f"按时间排序后，最新 {request.variable} 异常为 {current_anomaly:+.2f} {request.unit or threshold.unit}；"
        f"连续 {persistence_count}/{len(anomalies)} 个样本满足方向阈值，"
        f"连续段跨度 {persistence_span_hours:.1f} 小时，总时间跨度 {temporal_span_hours:.1f} 小时。"
        f"使用{baseline_label}，采样节律{'有效' if cadence_valid else '不满足日尺度连续性'}，"
        + (
            "满足样本量、持续性和时间跨度条件。"
            if detected
            else "未同时满足样本量、持续性、时间跨度和幅度条件，因此不生成已确认事件。"
        )
    )
    return {
        "detected": detected,
        "event_type": event_type,
        "anomaly": round(current_anomaly, 3),
        "robust_z_score": round(score, 3),
        "severity": round(severity, 3),
        "confidence": round(confidence, 3),
        "rationale": rationale,
        "validation_state": validation_state,
        "baseline_kind": request.baseline_kind,
        "unit": request.unit or threshold.unit,
        "sample_count": len(anomalies),
        "persistence_count": persistence_count,
        "persistence_fraction": round(persistence_fraction, 3),
        "temporal_span_hours": round(temporal_span_hours, 3),
        "persistence_span_hours": round(persistence_span_hours, 3),
        "cadence_valid": cadence_valid,
    }
