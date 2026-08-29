from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from urllib.parse import parse_qs, urlparse

import pytest

from app.data import argo_client


def test_nearest_argo_ranks_by_precise_spherical_distance(monkeypatch) -> None:
    floats = [
        {
            "platform": "FAR",
            "latest_profile_id": "FAR-1",
            "cycle": 1,
            "timestamp": "2026-08-20T00:00:00Z",
            "longitude": 121.0,
            "latitude": 20.0,
            "profile_count": 1,
            "networks": ["Core"],
            "has_bgc": False,
        },
        {
            "platform": "NEAR",
            "latest_profile_id": "NEAR-1",
            "cycle": 2,
            "timestamp": "2026-08-21T00:00:00Z",
            "longitude": 120.01,
            "latitude": 20.0,
            "profile_count": 1,
            "networks": ["BGC"],
            "has_bgc": True,
        },
    ]

    monkeypatch.setattr(
        argo_client,
        "get_argo_region",
        lambda **_: {"floats": floats, "float_count": len(floats)},
    )
    monkeypatch.setattr(
        argo_client,
        "_get_argo_float_from_region",
        lambda candidate, **_: {"platform": candidate["platform"]},
    )

    result = argo_client.get_nearest_argo(
        120.0,
        20.0,
        region_id="south_china_sea",
        region_name="南海",
    )

    assert result["query_point"] == (120.0, 20.0)
    assert result["nearest_platform"] == "NEAR"
    assert result["selected_platform"] == "NEAR"
    assert result["snapshot"]["platform"] == "NEAR"
    assert result["selected_distance_km"] == result["candidates"][0]["distance_km"]
    assert 1.04 < result["selected_distance_km"] < 1.05
    assert [item["platform"] for item in result["candidates"]] == ["NEAR", "FAR"]


def test_nearest_argo_allows_switching_to_another_ranked_float(monkeypatch) -> None:
    floats = [
        {
            "platform": platform,
            "latest_profile_id": f"{platform}-1",
            "cycle": index,
            "timestamp": "2026-08-21T00:00:00Z",
            "longitude": 120.0 + index,
            "latitude": 20.0,
            "profile_count": 1,
            "networks": ["Core"],
            "has_bgc": False,
        }
        for index, platform in enumerate(["A", "B", "C"])
    ]
    monkeypatch.setattr(
        argo_client,
        "get_argo_region",
        lambda **_: {"floats": floats, "float_count": len(floats)},
    )
    monkeypatch.setattr(
        argo_client,
        "_get_argo_float_from_region",
        lambda candidate, **_: {"platform": candidate["platform"]},
    )

    result = argo_client.get_nearest_argo(120.0, 20.0, platform="C")

    assert result["selected_platform"] == "C"
    assert result["nearest_platform"] == "A"
    assert result["nearest_distance_km"] == 0.0
    assert result["candidates"][0]["platform"] == "A"
    assert result["snapshot"]["platform"] == "C"
    assert result["selected_distance_km"] > 200


def test_haversine_uses_short_path_across_the_dateline() -> None:
    distance = argo_client._haversine_km(179.9, 10.0, -179.9, 10.0)  # noqa: SLF001

    assert 21.8 < distance < 22.0


def test_top_k_nearest_matches_full_precise_ranking() -> None:
    region = {
        "floats": [
            {
                "platform": str(index),
                "longitude": 100 + (index % 17) * 0.7,
                "latitude": -5 + (index % 23) * 0.5,
            }
            for index in range(250)
        ]
    }

    full = argo_client._rank_region_floats(region, 108.4, 2.3)  # noqa: SLF001
    top_k = argo_client._nearest_region_floats(region, 108.4, 2.3, 8)  # noqa: SLF001

    assert [item["platform"] for item in top_k] == [item["platform"] for item in full[:8]]
    assert [item["distance_km"] for item in top_k] == [item["distance_km"] for item in full[:8]]


def test_profile_request_preserves_all_argovis_qc_columns(monkeypatch) -> None:
    captured: dict[str, str] = {}

    def empty_response(endpoint: str) -> list[object]:
        captured["endpoint"] = endpoint
        return []

    monkeypatch.setattr(argo_client, "_get_json", empty_response)

    with pytest.raises(argo_client.ArgoDataError):
        argo_client._fetch_profile_snapshot(  # noqa: SLF001
            "5900001",
            "5900001_001",
            [],
            ["argo_bgc"],
            1,
            profile_scope="regional_window",
            profile_window_days=35,
        )

    query = parse_qs(urlparse(captured["endpoint"]).query)
    assert query["data"] == ["all"]


def test_uncached_platform_profiles_fetch_in_parallel(monkeypatch) -> None:
    barrier = Barrier(2)
    platforms = ("PARALLEL_A", "PARALLEL_B")

    def candidate(platform: str) -> dict[str, object]:
        return {
            "platform": platform,
            "latest_profile_id": f"{platform}_001",
            "cycle": 1,
            "timestamp": "2026-08-21T00:00:00Z",
            "longitude": 140.0,
            "latitude": 20.0,
            "profile_count": 1,
            "networks": ["argo_core"],
            "has_bgc": False,
        }

    def fetch(platform: str, *_args, **_kwargs) -> dict[str, object]:
        barrier.wait(timeout=2)
        return {"platform": platform, "latest": {"timestamp": "2026-08-21T00:00:00Z"}}

    monkeypatch.setattr(argo_client, "_fetch_profile_snapshot", fetch)
    with argo_client._cache_lock:  # noqa: SLF001
        for platform in platforms:
            argo_client._cache.pop(argo_client._profile_cache_key(platform, "regional_window"), None)  # noqa: SLF001

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(argo_client._get_argo_float_from_region, candidate(platform)) for platform in platforms]  # noqa: SLF001
        results = [future.result(timeout=3) for future in futures]

    assert {result["platform"] for result in results} == set(platforms)


def test_persisted_profile_is_reused_when_catalog_timestamp_is_unchanged(monkeypatch, tmp_path) -> None:
    platform = "5900001"
    timestamp = "2026-08-21T00:00:00Z"
    cache_key = argo_client._profile_cache_key(platform, "regional_window")  # noqa: SLF001
    snapshot = {"platform": platform, "latest": {"timestamp": timestamp}}
    monkeypatch.setattr(argo_client, "ARGO_PROFILE_CACHE_DIR", tmp_path)
    argo_client._persist_profile_cache(cache_key, snapshot)  # noqa: SLF001
    with argo_client._cache_lock:  # noqa: SLF001
        argo_client._cache.pop(cache_key, None)  # noqa: SLF001
    monkeypatch.setattr(
        argo_client,
        "_fetch_profile_snapshot",
        lambda *_args, **_kwargs: pytest.fail("validated persisted profile should avoid a remote fetch"),
    )

    result = argo_client._get_argo_float_from_region(  # noqa: SLF001
        {
            "platform": platform,
            "latest_profile_id": f"{platform}_001",
            "timestamp": timestamp,
            "cycle": 1,
            "longitude": 120.0,
            "latitude": 20.0,
            "networks": ["argo_core"],
            "profile_count": 1,
        }
    )

    assert result["platform"] == platform
    assert result["cache"]["state"] == "fresh"
    assert result["cache"]["ttl_seconds"] == argo_client.ARGO_PROFILE_CACHE_TTL_SECONDS


def test_recent_persisted_region_catalog_returns_stale_while_revalidating(monkeypatch) -> None:
    region_id = "persisted-probe-catalog"
    scheduled: list[str] = []
    snapshot = {
        "region_id": region_id,
        "floats": [{"platform": "5900001"}],
        "float_count": 1,
    }
    argo_client.prime_argo_region_cache(region_id, snapshot, age_seconds=600)
    monkeypatch.setattr(
        argo_client,
        "_schedule_region_revalidation",
        lambda requested_region, *_: scheduled.append(requested_region),
    )
    monkeypatch.setattr(
        argo_client,
        "_fetch_region",
        lambda *_args, **_kwargs: pytest.fail("stale catalog should return before the network scan"),
    )

    result = argo_client.get_argo_region(region_id=region_id)

    assert result["cache"]["state"] == "stale"
    assert result["floats"][0]["platform"] == "5900001"
    assert scheduled == [region_id]
    with argo_client._region_cache_lock:  # noqa: SLF001
        argo_client._region_cache.pop(region_id, None)  # noqa: SLF001
