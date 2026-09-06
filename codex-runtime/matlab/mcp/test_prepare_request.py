import base64
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


DIRECTORY = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("prepare_request", DIRECTORY / "prepare_request.py")
PREPARE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PREPARE)


def encoded(content):
    return base64.b64encode(content).decode("ascii")


class PrepareRequestTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.parent = Path(self.temporary.name)
        self.root = self.parent / "execution"
        self.archive = self.parent / "archive"
        self.code = b"fprintf('native MATLAB request\\n');\n"
        self.environ = {
            "MATLAB_EXECUTION_ROOT": str(self.root),
            "MATLAB_ARTIFACT_ROOT": str(self.archive),
            "MATLAB_PROJECT_ROOT": str(DIRECTORY.parents[2]),
            "MATLAB_REQUEST_ID": "ab96e060-75b1-4abe-9c6f-920270e0f470",
            "MATLAB_REQUESTED_RELEASE": "R2026a",
            "MATLAB_CODE_BASE64": encoded(self.code),
            "MATLAB_CODE_SHA256": PREPARE.sha256(self.code),
            "MATLAB_INPUT_JSON_BASE64": "",
            "GITHUB_RUN_ID": "123456789", "GITHUB_RUN_ATTEMPT": "2",
            "GITHUB_SHA": "a" * 40,
        }

    def native_receipt(self, **changes):
        receipt = json.loads((self.root / "execution.json").read_text())
        receipt.update(status="succeeded", matlab_started=True, code_started=True,
                       code_completed=True, matlab_release="R2026a", matlab_version="26.1.0",
                       started_at="2026-09-06T01:00:00.000Z", finished_at="2026-09-06T01:00:01.000Z")
        receipt.update(changes)
        PREPARE.write_json(self.root / "execution.json", receipt)
        self.environ["MATLAB_STEP_OUTCOME"] = "success"

    def test_prepare_preserves_code_bytes_and_no_input_is_fabricated(self):
        receipt = PREPARE.prepare(self.environ)
        self.assertEqual(receipt["status"], "prepared")
        self.assertEqual((self.root / "code.m").read_bytes(), self.code)
        self.assertEqual((self.root / "outputs/request_code.m").read_bytes(), self.code)
        self.assertFalse((self.root / "outputs/input.json").exists())
        self.assertFalse(receipt["matlab_started"])

    def test_unicode_code_and_json_bytes_preserved(self):
        code = "fprintf('\u6e29\u5ea6\\n');".encode("utf-8")
        content = b' {"value": [1, null], "name": "\\u6e29"}\n'
        self.environ.update(MATLAB_CODE_BASE64=encoded(code), MATLAB_CODE_SHA256=PREPARE.sha256(code),
                            MATLAB_INPUT_JSON_BASE64=encoded(content))
        PREPARE.prepare(self.environ)
        self.assertEqual((self.root / "code.m").read_bytes(), code)
        self.assertEqual((self.root / "outputs/input.json").read_bytes(), content)

    def test_all_supported_releases(self):
        for release in PREPARE.RELEASES:
            with self.subTest(release=release):
                self.environ["MATLAB_REQUESTED_RELEASE"] = release
                metadata, _, _ = PREPARE.validate_request(self.environ)
                self.assertEqual(metadata["requested_release"], release)

    def test_code_size_limit_counts_utf8_bytes(self):
        for content, allowed in [(b"a" * 32768, True), (b"a" * 32769, False),
                                 ("\u6e29" * 10923, False)]:
            if isinstance(content, str):
                content = content.encode("utf-8")
            self.environ.update(MATLAB_CODE_BASE64=encoded(content), MATLAB_CODE_SHA256=PREPARE.sha256(content))
            if allowed:
                PREPARE.validate_request(self.environ)
            else:
                with self.assertRaises(PREPARE.RequestError):
                    PREPARE.validate_request(self.environ)

    def test_strict_base64_and_utf8_rejections(self):
        for value in ["", "%%%", "YQ==\n", "YQ===", "YR==", "_w==", encoded(b"\xff"), encoded(b"a\0b")]:
            with self.subTest(value=value), self.assertRaises(PREPARE.RequestError):
                PREPARE.validate_request(dict(self.environ, MATLAB_CODE_BASE64=value))

    def test_wrong_hash_uuid_and_release_rejected(self):
        for key, values in {
            "MATLAB_CODE_SHA256": ["b" * 64, "g" * 64, "short"],
            "MATLAB_REQUEST_ID": ["../escape", "$(touch injected)", "ab96e06075b14abe9c6f920270e0f470", ""],
            "MATLAB_REQUESTED_RELEASE": ["2021a", "R9.10.0 (R2021a)", "R2025a"],
        }.items():
            for value in values:
                with self.subTest(key=key, value=value), self.assertRaises(PREPARE.RequestError):
                    PREPARE.validate_request(dict(self.environ, **{key: value}))

    def test_strict_json_rejects_nonfinite_duplicate_and_unicode(self):
        for content in [b'{"value":1,"value":2}', b'{"value":NaN}', b'Infinity', b'1e999',
                        b'{"value":"\\ud800"}', b'{"\\ud800":1}', b'{bad}', b'\xff']:
            with self.subTest(content=content), self.assertRaises(PREPARE.RequestError):
                PREPARE.validate_request(dict(self.environ, MATLAB_INPUT_JSON_BASE64=encoded(content)))

    def test_json_scalar_and_size_boundary(self):
        for content in [b"null", b"false", b"42", b'"' + b"a" * 16382 + b'"']:
            PREPARE.validate_request(dict(self.environ, MATLAB_INPUT_JSON_BASE64=encoded(content)))
        with self.assertRaises(PREPARE.RequestError):
            PREPARE.validate_request(dict(self.environ, MATLAB_INPUT_JSON_BASE64=encoded(b'"' + b"a" * 16383 + b'"')))

    def test_existing_directory_is_not_modified(self):
        self.root.mkdir()
        marker = self.root / "keep"
        marker.write_bytes(b"original")
        with self.assertRaises(PREPARE.RequestError):
            PREPARE.prepare(self.environ)
        self.assertEqual(marker.read_bytes(), b"original")
        self.assertFalse(self.archive.exists())

    def test_invalid_request_leaves_failure_receipt(self):
        self.environ["MATLAB_CODE_SHA256"] = "0" * 64
        with self.assertRaises(PREPARE.RequestError):
            PREPARE.prepare(self.environ)
        receipt = json.loads((self.archive / "execution.json").read_text())
        self.assertEqual(receipt["status"], "failed")
        self.assertEqual(receipt["matlab_release"], "")

    def test_no_matlab_cannot_become_success(self):
        PREPARE.prepare(self.environ)
        self.environ["MATLAB_STEP_OUTCOME"] = "skipped"
        result = PREPARE.finalize(self.environ)
        self.assertEqual(result["status"], "failed")
        self.assertFalse(result["matlab_started"])
        self.assertTrue((self.archive / "diary.log").is_file())

    def test_process_exit_without_completion_fails(self):
        PREPARE.prepare(self.environ)
        self.native_receipt(status="running", code_completed=False)
        result = PREPARE.finalize(self.environ)
        self.assertEqual(result["status"], "failed")

    def test_interrupted_receipt_write_retains_request_identity(self):
        PREPARE.prepare(self.environ)
        (self.root / "execution.json").write_bytes(b'{"status":')
        self.environ["MATLAB_STEP_OUTCOME"] = "failure"
        result = PREPARE.finalize(self.environ)
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["request_id"], self.environ["MATLAB_REQUEST_ID"])
        self.assertEqual(result["code_sha256"], self.environ["MATLAB_CODE_SHA256"])
        self.assertEqual(result["ci_run_id"], self.environ["GITHUB_RUN_ID"])
        self.assertFalse(result["matlab_started"])

    def test_timeout_overrides_claimed_success(self):
        PREPARE.prepare(self.environ)
        self.native_receipt()
        self.environ["MATLAB_STEP_OUTCOME"] = "failure"
        self.assertEqual(PREPARE.finalize(self.environ)["status"], "failed")

    def test_success_receipt_artifact_hashes_and_false_certification(self):
        PREPARE.prepare(self.environ)
        self.native_receipt(analysis_verified=True, visual_verified=True)
        output = self.root / "outputs/result.json"
        output.write_bytes(b'{"value":4}')
        (self.root / "outputs/empty.txt").write_bytes(b"")
        result = PREPARE.finalize(self.environ)
        self.assertEqual(result["status"], "succeeded")
        self.assertFalse(result["analysis_verified"])
        self.assertFalse(result["visual_verified"])
        declared = {artifact["file"] for artifact in result["artifacts"]}
        archived = {path.relative_to(self.archive).as_posix() for path in self.archive.rglob("*") if path.is_file()}
        self.assertEqual(archived, declared | {"execution.json"})
        self.assertIn("request.json", declared)
        for artifact in result["artifacts"]:
            content = (self.archive / artifact["file"]).read_bytes()
            self.assertEqual(artifact["sha256"], PREPARE.sha256(content))
            self.assertEqual(artifact["bytes"], len(content))
            self.assertFalse(Path(artifact["file"]).is_absolute())

    def test_runtime_release_and_boolean_evidence_are_strict(self):
        PREPARE.prepare(self.environ)
        self.native_receipt()
        valid = json.loads((self.root / "execution.json").read_text())
        request = json.loads((self.root / "request.json").read_text())
        PREPARE.validate_result(valid, request, self.environ, self.root)
        for changes in [{"matlab_release": "R9.10.0 (R2021a)"}, {"matlab_release": "R2021a"},
                        {"code_completed": 1}, {"code_started": "true"}, {"matlab_started": False},
                        {"started_at": "not-a-dateZ"}, {"finished_at": "2026-09-06T00:59:59Z"},
                        {"started_at": "2026-09-06T01:00:00+00:00"}, {"matlab_version": ""},
                        {"schema_version": True}, {"source_files": []},
                        {"error": {"identifier": "Failure", "message": "failed", "stack": []}}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                PREPARE.validate_result(dict(valid, **changes), request, self.environ, self.root)

    def test_timestamp_comparison_uses_parsed_instants(self):
        PREPARE.prepare(self.environ)
        self.native_receipt(started_at="2026-09-06T01:00:00Z", finished_at="2026-09-06T01:00:00.100Z")
        self.assertEqual(PREPARE.finalize(self.environ)["status"], "succeeded")

    def test_all_receipt_identity_fields_are_bound(self):
        PREPARE.prepare(self.environ)
        self.native_receipt()
        receipt = json.loads((self.root / "execution.json").read_text())
        request = json.loads((self.root / "request.json").read_text())
        for field in ("request_id", "requested_release", "code_sha256", "ci_run_id", "run_attempt", "commit"):
            with self.subTest(field=field), self.assertRaises(PREPARE.RequestError):
                PREPARE.validate_result(dict(receipt, **{field: "changed"}), request, self.environ, self.root)

    def test_input_changes_rejected_and_original_snapshot_retained(self):
        content = b'{"value":1}'
        self.environ["MATLAB_INPUT_JSON_BASE64"] = encoded(content)
        PREPARE.prepare(self.environ)
        self.native_receipt()
        (self.root / "outputs/input.json").write_bytes(b'{"value":2}')
        self.assertEqual(PREPARE.finalize(self.environ)["status"], "failed")
        self.assertEqual((self.archive / "input.json").read_bytes(), content)

    def test_native_failure_keeps_error_and_partial_output(self):
        PREPARE.prepare(self.environ)
        error = {"identifier": "request:Intentional", "message": "native failure", "stack": []}
        self.native_receipt(status="failed", error=error, code_completed=False)
        self.environ["MATLAB_STEP_OUTCOME"] = "failure"
        (self.root / "outputs/partial.txt").write_bytes(b"before error")
        result = PREPARE.finalize(self.environ)
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["error"], error)
        self.assertEqual((self.archive / "outputs/partial.txt").read_bytes(), b"before error")

    def test_modified_code_is_rejected(self):
        PREPARE.prepare(self.environ)
        self.native_receipt()
        (self.root / "outputs/request_code.m").write_bytes(b"disp('changed');")
        self.assertEqual(PREPARE.finalize(self.environ)["status"], "failed")

    def test_symlink_output_is_not_followed_or_archived(self):
        PREPARE.prepare(self.environ)
        self.native_receipt()
        outside = self.parent / "private"
        outside.write_bytes(b"not an output")
        (self.root / "outputs/link.txt").symlink_to(outside)
        self.assertEqual(PREPARE.finalize(self.environ)["status"], "failed")
        self.assertFalse((self.archive / "outputs/link.txt").exists())

    def test_symlink_directory_fails_but_keeps_diary(self):
        PREPARE.prepare(self.environ)
        self.native_receipt()
        (self.root / "diary.log").write_bytes(b"native diagnostic")
        (self.root / "outputs/link").symlink_to(self.parent, target_is_directory=True)
        self.assertEqual(PREPARE.finalize(self.environ)["status"], "failed")
        self.assertEqual((self.archive / "diary.log").read_bytes(), b"native diagnostic")

    def test_hard_links_and_special_files_rejected(self):
        ordinary = self.parent / "ordinary"
        ordinary.write_bytes(b"data")
        linked = self.parent / "hardlink"
        os.link(ordinary, linked)
        fifo = self.parent / "fifo"
        os.mkfifo(fifo)
        for path in (linked, fifo):
            with self.subTest(path=path), self.assertRaises(PREPARE.RequestError):
                PREPARE.regular_bytes(path)

    def test_oversize_rejected_before_open(self):
        path = self.parent / "large.bin"
        with path.open("wb") as stream:
            stream.truncate(PREPARE.ARTIFACT_BYTE_LIMIT + 1)
        with mock.patch.object(PREPARE.os, "open", side_effect=AssertionError("must not open")):
            with self.assertRaisesRegex(PREPARE.RequestError, "byte limit"):
                PREPARE.regular_bytes(path)

    def test_large_output_fails_with_receipt_and_bounded_diary(self):
        PREPARE.prepare(self.environ)
        self.native_receipt()
        (self.root / "diary.log").write_bytes(b"native diagnostic")
        with (self.root / "outputs/large.bin").open("wb") as stream:
            stream.truncate(PREPARE.ARTIFACT_BYTE_LIMIT + 1)
        result = PREPARE.finalize(self.environ)
        self.assertEqual(result["status"], "failed")
        self.assertIn("large.bin", result["error"]["message"])
        self.assertEqual((self.archive / "diary.log").read_bytes(), b"native diagnostic")
        self.assertFalse((self.archive / "outputs/large.bin").exists())

    def test_large_diary_fails_without_unbounded_read(self):
        PREPARE.prepare(self.environ)
        self.native_receipt()
        with (self.root / "diary.log").open("wb") as stream:
            stream.truncate(PREPARE.ARTIFACT_BYTE_LIMIT + 1)
        result = PREPARE.finalize(self.environ)
        self.assertEqual(result["status"], "failed")
        self.assertIn("diary.log", result["error"]["message"])
        self.assertTrue((self.archive / "execution.json").is_file())
        self.assertEqual((self.archive / "diary.log").read_bytes(), b"")
        self.assertEqual(result["diary_capture"]["status"], "not_archived")
        self.assertIn("diary.log", {artifact["file"] for artifact in result["artifacts"]})

    def test_unsafe_output_paths_are_rejected(self):
        for path in ("outputs/../escape", "outputs/back\\slash", "outputs/drive:name", "outputs/control\nname",
                     "outputs/" + "part/" * 16 + "file.txt", "outputs/" + "a" * 256):
            with self.subTest(path=path), self.assertRaises(PREPARE.RequestError):
                PREPARE.validate_artifact_path(path)
        PREPARE.validate_artifact_path("outputs/nested/result.json")

    def test_invalid_request_finalization_keeps_bindable_diagnostic_archive(self):
        self.environ["MATLAB_CODE_BASE64"] = "invalid"
        with self.assertRaises(PREPARE.RequestError):
            PREPARE.prepare(self.environ)
        self.environ["MATLAB_STEP_OUTCOME"] = "skipped"
        result = PREPARE.finalize(self.environ)
        self.assertEqual(result["status"], "failed")
        self.assertEqual({artifact["file"] for artifact in result["artifacts"]}, {"diary.log"})

    def test_total_output_budget_rejects_before_reading_outputs(self):
        PREPARE.prepare(self.environ)
        self.native_receipt()
        for filename in ("first.bin", "second.bin", "third.bin", "fourth.bin"):
            with (self.root / "outputs" / filename).open("wb") as stream:
                stream.truncate(PREPARE.ARTIFACT_BYTE_LIMIT)
        result = PREPARE.finalize(self.environ)
        self.assertEqual(result["status"], "failed")
        self.assertIn("total-byte limit", result["error"]["message"])
        self.assertFalse((self.archive / "outputs/first.bin").exists())
        self.assertTrue((self.archive / "diary.log").is_file())

    def test_file_count_budget_and_nested_output(self):
        PREPARE.prepare(self.environ)
        self.native_receipt()
        nested = self.root / "outputs/nested"
        nested.mkdir()
        for index in range(PREPARE.ARTIFACT_FILE_LIMIT):
            (nested / f"{index}.txt").write_bytes(b"")
        result = PREPARE.finalize(self.environ)
        self.assertEqual(result["status"], "failed")
        self.assertIn("file-count limit", result["error"]["message"])
        self.assertTrue((self.archive / "diary.log").is_file())

    def test_cli_failure_exit_and_machine_receipt(self):
        self.environ["MATLAB_CODE_BASE64"] = "invalid"
        result = subprocess.run([sys.executable, str(DIRECTORY / "prepare_request.py"), "prepare"],
                                env=dict(os.environ, **self.environ), capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads((self.root / "execution.json").read_text())["status"], "failed")


if __name__ == "__main__":
    unittest.main()
