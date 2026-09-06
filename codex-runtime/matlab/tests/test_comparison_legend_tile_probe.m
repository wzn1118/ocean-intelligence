function report = test_comparison_legend_tile_probe(outputDirectory)
arguments
    outputDirectory (1,1) string
end
assert(~ismissing(outputDirectory) && strlength(strtrim(outputDirectory)) > 0, ...
    "test_comparison_legend_tile_probe:Output", "An explicit fresh output directory is required");
create_directory(outputDirectory);
testsDirectory = fileparts(mfilename("fullpath"));
matlabDirectory = fileparts(testsDirectory);
evalDirectory = fullfile(matlabDirectory, "evals");
originalPath = path;
pathCleanup = onCleanup(@() path(originalPath));
addpath(fullfile(matlabDirectory, "assets"), evalDirectory, testsDirectory);
report = struct("schema_version", 1, "status", "incomplete", ...
    "scope", "synthetic comparison legend tile diagnostic only", ...
    "data_source", "synthetic benchmark, not observed ocean conditions", ...
    "matlab_release", "R" + string(version('-release')), "matlab_version", string(version), ...
    "generated_at", utc_time(), "screen_pixels_per_inch", get(groot, "ScreenPixelsPerInch"), ...
    "jvm_available", usejava("jvm"), "display", string(getenv("DISPLAY")), ...
    "requested_page_inches", [8 5], "requested_png_pixels", [2400 1500], ...
    "requested_dpi", 300, "reader_text_profile", "fixture-default", ...
    "single_variable", "post-helper Legend.Layout.Tile assignment", ...
    "counts_toward_stage", false, "counts_toward_score", false, ...
    "visual_verified", false, "layout_verified", false, "font_embedding_verified", false, ...
    "exact_page_verified", false, "desktop_interaction_verified", false, "external_inspection_status", "pending", ...
    "postprocessing_performed", false, "input_fixture", struct(), ...
    "comparison", struct("status", "not_verified"), "error", struct());
report.variants = cell(0, 1);
failure = [];
try
    assert(strcmp(which("measure_comparison_plot_data"), ...
        char(fullfile(evalDirectory, "measure_comparison_plot_data.m"))) ...
        && strcmp(which("build_native_pdf_fixture_case"), ...
        char(fullfile(testsDirectory, "build_native_pdf_fixture_case.m"))), ...
        "test_comparison_legend_tile_probe:FunctionPath", "The probe must use the repository builder and reader");
    report.sources = source_records(matlabDirectory);
    sourcePath = fullfile(evalDirectory, "fixtures", "paired_observation_model.json");
    inputDirectory = fullfile(outputDirectory, "fixture-inputs");
    create_directory(inputDirectory);
    snapshotPath = fullfile(inputDirectory, "paired_observation_model.json");
    content = read_bytes(sourcePath);
    write_bytes(snapshotPath, content);
    assert(isequal(read_bytes(snapshotPath), content), ...
        "test_comparison_legend_tile_probe:InputBytes", "The input snapshot must retain every original byte");
    inputHash = string(oi_sha256_file(snapshotPath));
    verify_bytes(snapshotPath, content, inputHash);
    verify_bytes(sourcePath, content, inputHash);
    fixture = jsondecode(native2unicode(content', 'UTF-8'));
    assert(isequal(fixture.synthetic, true) && string(fixture.id) == "paired-observation-model", ...
        "test_comparison_legend_tile_probe:Fixture", "The probe requires the actual synthetic paired fixture");
    snapshot = struct("id", string(fixture.id), "file", "fixture-inputs/paired_observation_model.json", ...
        "source_file", "paired_observation_model.json", "bytes", numel(content), "sha256", inputHash);
    report.input_fixture = snapshot;
    write_json(fullfile(outputDirectory, "input-fixture.json"), snapshot);
    variantIds = ["baseline" "candidate"];
    comparisons = cell(2, 1);
    for variantIndex = 1:2
        [record, comparisons{variantIndex}, variantFailure] = run_variant(outputDirectory, ...
            inputDirectory, variantIds(variantIndex), fixture, snapshot, content);
        report.variants{variantIndex, 1} = record;
        if isempty(failure) && ~isempty(variantFailure)
            failure = variantFailure;
        end
    end
    verify_bytes(snapshotPath, content, inputHash);
    verify_bytes(sourcePath, content, inputHash);
    assert(isequaln(source_records(matlabDirectory), report.sources), ...
        "test_comparison_legend_tile_probe:SourceChanged", "Probe, builder, helper or reader source changed");
    if ~isempty(failure)
        rethrow(failure);
    end
    report.comparison = struct("status", "checked", ...
        "same_v3_declaration", isequaln(comparisons{1}.proof, comparisons{2}.proof), ...
        "same_science_and_style", isequaln(comparisons{1}.invariants, comparisons{2}.invariants));
    assert(report.comparison.same_v3_declaration && report.comparison.same_science_and_style, ...
        "test_comparison_legend_tile_probe:VariantMismatch", ...
        "Only tile placement may differ, not native data, metadata, masks, statistics or styling");
    report.status = "completed_diagnostics_only";
catch errorRecord
    if isempty(failure)
        failure = errorRecord;
    end
    report.error = exception_record(errorRecord);
end
report.completed_at = utc_time();
reportPath = fullfile(outputDirectory, "comparison-legend-tile-probe.json");
write_json(reportPath, report);
fprintf("MATLAB_COMPARISON_LEGEND_TILE_PROBE_REPORT=%s\n", reportPath);
fprintf("MATLAB_COMPARISON_LEGEND_TILE_PROBE_STATUS=%s\n", report.status);
fprintf("MATLAB_COMPARISON_LEGEND_TILE_PROBE_VISUAL_VERIFIED=false\n");
if ~isempty(failure)
    rethrow(failure);
end
clear pathCleanup;
end

function [record, comparison, failure] = run_variant(outputDirectory, inputDirectory, ...
        identifier, fixture, snapshot, content)
variantDirectory = fullfile(outputDirectory, identifier);
record = struct("id", identifier, "status", "failed", "phase", "build", ...
    "legend_layout", "outer-tile", "builder_default_used", identifier == "baseline", ...
    "details", struct(), "artifacts", struct(), "error", struct(), ...
    "v3_preserved_after_exports", false, "science_and_style_preserved", false);
if identifier == "candidate"
    record.legend_layout = "axes-outside";
end
comparison = struct();
failure = [];
try
    create_directory(variantDirectory);
    if identifier == "baseline"
        [figureHandle, record.details, result] = build_native_pdf_fixture_case( ...
            "paired-observation-model", inputDirectory);
    else
        [figureHandle, record.details, result] = build_native_pdf_fixture_case( ...
            "paired-observation-model", inputDirectory, "ComparisonLegendLayout", "axes-outside");
    end
    figureCleanup = onCleanup(@() close_figure(figureHandle));
    assert(record.details.input_sha256 == snapshot.sha256 ...
        && record.details.source_file == snapshot.source_file ...
        && record.details.case_id == snapshot.id, ...
        "test_comparison_legend_tile_probe:BuilderBinding", "Builder evidence must match the consumed snapshot");
    assert(isa(result.Axes.Parent, "matlab.graphics.layout.TiledChartLayout") ...
        && string(result.Axes.Parent.Padding) == "loose" ...
        && string(result.Axes.Parent.TileSpacing) == "compact" ...
        && string(figureHandle.Units) == "inches" ...
        && max(abs(figureHandle.Position(3:4) - [8 5])) < 1e-10 ...
        && string(figureHandle.PaperUnits) == "inches" ...
        && isequal(figureHandle.PaperSize, [8 5]) ...
        && isequal(figureHandle.PaperPosition, [0 0 8 5]), ...
        "test_comparison_legend_tile_probe:Setup", "Both variants must retain the builder's physical setup");
    if identifier == "baseline"
        assert(isequal(string(result.Legend.Layout.Tile), "south"), ...
            "test_comparison_legend_tile_probe:BaselineTile", "Default builder must retain the south tile");
    else
        assert(string(result.Legend.Location) == "southoutside" ...
            && ~isequal(string(result.Legend.Layout.Tile), "south"), ...
            "test_comparison_legend_tile_probe:CandidateLocation", "Candidate must retain helper southoutside placement");
    end
    comparison.invariants = invariant_state(figureHandle, result);
    record.phase = "constructed";
    comparison.proof = capture_state(variantDirectory, record.phase, figureHandle, result, fixture, snapshot);
    for format = ["png" "pdf"]
        record.phase = "export_" + format;
        [artifact, exportFailure] = export_reference(variantDirectory, figureHandle, format);
        record.artifacts.(format) = artifact;
        if ~isempty(exportFailure)
            rethrow(exportFailure);
        end
        record.phase = "after_" + format;
        proof = capture_state(variantDirectory, record.phase, figureHandle, result, fixture, snapshot);
        assert(isequaln(proof, comparison.proof), ...
            "test_comparison_legend_tile_probe:ProofChanged", "Native v3 evidence changed after %s", format);
        assert(isequaln(invariant_state(figureHandle, result), comparison.invariants), ...
            "test_comparison_legend_tile_probe:NativeStateChanged", ...
            "Native science, identity, paint or typography changed after %s", format);
    end
    verify_bytes(fullfile(inputDirectory, snapshot.source_file), content, snapshot.sha256);
    for format = ["png" "pdf"]
        artifact = record.artifacts.(format);
        artifactPath = fullfile(variantDirectory, artifact.file);
        information = dir(artifactPath);
        assert(isscalar(information) && information.bytes == artifact.bytes ...
            && strcmpi(oi_sha256_file(artifactPath), artifact.sha256), ...
            "test_comparison_legend_tile_probe:ArtifactChanged", "A raw reference artifact changed after export");
    end
    record.v3_preserved_after_exports = true;
    record.science_and_style_preserved = true;
    record.status = "completed_diagnostic";
    clear figureCleanup;
catch errorRecord
    failure = errorRecord;
    record.error = exception_record(errorRecord);
    fprintf(2, "MATLAB_COMPARISON_LEGEND_TILE_VARIANT_FAILED=%s: %s: %s\n", ...
        identifier, errorRecord.identifier, errorRecord.message);
end
write_json(fullfile(variantDirectory, "variant.json"), record);
end

function proof = capture_state(directory, phase, figureHandle, result, fixture, snapshot)
drawnow;
state = struct("phase", phase, "reader_text_profile", "fixture-default", ...
    "geometry", geometry_state(figureHandle, result, phase ~= "constructed"), "reader_status", "failed");
failure = [];
proof = struct();
try
    proof = measure_comparison_plot_data(result, fixture, snapshot, figureHandle);
    assert(isequal(proof.schema_version, 3), "test_comparison_legend_tile_probe:Schema", ...
        "The actual reader must produce comparison v3");
    state.plot_data_evidence = proof;
    state.reader_status = "verified_native_fixture_assertions_only";
catch errorRecord
    failure = errorRecord;
    state.reader_error = exception_record(errorRecord);
end
write_json(fullfile(directory, phase + ".json"), state);
if ~isempty(failure)
    rethrow(failure);
end
end

function state = invariant_state(figureHandle, result)
state = struct();
state.returned = rmfield(result, {'Axes', 'Scatter', 'OneToOne', 'UncertaintyGraphics', 'Legend'});
state.theme = getappdata(figureHandle, "OI_OceanTheme");
state.figure_size_inches = figureHandle.Position(3:4);
[objects, roles] = named_objects(figureHandle, result);
objects = [objects; num2cell(result.Scatter(:)); {result.OneToOne}; num2cell(result.UncertaintyGraphics(:))];
propertiesToRead = ["String" "FontName" "FontSize" "FontUnits" "FontWeight" "FontAngle" ...
    "Interpreter" "Visible" "Color" "EdgeColor" "LineStyle" "LineWidth" "Marker" "SizeData" ...
    "MarkerFaceColor" "MarkerEdgeColor" "MarkerFaceAlpha" "MarkerEdgeAlpha" ...
    "XData" "YData" "CData" "UserData" "HandleVisibility" "DisplayName" ...
    "XLim" "YLim" "XLimMode" "YLimMode" "DataAspectRatio" "DataAspectRatioMode" ...
    "XDir" "YDir" "XScale" "YScale" "GridColor" "GridAlpha" "Padding" "TileSpacing" ...
    "Orientation" "AutoUpdate" "Box" "InvertHardcopy" "PaperSize" "PaperPosition" "PaperPositionMode"];
state.objects = cell(numel(objects), 1);
state.named_roles = roles;
for objectIndex = 1:numel(objects)
    object = objects{objectIndex};
    publicNames = string(properties(object));
    values = struct("class", string(class(object)));
    for propertyName = propertiesToRead
        if any(publicNames == propertyName)
            values.(propertyName) = object.(propertyName);
        end
    end
    if isgraphics(object) && isappdata(object, "OI_ColorAccessibilityRole")
        values.color_role = getappdata(object, "OI_ColorAccessibilityRole");
    end
    state.objects{objectIndex} = values;
end
end

function snapshot = geometry_state(figureHandle, result, exported)
[objects, roles] = named_objects(figureHandle, result);
propertyNames = ["Units" "Position" "OuterPosition" "InnerPosition" "Extent" "TightInset" ...
    "PositionConstraint" "String" "FontName" "FontSize" "FontUnits" "FontWeight" ...
    "Interpreter" "Visible" "Rotation" "Location" "Orientation" "NumColumns" "Box" ...
    "Padding" "TileSpacing" "GridSize" "XLim" "YLim" "XTick" "YTick" ...
    "XTickLabel" "YTickLabel" "DataAspectRatio" "PlotBoxAspectRatio" ...
    "PaperUnits" "PaperSize" "PaperPosition" "PaperPositionMode" "Renderer"];
snapshot = struct("scope", "literal public properties in their recorded native units", ...
    "legend_title_geometry_status", "unverified", "visual_verified", false);
snapshot.objects = cell(numel(objects), 1);
for objectIndex = 1:numel(objects)
    object = objects{objectIndex};
    publicNames = string(properties(object));
    record = struct("role", roles(objectIndex), "class", string(class(object)), ...
        "public_properties", {cellstr(publicNames)}, "parent_status", "not_available");
    record.properties = property_records(object, propertyNames);
    try
        if any(publicNames == "Parent")
            record.parent_class = string(class(object.Parent));
            record.parent_status = "available";
        end
        if any(publicNames == "Layout") && ~isempty(object.Layout)
            record.layout_class = string(class(object.Layout));
            record.layout_properties = property_records(object.Layout, ["Tile" "TileSpan"]);
        end
    catch errorRecord
        record.relationship_error = exception_record(errorRecord);
    end
    snapshot.objects{objectIndex} = record;
end
snapshot.figure_normalized_bounds = struct("status", "not_measured_before_native_export");
if exported
    snapshot.figure_normalized_bounds = measured_bounds(figureHandle, result);
end
end

function measurement = measured_bounds(figureHandle, result)
measurement = struct("status", "partial", "scope", "native object bounds, not exported glyphs", ...
    "units", "figure_normalized", "legend_title", struct("status", "not_available", ...
        "reason", "no public Extent assumed; see literal property inventory"));
textHandles = {result.Axes.Title; result.Axes.Subtitle; result.Axes.XLabel; result.Axes.YLabel};
textRoles = ["title" "subtitle" "xlabel" "ylabel"];
for textIndex = 1:numel(textHandles)
    try
        bounds = oi_text_bounds(textHandles{textIndex}, figureHandle);
        measurement.(textRoles(textIndex)) = struct("status", "measured", ...
            "method", "oi_text_bounds", "bounds", bounds);
    catch errorRecord
        measurement.(textRoles(textIndex)) = struct("status", "unverified", ...
            "error", exception_record(errorRecord));
    end
end
try
    figurePixels = double(getpixelposition(figureHandle));
    legendPixels = double(getpixelposition(result.Legend, true));
    assert(numel(figurePixels) == 4 && numel(legendPixels) == 4 ...
        && all(isfinite([figurePixels legendPixels])) ...
        && all(figurePixels(3:4) > 0) && all(legendPixels(3:4) > 0), ...
        "test_comparison_legend_tile_probe:LegendBounds", "Native legend geometry must be finite and positive");
    bounds = [(legendPixels(1:2) - 1) ./ figurePixels(3:4), legendPixels(3:4) ./ figurePixels(3:4)];
    measurement.legend = struct("status", "measured", "method", "getpixelposition recursive", "bounds", bounds);
catch errorRecord
    measurement.legend = struct("status", "unverified", "error", exception_record(errorRecord));
end
measurement.xlabel_legend_overlap = struct("status", "not_available");
if measurement.xlabel.status == "measured" && measurement.legend.status == "measured"
    xlabelBounds = measurement.xlabel.bounds;
    legendBounds = measurement.legend.bounds;
    intersection = min(xlabelBounds(1:2) + xlabelBounds(3:4), legendBounds(1:2) + legendBounds(3:4)) ...
        - max(xlabelBounds(1:2), legendBounds(1:2));
    measurement.xlabel_legend_overlap = struct("status", "computed_native_rectangles_only", ...
        "intersects", all(intersection > 0), "signed_intersection_size", intersection);
end
end

function records = property_records(object, propertyNames)
publicNames = string(properties(object));
records = struct();
for propertyName = propertyNames
    record = struct("status", "not_available", "property_exists", isprop(object, propertyName), ...
        "publicly_listed", any(publicNames == propertyName));
    if record.publicly_listed
        try
            value = object.(propertyName);
            record.value_class = string(class(value));
            record.value_size = size(value);
            if isa(value, "matlab.lang.OnOffSwitchState")
                value = string(value);
            end
            assert(isnumeric(value) || islogical(value) || ischar(value) || isstring(value) ...
                || iscell(value), "test_comparison_legend_tile_probe:PropertyType", ...
                "Unsupported public property value: %s.%s", class(object), propertyName);
            record.value = value;
            record.status = "available";
        catch errorRecord
            record.status = "read_error";
            record.error = exception_record(errorRecord);
        end
    end
    records.(propertyName) = record;
end
end

function [objects, roles] = named_objects(figureHandle, result)
objects = {figureHandle; result.Axes.Parent; result.Axes; result.Axes.Title; ...
    result.Axes.Subtitle; result.Axes.XLabel; result.Axes.YLabel; result.Legend; result.Legend.Title};
roles = ["figure"; "layout"; "axes"; "axes.title"; "axes.subtitle"; ...
    "axes.xlabel"; "axes.ylabel"; "legend"; "legend.title"];
end

function [artifact, failure] = export_reference(directory, figureHandle, format)
fileName = "reference." + format;
filePath = fullfile(directory, fileName);
artifact = struct("file", fileName, "status", "failed", "api", "print", ...
    "api_invoked", false, "call_succeeded", false, "postprocessed", false, ...
    "file_exists", false, "error", struct());
failure = [];
try
    assert(~isfile(filePath) && ~isfolder(filePath), "test_comparison_legend_tile_probe:StaleArtifact", ...
        "Refusing to overwrite %s", filePath);
    artifact.api_invoked = true;
    if format == "png"
        artifact.options = {"-dpng", "-r300"};
        print(figureHandle, char(filePath), "-dpng", "-r300");
    else
        artifact.options = {"-dpdf", "-painters"};
        print(figureHandle, char(filePath), "-dpdf", "-painters");
    end
    artifact.call_succeeded = true;
catch errorRecord
    failure = errorRecord;
    artifact.error = exception_record(errorRecord);
end
try
    artifact.file_exists = isfile(filePath);
    information = dir(filePath);
    assert(artifact.file_exists && isscalar(information) && information.bytes > 0, ...
        "test_comparison_legend_tile_probe:MissingArtifact", "No nonempty raw export: %s", filePath);
    artifact.bytes = information.bytes;
    artifact.sha256 = string(oi_sha256_file(filePath));
    if format == "png"
        information = imfinfo(filePath);
        artifact.png_pixels = [information.Width information.Height];
        assert(isequal(artifact.png_pixels, [2400 1500]), ...
            "test_comparison_legend_tile_probe:PNGSize", "Raw reference PNG must retain 2400x1500 pixels");
    end
    if isempty(failure)
        artifact.status = "exported_raw";
    end
catch errorRecord
    artifact.inspection_error = exception_record(errorRecord);
    if isempty(failure)
        failure = errorRecord;
        artifact.error = exception_record(errorRecord);
    end
end
write_json(fullfile(directory, fileName + ".json"), artifact);
end

function records = source_records(matlabDirectory)
names = ["tests/test_comparison_legend_tile_probe.m" "tests/build_native_pdf_fixture_case.m" ...
    "assets/oi_plot_comparison.m" "evals/measure_comparison_plot_data.m"];
records = cell(numel(names), 1);
for sourceIndex = 1:numel(names)
    sourcePath = fullfile(matlabDirectory, names(sourceIndex));
    information = dir(sourcePath);
    assert(isscalar(information) && ~information.isdir && information.bytes > 0, ...
        "test_comparison_legend_tile_probe:SourceFile", "Expected a nonempty source file: %s", sourcePath);
    records{sourceIndex} = struct("file", names(sourceIndex), "bytes", information.bytes, ...
        "sha256", string(oi_sha256_file(sourcePath)));
end
end

function verify_bytes(filePath, content, expectedHash)
assert(isequal(read_bytes(filePath), content) && strcmpi(oi_sha256_file(filePath), expectedHash) ...
    && isequal(read_bytes(filePath), content), ...
    "test_comparison_legend_tile_probe:InputChanged", "Consumed fixture bytes changed: %s", filePath);
end

function content = read_bytes(filePath)
fileHandle = fopen(filePath, "rb");
assert(fileHandle >= 0, "test_comparison_legend_tile_probe:Read", "Cannot read %s", filePath);
cleanup = onCleanup(@() fclose(fileHandle));
content = fread(fileHandle, Inf, "*uint8");
assert(~isempty(content) && feof(fileHandle), "test_comparison_legend_tile_probe:Read", ...
    "Expected a complete nonempty byte stream: %s", filePath);
clear cleanup;
end

function write_bytes(filePath, content)
assert(~isfile(filePath) && ~isfolder(filePath), "test_comparison_legend_tile_probe:StaleFile", ...
    "Refusing to overwrite %s", filePath);
fileHandle = fopen(filePath, "wb");
assert(fileHandle >= 0, "test_comparison_legend_tile_probe:Write", "Cannot write %s", filePath);
cleanup = onCleanup(@() fclose(fileHandle));
assert(fwrite(fileHandle, content, "uint8") == numel(content), ...
    "test_comparison_legend_tile_probe:Write", "Incomplete write: %s", filePath);
clear cleanup;
end

function write_json(filePath, payload)
write_bytes(filePath, unicode2native(jsonencode(payload), 'UTF-8'));
end

function create_directory(directory)
assert(~isfolder(directory) && ~isfile(directory), "test_comparison_legend_tile_probe:FreshOutput", ...
    "Refusing to reuse %s", directory);
[created, message] = mkdir(directory);
assert(created, "test_comparison_legend_tile_probe:Directory", "%s", message);
end

function value = exception_record(errorRecord)
value = struct("identifier", string(errorRecord.identifier), "message", string(errorRecord.message));
value.stack = errorRecord.stack;
end

function close_figure(figureHandle)
if isscalar(figureHandle) && isgraphics(figureHandle, "figure")
    delete(figureHandle);
end
end

function value = utc_time()
value = string(datetime("now", "TimeZone", "UTC", "Format", "yyyy-MM-dd'T'HH:mm:ss'Z'"));
end
