function report = test_comparison_native_evidence(outputDirectory)
%TEST_COMPARISON_NATIVE_EVIDENCE Synthetic native-reader tests, not runtime attestation.
arguments
    outputDirectory (1,1) string = string(tempname)
end
testsDirectory = fileparts(mfilename('fullpath'));
matlabDirectory = fileparts(testsDirectory);
evalDirectory = fullfile(matlabDirectory, 'evals');
assetsDirectory = fullfile(matlabDirectory, 'assets');
originalPath = path;
pathCleanup = onCleanup(@() path(originalPath));
addpath(assetsDirectory, evalDirectory);
assert(strcmp(which('measure_comparison_plot_data'), ...
    char(fullfile(evalDirectory, 'measure_comparison_plot_data.m'))), ...
    'test_comparison_native_evidence:ReaderPath', ...
    'Tests must call the evaluator reader, not a local substitute');
testDirectory = fullfile(outputDirectory, 'comparison-native-evidence-adversarial-test');
assert(~isfolder(testDirectory), 'test_comparison_native_evidence:StaleOutput', ...
    'Refusing to overwrite a native-reader test directory: %s', testDirectory);
mkdir(testDirectory);
fixturePath = fullfile(evalDirectory, 'fixtures', 'paired_observation_model.json');
snapshotPath = fullfile(testDirectory, 'paired_observation_model.input.json');
copyfile(fixturePath, snapshotPath);
fixture = read_fixture(snapshotPath);
inputSnapshot = struct('id', string(fixture.id), 'sha256', string(oi_sha256_file(snapshotPath)));
records = fixture.records;
observations = numeric_record_field(records, 'observation_degC');
models = numeric_record_field(records, 'model_degC');
magnitudes = numeric_record_field(records, 'uncertainty_degC');
recordTimes = datetime(reshape(string({records.time}), [], 1), ...
    'InputFormat', 'yyyy-MM-dd''T''HH:mm:ss''Z''', 'TimeZone', 'UTC');
metadata = struct('ID', reshape(string({records.id}), [], 1), 'Time', recordTimes, ...
    'Depth', numeric_record_field(records, 'depth_m'), 'DepthUnit', 'm', ...
    'DepthDirection', string(fixture.contract.depth_direction));
theme = oi_ocean_theme();
figureHandle = oi_figure(2400, 1500, 'off');
figureCleanup = onCleanup(@() close_if_valid(figureHandle));
figureHandle.Tag = 'comparison-native-evidence-adversarial-test';
figureHandle.Units = 'inches';
figureHandle.Position(3:4) = [8 5];
figureHandle.PaperUnits = 'inches';
figureHandle.PaperPosition = [0 0 8 5];
figureHandle.PaperSize = [8 5];
figureHandle.PaperPositionMode = 'manual';
layoutHandle = tiledlayout(figureHandle, 1, 1, 'Padding', 'loose', 'TileSpacing', 'compact');
pageMargin = 0.4 ./ [8 5];
layoutHandle.Units = 'normalized';
layoutHandle.OuterPosition = [pageMargin 1 - 2 * pageMargin];
axesHandle = nexttile(layoutHandle);
result = oi_plot_comparison(axesHandle, observations, models, struct( ...
    'QuantityUnit', 'degC', 'ObservationLabel', 'Observation', 'ModelLabel', 'Model', ...
    'RecordMetadata', metadata, 'SampleLabels', metadata.ID, 'MissingPolicy', 'preserve', ...
    'ObservationQC', reshape(string({records.qc}), [], 1), ...
    'AcceptedQCValues', ["good" "suspect"], 'UncertaintySides', 'observation', ...
    'ObservationUncertainty', magnitudes, 'UncertaintyType', 'standard-uncertainty', ...
    'UncertaintyUnit', 'degC', 'Theme', theme, 'Title', string(fixture.title)));
assert(isequal(result.Axes, axesHandle), 'test_comparison_native_evidence:Axes', ...
    'The actual helper must draw into the axes of the exported test figure');
oi_apply_axes(axesHandle, theme);
result.Legend.Layout.Tile = 'south';
baselineEntry = export_test_state(figureHandle, testDirectory, 'native-reader-baseline', fixture, theme);
reader = @(candidate) measure_comparison_plot_data(candidate, fixture, inputSnapshot, figureHandle);
baseline = reader(result);
assert_complete_evidence(baseline, records);
artifactPaths = export_paths(testDirectory, baselineEntry);
artifactHashes = file_hashes(artifactPaths);
write_test_json(fullfile(testDirectory, 'baseline-test-evidence.json'), struct( ...
    'scope', 'synthetic_native_reader_test_only', 'visual_verified', false, ...
    'desktop_interaction_verified', false, 'declaration', baseline));

titleHandle = result.Legend.Title;
scatterHandle = result.Scatter;
expectedTitle = ["Horizontal: observation standard uncertainty (degC)"; ...
    "Model uncertainty not provided"];
titleState = property_state(titleHandle, {'String'});
paintProperties = {'CData', 'MarkerFaceColor', 'MarkerEdgeColor', 'MarkerFaceAlpha', 'MarkerEdgeAlpha'};
paintState = property_state(scatterHandle, paintProperties);
positiveCleanup = onCleanup(@() restore_positive_state(titleHandle, titleState, scatterHandle, paintState));
titleHandle.String = char(expectedTitle);
set(scatterHandle, 'MarkerFaceColor', [0.1 0.4 0.7], 'MarkerEdgeColor', [0.15 0.15 0.15], ...
    'MarkerFaceAlpha', 0.65, 'MarkerEdgeAlpha', 0.35);
charEntry = export_test_state(figureHandle, testDirectory, 'native-reader-char-title', fixture, theme);
assert_same_evidence(reader, result, baseline, 'char-title-numeric-alpha');
titleGetterClass = class(titleHandle.String);
titleGetterSize = size(titleHandle.String);
clear positiveCleanup;
assert_same_evidence(reader, result, baseline, 'restored-char-title');
artifactPaths = [artifactPaths; export_paths(testDirectory, charEntry)];
artifactHashes = [artifactHashes; file_hashes(export_paths(testDirectory, charEntry))];

paintState = property_state(scatterHandle, paintProperties);
paintCleanup = onCleanup(@() restore_properties(scatterHandle, paintState));
set(scatterHandle, 'CData', repmat([0.1 0.4 0.7], 11, 1), ...
    'MarkerFaceColor', 'flat', 'MarkerFaceAlpha', 0.5, 'MarkerEdgeAlpha', 0);
assert_same_evidence(reader, result, baseline, 'flat-rgb-numeric-alpha');
set(scatterHandle, 'MarkerFaceColor', 'none', 'MarkerFaceAlpha', 0, ...
    'MarkerEdgeColor', [0.15 0.15 0.15], 'MarkerEdgeAlpha', 0.5);
assert_same_evidence(reader, result, baseline, 'edge-only-numeric-alpha');
clear paintCleanup;
assert_same_evidence(reader, result, baseline, 'restored-numeric-alpha');

legendState = property_state(result.Legend, {'AutoUpdate'});
legendCleanup = onCleanup(@() restore_properties(result.Legend, legendState));
result.Legend.AutoUpdate = 'off';
otherFigure = figure('Visible', 'off', 'Tag', 'adversarial-test-wrong-parent');
otherFigureCleanup = onCleanup(@() close_if_valid(otherFigure));
otherAxes = axes('Parent', otherFigure);
segmentHandle = result.UncertaintyGraphics(1);
changedX = scatterHandle.XData;
changedX(6) = changedX(6) + 0.125;
changedY = scatterHandle.YData;
changedY(6) = changedY(6) + 0.125;
changedID = scatterHandle.UserData;
changedID.RecordID(6) = "wrong-record";
changedRow = scatterHandle.UserData;
changedRow.SourceRow(6) = 12;
leftEndpoint = segmentHandle.XData;
leftEndpoint(1) = leftEndpoint(1) - 0.01;
rightEndpoint = segmentHandle.XData;
rightEndpoint(2) = rightEndpoint(2) + 0.01;
slantedSegment = segmentHandle.YData;
slantedSegment(2) = slantedSegment(2) + 0.01;
segmentIdentity = segmentHandle.UserData;
segmentIdentity.SourceRow = 12;
propertyCases = {
    'scatter-x', scatterHandle, {'XData'}, {changedX}, 'ComparisonProofScatter';
    'scatter-y', scatterHandle, {'YData'}, {changedY}, 'ComparisonProofScatter';
    'scatter-id', scatterHandle, {'UserData'}, {changedID}, 'ComparisonProofScatter';
    'scatter-source-row', scatterHandle, {'UserData'}, {changedRow}, 'ComparisonProofScatter';
    'scatter-hidden', scatterHandle, {'Visible'}, {'off'}, 'ComparisonProofHandles';
    'scatter-nan-size', scatterHandle, {'SizeData'}, {NaN}, 'ComparisonProofHandles';
    'scatter-unpainted', scatterHandle, {'MarkerFaceColor', 'MarkerEdgeAlpha'}, {'none', 0}, 'ComparisonProofHandles';
    'scatter-face-flat-alpha', scatterHandle, {'MarkerFaceAlpha'}, {'flat'}, 'ComparisonProofHandles';
    'scatter-edge-flat-alpha', scatterHandle, {'MarkerEdgeAlpha'}, {'flat'}, 'ComparisonProofHandles';
    'scatter-indexed-flat-color', scatterHandle, ...
        {'CData', 'MarkerFaceColor', 'MarkerEdgeAlpha'}, {(1:11)', 'flat', 0}, 'ComparisonProofHandles';
    'axes-hidden', axesHandle, {'Visible'}, {'off'}, 'ComparisonProofHandles';
    'segment-left-endpoint', segmentHandle, {'XData'}, {leftEndpoint}, 'ComparisonProofSegments';
    'segment-right-endpoint', segmentHandle, {'XData'}, {rightEndpoint}, 'ComparisonProofSegments';
    'segment-not-horizontal', segmentHandle, {'YData'}, {slantedSegment}, 'ComparisonProofSegments';
    'segment-source-row', segmentHandle, {'UserData'}, {segmentIdentity}, 'ComparisonProofSegments';
    'segment-hidden', segmentHandle, {'Visible'}, {'off'}, 'ComparisonProofSegments';
    'title-wrong-text', titleHandle, {'String'}, {'Model confidence interval'}, 'ComparisonProofNativeText';
    'title-hidden', titleHandle, {'Visible'}, {'off'}, 'ComparisonProofNativeText';
    'legend-hidden', result.Legend, {'Visible'}, {'off'}, 'ComparisonProofNativeText'
};
negativeRecords = cell(0, 1);
for caseIndex = 1:size(propertyCases, 1)
    caseName = propertyCases{caseIndex, 1};
    target = propertyCases{caseIndex, 2};
    properties = propertyCases{caseIndex, 3};
    values = propertyCases{caseIndex, 4};
    state = property_state(target, properties);
    stateCleanup = onCleanup(@() restore_properties(target, state));
    fprintf('COMPARISON_NATIVE_ADVERSARIAL_CASE=%s\n', caseName);
    for propertyIndex = 1:numel(properties)
        set(target, properties{propertyIndex}, values{propertyIndex});
    end
    negativeRecords{end + 1, 1} = assert_reader_rejected(@() reader(result), ...
        propertyCases{caseIndex, 5}, caseName); %#ok<AGROW>
    clear stateCleanup;
    assert_same_evidence(reader, result, baseline, ['restored-' caseName]);
end
for kind = ["scatter", "line"]
    sourceHandle = scatterHandle;
    expectedIdentifier = 'ComparisonProofHandles';
    if kind == "line"
        sourceHandle = segmentHandle;
        expectedIdentifier = 'ComparisonProofLineCount';
    end
    extraHandle = copyobj(sourceHandle, axesHandle);
    extraCleanup = onCleanup(@() delete(extraHandle));
    negativeRecords{end + 1, 1} = assert_reader_rejected(@() reader(result), ...
        expectedIdentifier, "extra-" + kind); %#ok<AGROW>
    clear extraCleanup;
    assert_same_evidence(reader, result, baseline, "restored-extra-" + kind);
end
for kind = ["scatter", "segment"]
    candidate = result;
    sourceHandle = scatterHandle;
    expectedIdentifier = 'ComparisonProofHandles';
    if kind == "segment"
        sourceHandle = segmentHandle;
        expectedIdentifier = 'ComparisonProofSegments';
    end
    wrongParentHandle = copyobj(sourceHandle, otherAxes);
    wrongParentCleanup = onCleanup(@() delete(wrongParentHandle));
    if kind == "scatter"
        candidate.Scatter = wrongParentHandle;
    else
        candidate.UncertaintyGraphics(1) = wrongParentHandle;
    end
    negativeRecords{end + 1, 1} = assert_reader_rejected(@() reader(candidate), ...
        expectedIdentifier, kind + "-parent"); %#ok<AGROW>
    clear wrongParentCleanup;
    assert_same_evidence(reader, result, baseline, "restored-" + kind + "-parent");
end
negativeRecords{end + 1, 1} = assert_reader_rejected( ...
    @() measure_comparison_plot_data(result, fixture, inputSnapshot, otherFigure), ...
    'ComparisonProofHandles', 'wrong-exported-figure');
assert_same_evidence(reader, result, baseline, 'restored-wrong-figure');

returnedCases = {
    'records-drop-row12', 'ComparisonProofRecords';
    'records-erase-model12', 'ComparisonProofRecords';
    'records-pad-id', 'ComparisonProofRecords';
    'model-uncertainty-invented', 'ComparisonProofUncertainty';
    'observation-u-changed', 'ComparisonProofUncertainty';
    'graphics-mask-changed', 'ComparisonProofUncertainty';
    'model-qc-invented', 'ComparisonProofQC';
    'suspect-qc-changed', 'ComparisonProofQC';
    'paired-mask-changed', 'ComparisonProofPairing';
    'scatter-is-reference-line', 'ComparisonProofHandles';
    'missing-returned-segment', 'ComparisonProofLineCount';
    'metric-bias-changed', 'ComparisonProofMetrics'
};
for caseIndex = 1:size(returnedCases, 1)
    caseName = returnedCases{caseIndex, 1};
    candidate = result;
    switch caseName
        case 'records-drop-row12'
            for fieldName = ["RecordID", "Time", "Depth", "SourceRow", "Observation", "Model"]
                candidate.RecordData.(fieldName) = candidate.RecordData.(fieldName)(1:11);
            end
        case 'records-erase-model12'
            candidate.RecordData.Model(12) = NaN;
        case 'records-pad-id'
            candidate.RecordData.RecordID(6) = candidate.RecordData.RecordID(6) + " ";
        case 'model-uncertainty-invented'
            candidate.Uncertainty.Model.Values = zeros(12, 1);
        case 'observation-u-changed'
            candidate.Uncertainty.Observation.Values(6) = magnitudes(6) + 0.01;
        case 'graphics-mask-changed'
            candidate.Uncertainty.GraphicsMask(6) = false;
        case 'model-qc-invented'
            candidate.QC.Model.Flags = repmat("good", 12, 1);
        case 'suspect-qc-changed'
            candidate.QC.Observation.Flags(6) = "good";
        case 'paired-mask-changed'
            candidate.PairedMask(6) = false;
        case 'scatter-is-reference-line'
            candidate.Scatter = result.OneToOne;
        case 'missing-returned-segment'
            candidate.UncertaintyGraphics = result.UncertaintyGraphics(1:end-1);
        case 'metric-bias-changed'
            candidate.Metrics.Bias = candidate.Metrics.Bias + 0.1;
    end
    negativeRecords{end + 1, 1} = assert_reader_rejected(@() reader(candidate), ...
        returnedCases{caseIndex, 2}, caseName); %#ok<AGROW>
    assert_same_evidence(reader, result, baseline, ['restored-' caseName]);
end
clear otherFigureCleanup legendCleanup;
textProfileReport = test_text_profiles(result, fixture, inputSnapshot, figureHandle, baseline);
assert_same_evidence(reader, result, baseline, 'final-restored-baseline');
assert(isequal(file_hashes(artifactPaths), artifactHashes) ...
    && string(oi_sha256_file(snapshotPath)) == inputSnapshot.sha256, ...
    'test_comparison_native_evidence:ArtifactMutation', ...
    'Adversarial native state tests must not overwrite exports or the consumed fixture');
report = struct('scope', 'synthetic_native_reader_adversarial_test_only', ...
    'matlab_release', "R" + string(version('-release')), ...
    'visual_verified', false, 'desktop_interaction_verified', false, ...
    'fixture_sha256', inputSnapshot.sha256, 'original_artifacts_unchanged', true, ...
    'char_title_getter_class', titleGetterClass, 'char_title_getter_size', titleGetterSize);
report.positive_cases = {'exported-baseline', 'exported-char-title-numeric-alpha', ...
    'flat-rgb-numeric-alpha', 'edge-only-numeric-alpha'};
report.negative_cases = negativeRecords;
report.text_profile_regression = textProfileReport;
report.export_ids = {char(baselineEntry.id), char(charEntry.id)};
report.artifact_sha256 = cellstr(artifactHashes);
write_test_json(fullfile(testDirectory, 'native-reader-test-results.json'), report);
fprintf('COMPARISON_NATIVE_READER_TEST_NEGATIVES=%d\n', numel(negativeRecords));
fprintf('COMPARISON_TEXT_PROFILE_NEGATIVES=%d\n', numel(textProfileReport.negative_cases));
fprintf('COMPARISON_TEXT_PROFILES=passed_synthetic_native_only\n');
fprintf('COMPARISON_NATIVE_READER_TEST=passed_synthetic_native_mutations_only\n');
clear figureCleanup pathCleanup;
end

function report = test_text_profiles(result, fixture, inputSnapshot, figureHandle, baseline)
defaultReader = @(candidate) measure_comparison_plot_data( ...
    candidate, fixture, inputSnapshot, figureHandle);
explicitReader = @(candidate) measure_comparison_plot_data( ...
    candidate, fixture, inputSnapshot, figureHandle, 'fixture-default');
astraReader = @(candidate) measure_comparison_plot_data( ...
    candidate, fixture, inputSnapshot, figureHandle, "astra-temperature-labels");
assert_same_evidence(explicitReader, result, baseline, 'explicit-fixture-default');
marker = 'COMPARISON_TEXT_PROFILE_REJECTED';
negativeRecords = cell(0, 1);
negativeRecords{end + 1, 1} = assert_reader_rejected(@() astraReader(result), ...
    'ComparisonProofNativeText', 'astra-rejects-fixture-labels', marker);
xLabel = result.Axes.XLabel;
yLabel = result.Axes.YLabel;
xState = property_state(xLabel, {'String'});
yState = property_state(yLabel, {'String'});
xCleanup = onCleanup(@() restore_properties(xLabel, xState));
yCleanup = onCleanup(@() restore_properties(yLabel, yState));
xLabel.String = 'Observation temperature (degC)';
yLabel.String = 'Model temperature (degC)';
negativeRecords{end + 1, 1} = assert_reader_rejected(@() defaultReader(result), ...
    'ComparisonProofNativeText', 'default-rejects-astra-labels', marker);
assert_same_evidence(astraReader, result, baseline, 'astra-labels-identical-v3');
xLabel.String = 'Observation temperature (K)';
negativeRecords{end + 1, 1} = assert_reader_rejected(@() astraReader(result), ...
    'ComparisonProofNativeText', 'astra-rejects-x-unit', marker);
xLabel.String = 'Observation temperature (degC)';
yLabel.String = 'Model temperature (K)';
negativeRecords{end + 1, 1} = assert_reader_rejected(@() astraReader(result), ...
    'ComparisonProofNativeText', 'astra-rejects-y-unit', marker);
clear yCleanup xCleanup;
assert_same_evidence(defaultReader, result, baseline, 'restored-text-profiles');
invalidProfiles = {'unknown'; ''; ["fixture-default", "astra-temperature-labels"]; 7};
invalidNames = {'unknown-profile', 'empty-profile', 'array-profile', 'numeric-profile'};
for caseIndex = 1:size(invalidProfiles, 1)
    profile = invalidProfiles{caseIndex, 1};
    negativeRecords{end + 1, 1} = assert_reader_rejected( ...
        @() measure_comparison_plot_data(result, fixture, inputSnapshot, figureHandle, profile), ...
        'ComparisonProofTextProfile', invalidNames{caseIndex}, marker); %#ok<AGROW>
    assert_same_evidence(defaultReader, result, baseline, invalidNames{caseIndex});
end
report = struct('positive_cases', {{'explicit-fixture-default', 'astra-labels-identical-v3'}}, ...
    'negative_cases', {negativeRecords}, 'visual_verified', false);
end

function entry = export_test_state(figureHandle, directory, identifier, fixture, theme)
drawnow;
entry = oi_export_figure(figureHandle, directory, identifier, 2400, 1500, 300, ...
    'Title', string(fixture.title), 'Theme', theme.Name, 'ExportSVG', true, ...
    'Source', 'test_comparison_native_evidence: synthetic test state, not evaluator runtime');
end

function paths = export_paths(directory, entry)
paths = strings(3, 1);
formats = ["png", "pdf", "svg"];
for formatIndex = 1:numel(formats)
    paths(formatIndex) = fullfile(directory, entry.exports.(formats(formatIndex)).file);
end
end

function hashes = file_hashes(paths)
hashes = strings(numel(paths), 1);
for pathIndex = 1:numel(paths)
    hashes(pathIndex) = string(oi_sha256_file(paths(pathIndex)));
end
end

function assert_complete_evidence(evidence, records)
assert(isscalar(evidence) && evidence.schema_version == 3 ...
    && isequal(evidence.shape, {12}) && isequal(evidence.dimension_order, {'observation'}) ...
    && numel(evidence.records.ids) == 12 && numel(evidence.records.time_utc) == 12 ...
    && isequal(cell2mat(evidence.records.source_rows), (1:12)') ...
    && isequal(string(evidence.records.ids), reshape(string({records.id}), [], 1)) ...
    && numel(evidence.input_values.observation) == 12 ...
    && numel(evidence.input_values.model) == 12 ...
    && isnan(evidence.input_values.observation{12}) && evidence.input_values.model{12} == 13.96 ...
    && numel(evidence.native_scatter.x_values) == 11 ...
    && numel(evidence.native_scatter.y_values) == 11 ...
    && isequal(cell2mat(evidence.native_scatter.source_rows), (1:11)') ...
    && numel(evidence.uncertainty.segments) == 11 && evidence.paired_stats.paired_count == 11 ...
    && numel(evidence.uncertainty.observation.values) == 12 ...
    && isnan(evidence.uncertainty.observation.values{12}) ...
    && isequal(fieldnames(evidence.uncertainty.model), {'status'}) ...
    && string(evidence.uncertainty.model.status) == "not_provided", ...
    'test_comparison_native_evidence:CompleteEvidence', ...
    'The real reader must retain 12 full records, row 12 model, 11 points and 11 segments');
wire = jsondecode(jsonencode(evidence));
assert(isscalar(wire) && numel(wire.records.ids) == 12 ...
    && numel(wire.input_values.observation) == 12 && isnan(wire.input_values.observation(12)) ...
    && wire.input_values.model(12) == 13.96 && numel(wire.native_scatter.x_values) == 11 ...
    && isstruct(wire.uncertainty.segments) && numel(wire.uncertainty.segments) == 11 ...
    && islogical(wire.pairing.finite_pair_mask) && islogical(wire.pairing.paired_mask) ...
    && islogical(wire.qc.accepted_mask) && islogical(wire.uncertainty.graphics_mask), ...
    'test_comparison_native_evidence:JSONRoundTrip', ...
    'Native MATLAB serialization must preserve complete arrays, nulls, booleans and segment objects');
end

function assert_same_evidence(reader, result, baseline, caseName)
assert(isequaln(reader(result), baseline), 'test_comparison_native_evidence:RestoredEvidence', ...
    'Reader evidence differs from the exported baseline in %s', caseName);
end

function record = assert_reader_rejected(callback, expectedSuffix, caseName, marker)
if nargin < 4
    marker = 'COMPARISON_NATIVE_REJECTED';
end
expectedIdentifier = ['run_matlab_gate:' char(expectedSuffix)];
try
    callback();
catch exception
    assert(strcmp(exception.identifier, expectedIdentifier), ...
        'test_comparison_native_evidence:UnexpectedFailure', ...
        '%s must be rejected by %s, not %s: %s', ...
        caseName, expectedIdentifier, exception.identifier, exception.message);
    record = struct('case', string(caseName), 'error_identifier', string(exception.identifier));
    fprintf('%s=%s:%s\n', marker, caseName, exception.identifier);
    return;
end
error('test_comparison_native_evidence:MutationAccepted', ...
    'The real native reader accepted adversarial state %s', caseName);
end

function state = property_state(target, properties)
state = cell(numel(properties), 4);
for propertyIndex = 1:numel(properties)
    propertyName = properties{propertyIndex};
    state{propertyIndex, 1} = propertyName;
    state{propertyIndex, 2} = get(target, propertyName);
    modeName = [propertyName 'Mode'];
    if any(strcmp(propertyName, {'CData', 'SizeData'})) && isprop(target, modeName)
        state{propertyIndex, 3} = modeName;
        state{propertyIndex, 4} = get(target, modeName);
    end
end
end

function restore_properties(target, state)
if isa(target, 'handle') && ~isvalid(target)
    return;
end
for propertyIndex = 1:size(state, 1)
    set(target, state{propertyIndex, 1}, state{propertyIndex, 2});
end
for propertyIndex = 1:size(state, 1)
    if ~isempty(state{propertyIndex, 3})
        set(target, state{propertyIndex, 3}, state{propertyIndex, 4});
    end
end
end

function restore_positive_state(titleHandle, titleState, scatterHandle, paintState)
restore_properties(titleHandle, titleState);
restore_properties(scatterHandle, paintState);
end

function fixture = read_fixture(path)
fileHandle = fopen(path, 'rb');
assert(fileHandle >= 0, 'test_comparison_native_evidence:FixtureRead', 'Cannot read %s', path);
fileCleanup = onCleanup(@() fclose(fileHandle));
bytes = fread(fileHandle, Inf, '*uint8');
fixture = jsondecode(native2unicode(bytes', 'UTF-8'));
clear fileCleanup;
end

function values = numeric_record_field(records, fieldName)
values = NaN(numel(records), 1);
for recordIndex = 1:numel(records)
    value = records(recordIndex).(fieldName);
    if ~isempty(value)
        assert(isnumeric(value) && isscalar(value) && isfinite(value), ...
            'test_comparison_native_evidence:FixtureValue', 'Invalid numeric field %s', fieldName);
        values(recordIndex) = double(value);
    end
end
end

function write_test_json(path, payload)
fileHandle = fopen(path, 'wb');
assert(fileHandle >= 0, 'test_comparison_native_evidence:Write', 'Cannot write %s', path);
fileCleanup = onCleanup(@() fclose(fileHandle));
fwrite(fileHandle, unicode2native(jsonencode(payload), 'UTF-8'), 'uint8');
clear fileCleanup;
end

function close_if_valid(figureHandle)
if isgraphics(figureHandle)
    close(figureHandle);
end
end
