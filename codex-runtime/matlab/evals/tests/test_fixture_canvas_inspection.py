"""Local synthetic declaration/file tests, not MATLAB, PDF-font or visual evidence."""
from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import os
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).resolve().parents[1] / "inspect_fixture_canvas.py"
SPEC = importlib.util.spec_from_file_location("fixture_canvas_inspection", MODULE_PATH)
assert SPEC and SPEC.loader
inspector = importlib.util.module_from_spec(SPEC)
sys.path.insert(0, str(MODULE_PATH.parent))
try:
    SPEC.loader.exec_module(inspector)
finally:
    sys.path.pop(0)


def png_bytes(width: int = 2400, height: int = 1500) -> bytes:
    def chunk(kind: bytes, content: bytes) -> bytes:
        return struct.pack(">I", len(content)) + kind + content + struct.pack(">I", zlib.crc32(kind + content))

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"\x00" * ((width + 1) * height))) + chunk(b"IEND", b""))


def geometry() -> dict:
    return {"status": "captured", "objects": {
        "object_index": 1, "class": "matlab.graphics.axis.Axes", "parent_class": "matlab.ui.Figure",
        "properties": {"Units": "inches", "Position": [0.4, 0.4, 7.2, 4.2]}, "unavailable_properties": [],
    }, "error_identifier": "", "error_message": ""}


class FixtureCanvasInspectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.png = png_bytes()

    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.workspace = Path(temporary.name)
        self.artifacts = self.workspace / "matlab-full100-R2021a"
        self.fixtures = self.workspace / "fixtures"
        self.fixtures.mkdir()
        self.report_path = self.artifacts / inspector.REPORT
        self.directory = self.report_path.parent
        self.directory.mkdir(parents=True)
        for identifier, source in inspector.SOURCES.items():
            if identifier != "paired-interactive":
                (self.fixtures / source).write_text(json.dumps({
                    "id": identifier, "synthetic": True, "values": [1, None, 3],
                }), encoding="utf-8")
        self.payload = {
            "schema_version": 1, "status": "completed_diagnostics_only", "release": "R2021a",
            "generated_at": "2026-09-06T01:00:00Z", "completed_at": "2026-09-06T01:01:00Z",
            "scope": "native fixture canvas diagnostic; not a production export strategy",
            "data_source": "synthetic benchmark, not observed ocean conditions", "counts_toward_stage": False,
            "target_page_inches": [8, 5], "target_page_points": [576, 360], "external_inspection_status": "pending",
            "exact_page_verified": False, "font_embedding_verified": False, "layout_verified": False,
            "skip_reason": "", "candidates": [],
        }
        for identifier, source in inspector.SOURCES.items():
            candidate = {
                "id": identifier, "status": "completed_diagnostic",
                "details": {"case_id": identifier, "source_file": source,
                            "input_sha256": hashlib.sha256((self.fixtures / source).read_bytes()).hexdigest(),
                            "title": "Unit-only fixture", "data_source": "synthetic"},
                "geometry": {phase: geometry() for phase in inspector.GEOMETRY},
                "wrapper_geometry": {phase: geometry() for phase in ("after_wrap", "after_pdf")},
                "data_preservation": {phase: True for phase in inspector.DATA_PHASES},
                "restoration_attempted": True, "restoration_completed": True, "root_state_preserved": True,
                "parent_identity_preserved": True, "callback_restoration_verified": False,
                "root_inventory": geometry(), "excluded_root_classes": [], "restoration_error": "",
                "error_identifier": "", "error_message": "",
            }
            for kind, (filename, api) in inspector.ARTIFACTS.items():
                content = self.png if filename.endswith(".png") else b"%PDF-1.4\nunit-only unverified PDF body\n%%EOF\n"
                path = self.directory / identifier / filename
                path.parent.mkdir(exist_ok=True)
                path.write_bytes(content)
                candidate[kind] = {
                    "file": identifier + "/" + filename, "requested_api": api, "status": "exported",
                    "api_invoked": True, "call_succeeded": True,
                    "export_object_class": "matlab.ui.container.Panel" if kind == "canvas_pdf" else "matlab.ui.Figure",
                    "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest(),
                    "png_pixels": [2400, 1500] if filename.endswith(".png") else [],
                    "error_identifier": "", "error_message": "",
                }
            self.payload["candidates"].append(candidate)
        self.write_report()

    def write_report(self) -> None:
        self.report_path.write_text(json.dumps(self.payload, ensure_ascii=False), encoding="utf-8")

    def inspect(self, release: str = "R2021a", context: str = "primary") -> dict:
        return inspector.inspect_fixture_canvas(self.artifacts, self.fixtures, release, context)

    def fingerprint(self) -> dict:
        return {str(path): hashlib.sha256(path.read_bytes()).hexdigest()
                for root in (self.artifacts, self.fixtures) for path in root.rglob("*") if path.is_file()}

    def dormant(self, candidate: dict) -> None:
        candidate.update(status="pending", details={}, geometry={}, wrapper_geometry={}, data_preservation={},
                         root_inventory={}, excluded_root_classes=[], restoration_error="", error_identifier="", error_message="")
        for key in inspector.RESTORATION_FLAGS:
            candidate[key] = False
        for kind in inspector.ARTIFACTS:
            record = candidate[kind]
            (self.directory / record["file"]).unlink(missing_ok=True)
            record.update(status="not_attempted", api_invoked=False, call_succeeded=False, export_object_class="",
                          bytes=0, sha256="", png_pixels=[], error_identifier="", error_message="")

    def assert_failed(self, result: dict) -> None:
        self.assertEqual(result["status"], "failed")
        self.assertTrue(any(check["status"] == "failed" for check in result["checks"]))
        json.dumps(result, allow_nan=False)

    def test_complete_hashes_bytes_and_png_dimensions_are_bound_without_visual_claims(self) -> None:
        before = self.fingerprint()
        result = self.inspect()
        self.assertEqual(result["status"], "declaration_consistent", result["checks"])
        self.assertEqual(result["diagnostic"]["sha256"], before[str(self.report_path)])
        self.assertEqual(len(result["candidates"]), 4)
        for candidate in result["candidates"]:
            source = self.fixtures / inspector.SOURCES[candidate["id"]]
            self.assertEqual(candidate["input"]["sha256"], before[str(source)])
            self.assertEqual(candidate["input"]["bytes"], source.stat().st_size)
            self.assertIsNone(candidate["input"]["declared_bytes"])
            self.assertEqual(candidate["input"]["status"], "matched")
            for kind, artifact in candidate["artifacts"].items():
                self.assertEqual(artifact["measured"]["sha256"], artifact["declared"]["sha256"])
                self.assertEqual(artifact["measured"]["bytes"], artifact["declared"]["bytes"])
                if kind.endswith("png"):
                    self.assertEqual(artifact["measured"]["png_pixels"], [2400, 1500])
        self.assertEqual(sum(check["name"].startswith("snapshot_unchanged:") for check in result["checks"]), 20)
        self.assertIs(result["counts_toward_stage"], False)
        for key in ("pdf_pages", "pdf_fonts", "visual", "matlab_execution"):
            self.assertEqual(result[key], "not_verified")
        self.assertNotIn("score", result)
        self.assertIn("not pixel decoding", result["notice"])
        self.assertEqual(before, self.fingerprint())

    def test_missing_and_partial_running_never_pass(self) -> None:
        self.report_path.unlink()
        self.assertEqual(self.inspect()["status"], "not_run")
        self.payload.update(status="running", completed_at="")
        for candidate in self.payload["candidates"][1:]:
            self.dormant(candidate)
        self.write_report()
        result = self.inspect()
        self.assertEqual(result["status"], "not_verified", result["checks"])
        self.assertEqual([candidate["status"] for candidate in result["candidates"]],
                         ["declaration_consistent", "not_verified", "not_verified", "not_verified"])
        self.assertFalse(any(check["status"] == "failed" for check in result["checks"]))

    def test_nonpublic_geometry_is_explicitly_unavailable_not_measured(self) -> None:
        snapshot = self.payload["candidates"][0]["geometry"]["constructed"]["objects"]
        snapshot["properties"].pop("Position")
        snapshot["unavailable_properties"] = ["Position"]
        snapshot["nonpublic_properties"] = ["Position"]
        self.write_report()
        self.assertEqual(self.inspect()["status"], "declaration_consistent")
        snapshot["properties"]["Position"] = [0, 0, 1, 1]
        self.write_report()
        self.assert_failed(self.inspect())

    def test_nonpublic_geometry_rejects_bad_shapes_duplicates_and_missing_unavailable(self) -> None:
        for nonpublic, unavailable in ((True, []), (["Position", "Position"], ["Position"]),
                                       (["Position"], []), ([""], [])):
            with self.subTest(nonpublic=nonpublic, unavailable=unavailable):
                snapshot = self.payload["candidates"][0]["geometry"]["constructed"]["objects"]
                snapshot["nonpublic_properties"] = nonpublic
                snapshot["unavailable_properties"] = unavailable
                self.write_report()
                self.assert_failed(self.inspect())

    def test_declared_failure_keeps_errors_and_still_reads_all_candidates(self) -> None:
        self.payload["status"] = "incomplete"
        candidate = self.payload["candidates"][0]
        candidate.update(status="failed", error_identifier="unit:Geometry", error_message="capture failed\nunit details")
        candidate["geometry"]["after_pdf"].update(status="capture_failed", error_identifier="unit:Capture", error_message="getter failed")
        self.write_report()
        result = self.inspect()
        self.assert_failed(result)
        self.assertEqual(len(result["candidates"]), 4)
        failed = result["candidates"][0]
        self.assertEqual(failed["errors"]["error_message"], "capture failed\nunit details")
        self.assertEqual(failed["geometry"]["after_pdf"]["errors"]["error_identifier"], "unit:Capture")
        self.assertEqual(failed["artifacts"]["canvas_pdf"]["declared"]["status"], "exported")
        self.assertEqual(failed["artifacts"]["canvas_pdf"]["measured"]["bytes"], candidate["canvas_pdf"]["bytes"])
        self.assertEqual(result["candidates"][-1]["status"], "declaration_consistent")

    def test_failed_partial_file_with_no_recorded_hash_is_measured_not_upgraded(self) -> None:
        self.payload["status"] = "incomplete"
        candidate = self.payload["candidates"][0]
        candidate.update(status="failed", error_identifier="unit:Export", error_message="native export failed")
        artifact = candidate["canvas_pdf"]
        artifact.update(status="failed", call_succeeded=False, bytes=0, sha256="",
                        error_identifier="unit:PDF", error_message="partial file")
        self.write_report()
        result = self.inspect()
        self.assert_failed(result)
        observed = result["candidates"][0]["artifacts"]["canvas_pdf"]
        self.assertEqual(observed["declared"]["status"], "failed")
        self.assertGreater(observed["measured"]["bytes"], 0)
        self.assertTrue(inspector.digest_string(observed["measured"]["sha256"]))
        self.assertTrue(any(check["status"] == "not_verified" and check["name"].endswith(".file_binding") for check in result["checks"]))

    def test_r21_ci_early_failure_shapes_preserve_unattempted_and_reference_evidence(self) -> None:
        """Reduced unit reproductions of CI34001173593, without reading the archived run."""
        self.payload["status"] = "incomplete"
        originals = copy.deepcopy(self.payload["candidates"])
        for candidate in self.payload["candidates"]:
            self.dormant(candidate)
            candidate.update(status="failed", error_identifier="build_native_pdf_fixture_case:JVMRequired",
                             error_message="The fixture byte digest requires the MATLAB JVM")
        self.write_report()
        result = self.inspect()
        self.assert_failed(result)
        for candidate in result["candidates"]:
            self.assertEqual(candidate["errors"]["error_identifier"], "build_native_pdf_fixture_case:JVMRequired")
            self.assertEqual(candidate["input"]["status"], "not_verified")
            self.assertTrue(all(artifact["declared"]["status"] == "not_attempted"
                                and artifact["measured"]["present"] is False for artifact in candidate["artifacts"].values()))
        for candidate, original in zip(self.payload["candidates"], originals):
            candidate.update(details=original["details"], root_inventory=geometry(),
                             geometry={"constructed": geometry(), "before_wrap": geometry()},
                             data_preservation={"after_reference": True},
                             error_identifier="test_native_pdf_fixture_canvas:RootObjects",
                             error_message="Only traditional axes or tiled-layout roots are supported by this diagnostic")
            for kind in ("reference_png", "reference_pdf"):
                candidate[kind] = original[kind]
                content = self.png if kind == "reference_png" else b"%PDF-1.4\nunit-only unverified PDF body\n%%EOF\n"
                (self.directory / candidate[kind]["file"]).write_bytes(content)
        self.payload["candidates"][1]["geometry"]["constructed"].update(
            status="capture_failed", error_identifier="MATLAB:class:GetProhibited",
            error_message="No public property 'Position' for class 'Text'.")
        self.write_report()
        result = self.inspect()
        self.assert_failed(result)
        for candidate in result["candidates"]:
            self.assertEqual(candidate["input"]["status"], "matched")
            self.assertEqual(candidate["errors"]["error_identifier"], "test_native_pdf_fixture_canvas:RootObjects")
            for kind in ("reference_png", "reference_pdf"):
                self.assertEqual(candidate["artifacts"][kind]["measured"]["sha256"], candidate["artifacts"][kind]["declared"]["sha256"])
            self.assertEqual(candidate["artifacts"]["canvas_pdf"]["declared"]["status"], "not_attempted")
        self.assertTrue(all(check["name"].endswith((".reported_error", ".native_failure", ".capture"))
                            for check in result["checks"] if check["status"] == "failed"))

    def test_input_content_and_declared_identity_mismatches_fail(self) -> None:
        source = self.fixtures / inspector.SOURCES["crossed-time-depth-temperature"]
        original = source.read_bytes()
        source.write_bytes(original.replace(b"[1,", b"[2,"))
        self.assert_failed(self.inspect())
        source.write_bytes(original)
        for key, value in (("source_file", "../outside.json"), ("source_file", "paired_observation_model.json"),
                           ("input_sha256", "0" * 64), ("case_id", "paired-interactive"), ("data_source", "observed")):
            with self.subTest(key=key, value=value):
                before = copy.deepcopy(self.payload)
                self.payload["candidates"][0]["details"][key] = value
                self.write_report()
                result = self.inspect()
                self.assert_failed(result)
                self.assertEqual(result["candidates"][0]["input"]["status"], "failed")
                self.payload = before

    def test_output_hash_byte_dimension_signature_and_missing_file_failures(self) -> None:
        candidate = self.payload["candidates"][0]
        path = self.directory / candidate["reference_png"]["file"]
        for replacement in (self.png + b"changed", png_bytes(2399, 1500), b"not a PNG"):
            with self.subTest(length=len(replacement)):
                path.write_bytes(replacement)
                self.assert_failed(self.inspect())
        path.write_bytes(self.png)
        path.unlink()
        self.assert_failed(self.inspect())
        path.write_bytes(self.png)
        for key, value in (("sha256", "0" * 64), ("bytes", candidate["reference_png"]["bytes"] + 1),
                           ("png_pixels", [2401, 1500])):
            before = copy.deepcopy(self.payload)
            self.payload["candidates"][0]["reference_png"][key] = value
            self.write_report()
            self.assert_failed(self.inspect())
            self.payload = before

    def test_duplicate_unknown_missing_ids_and_array_shapes_fail(self) -> None:
        original = copy.deepcopy(self.payload)
        cases = [original["candidates"][:3], original["candidates"] + original["candidates"][:1],
                 [original["candidates"][0]] * 4, [{"id": "unexpected"}] + original["candidates"][1:],
                 [{"id": []}] + original["candidates"][1:], {}, [None] * 4]
        for candidates in cases:
            with self.subTest(candidates=str(candidates)[:60]):
                self.payload = copy.deepcopy(original)
                self.payload["candidates"] = candidates
                self.write_report()
                self.assert_failed(self.inspect())

    def test_root_release_flags_unknown_fields_and_status_consistency(self) -> None:
        original = copy.deepcopy(self.payload)
        for key, value in (("release", "R2024b"), ("schema_version", True), ("schema_version", 2),
                           ("counts_toward_stage", True), ("exact_page_verified", True), ("font_embedding_verified", True),
                           ("layout_verified", True), ("external_inspection_status", "passed"), ("status", "incomplete"),
                           ("status", "running"), ("status", "passed"), ("status", {}), ("unknown", True)):
            with self.subTest(key=key, value=value):
                self.payload = copy.deepcopy(original)
                self.payload[key] = value
                self.write_report()
                self.assert_failed(self.inspect())

    def test_candidate_boolean_status_and_geometry_requirements_are_strict(self) -> None:
        original = copy.deepcopy(self.payload)
        mutations = [(key, value) for key in inspector.RESTORATION_FLAGS for value in (1, "true", None)]
        mutations += [("root_state_preserved", False), ("parent_identity_preserved", False),
                      ("callback_restoration_verified", True), ("restoration_attempted", False),
                      ("restoration_completed", False), ("status", "pending"), ("status", "success"),
                      ("geometry", {}), ("root_inventory", {}), ("wrapper_geometry", {}),
                      ("data_preservation", {}), ("reference_png", None), ("reference_pdf", []),
                      ("restoration_error", "unit restoration error"), ("unknown", True)]
        for key, value in mutations:
            with self.subTest(key=key, value=value):
                self.payload = copy.deepcopy(original)
                self.payload["candidates"][0][key] = value
                self.write_report()
                self.assert_failed(self.inspect())
        for group, key, value in (("geometry", "after_wrap", {}), ("geometry", "after_restore", None),
                                   ("data_preservation", "after_reference", False), ("data_preservation", "after_pdf", 1),
                                   ("reference_png", "api_invoked", False), ("reference_png", "call_succeeded", "true"),
                                   ("reference_png", "export_object_class", "matlab.graphics.axis.Axes"),
                                   ("reference_pdf", "sha256", [])):
            self.payload = copy.deepcopy(original)
            self.payload["candidates"][0][group][key] = value
            self.write_report()
            self.assert_failed(self.inspect())

    def test_geometry_native_singletons_and_object_types(self) -> None:
        self.payload["candidates"][0]["geometry"]["constructed"]["objects"]["unavailable_properties"] = "Parent"
        self.write_report()
        self.assertEqual(self.inspect()["status"], "declaration_consistent")
        original = copy.deepcopy(self.payload)
        for key, value in (("object_index", True), ("object_index", 2), ("class", ""), ("parent_class", []),
                           ("properties", []), ("unavailable_properties", [True]), ("unknown", True)):
            self.payload = copy.deepcopy(original)
            self.payload["candidates"][0]["geometry"]["constructed"]["objects"][key] = value
            self.write_report()
            self.assert_failed(self.inspect())

    def test_direct_child_count_is_metadata_and_never_overrides_declared_root_failure(self) -> None:
        candidate = self.payload["candidates"][0]
        axes_record = candidate["root_inventory"]["objects"]
        axes_record["properties"]["DirectChildCount"] = 3
        annotation = {"object_index": 2, "class": "matlab.graphics.shape.internal.AnnotationPane",
                      "parent_class": "matlab.ui.Figure", "unavailable_properties": [],
                      "properties": {"Tag": "scribeOverlay", "HandleVisibility": "off", "DirectChildCount": 0}}
        candidate["root_inventory"]["objects"] = [axes_record, annotation]
        candidate["excluded_root_classes"] = [annotation["class"]]
        self.write_report()
        result = self.inspect()
        self.assertEqual(result["status"], "declaration_consistent", result["checks"])
        self.assertIn("not an independent allchild/annotation-emptiness check", result["notice"])
        self.assertNotIn("annotation_empty_verified", result)
        annotation["properties"]["DirectChildCount"] = 1
        candidate["excluded_root_classes"] = []
        candidate.update(status="failed", error_identifier="test_native_pdf_fixture_canvas:RootObjects",
                         error_message="Nonempty annotation root is unsupported")
        self.payload["status"] = "incomplete"
        self.write_report()
        result = self.inspect()
        self.assert_failed(result)
        self.assertEqual(result["candidates"][0]["errors"]["error_identifier"], "test_native_pdf_fixture_canvas:RootObjects")

    def test_malformed_duplicate_nonfinite_and_oversized_json_fail_with_snapshot(self) -> None:
        for raw in (b"{", b"[]", b"null", b'{"status":"running","status":"failed"}',
                    b'{"geometry":{"Position":NaN}}', b'{"nested":[{"value":1e999}]}',
                    b"[" * 1100 + b"0" + b"]" * 1100, b"\xff"):
            with self.subTest(raw=raw[:60]):
                self.report_path.write_bytes(raw)
                result = self.inspect()
                self.assert_failed(result)
                self.assertEqual(result["diagnostic"]["sha256"], hashlib.sha256(raw).hexdigest())
        self.report_path.write_bytes(b" " * (inspector.MAX_JSON_BYTES + 1))
        result = self.inspect()
        self.assert_failed(result)
        self.assertIsNone(result["diagnostic"])

    def test_unsafe_declared_paths_are_rejected_without_reading_them(self) -> None:
        original = copy.deepcopy(self.payload)
        for path in ("../outside.pdf", "/tmp/outside.pdf", "a//b.pdf", "a/./b.pdf", "a\\b.pdf", "file:outside.pdf", "bad\x00path", None):
            with self.subTest(path=path):
                self.payload = copy.deepcopy(original)
                self.payload["candidates"][0]["canvas_pdf"]["file"] = path
                self.write_report()
                self.assert_failed(self.inspect())

    def test_symlink_report_output_input_and_directory_are_rejected(self) -> None:
        paths = [self.report_path, self.directory / self.payload["candidates"][0]["reference_png"]["file"],
                 self.fixtures / inspector.SOURCES["crossed-time-depth-temperature"]]
        for index, path in enumerate(paths):
            original = path.read_bytes()
            outside = self.workspace / f"outside-{index}"
            outside.write_bytes(original)
            path.unlink()
            path.symlink_to(outside)
            self.assert_failed(self.inspect())
            path.unlink()
            path.write_bytes(original)
        directory = self.directory / self.payload["candidates"][0]["id"]
        relocated = self.workspace / "relocated"
        directory.rename(relocated)
        directory.symlink_to(relocated, target_is_directory=True)
        self.assert_failed(self.inspect())

    def test_nonregular_fifo_is_rejected_without_blocking(self) -> None:
        path = self.directory / self.payload["candidates"][0]["canvas_pdf"]["file"]
        path.unlink()
        os.mkfifo(path)
        self.assert_failed(self.inspect())

    def test_r26_not_applicable_and_context_isolation_never_pass(self) -> None:
        self.payload.update(release="R2026a", status="not_applicable", candidates=[],
                            skip_reason="old_release_experiment_only; retain existing exact exportgraphics strategy")
        self.write_report()
        result = self.inspect("R2026a")
        self.assertEqual(result["status"], "not_applicable", result["checks"])
        self.assertEqual(result["candidates"], [])
        self.assertEqual(self.inspect("R2026a", "display")["status"], "not_run")
        self.payload["release"] = "R2021a"
        self.write_report()
        self.assert_failed(self.inspect())

    def test_display_reads_only_fixed_context_and_checks_release(self) -> None:
        self.assertEqual(self.inspect(context="display")["status"], "not_run")
        display = self.artifacts / "display-comparison"
        display.mkdir()
        (self.artifacts / "native-pdf-page-probe").rename(display / "native-pdf-page-probe")
        result = self.inspect(context="display")
        self.assertEqual(result["status"], "declaration_consistent", result["checks"])
        self.assertEqual(self.inspect()["status"], "not_run")
        self.assert_failed(self.inspect("R2024b", "display"))

    def test_report_change_during_inspection_fails_final_snapshot_binding(self) -> None:
        original = inspector.read_snapshot
        changed = False

        def mutate_report(root: Path, relative: str, limit: int, retain: bool = False):
            nonlocal changed
            result = original(root, relative, limit, retain)
            if not changed and relative == inspector.REPORT:
                self.report_path.write_bytes(self.report_path.read_bytes() + b" ")
                changed = True
            return result

        with mock.patch.object(inspector, "read_snapshot", mutate_report):
            result = self.inspect()
        self.assert_failed(result)
        self.assertTrue(any(check["name"] == "snapshot_unchanged:" + inspector.REPORT
                            and check["status"] == "failed" for check in result["checks"]))

    def run_cli(self, *arguments: str) -> subprocess.CompletedProcess:
        return subprocess.run([sys.executable, "-B", str(MODULE_PATH), "--artifact-root", str(self.artifacts),
                               "--fixture-root", str(self.fixtures), "--release", "R2021a", "--context", "primary",
                               *arguments], capture_output=True, text=True, check=False)

    def test_cli_outputs_new_evidence_without_modifying_inputs_and_exit_states(self) -> None:
        before = self.fingerprint()
        output = self.workspace / "inspection.json"
        process = self.run_cli("--output", str(output))
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(json.loads(process.stdout), json.loads(output.read_text()))
        self.assertEqual(json.loads(process.stdout)["status"], "declaration_consistent")
        self.assertEqual(before, self.fingerprint())
        self.assertEqual(self.run_cli("--output", str(output)).returncode, 2)
        for forbidden in (self.report_path, self.fixtures / "evidence.json", self.artifacts / "evidence.json"):
            self.assertEqual(self.run_cli("--output", str(forbidden)).returncode, 2)
        linked = self.workspace / "linked.json"
        linked.symlink_to(self.report_path)
        self.assertEqual(self.run_cli("--output", str(linked)).returncode, 2)
        self.payload["counts_toward_stage"] = True
        self.write_report()
        self.assertEqual(self.run_cli().returncode, 1)
        self.report_path.unlink()
        process = self.run_cli()
        self.assertEqual(process.returncode, 2)
        self.assertEqual(json.loads(process.stdout)["status"], "not_run")
        self.payload.update(release="R2026a", status="not_applicable", counts_toward_stage=False, candidates=[],
                            skip_reason="old_release_experiment_only; retain existing exact exportgraphics strategy")
        self.write_report()
        process = self.run_cli("--release", "R2026a")
        self.assertEqual(process.returncode, 2, process.stderr)
        self.assertEqual(json.loads(process.stdout)["status"], "not_applicable")


if __name__ == "__main__":
    unittest.main()
