import unittest

from app.data.ocean_statistics import calculate_ocean_statistics


class OceanStatisticsTests(unittest.TestCase):
    def test_weighted_summary_and_effective_sample_size(self) -> None:
        result = calculate_ocean_statistics({"operation": "weighted_summary", "values": [1, 3], "weights": [1, 3]})["results"]
        self.assertEqual(result["weighted_mean"], 2.5)
        self.assertAlmostEqual(result["effective_sample_size"], 1.6)

    def test_robust_trend_returns_window_tendency(self) -> None:
        result = calculate_ocean_statistics({"operation": "robust_trend", "values": [1, 2, 3, 4], "time_step_hours": 6})["results"]
        self.assertAlmostEqual(result["theil_sen_slope_per_hour"], 1 / 6)

    def test_vector_summary_distinguishes_scalar_and_vector_mean(self) -> None:
        result = calculate_ocean_statistics({"operation": "vector_summary", "eastward_values": [1, -1], "northward_values": [0, 0]})["results"]
        self.assertEqual(result["mean_vector_speed"], 0)
        self.assertEqual(result["mean_scalar_speed"], 1)

    def test_lag_correlation_finds_delayed_series(self) -> None:
        result = calculate_ocean_statistics({"operation": "lag_correlation", "x_values": [0, 1, 0, 3, 1, 5, 0, 2], "y_values": [4, 0, 1, 0, 3, 1, 5, 0], "maximum_lag": 2})["results"]
        self.assertEqual(result["best_absolute_correlation"]["lag_steps_y_after_x"], 1)

    def test_anomaly_detection_uses_robust_baseline(self) -> None:
        result = calculate_ocean_statistics({"operation": "anomaly_detection", "values": [1, 1.1, 0.9, 8], "baseline_values": [0.9, 1, 1.1, 1.05, 0.95]})["results"]
        self.assertEqual(result["candidate_count"], 1)


if __name__ == "__main__":
    unittest.main()
