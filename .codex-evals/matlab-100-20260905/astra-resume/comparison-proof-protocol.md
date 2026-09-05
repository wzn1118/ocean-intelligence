# Comparison Native Evidence Protocol, Round 15 Draft

Status: DESIGN ONLY. No implementation or runtime proof is supplied by this
document. The proposed comparison schema is v3, scoped exclusively to
`paired-observation-model`. Existing grid v1 and interactive v2 declarations,
scoring, visual gates, and freeze files remain unchanged. An old package with
three verified figures does not thereby verify its fourth, comparison figure.

## Read-only baseline and actual gaps

Read against commit `fe95f89e675a9ec4909935ba1b1f2677fff9b487`:

| Source | Relevant current behavior |
| --- | --- |
| `codex-runtime/matlab/assets/oi_plot_comparison.m:27` | Accepts observation/model QC and explicit accepted values, but does not return the resolved raw flags or acceptance policy. |
| `codex-runtime/matlab/assets/oi_plot_comparison.m:127` | Returns masks, pair indices, counts, Metrics and graphics handles; not full input values, time/depth/ID records or raw uncertainty. |
| `codex-runtime/matlab/assets/oi_plot_comparison.m:271` | Requires BOTH uncertainty vectors. The allowed types at line 278 omit `standard-uncertainty`. |
| `codex-runtime/matlab/assets/oi_plot_comparison.m:372` | Uncertainty graphics are ordinary native Line segments, horizontal and vertical per pair, NOT ErrorBar objects. |
| `codex-runtime/matlab/assets/oi_plot_comparison.m:400` | The R2021a DataTip branch has only X/Y rows. SampleLabels are accepted elsewhere but not uniqueness-validated stable IDs or complete returned identity evidence. |
| `codex-runtime/matlab/evals/run_matlab_gate.m:76` | Reads and snapshots the paired fixture, but passes only values/labels to this helper, not QC, uncertainty or time/depth. The `present` science fields describe fixture metadata, not native propagation. |
| `codex-runtime/matlab/evals/run_matlab_gate.m:335` | Only the two grid export calls supply fixture/snapshot arguments and enter the grid measurement path. Comparison needs its own dispatch before figure close. |
| `codex-runtime/matlab/evals/build_ocean_report.py:623` | Validates grid v1 and interactive v2 only; missing comparison declarations stay `not_verified`. |
| `codex-runtime/matlab/evals/build_ocean_report.py:1025` | Paired statistics are independently computed, but the comparison context does not retain full values/uncertainty in `plot_input`; unique coordinate summaries cannot replace ordered record arrays. |

Actual input is `codex-runtime/matlab/evals/fixtures/paired_observation_model.json`,
SHA256 `dfdd4a9b3270151e02b8c91970775ed10ebfc862bc8119c3cccb85b99b6f676b`.
This hash identifies the read-only design input, not a newly verified runtime.

There are 12 ordered synthetic records, 11 complete observation/model pairs,
10 good flags, one suspect (`pair-006`), and one missing (`pair-012`). The last
record has observation=null, uncertainty=null, but model=13.96. Its model
value, ID, time, depth and QC must remain in the full returned evidence even
though it has no native scatter point. Uncertainty is ONLY observation-side
standard uncertainty in degC. Model uncertainty and model-specific QC are
`not_provided`, not zero, not copied observation metadata, and not estimated.

## Scientific decision and minimum production extension

Recommend observation-only horizontal native Line segments, reusing the
existing horizontal half of `plot_uncertainty`. For a retained pair, draw
`[observation-u, observation+u]` at constant `model`. This displays plus/minus
one observation standard uncertainty, NOT a confidence interval, model error
interval, combined uncertainty or uncertainty in model Y. Do not draw a
vertical segment, including a fake zero-length one.

Metadata-only retention would prove propagation but not uncertainty drawing.
It requires less geometry verification, but does not address the actual
on-figure capability gap. This v3 profile therefore requires horizontal
segments; absent geometry is not silently downgraded into a verified v3
declaration. Switching to ErrorBar is unnecessary for this narrow extension
and must not be implied by field names. Existing Line drawing is already the
helper's cross-release primitive.

All names and capabilities in the following list are PROPOSED additions:

1. Add explicit `UncertaintySides="observation"`. Default `"both"` preserves
   the old both-or-neither input requirement and both-sided filtering/drawing.
   In the new branch require observation uncertainty, reject supplied model
   uncertainty, and accept the additional exact type `standard-uncertainty`.
   Normalize only the fixture spelling `standard_uncertainty` to that spelling
   at the input adapter; never relabel it standard-error/standard-deviation.
   No automatic inference of a missing side, no new model-only mode this round.
2. In that branch, scatter/statistic membership remains finite pairs AND QC
   acceptance. Uncertainty completeness only controls horizontal segments:
   `GraphicsMask = PairedMask & isfinite(observationUncertainty)`. Retain raw
   uncertainty nulls. A finite observation with missing model may retain its
   observation uncertainty but has no segment; finite uncertainty on a missing
   observation is invalid. Missing uncertainty on a finite pair must not erase
   the scatter or alter pair statistics. The fixed fixture has no such pair;
   helper tests must nevertheless distinguish these policies. Do not change
   the existing default both-sided completeness policy in this extension.
3. Add optional `RecordMetadata`, limited initially to numeric row-aligned
   inputs, with exact fields `ID`, `Time`, `Depth`, `DepthUnit`, `DepthDirection`.
   Require N unique nonblank string IDs, N zoned non-NaT UTC datetime values,
   N finite nonnegative depths, `m`, and `positive_down`. Generate SourceRow
   within the helper as `1:N` at call entry, never accept claimed source rows
   from the caller. Reuse existing SampleLabels for display: in this profile
   absent SampleLabels use ID, and explicit SampleLabels must equal ID.
   Do not promote default `Pair 1` labels to fixture IDs. Calls without this
   new metadata retain their existing behavior but cannot emit v3 proof.
4. Add `result.RecordData` containing the full validated, aligned, PRE-FILTER
   values and metadata actually consumed by the helper. Exact new fields:
   `RecordID`, `Time`, `Depth`, `DepthUnit`, `DepthDirection`, `SourceRow`,
   `SourceRowOrigin`, `Observation`, `Model`. SourceRowOrigin is
   `call_entry_order`. The result is assembled from resolved locals, not by
   returning an unchecked copy of the options struct.
5. Add `result.QC` with `Observation`, `Model`, `AcceptedValues`. A supplied
   side is `{Status:"provided", Flags:resolvedFlags}`; an absent side is
   exactly `{Status:"not_provided"}`. Use existing ObservationQC and
   AcceptedQCValues inputs. No model QC is supplied for this fixture. Existing
   `QCAcceptedMask` remains the actual mask. This exposes the actual policy
   operands without inventing a `QCPolicy` option that the helper lacks today.
6. Add `result.Uncertainty` with `Sides`, `Observation`, `Model`,
   `Representation`, `Display`, `GraphicsMask`. Supplied sides contain exactly
   `{Status:"provided", Values:resolvedMagnitudes}`; absent sides contain only
   `{Status:"not_provided"}`. Existing result UncertaintyType, UncertaintyUnit
   and ConfidenceLevel remain the semantic sources. For this branch use
   `Sides="observation"`, `Representation="magnitude"`,
   `Display="horizontal-line-segments"`. Do not fabricate model bounds as
   uncertainty evidence; unexpanded model centers may still contribute to
   axis limits without asserting model uncertainty.
7. At actual graphics creation, add `UserData.RecordID`, `SourceRow`, and
   `SourceRowOrigin` to Scatter and each uncertainty Line, using the same
   paired/group masks that select their native coordinates. Scatter metadata
   are M-vectors; segment metadata identify its single source row. This
   version-independent mapping, not R2021a DataTips, carries plotted identity.
   Do not change DataTip behavior as a prerequisite to this proof.

The figure must identify horizontal spans as observation standard uncertainty
and state that model uncertainty is not provided, using an actual existing
legend/subtitle/text surface. Gate checks must inspect that native text and
include the horizontal endpoints in final axis limits. Do not assert visual
legibility from text presence or from native handle geometry. No new layout
framework is needed, and the old both-sided annotation remains unchanged.

## Exact comparison v3 declaration

Location: the comparison figure's
`scientific_data_contract.plot_data_evidence`, not manifest/runtime root.
The following is a field/type specification, NOT fabricated runtime JSON.
N is the complete fixture record count; M is the complete-pair count. Every
root/nested key set shown is exact. Placeholders such as `number[N]` denote
flat JSON arrays, not literal JSON strings or scalar alternatives.

```text
schema_version = 3
figure_id = "paired-observation-model"
fixture_id = "paired-observation-model"
fixture_sha256 = bound input SHA256
matlab_release = actual canonical RYYYYa/b
dimension_order = ["observation"]
shape = [N]
quantity_unit = "degC"
missing_policy = "preserve"
records = {
  ids:string[N], time_utc:string[N], time_zone:"UTC",
  depth_m:number[N], depth_unit:"m", depth_direction:"positive_down",
  source_rows:integer[N], source_row_origin:"call_entry_order"
}
input_values = {observation:(number|null)[N], model:(number|null)[N]}
pairing = {
  rule:"row-aligned", observation_indices:integer[N], model_indices:integer[N],
  finite_pair_mask:boolean[N], paired_mask:boolean[N],
  unmatched_observation_count:0, unmatched_model_count:0,
  duplicate_key_policy:"reject"
}
qc = {
  policy:"preserve",
  observation:{status:"provided", flags:string[N], accepted_values:["good","suspect"]},
  model:{status:"not_provided"},
  accepted_mask:boolean[N]
}
native_data_source = "Scatter.XData/YData"
native_scatter = {
  source_rows:integer[M], record_ids:string[M],
  x_values:number[M], y_values:number[M]
}
uncertainty = {
  type:"standard-uncertainty", unit:"degC", representation:"magnitude",
  confidence_level:null, display:"horizontal-line-segments",
  observation:{status:"provided", values:(number|null)[N], missing_mask:boolean[N]},
  model:{status:"not_provided"},
  graphics_mask:boolean[N],
  native_data_source:"UncertaintyGraphics.XData/YData",
  segments:[
    {source_row:integer, record_id:string, x_values:number[2], y_values:number[2]}
    // One object per true graphics_mask entry, in source-row order.
  ]
}
paired_stats = {
  paired_count:integer,
  bias_model_minus_observation:number,
  mean_absolute_error:number,
  root_mean_square_error:number,
  pearson_correlation:(number|null)
}
```

An absent model side permits ONLY its status key: no values, flags, unit,
type, zeros, empty arrays or null-array placeholders. No `verified`,
`input_match_asserted`, `rendered`, desktop or CJK booleans are added. A status
string alone is never enough to validate any supplied-side evidence.

## Provenance and measurement lifecycle

The helper is fixture-agnostic: it receives scientific inputs but not a
fixture object, fixture hash, expected arrays or an evidence object. Gate
serialization reads the following actual sources:

| Declaration | Source to read, not reconstruct from fixture |
| --- | --- |
| records / input_values | New result.RecordData, including rows absent from Scatter |
| pairing | Existing result.PairingRule, pair indices, masks, unmatched counts and DuplicateKeyPolicy |
| qc | New result.QC plus existing QCAcceptedMask; policy `preserve` only after the full checks below |
| native_scatter | Actual single Scatter.XData/YData and its UserData identity mapping |
| uncertainty | New result.Uncertainty, existing semantic outputs, every actual uncertainty Line.XData/YData and its UserData |
| quantity_unit | Existing result.Metrics.QuantityUnit, cross-checked with input and actual axis labels |
| paired_stats | Existing result.Metrics.PairedCount/Bias/MAE/RMSE/Correlation |
| fixture identity/hash | Existing paired input snapshot binding, not a helper self-assertion |

The gate must pass actual QC, uncertainty, ordered ID/time/depth metadata and
the explicit new observation-only mode. Pass paired fixture/snapshot through
export_plot for a distinct comparison reader, not the existing grid reader.
Capture the helper result; export the SAME figure; measure live native handles
after export and drawnow, before figure close. Do not plot a second proof-only
figure, mutate graphics after measurement, or retrofit old runtime JSON.

Require one ungrouped native Scatter in the exported Axes. Check returned
Scatter and uncertainty handles against actual owned graphics, not a supplied
handle count. Require the same Axes/Figure ancestry, visible axes/primitives,
linear normal X/Y axes, finite native coordinates, and nonhidden scatter
markers. Figure.Visible may be off in batch; Line.HandleVisibility="off"
only excludes legend/discovery and must not be confused with Visible="off".
Each uncertainty segment is one native Line with exactly two X and two Y
entries. The existing 1:1 reference Line is not a scatter or uncertainty
source. Reject extra/grouped Scatters, wrong parents, extra vertical uncertainty
graphics, missing segments and source-row reordering in this fixed profile.

Gate compares every result/native value to independently obtained expected
fixture data, then serializes result/native data, never the expected arrays.
Check native UserData against the full returned record selected by SourceRow.
The report separately reconstructs expected arrays from the frozen fixture's
raw records, NOT from compressed statistics, unique time/depth summaries,
claimed IDs, masks or MATLAB metrics. Extend the comparison context's
plot_input for these independently parsed arrays; retain the 2D paths intact.

Retain existing runtime identity/release/nonce/freshness/artifact checks and
the input snapshot bytes/hash/path/symlink protections and end-of-run recheck.
The declaration hash must equal the bound paired snapshot and independently
loaded frozen fixture hash. Actual runtime and all figure releases must agree
under existing strict normalization; do not weaken it to accept version banners.
No additional ad hoc evidence hash replaces the existing manifest, snapshot
and artifact binding chain.

## Cross-language invariants

1. Parse exact object shapes before deciding verification status. Reject
   unknown/missing fields, duplicate JSON object keys, null/list/scalar objects,
   and unknown/wrong-figure schemas. Every vector, including `[N]` shape and
   `["observation"]`, remains an explicit flat JSON array even for length one.
   MATLAB must deliberately preserve arrays and the segments object array.
   JSON integer fields require actual integers, excluding booleans/floats;
   masks require actual booleans, excluding 0/1. Numeric checks exclude bool
   before numeric equality. Reject strings, Inf, complex values and NaN/Infinity
   JSON tokens, including numeric overflow such as 1e999. Encode intentional
   input NaN as null only at independently expected missing positions.
2. N is 12 for this fixture, not 11. Preserve original fixture record order;
   there is no numeric, lexical-ID, time-only or group sorting. IDs are unique,
   but their values are not a sorting instruction. The fixture is already
   paired within each record; `row-aligned` is the actual helper rule, not an
   ID join claim. Both pair-index arrays and full source_rows are exactly 1:N,
   one-based integers. Unmatched counts are zero. Distinguish unmatched rows
   from matched rows with missing values. Do not use `row-time-inner`: times
   repeat across depths and that helper rule requires unique times.
3. Compare all N IDs, UTC timestamps and depths to the same ordered raw records.
   Times serialize canonically as YYYY-MM-DDTHH:MM:SSZ, retaining all repeats;
   parse every timestamp and compare instants AND canonical shape. There are
   four times with three records each, not a four-entry time vector. Depths
   are [10,40,70] repeated four times in m, positive_down. Time/depth here are
   returned identity metadata, NOT native scatter axes. No invented vertical
   reference, station or independent model ID field is needed.
4. Define O, Y, U as full observation, model and observation-uncertainty arrays.
   Null locations and every raw finite value must match fixture exactly; no
   interpolation, rounding, equal-shape replacement or tolerant raw-array
   equality. Define F[i] = finite(O[i]) AND finite(Y[i]). Require actual
   FinitePairMask == F. Derive observation/model missing masks from each full
   input array separately; do not erase Y[12]=13.96 merely because F[12]=false.
5. Fixture qc is a record/observation-side flag, supplied via ObservationQC;
   it is not evidence of separate model QC. Accepted values are exactly
   ["good","suspect"]. A[i] = flag[i] in that set. The literal `missing` flag
   yields A=false; this is not a finite QC rejection. Require flags, accepted
   values and actual QCAcceptedMask == A. In this profile all finite pairs pass,
   including pair-006. `policy="preserve"` requires untouched full flags and
   no finite QC exclusion; it does not certify suspect as scientifically good.
   P = F AND A; actual PairedMask must equal P. QCRejectedCount == sum(F AND
   NOT A) == 0. MissingCount == sum(NOT F) == 1; ValidCount == sum(P) == 11.
   Cross-check these existing result counts and scientific contract counts.
6. Native scatter source_rows == the increasing one-based positions of P;
   native record_ids == full IDs[P], XData == O[P], YData == Y[P], element by
   element. All four vectors have M=sum(P) entries, with no nulls. Compare both
   to result-derived subsets AND independently to fixture-derived subsets.
   Never pad Scatter evidence with a twelfth null point or sort X and Y
   independently. Identity remains significant even for equal numeric points.
7. Require observation U and its null mask for all N records; model status is
   exactly not_provided. Normalize only the one allowed uncertainty spelling.
   Unit equals observation/model degC, representation is magnitude and
   confidence_level is null, not 0.68 or 0.95. Magnitudes are nonnegative;
   u=0 is a genuine provided zero magnitude, not absence of a side. G = P AND
   finite(U); actual GraphicsMask must equal G. For this fixture G=P and there
   are 11 horizontal segments. In source-row order each segment has the same
   source ID, X=[O-U,O+U] and Y=[Y,Y]. Read BOTH endpoints natively; do not derive
   serialized endpoints from returned U. No vertical/model segment is allowed.
8. Raw coordinates, raw uncertainty and masks use exact comparisons. Derived
   segment endpoints and finite metrics may use only
   `math.isclose(rel_tol=1e-12, abs_tol=1e-12)` for binary64 arithmetic/JSON
   round trips. Counts and identities stay exact; never round to displayed
   labels before comparison. Reject null/nonfinite endpoints. MATLAB checks
   arithmetic on actual native arrays; Python derives endpoints from fixture
   independently and also checks their association with native scatter points.
9. Metrics use exactly P, equal weight per complete pair including suspect,
   residual r[i]=Y[i]-O[i], no fit/regression, QC weighting or uncertainty
   weighting. PairedCount=M, Bias=sum(r)/M, MAE=sum(abs(r))/M,
   RMSE=sqrt(sum(r*r)/M). Pearson correlation is centered covariance divided
   by centered vector norms, not correlation of independently sorted values.
   Compare actual helper Metrics against both native-scatter recomputation
   and independent fixture recomputation. Correlation is null only if fewer
   than two pairs or a constant side; it MUST be finite for this fixture.

The current fixture oracle, calculated by the existing Python fixture reader
(not MATLAB runtime evidence), is M=11, Bias=0.08727272727272767,
MAE=0.09272727272727334, RMSE=0.11159993483217405,
Pearson=0.9996003539344701. Means and within-standard-uncertainty count 8/11
remain independently derived report statistics, NOT invented helper Metrics
fields. In particular, 8/11 describes residuals within observation uncertainty
only, not model uncertainty coverage or a confidence-level calibration test.

## Verification outcome and report boundary

Missing declaration stays `not_verified`. A malformed, unsupported or
mismatching supplied declaration fails even without input binding; absence
of binding is not an early bypass. A fully matching but unbound declaration
stays `not_verified`. Only complete, matching, currently bound evidence may
become `runtime_declaration_verified` for THIS figure.

Keep existing plot_display behavior for grids (`metadata`) and interactive
(`errorbar`). Only a verified comparison v3 may yield
`plot_display="horizontal-line-segments"`, with observation scope and model
status not_provided preserved in the report. Do not call these native Lines
ErrorBar objects, mark metadata-only as plotted, or promote unverified
declarations based on fixture uncertainty presence. Scalar counts, a familiar
schema number or successful checks on the other figures are insufficient.

This verifies consistency of a bound runtime declaration with native data
reads and independently reconstructed fixture values. It is not independent
execution attestation against a malicious producer, pixel-level proof of
export contents, human visual approval, real ocean observations, verified
R2021a ID DataTips, desktop interaction, or a 100-point result. Existing
artifact/font/text/visual checks and their limitations remain separate.

## Focused acceptance examples for implementation

Positive cases:

- Unit fixture declaration: all 12 full records, 11 native points and 11
  observation-only horizontal segments; preserve pair-006 and last model
  value 13.96. Exact figure/hash/release and runtime snapshot binding verify
  only this declaration. Fabricated unit objects are explicitly unit-only.
- Real gate run on each supported MATLAB release: read actual handles and
  returned metadata; R2021a identity succeeds through UserData without
  claiming Sample ID DataTips. Export checks retain their independent status.
- Helper-only tests for provided zero observation uncertainty, observation
  uncertainty on a row with missing model, and finite pairs missing
  uncertainty verify the new scatter/segment mask distinction. These are
  capability tests, not substitutions for the frozen fixture runtime.
- Regression tests keep old both-sided successes, missing-one-side failures
  without the new opt-in, two Lines per retained old pair, all grid v1 and
  interactive v2 outcomes, and old comparison-without-proof not_verified.

Negative cases (each must fail, not merely lose a boolean assertion):

| Mutation | Required rejection |
| --- | --- |
| Change one interior native X/Y value after plotting; serialize unchanged helper values instead | MATLAB native/result/fixture mismatch; Python native array mismatch |
| Use a different figure, 1:1 Line, extra grouped Scatter, hidden primitive or zero marker size as proof | Gate type, ownership, visibility or cardinality failure |
| Replace full arrays with correct-shape alternative values, drop row 12, fill its observation, or null its finite model | Exact full fixture input/null-pattern mismatch |
| Duplicate/change/reorder IDs or pair indices, use zero-based indices, sort equal-valued records, or retain only unique times/depths | Full identity/pairing/coordinate mismatch |
| Swap axes, sort each axis separately, drop suspect, deduplicate or aggregate points | Native ordered subset and complete-pair metric mismatch |
| Change suspect to good, omit QC, add copied model QC, or claim preserve with accepted_values=[good] | Raw flags, model absence or acceptance policy mismatch |
| Fill model uncertainty with zeros, copy U, use standard-error or claim 95% CI | Exact absent-side schema/type/confidence failure |
| Keep correct U but omit/shorten/reverse/move a horizontal segment or add a vertical one | Native segment mask, identity, both-endpoint or cardinality mismatch |
| Label metadata-only uncertainty as rendered, or use fake ErrorBar delta fields for Line objects | Unsupported display/native source/unknown fields |
| Negate bias, omit pair-006 from statistics, use uncertainty weights, claim M=12, null the defined correlation | Full independent metric/membership mismatch |
| Use bool as number/index, 0/1 masks, numeric strings, scalar shape/vector/segments, extra keys, duplicate JSON keys or NaN tokens | Strict JSON shape/type failure, also when unbound |
| Supply wrong schema/figure/release/hash, unsafe/stale snapshot, or modify bound input/artifact after measurement | Existing binding checks plus comparison identity failure |

A valid but unbound declaration and no declaration are explicit NOT-VERIFIED
tests, not the malformed-declaration cases above. Tests must exercise
native-handle mutation before capture; Python-only fake payloads cannot
demonstrate that the MATLAB producer reads its handles.

No implementation, test, runtime package, historical evidence, source freeze,
score, commit or push is changed by this draft. Integration and real runtime
verification are work for the next approved round.
