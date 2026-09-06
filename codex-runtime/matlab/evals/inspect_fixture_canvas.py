#!/usr/bin/env python3
"""Read-only inspection of native fixture canvas declarations and bound files.

Use --artifact-root /download/matlab-full100-R2021a --release R2021a
--context primary --fixture-root /checkout/codex-runtime/matlab/evals/fixtures.
The diagnostic path is fixed by context, never supplied by its payload.
Exit 0 means declaration_consistent, 1 failed, 2 incomplete/not_applicable.
No MATLAB execution, scoring, PDF page/font inspection or visual approval.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import stat
import struct
import sys
import zlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from inspect_rendered_artifacts import (
    finite_json_float, reject_json_constant, require, safe_artifact_path, unique_json_object,
)


MAX_JSON_BYTES = 4 * 1024 * 1024
MAX_ARTIFACT_BYTES = 128 * 1024 * 1024
REPORT = "native-pdf-page-probe/native-fixture-canvas/native-fixture-canvas.json"
SOURCES = {
    "crossed-time-depth-temperature": "crossed_time_depth_temperature.json",
    "repeat-cast-salinity-profiles": "repeat_cast_salinity_profiles.json",
    "paired-observation-model": "paired_observation_model.json",
    "paired-interactive": "crossed_time_depth_temperature.json",
}
ARTIFACTS = {
    "reference_png": ("reference.png", "print -dpng -r300"),
    "reference_pdf": ("reference.pdf", "print -dpdf -painters"),
    "canvas_pdf": ("canvas.pdf", "exportgraphics(panel, ContentType=vector)"),
    "restored_png": ("restored.png", "print -dpng -r300"),
}
GEOMETRY = ("constructed", "before_wrap", "after_wrap", "after_pdf", "after_restore", "after_restored_png")
DATA_PHASES = ("after_reference", "after_wrap", "after_pdf", "after_restore", "after_restored_png")
RESTORATION_FLAGS = ("restoration_attempted", "restoration_completed", "root_state_preserved",
                     "parent_identity_preserved", "callback_restoration_verified")
ERROR_FIELDS = ("error_identifier", "error_message")
NOTICE = (
    "Independent local declaration consistency and file bytes/SHA-256 checks only. "
    "Input bytes are measured from the explicitly supplied fixture root; the producer declares "
    "an input hash, not an input byte count or archived input snapshot. PNG dimensions use IHDR/CRC, "
    "not pixel decoding. Geometry captured and restoration booleans are declarations, not independent "
    "proof of unchanged geometry, parent identity, callbacks or native data. DirectChildCount is reported "
    "metadata, not an independent allchild/annotation-emptiness check. No PDF page/font or visual "
    "certification, MATLAB re-execution, freshness claim, stage credit or score."
)


def local_root(value: Path) -> Path:
    root = Path(os.path.abspath(value))
    require(not any(path.is_symlink() for path in (root, *root.parents)), "root must not traverse symlinks")
    require(root.is_dir(), f"directory required: {root}")
    return root


def read_snapshot(root: Path, relative: str, limit: int, retain: bool = False) -> tuple[dict, bytes]:
    local_root(root)
    safe_artifact_path(root, relative)
    descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        parts = relative.split("/")
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        file_descriptor = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=descriptor)
        with os.fdopen(file_descriptor, "rb") as stream:
            before = os.fstat(stream.fileno())
            require(stat.S_ISREG(before.st_mode) and before.st_size <= limit, "regular bounded file required")
            digest, size, content = hashlib.sha256(), 0, bytearray()
            while chunk := stream.read(min(65536, limit + 1 - size)):
                size += len(chunk)
                require(size <= limit, "file exceeds byte limit")
                digest.update(chunk)
                content.extend(chunk if retain else chunk[:max(0, 33 - len(content))])
            after = os.fstat(stream.fileno())
            require(size == before.st_size and all(getattr(before, key) == getattr(after, key)
                    for key in ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")),
                    "file changed while reading")
        return {"file": relative, "bytes": size, "sha256": digest.hexdigest()}, bytes(content)
    finally:
        os.close(descriptor)


def parse_json(content: bytes) -> Any:
    return json.loads(content.decode("utf-8"), object_pairs_hook=unique_json_object,
                      parse_constant=reject_json_constant, parse_float=finite_json_float)


def digest_string(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(char in "0123456789abcdef" for char in value)


def strings(value: Any) -> list | None:
    if isinstance(value, str):
        value = [value]
    return value if isinstance(value, list) and all(isinstance(item, str) and item for item in value) else None


class Inspection:
    def __init__(self) -> None:
        self.checks: list = []
        self.snapshots: dict = {}

    def check(self, name: str, condition: bool, reason: str, incomplete: bool = False) -> bool:
        self.checks.append({"name": name, "status": "passed" if condition else (
            "not_verified" if incomplete else "failed"), "reason": reason})
        return condition

    def record(self, value: Any, fields: tuple, name: str, partial: bool = False) -> dict:
        valid = isinstance(value, dict) and (set(value) <= set(fields) if partial else set(value) == set(fields))
        self.check(name, valid, "known object fields required" + ("; partial checkpoint allowed" if partial else ""))
        return value if isinstance(value, dict) else {}

    def snapshot(self, root: Path, relative: str, limit: int, retain: bool = False) -> tuple[dict, bytes]:
        evidence, content = read_snapshot(root, relative, limit, retain)
        key = (root, relative, limit)
        previous = self.snapshots.setdefault(key, dict(evidence))
        require(previous == evidence, "file changed between repeated reads")
        return evidence, content

    def errors(self, record: dict, name: str) -> dict:
        result = {key: record.get(key) if isinstance(record.get(key), str) else "" for key in ERROR_FIELDS}
        self.check(name + ".error_types", all(type(record.get(key)) is str for key in ERROR_FIELDS),
                   "error fields must be strings")
        if any(result.values()):
            self.check(name + ".reported_error", False, json.dumps(result, ensure_ascii=False))
        return result

    def geometry(self, value: Any, name: str) -> dict:
        if value == {}:
            return {"reported_status": None, "object_count": 0, "errors": {}}
        record = self.record(value, ("status", "objects", *ERROR_FIELDS), name)
        errors = self.errors(record, name)
        status = record.get("status")
        self.check(name + ".status", status in ("captured", "capture_failed"), "known geometry status required")
        objects = record.get("objects")
        if isinstance(objects, dict):
            objects = [objects]
        if not self.check(name + ".objects", isinstance(objects, list), "MATLAB object array required"):
            objects = []
        for index, value in enumerate(objects, 1):
            fields = ("object_index", "class", "parent_class", "properties", "unavailable_properties")
            if isinstance(value, dict) and "nonpublic_properties" in value:
                fields += ("nonpublic_properties",)
            item = self.record(value, fields,
                               name + f".objects[{index}]")
            self.check(name + f".object[{index}]", type(item.get("object_index")) is int
                       and item["object_index"] == index and isinstance(item.get("class"), str) and bool(item["class"])
                       and isinstance(item.get("parent_class"), str) and isinstance(item.get("properties"), dict)
                       and strings(item.get("unavailable_properties")) is not None,
                       "ordered native object indices and property containers required")
            nonpublic = strings(item.get("nonpublic_properties", []))
            unavailable = strings(item.get("unavailable_properties"))
            properties = item.get("properties")
            self.check(name + f".object[{index}].nonpublic", nonpublic is not None
                       and unavailable is not None and isinstance(properties, dict)
                       and len(nonpublic) == len(set(nonpublic))
                       and set(nonpublic) <= set(unavailable) and not set(nonpublic).intersection(properties),
                       "non-public getters must remain unavailable, never measured geometry")
        self.check(name + ".capture", status == "captured", "geometry capture declaration; not a geometry equality check")
        return {"reported_status": status, "object_count": len(objects), "errors": errors}

    def input(self, details: Any, identifier: str, fixture_root: Path) -> dict:
        result: dict = {"status": "not_verified", "declared_bytes": None}
        if details == {}:
            return result
        before = len(self.checks)
        record = self.record(details, ("case_id", "source_file", "input_sha256", "title", "data_source"), identifier + ".input")
        source = SOURCES[identifier]
        self.check(identifier + ".input_identity", record.get("case_id") == identifier
                   and record.get("source_file") == source and record.get("data_source") == "synthetic"
                   and isinstance(record.get("title"), str) and bool(record["title"].strip()),
                   "case must name its fixed synthetic source fixture")
        result["declared_sha256"] = record.get("input_sha256")
        try:
            measured, content = self.snapshot(fixture_root, source, MAX_JSON_BYTES, True)
            result.update(measured)
            fixture = parse_json(content)
            expected_id = identifier if identifier != "paired-interactive" else "crossed-time-depth-temperature"
            self.check(identifier + ".fixture_identity", isinstance(fixture, dict)
                       and fixture.get("id") == expected_id and fixture.get("synthetic") is True,
                       "supplied input must retain its synthetic fixture identity")
            self.check(identifier + ".input_hash", digest_string(record.get("input_sha256"))
                       and record["input_sha256"] == measured["sha256"], "recomputed input SHA-256 compared with declaration")
        except (OSError, ValueError, RecursionError) as error:
            self.check(identifier + ".input_read", False, str(error))
        result["status"] = "failed" if any(item["status"] == "failed" for item in self.checks[before:]) else "matched"
        return result

    def artifact(self, value: Any, identifier: str, kind: str, directory: Path) -> dict:
        name = identifier + "." + kind
        record = self.record(value, ("file", "requested_api", "status", "api_invoked", "call_succeeded",
                                    "export_object_class", "bytes", "sha256", "png_pixels", *ERROR_FIELDS), name)
        errors = self.errors(record, name)
        result = {"declared": record, "measured": None, "errors": errors}
        status = record.get("status")
        self.check(name + ".status", status in ("not_attempted", "exported", "failed"), "known export status required")
        self.check(name + ".types", all(type(record.get(key)) is bool for key in ("api_invoked", "call_succeeded"))
                   and type(record.get("bytes")) is int and record["bytes"] >= 0
                   and isinstance(record.get("sha256"), str) and isinstance(record.get("export_object_class"), str)
                   and isinstance(record.get("png_pixels"), list), "strict call, byte/hash and dimension types required")
        filename, requested_api = ARTIFACTS[kind]
        relative = identifier + "/" + filename
        self.check(name + ".path_api", record.get("file") == relative and record.get("requested_api") == requested_api,
                   "fixed candidate artifact path and native API required")
        succeeded = record.get("call_succeeded") is True
        invoked = record.get("api_invoked") is True
        expected_class = "matlab.ui.container.Panel" if kind == "canvas_pdf" else "matlab.ui.Figure"
        self.check(name + ".call", (not succeeded or invoked)
                   and record.get("export_object_class") == (expected_class if invoked else ""),
                   "successful calls require invocation and the declared figure/panel target")
        if status == "exported":
            self.check(name + ".exported", succeeded and digest_string(record.get("sha256"))
                       and type(record.get("bytes")) is int and record["bytes"] > 0 and not any(errors.values()),
                       "exported requires successful call and complete nonempty file declaration")
        elif status == "not_attempted":
            self.check(name + ".not_attempted", not invoked and not succeeded and record.get("bytes") == 0
                       and record.get("sha256") == "" and record.get("png_pixels") == []
                       and record.get("export_object_class") == "" and not any(errors.values()),
                       "unattempted exports cannot claim files or calls")
        else:
            self.check(name + ".native_failure", False, "producer declared export failure")
        try:
            measured, header = self.snapshot(directory, relative, MAX_ARTIFACT_BYTES)
            result["measured"] = measured
            self.check(name + ".unexpected_file", status != "not_attempted", "unattempted export must not have an output file")
            bound = record.get("sha256") not in (None, "") or record.get("bytes") not in (None, 0)
            self.check(name + ".file_binding", digest_string(record.get("sha256"))
                       and record["sha256"] == measured["sha256"] and type(record.get("bytes")) is int
                       and record["bytes"] == measured["bytes"], "actual file bytes/SHA-256 compared with declaration",
                       incomplete=status == "failed" and not bound)
            if filename.endswith(".png"):
                require(len(header) == 33 and header[:16] == b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
                        and zlib.crc32(header[12:29]) == struct.unpack(">I", header[29:33])[0], "invalid PNG IHDR/CRC")
                pixels = list(struct.unpack(">II", header[16:24]))
                measured["png_pixels"] = pixels
                declared = record.get("png_pixels")
                self.check(name + ".png_dimensions", isinstance(declared, list)
                           and all(type(value) is int for value in declared) and declared == pixels == [2400, 1500],
                           "PNG IHDR dimensions must match declaration and native 2400x1500 contract; no pixel decoding")
            else:
                self.check(name + ".pdf_header", header.startswith(b"%PDF-") and record.get("png_pixels") == [],
                           "PDF signature only; no page, font, text or visual certification")
        except FileNotFoundError:
            result["measured"] = {"file": relative, "present": False}
            if status != "not_attempted":
                self.check(name + ".missing_file", False, "declared export has no file")
        except (OSError, ValueError) as error:
            self.check(name + ".file_read", False, str(error))
        return result

    def candidate(self, value: dict, directory: Path, fixture_root: Path) -> dict:
        identifier = value["id"]
        before = len(self.checks)
        record = self.record(value, ("id", "status", "details", *ARTIFACTS, "geometry", "wrapper_geometry",
                                     "data_preservation", *RESTORATION_FLAGS, "root_inventory", "excluded_root_classes",
                                     "restoration_error", *ERROR_FIELDS), identifier)
        errors = self.errors(record, identifier)
        status = record.get("status")
        self.check(identifier + ".status", status in ("pending", "failed", "completed_diagnostic"), "known candidate status required")
        flags = {key: record.get(key) for key in RESTORATION_FLAGS}
        self.check(identifier + ".flags", all(type(value) is bool for value in flags.values()), "restoration flags must be booleans")
        self.check(identifier + ".restoration", (flags["restoration_completed"] is not True or flags["restoration_attempted"] is True)
                   and (not any(flags[key] is True for key in ("root_state_preserved", "parent_identity_preserved"))
                        or flags["restoration_completed"] is True)
                   and isinstance(record.get("restoration_error"), str), "restoration declarations must be consistent")
        self.check(identifier + ".callbacks", flags["callback_restoration_verified"] is False,
                   "producer does not verify callback restoration")
        if record.get("restoration_error"):
            self.check(identifier + ".restoration_error", False, str(record["restoration_error"]))
        result = {"id": identifier, "reported_status": status, "errors": errors, "restoration": flags,
                  "restoration_error": record.get("restoration_error"),
                  "input": self.input(record.get("details"), identifier, fixture_root)}
        result["artifacts"] = {kind: self.artifact(record.get(kind), identifier, kind, directory) for kind in ARTIFACTS}
        for group, phases in (("geometry", GEOMETRY), ("wrapper_geometry", ("after_wrap", "after_pdf"))):
            snapshots = self.record(record.get(group), phases, identifier + "." + group, partial=status != "completed_diagnostic")
            result[group] = {phase: self.geometry(snapshot, identifier + "." + group + "." + phase)
                             for phase, snapshot in snapshots.items()}
        result["root_inventory"] = self.geometry(record.get("root_inventory"), identifier + ".root_inventory")
        excluded = strings(record.get("excluded_root_classes"))
        self.check(identifier + ".excluded_roots", excluded is not None, "excluded root classes must be a MATLAB string vector")
        result["excluded_root_classes"] = excluded
        data = self.record(record.get("data_preservation"), DATA_PHASES, identifier + ".data_preservation",
                           partial=status != "completed_diagnostic")
        self.check(identifier + ".data_flags", all(type(value) is bool for value in data.values()), "data preservation flags must be booleans")
        result["data_preservation"] = data
        if status == "completed_diagnostic":
            snapshots = [*result["geometry"].values(), *result["wrapper_geometry"].values(), result["root_inventory"]]
            self.check(identifier + ".completion", all(flags[key] is True for key in RESTORATION_FLAGS[:-1])
                       and all(value is True for value in data.values()) and result["input"]["status"] == "matched"
                       and all(item["reported_status"] == "captured" and item["object_count"] > 0 for item in snapshots)
                       and all(result["artifacts"][kind]["declared"].get("status") == "exported" for kind in ARTIFACTS),
                       "completion requires input binding, four exports, restoration flags and all nine captures")
        elif status == "pending":
            self.check(identifier + ".pending", all(value is False for value in flags.values())
                       and all(record.get(key) == {} for key in ("details", "geometry", "wrapper_geometry", "data_preservation", "root_inventory"))
                       and all(result["artifacts"][kind]["declared"].get("status") == "not_attempted" for kind in ARTIFACTS)
                       and not any(errors.values()) and record.get("restoration_error") == "" and excluded == [],
                       "root report pending candidates must retain the unattempted template")
        else:
            self.check(identifier + ".native_failure", False, "producer declared candidate failure")
        result["status"] = "failed" if any(item["status"] == "failed" for item in self.checks[before:]) else (
            "declaration_consistent" if status == "completed_diagnostic" else "not_verified")
        return result


def inspect_fixture_canvas(artifact_root: Path, fixture_root: Path, release: str, context: str) -> dict:
    audit = Inspection()
    result = {"schema_version": 1, "scope": "fixture_canvas_declaration_and_file_checks_only",
              "status": "not_verified", "counts_toward_stage": False, "notice": NOTICE,
              "generated_at": datetime.now(timezone.utc).isoformat(), "release": release, "context": context,
              "reported_status": None, "reported_release": None, "diagnostic": None, "candidates": [],
              "pdf_pages": "not_verified", "pdf_fonts": "not_verified", "visual": "not_verified",
              "matlab_execution": "not_verified", "checks": audit.checks}
    try:
        require(release in ("R2021a", "R2024b", "R2026a") and context in ("primary", "display"), "known release/context required")
        root = local_root(artifact_root)
        result["artifact_root"] = str(root)
        source = ("display-comparison/" if context == "display" else "") + REPORT
        result["source"] = source
        try:
            result["diagnostic"], content = audit.snapshot(root, source, MAX_JSON_BYTES, True)
        except FileNotFoundError:
            result["status"] = "not_run"
            audit.check("diagnostic_missing", False, "fixed diagnostic report not generated; no inference from other probes", True)
            return result
        payload = parse_json(content)
        fields = ("schema_version", "status", "release", "generated_at", "completed_at", "scope", "data_source",
                  "counts_toward_stage", "target_page_inches", "target_page_points", "external_inspection_status",
                  "exact_page_verified", "font_embedding_verified", "layout_verified", "skip_reason", "candidates")
        record = audit.record(payload, fields, "diagnostic")
        result.update(reported_status=record.get("status"), reported_release=record.get("release"))
        expected = {"schema_version": 1, "release": release, "counts_toward_stage": False,
                    "scope": "native fixture canvas diagnostic; not a production export strategy",
                    "data_source": "synthetic benchmark, not observed ocean conditions", "external_inspection_status": "pending",
                    "exact_page_verified": False, "font_embedding_verified": False, "layout_verified": False}
        for key, value in expected.items():
            audit.check("diagnostic." + key, type(record.get(key)) is type(value) and record[key] == value, "fixed diagnostic contract required")
        audit.check("diagnostic.targets", record.get("target_page_inches") == [8, 5]
                    and record.get("target_page_points") == [576, 360], "declared page targets only, not PDF measurement")
        status = record.get("status")
        audit.check("diagnostic.status", status in ("running", "incomplete", "completed_diagnostics_only", "not_applicable"), "known report status required")
        for key in ("generated_at", "completed_at"):
            value = record.get(key)
            if key == "completed_at" and status == "running":
                audit.check("diagnostic." + key, value == "", "running checkpoint must not claim completion")
            else:
                require(isinstance(value, str), key + " must be UTC timestamp text")
                datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
        records = record.get("candidates")
        require(isinstance(records, list), "four candidates must be a JSON array")
        if release == "R2026a" or status == "not_applicable":
            audit.check("diagnostic.not_applicable", release == "R2026a" and status == "not_applicable" and records == []
                        and record.get("skip_reason") == "old_release_experiment_only; retain existing exact exportgraphics strategy",
                        "only R2026a may declare not_applicable; never a pass")
            result["status"] = "not_applicable"
        else:
            audit.check("diagnostic.skip_reason", record.get("skip_reason") == "", "applicable releases must not declare a skip")
            fixtures = local_root(fixture_root)
            result["fixture_root"] = str(fixtures)
            directory = root / source.rsplit("/", 1)[0]
            seen = set()
            for candidate in records:
                identifier = candidate.get("id") if isinstance(candidate, dict) else None
                if not audit.check("diagnostic.candidate_id", isinstance(identifier, str) and identifier in SOURCES
                                   and identifier not in seen, "exactly four unique known fixture IDs required"):
                    continue
                seen.add(identifier)
                result["candidates"].append(audit.candidate(candidate, directory, fixtures))
            audit.check("diagnostic.coverage", seen == set(SOURCES) and len(records) == 4, "all four fixture candidates required")
            statuses = [item["reported_status"] for item in result["candidates"]]
            if status != "running":
                audit.check("diagnostic.completion", all(value in ("completed_diagnostic", "failed") for value in statuses)
                            and (status == "completed_diagnostics_only") == (statuses == ["completed_diagnostic"] * 4),
                            "terminal root status must agree with all four candidate statuses")
            result["status"] = "declaration_consistent" if status == "completed_diagnostics_only" else "not_verified"
    except (OSError, ValueError, RecursionError) as error:
        audit.check("input_validation", False, str(error))
    for (root, relative, limit), expected in audit.snapshots.items():
        try:
            actual, _ = read_snapshot(root, relative, limit)
            audit.check("snapshot_unchanged:" + relative, actual == expected, "file bytes/SHA-256 unchanged at end of inspection")
        except (OSError, ValueError) as error:
            audit.check("snapshot_unchanged:" + relative, False, str(error))
    if any(item["status"] == "failed" for item in audit.checks):
        result["status"] = "failed"
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact-root", type=Path, required=True, help="one matlab-full100-RELEASE artifact directory")
    parser.add_argument("--fixture-root", type=Path, required=True, help="explicit source fixture directory; no inputs are synthesized")
    parser.add_argument("--release", choices=("R2021a", "R2024b", "R2026a"), required=True)
    parser.add_argument("--context", choices=("primary", "display"), required=True)
    parser.add_argument("--output", type=Path, help="optional new evidence JSON outside both input roots")
    arguments = parser.parse_args(argv)
    if arguments.output:
        output = arguments.output.resolve()
        if any(output.is_relative_to(root.resolve()) for root in (arguments.artifact_root, arguments.fixture_root)):
            parser.error("output must be outside artifact and fixture roots")
        if arguments.output.exists() or arguments.output.is_symlink():
            parser.error("output must be a new non-symlink file")
    result = inspect_fixture_canvas(arguments.artifact_root, arguments.fixture_root, arguments.release, arguments.context)
    encoded = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if arguments.output:
        try:
            with arguments.output.open("x", encoding="utf-8") as stream:
                stream.write(encoded)
        except OSError as error:
            parser.error(str(error))
    sys.stdout.write(encoded)
    return {"declaration_consistent": 0, "failed": 1}.get(result["status"], 2)


if __name__ == "__main__":
    raise SystemExit(main())
