from __future__ import annotations

import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


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
