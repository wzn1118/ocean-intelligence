from __future__ import annotations

from datetime import datetime, timezone
import math
from typing import Any


EARTH_RADIUS_KM = 6371.0088
ZONE_ORDER = ("西北", "北", "东北", "西", "中间", "东", "西南", "南", "东南")
RELATED_VARIABLES = {
    "WIND_SPEED": {"WIND_DIRECTION", "WAVE_HEIGHT", "WIND_WAVE_HEIGHT", "SWELL_HEIGHT", "CURRENT", "SST", "TEMPERATURE"},
    "WAVE_HEIGHT": {"WIND_SPEED", "WIND_DIRECTION", "WIND_WAVE_HEIGHT", "SWELL_HEIGHT", "CURRENT", "WAVE_PERIOD", "WAVE_DIRECTION"},
    "WIND_WAVE_HEIGHT": {"WIND_SPEED", "WIND_DIRECTION", "WAVE_HEIGHT", "SWELL_HEIGHT", "CURRENT"},
    "SWELL_HEIGHT": {"WAVE_HEIGHT", "WIND_WAVE_HEIGHT", "WAVE_DIRECTION", "WAVE_PERIOD", "WIND_SPEED"},
    "SST": {"TEMPERATURE", "SALINITY", "CURRENT", "WIND_SPEED", "CHLA", "MIXED_LAYER_DEPTH"},
    "TEMPERATURE": {"SST", "SALINITY", "CURRENT", "WIND_SPEED", "CHLA", "MIXED_LAYER_DEPTH"},
    "SALINITY": {"TEMPERATURE", "SST", "CURRENT", "NITRATE", "CHLA"},
    "CHLA": {"SST", "TEMPERATURE", "SALINITY", "CURRENT", "NITRATE", "OXYGEN", "WIND_SPEED"},
    "CURRENT": {"WIND_SPEED", "WAVE_HEIGHT", "SST", "TEMPERATURE", "SALINITY", "CHLA"},
}


def _finite(value: Any, default: float | None = None) -> float | None:
    if value is None:
        return default
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def _time(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _haversine_km(lon_a: float, lat_a: float, lon_b: float, lat_b: float) -> float:
    lat_a_rad = math.radians(lat_a)
    lat_b_rad = math.radians(lat_b)
    delta_lat = lat_b_rad - lat_a_rad
    delta_lon = math.radians(lon_b - lon_a)
    haversine = math.sin(delta_lat / 2) ** 2 + math.cos(lat_a_rad) * math.cos(lat_b_rad) * math.sin(delta_lon / 2) ** 2
    return EARTH_RADIUS_KM * 2 * math.asin(min(1.0, math.sqrt(haversine)))


def _variable(value: Any) -> str:
    return str(value or "UNKNOWN").strip().upper()


def _anomaly_value(candidate: dict[str, Any]) -> float | None:
    explicit = _finite(candidate.get("anomaly_value"))
    if explicit is not None:
        return explicit
    value = _finite(candidate.get("value"))
    baseline = _finite(candidate.get("baseline_value"))
    return value - baseline if value is not None and baseline is not None else None


def _score(candidate: dict[str, Any]) -> dict[str, Any]:
    robust_z = abs(_finite(candidate.get("robust_z_score"), 0.0) or 0.0)
    percentile = _finite(candidate.get("percentile"), 50.0) or 50.0
    persistence = max(0.0, _finite(candidate.get("persistence_hours"), 0.0) or 0.0)
    spatial_support = max(0.0, _finite(candidate.get("spatial_support_count"), 0.0) or 0.0)
    source_agreement = max(0.0, _finite(candidate.get("source_agreement_count"), 0.0) or 0.0)
    qc_confidence = min(1.0, max(0.0, _finite(candidate.get("qc_confidence"), 1.0) or 0.0))
    latency = max(0.0, _finite(candidate.get("latency_hours"), 0.0) or 0.0)
    missing_fraction = min(1.0, max(0.0, _finite(candidate.get("missing_fraction"), 0.0) or 0.0))
    edge_penalty = min(1.0, max(0.0, _finite(candidate.get("edge_effect_penalty"), 0.0) or 0.0))
    components = {
        "robust_z": min(1.0, robust_z / 6.0),
        "percentile_tail": min(1.0, abs(percentile - 50.0) / 50.0),
        "persistence": min(1.0, persistence / 24.0),
        "spatial_coherence": min(1.0, spatial_support / 10.0),
        "source_agreement": min(1.0, source_agreement / 3.0),
        "qc_confidence": qc_confidence,
        "latency_penalty": min(1.0, latency / 72.0),
        "missingness_penalty": missing_fraction,
        "edge_effect_penalty": edge_penalty,
    }
    weights = {
        "robust_z": 0.25,
        "percentile_tail": 0.15,
        "persistence": 0.15,
        "spatial_coherence": 0.15,
        "source_agreement": 0.10,
        "qc_confidence": 0.20,
        "latency_penalty": 0.08,
        "missingness_penalty": 0.07,
        "edge_effect_penalty": 0.05,
    }
    positive = sum(components[name] * weights[name] for name in ("robust_z", "percentile_tail", "persistence", "spatial_coherence", "source_agreement", "qc_confidence"))
    penalty = sum(components[name] * weights[name] for name in ("latency_penalty", "missingness_penalty", "edge_effect_penalty"))
    return {
        "score": round(max(0.0, min(1.0, positive - penalty)) * 100, 3),
        "components": components,
        "weights": weights,
        "method": "weighted normalized evidence score; ranking aid, not calibrated event probability",
    }


def _independent(candidate: dict[str, Any], point: dict[str, Any]) -> bool:
    if point.get("is_independent") is False:
        return False
    candidate_family = str(candidate.get("source_family") or candidate.get("source_id") or "").strip().lower()
    point_family = str(point.get("source_family") or point.get("source_id") or "").strip().lower()
    if not candidate_family or not point_family or candidate_family == point_family:
        return False
    candidate_platform = str(candidate.get("platform_id") or "").strip().lower()
    point_platform = str(point.get("platform_id") or "").strip().lower()
    return not candidate_platform or not point_platform or candidate_platform != point_platform


def _linkage_level(
    *,
    same_variable: bool,
    related_variable: bool,
    independent: bool,
    distance_km: float,
    time_difference_hours: float | None,
    depth_difference_m: float | None,
    core_radius_km: float,
    local_radius_km: float,
    background_radius_km: float,
    time_tolerance_hours: float,
    depth_tolerance_m: float,
) -> tuple[str, str]:
    time_matches = time_difference_hours is not None and time_difference_hours <= time_tolerance_hours
    depth_matches = depth_difference_m is None or depth_difference_m <= depth_tolerance_m
    if same_variable and independent and distance_km <= core_radius_km and time_matches and depth_matches:
        return "L1", "同位置邻域、同期、同变量、独立来源，可用于直接验证"
    if same_variable and distance_km <= local_radius_km and time_matches and depth_matches:
        return "L2", "局地邻域、同期、同变量，可用于局地支持"
    if related_variable and distance_km <= local_radius_km and time_matches:
        return "L3", "局地邻域相关变量，可用于机制支持"
    if distance_km <= background_radius_km:
        return "L4", "空间或时间代表性不足，仅用于背景参照"
    return "L5", "超出背景邻域，当前不能形成有效联动"


def analyze_anomaly_linkages(arguments: dict[str, Any]) -> dict[str, Any]:
    candidates = list(arguments.get("candidates") or [])
    points = list(arguments.get("points") or [])
    if not candidates:
        raise ValueError("candidates must contain at least one anomaly candidate")
    core_radius = float(arguments.get("core_radius_km") or 25.0)
    local_radius = float(arguments.get("local_radius_km") or 75.0)
    background_radius = float(arguments.get("background_radius_km") or 150.0)
    time_tolerance = float(arguments.get("time_tolerance_hours") or 24.0)
    depth_tolerance = float(arguments.get("depth_tolerance_m") or 10.0)
    if not 0 < core_radius <= local_radius <= background_radius:
        raise ValueError("radii must satisfy 0 < core_radius_km <= local_radius_km <= background_radius_km")
    if time_tolerance <= 0 or depth_tolerance < 0:
        raise ValueError("time_tolerance_hours must be positive and depth_tolerance_m non-negative")

    ranked = []
    audit = {"candidate_count": len(candidates), "point_count": len(points), "invalid_candidate_coordinates": 0, "invalid_point_coordinates": 0, "invalid_candidate_times": 0, "invalid_point_times": 0}
    valid_points = []
    for point in points:
        lon = _finite(point.get("longitude"))
        lat = _finite(point.get("latitude"))
        if lon is None or lat is None or not -180 <= lon <= 180 or not -90 <= lat <= 90:
            audit["invalid_point_coordinates"] += 1
            continue
        observed_at = _time(point.get("observed_at") or point.get("valid_time"))
        if observed_at is None:
            audit["invalid_point_times"] += 1
        valid_points.append((point, lon, lat, observed_at))

    for index, candidate in enumerate(candidates):
        candidate_id = str(candidate.get("candidate_id") or candidate.get("id") or f"ANOM-{index + 1:04d}")
        lon = _finite(candidate.get("longitude"))
        lat = _finite(candidate.get("latitude"))
        candidate_time = _time(candidate.get("valid_time") or candidate.get("observed_at"))
        if lon is None or lat is None or not -180 <= lon <= 180 or not -90 <= lat <= 90:
            audit["invalid_candidate_coordinates"] += 1
            linkages = []
        else:
            if candidate_time is None:
                audit["invalid_candidate_times"] += 1
            candidate_variable = _variable(candidate.get("variable"))
            related = RELATED_VARIABLES.get(candidate_variable, set())
            linkages = []
            for point, point_lon, point_lat, point_time in valid_points:
                distance = _haversine_km(lon, lat, point_lon, point_lat)
                if distance > background_radius:
                    continue
                time_difference = abs((point_time - candidate_time).total_seconds()) / 3600 if point_time and candidate_time else None
                candidate_depth = _finite(candidate.get("depth"))
                point_depth = _finite(point.get("depth"))
                depth_difference = abs(point_depth - candidate_depth) if point_depth is not None and candidate_depth is not None else None
                point_variable = _variable(point.get("variable"))
                same_variable = point_variable == candidate_variable
                related_variable = point_variable in related or candidate_variable in RELATED_VARIABLES.get(point_variable, set())
                independent = _independent(candidate, point)
                level, rationale = _linkage_level(
                    same_variable=same_variable,
                    related_variable=related_variable,
                    independent=independent,
                    distance_km=distance,
                    time_difference_hours=time_difference,
                    depth_difference_m=depth_difference,
                    core_radius_km=core_radius,
                    local_radius_km=local_radius,
                    background_radius_km=background_radius,
                    time_tolerance_hours=time_tolerance,
                    depth_tolerance_m=depth_tolerance,
                )
                linkages.append({
                    "candidate_id": candidate_id,
                    "point_id": str(point.get("id") or point.get("platform_id") or "unknown"),
                    "platform_id": point.get("platform_id"),
                    "platform_type": point.get("platform_type"),
                    "variable": point_variable,
                    "distance_km": round(distance, 3),
                    "time_difference_hours": round(time_difference, 3) if time_difference is not None else None,
                    "depth_difference_m": round(depth_difference, 3) if depth_difference is not None else None,
                    "same_variable": same_variable,
                    "related_variable": related_variable,
                    "independent_source": independent,
                    "qc_passed": bool(point.get("qc_passed", True)),
                    "source_id": point.get("source_id"),
                    "linkage_level": level,
                    "rationale": rationale,
                })
            linkages.sort(key=lambda item: (item["linkage_level"], item["distance_km"], item["time_difference_hours"] if item["time_difference_hours"] is not None else math.inf))

        scoring = _score(candidate)
        anomaly = _anomaly_value(candidate)
        level_counts = {level: sum(item["linkage_level"] == level for item in linkages) for level in ("L1", "L2", "L3", "L4", "L5")}
        if not linkages:
            level_counts["L5"] = 1
        ranked.append({
            **candidate,
            "candidate_id": candidate_id,
            "variable": _variable(candidate.get("variable")),
            "anomaly_value": anomaly,
            "anomaly_sign": "positive" if anomaly is not None and anomaly > 0 else "negative" if anomaly is not None and anomaly < 0 else "unknown",
            "anomaly_score": scoring["score"],
            "score_components": scoring["components"],
            "linkage_counts": level_counts,
            "independent_validation_status": "supported" if level_counts["L1"] else "partial" if level_counts["L2"] or level_counts["L3"] else "none",
            "nearest_linkages": linkages[:20],
        })

    ranked.sort(key=lambda item: item["anomaly_score"], reverse=True)
    zone_rankings = {
        zone: [item for item in ranked if item.get("zone") == zone][:3]
        for zone in ZONE_ORDER
    }
    return {
        "method": {
            "ranking": "weighted robust anomaly evidence score with explicit penalties",
            "collocation": "great-circle distance plus absolute UTC time difference and optional depth difference",
            "radii_km": {"core": core_radius, "local": local_radius, "background": background_radius},
            "tolerances": {"time_hours": time_tolerance, "depth_m": depth_tolerance},
            "linkage_levels": {
                "L1": "direct independent validation candidate",
                "L2": "local same-variable support",
                "L3": "related-variable mechanism support",
                "L4": "background reference",
                "L5": "no effective linkage",
            },
        },
        "global_top_candidates": ranked[:10],
        "positive_top_candidates": [item for item in ranked if item["anomaly_sign"] == "positive"][:10],
        "negative_top_candidates": [item for item in ranked if item["anomaly_sign"] == "negative"][:10],
        "zone_top_candidates": zone_rankings,
        "candidate_count": len(ranked),
        "linked_candidate_count": sum(any(item["linkage_counts"][level] for level in ("L1", "L2", "L3")) for item in ranked),
        "direct_validation_candidate_count": sum(item["linkage_counts"]["L1"] > 0 for item in ranked),
        "audit": audit,
        "limitations": [
            "The score ranks evidence within the supplied candidate set and is not an event probability or official warning level.",
            "Distance, time and depth tolerances must match product resolution and process scales; sensitivity runs are required for consequential conclusions.",
            "L1 marks eligibility for independent comparison. Agreement, bias and uncertainty still require value-level analysis.",
        ],
    }
