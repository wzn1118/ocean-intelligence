# Round 22: Model-Generated MATLAB Trial Design

## Coordinator Update After Original Generation

The proposal below is a retained pre-generation design, not the final acceptance
contract. Its assumed 8x5-inch page, 2400x1500 pixels and original short labels
were NOT requirements in the actual generation prompt and must not be applied
retroactively as model failures. The unchanged source selects 10x8.5 inches and
descriptive temperature labels; the implemented trial preserves them and exports
3000x2550 at 300 DPI, PDF 720x612 points. No generated source was repaired.

The final entry is `test_astra_generated_comparison(outputDirectory, fixturePath,
expectedSourceHash)`, wired after the existing native suite in family-B. The
shared reader now accepts only two named text profiles, defaulting to the old
strict labels, with independent two-positive/eight-negative native regressions;
its original scientific comparisons and 36 negative cases remain unchanged.
Implementation and R2021a syntax validation are complete; licensed execution is
still pending. Actual two-turn generation, unchanged original bytes and its
scope are documented in `runtime-generation-result-round22.md` and
`model-generated-report-review-round22.md`. Statements of pending source receipt
or no implementation below describe the earlier review time only.

## Historical Review Snapshot

Status: design only, 2026-09-06 UTC. No generated source has been received or executed in this review; no source/input/artifact copies were made.
The coordinator reports generation on isolated port 8012, with production 8011 untouched, CLI 0.153.4 and thread `01a07422-6d4a-7052-8d6a-993e40f9d46a`. These are handoff context, not independently verified generation or MATLAB evidence.
Generation snapshot `587c382` resolves locally to `587c382a7155c265abb82137b6e5ce47717b8de0`. The inspected reader, fixture, native test, exporter, manifest writer and family-b/CI runner match that commit. Provider/model identity and the generated file hash remain pending original evidence.

## Minimal Contract

- Model entry: `function [fig,result] = astra_comparison_trial(fixturePath)`. It reads the supplied fixture and constructs one new traditional invisible figure; it does not export, run the reader, declare success, overwrite files, or close the returned figure.
- The function must establish the final 8 x 5 inch canvas before constructing the plot, preserve the fixture's full arrays, use repository plotting helpers, and return their actual live handles and comparison result. Do not supply a replacement plot or repair the returned data in the acceptance driver.
- Candidate host-owned driver: `test_astra_comparison_trial(outputDirectory, trialSourcePath, provenancePath)`. One original source, one pinned paired fixture, one figure and PNG/PDF/SVG per release; no extra mutation matrix or rerun of the existing 36-case suite.
- The fixed function name and file basename must agree. Wait for the coordinator's exact original file and credential-free generation provenance before implementing or executing this driver. Any repaired model code is a distinct revision with both original and revised hashes, not an unchanged original-generation pass.

## Trusted Inputs and Provenance

Use `evals/fixtures/paired_observation_model.json`: 2771 bytes, SHA-256 `dfdd4a9b3270151e02b8c91970775ed10ebfc862bc8119c3cccb85b99b6f676b`.
It contains 12 ordered synthetic records, not ocean observations: four UTC times crossed with depths 10/40/70 m, 11 finite pairs, and a preserved final model value of 13.96 despite the missing final observation.
The reviewed reader SHA-256 is `e522e494c243ea105b399c03aa826a050200ae77d54ee7ee6ea55742a7dd25e3`; its prior native test SHA-256 is `4ad842e4dce727264f822e9fa50825dfecf320d01abc65d891f9cee99cdb65cd`.
The coordinator's eventual CI bundle must bind the original `.m` bytes to the actual assistant response or file-write event, with thread/turn identifiers, actual recorded provider/model, CLI version, completion state, generation snapshot and provenance-record hashes. Do not infer provider/model from the filename, prose attribution, CLI version or port.
Record generation provenance separately from the CI execution commit, driver/reader/helper hashes, actual MATLAB release/version, run/job IDs and execution log. A source digest identifies bytes; it does not authenticate their model origin by itself. Never archive credentials or access tokens in the trial evidence.

## Driver Sequence

1. Require a nonexistent `family-b/astra-comparison-trial` output directory. Validate the handed-off provenance and exact source/input bytes before evaluation. Future CI packaging may archive unchanged inputs/source; this design round does not copy them. Parse the exact fixture bytes independently, require its pinned hash, synthetic flag, ID, contract and 12 records; never trust fixture metadata or hashes returned by generated code.
2. Review the original source before authorizing execution: only fixture reading and figure construction are in scope. Reject unexpected filesystem/network/process operations, path manipulation, timers, export calls, validation substitutes or custom callbacks. Static review and hash checks are not a sandbox; execute only in the coordinator's isolated licensed CI context, without production-service credentials.
3. Save the caller path, working directory and existing figure handles; register cleanup before invoking the model entry. Resolve and hash the exact generated function and repository `measure_comparison_plot_data`, `oi_plot_comparison`, `oi_export_figure`, `oi_write_manifest` and hash helper. Clear the generated function cache and rehash before resolution; reject shadowing and unexpected dependencies. Recheck resolution/hashes after the call. A function exception must also clean up newly created figures, without `close all` or masking the original error.
4. Invoke `[fig,result] = astra_comparison_trial(fixturePath)` once. Require exactly one new live traditional figure, `Visible='off'`, final 8 x 5 inch geometry, and exactly the returned comparison axes in that figure. Check that the actual title matches the fixture title and that `result.OneToOne` is visible, has a non-`none` line style and positive line width. Do not replace handles, add a separate proof figure, change the layout, filter values, or restyle the generated result to make it pass.
5. Construct `inputSnapshot` from driver-read bytes and call `measure_comparison_plot_data(result, fixture, inputSnapshot, fig)` on those exact returned handles. Keep the complete v3 declaration as the pre-export baseline; apply the explicit completeness/JSON checks below, not only counts or a model-authored report.
6. Export that same `fig` with the unmodified repository `oi_export_figure(..., 'paired-observation-model', 2400, 1500, 300, ..., 'ExportSVG', true)` into the trial directory. Use the actual fixture title and explicit model-trial/source attribution. Read v3 again after export and require `isequaln` with the baseline. Write the single-entry `figures.json` using `oi_write_manifest`; independently recheck all returned file bytes/hashes and the input/source/provenance hashes. Never use a second plotter or retry another backend after failure.
7. Write the trial evidence JSON only from completed host-side checks, then emit a scoped terminal marker such as `ASTRA_COMPARISON_TRIAL=passed_synthetic_native_v3_and_exports_only`. Preserve partial artifacts and the original MATLAB identifier/message/stack on any failure, record the last completed phase, and rethrow into family-b. Missing source/provenance, stale output or an earlier family-b failure is not a skipped pass.

## Required Native and Wire Checks

| Operand | Required evidence |
| --- | --- |
| Full identity | IDs `pair-001` through `pair-012`, source rows 1:12 in call-entry order, all UTC datetime values and all depths, `DepthUnit='m'`, positive-down; no sorting or unique-time reduction. |
| Unplotted values | Both original numeric vectors retain 12 entries; observation(12) and observation U(12) remain missing, model(12) remains 13.96. Null conversion must not concatenate away an empty decoded value. |
| QC and pairing | All 12 observation QC flags, including row 6 `suspect` and row 12 `missing`; accepted values `good` and `suspect`; complete finite/QC/paired masks and pair indices; no invented model QC. |
| Uncertainty | Observation-only standard uncertainty in degC with all 12 magnitudes and missing/graphics masks; model uncertainty explicitly `not_provided`, not zero-filled or copied. |
| Native geometry | Exactly 11 scatter pairs and 11 visible horizontal Line intervals; endpoints are observation +/- its U at the corresponding model Y, with correct source IDs/rows, ownership and limits; the existing reader checks these values independently. |
| Text and metrics | Reader-required native observation/model labels and both legend-title lines; 11-pair metrics recomputed from the independent input and native coordinates, retaining the reader's tolerances. |
| JSON round trip | `schema_version=3`, `shape=[12]`, `dimension_order=['observation']`; complete ordered arrays, JSON nulls and logical masks, 11 segment objects, release and independently calculated fixture hash survive encode/decode. |

Reuse the established checks in `tests/test_comparison_native_evidence.m:296` as the narrow host-side completeness pattern; do not edit or replace the shared reader. The substantive array comparison remains the existing reader, not a duplicate implementation.

## Artifacts and Stage Placement

The dedicated directory contains `paired-observation-model.png/.pdf/.svg`, `figures.json`, and a scoped trial-evidence JSON binding the original source/input/provenance, full post-export v3 declaration, manifest, per-format hashes/bytes, actual dimensions/DPI and actual export APIs.
Use `paired-observation-model` as the export ID: the reader sets `figure_id` to the fixture ID. A distinct parent directory identifies the Astra trial without rewriting the declaration or colliding with evaluator outputs.
Requested dimensions are 2400 x 1500 at 300 DPI, PDF 576 x 360 points and SVG 8 x 5 inches. Read actual geometry using the existing exporter/manifest checks; target values must never be written as measured values. Retain all current thresholds and explicit SVG metadata/normalization provenance.
Use the repository's existing per-release export path and record what actually ran. Native printing, exact exportgraphics and subsequent SVG metadata handling must not be mislabeled as an untouched common backend. No external PDF repair, raster resizing or altered bounds to obtain a pass.
Proposed later call site: inside `full100_family_b_runtime`, after the existing comparison/native tests and before its evidence save/final success marker (currently lines 104-110). Store the trial result separately; do not promote it into evaluator/report figures automatically. `run_github_full100.m:101` already owns the family-b stage; leave its 20-stage denominator, scoring, reader and production runner unchanged.
Evidence must distinguish `not_reached`, actual MATLAB call completion, native-proof result and export/manifest result. Final scoped pass requires all requested phases, the evidence JSON and terminal log marker; a green stage, successful generation, function return or three files alone is insufficient. Keep visual/Desktop verification false and external font checks unverified until actually inspected; retain any later failures.

## Confirmed Boundaries

- `measure_comparison_plot_data.m:1` checks fixture/input IDs, but derives sample count from the supplied fixture and at line 230 copies the supplied hash into evidence. It does not read or authenticate fixture/source files. Without independent byte pinning, a driver could validate a shortened or changed fixture against itself.
- At `measure_comparison_plot_data.m:121`, the reference-line predicate checks ownership and endpoints but not visibility/style; extra axes elsewhere in the figure and the figure's main title are also outside that predicate. The proposed small driver guards cover those explicit trial-contract gaps without claiming a general visual audit or changing the reader.
- The reader and manifest cannot establish model authorship, font embedding, readable glyphs, absence of every overlap, or arbitrary generated-code safety. Legacy PDF font failures remain possible. Same-figure v3 binding and successful native exports must not be reported as full visual, Desktop, real-sea or overall-CI acceptance.
- Current action is only this design file. Generated-source inspection, driver implementation and R2021a/R2024b/R2026a execution remain pending the coordinator's original-file handoff and authorization; no generated sample is presently accepted.
