from __future__ import annotations

import json
from pathlib import Path

from app.copernicus_daily_index import index_status, publish_daily_index, read_event_page, select_daily_events
from app.data.marine_area_catalog import MARINE_AREA_CATALOG, locate_marine_area


def _event(event_id: str, longitude: float, latitude: float, *, kind: str = "observation", severity: float = 0.2) -> dict:
    return {
        "id": event_id,
        "type": "surface_observation" if kind == "observation" else "wave_anomaly",
        "event_kind": kind,
        "title": event_id,
        "summary": event_id,
        "region": "测试海域",
        "centroid": [longitude, latitude],
        "radius_km": 10.0,
        "radius_basis": "observation_footprint",
        "started_at": "2026-08-28T00:00:00Z",
        "status": "active",
        "severity": severity,
        "severity_label": "moderate",
        "confidence": 0.9,
        "variables": ["WAVE_HEIGHT"],
        "sources": ["COPERNICUS_MARINE"],
        "evidence": [{"variable": "WAVE_HEIGHT", "observed": 2.0, "anomaly": 0.5, "unit": "m"}],
        "reasoning_chain": [],
        "timeline": [],
        "potential_impacts": [],
        "uncertainty": "测试",
        "region_id": "global_ocean",
        "data_mode": "cached",
        "validation_state": "screening",
        "observation_count": 1,
    }


def test_catalogue_keeps_all_names_and_marks_missing_geometry() -> None:
    assert len(MARINE_AREA_CATALOG) >= 817
    assert sum(area["geometry_status"] == "polygon" for area in MARINE_AREA_CATALOG) >= 43
    assert sum(area["geometry_status"] == "missing" for area in MARINE_AREA_CATALOG) > 600
    assert locate_marine_area(113.5, 22.2)["geography"] == "china_mainland"
    assert locate_marine_area(121.8, 23.5)["geography"] == "taiwan_related"


def test_selection_prioritizes_real_anomalies_and_china() -> None:
    events = [
        _event("china-normal", 113.5, 22.2),
        _event("taiwan-normal", 121.8, 23.5),
        _event("global-normal", -90.0, 24.0),
        _event("global-anomaly", -90.0, 24.0, kind="anomaly", severity=0.9),
    ]
    events.append({**_event("not-copernicus", 113.5, 22.2), "sources": ["NOAA"]})
    selected = select_daily_events(events, target=3)
    ids = [row["event"]["id"] for row in selected]
    assert ids[0] == "global-anomaly"
    assert "china-normal" in ids
    assert "not-copernicus" not in ids


def test_publish_is_atomic_and_pageable(tmp_path: Path) -> None:
    source = tmp_path / "global_ocean.json"
    target = tmp_path / "active.sqlite3"
    events = [
        _event("china-normal", 113.5, 22.2),
        _event("global-anomaly", -90.0, 24.0, kind="anomaly", severity=0.9),
    ]
    source.write_text(json.dumps({"saved_at": 1, "bundle": {"events": events}}, ensure_ascii=False), encoding="utf-8")
    manifest = publish_daily_index(source, target, target=10)
    assert target.exists()
    assert not list(tmp_path.glob("*.tmp"))
    assert manifest["total"] == 2
    assert manifest["shortfall"] == 8
    assert index_status(target)["available"] is True
    first = read_event_page(cursor=0, limit=1, index_path=target)
    assert first["total"] == 2
    assert first["next_cursor"] == 1
    signals = read_event_page(cursor=0, limit=10, view="signals", index_path=target)
    assert [event["id"] for event in signals["events"]] == ["global-anomaly"]
