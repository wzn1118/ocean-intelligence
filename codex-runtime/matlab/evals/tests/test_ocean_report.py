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


class OceanReportTests(unittest.TestCase):
    def fixture_payload(self, identifier: str) -> dict[str, object]:
        path = ocean_report.DEFAULT_FIXTURE_DIRECTORY / ocean_report.EXPECTED_FIXTURES[identifier]
        return json.loads(path.read_bytes())

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
            RuntimeBundle(root)
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
