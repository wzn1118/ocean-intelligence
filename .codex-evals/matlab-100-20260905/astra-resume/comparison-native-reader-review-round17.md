# Comparison Native Reader Review, Round 17

Reviewed at 2026-09-05T22:29:53Z against the working-tree diff on HEAD
`4a445f52f30250cd5bf4f4f43dc763118398d072`.

Scope: the comparison adapter and `measure_comparison_plot_data` in
`run_matlab_gate.m`, the new helper RecordMetadata implementation, and their
agreement with `comparison-proof-protocol.md` and the completed Python consumer.
Only this review file was written. No production/test edits, freeze updates,
commits, MATLAB execution, or visual approval.

## Findings

### P2: Flattening native title characters before text conversion loses line identity

Location: [run_matlab_gate.m:514](/opt/ocean-intelligence/codex-runtime/matlab/evals/run_matlab_gate.m:514).

The reader uses `string(result.Legend.Title.String(:))`. This is correct for a
string vector or cellstr vector, but not for a multirow character matrix: `(:)`
first destroys the row boundaries. Comparing the result to the two expected
lines then rejects an otherwise equivalent native title.

Trigger condition: the native String value is a character matrix with the two
required lines as its rows. This representation is explicitly supported by the
[R2021a legend Text.String API](https://ww2.mathworks.cn/help/releases/R2021a/matlab/ref/matlab.graphics.illustration.legend.text-properties.html).
The character-array transformation is a code-level dimension error; this review
did not execute a native setter/getter round trip to establish whether a given
release normalizes that input into cellstr first. The current helper supplies
a string column, so this is NOT a demonstrated failure of the current fixture
on R2021a.

The adjacent helper test already uses the safer ordering:
[test_comparison_record_metadata.m:255](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_comparison_record_metadata.m:255)
converts the native value to string first and only then compares `titleLines(:)`.
The coordinator can use that same ordering in the reader, preserving strict
content and line-count checks. No font, consumer schema, or geometry change is
needed. A newline-delimited scalar would additionally need deliberate line
splitting if that representation is intended to be supported.

### P2: Scatter visibility check can certify fully disabled marker paint

Location: [run_matlab_gate.m:458](/opt/ocean-intelligence/codex-runtime/matlab/evals/run_matlab_gate.m:458).

The reader requires `Visible=on`, a non-none Marker, positive SizeData, and
`MarkerFaceAlpha > 0 || MarkerEdgeAlpha > 0`. It never couples those alpha values
to whether the corresponding marker face/edge color actually draws anything.
For example, this supported native state has no visible marker paint while the
current predicate and all coordinate/identity/metric checks still succeed:

```matlab
result.Scatter.MarkerFaceColor = 'none';
result.Scatter.MarkerFaceAlpha = 1;
result.Scatter.MarkerEdgeAlpha = 0;
```

No data or UserData mutation is necessary. This contradicts the protocol's
nonhidden-marker requirement at
[comparison-proof-protocol.md:208](/opt/ocean-intelligence/.codex-evals/matlab-100-20260905/astra-resume/comparison-proof-protocol.md:208).
The [R2021a Scatter properties](https://ww2.mathworks.cn/help/releases/R2021a/matlab/ref/matlab.graphics.chart.primitive.scatter-properties.html)
document both `MarkerFaceColor='none'` and numeric alpha zero. They also permit
alpha `'flat'`; comparing that character vector with zero and feeding the
result to `||` is not a scalar numeric-opacity validation.

For this fixed helper profile, check supported scalar numeric alpha values
explicitly and require an enabled painted face or edge with positive opacity.
If flat alpha is accepted later, its per-point AlphaData must be examined;
the string `'flat'` is not evidence of visibility. This is a native-state check,
not a substitute for color contrast or pixel inspection. The current helper's
filled, opaque scatter does not trigger this hole, and no MATLAB reproduction
was run here. A later Python consumer cannot recover the omitted paint state
from this v3 JSON; this belongs in the native reader, not another consumer.

## Checked Correctly

| Area | Code evidence and conclusion |
| --- | --- |
| Same exported figure | [run_matlab_gate.m:319](/opt/ocean-intelligence/codex-runtime/matlab/evals/run_matlab_gate.m:319) captures the plotting result, line 333 exports that figure, line 348 invokes the comparison reader with that figure, and line 355 closes it only afterward. The reader requires Axes/Figure ancestry and direct Scatter/Line parents. No second proof-only figure or post-measurement plot mutation is present. |
| Native ownership | [run_matlab_gate.m:455](/opt/ocean-intelligence/codex-runtime/matlab/evals/run_matlab_gate.m:455) checks the actual single Scatter with `findall`. The line count, per-line parent, unique expected source row/ID, and distinct diagonal reference together exclude duplicate returned segments and extra Lines in this fixed fixture. `findall` correctly includes uncertainty Lines with HandleVisibility off. It does not mistake these Lines for ErrorBar objects. |
| All 12 records | [run_matlab_gate.m:273](/opt/ocean-intelligence/codex-runtime/matlab/evals/run_matlab_gate.m:273) allocates one numeric slot per JSON record and fills non-null values individually. RecordData is built before filtering at [oi_plot_comparison.m:26](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_plot_comparison.m:26). Full observation/model arrays are independently compared before serialization. Row 12 retains model 13.96, ID, UTC time, depth 70 and missing QC while observation and U remain missing. |
| Identity and 11 points | [oi_plot_comparison.m:113](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_plot_comparison.m:113) selects identity using PairedMask, then uses the same group mask as the native coordinates. Segment identity uses the same sourceIndex as its endpoints. [run_matlab_gate.m:466](/opt/ocean-intelligence/codex-runtime/matlab/evals/run_matlab_gate.m:466) compares native X/Y and native UserData to the selected full records, not SampleLabels or R2021a DataTips. |
| Missing/QC | [run_matlab_gate.m:398](/opt/ocean-intelligence/codex-runtime/matlab/evals/run_matlab_gate.m:398) checks both 1:N pair-index vectors, F, A, P, unmatched counts and missing/QC counts. Accepted flags are exactly good and suspect. Pair-006 remains; the missing record is not counted as a finite QC rejection. Full observation flags remain separate from model QC, whose only field is Status=not_provided. |
| Observation-only U | [run_matlab_gate.m:426](/opt/ocean-intelligence/codex-runtime/matlab/evals/run_matlab_gate.m:426) checks all 12 magnitudes, standard-uncertainty, degC, magnitude representation, NaN confidence level, absent model values, and G=P AND finite(U). It reads both native endpoints of all 11 horizontal Lines and checks final limits. The serialized endpoints come from line_x/line_y, not recomputation from fixture U. |
| Zero/missing-U policies | The helper keeps observation-only scatter membership independent of U completeness. Existing [test_comparison_record_metadata.m:28](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_comparison_record_metadata.m:28) and the uncertainty tests exercise missing U, missing model with retained observation U, and genuine zero U. Those are helper capabilities, not substitutions for the frozen 12-record proof. |
| Metrics | [run_matlab_gate.m:520](/opt/ocean-intelligence/codex-runtime/matlab/evals/run_matlab_gate.m:520) recomputes bias Y-X, MAE, RMSE and Pearson from both native pairs and independent fixture operands. The helper's scaled-correlation/stable-norm implementation is compared with 1e-12 derived-value tolerance; raw arrays remain exact. The fixed fixture requires a finite correlation and 11 equally weighted pairs, including suspect. |
| Binding | Input bytes are snapshotted before jsondecode, hashed, and rechecked before manifest creation. The reader uses that snapshot identity/hash. The completed consumer independently loads the frozen fixture arrays, checks canonical release and exact schema, and does not promote missing or unbound declarations. No new scoring or visual-success flag is added. |

Read-only fixture inspection confirmed 12 records, 11 finite pairs, 11 eligible
segments, QC counts good=10/suspect=1/missing=1, four repeated UTC times, and
depths [10,40,70] repeated four times. This is input inspection, not MATLAB proof.

## JSON And MATLAB Dimensions

No scalar-struct expansion or JSON nesting bug was found in the current v3
construction at
[run_matlab_gate.m:538](/opt/ocean-intelligence/codex-runtime/matlab/evals/run_matlab_gate.m:538).

- RecordMetadata and RecordData constructors contain numeric/string/datetime
  arrays, not cell-valued constructor arguments that expand a struct array.
- The evidence structs are scalar. `cellstr` and `num2cell` vectors are assigned
  afterward as fields, avoiding struct constructor cell expansion.
- `{12}` and `{'observation'}` preserve the required singleton JSON arrays.
- Each segment is a scalar struct with two-element cell vectors. The outer
  `segments` cell vector preserves an array of objects even for one segment.
- Logical masks remain logical inside num2cell and encode as JSON booleans,
  not 0/1. Default jsonencode converts the intentional NaNs to null on R2021a.
- Schema v3 has the protocol's exact root/nested field sets; model QC and model
  uncertainty contain only status. Full arrays have length 12; the four native
  scatter vectors and segment list have length 11.

These encoding conclusions agree with the
[R2021a jsonencode conversion table](https://ww2.mathworks.cn/help/releases/R2021a/matlab/ref/jsonencode.html).
They are static/API checks, not a captured MATLAB v3 JSON. The producer adapter
is not a replacement for the existing strict Python JSON/fixture validation:
its isempty branch alone does not distinguish all malformed empty JSON values
from null, and jsondecode alone does not enforce duplicate-key rejection.
The unchanged frozen-input and strict consumer boundaries must remain enabled.

## R2021a And Verification Limits

The archived legend Text documentation explicitly includes Visible, String,
FontName, FontSize, FontWeight, Color and Interpreter. FontSize is in points.
Removing FontUnits was correct; do not reintroduce it. The new reader does not
call isgraphics on Legend.Title or invent its Units/Extent/Position. Numeric
Scatter/Line XData/YData, scalar/column masks, datetime Format and cell-based
serialization introduce no newly identified R2021a API blocker.

Checks executed:

```text
mh_lint --brief --input-encoding utf-8 --matlab 2021a <gate> <helper> <record-metadata-test>
  3 files analysed; no lint findings.
python3 -B -m unittest test_ocean_report.ComparisonProofTests test_evaluate.RuntimeComparisonV3EvidenceTests
  34 tests passed in 13.001 seconds; synthetic Python declarations only.
git diff --check -- <reviewed tracked production/test files>
  passed.
```

There is no local MATLAB result. In particular, no claim is made that the
native title getter representation, exported figure, runtime JSON or full CI
has passed. The existing synthetic Python tests cannot establish those facts.
No definitive failure of the unchanged current-fixture path was found; the
two findings describe explicit reader input/state conditions requiring care.

## Reviewed File Fingerprints

The following SHA256 values were unchanged between the initial and final
source checks. Paths are relative to `/opt/ocean-intelligence`.

```text
6a5fa2048fc5cba9680074995873bdf3234b20b3f18c19f7a2752243ea7be29a  codex-runtime/matlab/evals/run_matlab_gate.m
396db52a4822ea127c55fe524027432661567d2873bdf8d36fd21b168e160bd3  codex-runtime/matlab/assets/oi_plot_comparison.m
58470b0edc580cec9f107ad6de80c02954a5eb1a222eb7badecc6ba2da37362e  codex-runtime/matlab/evals/build_ocean_report.py
dfdd4a9b3270151e02b8c91970775ed10ebfc862bc8119c3cccb85b99b6f676b  codex-runtime/matlab/evals/fixtures/paired_observation_model.json
8d1097e98ae28ad8b08573c12898886c8dca4101d1784473c6c0a54f86ad25bc  .codex-evals/matlab-100-20260905/astra-resume/comparison-proof-protocol.md
```

## Coordinator Integration Follow-up

Both findings now have candidate corrections: normalize character-matrix title
rows before comparing text, and couple each enabled marker color to its actual
numeric scalar opacity. Flat alpha is rejected by this fixed proof profile;
flat color requires finite truecolor RGB data. This is not a color-contrast or
rendered-pixel claim.

The reader is extracted into `codex-runtime/matlab/evals/measure_comparison_plot_data.m`
to permit direct native-handle mutation tests. The new
`tests/test_comparison_native_evidence.m` exports real test states, calls that
same reader, mutates coordinates/identity/ownership/paint/uncertainty/returned
records, restores state and rechecks original artifact hashes. The tests are
implemented but have not yet run in MATLAB. Python mutations alone are not
reported as proof of the native rejection path. The earlier fingerprints
remain the review snapshot, not hashes of these later corrections.
