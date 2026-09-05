#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path


MATLAB_ROOT = Path(__file__).resolve().parents[1]
ASSETS = MATLAB_ROOT / "assets"
TARGETS = {
    "oi_plot_time_series.m": [
        "timetable", "TimeZone", "GapThreshold", "QCVariables",
        "UncertaintyType", "ConfidenceLevel", "DataTipTemplate", "ValidCount",
    ],
    "oi_plot_comparison.m": [
        "PairingRule", "inner-key", "row-time-inner", "DuplicateKeys",
        "Confounder", "StratifiedMetrics", "UncertaintyType", "UnmatchedObservationCount",
    ],
    "oi_plot_ts_diagram.m": [
        "SalinityDefinition", "TemperatureDefinition", "ReferencePressure",
        "QCVariable", "Confounder", "UncertaintyType", "DensityReference", "CompleteMask",
    ],
}


def main() -> int:
    failures: list[str] = []
    for name, markers in TARGETS.items():
        path = ASSETS / name
        if not path.is_file():
            failures.append(f"missing {path}")
            continue
        text = path.read_text(encoding="utf-8")
        if not text.isascii():
            failures.append(f"{name}: source must remain ASCII")
        for marker in markers:
            if marker not in text:
                failures.append(f"{name}: missing contract marker {marker}")
        for forbidden in [r"\bfillmissing\s*\(", r"\bsort\s*\(", r"\bOCTAVE_VERSION\b", r"\bgca\s*\("]:
            if re.search(forbidden, text, re.IGNORECASE):
                failures.append(f"{name}: forbidden pattern {forbidden}")
        if not re.search(rf"^function\s+result\s*=\s*{re.escape(path.stem)}\s*\(", text, re.MULTILINE):
            failures.append(f"{name}: top-level function does not match file name")
    runtime_test = Path(__file__).with_name("full100_family_b_runtime.m")
    runtime_text = runtime_test.read_text(encoding="utf-8")
    for marker in [
        "family-b-time-series",
        "family-b-comparison",
        "family-b-ts-diagram",
        "ExportSVG",
        "family-b-runtime-evidence.mat",
        "FAMILY_B_MATLAB_RUNTIME=passed",
    ]:
        if marker not in runtime_text:
            failures.append(f"runtime test: missing {marker}")
    if failures:
        for failure in failures:
            print(f"FAMILY_B_STATIC_FAIL {failure}", file=sys.stderr)
        return 1
    print("FAMILY_B_STATIC_CONTRACTS=passed")
    print("FAMILY_B_TARGET_COUNT=3")
    print("FAMILY_B_RUNTIME_DRIVER=present")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
