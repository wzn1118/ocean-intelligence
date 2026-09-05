#!/usr/bin/env python3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
ASSETS = ROOT / "codex-runtime" / "matlab" / "assets"
TEST = ROOT / "codex-runtime" / "matlab" / "tests" / "full100_family_c_contracts.m"

REQUIRED = {
    "oi_plot_vector_field.m": [
        "ComponentRotationDegrees",
        "counterclockwise-input-to-plot",
        "ZeroSpeedCount",
        "abs(componentRotationDegrees) <= 360",
    ],
    "oi_plot_spectrum.m": [
        "precomputed-frequency-density",
        "RegularSamplingVerified",
        "IncompleteConfidenceInterval",
        "Signal Processing Toolbox",
        "ToolboxExecutionVerified",
    ],
    "oi_plot_direction_rose.m": [
        "DisplayConvention",
        "displayDirection = displayDirection + 180",
        "centeredDirection",
        "WeightMeaning",
        "CalmCount",
    ],
}


def main() -> None:
    for filename, snippets in REQUIRED.items():
        text = (ASSETS / filename).read_text(encoding="utf-8")
        assert text.isascii(), f"{filename} must remain ASCII"
        for snippet in snippets:
            assert snippet in text, f"{filename} missing contract marker: {snippet}"
    test_text = TEST.read_text(encoding="utf-8")
    assert test_text.isascii(), "family-c MATLAB test must remain ASCII"
    for identifier in [
        "ComponentRotation",
        "NoDirectionalSamples",
        "RegularSamplingEvidence",
        "ToolboxEvidence",
        "IncompleteConfidenceInterval",
    ]:
        assert identifier in test_text, f"MATLAB test missing rejection case: {identifier}"
    print("FULL100_FAMILY_C_STATIC=ok")


if __name__ == "__main__":
    main()
