from __future__ import annotations

import copy
import importlib.util
import io
import json
import os
import struct
import sys
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).resolve().parents[1] / "evaluate.py"
SPEC = importlib.util.spec_from_file_location("matlab_eval", MODULE_PATH)
assert SPEC and SPEC.loader
matlab_eval = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(matlab_eval)


class JSONParsingTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix="matlab-evaluator-json-")
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "input.json"

    def test_duplicate_keys_are_rejected_at_every_depth(self) -> None:
        for content in (
            '{"score": 0, "score": 100}',
            '{"checks": [{"score": 0, "score": 100}]}',
            '{"score": 100, "score": 100}',
            '[{"checks": {"score": 100, "score": 100}}]',
            r'{"score": 0, "\u0073core": 100}',
        ):
            with self.subTest(content=content):
                self.path.write_text(content, encoding="utf-8")
                with self.assertRaisesRegex(matlab_eval.EvaluationError, "duplicate JSON key: 'score'") as caught:
                    matlab_eval.load_json(self.path)
                self.assertIn(str(self.path), str(caught.exception))

    def test_nonstandard_numeric_constants_are_rejected(self) -> None:
        for token in ("NaN", "Infinity", "-Infinity"):
            for content in (token, f"[{token}]", '{"checks": [{"value": ' + token + '}]}'):
                with self.subTest(content=content):
                    self.path.write_text(content, encoding="utf-8")
                    with self.assertRaisesRegex(matlab_eval.EvaluationError, "non-finite JSON number") as caught:
                        matlab_eval.load_json(self.path)
                    self.assertIn(token, str(caught.exception))
                    self.assertIn(str(self.path), str(caught.exception))

    def test_valid_unicode_and_numeric_values_are_preserved(self) -> None:
        payload = {
            "\u6e29\u5ea6": "\u00b0C / \U0001f30a",
            "values": [0, -12, 9007199254740993, 1.25, 6.02e23, 1e-200, True, False, None],
            "strings": ["NaN", "Infinity", "-Infinity"],
            "independent_objects": [{"id": 1}, {"id": 2}],
        }
        for ensure_ascii in (False, True):
            with self.subTest(ensure_ascii=ensure_ascii):
                self.path.write_text(json.dumps(payload, ensure_ascii=ensure_ascii), encoding="utf-8")
                actual = matlab_eval.load_json(self.path)
                self.assertEqual(actual, payload)
                self.assertEqual([type(value) for value in actual["values"]],
                                 [type(value) for value in payload["values"]])

    def test_standard_top_level_values_remain_supported(self) -> None:
        for content, expected in (("null", None), ("true", True), ("123", 123),
                                  ("1.25", 1.25), ('"NaN"', "NaN"), ("[]", []), ("{}", {})):
            with self.subTest(content=content):
                self.path.write_text(content, encoding="utf-8")
                actual = matlab_eval.load_json(self.path)
                self.assertEqual(actual, expected)
                self.assertIs(type(actual), type(expected))

    def test_invalid_syntax_and_encoding_raise_evaluation_error(self) -> None:
        for content in (b'{"value":', b'{"value": "\xff"}'):
            with self.subTest(content=content):
                self.path.write_bytes(content)
                with self.assertRaisesRegex(matlab_eval.EvaluationError, "invalid JSON") as caught:
                    matlab_eval.load_json(self.path)
                self.assertIn(str(self.path), str(caught.exception))

    def test_cli_returns_failure_for_ambiguous_json(self) -> None:
        result_path = self.path.with_name("result.json")
        for content, reason in (
            ('{"gates": [], "gates": []}', "duplicate JSON key"),
            ('{"gates": [], "value": NaN}', "non-finite JSON number"),
            ('{"gates": [], "value": Infinity}', "non-finite JSON number"),
            ('{"gates": [], "value": -Infinity}', "non-finite JSON number"),
        ):
            with self.subTest(content=content):
                self.path.write_text(content, encoding="utf-8")
                with mock.patch.object(matlab_eval, "RUBRIC_PATH", self.path), \
                        mock.patch("sys.argv", [str(MODULE_PATH), "--runtime", "skip", "--skip-tests",
                                                "--result", str(result_path)]), \
                        mock.patch("sys.stdout", new_callable=io.StringIO) as stdout, \
                        mock.patch("sys.stderr", new_callable=io.StringIO) as stderr:
                    self.assertEqual(matlab_eval.main(), 1)
                self.assertEqual(stdout.getvalue(), "")
                failure = json.loads(stderr.getvalue())
                self.assertEqual(failure["status"], "failed")
                self.assertIn(reason, failure["error"])
                self.assertIn(str(self.path), failure["error"])
                self.assertFalse(result_path.exists())


class FixtureValidationTests(unittest.TestCase):
    def test_all_repository_fixtures_pass(self) -> None:
        results = [matlab_eval.validate_fixture(path) for path in sorted(matlab_eval.FIXTURE_ROOT.glob("*.json"))]
        self.assertGreaterEqual(len(results), 3)
        self.assertTrue(all(result["status"] == "passed" for result in results))
        self.assertTrue(all(result["time_count"] >= 2 and result["depth_count"] >= 2 for result in results))

    def test_time_depth_confounding_is_rejected(self) -> None:
        source = matlab_eval.load_json(matlab_eval.FIXTURE_ROOT / "paired_observation_model.json")
        broken = copy.deepcopy(source)
        broken["records"] = broken["records"][::4]
        broken["design"]["expected_pair_count"] = len(broken["records"])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "confounded.json"
            path.write_text(json.dumps(broken), encoding="utf-8")
            with self.assertRaisesRegex(matlab_eval.EvaluationError, "fully_crossed|combination|crossing"):
                matlab_eval.validate_fixture(path)

    def test_duplicate_stable_ids_are_rejected(self) -> None:
        source = matlab_eval.load_json(matlab_eval.FIXTURE_ROOT / "paired_observation_model.json")
        broken = copy.deepcopy(source)
        broken["records"][1]["id"] = broken["records"][0]["id"]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "duplicate.json"
            path.write_text(json.dumps(broken), encoding="utf-8")
            with self.assertRaisesRegex(matlab_eval.EvaluationError, "duplicate stable identifier"):
                matlab_eval.validate_fixture(path)

    def test_uncertainty_mask_must_align(self) -> None:
        source = matlab_eval.load_json(matlab_eval.FIXTURE_ROOT / "crossed_time_depth_temperature.json")
        broken = copy.deepcopy(source)
        broken["variables"]["temperature_standard_uncertainty"]["values"][0][0] = None
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "mask.json"
            path.write_text(json.dumps(broken), encoding="utf-8")
            with self.assertRaisesRegex(matlab_eval.EvaluationError, "missing masks"):
                matlab_eval.validate_fixture(path)


class AntiCheatTests(unittest.TestCase):
    def test_comments_and_strings_do_not_satisfy_static_tokens(self) -> None:
        source = "% oi_write_manifest\nlabel = 'oi_export_figure';\nactual_call(data);\n"
        stripped = matlab_eval.strip_matlab_comments_and_strings(source)
        self.assertNotIn("oi_write_manifest", stripped)
        self.assertNotIn("oi_export_figure", stripped)
        self.assertIn("actual_call", stripped)

    def test_nested_score_claim_is_not_a_scoring_input(self) -> None:
        rubric = matlab_eval.load_json(matlab_eval.RUBRIC_PATH)
        weights = {gate["id"]: gate["weight"] for gate in rubric["gates"]}
        forged = {"metadata": {"score": 100, "status": "passed"}}
        trusted_status = {identifier: "pending" for identifier in weights}
        computed = sum(weights[identifier] for identifier, status in trusted_status.items() if status == "passed")
        self.assertEqual(computed, 0)
        self.assertEqual(forged["metadata"]["score"], 100)

    def test_invalid_artifact_signature_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fake.png"
            path.write_text("not a png", encoding="utf-8")
            with self.assertRaisesRegex(matlab_eval.EvaluationError, "signature"):
                matlab_eval.artifact_signature(path)

    def test_rubric_weights_and_result_shape_are_strict(self) -> None:
        rubric = matlab_eval.load_json(matlab_eval.RUBRIC_PATH)
        self.assertEqual(sum(gate["weight"] for gate in rubric["gates"]), 100)
        gates = [{"id": gate["id"], "weight": gate["weight"], "status": "pending", "trusted_evidence": []} for gate in rubric["gates"]]
        payload = {
            "schema_version": 1,
            "status": "runtime_pending",
            "score": 0,
            "maximum_score": 100,
            "gates": gates,
            "fixture_results": [{}, {}, {}],
            "runtime": {},
            "anti_cheat": {},
            "freeze": {},
            "remaining_runtime_gates": [gate["id"] for gate in gates],
        }
        matlab_eval.validate_result_shape(payload, rubric)
        payload["score"] = 100
        with self.assertRaisesRegex(matlab_eval.EvaluationError, "computed only"):
            matlab_eval.validate_result_shape(payload, rubric)


class RuntimeFixtureTestCase(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix="matlab-evaluator-unit-")
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.output_root = self.directory / "runtime"
        self.output_root.mkdir()
        self.started_ns = self.output_root.stat().st_mtime_ns
        self.fixture_root = self.directory / "frozen-fixtures"
        self.fixture_root.mkdir()
        (self.output_root / "fixture-inputs").mkdir()
        input_fixtures = []
        for identifier, source_file in matlab_eval.EXPECTED_INPUT_FIXTURES.items():
            content = (matlab_eval.FIXTURE_ROOT / source_file).read_bytes()
            (self.fixture_root / source_file).write_bytes(content)
            snapshot = self.output_root / "fixture-inputs" / source_file
            snapshot.write_bytes(content)
            input_fixtures.append({"id": identifier, "file": f"fixture-inputs/{source_file}",
                                   "source_file": source_file, "bytes": len(content),
                                   "sha256": matlab_eval.sha256(snapshot)})
        fixture_patch = mock.patch.object(matlab_eval, "FIXTURE_ROOT", self.fixture_root)
        fixture_patch.start()
        self.addCleanup(fixture_patch.stop)
        self.runtime = {
            "nonce": "unit-test-only-nonce",
            "runtime": "MathWorks MATLAB",
            "success": True,
            "matlab_version": "9.10.0.2198249 (R2021a) Update 8",
            "matlab_release": "R2021a",
            "fixture_ids": list(matlab_eval.EXPECTED_INPUT_FIXTURES),
            "input_fixtures": input_fixtures,
        }
        self.manifest = {
            "matlab_release": "2021a",
            "runtime": {"matlab_release": "2021a"},
            "figures": [
                {"id": f"unit-test-{index}", "runtime": {"matlab_release": "2021a"},
                 "exports": {format_name: {} for format_name in ("png", "pdf", "svg")}}
                for index in range(3)
            ],
        }


class RuntimeReleaseValidationTests(RuntimeFixtureTestCase):
    def release_sources(self) -> list[tuple[str, dict]]:
        return [("runtime", self.runtime), ("manifest", self.manifest),
                ("manifest.runtime", self.manifest["runtime"])] + [
                    (f"manifest.figures[{index}].runtime", figure["runtime"])
                    for index, figure in enumerate(self.manifest["figures"])
                ]

    def test_normal_forms_compare_without_rewriting_evidence(self) -> None:
        for release in ("2021a", "2021b", "2026a", "2026b"):
            self.runtime["matlab_release"] = f"R{release}"
            self.manifest["matlab_release"] = release
            self.manifest["runtime"]["matlab_release"] = f"R{release}"
            for index, figure in enumerate(self.manifest["figures"]):
                figure["runtime"]["matlab_release"] = release if index % 2 == 0 else f"R{release}"
            original = copy.deepcopy((self.runtime, self.manifest))
            with self.subTest(release=release):
                matlab_eval.validate_runtime_releases(self.runtime, self.manifest)
                self.assertEqual((self.runtime, self.manifest), original)

    def test_missing_empty_and_nonstring_releases_are_rejected_at_every_level(self) -> None:
        for field, source in self.release_sources():
            original = source["matlab_release"]
            for value in (None, "", " ", "\n", 2021, True, [], {}):
                with self.subTest(field=field, value=value):
                    source["matlab_release"] = value
                    with self.assertRaises(matlab_eval.EvaluationError) as caught:
                        matlab_eval.validate_runtime_releases(self.runtime, self.manifest)
                    self.assertIn(f"{field}.matlab_release", str(caught.exception))
            del source["matlab_release"]
            with self.subTest(field=field, missing=True), self.assertRaises(matlab_eval.EvaluationError):
                matlab_eval.validate_runtime_releases(self.runtime, self.manifest)
            source["matlab_release"] = original

    def test_malformed_release_strings_are_rejected_at_every_level(self) -> None:
        invalid = (
            "R9.10.0.2198249 (R2021a) Update 8", "9.10.0.2198249 (R2021a) Update 8",
            "(R2021a)", "R2021a Update 8", "release R2021a", "R2021a/R2026a",
            "r2021a", "R2021A", "R2021c", "R2021", "2021", "R21a", "R20210a",
            "RR2021a", " R2021a", "R2021a ", "R2021a\n", "2021a\x00", "R\uFF12\uFF10\uFF12\uFF11a",
        )
        for field, source in self.release_sources():
            original = source["matlab_release"]
            for value in invalid:
                with self.subTest(field=field, value=value):
                    source["matlab_release"] = value
                    with self.assertRaises(matlab_eval.EvaluationError) as caught:
                        matlab_eval.validate_runtime_releases(self.runtime, self.manifest)
                    self.assertIn(f"{field}.matlab_release", str(caught.exception))
            source["matlab_release"] = original

    def test_release_mismatches_are_rejected_at_every_level(self) -> None:
        for field, source in self.release_sources():
            original = source["matlab_release"]
            for value in ("2021b", "R2021b", "2026a", "R2026a"):
                with self.subTest(field=field, value=value):
                    source["matlab_release"] = value
                    with self.assertRaisesRegex(matlab_eval.EvaluationError, "does not match runtime.matlab_release"):
                        matlab_eval.validate_runtime_releases(self.runtime, self.manifest)
            source["matlab_release"] = original

    def test_consistently_malformed_release_is_not_accepted_as_agreement(self) -> None:
        for _, source in self.release_sources():
            source["matlab_release"] = "R9.10.0.2198249 (R2021a) Update 8"
        with self.assertRaisesRegex(matlab_eval.EvaluationError, "runtime.matlab_release must be"):
            matlab_eval.validate_runtime_releases(self.runtime, self.manifest)

    def test_missing_or_invalid_runtime_objects_are_rejected(self) -> None:
        for source in [self.manifest, *self.manifest["figures"]]:
            original = source["runtime"]
            for value in (None, "R2021a", [], {}):
                source["runtime"] = value
                with self.subTest(value=value), self.assertRaises(matlab_eval.EvaluationError):
                    matlab_eval.validate_runtime_releases(self.runtime, self.manifest)
            del source["runtime"]
            with self.assertRaises(matlab_eval.EvaluationError):
                matlab_eval.validate_runtime_releases(self.runtime, self.manifest)
            source["runtime"] = original
        for manifest in (None, [], "2021a"):
            with self.subTest(manifest=manifest), self.assertRaises(matlab_eval.EvaluationError):
                matlab_eval.validate_runtime_releases(self.runtime, manifest)

    def test_runtime_output_rejects_bad_release_before_artifact_checks(self) -> None:
        for field, source in self.release_sources():
            original = source["matlab_release"]
            for value in (None, "R9.10.0.2198249 (R2021a) Update 8", "R2026a"):
                source["matlab_release"] = value
                with self.subTest(field=field, value=value), \
                        mock.patch.object(matlab_eval, "load_json", side_effect=[self.runtime, self.manifest]), \
                        mock.patch.object(matlab_eval, "collect_manifest_exports") as collect_exports:
                    with self.assertRaises(matlab_eval.EvaluationError):
                        matlab_eval.validate_runtime_output(self.output_root, self.runtime["nonce"], self.started_ns)
                    collect_exports.assert_not_called()
            source["matlab_release"] = original

    def test_valid_release_still_requires_existing_artifact_checks(self) -> None:
        with mock.patch.object(matlab_eval, "load_json", side_effect=[self.runtime, self.manifest]), \
                mock.patch.object(matlab_eval, "collect_manifest_exports",
                                  side_effect=matlab_eval.EvaluationError("unit-test artifact failure")) as collect_exports:
            with self.assertRaisesRegex(matlab_eval.EvaluationError, "unit-test artifact failure"):
                matlab_eval.validate_runtime_output(self.output_root, self.runtime["nonce"], self.started_ns)
            collect_exports.assert_called_once_with(self.manifest)


class RuntimeInputFixtureTests(RuntimeFixtureTestCase):
    def validate_inputs(self) -> list[dict]:
        return matlab_eval.validate_runtime_input_fixtures(self.output_root, self.runtime, self.started_ns)

    def test_valid_snapshots_return_measured_evidence_without_mutation(self) -> None:
        original = copy.deepcopy(self.runtime)
        evidence = self.validate_inputs()
        self.assertEqual([item["id"] for item in evidence], sorted(matlab_eval.EXPECTED_INPUT_FIXTURES))
        self.assertEqual(self.runtime, original)
        for item in evidence:
            snapshot = self.output_root / item["file"]
            self.assertEqual(item["status"], "passed")
            self.assertEqual(item["bytes"], snapshot.stat().st_size)
            self.assertEqual(item["sha256"], matlab_eval.sha256(snapshot))
            self.assertEqual(item["source_sha256"], matlab_eval.sha256(self.fixture_root / item["source_file"]))
            self.assertGreaterEqual(item["mtime_ns"], item["started_ns"])

    def test_runtime_result_exposes_verified_input_fixtures(self) -> None:
        (self.output_root / "matlab-runtime.json").write_text(json.dumps(self.runtime), encoding="utf-8")
        (self.output_root / "figures.json").write_text(json.dumps(self.manifest), encoding="utf-8")
        with mock.patch.object(matlab_eval, "collect_manifest_exports", return_value=[]):
            result = matlab_eval.validate_runtime_output(self.output_root, self.runtime["nonce"], self.started_ns)
        self.assertEqual(result["input_fixtures"], self.validate_inputs())
        self.assertEqual(result["record"], self.runtime)

    def test_snapshot_change_during_artifact_validation_is_rejected(self) -> None:
        snapshot = self.output_root / self.runtime["input_fixtures"][0]["file"]

        def mutate_snapshot(manifest: dict) -> list:
            snapshot.write_bytes(snapshot.read_bytes() + b"\n")
            return []

        with mock.patch.object(matlab_eval, "load_json", side_effect=[self.runtime, self.manifest]), \
                mock.patch.object(matlab_eval, "collect_manifest_exports", side_effect=mutate_snapshot):
            with self.assertRaisesRegex(matlab_eval.EvaluationError, "input fixture snapshot byte/hash mismatch"):
                matlab_eval.validate_runtime_output(self.output_root, self.runtime["nonce"], self.started_ns)

    def test_missing_binding_rejects_legacy_runtime_before_artifacts(self) -> None:
        del self.runtime["input_fixtures"]
        with mock.patch.object(matlab_eval, "load_json", side_effect=[self.runtime, self.manifest]), \
                mock.patch.object(matlab_eval, "collect_manifest_exports") as collect_exports:
            with self.assertRaisesRegex(matlab_eval.EvaluationError, "exactly three input snapshots"):
                matlab_eval.validate_runtime_output(self.output_root, self.runtime["nonce"], self.started_ns)
            collect_exports.assert_not_called()

    def test_missing_extra_or_invalid_records_are_rejected(self) -> None:
        records = self.runtime["input_fixtures"]
        for value in (None, {}, "claimed", [], records[:2], records + records[:1], [None, *records[1:]]):
            with self.subTest(value=value):
                self.runtime["input_fixtures"] = value
                with self.assertRaises(matlab_eval.EvaluationError):
                    self.validate_inputs()

    def test_unknown_or_missing_input_ids_are_rejected(self) -> None:
        record = self.runtime["input_fixtures"][0]
        for value in (None, "", [], 1, "unknown"):
            with self.subTest(value=value):
                record["id"] = value
                with self.assertRaisesRegex(matlab_eval.EvaluationError, "unknown or duplicate input fixture id"):
                    self.validate_inputs()
        del record["id"]
        with self.assertRaises(matlab_eval.EvaluationError):
            self.validate_inputs()

    def test_duplicate_record_cannot_replace_a_missing_fixture(self) -> None:
        records = self.runtime["input_fixtures"]
        records[0] = records[1].copy()
        with self.assertRaisesRegex(matlab_eval.EvaluationError, "duplicate input fixture id"):
            self.validate_inputs()

    def test_declared_fixture_ids_must_match_all_three_inputs(self) -> None:
        identifiers = self.runtime["fixture_ids"]
        for value in (None, [], identifiers[:2], identifiers + identifiers[:1],
                      [identifiers[0], identifiers[0], identifiers[2]], ["unknown", *identifiers[1:]]):
            with self.subTest(value=value):
                self.runtime["fixture_ids"] = value
                with self.assertRaisesRegex(matlab_eval.EvaluationError, "runtime.fixture_ids"):
                    self.validate_inputs()

    def test_wrong_source_file_is_rejected(self) -> None:
        record = self.runtime["input_fixtures"][0]
        for value in (None, "", "../crossed_time_depth_temperature.json", [],
                      self.runtime["input_fixtures"][1]["source_file"]):
            with self.subTest(value=value):
                record["source_file"] = value
                with self.assertRaisesRegex(matlab_eval.EvaluationError, "source_file mismatch"):
                    self.validate_inputs()

    def test_snapshot_paths_must_be_canonical_and_relative(self) -> None:
        record = self.runtime["input_fixtures"][0]
        canonical = record["file"]
        for value in (None, [], "", "../" + canonical, "./" + canonical, "/tmp/" + canonical,
                      canonical.replace("/", "//"), canonical.replace("/", "/../fixture-inputs/"),
                      canonical.replace("/", "\\"), "file:///tmp/" + canonical,
                      "C:/" + canonical, "fixture-inputs/%2e%2e/" + record["source_file"],
                      self.runtime["input_fixtures"][1]["file"]):
            with self.subTest(value=value):
                record["file"] = value
                with self.assertRaisesRegex(matlab_eval.EvaluationError, "snapshot path"):
                    self.validate_inputs()

    def test_snapshot_and_parent_symlinks_are_rejected_even_inside_root(self) -> None:
        record = self.runtime["input_fixtures"][0]
        snapshot = self.output_root / record["file"]
        content = snapshot.read_bytes()
        for target in (self.output_root / "local-copy.json", self.directory / "outside.json"):
            target.write_bytes(content)
            snapshot.unlink()
            snapshot.symlink_to(target)
            with self.subTest(target=target), self.assertRaisesRegex(matlab_eval.EvaluationError, "symlink"):
                self.validate_inputs()
            snapshot.unlink()
            snapshot.write_bytes(content)
        snapshot_directory = self.output_root / "fixture-inputs"
        real_directory = self.output_root / "real-inputs"
        snapshot_directory.rename(real_directory)
        snapshot_directory.symlink_to(real_directory, target_is_directory=True)
        with self.assertRaisesRegex(matlab_eval.EvaluationError, "symlink"):
            self.validate_inputs()

    def test_source_fixture_symlinks_are_rejected(self) -> None:
        record = self.runtime["input_fixtures"][0]
        source = self.fixture_root / record["source_file"]
        source.unlink()
        source.symlink_to(self.output_root / record["file"])
        with self.assertRaisesRegex(matlab_eval.EvaluationError, "symlink"):
            self.validate_inputs()

    def test_missing_empty_and_nonregular_snapshots_are_rejected(self) -> None:
        snapshot = self.output_root / self.runtime["input_fixtures"][0]["file"]
        snapshot.unlink()
        with self.assertRaisesRegex(matlab_eval.EvaluationError, "cannot read input fixture"):
            self.validate_inputs()
        snapshot.touch()
        with self.assertRaisesRegex(matlab_eval.EvaluationError, "nonempty regular input fixture"):
            self.validate_inputs()
        snapshot.unlink()
        snapshot.mkdir()
        with self.assertRaisesRegex(matlab_eval.EvaluationError, "nonempty regular input fixture"):
            self.validate_inputs()

    def test_stale_snapshot_rejected_and_start_boundary_accepted(self) -> None:
        snapshot = self.output_root / self.runtime["input_fixtures"][0]["file"]
        os.utime(snapshot, ns=(self.started_ns - 1, self.started_ns - 1))
        with self.assertRaisesRegex(matlab_eval.EvaluationError, "stale input fixture snapshot"):
            self.validate_inputs()
        os.utime(snapshot, ns=(self.started_ns, self.started_ns))
        self.assertEqual(len(self.validate_inputs()), 3)

    def test_declared_bytes_and_hash_must_match_actual_snapshot(self) -> None:
        record = self.runtime["input_fixtures"][0]
        original = record.copy()
        for field, value in (("bytes", None), ("bytes", 0), ("bytes", True),
                             ("bytes", float(record["bytes"])), ("bytes", record["bytes"] + 1),
                             ("sha256", None), ("sha256", ""), ("sha256", "f" * 64),
                             ("sha256", record["sha256"].upper())):
            record.update(original)
            record[field] = value
            with self.subTest(field=field, value=value), self.assertRaisesRegex(matlab_eval.EvaluationError, "byte/hash mismatch"):
                self.validate_inputs()

    def test_same_shape_numeric_replacement_rejected_even_with_updated_hash(self) -> None:
        record = next(item for item in self.runtime["input_fixtures"] if item["id"] == "paired-observation-model")
        snapshot = self.output_root / record["file"]
        original = snapshot.read_bytes()
        altered = original.replace(b'"observation_degC":17.02', b'"observation_degC":18.02', 1)
        self.assertNotEqual(altered, original)
        self.assertEqual(len(altered), len(original))
        self.assertEqual(len(json.loads(altered)["records"]), len(json.loads(original)["records"]))
        snapshot.write_bytes(altered)
        with self.assertRaisesRegex(matlab_eval.EvaluationError, "byte/hash mismatch"):
            self.validate_inputs()
        record["sha256"] = matlab_eval.sha256(snapshot)
        with self.assertRaisesRegex(matlab_eval.EvaluationError, "differs from frozen fixture input"):
            self.validate_inputs()

    def test_source_actual_bytes_are_checked_not_only_runtime_claims(self) -> None:
        record = self.runtime["input_fixtures"][0]
        source = self.fixture_root / record["source_file"]
        source.write_bytes(source.read_bytes() + b"\n")
        with self.assertRaisesRegex(matlab_eval.EvaluationError, "differs from frozen fixture input"):
            self.validate_inputs()

    def test_ambiguous_source_json_rejected_with_matching_snapshot_bytes_and_hash(self) -> None:
        record = self.runtime["input_fixtures"][0]
        source = self.fixture_root / record["source_file"]
        snapshot = self.output_root / record["file"]
        original = source.read_bytes()
        for value, reason in (
            (b'{"value": 0, "value": 1}', "duplicate JSON key"),
            (b'[{"value": 1, "value": 1}]', "duplicate JSON key"),
            (b"NaN", "non-finite JSON number"),
            (b"Infinity", "non-finite JSON number"),
            (b"-Infinity", "non-finite JSON number"),
        ):
            with self.subTest(value=value):
                content = b'{"strict_json_probe": ' + value + b"," + original.lstrip()[1:]
                source.write_bytes(content)
                snapshot.write_bytes(content)
                record.update(bytes=len(content), sha256=matlab_eval.sha256(snapshot))
                with self.assertRaisesRegex(matlab_eval.EvaluationError, reason) as caught:
                    self.validate_inputs()
                self.assertIn(str(source), str(caught.exception))

    def test_input_id_must_match_the_actual_fixture_payload(self) -> None:
        record = self.runtime["input_fixtures"][0]
        source = self.fixture_root / record["source_file"]
        payload = json.loads(source.read_bytes())
        payload["id"] = "other-id"
        content = json.dumps(payload).encode()
        source.write_bytes(content)
        snapshot = self.output_root / record["file"]
        snapshot.write_bytes(content)
        record.update(bytes=len(content), sha256=matlab_eval.sha256(snapshot))
        with self.assertRaisesRegex(matlab_eval.EvaluationError, "frozen fixture id does not match"):
            self.validate_inputs()


class RuntimePlotDataEvidenceTests(RuntimeFixtureTestCase):
    def setUp(self) -> None:
        super().setUp()
        for figure, identifier in zip(self.manifest["figures"], matlab_eval.EXPECTED_INPUT_FIXTURES):
            figure["id"] = identifier
            for format_name in figure["exports"]:
                artifact = self.output_root / f"{identifier}.{format_name}"
                if format_name == "png":
                    def png_chunk(kind: bytes, payload: bytes) -> bytes:
                        return (struct.pack(">I", len(payload)) + kind + payload
                                + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF))

                    artifact.write_bytes(
                        b"\x89PNG\r\n\x1a\n"
                        + png_chunk(b"IHDR", struct.pack(">IIBBBBB", 2, 1, 8, 2, 0, 0, 0))
                        + png_chunk(b"IDAT", zlib.compress(b"\x00" + b"\xff" * 6))
                        + png_chunk(b"IEND", b"")
                    )
                elif format_name == "pdf":
                    artifact.write_bytes(b"%PDF-1.4\n%%EOF\n")
                else:
                    artifact.write_bytes(b'<svg xmlns="http://www.w3.org/2000/svg" width="2" height="1"/>')
                figure["exports"][format_name] = {
                    "file": artifact.name, "bytes": artifact.stat().st_size,
                    "sha256": matlab_eval.sha256(artifact), "width": 2, "height": 1,
                }

    def record_grid_evidence(self, figure_index: int = 0) -> dict:
        figure = self.manifest["figures"][figure_index]
        identifier = figure["id"]
        source = self.fixture_root / matlab_eval.EXPECTED_INPUT_FIXTURES[identifier]
        fixture = json.loads(source.read_bytes())
        variable_name = "temperature" if identifier == "crossed-time-depth-temperature" else "salinity"
        variable = fixture["variables"][variable_name]
        uncertainty = fixture["variables"][f"{variable_name}_standard_uncertainty"]
        values = variable["values"]
        declaration = {
            "schema_version": 1, "figure_id": identifier, "fixture_id": identifier,
            "fixture_sha256": matlab_eval.sha256(source), "matlab_release": "R2021a",
            "dimension_order": ["depth", "time"], "shape": [len(values), len(values[0])],
            "time_utc": fixture["coordinates"]["time"]["values"],
            "depth_m": fixture["coordinates"]["depth"]["values"], "depth_unit": "m",
            "quantity_unit": variable["unit"], "missing_policy": "preserve",
            "native_data_source": "Image.CData" if variable_name == "temperature" else "Lines.XData",
            "native_values": values, "missing_mask": [[value is None for value in row] for row in values],
            "input_match_asserted": True,
            "qc": {"provided": True, "policy": "preserve", "flags": fixture["variables"]["qc"]["values"]},
            "uncertainty": {"present": True, "type": uncertainty["type"], "unit": uncertainty["unit"],
                            "display": "metadata", "values": uncertainty["values"]},
        }
        figure["scientific_data_contract"] = {"plot_data_evidence": declaration}
        return declaration

    def validate_output(self) -> dict:
        (self.output_root / "matlab-runtime.json").write_text(json.dumps(self.runtime), encoding="utf-8")
        (self.output_root / "figures.json").write_text(json.dumps(self.manifest), encoding="utf-8")
        return matlab_eval.validate_runtime_output(self.output_root, self.runtime["nonce"], self.started_ns)

    def test_real_grid_v1_validates_complete_arrays_without_visual_promotion(self) -> None:
        declarations = [self.record_grid_evidence(index) for index in (0, 1)]
        original = copy.deepcopy((self.runtime, self.manifest))
        result = self.validate_output()
        self.assertEqual(result["status"], "passed")
        self.assertEqual(len(result["artifacts"]), 9)
        self.assertEqual((self.runtime, self.manifest), original)
        evidence = result["plot_data_evidence"]
        self.assertIn("not independent", evidence["scope"])
        self.assertIn("visual", evidence["scope"])
        self.assertEqual(len(evidence["figures"]), 3)
        for proof, declaration in zip(evidence["figures"], declarations):
            self.assertEqual(proof["figure_id"], declaration["figure_id"])
            self.assertEqual(proof["status"], "runtime_declaration_verified")
            self.assertTrue(proof["input_fixture_binding_verified"])
            self.assertTrue(proof["local_arrays_match"])
            self.assertEqual(proof["declaration"], declaration)
        self.assertEqual(evidence["figures"][2]["status"], "not_verified")
        self.assertEqual(matlab_eval.validate_visual_audit(None, result)["status"], "pending")
        self.assertNotIn("score", result)

    def test_legacy_missing_declarations_stay_unverified_including_unknown_figures(self) -> None:
        self.manifest["figures"][0]["scientific_data_contract"] = {"provided": True, "required": True}
        self.manifest["figures"][1]["scientific_data_contract"] = {}
        self.manifest["figures"][2]["id"] = "legacy-unknown-figure"
        result = self.validate_output()
        self.assertEqual(result["status"], "passed")
        self.assertEqual(len(result["artifacts"]), 9)
        for figure, proof in zip(self.manifest["figures"], result["plot_data_evidence"]["figures"]):
            self.assertEqual(proof["figure_id"], figure["id"])
            self.assertEqual(proof["status"], "not_verified")
            self.assertFalse(proof["provided"])
            self.assertIsNone(proof["declaration"])

    def test_real_grid_array_and_hash_tampering_is_rejected_before_passed(self) -> None:
        for figure_index in (0, 1):
            original = copy.deepcopy(self.record_grid_evidence(figure_index))
            for field, value, reason in (
                ("native_values", [[0] * original["shape"][1] for _ in original["native_values"]], "complete fixture array"),
                ("fixture_sha256", "0" * 64, "hash mismatch"),
                ("matlab_release", "R2024b", "release mismatch"),
                ("input_match_asserted", True, "fields are missing or unsupported"),
            ):
                declaration = copy.deepcopy(original)
                declaration[field] = value
                if field == "input_match_asserted":
                    declaration = {field: value}
                self.manifest["figures"][figure_index]["scientific_data_contract"]["plot_data_evidence"] = declaration
                with self.subTest(figure_index=figure_index, field=field), \
                        self.assertRaisesRegex(matlab_eval.EvaluationError, reason):
                    self.validate_output()
            self.manifest["figures"][figure_index]["scientific_data_contract"]["plot_data_evidence"] = original

    def test_misplaced_declarations_are_rejected_even_when_empty_or_false(self) -> None:
        declaration = self.record_grid_evidence()
        sources = [("runtime", self.runtime), ("manifest", self.manifest),
                   ("manifest.runtime", self.manifest["runtime"])]
        for index, figure in enumerate(self.manifest["figures"]):
            sources.extend([(f"figure[{index}]", figure), (f"figure[{index}].runtime", figure["runtime"])])
        for field, source in sources:
            for value in (declaration, {}, None, False):
                source["plot_data_evidence"] = value
                with self.subTest(field=field, value=value), \
                        self.assertRaisesRegex(matlab_eval.EvaluationError, "plot_data_evidence must be nested"):
                    self.validate_output()
            del source["plot_data_evidence"]

    def test_unknown_figure_cannot_supply_a_declaration(self) -> None:
        declaration = self.record_grid_evidence()
        self.manifest["figures"][0]["id"] = "unknown-figure"
        declaration["figure_id"] = "unknown-figure"
        with self.assertRaisesRegex(matlab_eval.EvaluationError, "plot_data_evidence.*unknown-figure"):
            self.validate_output()

    def test_verified_declaration_does_not_skip_artifact_checks(self) -> None:
        self.record_grid_evidence()
        export = self.manifest["figures"][0]["exports"]["png"]
        artifact = self.output_root / export["file"]
        original = export.copy()
        content = artifact.read_bytes()
        for fault, reason in (("signature", "signature"), ("hash", "byte/hash mismatch"),
                              ("dimensions", "PNG dimension mismatch"), ("stale", "stale artifact")):
            export.update(original)
            artifact.write_bytes(content)
            if fault == "signature":
                artifact.write_bytes(b"not a PNG")
                export.update(bytes=artifact.stat().st_size, sha256=matlab_eval.sha256(artifact))
            elif fault == "hash":
                export["sha256"] = "0" * 64
            elif fault == "dimensions":
                export["width"] += 1
            else:
                os.utime(artifact, ns=(self.started_ns - 1, self.started_ns - 1))
            with self.subTest(fault=fault), self.assertRaisesRegex(matlab_eval.EvaluationError, reason):
                self.validate_output()

    def test_report_validator_is_loaded_from_fixed_path_without_changing_sys_path(self) -> None:
        original_path = sys.path.copy()
        with mock.patch.dict(sys.modules, {"build_ocean_report": mock.Mock()}):
            report = matlab_eval.load_report_validator()
        self.assertEqual(Path(report.__file__).resolve(), MODULE_PATH.with_name("build_ocean_report.py"))
        self.assertEqual(sys.path, original_path)
        self.assertTrue(callable(report.validate_plot_data_evidence))

    def test_input_binding_uses_verified_snapshot_id_and_hash_not_runtime_claims(self) -> None:
        declaration = self.record_grid_evidence()
        validate_inputs = matlab_eval.validate_runtime_input_fixtures
        for fault in ("id", "sha256", "missing"):
            def change_checked_binding(*args):
                checked = validate_inputs(*args)
                record = next(item for item in checked if item["id"] == declaration["fixture_id"])
                if fault == "missing":
                    checked.remove(record)
                else:
                    record[fault] = "unrelated-fixture" if fault == "id" else "0" * 64
                return checked

            with self.subTest(fault=fault), \
                    mock.patch.object(matlab_eval, "validate_runtime_input_fixtures", side_effect=change_checked_binding) as validate:
                result = self.validate_output()
            self.assertEqual(validate.call_count, 2)
            proof = result["plot_data_evidence"]["figures"][0]
            self.assertEqual(proof["status"], "not_verified")
            self.assertTrue(proof["local_arrays_match"])
            self.assertFalse(proof["input_fixture_binding_verified"])
            self.assertTrue(proof["declaration"]["input_match_asserted"])
            self.assertEqual(proof["declaration"]["fixture_sha256"], self.runtime["input_fixtures"][0]["sha256"])

    def test_future_schema_is_delegated_with_figure_context_and_preserved_scope(self) -> None:
        report = matlab_eval.load_report_validator()
        validate_proof = report.validate_plot_data_evidence
        figure = self.manifest["figures"][0]
        figure["id"] = "paired-interactive"
        declaration = {"schema_version": 2, "delegation_test_only": True}
        figure["scientific_data_contract"] = {"plot_data_evidence": declaration}
        delegated_result = {"status": "not_verified", "provided": True, "declaration": declaration,
                            "scope": "mock delegation only; not real v2 runtime verification"}
        self.runtime["matlab_release"] = "2021a"

        def delegate(candidate: dict, context: dict, input_bound: bool, release: str) -> dict:
            if candidate["id"] == "paired-interactive":
                self.assertEqual(candidate, figure)
                self.assertEqual(context["fixture_id"], "crossed-time-depth-temperature")
                self.assertEqual(context["fixture_sha256"], self.runtime["input_fixtures"][0]["sha256"])
                self.assertTrue(input_bound)
                self.assertEqual(release, "R2021a")
                return delegated_result
            return validate_proof(candidate, context, input_bound, release)

        with mock.patch.object(matlab_eval, "load_report_validator", return_value=report), \
                mock.patch.object(report, "load_fixture_statistics", wraps=report.load_fixture_statistics) as load_statistics, \
                mock.patch.object(report, "validate_plot_data_evidence", side_effect=delegate) as validate:
            result = self.validate_output()
        load_statistics.assert_called_once_with(self.fixture_root)
        self.assertEqual(validate.call_count, 3)
        self.assertEqual(result["plot_data_evidence"]["figures"][0],
                         {"figure_id": "paired-interactive", **delegated_result})

    def test_shared_validator_failure_is_rejected_before_passed(self) -> None:
        self.record_grid_evidence()
        report = matlab_eval.load_report_validator()
        failure = report.ReportBuildError("delegated schema validation failed")
        with mock.patch.object(matlab_eval, "load_report_validator", return_value=report), \
                mock.patch.object(report, "validate_plot_data_evidence", side_effect=failure) as validate, \
                mock.patch.object(matlab_eval, "collect_manifest_exports") as collect_exports:
            with self.assertRaisesRegex(matlab_eval.EvaluationError, "delegated schema validation failed") as caught:
                self.validate_output()
        self.assertIs(caught.exception.__cause__, failure)
        validate.assert_called_once()
        collect_exports.assert_not_called()

    def test_snapshot_change_during_proof_validation_is_rejected_after_artifact_checks(self) -> None:
        self.record_grid_evidence()
        report = matlab_eval.load_report_validator()
        validate_proof = report.validate_plot_data_evidence
        snapshot = self.output_root / self.runtime["input_fixtures"][0]["file"]

        def mutate_snapshot(*args):
            proof = validate_proof(*args)
            snapshot.write_bytes(snapshot.read_bytes() + b"\n")
            return proof

        with mock.patch.object(matlab_eval, "load_report_validator", return_value=report), \
                mock.patch.object(report, "validate_plot_data_evidence", side_effect=mutate_snapshot), \
                mock.patch.object(matlab_eval, "artifact_signature", wraps=matlab_eval.artifact_signature) as signatures, \
                mock.patch.object(matlab_eval, "validate_runtime_input_fixtures",
                                  wraps=matlab_eval.validate_runtime_input_fixtures) as validate_inputs:
            with self.assertRaisesRegex(matlab_eval.EvaluationError, "input fixture snapshot byte/hash mismatch"):
                self.validate_output()
        self.assertEqual(signatures.call_count, 9)
        self.assertEqual(validate_inputs.call_count, 2)

    def test_false_or_empty_nested_declarations_are_not_treated_as_absent(self) -> None:
        figure = self.manifest["figures"][0]
        for value in (None, False, True, {}, [], "", {"input_match_asserted": True}):
            figure["scientific_data_contract"] = {"plot_data_evidence": value}
            with self.subTest(value=value), self.assertRaisesRegex(matlab_eval.EvaluationError, "plot_data_evidence"):
                self.validate_output()

    def test_fixture_context_errors_propagate_as_evaluation_failure(self) -> None:
        self.record_grid_evidence()
        report = matlab_eval.load_report_validator()
        failure = report.ReportBuildError("invalid fixture context")
        with mock.patch.object(matlab_eval, "load_report_validator", return_value=report), \
                mock.patch.object(report, "load_fixture_statistics", side_effect=failure):
            with self.assertRaisesRegex(matlab_eval.EvaluationError, "invalid fixture context") as caught:
                self.validate_output()
        self.assertIs(caught.exception.__cause__, failure)

    def test_release_and_snapshot_must_validate_before_loading_proof_validator(self) -> None:
        self.record_grid_evidence()
        for fault in ("release", "snapshot"):
            if fault == "release":
                self.manifest["figures"][0]["runtime"]["matlab_release"] = "R2024b"
            else:
                self.manifest["figures"][0]["runtime"]["matlab_release"] = "2021a"
                self.runtime["input_fixtures"][0]["sha256"] = "0" * 64
            with self.subTest(fault=fault), mock.patch.object(matlab_eval, "load_report_validator") as load_validator:
                with self.assertRaises(matlab_eval.EvaluationError):
                    self.validate_output()
                load_validator.assert_not_called()


class FreezeTests(unittest.TestCase):
    def test_inventory_excludes_itself_and_caches(self) -> None:
        paths = matlab_eval.inventory_files()
        self.assertNotIn(matlab_eval.FREEZE_PATH, paths)
        self.assertFalse(any("__pycache__" in path.parts or path.suffix == ".pyc" for path in paths))

    def test_freeze_inventory_detects_tampering(self) -> None:
        original_repository = matlab_eval.REPOSITORY_ROOT
        original_framework = matlab_eval.FRAMEWORK_ROOT
        original_eval = matlab_eval.EVAL_ROOT
        original_freeze = matlab_eval.FREEZE_PATH
        original_roots = matlab_eval.FREEZE_ROOTS
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            framework = root / "framework"
            eval_root = root / "evals"
            framework.mkdir()
            eval_root.mkdir()
            source = eval_root / "source.txt"
            source.write_text("frozen\n", encoding="utf-8")
            matlab_eval.REPOSITORY_ROOT = root
            matlab_eval.FRAMEWORK_ROOT = framework
            matlab_eval.EVAL_ROOT = eval_root
            matlab_eval.FREEZE_PATH = framework / "SOURCE_SHA256SUMS.txt"
            matlab_eval.FREEZE_ROOTS = (framework, eval_root)
            try:
                matlab_eval.write_freeze_inventory()
                matlab_eval.verify_freeze_inventory()
                source.write_text("tampered\n", encoding="utf-8")
                with self.assertRaisesRegex(matlab_eval.EvaluationError, "hash mismatch"):
                    matlab_eval.verify_freeze_inventory()
            finally:
                matlab_eval.REPOSITORY_ROOT = original_repository
                matlab_eval.FRAMEWORK_ROOT = original_framework
                matlab_eval.EVAL_ROOT = original_eval
                matlab_eval.FREEZE_PATH = original_freeze
                matlab_eval.FREEZE_ROOTS = original_roots


if __name__ == "__main__":
    unittest.main()
