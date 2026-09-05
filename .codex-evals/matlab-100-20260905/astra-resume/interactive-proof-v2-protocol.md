# Interactive Native Evidence Protocol, Round 13

Scope: only `paired-interactive` in this change. Keep both existing grid v1
branches unchanged. The paired scatter figure remains not verified. Neither
input declarations nor successful checks imply independent execution, visual
approval, real ocean observations, or desktop interaction.

Location: `scientific_data_contract.plot_data_evidence`. Exact root keys:

```text
schema_version = 2
figure_id = "paired-interactive"
fixture_id = "crossed-time-depth-temperature"
fixture_sha256 = bound input SHA256
matlab_release = actual release
dimension_order = ["time"]
shape = [N]
selection = {kind:"depth_row", index_zero_based:2, depth_m:50}
time_utc = [N UTC timestamp strings from actual Line.XData]
time_zone = "UTC"
quantity_unit = "degC"
missing_policy = "preserve"
native_data_source = "Lines(1).XData/YData;UncertaintyHandles(1).XData/YData/YNegativeDelta/YPositiveDelta"
native_values = [N actual Line.YData values, missing represented by null]
missing_mask = [N JSON booleans]
observation_ids = [N actual Line.UserData.ObservationID values]
source_rows = [1, ..., N] from actual Line.UserData.SourceRow
source_row_origin = "call_entry_order"
input_match_asserted = true
qc = {provided:true, policy:"preserve", flags:[N actual UserData.QCFlag strings]}
uncertainty = {
  present:true, type:"standard-uncertainty", unit:"degC",
  representation:"magnitude", confidence_level:null, display:"errorbar",
  values:[N actual UserData.Uncertainty values], missing_mask:[N booleans],
  joint_valid_mask:[N booleans],
  errorbar:{time_utc:[N actual ErrorBar.XData timestamps],
            values:[N actual ErrorBar.YData values],
            negative_delta:[N actual ErrorBar.YNegativeDelta values],
            positive_delta:[N actual ErrorBar.YPositiveDelta values]}
}
```

All nested key sets are exact. All vectors are flat JSON arrays, including
one-element dimension_order and shape; MATLAB must explicitly preserve these
arrays. Numeric strings and booleans are not numbers. Masks are booleans, not
0/1. Null is allowed only at the independently reconstructed missing positions.
No NaN or Infinity JSON tokens. Schema version, index and shape require strict
integer validation rather than Python bool/int equality.

MATLAB verifies actual Line and ErrorBar handles belong to the same exported
Axes and Figure and are visible. Read every X/Y/delta, not just endpoints or
input arguments. Compare all six times, values, missing masks, IDs, source rows,
QC, units and uncertainty semantics against the bound third fixture depth row.
Keep the suspect row. Assert TimeZone UTC, output QCPolicy and QCSummary against
the full flag list; assert UserData.Time matches native XData. SourceRow refers
to call-entry order, not flattened two-dimensional fixture indices. Check
output ValidCount/MissingCount against the joint value/uncertainty mask and
UncertaintyMissingCount against finite values lacking uncertainty. The report's
primary value missing counts must remain separate from these joint counts.

Python reconstructs the expected row independently from the frozen fixture,
including IDs temp-050m-001 through temp-050m-006, timestamps, flags, units and
uncertainty. Each ErrorBar delta equals the fixture uncertainty magnitude,
including nulls. Normalize the fixture's standard_uncertainty to the explicitly
supported standard-uncertainty spelling only. Selection/index/depth must all
match; no tolerant array or timestamp reordering. Derived QC/missing counts
must not be inferred from self-reported booleans.

No declaration keeps the old not_verified behavior. Malformed or inconsistent
provided declarations fail even without a bound input. Matching local arrays
without runtime input binding remain not_verified. Only a fully checked and
input-bound declaration becomes runtime_declaration_verified. Report
plot_display comes from the validated declaration: errorbar here, metadata for
the two existing grids. The paired scatter figure is unchanged.

Ownership: Confucius edits run_matlab_gate.m only; Boole edits
build_ocean_report.py only; Heisenberg edits test_ocean_report.py only.
The coordinator integrates evaluate.py, freeze files and documentation after
the three components agree. No scoring weights, acceptance thresholds, real
data labels, visual flags, or existing v1 field sets may be weakened.
