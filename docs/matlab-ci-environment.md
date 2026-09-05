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
3. PNG, PDF, SVG, manifest, font, and export contracts.
4. Headless interaction fallback and stable identity checks.
5. The evaluator-owned real MATLAB runtime gate.
6. An external SHA-256 inventory followed by artifact upload.

Run the workflow from GitHub Actions with **MATLAB Full 100 Gate → Run
workflow**. Runtime success raises the evidence-backed score from 70 to 90. The
last 10 points require a trusted visual audit bound to the uploaded artifact
hashes, including CJK glyphs, clipping, PDF/SVG fonts, accessibility, DataTip,
Brush, and Desktop lifecycle evidence.

For a private repository, configure a MathWorks batch licensing token or a
network license manager according to the official MATLAB Actions documentation;
never commit license material to the repository.
