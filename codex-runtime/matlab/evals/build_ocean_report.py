#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import html
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
FIXTURE_KINDS = {
    "crossed-time-depth-temperature": "time_depth_grid",
    "paired-observation-model": "paired_records",
    "repeat-cast-salinity-profiles": "repeat_profiles",
}
GRID_NATIVE_SOURCES = {
    "crossed-time-depth-temperature": "Image.CData",
    "repeat-cast-salinity-profiles": "Lines.XData",
}
INTERACTIVE_NATIVE_SOURCE = (
    "Lines(1).XData/YData;"
    "UncertaintyHandles(1).XData/YData/YNegativeDelta/YPositiveDelta"
)
FIXTURE_BINDING_LIMITATION = (
    "Runtime records contain fixture IDs but no fixture content hashes or coordinate values; "
    "matching metadata does not verify which numeric fixture snapshot MATLAB consumed."
)
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


def numeric_equal(actual: Any, expected: Any) -> bool:
    if isinstance(actual, bool) or isinstance(expected, bool):
        return False
    if actual is None or expected is None:
        return actual is expected
    if not isinstance(actual, (int, float)) or not isinstance(expected, (int, float)):
        return False
    try:
        return math.isfinite(actual) and math.isfinite(expected) and actual == expected
    except OverflowError:
        return False


def require_vector(value: Any, count: int, field: str) -> list[Any]:
    if not isinstance(value, list) or len(value) != count:
        raise ReportBuildError(f"{field} must be a JSON array of length {count}")
    return value


def parse_utc(value: Any, field: str) -> datetime:
    text = require_text(value, field)
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z", text):
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


def unique_json_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ReportBuildError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def reject_json_constant(value: str) -> None:
    raise ReportBuildError(f"non-finite JSON number: {value}")


def load_json_snapshot(path: Path, label: str) -> tuple[dict[str, Any], dict[str, Any]]:
    require_regular_file(path, label)
    try:
        content = path.read_bytes()
        payload = json.loads(content, object_pairs_hook=unique_json_object, parse_constant=reject_json_constant)
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ReportBuildError(f"invalid {label} JSON {path}: {error}") from error
    if not isinstance(payload, dict):
        raise ReportBuildError(f"{label} must contain a JSON object")
    return payload, {"bytes": len(content), "sha256": sha256_bytes(content)}


def load_json(path: Path, label: str) -> dict[str, Any]:
    return load_json_snapshot(path, label)[0]


def safe_artifact_path(root: Path, value: Any, field: str) -> tuple[str, Path]:
    relative = require_text(value, field)
    if "\\" in relative or ":" in relative or any(ord(character) < 32 for character in relative):
        raise ReportBuildError(f"{field} must be a normalized relative POSIX path: {relative!r}")
    pure_path = PurePosixPath(relative)
    if pure_path.is_absolute() or any(part in {"", ".", ".."} for part in relative.split("/")):
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


def verify_scientific_contract(figure: dict[str, Any], expected: dict[str, Any]) -> dict[str, Any]:
    figure_id = require_text(figure.get("id"), "figure.id")
    contract = figure.get("scientific_data_contract")
    if not isinstance(contract, dict):
        raise ReportBuildError(f"figure {figure_id} missing scientific_data_contract")
    if contract.get("provided") is not True or contract.get("required") is not True:
        raise ReportBuildError(f"figure {figure_id} scientific data contract is not required and provided")
    if contract.get("dataType") != "synthetic_fixture":
        raise ReportBuildError(f"figure {figure_id} must identify synthetic_fixture data")
    total_from_shape = shape_size(contract.get("shape"), f"{figure_id}.scientific_data_contract.shape")
    shape = contract["shape"] if isinstance(contract["shape"], list) else [contract["shape"]]
    dimension_order = contract.get("dimensionOrder")
    dimension_order = dimension_order if isinstance(dimension_order, list) else [dimension_order]
    if shape != expected["shape"] or dimension_order != expected["dimension_order"]:
        raise ReportBuildError(f"figure {figure_id} shape or dimension order differs from fixture selection")
    if (require_nonnegative_integer(contract.get("rank"), f"{figure_id}.rank") != len(shape)
            or contract.get("observationDimension") != dimension_order[0]):
        raise ReportBuildError(f"figure {figure_id} rank or observation dimension differs from fixture")
    coordinates = contract.get("coordinates")
    if not isinstance(coordinates, dict) or set(coordinates) != set(dimension_order):
        raise ReportBuildError(f"figure {figure_id} coordinate axes differ from fixture selection")
    for name, count in zip(dimension_order, shape):
        coordinate = coordinates[name]
        if not isinstance(coordinate, dict):
            raise ReportBuildError(f"figure {figure_id} coordinate {name} must be an object")
        expected_unit = {"depth": "m", "time": "datetime", "observation": "1"}[name]
        expected_direction = "positive_down" if name == "depth" else "increasing"
        if (require_nonnegative_integer(coordinate.get("count"), f"{figure_id}.{name}.count") != count
                or coordinate.get("unit") != expected_unit or coordinate.get("direction") != expected_direction):
            raise ReportBuildError(f"figure {figure_id} coordinate count/unit/direction differs from fixture")
        if name == "time" and (coordinate.get("timezone") != "UTC" or contract.get("timeZone") != "UTC"):
            raise ReportBuildError(f"figure {figure_id} time coordinate must use UTC")
    units = contract.get("units")
    if not isinstance(units, dict):
        raise ReportBuildError(f"figure {figure_id} missing units")
    unit = require_text(units.get("value"), f"{figure_id}.scientific_data_contract.units.value")
    if unit != expected["unit"]:
        raise ReportBuildError(f"figure {figure_id} unit differs from fixture: {unit}")
    missing = contract.get("missing")
    if not isinstance(missing, dict) or missing.get("status") != "present" or missing.get("policy") != "preserve":
        raise ReportBuildError(f"figure {figure_id} must preserve explicit missing data")
    if missing.get("representation") != "NaN" or require_nonnegative_integer(missing.get("masked_count"), "masked_count") != 0:
        raise ReportBuildError(f"figure {figure_id} missing representation or masked count differs from gate")
    total = require_nonnegative_integer(missing.get("total_count"), f"{figure_id}.missing.total_count")
    valid = require_nonnegative_integer(missing.get("valid_count"), f"{figure_id}.missing.valid_count")
    missing_count = require_nonnegative_integer(missing.get("missing_count"), f"{figure_id}.missing.missing_count")
    if total != total_from_shape or valid + missing_count != total:
        raise ReportBuildError(f"figure {figure_id} scientific count reconciliation failed")
    if (total, valid, missing_count) != (
        expected["counts"]["raw_count"],
        expected["counts"]["valid_count"],
        expected["counts"]["missing_count"],
    ):
        raise ReportBuildError(f"figure {figure_id} counts do not match fixture measurements")
    qc = contract.get("qc")
    uncertainty = contract.get("uncertainty")
    if not isinstance(qc, dict) or qc.get("status") != "present" or qc.get("action") != "preserve":
        raise ReportBuildError(f"figure {figure_id} QC contract is incomplete")
    if not isinstance(uncertainty, dict) or uncertainty.get("status") != "present":
        raise ReportBuildError(f"figure {figure_id} uncertainty contract is incomplete")
    return {
        "unit": unit, "raw_count": total, "valid_count": valid, "missing_count": missing_count,
        "shape": shape, "dimension_order": dimension_order,
        "qc": {"source_status": "present", "report_policy": "preserve_including_suspect",
               "report_rejected_count": 0, "plot_filtering": "not_verified"},
        "uncertainty": {"source_status": "present", "plot_display": "not_verified"},
    }


def validate_input_fixtures(
    runtime_root: Path, runtime: dict[str, Any], figure_contexts: dict[str, dict[str, Any]]
) -> dict[str, dict[str, Any]]:
    if "input_fixtures" not in runtime:
        return {}
    inputs = runtime["input_fixtures"]
    if not isinstance(inputs, list) or len(inputs) != len(EXPECTED_FIXTURES):
        raise ReportBuildError("runtime.input_fixtures must contain exactly three fixture records")
    verified: dict[str, dict[str, Any]] = {}
    for item in inputs:
        if not isinstance(item, dict) or set(item) != {"id", "file", "source_file", "bytes", "sha256"}:
            raise ReportBuildError("runtime.input_fixtures record fields must be id/file/source_file/bytes/sha256")
        identifier = item["id"]
        if not isinstance(identifier, str) or identifier not in EXPECTED_FIXTURES or identifier in verified:
            raise ReportBuildError("runtime.input_fixtures contains an unknown or duplicate fixture id")
        source_file = EXPECTED_FIXTURES[identifier]
        expected_file = f"fixture-inputs/{source_file}"
        if item["source_file"] != source_file or item["file"] != expected_file:
            raise ReportBuildError(f"runtime.input_fixtures path/source_file mismatch for {identifier}")
        relative, snapshot_path = safe_artifact_path(runtime_root, item["file"], "runtime.input_fixtures.file")
        byte_count = require_nonnegative_integer(item["bytes"], "runtime.input_fixtures.bytes")
        if byte_count == 0:
            raise ReportBuildError("runtime.input_fixtures.bytes must be positive")
        digest = item["sha256"]
        if not isinstance(digest, str) or SHA256_PATTERN.fullmatch(digest) is None:
            raise ReportBuildError("runtime.input_fixtures.sha256 must contain 64 lowercase hexadecimal characters")
        require_regular_file(snapshot_path, "fixture input snapshot")
        content = snapshot_path.read_bytes()
        if len(content) != byte_count or sha256_bytes(content) != digest:
            raise ReportBuildError(f"fixture input snapshot bytes/sha256 mismatch: {relative}")
        local = figure_contexts[identifier]
        if byte_count != local["fixture_bytes"] or digest != local["fixture_sha256"]:
            raise ReportBuildError(f"runtime fixture input differs from local statistics input: {identifier}")
        verified[identifier] = {
            "id": identifier, "file": relative, "source_file": source_file,
            "bytes": byte_count, "sha256": digest,
        }
    return verified


def manifest_object_list(value: Any, field: str) -> list[dict[str, Any]]:
    records = [value] if isinstance(value, dict) else value
    if not isinstance(records, list) or any(not isinstance(record, dict) or not record for record in records):
        raise ReportBuildError(f"{field} must be an object or a flat list of objects")
    return records


def validate_layout_measurement(figure: dict[str, Any]) -> dict[str, Any]:
    figure_id = figure["id"]
    rendering = figure.get("rendering_evidence", {})
    publication = figure.get("publication", {})
    if not isinstance(rendering, dict) or not isinstance(publication, dict):
        raise ReportBuildError(f"figure {figure_id} rendering_evidence/publication must be objects")
    layout = publication.get("layout", {})
    if not isinstance(layout, dict):
        raise ReportBuildError(f"figure {figure_id} publication.layout must be an object")
    result = {
        "status": "not_available",
        "evidence_source": "figures.json declarations; not independently remeasured",
        "bounds_audit_scope": "not_available",
        "bounds_audit_complete": None,
        "unmeasured_count": None,
        "unmeasured_text_objects": None,
        "bounds_audited": None,
        "layout_stable_declared": None,
    }
    for field, output in (("text_objects", "measured_text_count"), ("axes_objects", "measured_axes_count")):
        result[output] = len(manifest_object_list(figure[field], f"{figure_id}.{field}")) if field in figure else None
    for field in ("clipped_count", "text_overlap_count"):
        result[field] = require_nonnegative_integer(rendering[field], f"{figure_id}.{field}") if field in rendering else None
    if "bounds_audited" in rendering:
        result["bounds_audited"] = require_bool(rendering["bounds_audited"], f"{figure_id}.bounds_audited")
    if "stable" in layout:
        result["layout_stable_declared"] = require_bool(layout["stable"], f"{figure_id}.publication.layout.stable")
    new_fields = ("bounds_audit_scope", "bounds_audit_complete", "unmeasured_count")
    provided = ["unmeasured_text_objects" in figure, *(field in rendering for field in new_fields)]
    if not any(provided):
        return result
    if not all(provided):
        raise ReportBuildError(f"figure {figure_id} layout measurement fields are incomplete")
    if rendering["bounds_audit_scope"] != "measured_objects_only":
        raise ReportBuildError(f"figure {figure_id} bounds_audit_scope must be measured_objects_only")
    complete = require_bool(rendering["bounds_audit_complete"], f"{figure_id}.bounds_audit_complete")
    count = require_nonnegative_integer(rendering["unmeasured_count"], f"{figure_id}.unmeasured_count")
    unmeasured = manifest_object_list(figure["unmeasured_text_objects"], f"{figure_id}.unmeasured_text_objects")
    if count != len(unmeasured) or complete != (count == 0):
        raise ReportBuildError(f"figure {figure_id} bounds completeness/count contradict the unmeasured text list")
    if result["bounds_audited"] is not True:
        raise ReportBuildError(f"figure {figure_id} layout measurement requires bounds_audited=true")
    if result["layout_stable_declared"] is not None and result["layout_stable_declared"] != complete:
        raise ReportBuildError(f"figure {figure_id} layout.stable contradicts bounds_audit_complete")
    for record in unmeasured:
        if set(record) != {"role", "string", "font_name", "font_size", "class", "geometry_status"}:
            raise ReportBuildError(f"figure {figure_id} unmeasured text must contain only public text/font identity and geometry_status")
        for field in ("role", "string", "font_name", "class", "geometry_status"):
            require_text(record[field], f"{figure_id}.unmeasured_text.{field}")
        if (record["role"] not in {"layout.title", "layout.subtitle", "layout.xlabel", "layout.ylabel"}
                or record["class"] != "matlab.graphics.layout.Text" or record["geometry_status"] != "unverified"):
            raise ReportBuildError(f"figure {figure_id} unmeasured layout text must retain unverified geometry")
        require_positive_number(record["font_size"], f"{figure_id}.unmeasured_text.font_size")
    result.update({
        "status": "available", "bounds_audit_scope": rendering["bounds_audit_scope"],
        "bounds_audit_complete": complete, "unmeasured_count": count,
        "unmeasured_text_objects": unmeasured,
    })
    return result


def validate_interactive_plot_data_evidence(
    declaration: Any, context: dict[str, Any], input_bound: bool, runtime_release: str
) -> dict[str, Any]:
    fields = {
        "schema_version", "figure_id", "fixture_id", "fixture_sha256", "matlab_release",
        "dimension_order", "shape", "selection", "time_utc", "time_zone", "quantity_unit",
        "missing_policy", "native_data_source", "native_values", "missing_mask",
        "observation_ids", "source_rows", "source_row_origin", "input_match_asserted", "qc", "uncertainty",
    }
    if not isinstance(declaration, dict) or set(declaration) != fields:
        raise ReportBuildError("paired-interactive plot_data_evidence fields are missing or unsupported")
    if require_nonnegative_integer(declaration["schema_version"], "plot_data_evidence.schema_version") != 2:
        raise ReportBuildError("paired-interactive plot_data_evidence.schema_version must be 2")
    for field, expected in {
        "figure_id": "paired-interactive", "fixture_id": context["fixture_id"],
        "fixture_sha256": context["fixture_sha256"], "time_zone": "UTC",
        "quantity_unit": context["unit"], "missing_policy": "preserve",
        "native_data_source": INTERACTIVE_NATIVE_SOURCE, "source_row_origin": "call_entry_order",
    }.items():
        if not isinstance(declaration[field], str) or declaration[field] != expected:
            raise ReportBuildError(f"paired-interactive plot_data_evidence.{field} differs from the fixture contract")
    if normalize_matlab_release(declaration["matlab_release"], "plot_data_evidence.matlab_release") != runtime_release:
        raise ReportBuildError("paired-interactive plot_data_evidence MATLAB release mismatch")
    if require_bool(declaration["input_match_asserted"], "plot_data_evidence.input_match_asserted") is not True:
        raise ReportBuildError("plot_data_evidence input match assertion must be true")
    selection = declaration["selection"]
    if not isinstance(selection, dict) or set(selection) != {"kind", "index_zero_based", "depth_m"}:
        raise ReportBuildError("plot_data_evidence selection fields are missing or unsupported")
    index = require_nonnegative_integer(selection["index_zero_based"], "plot_data_evidence.selection.index_zero_based")
    if (selection["kind"] != context["selection"]["kind"]
            or index != context["selection"]["index_zero_based"]
            or not numeric_equal(selection["depth_m"], context["selection"]["depth_m"])):
        raise ReportBuildError("plot_data_evidence selection differs from the third fixture depth row")

    expected = context["plot_input"]
    expected_values = expected["values"]
    expected_uncertainty = expected["uncertainty_values"]
    count = len(expected_values)
    for field, source in (("shape", [count]), ("source_rows", list(range(1, count + 1)))):
        vector = require_vector(declaration[field], len(source), f"plot_data_evidence.{field}")
        for value in vector:
            require_nonnegative_integer(value, f"plot_data_evidence.{field}")
        if vector != source:
            raise ReportBuildError(f"plot_data_evidence.{field} differs from fixture call-entry order/shape")
    qc = declaration["qc"]
    uncertainty = declaration["uncertainty"]
    if not isinstance(qc, dict) or set(qc) != {"provided", "policy", "flags"}:
        raise ReportBuildError("plot_data_evidence QC fields are missing or unsupported")
    uncertainty_fields = {"present", "type", "unit", "representation", "confidence_level", "display",
                          "values", "missing_mask", "joint_valid_mask", "errorbar"}
    if not isinstance(uncertainty, dict) or set(uncertainty) != uncertainty_fields:
        raise ReportBuildError("plot_data_evidence uncertainty fields are missing or unsupported")
    if require_bool(qc["provided"], "plot_data_evidence.qc.provided") is not True or qc["policy"] != "preserve":
        raise ReportBuildError("plot_data_evidence QC must be provided and preserved")
    uncertainty_type = {"standard_uncertainty": "standard-uncertainty"}.get(context["uncertainty"]["type"])
    if (require_bool(uncertainty["present"], "plot_data_evidence.uncertainty.present") is not True
            or uncertainty_type is None or uncertainty["type"] != uncertainty_type
            or uncertainty["unit"] != context["uncertainty"]["unit"]
            or uncertainty["representation"] != "magnitude" or uncertainty["confidence_level"] is not None
            or uncertainty["display"] != "errorbar"):
        raise ReportBuildError("plot_data_evidence uncertainty must preserve fixture standard-uncertainty magnitudes as errorbar")
    errorbar = uncertainty["errorbar"]
    if not isinstance(errorbar, dict) or set(errorbar) != {"time_utc", "values", "negative_delta", "positive_delta"}:
        raise ReportBuildError("plot_data_evidence errorbar fields are missing or unsupported")

    for field, values, source in (
        ("dimension_order", declaration["dimension_order"], ["time"]),
        ("observation_ids", declaration["observation_ids"], context["observation_ids"]),
        ("qc.flags", qc["flags"], expected["qc_flags"]),
    ):
        vector = require_vector(values, len(source), f"plot_data_evidence.{field}")
        if any(not isinstance(value, str) for value in vector) or vector != source:
            raise ReportBuildError(f"plot_data_evidence.{field} differs from complete fixture identity/order")
    expected_times = [parse_utc(value, "fixture.time_utc") for value in context["time"]["values"]]
    for field, values in (("time_utc", declaration["time_utc"]), ("uncertainty.errorbar.time_utc", errorbar["time_utc"])):
        vector = require_vector(values, count, f"plot_data_evidence.{field}")
        if [parse_utc(value, f"plot_data_evidence.{field}") for value in vector] != expected_times:
            raise ReportBuildError(f"plot_data_evidence.{field} differs from the complete fixture time vector")
    for field, values, source in (
        ("native_values", declaration["native_values"], expected_values),
        ("uncertainty.values", uncertainty["values"], expected_uncertainty),
        ("uncertainty.errorbar.values", errorbar["values"], expected_values),
        ("uncertainty.errorbar.negative_delta", errorbar["negative_delta"], expected_uncertainty),
        ("uncertainty.errorbar.positive_delta", errorbar["positive_delta"], expected_uncertainty),
    ):
        vector = require_vector(values, count, f"plot_data_evidence.{field}")
        if not all(numeric_equal(value, expected_value) for value, expected_value in zip(vector, source)):
            raise ReportBuildError(f"plot_data_evidence.{field} differs from the complete fixture array")
    for field, values, source in (
        ("missing_mask", declaration["missing_mask"], [value is None for value in expected_values]),
        ("uncertainty.missing_mask", uncertainty["missing_mask"], [value is None for value in expected_uncertainty]),
        ("uncertainty.joint_valid_mask", uncertainty["joint_valid_mask"],
         [value is not None and magnitude is not None for value, magnitude in zip(expected_values, expected_uncertainty)]),
    ):
        vector = require_vector(values, count, f"plot_data_evidence.{field}")
        for value in vector:
            require_bool(value, f"plot_data_evidence.{field}")
        if vector != source:
            raise ReportBuildError(f"plot_data_evidence.{field} differs from the fixture missing/joint mask")
    return {
        "status": "runtime_declaration_verified" if input_bound else "not_verified",
        "provided": True, "local_arrays_match": True, "input_fixture_binding_verified": input_bound,
        "reason": "Native Line/ErrorBar declarations match complete fixture arrays and identity; not independently re-executed"
        if input_bound else "Arrays match local fixtures but runtime input bytes are not bound",
        "declaration": declaration,
    }


def validate_plot_data_evidence(
    figure: dict[str, Any], context: dict[str, Any], input_bound: bool, runtime_release: str
) -> dict[str, Any]:
    figure_id = figure["id"]
    if "plot_data_evidence" in figure:
        raise ReportBuildError("plot_data_evidence must be nested in scientific_data_contract")
    contract = figure["scientific_data_contract"]
    if "plot_data_evidence" not in contract:
        return {"status": "not_verified", "provided": False, "declaration": None,
                "reason": "Native plot/result array evidence not provided"}
    declaration = contract["plot_data_evidence"]
    if figure_id == "paired-interactive" and isinstance(declaration, dict) and declaration.get("schema_version") == 2:
        return validate_interactive_plot_data_evidence(declaration, context, input_bound, runtime_release)
    fields = {
        "schema_version", "figure_id", "fixture_id", "fixture_sha256", "matlab_release",
        "dimension_order", "shape", "time_utc", "depth_m", "depth_unit", "quantity_unit",
        "missing_policy", "native_data_source", "native_values", "missing_mask",
        "input_match_asserted", "qc", "uncertainty",
    }
    if not isinstance(declaration, dict) or set(declaration) != fields:
        raise ReportBuildError(f"figure {figure_id} plot_data_evidence fields are missing or unsupported")
    if require_nonnegative_integer(declaration["schema_version"], "plot_data_evidence.schema_version") != 1:
        raise ReportBuildError("plot_data_evidence.schema_version must be 1")
    if figure_id not in GRID_NATIVE_SOURCES:
        raise ReportBuildError(f"plot_data_evidence is unsupported for figure {figure_id}")
    if (declaration["figure_id"] != figure_id or declaration["fixture_id"] != context["fixture_id"]
            or declaration["fixture_sha256"] != context["fixture_sha256"]
            or declaration["native_data_source"] != GRID_NATIVE_SOURCES[figure_id]):
        raise ReportBuildError(f"figure {figure_id} plot_data_evidence identity/source/hash mismatch")
    if normalize_matlab_release(declaration["matlab_release"], "plot_data_evidence.matlab_release") != runtime_release:
        raise ReportBuildError(f"figure {figure_id} plot_data_evidence MATLAB release mismatch")
    if require_bool(declaration["input_match_asserted"], "plot_data_evidence.input_match_asserted") is not True:
        raise ReportBuildError("plot_data_evidence input match assertion must be true")
    if declaration["dimension_order"] != context["dimension_order"] or not isinstance(declaration["shape"], list):
        raise ReportBuildError(f"figure {figure_id} plot_data_evidence dimension order/shape mismatch")
    shape_size(declaration["shape"], "plot_data_evidence.shape")
    if declaration["shape"] != context["shape"]:
        raise ReportBuildError(f"figure {figure_id} plot_data_evidence shape mismatch")
    times = declaration["time_utc"]
    depths = declaration["depth_m"]
    if not isinstance(times, list) or not isinstance(depths, list):
        raise ReportBuildError("plot_data_evidence time_utc/depth_m must be vectors")
    if [parse_utc(value, "plot_data_evidence.time_utc") for value in times] != [
        parse_utc(value, "fixture.time_utc") for value in context["time"]["values"]
    ]:
        raise ReportBuildError(f"figure {figure_id} plot_data_evidence time order mismatch")
    numeric_values(depths, "plot_data_evidence.depth_m")
    if depths != context["coordinates"]["depth"]["values"] or declaration["depth_unit"] != "m":
        raise ReportBuildError(f"figure {figure_id} plot_data_evidence depth order/unit mismatch")
    if declaration["quantity_unit"] != context["unit"] or declaration["missing_policy"] != "preserve":
        raise ReportBuildError(f"figure {figure_id} plot_data_evidence unit/missing policy mismatch")
    qc = declaration["qc"]
    uncertainty = declaration["uncertainty"]
    if not isinstance(qc, dict) or set(qc) != {"provided", "policy", "flags"}:
        raise ReportBuildError("plot_data_evidence QC fields are missing or unsupported")
    if not isinstance(uncertainty, dict) or set(uncertainty) != {"present", "type", "unit", "display", "values"}:
        raise ReportBuildError("plot_data_evidence uncertainty fields are missing or unsupported")
    if require_bool(qc["provided"], "plot_data_evidence.qc.provided") is not True or qc["policy"] != "preserve":
        raise ReportBuildError("plot_data_evidence QC must be provided and preserved")
    if (require_bool(uncertainty["present"], "plot_data_evidence.uncertainty.present") is not True
            or uncertainty["type"] != context["uncertainty"]["type"]
            or uncertainty["unit"] != context["uncertainty"]["unit"] or uncertainty["display"] != "metadata"):
        raise ReportBuildError("plot_data_evidence uncertainty must preserve fixture type/unit with metadata display")
    rows, columns = context["shape"]
    expected = context["plot_input"]
    for field, values, source in (
        ("native_values", declaration["native_values"], expected["values"]),
        ("uncertainty.values", uncertainty["values"], expected["uncertainty_values"]),
    ):
        flattened = flatten_matrix(values, rows, columns, f"plot_data_evidence.{field}")
        numeric_values(flattened, f"plot_data_evidence.{field}")
        if values != source:
            raise ReportBuildError(f"figure {figure_id} plot_data_evidence {field} differs from the complete fixture array")
    flags = flatten_matrix(qc["flags"], rows, columns, "plot_data_evidence.qc.flags")
    if any(not isinstance(flag, str) for flag in flags) or qc["flags"] != expected["qc_flags"]:
        raise ReportBuildError(f"figure {figure_id} plot_data_evidence QC flags/order differ from fixture")
    mask = flatten_matrix(declaration["missing_mask"], rows, columns, "plot_data_evidence.missing_mask")
    for flag in mask:
        require_bool(flag, "plot_data_evidence.missing_mask")
    if mask != [value is None for row in expected["values"] for value in row]:
        raise ReportBuildError(f"figure {figure_id} plot_data_evidence missing mask differs from fixture")
    return {
        "status": "runtime_declaration_verified" if input_bound else "not_verified",
        "provided": True, "local_arrays_match": True, "input_fixture_binding_verified": input_bound,
        "reason": "Native plot/result declarations match the complete fixture arrays; not independently re-executed"
        if input_bound else "Arrays match local fixtures but runtime input bytes are not bound",
        "declaration": declaration,
    }


def validate_runtime_bundle(runtime_root: Path, figure_contexts: dict[str, dict[str, Any]]) -> dict[str, Any]:
    if runtime_root.is_symlink() or not runtime_root.is_dir():
        raise ReportBuildError(f"runtime output directory is missing or unsafe: {runtime_root}")
    runtime_root = runtime_root.resolve()
    manifest_path = runtime_root / "figures.json"
    runtime_path = runtime_root / "matlab-runtime.json"
    manifest, manifest_snapshot = load_json_snapshot(manifest_path, "figures.json")
    runtime, runtime_snapshot = load_json_snapshot(runtime_path, "matlab-runtime.json")
    if "plot_data_evidence" in runtime or "plot_data_evidence" in manifest:
        raise ReportBuildError("plot_data_evidence must be nested in each figure's scientific_data_contract")

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
    if (not isinstance(fixture_ids, list) or not all(isinstance(identifier, str) for identifier in fixture_ids)
            or len(fixture_ids) != len(EXPECTED_FIXTURES) or set(fixture_ids) != set(EXPECTED_FIXTURES)):
        raise ReportBuildError("runtime.fixture_ids do not match the run_matlab_gate fixtures")
    input_fixtures = validate_input_fixtures(runtime_root, runtime, figure_contexts)
    interaction = runtime.get("interaction")
    if not isinstance(interaction, dict) or any(
        interaction.get(field) is not True
        for field in ("datatip_verified", "brush_stable_ids_verified", "headless_fallback_verified")
    ):
        raise ReportBuildError("runtime interaction assertions are incomplete")

    if manifest.get("schema_version") != 2:
        raise ReportBuildError("figures.json schema_version must be 2")
    manifest_generated_at = parse_utc(manifest.get("generated_at"), "manifest.generated_at")
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
        context = figure_contexts[figure_id]
        fixture_input = input_fixtures.get(context["fixture_id"])
        fixture_file = fixture_input["file"] if fixture_input else context["fixture_file"]
        title = require_text(figure.get("title"), f"figure {figure_id}.title")
        if title != figure_contexts[figure_id]["title"]:
            raise ReportBuildError(f"figure {figure_id} title differs from fixture selection")
        source = require_text(figure.get("source"), f"figure {figure_id}.source")
        figure_runtime = figure.get("runtime")
        if not isinstance(figure_runtime, dict) or normalize_matlab_release(
            figure_runtime.get("matlab_release"), f"figure {figure_id}.runtime.matlab_release"
        ) != runtime_release:
            raise ReportBuildError(f"figure {figure_id} MATLAB release does not match runtime record")
        scientific = verify_scientific_contract(figure, figure_contexts[figure_id])
        plot_data = validate_plot_data_evidence(figure, context, fixture_input is not None, runtime_release)
        scientific["qc"]["plot_evidence_status"] = plot_data["status"]
        scientific["uncertainty"]["plot_evidence_status"] = plot_data["status"]
        if plot_data["status"] == "runtime_declaration_verified":
            scientific["qc"]["plot_filtering"] = "preserve"
            scientific["uncertainty"]["plot_display"] = plot_data["declaration"]["uncertainty"]["display"]
        layout_measurement = validate_layout_measurement(figure)
        exports = figure.get("exports")
        if not isinstance(exports, dict) or set(exports) != set(REQUIRED_FORMATS):
            raise ReportBuildError(f"figure {figure_id} must contain exactly PNG, PDF, and SVG exports")
        checked_exports = []
        for format_name in REQUIRED_FORMATS:
            export = exports[format_name]
            if not isinstance(export, dict) or export.get("figure_id") != figure_id:
                raise ReportBuildError(f"figure identity mismatch in {figure_id} {format_name} export")
            if any(export.get(key) != figure.get(key) for key in ("title", "source", "theme")):
                raise ReportBuildError(f"figure metadata mismatch in {figure_id} {format_name} export")
            if export.get("file") != f"{figure_id}.{format_name}":
                safe_artifact_path(runtime_root, export.get("file"), "export.file")
                raise ReportBuildError(f"figure {figure_id} export path does not match gate figure identity")
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
                "plot_data_evidence": plot_data,
                "layout_measurement": layout_measurement,
                "verification": {
                    "file_hashes_and_dimensions": "passed", "visual_inspection": "not_verified",
                    "glyph_rendering": "not_verified", "layout_visual": "not_verified",
                },
                "fixture_binding": {
                    "fixture_id": context["fixture_id"],
                    "fixture_file": fixture_file,
                    "fixture_sha256": context["fixture_sha256"],
                    "selection": context["selection"],
                    "metadata_match": True,
                    "runtime_fixture_hash_verified": fixture_input is not None,
                    "limitations": "" if fixture_input else FIXTURE_BINDING_LIMITATION,
                },
                "scientific_context": {**context, "fixture_file": fixture_file},
                "exports": checked_exports,
            }
        )
    return {
        "manifest": manifest,
        "runtime": runtime,
        "matlab_release": runtime_release,
        "manifest_generated_at": manifest_generated_at.isoformat().replace("+00:00", "Z"),
        "manifest_file": {"file": "figures.json", **manifest_snapshot},
        "runtime_file": {"file": "matlab-runtime.json", **runtime_snapshot},
        "input_fixtures": [input_fixtures[identifier] for identifier in sorted(input_fixtures)],
        "runtime_fixture_binding": (
            {"status": "verified", "method": "runtime_snapshot_sha256_and_bytes_match_local_statistics_inputs",
             "fixture_count": len(input_fixtures)}
            if input_fixtures else {"status": "unverified", "reason": FIXTURE_BINDING_LIMITATION}
        ),
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
    if payload.get("kind") != FIXTURE_KINDS[expected_id]:
        raise ReportBuildError(f"fixture kind does not match its id: {file_name}")
    provenance = payload.get("provenance")
    if not isinstance(provenance, dict):
        raise ReportBuildError(f"fixture provenance missing: {file_name}")
    if provenance.get("method") != "deterministic_formula":
        raise ReportBuildError(f"fixture method must be deterministic_formula: {file_name}")
    require_text(provenance.get("formula"), f"{file_name}.provenance.formula")
    purpose = require_text(provenance.get("purpose"), f"{file_name}.provenance.purpose").lower()
    if "not an observed ocean dataset" not in purpose:
        raise ReportBuildError(f"fixture must disclaim observed ocean data: {file_name}")
    if any(key in payload for key in ("area", "bounds", "sea_area", "spatial_coverage", "longitude", "latitude")):
        raise ReportBuildError(f"unsupported geographic metadata in fixed fixture: {file_name}")
    if payload["kind"] == "paired_records" and "coordinates" in payload:
        raise ReportBuildError(f"paired coordinates must come from individual records: {file_name}")


def validate_design(payload: dict[str, Any], pair_count: int, file_name: str) -> None:
    design = payload.get("design")
    if not isinstance(design, dict) or design.get("time_depth_relationship") != "fully_crossed":
        raise ReportBuildError(f"fixture must declare a fully_crossed design: {file_name}")
    if require_nonnegative_integer(design.get("expected_pair_count"), "design.expected_pair_count") != pair_count:
        raise ReportBuildError(f"fixture design count does not match coordinates: {file_name}")


def summarize_grid_fixture(payload: dict[str, Any], file_name: str) -> dict[str, Any]:
    kind = payload.get("kind")
    variable_name = "temperature" if kind == "time_depth_grid" else "salinity"
    coordinates = payload.get("coordinates")
    variables = payload.get("variables")
    if not isinstance(coordinates, dict) or not isinstance(variables, dict):
        raise ReportBuildError(f"fixture coordinates or variables missing: {file_name}")
    if set(coordinates) != {"time", "depth"}:
        raise ReportBuildError(f"unsupported coordinates in fixed fixture: {file_name}")
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
    if (time_coordinate.get("timezone") != "UTC" or time_coordinate.get("direction") != "increasing"
            or time_coordinate.get("unit") != "datetime" or depth_coordinate.get("unit") != "m"
            or depth_coordinate.get("direction") != "positive_down"):
        raise ReportBuildError(f"fixture coordinate contract is incomplete: {file_name}")
    if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in depths):
        raise ReportBuildError(f"fixture depths must be numeric: {file_name}")
    numeric_depths = [float(value) for value in depths]
    if min(numeric_depths) < 0 or any(current <= previous for previous, current in zip(numeric_depths, numeric_depths[1:])):
        raise ReportBuildError(f"fixture depths must be nonnegative and increasing: {file_name}")
    reference = require_text(depth_coordinate.get("reference"), f"{file_name}.depth.reference")
    validate_design(payload, len(times) * len(depths), file_name)

    primary = variables.get(variable_name)
    uncertainty = variables.get(f"{variable_name}_standard_uncertainty")
    qc_variable = variables.get("qc")
    if not isinstance(primary, dict) or not isinstance(uncertainty, dict) or not isinstance(qc_variable, dict):
        raise ReportBuildError(f"fixture value, uncertainty, or QC variable missing: {file_name}")
    if any(variable.get("dimension_order") != ["depth", "time"] for variable in (primary, uncertainty, qc_variable)):
        raise ReportBuildError(f"fixture dimension_order must be depth,time for values, QC and uncertainty: {file_name}")
    if (primary.get("missing_policy") != "preserve" or primary.get("missing_representation") != "null_to_NaN"
            or qc_variable.get("policy") != "preserve"):
        raise ReportBuildError(f"fixture missing and QC policies must preserve data: {file_name}")
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
    if unit != ("degC" if variable_name == "temperature" else "g kg-1"):
        raise ReportBuildError(f"fixture unit does not match run_matlab_gate: {file_name}")
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
        "shape": [rows, columns],
        "dimension_order": ["depth", "time"],
        "time": {"start": times[0], "end": times[-1], "timezone": "UTC", "count": len(times), "values": times},
        "coordinates": {
            "longitude": {"status": "not_provided", "unit": "degrees_east", "values": None},
            "latitude": {"status": "not_provided", "unit": "degrees_north", "values": None},
            "depth": {"minimum": min(numeric_depths), "maximum": max(numeric_depths), "unit": "m", "positive": "down", "count": len(depths), "reference": reference, "values": numeric_depths},
        },
        "counts": {"raw_count": raw_count, "valid_count": len(values), "missing_count": missing_count},
        "qc": dict(sorted(Counter(qc_raw).items())),
        "missing_indices_depth_time": [[index // columns, index % columns] for index, value in enumerate(primary_raw) if value is None],
        "statistics_method": {"weighting": "equal_weight_finite_cells", "qc_policy": "preserve_including_suspect", "qc_rejected": 0},
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
    if unit != "degC" or contract.get("model_unit") != unit or contract.get("uncertainty_unit") != unit:
        raise ReportBuildError(f"paired fixture units differ: {file_name}")
    if (contract.get("missing_policy") != "preserve" or contract.get("qc_policy") != "preserve"
            or contract.get("stable_id_field") != "id"):
        raise ReportBuildError(f"paired fixture must preserve missing, QC and stable id: {file_name}")
    if contract.get("uncertainty_type") != "standard_uncertainty":
        raise ReportBuildError(f"paired fixture uncertainty type is unsupported: {file_name}")

    identifiers: set[str] = set()
    coordinate_pairs: set[tuple[datetime, float]] = set()
    valid_ids: list[str] = []
    missing_ids: list[str] = []
    observation_missing_ids: list[str] = []
    model_missing_ids: list[str] = []
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
        if set(record) != {"id", "time", "depth_m", "observation_degC", "model_degC", "uncertainty_degC", "qc"}:
            raise ReportBuildError(f"paired record has missing or unsupported fields: {index}")
        identifier = require_text(record.get("id"), f"{file_name}.records[{index}].id")
        if identifier in identifiers:
            raise ReportBuildError(f"duplicate paired record id: {identifier}")
        identifiers.add(identifier)
        timestamp = require_text(record.get("time"), f"{file_name}.records[{index}].time")
        parsed_time = parse_utc(timestamp, f"{file_name}.records[{index}].time")
        depth = record.get("depth_m")
        if isinstance(depth, bool) or not isinstance(depth, (int, float)) or not math.isfinite(depth) or depth < 0:
            raise ReportBuildError(f"invalid paired record depth: {identifier}")
        coordinate_pair = (parsed_time, float(depth))
        if coordinate_pair in coordinate_pairs:
            raise ReportBuildError(f"duplicate time/depth pair: {identifier}")
        coordinate_pairs.add(coordinate_pair)
        qc = require_text(record.get("qc"), f"{file_name}.records[{index}].qc")
        if qc not in {"good", "suspect", "missing"}:
            raise ReportBuildError(f"unsupported paired record QC: {qc}")
        observation = record.get("observation_degC")
        model = record.get("model_degC")
        uncertainty = record.get("uncertainty_degC")
        for field, value in (("observation", observation), ("model", model), ("uncertainty", uncertainty)):
            numeric_values([value], f"paired {field} for {identifier}")
        times.append(timestamp)
        depths.append(float(depth))
        qc_values.append(qc)
        if observation is None:
            observation_missing_ids.append(identifier)
            if uncertainty is not None or qc != "missing":
                raise ReportBuildError(f"missing paired observation must preserve uncertainty and QC: {identifier}")
        elif uncertainty is None or uncertainty < 0 or qc == "missing":
            raise ReportBuildError(f"finite paired observation requires uncertainty and non-missing QC: {identifier}")
        if model is None:
            model_missing_ids.append(identifier)
        if observation is None or model is None:
            missing_ids.append(identifier)
            missing_count += 1
            continue
        valid_ids.append(identifier)
        observation_value = float(observation)
        model_value = float(model)
        uncertainty_value = float(uncertainty)
        difference = model_value - observation_value
        observations.append(observation_value)
        models.append(model_value)
        uncertainties.append(uncertainty_value)
        differences.append(difference)
        within_uncertainty += int(abs(difference) <= uncertainty_value or math.isclose(abs(difference), uncertainty_value, rel_tol=1e-12, abs_tol=1e-12))

    unique_times = sorted(set(times), key=lambda value: parse_utc(value, "paired.time"))
    unique_depths = sorted(set(depths))
    expected_pairs = len(unique_times) * len(unique_depths)
    if len(unique_times) < 2 or len(unique_depths) < 2 or len(coordinate_pairs) != expected_pairs:
        raise ReportBuildError(f"paired fixture is not a complete crossed design: {file_name}")
    validate_design(payload, expected_pairs, file_name)
    valid_count = len(differences)
    if valid_count == 0:
        raise ReportBuildError(f"paired fixture has no complete finite pairs: {file_name}")
    correlation = pearson_correlation(observations, models)
    return {
        "id": payload["id"],
        "file": file_name,
        "title": require_text(payload.get("title"), f"{file_name}.title"),
        "kind": payload.get("kind"),
        "variable": "observation_model_temperature",
        "unit": unit,
        "shape": [len(records)],
        "dimension_order": ["observation"],
        "time": {"start": unique_times[0], "end": unique_times[-1], "timezone": "UTC", "count": len(unique_times), "values": unique_times},
        "coordinates": {
            "longitude": {"status": "not_provided", "unit": "degrees_east", "values": None},
            "latitude": {"status": "not_provided", "unit": "degrees_north", "values": None},
            "depth": {"minimum": min(unique_depths), "maximum": max(unique_depths), "unit": "m", "positive": "down", "count": len(unique_depths), "reference": "not_provided", "values": unique_depths},
        },
        "counts": {"raw_count": len(records), "valid_count": valid_count, "missing_count": missing_count},
        "qc": dict(sorted(Counter(qc_values).items())),
        "pairing": {
            "method": "same_record_id_time_depth", "error": "model_minus_observation",
            "valid_ids": valid_ids, "missing_ids": missing_ids,
            "observation_missing_ids": observation_missing_ids, "model_missing_ids": model_missing_ids,
            "records": [{key: record[key] for key in ("id", "time", "depth_m", "qc")} for record in records],
        },
        "statistics_method": {"weighting": "equal_weight_complete_pairs", "qc_policy": "preserve_including_suspect", "qc_rejected": 0},
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
        "uncertainty": {"type": "standard_uncertainty", "unit": unit, "scope": "observation_in_complete_pairs", "count": len(uncertainties), **summarize_numbers(uncertainties)},
        "provenance": payload["provenance"],
        "sha256": None,
    }


def load_fixture_statistics(fixture_directory: Path) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    if fixture_directory.is_symlink() or not fixture_directory.is_dir():
        raise ReportBuildError(f"fixture directory is missing or unsafe: {fixture_directory}")
    summaries: list[dict[str, Any]] = []
    payloads: dict[str, dict[str, Any]] = {}
    for expected_id, file_name in EXPECTED_FIXTURES.items():
        path = fixture_directory / file_name
        payload, snapshot = load_json_snapshot(path, f"fixture {file_name}")
        validate_fixture_identity(payload, expected_id, file_name)
        if payload.get("kind") in {"time_depth_grid", "repeat_profiles"}:
            summary = summarize_grid_fixture(payload, file_name)
        elif payload.get("kind") == "paired_records":
            summary = summarize_paired_fixture(payload, file_name)
        else:
            raise ReportBuildError(f"unsupported fixture kind in {file_name}: {payload.get('kind')!r}")
        summary.update(snapshot)
        payloads[expected_id] = payload
        summaries.append(summary)
    summaries.sort(key=lambda item: item["id"])
    by_id = {item["id"]: item for item in summaries}
    temperature = by_id["crossed-time-depth-temperature"]
    temperature_payload = payloads["crossed-time-depth-temperature"]
    if len(temperature_payload["coordinates"]["depth"]["values"]) < 3:
        raise ReportBuildError("temperature fixture lacks the gate's third depth row")
    interactive_row = temperature_payload["variables"]["temperature"]["values"][2]
    interactive_counts = {
        "raw_count": len(interactive_row),
        "valid_count": sum(value is not None for value in interactive_row),
        "missing_count": sum(value is None for value in interactive_row),
    }
    figure_contexts = {}
    for summary in summaries:
        figure_contexts[summary["id"]] = {
            "fixture_id": summary["id"], "fixture_file": summary["file"], "fixture_sha256": summary["sha256"],
            "fixture_bytes": summary["bytes"],
            "title": summary["title"], "variable": summary["variable"], "unit": summary["unit"],
            "shape": summary["shape"], "dimension_order": summary["dimension_order"],
            "time": summary["time"], "coordinates": summary["coordinates"],
            "counts": summary["counts"], "qc": summary["qc"], "uncertainty": summary["uncertainty"],
            "statistics": summary["statistics"], "selection": {"kind": "whole_fixture"},
        }
    interactive_depth = temperature_payload["coordinates"]["depth"]["values"][2]
    if interactive_depth != 50:
        raise ReportBuildError("third temperature depth must be 50 m for gate ObservationIDs temp-050m")
    interactive_uncertainty = temperature_payload["variables"]["temperature_standard_uncertainty"]["values"][2]
    interactive_qc = temperature_payload["variables"]["qc"]["values"][2]
    figure_contexts["paired-interactive"] = {
        **figure_contexts["crossed-time-depth-temperature"],
        "title": "温度时间序列 / Temperature time series", "shape": [len(interactive_row)],
        "dimension_order": ["time"], "counts": interactive_counts,
        "selection": {"kind": "depth_row", "index_zero_based": 2, "depth_m": interactive_depth},
        "coordinates": {**temperature["coordinates"], "depth": {
            "minimum": interactive_depth, "maximum": interactive_depth, "values": [interactive_depth],
            "unit": "m", "positive": "down", "count": 1, "reference": temperature["coordinates"]["depth"]["reference"],
        }},
        "qc": dict(sorted(Counter(interactive_qc).items())),
        "uncertainty": {"type": "standard_uncertainty", "unit": "degC", **summarize_numbers(numeric_values(interactive_uncertainty, "interactive uncertainty"))},
        "statistics": summarize_numbers(numeric_values(interactive_row, "interactive temperature")),
        "observation_ids": [f"temp-050m-{index + 1:03d}" for index in range(len(interactive_row))],
        "missing_time_indices": [index for index, value in enumerate(interactive_row) if value is None],
        "plot_input": {"values": interactive_row, "qc_flags": interactive_qc,
                       "uncertainty_values": interactive_uncertainty},
    }
    for identifier in GRID_NATIVE_SOURCES:
        variables = payloads[identifier]["variables"]
        variable = by_id[identifier]["variable"]
        figure_contexts[identifier]["plot_input"] = {
            "values": variables[variable]["values"], "qc_flags": variables["qc"]["values"],
            "uncertainty_values": variables[f"{variable}_standard_uncertainty"]["values"],
        }
    return summaries, figure_contexts


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


def markdown_table_text(value: str) -> str:
    escaped = html.escape(" ".join(value.splitlines()), quote=False)
    for character in "\\|`*_[]":
        escaped = escaped.replace(character, "\\" + character)
    return escaped


def render_report(evidence: dict[str, Any]) -> str:
    fixtures = {item["id"]: item for item in evidence["fixtures"]}
    paired = fixtures["paired-observation-model"]
    runtime = evidence["runtime_evidence"]
    binding_verified = evidence["runtime_fixture_binding"]["status"] == "verified"
    lines = [
        "# MATLAB 海洋合成基准证据报告",
        "",
        f"> 数据来源={SOURCE_CLASSIFICATION}。本报告复述本地确定性 fixture 的复算统计与清单登记的导出产物，不代表任何真实海区当前或历史海况。",
        "",
        "## 1. 报告范围与结论边界",
        "",
        "- 海区：未指定。fixture 没有命名海区、经度或纬度，不能映射到现实海域。",
        f"- 时间：全部时间使用 UTC；跨 fixture 总包络为 {evidence['coverage']['time']['start']} 至 {evidence['coverage']['time']['end']}，不同 fixture 之间不构成连续观测序列。",
        f"- 垂向坐标：{evidence['coverage']['depth']['minimum']:g}-{evidence['coverage']['depth']['maximum']:g} m，正方向向下；各 fixture 的实际范围见后表。",
        "- 水平坐标：经度与纬度均未提供，状态为 `not_provided`。",
        f"- 运行证据：{runtime['runtime']} {runtime['matlab_release']}；`figures.json` 记录执行已验证和产物校验通过。",
        "- 验证边界：未执行桌面人工验证，未执行人工视觉检查，不形成任何评分或生产验收结论。",
        ("- 输入绑定：已核对 `matlab-runtime.json.input_fixtures` 的三份记录、包内 `fixture-inputs/` 快照及本地统计输入，字节数与 SHA-256 全部一致，输入字节绑定已验证；引用使用包内快照。"
         if binding_verified else
         "- 输入绑定：运行记录没有 fixture 内容哈希或实际坐标值。图与本地 fixture 的 ID、标题、维度、单位和计数已核对，但运行时数值快照一致性未验证。"),
        "",
        "## 2. 数据来源与复算方法",
        "",
        "三份输入均声明 `synthetic=true`，来源方法为确定性公式，目的限定为 evaluation fixture。生成器从 JSON 中存储的数值逐值复算有效数、缺测数、QC 分布、均值、极值、标准不确定度以及观测-模式配对误差。未按说明公式重新生成数据，也未从图中文字反推数值。[E1-E3]",
        "统计口径：网格按有限单元等权，配对按双方有限的同记录等权；保留 suspect，不做面积、层厚或时间加权。标准不确定度均值是输入数值的描述统计，不是均值估计的不确定度。",
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
            f"观测侧缺测 {len(paired['pairing']['observation_missing_ids'])} 条，模式侧缺测 {len(paired['pairing']['model_missing_ids'])} 条；"
            "观测均值和模式均值均限定在相同完整配对上。记录 ID、时间和深度用于唯一匹配，suspect 保留。",
            "误差覆盖分母为完整配对数，阈值仅取观测侧标准不确定度。fixture 未提供模式不确定度，不能据此声明联合置信区间、概率校准或独立实测验证。",
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
    interactive_context = interactive["scientific_context"]
    interactive_png = next(item for item in interactive["exports"] if item["format"] == "png")
    interactive_pdf = next(item for item in interactive["exports"] if item["format"] == "pdf")
    interactive_svg = next(item for item in interactive["exports"] if item["format"] == "svg")
    lines.extend(
        [
            "`matlab-runtime.json` 记录 DataTip 回调、Brush 稳定 ObservationID 和 headless fallback 断言成功。该证据来自批处理函数断言，只证明本次 headless 路径，不等于桌面交互或人工视觉验证。[E5]",
            f"关联 E1 的第三行：深度 {interactive_context['selection']['depth_m']:g} m，"
            f"UTC {interactive_context['time']['start']} 至 {interactive_context['time']['end']}；"
            f"原始/有效/缺测 {interactive_context['counts']['raw_count']}/{interactive_context['counts']['valid_count']}/{interactive_context['counts']['missing_count']}。"
            f"本地有限值均值 {format_number(interactive_context['statistics']['mean'])} degC。对应 ObservationID 和缺测时次索引保存在证据 JSON。[E1]",
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
    lines.extend([
        "", "### 布局测量覆盖", "",
        "以下为清单记录，未独立重测。完整标志仅指边界审计覆盖；文件哈希/尺寸通过、`bounds_audited` 或 `layout.stable` 均不等于视觉、字形或布局外观通过。`layout.Text` 无公开 Extent 的标题/标签保持未验证。",
        "",
        "| 图 ID | 文件哈希/尺寸 | 已测文本/坐标轴记录数 | 边界审计覆盖 | 未测标题/标签 |",
        "|---|---|---:|---|---|",
    ])
    for figure in runtime["figures"]:
        measurement = figure["layout_measurement"]
        counts = "/".join(str(measurement[field]) if measurement[field] is not None else "未提供"
                          for field in ("measured_text_count", "measured_axes_count"))
        if measurement["status"] == "not_available":
            coverage = "未提供（not_available）"
            unmeasured_text = "未提供"
        else:
            completeness = "清单完整" if measurement["bounds_audit_complete"] else "清单不完整"
            coverage = f"仅已测对象；{completeness}；未测 {measurement['unmeasured_count']}"
            unmeasured_text = "<br>".join(
                f"{record['role']}: {markdown_table_text(record['string'])}"
                for record in measurement["unmeasured_text_objects"]
            ) or "无未测记录"
        lines.append(f"| `{figure['id']}` | 通过 | {counts} | {coverage} | {unmeasured_text} |")
    lines.extend([
        "", "### 原生图元数据核对", "",
        "仅在输入字节绑定通过且原生数值、QC、不确定度完整数组逐项一致时，标记 `runtime_declaration_verified`。这是 MATLAB 运行声明核对，不是视觉验证或独立重执行；metadata 不代表绘制误差带。",
        "",
        "| 图 ID | 原生读取 | 状态 | QC | 不确定度类型 / 单位 / 显示 |",
        "|---|---|---|---|---|",
    ])
    for figure in runtime["figures"]:
        proof = figure["plot_data_evidence"]
        declaration = proof["declaration"]
        source = declaration["native_data_source"] if declaration else "未提供"
        status = proof["status"]
        if status == "runtime_declaration_verified":
            qc_text = "preserve，保留 suspect"
            uncertainty = declaration["uncertainty"]
            uncertainty_text = f"{uncertainty['type']} / {uncertainty['unit']} / {uncertainty['display']}"
        else:
            status += "（输入字节未绑定）" if declaration else "（未提供）"
            qc_text = "应用未验证"
            uncertainty_text = "应用未验证"
        lines.append(f"| `{figure['id']}` | {source} | {status} | {qc_text} | {uncertainty_text} |")
    lines.extend(
        [
            "",
            "## 8. 缺测、QC 与不确定度解释",
            "",
            "- 缺测保持为 `null -> NaN` 语义，不填补、不按零值处理。",
            "- QC 保留 `good`、`suspect`、`missing` 原状态；统计未把 `suspect` 自动删除，因此有效数与严格高质量样本数含义不同。",
            "- 清单 `qc.status=present`、`uncertainty.status=present` 仅表示源 fixture 元数据存在，不能单独证明图件已接收、筛选或呈现这些字段。",
            "- 各图应用证据见原生图元核对表；未提供或输入字节未绑定的声明不推定已核验。errorbar 表示原生误差条数值声明核对，不是视觉通过；metadata 不表示已绘制误差条。",
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
            ("6. 输入字节绑定不等于图上数值、QC 或不确定度呈现已核验，未执行独立图像科学内容核验。"
             if binding_verified else
             "6. fixture 哈希记录的是本次报告读取的本地字节；运行清单缺少输入哈希，无法排除运行后同形数据被替换。图上数值、QC 和不确定度呈现尚未独立核验。"),
            "",
            "## 10. 引用与可复核入口",
            "",
            f"- [E1] `{fixtures['crossed-time-depth-temperature']['reference_file']}`，SHA-256 `{fixtures['crossed-time-depth-temperature']['sha256']}`。",
            f"- [E2] `{fixtures['paired-observation-model']['reference_file']}`，SHA-256 `{fixtures['paired-observation-model']['sha256']}`。",
            f"- [E3] `{fixtures['repeat-cast-salinity-profiles']['reference_file']}`，SHA-256 `{fixtures['repeat-cast-salinity-profiles']['sha256']}`。",
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
        "validation_scope": "local_fixture_statistics_and_manifest_artifact_consistency",
        "runtime_fixture_binding": runtime_bundle["runtime_fixture_binding"],
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
            "manifest_generated_at": runtime_bundle["manifest_generated_at"],
            "execution_verified": True,
            "execution_evidence_source": "matlab-runtime.json and figures.json declarations; not independently re-executed",
            "batch_startup_option_used": runtime_bundle["runtime"]["batch_startup_option_used"],
            "jvm_available": runtime_bundle["runtime"]["jvm_available"],
            "desktop_available": runtime_bundle["runtime"]["desktop_available"],
            "desktop_validation": {"status": "not_performed", "reason": "run_matlab_gate records batch/headless assertions only"},
            "visual_inspection": runtime_bundle["manifest"]["visual_inspection"],
            "interaction_assertions": runtime_bundle["runtime"]["interaction"],
            "manifest_file": runtime_bundle["manifest_file"],
            "runtime_file": runtime_bundle["runtime_file"],
            "input_fixtures": runtime_bundle["input_fixtures"],
            "figures": runtime_bundle["figures"],
            "artifacts": runtime_bundle["artifacts"],
        },
        "limitations": [
            "Synthetic deterministic fixtures are not observed ocean conditions.",
            "No named sea area, longitude, or latitude is supplied.",
            "Fixture time windows are separate and do not form a continuous record.",
            "Desktop validation and trusted visual inspection were not performed.",
            "No evaluation score or production-readiness claim is made.",
            *([FIXTURE_BINDING_LIMITATION] if runtime_bundle["runtime_fixture_binding"]["status"] != "verified" else []),
            "QC/uncertainty presence in a source contract does not verify filtering or visual presentation.",
        ],
        "references": [
            *[{"id": f"E{index + 1}", "type": "fixture", "file": item["reference_file"], "sha256": item["sha256"]}
              for index, item in enumerate(fixtures)],
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
    evidence_payload = (json.dumps(evidence, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + "\n").encode("utf-8")
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
    if runtime_output.is_symlink() or fixture_directory.is_symlink():
        raise ReportBuildError("runtime and fixture directories must not be symlinks")
    runtime_root = runtime_output.resolve()
    fixtures, figure_contexts = load_fixture_statistics(fixture_directory.resolve())
    runtime_bundle = validate_runtime_bundle(runtime_root, figure_contexts)
    bound_inputs = {item["id"]: item for item in runtime_bundle["input_fixtures"]}
    for fixture in fixtures:
        fixture["reference_file"] = (
            bound_inputs[fixture["id"]]["file"] if fixture["id"] in bound_inputs else
            Path(os.path.relpath(fixture_directory.resolve() / fixture["file"], runtime_root)).as_posix()
        )
    generated_at = utc_now()
    evidence = build_evidence(fixtures, runtime_bundle, generated_at)
    report_text = render_report(evidence)
    for item in [runtime_bundle["manifest_file"], runtime_bundle["runtime_file"],
                 *runtime_bundle["artifacts"], *runtime_bundle["input_fixtures"]]:
        _, input_path = safe_artifact_path(runtime_root, item["file"], "input.file")
        verify_input_snapshot(input_path, item)
    for fixture in fixtures:
        verify_input_snapshot(fixture_directory / fixture["file"], fixture)
    return write_outputs(runtime_root, report_text, evidence)


def verify_input_snapshot(path: Path, snapshot: dict[str, Any]) -> None:
    require_regular_file(path, "input snapshot")
    if path.stat().st_size != snapshot["bytes"] or sha256_file(path) != snapshot["sha256"]:
        raise ReportBuildError(f"input changed during report generation: {path}")


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
