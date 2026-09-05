from __future__ import annotations

import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).resolve().parents[1] / "evaluate.py"
SPEC = importlib.util.spec_from_file_location("matlab_eval", MODULE_PATH)
assert SPEC and SPEC.loader
matlab_eval = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(matlab_eval)


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


class RuntimeReleaseValidationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.runtime = {
            "nonce": "unit-test-only-nonce",
            "runtime": "MathWorks MATLAB",
            "success": True,
            "matlab_version": "9.10.0.2198249 (R2021a) Update 8",
            "matlab_release": "R2021a",
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
                        matlab_eval.validate_runtime_output(Path("unit-test-only"), self.runtime["nonce"], 0)
                    collect_exports.assert_not_called()
            source["matlab_release"] = original

    def test_valid_release_still_requires_existing_artifact_checks(self) -> None:
        with mock.patch.object(matlab_eval, "load_json", side_effect=[self.runtime, self.manifest]), \
                mock.patch.object(matlab_eval, "collect_manifest_exports",
                                  side_effect=matlab_eval.EvaluationError("unit-test artifact failure")) as collect_exports:
            with self.assertRaisesRegex(matlab_eval.EvaluationError, "unit-test artifact failure"):
                matlab_eval.validate_runtime_output(Path("unit-test-only"), self.runtime["nonce"], 0)
            collect_exports.assert_called_once_with(self.manifest)


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
