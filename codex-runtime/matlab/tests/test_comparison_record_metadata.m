function test_comparison_record_metadata()
addpath(fullfile(fileparts(mfilename("fullpath")), "..", "assets"));
[observations, models, options] = synthetic_inputs();
originalOptions = options;
originalObservations = observations;
originalModels = models;

baselineMetrics = run_case(observations, models, options);
assert(baselineMetrics.PairedCount == 11, ...
    "test_comparison_record_metadata:CompletePairs", "The synthetic fixture has eleven complete pairs");
explicitLabels = options;
explicitLabels.SampleLabels = options.RecordMetadata.ID;
assert(isequaln(run_case(observations, models, explicitLabels), baselineMetrics), ...
    "test_comparison_record_metadata:Labels", "Explicit matching IDs cannot change statistics");
surfaceMetadata = options;
surfaceMetadata.RecordMetadata.Depth(1) = 0;
run_case(observations, models, surfaceMetadata);
noUncertainty = rmfield(options, {'ObservationUncertainty', 'UncertaintySides', ...
    'UncertaintyType', 'UncertaintyUnit'});
assert(isequaln(run_case(observations, models, noUncertainty), baselineMetrics), ...
    "test_comparison_record_metadata:MetadataOnly", "Record identity must not depend on uncertainty graphics");

goodOnly = options;
goodOnly.AcceptedQCValues = "good";
goodMetrics = run_case(observations, models, goodOnly);
assert(goodMetrics.PairedCount == 10, "test_comparison_record_metadata:GoodOnly", ...
    "Good-only acceptance must reject suspect row six without deleting its returned record");

missingUncertainty = options;
missingUncertainty.ObservationUncertainty([2 6]) = NaN;
assert(isequaln(run_case(observations, models, missingUncertainty), baselineMetrics), ...
    "test_comparison_record_metadata:MissingUncertainty", "Missing U must not remove scatter pairs or statistics");
missingModel = models;
missingModel(4) = NaN;
missingModelMetrics = run_case(observations, missingModel, options);
assert(missingModelMetrics.PairedCount == 10, ...
    "test_comparison_record_metadata:MissingModel", "Missing model must retain observation U but no segment");

grouped = missingUncertainty;
grouped.ConfounderValues = repmat(["deep"; "surface"; "middle"], 4, 1);
grouped.ConfounderLabel = "Synthetic group";
run_case(observations, models, grouped);
grouped.AcceptedQCValues = "good";
run_case(observations, models, grouped);

order = [12 6 2 10 1 8 4 11 3 9 5 7];
reordered = options;
reordered.RecordMetadata.ID = options.RecordMetadata.ID(order)';
reordered.RecordMetadata.Time = options.RecordMetadata.Time(order)';
reordered.RecordMetadata.Depth = options.RecordMetadata.Depth(order)';
reordered.ObservationQC = options.ObservationQC(order)';
reordered.ObservationUncertainty = missingUncertainty.ObservationUncertainty(order)';
reordered.ConfounderValues = grouped.ConfounderValues(order)';
reordered.ConfounderLabel = grouped.ConfounderLabel;
run_case(observations(order)', models(order)', reordered);

test_qc_sides(observations, models, options);
test_legacy(observations, models, options, baselineMetrics);
test_negative_metadata(observations, models, options);
test_negative_labels(observations, models, options);
test_tabular_scope(observations, models, options);
assert(isequaln(options, originalOptions) && isequaln(observations, originalObservations) ...
    && isequaln(models, originalModels), "test_comparison_record_metadata:InputMutation", ...
    "Metadata regression must leave the synthetic source arrays unchanged");
fprintf("MATLAB_COMPARISON_RECORD_METADATA_NATIVE_ASSERTIONS=passed\n");
fprintf("MATLAB_COMPARISON_RECORD_METADATA_VISUAL_VERIFIED=false\n");
end

function [observations, models, options] = synthetic_inputs()
observations = [17.02; 15.37; 13.72; 17.31; 15.66; 14.01; ...
    17.38; 15.73; 14.08; 17.16; 15.51; NaN];
models = [17.10; 15.51; 13.93; 17.35; 15.76; 14.18; ...
    17.39; 15.80; 14.22; 17.13; 15.54; 13.96];
metadata = struct("ID", compose("pair-%03d", (1:12)'), ...
    "Time", datetime(2026, 8, 20, 0, 0, 0, "TimeZone", "UTC") ...
        + hours(repelem([0; 6; 12; 18], 3)), ...
    "Depth", repmat([10; 40; 70], 4, 1), ...
    "DepthUnit", "m", "DepthDirection", "positive_down");
flags = repmat("good", 12, 1);
flags(6) = "suspect";
flags(12) = "missing";
options = struct("RecordMetadata", metadata, "ObservationQC", flags, ...
    "AcceptedQCValues", ["good" "suspect"], "UncertaintySides", "observation", ...
    "ObservationUncertainty", [0.10; 0.12; 0.15; 0.10; 0.12; 0.15; ...
        0.10; 0.12; 0.15; 0.10; 0.12; NaN], ...
    "UncertaintyType", "standard-uncertainty", "UncertaintyUnit", "degC", ...
    "QuantityUnit", "degC", "Theme", oi_ocean_theme(), ...
    "Title", "Synthetic record metadata regression; not ocean observations");
end

function metrics = run_case(observations, models, options)
[figureHandle, axesHandle, cleanup] = make_axes();
result = oi_plot_comparison(axesHandle, observations, models, options);
drawnow;
observations = observations(:);
models = models(:);
sourceRows = (1:numel(observations))';
assert(isequal(result.Axes, axesHandle), "test_comparison_record_metadata:Axes", ...
    "Returned axes must be the actual input axes");
if isfield(options, "RecordMetadata")
    metadata = options.RecordMetadata;
    expected = struct("RecordID", metadata.ID(:), "Time", metadata.Time(:), ...
        "Depth", metadata.Depth(:), "DepthUnit", "m", "DepthDirection", "positive_down", ...
        "SourceRow", sourceRows, "SourceRowOrigin", "call_entry_order", ...
        "Observation", observations, "Model", models);
    assert_fields(result.RecordData, fieldnames(expected));
    assert(isequaln(orderfields(result.RecordData), orderfields(expected)), ...
        "test_comparison_record_metadata:PreFilterRecords", ...
        "Every pre-filter value, ID, UTC time, depth and call-entry row must survive unchanged");
    missingRow = find(metadata.ID(:) == "pair-012");
    assert(isscalar(missingRow) && isnan(result.RecordData.Observation(missingRow)) ...
        && result.RecordData.Model(missingRow) == 13.96 ...
        && result.RecordData.SourceRow(missingRow) == missingRow, ...
        "test_comparison_record_metadata:MissingRow", "Missing observation must preserve its model and identity");
else
    assert(~isfield(result, "RecordData"), "test_comparison_record_metadata:LegacyRecordData", ...
        "Legacy display labels must not be promoted to validated RecordData");
end
assert_fields(result.QC, {'Observation', 'Model', 'AcceptedValues'});
acceptedValues = [];
if isfield(options, "AcceptedQCValues")
    acceptedValues = options.AcceptedQCValues;
end
assert(isequaln(result.QC.AcceptedValues(:), acceptedValues(:)), ...
    "test_comparison_record_metadata:QCPolicy", "Return the actual accepted QC values, not a claimed policy");
qcMask = true(size(observations));
for side = ["Observation" "Model"]
    flags = [];
    optionName = side + "QC";
    if isfield(options, optionName)
        flags = options.(optionName);
    end
    returnedSide = result.QC.(side);
    if isempty(flags)
        assert_absent(returnedSide);
    else
        assert_fields(returnedSide, {'Status', 'Flags'});
        assert(isequal(returnedSide.Status, "provided") && isequaln(returnedSide.Flags, flags(:)), ...
            "test_comparison_record_metadata:QCFlags", "Return full actual flags including rejected and missing rows");
        qcMask = qcMask & ismember(flags(:), acceptedValues) & ~ismissing(flags(:));
    end
end
finiteMask = isfinite(observations) & isfinite(models);
pairedMask = finiteMask & qcMask;
assert(islogical(result.FinitePairMask) && isequal(result.FinitePairMask, finiteMask) ...
    && islogical(result.QCAcceptedMask) && isequal(result.QCAcceptedMask, qcMask) ...
    && islogical(result.PairedMask) && isequal(result.PairedMask, pairedMask) ...
    && result.ValidCount == sum(pairedMask) && result.MissingCount == sum(~finiteMask) ...
    && result.QCRejectedCount == sum(finiteMask & ~qcMask), ...
    "test_comparison_record_metadata:Masks", "Finite, accepted and paired masks must remain distinct");
assert(isequal(result.PairingRule, "row-aligned") ...
    && isequal(result.ObservationPairIndices, sourceRows) && isequal(result.ModelPairIndices, sourceRows) ...
    && result.UnmatchedObservationCount == 0 && result.UnmatchedModelCount == 0 ...
    && isequal(result.DuplicateKeyPolicy, "reject") && isequal(result.MissingPolicy, "preserve"), ...
    "test_comparison_record_metadata:Pairing", "Numeric inputs must retain call-entry pairing");
assert_scatter(result, axesHandle, figureHandle, observations, models, options, pairedMask);
assert_uncertainty(result, axesHandle, figureHandle, observations, models, options, pairedMask);
metrics = result.Metrics;
residuals = models(pairedMask) - observations(pairedMask);
correlation = corrcoef(observations(pairedMask), models(pairedMask));
expectedStatistics = [mean(residuals) mean(abs(residuals)) sqrt(mean(residuals.^2)) correlation(1, 2)];
actualStatistics = [metrics.Bias metrics.MAE metrics.RMSE metrics.Correlation];
assert(metrics.PairedCount == sum(pairedMask) ...
    && all(abs(actualStatistics - expectedStatistics) <= 32 * eps(max(1, abs(expectedStatistics)))) ...
    && isequal(metrics.QuantityUnit, "degC"), "test_comparison_record_metadata:Metrics", ...
    "Metrics must be computed from the native scatter membership, not full unfiltered records");
clear cleanup;
end

function assert_scatter(result, axesHandle, figureHandle, observations, models, options, pairedMask)
groups = repmat("All pairs", numel(observations), 1);
if isfield(options, "ConfounderValues")
    groups = options.ConfounderValues(:);
end
selectedGroups = unique(groups(pairedMask), "stable");
assert(numel(result.Scatter) == numel(selectedGroups), ...
    "test_comparison_record_metadata:Groups", "Each retained group needs its own native Scatter");
assert_owned_handles(findall(axesHandle, "Type", "scatter"), result.Scatter);
for groupIndex = 1:numel(selectedGroups)
    sourceRows = find(pairedMask & groups == selectedGroups(groupIndex));
    handle = result.Scatter(groupIndex);
    assert_native_handle(handle, "scatter", axesHandle, figureHandle);
    assert(isequaln(double(handle.XData(:)), observations(sourceRows)) ...
        && isequaln(double(handle.YData(:)), models(sourceRows)), ...
        "test_comparison_record_metadata:ScatterCoordinates", "Native group coordinates must match source row order");
    assert_identity(handle.UserData, options, sourceRows);
    if isfield(options, "ConfounderValues")
        assert(isequal(string(handle.DisplayName), options.ConfounderLabel + ": " + selectedGroups(groupIndex)), ...
            "test_comparison_record_metadata:GroupLabel", "The native group label must identify its actual records");
    end
    if isfield(options, "RecordMetadata") && ~verLessThan("matlab", "9.11")
        rows = handle.DataTipTemplate.DataTipRows;
        sampleRows = find(arrayfun(@(row) string(row.Label) == "Sample", rows));
        assert(isscalar(sampleRows), "test_comparison_record_metadata:SampleLabel", ...
            "Supported native data tips must use metadata IDs as sample labels");
        labels = string(rows(sampleRows).Value);
        expectedIDs = options.RecordMetadata.ID(:);
        assert(isequal(labels(:), expectedIDs(sourceRows)), ...
            "test_comparison_record_metadata:SampleLabel", "Data tip sample labels must preserve grouped record IDs");
    end
end
end

function assert_uncertainty(result, axesHandle, figureHandle, observations, models, options, pairedMask)
if ~isfield(options, "ObservationUncertainty")
    assert_absent(result.Uncertainty.Observation);
    assert_absent(result.Uncertainty.Model);
    assert(isempty(result.UncertaintyGraphics) && isequal(result.UncertaintyType, "none") ...
        && isequal(result.Uncertainty.Representation, "none") && isequal(result.Uncertainty.Display, "none") ...
        && isequal(result.Uncertainty.GraphicsMask, false(size(pairedMask))) ...
        && isempty(findall(axesHandle, "Type", "errorbar")), ...
        "test_comparison_record_metadata:NoUncertainty", "Absent uncertainty must not acquire values or segments");
    assert_owned_handles(findall(axesHandle, "Type", "line"), result.OneToOne);
    assert_native_handle(result.OneToOne, "line", axesHandle, figureHandle);
    return;
end
uncertaintyValues = options.ObservationUncertainty(:);
graphicsMask = pairedMask & isfinite(uncertaintyValues);
assert(islogical(result.Uncertainty.GraphicsMask) && isequal(result.Uncertainty.GraphicsMask, graphicsMask) ...
    && isequal(result.Uncertainty.Sides, "observation") ...
    && isequal(result.Uncertainty.Display, "horizontal-line-segments") ...
    && isequal(result.Uncertainty.Representation, "magnitude") ...
    && isequal(result.UncertaintyType, "standard-uncertainty") ...
    && isequal(result.UncertaintyUnit, "degC") && isnan(result.ConfidenceLevel), ...
    "test_comparison_record_metadata:Uncertainty", "Missing U controls segments only, not scatter membership");
assert_fields(result.Uncertainty.Observation, {'Status', 'Values'});
assert(isequal(result.Uncertainty.Observation.Status, "provided") ...
    && isequaln(result.Uncertainty.Observation.Values, uncertaintyValues), ...
    "test_comparison_record_metadata:RawUncertainty", "Full raw U must survive QC and missing-model exclusion");
assert_absent(result.Uncertainty.Model);
sourceRows = find(graphicsMask);
assert(numel(result.UncertaintyGraphics) == numel(sourceRows) ...
    && isempty(findall(axesHandle, "Type", "errorbar")), ...
    "test_comparison_record_metadata:SegmentCount", "Exactly one horizontal Line per eligible record is required");
assert_owned_handles(findall(axesHandle, "Type", "line"), ...
    [result.UncertaintyGraphics(:); result.OneToOne]);
for segmentIndex = 1:numel(sourceRows)
    sourceRow = sourceRows(segmentIndex);
    handle = result.UncertaintyGraphics(segmentIndex);
    assert_native_handle(handle, "line", axesHandle, figureHandle);
    assert_identity(handle.UserData, options, sourceRow);
    expectedX = observations(sourceRow) + [-uncertaintyValues(sourceRow); uncertaintyValues(sourceRow)];
    assert(isequaln(double(handle.XData(:)), expectedX) ...
        && isequaln(double(handle.YData(:)), repmat(models(sourceRow), 2, 1)), ...
        "test_comparison_record_metadata:SegmentCoordinates", "Each native segment must match its identified record");
end
endpoints = [observations(pairedMask); models(pairedMask); ...
    observations(graphicsMask) - uncertaintyValues(graphicsMask); ...
    observations(graphicsMask) + uncertaintyValues(graphicsMask)];
assert_native_handle(result.OneToOne, "line", axesHandle, figureHandle);
assert(axesHandle.XLim(1) <= min(endpoints) && axesHandle.XLim(2) >= max(endpoints) ...
    && axesHandle.YLim(1) <= min(endpoints) && axesHandle.YLim(2) >= max(endpoints), ...
    "test_comparison_record_metadata:Limits", "Native limits must include the actual uncertainty endpoints");
legendTitle = result.Legend.Title;
titleLines = string(legendTitle.String);
assert(string(result.Legend.Visible) == "on" && string(legendTitle.Visible) == "on" ...
    && legendTitle.FontSize == options.Theme.FontSize ...
    && string(legendTitle.FontName) == string(options.Theme.FontName) ...
    && isequal(titleLines(:), ["Horizontal: observation standard uncertainty (degC)"; ...
        "Model uncertainty not provided"]), "test_comparison_record_metadata:NativeText", ...
    "Native text must identify horizontal observation U without claiming model U");
end

function assert_identity(identity, options, sourceRows)
if ~isfield(options, "RecordMetadata")
    assert(isempty(identity), "test_comparison_record_metadata:LegacyIdentity", ...
        "Legacy labels must not become a fabricated record identity");
    return;
end
assert_fields(identity, {'RecordID', 'SourceRow', 'SourceRowOrigin'});
expectedIDs = options.RecordMetadata.ID(:);
assert(isstring(identity.RecordID) && isequal(identity.RecordID(:), expectedIDs(sourceRows)) ...
    && isvector(identity.RecordID) && isnumeric(identity.SourceRow) && isvector(identity.SourceRow) ...
    && isequal(identity.SourceRow(:), sourceRows(:)) ...
    && isequal(identity.SourceRowOrigin, "call_entry_order"), ...
    "test_comparison_record_metadata:NativeIdentity", ...
    "Native UserData must bind each plotted point or segment to its original call-entry row");
end

function assert_native_handle(handle, kind, axesHandle, figureHandle)
assert(isscalar(handle) && isgraphics(handle, kind) && isequal(handle.Parent, axesHandle) ...
    && isequal(ancestor(handle, "figure"), figureHandle) && string(handle.Visible) == "on", ...
    "test_comparison_record_metadata:NativeHandle", "Evidence must come from visible native graphics in the input axes");
end

function assert_owned_handles(actual, returned)
assert(numel(actual) == numel(returned), "test_comparison_record_metadata:OwnedHandles", ...
    "Returned graphics must enumerate all actual owned primitives");
for handleIndex = 1:numel(returned)
    assert(sum(arrayfun(@(candidate) isequal(candidate, returned(handleIndex)), actual)) == 1 ...
        && sum(arrayfun(@(candidate) isequal(candidate, returned(handleIndex)), returned)) == 1, ...
        "test_comparison_record_metadata:OwnedHandles", "Every native handle must occur exactly once");
end
end

function test_qc_sides(observations, models, options)
bothQC = options;
bothQC.ModelQC = repmat("good", 12, 1);
bothQC.ModelQC(2) = "suspect";
bothQC.ModelQC(3) = "bad";
bothQC.AcceptedQCValues = options.AcceptedQCValues(:);
run_case(observations, models, bothQC);
bothQC.AcceptedQCValues = "good";
run_case(observations, models, bothQC);
modelOnly = rmfield(bothQC, 'ObservationQC');
run_case(observations, models, modelOnly);
noQC = rmfield(options, {'ObservationQC', 'AcceptedQCValues'});
run_case(observations, models, noQC);
noQC.ObservationQC = [];
noQC.ModelQC = [];
run_case(observations, models, noQC);
end

function test_legacy(observations, models, options, baselineMetrics)
legacy = rmfield(options, 'RecordMetadata');
assert(isequaln(run_case(observations, models, legacy), baselineMetrics), ...
    "test_comparison_record_metadata:LegacyMetrics", "Optional identity metadata cannot alter legacy statistics");
legacy.SampleLabels = repmat("Display label only", 12, 1);
run_case(observations, models, legacy);
legacy = rmfield(legacy, {'ObservationQC', 'AcceptedQCValues'});
run_case(observations, models, legacy);
end

function test_negative_metadata(observations, models, options)
metadata = options.RecordMetadata;
invalid = {[], struct(), {metadata}, [metadata metadata], struct2table(metadata, 'AsArray', true)};
requiredFields = fieldnames(metadata);
for fieldIndex = 1:numel(requiredFields)
    invalid{end + 1} = rmfield(metadata, requiredFields{fieldIndex});
end
for extraField = ["SourceRow" "SourceRowOrigin" "RecordID" "UnverifiedExtra"]
    changed = metadata;
    changed.(extraField) = (12:-1:1)';
    invalid{end + 1} = changed;
end
changed = metadata;
changed.SourceRow = (1:12)';
changed.SourceRowOrigin = "call_entry_order";
invalid{end + 1} = changed;
duplicateIDs = metadata.ID;
duplicateIDs(12) = duplicateIDs(1);
blankIDs = metadata.ID;
blankIDs(12) = "";
whitespaceIDs = metadata.ID;
whitespaceIDs(6) = "   ";
missingIDs = metadata.ID;
missingIDs(2) = missing;
badIDs = {duplicateIDs, blankIDs, whitespaceIDs, missingIDs, (1:12)', ...
    cellstr(metadata.ID), reshape(metadata.ID, 3, 4), metadata.ID(1:11), [metadata.ID; "extra"]};
for valueIndex = 1:numel(badIDs)
    changed = metadata;
    changed.ID = badIDs{valueIndex};
    invalid{end + 1} = changed;
end
unzonedTimes = metadata.Time;
unzonedTimes.TimeZone = '';
wrongZoneTimes = metadata.Time;
wrongZoneTimes.TimeZone = 'Asia/Shanghai';
missingTimes = metadata.Time;
missingTimes(12) = NaT(1, 1, 'TimeZone', 'UTC');
badTimes = {unzonedTimes, wrongZoneTimes, missingTimes, string(metadata.Time), ...
    (1:12)', reshape(metadata.Time, 3, 4), metadata.Time(1:11)};
for valueIndex = 1:numel(badTimes)
    changed = metadata;
    changed.Time = badTimes{valueIndex};
    invalid{end + 1} = changed;
end
for badValue = [NaN Inf -Inf -1 1+1i]
    changed = metadata;
    changed.Depth(12) = badValue;
    invalid{end + 1} = changed;
end
badDepths = {true(12, 1), string(metadata.Depth), reshape(metadata.Depth, 3, 4), metadata.Depth(1:11)};
for valueIndex = 1:numel(badDepths)
    changed = metadata;
    changed.Depth = badDepths{valueIndex};
    invalid{end + 1} = changed;
end
for unit = ["" "km" "dbar"]
    changed = metadata;
    changed.DepthUnit = unit;
    invalid{end + 1} = changed;
end
for direction = ["" "positive_up" "negative_down"]
    changed = metadata;
    changed.DepthDirection = direction;
    invalid{end + 1} = changed;
end
for name = ["DepthUnit" "DepthDirection"]
    for badValue = {1, ["m" "positive_down"]}
        changed = metadata;
        changed.(name) = badValue{1};
        invalid{end + 1} = changed;
    end
end
[~, axesHandle, cleanup] = make_axes();
for caseIndex = 1:numel(invalid)
    changed = options;
    changed.RecordMetadata = invalid{caseIndex};
    must_throw(@() oi_plot_comparison(axesHandle, observations, models, changed), "RecordMetadata");
end
changed = options;
changed.PairingRule = "inner-key";
must_throw(@() oi_plot_comparison(axesHandle, observations, models, changed), "PairingRule");
clear cleanup;
end

function test_negative_labels(observations, models, options)
labels = options.RecordMetadata.ID;
wrongLabels = labels;
wrongLabels(6) = "wrong-id";
invalidLabels = {[], "", flipud(labels), wrongLabels, labels(1:11), ...
    cellstr(labels), reshape(labels, 3, 4)};
[~, axesHandle, cleanup] = make_axes();
for caseIndex = 1:numel(invalidLabels)
    changed = options;
    changed.SampleLabels = invalidLabels{caseIndex};
    must_throw(@() oi_plot_comparison(axesHandle, observations, models, changed), "SampleLabels");
end
changed = options;
changed.SampleLabelVariable = "";
must_throw(@() oi_plot_comparison(axesHandle, observations, models, changed), "SampleLabels");
clear cleanup;
end

function test_tabular_scope(observations, models, options)
observationTable = table(options.RecordMetadata.ID, observations, 'VariableNames', {'ID', 'Observation'});
modelTable = table(options.RecordMetadata.ID, models, 'VariableNames', {'ID', 'Model'});
tabular = options;
tabular.PairingRule = "row-aligned";
tabular.ObservationVariable = "Observation";
tabular.ModelVariable = "Model";
[~, axesHandle, cleanup] = make_axes();
must_throw(@() oi_plot_comparison(axesHandle, observationTable, modelTable, tabular), "RecordMetadata");
legacy = rmfield(tabular, 'RecordMetadata');
result = oi_plot_comparison(axesHandle, observationTable, modelTable, legacy);
assert(~isfield(result, "RecordData") && result.ValidCount == 11 ...
    && isempty(result.Scatter.UserData) ...
    && isequaln(double(result.Scatter.XData(:)), observations(1:11)) ...
    && isequaln(double(result.Scatter.YData(:)), models(1:11)), ...
    "test_comparison_record_metadata:LegacyTable", "Legacy row-aligned tables must still plot without record proof");
tabular.PairingRule = "inner-key";
tabular.PairKeys = "ID";
must_throw(@() oi_plot_comparison(axesHandle, observationTable, modelTable, tabular), "RecordMetadata");
times = datetime(2026, 8, 20, 0, 0, 0, 'TimeZone', 'UTC') + hours((0:11)');
observationTimetable = table2timetable(observationTable, 'RowTimes', times);
modelTimetable = table2timetable(modelTable, 'RowTimes', times);
tabular.PairingRule = "row-time-inner";
must_throw(@() oi_plot_comparison(axesHandle, observationTimetable, modelTimetable, tabular), "RecordMetadata");
clear cleanup;
end

function assert_absent(metadata)
assert_fields(metadata, {'Status'});
assert(isequal(metadata.Status, "not_provided"), "test_comparison_record_metadata:AbsentSide", ...
    "Absent model QC or uncertainty must have status only, never copied or fabricated arrays");
end

function assert_fields(value, expected)
assert(isstruct(value) && isscalar(value) && isequal(sort(fieldnames(value)), sort(expected(:))), ...
    "test_comparison_record_metadata:Fields", "Metadata fields must match the exact protocol");
end

function [figureHandle, axesHandle, cleanup] = make_axes()
figureHandle = oi_figure(2400, 1500, "off");
figureHandle.Units = "inches";
figureHandle.Position(3:4) = [8 5];
layoutHandle = tiledlayout(figureHandle, 1, 1, "TileSpacing", "compact", "Padding", "compact");
axesHandle = nexttile(layoutHandle);
cleanup = onCleanup(@() close_if_valid(figureHandle));
end

function must_throw(callback, identifierFragment)
try
    callback();
catch errorRecord
    assert(startsWith(string(errorRecord.identifier), "oi_plot_comparison:") ...
        && contains(string(errorRecord.identifier), identifierFragment), ...
        "test_comparison_record_metadata:WrongFailure", "Unexpected rejection: %s: %s", ...
        errorRecord.identifier, errorRecord.message);
    return;
end
error("test_comparison_record_metadata:MissingRejection", ...
    "Expected oi_plot_comparison rejection containing %s", identifierFragment);
end

function close_if_valid(figureHandle)
if isgraphics(figureHandle, "figure")
    close(figureHandle);
end
end
