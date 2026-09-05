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

Legacy `print` is an explicit preselected strategy, not a retry after failure. Exact `exportgraphics` uses `Units="inches"`, `Width`, `Height`, `Padding="figure"`, and `PreserveAspectRatio="on"`. Preserve export errors and stop; never silently retry with `print`. Record the actual per-figure, per-format `export_api` consistently with runtime evidence; a selected strategy is not proof of execution. These repository constraints take precedence over generic API recommendations in the capability matrix.

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
- `typography`: selected font and fallbacks, final-size tick/label/title sizes, line width, and interpreter. Verify installed font family names by exact, case-insensitive matching against `listfonts` or `fc-list` enumeration. A substitute returned by `fc-match` fallback does not prove the requested font is installed. A matching font candidate proves neither PDF font embedding nor readable CJK glyphs. Chinese delivery uses UTF-8, `Interpreter="none"` for ordinary labels, and separate PNG/PDF/SVG artifact checks; leave unverified embedding and glyph claims unverified.
- `color`: palette class and source, white or declared background, distinct missing-data appearance, minimum contrast ratio, grayscale and color-vision checks, and redundant line/marker/label encoding instead of color alone.
- `clipping` and `accessibility`: require `drawnow` before bounds/overlap inspection, check titles/ticks/legends/colorbars/annotations, preserve reading order, and require accessible title/description evidence in formats that support it.
- Check `tiledlayout` titles in every requested format for text, glyphs, allocated space, and clipping. Their geometry coverage gap is still under diagnosis, not a confirmed fix. Passing the current bounds gate alone does not prove that layout titles are complete; retain unverified status without artifact evidence.
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

## Output Contract

Return runnable `.m` source plus requested PNG/PDF/SVG outputs when supported. Write manifest `schema_version: 2` to a safe relative JSON path with deterministic figure IDs. Top-level evidence includes generation time, generator, runtime status, execution verification, MATLAB release, toolboxes, artifact validation, visual inspection, warnings, errors, and figures. Each figure records title, source, theme, variables, units, time/space scope, generation script, runtime release, toolbox dependencies, text/axes evidence, accessibility, rendering, publication, interaction/headless evidence, and exports.

For PNG record file, width, height, DPI, bytes, and SHA-256. For PDF/SVG record file, dimensions, bytes, SHA-256, and text or glyph evidence. Include `scientific_data_contract`, `publication_contract`, `runtime_status`, `execution_verified`, `artifact_validation`, `visual_inspection`, `warnings`, and structured `errors`.

Only verified artifacts enter the manifest or report. Never expose temporary paths, `file://` URIs, or tenant host paths.

For ocean-region reports, bind figure provenance and computed statistics to the actual input snapshots consumed by that MATLAB run. Check their relative paths, bytes, and SHA-256 against runtime records (`runtime.input_fixtures` for the fixture bundle). Reading a same-name or same-shape source file later is not runtime input evidence. Missing runtime hashes leave the binding `unverified`; mismatched hashes must be rejected, never refreshed into passing evidence. Keep synthetic fixtures labeled `synthetic_benchmark` or synthetic data even when execution and hashes are verified; they are not evidence of real ocean conditions, observed trends, or regional mechanisms.

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
