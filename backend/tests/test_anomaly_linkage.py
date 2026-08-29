import unittest

from app.data.anomaly_linkage import analyze_anomaly_linkages


class AnomalyLinkageTests(unittest.TestCase):
    def test_ranks_candidates_and_builds_independent_linkage(self) -> None:
        result = analyze_anomaly_linkages({
            "candidates": [
                {"candidate_id": "A", "variable": "WIND_SPEED", "value": 20, "baseline_value": 8, "robust_z_score": 5, "percentile": 99, "persistence_hours": 12, "spatial_support_count": 8, "source_id": "grid-wind", "source_family": "copernicus", "longitude": 120, "latitude": 28, "valid_time": "2026-08-29T00:00:00Z", "zone": "东"},
                {"candidate_id": "B", "variable": "WIND_SPEED", "value": 10, "baseline_value": 8, "robust_z_score": 1, "percentile": 80, "longitude": 121, "latitude": 28, "valid_time": "2026-08-29T00:00:00Z", "zone": "中间"},
            ],
            "points": [
                {"id": "P1", "platform_id": "buoy-1", "platform_type": "浮标", "variable": "WIND_SPEED", "longitude": 120.05, "latitude": 28, "observed_at": "2026-08-29T01:00:00Z", "source_id": "buoy-feed", "source_family": "in_situ", "qc_passed": True},
            ],
            "core_radius_km": 25,
            "local_radius_km": 75,
            "background_radius_km": 150,
            "time_tolerance_hours": 6,
        })
        self.assertEqual(result["global_top_candidates"][0]["candidate_id"], "A")
        self.assertEqual(result["global_top_candidates"][0]["nearest_linkages"][0]["linkage_level"], "L1")
        self.assertEqual(result["direct_validation_candidate_count"], 1)
        self.assertEqual(result["zone_top_candidates"]["东"][0]["candidate_id"], "A")

    def test_same_source_is_not_independent_validation(self) -> None:
        result = analyze_anomaly_linkages({
            "candidates": [{"candidate_id": "A", "variable": "SST", "anomaly_value": 2, "longitude": 120, "latitude": 28, "valid_time": "2026-08-29T00:00:00Z", "source_family": "satellite"}],
            "points": [{"id": "P1", "variable": "SST", "longitude": 120, "latitude": 28, "observed_at": "2026-08-29T00:00:00Z", "source_family": "satellite"}],
        })
        linkage = result["global_top_candidates"][0]["nearest_linkages"][0]
        self.assertFalse(linkage["independent_source"])
        self.assertEqual(linkage["linkage_level"], "L2")

    def test_related_variable_receives_mechanism_support_level(self) -> None:
        result = analyze_anomaly_linkages({
            "candidates": [{"candidate_id": "A", "variable": "WAVE_HEIGHT", "anomaly_value": 2, "longitude": 120, "latitude": 28, "valid_time": "2026-08-29T00:00:00Z"}],
            "points": [{"id": "P1", "variable": "WIND_SPEED", "longitude": 120.1, "latitude": 28, "observed_at": "2026-08-29T02:00:00Z", "source_family": "in_situ"}],
        })
        self.assertEqual(result["global_top_candidates"][0]["nearest_linkages"][0]["linkage_level"], "L3")

    def test_rejects_invalid_radius_order(self) -> None:
        with self.assertRaisesRegex(ValueError, "radii"):
            analyze_anomaly_linkages({"candidates": [{"id": "A"}], "core_radius_km": 100, "local_radius_km": 50})

    def test_no_nearby_point_is_explicit_l5(self) -> None:
        result = analyze_anomaly_linkages({
            "candidates": [{"candidate_id": "A", "variable": "SST", "longitude": 120, "latitude": 28}],
            "points": [],
        })
        candidate = result["global_top_candidates"][0]
        self.assertEqual(candidate["linkage_counts"]["L5"], 1)
        self.assertEqual(result["linked_candidate_count"], 0)


if __name__ == "__main__":
    unittest.main()
