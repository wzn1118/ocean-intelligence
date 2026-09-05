"""Validate byte-bound external inspector declarations without rerunning tools."""
from __future__ import annotations

import importlib.util
import math
import re
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Any


STATUSES = {"passed", "failed", "not_verified"}
LIMITATIONS = (
    "External automated inspector declarations, not authenticated tool execution or a trusted visual audit. "
    "File bindings and declaration consistency are rechecked; tools are not rerun. "
    "Recorded source hashes do not authenticate execution. Bbox output hashes without the original XML "
    "and truncated text excerpts are declarations, not independently verified extraction output."
)


class AuditValidationError(ValueError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AuditValidationError(f"rendered audit: {message}")


def text(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def digest(value: Any) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def integer(value: Any, minimum: int = 0) -> bool:
    return type(value) is int and minimum <= value <= 2**53 - 1


def declaration_equal(actual: Any, expected: Any) -> bool:
    if type(expected) in (int, float):
        return (type(actual) in (int, float)
                and (type(actual) is not float or math.isfinite(actual))
                and (type(expected) is not float or math.isfinite(expected))
                and actual == expected)
    if type(actual) is not type(expected):
        return False
    if isinstance(expected, dict):
        return actual.keys() == expected.keys() and all(
            declaration_equal(actual[key], value) for key, value in expected.items()
        )
    if isinstance(expected, list):
        return len(actual) == len(expected) and all(
            declaration_equal(actual_value, expected_value) for actual_value, expected_value in zip(actual, expected)
        )
    return actual == expected


def checks_by_name(checks: Any, allowed: set[str], label: str) -> dict[str, dict[str, Any]]:
    require(isinstance(checks, list) and bool(checks), f"{label} checks must be nonempty")
    result = {}
    for check in checks:
        require(isinstance(check, dict), f"{label} check must be an object")
        name = check.get("name")
        require(isinstance(name, str) and name in allowed and name not in result,
                f"{label} unknown or duplicate check: {name!r}")
        require(isinstance(check.get("status"), str) and check["status"] in STATUSES
                and text(check.get("reason")), f"{label}/{name} invalid status or reason")
        result[name] = check
    return result


def require_checks(checks: dict, names: set[str], label: str) -> None:
    require(names <= checks.keys(), f"{label} missing checks: {sorted(names - checks.keys())}")


def compare_derived(checks: dict, derived: list[dict], label: str) -> None:
    for expected in derived:
        name = expected["name"]
        require(name in checks, f"{label} missing {name}")
        for field, value in expected.items():
            if field != "reason":
                require(field in checks[name] and declaration_equal(checks[name][field], value),
                        f"{label}/{name} contradicts derived {field}")


def validate_tool(check: dict, dependency: dict, name: str) -> None:
    if check["status"] == "passed":
        require(dependency["status"] == "available" and type(check.get("returncode")) is int
                and check["returncode"] == 0 and isinstance(check.get("stderr"), str)
                and not check["stderr"].strip(), f"{name} passed without a clean available tool")
        if name != "pdftotext":
            require(isinstance(check.get("stdout"), str), f"{name} output is missing")


def validate_pdf_text(checks: dict, figure: dict, artifact: dict, inspector: Any) -> None:
    require_checks(checks, {"pdf_text_extractability", "pdf_text_integrity"}, artifact["file"])
    extraction = checks["pdf_text_extractability"]
    integrity = checks["pdf_text_integrity"]
    bbox_hashes = set()
    for name in ("pdftotext", "pdf_text_extractability", "pdf_text_integrity"):
        if name not in checks:
            continue
        check = checks[name]
        require(check.get("snapshot_sha256") == artifact["sha256"], f"{name} PDF snapshot hash mismatch")
        if "bbox_output_sha256" in check:
            require(digest(check["bbox_output_sha256"]), f"{name} invalid bbox output hash")
            bbox_hashes.add(check["bbox_output_sha256"])
    require(len(bbox_hashes) <= 1, "PDF text checks disagree about bbox output hash")
    if extraction["status"] == "passed":
        require_checks(checks, {"pdftotext"}, artifact["file"])
        require(checks["pdftotext"]["status"] == "passed" and bool(bbox_hashes), "PDF extraction lacks successful output")
    if integrity["status"] == "failed" and "labels" not in integrity:
        require("expected_count" not in integrity, "failed text parser has incomplete label evidence")
        return
    expected = inspector.expected_pdf_texts(figure)
    labels = integrity.get("labels")
    require(isinstance(labels, list) and len(labels) == len(expected)
            and integer(integrity.get("expected_count")) and integrity["expected_count"] == len(expected),
            "PDF text labels do not cover the complete manifest expectations")
    inventory = checks.get("pdf_font_inventory", {})
    fonts = inventory.get("fonts", []) if inventory.get("status") == "passed" else []
    mapped = bool(fonts) and all(font["unicode_map"] == "yes" for font in fonts)
    require(type(integrity.get("all_fonts_have_unicode_maps")) is bool
            and integrity["all_fonts_have_unicode_maps"] == mapped, "PDF text font mapping contradicts inventory")
    pages = extraction.get("pages", [])
    require(isinstance(pages, list), "PDF extracted pages must be an array")
    page_text = {}
    complete = True
    for page in pages:
        require(isinstance(page, dict) and integer(page.get("page"), 1) and page["page"] not in page_text
                and integer(page.get("word_count")) and isinstance(page.get("text_excerpt"), str)
                and type(page.get("excerpt_truncated")) is bool and digest(page.get("normalized_text_sha256")),
                "invalid extracted PDF page")
        content = page["text_excerpt"]
        complete = complete and not page["excerpt_truncated"]
        if not page["excerpt_truncated"]:
            require(inspector.sha256(content.encode("utf-8")) == page["normalized_text_sha256"],
                    "PDF normalized text hash mismatch")
        page_text[page["page"]] = content
    require(extraction["status"] != "passed" or any(page_text.values()), "passed PDF extraction has no text")
    reliable = mapped and not any(unicodedata.category(character) in {"Co", "Cc"} or character == "\ufffd"
                                  for content in page_text.values() for character in content)
    for label, expected_label in zip(labels, expected):
        require(isinstance(label, dict) and all(label.get(key) == value for key, value in expected_label.items()),
                "PDF text label identity/order differs from manifest")
        require(isinstance(label.get("status"), str) and label["status"] in STATUSES
                and text(label.get("reason")), "invalid PDF text label status/reason")
        matches, partial = label.get("matching_pages"), label.get("partial_matches")
        require(isinstance(matches, list) and all(integer(page, 1) and page in page_text for page in matches)
                and len(set(matches)) == len(matches) and isinstance(partial, list), "invalid PDF text matches")
        require(all(isinstance(item, dict) and set(item) == {"page", "fragment"}
                    and integer(item["page"], 1) and item["page"] in page_text and text(item["fragment"])
                    for item in partial), "invalid PDF partial text matches")
        if complete:
            normalized = expected_label["normalized"]
            measured_matches = [page for page, content in page_text.items() if inspector.pdf_text_contains(content, normalized)]
            words = normalized.split()
            fragments = [" ".join(words[:2]), " ".join(words[-2:])] if len(words) > 2 else []
            measured_partial = [{"page": page, "fragment": fragment} for page, content in page_text.items()
                                for fragment in fragments if len(fragment) >= 8 and inspector.pdf_text_contains(content, fragment)] if not measured_matches else []
            require(matches == measured_matches and partial == measured_partial, "PDF label matches contradict complete excerpts")
            status = "passed" if matches else ("failed" if normalized.isascii() and reliable and partial else "not_verified")
            require(label["status"] == status, "PDF text label status contradicts extraction evidence")
        else:
            require((label["status"] == "passed") == bool(matches), "PDF text status contradicts declared matches")
    status = inspector.combined_status(labels) if labels else "not_verified"
    require(integrity["status"] == status, "PDF text integrity contradicts label states")


def validate_format_checks(artifact: dict, figure: dict, export: dict, measured: dict, dependencies: dict, inspector: Any) -> None:
    format_name = artifact["format"]
    common = {"manifest_binding", "stable_snapshot", "artifact_inspection"}
    names = {
        "png": {"png_header", "png_dimensions", "png_pixels"},
        "svg": {"svg_xml", "svg_references", "svg_dimensions", "svg_geometry", "svg_accessibility"},
        "pdf": {"pdfinfo", "pdffonts", "pdf_structure", "pdf_font_inventory", "pdf_font_embedding",
                "pdftotext", "pdf_text_extractability", "pdf_text_integrity"}
               | {f"pdf_page_{page}_dimensions" for page in range(1, export.get("pages", 1) + 1)},
    }
    checks = checks_by_name(artifact.get("checks"), common | names[format_name], artifact["file"])
    require_checks(checks, {"manifest_binding", "stable_snapshot"}, artifact["file"])
    require(all(checks[name]["status"] == "passed" for name in ("manifest_binding", "stable_snapshot")),
            "artifact binding/snapshot declaration did not pass")
    terminal = "artifact_inspection" in checks
    if terminal:
        require(checks["artifact_inspection"]["status"] == "failed", "artifact_inspection must record failure")
    if format_name == "pdf":
        if not terminal:
            require_checks(checks, {"pdfinfo", "pdffonts", "pdf_text_extractability", "pdf_text_integrity"}, artifact["file"])
        for name, targets in (("pdfinfo", {"pdf_structure"} | {key for key in checks if key.startswith("pdf_page_")}),
                              ("pdffonts", {"pdf_font_inventory", "pdf_font_embedding"})):
            if targets & checks.keys():
                require(name in checks and checks[name]["status"] == "passed", f"{name} missing for derived checks")
        for name, target in (("pdfinfo", "pdf_structure"), ("pdffonts", "pdf_font_inventory")):
            if name not in checks:
                continue
            validate_tool(checks[name], dependencies[name], name)
            if checks[name]["status"] == "passed":
                derived = []
                try:
                    if name == "pdfinfo":
                        inspector.parse_pdfinfo(checks[name]["stdout"], export, derived)
                    else:
                        inspector.parse_pdffonts(checks[name]["stdout"], derived)
                except inspector.InspectionError:
                    require(target in checks and checks[target]["status"] == "failed", f"{name} parser failure not preserved")
                else:
                    compare_derived(checks, derived, artifact["file"])
            else:
                require(target not in checks and (name != "pdffonts" or "pdf_font_embedding" not in checks),
                        f"{name} unavailable/failed but derived checks were supplied")
        if "pdf_font_inventory" in checks and checks["pdf_font_inventory"]["status"] == "failed":
            require("pdf_font_embedding" not in checks, "failed font inventory cannot prove embedding")
        if "pdftotext" in checks:
            require(checks["pdftotext"]["status"] == "passed", "failed text extraction must remain not_verified")
            validate_tool(checks["pdftotext"], dependencies["pdftotext"], "pdftotext")
        if not terminal or "pdf_text_integrity" in checks:
            validate_pdf_text(checks, figure, artifact, inspector)
    elif format_name == "png":
        if not terminal:
            require_checks(checks, names["png"], artifact["file"])
        if "png_header" in checks:
            require(checks["png_header"]["status"] == "passed"
                    and all(integer(checks["png_header"].get(key), 1)
                            and checks["png_header"][key] == measured[key] for key in ("width", "height")),
                    "PNG header contradicts the bound artifact")
        pixels = checks.get("png_pixels", {})
        if pixels.get("status") == "passed":
            require(dependencies["pillow"]["status"] == "available", "PNG pixels passed without Pillow")
        if "foreground_pixels" in pixels or pixels.get("status") == "passed":
            require(all(integer(pixels.get(key), 1) and pixels[key] == measured[key] for key in ("width", "height"))
                    and integer(pixels.get("foreground_pixels")), "PNG pixel dimensions/count are invalid")
            count = pixels["width"] * pixels["height"]
            require(pixels["foreground_pixels"] <= count, "PNG foreground exceeds pixel count")
            fraction = pixels["foreground_pixels"] / count
            require(type(pixels.get("foreground_fraction")) in (int, float)
                    and pixels["foreground_fraction"] == fraction, "PNG foreground fraction contradicts count")
            extrema = pixels.get("rgb_extrema")
            require(isinstance(extrema, list) and len(extrema) == 3
                    and all(isinstance(pair, list) and len(pair) == 2 and all(integer(value) for value in pair)
                            and 0 <= pair[0] <= pair[1] <= 255 for pair in extrema), "PNG extrema are invalid")
            nonuniform = any(pair[0] != pair[1] for pair in extrema)
            require(type(pixels.get("nonuniform")) is bool and pixels["nonuniform"] == nonuniform,
                    "PNG nonuniform flag contradicts extrema")
            expected = "passed" if nonuniform and fraction >= inspector.MIN_FOREGROUND_FRACTION else "failed"
            require(pixels["status"] == expected, "PNG pixel status contradicts measurements")
    else:
        if not terminal:
            require_checks(checks, {"svg_xml", "svg_references", "svg_geometry", "svg_accessibility"}, artifact["file"])
        if "svg_xml" in checks:
            require(checks["svg_xml"]["status"] == "passed", "SVG XML failure must retain artifact_inspection")
        if checks.get("svg_geometry", {}).get("status") == "passed":
            require_checks(checks, {"svg_dimensions"}, artifact["file"])
            geometry = checks["svg_geometry"]
            require(all(inspector.positive_number(geometry.get(key)) for key in
                        ("width_px", "height_px", "css_width_px", "css_height_px", "physical_width_in", "physical_height_in")),
                    "SVG geometry is missing positive dimensions")
            require(all(geometry[f"{key}_px"] == measured[key] for key in ("width", "height")),
                    "SVG geometry contradicts measured viewport")
            viewbox = geometry.get("native_viewbox")
            require(isinstance(viewbox, list) and len(viewbox) == 4
                    and all(type(value) in (int, float) and math.isfinite(value) for value in viewbox)
                    and min(viewbox[2:]) > 0, "invalid native SVG viewBox")
            for key, actual in zip(("viewbox_width", "viewbox_height"), viewbox[2:]):
                require(math.isclose(export[key], actual, rel_tol=1e-6, abs_tol=0.001), "SVG viewBox contradicts manifest")
            for prefix in ("", "css_"):
                require(math.isclose(geometry[f"{prefix}width_px"] / geometry[f"{prefix}height_px"],
                                     viewbox[2] / viewbox[3], rel_tol=inspector.ASPECT_RATIO_TOLERANCE),
                        "SVG viewport/root viewBox aspect ratios disagree")
            for direction in ("width", "height"):
                physical = geometry[f"physical_{direction}_in"]
                require(math.isclose(physical, geometry[f"css_{direction}_px"] / 96, rel_tol=1e-6, abs_tol=1e-6),
                        "SVG physical dimensions contradict CSS viewport")
                if f"physical_{direction}_in" in export:
                    require(math.isclose(physical, export[f"physical_{direction}_in"], rel_tol=1e-6, abs_tol=1e-6),
                            "SVG physical dimensions contradict manifest")
        accessibility = checks.get("svg_accessibility", {})
        if accessibility.get("status") == "passed":
            require(text(accessibility.get("description")) and accessibility.get("title") == " ".join(figure["title"].split()),
                    "SVG accessibility title/description contradicts manifest")
            if "description" in export:
                require(accessibility["description"] == " ".join(export["description"].split()),
                        "SVG accessible description contradicts manifest")
    dimension_name = {"png": "png_dimensions", "svg": "svg_dimensions"}.get(format_name)
    if dimension_name in checks:
        derived = []
        inspector.compare_dimensions(derived, dimension_name, measured["width"], measured["height"], export,
                                     0.001 if format_name == "svg" else 0)
        compare_derived(checks, derived, artifact["file"])
    require(artifact.get("status") == inspector.combined_status(list(checks.values())),
            f"{artifact['file']} status contradicts check leaves")


def validate_declaration(payload: dict, runtime_bundle: dict) -> dict:
    spec = importlib.util.spec_from_file_location("rendered_audit_inspector", Path(__file__).with_name("inspect_rendered_artifacts.py"))
    require(spec is not None and spec.loader is not None, "local inspector parser is unavailable")
    inspector = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(inspector)
    required = {"schema_version", "evidence_type", "generated_at", "scope", "limitations", "human_visual_inspection",
                "desktop_interaction", "cjk_glyph_rendering", "matlab_execution", "manifest", "artifact_root",
                "manifest_sha256", "manifest_bytes", "inspector_sha256", "dependencies", "policy", "checks",
                "artifacts", "artifact_sha256", "status", "summary"}
    require(set(payload) == required, "missing or unsupported root fields")
    require(type(payload["schema_version"]) is int and payload["schema_version"] == 1
            and payload["evidence_type"] == "automated_rendered_artifact_inspection"
            and payload["scope"] == "automated_artifact_checks_only", "unsupported schema/type/scope")
    require(all(payload[field] == "not_verified" for field in
                ("human_visual_inspection", "desktop_interaction", "cjk_glyph_rendering", "matlab_execution")),
            "external audit cannot promote visual/desktop/CJK/MATLAB verification")
    require(all(text(payload[field]) for field in ("manifest", "artifact_root", "limitations", "generated_at"))
            and digest(payload["inspector_sha256"]), "invalid provenance fields")
    require(payload["generated_at"].endswith("Z"), "generated_at must be UTC")
    try:
        datetime.fromisoformat(payload["generated_at"][:-1] + "+00:00")
    except ValueError as error:
        raise AuditValidationError("rendered audit: invalid generated_at") from error
    pending = [payload]
    while pending:
        value = pending.pop()
        if isinstance(value, dict):
            pending.extend(value.values())
        elif isinstance(value, list):
            pending.extend(value)
        elif isinstance(value, float):
            require(math.isfinite(value), "nonfinite numeric evidence")
    manifest = runtime_bundle["manifest_file"]
    require(integer(payload["manifest_bytes"], 1) and payload["manifest_bytes"] == manifest["bytes"]
            and payload["manifest_sha256"] == manifest["sha256"], "manifest bytes/hash mismatch")
    policy = payload["policy"]
    fixed_policy = {
        "max_file_bytes": inspector.MAX_FILE_BYTES, "max_png_pixels": inspector.MAX_PNG_PIXELS,
        "png_white_threshold": inspector.WHITE_THRESHOLD, "png_min_foreground_fraction": inspector.MIN_FOREGROUND_FRACTION,
        "svg_ratio_relative_tolerance": inspector.ASPECT_RATIO_TOLERANCE, "pdf_dimension_tolerance_pt": 1.0,
        "pdf_max_pages": inspector.MAX_PDF_PAGES, "pdf_text_max_output_bytes": inspector.MAX_PDF_TEXT_BYTES,
        "pdf_text_max_expected_strings": inspector.MAX_EXPECTED_PDF_TEXTS,
        "pdf_text_max_expected_length": inspector.MAX_EXPECTED_PDF_TEXT_LENGTH,
    }
    require(isinstance(policy, dict) and set(policy) == {*fixed_policy, "pdf_timeout_seconds"}
            and all(type(policy[key]) in (int, float) and declaration_equal(policy[key], value)
                    for key, value in fixed_policy.items())
            and inspector.positive_number(policy["pdf_timeout_seconds"]), "unsupported inspection policy keys/values")
    dependencies = payload["dependencies"]
    require(isinstance(dependencies, dict) and set(dependencies) == {"pillow", "pdfinfo", "pdffonts", "pdftotext"},
            "incomplete dependency inventory")
    for name, dependency in dependencies.items():
        require(isinstance(dependency, dict) and dependency.get("status") in ("available", "not_verified"),
                f"invalid {name} dependency status")
    expected = {item["file"]: item for item in runtime_bundle["artifacts"]}
    records = payload["artifacts"]
    require(isinstance(records, list) and len(records) == len(expected), "artifact coverage does not match manifest")
    figures = {figure["id"]: figure for figure in runtime_bundle["manifest"]["figures"]}
    seen = set()
    for artifact in records:
        require(isinstance(artifact, dict) and set(artifact) == {"file", "format", "figure_id", "checks", "bytes", "sha256", "status"},
                "incomplete artifact record")
        relative = artifact["file"]
        require(isinstance(relative, str) and relative in expected and relative not in seen, "unknown or duplicate artifact file")
        seen.add(relative)
        measured = expected[relative]
        require(integer(artifact["bytes"], 1) and all(artifact[key] == measured[key] for key in
                ("file", "format", "figure_id", "bytes", "sha256")), f"{relative} identity/bytes/hash mismatch")
        figure = figures[artifact["figure_id"]]
        try:
            validate_format_checks(artifact, figure, figure["exports"][artifact["format"]], measured, dependencies, inspector)
        except inspector.InspectionError as error:
            raise AuditValidationError(f"rendered audit: invalid inspector declaration: {error}") from error
    require(payload["artifact_sha256"] == {name: item["sha256"] for name, item in expected.items()},
            "artifact_sha256 does not match complete artifact set")
    roots = checks_by_name(payload["checks"], {"manifest_snapshot", "input_validation", "manifest_exports", "manifest_figures",
                                             "manifest_paths", "root_inventory"}, "root")
    require_checks(roots, {"manifest_snapshot"}, "root")
    require(roots["manifest_snapshot"]["status"] == "passed", "manifest snapshot declaration failed")
    require(all(check["status"] == "failed" for name, check in roots.items() if name != "manifest_snapshot"),
            "root error checks must preserve failure")
    status = inspector.combined_status(payload["checks"] + records)
    summary = {state: sum(item["status"] == state for item in records) for state in ("passed", "failed", "not_verified")}
    summary["artifact_count"] = len(records)
    require(payload["status"] == status, "root status contradicts check leaves")
    require(isinstance(payload["summary"], dict) and all(integer(value) for value in payload["summary"].values())
            and payload["summary"] == summary, "summary contradicts artifact states")
    return {"checks": payload["checks"], "artifacts": records, "status": status, "summary": summary}
