from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "build_ocean_report.py"
SPEC = importlib.util.spec_from_file_location("build_ocean_report", MODULE_PATH)
assert SPEC and SPEC.loader
ocean_report = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ocean_report)


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
                "title": identifier,
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
        return {
            "id": identifier,
            "title": identifier,
            "source": "synthetic fixture",
            "theme": "Ocean Intelligence",
            "runtime": {"matlab_release": self.writer_release},
            "scientific_data_contract": {
                "schemaVersion": 1,
                "provided": True,
                "required": True,
                "dataType": "synthetic_fixture",
                "shape": shape,
                "units": {"value": unit},
                "missing": {
                    "status": "present",
                    "policy": "preserve",
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


class OceanReportTests(unittest.TestCase):
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
            RuntimeBundle(root)
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


if __name__ == "__main__":
    unittest.main()
