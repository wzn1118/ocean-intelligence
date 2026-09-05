#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "matlab" / "assets"
TEST = Path(__file__).with_name("full100_export_contracts.m")

required = {
    "oi_export_figure.m": [
        "physical_dimensions_verified", "png_embedded_dpi_verified",
        "png_physical_dpi", "pdf_geometry", "apply_export_font",
        "color_accessibility_audit", "oi_annotate_svg", "ExportSVG",
    ],
    "oi_annotate_svg.m": ["xmlread", "xmlwrite", "viewBox", "aria-label", "setAttribute"],
    "oi_write_manifest.m": [
        "validate_artifact_evidence", "assert_artifacts_unchanged",
        "validate_written_manifest", "PhysicalSizeMismatch", "movefile",
    ],
    "oi_sha256_file.m": ["MessageDigest", "fread", "FileChanged"],
    "oi_ocean_theme.m": ["CJK-capable", "LineStyles", "Markers"],
}
for name, markers in required.items():
    text = (ASSETS / name).read_text(encoding="utf-8")
    for marker in markers:
        assert marker in text, f"{name} missing {marker}"
test_text = TEST.read_text(encoding="utf-8")
for marker in [
    "embedded_dpi_x", "exports.pdf.width", "svgRecord.width", "assert_svg_geometry",
    "ByteMismatch", "HashMismatch", "oi_sha256_file",
]:
    assert marker in test_text, f"full100 export test missing {marker}"
print("MATLAB_FULL100_EXPORT_STATIC=passed")
