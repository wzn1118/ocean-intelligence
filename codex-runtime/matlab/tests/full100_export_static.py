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
    "ByteMismatch", "HashMismatch", "oi_sha256_file", "ActualPdfDimensions",
    "invalidPhysicalEntry", "1 / 720", "test_native_raster_aspect",
    "RasterSourceChanged", "RasterAspectDistortion", "curveMask",
]:
    assert marker in test_text, f"full100 export test missing {marker}"
probe_text = TEST.with_name("diagnose_native_raster_sizes.m").read_text(encoding="utf-8")
for marker in [
    'verLessThan(\'matlab\', \'25.1\')', '"unsupported_release"',
    '[400 300 150; 1200 675 180; 997 613 300]',
    '["pixels" "inches"]', '["on" "off"]', '"Padding", "figure"',
    'record.api_invoked = true', 'record.export_call_succeeded = true',
    '"visual_verified", false', '"layout_verified", false',
    '"figure_before_export"', '"figure_after_export"', 'imfinfo(filePath)',
    'oi_sha256_file(filePath)', '"completed_diagnostics_only"',
]:
    assert marker in probe_text, f"native raster probe missing {marker}"
assert "imresize(" not in probe_text
runner_text = TEST.with_name("run_github_full100.m").read_text(encoding="utf-8")
assert 'diagnose_native_raster_sizes(fullfile(export_directory, "native-raster-sizing-probe"))' in runner_text
assert 'diagnose_svg_print_sizes(fullfile(export_directory, "svg-print-sizes-probe"))' in runner_text
svg_probe = TEST.with_name("diagnose_svg_print_sizes.m").read_text(encoding="utf-8")
for marker in [
    '"default", "explicit-resolution"', '"requested_print_options"',
    '"invoked_print_options"', '"native_file_unchanged_after_xml"',
    '"exact_page_verified", false', '"visual_verified", false',
    'xmlread(', 'oi_sha256_file(', "'-dsvg', '-painters', resolutionOption",
    '"rectangles", struct("node_name", {}, "attributes", {}, "ancestors_nearest_first", {})',
    '"clip_paths", struct("element", {}, "descendants", {})',
]:
    assert marker in svg_probe, f"native SVG probe missing {marker}"
assert "xmlwrite(" not in svg_probe
assert "oi_annotate_svg(" not in svg_probe
display_test = TEST.with_name("test_display_rendering.m").read_text(encoding="utf-8")
assert 'diagnose_svg_print_sizes(fullfile(outputDirectory, "svg-print-sizes-probe"))' in display_test
print("MATLAB_FULL100_EXPORT_STATIC=passed")
