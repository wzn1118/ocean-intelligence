---
name: matlab-scientific-plotting
description: Route, create, repair, validate, and export MATLAB-first scientific figures with explicit release, toolbox, runtime, artifact, and failure contracts. Use when MATLAB is requested or MATLAB-native graphics behavior matters; route Octave-first execution to the Octave skill instead.
---

# MATLAB Scientific Plotting

Treat MathWorks MATLAB as the authoritative runtime. Preserve scientific meaning, dimensions, units, missing values, coordinate direction, time zones, and uncertainty semantics.

## Trigger And Triage

Use this skill when the user explicitly requests MATLAB, names a MATLAB release or toolbox, supplies MATLAB-native types such as `table`, `timetable`, or `datetime`, requires `tiledlayout`, `exportgraphics`, `uifigure`, App Designer, or asks to diagnose MATLAB rendering.

Route an explicitly Octave-first, Octave-only, or Octave-rendered request to the Octave skill. A `.m` extension alone does not select MATLAB. Never silently substitute Octave when MATLAB is requested.

Before implementation, classify the task as `create`, `repair`, `refine`, `inspect`, `export`, `interactive`, or `portability`. Resolve the scientific plot route separately from the runtime route.

## Runtime Contract

Resolve and report:

- Requested runtime and whether MATLAB-first was explicit or inferred.
- Target release in `RYYYYa` or `RYYYYb` form.
- MATLAB executable availability and actual release when executed.
- Required products and toolbox license/function checks.
- Requested output formats and release-compatible export APIs.

For unattended execution, `matlab -batch` is native only from R2019a. Older releases use an explicit `matlab -r` command with tested `try/catch/exit` behavior and preserved failure status.

General `exportgraphics` is available from R2020a. This API availability does not establish exact sizing support. For this repository's strict fixed-size `oi_export_figure` + `oi_write_manifest` workflow, choose each requested format's API before execution:

| Release | PNG | PDF | SVG |
| --- | --- | --- | --- |
| R2019b-R2024b | print -dpng | print -dpdf | print -dsvg |
| R2025a+ | exact exportgraphics | exact exportgraphics | exact exportgraphics |

Legacy `print` is an explicit preselected strategy, not a retry after failure. Exact `exportgraphics` requests PNG with `Units="inches"`, `Width=widthPixels/dpi`, `Height=heightPixels/dpi`, `Resolution=dpi`, and `PreserveAspectRatio="off"`; PDF/SVG retain the same physical dimensions in inches with `PreserveAspectRatio="on"`. Both keep `Padding="figure"`. Set the figure to those physical inches before plotting, preserving point-sized fonts and layout. Verify actual PNG pixels and embedded DPI in the target release, without resizing the artifact afterward. Preserve export errors and stop; never silently retry with `print`. Record the actual per-figure, per-format `export_api` consistently with runtime evidence, together with the corresponding `export_size_units` (inches for this native path and the legacy print geometry); a selected strategy is not proof of execution. These repository constraints take precedence over generic API recommendations in the capability matrix.

The round-11 native sizing probe produced exact dimensions in 2/6 cases with aspect preservation on and 6/6 with it off. The pixels/off real-figure control shrank fonts and increased tick counts, so it is not the production strategy. The inches/off control retained approximately the original physical typography and matched dimensions in 3/3 tested cases, but changed axes positions and margins. Rounds 12 and 13 each passed 57/60 CI stages, with 19/20 on each of R2021a/R2024b/R2026a. Their full native regression runs passed the dimension checks, including the R2026a PNG inches/off path; its sizing evidence is no longer limited to the initial probe. Three unit-circle images had local pixel bounding-box width/height differences of at most two edge pixels. This is not full-figure visual approval: independently verify typography, ticks, clipping, fonts, and every requested format without resampling, cropping, padding artifacts, or weakening dimension gates.

Round 14 adds restricted nested-viewport normalization in `oi_annotate_svg`: retain the native `viewBox` and drawing coordinates in the child viewport while normalizing the outer viewport. This is explicit XML postprocessing after native export, not untouched native SVG output. Reject unknown or unsupported SVG profiles instead of applying the normalization generally; do not relax dimension gates. Round 15 passed the namespace-aware DOM contracts on all three releases: ten positive and 34 rejection cases, including CSS-wide inheritance. All 60 primary MATLAB stages passed, but overall CI still failed on postprocessing gates. A separate R2024b DISPLAY diagnostic emitted embedded SVG fonts outside the accepted normalization profile and was correctly rejected. Two SVG layout engines produced zero pixel differences for the inspected historical copies; CairoSVG also matched four actual round-15 outputs to their historical baselines. They share a Cairo backend, so this is not full independent browser, font, or visual approval.

Current evidence: round-22 run 34002693563 (remote commit `0f677978`) is `completed/failure`. R2021a/R2024b each passed 19/20 primary stages and R2026a passed 20/20, 58/60 in total; `evaluator-runtime` passed on all three. Each original evaluator result remains score 90 with `runtime_pending`; full visual approval is absent. The two older `family-b-runtime` failures are `astra_comparison_trial:FontUnavailable` at original model-source line 118: a listfonts enumeration assertion, not proof of a missing system font. The unchanged first model-generated function completed on R2026a, including full same-figure v3 before/after export, native PNG/PDF/SVG and manifest validation. Its separate artifact audit passed 3/3. Faraday inspected all three formats: titles, labels and legends are complete, and the PDF embeds its font, but PNG statistics touch the top ticks, vector spacing is tight with smaller text, and the reference line crosses points. This is not full visual approval or measured legend-title geometry. The `tests/model-generated-round23/` revision adds the existing `oi_font_available` dependency and replaces only that font assertion; it has not run in MATLAB. Retain the original source, older failures and R2026a success separately. Read `evals/README.md` for detailed evidence and provenance.

The four-fixture `test_native_pdf_fixture_canvas` reports now declare `completed_diagnostics_only` on R2021a/R2024b in primary and DISPLAY contexts, with canvas PDF calls completed. Independent offline pixel inspection nevertheless found 12 completely white restored PNGs: all four cases in R2021a primary/DISPLAY and R2024b primary. R2024b DISPLAY's four restored/reference pairs have equal decoded RGB, not PDF or visual approval. Header/hash checks missed the blank images; the candidate inspector now decodes PNGs and checks limited nonuniform foreground on white. Missing Pillow leaves pixels `not_verified`. This pixel gate does not establish restoration equivalence or authorize a production canvas strategy. Nonpublic `legend.Text.Position` remains unavailable; `captured`, matching serialized properties and completion flags do not prove restoration. R2026a remains `not_applicable`, not passed. Only strictly empty AnnotationPane objects may be excluded; nonempty ones still require rejection, which this run did not exercise. These diagnostics do not count toward the original three-candidate native PDF probe stage, score, or promoted report artifacts. Earlier JVMRequired/RootObjects failures and simple-canvas snapshots remain historical evidence in `evals/README.md`.

Two real Astra diagnostic turns completed in round 19 at low effort with read-only diagnostic commands. These are diagnostic responses, not MATLAB execution, desktop-interaction coverage or proof that existing sessions were refreshed.

Use these terminal states exactly:

- `ready`: requirements are complete and MATLAB execution may proceed.
- `needs-input`: required scientific metadata, release, units, dimensions, or output details are unresolved.
- `runtime-unavailable`: MATLAB was required but no MATLAB runtime was verified.
- `unsupported-release`: the requested release is invalid or outside the supported capability matrix.
- `missing-toolbox`: a required product, license feature, or function is unavailable.
- `unsupported-output`: the requested format has no valid strategy for the target release.
- `routed-to-octave`: the request explicitly requires Octave; stop MATLAB generation.
- `failed`: execution or artifact validation failed; preserve the error evidence.

Every non-ready result must include a stable error code, a human-readable reason, and a recoverable next action. Do not claim execution from static inspection.

Treat route input as untrusted JSON. Accept only plain JSON objects, not arrays, `Date`, `Map`, class instances, or objects with custom prototypes. Reject contradictory `runtime`/`requestedRuntime`, `taskType`/`intent`, release aliases, or simultaneous MATLAB-first and Octave-first signals. Keep runtime, release, task, toolbox, contract, and output fields at the request top level. `plotInput` and its legacy `plot` alias are mutually exclusive; reject nested routing fields and metadata duplicated across the top level and plot object instead of silently overwriting either value. Scientific/publication contract aliases are also mutually exclusive; when a nested contract is present, keep all metadata from that domain inside it instead of repeating flat fields. Availability and required flags must be JSON booleans, not strings or numbers. Normalize output extensions before deduplication, reject URI/absolute/traversal/control-character manifest paths, and never infer success from prose in either Chinese or English.

## Scientific Data Contract

Before generation, create a machine-readable `scientificDataContract`. For create, repair, refine, export, and interactive data-driven work, set `requireScientificContract=true` so unresolved semantics return `needs-input` instead of being inferred.

- Record original positive-integer `shape`, ordered and unique `dimensionOrder`, and an `observationDimension` that names one declared dimension. Never infer a transpose, squeeze, sort, or reshape.
- Record MATLAB `dataType`, coordinate names, physical quantities, and units. Unitless quantities use `1`; conversions require source unit, target unit, formula, and variable provenance.
- Time coordinates use `datetime` or `timetable`, preserve source `TimeZone`, and state coordinate order. Do not convert serial dates or time zones silently.
- State missing-data status as `present` or `absent`. When present, record NaN/NaT/sentinel representation; keep missing, invalid, and suspect masks separate.
- State QC status as `present` or `absent`. When present, record the aligned QC variable, observation dimension, flag meanings, and mask variables; do not treat suspect or rejected values as missing without policy.
- State uncertainty status as `present` or `absent`. When present, record uncertainty type, unit, and aligned observation dimension; require unit compatibility or an explicit conversion.
- For longitude and latitude, record convention and ordering, including dateline handling where applicable. For depth, pressure, height, or elevation, record coordinate type, positive direction, reference, and cast/order semantics.

Expose this contract in runtime route responses and delivered metadata as `scientific_data_contract`. A plotting route may add plot-specific checks, but it must not replace or weaken this task-level contract.

## Publication And Interaction Contract

For publication, export, accessibility, Chinese text, or interactive delivery, set `requirePublicationContract=true` and provide a machine-readable `publicationContract` before generation. This is a preflight plan, not proof that visual checks passed.

- `target`: final medium, physical width/height in cm or inches, output formats, and at least 150 DPI for raster output; publication raster output normally uses 300 DPI or the venue requirement.
- `layout`: `single-axes`, `tiledlayout`, or explicit axes; declare rows/columns when tiled, spacing, padding, row-major reading order, explicit handle ownership, and outside/none placement for legends and colorbars.
- `typography`: selected font and fallbacks, final-size tick/label/title sizes, line width, and interpreter. Use `oi_font_available` with the repository's exact, case-insensitive family matching against `listfonts` or Unix fontconfig results; do not add a separate requirement that listfonts enumerate the selected family. Missing enumeration is not proof of a missing system font. A substitute returned by `fc-match` fallback does not prove the requested font is installed. A matching font candidate proves neither PDF font embedding nor readable CJK glyphs. Chinese delivery uses UTF-8, `Interpreter="none"` for ordinary labels, and separate PNG/PDF/SVG artifact checks; leave unverified embedding and glyph claims unverified.
- `color`: palette class and source, white or declared background, distinct missing-data appearance, minimum contrast ratio, grayscale and color-vision checks, and redundant line/marker/label encoding instead of color alone.
- `clipping` and `accessibility`: require `drawnow` before bounds/overlap inspection, check titles/ticks/legends/colorbars/annotations, preserve reading order, and require accessible title/description evidence in formats that support it.
- Check `tiledlayout` titles in every requested format for text, glyphs, allocated space, and clipping. Their geometry coverage gap is still under diagnosis, not a confirmed fix. Passing the current bounds gate alone does not prove that layout titles are complete; retain unverified status without artifact evidence.
- Visible, nonempty `Legend.Title` objects of class `matlab.graphics.illustration.legend.Text` without public `Extent`/`Position` must appear in `unmeasured_text_objects` with `role="legend.title"` and their actual class. Set `bounds_audit_complete=false`; do not fabricate a zero rectangle or treat absence of measurable bounds as success. This is an explicit measurement-coverage declaration, not a visual or clipping fix.
- `interaction`: interactive tasks use `mode="dual"`, stable observation IDs, callbacks scoped through `event.Target`/`DataIndex`, cleanup registration, and a deterministic static fallback.
- `headless`: declare MATLAB `-batch`, invisible traditional figures, an explicit `exportgraphics` or documented `print` path, and no dependency on clicks, hover state, pinned tips, desktop tools, or callbacks for the exported scientific result.

Expose the normalized contract as `publicationContract` in route responses and `publication_contract` in delivery metadata. Expose `outputContract` at the task and runtime composition layers with the release-specific export strategy for every requested format. After rendering, apply every criterion named by `qualityGate.requiredCriteria`; only artifact evidence and `inspectMatlabPlotQuality` can mark the checks as passed.

For MATLAB CJK+Latin output without an explicit user `FontName`, prefer `WenQuanYi Zen Hei` after exact installation checks, keeping the theme, exporter, and interaction font consistent. Do not override an explicit user font. Font probe 33985570222 verified readable tested Chinese/Latin/numerals, exact text extraction, and embedding for WenQuanYi with `exportgraphics(..., "ContentType", "vector")` PDF on R2021a/R2024b/R2026a. This is limited probe evidence, not a guarantee for every glyph or backend.

Those native PDFs were content-cropped, not exact-page exports. R2021a/R2024b `print` PDFs still lacked embedded fonts; changing the default to WenQuanYi does not resolve legacy embedding or the exact-page contract, and does not authorize changing the strict export strategy. Validate whole-figure layout, final size, bold text, rotated Chinese labels, and PNG/SVG independently. In the two older releases, native Noto titles were `######` and native Droid Latin/numerals were boxes; neither is an equivalently verified fallback. Do not misreport backend failures as fonts being uninstalled.

## Implementation Workflow

1. Enter through `codex-runtime/server/matlab-runtime-route-service.mjs`; it is the only runtime composition layer and must expose normalized scientific data and publication contracts.
2. Build the task, scientific data, and publication gates with `codex-runtime/server/matlab-task-routing-contract.mjs`, then build the scientific plot route with `codex-runtime/server/matlab-plot-router.mjs` when the task creates or changes a plot.
3. Resolve release APIs, formats, and toolbox dependencies with `codex-runtime/server/matlab-release-capabilities.mjs`.
4. Require the task route to expose `plotRoute`, release `capabilities`, and the `inspectMatlabPlotQuality` quality gate before generation.
5. Use native MATLAB data types and APIs when supported. Apply only documented MATLAB fallbacks for older releases.
6. Run MATLAB when available, validate artifacts, and record command, release, products, output paths, dimensions, bytes, hashes, text/glyph evidence, and visual-inspection status.

For repository exports, `oi_figure` takes screen pixels, not the final physical size at the requested output DPI. Set the final inches before creating axes, a `tiledlayout`, or any plot content, using the requested `widthPixels`, `heightPixels`, and `dpi`:

```matlab
figureHandle = oi_figure(widthPixels, heightPixels, "off");
figureHandle.Units = "inches";
figureHandle.Position(3:4) = [widthPixels heightPixels] / dpi;
```

For example, 1200 x 675 output pixels at 300 DPI means 4 x 2.25 inches. Waiting for `oi_export_figure` to shrink the figure changes the space available to point-sized fonts and labels. At the final size, allocate real page margins using axes `OuterPosition` with an outer-position constraint, or let `tiledlayout` allocate space through `Padding` and `TileSpacing`; do not fill the canvas with a fixed inner axes rectangle. Use release-supported properties, run `drawnow`, and check both layout and exported artifacts. Fix the layout rather than relaxing clipping/overlap gates, omitting objects, or rewriting manifest evidence.

For static time-series figures, use `assets/oi_plot_time_series.m` with explicit `ValueVariables`, units, timezone semantics, gap threshold, QC policy, and uncertainty definition. It is a registered plot asset exercised directly by `tests/run_plot_regression.m`, `tests/test_asset_contracts.m`, and `tests/test_asset_adversarial_contracts.m`. Do not describe it as server-router generated until `matlab-plot-router.mjs` actually calls the helper.

For comparison data with uncertainty only on observations, `oi_plot_comparison` accepts explicit `UncertaintySides="observation"`, `ObservationUncertainty` or its variable selector, and `UncertaintyType="standard-uncertainty"` with the actual quantity unit. Omit model uncertainty inputs entirely; never substitute zeros or copy observation uncertainty. Missing observation uncertainty preserves finite QC-accepted scatter pairs and their statistics, but produces no horizontal interval. The helper returns the aligned values, provided/not-provided sides and actual `GraphicsMask` in `result.Uncertainty`; its native legend title identifies the horizontal intervals and absent model uncertainty. Default `UncertaintySides="both"` keeps the existing two-sided contract. Existing audit appdata `OI_ColorAccessibilityRole="uncertainty"` marks only actual helper-created uncertainty Lines. Round 18 completed the independent `test_comparison_uncertainty` PNG/PDF/SVG exports and manifest on all three releases. Neither this annotation nor `HandleVisibility="off"` exempts arbitrary data lines or changes the audit algorithm, data, dimension gates or visual gates.

Optional strict `RecordMetadata` applies only to numeric row-aligned comparison inputs, not table/timetable pairing. Its scalar struct must contain exactly `ID`, `Time`, `Depth`, `DepthUnit`, and `DepthDirection`: one unique nonblank string ID, non-NaT UTC datetime, and finite nonnegative depth per input row, with `m` and `positive_down`. Explicit `SampleLabels` must match the IDs; matching string or `cellstr` vectors are valid, while `RecordMetadata.ID` itself must remain a string vector. `SampleLabelVariable` is not accepted with this metadata. `result.RecordData` retains every original row, value and identity, `result.QC` retains supplied flags or `not_provided`, and native Scatter/horizontal Line `UserData` carries selected record IDs and call-entry source rows. Omitting `RecordMetadata` preserves existing numeric and tabular calling contracts without inventing record identity or emitting `RecordData`. Rounds 18/19/20 produced bound v3 declarations on all three releases; round 19 also passed the corrected matching-cellstr regression without changing the API. Do not fabricate model QC or model uncertainty when only observations supply them.

In the tested headless releases, `drawnow` alone can leave placeholder text extents. Render the relevant state natively before measuring it. Avoid adding measurement probes to the source axes: they can change automatic layout. Prefer a separate measurement figure with identical typography, then use the source figure's final measured geometry. Native `layout.Text` may not expose public bounds; report that measurement gap instead of using a zero rectangle. PNG correctness does not prove PDF/SVG text alignment, and repeated export or PNG prewarming did not repair the R2026a vector-text probe in run 33988300354.

## Output Contract

Return runnable `.m` source plus requested PNG/PDF/SVG outputs when supported. Write manifest `schema_version: 2` to a safe relative JSON path with deterministic figure IDs. Top-level evidence includes generation time, generator, runtime status, execution verification, MATLAB release, toolboxes, artifact validation, visual inspection, warnings, errors, and figures. Each figure records title, source, theme, variables, units, time/space scope, generation script, runtime release, toolbox dependencies, text/axes evidence, accessibility, rendering, publication, interaction/headless evidence, and exports.

For PNG record file, width, height, DPI, bytes, and SHA-256. For PDF/SVG record file, dimensions, bytes, SHA-256, and text or glyph evidence. Include `scientific_data_contract`, `publication_contract`, `runtime_status`, `execution_verified`, `artifact_validation`, `visual_inspection`, `warnings`, and structured `errors`.

Only verified artifacts enter the manifest or report. Never expose temporary paths, `file://` URIs, or tenant host paths.

For ocean-region reports, bind figure provenance and computed statistics to the actual input snapshots consumed by that MATLAB run. Check their relative paths, bytes, and SHA-256 against runtime records (`runtime.input_fixtures` for the fixture bundle). Reading a same-name or same-shape source file later is not runtime input evidence. Missing runtime hashes leave the binding `unverified`; mismatched hashes must be rejected, never refreshed into passing evidence. Keep synthetic fixtures labeled `synthetic_benchmark` or synthetic data even when execution and hashes are verified; they are not evidence of real ocean conditions, observed trends, or regional mechanisms.

For the evaluator's temperature field and salinity profiles, `scientific_data_contract.plot_data_evidence` records native graphics values and the plotting helper's returned QC and uncertainty arrays. The report checks complete arrays, order, masks, units, policy, release, and fixture hash. Only input-bound matching declarations receive `runtime_declaration_verified`; absent declarations remain `not_verified`. Metadata-only uncertainty is not an error band, preserving suspect flags is not QC filtering, and matching declarations are not independent re-execution or visual verification.

Round 13 passed the `paired-interactive` version-2 native evidence checks on R2021a/R2024b/R2026a, including complete values, QC, uncertainty, and errorbar arrays. Those earlier archived reports retain 3/4 native-proof coverage, with comparison still `not_verified`; do not upgrade them using a later run. Since round 18, including current round 22, all four entries under `report-evidence.json`'s `runtime_evidence.figures` have `plot_data_evidence.status="runtime_declaration_verified"` on all three releases: 4/4 bound declarations for each run. These evaluator declarations are separate from the model-generated trial. Declaration binding alone is not adversarial-suite success, desktop interaction, full-figure appearance, real-sea analysis, or live service updates.

The comparison v3 producer in `run_matlab_gate.m` uses observation-only uncertainty and `RecordMetadata`, reading native Scatter coordinates, horizontal Line endpoints, ownership and `UserData` identities after export. Round 18 first completed this same-figure binding with `schema_version=3` on all three releases. The report/evaluator consumers check all 12 synthetic fixture records, all 11 scatter pairs, unplotted values, QC and uncertainty masks, statistics, release and input hashes. Model QC and uncertainty remain explicitly `not_provided`. Consumer mutation tests are separate from native reader tests. Round 20 completed `test_comparison_native_evidence` on R2021a/R2024b/R2026a: four positive cases and 36/36 reader-negative cases per release, verified against `native-reader-test-results.json` and actual job-log markers `COMPARISON_NATIVE_READER_TEST_NEGATIVES=36` and `COMPARISON_NATIVE_READER_TEST=passed_synthetic_native_mutations_only`. `scatter-nan-size` reached the reader and raised `run_matlab_gate:ComparisonProofHandles`; setter exceptions do not count as reader rejections. Final restored-baseline/hash assertions were reached, and `original_artifacts_unchanged=true` matches the six export hashes and input snapshot; `visual_verified=false` and `desktop_interaction_verified=false` remain. This synthetic suite result does not upgrade round 19's partial 5/36 run. Existing packages without v3 remain compatible and unverified for comparison; malformed or mismatched declarations must fail, not bypass validation. The fixtures remain synthetic, not observed ocean evidence; 4/4 declarations are not independent re-execution or visual approval.

Supply external artifact checks to `build_ocean_report.py` through an explicit `--rendered-audit` file. The report validates that file's byte/hash snapshot, manifest/artifact bindings, and check/status consistency; it does not discover an audit automatically or independently rerun or authenticate the inspector. The shell workflow runs rendered-artifact inspection before report generation and passes the file explicitly. Omitting the option leaves external checks `not_verified`; an explicitly supplied missing, malformed, or inconsistent file must fail report generation. Known `pdf_font_embedding` failures on the older releases must remain visible as failures, not be hidden by unverified text or visual checks. Current round 22 passed external checks for 12/12 evaluator artifacts on R2026a; R2021a/R2024b each retained four PDF font-embedding failures, including unembedded Courier. The separate historical R2024b DISPLAY diagnostic rejected an unsupported SVG `font` element with `oi_annotate_svg:UnsupportedNormalization`; do not conflate that diagnostic with evaluator artifacts. These are external automated declarations, not a trusted visual audit or overall CI pass; successful report construction does not make the reported artifact failures pass. The report status aggregator candidate does not read `generatedRoot` without a valid report-bound policy. With that policy, it requires complete entry, manifest, artifact-reference and MATLAB-source path preflight before physical checks; scientific-field failures do not skip those checks or become passes. New status/policy/AST and pixel-gate code is not deployed to production; synthetic tests do not validate a real-ocean report.

The round-20 source candidate shares strict UTC coverage parsing through `parseOceanEvidenceTime` and requires main-report `data-uncertainty-status`/`data-uncertainty-method` to match manifest context exactly. The nonempty `data-uncertainty` explanation still needs human review; substring matches do not certify semantics. These source contracts do not establish validation of a real ocean-region report or authenticate every raw point timestamp.

## Failure Rules

- Do not fabricate data, units, metadata, execution, toolbox availability, or artifacts.
- Do not silently smooth, interpolate, sort, transpose, fill, clip, normalize, or reverse data.
- Do not silently change runtime, release, export format, renderer, or scientific plot type.
- If MATLAB is unavailable, perform static validation only and return `runtime-unavailable` with `execution_verified=false`.
- If execution succeeds but an artifact is absent, empty, clipped, unreadable, or inconsistent, return `failed` and retain logs and validation evidence.
- Reject malformed or contradictory request fields before plot generation; do not silently select one alias, merge duplicate top-level and plot metadata, coerce availability strings, or accept a legacy catch path that exits successfully after failure.

## Validation

Run the repository route tests and skill checks:

```bash
node --test codex-runtime/server/matlab-task-routing-contract.test.mjs codex-runtime/server/matlab-plot-router.test.mjs codex-runtime/server/matlab-plotting-instructions.test.mjs codex-runtime/server/matlab-interaction-contract.test.mjs codex-runtime/server/matlab-runtime-wiring.test.mjs
python3 /root/.codex/skills/.system/skill-creator/scripts/quick_validate.py codex-runtime/matlab
```

Run canonical MATLAB skill static validation when that installed skill is available. Report MATLAB runtime or rendering as unverified unless MATLAB actually ran.
