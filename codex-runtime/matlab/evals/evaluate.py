#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import secrets
import shutil
import stat
import struct
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


EVAL_ROOT = Path(__file__).resolve().parent
REPOSITORY_ROOT = EVAL_ROOT.parents[2]
FRAMEWORK_ROOT = REPOSITORY_ROOT / ".codex-evals" / "matlab-100-20260905" / "framework"
FIXTURE_ROOT = EVAL_ROOT / "fixtures"
RUBRIC_PATH = EVAL_ROOT / "rubric.json"
MATLAB_GATE_PATH = EVAL_ROOT / "run_matlab_gate.m"
FREEZE_PATH = FRAMEWORK_ROOT / "SOURCE_SHA256SUMS.txt"
FREEZE_ROOTS = (FRAMEWORK_ROOT, EVAL_ROOT)
REQUIRED_QC = {"good", "suspect", "missing"}
EXPECTED_INPUT_FIXTURES = {
    "crossed-time-depth-temperature": "crossed_time_depth_temperature.json",
    "repeat-cast-salinity-profiles": "repeat_cast_salinity_profiles.json",
    "paired-observation-model": "paired_observation_model.json",
}
MATLAB_STATIC_TOKENS = (
    "jsondecode",
    "datetime",
    "TimeZone",
    "oi_plot_hovmoller",
    "oi_plot_profile",
    "oi_plot_comparison",
    "oi_export_figure",
    "oi_write_manifest",
)


class EvaluationError(ValueError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json(path: Path) -> Any:
    if path.is_symlink() or not path.is_file():
        raise EvaluationError(f"regular file required: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise EvaluationError(f"invalid JSON {path}: {error}") from error


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_utc(value: str) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise EvaluationError(f"UTC timestamp must end in Z: {value!r}")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as error:
        raise EvaluationError(f"invalid UTC timestamp: {value!r}") from error
    if parsed.utcoffset() != timezone.utc.utcoffset(parsed):
        raise EvaluationError(f"timestamp is not UTC: {value!r}")
    return parsed


def require_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise EvaluationError(f"{field} must be nonblank text")
    return value.strip()


def validate_matrix(values: Any, rows: int, columns: int, field: str, *, allow_text: bool = False) -> int:
    if not isinstance(values, list) or len(values) != rows:
        raise EvaluationError(f"{field} must have {rows} rows")
    missing = 0
    for row in values:
        if not isinstance(row, list) or len(row) != columns:
            raise EvaluationError(f"{field} must be rectangular {rows}x{columns}")
        for value in row:
            if value is None:
                missing += 1
            elif allow_text:
                require_text(value, field)
            elif isinstance(value, bool) or not isinstance(value, (int, float)):
                raise EvaluationError(f"{field} must contain numbers or null")
    return missing


def validate_crossed_design(times: list[str], depths: list[float], expected_pairs: Any) -> None:
    if len(times) < 2 or len(depths) < 2:
        raise EvaluationError("time-depth fixtures require at least two times and two depths")
    pair_count = len(times) * len(depths)
    if expected_pairs != pair_count:
        raise EvaluationError(f"expected_pair_count must equal full crossing {pair_count}")


def validate_grid_fixture(payload: dict[str, Any]) -> dict[str, Any]:
    coordinates = payload.get("coordinates")
    variables = payload.get("variables")
    if not isinstance(coordinates, dict) or not isinstance(variables, dict):
        raise EvaluationError("grid fixture requires coordinates and variables objects")
    time_coordinate = coordinates.get("time", {})
    depth_coordinate = coordinates.get("depth", {})
    times = time_coordinate.get("values")
    depths = depth_coordinate.get("values")
    if not isinstance(times, list) or not isinstance(depths, list):
        raise EvaluationError("time and depth coordinate values must be arrays")
    parsed_times = [parse_utc(value) for value in times]
    if any(current <= previous for previous, current in zip(parsed_times, parsed_times[1:])):
        raise EvaluationError("time coordinate must be strictly increasing and unique")
    if time_coordinate.get("timezone") != "UTC" or time_coordinate.get("direction") != "increasing":
        raise EvaluationError("time coordinate must explicitly declare UTC and increasing")
    if any(isinstance(value, bool) or not isinstance(value, (int, float)) for value in depths):
        raise EvaluationError("depth values must be numeric")
    if any(value < 0 for value in depths) or any(current <= previous for previous, current in zip(depths, depths[1:])):
        raise EvaluationError("depth must be nonnegative and strictly increasing")
    if depth_coordinate.get("direction") != "positive_down" or depth_coordinate.get("unit") != "m":
        raise EvaluationError("depth must declare positive_down metres")
    design = payload.get("design", {})
    if design.get("time_depth_relationship") != "fully_crossed":
        raise EvaluationError("time-depth relationship must be fully_crossed")
    validate_crossed_design(times, depths, design.get("expected_pair_count"))

    primary_name = "temperature" if payload["kind"] == "time_depth_grid" else "salinity"
    primary = variables.get(primary_name, {})
    uncertainty = variables.get(f"{primary_name}_standard_uncertainty", {})
    qc = variables.get("qc", {})
    expected_order = ["depth", "time"]
    if primary.get("dimension_order") != expected_order or uncertainty.get("dimension_order") != expected_order or qc.get("dimension_order") != expected_order:
        raise EvaluationError("primary, uncertainty, and QC dimension order must be depth,time")
    if primary.get("missing_policy") != "preserve" or qc.get("policy") != "preserve":
        raise EvaluationError("missing and QC policies must preserve input state")
    if uncertainty.get("type") != "standard_uncertainty" or uncertainty.get("unit") != primary.get("unit"):
        raise EvaluationError("uncertainty type and unit must align with the primary variable")
    missing = validate_matrix(primary.get("values"), len(depths), len(times), f"variables.{primary_name}.values")
    uncertainty_missing = validate_matrix(uncertainty.get("values"), len(depths), len(times), "uncertainty.values")
    validate_matrix(qc.get("values"), len(depths), len(times), "qc.values", allow_text=True)
    qc_values = {item for row in qc["values"] for item in row}
    if not qc_values <= REQUIRED_QC:
        raise EvaluationError(f"unsupported QC values: {sorted(qc_values - REQUIRED_QC)}")
    for primary_row, uncertainty_row in zip(primary["values"], uncertainty["values"]):
        for value, uncertainty_value in zip(primary_row, uncertainty_row):
            if (value is None) != (uncertainty_value is None):
                raise EvaluationError("primary and uncertainty missing masks must align")
            if uncertainty_value is not None and uncertainty_value < 0:
                raise EvaluationError("uncertainty must be nonnegative")
    if missing == 0 or uncertainty_missing != missing:
        raise EvaluationError("grid fixtures must exercise aligned missing primary and uncertainty data")
    return {"time_count": len(times), "depth_count": len(depths), "pair_count": len(times) * len(depths), "missing_count": missing}


def validate_record_fixture(payload: dict[str, Any]) -> dict[str, Any]:
    records = payload.get("records")
    contract = payload.get("contract")
    design = payload.get("design", {})
    if not isinstance(records, list) or not records or not isinstance(contract, dict):
        raise EvaluationError("paired fixture requires records and contract")
    if contract.get("time_zone") != "UTC" or contract.get("depth_direction") != "positive_down":
        raise EvaluationError("paired fixture must declare UTC and positive_down")
    if contract.get("observation_unit") != contract.get("model_unit") or contract.get("observation_unit") != contract.get("uncertainty_unit"):
        raise EvaluationError("observation, model, and uncertainty units must match")
    if contract.get("uncertainty_type") != "standard_uncertainty":
        raise EvaluationError("paired fixture uncertainty must be standard_uncertainty")
    if contract.get("missing_policy") != "preserve" or contract.get("qc_policy") != "preserve":
        raise EvaluationError("paired fixture must preserve missing and QC state")
    identifiers: set[str] = set()
    times: set[str] = set()
    depths: set[float] = set()
    pairs: set[tuple[str, float]] = set()
    missing = 0
    for record in records:
        if not isinstance(record, dict):
            raise EvaluationError("each paired record must be an object")
        identifier = require_text(record.get("id"), "record.id")
        if identifier in identifiers:
            raise EvaluationError(f"duplicate stable identifier: {identifier}")
        identifiers.add(identifier)
        timestamp = require_text(record.get("time"), "record.time")
        parse_utc(timestamp)
        depth = record.get("depth_m")
        if isinstance(depth, bool) or not isinstance(depth, (int, float)) or depth < 0:
            raise EvaluationError("record.depth_m must be nonnegative numeric")
        qc = require_text(record.get("qc"), "record.qc")
        if qc not in REQUIRED_QC:
            raise EvaluationError(f"unsupported record QC: {qc}")
        observation = record.get("observation_degC")
        model = record.get("model_degC")
        uncertainty = record.get("uncertainty_degC")
        for field, value in (("observation", observation), ("model", model), ("uncertainty", uncertainty)):
            if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float))):
                raise EvaluationError(f"record {field} must be numeric or null")
        if observation is None:
            missing += 1
            if uncertainty is not None or qc != "missing":
                raise EvaluationError("missing observation requires missing uncertainty and QC")
        elif uncertainty is None or uncertainty < 0:
            raise EvaluationError("finite observation requires nonnegative uncertainty")
        times.add(timestamp)
        depths.add(float(depth))
        pairs.add((timestamp, float(depth)))
    if design.get("time_depth_relationship") != "fully_crossed":
        raise EvaluationError("paired time-depth relationship must be fully_crossed")
    validate_crossed_design(sorted(times), sorted(depths), design.get("expected_pair_count"))
    if len(pairs) != len(times) * len(depths):
        raise EvaluationError("paired records do not contain every time-depth combination")
    return {"time_count": len(times), "depth_count": len(depths), "pair_count": len(pairs), "missing_count": missing}


def validate_fixture(path: Path) -> dict[str, Any]:
    payload = load_json(path)
    if not isinstance(payload, dict) or payload.get("schema_version") != 1:
        raise EvaluationError("fixture must be a schema version 1 object")
    identifier = require_text(payload.get("id"), "fixture.id")
    require_text(payload.get("title"), "fixture.title")
    if payload.get("synthetic") is not True:
        raise EvaluationError("evaluation fixtures must explicitly declare synthetic=true")
    provenance = payload.get("provenance")
    if not isinstance(provenance, dict):
        raise EvaluationError("fixture provenance is required")
    require_text(provenance.get("method"), "provenance.method")
    require_text(provenance.get("formula"), "provenance.formula")
    purpose = require_text(provenance.get("purpose"), "provenance.purpose").lower()
    if "not an observed" not in purpose:
        raise EvaluationError("synthetic fixture purpose must disclaim observed-data status")
    kind = payload.get("kind")
    if kind in {"time_depth_grid", "repeat_profiles"}:
        details = validate_grid_fixture(payload)
    elif kind == "paired_records":
        details = validate_record_fixture(payload)
    else:
        raise EvaluationError(f"unsupported fixture kind: {kind!r}")
    return {"id": identifier, "kind": kind, "status": "passed", **details}


def strip_matlab_comments_and_strings(source: str) -> str:
    output: list[str] = []
    index = 0
    block_comment = False
    while index < len(source):
        if block_comment:
            end = source.find("%}", index)
            if end < 0:
                break
            output.extend(" " * (end + 2 - index))
            index = end + 2
            block_comment = False
            continue
        if source.startswith("%{", index):
            block_comment = True
            output.extend("  ")
            index += 2
            continue
        character = source[index]
        if character == "%":
            end = source.find("\n", index)
            if end < 0:
                output.extend(" " * (len(source) - index))
                break
            output.extend(" " * (end - index))
            output.append("\n")
            index = end + 1
            continue
        previous_nonspace = next((item for item in reversed(output) if not item.isspace()), "")
        is_transpose = character == "'" and bool(previous_nonspace) and (
            previous_nonspace.isalnum() or previous_nonspace in ")]}."
        )
        if is_transpose:
            output.append(character)
            index += 1
            continue
        if character in {"'", '"'}:
            quote = character
            output.append(" ")
            index += 1
            while index < len(source):
                if source[index] == quote:
                    if index + 1 < len(source) and source[index + 1] == quote:
                        output.extend("  ")
                        index += 2
                        continue
                    output.append(" ")
                    index += 1
                    break
                output.append("\n" if source[index] == "\n" else " ")
                index += 1
            continue
        output.append(character)
        index += 1
    return "".join(output)


def validate_matlab_gate_source(path: Path = MATLAB_GATE_PATH) -> dict[str, Any]:
    source = path.read_text(encoding="utf-8")
    executable_source = strip_matlab_comments_and_strings(source)
    missing = [token for token in MATLAB_STATIC_TOKENS if re.search(rf"\b{re.escape(token)}\b", executable_source) is None]
    forbidden = [token for token in ("octave", "gcf", "gca") if re.search(rf"\b{token}\b", executable_source, flags=re.IGNORECASE)]
    if missing or forbidden:
        raise EvaluationError(f"MATLAB gate source contract failed; missing={missing}, forbidden={forbidden}")
    return {"required_tokens": list(MATLAB_STATIC_TOKENS), "forbidden_tokens_absent": True}


def run_framework_tests() -> dict[str, Any]:
    suite = unittest.defaultTestLoader.discover(str(EVAL_ROOT / "tests"), pattern="test_*.py")
    stream = tempfile.SpooledTemporaryFile(mode="w+", encoding="utf-8")
    result = unittest.TextTestRunner(stream=stream, verbosity=2).run(suite)
    stream.seek(0)
    output = stream.read()
    if not result.wasSuccessful():
        raise EvaluationError(f"framework tests failed:\n{output}")
    return {"tests_run": result.testsRun, "output": output.strip().splitlines()}


def artifact_signature(path: Path) -> str:
    prefix = path.read_bytes()[:256].lstrip()
    suffix = path.suffix.lower()
    if suffix == ".png" and prefix.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if suffix == ".pdf" and prefix.startswith(b"%PDF-"):
        return "pdf"
    if suffix == ".svg" and (prefix.startswith(b"<svg") or b"<svg" in prefix):
        return "svg"
    raise EvaluationError(f"invalid artifact signature: {path}")


def png_dimensions(path: Path) -> tuple[int, int]:
    with path.open("rb") as handle:
        prefix = handle.read(24)
    if len(prefix) < 24 or not prefix.startswith(b"\x89PNG\r\n\x1a\n") or prefix[12:16] != b"IHDR":
        raise EvaluationError(f"invalid PNG header: {path}")
    return struct.unpack(">II", prefix[16:24])


def collect_manifest_exports(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    figures = manifest.get("figures")
    if not isinstance(figures, list) or len(figures) < 3:
        raise EvaluationError("figures.json must contain at least three figures")
    exports: list[dict[str, Any]] = []
    for figure in figures:
        if not isinstance(figure, dict) or not isinstance(figure.get("exports"), dict):
            raise EvaluationError("each manifest figure requires exports")
        for format_name in ("png", "pdf", "svg"):
            export = figure["exports"].get(format_name)
            if not isinstance(export, dict):
                raise EvaluationError(f"figure {figure.get('id')} missing {format_name} export")
            exports.append({"figure_id": figure.get("id"), "format": format_name, **export})
    return exports


def normalize_matlab_release(value: Any, field: str) -> str:
    if not isinstance(value, str) or re.fullmatch(r"R?[0-9]{4}[ab]", value) is None:
        raise EvaluationError(f"{field} must be YYYYa/b or RYYYYa/b: {value!r}")
    return value if value.startswith("R") else f"R{value}"


def validate_runtime_releases(runtime_record: dict[str, Any], manifest: Any) -> None:
    expected = normalize_matlab_release(runtime_record.get("matlab_release"), "runtime.matlab_release")
    if not isinstance(manifest, dict):
        raise EvaluationError("figures.json must be an object")
    sources = [("manifest", manifest)]
    manifest_runtime = manifest.get("runtime")
    if not isinstance(manifest_runtime, dict):
        raise EvaluationError("manifest.runtime must be an object with matlab_release")
    sources.append(("manifest.runtime", manifest_runtime))
    figures = manifest.get("figures")
    if not isinstance(figures, list) or not figures:
        raise EvaluationError("manifest.figures must be a nonempty array")
    for index, figure in enumerate(figures):
        field = f"manifest.figures[{index}].runtime"
        if not isinstance(figure, dict) or not isinstance(figure.get("runtime"), dict):
            raise EvaluationError(f"{field} must be an object with matlab_release")
        sources.append((field, figure["runtime"]))
    for field, source in sources:
        actual = normalize_matlab_release(source.get("matlab_release"), f"{field}.matlab_release")
        if actual != expected:
            raise EvaluationError(
                f"{field}.matlab_release does not match runtime.matlab_release: {actual} != {expected}"
            )


def read_input_fixture(path: Path, started_ns: int | None = None) -> tuple[bytes, os.stat_result]:
    try:
        before = path.lstat()
        if not stat.S_ISREG(before.st_mode) or before.st_size <= 0:
            raise EvaluationError(f"nonempty regular input fixture required (no symlinks): {path}")
        if started_ns is not None and before.st_mtime_ns < started_ns:
            raise EvaluationError(f"stale input fixture snapshot: {path}")
        content = path.read_bytes()
        after = path.lstat()
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns
        ) or len(content) != before.st_size:
            raise EvaluationError(f"input fixture changed during inspection: {path}")
    except OSError as error:
        raise EvaluationError(f"cannot read input fixture {path}: {error}") from error
    return content, after


def validate_runtime_input_fixtures(
    output_root: Path, runtime_record: dict[str, Any], started_ns: int,
) -> list[dict[str, Any]]:
    records = runtime_record.get("input_fixtures")
    if not isinstance(records, list) or len(records) != len(EXPECTED_INPUT_FIXTURES):
        raise EvaluationError("runtime.input_fixtures must contain exactly three input snapshots")
    fixture_ids = runtime_record.get("fixture_ids")
    if (not isinstance(fixture_ids, list) or len(fixture_ids) != len(EXPECTED_INPUT_FIXTURES)
            or not all(isinstance(identifier, str) for identifier in fixture_ids)
            or set(fixture_ids) != set(EXPECTED_INPUT_FIXTURES)):
        raise EvaluationError("runtime.fixture_ids must contain the three expected unique fixture ids")
    root = output_root.resolve()
    snapshot_directory = root / "fixture-inputs"
    if snapshot_directory.is_symlink() or not snapshot_directory.is_dir():
        raise EvaluationError("fixture-inputs must be a real directory, not a symlink")
    if FIXTURE_ROOT.is_symlink() or not FIXTURE_ROOT.is_dir():
        raise EvaluationError("frozen fixture inputs must reside in a real directory, not a symlink")
    checked: list[dict[str, Any]] = []
    identifiers: set[str] = set()
    for record in records:
        if not isinstance(record, dict):
            raise EvaluationError("runtime.input_fixtures entries must be objects")
        identifier = record.get("id")
        if not isinstance(identifier, str) or identifier not in EXPECTED_INPUT_FIXTURES or identifier in identifiers:
            raise EvaluationError(f"unknown or duplicate input fixture id: {identifier!r}")
        identifiers.add(identifier)
        source_file = EXPECTED_INPUT_FIXTURES[identifier]
        relative = f"fixture-inputs/{source_file}"
        if record.get("source_file") != source_file:
            raise EvaluationError(f"input fixture source_file mismatch for {identifier}")
        if record.get("file") != relative:
            raise EvaluationError(f"unsafe or mismatched input fixture snapshot path for {identifier}: {record.get('file')!r}")
        snapshot = snapshot_directory / source_file
        if snapshot.is_symlink() or not snapshot.resolve().is_relative_to(root):
            raise EvaluationError(f"input fixture snapshot must stay within the output root without symlinks: {relative}")
        content, info = read_input_fixture(snapshot, started_ns)
        actual_hash = hashlib.sha256(content).hexdigest()
        if (type(record.get("bytes")) is not int or record["bytes"] != len(content)
                or not isinstance(record.get("sha256"), str)
                or re.fullmatch(r"[0-9a-f]{64}", record["sha256"]) is None
                or record["sha256"] != actual_hash):
            raise EvaluationError(f"input fixture snapshot byte/hash mismatch: {relative}")
        source_content, _ = read_input_fixture(FIXTURE_ROOT / source_file)
        source_hash = hashlib.sha256(source_content).hexdigest()
        if actual_hash != source_hash or content != source_content:
            raise EvaluationError(f"input fixture snapshot differs from frozen fixture input: {source_file}")
        try:
            source_payload = json.loads(source_content)
        except (ValueError, UnicodeError) as error:
            raise EvaluationError(f"invalid frozen fixture JSON: {source_file}") from error
        if not isinstance(source_payload, dict) or source_payload.get("id") != identifier:
            raise EvaluationError(f"frozen fixture id does not match input snapshot record: {source_file}")
        checked.append({"id": identifier, "file": relative, "source_file": source_file,
                        "bytes": len(content), "sha256": actual_hash, "source_sha256": source_hash,
                        "mtime_ns": info.st_mtime_ns, "started_ns": started_ns, "status": "passed"})
    return sorted(checked, key=lambda item: item["id"])


def validate_runtime_output(output_root: Path, nonce: str, started_ns: int) -> dict[str, Any]:
    runtime_record = load_json(output_root / "matlab-runtime.json")
    if not isinstance(runtime_record, dict) or runtime_record.get("nonce") != nonce:
        raise EvaluationError("MATLAB runtime record nonce mismatch")
    if runtime_record.get("runtime") != "MathWorks MATLAB" or runtime_record.get("success") is not True:
        raise EvaluationError("runtime record does not prove a successful MathWorks MATLAB run")
    require_text(runtime_record.get("matlab_version"), "runtime.matlab_version")
    manifest = load_json(output_root / "figures.json")
    validate_runtime_releases(runtime_record, manifest)
    input_fixtures = validate_runtime_input_fixtures(output_root, runtime_record, started_ns)
    exports = collect_manifest_exports(manifest)
    checked: list[dict[str, Any]] = []
    for export in exports:
        relative = export.get("file")
        if not isinstance(relative, str) or Path(relative).is_absolute() or ".." in Path(relative).parts:
            raise EvaluationError(f"unsafe manifest path: {relative!r}")
        artifact = output_root / relative
        if artifact.is_symlink() or not artifact.is_file() or artifact.stat().st_size <= 0:
            raise EvaluationError(f"fresh regular artifact required: {artifact}")
        if artifact.stat().st_mtime_ns < started_ns:
            raise EvaluationError(f"stale artifact detected: {artifact}")
        signature = artifact_signature(artifact)
        actual_hash = sha256(artifact)
        if export.get("bytes") != artifact.stat().st_size or export.get("sha256") != actual_hash:
            raise EvaluationError(f"manifest byte/hash mismatch: {relative}")
        item = {"file": relative, "format": signature, "bytes": artifact.stat().st_size, "sha256": actual_hash}
        if signature == "png":
            width, height = png_dimensions(artifact)
            if export.get("width") != width or export.get("height") != height:
                raise EvaluationError(f"PNG dimension mismatch: {relative}")
            item.update(width=width, height=height)
        checked.append(item)
    if validate_runtime_input_fixtures(output_root, runtime_record, started_ns) != input_fixtures:
        raise EvaluationError("input fixture snapshots changed during artifact validation")
    return {"status": "passed", "record": runtime_record, "input_fixtures": input_fixtures,
            "artifacts": checked, "manifest_sha256": sha256(output_root / "figures.json")}


def validate_visual_audit(path: Path | None, runtime: dict[str, Any]) -> dict[str, Any]:
    if path is None:
        return {"status": "pending", "reason": "trusted visual audit was not supplied"}
    payload = load_json(path)
    if not isinstance(payload, dict) or payload.get("schema_version") != 1:
        raise EvaluationError("visual audit must be a schema version 1 object")
    if payload.get("manifest_sha256") != runtime.get("manifest_sha256"):
        raise EvaluationError("visual audit is not bound to the runtime manifest")
    require_text(payload.get("reviewer"), "visual_audit.reviewer")
    require_text(payload.get("reviewed_at"), "visual_audit.reviewed_at")
    required = ("png_layout", "pdf_fonts", "svg_fonts", "cjk_glyphs", "clipping", "color_accessibility", "interactive_datatip", "interactive_brush", "headless_fallback")
    checks = payload.get("checks")
    if not isinstance(checks, dict) or any(checks.get(name) is not True for name in required):
        raise EvaluationError("every trusted visual and interaction audit check must be true")
    expected_hashes = {item["file"]: item["sha256"] for item in runtime.get("artifacts", [])}
    if payload.get("artifact_sha256") != expected_hashes:
        raise EvaluationError("visual audit artifact hashes do not match runtime artifacts")
    return {"status": "passed", "reviewer": payload["reviewer"], "reviewed_at": payload["reviewed_at"], "checks": checks}


def matlab_command(output_root: Path, nonce: str) -> list[str]:
    def quote(value: str) -> str:
        return value.replace("'", "''")

    expression = (
        f"addpath('{quote(str(EVAL_ROOT))}');"
        f"run_matlab_gate('{quote(str(FIXTURE_ROOT))}','{quote(str(output_root))}','{quote(nonce)}')"
    )
    return ["matlab", "-batch", expression]


def run_matlab(output_root: Path, nonce: str, timeout: int) -> tuple[dict[str, Any], str, int]:
    if output_root.exists():
        raise EvaluationError(f"runtime output must not pre-exist: {output_root}")
    output_root.mkdir(parents=True)
    started_ns = output_root.stat().st_mtime_ns
    command = matlab_command(output_root, nonce)
    process = subprocess.run(command, cwd=REPOSITORY_ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout, env={**os.environ, "LC_ALL": "C.UTF-8", "LANG": "C.UTF-8"})
    log = process.stdout
    (output_root / "matlab-console.log").write_text(log, encoding="utf-8")
    if process.returncode != 0:
        raise EvaluationError(f"MATLAB failed with exit code {process.returncode}:\n{log}")
    return validate_runtime_output(output_root, nonce, started_ns), log, process.returncode


def inventory_files() -> list[Path]:
    files: list[Path] = []
    for root in FREEZE_ROOTS:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file() or path.is_symlink() or path == FREEZE_PATH:
                continue
            if "__pycache__" in path.parts or path.suffix == ".pyc" or "runtime-output" in path.parts:
                continue
            files.append(path)
    return sorted(files, key=lambda item: item.relative_to(REPOSITORY_ROOT).as_posix())


def write_freeze_inventory() -> dict[str, Any]:
    FRAMEWORK_ROOT.mkdir(parents=True, exist_ok=True)
    lines = [f"{sha256(path)}  {path.relative_to(REPOSITORY_ROOT).as_posix()}" for path in inventory_files()]
    FREEZE_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return {"status": "passed", "file_count": len(lines), "inventory": str(FREEZE_PATH.relative_to(REPOSITORY_ROOT))}


def verify_freeze_inventory() -> dict[str, Any]:
    if FREEZE_PATH.is_symlink() or not FREEZE_PATH.is_file():
        raise EvaluationError("freeze inventory is missing")
    expected: dict[str, str] = {}
    for line in FREEZE_PATH.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  ([^\n]+)", line)
        if not match or match.group(2) in expected:
            raise EvaluationError(f"invalid or duplicate freeze inventory line: {line!r}")
        expected[match.group(2)] = match.group(1)
    actual_paths = {path.relative_to(REPOSITORY_ROOT).as_posix(): path for path in inventory_files()}
    if set(expected) != set(actual_paths):
        raise EvaluationError("freeze inventory path set differs from final scoped files")
    changed = [relative for relative, path in actual_paths.items() if sha256(path) != expected[relative]]
    if changed:
        raise EvaluationError(f"freeze inventory hash mismatch: {changed}")
    return {"status": "passed", "file_count": len(expected), "inventory": str(FREEZE_PATH.relative_to(REPOSITORY_ROOT))}


def evaluate(
    runtime_mode: str,
    output_root: Path,
    visual_audit: Path | None,
    timeout: int,
    run_tests: bool,
    runtime_evidence_dir: Path | None = None,
    runtime_nonce: str | None = None,
    runtime_start_marker: Path | None = None,
) -> dict[str, Any]:
    rubric = load_json(RUBRIC_PATH)
    weights = {gate["id"]: gate["weight"] for gate in rubric["gates"]}
    fixture_paths = sorted(FIXTURE_ROOT.glob("*.json"))
    if len(fixture_paths) < 3:
        raise EvaluationError("at least three fixture files are required")
    fixture_results = [validate_fixture(path) for path in fixture_paths]
    source_result = validate_matlab_gate_source()
    test_result = run_framework_tests() if run_tests else {"tests_run": 0, "skipped": True}

    gate_status = {
        "fixture_science": "passed",
        "scientific_contract": "passed",
        "anti_cheat": "passed",
        "hash_freeze": "passed" if FREEZE_PATH.exists() and verify_freeze_inventory()["status"] == "passed" else "pending",
        "framework_tests": "passed" if run_tests else "pending",
        "matlab_runtime": "pending",
        "artifact_visual_audit": "pending",
    }
    runtime: dict[str, Any] = {"status": "pending", "matlab_executable": shutil.which("matlab")}
    visual = {"status": "pending", "reason": "MATLAB runtime has not run"}
    matlab_available = shutil.which("matlab") is not None
    external_runtime = runtime_evidence_dir is not None
    if external_runtime:
        if runtime_mode == "skip":
            raise EvaluationError("external runtime evidence cannot be used with runtime mode skip")
        if not runtime_nonce or len(runtime_nonce.strip()) < 32:
            raise EvaluationError("external runtime evidence requires a valid nonce")
        if runtime_start_marker is None or not runtime_start_marker.is_file():
            raise EvaluationError("external runtime evidence requires a start marker")
        runtime = validate_runtime_output(
            runtime_evidence_dir.resolve(),
            runtime_nonce.strip(),
            runtime_start_marker.stat().st_mtime_ns,
        )
        gate_status["matlab_runtime"] = "passed"
        visual = validate_visual_audit(visual_audit, runtime)
        gate_status["artifact_visual_audit"] = visual["status"]
    elif runtime_mode == "require" and not matlab_available:
        raise EvaluationError("runtime mode require selected but matlab is unavailable")
    elif runtime_mode != "skip" and matlab_available:
        nonce = secrets.token_hex(24)
        runtime, _, _ = run_matlab(output_root, nonce, timeout)
        gate_status["matlab_runtime"] = "passed"
        visual = validate_visual_audit(visual_audit, runtime)
        gate_status["artifact_visual_audit"] = visual["status"]

    trusted_evidence = {
        "fixture_science": [str(path.relative_to(REPOSITORY_ROOT)) for path in fixture_paths],
        "scientific_contract": ["evaluate.py:validate_fixture", "evaluate.py:validate_crossed_design"],
        "anti_cheat": ["anti-cheat-rules.json", "evaluate.py:strip_matlab_comments_and_strings"],
        "hash_freeze": [str(FREEZE_PATH.relative_to(REPOSITORY_ROOT))] if FREEZE_PATH.exists() else [],
        "framework_tests": ["codex-runtime/matlab/evals/tests/test_evaluate.py"],
        "matlab_runtime": ["nonce-bound MATLAB process exit", "matlab-runtime.json", "figures.json"] if gate_status["matlab_runtime"] == "passed" else [],
        "artifact_visual_audit": [str(visual_audit)] if gate_status["artifact_visual_audit"] == "passed" else [],
    }
    gates = [{"id": identifier, "weight": weights[identifier], "status": gate_status[identifier], "trusted_evidence": trusted_evidence[identifier]} for identifier in weights]
    score = sum(gate["weight"] for gate in gates if gate["status"] == "passed")
    static_failed = any(gate["status"] == "failed" for gate in gates if gate["id"] not in {"matlab_runtime", "artifact_visual_audit"})
    runtime_failed = gate_status["matlab_runtime"] == "failed" or gate_status["artifact_visual_audit"] == "failed"
    status = "failed" if static_failed or runtime_failed else ("passed" if score == 100 else "runtime_pending")
    remaining = [gate["id"] for gate in gates if gate["status"] != "passed"]
    payload = {
        "schema_version": 1,
        "generated_at": utc_now(),
        "status": status,
        "score": score,
        "maximum_score": 100,
        "gates": gates,
        "fixture_results": fixture_results,
        "runtime": runtime,
        "visual_audit": visual,
        "anti_cheat": {"status": "passed", "source_scan": source_result, "candidate_claims_ignored": ["score", "status", "passed", "gates"]},
        "freeze": verify_freeze_inventory() if FREEZE_PATH.exists() else {"status": "pending", "reason": "inventory not generated"},
        "tests": test_result,
        "remaining_runtime_gates": remaining,
    }
    validate_result_shape(payload, rubric)
    return payload


def validate_result_shape(payload: dict[str, Any], rubric: dict[str, Any]) -> None:
    required = {
        "schema_version", "status", "score", "maximum_score", "gates",
        "fixture_results", "runtime", "anti_cheat", "freeze", "remaining_runtime_gates",
    }
    if payload.get("schema_version") != 1 or not required <= payload.keys():
        raise EvaluationError("evaluation result is missing required score-schema fields")
    rubric_gates = rubric.get("gates")
    if not isinstance(rubric_gates, list) or sum(gate.get("weight", 0) for gate in rubric_gates) != 100:
        raise EvaluationError("rubric gate weights must sum to 100")
    result_gates = payload.get("gates")
    if not isinstance(result_gates, list) or [gate.get("id") for gate in result_gates] != [gate.get("id") for gate in rubric_gates]:
        raise EvaluationError("evaluation result gate order must match rubric order")
    computed_score = sum(gate["weight"] for gate in result_gates if gate.get("status") == "passed")
    if payload.get("score") != computed_score or payload.get("maximum_score") != 100:
        raise EvaluationError("evaluation score must be computed only from passed trusted gates")
    if payload.get("status") == "passed" and computed_score != 100:
        raise EvaluationError("passed status requires score 100")


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate the reproducible MATLAB full-score framework")
    parser.add_argument("--runtime", choices=("auto", "require", "skip"), default="auto")
    parser.add_argument("--output-dir", type=Path, default=FRAMEWORK_ROOT / "runtime-output")
    parser.add_argument("--visual-audit", type=Path)
    parser.add_argument("--result", type=Path)
    parser.add_argument("--timeout", type=int, default=1200)
    parser.add_argument("--runtime-evidence-dir", type=Path)
    parser.add_argument("--runtime-nonce")
    parser.add_argument("--runtime-start-marker", type=Path)
    parser.add_argument("--skip-tests", action="store_true")
    parser.add_argument("--write-freeze", action="store_true")
    parser.add_argument("--verify-freeze", action="store_true")
    arguments = parser.parse_args()
    try:
        if arguments.write_freeze:
            payload = write_freeze_inventory()
        elif arguments.verify_freeze:
            payload = verify_freeze_inventory()
        else:
            payload = evaluate(
                arguments.runtime,
                arguments.output_dir.resolve(),
                arguments.visual_audit,
                arguments.timeout,
                not arguments.skip_tests,
                arguments.runtime_evidence_dir,
                arguments.runtime_nonce,
                arguments.runtime_start_marker,
            )
        encoded = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
        if arguments.result:
            arguments.result.parent.mkdir(parents=True, exist_ok=True)
            arguments.result.write_text(encoded, encoding="utf-8")
        print(encoded, end="")
        return 0 if payload.get("status") in {"passed", "runtime_pending"} else 1
    except (EvaluationError, OSError, subprocess.SubprocessError) as error:
        print(json.dumps({"status": "failed", "error": str(error)}, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
