from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "validate_stage_status.py"
REPOSITORY_ROOT = MODULE_PATH.parents[3]
RUNNER_PATH = MODULE_PATH.parent.parent / "tests" / "run_github_full100.m"
SHELL_PATH = REPOSITORY_ROOT / "scripts" / "matlab-github-full100.sh"
SPEC = importlib.util.spec_from_file_location("stage_status", MODULE_PATH)
assert SPEC and SPEC.loader
stage_status = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(stage_status)


def recount(payload: dict) -> None:
    payload["summary"] = {
        "total": len(payload["stages"]),
        **{status: sum(stage["status"] == status for stage in payload["stages"])
           for status in stage_status.STATUSES},
    }


def synthetic_ledger(release: str = "R2021a") -> dict:
    """Producer-shaped synthetic declarations, not MATLAB execution evidence."""
    payload = {
        "schema_version": 1,
        "expected_release": release,
        "generated_at": "2026-09-06T00:02:00Z",
        "stages": [
            {"id": identifier, "status": "passed", "started_at": "2026-09-06T00:00:00Z",
             "completed_at": "2026-09-06T00:01:00Z",
             "error_identifier": "", "error_message": "", "error_report": ""}
            for identifier in stage_status.REQUIRED_STAGES
        ],
    }
    recount(payload)
    return payload


class StageStatusTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix="matlab-stage-status-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.path = self.root / "ci-stage-status.json"

    def write(self, payload: object) -> None:
        self.path.write_text(json.dumps(payload), encoding="utf-8")

    def reject(self, payload: object, reason: str) -> None:
        self.write(payload)
        with self.assertRaisesRegex(stage_status.StageStatusError, reason):
            stage_status.validate_stage_status(self.path, "R2021a")

    def test_required_stages_match_current_runner_declarations(self) -> None:
        source = RUNNER_PATH.read_text(encoding="utf-8")
        identifiers = re.findall(r'\brun_stage\(\s*stage_records,\s*"([^"]+)"', source)
        self.assertEqual(tuple(identifiers), stage_status.REQUIRED_STAGES)
        self.assertEqual(len(set(identifiers)), len(identifiers))

    def test_complete_schema_v1_ledgers_pass_for_all_ci_releases(self) -> None:
        for release in ("R2021a", "R2024b", "R2026a"):
            with self.subTest(release=release):
                payload = synthetic_ledger(release)
                self.write(payload)
                result = stage_status.validate_stage_status(self.path, release)
                self.assertEqual(result["status"], "passed")
                self.assertEqual(result["scope"], "stage_status_declaration_only")
                self.assertEqual(result["summary"], payload["summary"])
                self.assertEqual(result["required_stages"], list(stage_status.REQUIRED_STAGES))
                self.assertEqual(result["expected_release"], release)

    def test_stage_order_is_not_required_and_source_is_unchanged(self) -> None:
        payload = synthetic_ledger()
        payload["stages"].reverse()
        self.write(payload)
        original = self.path.read_bytes()
        result = stage_status.validate_stage_status(self.path, "R2021a")
        self.assertEqual(self.path.read_bytes(), original)
        self.assertEqual(result["source"], {
            "file": self.path.name, "bytes": len(original),
            "sha256": hashlib.sha256(original).hexdigest(),
        })

    def test_schema_version_requires_exact_integer_one(self) -> None:
        for value in (True, False, 1.0, "1", 0, 2, None, []):
            with self.subTest(value=value):
                payload = synthetic_ledger()
                payload["schema_version"] = value
                self.reject(payload, "schema_version")

    def test_declared_release_must_match_exactly(self) -> None:
        for value in ("R2024b", "r2021a", "R2021a ", None, True, ["R2021a"]):
            with self.subTest(value=value):
                payload = synthetic_ledger()
                payload["expected_release"] = value
                self.reject(payload, "expected_release mismatch")

    def test_invalid_expected_release_is_not_normalized(self) -> None:
        self.write(synthetic_ledger())
        for value in ("r2021a", "R2021A", "R2021a\n", " R2021a", "R2021", True, None):
            with self.subTest(value=value):
                with self.assertRaisesRegex(stage_status.StageStatusError, "expected_release"):
                    stage_status.validate_stage_status(self.path, value)

    def test_root_requires_exact_schema_fields_and_object(self) -> None:
        for value in (None, [], "passed", True):
            with self.subTest(value=value):
                self.reject(value, "stage ledger must be an object")
        for key in synthetic_ledger():
            with self.subTest(missing=key):
                payload = synthetic_ledger()
                del payload[key]
                self.reject(payload, "missing fields")
        for key in ("status", "error", "errors", "execution_verified"):
            with self.subTest(unknown=key):
                payload = synthetic_ledger()
                payload[key] = "passed"
                self.reject(payload, "unknown fields")

    def test_stages_require_array_of_exact_record_objects(self) -> None:
        for value in (None, {}, "passed", True):
            with self.subTest(stages=value):
                payload = synthetic_ledger()
                payload["stages"] = value
                self.reject(payload, "stages must be an array")
        for value in (None, [], "passed", True):
            with self.subTest(stage=value):
                payload = synthetic_ledger()
                payload["stages"][0] = value
                self.reject(payload, "must be an object")
        for key in synthetic_ledger()["stages"][0]:
            with self.subTest(missing=key):
                payload = synthetic_ledger()
                del payload["stages"][0][key]
                self.reject(payload, "missing fields")
        payload = synthetic_ledger()
        payload["stages"][0]["error"] = {"message": "hidden failure"}
        self.reject(payload, "unknown fields")

    def test_each_required_stage_is_required_even_with_adjusted_summary(self) -> None:
        for identifier in stage_status.REQUIRED_STAGES:
            with self.subTest(identifier=identifier):
                payload = synthetic_ledger()
                payload["stages"] = [stage for stage in payload["stages"] if stage["id"] != identifier]
                recount(payload)
                self.reject(payload, "missing required stages: " + identifier)

    def test_historical_partial_and_empty_ledgers_do_not_pass_current_gate(self) -> None:
        for length in (0, 7, 15, len(stage_status.REQUIRED_STAGES) - 1):
            with self.subTest(length=length):
                payload = synthetic_ledger()
                payload["stages"] = payload["stages"][:length]
                recount(payload)
                self.reject(payload, "missing required stages")

    def test_duplicate_stages_cannot_replace_missing_stages_or_inflate_total(self) -> None:
        for append in (False, True):
            with self.subTest(append=append):
                payload = synthetic_ledger()
                duplicate = copy.deepcopy(payload["stages"][0])
                if append:
                    payload["stages"].append(duplicate)
                else:
                    payload["stages"][-1] = duplicate
                recount(payload)
                self.reject(payload, "duplicate stage ID")

    def test_unknown_stage_ids_are_not_accepted(self) -> None:
        for value in ("unknown", "plot-regression ", "", None, True, [], {}):
            with self.subTest(value=value):
                payload = synthetic_ledger()
                payload["stages"][0]["id"] = value
                self.reject(payload, "unknown stage ID")

    def test_failed_stage_is_rejected_with_truthful_summary(self) -> None:
        payload = synthetic_ledger()
        stage = next(stage for stage in payload["stages"] if stage["id"] == "family-b-runtime")
        stage.update(status="failed", error_identifier="MATLAB:test", error_message="synthetic failure",
                     error_report="synthetic stack")
        recount(payload)
        self.reject(payload, r"stages not passed: family-b-runtime \(failed; MATLAB:test\)")

    def test_incomplete_and_unknown_statuses_never_pass(self) -> None:
        for value in ("pending", "running", "unknown", "skipped", "success", "Passed", None, True, [], {}):
            with self.subTest(value=value):
                payload = synthetic_ledger()
                payload["stages"][0]["status"] = value
                recount(payload)
                self.reject(payload, "stages not passed|unknown stage status")

    def test_passed_stage_requires_all_error_fields_to_be_empty_strings(self) -> None:
        for key in stage_status.ERROR_FIELDS:
            for value in ("failure", " ", "\n", None, False, 0, [], {}):
                with self.subTest(key=key, value=value):
                    payload = synthetic_ledger()
                    payload["stages"][0][key] = value
                    self.reject(payload, key)

    def test_summary_requires_exact_nonnegative_integer_fields(self) -> None:
        for value in (None, [], True, "passed"):
            with self.subTest(summary=value):
                payload = synthetic_ledger()
                payload["summary"] = value
                self.reject(payload, "summary must be an object")
        for key in synthetic_ledger()["summary"]:
            for value in (True, False, 0.0, 20.0, "0", -1, None, [], 9007199254740993):
                with self.subTest(key=key, value=value):
                    payload = synthetic_ledger()
                    payload["summary"][key] = value
                    self.reject(payload, "summary")
            payload = synthetic_ledger()
            del payload["summary"][key]
            self.reject(payload, "summary missing fields")
        payload = synthetic_ledger()
        payload["summary"]["unknown"] = 0
        self.reject(payload, "summary unknown fields")

    def test_summary_cannot_hide_failures_or_inflate_success(self) -> None:
        payload = synthetic_ledger()
        payload["stages"][0]["status"] = "failed"
        self.reject(payload, "summary does not match stage records")
        payload = synthetic_ledger()
        payload["summary"]["total"] += 1
        payload["summary"]["passed"] += 1
        self.reject(payload, "summary does not match stage records")

    def test_timestamps_require_producer_utc_format_and_valid_dates(self) -> None:
        for key in ("generated_at", "started_at", "completed_at"):
            for value in ("", "not-a-date", "2026-02-30T00:00:00Z", "2026-09-06T00:00:00+00:00",
                          "2026-9-6T0:0:0Z", None, True, 0, []):
                with self.subTest(key=key, value=value):
                    payload = synthetic_ledger()
                    target = payload if key == "generated_at" else payload["stages"][0]
                    target[key] = value
                    self.reject(payload, key)

    def test_timestamp_order_is_checked_but_equal_seconds_are_allowed(self) -> None:
        for key, value in (("started_at", "2026-09-06T00:01:01Z"),
                           ("completed_at", "2026-09-06T00:02:01Z")):
            payload = synthetic_ledger()
            payload["stages"][0][key] = value
            self.reject(payload, "timestamps must satisfy")
        payload = synthetic_ledger()
        for stage in payload["stages"]:
            stage["started_at"] = stage["completed_at"] = payload["generated_at"]
        self.write(payload)
        self.assertEqual(stage_status.validate_stage_status(self.path, "R2021a")["status"], "passed")

    def test_json_duplicate_keys_are_rejected_at_all_depths(self) -> None:
        for content in (
            '{"schema_version":1,"schema_version":1}',
            '{"summary":{"passed":20,"passed":0}}',
            '{"stages":[{"status":"failed","status":"passed"}]}',
            '{"stages":[{"error_message":"failure","error_message":""}]}',
            r'{"summary":{"passed":20,"\u0070assed":20}}',
        ):
            with self.subTest(content=content):
                self.path.write_text(content, encoding="utf-8")
                with self.assertRaisesRegex(stage_status.StageStatusError, "duplicate JSON key"):
                    stage_status.validate_stage_status(self.path, "R2021a")

    def test_nonfinite_json_values_and_overflow_are_rejected(self) -> None:
        for value in ("NaN", "Infinity", "-Infinity", "1e999", "-1e999"):
            with self.subTest(value=value):
                self.path.write_text('{"summary":{"passed":' + value + '}}', encoding="utf-8")
                with self.assertRaisesRegex(stage_status.StageStatusError, "nonfinite JSON number"):
                    stage_status.validate_stage_status(self.path, "R2021a")

    def test_malformed_json_and_encoding_are_rejected(self) -> None:
        for content in (b"", b"{", b"{} {}", b'{"value":"\xff"}'):
            with self.subTest(content=content):
                self.path.write_bytes(content)
                with self.assertRaisesRegex(stage_status.StageStatusError, "invalid stage JSON"):
                    stage_status.validate_stage_status(self.path, "R2021a")

    def test_missing_directory_and_symlink_inputs_are_rejected(self) -> None:
        self.write(synthetic_ledger())
        link = self.root / "linked.json"
        link.symlink_to(self.path)
        for path in (self.root / "missing.json", self.root, link):
            with self.subTest(path=path):
                with self.assertRaisesRegex(stage_status.StageStatusError, "regular file required"):
                    stage_status.validate_stage_status(path, "R2021a")

    def test_cli_emits_structured_success_and_failure_without_rewriting_input(self) -> None:
        for malformed in (False, True):
            with self.subTest(malformed=malformed):
                if malformed:
                    self.path.write_text('{"schema_version":1,"schema_version":1}', encoding="utf-8")
                else:
                    self.write(synthetic_ledger())
                original = self.path.read_bytes()
                completed = subprocess.run(
                    [sys.executable, str(MODULE_PATH), "--stage-status", str(self.path),
                     "--expected-release", "R2021a"], capture_output=True, text=True, timeout=10,
                )
                self.assertEqual(completed.returncode, 1 if malformed else 0, completed.stderr)
                result = json.loads(completed.stdout)
                self.assertEqual(result["status"], "failed" if malformed else "passed")
                self.assertEqual(result["scope"], stage_status.SCOPE)
                self.assertEqual(completed.stderr, "")
                self.assertEqual(self.path.read_bytes(), original)


class StageStatusShellTests(unittest.TestCase):
    """Real shell and stage validator; unrelated validators are synthetic stubs."""

    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix="matlab-stage-shell-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.repository = self.root / "repository"
        self.output = self.root / "output"
        self.output.mkdir()
        self.script = self.repository / "scripts" / SHELL_PATH.name
        validator = self.repository / MODULE_PATH.relative_to(REPOSITORY_ROOT)
        self.script.parent.mkdir(parents=True)
        validator.parent.mkdir(parents=True)
        shutil.copyfile(SHELL_PATH, self.script)
        shutil.copyfile(MODULE_PATH, validator)
        self.nonce = "synthetic-stage-shell-nonce-" * 2
        self.write_json("runtime-start.marker", {
            "schema_version": 1, "expected_release": "R2021a",
            "nonce_sha256": hashlib.sha256(self.nonce.encode()).hexdigest(),
        })
        self.write_json("matlab-runtime-probe.json", {"synthetic_stub": True})
        self.write_json("evaluator-runtime/matlab-runtime.json", {
            "runtime": "MathWorks MATLAB", "matlab_release": "R2021a", "success": True,
        })
        self.write_json("regression/run/figures.json", {"synthetic_stub": True})
        self.write_json("interaction-headless/headless-interaction-evidence.json", {"synthetic_stub": True})
        self.bin_directory = self.root / "bin"
        self.bin_directory.mkdir()
        python_wrapper = self.bin_directory / "python3"
        python_wrapper.write_text(f"#!{sys.executable}\n" + """import json
import os
import sys
from pathlib import Path

command = sys.argv[1]
if command == '-' or Path(command).name == 'validate_stage_status.py':
    os.execv(sys.executable, [sys.executable, *sys.argv[1:]])
if Path(command).name not in {'evaluate.py', 'inspect_rendered_artifacts.py', 'build_ocean_report.py'}:
    raise RuntimeError('unexpected stubbed command')
if Path(command).name == 'evaluate.py':
    Path(sys.argv[sys.argv.index('--result') + 1]).write_text(json.dumps({'synthetic_stub': True}))
if Path(command).name == 'inspect_rendered_artifacts.py':
    manifest = Path(sys.argv[sys.argv.index('--manifest') + 1])
    artifact_root = Path(sys.argv[sys.argv.index('--artifact-root') + 1])
    if artifact_root.parts[-2:] == ('regression', 'run'):
        assert manifest == artifact_root / 'figures.json'
        status = os.environ.get('SYNTHETIC_REGRESSION_EXTERNAL_STATUS', 'passed')
        output = Path(sys.argv[sys.argv.index('--output') + 1])
        output.write_text(json.dumps({'synthetic_stub': True, 'status': status,
                                     'manifest': str(manifest), 'artifact_root': str(artifact_root)}))
        print(json.dumps({'synthetic_stub': True, 'status': status}))
        sys.exit({'passed': 0, 'failed': 1, 'not_verified': 2}[status])
print(json.dumps({'synthetic_stub': True}))
""", encoding="utf-8")
        python_wrapper.chmod(0o755)
        node_wrapper = self.bin_directory / "node"
        node_wrapper.write_text(f"#!{sys.executable}\n" + """import json
import os
import sys
from pathlib import Path

source = sys.stdin.read()
if '--input-type=module' in sys.argv:
    assert "validationMode: 'runtime-artifacts'" in source
    for option in ('requireMatlab', 'requireSvg', 'requireRuntimeContract', 'requireScienceContract',
                   'requirePublicationContract', 'requireInteractionContract', 'requireEmbeddedPngDpi'):
        assert option + ': true' in source
    status = os.environ.get('SYNTHETIC_REGRESSION_STATUS', 'passed')
    payload = {'synthetic_stub': True, 'validationMode': 'runtime-artifacts',
               'scope': 'automated_runtime_and_artifacts_only', 'status': status, 'runtime': status,
               'visualInspection': 'pending', 'baseline': 'pending', 'publication': 'pending',
               'imageRegressionOk': False, 'visualInspectionVerified': False, 'regressionOk': False}
    Path(sys.argv[-1]).write_text(json.dumps(payload))
    print(json.dumps(payload))
    sys.exit(0 if status == 'passed' else 1)
print(json.dumps({'synthetic_stub': True}))
""", encoding="utf-8")
        node_wrapper.chmod(0o755)

    def write_json(self, name: str, payload: dict) -> Path:
        path = self.output / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload), encoding="utf-8")
        return path

    def run_shell(self, **overrides) -> subprocess.CompletedProcess:
        environment = os.environ.copy()
        environment["PATH"] = str(self.bin_directory) + os.pathsep + environment.get("PATH", "")
        environment["GITHUB_STEP_SUMMARY"] = str(self.output / "step-summary.md")
        environment.update(overrides)
        return subprocess.run(
            ["bash", str(self.script), "R2021a", str(self.output), self.nonce,
             str(self.output / "runtime-start.marker")], cwd=self.repository, env=environment,
            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=30,
        )

    def test_valid_ledger_adds_distinct_file_and_content_checks(self) -> None:
        self.write_json("ci-stage-status.json", synthetic_ledger())
        completed = self.run_shell()
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        summary = json.loads((self.output / "ci-validation-summary.json").read_text())
        checks = {check["id"]: check["status"] for check in summary["checks"]}
        self.assertEqual(checks["stage-status-file"], "passed")
        self.assertEqual(checks["stage-status-content"], "passed")
        self.assertEqual(summary["status"], "passed")

    def test_failed_stage_alone_fails_summary_and_preserves_later_evidence(self) -> None:
        payload = synthetic_ledger()
        payload["stages"][0].update(status="failed", error_identifier="synthetic:failure")
        recount(payload)
        path = self.write_json("ci-stage-status.json", payload)
        original = path.read_bytes()
        completed = self.run_shell()
        self.assertEqual(completed.returncode, 1, completed.stdout + completed.stderr)
        summary = json.loads((self.output / "ci-validation-summary.json").read_text())
        checks = {check["id"]: check["status"] for check in summary["checks"]}
        self.assertEqual(summary["status"], "failed")
        self.assertEqual(checks["stage-status-file"], "passed")
        self.assertEqual(checks["stage-status-content"], "failed")
        self.assertEqual(checks["evaluator-runtime"], "passed")
        self.assertEqual(checks["rendered-artifacts"], "passed")
        self.assertEqual(checks["ocean-report"], "passed")
        self.assertEqual(len(summary["failures"]), 1)
        self.assertIn("stage-status-content", summary["failures"][0])
        self.assertNotIn("runtime_passed_visual_pending", completed.stdout)
        self.assertEqual(path.read_bytes(), original)
        inventory = json.loads((self.output / "artifact-inventory.json").read_text())
        entries = {entry["path"]: entry for entry in inventory["files"]}
        self.assertIn("stage-status-content.log", entries)
        self.assertIn("ci-validation-summary.json", entries)
        self.assertEqual(entries["ci-stage-status.json"]["sha256"], hashlib.sha256(original).hexdigest())
        result = json.loads((self.output / "stage-status-content.log").read_text())
        self.assertEqual(result["status"], "failed")

    def test_missing_and_malformed_ledgers_still_collect_evidence(self) -> None:
        for content in (None, b'{"schema_version":1,"schema_version":1}'):
            with self.subTest(content=content):
                if content is not None:
                    (self.output / "ci-stage-status.json").write_bytes(content)
                completed = self.run_shell()
                self.assertEqual(completed.returncode, 1, completed.stdout + completed.stderr)
                summary = json.loads((self.output / "ci-validation-summary.json").read_text())
                checks = {check["id"]: check["status"] for check in summary["checks"]}
                self.assertEqual(checks["stage-status-file"], "failed" if content is None else "passed")
                self.assertEqual(checks["stage-status-content"], "failed")
                self.assertEqual(checks["ocean-report"], "passed")
                self.assertTrue((self.output / "artifact-inventory.json").is_file())

    def test_runtime_mode_summary_keeps_visual_and_baseline_pending(self) -> None:
        self.write_json("ci-stage-status.json", synthetic_ledger())
        completed = self.run_shell()
        self.assertEqual(completed.returncode, 0, completed.stderr)
        summary = json.loads((self.output / "ci-validation-summary.json").read_text())
        self.assertEqual(summary["regression"]["runtime"], "passed")
        for key in ("visualInspection", "baseline", "publication"):
            self.assertEqual(summary["regression"][key], "pending")
        for key in ("imageRegressionOk", "visualInspectionVerified", "regressionOk"):
            self.assertIs(summary["regression"][key], False)
        markdown = (self.output / "step-summary.md").read_text()
        self.assertIn("Regression runtime/artifacts: `passed`", markdown)
        self.assertIn("Visual inspection: `pending`", markdown)
        self.assertIn("Image baseline: `pending`", markdown)
        checks = {check["id"]: check["status"] for check in summary["checks"]}
        self.assertEqual(checks["regression-rendered-artifacts"], "passed")
        external = json.loads((self.output / "regression-rendered-artifact-evidence.json").read_text())
        self.assertEqual(external["artifact_root"], str(self.output / "regression/run"))

    def test_regression_failure_still_collects_full_external_and_evaluator_evidence(self) -> None:
        self.write_json("ci-stage-status.json", synthetic_ledger())
        completed = self.run_shell(SYNTHETIC_REGRESSION_STATUS="failed")
        self.assertEqual(completed.returncode, 1, completed.stderr)
        summary = json.loads((self.output / "ci-validation-summary.json").read_text())
        checks = {check["id"]: check["status"] for check in summary["checks"]}
        self.assertEqual(checks["regression-contract"], "failed")
        for name in ("regression-rendered-artifacts", "evaluator-runtime", "rendered-artifacts", "ocean-report"):
            self.assertEqual(checks[name], "passed")
        self.assertEqual(summary["regression"]["runtime"], "failed")
        self.assertNotIn("MATLAB_FULL100_STATUS=runtime_passed", completed.stdout)

    def test_regression_external_failure_or_missing_tool_cannot_become_visual_pending_success(self) -> None:
        self.write_json("ci-stage-status.json", synthetic_ledger())
        for status in ("failed", "not_verified"):
            with self.subTest(status=status):
                completed = self.run_shell(SYNTHETIC_REGRESSION_EXTERNAL_STATUS=status)
                self.assertEqual(completed.returncode, 1, completed.stderr)
                summary = json.loads((self.output / "ci-validation-summary.json").read_text())
                checks = {check["id"]: check["status"] for check in summary["checks"]}
                self.assertEqual(summary["status"], "failed")
                self.assertEqual(checks["regression-contract"], "passed")
                self.assertEqual(checks["regression-rendered-artifacts"], "failed")
                self.assertEqual(summary["regression"]["contractStatus"], "passed")
                self.assertEqual(summary["regression"]["runtime"], "failed")
                self.assertEqual(summary["regression"]["externalArtifacts"], "failed")
                self.assertEqual(checks["ocean-report"], "passed")
                self.assertEqual(len(summary["failures"]), 1)
                self.assertIn("regression-rendered-artifacts", summary["failures"][0])
                inventory = json.loads((self.output / "artifact-inventory.json").read_text())
                files = {entry["path"] for entry in inventory["files"]}
                self.assertIn("regression-rendered-artifact-evidence.json", files)
                self.assertIn("evaluator-result.json", files)


if __name__ == "__main__":
    unittest.main()
