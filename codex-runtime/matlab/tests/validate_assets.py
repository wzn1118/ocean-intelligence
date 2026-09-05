#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path


MATLAB_DIR = Path(__file__).resolve().parents[1]
ASSET_DIR = MATLAB_DIR / "assets"
TEST_DIR = MATLAB_DIR / "tests"
ROUTER_PATH = MATLAB_DIR.parent / "server" / "matlab-plot-router.mjs"
REGRESSION_RUNNER_PATH = MATLAB_DIR.parents[1] / "scripts" / "matlab-plot-regression.sh"

EXPECTED_ASSETS = {
    "oi_annotate_svg.m",
    "oi_text_bounds.m",
    "oi_font_available.m",
    "oi_color_accessibility_audit.m",
    "interactive_timeseries_native_template.m",
    "oi_apply_axes.m",
    "oi_apply_color_scale.m",
    "oi_export_figure.m",
    "oi_figure.m",
    "oi_get_option.m",
    "oi_hold_axes.m",
    "oi_ocean_theme.m",
    "oi_require_text.m",
    "oi_read_file_prefix.m",
    "oi_sha256_file.m",
    "oi_plot_comparison.m",
    "oi_plot_direction_rose.m",
    "oi_plot_hovmoller.m",
    "oi_plot_profile.m",
    "oi_plot_section.m",
    "oi_plot_spectrum.m",
    "oi_plot_time_series.m",
    "oi_plot_ts_diagram.m",
    "oi_plot_vector_field.m",
    "oi_write_manifest.m",
}

PLOT_ASSETS = {
    "oi_plot_profile.m",
    "oi_plot_section.m",
    "oi_plot_hovmoller.m",
    "oi_plot_time_series.m",
    "oi_plot_ts_diagram.m",
    "oi_plot_spectrum.m",
    "oi_plot_direction_rose.m",
    "oi_plot_vector_field.m",
    "oi_plot_comparison.m",
}

DIRECT_REGRESSION_PLOT_ASSETS = {
    "oi_plot_time_series.m",
}

COMMON_PLOT_CONTRACT = [
    "Input contract:",
    "MissingPolicy",
    "NaN",
    "Unit",
    "ValidCount",
    "MissingCount",
    "oi_apply_axes",
    "oi_require_text",
]

SPECIAL_REQUIREMENTS = {
    "interactive_timeseries_native_template.m": [
        "arguments",
        "TimeZone",
        "NaN",
        "DataTipTemplate",
        "ObservationID, Station, and QCFlag",
        "ActionPostCallback",
        "BrushData",
        "SelectedObservationIDs",
        "normalize_observation_ids",
        "data_index > numel(target.YData)",
        "DataCursorUpdateFcn",
        "OceanCallerOwnsFigure",
        "close_unowned_figure",
        "is_live_handle",
        "HeadlessFallback",
        "linkaxes(axes_handles, 'x')",
        "linkdata(figure_handle, 'off')",
        "options.Export",
        "oi_export_figure",
        "exportapp",
        "ExportMode",
        'ExportMode="graphics" requires UseUIFigure=false',
        "options.ExportSVG",
        "options.RequiredToolboxes",
        'SVG app export is unsupported',
        "isfile(",
        "dir(",
        "ValueUnit",
        "oi_export_figure",
        "ManifestEntry",
        "Station and QCFlag must be nonmissing",
        "QCSummary",
        "QCPolicy",
        "VariableUnits",
        "UnitMismatch",
        "ConfidenceLevel",
        "allowed_uncertainty_types",
        "UncertaintyMissingCount",
        "resolve_interaction_font",
        "listfonts",
        "CJKFontUnavailable",
        "Padding', 'loose'",
        "PublicationExport",
        "ExportPerformed",
        "FontRenderingVerified",
        "safe nonempty file stem",
        "SecondaryValue metadata must be omitted",
    ],
    "oi_plot_profile.m": ["YDir = \"reverse\"", "positive down", "MissingMask", "LineStyle", "eastoutside", "oi_hold_axes", "oi_get_option(options, \"QuantityLabel\", \"\")", "oi_get_option(options, \"DepthUnit\", \"\")", "oi_get_option(options, \"VerticalReference\", \"\")"],
    "oi_plot_section.m": ["contourf", "ColorLimits", "Interpolated", "MissingMask", "oi_apply_color_scale", "eastoutside", "oi_get_option(options, \"DistanceUnit\", \"\")", "oi_get_option(options, \"DepthUnit\", \"\")", "oi_get_option(options, \"QuantityLabel\", \"\")"],
    "oi_plot_hovmoller.m": ["datetime", "TimeZone", "R2023b", "AlphaData", "ColorLimits", "Interpolated", "oi_apply_color_scale", "eastoutside", "oi_get_option(options, \"DepthUnit\", \"\")", "oi_get_option(options, \"QuantityLabel\", \"\")"],
    "oi_plot_time_series.m": [
        "istable(data) || istimetable(data)",
        "TimeZone",
        "diff(rowTimes) > seconds(0)",
        "GapThreshold",
        "insert_gap_breaks",
        "QCVariables",
        "AcceptedQCValues",
        "QCRejectedCount",
        "GapCount",
        "UncertaintyType",
        "ConfidenceLevel",
        "VariableUnits",
        "DataTipTemplate",
        "oi_hold_axes",
    ],
    "oi_plot_ts_diagram.m": ["DensityValues", "CompleteMask", "DataTipTemplate", "ColorLimits", "oi_apply_color_scale", "eastoutside", "DensityLevels must be a finite scalar or strictly increasing vector", "oi_hold_axes", "oi_get_option(options, \"ColorLabel\", \"\")", "oi_get_option(options, \"ColorUnit\", \"\")"],
    "oi_plot_spectrum.m": ["precomputed", "frequencyValues > 0", "loglog", "contiguous_segments", "DegreesOfFreedom", "BoundMaskMismatch", "BoundType", "ConfidenceLevel", "BoundStatus", "MissingBoundCount", "isreal(lowerBound)", "oi_hold_axes"],
    "oi_plot_direction_rose.m": ["DirectionConvention", "ThetaZeroLocation", "ThetaDir", "Weights", "Normalization", "OI_AxisLabels", "degreeUnits", "WeightsRequired", "matlab.graphics.axis.PolarAxes"],
    "oi_plot_vector_field.m": ["MaskMismatch", "quiver", "Stride", "ReferenceMagnitude", "hypot", "isnumeric(stride)", "oi_get_option(options, \"ComponentFrame\", \"\")", "oi_get_option(options, \"XLabel\", \"\")", "oi_get_option(options, \"YLabel\", \"\")"],
    "oi_plot_comparison.m": ["OneToOne", "Bias", "MAE", "RMSE", "Correlation", "DataTipTemplate", "MetricOverflow", "LimitOverflow", "oi_hold_axes"],
    "oi_export_figure.m": ["exportgraphics", ".png", ".pdf", ".svg", "-dsvg", "bytes > 0", "oi_read_file_prefix", "oi_sha256_file", "imfinfo", "StaleArtifact", "print(", "ExportSVG", "RequiredToolboxes", "MissingToolbox", "UnsupportedRelease", "EmptyTitle", "EmptyProvenance", "InvalidArtifactSignature", "minimum_release", "R2019b", "25.1", "has_direct_svg_export", "installed_toolboxes", "toolbox_installation_verified", "toolbox_license_verified", "toolbox_invocation_verified", "export_api", "export_device", "headless_static_export", "oi_annotate_svg", "accessibility", "ContrastRatio", "bounds_units", "normalized", "ClippedContent", "OverlappingText", "normalized_margins", "foreground_color", "background_color", "rendering_evidence", "drawnow_completed", "visual_inspection_verified", "pdf_font_embedding_verified", "entry.publication", "entry.interaction", "CJKFontUnavailable", "artifactCleanup", "delete_artifacts"],
    "oi_annotate_svg.m": ["xmlread", "xmlwrite", "viewBox", "aria-label", "setAttribute"],
    "oi_text_bounds.m": ["getpixelposition", "Extent", "onCleanup", "FigureMismatch"],
    "oi_font_available.m": ["listfonts", "fc-match", "shellArgument", "strcmpi"],
    "oi_color_accessibility_audit.m": ["HandleVisibility", "finite_data_count", "continuous_color_status", "categorical_status"],
    "oi_write_manifest.m": ["jsonencode", 'schema_version\", 2', "generated_at", "oi_read_file_prefix", "oi_sha256_file", "ByteMismatch", "HashMismatch", "movefile", "runtime_status", "execution_verified", "artifact_validation", "visual_inspection", "matlab_release", "minimum_matlab_release", "export_formats", "export_strategies", "runtime_contract", "octave_substitution_allowed", "installed_toolboxes", "required_toolboxes", "toolbox_verification_scope", "toolbox_license_verified", "toolbox_invocation_verified", "toolboxes", "desktop_independent", "matlab -batch", "InvalidPng", "InvalidPdf", "InvalidSvg", "xmlread", "rendering_evidence", "RenderingEvidence", "RuntimeEvidence", "ExportApiMismatch", "MetadataMismatch", "UnsafeExportPath", "canonical_path", "is_within_directory", "text_overlap_count", "normalized_margins", "pdf_font_embedding_verified", "PublicationEvidence", "InteractionEvidence"],
    "oi_ocean_theme.m": ["SequentialMap", "DivergingMap", "MissingColor", "listfonts", "Noto Sans CJK TC", "CJK-capable"],
    "oi_figure.m": ["DefaultAxesColorOrder", "Visible", "Position"],
    "oi_apply_axes.m": ["style_axis_text", "style_named_text", "Clipping", "LabelSize", "TitleSize"],
    "oi_apply_color_scale.m": ["InvalidColormap", "InvalidMissingColor", "colormap", "clim", "caxis", "Label.Interpreter"],
    "oi_hold_axes.m": ["onCleanup", "NextPlot", "restore_next_plot"],
    "oi_require_text.m": ["isstring", "iscellstr", "ischar", "ismissing", "strtrim", "whitespace-only"],
    "oi_read_file_prefix.m": ["uint8", "maximumBytes", "fread", "EmptyFile", "onCleanup"],
    "oi_sha256_file.m": ["SHA-256", "MessageDigest", "fread", "EmptyFile", "JVMRequired"],
}

FORBIDDEN_PATTERNS = {
    r"\bgca\s*\(": "implicit current axes",
    r"\bgcf\s*\(": "implicit current figure",
    r"\bsubplot\s*\(": "legacy implicit layout",
    r"\bjet\s*\(": "rainbow colormap",
    r"\bfillmissing\s*\(": "silent missing-value filling",
    r"\bOCTAVE_VERSION\b": "Octave compatibility branch",
    r"/root/|/tmp/|/opt/": "host absolute path",
}

TOOLBOX_DEPENDENT_CALLS = {
    r"\bpwelch\s*\(": "Signal Processing Toolbox pwelch",
    r"\bspectrogram\s*\(": "Signal Processing Toolbox spectrogram",
    r"\bisoutlier\s*\(": "Statistics and Machine Learning Toolbox isoutlier",
    r"\bfilloutliers\s*\(": "Statistics and Machine Learning Toolbox filloutliers",
    r"\bgeo(?:axes|scatter|plot)\s*\(": "Mapping Toolbox geographic graphics",
    r"\b(?:gsw_|sw_dens)": "external oceanographic toolbox",
}


def fail(message: str, failures: list[str]) -> None:
    failures.append(message)


def validate() -> list[str]:
    failures: list[str] = []
    discovered = {path.name for path in ASSET_DIR.glob("*.m")}
    for name in sorted(EXPECTED_ASSETS - discovered):
        fail(f"missing asset: {name}", failures)
    for name in sorted(discovered - EXPECTED_ASSETS):
        fail(f"asset lacks static contract: {name}", failures)

    for path in sorted(ASSET_DIR.glob("*.m")):
        text = path.read_text(encoding="utf-8")
        if not text.isascii():
            fail(f"{path.name}: MATLAB source must remain ASCII", failures)
        match = re.search(r"(?m)^function\s+(?:(?:\[[^\]]+\]|\w+)\s*=\s*)?(\w+)\s*\(", text)
        if not match:
            fail(f"{path.name}: missing top-level function", failures)
            continue
        if match.group(1) != path.stem:
            fail(f"{path.name}: function name is {match.group(1)}", failures)
        for pattern, label in FORBIDDEN_PATTERNS.items():
            if re.search(pattern, text, re.IGNORECASE):
                fail(f"{path.name}: contains {label}", failures)
        if re.search(r"FontName\s*[,=]\s*['\"](?:Helvetica|Arial)['\"]", text):
            fail(f"{path.name}: contains an unverified Latin-only font fallback", failures)
        for snippet in SPECIAL_REQUIREMENTS.get(path.name, []):
                if snippet not in text:
                    fail(f"{path.name}: missing {snippet}", failures)
        if path.name in PLOT_ASSETS:
            for snippet in COMMON_PLOT_CONTRACT:
                if snippet not in text:
                    fail(f"{path.name}: missing ocean contract {snippet}", failures)
            for pattern, label in TOOLBOX_DEPENDENT_CALLS.items():
                if re.search(pattern, text, re.IGNORECASE):
                    fail(f"{path.name}: undeclared toolbox dependency: {label}", failures)

    interactive_text = (ASSET_DIR / "interactive_timeseries_native_template.m").read_text(encoding="utf-8")
    if "graphics export requires MATLAB R2020a" in interactive_text:
        fail("interactive template blocks the documented R2019b print fallback", failures)

    regression_path = TEST_DIR / "run_plot_regression.m"
    contract_test_path = TEST_DIR / "test_asset_contracts.m"
    adversarial_test_path = TEST_DIR / "test_asset_adversarial_contracts.m"
    regression_text = ""
    contract_text = ""
    adversarial_text = ""
    if not regression_path.is_file():
        fail("missing MATLAB regression entry: run_plot_regression.m", failures)
    else:
        regression_text = regression_path.read_text(encoding="utf-8")
        for snippet in ["addpath(asset_directory)", "test_asset_contracts()", "test_asset_adversarial_contracts()", "oi_plot_time_series", "oi_require_text", "oi_write_manifest", "scientific_data_contract", "ExportSVG", '".svg"', "MATLAB_ASSET_REGRESSION_FIGURES", "sort(figure_ids)"]:
            if snippet not in regression_text:
                fail(f"run_plot_regression.m: missing end-to-end marker {snippet}", failures)
    if not contract_test_path.is_file():
        fail("missing MATLAB contract test: test_asset_contracts.m", failures)
    else:
        contract_text = contract_test_path.read_text(encoding="utf-8")
        for snippet in ["oi_hold_axes", "oi_apply_color_scale", "oi_plot_time_series", "series_result.GapCount", "series_result.QCRejectedCount", "DisplayTimeZone", "oi_read_file_prefix", "oi_sha256_file", "ExportSVG", "MissingToolbox", "RuntimeEvidence", "MetadataMismatch", "UnsafeExportPath", "forged description", "ContrastRatio", "cleanup-on-failure", "partial artifacts", "entry.exports.svg.export_api", "export_formats", "MATLAB_ASSET_VERSION_EXPORT"]:
            if snippet not in contract_text:
                fail(f"test_asset_contracts.m: missing version/export test {snippet}", failures)
    if not adversarial_test_path.is_file():
        fail("missing MATLAB adversarial test: test_asset_adversarial_contracts.m", failures)
    else:
        adversarial_text = adversarial_test_path.read_text(encoding="utf-8")
        for helper in sorted(PLOT_ASSETS):
            if helper[:-2] not in adversarial_text:
                fail(f"test_asset_adversarial_contracts.m: missing attack for {helper}", failures)
        for snippet in ["oi_plot_time_series", "AcceptedQCValues", "overflowTable", "oi_require_text", "MetricOverflow", "DensityLevels", "ishold", "realmax", "tempdir", "findall(groot", "MATLAB_ASSET_ADVERSARIAL_CASES", "MATLAB_ASSET_BILINGUAL_CONTRACT"]:
            if snippet not in adversarial_text:
                fail(f"test_asset_adversarial_contracts.m: missing adversarial marker {snippet}", failures)
    for path in sorted(TEST_DIR.glob("*.m")):
        if not path.read_text(encoding="utf-8").isascii():
            fail(f"{path.name}: MATLAB test source must remain ASCII", failures)

    wiring_text = "\n".join(
        path.read_text(encoding="utf-8")
        for path in sorted([*ASSET_DIR.glob("*.m"), *TEST_DIR.glob("*.m")])
    )
    for name in sorted(EXPECTED_ASSETS):
        function_name = name[:-2]
        if len(re.findall(rf"\b{re.escape(function_name)}\s*\(", wiring_text)) < 2:
            fail(f"{name}: asset is not connected outside its declaration", failures)
    plot_text = "\n".join(
        (ASSET_DIR / name).read_text(encoding="utf-8") for name in sorted(PLOT_ASSETS)
    )
    if "function style_colorbar" in plot_text:
        fail("plot assets retain a duplicate local colorbar implementation", failures)
    if "originalNextPlot = axesHandle.NextPlot" in plot_text:
        fail("plot assets retain a duplicate local hold-state implementation", failures)
    export_manifest_text = "\n".join([
        (ASSET_DIR / "oi_export_figure.m").read_text(encoding="utf-8"),
        (ASSET_DIR / "oi_write_manifest.m").read_text(encoding="utf-8"),
    ])
    if "function digest = sha256_file" in export_manifest_text:
        fail("export assets retain a duplicate local SHA-256 implementation", failures)
    if "function prefix = read_prefix" in export_manifest_text:
        fail("export assets retain a duplicate local prefix-reader implementation", failures)

    if not REGRESSION_RUNNER_PATH.is_file():
        fail("missing MATLAB regression shell runner", failures)
    else:
        runner_text = REGRESSION_RUNNER_PATH.read_text(encoding="utf-8")
        for snippet in ["requireSvg: true", "requireRuntimeContract: true", "requireMatlab: true"]:
            if snippet not in runner_text:
                fail(f"matlab-plot-regression.sh: missing strict check {snippet}", failures)

    if not ROUTER_PATH.is_file():
        fail("missing MATLAB plot router registration", failures)
    else:
        router_text = ROUTER_PATH.read_text(encoding="utf-8")
        if not DIRECT_REGRESSION_PLOT_ASSETS <= PLOT_ASSETS:
            fail("direct regression plot assets must be registered in PLOT_ASSETS", failures)
        for name in sorted(PLOT_ASSETS - DIRECT_REGRESSION_PLOT_ASSETS):
            helper = name[:-2]
            if helper not in router_text or f"{helper}.m" not in router_text:
                fail(f"router is missing registration for {name}", failures)
        for name in sorted(DIRECT_REGRESSION_PLOT_ASSETS):
            helper = name[:-2]
            if helper not in regression_text:
                fail(f"run_plot_regression.m: missing direct plot registration for {name}", failures)
            if helper not in contract_text:
                fail(f"test_asset_contracts.m: missing direct plot contract for {name}", failures)
            if helper not in adversarial_text:
                fail(f"test_asset_adversarial_contracts.m: missing direct plot attack for {name}", failures)
        for snippet in ["addpath(assetDirectory)", "plotResult.ValidCount", "oi_export_figure", "oi_write_manifest"]:
            if snippet not in router_text:
                fail(f"router: missing generated MATLAB wiring marker {snippet}", failures)

    return failures


def main() -> int:
    failures = validate()
    if failures:
        for message in failures:
            print(f"MATLAB_ASSET_STATIC_FAIL {message}", file=sys.stderr)
        return 1
    print(f"MATLAB_ASSET_COUNT={len(EXPECTED_ASSETS)}")
    print(f"MATLAB_OCEAN_PLOT_COUNT={len(PLOT_ASSETS)}")
    print("MATLAB_ASSET_FUNCTION_NAMES=ok")
    print("MATLAB_ASSET_INPUT_CONTRACTS=ok")
    print("MATLAB_ASSET_MISSING_AND_UNITS=ok")
    print("MATLAB_ASSET_EXPORT_AND_MANIFEST=ok")
    print("MATLAB_ASSET_VERSION_FALLBACKS=ok")
    print("MATLAB_OCEAN_PLOT_TOOLBOX_BOUNDARY=base-matlab-only")
    print("MATLAB_ASSET_SVG_CONTRACT=ok")
    print("MATLAB_ASSET_NATIVE_SYNTAX_POLICY=ok")
    print("MATLAB_ASSET_ADVERSARIAL_CONTRACTS=ok")
    print("MATLAB_ASSET_SHARED_HELPERS=ok")
    print("MATLAB_ASSET_ASCII=ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
