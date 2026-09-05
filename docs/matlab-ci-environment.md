# MATLAB CI environment

The project uses `.github/workflows/matlab-full100.yml` to install and run
MathWorks MATLAB on GitHub-hosted runners. The repository is public, so the
official `matlab-actions/setup-matlab` action can provide licensed batch MATLAB
without storing a local license file in the repository.

The workflow runs three releases: R2021a, R2024b, and R2026a. R2021a is used as
the oldest GitHub-hosted action lane because the official setup action supports
R2021a and later. A separately licensed self-hosted runner is required if an
exact R2020a lane remains mandatory.

Each lane runs:

1. The full MATLAB plotting regression and release/license probe.
2. Family A, B, and C runtime contracts.
3. PNG, PDF, SVG, manifest, font, and export contracts, including native SVG
   coordinate preservation, tamper rejection, and pixel-based text bounds.
4. Headless interaction fallback and stable identity checks.
5. The evaluator-owned real MATLAB runtime gate.
6. A Chinese synthetic-ocean report built from the runtime artifacts and fixture
   statistics, with missing/QC counts, paired metrics, provenance, and limitations.
7. Independent PNG pixel, PDF structure/font, and SVG XML/geometry checks,
   recorded in `rendered-artifact-evidence.json` without claiming a visual pass.
8. An external SHA-256 inventory followed by artifact upload.

The report and its hash-bound evidence are stored as
`evaluator-runtime/report.md` and `evaluator-runtime/report-evidence.json` in
each release's artifact bundle. Generate them locally from a downloaded bundle
with `python3 codex-runtime/matlab/evals/build_ocean_report.py --runtime-output
<bundle>/evaluator-runtime`. Missing or mismatched artifacts fail report creation.
Synthetic fixtures do not establish real sea conditions, and the report does not
claim desktop interaction or visual inspection passed.

The regression and interactive figures use an explicit 8 by 5 inch publication
canvas at 300 DPI (2400 by 1500 pixels). Smaller export geometries remain
available through the export helpers and interactive publication size options.

R2025a and newer use `exportgraphics` with explicit `Width`, `Height`, `Units`,
`Padding="figure"`, and `PreserveAspectRatio="on"` for all three formats.
Sizing failures stop the export instead of silently retrying another API.
Earlier releases use the documented `print` path for exact physical dimensions;
their manifests record the actual device and compatibility reason. MATLAB
P-code (`exist(..., 'file') == 6`) is a callable API, not a missing function.
Exact dimensions do not establish PDF font embedding or visual fidelity.

The report checks local fixture units, coordinate order, missing/QC counts,
paired statistics and artifact snapshots independently. Its current runtime
record binds fixture IDs, not input content hashes; the report states that
limitation and does not claim to prove which numerical input snapshot MATLAB
consumed. Source QC and uncertainty presence is not a claim that every plot
filtered or displayed those fields.

For local automated artifact inspection, install the pinned Python packages in
`codex-runtime/matlab/evals/requirements.txt` and the `poppler-utils` system
package. Missing dependencies are reported as unverified, not passed. The
static CI job also parses MATLAB source with MISS_HIT at the R2021a boundary.

Run the workflow from GitHub Actions with **MATLAB Full 100 Gate → Run
workflow**. Runtime success raises the evidence-backed score from 70 to 90. The
last 10 points require a trusted visual audit bound to the uploaded artifact
hashes, including CJK glyphs, clipping, PDF/SVG fonts, accessibility, DataTip,
Brush, and Desktop lifecycle evidence.

For a private repository, configure a MathWorks batch licensing token or a
network license manager according to the official MATLAB Actions documentation;
never commit license material to the repository.
