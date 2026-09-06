# MATLAB 100-point evaluation framework

This directory is the executable half of the MATLAB full-score gate. It uses
three deterministic synthetic fixtures, all explicitly marked as non-observed
data. Every fixture repeats multiple depths at multiple UTC times; time and
depth therefore form a crossed design instead of a one-to-one confounded axis.

## Layers

1. `evaluate.py --runtime skip` validates fixtures, scientific contracts,
   anti-cheat behavior, static MATLAB source, tests, and the frozen hash set.
2. `evaluate.py --runtime require` launches the real `matlab -batch` process,
   creates a fresh output directory, binds it to an evaluator nonce, executes
   plotting and interaction assertions, and rehashes PNG/PDF/SVG externally.
3. A trusted `visual-audit.json` must bind to the manifest and every artifact
   hash before glyphs, vector fonts, clipping, accessibility, DataTip, Brush,
   and headless behavior can receive the final 10 points.

Candidate-provided `score`, `status`, comments, strings, reports, Octave logs,
or nested gate fields are never scoring inputs. Only evaluator-owned results
contribute to the score defined in `rubric.json`.

## Native Generator Smoke

The GitHub workflow prepares two scripts through the actual server plot router,
then runs them in the licensed MATLAB process as `generated-router-runtime`.
The cases cover a static time series and a headless interactive time series
with declared synthetic inputs, missing values, units, UTC times, and stable
observation IDs. Generated source and inputs are hash-bound in a fresh
`generated-router` directory. Preparation or execution failure remains a failed
stage; it does not prevent collecting the other stages.

This is an additional regression check, not all-route coverage, a score bonus,
or evidence of desktop interaction or visual correctness. The independent
publication, evaluator, external artifact, and trusted visual gates still apply.

Reports bind statistics to the fixture snapshots actually consumed by MATLAB,
not just to same-named files. Snapshot bytes and SHA-256 must match runtime
records and report inputs. Synthetic benchmark results must not be described
as observed conditions in a real ocean region.

Reports also distinguish file hashes/dimensions from the declared coverage of
graphics bounds. Native layout text without public geometry remains unmeasured;
old manifests without coverage fields are reported as unavailable, not complete.
Visible, nonempty legend titles without public `Extent`/`Position` also belong
in `unmeasured_text_objects`, with `role="legend.title"` and
`class="matlab.graphics.illustration.legend.Text"`; their presence requires
`bounds_audit_complete=false`. This declares missing measurement coverage,
not a repaired visual defect or a verified title boundary. Run 33996694221
passed the four native legend-title cases (visible, hidden-title, hidden-legend,
empty) and the text-bounds stage on R2021a/R2024b/R2026a. Only the visible, nonempty
case records an unmeasured title; its geometry and visual status stay unverified.

For the temperature field and salinity profiles, the MATLAB gate passes the
fixture's complete QC and uncertainty arrays to the plotting helpers without
filtering or drawing uncertainty bands. It reads native image/line values and
the helpers' returned arrays into `scientific_data_contract.plot_data_evidence`.
The report checks every value, order, mask, unit, policy, release and fixture hash.
Matching runtime input snapshots are required for `runtime_declaration_verified`;
missing declarations remain `not_verified`, and inconsistent declarations fail.
This is not a visual audit or independent re-execution. Other figures do not
inherit this evidence merely because their source metadata contains QC.

The interactive temperature slice now has a separate strict v2 declaration.
After exporting, MATLAB reads every native Line and ErrorBar time/value/delta,
checks ownership of the exported figure, and compares IDs, call-entry rows, QC,
units, uncertainty and separate missing masks against the complete 50 m fixture
row. The report independently reconstructs that row; single-element shape and
dimension-order fields remain JSON arrays. Only a bound, matching declaration
can be verified, and its uncertainty display is errorbar rather than metadata.
Round 13 passed this v2 path on R2021a/R2024b/R2026a. Those earlier archived
reports retain 3/4 native-proof coverage, with comparison `not_verified`.
Rounds 18 and 19 have 4/4 bound declarations on all three releases: every entry under
`report-evidence.json`'s `runtime_evidence.figures` has
`plot_data_evidence.status="runtime_declaration_verified"`. Do not upgrade old
packages with evidence from this later run.

Comparison v3 (`schema_version=3`) for `paired-observation-model` first completed
licensed same-figure data binding in round 18.
`oi_plot_comparison` accepts optional strict `RecordMetadata` only for numeric
row-aligned inputs: exactly `ID`, `Time`, `Depth`, `DepthUnit`, and
`DepthDirection`, with unique nonblank string IDs, non-NaT UTC datetimes and
finite nonnegative depths in `m`/`positive_down`, all aligned to input rows.
Explicit `SampleLabels` must match all IDs; matching string or `cellstr` vectors
are valid, while `RecordMetadata.ID` must remain a string vector.
`SampleLabelVariable` is not accepted with this metadata.
It retains complete `RecordData` and supplied/not-provided QC, with native
Scatter and horizontal Line `UserData` carrying IDs and call-entry row numbers.
Omitting metadata preserves existing numeric/tabular calls without invented
identity or `RecordData`; this option does not extend tabular pairing.

`run_matlab_gate.m` now calls the comparison helper with this metadata,
observation QC and observation-only standard uncertainty, then reads native
Scatter values and horizontal Line endpoints, ownership and identities into
v3 evidence. The report/evaluator consumer and mutation tests validate all 12
synthetic records, all 11 scatter pairs, unplotted input values, complete masks,
statistics, release and input hashes. Model QC and uncertainty stay
`not_provided`: never fill them with zeros or copy observation values. Missing
observation uncertainty does not remove otherwise accepted scatter pairs.
Runs 33997547843 and 33999054663 produced and consumed v3 on R2021a/R2024b/R2026a.
Consumer mutation tests are distinct from `test_comparison_native_evidence`:
round 18 never reached that suite; round 19 completed four positive cases and
only 5/36 reader-negative cases before an invalid SizeData setter stopped it.
The 4/4 declarations are not native mutation-test success, independent re-execution, or visual
approval. Legacy packages without v3 remain compatible,
with comparison unverified; malformed or inconsistent declarations fail.
The fixtures remain synthetic, not measurements of real ocean conditions.

The evaluator reuses the same report validator for all provided native array
declarations. It rejects misplaced, malformed or inconsistent evidence before
returning runtime success, while preserving absent-declaration compatibility,
artifact checks and input-snapshot integrity checks. Neither validator grants
visual approval or additional scoring weight for a declaration alone.

The GitHub postprocessing probe uses the same MathWorks `run-matlab-command`
launcher as `matlab-actions/run-command@v3`, with online batch licensing enabled.
It still runs the MATLAB vendor assertion and parses the actual release marker;
it does not reuse an old probe or bypass the runtime and visual gates. Local
inspection defaults to the ordinary `matlab` launcher. The action's packaged
launcher path is explicit in the workflow and must be checked on action upgrades.
Observed direct-launch failures in run 33987455982 are retained in its sanitized
`regression-contract.log`; no license credentials are copied or installed.

Native page and vector-text probes preserve experimental files separately from
promoted publication artifacts. An export call completing is not a finding that
the experimental PDF has exact dimensions, embedded fonts, or correct layout.

The workflow also runs publication and native PDF probes on an isolated Xvfb
display after the primary gates. The `display-comparison` directory
and display-server logs are independent diagnostics. `summarize_ci.py` displays
them separately, without adding stages or points or changing the main outcome.
Virtual display availability and callback completion do not prove desktop
interaction, font embedding, text alignment, or a successful visual review.

Run 33989124823 retained a no-display baseline on all three releases. Its R2026a
display controls removed the observed text-anchor clipping in two samples while
preserving exact pages; R2021a/R2024b print fonts remained unembedded. The next
full R2026a gate uses the same Xvfb environment as a candidate rendering setup,
with actual display and screen DPI recorded. This changes the R2026a environment,
not the artifacts or acceptance rules; it is not an all-figure visual approval.
The two older primary jobs remain no-display. Desktop interaction stays unverified.

Run 33989846546 passed all twelve external evaluator artifact checks on R2026a
under that display setup, including PDF text and font checks. This is not a
manual visual approval. Native raster output still failed exact dimensions in
two other suites. The next candidate requested integer pixel dimensions for PNG
and inches for PDF/SVG, recording `runtime.export_size_units` per format. The
publication suite exercises 400x300 at 150 DPI, 1200x675 at 180 DPI, and 997x613
at 300 DPI, with actual dimensions and embedded DPI checked before promotion.
That pixel-based candidate was not yet validated at that point; no resampling
or relaxed geometry tolerance was used. Rounds 12/13 subsequently passed the
full three-release native dimension regression with inches/off for R2026a PNG,
without implying whole-figure visual approval.

Run 33990723561 confirmed that integer pixel requests alone did not fix the
R2026a off-by-one output. A separate native raster probe now compares pixels
versus inches and PreserveAspectRatio on versus off on fresh figures. Its files
are diagnostic, never promoted report artifacts or evidence of visual quality.
The existing publication gate still rejects incorrect raster dimensions.
The added fractional-inch case also exposed PDF physical-size metadata copied
from the request rather than the actual MediaBox. Record the measured page size;
the existing one-point PDF request tolerance and strict metadata checks remain.

Run 33991563211 completed 52/60 runtime stages. Its twelve native raster
diagnostics returned exact dimensions in all six PreserveAspectRatio="off"
cases, compared with two of six "on" cases. However, the pixel/off images
visibly reduced physical font sizes and changed ticks, so that combination was
rejected. The next production candidate uses inches/off for PNG and keeps
inches/on for PDF/SVG. The three inches/off diagnostics had exact dimensions
and retained large physical typography, but this is not full-layout approval.
The publication suite now checks native equal-data-scale circle pixels,
unchanged source arrays and point sizes, in addition to dimensions and DPI.
No raster resizing, clipping, artificial padding, or relaxed size check is used.

The same run confirmed the PDF metadata fix; older releases then reached a
native SVG aspect-ratio mismatch. A separate raw SVG print probe compares
default resolution with explicit -rDPI on fresh figures, in both primary and
DISPLAY diagnostics. XML attributes and hashes are read without rewriting SVG.
The existing strict SVG gate remains unchanged. The points-based text test also
exposed a row/column broadcasting bug; normalizing both extents to four-element
rows fixes the comparison without changing its 1e-6-pixel threshold.

Round-19 run 33999054663 (remote commit `85ab9d20`) completed 19/20 primary stages on each of
R2021a/R2024b/R2026a, 57/60 in total. `evaluator-runtime` passed on all three;
each original `evaluator-result.json` has score 90 and status `runtime_pending`,
not overall CI or visual approval. Corrected `SampleLabels`/`cellstr` metadata
tests passed. The native adversarial suite completed four positive cases and
5/36 reader-negative cases, then `Scatter.SizeData=0` failed at its setter with
`MATLAB:hg:shaped_arrays:PositiveOrNanVectorDataPredicate`, before the reader call.
Round 20 substitutes setter-valid `NaN` and guards cleanup of deleted handles;
remaining cases and final restoration/hash assertions still need licensed CI.
Do not count setter failures as reader rejections or declare the suite passed.

Existing appdata `OI_ColorAccessibilityRole="uncertainty"` annotates only actual
helper-created uncertainty Lines. Round 18 completed the independent
`test_comparison_uncertainty` PNG/PDF/SVG exports and manifest on all three
releases. This does not change the audit algorithm, data, dimension gates or
visual gates. Hidden handles or role declarations must not exempt arbitrary
data lines or establish visual approval.

Round 19 passed 12/12 external evaluator artifact checks on R2026a.
R2021a/R2024b each retained four `pdf_font_embedding` failures, including
unembedded Courier; the generated reports preserve those failures. The separate
R2024b DISPLAY diagnostic still rejected an unsupported SVG `font` element with
`oi_annotate_svg:UnsupportedNormalization`, outside the accepted normalization
profile. Neither that diagnostic nor external declarations replace visual audit.

## Commands

```bash
npm ci --prefix codex-runtime/server --ignore-scripts --no-audit --no-fund
python3 -m unittest discover -s codex-runtime/matlab/evals/tests -p 'test_*.py' -v
python3 codex-runtime/matlab/evals/evaluate.py --runtime skip
python3 codex-runtime/matlab/evals/evaluate.py --runtime require \
  --output-dir .codex-evals/matlab-100-20260905/framework/runtime-output \
  --visual-audit /trusted-input/visual-audit.json \
  --result .codex-evals/matlab-100-20260905/framework/runtime-evaluation.json
python3 codex-runtime/matlab/evals/evaluate.py --write-freeze
python3 codex-runtime/matlab/evals/evaluate.py --verify-freeze
```

`--write-freeze` and `--verify-freeze` are inventory-only modes. Do not combine
them with `--runtime skip` to claim that the full static evaluation was run.

The runtime output directory must not exist before a real run. Remove only that
generated directory between CI attempts; never reuse artifacts. Full CI inputs,
expected outputs, and failure conditions are machine-readable in
`ci-inputs.json`. Without MathWorks MATLAB, the only honest status is
`runtime_pending`; Octave output cannot satisfy either runtime gate.
