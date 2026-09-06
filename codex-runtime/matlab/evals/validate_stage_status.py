"""Validate the current run_github_full100 schema-v1 stage ledger.

Historical ledgers with fewer required stages do not pass this current CI gate;
use summarize_ci.py for historical reporting. This checks declarations only,
not independent MATLAB execution, artifact quality, or visual approval.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


REQUIRED_STAGES = (
    "font-export-probe",
    "native-pdf-page-probe",
    "vector-text-alignment-probe",
    "generated-router-runtime",
    "plot-regression",
    "comparison-statistics-layout",
    "hovmoller-time-axis",
    "family-a-contracts",
    "family-b-runtime",
    "astra-argo-native",
    "family-c-contracts",
    "export-metadata",
    "manifest-evidence-integrity",
    "text-bounds",
    "font-availability",
    "color-accessibility",
    "series-style-preservation",
    "export-runtime",
    "interaction-native-compatibility",
    "interaction-headless",
    "evaluator-runtime",
)
STATUSES = ("pending", "running", "passed", "failed")
ERROR_FIELDS = ("error_identifier", "error_message", "error_report")
SCOPE = "stage_status_declaration_only"


class StageStatusError(ValueError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise StageStatusError(message)


def require_fields(value: Any, fields: set[str], label: str) -> dict[str, Any]:
    require(isinstance(value, dict), f"{label} must be an object")
    missing = fields - value.keys()
    unknown = value.keys() - fields
    require(not missing, f"{label} missing fields: {', '.join(sorted(missing))}")
    require(not unknown, f"{label} unknown fields: {', '.join(sorted(unknown))}")
    return value


def unique_json_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result = {}
    for key, value in pairs:
        require(key not in result, f"duplicate JSON key: {key!r}")
        result[key] = value
    return result


def reject_json_constant(value: str) -> None:
    raise StageStatusError(f"nonfinite JSON number: {value}")


def finite_json_float(value: str) -> float:
    result = float(value)
    require(math.isfinite(result), f"nonfinite JSON number: {value}")
    return result


def timestamp(value: Any, label: str) -> datetime:
    require(isinstance(value, str) and re.fullmatch(
        r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z", value) is not None,
        f"{label} must be a UTC timestamp in YYYY-MM-DDTHH:MM:SSZ format")
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError as error:
        raise StageStatusError(f"{label} is not a valid UTC timestamp") from error


def validate_stage_status(path: Path, expected_release: str) -> dict[str, Any]:
    require(isinstance(expected_release, str)
            and re.fullmatch(r"R20[0-9]{2}[ab]", expected_release) is not None,
            "expected_release must have the form R20YYa or R20YYb")
    path = Path(path)
    require(not path.is_symlink() and path.is_file(), f"regular file required: {path}")
    try:
        content = path.read_bytes()
        payload = json.loads(content.decode("utf-8"), object_pairs_hook=unique_json_object,
                             parse_constant=reject_json_constant, parse_float=finite_json_float)
    except (OSError, UnicodeError, ValueError, RecursionError) as error:
        raise StageStatusError(f"invalid stage JSON {path.name}: {error}") from error

    require_fields(payload, {"schema_version", "generated_at", "expected_release", "summary", "stages"},
                   "stage ledger")
    require(type(payload["schema_version"]) is int and payload["schema_version"] == 1,
            "schema_version must be integer 1")
    require(payload["expected_release"] == expected_release, "stage ledger expected_release mismatch")
    generated_at = timestamp(payload["generated_at"], "generated_at")
    require(isinstance(payload["stages"], list), "stages must be an array")
    summary = require_fields(payload["summary"], {"total", *STATUSES}, "summary")
    for key, value in summary.items():
        require(type(value) is int and value >= 0, f"summary.{key} must be a nonnegative integer")

    counts = {"total": len(payload["stages"]), **dict.fromkeys(STATUSES, 0)}
    seen = set()
    nonpassed = []
    for index, stage in enumerate(payload["stages"]):
        require_fields(stage, {"id", "status", "started_at", "completed_at", *ERROR_FIELDS},
                       f"stages[{index}]")
        identifier = stage["id"]
        require(isinstance(identifier, str) and identifier in REQUIRED_STAGES,
                f"unknown stage ID: {identifier!r}")
        require(identifier not in seen, f"duplicate stage ID: {identifier}")
        seen.add(identifier)
        status = stage["status"]
        require(isinstance(status, str) and status in STATUSES,
                f"{identifier} has unknown stage status: {status!r}")
        counts[status] += 1
        for key in ERROR_FIELDS:
            require(isinstance(stage[key], str), f"{identifier}.{key} must be a string")
            require(status != "passed" or stage[key] == "",
                    f"{identifier} passed with nonempty {key}")
        started_at = timestamp(stage["started_at"], f"{identifier}.started_at")
        completed_at = timestamp(stage["completed_at"], f"{identifier}.completed_at")
        require(started_at <= completed_at <= generated_at,
                f"{identifier} timestamps must satisfy started_at <= completed_at <= generated_at")
        if status != "passed":
            nonpassed.append(f"{identifier} ({status}; {stage['error_identifier']})")

    missing = set(REQUIRED_STAGES) - seen
    require(not missing, f"missing required stages: {', '.join(sorted(missing))}")
    require(summary == counts, f"summary does not match stage records: expected {counts}")
    require(not nonpassed, f"stages not passed: {', '.join(nonpassed)}")
    return {
        "schema_version": 1,
        "status": "passed",
        "scope": SCOPE,
        "expected_release": expected_release,
        "generated_at": payload["generated_at"],
        "required_stages": list(REQUIRED_STAGES),
        "summary": counts,
        "source": {"file": path.name, "bytes": len(content),
                   "sha256": hashlib.sha256(content).hexdigest()},
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage-status", required=True, type=Path)
    parser.add_argument("--expected-release", required=True)
    arguments = parser.parse_args(argv)
    try:
        result = validate_stage_status(arguments.stage_status, arguments.expected_release)
    except (StageStatusError, OSError) as error:
        result = {"schema_version": 1, "status": "failed", "scope": SCOPE,
                  "expected_release": arguments.expected_release, "error": str(error)}
    print(json.dumps(result, indent=2, ensure_ascii=True, allow_nan=False))
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
