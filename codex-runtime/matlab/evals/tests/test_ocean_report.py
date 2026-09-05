from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import zlib
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "build_ocean_report.py"
SPEC = importlib.util.spec_from_file_location("build_ocean_report", MODULE_PATH)
assert SPEC and SPEC.loader
ocean_report = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ocean_report)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def png_chunk(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)


def write_png(path: Path, width: int, height: int) -> None:
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    scanlines = b"".join(b"\x00" + b"\xff\xff\xff" * width for _ in range(height))
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", header)
        + png_chunk(b"IDAT", zlib.compress(scanlines))
        + png_chunk(b"IEND", b"")
    )


def write_pdf(path: Path, width: float, height: float) -> None:
    path.write_bytes(
        (
            "%PDF-1.4\n"
            "1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj\n"
            "2 0 obj <</Type /Pages /Count 1 /Kids [3 0 R]>> endobj\n"
            f"3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 {width:g} {height:g}]>> endobj\n"
            "trailer <</Root 1 0 R>>\n%%EOF\n"
        ).encode("ascii")
    )


def write_svg(path: Path, width: int, height: int) -> None:
    path.write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}"><title>fixture</title><rect width="100%" height="100%" fill="white"/></svg>',
        encoding="utf-8",
    )


class RuntimeBundle:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.release = "R2026a"
        self.writer_release = "2026a"
        self.figures = [
            ("crossed-time-depth-temperature", 24, 23, 1),
            ("paired-interactive", 6, 5, 1),
            ("paired-observation-model", 12, 11, 1),
            ("repeat-cast-salinity-profiles", 18, 17, 1),
        ]
        entries = [self._figure(identifier, raw, valid, missing) for identifier, raw, valid, missing in self.figures]
        self.manifest = {
            "schema_version": 2,
            "generated_at": "2026-09-05T12:00:00Z",
            "generator": "Ocean Intelligence MATLAB native assets",
            "runtime_status": "ready",
            "execution_verified": True,
            "matlab_release": self.writer_release,
            "export_formats": ["png", "pdf", "svg"],
            "artifact_validation": {"status": "passed", "verified_by": "test fixture"},
            "visual_inspection": {"status": "not_run", "verified": False},
            "figures": entries,
        }
        self.runtime = {
            "schema_version": 1,
            "nonce": "0123456789abcdef0123456789abcdef",
            "runtime": "MathWorks MATLAB",
            "success": True,
            "matlab_version": "26.1.0",
            "matlab_release": self.release,
            "jvm_available": True,
            "desktop_available": False,
            "batch_startup_option_used": True,
            "fixture_ids": sorted(ocean_report.EXPECTED_FIXTURES),
            "interaction": {
                "datatip_verified": True,
                "brush_stable_ids_verified": True,
                "headless_fallback_verified": True,
            },
            "manifest": "figures.json",
        }
        self.write_metadata()

    def _figure(self, identifier: str, raw: int, valid: int, missing: int) -> dict[str, object]:
        if identifier == "paired-interactive":
            title = "温度时间序列 / Temperature time series"
        else:
            fixture_path = ocean_report.DEFAULT_FIXTURE_DIRECTORY / ocean_report.EXPECTED_FIXTURES[identifier]
            title = json.loads(fixture_path.read_bytes())["title"]
        width = 12
        height = 7 if identifier != "paired-interactive" else 8
        pdf_width = width * 72 / 300
        pdf_height = height * 72 / 300
        exports: dict[str, dict[str, object]] = {}
        for format_name in ocean_report.REQUIRED_FORMATS:
            path = self.root / f"{identifier}.{format_name}"
            if format_name == "png":
                write_png(path, width, height)
                declared_width, declared_height = width, height
            elif format_name == "pdf":
                write_pdf(path, pdf_width, pdf_height)
                declared_width, declared_height = pdf_width, pdf_height
            else:
                write_svg(path, width, height)
                declared_width, declared_height = width, height
            exports[format_name] = {
                "figure_id": identifier,
                "title": title,
                "source": "synthetic fixture",
                "theme": "Ocean Intelligence",
                "file": path.name,
                "width": declared_width,
                "height": declared_height,
                "dpi": 300,
                "pages": 1,
                "bytes": path.stat().st_size,
                "sha256": sha256(path),
                "export_api": "exportgraphics",
            }
            if format_name == "svg":
                exports[format_name]["viewbox_width"] = width
                exports[format_name]["viewbox_height"] = height
        unit = "g kg-1" if "salinity" in identifier else "degC"
        shape: int | list[int]
        if identifier == "crossed-time-depth-temperature":
            shape = [4, 6]
        elif identifier == "repeat-cast-salinity-profiles":
            shape = [6, 3]
        else:
            shape = raw
        dimensions = ["depth", "time"] if isinstance(shape, list) else ["time" if identifier == "paired-interactive" else "observation"]
        shape_values = shape if isinstance(shape, list) else [shape]
        coordinates = {
            name: {"count": count, "unit": {"depth": "m", "time": "datetime", "observation": "1"}[name],
                   "direction": "positive_down" if name == "depth" else "increasing"}
            for name, count in zip(dimensions, shape_values)
        }
        if "time" in coordinates:
            coordinates["time"]["timezone"] = "UTC"
        return {
            "id": identifier,
            "title": title,
            "source": "synthetic fixture",
            "theme": "Ocean Intelligence",
            "runtime": {"matlab_release": self.writer_release},
            "scientific_data_contract": {
                "schemaVersion": 1,
                "provided": True,
                "required": True,
                "dataType": "synthetic_fixture",
                "shape": shape,
                "rank": len(dimensions),
                "dimensionOrder": dimensions if len(dimensions) > 1 else dimensions[0],
                "observationDimension": dimensions[0],
                "coordinates": coordinates,
                **({"timeZone": "UTC"} if "time" in coordinates else {}),
                "units": {"value": unit},
                "missing": {
                    "status": "present",
                    "policy": "preserve",
                    "representation": "NaN",
                    "masked_count": 0,
                    "total_count": raw,
                    "valid_count": valid,
                    "missing_count": missing,
                },
                "qc": {"status": "present", "action": "preserve"},
                "uncertainty": {"status": "present"},
            },
            "exports": exports,
        }

    def write_metadata(self) -> None:
        (self.root / "figures.json").write_text(json.dumps(self.manifest), encoding="utf-8")
        (self.root / "matlab-runtime.json").write_text(json.dumps(self.runtime), encoding="utf-8")

    def capture_input_fixtures(self, fixture_directory: Path = ocean_report.DEFAULT_FIXTURE_DIRECTORY) -> None:
        (self.root / "fixture-inputs").mkdir()
        inputs = []
        for identifier, source_file in ocean_report.EXPECTED_FIXTURES.items():
            content = (fixture_directory / source_file).read_bytes()
            relative = f"fixture-inputs/{source_file}"
            with (self.root / relative).open("xb") as handle:
                handle.write(content)
            inputs.append({
                "id": identifier, "file": relative, "source_file": source_file,
                "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest(),
            })
        self.runtime["input_fixtures"] = inputs
        self.write_metadata()

    def record_layout_measurement(self, identifier: str, unmeasured: list[dict] | dict) -> None:
        figure = next(item for item in self.manifest["figures"] if item["id"] == identifier)
        count = 1 if isinstance(unmeasured, dict) else len(unmeasured)
        figure["text_objects"] = {
            "role": "title", "string": figure["title"], "bounds": [0.2, 0.8, 0.6, 0.1],
            "bounds_units": "normalized", "clipped": False,
        }
        figure["axes_objects"] = {"bounds": [0.1, 0.1, 0.8, 0.7], "bounds_units": "normalized"}
        figure["unmeasured_text_objects"] = unmeasured
        figure["rendering_evidence"] = {
            "bounds_audited": True, "bounds_audit_scope": "measured_objects_only",
            "bounds_audit_complete": count == 0, "unmeasured_count": count,
            "clipped_count": 0, "text_overlap_count": 0,
            "font_selection_verified": True, "visual_inspection_verified": False,
            "cjk_font_evidence": {"candidate_verified": True, "glyph_rendering_verified": False},
        }
        figure["publication"] = {"layout": {"stable": count == 0}}


class OceanReportTests(unittest.TestCase):
    def fixture_payload(self, identifier: str) -> dict[str, object]:
        path = ocean_report.DEFAULT_FIXTURE_DIRECTORY / ocean_report.EXPECTED_FIXTURES[identifier]
        return json.loads(path.read_bytes())

    def unmeasured_layout_text(self, role: str = "layout.title", text: str = "合成基准总标题") -> dict:
        return {
            "role": role, "string": text, "font_name": "Noto Sans CJK SC", "font_size": 12,
            "class": "matlab.graphics.layout.Text", "geometry_status": "unverified",
        }

    def test_reports_each_figures_layout_coverage_without_visual_promotion(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            bundle.capture_input_fixtures()
            single = self.unmeasured_layout_text()
            multiple = [self.unmeasured_layout_text(), self.unmeasured_layout_text("layout.xlabel", "时间 UTC")]
            bundle.record_layout_measurement("crossed-time-depth-temperature", [])
            bundle.record_layout_measurement("paired-interactive", single)
            bundle.record_layout_measurement("paired-observation-model", multiple)
            bundle.write_metadata()

            ocean_report.build_ocean_report(root)

            evidence = json.loads((root / "report-evidence.json").read_bytes())
            figures = {figure["id"]: figure for figure in evidence["runtime_evidence"]["figures"]}
            self.assertEqual(evidence["runtime_fixture_binding"]["status"], "verified")
            complete = figures["crossed-time-depth-temperature"]["layout_measurement"]
            self.assertEqual(complete["status"], "available")
            self.assertTrue(complete["bounds_audit_complete"])
            self.assertEqual(complete["unmeasured_count"], 0)
            self.assertEqual(complete["unmeasured_text_objects"], [])
            self.assertEqual(complete["measured_text_count"], 1)
            self.assertEqual(complete["measured_axes_count"], 1)
            for identifier, expected in (("paired-interactive", [single]), ("paired-observation-model", multiple)):
                coverage = figures[identifier]["layout_measurement"]
                self.assertEqual(coverage["bounds_audit_scope"], "measured_objects_only")
                self.assertFalse(coverage["bounds_audit_complete"])
                self.assertFalse(coverage["layout_stable_declared"])
                self.assertEqual(coverage["unmeasured_count"], len(expected))
                self.assertEqual(coverage["unmeasured_text_objects"], expected)
                self.assertNotIn("bounds", coverage["unmeasured_text_objects"][0])
            missing = figures["repeat-cast-salinity-profiles"]["layout_measurement"]
            self.assertEqual(missing["status"], "not_available")
            self.assertIsNone(missing["unmeasured_count"])
            self.assertIsNone(missing["unmeasured_text_objects"])
            for figure in figures.values():
                self.assertEqual(figure["verification"], {
                    "file_hashes_and_dimensions": "passed", "visual_inspection": "not_verified",
                    "glyph_rendering": "not_verified", "layout_visual": "not_verified",
                })
                self.assertEqual(figure["scientific_data"]["qc"]["plot_filtering"], "not_verified")
            report = (root / "report.md").read_text(encoding="utf-8")
            table = report.split("### 布局测量覆盖")[1].split("## 8.")[0]
            self.assertEqual(report.count("### 布局测量覆盖"), 1)
            for identifier in figures:
                self.assertEqual(table.count(f"`{identifier}`"), 1)
            self.assertIn("仅已测对象；清单完整；未测 0", table)
            self.assertIn("仅已测对象；清单不完整；未测 1", table)
            self.assertIn("仅已测对象；清单不完整；未测 2", table)
            self.assertIn("layout.title: 合成基准总标题", table)
            self.assertIn("layout.xlabel: 时间 UTC", table)
            self.assertIn("未提供（not_available）", table)
            self.assertIn("无公开 Extent", table)
            self.assertIn("均不等于视觉、字形或布局外观通过", table)
            self.assertIn("数据来源=合成基准非实测海况", report)

    def test_legacy_layout_flags_do_not_supply_missing_measurement_coverage(self) -> None:
        for flags in ({}, {"bounds_audited": True}):
            with self.subTest(flags=flags), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                for figure in bundle.manifest["figures"]:
                    figure["rendering_evidence"] = flags
                    figure["publication"] = {"layout": {"stable": True}}
                bundle.write_metadata()
                ocean_report.build_ocean_report(root)
                evidence = json.loads((root / "report-evidence.json").read_bytes())
                self.assertEqual(evidence["runtime_fixture_binding"]["status"], "unverified")
                for figure in evidence["runtime_evidence"]["figures"]:
                    coverage = figure["layout_measurement"]
                    self.assertEqual(coverage["status"], "not_available")
                    self.assertEqual(coverage["bounds_audit_scope"], "not_available")
                    for field in ("bounds_audit_complete", "unmeasured_count", "unmeasured_text_objects"):
                        self.assertIsNone(coverage[field])
                    self.assertEqual(figure["verification"]["layout_visual"], "not_verified")
                report = (root / "report.md").read_text(encoding="utf-8")
                self.assertEqual(report.count("未提供（not_available）"), 4)
                self.assertNotIn("无未测记录", report)

    def test_incomplete_new_layout_field_groups_fail_without_outputs(self) -> None:
        for field in ("unmeasured_text_objects", "bounds_audit_scope", "bounds_audit_complete", "unmeasured_count"):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                bundle.record_layout_measurement("paired-interactive", self.unmeasured_layout_text())
                figure = next(item for item in bundle.manifest["figures"] if item["id"] == "paired-interactive")
                if field == "unmeasured_text_objects":
                    del figure[field]
                else:
                    del figure["rendering_evidence"][field]
                bundle.write_metadata()
                with self.assertRaisesRegex(ocean_report.ReportBuildError, "layout measurement fields are incomplete"):
                    ocean_report.build_ocean_report(root)
                self.assertFalse((root / "report.md").exists())
                self.assertFalse((root / "report-evidence.json").exists())

    def test_layout_completeness_count_and_stable_contradictions_fail(self) -> None:
        changes = (
            lambda figure: figure["rendering_evidence"].update(bounds_audit_complete=True),
            lambda figure: figure["rendering_evidence"].update(unmeasured_count=0),
            lambda figure: figure["rendering_evidence"].update(unmeasured_count=2),
            lambda figure: figure.update(unmeasured_text_objects=[]),
            lambda figure: figure["publication"]["layout"].update(stable=True),
            lambda figure: figure["rendering_evidence"].update(bounds_audited=False),
        )
        for index, change in enumerate(changes):
            with self.subTest(change=index), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                bundle.record_layout_measurement("paired-interactive", self.unmeasured_layout_text())
                figure = next(item for item in bundle.manifest["figures"] if item["id"] == "paired-interactive")
                change(figure)
                bundle.write_metadata()
                with self.assertRaises(ocean_report.ReportBuildError):
                    ocean_report.build_ocean_report(root)
                self.assertFalse((root / "report.md").exists())
                self.assertFalse((root / "report-evidence.json").exists())

    def test_layout_flags_counts_and_container_shapes_are_strict(self) -> None:
        changes = [
            lambda figure: figure.update(rendering_evidence=[]),
            lambda figure: figure.update(publication=[]),
            lambda figure: figure["publication"].update(layout=[]),
            lambda figure: figure["publication"]["layout"].update(stable="false"),
            lambda figure: figure.update(text_objects=[[]]),
            lambda figure: figure.update(axes_objects="axes"),
        ]
        for field, invalid in (
            ("bounds_audit_scope", "whole_canvas"), ("bounds_audit_scope", ["measured_objects_only"]),
            ("bounds_audit_complete", 1), ("bounds_audit_complete", "false"),
            ("bounds_audited", 1), ("unmeasured_count", -1), ("unmeasured_count", True),
            ("unmeasured_count", 1.0), ("unmeasured_count", "1"), ("unmeasured_count", None),
            ("clipped_count", -1), ("text_overlap_count", True),
        ):
            changes.append(lambda figure, field=field, invalid=invalid: figure["rendering_evidence"].update({field: invalid}))
        for index, change in enumerate(changes):
            with self.subTest(change=index), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                bundle.record_layout_measurement("paired-interactive", self.unmeasured_layout_text())
                figure = next(item for item in bundle.manifest["figures"] if item["id"] == "paired-interactive")
                change(figure)
                bundle.write_metadata()
                with self.assertRaises(ocean_report.ReportBuildError):
                    ocean_report.build_ocean_report(root)

    def test_unmeasured_text_rejects_fake_geometry_and_invalid_identity(self) -> None:
        mutations = (
            ("geometry_status", "verified"), ("bounds", [0, 0, 1, 1]), ("geometry_verified", True),
            ("class", "matlab.graphics.primitive.Text"), ("role", "title"),
            ("string", " "), ("string", ["title"]), ("font_name", None),
            ("font_size", 0), ("font_size", -1), ("font_size", True), ("font_size", "12"),
        )
        for field, value in mutations:
            with self.subTest(field=field, value=value), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                record = self.unmeasured_layout_text()
                record[field] = value
                bundle.record_layout_measurement("paired-interactive", record)
                bundle.write_metadata()
                with self.assertRaises(ocean_report.ReportBuildError):
                    ocean_report.build_ocean_report(root)
                self.assertFalse((root / "report.md").exists())

    def test_unmeasured_text_list_must_be_flat_and_complete(self) -> None:
        missing_font = self.unmeasured_layout_text()
        del missing_font["font_name"]
        for invalid in (None, {}, "title", [None], [[]], [[self.unmeasured_layout_text()]], missing_font):
            with self.subTest(invalid=invalid), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                bundle.record_layout_measurement("paired-interactive", self.unmeasured_layout_text())
                figure = next(item for item in bundle.manifest["figures"] if item["id"] == "paired-interactive")
                figure["unmeasured_text_objects"] = invalid
                bundle.write_metadata()
                with self.assertRaises(ocean_report.ReportBuildError):
                    ocean_report.build_ocean_report(root)

    def test_unmeasured_titles_cannot_break_markdown_table(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            title = "合成 | 标题\n[visual passed](fake) <b>字形</b>"
            bundle.record_layout_measurement("paired-interactive", self.unmeasured_layout_text(text=title))
            bundle.write_metadata()
            ocean_report.build_ocean_report(root)
            evidence = json.loads((root / "report-evidence.json").read_bytes())
            figure = next(item for item in evidence["runtime_evidence"]["figures"] if item["id"] == "paired-interactive")
            self.assertEqual(figure["layout_measurement"]["unmeasured_text_objects"][0]["string"], title)
            report = (root / "report.md").read_text(encoding="utf-8")
            self.assertIn("合成 \\| 标题 \\[visual passed\\](fake) &lt;b&gt;字形&lt;/b&gt;", report)
            self.assertNotIn("[visual passed](fake)", report)
            self.assertEqual(figure["verification"]["visual_inspection"], "not_verified")

    def test_fixture_statistics_match_known_values_and_sampling_scope(self) -> None:
        fixtures, contexts = ocean_report.load_fixture_statistics(ocean_report.DEFAULT_FIXTURE_DIRECTORY)
        by_id = {item["id"]: item for item in fixtures}
        temperature = by_id["crossed-time-depth-temperature"]
        salinity = by_id["repeat-cast-salinity-profiles"]
        paired = by_id["paired-observation-model"]
        self.assertAlmostEqual(temperature["statistics"]["mean"], 359.794 / 23)
        self.assertEqual(temperature["qc"], {"good": 22, "suspect": 1, "missing": 1})
        self.assertEqual(temperature["missing_indices_depth_time"], [[2, 2]])
        self.assertEqual(salinity["qc"], {"good": 16, "suspect": 1, "missing": 1})
        self.assertAlmostEqual(salinity["statistics"]["mean"], 566.81 / 17)
        self.assertAlmostEqual(paired["statistics"]["bias_model_minus_observation"], 0.96 / 11)
        self.assertAlmostEqual(paired["statistics"]["mean_absolute_error"], 1.02 / 11)
        self.assertAlmostEqual(paired["statistics"]["root_mean_square_error"], math.sqrt(0.137 / 11))
        self.assertAlmostEqual(paired["statistics"]["pearson_correlation"], 0.9996003539344701)
        self.assertEqual(paired["statistics"]["within_standard_uncertainty_count"], 8)
        self.assertEqual(paired["pairing"]["missing_ids"], ["pair-012"])
        self.assertIn("pair-006", paired["pairing"]["valid_ids"])
        self.assertEqual(paired["pairing"]["model_missing_ids"], [])
        interactive = contexts["paired-interactive"]
        self.assertEqual(interactive["fixture_id"], temperature["id"])
        self.assertEqual(interactive["selection"], {"kind": "depth_row", "index_zero_based": 2, "depth_m": 50})
        self.assertAlmostEqual(interactive["statistics"]["mean"], 14.6288)
        self.assertEqual(interactive["qc"], {"good": 4, "suspect": 1, "missing": 1})
        self.assertEqual(interactive["missing_time_indices"], [2])
        self.assertEqual(interactive["observation_ids"][2], "temp-050m-003")

    def test_manifest_scientific_mismatches_fail_before_report_write(self) -> None:
        changes = [
            ("unit", lambda contract: contract["units"].update(value="K")),
            ("transposed shape", lambda contract: contract.update(shape=[6, 4])),
            ("axis order", lambda contract: contract.update(dimensionOrder=["time", "depth"])),
            ("rank", lambda contract: contract.update(rank=1)),
            ("observation dimension", lambda contract: contract.update(observationDimension="time")),
            ("time zone", lambda contract: contract["coordinates"]["time"].update(timezone="Asia/Shanghai")),
            ("coordinate count", lambda contract: contract["coordinates"]["time"].update(count=5)),
            ("depth unit", lambda contract: contract["coordinates"]["depth"].update(unit="km")),
            ("depth direction", lambda contract: contract["coordinates"]["depth"].update(direction="positive_up")),
            ("missing", lambda contract: contract["missing"].update(missing_count=0, valid_count=24)),
            ("mask", lambda contract: contract["missing"].update(masked_count=1)),
            ("QC", lambda contract: contract["qc"].update(action="filter")),
        ]
        for label, change in changes:
            with self.subTest(label=label), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                change(bundle.manifest["figures"][0]["scientific_data_contract"])
                bundle.write_metadata()
                with self.assertRaises(ocean_report.ReportBuildError):
                    ocean_report.build_ocean_report(root)
                self.assertFalse((root / "report.md").exists())

    def test_grid_axis_policy_unit_design_and_mask_mismatches_are_rejected(self) -> None:
        changes = [
            lambda payload: payload["variables"]["temperature"].update(dimension_order=["time", "depth"]),
            lambda payload: payload["variables"]["qc"].update(policy="drop_suspect"),
            lambda payload: payload["variables"]["temperature"].update(missing_policy="fill_zero"),
            lambda payload: payload["variables"]["temperature"].update(unit="K"),
            lambda payload: payload["design"].update(expected_pair_count=23),
            lambda payload: payload["coordinates"].update(latitude={"values": [30]}),
            lambda payload: payload["coordinates"]["depth"]["values"].__setitem__(0, float("nan")),
            lambda payload: payload["variables"]["temperature_standard_uncertainty"]["values"][0].__setitem__(0, None),
            lambda payload: payload["variables"]["qc"]["values"][0].__setitem__(0, "missing"),
        ]
        for index, change in enumerate(changes):
            with self.subTest(index=index):
                payload = self.fixture_payload("crossed-time-depth-temperature")
                change(payload)
                with self.assertRaises(ocean_report.ReportBuildError):
                    ocean_report.summarize_grid_fixture(payload, "temperature.json")

    def test_duplicate_time_depth_pair_with_unique_id_is_rejected(self) -> None:
        payload = self.fixture_payload("paired-observation-model")
        payload["records"][1]["depth_m"] = payload["records"][0]["depth_m"]
        with self.assertRaisesRegex(ocean_report.ReportBuildError, "duplicate time/depth"):
            ocean_report.summarize_paired_fixture(payload, "paired.json")

    def test_paired_model_only_missing_uses_same_complete_pair_mask(self) -> None:
        payload = self.fixture_payload("paired-observation-model")
        payload["records"][0]["model_degC"] = None
        summary = ocean_report.summarize_paired_fixture(payload, "paired.json")
        self.assertEqual(summary["counts"], {"raw_count": 12, "valid_count": 10, "missing_count": 2})
        self.assertEqual(summary["pairing"]["model_missing_ids"], ["pair-001"])
        self.assertEqual(summary["pairing"]["observation_missing_ids"], ["pair-012"])
        self.assertAlmostEqual(summary["statistics"]["bias_model_minus_observation"], 0.088)
        self.assertAlmostEqual(summary["statistics"]["model_mean"], 15.681)
        self.assertAlmostEqual(summary["statistics"]["observation_mean"], 15.593)

    def test_missing_observation_does_not_hide_invalid_model(self) -> None:
        for model in ("invalid", True, float("inf"), float("nan")):
            with self.subTest(model=model):
                payload = self.fixture_payload("paired-observation-model")
                payload["records"][-1]["model_degC"] = model
                with self.assertRaisesRegex(ocean_report.ReportBuildError, "paired model"):
                    ocean_report.summarize_paired_fixture(payload, "paired.json")

    def test_finite_observation_cannot_have_missing_qc(self) -> None:
        payload = self.fixture_payload("paired-observation-model")
        payload["records"][0]["qc"] = "missing"
        with self.assertRaisesRegex(ocean_report.ReportBuildError, "non-missing QC"):
            ocean_report.summarize_paired_fixture(payload, "paired.json")

    def test_empty_complete_pair_set_fails_explicitly(self) -> None:
        payload = self.fixture_payload("paired-observation-model")
        for record in payload["records"]:
            record["model_degC"] = None
        with self.assertRaisesRegex(ocean_report.ReportBuildError, "no complete finite pairs"):
            ocean_report.summarize_paired_fixture(payload, "paired.json")

    def test_paired_record_order_does_not_change_matching_or_coverage(self) -> None:
        payload = self.fixture_payload("paired-observation-model")
        expected = ocean_report.summarize_paired_fixture(payload, "paired.json")
        payload["records"].reverse()
        actual = ocean_report.summarize_paired_fixture(payload, "paired.json")
        self.assertEqual(actual["time"], expected["time"])
        self.assertAlmostEqual(actual["statistics"]["bias_model_minus_observation"], expected["statistics"]["bias_model_minus_observation"])
        self.assertEqual(set(actual["pairing"]["valid_ids"]), set(expected["pairing"]["valid_ids"]))

    def test_release_full_version_strings_and_wrong_releases_are_rejected(self) -> None:
        for target in ("runtime", "manifest", "entry"):
            for invalid in ("R9.10.0.2198249 (R2021a) Update 8", "R2024b"):
                with self.subTest(target=target, invalid=invalid), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    bundle = RuntimeBundle(root)
                    record = {"runtime": bundle.runtime, "manifest": bundle.manifest,
                              "entry": bundle.manifest["figures"][0]["runtime"]}[target]
                    record["matlab_release"] = invalid
                    bundle.write_metadata()
                    with self.assertRaises(ocean_report.ReportBuildError):
                        ocean_report.build_ocean_report(root)

    def test_generated_at_requires_valid_full_utc_time(self) -> None:
        for invalid in ("2026-09-05Z", "2026-02-30T00:00:00Z", "2026-09-05T12:00:00+08:00"):
            with self.subTest(invalid=invalid), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                bundle.manifest["generated_at"] = invalid
                bundle.write_metadata()
                with self.assertRaisesRegex(ocean_report.ReportBuildError, "manifest.generated_at"):
                    ocean_report.build_ocean_report(root)

    def test_present_metadata_does_not_claim_applied_qc_or_uncertainty(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            RuntimeBundle(root)
            ocean_report.build_ocean_report(root)
            evidence = json.loads((root / "report-evidence.json").read_bytes())
            self.assertEqual(evidence["runtime_fixture_binding"]["status"], "unverified")
            for figure in evidence["runtime_evidence"]["figures"]:
                self.assertEqual(figure["scientific_data"]["qc"]["source_status"], "present")
                self.assertEqual(figure["scientific_data"]["qc"]["plot_filtering"], "not_verified")
                self.assertEqual(figure["scientific_data"]["uncertainty"]["plot_display"], "not_verified")
                self.assertFalse(figure["fixture_binding"]["runtime_fixture_hash_verified"])
            report = (root / "report.md").read_text(encoding="utf-8")
            self.assertIn("源 fixture 元数据存在", report)
            self.assertIn("标准不确定度均值是输入数值的描述统计", report)
            self.assertIn("未提供模式不确定度", report)

    def test_each_figure_links_the_exact_local_fixture_snapshot_and_selection(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            RuntimeBundle(root)
            ocean_report.build_ocean_report(root)
            evidence = json.loads((root / "report-evidence.json").read_bytes())
            sources = {item["id"]: item for item in evidence["fixtures"]}
            for figure in evidence["runtime_evidence"]["figures"]:
                binding = figure["fixture_binding"]
                source = sources[binding["fixture_id"]]
                self.assertEqual(binding["fixture_sha256"], source["sha256"])
                self.assertEqual(binding["fixture_file"], source["file"])
                self.assertEqual(figure["scientific_context"]["counts"]["valid_count"], figure["scientific_data"]["valid_count"])
                self.assertEqual(figure["scientific_context"]["unit"], source["unit"])
            for reference in evidence["references"]:
                self.assertTrue((root / reference["file"]).is_file())
            self.assertEqual(evidence["coverage"]["time"]["continuity"], "not_continuous_across_fixtures")
            self.assertEqual(evidence["coverage"]["time"]["start"], "2026-08-01T00:00:00Z")
            self.assertEqual(evidence["coverage"]["time"]["end"], "2026-08-20T18:00:00Z")

    def test_same_shape_changed_fixture_is_not_claimed_as_runtime_verified(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            RuntimeBundle(root)
            fixture_dir = root / "fixtures"
            shutil.copytree(ocean_report.DEFAULT_FIXTURE_DIRECTORY, fixture_dir)
            fixture_path = fixture_dir / "crossed_time_depth_temperature.json"
            payload = json.loads(fixture_path.read_bytes())
            payload["variables"]["temperature"]["values"][0][0] = 19
            fixture_path.write_text(json.dumps(payload), encoding="utf-8")
            ocean_report.build_ocean_report(root, fixture_dir)
            evidence = json.loads((root / "report-evidence.json").read_bytes())
            fixture = evidence["fixtures"][0]
            self.assertEqual(fixture["sha256"], sha256(fixture_path))
            self.assertAlmostEqual(fixture["statistics"]["mean"], (359.794 + 0.85) / 23)
            self.assertEqual(evidence["runtime_fixture_binding"]["status"], "unverified")
            self.assertIn("运行时数值快照一致性未验证", (root / "report.md").read_text(encoding="utf-8"))

    def test_new_binding_verifies_all_inputs_and_uses_bundle_references(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            bundle.capture_input_fixtures()
            bundle.runtime["input_fixtures"].reverse()
            bundle.write_metadata()
            before = {item["file"]: (root / item["file"]).read_bytes() for item in bundle.runtime["input_fixtures"]}

            ocean_report.build_ocean_report(root)

            evidence = json.loads((root / "report-evidence.json").read_bytes())
            self.assertEqual(evidence["runtime_fixture_binding"]["status"], "verified")
            self.assertEqual(evidence["runtime_fixture_binding"]["fixture_count"], 3)
            inputs = {item["id"]: item for item in evidence["runtime_evidence"]["input_fixtures"]}
            for fixture in evidence["fixtures"]:
                snapshot = inputs[fixture["id"]]
                self.assertEqual(fixture["reference_file"], snapshot["file"])
                self.assertEqual(fixture["sha256"], snapshot["sha256"])
                self.assertEqual(fixture["bytes"], snapshot["bytes"])
            for figure in evidence["runtime_evidence"]["figures"]:
                binding = figure["fixture_binding"]
                self.assertTrue(binding["runtime_fixture_hash_verified"])
                self.assertEqual(binding["fixture_file"], inputs[binding["fixture_id"]]["file"])
                self.assertEqual(figure["scientific_context"]["fixture_file"], binding["fixture_file"])
                self.assertEqual(binding["limitations"], "")
                self.assertEqual(figure["scientific_data"]["qc"]["plot_filtering"], "not_verified")
                self.assertEqual(figure["scientific_data"]["uncertainty"]["plot_display"], "not_verified")
            report = (root / "report.md").read_text(encoding="utf-8")
            for reference in evidence["references"][:3]:
                self.assertTrue(reference["file"].startswith("fixture-inputs/"))
                self.assertEqual(reference["sha256"], sha256(root / reference["file"]))
                self.assertIn(reference["file"], report)
            self.assertIn("输入字节绑定已验证", report)
            self.assertIn("源 fixture 元数据存在", report)
            self.assertIn("未提供模式不确定度", report)
            self.assertNotIn("运行记录没有 fixture 内容哈希", report)
            self.assertNotIn("运行清单缺少输入哈希", report)
            self.assertNotIn(ocean_report.FIXTURE_BINDING_LIMITATION, json.dumps(evidence))
            self.assertEqual(before, {name: (root / name).read_bytes() for name in before})

    def test_new_binding_rejects_same_shape_same_size_numeric_replacement(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            fixture_dir = root / "fixtures"
            shutil.copytree(ocean_report.DEFAULT_FIXTURE_DIRECTORY, fixture_dir)
            bundle.capture_input_fixtures(fixture_dir)
            fixture_path = fixture_dir / "crossed_time_depth_temperature.json"
            original = fixture_path.read_bytes()
            changed = original.replace(b"18.15", b"19.15", 1)
            self.assertNotEqual(changed, original)
            self.assertEqual(len(changed), len(original))
            fixture_path.write_bytes(changed)
            fixtures, contexts = ocean_report.load_fixture_statistics(fixture_dir)
            self.assertEqual(contexts["crossed-time-depth-temperature"]["shape"], [4, 6])
            self.assertEqual(fixtures[0]["counts"], {"raw_count": 24, "valid_count": 23, "missing_count": 1})
            self.assertAlmostEqual(fixtures[0]["statistics"]["mean"], 360.794 / 23)
            with self.assertRaisesRegex(ocean_report.ReportBuildError, "differs from local statistics input"):
                ocean_report.build_ocean_report(root, fixture_dir)
            self.assertFalse((root / "report.md").exists())
            self.assertFalse((root / "report-evidence.json").exists())

    def test_new_binding_requires_byte_identity_not_only_equal_json(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            fixture_dir = root / "fixtures"
            shutil.copytree(ocean_report.DEFAULT_FIXTURE_DIRECTORY, fixture_dir)
            bundle.capture_input_fixtures(fixture_dir)
            fixture_path = fixture_dir / "paired_observation_model.json"
            original = fixture_path.read_bytes()
            fixture_path.write_bytes(original + b"\n")
            self.assertEqual(json.loads(original), json.loads(fixture_path.read_bytes()))
            with self.assertRaisesRegex(ocean_report.ReportBuildError, "differs from local statistics input"):
                ocean_report.build_ocean_report(root, fixture_dir)

    def test_present_input_fixtures_cannot_fall_back_to_legacy(self) -> None:
        for invalid in (None, [], {}, "not-records", [None] * 3):
            with self.subTest(invalid=invalid), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                bundle.runtime["input_fixtures"] = invalid
                bundle.write_metadata()
                with self.assertRaisesRegex(ocean_report.ReportBuildError, "runtime.input_fixtures"):
                    ocean_report.build_ocean_report(root)
                self.assertFalse((root / "report.md").exists())
                self.assertFalse((root / "report-evidence.json").exists())

    def test_new_binding_requires_exactly_three_distinct_ids(self) -> None:
        for change in ("duplicate", "missing", "extra", "unknown"):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                bundle.capture_input_fixtures()
                inputs = bundle.runtime["input_fixtures"]
                if change == "duplicate":
                    inputs[1] = dict(inputs[0])
                elif change == "missing":
                    inputs.pop()
                elif change == "extra":
                    inputs.append(dict(inputs[0]))
                else:
                    inputs[0]["id"] = "unknown-fixture"
                bundle.write_metadata()
                with self.assertRaisesRegex(ocean_report.ReportBuildError, "runtime.input_fixtures"):
                    ocean_report.build_ocean_report(root)
                self.assertFalse((root / "report.md").exists())

    def test_new_binding_strict_record_fields_paths_hashes_and_sizes(self) -> None:
        mutations = [
            ("id", None), ("id", []), ("source_file", "paired_observation_model.json"),
            ("source_file", "../crossed_time_depth_temperature.json"),
            ("file", "crossed_time_depth_temperature.json"),
            ("file", "fixture-inputs/../crossed_time_depth_temperature.json"),
            ("file", "fixture-inputs/./crossed_time_depth_temperature.json"),
            ("file", "/fixture-inputs/crossed_time_depth_temperature.json"),
            ("file", "fixture-inputs\\crossed_time_depth_temperature.json"),
            ("file", " fixture-inputs/crossed_time_depth_temperature.json"),
            ("bytes", 0), ("bytes", -1), ("bytes", True), ("bytes", 1.5), ("bytes", "100"),
            ("bytes", 1), ("sha256", "0" * 64), ("sha256", "f" * 63),
            ("sha256", "g" * 64), ("sha256", None), ("extra_field", True),
        ]
        for field, value in mutations:
            with self.subTest(field=field, value=value), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                bundle.capture_input_fixtures()
                bundle.runtime["input_fixtures"][0][field] = value
                bundle.write_metadata()
                with self.assertRaises(ocean_report.ReportBuildError):
                    ocean_report.build_ocean_report(root)
                self.assertFalse((root / "report.md").exists())

    def test_new_binding_rejects_missing_snapshot_copy(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            bundle.capture_input_fixtures()
            (root / bundle.runtime["input_fixtures"][0]["file"]).unlink()
            with self.assertRaisesRegex(ocean_report.ReportBuildError, "fixture input snapshot missing"):
                ocean_report.build_ocean_report(root)
            self.assertFalse((root / "report.md").exists())
            self.assertFalse((root / "report-evidence.json").exists())

    def test_new_binding_rejects_tampered_snapshot_even_with_updated_record(self) -> None:
        for update_record in (False, True):
            with self.subTest(update_record=update_record), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                bundle.capture_input_fixtures()
                item = bundle.runtime["input_fixtures"][0]
                path = root / item["file"]
                original = path.read_bytes()
                tampered = original.replace(b"18.15", b"19.15", 1)
                self.assertNotEqual(tampered, original)
                self.assertEqual(len(tampered), len(original))
                path.write_bytes(tampered)
                if update_record:
                    item["sha256"] = sha256(path)
                    bundle.write_metadata()
                message = "differs from local statistics input" if update_record else "snapshot bytes/sha256 mismatch"
                with self.assertRaisesRegex(ocean_report.ReportBuildError, message):
                    ocean_report.build_ocean_report(root)
                self.assertFalse((root / "report.md").exists())
                self.assertFalse((root / "report-evidence.json").exists())

    def test_new_binding_rejects_snapshot_file_and_parent_symlinks(self) -> None:
        for link_parent in (False, True):
            with self.subTest(link_parent=link_parent), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                bundle.capture_input_fixtures()
                if link_parent:
                    path = root / "fixture-inputs"
                    target = root / "renamed-inputs"
                    path.rename(target)
                    path.symlink_to(target, target_is_directory=True)
                else:
                    item = bundle.runtime["input_fixtures"][0]
                    path = root / item["file"]
                    path.unlink()
                    path.symlink_to(ocean_report.DEFAULT_FIXTURE_DIRECTORY / item["source_file"])
                with self.assertRaisesRegex(ocean_report.ReportBuildError, "symlink artifact path"):
                    ocean_report.build_ocean_report(root)

    def test_used_snapshot_is_rechecked_before_output_write(self) -> None:
        for mutation in ("bytes", "missing", "symlink"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                bundle.capture_input_fixtures()
                item = bundle.runtime["input_fixtures"][0]
                original_render = ocean_report.render_report
                def change_after_render(evidence):
                    report = original_render(evidence)
                    path = root / item["file"]
                    if mutation == "bytes":
                        path.write_bytes(path.read_bytes().replace(b"18.15", b"19.15", 1))
                    else:
                        path.unlink()
                        if mutation == "symlink":
                            path.symlink_to(ocean_report.DEFAULT_FIXTURE_DIRECTORY / item["source_file"])
                    return report
                with mock.patch.object(ocean_report, "render_report", side_effect=change_after_render):
                    with mock.patch.object(ocean_report, "write_outputs") as writer:
                        with self.assertRaises(ocean_report.ReportBuildError):
                            ocean_report.build_ocean_report(root)
                        writer.assert_not_called()
                self.assertFalse((root / "report.md").exists())
                self.assertFalse((root / "report-evidence.json").exists())

    def test_legacy_runtime_with_unrecorded_copies_remains_unverified(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            bundle.capture_input_fixtures()
            del bundle.runtime["input_fixtures"]
            bundle.write_metadata()
            ocean_report.build_ocean_report(root)
            evidence = json.loads((root / "report-evidence.json").read_bytes())
            self.assertEqual(evidence["runtime_fixture_binding"], {
                "status": "unverified", "reason": ocean_report.FIXTURE_BINDING_LIMITATION,
            })
            self.assertEqual(evidence["runtime_evidence"]["input_fixtures"], [])
            self.assertIn(ocean_report.FIXTURE_BINDING_LIMITATION, evidence["limitations"])
            for figure in evidence["runtime_evidence"]["figures"]:
                self.assertFalse(figure["fixture_binding"]["runtime_fixture_hash_verified"])
            for reference in evidence["references"][:3]:
                self.assertFalse(reference["file"].startswith("fixture-inputs/"))
            report = (root / "report.md").read_text(encoding="utf-8")
            self.assertIn("运行时数值快照一致性未验证", report)
            self.assertIn("运行清单缺少输入哈希", report)
            self.assertNotIn("输入字节绑定已验证", report)

    def test_input_change_during_generation_rejects_mixed_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            RuntimeBundle(root)
            fixture_dir = root / "fixtures"
            shutil.copytree(ocean_report.DEFAULT_FIXTURE_DIRECTORY, fixture_dir)
            original_render = ocean_report.render_report
            def change_after_render(evidence):
                report = original_render(evidence)
                path = fixture_dir / "paired_observation_model.json"
                path.write_bytes(path.read_bytes() + b"\n")
                return report
            with mock.patch.object(ocean_report, "render_report", side_effect=change_after_render):
                with self.assertRaisesRegex(ocean_report.ReportBuildError, "input changed"):
                    ocean_report.build_ocean_report(root, fixture_dir)
            self.assertFalse((root / "report.md").exists())

    def test_conflicting_export_metadata_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            bundle.manifest["figures"][0]["exports"]["pdf"]["title"] = "Different scientific figure"
            bundle.write_metadata()
            with self.assertRaisesRegex(ocean_report.ReportBuildError, "metadata mismatch"):
                ocean_report.build_ocean_report(root)

    def test_wrong_fixture_identity_and_geography_are_rejected(self) -> None:
        for change in (
            lambda payload: payload.update(kind="repeat_profiles"),
            lambda payload: payload.update(area={"name": "Real Sea"}),
            lambda payload: payload.update(synthetic=False),
        ):
            payload = self.fixture_payload("crossed-time-depth-temperature")
            change(payload)
            with self.assertRaises(ocean_report.ReportBuildError):
                ocean_report.validate_fixture_identity(payload, "crossed-time-depth-temperature", "temperature.json")
        paired = self.fixture_payload("paired-observation-model")
        paired["coordinates"] = {"latitude": [30], "longitude": [120]}
        with self.assertRaisesRegex(ocean_report.ReportBuildError, "paired coordinates"):
            ocean_report.validate_fixture_identity(paired, "paired-observation-model", "paired.json")

    def test_json_nan_and_duplicate_keys_fail_explicitly(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "invalid.json"
            for text in ('{"value": NaN}', '{"value": 1, "value": 2}'):
                path.write_text(text, encoding="utf-8")
                with self.assertRaises(ocean_report.ReportBuildError):
                    ocean_report.load_json(path, "fixture")

    def test_normalizes_real_writer_and_runtime_release_forms(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            RuntimeBundle(root)

            ocean_report.build_ocean_report(root, ocean_report.DEFAULT_FIXTURE_DIRECTORY)

            evidence = json.loads((root / "report-evidence.json").read_text(encoding="utf-8"))
            self.assertEqual(evidence["runtime_evidence"]["matlab_release"], "R2026a")

    def test_builds_report_from_verified_runtime_artifacts_and_fixture_statistics(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            RuntimeBundle(root)

            result = ocean_report.build_ocean_report(root, ocean_report.DEFAULT_FIXTURE_DIRECTORY)

            self.assertEqual(result["status"], "passed")
            self.assertEqual(result["artifact_count"], 12)
            report_path = root / "report.md"
            evidence_path = root / "report-evidence.json"
            report = report_path.read_text(encoding="utf-8")
            evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
            self.assertIn("数据来源=合成基准非实测海况", report)
            self.assertIn("观测-模式配对统计", report)
            self.assertIn("](crossed-time-depth-temperature.png)", report)
            self.assertNotIn(str(root), report)
            self.assertNotIn("桌面验证通过", report)
            self.assertNotIn("100分", report)
            self.assertEqual(evidence["data_source"]["observed_ocean_conditions"], False)
            self.assertEqual(evidence["area"]["bounds"], None)
            self.assertEqual(evidence["runtime_evidence"]["desktop_validation"]["status"], "not_performed")
            self.assertEqual(len(evidence["runtime_evidence"]["artifacts"]), 12)
            paired = next(item for item in evidence["fixtures"] if item["id"] == "paired-observation-model")
            self.assertEqual(paired["counts"], {"raw_count": 12, "valid_count": 11, "missing_count": 1})
            self.assertAlmostEqual(paired["statistics"]["bias_model_minus_observation"], 0.08727272727272739)
            self.assertEqual(evidence["report"]["bytes"], report_path.stat().st_size)
            self.assertEqual(evidence["report"]["sha256"], sha256(report_path))

    def test_cli_writes_the_two_contract_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            bundle.capture_input_fixtures()
            process = subprocess.run(
                [
                    sys.executable,
                    str(MODULE_PATH),
                    "--runtime-output",
                    str(root),
                    "--fixture-dir",
                    str(ocean_report.DEFAULT_FIXTURE_DIRECTORY),
                ],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            self.assertEqual(process.returncode, 0, process.stderr)
            payload = json.loads(process.stdout)
            self.assertEqual(payload["status"], "passed")
            self.assertTrue((root / "report.md").is_file())
            self.assertTrue((root / "report-evidence.json").is_file())
            evidence = json.loads((root / "report-evidence.json").read_bytes())
            self.assertEqual(evidence["runtime_fixture_binding"]["status"], "verified")

    def test_missing_artifact_fails_without_writing_report(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            RuntimeBundle(root)
            (root / "paired-observation-model.pdf").unlink()

            with self.assertRaisesRegex(ocean_report.ReportBuildError, "required pdf artifact missing"):
                ocean_report.build_ocean_report(root, ocean_report.DEFAULT_FIXTURE_DIRECTORY)

            self.assertFalse((root / "report.md").exists())
            self.assertFalse((root / "report-evidence.json").exists())

    def test_hash_tampering_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            RuntimeBundle(root)
            (root / "crossed-time-depth-temperature.svg").write_text("<svg/>", encoding="utf-8")

            with self.assertRaisesRegex(ocean_report.ReportBuildError, "byte count mismatch|sha256 mismatch"):
                ocean_report.build_ocean_report(root, ocean_report.DEFAULT_FIXTURE_DIRECTORY)

    def test_dimension_mismatch_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            bundle.manifest["figures"][0]["exports"]["png"]["width"] = 999
            bundle.write_metadata()

            with self.assertRaisesRegex(ocean_report.ReportBuildError, "dimensions mismatch"):
                ocean_report.build_ocean_report(root, ocean_report.DEFAULT_FIXTURE_DIRECTORY)

    def test_unsafe_manifest_path_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            bundle.manifest["figures"][0]["exports"]["svg"]["file"] = "../outside.svg"
            bundle.write_metadata()

            with self.assertRaisesRegex(ocean_report.ReportBuildError, "unsafe artifact path"):
                ocean_report.build_ocean_report(root, ocean_report.DEFAULT_FIXTURE_DIRECTORY)

    def test_runtime_cannot_claim_visual_inspection(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            bundle.manifest["visual_inspection"] = {"status": "passed", "verified": True}
            bundle.write_metadata()

            with self.assertRaisesRegex(ocean_report.ReportBuildError, "visual inspection as not_run"):
                ocean_report.build_ocean_report(root, ocean_report.DEFAULT_FIXTURE_DIRECTORY)


if __name__ == "__main__":
    unittest.main()
