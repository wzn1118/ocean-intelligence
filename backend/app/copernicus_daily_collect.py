"""Collect a fresh daily Copernicus-only event index from remote ARCO grids."""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from collections import Counter
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.copernicus_daily_index import DEFAULT_INDEX_PATH, publish_daily_index
from app.data.copernicus_arco_sampler import ArcoDataset, ArcoSampler, CURRENT_DATASET, WAVE_DATASET, WIND_DATASET
from app.data.marine_area_catalog import MARINE_AREA_CATALOG


BACKEND_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RAW_PATH = Path(os.getenv("COPERNICUS_DAILY_RAW_PATH", str(BACKEND_ROOT / ".cache" / "copernicus_daily_index" / "latest-points.json")))
DATASETS = (WIND_DATASET, WAVE_DATASET, CURRENT_DATASET)
GEOGRAPHY_RATIOS = {"china_mainland": 0.55, "taiwan_related": 0.10, "global": 0.35}


def category_quotas(target: int) -> dict[str, int]:
    base, remainder = divmod(target, 3)
    return {
        "wind": base + (1 if remainder >= 1 else 0),
        "wave": base + (1 if remainder >= 2 else 0),
        "current": base,
    }


def geography_quotas(target: int) -> dict[str, int]:
    mainland = round(target * GEOGRAPHY_RATIOS["china_mainland"])
    taiwan = round(target * GEOGRAPHY_RATIOS["taiwan_related"])
    return {"china_mainland": mainland, "taiwan_related": taiwan, "global": target - mainland - taiwan}


def collection_quotas(target: int) -> dict[str, dict[str, int]]:
    categories = category_quotas(target)
    geography_totals = geography_quotas(target)
    output = {category: {geography: 0 for geography in geography_totals} for category in categories}
    for geography, geography_total in geography_totals.items():
        exact = {
            category: geography_total * category_total / target
            for category, category_total in categories.items()
        }
        for category, value in exact.items():
            output[category][geography] = math.floor(value)
        remainder = geography_total - sum(output[category][geography] for category in categories)
        order = sorted(categories, key=lambda category: (exact[category] % 1, category == "wind"), reverse=True)
        for category in order[:remainder]:
            output[category][geography] += 1
    differences = {
        category: categories[category] - sum(output[category].values())
        for category in categories
    }
    while any(difference != 0 for difference in differences.values()):
        receiver = next(category for category, difference in differences.items() if difference > 0)
        donor = next(category for category, difference in differences.items() if difference < 0)
        geography = max(geography_totals, key=lambda name: output[donor][name])
        output[donor][geography] -= 1
        output[receiver][geography] += 1
        differences[donor] += 1
        differences[receiver] -= 1
    return output


def _finite(value: Any) -> float | None:
    if isinstance(value, (int, float)) and math.isfinite(value):
        return float(value)
    return None


def _point_in_polygon(longitude: float, latitude: float, polygon: list[tuple[float, float]]) -> bool:
    inside = False
    previous = polygon[-1]
    for current in polygon:
        x1, y1 = previous
        x2, y2 = current
        if (y1 > latitude) != (y2 > latitude):
            crossing = (x2 - x1) * (latitude - y1) / (y2 - y1) + x1
            if longitude < crossing:
                inside = not inside
        previous = current
    return inside


def _candidate(area: dict[str, Any], sequence: int) -> dict[str, Any]:
    center_longitude = float(area["center_longitude"])
    center_latitude = float(area["center_latitude"])
    polygon = area.get("polygon") or []
    angle = sequence * 2.399963229728653
    if polygon:
        longitudes = [float(point[0]) for point in polygon]
        latitudes = [float(point[1]) for point in polygon]
        longitude_radius = max(0.08, (max(longitudes) - min(longitudes)) * 0.60)
        latitude_radius = max(0.08, (max(latitudes) - min(latitudes)) * 0.60)
    else:
        radius_km = min(max(float(area.get("radius_km") or 120), 40), 650)
        latitude_radius = radius_km / 111.0
        longitude_radius = latitude_radius / max(0.25, math.cos(math.radians(center_latitude)))
    fraction = math.sqrt((sequence * 0.6180339887498949 + 0.17) % 1)
    longitude = center_longitude + math.cos(angle) * longitude_radius * fraction
    latitude = center_latitude + math.sin(angle) * latitude_radius * fraction
    if polygon and not _point_in_polygon(longitude, latitude, polygon):
        for shrink in (0.8, 0.6, 0.4, 0.2, 0.0):
            candidate_longitude = center_longitude + (longitude - center_longitude) * shrink
            candidate_latitude = center_latitude + (latitude - center_latitude) * shrink
            if shrink == 0.0 or _point_in_polygon(candidate_longitude, candidate_latitude, polygon):
                longitude = candidate_longitude
                latitude = candidate_latitude
                break
    return {"area": area, "longitude": longitude, "latitude": latitude, "candidate_sequence": sequence}


def build_candidates(geography: str, target: int, *, multiplier: int = 16) -> list[dict[str, Any]]:
    areas = [
        area for area in MARINE_AREA_CATALOG
        if area["geography"] == geography
        and area.get("center_longitude") is not None
        and area.get("center_latitude") is not None
    ]
    if not areas:
        return []
    candidates: list[dict[str, Any]] = []
    desired = max(target, target * multiplier)
    for index in range(desired):
        area = areas[index % len(areas)]
        candidates.append(_candidate(area, index // len(areas)))
    return candidates


def _severity(value: float, threshold: float) -> tuple[float, str]:
    score = min(1.0, max(0.05, value / max(threshold * 2, 0.001)))
    label = "critical" if score >= 0.85 else "high" if score >= 0.65 else "moderate" if score >= 0.35 else "low"
    return round(score, 4), label


def _direction(u_value: float, v_value: float, *, from_direction: bool) -> float:
    if from_direction:
        return (math.degrees(math.atan2(-u_value, -v_value)) + 360) % 360
    return (math.degrees(math.atan2(u_value, v_value)) + 360) % 360


def _event(sample: dict[str, Any], dataset: ArcoDataset, sequence: int) -> dict[str, Any]:
    area = sample["area"]
    values = sample["values"]
    evidence: list[dict[str, Any]] = []
    if dataset.category == "wind":
        eastward = float(values["eastward_wind"])
        northward = float(values["northward_wind"])
        speed = math.hypot(eastward, northward)
        direction = _direction(eastward, northward, from_direction=True)
        readings = (("WIND_SPEED", speed, "m s-1"), ("WIND_DIRECTION", direction, "degree"))
        threshold = 13.9
        title_variable = "风速"
    elif dataset.category == "wave":
        speed = float(values["VHM0"])
        readings = (("VHM0", speed, "m"), ("VTM02", float(values["VTM02"]), "s"), ("VMDR", float(values["VMDR"]), "degree"))
        threshold = 4.0
        title_variable = "海况"
    else:
        eastward = float(values["utotal"])
        northward = float(values["vtotal"])
        speed = math.hypot(eastward, northward)
        direction = _direction(eastward, northward, from_direction=False)
        readings = (("CURRENT_SPEED", speed, "m s-1"), ("CURRENT_DIRECTION", direction, "degree"))
        threshold = 1.5
        title_variable = "海流"
    is_anomaly = speed >= threshold
    severity, severity_label = _severity(speed, threshold)
    timestamp = str(sample["timestamp"])
    source = f"COPERNICUS_{dataset.category.upper()}"
    event_id = f"copernicus-daily-{dataset.category}-{sequence:05d}-{timestamp}".replace(":", "").replace("+", "")
    for variable, observed, unit in readings:
        is_primary = variable in {"WIND_SPEED", "VHM0", "CURRENT_SPEED"}
        evidence.append({
            "id": f"{event_id}-{variable.lower()}",
            "source": source,
            "variable": variable,
            "observed": round(observed, 5),
            "baseline": threshold if is_primary and is_anomaly else observed,
            "anomaly": round(observed - threshold, 5) if is_primary and is_anomaly else 0,
            "unit": unit,
            "timestamp": timestamp,
            "method": "Copernicus Marine ARCO latest-time grid sample; repeated remote chunks are downloaded once per dataset.",
            "confidence": 0.9,
            "series": [],
            "sample_count": 1,
            "temporal_span_hours": 0,
            "value_mode": "analysis",
            "validation_state": "screening" if is_anomaly else "observed",
        })
    longitude = float(sample["longitude"])
    latitude = float(sample["latitude"])
    return {
        "id": event_id,
        "type": f"{dataset.category}_anomaly" if is_anomaly else "surface_observation",
        "event_kind": "anomaly" if is_anomaly else "observation",
        "category": dataset.category,
        "title": f"{area['name']} {title_variable}{'异常' if is_anomaly else '观测'}",
        "summary": f"Copernicus Marine 在 {area['name']} 网格（{longitude:.3f}°, {latitude:.3f}°）生成一条{title_variable}综合记录。",
        "region": str(area["name"]),
        "centroid": [longitude, latitude],
        "radius_km": 10.0,
        "radius_basis": "observation_footprint",
        "started_at": timestamp,
        "status": "active" if is_anomaly else "watch",
        "severity": severity,
        "severity_label": severity_label,
        "confidence": 0.65 if is_anomaly else 0.9,
        "variables": [reading[0] for reading in readings],
        "sources": [source],
        "source_dataset_id": dataset.dataset_id,
        "marine_area_id": str(area["id"]),
        "geography": str(area["geography"]),
        "evidence": evidence,
        "reasoning_chain": [],
        "timeline": [{"timestamp": timestamp, "label": "Copernicus Marine 最新网格", "state": "detected" if is_anomaly else "observed"}],
        "potential_impacts": ["达到固定风险阈值，需结合相邻时次复核。"] if is_anomaly else [],
        "uncertainty": "单个原生网格代表该位置，不代表整个命名海域均一状态。",
        "region_id": "global_ocean",
        "data_mode": "live",
        "validation_state": "screening" if is_anomaly else "observed",
        "observation_count": 1,
        "source_updated_at": timestamp,
        "lifecycle_state": "detected" if is_anomaly else "monitoring",
        "first_detected_at": timestamp,
        "last_seen_at": timestamp,
        "lifecycle_revision": 1,
        "consecutive_updates": 1,
        "lifecycle_duration_hours": 0,
    }


def collect_category(
    dataset: ArcoDataset,
    target: int,
    *,
    request_timeout: int,
    quota: dict[str, int] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    started = time.monotonic()
    sampler = ArcoSampler(dataset, request_timeout=request_timeout)
    quota = quota or geography_quotas(target)
    events: list[dict[str, Any]] = []
    selected_coordinates: set[tuple[float, float]] = set()
    geography_counts: Counter[str] = Counter()
    candidates: list[dict[str, Any]] = []
    for geography in ("china_mainland", "taiwan_related", "global"):
        candidates.extend(build_candidates(geography, quota[geography]))
    samples, sample_metadata = sampler.sample(candidates)
    for geography in ("china_mainland", "taiwan_related", "global"):
        for sample in samples:
            if sample["area"]["geography"] != geography:
                continue
            coordinate = (
                round(float(sample["longitude"]), 6),
                round(float(sample["latitude"]), 6),
            )
            if coordinate in selected_coordinates:
                continue
            selected_coordinates.add(coordinate)
            events.append(_event(sample, dataset, len(events)))
            geography_counts[geography] += 1
            if geography_counts[geography] >= quota[geography]:
                break
        if geography_counts[geography] < quota[geography]:
            raise RuntimeError(
                f"{dataset.category} {geography} shortfall: {geography_counts[geography]}/{quota[geography]}"
            )
    return events, {
        "category": dataset.category,
        "dataset_id": dataset.dataset_id,
        "target": target,
        "total": len(events),
        "geography_counts": dict(geography_counts),
        "source_timestamp": sampler.timestamp.isoformat(),
        "remote_requests": sampler.requests,
        "bytes_downloaded": sampler.bytes_downloaded,
        "elapsed_seconds": round(time.monotonic() - started, 3),
        "sampling": sample_metadata,
    }


def collect_category_with_retries(
    dataset: ArcoDataset,
    target: int,
    *,
    request_timeout: int,
    quota: dict[str, int],
    attempts: int = 3,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    failures: list[str] = []
    for attempt in range(attempts):
        rotated_urls = dataset.base_urls[attempt % len(dataset.base_urls):] + dataset.base_urls[:attempt % len(dataset.base_urls)]
        attempt_dataset = replace(dataset, base_urls=rotated_urls)
        try:
            events, metadata = collect_category(
                attempt_dataset,
                target,
                request_timeout=request_timeout,
                quota=quota,
            )
            metadata["attempt"] = attempt + 1
            metadata["previous_failures"] = failures
            return events, metadata
        except Exception as error:  # noqa: BLE001
            failures.append(str(error)[:500])
            print(
                f"copernicus fresh collection: {dataset.category} attempt={attempt + 1} failed: {error}",
                file=sys.stderr,
                flush=True,
            )
    raise RuntimeError(f"{dataset.category} failed after {attempts} attempts: {failures}")


def run_collection(raw_path: Path, index_path: Path, *, target: int = 10000, request_timeout_seconds: int = 60) -> dict[str, Any]:
    started = time.monotonic()
    quotas = category_quotas(target)
    quotas_by_geography = collection_quotas(target)
    events: list[dict[str, Any]] = []
    collections: list[dict[str, Any]] = []
    for dataset in DATASETS:
        print(f"copernicus fresh collection: {dataset.category} target={quotas[dataset.category]}", file=sys.stderr, flush=True)
        category_events, metadata = collect_category_with_retries(
            dataset,
            quotas[dataset.category],
            request_timeout=request_timeout_seconds,
            quota=quotas_by_geography[dataset.category],
        )
        events.extend(category_events)
        collections.append(metadata)
        print(
            f"copernicus fresh collection: {dataset.category} complete={len(category_events)} "
            f"requests={metadata['remote_requests']} bytes={metadata['bytes_downloaded']}",
            file=sys.stderr,
            flush=True,
        )
    if len(events) != target:
        raise RuntimeError(f"Fresh Copernicus collection total mismatch: {len(events)}/{target}")
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = raw_path.with_name(f".{raw_path.name}.{os.getpid()}.tmp")
    saved_at = datetime.now(UTC)
    document = {
        "format_version": 2,
        "saved_at": saved_at.timestamp(),
        "bundle": {
            "events": events,
            "refreshed_at": saved_at.isoformat(),
            "collection": {
                "mode": "fresh_remote_arco",
                "category_quotas": quotas,
                "category_geography_quotas": quotas_by_geography,
                "categories": collections,
                "elapsed_seconds": round(time.monotonic() - started, 3),
            },
        },
    }
    try:
        temporary.write_text(json.dumps(document, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        temporary.replace(raw_path)
    finally:
        temporary.unlink(missing_ok=True)
    manifest = publish_daily_index(raw_path, index_path, target=target)
    return {
        **manifest,
        "category_quotas": quotas,
        "category_geography_quotas": quotas_by_geography,
        "category_counts": dict(Counter(event["category"] for event in events)),
        "collection": document["bundle"]["collection"],
        "raw_event_count": len(events),
        "elapsed_seconds": round(time.monotonic() - started, 3),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect and publish a fresh three-category Copernicus index.")
    parser.add_argument("--raw-path", type=Path, default=DEFAULT_RAW_PATH)
    parser.add_argument("--index-path", type=Path, default=DEFAULT_INDEX_PATH)
    parser.add_argument("--target", type=int, default=10000)
    parser.add_argument("--request-timeout", type=int, default=60)
    args = parser.parse_args()
    result = run_collection(
        args.raw_path,
        args.index_path,
        target=max(3, min(args.target, 10000)),
        request_timeout_seconds=max(15, min(args.request_timeout, 180)),
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["total"] == min(args.target, 10000) else 2


if __name__ == "__main__":
    raise SystemExit(main())
