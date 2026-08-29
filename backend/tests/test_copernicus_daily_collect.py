from app.copernicus_daily_collect import _event, category_quotas, collection_quotas
from app.data.copernicus_arco_sampler import CURRENT_DATASET, WAVE_DATASET, WIND_DATASET


AREA = {
    "id": "marine-test",
    "name": "测试海",
    "geography": "china_mainland",
}


def sample(values: dict[str, float]) -> dict[str, object]:
    return {
        "area": AREA,
        "longitude": 120.0,
        "latitude": 20.0,
        "timestamp": "2026-08-28T00:00:00+00:00",
        "values": values,
    }


def test_ten_thousand_category_and_geography_quotas() -> None:
    assert category_quotas(10000) == {"wind": 3334, "wave": 3333, "current": 3333}
    matrix = collection_quotas(10000)
    assert sum(matrix[category]["china_mainland"] for category in matrix) == 5500
    assert sum(matrix[category]["taiwan_related"] for category in matrix) == 1000
    assert sum(matrix[category]["global"] for category in matrix) == 3500
    assert {category: sum(matrix[category].values()) for category in matrix} == category_quotas(10000)


def test_wave_record_contains_combined_readings() -> None:
    event = _event(sample({"VHM0": 4.5, "VTM02": 7.2, "VMDR": 315.0}), WAVE_DATASET, 0)
    assert event["event_kind"] == "anomaly"
    assert event["variables"] == ["VHM0", "VTM02", "VMDR"]
    assert event["marine_area_id"] == "marine-test"


def test_wind_and_current_records_are_not_split() -> None:
    wind = _event(sample({"eastward_wind": 3.0, "northward_wind": 4.0}), WIND_DATASET, 0)
    current = _event(sample({"utotal": 0.3, "vtotal": 0.4}), CURRENT_DATASET, 0)
    assert wind["variables"] == ["WIND_SPEED", "WIND_DIRECTION"]
    assert current["variables"] == ["CURRENT_SPEED", "CURRENT_DIRECTION"]
