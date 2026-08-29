from __future__ import annotations

from datetime import UTC, datetime

from app import daily_briefing


def _bundle() -> dict:
    return {
        "events": [],
        "errors": [],
        "argo_region": {
            "lookback_days": 35,
            "profile_count": 3,
            "float_count": 2,
            "profiles": [
                {
                    "platform": "5900001",
                    "timestamp": "2026-08-27T23:30:00Z",
                    "has_bgc": True,
                },
                {
                    "platform": "5900002",
                    "timestamp": "2026-08-27T22:30:00Z",
                    "has_bgc": False,
                },
                {
                    "platform": "5900001",
                    "timestamp": "2026-08-26T22:00:00Z",
                    "has_bgc": True,
                },
            ],
        },
    }


def _copernicus() -> dict:
    return {
        "date": "2026-08-28",
        "dataset_count": 3,
        "record_count": 100,
        "value_count": 250,
        "latest_observation_at": "2026-08-28T00:00:00Z",
        "status": "live",
        "datasets": [
            {"is_current_day": True},
            {"is_current_day": True},
            {"is_current_day": False},
        ],
        "errors": [],
    }


def test_daily_briefing_generates_at_eight_and_publishes_at_nine(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(daily_briefing, "DAILY_BRIEF_CACHE_DIR", tmp_path)
    monkeypatch.setattr(daily_briefing, "DAILY_BRIEF_WEBHOOK_URL", "")
    monkeypatch.setattr(daily_briefing, "get_argo_region", lambda **_kwargs: _bundle()["argo_region"])
    monkeypatch.setattr(
        daily_briefing,
        "get_realtime_bundle",
        lambda *_args, **_kwargs: _bundle(),
    )
    monkeypatch.setattr(daily_briefing, "get_global_daily_data_volume", lambda **_kwargs: _copernicus())

    before_generation = datetime(2026, 8, 27, 23, 59, tzinfo=UTC)
    assert daily_briefing.run_daily_briefing_tick(before_generation) is None

    generated = daily_briefing.run_daily_briefing_tick(datetime(2026, 8, 28, 0, 0, tzinfo=UTC))
    assert generated is not None
    assert generated["status"] == "generated"
    assert generated["publish_at"] == "2026-08-28T01:00:00+00:00"
    assert generated["copernicus"]["record_count"] == 100
    assert generated["argo"]["profile_count"] == 2
    assert generated["argo"]["bgc_float_count"] == 1

    published = daily_briefing.run_daily_briefing_tick(datetime(2026, 8, 28, 1, 0, tzinfo=UTC))
    assert published is not None
    assert published["status"] == "published"
    assert published["delivery"]["in_app"] == "published"
    assert published["published_at"] == "2026-08-28T01:00:00+00:00"


def test_daily_briefing_uses_latest_available_argo_window(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(daily_briefing, "DAILY_BRIEF_CACHE_DIR", tmp_path)
    monkeypatch.setattr(daily_briefing, "get_argo_region", lambda **_kwargs: _bundle()["argo_region"])
    monkeypatch.setattr(daily_briefing, "get_realtime_bundle", lambda *_args, **_kwargs: _bundle())
    monkeypatch.setattr(daily_briefing, "get_global_daily_data_volume", lambda **_kwargs: _copernicus())

    generated = daily_briefing.generate_daily_briefing(datetime(2026, 8, 29, 0, 0, tzinfo=UTC))

    assert generated["argo"]["uses_latest_available_window"] is True
    assert generated["argo"]["profile_count"] == 2
    assert "最新可用24小时" in generated["summary"]
