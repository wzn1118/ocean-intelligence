function [figureHandle, details] = build_native_pdf_fixture_case(caseId, fixtureDirectory)
arguments
    caseId (1,1) string
    fixtureDirectory (1,1) string
end
caseIds = ["crossed-time-depth-temperature" "repeat-cast-salinity-profiles" ...
    "paired-observation-model" "paired-interactive"];
sourceFiles = ["crossed_time_depth_temperature.json" "repeat_cast_salinity_profiles.json" ...
    "paired_observation_model.json" "crossed_time_depth_temperature.json"];
assert(~ismissing(caseId) && any(caseId == caseIds), ...
    "build_native_pdf_fixture_case:CaseID", "Unsupported native fixture case: %s", caseId);
assert(~ismissing(fixtureDirectory) && isfolder(fixtureDirectory), ...
    "build_native_pdf_fixture_case:FixtureDirectory", "Fixture directory must exist");
assetDirectory = fullfile(fileparts(mfilename("fullpath")), "..", "assets");
assert(isfolder(assetDirectory), "build_native_pdf_fixture_case:Assets", "Native assets must exist");
addpath(assetDirectory);
sourceFile = sourceFiles(caseIds == caseId);
sourcePath = fullfile(fixtureDirectory, sourceFile);
[fixture, inputHash, inputBytes] = read_fixture(sourcePath);
expectedFixtureId = caseId;
if caseId == "paired-interactive"
    expectedFixtureId = "crossed-time-depth-temperature";
end
assert(isstruct(fixture) && isscalar(fixture) ...
    && isfield(fixture, "id") && isequal(string(fixture.id), expectedFixtureId) ...
    && isfield(fixture, "synthetic") && isequal(fixture.synthetic, true), ...
    "build_native_pdf_fixture_case:FixtureIdentity", "The case requires its actual synthetic fixture");
titleText = oi_require_text(fixture.title, "build_native_pdf_fixture_case:Title", ...
    "Fixture title must be explicit nonblank text");
assert(isscalar(titleText), "build_native_pdf_fixture_case:Title", "Fixture title must be scalar text");
if caseId == "paired-interactive"
    titleText = string(char([28201 24230 26102 38388 24207 21015])) ...
        + " / Temperature time series";
end
details = struct("case_id", caseId, "source_file", sourceFile, ...
    "input_sha256", inputHash, "title", titleText, "data_source", "synthetic");
existingFigures = findall(groot, "Type", "figure");
try
    if caseId == "paired-interactive"
        outputs = build_interactive(fixture, titleText);
        figureHandle = outputs.Figure;
        assert(~outputs.ExportPerformed && ~outputs.InteractiveEnabled && ~outputs.ManifestAvailable, ...
            "build_native_pdf_fixture_case:BuildOnly", "Interactive case must only build static native graphics");
    else
        theme = oi_ocean_theme();
        figureHandle = oi_figure(2400, 1500, "off");
        axesHandle = make_axes(figureHandle);
        switch caseId
            case "crossed-time-depth-temperature"
                times = parse_utc_time(fixture.coordinates.time.values);
                depths = double(fixture.coordinates.depth.values(:));
                values = double(fixture.variables.temperature.values);
                qc = string_grid(fixture.variables.qc.values, size(values));
                uncertainty = double(fixture.variables.temperature_standard_uncertainty.values);
                result = oi_plot_hovmoller(axesHandle, times, depths, values, struct( ...
                    "TimeZone", "UTC", "DepthUnit", "m", ...
                    "QuantityLabel", "Temperature", "QuantityUnit", "degC", ...
                    "ColorLimits", [12 19], "MissingPolicy", "preserve", ...
                    "QCFlags", qc, "QCPolicy", "preserve", "UncertaintyValues", uncertainty, ...
                    "UncertaintyType", fixture.variables.temperature_standard_uncertainty.type, ...
                    "UncertaintyUnit", fixture.variables.temperature_standard_uncertainty.unit, ...
                    "Theme", theme, "Title", titleText));
                inputCount = numel(values);
            case "repeat-cast-salinity-profiles"
                depths = double(fixture.coordinates.depth.values(:));
                values = double(fixture.variables.salinity.values);
                labels = string(fixture.coordinates.time.values(:));
                qc = string_grid(fixture.variables.qc.values, size(values));
                uncertainty = double(fixture.variables.salinity_standard_uncertainty.values);
                result = oi_plot_profile(axesHandle, depths, values, struct( ...
                    "QuantityLabel", "Salinity", "QuantityUnit", "g kg-1", "DepthUnit", "m", ...
                    "VerticalReference", "synthetic sea surface", "SeriesLabels", labels, ...
                    "MissingPolicy", "preserve", "QCFlags", qc, "QCPolicy", "preserve", ...
                    "UncertaintyValues", uncertainty, ...
                    "UncertaintyType", fixture.variables.salinity_standard_uncertainty.type, ...
                    "UncertaintyUnit", fixture.variables.salinity_standard_uncertainty.unit, ...
                    "UncertaintyDisplay", "metadata", "Theme", theme, "Title", titleText));
                inputCount = numel(values);
            case "paired-observation-model"
                records = fixture.records;
                observations = numeric_record_field(records, "observation_degC");
                models = numeric_record_field(records, "model_degC");
                labels = reshape(string({records.id}), [], 1);
                times = parse_utc_time(string({records.time}));
                depths = numeric_record_field(records, "depth_m");
                qc = reshape(string({records.qc}), [], 1);
                uncertainty = numeric_record_field(records, "uncertainty_degC");
                recordMetadata = struct("ID", labels, "Time", times, "Depth", depths, ...
                    "DepthUnit", "m", "DepthDirection", string(fixture.contract.depth_direction));
                result = oi_plot_comparison(axesHandle, observations, models, struct( ...
                    "QuantityUnit", "degC", "ObservationLabel", "Observation", "ModelLabel", "Model", ...
                    "SampleLabels", labels, "MissingPolicy", "preserve", "RecordMetadata", recordMetadata, ...
                    "ObservationQC", qc, "AcceptedQCValues", ["good" "suspect"], ...
                    "UncertaintySides", "observation", "ObservationUncertainty", uncertainty, ...
                    "UncertaintyType", replace(string(fixture.contract.uncertainty_type), "_", "-"), ...
                    "UncertaintyUnit", string(fixture.contract.uncertainty_unit), ...
                    "Theme", theme, "Title", titleText));
                inputCount = numel(records);
        end
        assert(result.ValidCount + result.MissingCount == inputCount, ...
            "build_native_pdf_fixture_case:Counts", "Native counts must preserve the fixture shape");
        oi_apply_axes(axesHandle, theme);
        if isfield(result, "Legend") && isscalar(result.Legend) && isgraphics(result.Legend)
            location = string(result.Legend.Location);
            if any(location == ["northoutside" "southoutside" "eastoutside" "westoutside"])
                result.Legend.Layout.Tile = erase(location, "outside");
            end
        end
        if isfield(result, "Colorbar") && isscalar(result.Colorbar) && isgraphics(result.Colorbar)
            result.Colorbar.Layout.Tile = "east";
        end
    end
    drawnow;
    assert(isscalar(figureHandle) && isgraphics(figureHandle, "figure"), ...
        "build_native_pdf_fixture_case:Figure", "The caller must receive a live native figure");
    verify_fixture_bytes(sourcePath, inputHash, inputBytes);
catch errorRecord
    delete_new_figures(existingFigures);
    rethrow(errorRecord);
end
end

function axesHandle = make_axes(figureHandle)
pageSize = [8 5];
figureHandle.Units = "inches";
figureHandle.Position(3:4) = pageSize;
figureHandle.PaperUnits = "inches";
figureHandle.PaperPosition = [0 0 pageSize];
figureHandle.PaperSize = pageSize;
figureHandle.PaperPositionMode = "manual";
pageMargin = 0.4 ./ pageSize;
layoutHandle = tiledlayout(figureHandle, 1, 1, "Padding", "loose", "TileSpacing", "compact");
layoutHandle.Units = "normalized";
layoutHandle.OuterPosition = [pageMargin 1 - 2 * pageMargin];
axesHandle = nexttile(layoutHandle);
end

function outputs = build_interactive(fixture, titleText)
times = parse_utc_time(fixture.coordinates.time.values);
depths = double(fixture.coordinates.depth.values(:));
values = double(fixture.variables.temperature.values);
uncertainty = double(fixture.variables.temperature_standard_uncertainty.values);
qc = string_grid(fixture.variables.qc.values, size(values));
depthIndex = find(depths == 50);
assert(isscalar(depthIndex) && depthIndex == 3 && numel(times) == 6 ...
    && string(fixture.coordinates.depth.unit) == "m" ...
    && isequal(size(values), [numel(depths) numel(times)]) ...
    && isequal(size(uncertainty), size(values)), ...
    "build_native_pdf_fixture_case:InteractiveSlice", "Interactive case requires all six records at the third, 50 m depth");
observationValues = values(depthIndex, :)';
observationUncertainty = uncertainty(depthIndex, :)';
observationIds = "temp-050m-" + compose("%03d", (1:numel(times))');
station = "Synthetic mooring" + strings(numel(times), 1);
flags = qc(depthIndex, :)';
valueUnit = string(fixture.variables.temperature.unit);
uncertaintyUnit = string(fixture.variables.temperature_standard_uncertainty.unit);
uncertaintyType = replace(strtrim(string(fixture.variables.temperature_standard_uncertainty.type)), "_", "-");
data = table(times, observationValues, observationUncertainty, observationIds, station, flags, ...
    'VariableNames', ["Time" "Value" "Uncertainty" "ObservationID" "Station" "QCFlag"]);
data.Properties.VariableUnits = {'', char(valueUnit), char(uncertaintyUnit), '', '', ''};
outputs = interactive_timeseries_native_template(data, fullfile(tempdir, "paired-interactive"), ...
    "Export", false, "Interactive", false, "ExportMode", "graphics", ...
    "PublicationWidthPixels", 2400, "PublicationHeightPixels", 1500, "PublicationDPI", 300, ...
    "Title", titleText, "ValueLabel", "Temperature", "ValueUnit", valueUnit, ...
    "UncertaintyType", uncertaintyType, "UncertaintyUnit", uncertaintyUnit);
end

function [fixture, inputHash, content] = read_fixture(sourcePath)
content = read_fixture_bytes(sourcePath);
snapshotPath = string(tempname);
assert(~isfile(snapshotPath) && ~isfolder(snapshotPath), ...
    "build_native_pdf_fixture_case:StaleSnapshot", "Refusing to overwrite a fixture snapshot");
snapshotCleanup = onCleanup(@() delete_snapshot(snapshotPath));
fileHandle = fopen(snapshotPath, "wb");
assert(fileHandle >= 0, "build_native_pdf_fixture_case:FixtureWrite", ...
    "Cannot write fixture snapshot: %s", snapshotPath);
writeCleanup = onCleanup(@() fclose(fileHandle));
written = fwrite(fileHandle, content, "uint8");
assert(written == numel(content), "build_native_pdf_fixture_case:FixtureWrite", ...
    "Fixture snapshot must contain every input byte: %s", snapshotPath);
clear writeCleanup;
assert(isequal(read_fixture_bytes(snapshotPath), content), ...
    "build_native_pdf_fixture_case:FixtureChanged", "Fixture snapshot bytes differ from the input");
inputHash = string(oi_sha256_file(snapshotPath));
verify_fixture_bytes(snapshotPath, inputHash, content);
verify_fixture_bytes(sourcePath, inputHash, content);
fixture = jsondecode(native2unicode(content', 'UTF-8'));
clear snapshotCleanup;
end

function content = read_fixture_bytes(sourcePath)
assert(isfile(sourcePath), "build_native_pdf_fixture_case:FixtureMissing", ...
    "Fixture is missing: %s", sourcePath);
fileHandle = fopen(sourcePath, "rb");
assert(fileHandle >= 0, "build_native_pdf_fixture_case:FixtureRead", "Cannot read fixture: %s", sourcePath);
cleanup = onCleanup(@() fclose(fileHandle));
content = fread(fileHandle, Inf, "*uint8");
assert(~isempty(content) && feof(fileHandle), "build_native_pdf_fixture_case:FixtureRead", ...
    "Fixture must be nonempty and completely readable: %s", sourcePath);
clear cleanup;
end

function verify_fixture_bytes(sourcePath, inputHash, content)
assert(isequal(read_fixture_bytes(sourcePath), content) ...
    && strcmpi(oi_sha256_file(sourcePath), inputHash) ...
    && isequal(read_fixture_bytes(sourcePath), content), ...
    "build_native_pdf_fixture_case:FixtureChanged", "Consumed fixture bytes changed: %s", sourcePath);
end

function delete_snapshot(snapshotPath)
if isfile(snapshotPath)
    delete(snapshotPath);
end
end

function values = parse_utc_time(rawValues)
values = datetime(string(rawValues(:)), "InputFormat", "yyyy-MM-dd'T'HH:mm:ss'Z'", "TimeZone", "UTC");
assert(~any(isnat(values)) && all(diff(values) >= seconds(0)) && string(values.TimeZone) == "UTC", ...
    "build_native_pdf_fixture_case:Time", "Fixture times must parse as nondecreasing UTC");
end

function values = numeric_record_field(records, fieldName)
values = NaN(numel(records), 1);
for recordIndex = 1:numel(records)
    value = records(recordIndex).(fieldName);
    if ~isempty(value)
        assert(isnumeric(value) && isscalar(value) && isfinite(value), ...
            "build_native_pdf_fixture_case:RecordField", "Record field %s must be scalar numeric or null", fieldName);
        values(recordIndex) = double(value);
    end
end
end

function values = string_grid(raw, expectedShape)
if iscell(raw) && numel(raw) == expectedShape(1) && all(cellfun(@iscell, raw(:)))
    values = strings(expectedShape);
    for rowIndex = 1:expectedShape(1)
        rowValues = string(raw{rowIndex});
        assert(numel(rowValues) == expectedShape(2), ...
            "build_native_pdf_fixture_case:StringGridShape", "QC row width must match the data");
        values(rowIndex, :) = reshape(rowValues, 1, []);
    end
else
    values = string(raw);
end
assert(isequal(size(values), expectedShape) && all(~ismissing(values), "all"), ...
    "build_native_pdf_fixture_case:StringGridShape", "QC must match the data shape without missing labels");
end

function delete_new_figures(existingFigures)
currentFigures = findall(groot, "Type", "figure");
for figureIndex = 1:numel(currentFigures)
    handle = currentFigures(figureIndex);
    existed = any(arrayfun(@(previous) isequal(previous, handle), existingFigures));
    if ~existed && isgraphics(handle, "figure")
        delete(handle);
    end
end
end
