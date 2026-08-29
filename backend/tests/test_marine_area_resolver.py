from __future__ import annotations

import unittest

from app.data.marine_area_resolver import resolve_marine_area


class MarineAreaResolverTests(unittest.TestCase):
    def test_recognizes_chinese_and_english_names_inside_free_text(self) -> None:
        chinese = resolve_marine_area(query="请生成地中海最近24小时风场报告")
        english = resolve_marine_area(query="Analyze Caribbean Sea waves")

        self.assertEqual(chinese["selected_by"], "text")
        self.assertEqual(chinese["selected"]["name"], "地中海")
        self.assertEqual(english["selected"]["name"], "加勒比海")

    def test_recognizes_the_marine_area_containing_a_point(self) -> None:
        result = resolve_marine_area(longitude=108.075, latitude=19.5)

        self.assertEqual(result["selected_by"], "point")
        self.assertEqual(result["selected"]["name"], "北部湾")
        self.assertEqual(result["selected"]["geometry_status"], "polygon")

    def test_text_takes_priority_and_reports_point_conflict(self) -> None:
        result = resolve_marine_area(query="分析地中海", longitude=108.075, latitude=19.5)

        self.assertEqual(result["selected"]["name"], "地中海")
        self.assertEqual(result["point_match"]["name"], "北部湾")
        self.assertTrue(result["text_point_conflict"])


if __name__ == "__main__":
    unittest.main()
