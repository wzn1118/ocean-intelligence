from __future__ import annotations

import unittest

from app.data.spatial_grid import build_nine_zone_grid, summarize_nine_zone_points


class NineZoneGridTests(unittest.TestCase):
    def test_beibu_gulf_center_and_zone_order(self) -> None:
        grid = build_nine_zone_grid(((105.5, 17.0), (110.65, 22.0)))

        self.assertEqual(grid["center"], {"longitude": 108.075, "latitude": 19.5})
        self.assertEqual(
            grid["zone_order"],
            ["西北", "北", "东北", "西", "中间", "东", "西南", "南", "东南"],
        )
        self.assertEqual(len(grid["zones"]), 9)
        self.assertEqual(grid["zones"][4]["name"], "中间")

    def test_antimeridian_zones_expose_split_query_bounds(self) -> None:
        grid = build_nine_zone_grid(((170.0, -15.0), (-170.0, 15.0)))

        self.assertTrue(grid["crosses_antimeridian"])
        self.assertEqual(grid["center"], {"longitude": 180.0, "latitude": 0.0})
        self.assertTrue(any(len(zone["query_bounds"]) == 2 for zone in grid["zones"]))

    def test_point_inventory_reconciles_counts_qc_and_unassigned_records(self) -> None:
        inventory = summarize_nine_zone_points(
            ((105.5, 17.0), (110.65, 22.0)),
            [
                {"platform_id": "argo-1", "platform_type": "Argo", "longitude": 106.0, "latitude": 21.0, "variable": "TEMP", "record_count": 10, "valid_record_count": 8, "observed_at": "2026-08-27T00:00:00Z"},
                {"platform_id": "argo-1", "platform_type": "Argo", "longitude": 106.1, "latitude": 21.1, "variable": "PSAL", "record_count": 5, "valid_record_count": 5, "observed_at": "2026-08-28T00:00:00Z"},
                {"platform_id": "buoy-1", "platform_type": "buoy", "longitude": 108.0, "latitude": 19.5, "variable": "WAVE_HEIGHT", "record_count": 4, "qc_passed": True},
                {"platform_id": "shore-1", "platform_type": "岸基站", "longitude": 110.2, "latitude": 17.5, "variable": "SST", "record_count": 3, "qc_passed": False},
                {"platform_id": "missing", "platform_type": "other", "longitude": None, "latitude": None, "record_count": 2},
                {"platform_id": "outside", "platform_type": "other", "longitude": 120.0, "latitude": 20.0, "record_count": 1},
            ],
            ocean_area_km2_by_zone={"西北": 20_000.0},
        )

        rows = {row["zone"]: row for row in inventory["zones"]}
        self.assertEqual(inventory["totals"]["raw_records"], 25)
        self.assertEqual(inventory["totals"]["assigned_raw_records"], 22)
        self.assertEqual(inventory["totals"]["assigned_valid_records"], 17)
        self.assertEqual(inventory["totals"]["unique_platforms"], 3)
        self.assertEqual(rows["西北"]["raw_records"], 15)
        self.assertEqual(rows["西北"]["unique_platforms"], 1)
        self.assertEqual(rows["西北"]["argo_platforms"], 1)
        self.assertEqual(rows["西北"]["point_density_per_10000_km2"], 0.5)
        self.assertEqual(rows["中间"]["buoy_platforms"], 1)
        self.assertEqual(rows["东南"]["valid_records"], 0)
        self.assertEqual(inventory["audit"]["qc_failed_records"], 5)
        self.assertEqual(inventory["audit"]["unassigned_records"], 3)
        self.assertEqual(inventory["audit"]["duplicate_platform_items"], 1)

    def test_incomplete_source_does_not_turn_empty_zones_into_verified_zero(self) -> None:
        inventory = summarize_nine_zone_points(
            ((100.0, 0.0), (109.0, 9.0)),
            [],
            source_complete=False,
            source_errors=["buoy source unavailable"],
        )

        self.assertTrue(all(row["count_semantics"] == "unknown_or_incomplete" for row in inventory["zones"]))


if __name__ == "__main__":
    unittest.main()
