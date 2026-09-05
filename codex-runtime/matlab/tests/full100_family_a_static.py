#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[3]
ASSET_DIR = ROOT / "codex-runtime" / "matlab" / "assets"
FILES = {
    "oi_plot_profile.m": [
        "StructuralMissingMask",
        "ReportingMissingMask",
        "QCFlags",
        "UncertaintyValues",
        "UnknownOption",
        'axesHandle.YDir = "reverse"',
    ],
    "oi_plot_hovmoller.m": [
        'timeValues.TimeZone) == "UTC"',
        "TimeZoneMismatch",
        "StructuralMissingMask",
        "ReportingMissingMask",
        "QCFlags",
        "UncertaintyValues",
        "ColorCenter",
        "center_colormap",
        "R2023b",
        "AlphaData",
    ],
    "oi_plot_section.m": [
        "depth-by-distance",
        "StructuralMissingMask",
        "ReportingMissingMask",
        "QCFlags",
        "UncertaintyValues",
        "ColorCenter",
        "center_colormap",
        "Levels",
        'axesHandle.YDir = "reverse"',
    ],
}
FORBIDDEN = {
    r"\bfillmissing\s*\(": "silent missing-value filling",
    r"\b(?:smooth|smoothdata)\s*\(": "silent smoothing",
    r"\bsort(?:rows)?\s*\(": "silent coordinate sorting",
    r"\bsqueeze\s*\(": "implicit dimension removal",
    r"\bpermute\s*\(": "implicit dimension permutation",
}


def main() -> int:
    failures: list[str] = []
    for name, markers in FILES.items():
        path = ASSET_DIR / name
        if not path.is_file():
            failures.append(f"missing {path}")
            continue
        text = path.read_text(encoding="ascii")
        declaration = re.search(r"(?m)^function\s+result\s*=\s*(\w+)\s*\(", text)
        if not declaration or declaration.group(1) != path.stem:
            failures.append(f"{name}: top-level function mismatch")
        for marker in markers:
            if marker not in text:
                failures.append(f"{name}: missing marker {marker}")
        for pattern, label in FORBIDDEN.items():
            if re.search(pattern, text, re.IGNORECASE):
                failures.append(f"{name}: contains {label}")
        if "isreal(" not in text or "isinf(" not in text:
            failures.append(f"{name}: does not reject complex or infinite data")
        if 'MissingPolicy", "preserve"' not in text:
            failures.append(f"{name}: missing preserve-only missing policy")
        if 'QCPolicy", "preserve"' not in text:
            failures.append(f"{name}: missing preserve-only QC policy")
        if "Interpolated" not in text or "false" not in text:
            failures.append(f"{name}: missing no-interpolation evidence")
        interpolation_calls = len(re.findall(r"\binterp[123n]?\s*\(", text, re.IGNORECASE))
        expected_calls = 1 if name in {"oi_plot_hovmoller.m", "oi_plot_section.m"} else 0
        if interpolation_calls != expected_calls:
            failures.append(f"{name}: unexpected scientific interpolation call count")
    test_path = Path(__file__).with_name("full100_family_a_contracts.m")
    if not test_path.is_file():
        failures.append("missing full100_family_a_contracts.m")
    else:
        test_text = test_path.read_text(encoding="ascii")
        for marker in [
            "MissingMaskOverlap",
            "MissingMaskCoverage",
            "UncertaintyValues",
            "QCFlags",
            "TimeZone",
            "ColorScale",
            "ColorCenter",
            "UnknownOption",
        ]:
            if marker not in test_text:
                failures.append(f"MATLAB family test missing {marker}")
    if failures:
        for failure in failures:
            print(f"MATLAB_FULL100_FAMILY_A_STATIC_FAIL {failure}", file=sys.stderr)
        return 1
    print("MATLAB_FULL100_FAMILY_A_STATIC=ok")
    print("MATLAB_FULL100_FAMILY_A_ASSETS=3")
    print("MATLAB_FULL100_FAMILY_A_RUNTIME_TEST=full100_family_a_contracts")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
