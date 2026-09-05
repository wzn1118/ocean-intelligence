from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import math
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import zlib
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "build_ocean_report.py"
SPEC = importlib.util.spec_from_file_location("build_ocean_report", MODULE_PATH)
assert SPEC and SPEC.loader
ocean_report = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ocean_report)


INTERACTIVE_VECTOR_PATHS = (
    ("time_utc",), ("native_values",), ("missing_mask",),
    ("observation_ids",), ("source_rows",), ("qc", "flags"),
    ("uncertainty", "values"), ("uncertainty", "missing_mask"),
    ("uncertainty", "joint_valid_mask"),
    ("uncertainty", "errorbar", "time_utc"),
    ("uncertainty", "errorbar", "values"),
    ("uncertainty", "errorbar", "negative_delta"),
    ("uncertainty", "errorbar", "positive_delta"),
)
SIMULATED_AUDIT_REASON = "Synthetic unit-test audit; NOT actual inspector evidence or a visual pass."


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def png_chunk(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)


def write_png(path: Path, width: int, height: int) -> None:
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    scanlines = b"".join(b"\x00" + b"\xff\xff\xff" * width for _ in range(height))
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", header)
        + png_chunk(b"IDAT", zlib.compress(scanlines))
        + png_chunk(b"IEND", b"")
    )


def write_pdf(path: Path, width: float, height: float) -> None:
    path.write_bytes(
        (
            "%PDF-1.4\n"
            "1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj\n"
            "2 0 obj <</Type /Pages /Count 1 /Kids [3 0 R]>> endobj\n"
            f"3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 {width:g} {height:g}]>> endobj\n"
            "trailer <</Root 1 0 R>>\n%%EOF\n"
        ).encode("ascii")
    )


def write_svg(path: Path, width: int, height: int) -> None:
    path.write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}"><title>fixture</title><rect width="100%" height="100%" fill="white"/></svg>',
        encoding="utf-8",
    )


class RuntimeBundle:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.release = "R2026a"
        self.writer_release = "2026a"
        self.figures = [
            ("crossed-time-depth-temperature", 24, 23, 1),
            ("paired-interactive", 6, 5, 1),
            ("paired-observation-model", 12, 11, 1),
            ("repeat-cast-salinity-profiles", 18, 17, 1),
        ]
        entries = [self._figure(identifier, raw, valid, missing) for identifier, raw, valid, missing in self.figures]
        self.manifest = {
            "schema_version": 2,
            "generated_at": "2026-09-05T12:00:00Z",
            "generator": "Ocean Intelligence MATLAB native assets",
            "runtime_status": "ready",
            "execution_verified": True,
            "matlab_release": self.writer_release,
            "export_formats": ["png", "pdf", "svg"],
            "artifact_validation": {"status": "passed", "verified_by": "test fixture"},
            "visual_inspection": {"status": "not_run", "verified": False},
            "figures": entries,
        }
        self.runtime = {
            "schema_version": 1,
            "nonce": "0123456789abcdef0123456789abcdef",
            "runtime": "MathWorks MATLAB",
            "success": True,
            "matlab_version": "26.1.0",
            "matlab_release": self.release,
            "jvm_available": True,
            "desktop_available": False,
            "batch_startup_option_used": True,
            "fixture_ids": sorted(ocean_report.EXPECTED_FIXTURES),
            "interaction": {
                "datatip_verified": True,
                "brush_stable_ids_verified": True,
                "headless_fallback_verified": True,
            },
            "manifest": "figures.json",
        }
        self.write_metadata()

    def _figure(self, identifier: str, raw: int, valid: int, missing: int) -> dict[str, object]:
        if identifier == "paired-interactive":
            title = "温度时间序列 / Temperature time series"
        else:
            fixture_path = ocean_report.DEFAULT_FIXTURE_DIRECTORY / ocean_report.EXPECTED_FIXTURES[identifier]
            title = json.loads(fixture_path.read_bytes())["title"]
        width = 12
        height = 7 if identifier != "paired-interactive" else 8
        pdf_width = width * 72 / 300
        pdf_height = height * 72 / 300
        exports: dict[str, dict[str, object]] = {}
        for format_name in ocean_report.REQUIRED_FORMATS:
            path = self.root / f"{identifier}.{format_name}"
            if format_name == "png":
                write_png(path, width, height)
                declared_width, declared_height = width, height
            elif format_name == "pdf":
                write_pdf(path, pdf_width, pdf_height)
                declared_width, declared_height = pdf_width, pdf_height
            else:
                write_svg(path, width, height)
                declared_width, declared_height = width, height
            exports[format_name] = {
                "figure_id": identifier,
                "title": title,
                "source": "synthetic fixture",
                "theme": "Ocean Intelligence",
                "file": path.name,
                "width": declared_width,
                "height": declared_height,
                "dpi": 300,
                "pages": 1,
                "bytes": path.stat().st_size,
                "sha256": sha256(path),
                "export_api": "exportgraphics",
            }
            if format_name == "svg":
                exports[format_name]["viewbox_width"] = width
                exports[format_name]["viewbox_height"] = height
        unit = "g kg-1" if "salinity" in identifier else "degC"
        shape: int | list[int]
        if identifier == "crossed-time-depth-temperature":
            shape = [4, 6]
        elif identifier == "repeat-cast-salinity-profiles":
            shape = [6, 3]
        else:
            shape = raw
        dimensions = ["depth", "time"] if isinstance(shape, list) else ["time" if identifier == "paired-interactive" else "observation"]
        shape_values = shape if isinstance(shape, list) else [shape]
        coordinates = {
            name: {"count": count, "unit": {"depth": "m", "time": "datetime", "observation": "1"}[name],
                   "direction": "positive_down" if name == "depth" else "increasing"}
            for name, count in zip(dimensions, shape_values)
        }
        if "time" in coordinates:
            coordinates["time"]["timezone"] = "UTC"
        return {
            "id": identifier,
            "title": title,
            "source": "synthetic fixture",
            "theme": "Ocean Intelligence",
            "runtime": {"matlab_release": self.writer_release},
            "scientific_data_contract": {
                "schemaVersion": 1,
                "provided": True,
                "required": True,
                "dataType": "synthetic_fixture",
                "shape": shape,
                "rank": len(dimensions),
                "dimensionOrder": dimensions if len(dimensions) > 1 else dimensions[0],
                "observationDimension": dimensions[0],
                "coordinates": coordinates,
                **({"timeZone": "UTC"} if "time" in coordinates else {}),
                "units": {"value": unit},
                "missing": {
                    "status": "present",
                    "policy": "preserve",
                    "representation": "NaN",
                    "masked_count": 0,
                    "total_count": raw,
                    "valid_count": valid,
                    "missing_count": missing,
                },
                "qc": {"status": "present", "action": "preserve"},
                "uncertainty": {"status": "present"},
            },
            "exports": exports,
        }

    def write_metadata(self) -> None:
        (self.root / "figures.json").write_text(json.dumps(self.manifest), encoding="utf-8")
        (self.root / "matlab-runtime.json").write_text(json.dumps(self.runtime), encoding="utf-8")

    def capture_input_fixtures(self, fixture_directory: Path = ocean_report.DEFAULT_FIXTURE_DIRECTORY) -> None:
        (self.root / "fixture-inputs").mkdir()
        inputs = []
        for identifier, source_file in ocean_report.EXPECTED_FIXTURES.items():
            content = (fixture_directory / source_file).read_bytes()
            relative = f"fixture-inputs/{source_file}"
            with (self.root / relative).open("xb") as handle:
                handle.write(content)
            inputs.append({
                "id": identifier, "file": relative, "source_file": source_file,
                "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest(),
            })
        self.runtime["input_fixtures"] = inputs
        self.write_metadata()

    def simulated_rendered_audit(self, *, font_failure: bool = True) -> dict:
        def check(name: str, status: str = "passed", **details) -> dict:
            return {"name": name, "status": status, "reason": SIMULATED_AUDIT_REASON, **details}

        artifacts = []
        for figure in self.manifest["figures"]:
            for format_name, export in figure["exports"].items():
                path = self.root / export["file"]
                digest = sha256(path)
                checks = [check("manifest_binding")]
                dimensions = {"width": export["width"], "height": export["height"],
                              "expected_width": export["width"], "expected_height": export["height"]}
                if format_name == "png":
                    pixel_count = export["width"] * export["height"]
                    foreground = pixel_count // 4
                    checks.extend([check("png_header", **dimensions), check("png_dimensions", **dimensions),
                                   check("png_pixels", width=export["width"], height=export["height"],
                                         foreground_pixels=foreground, foreground_fraction=foreground / pixel_count,
                                         rgb_extrema=[[0, 255], [0, 255], [0, 255]], nonuniform=True)])
                elif format_name == "svg":
                    checks.extend([check("svg_xml"), check("svg_references"), check("svg_dimensions", **dimensions),
                                   check("svg_geometry", width_px=export["width"], height_px=export["height"],
                                         native_viewbox=[0, 0, export["viewbox_width"], export["viewbox_height"]],
                                         css_width_px=export["width"], css_height_px=export["height"],
                                         physical_width_in=export["width"] / 96, physical_height_in=export["height"] / 96),
                                   check("svg_accessibility", title=figure["title"], description=SIMULATED_AUDIT_REASON)])
                else:
                    title = figure["title"]
                    text_hash = hashlib.sha256(title.encode("utf-8")).hexdigest()
                    snapshot = {"snapshot_sha256": digest, "bbox_output_sha256": text_hash}
                    pdfinfo = (f"Pages: 1\nEncrypted: no\nPage 1 size: {export['width']:.17g} x "
                               f"{export['height']:.17g} pts\n")
                    embedded = "no" if font_failure else "yes"
                    pdffonts = ("name type encoding emb sub uni object ID\n--------------------------------------\n"
                                f"SimulatedUnitTestFont Type 1 WinAnsi {embedded} no yes 1 0\n")
                    checks.extend([
                        check("pdfinfo", returncode=0, stdout=pdfinfo, stderr=""),
                        check("pdffonts", returncode=0, stdout=pdffonts, stderr=""),
                        check("pdf_page_1_dimensions", **dimensions),
                        check("pdf_structure", page_count=1, page_dimensions=[{
                            "page": 1, "width_pt": export["width"], "height_pt": export["height"],
                        }]),
                        check("pdf_font_inventory", fonts=[{
                            "name": "SimulatedUnitTestFont", "type": "Type 1", "encoding": "WinAnsi",
                            "embedded": embedded, "subset": "no",
                            "unicode_map": "yes", "object_id": 1, "generation": 0,
                        }]),
                        check("pdf_font_embedding", "failed" if font_failure else "passed"),
                        check("pdftotext", **snapshot, returncode=0, stderr=""),
                        check("pdf_text_extractability", **snapshot, pages=[{
                            "page": 1, "word_count": len(title.split()), "text_excerpt": title,
                            "excerpt_truncated": False, "normalized_text_sha256": text_hash,
                        }]),
                        check("pdf_text_integrity", **snapshot, expected_count=1,
                              normalization="NFKC; whitespace collapsed; CJK-to-CJK extraction gaps joined",
                              word_order="pdftotext bbox-layout XML order, not coordinate sorting",
                              all_fonts_have_unicode_maps=True, labels=[{
                                  "expected": title, "normalized": title, "sources": ["title"],
                                  "status": "passed", "matching_pages": [1], "partial_matches": [],
                                  "reason": SIMULATED_AUDIT_REASON,
                              }]),
                    ])
                checks.append(check("stable_snapshot"))
                artifacts.append({"file": export["file"], "format": format_name, "figure_id": figure["id"],
                                  "bytes": path.stat().st_size, "sha256": digest, "checks": checks})
        manifest = self.root / "figures.json"
        audit = {
            "schema_version": 1, "evidence_type": "automated_rendered_artifact_inspection",
            "generated_at": "2026-09-05T18:40:24.397540Z", "scope": "automated_artifact_checks_only",
            "limitations": SIMULATED_AUDIT_REASON,
            "human_visual_inspection": "not_verified", "desktop_interaction": "not_verified",
            "cjk_glyph_rendering": "not_verified", "matlab_execution": "not_verified",
            "manifest": "/previous-runner/unit-fixture/evaluator-runtime/figures.json",
            "artifact_root": "/previous-runner/unit-fixture/evaluator-runtime",
            "manifest_bytes": manifest.stat().st_size, "manifest_sha256": sha256(manifest),
            "inspector_sha256": hashlib.sha256(SIMULATED_AUDIT_REASON.encode("ascii")).hexdigest(),
            "dependencies": {
                "pillow": {"status": "available", "version": "simulated-unit-fixture"},
                **{name: {"status": "available", "path": f"/previous-runner/unit-fixture/bin/{name}"}
                   for name in ("pdfinfo", "pdffonts", "pdftotext")},
            },
            "policy": {"max_file_bytes": 128 * 1024 * 1024, "max_png_pixels": 40_000_000,
                       "png_white_threshold": 250, "png_min_foreground_fraction": 0.001,
                       "svg_ratio_relative_tolerance": 0.005, "pdf_dimension_tolerance_pt": 1.0,
                       "pdf_max_pages": 1000, "pdf_text_max_output_bytes": 1024 * 1024,
                       "pdf_text_max_expected_strings": 128, "pdf_text_max_expected_length": 4096,
                       "pdf_timeout_seconds": 30},
            "checks": [check("manifest_snapshot")], "artifacts": artifacts,
            "artifact_sha256": {artifact["file"]: artifact["sha256"] for artifact in artifacts},
        }
        self.recount_simulated_audit(audit)
        return audit

    @staticmethod
    def recount_simulated_audit(audit: dict) -> None:
        def status_of(records: list[dict]) -> str:
            statuses = {record["status"] for record in records}
            return "failed" if "failed" in statuses else "not_verified" if "not_verified" in statuses else "passed"

        for artifact in audit["artifacts"]:
            artifact["status"] = status_of(artifact["checks"])
        audit["status"] = status_of(audit["checks"] + audit["artifacts"])
        audit["summary"] = {status: sum(artifact["status"] == status for artifact in audit["artifacts"])
                            for status in ("passed", "failed", "not_verified")}
        audit["summary"]["artifact_count"] = len(audit["artifacts"])

    def write_simulated_rendered_audit(self, audit: dict) -> Path:
        path = self.root / "simulated-rendered-audit.json"
        path.write_text(json.dumps(audit), encoding="utf-8")
        return path

    def record_layout_measurement(self, identifier: str, unmeasured: list[dict] | dict) -> None:
        figure = next(item for item in self.manifest["figures"] if item["id"] == identifier)
        count = 1 if isinstance(unmeasured, dict) else len(unmeasured)
        figure["text_objects"] = {
            "role": "title", "string": figure["title"], "bounds": [0.2, 0.8, 0.6, 0.1],
            "bounds_units": "normalized", "clipped": False,
        }
        figure["axes_objects"] = {"bounds": [0.1, 0.1, 0.8, 0.7], "bounds_units": "normalized"}
        figure["unmeasured_text_objects"] = unmeasured
        figure["rendering_evidence"] = {
            "bounds_audited": True, "bounds_audit_scope": "measured_objects_only",
            "bounds_audit_complete": count == 0, "unmeasured_count": count,
            "clipped_count": 0, "text_overlap_count": 0,
            "font_selection_verified": True, "visual_inspection_verified": False,
            "cjk_font_evidence": {"candidate_verified": True, "glyph_rendering_verified": False},
        }
        figure["publication"] = {"layout": {"stable": count == 0}}

    def record_plot_data_evidence(self, identifier: str) -> dict:
        figure = next(item for item in self.manifest["figures"] if item["id"] == identifier)
        path = ocean_report.DEFAULT_FIXTURE_DIRECTORY / ocean_report.EXPECTED_FIXTURES[identifier]
        fixture = json.loads(path.read_bytes())
        variable_name = "temperature" if identifier == "crossed-time-depth-temperature" else "salinity"
        variable = fixture["variables"][variable_name]
        uncertainty = fixture["variables"][variable_name + "_standard_uncertainty"]
        declaration = {
            "schema_version": 1, "figure_id": identifier, "fixture_id": identifier,
            "fixture_sha256": sha256(path), "matlab_release": self.release,
            "dimension_order": ["depth", "time"],
            "shape": [len(variable["values"]), len(variable["values"][0])],
            "time_utc": fixture["coordinates"]["time"]["values"],
            "depth_m": fixture["coordinates"]["depth"]["values"], "depth_unit": "m",
            "quantity_unit": variable["unit"], "missing_policy": "preserve",
            "native_data_source": "Image.CData" if variable_name == "temperature" else "Lines.XData",
            "native_values": variable["values"],
            "missing_mask": [[value is None for value in row] for row in variable["values"]],
            "input_match_asserted": True,
            "qc": {"provided": True, "policy": "preserve", "flags": fixture["variables"]["qc"]["values"]},
            "uncertainty": {"present": True, "type": uncertainty["type"], "unit": uncertainty["unit"],
                            "display": "metadata", "values": uncertainty["values"]},
        }
        figure["scientific_data_contract"]["plot_data_evidence"] = declaration
        return declaration

    def record_interactive_plot_data_evidence(self) -> dict:
        identifier = "paired-interactive"
        fixture_id = "crossed-time-depth-temperature"
        source_file = ocean_report.EXPECTED_FIXTURES[fixture_id]
        path = self.root / "fixture-inputs" / source_file
        if not path.is_file():
            path = ocean_report.DEFAULT_FIXTURE_DIRECTORY / source_file
        fixture = json.loads(path.read_bytes())
        row_index = 2
        variable = fixture["variables"]["temperature"]
        uncertainty = fixture["variables"]["temperature_standard_uncertainty"]
        values = list(variable["values"][row_index])
        magnitudes = list(uncertainty["values"][row_index])
        times = list(fixture["coordinates"]["time"]["values"])
        declaration = {
            "schema_version": 2, "figure_id": identifier, "fixture_id": fixture_id,
            "fixture_sha256": sha256(path), "matlab_release": self.release,
            "dimension_order": ["time"], "shape": [len(values)],
            "selection": {"kind": "depth_row", "index_zero_based": row_index,
                          "depth_m": fixture["coordinates"]["depth"]["values"][row_index]},
            "time_utc": times, "time_zone": fixture["coordinates"]["time"]["timezone"],
            "quantity_unit": variable["unit"], "missing_policy": variable["missing_policy"],
            "native_data_source": (
                "Lines(1).XData/YData;"
                "UncertaintyHandles(1).XData/YData/YNegativeDelta/YPositiveDelta"
            ),
            "native_values": values, "missing_mask": [value is None for value in values],
            "observation_ids": [f"temp-050m-{index + 1:03d}" for index in range(len(values))],
            "source_rows": list(range(1, len(values) + 1)), "source_row_origin": "call_entry_order",
            "input_match_asserted": True,
            "qc": {"provided": True, "policy": fixture["variables"]["qc"]["policy"],
                   "flags": list(fixture["variables"]["qc"]["values"][row_index])},
            "uncertainty": {
                "present": True,
                "type": {"standard_uncertainty": "standard-uncertainty"}[uncertainty["type"]],
                "unit": uncertainty["unit"], "representation": "magnitude",
                "confidence_level": None, "display": "errorbar", "values": magnitudes,
                "missing_mask": [value is None for value in magnitudes],
                "joint_valid_mask": [value is not None and magnitude is not None
                                     for value, magnitude in zip(values, magnitudes)],
                "errorbar": {"time_utc": list(times), "values": list(values),
                             "negative_delta": list(magnitudes), "positive_delta": list(magnitudes)},
            },
        }
        figure = next(item for item in self.manifest["figures"] if item["id"] == identifier)
        figure["scientific_data_contract"]["plot_data_evidence"] = declaration
        return declaration

    @staticmethod
    def synthetic_comparison_stats(observations: list, models: list) -> dict:
        count = len(observations)
        residuals = [model - observation for observation, model in zip(observations, models)]
        observation_mean = sum(observations) / count
        model_mean = sum(models) / count
        centered_observations = [value - observation_mean for value in observations]
        centered_models = [value - model_mean for value in models]
        scale = math.sqrt(sum(value * value for value in centered_observations)) * math.sqrt(
            sum(value * value for value in centered_models)
        )
        correlation = (sum(left * right for left, right in zip(centered_observations, centered_models)) / scale
                       if count >= 2 and scale else None)
        return {
            "paired_count": count,
            "bias_model_minus_observation": sum(residuals) / count,
            "mean_absolute_error": sum(abs(value) for value in residuals) / count,
            "root_mean_square_error": math.sqrt(sum(value * value for value in residuals) / count),
            "pearson_correlation": correlation,
        }

    def record_synthetic_comparison_plot_data_evidence(
        self, fixture_directory: Path = ocean_report.DEFAULT_FIXTURE_DIRECTORY,
    ) -> dict:
        """Build a fixture-derived unit declaration, NOT actual MATLAB/native execution evidence."""
        identifier = "paired-observation-model"
        filename = ocean_report.EXPECTED_FIXTURES[identifier]
        path = self.root / "fixture-inputs" / filename
        if not path.is_file():
            path = fixture_directory / filename
        fixture = json.loads(path.read_bytes())
        records = fixture["records"]
        contract = fixture["contract"]
        observations = [record["observation_degC"] for record in records]
        models = [record["model_degC"] for record in records]
        magnitudes = [record["uncertainty_degC"] for record in records]
        flags = [record["qc"] for record in records]
        accepted_values = ["good", "suspect"]
        accepted_mask = [flag in accepted_values for flag in flags]
        finite_mask = [observation is not None and model is not None
                       for observation, model in zip(observations, models)]
        paired_mask = [finite and accepted for finite, accepted in zip(finite_mask, accepted_mask)]
        graphics_mask = [paired and magnitude is not None for paired, magnitude in zip(paired_mask, magnitudes)]
        selected = [index for index, paired in enumerate(paired_mask) if paired]
        scatter = {
            "source_rows": [index + 1 for index in selected],
            "record_ids": [records[index]["id"] for index in selected],
            "x_values": [observations[index] for index in selected],
            "y_values": [models[index] for index in selected],
        }
        declaration = {
            "schema_version": 3, "figure_id": identifier, "fixture_id": identifier,
            "fixture_sha256": sha256(path), "matlab_release": self.release,
            "dimension_order": ["observation"], "shape": [len(records)],
            "quantity_unit": contract["observation_unit"], "missing_policy": contract["missing_policy"],
            "records": {
                "ids": [record["id"] for record in records], "time_utc": [record["time"] for record in records],
                "time_zone": contract["time_zone"], "depth_m": [record["depth_m"] for record in records],
                "depth_unit": "m", "depth_direction": contract["depth_direction"],
                "source_rows": list(range(1, len(records) + 1)), "source_row_origin": "call_entry_order",
            },
            "input_values": {"observation": observations, "model": models},
            "pairing": {
                "rule": "row-aligned", "observation_indices": list(range(1, len(records) + 1)),
                "model_indices": list(range(1, len(records) + 1)), "finite_pair_mask": finite_mask,
                "paired_mask": paired_mask, "unmatched_observation_count": 0, "unmatched_model_count": 0,
                "duplicate_key_policy": "reject",
            },
            "qc": {"policy": contract["qc_policy"],
                   "observation": {"status": "provided", "flags": flags, "accepted_values": accepted_values},
                   "model": {"status": "not_provided"}, "accepted_mask": accepted_mask},
            "native_data_source": "Scatter.XData/YData", "native_scatter": scatter,
            "uncertainty": {
                "type": {"standard_uncertainty": "standard-uncertainty"}[contract["uncertainty_type"]],
                "unit": contract["uncertainty_unit"], "representation": "magnitude", "confidence_level": None,
                "display": "horizontal-line-segments",
                "observation": {"status": "provided", "values": magnitudes,
                                "missing_mask": [value is None for value in magnitudes]},
                "model": {"status": "not_provided"}, "graphics_mask": graphics_mask,
                "native_data_source": "UncertaintyGraphics.XData/YData",
                "segments": [{"source_row": index + 1, "record_id": records[index]["id"],
                              "x_values": [observations[index] - magnitudes[index], observations[index] + magnitudes[index]],
                              "y_values": [models[index], models[index]]}
                             for index, drawn in enumerate(graphics_mask) if drawn],
            },
            "paired_stats": self.synthetic_comparison_stats(scatter["x_values"], scatter["y_values"]),
        }
        figure = next(item for item in self.manifest["figures"] if item["id"] == identifier)
        figure["scientific_data_contract"]["plot_data_evidence"] = declaration
        return declaration


class OceanReportTests(unittest.TestCase):
    def fixture_payload(self, identifier: str) -> dict[str, object]:
        path = ocean_report.DEFAULT_FIXTURE_DIRECTORY / ocean_report.EXPECTED_FIXTURES[identifier]
        return json.loads(path.read_bytes())

    def unmeasured_layout_text(self, role: str = "layout.title", text: str = "合成基准总标题") -> dict:
        return {
            "role": role, "string": text, "font_name": "Noto Sans CJK SC", "font_size": 12,
            "class": "matlab.graphics.layout.Text", "geometry_status": "unverified",
        }

    def assert_interactive_evidence_rejected(self, mutate, bound: bool = False) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            if bound:
                bundle.capture_input_fixtures()
            declaration = bundle.record_interactive_plot_data_evidence()
            bundle.write_metadata()
            _, contexts = ocean_report.load_fixture_statistics(ocean_report.DEFAULT_FIXTURE_DIRECTORY)
            baseline = ocean_report.validate_runtime_bundle(root, contexts)
            figure = next(item for item in baseline["figures"] if item["id"] == "paired-interactive")
            proof = figure["plot_data_evidence"]
            self.assertEqual(proof["status"], "runtime_declaration_verified" if bound else "not_verified")
            self.assertTrue(proof["local_arrays_match"])
            self.assertEqual(proof["declaration"], declaration)
            mutate(declaration)
            bundle.write_metadata()
            with self.assertRaises(ocean_report.ReportBuildError):
                ocean_report.build_ocean_report(root)
            self.assertFalse((root / "report.md").exists())
            self.assertFalse((root / "report-evidence.json").exists())

    def assert_interactive_field_rejected(self, path: tuple, value, bound: bool = False) -> None:
        def mutate(declaration):
            target = declaration
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value
        self.assert_interactive_evidence_rejected(mutate, bound)

    def test_reports_each_figures_layout_coverage_without_visual_promotion(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            bundle.capture_input_fixtures()
            single = self.unmeasured_layout_text()
            multiple = [self.unmeasured_layout_text(), self.unmeasured_layout_text("layout.xlabel", "时间 UTC")]
            bundle.record_layout_measurement("crossed-time-depth-temperature", [])
            bundle.record_layout_measurement("paired-interactive", single)
            bundle.record_layout_measurement("paired-observation-model", multiple)
            bundle.write_metadata()

            ocean_report.build_ocean_report(root)

            evidence = json.loads((root / "report-evidence.json").read_bytes())
            figures = {figure["id"]: figure for figure in evidence["runtime_evidence"]["figures"]}
            self.assertEqual(evidence["runtime_fixture_binding"]["status"], "verified")
            complete = figures["crossed-time-depth-temperature"]["layout_measurement"]
            self.assertEqual(complete["status"], "available")
            self.assertTrue(complete["bounds_audit_complete"])
            self.assertEqual(complete["unmeasured_count"], 0)
            self.assertEqual(complete["unmeasured_text_objects"], [])
            self.assertEqual(complete["measured_text_count"], 1)
            self.assertEqual(complete["measured_axes_count"], 1)
            for identifier, expected in (("paired-interactive", [single]), ("paired-observation-model", multiple)):
                coverage = figures[identifier]["layout_measurement"]
                self.assertEqual(coverage["bounds_audit_scope"], "measured_objects_only")
                self.assertFalse(coverage["bounds_audit_complete"])
                self.assertFalse(coverage["layout_stable_declared"])
                self.assertEqual(coverage["unmeasured_count"], len(expected))
                self.assertEqual(coverage["unmeasured_text_objects"], expected)
                self.assertNotIn("bounds", coverage["unmeasured_text_objects"][0])
            missing = figures["repeat-cast-salinity-profiles"]["layout_measurement"]
            self.assertEqual(missing["status"], "not_available")
            self.assertIsNone(missing["unmeasured_count"])
            self.assertIsNone(missing["unmeasured_text_objects"])
            for figure in figures.values():
                self.assertEqual(figure["verification"], {
                    "file_hashes_and_dimensions": "passed", "visual_inspection": "not_verified",
                    "glyph_rendering": "not_verified", "layout_visual": "not_verified",
                })
                self.assertEqual(figure["scientific_data"]["qc"]["plot_filtering"], "not_verified")
            report = (root / "report.md").read_text(encoding="utf-8")
            table = report.split("### 布局测量覆盖")[1].split("### 原生图元数据核对")[0]
            self.assertEqual(report.count("### 布局测量覆盖"), 1)
            for identifier in figures:
                self.assertEqual(table.count(f"`{identifier}`"), 1)
            self.assertIn("仅已测对象；清单完整；未测 0", table)
            self.assertIn("仅已测对象；清单不完整；未测 1", table)
            self.assertIn("仅已测对象；清单不完整；未测 2", table)
            self.assertIn("layout.title: 合成基准总标题", table)
            self.assertIn("layout.xlabel: 时间 UTC", table)
            self.assertIn("未提供（not_available）", table)
            self.assertIn("无公开 Extent", table)
            self.assertIn("均不等于视觉、字形或布局外观通过", table)
            self.assertIn("数据来源=合成基准非实测海况", report)

    def test_native_legend_title_remains_unmeasured_in_report(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            record = self.unmeasured_layout_text("legend.title", "观测标准不确定度 | synthetic")
            record["class"] = "matlab.graphics.illustration.legend.Text"
            bundle.record_layout_measurement("paired-observation-model", record)
            bundle.write_metadata()
            ocean_report.build_ocean_report(root)
            evidence = json.loads((root / "report-evidence.json").read_bytes())
            figure = next(item for item in evidence["runtime_evidence"]["figures"]
                          if item["id"] == "paired-observation-model")
            coverage = figure["layout_measurement"]
            self.assertEqual(coverage["unmeasured_text_objects"], [record])
            self.assertEqual(coverage["unmeasured_count"], 1)
            self.assertFalse(coverage["bounds_audit_complete"])
            self.assertFalse(coverage["layout_stable_declared"])
            self.assertEqual(figure["verification"]["layout_visual"], "not_verified")
            report = (root / "report.md").read_text(encoding="utf-8")
            self.assertIn("legend.title: 观测标准不确定度 \\| synthetic", report)

    def test_unmeasured_legend_identity_is_not_a_general_text_exemption(self) -> None:
        for role, class_name in (
            ("legend.title", "matlab.graphics.layout.Text"),
            ("layout.title", "matlab.graphics.illustration.legend.Text"),
            ("legend.subtitle", "matlab.graphics.illustration.legend.Text"),
            ("legend.title", "matlab.graphics.primitive.Text"),
        ):
            with self.subTest(role=role, class_name=class_name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                record = self.unmeasured_layout_text(role)
                record["class"] = class_name
                bundle.record_layout_measurement("paired-observation-model", record)
                bundle.write_metadata()
                with self.assertRaises(ocean_report.ReportBuildError):
                    ocean_report.build_ocean_report(root)

    def test_legacy_layout_flags_do_not_supply_missing_measurement_coverage(self) -> None:
        for flags in ({}, {"bounds_audited": True}):
            with self.subTest(flags=flags), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                for figure in bundle.manifest["figures"]:
                    figure["rendering_evidence"] = flags
                    figure["publication"] = {"layout": {"stable": True}}
                bundle.write_metadata()
                ocean_report.build_ocean_report(root)
                evidence = json.loads((root / "report-evidence.json").read_bytes())
                self.assertEqual(evidence["runtime_fixture_binding"]["status"], "unverified")
                for figure in evidence["runtime_evidence"]["figures"]:
                    coverage = figure["layout_measurement"]
                    self.assertEqual(coverage["status"], "not_available")
                    self.assertEqual(coverage["bounds_audit_scope"], "not_available")
                    for field in ("bounds_audit_complete", "unmeasured_count", "unmeasured_text_objects"):
                        self.assertIsNone(coverage[field])
                    self.assertEqual(figure["verification"]["layout_visual"], "not_verified")
                report = (root / "report.md").read_text(encoding="utf-8")
                self.assertEqual(report.count("未提供（not_available）"), 4)
                self.assertNotIn("无未测记录", report)

    def test_incomplete_new_layout_field_groups_fail_without_outputs(self) -> None:
        for field in ("unmeasured_text_objects", "bounds_audit_scope", "bounds_audit_complete", "unmeasured_count"):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                bundle.record_layout_measurement("paired-interactive", self.unmeasured_layout_text())
                figure = next(item for item in bundle.manifest["figures"] if item["id"] == "paired-interactive")
                if field == "unmeasured_text_objects":
                    del figure[field]
                else:
                    del figure["rendering_evidence"][field]
                bundle.write_metadata()
                with self.assertRaisesRegex(ocean_report.ReportBuildError, "layout measurement fields are incomplete"):
                    ocean_report.build_ocean_report(root)
                self.assertFalse((root / "report.md").exists())
                self.assertFalse((root / "report-evidence.json").exists())

    def test_layout_completeness_count_and_stable_contradictions_fail(self) -> None:
        changes = (
            lambda figure: figure["rendering_evidence"].update(bounds_audit_complete=True),
            lambda figure: figure["rendering_evidence"].update(unmeasured_count=0),
            lambda figure: figure["rendering_evidence"].update(unmeasured_count=2),
            lambda figure: figure.update(unmeasured_text_objects=[]),
            lambda figure: figure["publication"]["layout"].update(stable=True),
            lambda figure: figure["rendering_evidence"].update(bounds_audited=False),
        )
        for index, change in enumerate(changes):
            with self.subTest(change=index), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                bundle.record_layout_measurement("paired-interactive", self.unmeasured_layout_text())
                figure = next(item for item in bundle.manifest["figures"] if item["id"] == "paired-interactive")
                change(figure)
                bundle.write_metadata()
                with self.assertRaises(ocean_report.ReportBuildError):
                    ocean_report.build_ocean_report(root)
                self.assertFalse((root / "report.md").exists())
                self.assertFalse((root / "report-evidence.json").exists())

    def test_layout_flags_counts_and_container_shapes_are_strict(self) -> None:
        changes = [
            lambda figure: figure.update(rendering_evidence=[]),
            lambda figure: figure.update(publication=[]),
            lambda figure: figure["publication"].update(layout=[]),
            lambda figure: figure["publication"]["layout"].update(stable="false"),
            lambda figure: figure.update(text_objects=[[]]),
            lambda figure: figure.update(axes_objects="axes"),
        ]
        for field, invalid in (
            ("bounds_audit_scope", "whole_canvas"), ("bounds_audit_scope", ["measured_objects_only"]),
            ("bounds_audit_complete", 1), ("bounds_audit_complete", "false"),
            ("bounds_audited", 1), ("unmeasured_count", -1), ("unmeasured_count", True),
            ("unmeasured_count", 1.0), ("unmeasured_count", "1"), ("unmeasured_count", None),
            ("clipped_count", -1), ("text_overlap_count", True),
        ):
            changes.append(lambda figure, field=field, invalid=invalid: figure["rendering_evidence"].update({field: invalid}))
        for index, change in enumerate(changes):
            with self.subTest(change=index), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                bundle.record_layout_measurement("paired-interactive", self.unmeasured_layout_text())
                figure = next(item for item in bundle.manifest["figures"] if item["id"] == "paired-interactive")
                change(figure)
                bundle.write_metadata()
                with self.assertRaises(ocean_report.ReportBuildError):
                    ocean_report.build_ocean_report(root)

    def test_unmeasured_text_rejects_fake_geometry_and_invalid_identity(self) -> None:
        mutations = (
            ("geometry_status", "verified"), ("bounds", [0, 0, 1, 1]), ("geometry_verified", True),
            ("class", "matlab.graphics.primitive.Text"), ("role", "title"),
            ("string", " "), ("string", ["title"]), ("font_name", None),
            ("font_size", 0), ("font_size", -1), ("font_size", True), ("font_size", "12"),
        )
        for field, value in mutations:
            with self.subTest(field=field, value=value), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                record = self.unmeasured_layout_text()
                record[field] = value
                bundle.record_layout_measurement("paired-interactive", record)
                bundle.write_metadata()
                with self.assertRaises(ocean_report.ReportBuildError):
                    ocean_report.build_ocean_report(root)
                self.assertFalse((root / "report.md").exists())

    def test_unmeasured_text_list_must_be_flat_and_complete(self) -> None:
        missing_font = self.unmeasured_layout_text()
        del missing_font["font_name"]
        for invalid in (None, {}, "title", [None], [[]], [[self.unmeasured_layout_text()]], missing_font):
            with self.subTest(invalid=invalid), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                bundle.record_layout_measurement("paired-interactive", self.unmeasured_layout_text())
                figure = next(item for item in bundle.manifest["figures"] if item["id"] == "paired-interactive")
                figure["unmeasured_text_objects"] = invalid
                bundle.write_metadata()
                with self.assertRaises(ocean_report.ReportBuildError):
                    ocean_report.build_ocean_report(root)

    def test_unmeasured_titles_cannot_break_markdown_table(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            title = "合成 | 标题\n[visual passed](fake) <b>字形</b>"
            bundle.record_layout_measurement("paired-interactive", self.unmeasured_layout_text(text=title))
            bundle.write_metadata()
            ocean_report.build_ocean_report(root)
            evidence = json.loads((root / "report-evidence.json").read_bytes())
            figure = next(item for item in evidence["runtime_evidence"]["figures"] if item["id"] == "paired-interactive")
            self.assertEqual(figure["layout_measurement"]["unmeasured_text_objects"][0]["string"], title)
            report = (root / "report.md").read_text(encoding="utf-8")
            self.assertIn("合成 \\| 标题 \\[visual passed\\](fake) &lt;b&gt;字形&lt;/b&gt;", report)
            self.assertNotIn("[visual passed](fake)", report)
            self.assertEqual(figure["verification"]["visual_inspection"], "not_verified")

    def test_fixture_statistics_match_known_values_and_sampling_scope(self) -> None:
        fixtures, contexts = ocean_report.load_fixture_statistics(ocean_report.DEFAULT_FIXTURE_DIRECTORY)
        by_id = {item["id"]: item for item in fixtures}
        temperature = by_id["crossed-time-depth-temperature"]
        salinity = by_id["repeat-cast-salinity-profiles"]
        paired = by_id["paired-observation-model"]
        self.assertAlmostEqual(temperature["statistics"]["mean"], 359.794 / 23)
        self.assertEqual(temperature["qc"], {"good": 22, "suspect": 1, "missing": 1})
        self.assertEqual(temperature["missing_indices_depth_time"], [[2, 2]])
        self.assertEqual(salinity["qc"], {"good": 16, "suspect": 1, "missing": 1})
        self.assertAlmostEqual(salinity["statistics"]["mean"], 566.81 / 17)
        self.assertAlmostEqual(paired["statistics"]["bias_model_minus_observation"], 0.96 / 11)
        self.assertAlmostEqual(paired["statistics"]["mean_absolute_error"], 1.02 / 11)
        self.assertAlmostEqual(paired["statistics"]["root_mean_square_error"], math.sqrt(0.137 / 11))
        self.assertAlmostEqual(paired["statistics"]["pearson_correlation"], 0.9996003539344701)
        self.assertEqual(paired["statistics"]["within_standard_uncertainty_count"], 8)
        self.assertEqual(paired["pairing"]["missing_ids"], ["pair-012"])
        self.assertIn("pair-006", paired["pairing"]["valid_ids"])
        self.assertEqual(paired["pairing"]["model_missing_ids"], [])
        interactive = contexts["paired-interactive"]
        self.assertEqual(interactive["fixture_id"], temperature["id"])
        self.assertEqual(interactive["selection"], {"kind": "depth_row", "index_zero_based": 2, "depth_m": 50})
        self.assertAlmostEqual(interactive["statistics"]["mean"], 14.6288)
        self.assertEqual(interactive["qc"], {"good": 4, "suspect": 1, "missing": 1})
        self.assertEqual(interactive["missing_time_indices"], [2])
        self.assertEqual(interactive["observation_ids"][2], "temp-050m-003")

    def test_native_grid_evidence_binds_full_arrays_without_visual_promotion(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            bundle.capture_input_fixtures()
            declarations = {identifier: bundle.record_plot_data_evidence(identifier) for identifier in ocean_report.GRID_NATIVE_SOURCES}
            bundle.write_metadata()
            ocean_report.build_ocean_report(root)
            evidence = json.loads((root / "report-evidence.json").read_bytes())
            for figure in evidence["runtime_evidence"]["figures"]:
                proof = figure["plot_data_evidence"]
                if figure["id"] in declarations:
                    self.assertEqual(proof["status"], "runtime_declaration_verified")
                    self.assertTrue(proof["local_arrays_match"])
                    self.assertTrue(proof["input_fixture_binding_verified"])
                    self.assertEqual(proof["declaration"], declarations[figure["id"]])
                    self.assertEqual(figure["scientific_data"]["qc"]["plot_filtering"], "preserve")
                    self.assertEqual(figure["scientific_data"]["uncertainty"]["plot_display"], "metadata")
                    self.assertEqual(proof["declaration"]["uncertainty"]["type"], "standard_uncertainty")
                    self.assertIn("suspect", [flag for row in proof["declaration"]["qc"]["flags"] for flag in row])
                else:
                    self.assertEqual(proof["status"], "not_verified")
                    self.assertFalse(proof["provided"])
                    self.assertEqual(figure["scientific_data"]["qc"]["plot_filtering"], "not_verified")
                    self.assertEqual(figure["scientific_data"]["uncertainty"]["plot_display"], "not_verified")
                self.assertEqual(figure["verification"]["visual_inspection"], "not_verified")
                self.assertEqual(figure["verification"]["layout_visual"], "not_verified")
            report = (root / "report.md").read_text(encoding="utf-8")
            table = report.split("### 原生图元数据核对")[1].split("## 8.")[0]
            for identifier in ocean_report.EXPECTED_FIGURES:
                self.assertEqual(table.count(f"`{identifier}`"), 1)
            self.assertIn("Image.CData | runtime_declaration_verified", table)
            self.assertIn("Lines.XData | runtime_declaration_verified", table)
            self.assertEqual(table.count("not_verified（未提供）"), 2)
            self.assertIn("preserve，保留 suspect", table)
            self.assertIn("standard_uncertainty / g kg-1 / metadata", table)
            self.assertIn("不是视觉验证或独立重执行", table)
            self.assertNotIn("当前 gate 的温度场、盐度剖面和配对图调用未传", report)

    def test_interactive_v2_bound_arrays_verify_three_of_four_figures_with_v1_unchanged(self) -> None:
        for release in ("R2021a", "R2024b", "R2026a"):
            with self.subTest(release=release), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                bundle.release = release
                bundle.runtime["matlab_release"] = release
                bundle.runtime["matlab_version"] = {"R2021a": "9.10.0", "R2024b": "24.2.0", "R2026a": "26.1.0"}[release]
                bundle.manifest["matlab_release"] = release[1:]
                for figure in bundle.manifest["figures"]:
                    figure["runtime"]["matlab_release"] = release[1:]
                bundle.capture_input_fixtures()
                declarations = {identifier: bundle.record_plot_data_evidence(identifier)
                                for identifier in ocean_report.GRID_NATIVE_SOURCES}
                interactive = bundle.record_interactive_plot_data_evidence()
                declarations["paired-interactive"] = interactive
                bundle.write_metadata()
                before = (root / "figures.json").read_bytes()
                ocean_report.build_ocean_report(root)
                evidence = json.loads((root / "report-evidence.json").read_bytes())
                self.assertEqual((root / "figures.json").read_bytes(), before)
                self.assertEqual(evidence["runtime_fixture_binding"]["status"], "verified")
                self.assertEqual(evidence["runtime_fixture_binding"]["fixture_count"], 3)
                figures = {item["id"]: item for item in evidence["runtime_evidence"]["figures"]}
                verified = {identifier for identifier, figure in figures.items()
                            if figure["plot_data_evidence"]["status"] == "runtime_declaration_verified"}
                self.assertEqual(verified, set(declarations))
                self.assertEqual(len(verified), 3)
                for identifier, declaration in declarations.items():
                    figure = figures[identifier]
                    proof = figure["plot_data_evidence"]
                    self.assertEqual(proof["declaration"], declaration)
                    self.assertTrue(proof["local_arrays_match"])
                    self.assertTrue(proof["input_fixture_binding_verified"])
                    self.assertEqual(figure["scientific_data"]["qc"]["plot_filtering"], "preserve")
                    self.assertEqual(figure["scientific_data"]["uncertainty"]["plot_display"],
                                     "errorbar" if identifier == "paired-interactive" else "metadata")
                    self.assertEqual(declaration["schema_version"], 2 if identifier == "paired-interactive" else 1)
                paired = figures["paired-observation-model"]
                self.assertEqual(paired["plot_data_evidence"]["status"], "not_verified")
                self.assertFalse(paired["plot_data_evidence"]["provided"])
                self.assertEqual(paired["scientific_data"]["qc"]["plot_filtering"], "not_verified")
                self.assertEqual(paired["scientific_data"]["uncertainty"]["plot_display"], "not_verified")
                selected = figures["paired-interactive"]
                self.assertEqual(selected["scientific_data"]["raw_count"], 6)
                self.assertEqual(selected["scientific_data"]["valid_count"], 5)
                self.assertEqual(selected["scientific_data"]["missing_count"], 1)
                self.assertEqual(selected["scientific_context"]["qc"], {"good": 4, "suspect": 1, "missing": 1})
                self.assertEqual(interactive["shape"], [6])
                self.assertEqual(interactive["dimension_order"], ["time"])
                self.assertEqual(interactive["native_values"], [14.75, 15.356, None, 14.75, 14.144, 14.144])
                self.assertEqual(interactive["missing_mask"], [False, False, True, False, False, False])
                self.assertEqual(interactive["source_rows"], [1, 2, 3, 4, 5, 6])
                self.assertEqual(interactive["observation_ids"][4], "temp-050m-005")
                self.assertEqual(interactive["qc"]["flags"][4], "suspect")
                self.assertEqual(interactive["uncertainty"]["values"], [0.11, 0.11, None, 0.11, 0.11, 0.11])
                self.assertEqual(interactive["uncertainty"]["joint_valid_mask"], [True, True, False, True, True, True])
                self.assertEqual(interactive["uncertainty"]["errorbar"]["values"], interactive["native_values"])
                self.assertEqual(interactive["fixture_sha256"], sha256(root / "fixture-inputs" / "crossed_time_depth_temperature.json"))
                for figure in figures.values():
                    self.assertEqual(figure["verification"]["visual_inspection"], "not_verified")
                    self.assertEqual(figure["verification"]["layout_visual"], "not_verified")
                self.assertFalse(evidence["runtime_evidence"]["visual_inspection"]["verified"])
                self.assertFalse(evidence["data_source"]["observed_ocean_conditions"])
                report = (root / "report.md").read_text(encoding="utf-8")
                table = report.split("### 原生图元数据核对")[1].split("## 8.")[0]
                self.assertIn("standard-uncertainty / degC / errorbar", table)
                self.assertIn("standard_uncertainty / g kg-1 / metadata", table)
                self.assertEqual(table.count("not_verified（未提供）"), 1)

    def test_interactive_v2_without_input_binding_does_not_promote_matching_arrays(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            declaration = bundle.record_interactive_plot_data_evidence()
            bundle.write_metadata()
            ocean_report.build_ocean_report(root)
            evidence = json.loads((root / "report-evidence.json").read_bytes())
            figure = next(item for item in evidence["runtime_evidence"]["figures"] if item["id"] == "paired-interactive")
            proof = figure["plot_data_evidence"]
            self.assertEqual(evidence["runtime_fixture_binding"]["status"], "unverified")
            self.assertEqual(proof["status"], "not_verified")
            self.assertTrue(proof["local_arrays_match"])
            self.assertFalse(proof["input_fixture_binding_verified"])
            self.assertEqual(proof["declaration"], declaration)
            self.assertEqual(figure["scientific_data"]["qc"]["plot_filtering"], "not_verified")
            self.assertEqual(figure["scientific_data"]["uncertainty"]["plot_display"], "not_verified")

    def test_interactive_missing_declaration_keeps_legacy_status_with_or_without_binding(self) -> None:
        for bound in (False, True):
            with self.subTest(bound=bound), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                if bound:
                    bundle.capture_input_fixtures()
                ocean_report.build_ocean_report(root)
                evidence = json.loads((root / "report-evidence.json").read_bytes())
                figure = next(item for item in evidence["runtime_evidence"]["figures"] if item["id"] == "paired-interactive")
                self.assertEqual(figure["plot_data_evidence"]["status"], "not_verified")
                self.assertFalse(figure["plot_data_evidence"]["provided"])
                self.assertIsNone(figure["plot_data_evidence"]["declaration"])
                self.assertEqual(figure["scientific_data"]["uncertainty"]["plot_display"], "not_verified")

    def test_interactive_v2_identity_source_version_hash_and_release_are_strict(self) -> None:
        mutations = (
            (("schema_version",), 1), (("schema_version",), 3), (("schema_version",), True),
            (("schema_version",), 2.0), (("schema_version",), "2"),
            (("figure_id",), "paired-observation-model"), (("fixture_id",), "paired-interactive"),
            (("fixture_sha256",), "0" * 64), (("fixture_sha256",), None),
            (("matlab_release",), "R2024b"), (("matlab_release",), "R26.1.0 (R2026a)"),
            (("native_data_source",), "Lines(1).YData"),
            (("native_data_source",), "fixture.variables.temperature.values"),
            (("source_row_origin",), "fixture_flattened_order"),
            (("quantity_unit",), "K"), (("missing_policy",), "fill_zero"),
        )
        for path, value in mutations:
            with self.subTest(path=path, value=value):
                self.assert_interactive_field_rejected(path, value)

    def test_interactive_v2_shape_and_dimension_vectors_cannot_use_scalar_or_nested_forms(self) -> None:
        for shape in (6, 6.0, "6", [6.0], [True], ["6"], [1, 6], [[6]], [5], [7], []):
            with self.subTest(shape=shape):
                self.assert_interactive_field_rejected(("shape",), shape)
        for order in ("time", ["observation"], ["time", "depth"], [["time"]], []):
            with self.subTest(order=order):
                self.assert_interactive_field_rejected(("dimension_order",), order)

    def test_interactive_v2_selection_must_be_the_third_depth_row(self) -> None:
        for field, value in (("kind", "whole_fixture"), ("kind", "time_column"),
                             ("index_zero_based", 1), ("index_zero_based", 3),
                             ("index_zero_based", 2.0), ("index_zero_based", True),
                             ("index_zero_based", "2"), ("depth_m", 25),
                             ("depth_m", 0.05), ("depth_m", "50"), ("depth_m", True)):
            with self.subTest(field=field, value=value):
                self.assert_interactive_field_rejected(("selection", field), value)

    def test_interactive_v2_consistent_wrong_row_arrays_cannot_rely_on_correct_selection_claim(self) -> None:
        fixture = self.fixture_payload("crossed-time-depth-temperature")
        for row_index in (0, 1, 3):
            with self.subTest(row_index=row_index):
                def mutate(declaration):
                    values = list(fixture["variables"]["temperature"]["values"][row_index])
                    magnitudes = list(fixture["variables"]["temperature_standard_uncertainty"]["values"][row_index])
                    declaration["native_values"] = values
                    declaration["missing_mask"] = [value is None for value in values]
                    declaration["qc"]["flags"] = list(fixture["variables"]["qc"]["values"][row_index])
                    uncertainty = declaration["uncertainty"]
                    uncertainty["values"] = magnitudes
                    uncertainty["missing_mask"] = [value is None for value in magnitudes]
                    uncertainty["joint_valid_mask"] = [value is not None and magnitude is not None
                                                       for value, magnitude in zip(values, magnitudes)]
                    uncertainty["errorbar"].update(values=list(values), negative_delta=list(magnitudes),
                                                  positive_delta=list(magnitudes))
                    self.assertEqual(declaration["selection"], {"kind": "depth_row", "index_zero_based": 2, "depth_m": 50})
                    self.assertIs(declaration["input_match_asserted"], True)
                self.assert_interactive_evidence_rejected(mutate, bound=True)

    def test_interactive_v2_all_sample_vectors_are_flat_complete_and_ordered(self) -> None:
        for path in INTERACTIVE_VECTOR_PATHS:
            for operation in ("scalar", "nested", "short", "long"):
                with self.subTest(path=path, operation=operation):
                    def mutate(declaration):
                        target = declaration
                        for key in path[:-1]:
                            target = target[key]
                        values = target[path[-1]]
                        target[path[-1]] = {
                            "scalar": values[0], "nested": [values],
                            "short": values[:-1], "long": values + values[-1:],
                        }[operation]
                    self.assert_interactive_evidence_rejected(mutate)

    def test_interactive_v2_line_and_errorbar_check_every_time_and_utc(self) -> None:
        for path in (("time_utc",), ("uncertainty", "errorbar", "time_utc")):
            for value in ("2026-08-01T05:00:00Z", "2026-08-01T04:00:00+08:00", None):
                with self.subTest(path=path, value=value):
                    self.assert_interactive_field_rejected((*path, 1), value)
            with self.subTest(path=path, operation="interior_reorder"):
                def mutate(declaration):
                    values = declaration
                    for key in path:
                        values = values[key]
                    values[1], values[3] = values[3], values[1]
                self.assert_interactive_evidence_rejected(mutate)
        self.assert_interactive_field_rejected(("time_zone",), "Asia/Shanghai")

    def test_interactive_v2_source_rows_and_ids_cannot_hide_equal_value_reordering(self) -> None:
        for path, value in (
            (("source_rows",), [0, 1, 2, 3, 4, 5]),
            (("source_rows",), [13, 14, 15, 16, 17, 18]),
            (("source_rows", 0), True), (("source_rows", 0), "1"),
            (("source_rows", 4), 6),
            (("observation_ids", 4), "temp-050m-006"),
            (("observation_ids", 0), "temp-025m-001"),
            (("observation_ids", 0), None),
        ):
            with self.subTest(path=path, value=value):
                self.assert_interactive_field_rejected(path, value)
        for path in (("source_rows",), ("observation_ids",), ("qc", "flags")):
            with self.subTest(path=path, operation="swap_equal_values"):
                def mutate(declaration):
                    self.assertEqual(declaration["native_values"][4], declaration["native_values"][5])
                    values = declaration
                    for key in path:
                        values = values[key]
                    values[4], values[5] = values[5], values[4]
                self.assert_interactive_evidence_rejected(mutate)

    def test_interactive_v2_suspect_cannot_be_dropped_or_relabelled(self) -> None:
        for bound in (False, True):
            for operation in ("drop", "copy_good"):
                with self.subTest(bound=bound, operation=operation):
                    def mutate(declaration):
                        self.assertEqual(declaration["qc"]["flags"][4], "suspect")
                        for path in INTERACTIVE_VECTOR_PATHS:
                            values = declaration
                            for key in path:
                                values = values[key]
                            if operation == "drop":
                                values.pop(4)
                            else:
                                values[4] = values[5]
                        if operation == "drop":
                            declaration["shape"] = [5]
                    self.assert_interactive_evidence_rejected(mutate, bound)
        self.assert_interactive_field_rejected(("qc", "flags", 4), "good")
        self.assert_interactive_field_rejected(("qc", "policy"), "good_only")

    def test_interactive_v2_native_values_uncertainty_and_errorbar_are_exact(self) -> None:
        numeric_paths = (
            ("native_values",), ("uncertainty", "values"),
            ("uncertainty", "errorbar", "values"),
            ("uncertainty", "errorbar", "negative_delta"),
            ("uncertainty", "errorbar", "positive_delta"),
        )
        for bound in (False, True):
            for path in numeric_paths:
                for operation in ("one_ulp", "boolean", "string", "finite_to_null", "missing_to_zero"):
                    with self.subTest(bound=bound, path=path, operation=operation):
                        def mutate(declaration):
                            values = declaration
                            for key in path:
                                values = values[key]
                            if operation == "missing_to_zero":
                                self.assertIsNone(values[2])
                                values[2] = 0
                            else:
                                values[0] = {"one_ulp": math.nextafter(values[0], math.inf),
                                             "boolean": True, "string": str(values[0]),
                                             "finite_to_null": None}[operation]
                        self.assert_interactive_evidence_rejected(mutate, bound)

    def test_interactive_v2_nonstandard_nan_and_infinity_tokens_are_rejected(self) -> None:
        for value in (float("nan"), float("inf"), float("-inf"), "NaN"):
            with self.subTest(value=value):
                self.assert_interactive_field_rejected(("uncertainty", "errorbar", "positive_delta", 2), value)

    def test_interactive_v2_missing_and_joint_masks_require_boolean_values_and_correct_positions(self) -> None:
        for path in (("missing_mask",), ("uncertainty", "missing_mask"), ("uncertainty", "joint_valid_mask")):
            for operation in ("numeric", "string", "null", "invert", "move_missing"):
                with self.subTest(path=path, operation=operation):
                    def mutate(declaration):
                        values = declaration
                        for key in path:
                            values = values[key]
                        if operation == "move_missing":
                            values[1], values[2] = values[2], values[1]
                        else:
                            values[0] = {"numeric": int(values[0]), "string": str(values[0]).lower(),
                                         "null": None, "invert": not values[0]}[operation]
                    self.assert_interactive_evidence_rejected(mutate)

    def test_interactive_v2_assertion_flags_cannot_replace_boolean_true(self) -> None:
        for path in (("input_match_asserted",), ("qc", "provided"), ("uncertainty", "present")):
            for value in (False, 1, "true", None):
                with self.subTest(path=path, value=value):
                    self.assert_interactive_field_rejected(path, value)

    def test_interactive_v2_uncertainty_semantics_and_errorbar_deltas_cannot_be_substituted(self) -> None:
        for field, value in (
            ("type", "standard_uncertainty"), ("type", "standard-deviation"),
            ("type", "confidence-interval"), ("unit", "K"),
            ("representation", "bounds"), ("confidence_level", 0.95),
            ("confidence_level", False), ("display", "metadata"), ("display", "band"),
        ):
            with self.subTest(field=field, value=value):
                self.assert_interactive_field_rejected(("uncertainty", field), value)
        for field in ("negative_delta", "positive_delta"):
            with self.subTest(field=field, operation="signed_or_endpoint_delta"):
                self.assert_interactive_field_rejected(("uncertainty", "errorbar", field, 0), -0.11 if field == "negative_delta" else 14.86)

    def test_interactive_v2_filling_all_missing_arrays_and_masks_cannot_forge_joint_counts(self) -> None:
        def mutate(declaration):
            declaration["native_values"][2] = 0
            declaration["missing_mask"][2] = False
            declaration["qc"]["flags"][2] = "good"
            uncertainty = declaration["uncertainty"]
            uncertainty["values"][2] = 0
            uncertainty["missing_mask"][2] = False
            uncertainty["joint_valid_mask"][2] = True
            for field in ("values", "negative_delta", "positive_delta"):
                uncertainty["errorbar"][field][2] = 0
        self.assert_interactive_evidence_rejected(mutate, bound=True)

    def test_interactive_v2_field_sets_are_exact_at_every_level(self) -> None:
        fields_by_path = {
            (): ("schema_version", "figure_id", "fixture_id", "fixture_sha256", "matlab_release",
                 "dimension_order", "shape", "selection", "time_utc", "time_zone", "quantity_unit",
                 "missing_policy", "native_data_source", "native_values", "missing_mask", "observation_ids",
                 "source_rows", "source_row_origin", "input_match_asserted", "qc", "uncertainty"),
            ("selection",): ("kind", "index_zero_based", "depth_m"),
            ("qc",): ("provided", "policy", "flags"),
            ("uncertainty",): ("present", "type", "unit", "representation", "confidence_level", "display",
                               "values", "missing_mask", "joint_valid_mask", "errorbar"),
            ("uncertainty", "errorbar"): ("time_utc", "values", "negative_delta", "positive_delta"),
        }
        for path, fields in fields_by_path.items():
            for field in (*fields, "stats_verified"):
                with self.subTest(path=path, field=field):
                    def mutate(declaration):
                        target = declaration
                        for key in path:
                            target = target[key]
                        if field == "stats_verified":
                            target[field] = True
                        else:
                            del target[field]
                    self.assert_interactive_evidence_rejected(mutate)

    def test_native_declarations_without_input_snapshots_stay_unverified(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            for identifier in ocean_report.GRID_NATIVE_SOURCES:
                bundle.record_plot_data_evidence(identifier)
            bundle.write_metadata()
            ocean_report.build_ocean_report(root)
            evidence = json.loads((root / "report-evidence.json").read_bytes())
            self.assertEqual(evidence["runtime_fixture_binding"]["status"], "unverified")
            for figure in evidence["runtime_evidence"]["figures"]:
                proof = figure["plot_data_evidence"]
                self.assertEqual(proof["status"], "not_verified")
                self.assertEqual(figure["scientific_data"]["qc"]["plot_filtering"], "not_verified")
                if figure["id"] in ocean_report.GRID_NATIVE_SOURCES:
                    self.assertTrue(proof["local_arrays_match"])
                    self.assertFalse(proof["input_fixture_binding_verified"])
            self.assertEqual((root / "report.md").read_text(encoding="utf-8").count("not_verified（输入字节未绑定）"), 2)

    def test_legacy_presence_and_bound_inputs_cannot_replace_native_arrays(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            bundle.capture_input_fixtures()
            ocean_report.build_ocean_report(root)
            evidence = json.loads((root / "report-evidence.json").read_bytes())
            for figure in evidence["runtime_evidence"]["figures"]:
                self.assertEqual(figure["plot_data_evidence"]["status"], "not_verified")
                self.assertFalse(figure["plot_data_evidence"]["provided"])
                self.assertIsNone(figure["plot_data_evidence"]["declaration"])
            self.assertEqual((root / "report.md").read_text(encoding="utf-8").count("not_verified（未提供）"), 4)

    def test_native_evidence_versions_identity_and_field_set_are_strict(self) -> None:
        mutations = (
            ("schema_version", 2), ("schema_version", True), ("schema_version", 1.0),
            ("figure_id", "other"), ("fixture_id", "paired-observation-model"),
            ("fixture_sha256", "0" * 64), ("native_data_source", "copied_input"),
            ("native_data_source", "Lines.XData"), ("matlab_release", "R2024b"),
            ("matlab_release", "R9.10.0.2198249 (R2021a) Update 8"),
            ("input_match_asserted", False), ("input_match_asserted", 1),
            ("input_match_asserted", "true"), ("unknown_proof", True),
        )
        for field, value in mutations:
            with self.subTest(field=field, value=value), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                bundle.capture_input_fixtures()
                declaration = bundle.record_plot_data_evidence("crossed-time-depth-temperature")
                declaration[field] = value
                bundle.write_metadata()
                with self.assertRaises(ocean_report.ReportBuildError):
                    ocean_report.build_ocean_report(root)
                self.assertFalse((root / "report.md").exists())
                self.assertFalse((root / "report-evidence.json").exists())

    def test_native_evidence_bad_arrays_fail_even_without_input_binding(self) -> None:
        mutations = (
            lambda proof: proof["native_values"][0].__setitem__(0, 19.0),
            lambda proof: proof["native_values"][0].__setitem__(0, True),
            lambda proof: proof["native_values"].pop(),
            lambda proof: proof.update(native_values=[list(column) for column in zip(*proof["native_values"])]),
            lambda proof: proof.update(native_values=[list(reversed(row)) for row in proof["native_values"]]),
            lambda proof: proof["uncertainty"]["values"][0].__setitem__(0, 0.5),
            lambda proof: proof["uncertainty"]["values"][0].__setitem__(0, False),
            lambda proof: proof["uncertainty"]["values"].pop(),
            lambda proof: proof["qc"]["flags"].pop(),
            lambda proof: proof["qc"].update(flags=[["good" if flag == "suspect" else flag for flag in row] for row in proof["qc"]["flags"]]),
            lambda proof: proof["missing_mask"][0].__setitem__(0, True),
            lambda proof: proof["missing_mask"][0].__setitem__(0, 0),
        )
        for bound in (False, True):
            for identifier in ocean_report.GRID_NATIVE_SOURCES:
                for index, mutate in enumerate(mutations):
                    with self.subTest(bound=bound, figure=identifier, change=index), tempfile.TemporaryDirectory() as directory:
                        root = Path(directory)
                        bundle = RuntimeBundle(root)
                        if bound:
                            bundle.capture_input_fixtures()
                        declaration = bundle.record_plot_data_evidence(identifier)
                        mutate(declaration)
                        bundle.write_metadata()
                        with self.assertRaises(ocean_report.ReportBuildError):
                            ocean_report.build_ocean_report(root)
                        self.assertFalse((root / "report.md").exists())

    def test_native_evidence_missing_masks_cannot_be_filled_or_moved(self) -> None:
        for field in ("native_values", "uncertainty", "qc", "missing_mask"):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                bundle.capture_input_fixtures()
                declaration = bundle.record_plot_data_evidence("crossed-time-depth-temperature")
                if field == "native_values":
                    declaration[field][2][2] = 0
                elif field == "uncertainty":
                    declaration[field]["values"][2][2] = 0
                elif field == "qc":
                    declaration[field]["flags"][2][2] = "good"
                else:
                    declaration[field][2][2] = False
                bundle.write_metadata()
                with self.assertRaises(ocean_report.ReportBuildError):
                    ocean_report.build_ocean_report(root)

    def test_coordinate_roundoff_tolerance_does_not_relax_data_array_equality(self) -> None:
        for identifier in ocean_report.GRID_NATIVE_SOURCES:
            for field in ("native_values", "uncertainty"):
                with self.subTest(figure=identifier, field=field), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    bundle = RuntimeBundle(root)
                    bundle.capture_input_fixtures()
                    declaration = bundle.record_plot_data_evidence(identifier)
                    values = declaration[field] if field == "native_values" else declaration[field]["values"]
                    values[0][0] = math.nextafter(values[0][0], math.inf)
                    bundle.write_metadata()
                    with self.assertRaisesRegex(ocean_report.ReportBuildError, "differs from the complete fixture array"):
                        ocean_report.build_ocean_report(root)

    def test_native_evidence_coordinates_policies_and_metadata_must_match(self) -> None:
        mutations = (
            lambda proof: proof.update(dimension_order=["time", "depth"]),
            lambda proof: proof.update(shape=[6, 4]),
            lambda proof: proof.update(shape=[True, 6]),
            lambda proof: proof.update(time_utc=list(reversed(proof["time_utc"]))),
            lambda proof: proof["time_utc"].__setitem__(0, "2026-08-01T00:00:00+08:00"),
            lambda proof: proof.update(depth_m=list(reversed(proof["depth_m"]))),
            lambda proof: proof["depth_m"].__setitem__(0, False),
            lambda proof: proof.update(depth_unit="km"),
            lambda proof: proof.update(quantity_unit="K"),
            lambda proof: proof.update(missing_policy="fill"),
            lambda proof: proof["qc"].update(policy="good_only"),
            lambda proof: proof["qc"].update(provided=False),
            lambda proof: proof["qc"].update(provided=1),
            lambda proof: proof["uncertainty"].update(present=False),
            lambda proof: proof["uncertainty"].update(present="true"),
            lambda proof: proof["uncertainty"].update(type="standard-deviation"),
            lambda proof: proof["uncertainty"].update(unit="K"),
            lambda proof: proof["uncertainty"].update(display="band"),
            lambda proof: proof["uncertainty"].update(visual_verified=True),
        )
        for index, mutate in enumerate(mutations):
            with self.subTest(change=index), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                declaration = bundle.record_plot_data_evidence("crossed-time-depth-temperature")
                mutate(declaration)
                bundle.write_metadata()
                with self.assertRaises(ocean_report.ReportBuildError):
                    ocean_report.build_ocean_report(root)

    def test_native_evidence_null_incomplete_or_misplaced_is_not_ignored(self) -> None:
        for value in (None, [], True, {}, {"schema_version": 1}, {"provided": True}):
            with self.subTest(value=value), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                bundle.manifest["figures"][0]["scientific_data_contract"]["plot_data_evidence"] = value
                bundle.write_metadata()
                with self.assertRaises(ocean_report.ReportBuildError):
                    ocean_report.build_ocean_report(root)
        for location in ("runtime", "manifest", "figure"):
            with self.subTest(location=location), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                container = bundle.runtime if location == "runtime" else bundle.manifest if location == "manifest" else bundle.manifest["figures"][0]
                container["plot_data_evidence"] = {"provided": True}
                bundle.write_metadata()
                with self.assertRaisesRegex(ocean_report.ReportBuildError, "must be nested"):
                    ocean_report.build_ocean_report(root)

    def test_native_evidence_cannot_extend_to_paired_or_interactive_figures(self) -> None:
        for identifier in ("paired-observation-model", "paired-interactive"):
            with self.subTest(figure=identifier), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                bundle.capture_input_fixtures()
                declaration = bundle.record_plot_data_evidence("crossed-time-depth-temperature")
                target = next(item for item in bundle.manifest["figures"] if item["id"] == identifier)
                target["scientific_data_contract"]["plot_data_evidence"] = declaration
                bundle.write_metadata()
                with self.assertRaisesRegex(ocean_report.ReportBuildError, "unsupported for figure"):
                    ocean_report.build_ocean_report(root)

    def test_gate_native_evidence_wiring_is_scoped_and_reads_result_arrays(self) -> None:
        gate = MODULE_PATH.with_name("run_matlab_gate.m").read_text(encoding="utf-8")
        self.assertIn('"QCFlags", temperature_qc, "QCPolicy", "preserve"', gate)
        self.assertIn('"QCFlags", profile_qc, "QCPolicy", "preserve"', gate)
        self.assertIn('"UncertaintyType", temperature_fixture.variables.temperature_standard_uncertainty.type', gate)
        self.assertIn('"UncertaintyType", profile_fixture.variables.salinity_standard_uncertainty.type', gate)
        self.assertIn('"UncertaintyDisplay", "metadata"', gate)
        self.assertIn('native_values = double(result.Image.CData)', gate)
        self.assertIn('native_values(:, series_index) = double(result.Lines(series_index).XData(:))', gate)
        self.assertIn('isequaln(native_values, expected_values)', gate)
        self.assertIn('isequaln(result.QCFlags, expected_qc)', gate)
        self.assertIn('isequaln(result.UncertaintyValues, expected_uncertainty)', gate)
        self.assertIn('ruler2num(result.Image.XData, result.Axes.XAxis)', gate)
        self.assertIn('ruler2num(parse_utc_time(fixture.coordinates.time.values), result.Axes.XAxis)', gate)
        self.assertIn('assert_numeric_coordinates(native_time([1 end]), expected_time([1 end]))', gate)
        self.assertIn('native_centers = linspace(native_time(1), native_time(end), size(native_values, 2))', gate)
        self.assertIn('assert_numeric_coordinates(native_centers, expected_time)', gate)
        self.assertIn('endpoint_ulp = max(eps(abs([actual([1 end]); expected([1 end])])))', gate)
        self.assertIn('abs(actual - expected) <= 4 * ulp', gate)
        self.assertNotIn('isequaln(native_time', gate)
        self.assertIn('contract.plot_data_evidence = measure_grid_plot_data(result, fixture, input_snapshot)', gate)
        self.assertNotIn('entry.plot_data_evidence', gate)

    def test_manifest_scientific_mismatches_fail_before_report_write(self) -> None:
        changes = [
            ("unit", lambda contract: contract["units"].update(value="K")),
            ("transposed shape", lambda contract: contract.update(shape=[6, 4])),
            ("axis order", lambda contract: contract.update(dimensionOrder=["time", "depth"])),
            ("rank", lambda contract: contract.update(rank=1)),
            ("observation dimension", lambda contract: contract.update(observationDimension="time")),
            ("time zone", lambda contract: contract["coordinates"]["time"].update(timezone="Asia/Shanghai")),
            ("coordinate count", lambda contract: contract["coordinates"]["time"].update(count=5)),
            ("depth unit", lambda contract: contract["coordinates"]["depth"].update(unit="km")),
            ("depth direction", lambda contract: contract["coordinates"]["depth"].update(direction="positive_up")),
            ("missing", lambda contract: contract["missing"].update(missing_count=0, valid_count=24)),
            ("mask", lambda contract: contract["missing"].update(masked_count=1)),
            ("QC", lambda contract: contract["qc"].update(action="filter")),
        ]
        for label, change in changes:
            with self.subTest(label=label), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                change(bundle.manifest["figures"][0]["scientific_data_contract"])
                bundle.write_metadata()
                with self.assertRaises(ocean_report.ReportBuildError):
                    ocean_report.build_ocean_report(root)
                self.assertFalse((root / "report.md").exists())

    def test_grid_axis_policy_unit_design_and_mask_mismatches_are_rejected(self) -> None:
        changes = [
            lambda payload: payload["variables"]["temperature"].update(dimension_order=["time", "depth"]),
            lambda payload: payload["variables"]["qc"].update(policy="drop_suspect"),
            lambda payload: payload["variables"]["temperature"].update(missing_policy="fill_zero"),
            lambda payload: payload["variables"]["temperature"].update(unit="K"),
            lambda payload: payload["design"].update(expected_pair_count=23),
            lambda payload: payload["coordinates"].update(latitude={"values": [30]}),
            lambda payload: payload["coordinates"]["depth"]["values"].__setitem__(0, float("nan")),
            lambda payload: payload["variables"]["temperature_standard_uncertainty"]["values"][0].__setitem__(0, None),
            lambda payload: payload["variables"]["qc"]["values"][0].__setitem__(0, "missing"),
        ]
        for index, change in enumerate(changes):
            with self.subTest(index=index):
                payload = self.fixture_payload("crossed-time-depth-temperature")
                change(payload)
                with self.assertRaises(ocean_report.ReportBuildError):
                    ocean_report.summarize_grid_fixture(payload, "temperature.json")

    def test_duplicate_time_depth_pair_with_unique_id_is_rejected(self) -> None:
        payload = self.fixture_payload("paired-observation-model")
        payload["records"][1]["depth_m"] = payload["records"][0]["depth_m"]
        with self.assertRaisesRegex(ocean_report.ReportBuildError, "duplicate time/depth"):
            ocean_report.summarize_paired_fixture(payload, "paired.json")

    def test_paired_model_only_missing_uses_same_complete_pair_mask(self) -> None:
        payload = self.fixture_payload("paired-observation-model")
        payload["records"][0]["model_degC"] = None
        summary = ocean_report.summarize_paired_fixture(payload, "paired.json")
        self.assertEqual(summary["counts"], {"raw_count": 12, "valid_count": 10, "missing_count": 2})
        self.assertEqual(summary["pairing"]["model_missing_ids"], ["pair-001"])
        self.assertEqual(summary["pairing"]["observation_missing_ids"], ["pair-012"])
        self.assertAlmostEqual(summary["statistics"]["bias_model_minus_observation"], 0.088)
        self.assertAlmostEqual(summary["statistics"]["model_mean"], 15.681)
        self.assertAlmostEqual(summary["statistics"]["observation_mean"], 15.593)

    def test_missing_observation_does_not_hide_invalid_model(self) -> None:
        for model in ("invalid", True, float("inf"), float("nan")):
            with self.subTest(model=model):
                payload = self.fixture_payload("paired-observation-model")
                payload["records"][-1]["model_degC"] = model
                with self.assertRaisesRegex(ocean_report.ReportBuildError, "paired model"):
                    ocean_report.summarize_paired_fixture(payload, "paired.json")

    def test_finite_observation_cannot_have_missing_qc(self) -> None:
        payload = self.fixture_payload("paired-observation-model")
        payload["records"][0]["qc"] = "missing"
        with self.assertRaisesRegex(ocean_report.ReportBuildError, "non-missing QC"):
            ocean_report.summarize_paired_fixture(payload, "paired.json")

    def test_empty_complete_pair_set_fails_explicitly(self) -> None:
        payload = self.fixture_payload("paired-observation-model")
        for record in payload["records"]:
            record["model_degC"] = None
        with self.assertRaisesRegex(ocean_report.ReportBuildError, "no complete finite pairs"):
            ocean_report.summarize_paired_fixture(payload, "paired.json")

    def test_paired_record_order_does_not_change_matching_or_coverage(self) -> None:
        payload = self.fixture_payload("paired-observation-model")
        expected = ocean_report.summarize_paired_fixture(payload, "paired.json")
        payload["records"].reverse()
        actual = ocean_report.summarize_paired_fixture(payload, "paired.json")
        self.assertEqual(actual["time"], expected["time"])
        self.assertAlmostEqual(actual["statistics"]["bias_model_minus_observation"], expected["statistics"]["bias_model_minus_observation"])
        self.assertEqual(set(actual["pairing"]["valid_ids"]), set(expected["pairing"]["valid_ids"]))

    def test_release_full_version_strings_and_wrong_releases_are_rejected(self) -> None:
        for target in ("runtime", "manifest", "entry"):
            for invalid in ("R9.10.0.2198249 (R2021a) Update 8", "R2024b"):
                with self.subTest(target=target, invalid=invalid), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    bundle = RuntimeBundle(root)
                    record = {"runtime": bundle.runtime, "manifest": bundle.manifest,
                              "entry": bundle.manifest["figures"][0]["runtime"]}[target]
                    record["matlab_release"] = invalid
                    bundle.write_metadata()
                    with self.assertRaises(ocean_report.ReportBuildError):
                        ocean_report.build_ocean_report(root)

    def test_generated_at_requires_valid_full_utc_time(self) -> None:
        for invalid in ("2026-09-05Z", "2026-02-30T00:00:00Z", "2026-09-05T12:00:00+08:00"):
            with self.subTest(invalid=invalid), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                bundle.manifest["generated_at"] = invalid
                bundle.write_metadata()
                with self.assertRaisesRegex(ocean_report.ReportBuildError, "manifest.generated_at"):
                    ocean_report.build_ocean_report(root)

    def test_present_metadata_does_not_claim_applied_qc_or_uncertainty(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            RuntimeBundle(root)
            ocean_report.build_ocean_report(root)
            evidence = json.loads((root / "report-evidence.json").read_bytes())
            self.assertEqual(evidence["runtime_fixture_binding"]["status"], "unverified")
            for figure in evidence["runtime_evidence"]["figures"]:
                self.assertEqual(figure["scientific_data"]["qc"]["source_status"], "present")
                self.assertEqual(figure["scientific_data"]["qc"]["plot_filtering"], "not_verified")
                self.assertEqual(figure["scientific_data"]["uncertainty"]["plot_display"], "not_verified")
                self.assertFalse(figure["fixture_binding"]["runtime_fixture_hash_verified"])
            report = (root / "report.md").read_text(encoding="utf-8")
            self.assertIn("源 fixture 元数据存在", report)
            self.assertIn("标准不确定度均值是输入数值的描述统计", report)
            self.assertIn("未提供模式不确定度", report)

    def test_each_figure_links_the_exact_local_fixture_snapshot_and_selection(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            RuntimeBundle(root)
            ocean_report.build_ocean_report(root)
            evidence = json.loads((root / "report-evidence.json").read_bytes())
            sources = {item["id"]: item for item in evidence["fixtures"]}
            for figure in evidence["runtime_evidence"]["figures"]:
                binding = figure["fixture_binding"]
                source = sources[binding["fixture_id"]]
                self.assertEqual(binding["fixture_sha256"], source["sha256"])
                self.assertEqual(binding["fixture_file"], source["file"])
                self.assertEqual(figure["scientific_context"]["counts"]["valid_count"], figure["scientific_data"]["valid_count"])
                self.assertEqual(figure["scientific_context"]["unit"], source["unit"])
            for reference in evidence["references"]:
                self.assertTrue((root / reference["file"]).is_file())
            self.assertEqual(evidence["coverage"]["time"]["continuity"], "not_continuous_across_fixtures")
            self.assertEqual(evidence["coverage"]["time"]["start"], "2026-08-01T00:00:00Z")
            self.assertEqual(evidence["coverage"]["time"]["end"], "2026-08-20T18:00:00Z")

    def test_same_shape_changed_fixture_is_not_claimed_as_runtime_verified(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            RuntimeBundle(root)
            fixture_dir = root / "fixtures"
            shutil.copytree(ocean_report.DEFAULT_FIXTURE_DIRECTORY, fixture_dir)
            fixture_path = fixture_dir / "crossed_time_depth_temperature.json"
            payload = json.loads(fixture_path.read_bytes())
            payload["variables"]["temperature"]["values"][0][0] = 19
            fixture_path.write_text(json.dumps(payload), encoding="utf-8")
            ocean_report.build_ocean_report(root, fixture_dir)
            evidence = json.loads((root / "report-evidence.json").read_bytes())
            fixture = evidence["fixtures"][0]
            self.assertEqual(fixture["sha256"], sha256(fixture_path))
            self.assertAlmostEqual(fixture["statistics"]["mean"], (359.794 + 0.85) / 23)
            self.assertEqual(evidence["runtime_fixture_binding"]["status"], "unverified")
            self.assertIn("运行时数值快照一致性未验证", (root / "report.md").read_text(encoding="utf-8"))

    def test_new_binding_verifies_all_inputs_and_uses_bundle_references(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            bundle.capture_input_fixtures()
            bundle.runtime["input_fixtures"].reverse()
            bundle.write_metadata()
            before = {item["file"]: (root / item["file"]).read_bytes() for item in bundle.runtime["input_fixtures"]}

            ocean_report.build_ocean_report(root)

            evidence = json.loads((root / "report-evidence.json").read_bytes())
            self.assertEqual(evidence["runtime_fixture_binding"]["status"], "verified")
            self.assertEqual(evidence["runtime_fixture_binding"]["fixture_count"], 3)
            inputs = {item["id"]: item for item in evidence["runtime_evidence"]["input_fixtures"]}
            for fixture in evidence["fixtures"]:
                snapshot = inputs[fixture["id"]]
                self.assertEqual(fixture["reference_file"], snapshot["file"])
                self.assertEqual(fixture["sha256"], snapshot["sha256"])
                self.assertEqual(fixture["bytes"], snapshot["bytes"])
            for figure in evidence["runtime_evidence"]["figures"]:
                binding = figure["fixture_binding"]
                self.assertTrue(binding["runtime_fixture_hash_verified"])
                self.assertEqual(binding["fixture_file"], inputs[binding["fixture_id"]]["file"])
                self.assertEqual(figure["scientific_context"]["fixture_file"], binding["fixture_file"])
                self.assertEqual(binding["limitations"], "")
                self.assertEqual(figure["scientific_data"]["qc"]["plot_filtering"], "not_verified")
                self.assertEqual(figure["scientific_data"]["uncertainty"]["plot_display"], "not_verified")
            report = (root / "report.md").read_text(encoding="utf-8")
            for reference in evidence["references"][:3]:
                self.assertTrue(reference["file"].startswith("fixture-inputs/"))
                self.assertEqual(reference["sha256"], sha256(root / reference["file"]))
                self.assertIn(reference["file"], report)
            self.assertIn("输入字节绑定已验证", report)
            self.assertIn("源 fixture 元数据存在", report)
            self.assertIn("未提供模式不确定度", report)
            self.assertNotIn("运行记录没有 fixture 内容哈希", report)
            self.assertNotIn("运行清单缺少输入哈希", report)
            self.assertNotIn(ocean_report.FIXTURE_BINDING_LIMITATION, json.dumps(evidence))
            self.assertEqual(before, {name: (root / name).read_bytes() for name in before})

    def test_new_binding_rejects_same_shape_same_size_numeric_replacement(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            fixture_dir = root / "fixtures"
            shutil.copytree(ocean_report.DEFAULT_FIXTURE_DIRECTORY, fixture_dir)
            bundle.capture_input_fixtures(fixture_dir)
            fixture_path = fixture_dir / "crossed_time_depth_temperature.json"
            original = fixture_path.read_bytes()
            changed = original.replace(b"18.15", b"19.15", 1)
            self.assertNotEqual(changed, original)
            self.assertEqual(len(changed), len(original))
            fixture_path.write_bytes(changed)
            fixtures, contexts = ocean_report.load_fixture_statistics(fixture_dir)
            self.assertEqual(contexts["crossed-time-depth-temperature"]["shape"], [4, 6])
            self.assertEqual(fixtures[0]["counts"], {"raw_count": 24, "valid_count": 23, "missing_count": 1})
            self.assertAlmostEqual(fixtures[0]["statistics"]["mean"], 360.794 / 23)
            with self.assertRaisesRegex(ocean_report.ReportBuildError, "differs from local statistics input"):
                ocean_report.build_ocean_report(root, fixture_dir)
            self.assertFalse((root / "report.md").exists())
            self.assertFalse((root / "report-evidence.json").exists())

    def test_new_binding_requires_byte_identity_not_only_equal_json(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            fixture_dir = root / "fixtures"
            shutil.copytree(ocean_report.DEFAULT_FIXTURE_DIRECTORY, fixture_dir)
            bundle.capture_input_fixtures(fixture_dir)
            fixture_path = fixture_dir / "paired_observation_model.json"
            original = fixture_path.read_bytes()
            fixture_path.write_bytes(original + b"\n")
            self.assertEqual(json.loads(original), json.loads(fixture_path.read_bytes()))
            with self.assertRaisesRegex(ocean_report.ReportBuildError, "differs from local statistics input"):
                ocean_report.build_ocean_report(root, fixture_dir)

    def test_present_input_fixtures_cannot_fall_back_to_legacy(self) -> None:
        for invalid in (None, [], {}, "not-records", [None] * 3):
            with self.subTest(invalid=invalid), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                bundle.runtime["input_fixtures"] = invalid
                bundle.write_metadata()
                with self.assertRaisesRegex(ocean_report.ReportBuildError, "runtime.input_fixtures"):
                    ocean_report.build_ocean_report(root)
                self.assertFalse((root / "report.md").exists())
                self.assertFalse((root / "report-evidence.json").exists())

    def test_new_binding_requires_exactly_three_distinct_ids(self) -> None:
        for change in ("duplicate", "missing", "extra", "unknown"):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                bundle.capture_input_fixtures()
                inputs = bundle.runtime["input_fixtures"]
                if change == "duplicate":
                    inputs[1] = dict(inputs[0])
                elif change == "missing":
                    inputs.pop()
                elif change == "extra":
                    inputs.append(dict(inputs[0]))
                else:
                    inputs[0]["id"] = "unknown-fixture"
                bundle.write_metadata()
                with self.assertRaisesRegex(ocean_report.ReportBuildError, "runtime.input_fixtures"):
                    ocean_report.build_ocean_report(root)
                self.assertFalse((root / "report.md").exists())

    def test_new_binding_strict_record_fields_paths_hashes_and_sizes(self) -> None:
        mutations = [
            ("id", None), ("id", []), ("source_file", "paired_observation_model.json"),
            ("source_file", "../crossed_time_depth_temperature.json"),
            ("file", "crossed_time_depth_temperature.json"),
            ("file", "fixture-inputs/../crossed_time_depth_temperature.json"),
            ("file", "fixture-inputs/./crossed_time_depth_temperature.json"),
            ("file", "/fixture-inputs/crossed_time_depth_temperature.json"),
            ("file", "fixture-inputs\\crossed_time_depth_temperature.json"),
            ("file", " fixture-inputs/crossed_time_depth_temperature.json"),
            ("bytes", 0), ("bytes", -1), ("bytes", True), ("bytes", 1.5), ("bytes", "100"),
            ("bytes", 1), ("sha256", "0" * 64), ("sha256", "f" * 63),
            ("sha256", "g" * 64), ("sha256", None), ("extra_field", True),
        ]
        for field, value in mutations:
            with self.subTest(field=field, value=value), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                bundle.capture_input_fixtures()
                bundle.runtime["input_fixtures"][0][field] = value
                bundle.write_metadata()
                with self.assertRaises(ocean_report.ReportBuildError):
                    ocean_report.build_ocean_report(root)
                self.assertFalse((root / "report.md").exists())

    def test_new_binding_rejects_missing_snapshot_copy(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            bundle.capture_input_fixtures()
            (root / bundle.runtime["input_fixtures"][0]["file"]).unlink()
            with self.assertRaisesRegex(ocean_report.ReportBuildError, "fixture input snapshot missing"):
                ocean_report.build_ocean_report(root)
            self.assertFalse((root / "report.md").exists())
            self.assertFalse((root / "report-evidence.json").exists())

    def test_new_binding_rejects_tampered_snapshot_even_with_updated_record(self) -> None:
        for update_record in (False, True):
            with self.subTest(update_record=update_record), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                bundle.capture_input_fixtures()
                item = bundle.runtime["input_fixtures"][0]
                path = root / item["file"]
                original = path.read_bytes()
                tampered = original.replace(b"18.15", b"19.15", 1)
                self.assertNotEqual(tampered, original)
                self.assertEqual(len(tampered), len(original))
                path.write_bytes(tampered)
                if update_record:
                    item["sha256"] = sha256(path)
                    bundle.write_metadata()
                message = "differs from local statistics input" if update_record else "snapshot bytes/sha256 mismatch"
                with self.assertRaisesRegex(ocean_report.ReportBuildError, message):
                    ocean_report.build_ocean_report(root)
                self.assertFalse((root / "report.md").exists())
                self.assertFalse((root / "report-evidence.json").exists())

    def test_new_binding_rejects_snapshot_file_and_parent_symlinks(self) -> None:
        for link_parent in (False, True):
            with self.subTest(link_parent=link_parent), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                bundle.capture_input_fixtures()
                if link_parent:
                    path = root / "fixture-inputs"
                    target = root / "renamed-inputs"
                    path.rename(target)
                    path.symlink_to(target, target_is_directory=True)
                else:
                    item = bundle.runtime["input_fixtures"][0]
                    path = root / item["file"]
                    path.unlink()
                    path.symlink_to(ocean_report.DEFAULT_FIXTURE_DIRECTORY / item["source_file"])
                with self.assertRaisesRegex(ocean_report.ReportBuildError, "symlink artifact path"):
                    ocean_report.build_ocean_report(root)

    def test_used_snapshot_is_rechecked_before_output_write(self) -> None:
        for mutation in ("bytes", "missing", "symlink"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                bundle.capture_input_fixtures()
                item = bundle.runtime["input_fixtures"][0]
                original_render = ocean_report.render_report
                def change_after_render(evidence):
                    report = original_render(evidence)
                    path = root / item["file"]
                    if mutation == "bytes":
                        path.write_bytes(path.read_bytes().replace(b"18.15", b"19.15", 1))
                    else:
                        path.unlink()
                        if mutation == "symlink":
                            path.symlink_to(ocean_report.DEFAULT_FIXTURE_DIRECTORY / item["source_file"])
                    return report
                with mock.patch.object(ocean_report, "render_report", side_effect=change_after_render):
                    with mock.patch.object(ocean_report, "write_outputs") as writer:
                        with self.assertRaises(ocean_report.ReportBuildError):
                            ocean_report.build_ocean_report(root)
                        writer.assert_not_called()
                self.assertFalse((root / "report.md").exists())
                self.assertFalse((root / "report-evidence.json").exists())

    def test_legacy_runtime_with_unrecorded_copies_remains_unverified(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            bundle.capture_input_fixtures()
            del bundle.runtime["input_fixtures"]
            bundle.write_metadata()
            ocean_report.build_ocean_report(root)
            evidence = json.loads((root / "report-evidence.json").read_bytes())
            self.assertEqual(evidence["runtime_fixture_binding"], {
                "status": "unverified", "reason": ocean_report.FIXTURE_BINDING_LIMITATION,
            })
            self.assertEqual(evidence["runtime_evidence"]["input_fixtures"], [])
            self.assertIn(ocean_report.FIXTURE_BINDING_LIMITATION, evidence["limitations"])
            for figure in evidence["runtime_evidence"]["figures"]:
                self.assertFalse(figure["fixture_binding"]["runtime_fixture_hash_verified"])
            for reference in evidence["references"][:3]:
                self.assertFalse(reference["file"].startswith("fixture-inputs/"))
            report = (root / "report.md").read_text(encoding="utf-8")
            self.assertIn("运行时数值快照一致性未验证", report)
            self.assertIn("运行清单缺少输入哈希", report)
            self.assertNotIn("输入字节绑定已验证", report)

    def test_input_change_during_generation_rejects_mixed_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            RuntimeBundle(root)
            fixture_dir = root / "fixtures"
            shutil.copytree(ocean_report.DEFAULT_FIXTURE_DIRECTORY, fixture_dir)
            original_render = ocean_report.render_report
            def change_after_render(evidence):
                report = original_render(evidence)
                path = fixture_dir / "paired_observation_model.json"
                path.write_bytes(path.read_bytes() + b"\n")
                return report
            with mock.patch.object(ocean_report, "render_report", side_effect=change_after_render):
                with self.assertRaisesRegex(ocean_report.ReportBuildError, "input changed"):
                    ocean_report.build_ocean_report(root, fixture_dir)
            self.assertFalse((root / "report.md").exists())

    def test_conflicting_export_metadata_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            bundle.manifest["figures"][0]["exports"]["pdf"]["title"] = "Different scientific figure"
            bundle.write_metadata()
            with self.assertRaisesRegex(ocean_report.ReportBuildError, "metadata mismatch"):
                ocean_report.build_ocean_report(root)

    def test_wrong_fixture_identity_and_geography_are_rejected(self) -> None:
        for change in (
            lambda payload: payload.update(kind="repeat_profiles"),
            lambda payload: payload.update(area={"name": "Real Sea"}),
            lambda payload: payload.update(synthetic=False),
        ):
            payload = self.fixture_payload("crossed-time-depth-temperature")
            change(payload)
            with self.assertRaises(ocean_report.ReportBuildError):
                ocean_report.validate_fixture_identity(payload, "crossed-time-depth-temperature", "temperature.json")
        paired = self.fixture_payload("paired-observation-model")
        paired["coordinates"] = {"latitude": [30], "longitude": [120]}
        with self.assertRaisesRegex(ocean_report.ReportBuildError, "paired coordinates"):
            ocean_report.validate_fixture_identity(paired, "paired-observation-model", "paired.json")

    def test_json_nan_and_duplicate_keys_fail_explicitly(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "invalid.json"
            for text in ('{"value": NaN}', '{"value": 1, "value": 2}'):
                path.write_text(text, encoding="utf-8")
                with self.assertRaises(ocean_report.ReportBuildError):
                    ocean_report.load_json(path, "fixture")

    def test_normalizes_real_writer_and_runtime_release_forms(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            RuntimeBundle(root)

            ocean_report.build_ocean_report(root, ocean_report.DEFAULT_FIXTURE_DIRECTORY)

            evidence = json.loads((root / "report-evidence.json").read_text(encoding="utf-8"))
            self.assertEqual(evidence["runtime_evidence"]["matlab_release"], "R2026a")

    def test_builds_report_from_verified_runtime_artifacts_and_fixture_statistics(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            RuntimeBundle(root)

            result = ocean_report.build_ocean_report(root, ocean_report.DEFAULT_FIXTURE_DIRECTORY)

            self.assertEqual(result["status"], "passed")
            self.assertEqual(result["artifact_count"], 12)
            report_path = root / "report.md"
            evidence_path = root / "report-evidence.json"
            report = report_path.read_text(encoding="utf-8")
            evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
            self.assertIn("数据来源=合成基准非实测海况", report)
            self.assertIn("观测-模式配对统计", report)
            self.assertIn("](crossed-time-depth-temperature.png)", report)
            self.assertNotIn(str(root), report)
            self.assertNotIn("桌面验证通过", report)
            self.assertNotIn("100分", report)
            self.assertEqual(evidence["data_source"]["observed_ocean_conditions"], False)
            self.assertEqual(evidence["area"]["bounds"], None)
            self.assertEqual(evidence["runtime_evidence"]["desktop_validation"]["status"], "not_performed")
            self.assertEqual(len(evidence["runtime_evidence"]["artifacts"]), 12)
            paired = next(item for item in evidence["fixtures"] if item["id"] == "paired-observation-model")
            self.assertEqual(paired["counts"], {"raw_count": 12, "valid_count": 11, "missing_count": 1})
            self.assertAlmostEqual(paired["statistics"]["bias_model_minus_observation"], 0.08727272727272739)
            self.assertEqual(evidence["report"]["bytes"], report_path.stat().st_size)
            self.assertEqual(evidence["report"]["sha256"], sha256(report_path))

    def test_cli_writes_the_two_contract_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            bundle.capture_input_fixtures()
            process = subprocess.run(
                [
                    sys.executable,
                    str(MODULE_PATH),
                    "--runtime-output",
                    str(root),
                    "--fixture-dir",
                    str(ocean_report.DEFAULT_FIXTURE_DIRECTORY),
                ],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            self.assertEqual(process.returncode, 0, process.stderr)
            payload = json.loads(process.stdout)
            self.assertEqual(payload["status"], "passed")
            self.assertTrue((root / "report.md").is_file())
            self.assertTrue((root / "report-evidence.json").is_file())
            evidence = json.loads((root / "report-evidence.json").read_bytes())
            self.assertEqual(evidence["runtime_fixture_binding"]["status"], "verified")

    def test_missing_artifact_fails_without_writing_report(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            RuntimeBundle(root)
            (root / "paired-observation-model.pdf").unlink()

            with self.assertRaisesRegex(ocean_report.ReportBuildError, "required pdf artifact missing"):
                ocean_report.build_ocean_report(root, ocean_report.DEFAULT_FIXTURE_DIRECTORY)

            self.assertFalse((root / "report.md").exists())
            self.assertFalse((root / "report-evidence.json").exists())

    def test_hash_tampering_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            RuntimeBundle(root)
            (root / "crossed-time-depth-temperature.svg").write_text("<svg/>", encoding="utf-8")

            with self.assertRaisesRegex(ocean_report.ReportBuildError, "byte count mismatch|sha256 mismatch"):
                ocean_report.build_ocean_report(root, ocean_report.DEFAULT_FIXTURE_DIRECTORY)

    def test_dimension_mismatch_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            bundle.manifest["figures"][0]["exports"]["png"]["width"] = 999
            bundle.write_metadata()

            with self.assertRaisesRegex(ocean_report.ReportBuildError, "dimensions mismatch"):
                ocean_report.build_ocean_report(root, ocean_report.DEFAULT_FIXTURE_DIRECTORY)

    def test_unsafe_manifest_path_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            bundle.manifest["figures"][0]["exports"]["svg"]["file"] = "../outside.svg"
            bundle.write_metadata()

            with self.assertRaisesRegex(ocean_report.ReportBuildError, "unsafe artifact path"):
                ocean_report.build_ocean_report(root, ocean_report.DEFAULT_FIXTURE_DIRECTORY)

    def test_runtime_cannot_claim_visual_inspection(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            bundle.manifest["visual_inspection"] = {"status": "passed", "verified": True}
            bundle.write_metadata()

            with self.assertRaisesRegex(ocean_report.ReportBuildError, "visual inspection as not_run"):
                ocean_report.build_ocean_report(root, ocean_report.DEFAULT_FIXTURE_DIRECTORY)


class ComparisonProofTests(unittest.TestCase):
    @staticmethod
    def at_path(value, path: tuple):
        for key in path:
            value = value[key]
        return value

    def replace_field(self, path: tuple, value):
        def mutate(declaration):
            self.at_path(declaration, path[:-1])[path[-1]] = copy.deepcopy(value)
        return mutate

    def assert_comparison_mutations_rejected(self, case_factory, *, bound: bool = True) -> None:
        with tempfile.TemporaryDirectory() as directory:
            bundle = RuntimeBundle(Path(directory))
            if bound:
                bundle.capture_input_fixtures()
            original = bundle.record_synthetic_comparison_plot_data_evidence()
            self.assert_comparison_report(bundle, original, bound=bound)
            for name in ("report.md", "report-evidence.json"):
                (bundle.root / name).unlink()
            inputs = {path: path.read_bytes() for path in (bundle.root / "fixture-inputs").glob("*")}
            contract = next(item for item in bundle.manifest["figures"]
                            if item["id"] == "paired-observation-model")["scientific_data_contract"]
            for label, mutate in case_factory(original):
                with self.subTest(mutation=label, bound=bound):
                    declaration = copy.deepcopy(original)
                    contract["plot_data_evidence"] = declaration
                    mutate(declaration)
                    bundle.write_metadata()
                    with mock.patch.object(ocean_report, "write_outputs",
                                           side_effect=AssertionError("invalid comparison reached output writer")) as writer:
                        with self.assertRaises(ocean_report.ReportBuildError):
                            ocean_report.build_ocean_report(bundle.root)
                        writer.assert_not_called()
                    self.assertFalse((bundle.root / "report.md").exists())
                    self.assertFalse((bundle.root / "report-evidence.json").exists())
                    self.assertEqual(inputs, {path: path.read_bytes() for path in inputs})

    def assert_comparison_fields_rejected(self, fields, *, bound: bool = True) -> None:
        def cases(original):
            for path, value in fields(original) if callable(fields) else fields:
                yield (path, value), self.replace_field(path, value)
        self.assert_comparison_mutations_rejected(cases, bound=bound)

    def assert_comparison_report(
        self, bundle: RuntimeBundle, declaration: dict, *, bound: bool = True,
        fixture_directory: Path = ocean_report.DEFAULT_FIXTURE_DIRECTORY,
    ) -> dict:
        bundle.write_metadata()
        before = {path: path.read_bytes() for path in bundle.root.rglob("*") if path.is_file()}
        result = ocean_report.build_ocean_report(bundle.root, fixture_directory)
        self.assertEqual(result["status"], "passed")
        evidence = json.loads((bundle.root / "report-evidence.json").read_bytes())
        figure = next(item for item in evidence["runtime_evidence"]["figures"] if item["id"] == "paired-observation-model")
        proof = figure["plot_data_evidence"]
        self.assertEqual(proof["status"], "runtime_declaration_verified" if bound else "not_verified")
        self.assertIs(proof["provided"], True)
        self.assertIs(proof["local_arrays_match"], True)
        self.assertIs(proof["input_fixture_binding_verified"], bound)
        self.assertEqual(proof["declaration"], declaration)
        self.assertEqual(figure["scientific_data"]["qc"]["plot_filtering"], "preserve" if bound else "not_verified")
        self.assertEqual(figure["scientific_data"]["uncertainty"]["plot_display"],
                         "horizontal-line-segments" if bound else "not_verified")
        self.assertFalse(evidence["data_source"]["observed_ocean_conditions"])
        self.assertFalse(evidence["runtime_evidence"]["visual_inspection"]["verified"])
        self.assertEqual(evidence["runtime_evidence"]["desktop_validation"]["status"], "not_performed")
        for item in evidence["runtime_evidence"]["figures"]:
            self.assertEqual(item["verification"]["visual_inspection"], "not_verified")
        self.assertEqual(before, {path: path.read_bytes() for path in before})
        return evidence

    def test_synthetic_comparison_v3_verifies_four_figures_without_execution_or_visual_promotion(self) -> None:
        for release in ("R2021a", "R2024b", "R2026a"):
            with self.subTest(release=release), tempfile.TemporaryDirectory() as directory:
                bundle = RuntimeBundle(Path(directory))
                bundle.release = release
                bundle.runtime["matlab_release"] = release
                bundle.runtime["matlab_version"] = {"R2021a": "9.10.0", "R2024b": "24.2.0", "R2026a": "26.1.0"}[release]
                bundle.manifest["matlab_release"] = release[1:]
                for figure in bundle.manifest["figures"]:
                    figure["runtime"]["matlab_release"] = release[1:]
                bundle.capture_input_fixtures()
                declarations = {identifier: bundle.record_plot_data_evidence(identifier)
                                for identifier in ocean_report.GRID_NATIVE_SOURCES}
                declarations["paired-interactive"] = bundle.record_interactive_plot_data_evidence()
                declaration = bundle.record_synthetic_comparison_plot_data_evidence()
                declarations["paired-observation-model"] = declaration
                evidence = self.assert_comparison_report(bundle, declaration)
                figures = {item["id"]: item for item in evidence["runtime_evidence"]["figures"]}
                self.assertEqual({identifier for identifier, figure in figures.items()
                                  if figure["plot_data_evidence"]["status"] == "runtime_declaration_verified"},
                                 ocean_report.EXPECTED_FIGURES)
                for identifier, expected in declarations.items():
                    self.assertEqual(figures[identifier]["plot_data_evidence"]["declaration"], expected)
                self.assertEqual(declaration["shape"], [12])
                self.assertEqual(declaration["records"]["source_rows"], list(range(1, 13)))
                self.assertEqual(declaration["records"]["depth_m"], [10, 40, 70] * 4)
                self.assertEqual(declaration["input_values"]["model"][-1], 13.96)
                self.assertIsNone(declaration["input_values"]["observation"][-1])
                self.assertEqual(declaration["qc"]["observation"]["flags"][5], "suspect")
                self.assertEqual(declaration["native_scatter"]["source_rows"], list(range(1, 12)))
                self.assertEqual(len(declaration["uncertainty"]["segments"]), 11)
                self.assertEqual(declaration["qc"]["model"], {"status": "not_provided"})
                self.assertEqual(declaration["uncertainty"]["model"], {"status": "not_provided"})
                for field, expected in {"paired_count": 11, "bias_model_minus_observation": 0.08727272727272767,
                                        "mean_absolute_error": 0.09272727272727334,
                                        "root_mean_square_error": 0.11159993483217405,
                                        "pearson_correlation": 0.9996003539344701}.items():
                    self.assertAlmostEqual(declaration["paired_stats"][field], expected, places=14)
                report = (bundle.root / "report.md").read_text(encoding="utf-8")
                self.assertIn("horizontal-line-segments", report)
                self.assertIn("未提供模式不确定度", report)

    def test_comparison_v3_unbound_arrays_match_but_do_not_verify_display(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            bundle = RuntimeBundle(Path(directory))
            declaration = bundle.record_synthetic_comparison_plot_data_evidence()
            evidence = self.assert_comparison_report(bundle, declaration, bound=False)
            self.assertEqual(evidence["runtime_fixture_binding"]["status"], "unverified")

    def test_comparison_v3_all_object_fields_are_required_and_exact(self) -> None:
        paths = ((), ("records",), ("input_values",), ("pairing",), ("qc",), ("qc", "observation"),
                 ("qc", "model"), ("native_scatter",), ("uncertainty",), ("uncertainty", "observation"),
                 ("uncertainty", "model"), ("uncertainty", "segments", 0), ("paired_stats",))

        def cases(original):
            for path in paths:
                for field in self.at_path(original, path):
                    yield ("missing", path, field), lambda declaration, path=path, field=field: self.at_path(
                        declaration, path
                    ).pop(field)
                yield ("extra", path), lambda declaration, path=path: self.at_path(declaration, path).update(verified=True)
                if path:
                    for value in (None, [], True, "provided"):
                        yield ("not_object", path, value), self.replace_field(path, value)
        self.assert_comparison_mutations_rejected(cases)

    def test_comparison_v3_flat_vectors_and_segments_cannot_use_scalar_or_partial_forms(self) -> None:
        def fields(original):
            def vectors(value, path=()):
                if isinstance(value, dict):
                    for key, item in value.items():
                        yield from vectors(item, (*path, key))
                elif isinstance(value, list):
                    yield path, value
                    if value and isinstance(value[0], dict):
                        yield from vectors(value[0], (*path, 0))
            for path, vector in vectors(original):
                for value in (vector[:-1], vector + [copy.deepcopy(vector[0])], [vector], vector[0]):
                    yield path, value
        self.assert_comparison_fields_rejected(fields)

    def test_comparison_v3_integer_identity_fields_reject_boolean_float_and_string(self) -> None:
        paths = (("schema_version",), ("shape", 0), ("records", "source_rows", 0),
                 ("pairing", "observation_indices", 0), ("pairing", "model_indices", 0),
                 ("pairing", "unmatched_observation_count"), ("pairing", "unmatched_model_count"),
                 ("native_scatter", "source_rows", 0), ("uncertainty", "segments", 0, "source_row"),
                 ("paired_stats", "paired_count"))

        def fields(original):
            for path in paths:
                original_value = self.at_path(original, path)
                for value in (bool(original_value), float(original_value), str(original_value)):
                    yield path, value
        self.assert_comparison_fields_rejected(fields)

    def test_comparison_v3_boolean_masks_reject_numeric_and_string_substitutes(self) -> None:
        paths = (("pairing", "finite_pair_mask"), ("pairing", "paired_mask"), ("qc", "accepted_mask"),
                 ("uncertainty", "observation", "missing_mask"), ("uncertainty", "graphics_mask"))

        def fields(original):
            for path in paths:
                for index in (0, 11):
                    value = self.at_path(original, path)[index]
                    for replacement in (int(value), float(value), str(value).lower(), None):
                        yield (*path, index), replacement
        self.assert_comparison_fields_rejected(fields)

    def test_comparison_v3_schema_identity_hash_release_and_fixed_semantics_are_strict(self) -> None:
        fields = [
            (("schema_version",), value) for value in (1, 2, 4, None)
        ] + [
            (("figure_id",), "paired-interactive"), (("fixture_id",), "crossed-time-depth-temperature"),
            (("fixture_sha256",), "0" * 64), (("fixture_sha256",), None),
            (("matlab_release",), "R2024b"), (("matlab_release",), "26.1.0 (R2026a)"),
            (("dimension_order",), ["time"]), (("shape",), [11]), (("quantity_unit",), "K"),
            (("missing_policy",), "drop"), (("native_data_source",), "Lines.XData/YData"),
            (("records", "time_zone"), "Europe/London"), (("records", "depth_unit"), "km"),
            (("records", "depth_direction"), "positive_up"), (("records", "source_row_origin"), "sorted_order"),
            (("pairing", "rule"), "row-time-inner"), (("pairing", "duplicate_key_policy"), "first"),
            (("pairing", "unmatched_observation_count"), 1), (("pairing", "unmatched_model_count"), 1),
        ]
        self.assert_comparison_fields_rejected(fields)

    def test_comparison_v3_cannot_be_attached_to_another_figure_or_manifest_root(self) -> None:
        for destination in ("paired-interactive", "crossed-time-depth-temperature", "manifest", "runtime"):
            with self.subTest(destination=destination), tempfile.TemporaryDirectory() as directory:
                bundle = RuntimeBundle(Path(directory))
                bundle.capture_input_fixtures()
                declaration = bundle.record_synthetic_comparison_plot_data_evidence()
                self.assert_comparison_report(bundle, declaration)
                for name in ("report.md", "report-evidence.json"):
                    (bundle.root / name).unlink()
                if destination in {"manifest", "runtime"}:
                    getattr(bundle, destination)["plot_data_evidence"] = declaration
                else:
                    figure = next(item for item in bundle.manifest["figures"] if item["id"] == destination)
                    figure["scientific_data_contract"]["plot_data_evidence"] = declaration
                bundle.write_metadata()
                with self.assertRaises(ocean_report.ReportBuildError):
                    ocean_report.build_ocean_report(bundle.root)
                self.assertFalse((bundle.root / "report.md").exists())
                self.assertFalse((bundle.root / "report-evidence.json").exists())

    def test_comparison_v3_checks_every_record_identity_time_depth_and_pair_index(self) -> None:
        def fields(original):
            for index in range(12):
                yield ("records", "ids", index), f"changed-pair-{index + 1:03d}"
                yield ("records", "time_utc", index), "2026-08-20T01:00:00Z"
                depth = original["records"]["depth_m"][index]
                yield ("records", "depth_m", index), math.nextafter(float(depth), math.inf)
                for path in (("records", "source_rows"), ("pairing", "observation_indices"), ("pairing", "model_indices")):
                    yield (*path, index), index
            for field in ("ids", "time_utc", "depth_m", "source_rows"):
                yield ("records", field), list(reversed(original["records"][field]))
            yield ("records", "ids", 1), original["records"]["ids"][0]
            for timestamp in ("2026-08-20T00:00:00+00:00", "2026-08-20T00:00:00.000Z",
                              "2026-08-20T00:00:00", "2026-08-32T00:00:00Z"):
                yield ("records", "time_utc", 0), timestamp
        self.assert_comparison_fields_rejected(fields)

    def test_comparison_v3_every_raw_value_is_exact_including_unplotted_model(self) -> None:
        def fields(original):
            for name in ("observation", "model"):
                for index, value in enumerate(original["input_values"][name]):
                    yield ("input_values", name, index), 0 if value is None else math.nextafter(value, math.inf)
            yield ("input_values", "model", 11), None
            yield ("input_values", "observation", 0), True
            yield ("input_values", "model", 0), "17.10"
            yield ("records", "depth_m", 0), True
        self.assert_comparison_fields_rejected(fields)

    def test_comparison_v3_qc_all_flags_acceptance_and_model_absence_are_preserved(self) -> None:
        def fields(original):
            for index, flag in enumerate(original["qc"]["observation"]["flags"]):
                yield ("qc", "observation", "flags", index), "suspect" if flag == "good" else "good"
                yield ("qc", "accepted_mask", index), not original["qc"]["accepted_mask"][index]
                for mask in ("finite_pair_mask", "paired_mask"):
                    yield ("pairing", mask, index), not original["pairing"][mask][index]
            for values in (["good"], ["suspect", "good"], ["good", "suspect", "missing"]):
                yield ("qc", "observation", "accepted_values"), values
            yield ("qc", "policy"), "filter"
            yield ("qc", "observation", "status"), "not_provided"
            yield ("qc", "model"), copy.deepcopy(original["qc"]["observation"])
            yield ("qc", "model"), {"status": "not_provided", "flags": []}
        self.assert_comparison_fields_rejected(fields)

    def test_comparison_v3_coherent_suspect_exclusion_cannot_forge_preservation(self) -> None:
        def mutate(declaration):
            declaration["qc"]["observation"]["accepted_values"] = ["good"]
            declaration["qc"]["accepted_mask"][5] = False
            declaration["pairing"]["paired_mask"][5] = False
            declaration["uncertainty"]["graphics_mask"][5] = False
            for vector in declaration["native_scatter"].values():
                vector.pop(5)
            declaration["uncertainty"]["segments"].pop(5)
            scatter = declaration["native_scatter"]
            declaration["paired_stats"] = RuntimeBundle.synthetic_comparison_stats(scatter["x_values"], scatter["y_values"])
        self.assert_comparison_mutations_rejected(lambda original: [("coherent_drop_pair_006", mutate)])

    def test_comparison_v3_observation_uncertainty_checks_every_value_and_mask(self) -> None:
        def fields(original):
            for index, value in enumerate(original["uncertainty"]["observation"]["values"]):
                yield ("uncertainty", "observation", "values", index), 0 if value is None else math.nextafter(value, math.inf)
                yield ("uncertainty", "observation", "missing_mask", index), value is not None
                yield ("uncertainty", "graphics_mask", index), not original["uncertainty"]["graphics_mask"][index]
            for value in (None, True, "0.10", -0.1):
                yield ("uncertainty", "observation", "values", 0), value
        self.assert_comparison_fields_rejected(fields)

    def test_comparison_v3_uncertainty_semantics_reject_model_zero_fill_and_fake_errorbars(self) -> None:
        self.assert_comparison_fields_rejected([
            (("uncertainty", "type"), "standard-error"), (("uncertainty", "type"), "standard_uncertainty"),
            (("uncertainty", "unit"), "K"), (("uncertainty", "representation"), "bounds"),
            (("uncertainty", "confidence_level"), 0.95), (("uncertainty", "confidence_level"), False),
            (("uncertainty", "display"), "metadata"), (("uncertainty", "display"), "errorbar"),
            (("uncertainty", "native_data_source"), "ErrorBar.XData/YData/YNegativeDelta/YPositiveDelta"),
            (("uncertainty", "observation", "status"), "not_provided"),
            (("uncertainty", "model"), {"status": "provided", "values": [0] * 12}),
            (("uncertainty", "model"), {"status": "not_provided", "values": [None] * 12}),
            (("uncertainty", "model"), {"status": "not_provided", "values": []}),
        ])

    def test_comparison_v3_native_scatter_checks_every_coordinate_and_identity(self) -> None:
        def fields(original):
            scatter = original["native_scatter"]
            for index in range(11):
                for name in ("x_values", "y_values"):
                    yield ("native_scatter", name, index), math.nextafter(scatter[name][index], math.inf)
                yield ("native_scatter", "source_rows", index), index + 2
                yield ("native_scatter", "record_ids", index), f"wrong-{index}"
            for name, vector in scatter.items():
                yield ("native_scatter", name), list(reversed(vector))
            yield ("native_scatter", "x_values"), list(scatter["y_values"])
            yield ("native_scatter", "y_values"), sorted(scatter["y_values"])
            yield ("native_scatter", "x_values", 0), None
            yield ("native_scatter", "y_values", 0), True
        self.assert_comparison_fields_rejected(fields)

    def test_comparison_v3_checks_both_endpoints_and_identity_of_every_horizontal_segment(self) -> None:
        def fields(original):
            for index, segment in enumerate(original["uncertainty"]["segments"]):
                for name in ("x_values", "y_values"):
                    for endpoint, value in enumerate(segment[name]):
                        yield ("uncertainty", "segments", index, name, endpoint), value + 1e-6
                yield ("uncertainty", "segments", index, "source_row"), index + 2
                yield ("uncertainty", "segments", index, "record_id"), f"wrong-{index}"
        self.assert_comparison_fields_rejected(fields)

    def test_comparison_v3_segment_order_count_and_orientation_are_not_interchangeable(self) -> None:
        def fields(original):
            segments = original["uncertainty"]["segments"]
            yield ("uncertainty", "segments"), list(reversed(segments))
            yield ("uncertainty", "segments"), [copy.deepcopy(segments[0])] * len(segments)
            yield ("uncertainty", "segments", 0, "x_values"), list(reversed(segments[0]["x_values"]))
            observation = original["native_scatter"]["x_values"][0]
            model = original["native_scatter"]["y_values"][0]
            for span in (0, 0.1):
                vertical = {**segments[0], "x_values": [observation, observation], "y_values": [model - span, model + span]}
                yield ("uncertainty", "segments", 0), vertical
                yield ("uncertainty", "segments"), segments + [vertical]
            for name in ("x_values", "y_values"):
                for value in (None, True, "17.1"):
                    yield ("uncertainty", "segments", 0, name, 0), value
        self.assert_comparison_fields_rejected(fields)

    def test_comparison_v3_nonfinite_values_are_rejected_even_without_binding(self) -> None:
        paths = (("input_values", "model", 11), ("records", "depth_m", 0),
                 ("native_scatter", "x_values", 0), ("uncertainty", "observation", "values", 0),
                 ("uncertainty", "segments", 0, "y_values", 1), ("paired_stats", "pearson_correlation"))
        self.assert_comparison_fields_rejected([(path, value) for path in paths
                                               for value in (math.nan, math.inf, -math.inf)], bound=False)

    def test_comparison_v3_json_overflow_and_identical_duplicate_keys_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            bundle = RuntimeBundle(Path(directory))
            declaration = bundle.record_synthetic_comparison_plot_data_evidence()
            self.assert_comparison_report(bundle, declaration, bound=False)
            for name in ("report.md", "report-evidence.json"):
                (bundle.root / name).unlink()
            manifest = bundle.root / "figures.json"
            original = manifest.read_text(encoding="utf-8")
            correlation = '"pearson_correlation": ' + json.dumps(declaration["paired_stats"]["pearson_correlation"])
            mutations = [(correlation, '"pearson_correlation": ' + token)
                         for token in ("NaN", "Infinity", "-Infinity", "1e999")]
            for field, value in (("schema_version", 3), ("paired_count", 11)):
                member = json.dumps(field) + ": " + str(value)
                mutations.append((member, member + ", " + member))
            for member, replacement in mutations:
                with self.subTest(replacement=replacement):
                    self.assertEqual(original.count(member), 1)
                    manifest.write_text(original.replace(member, replacement, 1), encoding="utf-8")
                    with mock.patch.object(ocean_report, "write_outputs") as writer:
                        with self.assertRaises(ocean_report.ReportBuildError):
                            ocean_report.build_ocean_report(bundle.root)
                        writer.assert_not_called()
                    self.assertFalse((bundle.root / "report.md").exists())
                    self.assertFalse((bundle.root / "report-evidence.json").exists())

    def test_comparison_v3_stats_require_all_pairs_and_defined_correlation(self) -> None:
        def fields(original):
            for name, value in original["paired_stats"].items():
                for replacement in (None, True, str(value), value + 0.01):
                    yield ("paired_stats", name), replacement
            yield ("paired_stats", "paired_count"), 12
            yield ("paired_stats", "bias_model_minus_observation"), -original["paired_stats"]["bias_model_minus_observation"]
            scatter = original["native_scatter"]
            yield ("paired_stats",), RuntimeBundle.synthetic_comparison_stats(
                scatter["x_values"][:5] + scatter["x_values"][6:], scatter["y_values"][:5] + scatter["y_values"][6:]
            )
            weights = [1 / value ** 2 for value in original["uncertainty"]["observation"]["values"] if value is not None]
            weighted_bias = sum(weight * (model - observation) for weight, observation, model in zip(
                weights, scatter["x_values"], scatter["y_values"]
            )) / sum(weights)
            yield ("paired_stats", "bias_model_minus_observation"), weighted_bias
        self.assert_comparison_fields_rejected(fields)

    def test_comparison_v3_only_derived_values_allow_one_e_minus_twelve_roundoff(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            bundle = RuntimeBundle(Path(directory))
            bundle.capture_input_fixtures()
            declaration = bundle.record_synthetic_comparison_plot_data_evidence()
            self.assert_comparison_report(bundle, declaration)
            for name in ("report.md", "report-evidence.json"):
                (bundle.root / name).unlink()
            declaration["records"]["depth_m"] = [float(value) for value in declaration["records"]["depth_m"]]
            for segment in declaration["uncertainty"]["segments"]:
                for field in ("x_values", "y_values"):
                    segment[field] = [value + 0.5e-12 * max(1, abs(value)) for value in segment[field]]
            for field, value in declaration["paired_stats"].items():
                if field != "paired_count":
                    declaration["paired_stats"][field] = value + 0.5e-12 * max(1, abs(value))
            self.assert_comparison_report(bundle, declaration)

        def fields(original):
            for field, value in original["paired_stats"].items():
                if field != "paired_count":
                    yield ("paired_stats", field), value + 2e-12 * max(1, abs(value))
            for name in ("x_values", "y_values"):
                for endpoint, value in enumerate(original["uncertainty"]["segments"][0][name]):
                    yield ("uncertainty", "segments", 0, name, endpoint), value + 2e-12 * abs(value)
        self.assert_comparison_fields_rejected(fields)

    def test_comparison_v3_null_correlation_is_valid_only_for_a_constant_side(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture_directory = root / "fixtures"
            shutil.copytree(ocean_report.DEFAULT_FIXTURE_DIRECTORY, fixture_directory)
            path = fixture_directory / "paired_observation_model.json"
            fixture = json.loads(path.read_bytes())
            for record in fixture["records"]:
                record["model_degC"] = 15.0
            path.write_text(json.dumps(fixture), encoding="utf-8")
            bundle = RuntimeBundle(root)
            bundle.capture_input_fixtures(fixture_directory)
            declaration = bundle.record_synthetic_comparison_plot_data_evidence(fixture_directory)
            self.assertIsNone(declaration["paired_stats"]["pearson_correlation"])
            self.assert_comparison_report(bundle, declaration, fixture_directory=fixture_directory)
            for name in ("report.md", "report-evidence.json"):
                (root / name).unlink()
            declaration["paired_stats"]["pearson_correlation"] = 0
            bundle.write_metadata()
            with self.assertRaises(ocean_report.ReportBuildError):
                ocean_report.build_ocean_report(root, fixture_directory)
            self.assertFalse((root / "report.md").exists())
            self.assertFalse((root / "report-evidence.json").exists())

    def test_comparison_v3_unbound_cannot_bypass_malformed_or_mismatched_evidence(self) -> None:
        self.assert_comparison_fields_rejected([
            (("fixture_sha256",), "0" * 64), (("schema_version",), 3.0),
            (("uncertainty", "segments", 5, "source_row"), True),
            (("input_values", "model", 11), None), (("paired_stats", "pearson_correlation"), None),
        ], bound=False)

    def test_comparison_v3_paired_snapshot_is_rechecked_after_report_render(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            bundle = RuntimeBundle(Path(directory))
            bundle.capture_input_fixtures()
            declaration = bundle.record_synthetic_comparison_plot_data_evidence()
            self.assert_comparison_report(bundle, declaration)
            for name in ("report.md", "report-evidence.json"):
                (bundle.root / name).unlink()
            snapshot = bundle.root / "fixture-inputs" / "paired_observation_model.json"
            original_render = ocean_report.render_report

            def change_snapshot(evidence):
                report = original_render(evidence)
                snapshot.write_bytes(snapshot.read_bytes() + b"\n")
                return report

            with mock.patch.object(ocean_report, "render_report", side_effect=change_snapshot), \
                    mock.patch.object(ocean_report, "write_outputs") as writer:
                with self.assertRaises(ocean_report.ReportBuildError):
                    ocean_report.build_ocean_report(bundle.root)
                writer.assert_not_called()


class RenderedAuditTests(unittest.TestCase):
    def assert_valid_audit(self, bundle: RuntimeBundle, audit: dict) -> tuple[Path, dict]:
        audit_path = bundle.write_simulated_rendered_audit(audit)
        result = ocean_report.build_ocean_report(bundle.root, rendered_audit=audit_path)
        self.assertEqual(result["status"], "passed")
        evidence = json.loads((bundle.root / "report-evidence.json").read_bytes())
        imported = evidence["runtime_evidence"]["rendered_audit"]
        self.assertIs(imported["provided"], True)
        self.assertEqual(imported["binding_status"], "passed")
        self.assertEqual(imported["status"], audit["status"])
        self.assertEqual(imported["source"]["bytes"], audit_path.stat().st_size)
        self.assertEqual(imported["source"]["sha256"], sha256(audit_path))
        self.assertEqual(imported["manifest"]["bytes"], (bundle.root / "figures.json").stat().st_size)
        self.assertEqual(imported["manifest"]["sha256"], sha256(bundle.root / "figures.json"))
        self.assertEqual(imported["summary"], audit["summary"])
        self.assertEqual({item["file"]: item["checks"] for item in imported["artifacts"]},
                         {item["file"]: item["checks"] for item in audit["artifacts"]})
        self.assertEqual(imported["scope"], "automated_artifact_checks_only")
        self.assertIs(imported["trusted_visual_audit"], False)
        self.assertFalse(evidence["runtime_evidence"]["visual_inspection"]["verified"])
        self.assertEqual(evidence["runtime_evidence"]["desktop_validation"]["status"], "not_performed")
        for figure in evidence["runtime_evidence"]["figures"]:
            self.assertEqual(figure["verification"]["visual_inspection"], "not_verified")
        return audit_path, imported

    def assert_invalid_audit(self, mutate, *, font_failure: bool = True) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            bundle.capture_input_fixtures()
            audit = bundle.simulated_rendered_audit(font_failure=font_failure)
            self.assert_valid_audit(bundle, audit)
            (root / "report.md").unlink()
            (root / "report-evidence.json").unlink()
            mutate(audit, bundle)
            bundle.write_metadata()
            audit_path = bundle.write_simulated_rendered_audit(audit)
            with mock.patch.object(ocean_report, "write_outputs", wraps=ocean_report.write_outputs) as writer:
                with self.assertRaises(ocean_report.ReportBuildError):
                    ocean_report.build_ocean_report(root, rendered_audit=audit_path)
                writer.assert_not_called()
            self.assertFalse((root / "report.md").exists())
            self.assertFalse((root / "report-evidence.json").exists())

    @staticmethod
    def pdf_check(audit: dict, name: str) -> dict:
        artifact = next(item for item in audit["artifacts"] if item["format"] == "pdf")
        return next(check for check in artifact["checks"] if check["name"] == name)

    def test_valid_simulated_failed_audit_generates_report_with_font_failures_in_front(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            bundle.capture_input_fixtures()
            audit = bundle.simulated_rendered_audit()
            _, imported = self.assert_valid_audit(bundle, audit)
            self.assertEqual(imported["summary"], {"passed": 8, "failed": 4, "not_verified": 0, "artifact_count": 12})
            self.assertIn("NOT actual inspector evidence", audit["limitations"])
            report = (root / "report.md").read_text(encoding="utf-8")
            front = "\n## ".join(report.split("\n## ", 2)[:2])
            self.assertIn("failed", front)
            self.assertEqual(report.replace(r"\_", "_").count("pdf_font_embedding=failed"), 4)
            self.assertEqual(report.count("embedded=no"), 4)
            for artifact in audit["artifacts"]:
                if artifact["format"] == "pdf":
                    self.assertIn(artifact["file"], report)
            self.assertIs(imported["trusted_visual_audit"], False)

    def test_valid_simulated_passed_audit_still_is_not_a_visual_or_execution_audit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            bundle = RuntimeBundle(Path(directory))
            audit = bundle.simulated_rendered_audit(font_failure=False)
            _, imported = self.assert_valid_audit(bundle, audit)
            self.assertEqual(imported["summary"], {"passed": 12, "failed": 0, "not_verified": 0, "artifact_count": 12})
            self.assertIs(imported["trusted_visual_audit"], False)

    def test_no_argument_keeps_rendered_audit_unverified(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            bundle.write_simulated_rendered_audit(bundle.simulated_rendered_audit())
            result = ocean_report.build_ocean_report(root)
            self.assertEqual(result["status"], "passed")
            evidence = json.loads((root / "report-evidence.json").read_bytes())
            imported = evidence["runtime_evidence"]["rendered_audit"]
            self.assertIs(imported["provided"], False)
            self.assertEqual(imported["status"], "not_verified")
            self.assertIs(imported["trusted_visual_audit"], False)

    def test_valid_simulated_text_not_verified_cannot_be_promoted_to_passed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            bundle = RuntimeBundle(Path(directory))
            audit = bundle.simulated_rendered_audit(font_failure=False)
            check = self.pdf_check(audit, "pdf_text_integrity")
            check["status"] = "not_verified"
            check["labels"][0].update(status="not_verified", matching_pages=[])
            text = "Unrelated simulated extraction"
            page = self.pdf_check(audit, "pdf_text_extractability")["pages"][0]
            page.update(text_excerpt=text, word_count=len(text.split()),
                        normalized_text_sha256=hashlib.sha256(text.encode("utf-8")).hexdigest())
            bundle.recount_simulated_audit(audit)
            _, imported = self.assert_valid_audit(bundle, audit)
            self.assertEqual(imported["status"], "not_verified")
            self.assertEqual(imported["summary"]["not_verified"], 1)

    def test_cli_explicit_simulated_failed_audit_is_a_successful_report_not_visual_pass(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = RuntimeBundle(root)
            audit_path = bundle.write_simulated_rendered_audit(bundle.simulated_rendered_audit())
            process = subprocess.run([sys.executable, "-B", str(MODULE_PATH), "--runtime-output", str(root),
                                      "--rendered-audit", str(audit_path)], text=True,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
            self.assertEqual(process.returncode, 0, process.stderr)
            self.assertEqual(json.loads(process.stdout)["status"], "passed")
            evidence = json.loads((root / "report-evidence.json").read_bytes())
            self.assertEqual(evidence["runtime_evidence"]["rendered_audit"]["status"], "failed")
            self.assertIs(evidence["runtime_evidence"]["rendered_audit"]["trusted_visual_audit"], False)

    def test_explicit_missing_or_invalid_audit_cannot_fall_back_to_no_argument(self) -> None:
        for kind in ("missing", "empty", "invalid_json", "directory", "symlink"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                audit_path, _ = self.assert_valid_audit(bundle, bundle.simulated_rendered_audit())
                (root / "report.md").unlink()
                (root / "report-evidence.json").unlink()
                original = audit_path.read_bytes()
                audit_path.unlink()
                if kind in {"empty", "invalid_json"}:
                    audit_path.write_bytes(b"" if kind == "empty" else b'{"status":')
                elif kind == "directory":
                    audit_path.mkdir()
                elif kind == "symlink":
                    target = root / "audit-target.json"
                    target.write_bytes(original)
                    audit_path.symlink_to(target)
                with self.assertRaises(ocean_report.ReportBuildError):
                    ocean_report.build_ocean_report(root, rendered_audit=audit_path)
                self.assertFalse((root / "report.md").exists())
                self.assertFalse((root / "report-evidence.json").exists())

    def test_root_and_artifact_passes_cannot_contradict_font_failure_leaves(self) -> None:
        def mutate(audit, bundle):
            audit["status"] = "passed"
            audit["summary"] = {"passed": 12, "failed": 0, "not_verified": 0, "artifact_count": 12}
            for artifact in audit["artifacts"]:
                artifact["status"] = "passed"
        self.assert_invalid_audit(mutate)

    def test_deleted_font_failure_checks_cannot_create_a_pass(self) -> None:
        for remove_inventory in (False, True):
            with self.subTest(remove_inventory=remove_inventory):
                def mutate(audit, bundle):
                    removed = {"pdf_font_embedding", "pdf_font_inventory"} if remove_inventory else {"pdf_font_embedding"}
                    for artifact in audit["artifacts"]:
                        artifact["checks"] = [check for check in artifact["checks"] if check["name"] not in removed]
                    bundle.recount_simulated_audit(audit)
                    self.assertEqual(audit["status"], "passed")
                self.assert_invalid_audit(mutate)

    def test_audit_byte_hash_and_snapshot_maps_must_match_current_files(self) -> None:
        for field in ("manifest_bytes", "manifest_sha256", "artifact_bytes", "artifact_sha256",
                      "coherent_false_hash", "map_missing", "map_extra", "pdf_snapshot"):
            with self.subTest(field=field):
                def mutate(audit, bundle):
                    artifact = audit["artifacts"][0]
                    if field == "manifest_bytes":
                        audit[field] += 1
                    elif field == "manifest_sha256":
                        audit[field] = "0" * 64
                    elif field == "artifact_bytes":
                        artifact["bytes"] += 1
                    elif field in {"artifact_sha256", "coherent_false_hash"}:
                        artifact["sha256"] = "0" * 64
                        if field == "coherent_false_hash":
                            audit["artifact_sha256"][artifact["file"]] = artifact["sha256"]
                    elif field == "map_missing":
                        del audit["artifact_sha256"][artifact["file"]]
                    elif field == "map_extra":
                        audit["artifact_sha256"]["unregistered.pdf"] = "0" * 64
                    else:
                        self.pdf_check(audit, "pdf_text_integrity")["snapshot_sha256"] = "0" * 64
                self.assert_invalid_audit(mutate)

    def test_artifact_identity_coverage_and_duplicates_are_rejected(self) -> None:
        for operation in ("missing", "duplicate", "duplicate_identity", "wrong_id", "wrong_format", "wrong_file"):
            with self.subTest(operation=operation):
                def mutate(audit, bundle):
                    if operation == "missing":
                        removed = audit["artifacts"].pop()
                        del audit["artifact_sha256"][removed["file"]]
                    elif operation == "duplicate":
                        audit["artifacts"].append(copy.deepcopy(audit["artifacts"][0]))
                    elif operation == "duplicate_identity":
                        audit["artifacts"][3]["figure_id"] = audit["artifacts"][0]["figure_id"]
                    else:
                        field = {"wrong_id": "figure_id", "wrong_format": "format", "wrong_file": "file"}[operation]
                        audit["artifacts"][0][field] = {"wrong_id": "unknown", "wrong_format": "pdf",
                                                       "wrong_file": "other.png"}[operation]
                    bundle.recount_simulated_audit(audit)
                self.assert_invalid_audit(mutate)

    def test_numeric_and_status_types_do_not_accept_boolean_equality(self) -> None:
        for path, value in (
            (("schema_version",), True), (("schema_version",), 1.0), (("schema_version",), "1"),
            (("manifest_bytes",), True), (("artifacts", 0, "bytes"), False),
            (("summary", "not_verified"), False), (("summary", "failed"), "4"),
            (("status",), True), (("artifacts", 0, "status"), "success"),
            (("artifacts", 0, "checks", 0, "status"), None),
            (("policy", "pdf_dimension_tolerance_pt"), True),
        ):
            with self.subTest(path=path, value=value):
                def mutate(audit, bundle):
                    target = audit
                    for key in path[:-1]:
                        target = target[key]
                    target[path[-1]] = value
                self.assert_invalid_audit(mutate)
        with self.subTest(check="pdf_structure", field="page_dimensions[0].page", value=True):
            def mutate(audit, bundle):
                self.pdf_check(audit, "pdf_structure")["page_dimensions"][0]["page"] = True
            self.assert_invalid_audit(mutate)

    def test_font_inventory_cannot_contradict_a_passed_embedding_check(self) -> None:
        for embedded in ("no", False, True):
            with self.subTest(embedded=embedded):
                def mutate(audit, bundle):
                    self.pdf_check(audit, "pdf_font_inventory")["fonts"][0]["embedded"] = embedded
                self.assert_invalid_audit(mutate, font_failure=False)

    def test_text_labels_must_cover_current_manifest_and_use_strict_counts(self) -> None:
        for operation in ("missing", "empty", "wrong_title", "duplicate", "boolean_count"):
            with self.subTest(operation=operation):
                def mutate(audit, bundle):
                    check = self.pdf_check(audit, "pdf_text_integrity")
                    if operation == "missing":
                        del check["labels"]
                    elif operation == "empty":
                        check.update(labels=[], expected_count=0)
                    elif operation == "wrong_title":
                        check["labels"][0].update(expected="Unrelated old title", normalized="Unrelated old title")
                    elif operation == "duplicate":
                        check["labels"].append(copy.deepcopy(check["labels"][0]))
                        check["expected_count"] = 2
                    else:
                        check["expected_count"] = True
                self.assert_invalid_audit(mutate)

    def test_nested_text_failure_cannot_be_hidden_by_passed_check(self) -> None:
        def mutate(audit, bundle):
            self.pdf_check(audit, "pdf_text_integrity")["labels"][0].update(status="failed", matching_pages=[])
        self.assert_invalid_audit(mutate, font_failure=False)

    def test_changed_manifest_metadata_invalidates_audit_without_changing_exports(self) -> None:
        def mutate(audit, bundle):
            bundle.manifest["generator"] += " changed after inspection"
            for artifact in audit["artifacts"]:
                self.assertEqual(sha256(bundle.root / artifact["file"]), artifact["sha256"])
        self.assert_invalid_audit(mutate)

    def test_old_absolute_provenance_paths_are_preserved_without_access_or_execution(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            bundle = RuntimeBundle(Path(directory))
            audit = bundle.simulated_rendered_audit()
            original_open, original_stat, original_lstat = Path.open, Path.stat, Path.lstat

            def guarded_open(path, *args, **kwargs):
                self.assertFalse(str(path).startswith("/previous-runner/"), f"opened provenance path: {path}")
                return original_open(path, *args, **kwargs)

            def guarded_stat(path, *args, **kwargs):
                self.assertFalse(str(path).startswith("/previous-runner/"), f"probed provenance path: {path}")
                return original_stat(path, *args, **kwargs)

            def guarded_lstat(path, *args, **kwargs):
                self.assertFalse(str(path).startswith("/previous-runner/"), f"probed provenance path: {path}")
                return original_lstat(path, *args, **kwargs)

            with mock.patch.object(Path, "open", guarded_open), mock.patch.object(Path, "stat", guarded_stat), \
                    mock.patch.object(Path, "lstat", guarded_lstat), \
                    mock.patch.object(subprocess, "Popen", side_effect=AssertionError("report must not rerun inspector tools")):
                _, imported = self.assert_valid_audit(bundle, audit)
            self.assertEqual(imported["provenance"], "external_inspector_declaration")
            self.assertEqual(imported["source"]["declared_manifest"], audit["manifest"])
            self.assertEqual(imported["source"]["declared_artifact_root"], audit["artifact_root"])

    def test_absolute_or_escaping_artifact_files_are_not_provenance_paths(self) -> None:
        for path in ("/previous-runner/unit-fixture/figure.png", "../figure.png", "nested/../../figure.png"):
            with self.subTest(path=path):
                def mutate(audit, bundle):
                    audit["artifacts"][0]["file"] = path
                self.assert_invalid_audit(mutate)

    def test_audit_snapshot_is_rechecked_before_report_write(self) -> None:
        for operation in ("bytes", "delete", "symlink"):
            with self.subTest(operation=operation), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = RuntimeBundle(root)
                audit_path, _ = self.assert_valid_audit(bundle, bundle.simulated_rendered_audit())
                (root / "report.md").unlink()
                (root / "report-evidence.json").unlink()
                original = audit_path.read_bytes()
                original_render = ocean_report.render_report

                def change_after_render(evidence):
                    report = original_render(evidence)
                    if operation == "bytes":
                        audit_path.write_bytes(original + b"\n")
                    else:
                        audit_path.unlink()
                        if operation == "symlink":
                            target = root / "replacement-audit.json"
                            target.write_bytes(original)
                            audit_path.symlink_to(target)
                    return report

                with mock.patch.object(ocean_report, "render_report", side_effect=change_after_render), \
                        mock.patch.object(ocean_report, "write_outputs", wraps=ocean_report.write_outputs) as writer:
                    with self.assertRaises(ocean_report.ReportBuildError):
                        ocean_report.build_ocean_report(root, rendered_audit=audit_path)
                    writer.assert_not_called()
                self.assertFalse((root / "report.md").exists())
                self.assertFalse((root / "report-evidence.json").exists())

    def test_scope_and_visual_claims_cannot_promote_automated_evidence(self) -> None:
        for field, value in (("evidence_type", "human_visual_audit"), ("scope", "complete_visual_approval"),
                             ("human_visual_inspection", "passed"), ("desktop_interaction", "passed"),
                             ("cjk_glyph_rendering", "passed"), ("matlab_execution", "passed")):
            with self.subTest(field=field, value=value):
                def mutate(audit, bundle):
                    audit[field] = value
                self.assert_invalid_audit(mutate, font_failure=False)


if __name__ == "__main__":
    unittest.main()
