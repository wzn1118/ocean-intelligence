# Round 16 Comparison Uncertainty Evidence Review

Run: [33995525791](https://github.com/wzn1118/ocean-intelligence/actions/runs/33995525791), commit `b0d7fb2d1204424bd0b347cf8aa33c7368814e16`.
Review date: 2026-09-05. Scope: new observation-only `test_comparison_uncertainty`, original CI errors, artifact existence, and any available new PNG/PDF/SVG. No production, scoring, original-artifact, or visual-verification fields were edited.
At `2026-09-05T22:26:27Z`, one artifact-list check returned R21 artifact `9977992473` and R24 artifact `9977994477`, both bound to this run/commit, with no R26 artifact yet. Polling stopped; the pending row is not a prediction of R26 failure or success.

## Confirmed Results

| Release | Runtime result inspected | New uncertainty artifacts | Visual and actual-size review |
| --- | --- | --- | --- |
| R2021a Update 8 | 19/20 stages; family-b-runtime failed with InvalidProperty | None | Not possible; export was not reached |
| R2024b Update 9 | 19/20 stages; family-b-runtime failed with InvalidProperty | None | Not possible; export was not reached |
| R2026a | Pending original result at this report update | Not yet inspected | Unverified; no outcome inferred from old releases |

R21/R24 evidence was reused read-only at the coordinator's request from `/tmp/matlab-run-33995525791/matlab-full100-R2021a/` and `matlab-full100-R2024b/`. Neither original package was redownloaded or modified.
Recursive file inspection found no `comparison-uncertainty` files, no `synthetic-observation-uncertainty` PNG/PDF/SVG, and no new uncertainty manifest in either package. The existing `family-b-comparison.*` files are different tests and are not substitute evidence.

## Preserved Failure

Both original `ci-stage-status.json` records contain identifier `MATLAB:class:InvalidProperty` and this exact `error_message`:

```text
The name 'FontUnits' is not an accessible property for an instance of class 'matlab.graphics.illustration.legend.Text'.
```

The retained stack identifies `oi_plot_comparison` line 136 (`set(legendHandle.Title,...)`), called by `test_comparison_uncertainty` line 25, then `full100_family_b_runtime` line 105. The complete release-specific stack remains in each original stage JSON, including the original MATLAB command frame.
R21 family-b-runtime ran from `2026-09-05T22:21:14Z` to `22:21:24Z`; R24 from `22:21:34Z` to `22:21:43Z`.
The first observation-only helper call failed before the first observation-case assertion, subsequent adversarial cases, and the `oi_export_figure` call. These tests cannot be reported as passed merely because other stages or earlier family-B exports succeeded.

## Hash Binding

Remote source contents were fetched from the exact commit through GitHub's contents API, not assumed from the local working tree. These are committed-source hashes; they are not a claim that a separate runtime source snapshot was archived and rehashed.

| Committed source | Bytes | SHA-256 |
| --- | ---: | --- |
| tests/test_comparison_uncertainty.m | 21402 | d9149d4cb5ae58b99d194651736ecb14d7b90364d9f97aa57e68e0dd845e8a33 |
| assets/oi_plot_comparison.m | 34492 | 29bb859c768b206c81bebe2995cea891c70cd26df1bf97ac74822f56039dd387 |
| tests/full100_family_b_runtime.m | 13499 | bb91405b765bc9d5b53059a6611139767fbbec2f798ebe21d97f1fd9ea955ff0 |
| tests/run_github_full100.m | 11023 | bca37f5491af0aad9b427aa1ca9218d55e239bfe89bb8919138f23fae6561e26 |

Source paths in this table are relative to `codex-runtime/matlab/` at the stated commit.

| Original evidence | Bytes | SHA-256 |
| --- | ---: | --- |
| R2021a/ci-stage-status.json | 5118 | 081a9cbc8f11bc6584bc32a4da4485c91770f0c052b3b608cccba6769bf59726 |
| R2024b/ci-stage-status.json | 5620 | fe28485d286cbbb3f60e43fd4dc27fb8159cd2978e96804b291054ea83354a98 |
| R2021a/matlab-runtime-probe.json | 704 | 5faa6b9699192c48a7140b917ad90515af950dd1c6f24eb1f500970a189da173 |
| R2024b/matlab-runtime-probe.json | 713 | 102929360140dd8cd2288dec981c2ae3cf417f9bd0a6ef922d7d0e2c2ca2f217 |

## Export Expectations, Not Observations

- The committed test requests PNG 2400x1500 at 300 DPI and an 8x5 inch figure; expected PDF page dimensions are 576x360 points. Actual new raster dimensions, PDF MediaBox, SVG viewport/physical units, bytes, and hashes are unavailable because export was not reached.
- Expected horizontal intervals are x=[-1,7] at y=3.5 and x=[-1,3] at y=1.5. The finite missing-U point must remain at (2,2.5), with no fabricated model-U or vertical interval. No new artifact currently verifies these features.
- Expected legend title lines are `Horizontal: observation standard uncertainty (degC)` and `Model uncertainty not provided`; figure title is `Synthetic observation-only uncertainty`. Their legibility, overlap, clipping, and clearance are unverified, not inferred from source strings or metadata.
- The coordinator reported removing only the unsupported FontUnits setter, consistent with the [official legend Text properties](https://ww2.mathworks.cn/help/matlab/ref/matlab.graphics.illustration.legend.text-properties.html). That subsequent change is not part of this CI commit and has no successful runtime or visual result in this review yet.
- R26 remains pending until its own original stage record and files are available. No Desktop interaction, font embedding, or publication visual approval is implied by this report.

## Coordinator Follow-up, Complete Matrix

The subsequently downloaded R2026a artifact confirms the same first-call
`MATLAB:class:InvalidProperty` failure for `legend.Text.FontUnits`, before the
new uncertainty export. All three releases finished with 19/20 primary stages,
raw score 90/100 and failed overall CI. No new uncertainty PNG/PDF/SVG was
produced on any release. This does not verify the later setter correction.

R2026a `ci-stage-status.json`: 5620 bytes, SHA256
`76d77454307dfc0cc879f253cae51cf04d0edc27289d9e74e4d681b5e1c9c223`.
R2026a `matlab-runtime-probe.json`: 701 bytes, SHA256
`3ee9fa0a7e81c759782cdbc5f877b7f5776d1d77ebd5ab1d2d90970c95996dcb`.
Original files are under `/tmp/matlab-run-33995525791/matlab-full100-R2026a`.
The completed matrix summary is `/tmp/matlab-ci-summary-33995525791/summary.md`.
