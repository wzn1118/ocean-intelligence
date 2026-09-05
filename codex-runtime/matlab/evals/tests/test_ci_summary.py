from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "summarize_ci.py"
SPEC = importlib.util.spec_from_file_location("ci_summary", MODULE_PATH)
assert SPEC and SPEC.loader
ci_summary = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ci_summary)


RENDERED_EVIDENCE_FIXTURE = {
    "schema_version": 1,
    "evidence_type": "automated_rendered_artifact_inspection",
    "generated_at": "2026-09-05T18:40:24.397540Z",
    "scope": "automated_artifact_checks_only",
    "human_visual_inspection": "not_verified",
    "desktop_interaction": "not_verified",
    "cjk_glyph_rendering": "not_verified",
    "matlab_execution": "not_verified",
    "dependencies": {"pdffonts": {"status": "available", "path": "/usr/bin/pdffonts"}},
    "checks": [{"name": "manifest_snapshot", "status": "passed",
                "reason": "original manifest bytes still match inspected SHA-256"}],
    "artifacts": [
        {"file": "crossed-time-depth-temperature.png", "format": "png", "status": "passed",
         "checks": [{"name": "png_dimensions", "status": "passed", "reason": "dimensions match",
                     "width": 2400, "height": 1500, "expected_width": 2400, "expected_height": 1500}]},
        {"file": "crossed-time-depth-temperature.pdf", "format": "pdf", "status": "failed",
         "checks": [
             {"name": "pdf_font_inventory", "status": "passed", "reason": "pdffonts table parsed",
              "fonts": [{"name": "Courier", "type": "Type 1", "encoding": "WinAnsi",
                         "embedded": "no", "subset": "no", "unicode_map": "no"}]},
             {"name": "pdf_font_embedding", "status": "failed",
              "reason": "embedding flags only; does not verify glyph appearance, CJK coverage or visual correctness"},
         ]},
    ],
    "status": "failed",
    "summary": {"passed": 1, "failed": 1, "not_verified": 0, "artifact_count": 2},
}

VALIDATION_SUMMARY_FIXTURE = {
    "schema_version": 1,
    "generated_at": "2026-09-05T18:40:24Z",
    "expected_release": "R2021a",
    "status": "failed",
    "checks": [
        {"id": "stage-status", "status": "passed", "detail": "ci-stage-status.json"},
        {"id": "regression-contract", "status": "failed", "detail": "exit 1; log: regression-contract.log"},
        {"id": "rendered-artifacts", "status": "failed", "detail": "exit 1; log: rendered-artifacts.log"},
    ],
    "failures": ["regression-contract: exit 1; log: regression-contract.log",
                 "rendered-artifacts: exit 1; log: rendered-artifacts.log"],
}

DISPLAY_DIAGNOSTICS_FIXTURE = {
    "schema_version": 1,
    "scope": "virtual_display_diagnostics_only",
    "started_at": "2026-09-05T19:00:00Z",
    "release": "R2021a",
    "version": "9.10.0 (R2021a)",
    "display": ":98",
    "jvm_available": True,
    "desktop_available": False,
    "screen_pixels_per_inch": 72,
    "visual_verified": False,
    "desktop_interaction_verified": False,
    "status": "completed_pending_external_review",
    "cases": [
        {"id": "publication", "status": "export_checks_completed",
         "error_identifier": "", "error_message": ""},
        {"id": "native-pdf-page-probe", "status": "export_checks_completed",
         "error_identifier": "", "error_message": ""},
        {"id": "vector-text-alignment-probe", "status": "export_checks_completed",
         "error_identifier": "", "error_message": ""},
    ],
    "failed_count": 0,
    "completed_at": "2026-09-05T19:02:00Z",
}


class SummaryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "download"
        self.root.mkdir()

    def write_json(self, release: str, name: str, payload: object) -> Path:
        directory = self.root / ("matlab-full100-" + release)
        directory.mkdir(exist_ok=True)
        path = directory / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        return path

    def stages(self, release: str, overrides: dict | None = None) -> dict:
        payload = {"schema_version": 1, "expected_release": release,
                   "stages": [{"id": identifier, "status": "passed"} for identifier in ci_summary.CORE_STAGES]}
        if overrides:
            payload.update(overrides)
        self.write_json(release, "ci-stage-status.json", payload)
        return payload

    def probe(self, expected_release: str, **overrides: object) -> dict:
        payload = {"runtime": "matlab", "vendor": "MathWorks", "release": expected_release,
                   "version": "test version", "matlab_license_tested": True,
                   "matlab_license_available": True, "headless": True, **overrides}
        self.write_json(expected_release, "matlab-runtime-probe.json", payload)
        return payload

    def evaluator(self, release: str, **overrides: object) -> dict:
        payload = {"status": "runtime_pending", "score": 90, "maximum_score": 100,
                   "runtime": {"status": "passed"}, "visual_audit": {"status": "pending"},
                   "gates": [{"id": "matlab_runtime", "status": "passed"},
                             {"id": "artifact_visual_audit", "status": "pending"}], **overrides}
        self.write_json(release, "evaluator-result.json", payload)
        return payload

    def complete_runtime(self) -> None:
        for release in ci_summary.RELEASES:
            self.stages(release)
            self.probe(release)

    def postprocessing(self, release: str, passed: bool = False) -> None:
        rendered = copy.deepcopy(RENDERED_EVIDENCE_FIXTURE)
        validation = copy.deepcopy(VALIDATION_SUMMARY_FIXTURE)
        validation["expected_release"] = release
        if passed:
            rendered["status"] = validation["status"] = "passed"
            rendered["summary"] = {"passed": 999, "failed": 0, "not_verified": 0, "artifact_count": 999}
            for artifact in rendered["artifacts"]:
                artifact["status"] = "passed"
                for check in artifact["checks"]:
                    check["status"] = "passed"
            for check in validation["checks"]:
                check["status"] = "passed"
            validation["failures"] = []
        self.write_json(release, "rendered-artifact-evidence.json", rendered)
        self.write_json(release, "ci-validation-summary.json", validation)

    def early_export_abort(self, release: str) -> None:
        """Synthetic R17 early-stop shape, not MATLAB execution or inspection evidence."""
        payload = self.stages(release)
        payload["stages"].extend({"id": identifier, "status": "passed"} for identifier in (
            "font-export-probe", "native-pdf-page-probe", "vector-text-alignment-probe",
            "generated-router-runtime", "comparison-statistics-layout", "hovmoller-time-axis",
            "export-metadata", "manifest-evidence-integrity", "text-bounds", "font-availability",
            "color-accessibility", "series-style-preservation", "interaction-native-compatibility",
        ))
        for stage in payload["stages"]:
            if stage["id"] in ("family-b-runtime", "evaluator-runtime"):
                stage.update(status="failed", error_identifier="oi_export_figure:ColorAccessibility",
                             error_message="Final series require non-color redundant encoding: "
                             "ambiguous hidden line needs explicit role or series appdata")
        self.write_json(release, "ci-stage-status.json", payload)
        self.probe(release)
        self.write_json(release, "evaluator-result.json", {
            "schema_version": 1, "status": "failed", "score": 0, "maximum_score": 100,
            "error": json.dumps({"status": "failed", "error":
                                 "regular file required: evaluator-runtime/matlab-runtime.json"}),
        })
        rendered = copy.deepcopy(RENDERED_EVIDENCE_FIXTURE)
        rendered.update(
            manifest="evaluator-runtime/figures.json", manifest_sha256=None,
            checks=[{"name": "input_validation", "status": "failed",
                     "reason": "No such file or directory: evaluator-runtime/figures.json"}],
            artifacts=[], artifact_sha256={},
            summary={"passed": 0, "failed": 0, "not_verified": 0, "artifact_count": 0},
        )
        self.write_json(release, "rendered-artifact-evidence.json", rendered)
        validation = copy.deepcopy(VALIDATION_SUMMARY_FIXTURE)
        validation["expected_release"] = release
        details = {
            "evaluator-runtime-record": "missing nonempty regular file: evaluator-runtime/matlab-runtime.json",
            "regression-contract": "exit 1; log: regression-contract.log",
            "evaluator-runtime": "exit 1; log: evaluator-runtime.log",
            "rendered-artifacts": "exit 1; log: rendered-artifacts.log",
            "ocean-report": "exit 1; log: ocean-report.log",
        }
        validation["checks"] = [{"id": "stage-status", "status": "passed", "detail": "ci-stage-status.json"},
                                *({"id": identifier, "status": "failed", "detail": detail}
                                  for identifier, detail in details.items())]
        validation["failures"] = [f"{identifier}: {detail}" for identifier, detail in details.items()]
        self.write_json(release, "ci-validation-summary.json", validation)
        self.write_json(release, "ocean-report.log", {
            "status": "failed", "error": "required figures.json missing: evaluator-runtime/figures.json",
        })
        runtime = self.root / ("matlab-full100-" + release) / "evaluator-runtime"
        runtime.mkdir()
        for identifier in ("crossed-time-depth-temperature", "repeat-cast-salinity-profiles"):
            for extension in ("png", "pdf", "svg"):
                (runtime / f"{identifier}.{extension}").write_bytes(b"unit-only partial export placeholder")

    def release_result(self, release: str = "R2021a") -> dict:
        return next(result for result in ci_summary.summarize(self.root)["releases"] if result["release"] == release)

    def display_diagnostics(self, expected_release: str, **overrides: object) -> dict:
        payload = copy.deepcopy(DISPLAY_DIAGNOSTICS_FIXTURE)
        payload.update(release=expected_release)
        payload.update(overrides)
        self.write_json(expected_release, ci_summary.DISPLAY_FILE, payload)
        return payload

    def main_summary(self, summary: dict) -> dict:
        result = copy.deepcopy(summary)
        for release in result["releases"]:
            release.pop("display_diagnostics", None)
        return result

    def test_canvas_diagnostics_are_explicitly_outside_summary_scope(self) -> None:
        self.complete_runtime()
        baseline = ci_summary.summarize(self.root)
        for status in ["failed", "running", "completed_diagnostics_only"]:
            for prefix in ["native-pdf-page-probe", "display-comparison/native-pdf-page-probe"]:
                self.write_json("R2021a", prefix + "/canvas-extent-experiment/canvas-extent-experiment.json", {
                    "status": status, "counts_toward_stage": False, "visual_verified": False,
                })
            summary = ci_summary.summarize(self.root)
            self.assertEqual(summary, baseline)
            self.assertIn("未读取 canvas-extent-experiment", summary["notice"])
            self.assertIn("不能从主阶段 passed 推断成功", ci_summary.markdown(summary))

    def test_display_missing_old_packages_are_not_run_and_have_no_table(self) -> None:
        self.complete_runtime()
        summary = ci_summary.summarize(self.root)
        self.assertEqual(summary["status"], "pending")
        self.assertEqual(summary["stage_counts"]["total"], 21)
        self.assertNotIn("虚拟 DISPLAY 独立诊断", ci_summary.markdown(summary))
        for result in summary["releases"]:
            diagnostic = result["display_diagnostics"]
            self.assertFalse(diagnostic["present"])
            self.assertEqual(diagnostic["status"], "not_run")
            self.assertEqual(diagnostic["issues"], [])
            self.assertEqual([case["status"] for case in diagnostic["cases"]], ["not_run"] * 3)
            self.assertEqual(result["issues"], [])

    def test_display_partial_matrix_and_running_callbacks(self) -> None:
        self.complete_runtime()
        before = self.main_summary(ci_summary.summarize(self.root))
        payload = copy.deepcopy(DISPLAY_DIAGNOSTICS_FIXTURE)
        payload.update(release="R2026a", status="running")
        payload.pop("completed_at")
        payload.pop("failed_count")
        for case, status in zip(payload["cases"], ("export_checks_completed", "running", "pending")):
            case["status"] = status
        self.write_json("R2026a", ci_summary.DISPLAY_FILE, payload)
        summary = ci_summary.summarize(self.root)
        self.assertEqual(self.main_summary(summary), before)
        self.assertEqual([result["display_diagnostics"]["status"] for result in summary["releases"]],
                         ["not_run", "not_run", "running"])
        diagnostic = summary["releases"][2]["display_diagnostics"]
        self.assertEqual(diagnostic["issues"], [])
        self.assertEqual([case["status"] for case in diagnostic["cases"]],
                         ["export_checks_completed", "running", "pending"])
        report = ci_summary.markdown(summary)
        self.assertIn("| R2026a | 运行中 | R2026a | :98 |", report)
        self.assertIn("| R2021a | 未运行 | 未提供 | 未提供 |", report)
        self.assertIn("回调 API 完成（待外部检查）", report)
        self.assertIn("不代表视觉通过或桌面交互验证", report)

    def test_display_completion_never_changes_main_ci_outcome_or_score(self) -> None:
        self.complete_runtime()
        for release in ci_summary.RELEASES:
            self.evaluator(release, status="passed", score=100,
                           visual_audit={"status": "passed"},
                           gates=[{"id": "artifact_visual_audit", "status": "passed"}])
        for main_status in ("pending", "running", "failed", "passed"):
            with self.subTest(main_status=main_status):
                stages = self.stages("R2021a")
                stages["stages"][0]["status"] = main_status
                self.write_json("R2021a", "ci-stage-status.json", stages)
                before = self.main_summary(ci_summary.summarize(self.root))
                for release in ci_summary.RELEASES:
                    self.display_diagnostics(release)
                summary = ci_summary.summarize(self.root)
                self.assertEqual(summary["status"], main_status)
                self.assertEqual(self.main_summary(summary), before)
                for result in summary["releases"]:
                    diagnostic = result["display_diagnostics"]
                    self.assertEqual(diagnostic["status"], "completed_pending_external_review")
                    self.assertEqual(diagnostic["issues"], [])
                self.display_diagnostics("R2021a", visual_verified=True)
                failed_diagnostic = ci_summary.summarize(self.root)
                self.assertEqual(failed_diagnostic["releases"][0]["display_diagnostics"]["status"], "failed")
                self.assertEqual(self.main_summary(failed_diagnostic), before)
        report = ci_summary.markdown(summary)
        self.assertIn("完成待外部检查", report)
        self.assertNotIn("visual passed", report)

    def test_display_completion_does_not_supply_missing_score_or_visual_review(self) -> None:
        self.complete_runtime()
        before = self.main_summary(ci_summary.summarize(self.root))
        for release in ci_summary.RELEASES:
            self.display_diagnostics(release)
        summary = ci_summary.summarize(self.root)
        self.assertEqual(self.main_summary(summary), before)
        self.assertEqual(summary["status"], "pending")
        for result in summary["releases"]:
            self.assertIsNone(result["evaluator"]["reported_score"])
            self.assertEqual(result["evaluator"]["visual_status"], "pending")

    def test_display_callback_failures_are_separate_and_errors_are_escaped(self) -> None:
        self.complete_runtime()
        before = self.main_summary(ci_summary.summarize(self.root))
        for final in (False, True):
            with self.subTest(final=final):
                payload = copy.deepcopy(DISPLAY_DIAGNOSTICS_FIXTURE)
                payload["cases"][0].update(status="failed", error_identifier="Display:Failure",
                                            error_message="first | <error> `label`\nstack trace")
                if final:
                    payload.update(status="completed_with_failures", failed_count=1)
                else:
                    payload.update(status="running")
                    payload.pop("completed_at")
                    payload.pop("failed_count")
                    payload["cases"][1]["status"] = "running"
                    payload["cases"][2]["status"] = "pending"
                self.write_json("R2021a", ci_summary.DISPLAY_FILE, payload)
                summary = ci_summary.summarize(self.root)
                diagnostic = summary["releases"][0]["display_diagnostics"]
                self.assertEqual(self.main_summary(summary), before)
                self.assertEqual(diagnostic["status"], "failed")
                self.assertEqual(diagnostic["reported_status"], payload["status"])
                self.assertEqual(diagnostic["issues"][0]["identifier"], "Display:Failure")
                self.assertEqual(diagnostic["cases"][0]["error_message"], "first | <error> `label`")
                report = ci_summary.markdown(summary)
                self.assertIn("Display:Failure: first &#124; &lt;error&gt; &#96;label&#96;", report)
                self.assertNotIn("stack trace", report)

    def test_display_invalid_metadata_is_failed_without_affecting_main(self) -> None:
        self.complete_runtime()
        before = self.main_summary(ci_summary.summarize(self.root))
        overrides = [
            {"schema_version": True}, {"schema_version": 2}, {"scope": "desktop_interaction"},
            {"scope": None}, {"release": "R2026a"}, {"release": None}, {"display": ""},
            {"display": False}, {"version": []}, {"started_at": None}, {"visual": True},
            {"desktop_interaction": True}, {"score": 100}, {"screen_pixels_per_inch": 0},
            {"screen_pixels_per_inch": True}, {"screen_pixels_per_inch": "72"},
            {"status": "passed"}, {"status": []}, {"failed_count": False}, {"failed_count": 1},
            {"failed_count": "0"}, {"completed_at": ""}, {"completed_at": False},
            {"status": "running"}, {"status": "completed_with_failures"},
        ]
        for key in ("visual_verified", "desktop_interaction_verified"):
            overrides.extend({key: value} for value in (True, 0, 1, "false", None, [], {}))
        for key in ("jvm_available", "desktop_available"):
            overrides.extend({key: value} for value in (0, 1, "false", None))
        for override in overrides:
            with self.subTest(override=override):
                self.display_diagnostics("R2021a", **override)
                summary = ci_summary.summarize(self.root)
                diagnostic = summary["releases"][0]["display_diagnostics"]
                self.assertTrue(diagnostic["present"])
                self.assertEqual(diagnostic["status"], "failed")
                self.assertTrue(diagnostic["issues"])
                self.assertEqual(self.main_summary(summary), before)
                ci_summary.markdown(summary)
                json.dumps(summary, allow_nan=False)
        self.display_diagnostics("R2021a", jvm_available=False, desktop_available=True)
        self.assertEqual(self.release_result()["display_diagnostics"]["status"],
                         "completed_pending_external_review")

    def test_display_invalid_case_shapes_and_contradictory_completion(self) -> None:
        self.complete_runtime()
        before = self.main_summary(ci_summary.summarize(self.root))
        valid_cases = DISPLAY_DIAGNOSTICS_FIXTURE["cases"]
        invalid_cases = [None, {}, [], "completed", [None], valid_cases[:1],
                         [valid_cases[0], valid_cases[0], valid_cases[2]]]
        for override in ({"id": "unknown"}, {"id": []}, {"status": "passed"}, {"status": None},
                         {"status": True}, {"status": []}, {"status": "running"}, {"status": "pending"},
                         {"error_identifier": False}, {"error_message": {}},
                         {"error_message": "error despite completed"}, {"visual_verified": True},
                         {"status": "failed"}):
            cases = copy.deepcopy(valid_cases)
            cases[0].update(override)
            invalid_cases.append(cases)
        for key in valid_cases[0]:
            cases = copy.deepcopy(valid_cases)
            cases[0].pop(key)
            invalid_cases.append(cases)
        for cases in invalid_cases:
            with self.subTest(cases=cases):
                self.display_diagnostics("R2021a", cases=cases)
                summary = ci_summary.summarize(self.root)
                diagnostic = summary["releases"][0]["display_diagnostics"]
                self.assertEqual(diagnostic["status"], "failed")
                self.assertTrue(diagnostic["issues"])
                self.assertEqual(self.main_summary(summary), before)
                ci_summary.markdown(summary)

    def test_display_malformed_json_and_duplicate_keys_are_diagnostic_failures(self) -> None:
        self.complete_runtime()
        before = self.main_summary(ci_summary.summarize(self.root))
        encoded = json.dumps(DISPLAY_DIAGNOSTICS_FIXTURE)
        contents = [b"{", b"[]", b"null", b"\xff", b'{"status": NaN}',
                    encoded.replace('"screen_pixels_per_inch": 72', '"screen_pixels_per_inch": 1e999').encode(),
                    encoded.replace('"visual_verified": false',
                                    '"visual_verified": true, "visual_verified": false').encode(),
                    encoded.replace('"status": "export_checks_completed"',
                                    '"status": "failed", "status": "export_checks_completed"', 1).encode()]
        for content in contents:
            with self.subTest(content=content):
                path = self.write_json("R2021a", ci_summary.DISPLAY_FILE, {})
                path.write_bytes(content)
                summary = ci_summary.summarize(self.root)
                self.assertEqual(self.main_summary(summary), before)
                self.assertEqual(summary["releases"][0]["display_diagnostics"]["status"], "failed")
                self.assertTrue(summary["releases"][0]["display_diagnostics"]["issues"])
                json.dumps(summary, allow_nan=False)
                fingerprint = self.fingerprint()
                process = self.run_cli("--format", "json")
                self.assertEqual(process.returncode, 0, process.stderr)
                self.assertEqual(json.loads(process.stdout), summary)
                self.assertEqual(fingerprint, self.fingerprint())

    def test_read_json_duplicate_keys_use_existing_invalid_json_contract(self) -> None:
        self.complete_runtime()
        for name in ("ci-stage-status.json", "matlab-runtime-probe.json", "evaluator-result.json",
                     *ci_summary.POSTPROCESSING_FILES):
            with self.subTest(name=name):
                self.complete_runtime()
                path = self.write_json("R2021a", name, {})
                path.write_text('{"status":"failed","status":"passed"}', encoding="utf-8")
                summary = ci_summary.summarize(self.root)
                self.assertEqual(summary["releases"][0]["status"], "failed")
                self.assertIn("ci_summary:InvalidJSON", [item["identifier"] for item in summary["releases"][0]["issues"]])
                self.assertEqual(summary["releases"][1]["runtime_status"], "passed")
                path.unlink()

    def test_empty_artifacts_never_report_postprocessing_pass(self) -> None:
        self.complete_runtime()
        for reported_status in ("passed", "pending", "failed"):
            with self.subTest(status=reported_status):
                payload = copy.deepcopy(RENDERED_EVIDENCE_FIXTURE)
                payload["status"] = reported_status
                payload["artifacts"] = []
                self.write_json("R2021a", "rendered-artifact-evidence.json", payload)
                result = self.release_result()
                expected = "failed" if reported_status == "failed" else "pending"
                self.assertEqual(result["postprocessing"]["status"], expected)
                self.assertTrue(any(item["identifier"] == "ci_summary:MissingArtifacts"
                                    and item["status"] == "pending" for item in result["issues"]))

    def test_real_shape_counts_each_failure_and_nested_evaluator_error(self) -> None:
        for release in ci_summary.RELEASES:
            payload = self.stages(release)
            for stage in payload["stages"]:
                if stage["id"] in ("plot-regression", "export-runtime", "evaluator-runtime"):
                    stage.update(status="failed", error_identifier="MATLAB:Example",
                                 error_message="第一行\n不应显示的堆栈", error_report="长报告\n更多内容")
            self.write_json(release, "ci-stage-status.json", payload)
            self.probe(release)
            self.evaluator(release, status="failed", score=0, error=json.dumps(
                {"status": "failed", "error": "regular file required: matlab-runtime.json\nstack trace"}))
        summary = ci_summary.summarize(self.root)
        self.assertEqual(summary["stage_counts"], {"total": 21, "passed": 12, "failed": 9, "pending": 0, "running": 0})
        self.assertEqual(summary["release_counts"]["failed"], 3)
        report = ci_summary.markdown(summary)
        self.assertEqual(report.count("MATLAB:Example"), 9)
        self.assertEqual(report.count("regular file required: matlab-runtime.json"), 3)
        self.assertNotIn("不应显示的堆栈", report)
        self.assertNotIn("stack trace", report)
        self.assertNotIn("长报告", report)

    def test_early_export_abort_keeps_raw_zero_and_failed_postprocessing(self) -> None:
        for release in ci_summary.RELEASES:
            self.early_export_abort(release)
            runtime = self.root / ("matlab-full100-" + release) / "evaluator-runtime"
            self.assertEqual(len(list(runtime.iterdir())), 6)
            for name in ("matlab-runtime.json", "figures.json", "report.md", "report-evidence.json"):
                self.assertFalse((runtime / name).exists())
        before = self.fingerprint()
        process = self.run_cli("--format", "json")
        self.assertEqual(process.returncode, 0, process.stderr)
        summary = json.loads(process.stdout)
        self.assertEqual(summary["status"], "failed")
        self.assertEqual(summary["stage_counts"], {"total": 60, "passed": 54, "failed": 6, "pending": 0, "running": 0})
        self.assertEqual(summary["release_counts"], {"total": 3, "passed": 0, "failed": 3, "pending": 0, "running": 0})
        for result in summary["releases"]:
            self.assertEqual(result["runtime_status"], "failed")
            self.assertEqual(result["evaluator"]["status"], "failed")
            self.assertEqual(result["evaluator"]["reported_status"], "failed")
            self.assertEqual(result["evaluator"]["reported_score"], 0)
            self.assertEqual(result["evaluator"]["maximum_score"], 100)
            self.assertEqual(result["evaluator"]["visual_status"], "pending")
            self.assertEqual(result["stage_counts"], {"total": 20, "passed": 18, "failed": 2, "pending": 0, "running": 0})
            self.assertEqual({stage["id"] for stage in result["stages"] if stage["status"] == "failed"},
                             {"family-b-runtime", "evaluator-runtime"})
            self.assertEqual(result["postprocessing"]["status"], "failed")
            self.assertEqual({item["source"]: item["status"] for item in result["postprocessing"]["sources"]},
                             {name: "failed" for name in ci_summary.POSTPROCESSING_FILES})
            for identifier in ("input_validation", "evaluator-runtime-record", "rendered-artifacts", "ocean-report"):
                self.assertTrue(any(item["identifier"] == identifier and item["status"] == "failed"
                                    for item in result["issues"]))
            self.assertTrue(any(item["identifier"] == "ci_summary:MissingArtifacts" and item["status"] == "pending"
                                for item in result["issues"]))
        report = ci_summary.markdown(summary)
        self.assertEqual(report.count("failed (0/100)"), 3)
        self.assertEqual(report.count("oi_export_figure:ColorAccessibility"), 6)
        self.assertNotIn("90/100", report)
        self.assertNotIn("3/4", report)
        self.assertEqual(before, self.fingerprint())

    def test_early_abort_never_borrows_other_release_or_archived_run(self) -> None:
        self.early_export_abort("R2021a")
        before = self.release_result()
        passed_stages = [{"id": stage["id"], "status": "passed"} for stage in before["stages"]]
        self.stages("R2024b", {"stages": passed_stages})
        self.probe("R2024b")
        self.evaluator("R2024b", status="passed", score=100, visual_audit={"status": "passed"},
                       gates=[{"id": "artifact_visual_audit", "status": "passed"}])
        self.postprocessing("R2024b", passed=True)
        self.assertEqual(self.release_result("R2024b")["status"], "passed")
        self.write_json("R2021a", "previous-run/ci-stage-status.json", {
            "schema_version": 1, "expected_release": "R2021a", "stages": passed_stages,
        })
        self.write_json("R2021a", "previous-run/evaluator-result.json", {
            "status": "runtime_pending", "score": 90, "maximum_score": 100,
            "runtime": {"status": "passed"}, "visual_audit": {"status": "pending"},
        })
        self.write_json("R2021a", "previous-run/evaluator-runtime/figures.json", {
            "execution_verified": True, "fixture_binding": "verified", "unit_only": True,
        })
        self.write_json("R2021a", "previous-run/evaluator-runtime/report-evidence.json", {
            "status": "passed", "plot_data_summary": "3/4", "unit_only": True,
        })
        self.assertEqual(self.release_result(), before)
        package = self.root / "matlab-full100-R2021a"
        for name in ("figures.json", "report-evidence.json"):
            archived = package / "previous-run/evaluator-runtime" / name
            (package / "evaluator-runtime" / name).write_bytes(archived.read_bytes())
        other_runtime = self.write_json("R2024b", "evaluator-runtime/matlab-runtime.json", {
            "success": True, "matlab_release": "R2024b", "unit_only": True,
        })
        (package / "evaluator-runtime/matlab-runtime.json").write_bytes(other_runtime.read_bytes())
        self.assertEqual(self.release_result(), before)
        (package / "evaluator-result.json").unlink()
        result = self.release_result()
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["runtime_status"], "failed")
        self.assertEqual(result["postprocessing"]["status"], "failed")
        self.assertIsNone(result["evaluator"]["reported_score"])
        self.assertIsNone(result["evaluator"]["reported_status"])
        self.assertEqual(result["evaluator"]["status"], "pending")
        self.assertTrue((package / "evaluator-runtime/figures.json").exists())
        self.assertTrue((package / "evaluator-runtime/matlab-runtime.json").exists())
        report = ci_summary.markdown(ci_summary.summarize(self.root))
        self.assertNotIn("90/100", report)
        self.assertNotIn("3/4", report)

    def test_dynamic_stage_union_pending_running_and_ignores_summary(self) -> None:
        self.complete_runtime()
        payload = self.stages("R2021a")
        payload["stages"][0]["status"] = "running"
        payload["stages"][1]["status"] = "pending"
        payload["stages"].append({"id": "new-runtime-check", "status": "passed"})
        payload["summary"] = {"total": 999, "passed": 999}
        self.write_json("R2021a", "ci-stage-status.json", payload)
        summary = ci_summary.summarize(self.root)
        self.assertEqual(summary["stage_counts"], {"total": 24, "passed": 20, "failed": 0, "pending": 3, "running": 1})
        self.assertEqual(summary["status"], "running")
        self.assertEqual(summary["releases"][1]["runtime_status"], "pending")

    def test_runtime_pass_does_not_invent_score_or_visual_pass(self) -> None:
        self.complete_runtime()
        summary = ci_summary.summarize(self.root)
        self.assertEqual(summary["stage_counts"]["passed"], 21)
        self.assertEqual(summary["status"], "pending")
        for result in summary["releases"]:
            self.assertEqual(result["runtime_status"], "passed")
            self.assertEqual(result["evaluator"]["visual_status"], "pending")
            self.assertIsNone(result["evaluator"]["reported_score"])
        self.assertIn("不代表 100 分或渲染/视觉通过", ci_summary.markdown(summary))

    def test_runtime_pending_evaluator_preserves_90_not_100(self) -> None:
        self.complete_runtime()
        self.evaluator("R2021a")
        result = self.release_result()
        self.assertEqual(result["runtime_status"], "passed")
        self.assertEqual(result["status"], "pending")
        self.assertEqual(result["evaluator"]["reported_status"], "runtime_pending")
        self.assertEqual(result["evaluator"]["reported_score"], 90)
        self.assertEqual(result["evaluator"]["visual_status"], "pending")

    def test_explicit_visual_evidence_is_separate_from_runtime(self) -> None:
        self.complete_runtime()
        for release in ci_summary.RELEASES:
            self.evaluator(release, status="passed", score=100,
                           visual_audit={"status": "passed"},
                           gates=[{"id": "artifact_visual_audit", "status": "passed"}])
        self.assertEqual(ci_summary.summarize(self.root)["status"], "passed")
        self.evaluator("R2021a", status="passed", score=100, gates=[], visual_audit={"status": "passed"})
        self.assertEqual(self.release_result()["status"], "pending")

    def test_real_postprocessing_failures_override_pending_visual_audit(self) -> None:
        self.complete_runtime()
        for release in ("R2021a", "R2024b"):
            self.evaluator(release)
            self.postprocessing(release)
        summary = ci_summary.summarize(self.root)
        self.assertEqual(summary["status"], "failed")
        self.assertEqual(summary["status_source"], "local_artifact_evidence")
        self.assertIsNone(summary["github_status"])
        self.assertEqual(summary["release_counts"], {"total": 3, "passed": 0, "failed": 2, "pending": 1, "running": 0})
        self.assertEqual(summary["stage_counts"], {"total": 21, "passed": 21, "failed": 0, "pending": 0, "running": 0})
        for result in summary["releases"][:2]:
            self.assertEqual(result["runtime_status"], "passed")
            self.assertEqual(result["postprocessing"]["status"], "failed")
            self.assertEqual(len(result["postprocessing"]["sources"]), 2)
            self.assertEqual(result["evaluator"]["reported_score"], 90)
            self.assertEqual(result["evaluator"]["visual_status"], "pending")
            self.assertEqual([item["identifier"] for item in result["issues"]],
                             ["pdf_font_embedding", "regression-contract", "rendered-artifacts"])
            self.assertTrue(result["issues"][0]["source"].endswith(":crossed-time-depth-temperature.pdf"))
        report = ci_summary.markdown(summary)
        self.assertIn("本地证据推断", report)
        self.assertIn("未提供 GitHub 状态、未查询远端", report)
        self.assertIn("后处理", report)
        self.assertEqual(report.count("pdf_font_embedding"), 2)

    def test_each_postprocessing_source_independently_blocks_pass(self) -> None:
        self.complete_runtime()
        for name, fixture in (("rendered-artifact-evidence.json", RENDERED_EVIDENCE_FIXTURE),
                              ("ci-validation-summary.json", VALIDATION_SUMMARY_FIXTURE)):
            with self.subTest(name=name):
                path = self.write_json("R2021a", name, fixture)
                result = self.release_result()
                self.assertEqual(result["status"], "failed")
                self.assertEqual(result["postprocessing"]["status"], "failed")
                self.assertEqual(result["runtime_status"], "passed")
                path.unlink()

    def test_postprocessing_leaf_failure_overrides_claimed_parent_passes(self) -> None:
        self.complete_runtime()
        for name, fixture in (("rendered-artifact-evidence.json", RENDERED_EVIDENCE_FIXTURE),
                              ("ci-validation-summary.json", VALIDATION_SUMMARY_FIXTURE)):
            with self.subTest(name=name):
                payload = copy.deepcopy(fixture)
                payload["status"] = "passed"
                payload["summary"] = {"passed": 999, "failed": 0}
                if "artifacts" in payload:
                    for artifact in payload["artifacts"]:
                        artifact["status"] = "passed"
                else:
                    payload["failures"] = []
                path = self.write_json("R2021a", name, payload)
                result = self.release_result()
                self.assertEqual(result["status"], "failed")
                self.assertEqual(result["postprocessing"]["sources"][0]["reported_status"], "passed")
                path.unlink()

    def test_validation_failures_array_alone_blocks_pass_and_preserves_first_line(self) -> None:
        self.complete_runtime()
        payload = copy.deepcopy(VALIDATION_SUMMARY_FIXTURE)
        payload.update(status="passed", checks=payload["checks"][:1], failures=[
            "rendered-artifacts: exit 1 | <details>\nstack trace", "failure without identifier\nmore"])
        self.write_json("R2021a", "ci-validation-summary.json", payload)
        summary = ci_summary.summarize(self.root)
        result = summary["releases"][0]
        self.assertEqual(result["status"], "failed")
        self.assertEqual([item["identifier"] for item in result["issues"]],
                         ["rendered-artifacts", "(无 identifier)"])
        report = ci_summary.markdown(summary)
        self.assertIn("rendered-artifacts: exit 1 &#124; &lt;details&gt;", report)
        self.assertIn("failure without identifier", report)
        self.assertNotIn("stack trace", report)

    def test_rendered_top_and_artifact_status_failures_are_not_ignored(self) -> None:
        self.complete_runtime()
        for level in ("root", "artifact", "check"):
            with self.subTest(level=level):
                payload = copy.deepcopy(RENDERED_EVIDENCE_FIXTURE)
                payload["status"] = "passed"
                payload["artifacts"] = payload["artifacts"][:1]
                record = {"root": payload, "artifact": payload["artifacts"][0],
                          "check": payload["checks"][0]}[level]
                record.update(status="failed", reason="first failure line\nnot shown")
                self.write_json("R2021a", "rendered-artifact-evidence.json", payload)
                result = self.release_result()
                self.assertEqual(result["status"], "failed")
                self.assertEqual(result["issues"][0]["message"], "first failure line")

    def test_automated_pass_never_supplies_score_or_visual_approval(self) -> None:
        self.complete_runtime()
        self.postprocessing("R2021a", passed=True)
        for has_evaluator in (False, True):
            with self.subTest(has_evaluator=has_evaluator):
                if has_evaluator:
                    self.evaluator("R2021a")
                result = self.release_result()
                self.assertEqual(result["postprocessing"]["status"], "passed")
                self.assertEqual(result["status"], "pending")
                self.assertEqual(result["evaluator"]["reported_score"], 90 if has_evaluator else None)
                self.assertEqual(result["evaluator"]["visual_status"], "pending")
                self.assertEqual(result["issues"], [])
                self.assertEqual(result["stage_counts"]["passed"], 7)

    def test_rendered_not_verified_and_other_incomplete_statuses_block_pass(self) -> None:
        self.complete_runtime()
        self.evaluator("R2021a", status="passed", score=100, visual_audit={"status": "passed"},
                       gates=[{"id": "artifact_visual_audit", "status": "passed"}])
        for reported, expected in (("not_verified", "pending"), ("pending", "pending"), ("running", "running")):
            for level in ("root", "artifact", "check"):
                with self.subTest(reported=reported, level=level):
                    payload = copy.deepcopy(RENDERED_EVIDENCE_FIXTURE)
                    payload["status"] = "passed"
                    payload["artifacts"] = payload["artifacts"][:1]
                    record = {"root": payload, "artifact": payload["artifacts"][0],
                              "check": payload["artifacts"][0]["checks"][0]}[level]
                    record["status"] = reported
                    self.write_json("R2021a", "rendered-artifact-evidence.json", payload)
                    result = self.release_result()
                    self.assertEqual(result["postprocessing"]["status"], expected)
                    self.assertEqual(result["status"], expected)
                    self.assertEqual(result["runtime_status"], "passed")

    def test_postprocessing_unknown_statuses_fail_closed(self) -> None:
        self.complete_runtime()
        for status in ("success", "skipped", "error", None, True, [], {}):
            for level in ("root", "artifact", "check"):
                with self.subTest(status=status, level=level):
                    payload = copy.deepcopy(RENDERED_EVIDENCE_FIXTURE)
                    payload["status"] = "passed"
                    payload["artifacts"] = payload["artifacts"][:1]
                    record = {"root": payload, "artifact": payload["artifacts"][0],
                              "check": payload["artifacts"][0]["checks"][0]}[level]
                    record["status"] = status
                    self.write_json("R2021a", "rendered-artifact-evidence.json", payload)
                    result = self.release_result()
                    self.assertEqual(result["status"], "failed")
                    self.assertEqual(result["runtime_status"], "passed")
                    self.assertIn("ci_summary:InvalidStatus", [item["identifier"] for item in result["issues"]])

    def test_postprocessing_malformed_records_and_release_binding_fail_closed(self) -> None:
        self.complete_runtime()
        cases = (
            ("rendered-artifact-evidence.json", RENDERED_EVIDENCE_FIXTURE,
             [{"schema_version": 2}, {"artifacts": None}, {"artifacts": [None]},
              {"artifacts": [{"file": [], "status": "passed"}]},
              {"artifacts": [{"file": "plot.pdf", "status": "passed", "checks": None}]},
              {"checks": None}, {"checks": [{"name": [], "status": "passed"}]}]),
            ("ci-validation-summary.json", VALIDATION_SUMMARY_FIXTURE,
             [{"expected_release": "R2026a"}, {"expected_release": None}, {"status": "not_verified"},
              {"checks": {}}, {"checks": [{"id": "rendered-artifacts", "status": "success"}]},
              {"failures": "failure"}, {"failures": [None]}, {"failures": [""]}]),
        )
        for name, fixture, overrides in cases:
            for override in overrides:
                with self.subTest(name=name, override=override):
                    payload = copy.deepcopy(fixture)
                    payload.update(status="passed", checks=[], failures=[])
                    if "artifacts" in payload:
                        payload["artifacts"] = []
                    payload.update(override)
                    path = self.write_json("R2021a", name, payload)
                    result = self.release_result()
                    self.assertEqual(result["status"], "failed")
                    self.assertEqual(result["postprocessing"]["status"], "failed")
                    self.assertEqual(result["runtime_status"], "passed")
                    path.unlink()

    def test_missing_release_is_pending_and_not_dropped(self) -> None:
        self.stages("R2021a")
        self.probe("R2021a")
        summary = ci_summary.summarize(self.root)
        self.assertEqual(len(summary["releases"]), 3)
        self.assertEqual(summary["stage_counts"]["pending"], 14)
        self.assertFalse(summary["releases"][1]["artifact_present"])
        self.assertEqual(summary["release_counts"]["passed"], 0)

    def test_missing_stage_in_every_release_is_not_a_pass(self) -> None:
        self.complete_runtime()
        for release in ci_summary.RELEASES:
            payload = self.stages(release)
            payload["stages"].pop()
            self.write_json(release, "ci-stage-status.json", payload)
        summary = ci_summary.summarize(self.root)
        self.assertEqual(summary["stage_counts"]["pending"], 3)
        self.assertEqual(summary["stage_counts"]["passed"], 18)
        self.assertTrue(all(result["runtime_status"] == "pending" for result in summary["releases"]))

    def test_empty_directory_is_pending_not_success(self) -> None:
        summary = ci_summary.summarize(self.root)
        self.assertEqual(summary["status"], "pending")
        self.assertEqual(summary["stage_counts"]["passed"], 0)
        self.assertEqual(summary["stage_counts"]["pending"], 21)

    def test_unknown_or_missing_status_fails_closed(self) -> None:
        self.probe("R2021a")
        for status in ("success", "skipped", "cancelled", "error", "PASSED", None, True, [], {}):
            with self.subTest(status=status):
                payload = self.stages("R2021a")
                payload["stages"][0]["status"] = status
                self.write_json("R2021a", "ci-stage-status.json", payload)
                result = self.release_result()
                self.assertEqual(result["stage_counts"]["passed"], 6)
                self.assertEqual(result["stage_counts"]["failed"], 1)
                self.assertEqual(result["status"], "failed")

    def test_passed_stage_with_error_and_duplicate_are_not_passes(self) -> None:
        payload = self.stages("R2021a")
        payload["stages"][0]["error_report"] = "Only report first line\r\nmore"
        duplicate = copy.deepcopy(payload["stages"][1])
        duplicate.update(error_identifier="Duplicate:Error", error_message="duplicate error")
        payload["stages"].append(duplicate)
        self.write_json("R2021a", "ci-stage-status.json", payload)
        result = self.release_result()
        self.assertEqual(result["stage_counts"]["failed"], 2)
        self.assertEqual(result["stage_counts"]["total"], 7)
        self.assertIn("Only report first line", [item["message"] for item in result["issues"]])
        self.assertIn("Duplicate:Error", [item["identifier"] for item in result["issues"]])

    def test_matlab_singleton_stage_object(self) -> None:
        self.stages("R2021a", {"stages": {"id": "plot-regression", "status": "running"}})
        result = self.release_result()
        self.assertEqual(result["stage_counts"]["running"], 1)
        self.assertEqual(result["stage_counts"]["pending"], 6)

    def test_release_mismatch_never_counts_other_release_passes(self) -> None:
        self.stages("R2021a", {"expected_release": "R2026a"})
        self.probe("R2021a")
        result = self.release_result()
        self.assertEqual(result["stage_counts"]["passed"], 0)
        self.assertEqual(result["status"], "failed")

    def test_missing_or_invalid_probe_blocks_runtime_pass(self) -> None:
        self.stages("R2021a")
        self.assertEqual(self.release_result()["runtime_status"], "pending")
        for overrides in ({"release": "R2026a"}, {"runtime": "octave"},
                          {"matlab_license_available": False}, {"matlab_license_available": 1},
                          {"matlab_license_tested": "true"}, {"status": "error"}):
            with self.subTest(overrides=overrides):
                self.probe("R2021a", **overrides)
                self.assertEqual(self.release_result()["runtime_status"], "failed")

    def test_corrupt_and_invalid_json_are_reported_without_aborting_matrix(self) -> None:
        self.complete_runtime()
        for name in ("ci-stage-status.json", "matlab-runtime-probe.json", "evaluator-result.json",
                     *ci_summary.POSTPROCESSING_FILES):
            for content in (b"{", b"[]", b"null", b"\xff"):
                with self.subTest(name=name, content=content):
                    self.complete_runtime()
                    path = self.root / "matlab-full100-R2021a" / name
                    path.write_bytes(content)
                    summary = ci_summary.summarize(self.root)
                    self.assertEqual(summary["releases"][0]["status"], "failed")
                    self.assertEqual(summary["releases"][1]["runtime_status"], "passed")
                    if name == "matlab-runtime-probe.json":
                        self.assertEqual(summary["releases"][0]["probe"]["status"], "failed")
                    if name == "evaluator-result.json":
                        self.assertEqual(summary["releases"][0]["evaluator"]["status"], "failed")
                    if name in ci_summary.POSTPROCESSING_FILES:
                        self.assertEqual(summary["releases"][0]["postprocessing"]["status"], "failed")
                        self.assertEqual(summary["releases"][0]["runtime_status"], "passed")
                    path.unlink()

    def test_malformed_stage_shapes_do_not_crash_or_pass(self) -> None:
        for stages in (None, "passed", {}, [None], [{"status": "passed"}], [{"id": [], "status": "passed"}]):
            with self.subTest(stages=stages):
                self.stages("R2021a", {"stages": stages})
                result = self.release_result()
                self.assertEqual(result["status"], "failed")
                self.assertEqual(result["stage_counts"]["passed"], 0)

    def test_evaluator_errors_and_invalid_score_never_become_passes(self) -> None:
        self.complete_runtime()
        for overrides in ({"status": "success"}, {"score": True}, {"score": float("nan")},
                          {"score": 101}, {"maximum_score": 90}, {"gates": {}},
                          {"status": "passed", "score": 90},
                          {"runtime": {"status": "unknown"}},
                          {"visual_audit": "passed"},
                          {"gates": [{"id": "artifact_visual_audit", "status": "unknown"}]}):
            with self.subTest(overrides=overrides):
                self.evaluator("R2021a", **overrides)
                result = self.release_result()
                self.assertEqual(result["status"], "failed")
                self.assertEqual(result["runtime_status"], "passed")

    def test_conflicting_visual_gates_never_report_visual_pass(self) -> None:
        self.complete_runtime()
        self.evaluator("R2021a", status="passed", score=100, visual_audit={"status": "passed"},
                       gates=[{"id": "artifact_visual_audit", "status": "failed"},
                              {"id": "artifact_visual_audit", "status": "passed"}])
        result = self.release_result()
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["evaluator"]["visual_status"], "failed")

    def test_every_structured_error_identifier_and_markdown_escaping(self) -> None:
        self.stages("R2021a")
        self.evaluator("R2021a", status="failed", errors=[
            {"identifier": "First:Failure", "message": "first | <line>\nsecond"},
            {"identifier": "Second:Failure", "message": "second failure\r\ntrace"},
        ])
        summary = ci_summary.summarize(self.root)
        report = ci_summary.markdown(summary)
        self.assertIn("First:Failure: first &#124; &lt;line&gt;", report)
        self.assertIn("Second:Failure: second failure", report)
        self.assertNotIn("trace", report)

    def test_additional_release_is_not_ignored(self) -> None:
        self.stages("R2025b")
        self.probe("R2025b")
        summary = ci_summary.summarize(self.root)
        self.assertEqual(summary["release_counts"]["total"], 4)
        self.assertEqual(summary["stage_counts"]["total"], 28)

    def run_cli(self, *arguments: str) -> subprocess.CompletedProcess:
        return subprocess.run([sys.executable, "-B", str(MODULE_PATH), "--input-root", str(self.root),
                               *arguments], text=True, capture_output=True, check=False)

    def fingerprint(self) -> dict:
        return {str(path.relative_to(self.root)): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in self.root.rglob("*") if path.is_file()}

    def test_cli_writes_both_formats_outside_input_without_modifying_sources(self) -> None:
        self.complete_runtime()
        self.postprocessing("R2021a")
        before = self.fingerprint()
        output = Path(self.temporary.name) / "summary"
        process = self.run_cli("--output-dir", str(output), "--format", "json")
        self.assertEqual(process.returncode, 0, process.stderr)
        summary = json.loads(process.stdout)
        self.assertEqual(summary["status"], "failed")
        self.assertEqual(summary["status_source"], "local_artifact_evidence")
        self.assertIsNone(summary["github_status"])
        self.assertEqual(json.loads((output / "summary.json").read_text(encoding="utf-8")), summary)
        self.assertEqual((output / "summary.md").read_text(encoding="utf-8"), ci_summary.markdown(summary))
        self.assertEqual(before, self.fingerprint())
        second = self.run_cli()
        self.assertEqual(second.stdout, ci_summary.markdown(summary))
        self.assertEqual(before, self.fingerprint())

    def test_cli_rejects_invalid_root_and_output_inside_input(self) -> None:
        for arguments in (("--input-root", str(self.root / "missing")),
                          ("--output-dir", str(self.root)),
                          ("--output-dir", str(self.root / "nested"))):
            with self.subTest(arguments=arguments):
                process = self.run_cli(*arguments)
                self.assertEqual(process.returncode, 2)
                self.assertNotIn("Traceback", process.stderr)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_cli_rejects_output_file_symlink_into_input(self) -> None:
        payload = self.stages("R2021a")
        source = self.root / "matlab-full100-R2021a" / "ci-stage-status.json"
        output = Path(self.temporary.name) / "summary"
        output.mkdir()
        (output / "summary.json").symlink_to(source)
        process = self.run_cli("--output-dir", str(output))
        self.assertEqual(process.returncode, 2)
        self.assertEqual(json.loads(source.read_text(encoding="utf-8")), payload)


if __name__ == "__main__":
    unittest.main()
