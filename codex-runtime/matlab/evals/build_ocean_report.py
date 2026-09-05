#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import statistics
import struct
import sys
import tempfile
import xml.etree.ElementTree as ElementTree
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any


EVAL_ROOT = Path(__file__).resolve().parent
DEFAULT_FIXTURE_DIRECTORY = EVAL_ROOT / "fixtures"
REPORT_NAME = "report.md"
EVIDENCE_NAME = "report-evidence.json"
SOURCE_CLASSIFICATION = "合成基准非实测海况"
EXPECTED_FIXTURES = {
    "crossed-time-depth-temperature": "crossed_time_depth_temperature.json",
    "paired-observation-model": "paired_observation_model.json",
    "repeat-cast-salinity-profiles": "repeat_cast_salinity_profiles.json",
}
EXPECTED_FIGURES = {
    "crossed-time-depth-temperature",
    "paired-interactive",
    "paired-observation-model",
    "repeat-cast-salinity-profiles",
}
REQUIRED_FORMATS = ("png", "pdf", "svg")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
MATLAB_RELEASE_PATTERN = re.compile(r"^(?:R)?(\d{4})([ab])$", re.IGNORECASE)
PDF_MEDIABOX_PATTERN = re.compile(
    rb"/MediaBox\s*\[\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+"
    rb"(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\]"
)


class ReportBuildError(ValueError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def require_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ReportBuildError(f"{field} must be nonblank text")
    return value.strip()


def require_bool(value: Any, field: str) -> bool:
    if not isinstance(value, bool):
        raise ReportBuildError(f"{field} must be boolean")
    return value


def require_nonnegative_integer(value: Any, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ReportBuildError(f"{field} must be a nonnegative integer")
    return value


def require_positive_number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        raise ReportBuildError(f"{field} must be a positive finite number")
    return float(value)


def parse_utc(value: Any, field: str) -> datetime:
    text = require_text(value, field)
    if not text.endswith("Z"):
        raise ReportBuildError(f"{field} must be a UTC timestamp ending in Z")
    try:
        parsed = datetime.fromisoformat(text[:-1] + "+00:00")
    except ValueError as error:
        raise ReportBuildError(f"{field} is not a valid UTC timestamp: {text}") from error
    if parsed.utcoffset() != timezone.utc.utcoffset(parsed):
        raise ReportBuildError(f"{field} must use UTC")
    return parsed


def normalize_matlab_release(value: Any, field: str) -> str:
    text = require_text(value, field)
    match = MATLAB_RELEASE_PATTERN.fullmatch(text)
    if match is None:
        raise ReportBuildError(f"{field} must use RYYYYa/b or YYYYa/b format")
    return f"R{match.group(1)}{match.group(2).lower()}"


def require_regular_file(path: Path, label: str) -> Path:
    if path.is_symlink() or not path.is_file():
        raise ReportBuildError(f"required {label} missing or not a regular file: {path}")
    if path.stat().st_size <= 0:
        raise ReportBuildError(f"required {label} is empty: {path}")
    return path


def load_json(path: Path, label: str) -> dict[str, Any]:
    require_regular_file(path, label)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ReportBuildError(f"invalid {label} JSON {path}: {error}") from error
    if not isinstance(payload, dict):
        raise ReportBuildError(f"{label} must contain a JSON object")
    return payload


def safe_artifact_path(root: Path, value: Any, field: str) -> tuple[str, Path]:
    relative = require_text(value, field)
    if "\\" in relative or "\x00" in relative:
        raise ReportBuildError(f"{field} must be a normalized relative POSIX path: {relative!r}")
    pure_path = PurePosixPath(relative)
    if pure_path.is_absolute() or any(part in {"", ".", ".."} for part in pure_path.parts):
        raise ReportBuildError(f"unsafe artifact path in {field}: {relative!r}")
    candidate = root.joinpath(*pure_path.parts)
    current = root
    for part in pure_path.parts:
        current = current / part
        if current.is_symlink():
            raise ReportBuildError(f"symlink artifact path is not allowed in {field}: {relative!r}")
    try:
        candidate.resolve().relative_to(root.resolve())
    except (OSError, ValueError) as error:
        raise ReportBuildError(f"artifact path escapes runtime output in {field}: {relative!r}") from error
    return pure_path.as_posix(), candidate


def png_dimensions(path: Path) -> tuple[float, float]:
    with path.open("rb") as handle:
        prefix = handle.read(24)
    if len(prefix) < 24 or not prefix.startswith(b"\x89PNG\r\n\x1a\n") or prefix[12:16] != b"IHDR":
        raise ReportBuildError(f"invalid PNG signature or IHDR: {path}")
    width, height = struct.unpack(">II", prefix[16:24])
    if width <= 0 or height <= 0:
        raise ReportBuildError(f"invalid PNG dimensions: {path}")
    return float(width), float(height)


def pdf_dimensions(path: Path) -> tuple[float, float, int]:
    payload = path.read_bytes()
    if not payload.lstrip().startswith(b"%PDF-"):
        raise ReportBuildError(f"invalid PDF signature: {path}")
    match = PDF_MEDIABOX_PATTERN.search(payload)
    page_count = len(re.findall(rb"/Type\s*/Page(?=\s|/|>>)", payload))
    if match is None or page_count <= 0:
        raise ReportBuildError(f"PDF page count or MediaBox is unavailable: {path}")
    x0, y0, x1, y1 = (float(value) for value in match.groups())
    width = x1 - x0
    height = y1 - y0
    if width <= 0 or height <= 0:
        raise ReportBuildError(f"invalid PDF dimensions: {path}")
    return width, height, page_count


def svg_dimensions(path: Path) -> tuple[float, float, float, float]:
    try:
        root = ElementTree.fromstring(path.read_bytes())
    except ElementTree.ParseError as error:
        raise ReportBuildError(f"invalid SVG XML: {path}: {error}") from error
    if root.tag.rsplit("}", 1)[-1].lower() != "svg":
        raise ReportBuildError(f"invalid SVG root element: {path}")
    width = parse_svg_length(root.attrib.get("width"), path, "width")
    height = parse_svg_length(root.attrib.get("height"), path, "height")
    view_box = require_text(root.attrib.get("viewBox") or root.attrib.get("viewbox"), "SVG viewBox")
    parts = re.split(r"[\s,]+", view_box.strip())
    if len(parts) != 4:
        raise ReportBuildError(f"invalid SVG viewBox: {path}")
    try:
        _, _, viewbox_width, viewbox_height = (float(value) for value in parts)
    except ValueError as error:
        raise ReportBuildError(f"invalid SVG viewBox: {path}") from error
    if width <= 0 or height <= 0 or viewbox_width <= 0 or viewbox_height <= 0:
        raise ReportBuildError(f"invalid SVG dimensions: {path}")
    return width, height, viewbox_width, viewbox_height


def parse_svg_length(value: Any, path: Path, field: str) -> float:
    text = require_text(value, f"SVG {field}")
    match = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)(?:px)?", text)
    if match is None:
        raise ReportBuildError(f"unsupported SVG {field} in {path}: {text!r}")
    return float(match.group(1))


def close_enough(actual: float, declared: float, tolerance: float = 0.75) -> bool:
    return abs(actual - declared) <= tolerance


def verify_artifact(
    runtime_root: Path,
    figure_id: str,
    format_name: str,
    export: Any,
    seen_paths: set[str],
) -> dict[str, Any]:
    if not isinstance(export, dict):
        raise ReportBuildError(f"figure {figure_id} missing {format_name} export metadata")
    relative, artifact_path = safe_artifact_path(runtime_root, export.get("file"), f"{figure_id}.exports.{format_name}.file")
    if PurePosixPath(relative).suffix.lower() != f".{format_name}":
        raise ReportBuildError(f"artifact extension does not match {format_name}: {relative}")
    if relative in seen_paths:
        raise ReportBuildError(f"duplicate artifact path in figures.json: {relative}")
    seen_paths.add(relative)
    require_regular_file(artifact_path, f"{format_name} artifact")

    expected_bytes = require_nonnegative_integer(export.get("bytes"), f"{figure_id}.exports.{format_name}.bytes")
    if expected_bytes == 0 or artifact_path.stat().st_size != expected_bytes:
        raise ReportBuildError(f"artifact byte count mismatch: {relative}")
    expected_hash = require_text(export.get("sha256"), f"{figure_id}.exports.{format_name}.sha256").lower()
    actual_hash = sha256_file(artifact_path)
    if not SHA256_PATTERN.fullmatch(expected_hash) or actual_hash != expected_hash:
        raise ReportBuildError(f"artifact sha256 mismatch: {relative}")

    declared_width = require_positive_number(export.get("width"), f"{figure_id}.exports.{format_name}.width")
    declared_height = require_positive_number(export.get("height"), f"{figure_id}.exports.{format_name}.height")
    pages: int | None = None
    if format_name == "png":
        actual_width, actual_height = png_dimensions(artifact_path)
        require_positive_number(export.get("dpi"), f"{figure_id}.exports.png.dpi")
    elif format_name == "pdf":
        actual_width, actual_height, pages = pdf_dimensions(artifact_path)
        declared_pages = require_nonnegative_integer(export.get("pages"), f"{figure_id}.exports.pdf.pages")
        if declared_pages == 0 or pages != declared_pages:
            raise ReportBuildError(f"PDF page count mismatch: {relative}")
    else:
        actual_width, actual_height, viewbox_width, viewbox_height = svg_dimensions(artifact_path)
        declared_viewbox_width = require_positive_number(export.get("viewbox_width"), f"{figure_id}.exports.svg.viewbox_width")
        declared_viewbox_height = require_positive_number(export.get("viewbox_height"), f"{figure_id}.exports.svg.viewbox_height")
        if not close_enough(viewbox_width, declared_viewbox_width) or not close_enough(viewbox_height, declared_viewbox_height):
            raise ReportBuildError(f"artifact viewBox dimensions mismatch: {relative}")
    if not close_enough(actual_width, declared_width) or not close_enough(actual_height, declared_height):
        raise ReportBuildError(
            f"artifact dimensions mismatch: {relative}; "
            f"declared={declared_width:g}x{declared_height:g}, actual={actual_width:g}x{actual_height:g}"
        )
    return {
        "file": relative,
        "format": format_name,
        "bytes": expected_bytes,
        "sha256": actual_hash,
        "width": actual_width,
        "height": actual_height,
        **({"pages": pages} if pages is not None else {}),
    }


def shape_size(shape: Any, field: str) -> int:
    if isinstance(shape, int) and not isinstance(shape, bool):
        if shape <= 0:
            raise ReportBuildError(f"{field} must be positive")
        return shape
    if not isinstance(shape, list) or not shape:
        raise ReportBuildError(f"{field} must be a positive integer or nonempty array")
    values = [require_nonnegative_integer(value, field) for value in shape]
    if any(value == 0 for value in values):
        raise ReportBuildError(f"{field} dimensions must be positive")
    return math.prod(values)


def verify_scientific_contract(figure: dict[str, Any], expected_counts: dict[str, int]) -> dict[str, Any]:
    figure_id = require_text(figure.get("id"), "figure.id")
    contract = figure.get("scientific_data_contract")
    if not isinstance(contract, dict):
        raise ReportBuildError(f"figure {figure_id} missing scientific_data_contract")
    if contract.get("provided") is not True or contract.get("required") is not True:
        raise ReportBuildError(f"figure {figure_id} scientific data contract is not required and provided")
    if contract.get("dataType") != "synthetic_fixture":
        raise ReportBuildError(f"figure {figure_id} must identify synthetic_fixture data")
    total_from_shape = shape_size(contract.get("shape"), f"{figure_id}.scientific_data_contract.shape")
    units = contract.get("units")
    if not isinstance(units, dict):
        raise ReportBuildError(f"figure {figure_id} missing units")
    unit = require_text(units.get("value"), f"{figure_id}.scientific_data_contract.units.value")
    missing = contract.get("missing")
    if not isinstance(missing, dict) or missing.get("status") != "present" or missing.get("policy") != "preserve":
        raise ReportBuildError(f"figure {figure_id} must preserve explicit missing data")
    total = require_nonnegative_integer(missing.get("total_count"), f"{figure_id}.missing.total_count")
    valid = require_nonnegative_integer(missing.get("valid_count"), f"{figure_id}.missing.valid_count")
    missing_count = require_nonnegative_integer(missing.get("missing_count"), f"{figure_id}.missing.missing_count")
    if total != total_from_shape or valid + missing_count != total:
        raise ReportBuildError(f"figure {figure_id} scientific count reconciliation failed")
    if (total, valid, missing_count) != (
        expected_counts["raw_count"],
        expected_counts["valid_count"],
        expected_counts["missing_count"],
    ):
        raise ReportBuildError(f"figure {figure_id} counts do not match fixture measurements")
    qc = contract.get("qc")
    uncertainty = contract.get("uncertainty")
    if not isinstance(qc, dict) or qc.get("status") != "present" or qc.get("action") != "preserve":
        raise ReportBuildError(f"figure {figure_id} QC contract is incomplete")
    if not isinstance(uncertainty, dict) or uncertainty.get("status") != "present":
        raise ReportBuildError(f"figure {figure_id} uncertainty contract is incomplete")
    return {"unit": unit, "raw_count": total, "valid_count": valid, "missing_count": missing_count}


def validate_runtime_bundle(runtime_root: Path, figure_counts: dict[str, dict[str, int]]) -> dict[str, Any]:
    if runtime_root.is_symlink() or not runtime_root.is_dir():
        raise ReportBuildError(f"runtime output directory is missing or unsafe: {runtime_root}")
    runtime_root = runtime_root.resolve()
    manifest_path = runtime_root / "figures.json"
    runtime_path = runtime_root / "matlab-runtime.json"
    manifest = load_json(manifest_path, "figures.json")
    runtime = load_json(runtime_path, "matlab-runtime.json")

    if runtime.get("schema_version") != 1:
        raise ReportBuildError("matlab-runtime.json schema_version must be 1")
    if runtime.get("runtime") != "MathWorks MATLAB" or runtime.get("success") is not True:
        raise ReportBuildError("matlab-runtime.json does not prove a successful MathWorks MATLAB run")
    nonce = require_text(runtime.get("nonce"), "runtime.nonce")
    if len(nonce) < 32:
        raise ReportBuildError("runtime.nonce must contain at least 32 characters")
    runtime_release = normalize_matlab_release(runtime.get("matlab_release"), "runtime.matlab_release")
    require_text(runtime.get("matlab_version"), "runtime.matlab_version")
    require_bool(runtime.get("jvm_available"), "runtime.jvm_available")
    require_bool(runtime.get("desktop_available"), "runtime.desktop_available")
    require_bool(runtime.get("batch_startup_option_used"), "runtime.batch_startup_option_used")
    manifest_reference, referenced_manifest = safe_artifact_path(runtime_root, runtime.get("manifest"), "runtime.manifest")
    if manifest_reference != "figures.json" or referenced_manifest != manifest_path:
        raise ReportBuildError("runtime.manifest must reference figures.json in the runtime output directory")
    fixture_ids = runtime.get("fixture_ids")
    if not isinstance(fixture_ids, list) or set(fixture_ids) != set(EXPECTED_FIXTURES):
        raise ReportBuildError("runtime.fixture_ids do not match the run_matlab_gate fixtures")
    interaction = runtime.get("interaction")
    if not isinstance(interaction, dict) or any(
        interaction.get(field) is not True
        for field in ("datatip_verified", "brush_stable_ids_verified", "headless_fallback_verified")
    ):
        raise ReportBuildError("runtime interaction assertions are incomplete")

    if manifest.get("schema_version") != 2:
        raise ReportBuildError("figures.json schema_version must be 2")
    parse_utc(manifest.get("generated_at"), "manifest.generated_at")
    require_text(manifest.get("generator"), "manifest.generator")
    if manifest.get("runtime_status") != "ready" or manifest.get("execution_verified") is not True:
        raise ReportBuildError("figures.json does not contain verified runtime execution")
    manifest_release = normalize_matlab_release(manifest.get("matlab_release"), "manifest.matlab_release")
    if manifest_release != runtime_release:
        raise ReportBuildError("MATLAB release differs between figures.json and matlab-runtime.json")
    artifact_validation = manifest.get("artifact_validation")
    if not isinstance(artifact_validation, dict) or artifact_validation.get("status") != "passed":
        raise ReportBuildError("figures.json artifact_validation did not pass")
    visual_inspection = manifest.get("visual_inspection")
    if not isinstance(visual_inspection, dict) or visual_inspection.get("status") != "not_run" or visual_inspection.get("verified") is not False:
        raise ReportBuildError("run_matlab_gate figures.json must honestly record visual inspection as not_run")
    export_formats = manifest.get("export_formats")
    if not isinstance(export_formats, list) or not set(REQUIRED_FORMATS) <= set(export_formats):
        raise ReportBuildError("figures.json must declare PNG, PDF, and SVG exports")

    figures = manifest.get("figures")
    if not isinstance(figures, list) or not figures:
        raise ReportBuildError("figures.json must contain figures")
    figure_ids = [require_text(figure.get("id"), "figure.id") for figure in figures if isinstance(figure, dict)]
    if len(figure_ids) != len(figures) or len(set(figure_ids)) != len(figure_ids):
        raise ReportBuildError("figures.json figure ids must be unique objects")
    if set(figure_ids) != EXPECTED_FIGURES:
        raise ReportBuildError("figures.json does not match the current run_matlab_gate figure set")

    artifacts: list[dict[str, Any]] = []
    figure_evidence: list[dict[str, Any]] = []
    seen_paths: set[str] = set()
    for figure in figures:
        figure_id = figure["id"]
        title = require_text(figure.get("title"), f"figure {figure_id}.title")
        source = require_text(figure.get("source"), f"figure {figure_id}.source")
        figure_runtime = figure.get("runtime")
        if not isinstance(figure_runtime, dict) or normalize_matlab_release(
            figure_runtime.get("matlab_release"), f"figure {figure_id}.runtime.matlab_release"
        ) != runtime_release:
            raise ReportBuildError(f"figure {figure_id} MATLAB release does not match runtime record")
        scientific = verify_scientific_contract(figure, figure_counts[figure_id])
        exports = figure.get("exports")
        if not isinstance(exports, dict) or set(exports) != set(REQUIRED_FORMATS):
            raise ReportBuildError(f"figure {figure_id} must contain exactly PNG, PDF, and SVG exports")
        checked_exports = []
        for format_name in REQUIRED_FORMATS:
            export = exports[format_name]
            if export.get("figure_id") != figure_id:
                raise ReportBuildError(f"figure identity mismatch in {figure_id} {format_name} export")
            checked = verify_artifact(runtime_root, figure_id, format_name, export, seen_paths)
            checked["figure_id"] = figure_id
            artifacts.append(checked)
            checked_exports.append(checked)
        figure_evidence.append(
            {
                "id": figure_id,
                "title": title,
                "source": source,
                "scientific_data": scientific,
                "exports": checked_exports,
            }
        )
    return {
        "manifest": manifest,
        "runtime": runtime,
        "matlab_release": runtime_release,
        "manifest_file": {"file": "figures.json", "bytes": manifest_path.stat().st_size, "sha256": sha256_file(manifest_path)},
        "runtime_file": {"file": "matlab-runtime.json", "bytes": runtime_path.stat().st_size, "sha256": sha256_file(runtime_path)},
        "figures": figure_evidence,
        "artifacts": artifacts,
    }


def flatten_matrix(values: Any, rows: int, columns: int, field: str) -> list[Any]:
    if not isinstance(values, list) or len(values) != rows:
        raise ReportBuildError(f"{field} must have {rows} rows")
    flattened: list[Any] = []
    for row in values:
        if not isinstance(row, list) or len(row) != columns:
            raise ReportBuildError(f"{field} must be a rectangular {rows}x{columns} matrix")
        flattened.extend(row)
    return flattened


def numeric_values(values: list[Any], field: str) -> list[float]:
    result: list[float] = []
    for value in values:
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ReportBuildError(f"{field} must contain finite numbers or null")
        result.append(float(value))
    return result


def summarize_numbers(values: list[float]) -> dict[str, float]:
    if not values:
        raise ReportBuildError("cannot summarize an empty numeric sequence")
    return {"minimum": min(values), "maximum": max(values), "mean": statistics.fmean(values)}


def validate_fixture_identity(payload: dict[str, Any], expected_id: str, file_name: str) -> None:
    if payload.get("schema_version") != 1 or payload.get("id") != expected_id:
        raise ReportBuildError(f"fixture identity mismatch: {file_name}")
    if payload.get("synthetic") is not True:
        raise ReportBuildError(f"fixture must declare synthetic=true: {file_name}")
    provenance = payload.get("provenance")
    if not isinstance(provenance, dict):
        raise ReportBuildError(f"fixture provenance missing: {file_name}")
    require_text(provenance.get("method"), f"{file_name}.provenance.method")
    require_text(provenance.get("formula"), f"{file_name}.provenance.formula")
    purpose = require_text(provenance.get("purpose"), f"{file_name}.provenance.purpose").lower()
    if "not an observed ocean dataset" not in purpose:
        raise ReportBuildError(f"fixture must disclaim observed ocean data: {file_name}")


def summarize_grid_fixture(payload: dict[str, Any], file_name: str) -> dict[str, Any]:
    kind = payload.get("kind")
    variable_name = "temperature" if kind == "time_depth_grid" else "salinity"
    coordinates = payload.get("coordinates")
    variables = payload.get("variables")
    if not isinstance(coordinates, dict) or not isinstance(variables, dict):
        raise ReportBuildError(f"fixture coordinates or variables missing: {file_name}")
    time_coordinate = coordinates.get("time")
    depth_coordinate = coordinates.get("depth")
    if not isinstance(time_coordinate, dict) or not isinstance(depth_coordinate, dict):
        raise ReportBuildError(f"fixture time/depth coordinates missing: {file_name}")
    times = time_coordinate.get("values")
    depths = depth_coordinate.get("values")
    if not isinstance(times, list) or len(times) < 2 or not isinstance(depths, list) or len(depths) < 2:
        raise ReportBuildError(f"fixture requires crossed time/depth coordinates: {file_name}")
    parsed_times = [parse_utc(value, f"{file_name}.coordinates.time") for value in times]
    if any(current <= previous for previous, current in zip(parsed_times, parsed_times[1:])):
        raise ReportBuildError(f"fixture time coordinate must be strictly increasing: {file_name}")
    if time_coordinate.get("timezone") != "UTC" or depth_coordinate.get("unit") != "m" or depth_coordinate.get("direction") != "positive_down":
        raise ReportBuildError(f"fixture coordinate contract is incomplete: {file_name}")
    if any(isinstance(value, bool) or not isinstance(value, (int, float)) for value in depths):
        raise ReportBuildError(f"fixture depths must be numeric: {file_name}")
    numeric_depths = [float(value) for value in depths]
    if min(numeric_depths) < 0 or any(current <= previous for previous, current in zip(numeric_depths, numeric_depths[1:])):
        raise ReportBuildError(f"fixture depths must be nonnegative and increasing: {file_name}")

    primary = variables.get(variable_name)
    uncertainty = variables.get(f"{variable_name}_standard_uncertainty")
    qc_variable = variables.get("qc")
    if not isinstance(primary, dict) or not isinstance(uncertainty, dict) or not isinstance(qc_variable, dict):
        raise ReportBuildError(f"fixture value, uncertainty, or QC variable missing: {file_name}")
    rows, columns = len(depths), len(times)
    primary_raw = flatten_matrix(primary.get("values"), rows, columns, f"{file_name}.{variable_name}")
    uncertainty_raw = flatten_matrix(uncertainty.get("values"), rows, columns, f"{file_name}.uncertainty")
    qc_raw = flatten_matrix(qc_variable.get("values"), rows, columns, f"{file_name}.qc")
    values = numeric_values(primary_raw, f"{file_name}.{variable_name}")
    uncertainties = numeric_values(uncertainty_raw, f"{file_name}.uncertainty")
    if [(value is None) for value in primary_raw] != [(value is None) for value in uncertainty_raw]:
        raise ReportBuildError(f"fixture value and uncertainty masks differ: {file_name}")
    if any(value < 0 for value in uncertainties):
        raise ReportBuildError(f"fixture uncertainty must be nonnegative: {file_name}")
    if any(not isinstance(value, str) or value not in {"good", "suspect", "missing"} for value in qc_raw):
        raise ReportBuildError(f"fixture contains unsupported QC values: {file_name}")
    for value, qc_value in zip(primary_raw, qc_raw):
        if (value is None) != (qc_value == "missing"):
            raise ReportBuildError(f"fixture missing values and QC state differ: {file_name}")
    unit = require_text(primary.get("unit"), f"{file_name}.{variable_name}.unit")
    if uncertainty.get("unit") != unit or uncertainty.get("type") != "standard_uncertainty":
        raise ReportBuildError(f"fixture uncertainty unit or type mismatch: {file_name}")
    raw_count = rows * columns
    missing_count = raw_count - len(values)
    return {
        "id": payload["id"],
        "file": file_name,
        "title": require_text(payload.get("title"), f"{file_name}.title"),
        "kind": kind,
        "variable": variable_name,
        "unit": unit,
        "time": {"start": times[0], "end": times[-1], "timezone": "UTC", "count": len(times)},
        "coordinates": {
            "longitude": {"status": "not_provided", "unit": "degrees_east", "values": None},
            "latitude": {"status": "not_provided", "unit": "degrees_north", "values": None},
            "depth": {"minimum": min(numeric_depths), "maximum": max(numeric_depths), "unit": "m", "positive": "down", "count": len(depths)},
        },
        "counts": {"raw_count": raw_count, "valid_count": len(values), "missing_count": missing_count},
        "qc": dict(sorted(Counter(qc_raw).items())),
        "statistics": summarize_numbers(values),
        "uncertainty": {"type": "standard_uncertainty", "unit": unit, **summarize_numbers(uncertainties)},
        "provenance": payload["provenance"],
        "sha256": None,
    }


def pearson_correlation(left: list[float], right: list[float]) -> float | None:
    if len(left) != len(right) or len(left) < 2:
        return None
    left_mean = statistics.fmean(left)
    right_mean = statistics.fmean(right)
    numerator = sum((x - left_mean) * (y - right_mean) for x, y in zip(left, right))
    left_scale = math.sqrt(sum((x - left_mean) ** 2 for x in left))
    right_scale = math.sqrt(sum((y - right_mean) ** 2 for y in right))
    if left_scale == 0 or right_scale == 0:
        return None
    return numerator / (left_scale * right_scale)


def summarize_paired_fixture(payload: dict[str, Any], file_name: str) -> dict[str, Any]:
    records = payload.get("records")
    contract = payload.get("contract")
    if not isinstance(records, list) or not records or not isinstance(contract, dict):
        raise ReportBuildError(f"paired fixture records or contract missing: {file_name}")
    if contract.get("time_zone") != "UTC" or contract.get("depth_direction") != "positive_down":
        raise ReportBuildError(f"paired fixture coordinate contract is incomplete: {file_name}")
    unit = require_text(contract.get("observation_unit"), f"{file_name}.observation_unit")
    if contract.get("model_unit") != unit or contract.get("uncertainty_unit") != unit:
        raise ReportBuildError(f"paired fixture units differ: {file_name}")
    if contract.get("uncertainty_type") != "standard_uncertainty":
        raise ReportBuildError(f"paired fixture uncertainty type is unsupported: {file_name}")

    identifiers: set[str] = set()
    times: list[str] = []
    depths: list[float] = []
    qc_values: list[str] = []
    observations: list[float] = []
    models: list[float] = []
    uncertainties: list[float] = []
    differences: list[float] = []
    within_uncertainty = 0
    missing_count = 0
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            raise ReportBuildError(f"paired record {index} must be an object")
        identifier = require_text(record.get("id"), f"{file_name}.records[{index}].id")
        if identifier in identifiers:
            raise ReportBuildError(f"duplicate paired record id: {identifier}")
        identifiers.add(identifier)
        timestamp = require_text(record.get("time"), f"{file_name}.records[{index}].time")
        parse_utc(timestamp, f"{file_name}.records[{index}].time")
        depth = record.get("depth_m")
        if isinstance(depth, bool) or not isinstance(depth, (int, float)) or not math.isfinite(depth) or depth < 0:
            raise ReportBuildError(f"invalid paired record depth: {identifier}")
        qc = require_text(record.get("qc"), f"{file_name}.records[{index}].qc")
        if qc not in {"good", "suspect", "missing"}:
            raise ReportBuildError(f"unsupported paired record QC: {qc}")
        observation = record.get("observation_degC")
        model = record.get("model_degC")
        uncertainty = record.get("uncertainty_degC")
        times.append(timestamp)
        depths.append(float(depth))
        qc_values.append(qc)
        if observation is None:
            missing_count += 1
            if uncertainty is not None or qc != "missing":
                raise ReportBuildError(f"missing paired observation must preserve uncertainty and QC: {identifier}")
            continue
        for field, value in (("observation", observation), ("model", model), ("uncertainty", uncertainty)):
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ReportBuildError(f"paired {field} must be finite for {identifier}")
        if uncertainty < 0:
            raise ReportBuildError(f"paired uncertainty must be nonnegative for {identifier}")
        observation_value = float(observation)
        model_value = float(model)
        uncertainty_value = float(uncertainty)
        difference = model_value - observation_value
        observations.append(observation_value)
        models.append(model_value)
        uncertainties.append(uncertainty_value)
        differences.append(difference)
        within_uncertainty += int(abs(difference) <= uncertainty_value)

    unique_times = sorted(set(times))
    unique_depths = sorted(set(depths))
    expected_pairs = len(unique_times) * len(unique_depths)
    if len(records) != expected_pairs or payload.get("design", {}).get("expected_pair_count") != expected_pairs:
        raise ReportBuildError(f"paired fixture is not a complete crossed design: {file_name}")
    valid_count = len(differences)
    correlation = pearson_correlation(observations, models)
    return {
        "id": payload["id"],
        "file": file_name,
        "title": require_text(payload.get("title"), f"{file_name}.title"),
        "kind": payload.get("kind"),
        "variable": "observation_model_temperature",
        "unit": unit,
        "time": {"start": unique_times[0], "end": unique_times[-1], "timezone": "UTC", "count": len(unique_times)},
        "coordinates": {
            "longitude": {"status": "not_provided", "unit": "degrees_east", "values": None},
            "latitude": {"status": "not_provided", "unit": "degrees_north", "values": None},
            "depth": {"minimum": min(unique_depths), "maximum": max(unique_depths), "unit": "m", "positive": "down", "count": len(unique_depths)},
        },
        "counts": {"raw_count": len(records), "valid_count": valid_count, "missing_count": missing_count},
        "qc": dict(sorted(Counter(qc_values).items())),
        "statistics": {
            "observation_mean": statistics.fmean(observations),
            "model_mean": statistics.fmean(models),
            "bias_model_minus_observation": statistics.fmean(differences),
            "mean_absolute_error": statistics.fmean(abs(value) for value in differences),
            "root_mean_square_error": math.sqrt(statistics.fmean(value * value for value in differences)),
            "pearson_correlation": correlation,
            "within_standard_uncertainty_count": within_uncertainty,
            "within_standard_uncertainty_fraction": within_uncertainty / valid_count,
        },
        "uncertainty": {"type": "standard_uncertainty", "unit": unit, **summarize_numbers(uncertainties)},
        "provenance": payload["provenance"],
        "sha256": None,
    }


def load_fixture_statistics(fixture_directory: Path) -> tuple[list[dict[str, Any]], dict[str, dict[str, int]]]:
    if fixture_directory.is_symlink() or not fixture_directory.is_dir():
        raise ReportBuildError(f"fixture directory is missing or unsafe: {fixture_directory}")
    summaries: list[dict[str, Any]] = []
    for expected_id, file_name in EXPECTED_FIXTURES.items():
        path = fixture_directory / file_name
        payload = load_json(path, f"fixture {file_name}")
        validate_fixture_identity(payload, expected_id, file_name)
        if payload.get("kind") in {"time_depth_grid", "repeat_profiles"}:
            summary = summarize_grid_fixture(payload, file_name)
        elif payload.get("kind") == "paired_records":
            summary = summarize_paired_fixture(payload, file_name)
        else:
            raise ReportBuildError(f"unsupported fixture kind in {file_name}: {payload.get('kind')!r}")
        summary["sha256"] = sha256_file(path)
        summary["bytes"] = path.stat().st_size
        summaries.append(summary)
    summaries.sort(key=lambda item: item["id"])
    by_id = {item["id"]: item for item in summaries}
    temperature = by_id["crossed-time-depth-temperature"]
    temperature_payload = load_json(
        fixture_directory / EXPECTED_FIXTURES["crossed-time-depth-temperature"],
        "temperature fixture",
    )
    interactive_row = temperature_payload["variables"]["temperature"]["values"][2]
    interactive_counts = {
        "raw_count": len(interactive_row),
        "valid_count": sum(value is not None for value in interactive_row),
        "missing_count": sum(value is None for value in interactive_row),
    }
    figure_counts = {
        "crossed-time-depth-temperature": temperature["counts"],
        "paired-interactive": interactive_counts,
        "paired-observation-model": by_id["paired-observation-model"]["counts"],
        "repeat-cast-salinity-profiles": by_id["repeat-cast-salinity-profiles"]["counts"],
    }
    return summaries, figure_counts


def format_number(value: float | None, digits: int = 3) -> str:
    if value is None:
        return "不可计算"
    return f"{value:.{digits}f}"


def dimension_label(artifact: dict[str, Any]) -> str:
    unit = "px" if artifact["format"] in {"png", "svg"} else "pt"
    value = f"{artifact['width']:g} x {artifact['height']:g} {unit}"
    if artifact["format"] == "pdf":
        value += f"，{artifact['pages']} 页"
    return value


def render_report(evidence: dict[str, Any]) -> str:
    fixtures = {item["id"]: item for item in evidence["fixtures"]}
    paired = fixtures["paired-observation-model"]
    runtime = evidence["runtime_evidence"]
    lines = [
        "# MATLAB 海洋合成基准证据报告",
        "",
        f"> 数据来源={SOURCE_CLASSIFICATION}。本报告只复述本地确定性 fixture 的复算统计与 `run_matlab_gate` 真实导出产物，不代表任何真实海区当前或历史海况。",
        "",
        "## 1. 报告范围与结论边界",
        "",
        "- 海区：未指定。fixture 没有命名海区、经度或纬度，不能映射到现实海域。",
        f"- 时间：全部时间使用 UTC；跨 fixture 总包络为 {evidence['coverage']['time']['start']} 至 {evidence['coverage']['time']['end']}，不同 fixture 之间不构成连续观测序列。",
        f"- 垂向坐标：{evidence['coverage']['depth']['minimum']:g}-{evidence['coverage']['depth']['maximum']:g} m，正方向向下；各 fixture 的实际范围见后表。",
        "- 水平坐标：经度与纬度均未提供，状态为 `not_provided`。",
        f"- 运行证据：{runtime['runtime']} {runtime['matlab_release']}；`figures.json` 记录执行已验证和产物校验通过。",
        "- 验证边界：未执行桌面人工验证，未执行人工视觉检查，不形成任何评分或生产验收结论。",
        "",
        "## 2. 数据来源与复算方法",
        "",
        "三份输入均声明 `synthetic=true`，来源方法为确定性公式，目的限定为 evaluation fixture。生成器独立读取原始 JSON，逐值复算有效数、缺测数、QC 分布、均值、极值、标准不确定度以及观测-模式配对误差；未从图中文字反推数值。[E1-E3]",
        "",
        "| Fixture | 变量 | UTC 时间 | 深度 | 单位 | 原始/有效/缺测 | QC |",
        "|---|---|---|---|---|---:|---|",
    ]
    for fixture in evidence["fixtures"]:
        qc = ", ".join(f"{key}={value}" for key, value in fixture["qc"].items())
        counts = fixture["counts"]
        depth = fixture["coordinates"]["depth"]
        lines.append(
            f"| `{fixture['id']}` | {fixture['variable']} | {fixture['time']['start']} 至 {fixture['time']['end']} | "
            f"{depth['minimum']:g}-{depth['maximum']:g} m | {fixture['unit']} | "
            f"{counts['raw_count']}/{counts['valid_count']}/{counts['missing_count']} | {qc} |"
        )

    for fixture_id, heading in (
        ("crossed-time-depth-temperature", "温度时间-深度合成场"),
        ("repeat-cast-salinity-profiles", "重复盐度剖面合成场"),
    ):
        fixture = fixtures[fixture_id]
        stats = fixture["statistics"]
        uncertainty = fixture["uncertainty"]
        figure = next(item for item in runtime["figures"] if item["id"] == fixture_id)
        png = next(item for item in figure["exports"] if item["format"] == "png")
        pdf = next(item for item in figure["exports"] if item["format"] == "pdf")
        svg = next(item for item in figure["exports"] if item["format"] == "svg")
        lines.extend(
            [
                "",
                f"## {3 if fixture_id.startswith('crossed') else 4}. {heading}",
                "",
                f"有效值均值 {format_number(stats['mean'])} {fixture['unit']}，范围 {format_number(stats['minimum'])}-{format_number(stats['maximum'])} {fixture['unit']}。"
                f"标准不确定度均值 {format_number(uncertainty['mean'])} {uncertainty['unit']}，范围 {format_number(uncertainty['minimum'])}-{format_number(uncertainty['maximum'])} {uncertainty['unit']}。"
                f"这些数值描述合成数组，不支持真实海区异常、趋势或机制判断。[E{1 if fixture_id.startswith('crossed') else 3}]",
                "",
                f"![{figure['title']}]({png['file']})",
                "",
                f"图件附件：[PDF]({pdf['file']})；[SVG]({svg['file']})。以上均为相对路径。",
            ]
        )

    paired_figure = next(item for item in runtime["figures"] if item["id"] == "paired-observation-model")
    paired_png = next(item for item in paired_figure["exports"] if item["format"] == "png")
    paired_pdf = next(item for item in paired_figure["exports"] if item["format"] == "pdf")
    paired_svg = next(item for item in paired_figure["exports"] if item["format"] == "svg")
    paired_stats = paired["statistics"]
    lines.extend(
        [
            "",
            "## 5. 观测-模式配对统计",
            "",
            f"完整交叉设计含 {paired['counts']['raw_count']} 条记录，其中 {paired['counts']['valid_count']} 对同时具有观测值与模式值，{paired['counts']['missing_count']} 对保留缺测。"
            f"按 `model - observation` 计算，偏差为 {format_number(paired_stats['bias_model_minus_observation'])} {paired['unit']}，"
            f"MAE 为 {format_number(paired_stats['mean_absolute_error'])} {paired['unit']}，RMSE 为 {format_number(paired_stats['root_mean_square_error'])} {paired['unit']}，"
            f"Pearson 相关系数为 {format_number(paired_stats['pearson_correlation'], 4)}。"
            f"绝对误差不超过逐记录标准不确定度的配对数为 {paired_stats['within_standard_uncertainty_count']}/{paired['counts']['valid_count']}。"
            "这是合成观测-模式基准的配对表现，不是生产模式验证结果。[E2]",
            "",
            f"![{paired_figure['title']}]({paired_png['file']})",
            "",
            f"图件附件：[PDF]({paired_pdf['file']})；[SVG]({paired_svg['file']})。",
            "",
            "## 6. Headless 交互回退证据",
            "",
        ]
    )
    interactive = next(item for item in runtime["figures"] if item["id"] == "paired-interactive")
    interactive_png = next(item for item in interactive["exports"] if item["format"] == "png")
    interactive_pdf = next(item for item in interactive["exports"] if item["format"] == "pdf")
    interactive_svg = next(item for item in interactive["exports"] if item["format"] == "svg")
    lines.extend(
        [
            "`matlab-runtime.json` 记录 DataTip 回调、Brush 稳定 ObservationID 和 headless fallback 断言成功。该证据来自批处理函数断言，只证明本次 headless 路径，不等于桌面交互或人工视觉验证。[E5]",
            "",
            f"![{interactive['title']}]({interactive_png['file']})",
            "",
            f"图件附件：[PDF]({interactive_pdf['file']})；[SVG]({interactive_svg['file']})。",
            "",
            "## 7. 产物完整性核验",
            "",
            "生成器对每个清单路径执行目录约束与符号链接检查，按文件内容复算 bytes 和 SHA-256，并从 PNG IHDR、PDF MediaBox/Page、SVG viewBox 或宽高属性复核尺寸。[E4]",
            "",
            "| 图 ID | 格式 | 相对路径 | 尺寸 | bytes | SHA-256 |",
            "|---|---|---|---|---:|---|",
        ]
    )
    for artifact in runtime["artifacts"]:
        lines.append(
            f"| `{artifact['figure_id']}` | {artifact['format'].upper()} | `{artifact['file']}` | "
            f"{dimension_label(artifact)} | {artifact['bytes']} | `{artifact['sha256']}` |"
        )
    lines.extend(
        [
            "",
            "## 8. 缺测、QC 与不确定度解释",
            "",
            "- 缺测保持为 `null -> NaN` 语义，不填补、不按零值处理。",
            "- QC 保留 `good`、`suspect`、`missing` 原状态；统计未把 `suspect` 自动删除，因此有效数与严格高质量样本数含义不同。",
            "- 不确定度为 fixture 提供的标准不确定度，仅用于描述合成输入和逐记录误差覆盖；没有扩展为现实仪器误差、代表性误差或海区综合不确定度。",
            "- 三份 fixture 的时间窗不同，合并包络不代表连续采样，也不用于趋势计算。",
            "",
            "## 9. 局限",
            "",
            "1. 数据来源为合成基准，非实测海况、遥感产品、再分析或业务预报。",
            "2. 没有命名海区及经纬度，无法生成真实空间覆盖、九区统计或海区风险判断。",
            "3. 样本规模只服务于绘图和合同回归，不能外推季节变化、异常事件或动力机制。",
            "4. `figures.json` 明确记录人工视觉检查未运行；本报告不补写桌面、字形、PDF 字体嵌入或人工审阅结论。",
            "5. 本报告不读取评分结果，也不声明满分、生产就绪或业务验收通过。",
            "",
            "## 10. 引用与可复核入口",
            "",
            f"- [E1] `{fixtures['crossed-time-depth-temperature']['file']}`，SHA-256 `{fixtures['crossed-time-depth-temperature']['sha256']}`。",
            f"- [E2] `{fixtures['paired-observation-model']['file']}`，SHA-256 `{fixtures['paired-observation-model']['sha256']}`。",
            f"- [E3] `{fixtures['repeat-cast-salinity-profiles']['file']}`，SHA-256 `{fixtures['repeat-cast-salinity-profiles']['sha256']}`。",
            f"- [E4] `figures.json`，SHA-256 `{runtime['manifest_file']['sha256']}`。",
            f"- [E5] `matlab-runtime.json`，SHA-256 `{runtime['runtime_file']['sha256']}`。",
            "- 机器可读复核结果：[`report-evidence.json`](report-evidence.json)。",
            "",
        ]
    )
    return "\n".join(lines)


def build_evidence(fixtures: list[dict[str, Any]], runtime_bundle: dict[str, Any], generated_at: str) -> dict[str, Any]:
    time_starts = [parse_utc(item["time"]["start"], f"{item['id']}.time.start") for item in fixtures]
    time_ends = [parse_utc(item["time"]["end"], f"{item['id']}.time.end") for item in fixtures]
    depth_minimum = min(item["coordinates"]["depth"]["minimum"] for item in fixtures)
    depth_maximum = max(item["coordinates"]["depth"]["maximum"] for item in fixtures)
    return {
        "schema_version": 1,
        "generated_at": generated_at,
        "status": "passed",
        "data_source": {
            "classification": "synthetic_benchmark",
            "label": SOURCE_CLASSIFICATION,
            "observed_ocean_conditions": False,
            "production_data": False,
            "method": "deterministic local evaluation fixtures",
        },
        "area": {
            "name": "未指定（合成基准）",
            "status": "not_provided",
            "bounds": None,
            "longitude": {"status": "not_provided", "unit": "degrees_east"},
            "latitude": {"status": "not_provided", "unit": "degrees_north"},
        },
        "coverage": {
            "time": {
                "start": min(time_starts).isoformat().replace("+00:00", "Z"),
                "end": max(time_ends).isoformat().replace("+00:00", "Z"),
                "timezone": "UTC",
                "continuity": "not_continuous_across_fixtures",
            },
            "depth": {"minimum": depth_minimum, "maximum": depth_maximum, "unit": "m", "positive": "down"},
            "horizontal_coordinates": {"status": "not_provided"},
        },
        "fixtures": fixtures,
        "runtime_evidence": {
            "runtime": runtime_bundle["runtime"]["runtime"],
            "matlab_version": runtime_bundle["runtime"]["matlab_version"],
            "matlab_release": runtime_bundle["matlab_release"],
            "execution_verified": True,
            "batch_startup_option_used": runtime_bundle["runtime"]["batch_startup_option_used"],
            "jvm_available": runtime_bundle["runtime"]["jvm_available"],
            "desktop_available": runtime_bundle["runtime"]["desktop_available"],
            "desktop_validation": {"status": "not_performed", "reason": "run_matlab_gate records batch/headless assertions only"},
            "visual_inspection": runtime_bundle["manifest"]["visual_inspection"],
            "interaction_assertions": runtime_bundle["runtime"]["interaction"],
            "manifest_file": runtime_bundle["manifest_file"],
            "runtime_file": runtime_bundle["runtime_file"],
            "figures": runtime_bundle["figures"],
            "artifacts": runtime_bundle["artifacts"],
        },
        "limitations": [
            "Synthetic deterministic fixtures are not observed ocean conditions.",
            "No named sea area, longitude, or latitude is supplied.",
            "Fixture time windows are separate and do not form a continuous record.",
            "Desktop validation and trusted visual inspection were not performed.",
            "No evaluation score or production-readiness claim is made.",
        ],
        "references": [
            {"id": "E1", "type": "fixture", "file": "crossed_time_depth_temperature.json"},
            {"id": "E2", "type": "fixture", "file": "paired_observation_model.json"},
            {"id": "E3", "type": "fixture", "file": "repeat_cast_salinity_profiles.json"},
            {"id": "E4", "type": "manifest", "file": "figures.json"},
            {"id": "E5", "type": "runtime", "file": "matlab-runtime.json"},
        ],
    }


def write_outputs(runtime_root: Path, report_text: str, evidence: dict[str, Any]) -> dict[str, Any]:
    report_path = runtime_root / REPORT_NAME
    evidence_path = runtime_root / EVIDENCE_NAME
    for output in (report_path, evidence_path):
        if output.is_symlink():
            raise ReportBuildError(f"refusing to replace symlink output: {output}")
    report_payload = report_text.encode("utf-8")
    evidence["report"] = {
        "file": REPORT_NAME,
        "bytes": len(report_payload),
        "sha256": sha256_bytes(report_payload),
    }
    evidence_payload = (json.dumps(evidence, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    temporary_paths: list[Path] = []
    try:
        for payload in (report_payload, evidence_payload):
            with tempfile.NamedTemporaryFile(dir=runtime_root, prefix=".ocean-report-", delete=False) as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
                temporary_paths.append(Path(handle.name))
        os.replace(temporary_paths[0], report_path)
        temporary_paths.pop(0)
        os.replace(temporary_paths[0], evidence_path)
        temporary_paths.pop(0)
    finally:
        for path in temporary_paths:
            path.unlink(missing_ok=True)
    return {
        "status": "passed",
        "report": {"path": str(report_path), "bytes": report_path.stat().st_size, "sha256": sha256_file(report_path)},
        "evidence": {"path": str(evidence_path), "bytes": evidence_path.stat().st_size, "sha256": sha256_file(evidence_path)},
        "artifact_count": len(evidence["runtime_evidence"]["artifacts"]),
    }


def build_ocean_report(runtime_output: Path, fixture_directory: Path = DEFAULT_FIXTURE_DIRECTORY) -> dict[str, Any]:
    runtime_root = runtime_output.resolve()
    fixtures, figure_counts = load_fixture_statistics(fixture_directory.resolve())
    runtime_bundle = validate_runtime_bundle(runtime_root, figure_counts)
    generated_at = utc_now()
    evidence = build_evidence(fixtures, runtime_bundle, generated_at)
    report_text = render_report(evidence)
    return write_outputs(runtime_root, report_text, evidence)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Build an evidence-bound Chinese report from run_matlab_gate output and synthetic fixtures"
    )
    parser.add_argument("--runtime-output", type=Path, required=True, help="Directory containing figures.json, matlab-runtime.json, and exports")
    parser.add_argument("--fixture-dir", type=Path, default=DEFAULT_FIXTURE_DIRECTORY, help="Directory containing the three repository evaluation fixtures")
    arguments = parser.parse_args(argv)
    try:
        result = build_ocean_report(arguments.runtime_output, arguments.fixture_dir)
    except (ReportBuildError, OSError) as error:
        print(json.dumps({"status": "failed", "error": str(error)}, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
