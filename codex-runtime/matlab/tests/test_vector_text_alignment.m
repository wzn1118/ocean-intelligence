function report = test_vector_text_alignment(outputDirectory)
%TEST_VECTOR_TEXT_ALIGNMENT Four native PDF controls, without geometry fixes.
% Export completion and raw public properties are diagnostic evidence only.
% Files survive failures; glyphs, alignment, embedding, and PDF page sizes
% require independent inspection. No production exporter or bounds helper runs.
arguments
    outputDirectory (1,1) string
end
assert(~ismissing(outputDirectory) && strlength(strtrim(outputDirectory)) > 0, ...
    "test_vector_text_alignment:OutputDirectory", "An output directory is required");
assert(~isfolder(outputDirectory) && ~isfile(outputDirectory), ...
    "test_vector_text_alignment:FreshOutput", "Refusing to reuse %s", outputDirectory);
[created, message] = mkdir(outputDirectory);
assert(created, "test_vector_text_alignment:CreateDirectory", "%s", message);
originalPath = path;
pathCleanup = onCleanup(@() path(originalPath));
addpath(fullfile(fileparts(fileparts(mfilename("fullpath"))), "assets"));

source = struct("id", "synthetic-regression-profile", ...
    "description", "Synthetic values from run_plot_regression profile; not observations", ...
    "depth_m", [0; 10; 20; 30; 40], ...
    "temperature_degC", [9 10; NaN 11; 8 12; 7 NaN; 6 13], ...
    "series", ["Station A" "Station B"]);
source.missing_mask = isnan(source.temperature_degC);
cjkText = string(char([21335 28023 28201 24230 21078 38754]));
source.title = "Ocean temperature profiles: Station A and Station B - " + cjkText;
source.xlabel = "Temperature (degC)";
source.ylabel = "Depth (m, positive down; reference: mean sea level)";
fontName = "WenQuanYi Zen Hei";
exportPath = string(which("exportgraphics"));
exactAvailable = strlength(exportPath) > 0 && ~verLessThan('matlab', '25.1');
report = struct("schema_version", 1, "status", "running", ...
    "started_at", utc_timestamp(), "release", "R" + string(version('-release')), ...
    "matlab_version", string(version), "jvm_available", logical(usejava("jvm")), ...
    "screen_pixels_per_inch", get(groot, "ScreenPixelsPerInch"), ...
    "exportgraphics_path", exportPath, "exact_options_available", exactAvailable, ...
    "source", source, "font_name", fontName, "font_available", false, ...
    "font_probe", struct(), "font_check_error", "", "figure_inches", [8 5], "png_dpi", 300, ...
    "expected_exact_pdf_page_points", [576 360], ...
    "verification_scope", "API completion, raw public properties, file bytes and SHA-256 only", ...
    "geometry_reference", "Unconverted public properties in their recorded Units; no inferred bounds", ...
    "hypothesis_status", "unverified", "visual_verified", false, ...
    "font_embedding_verified", false, "text_extraction_verified", false, ...
    "pdf_page_size_verified", false, "exact_comparison_completed", false);
report.candidates = candidate_records(source.id);
reportPath = fullfile(outputDirectory, "vector-text-alignment.json");
write_report(reportPath, report);
try
    [report.font_available, report.font_probe] = probe_font_availability(fontName);
catch errorRecord
    report.font_check_error = string(errorRecord.identifier) + ": " + string(errorRecord.message);
end
for candidateIndex = 1:numel(report.candidates)
    if ~report.font_available
        report.candidates(candidateIndex).status = "skipped";
        report.candidates(candidateIndex).skip_reason = "requested_font_not_confirmed_available";
    elseif strlength(exportPath) == 0
        report.candidates(candidateIndex).status = "skipped";
        report.candidates(candidateIndex).skip_reason = "exportgraphics_unavailable";
    elseif candidateIndex <= 3 && ~exactAvailable
        report.candidates(candidateIndex).status = "skipped";
        report.candidates(candidateIndex).skip_reason = "exact_options_require_R2025a";
    end
    if report.candidates(candidateIndex).status == "skipped" ...
            && report.candidates(candidateIndex).png_precondition.status == "pending"
        report.candidates(candidateIndex).png_precondition.status = "skipped";
    end
end
report.candidates(2).predecessor_status = report.candidates(1).status;
write_report(reportPath, report);

if report.candidates(1).status == "pending"
    try
        shared = make_figure(source, fontName);
        sharedCleanup = onCleanup(@() close_if_valid(shared.figure));
        report.candidates(1) = run_candidate(shared, report.candidates(1), outputDirectory);
        write_report(reportPath, report);
        report.candidates(2).predecessor_status = report.candidates(1).status;
        report.candidates(2) = run_candidate(shared, report.candidates(2), outputDirectory);
    catch errorRecord
        for candidateIndex = 1:2
            if report.candidates(candidateIndex).status == "pending"
                report.candidates(candidateIndex) = record_failure(report.candidates(candidateIndex), errorRecord);
            end
        end
    end
    clear sharedCleanup;
    write_report(reportPath, report);
end
for candidateIndex = 3:4
    if report.candidates(candidateIndex).status ~= "pending"
        continue;
    end
    try
        handles = make_figure(source, fontName);
        figureCleanup = onCleanup(@() close_if_valid(handles.figure));
        report.candidates(candidateIndex) = run_candidate(handles, report.candidates(candidateIndex), outputDirectory);
    catch errorRecord
        report.candidates(candidateIndex) = record_failure(report.candidates(candidateIndex), errorRecord);
    end
    clear figureCleanup;
    write_report(reportPath, report);
end

statuses = [report.candidates.status];
report.summary = struct("candidate_count", 4, "exported", sum(statuses == "exported"), ...
    "failed", sum(statuses == "failed"), "skipped", sum(statuses == "skipped"));
report.exact_comparison_completed = all(statuses(1:3) == "exported");
if report.summary.failed > 0
    report.status = "completed_with_failures";
elseif report.summary.exported == 0
    report.status = "unavailable";
elseif report.summary.skipped > 0
    report.status = "completed_with_skips";
else
    report.status = "exports_completed_pending_external_review";
end
report.completed_at = utc_timestamp();
write_report(reportPath, report);
fprintf("MATLAB_VECTOR_TEXT_ALIGNMENT_JSON=%s\n", reportPath);
fprintf("MATLAB_VECTOR_TEXT_ALIGNMENT_STATUS=%s\n", report.status);
fprintf("MATLAB_VECTOR_TEXT_ALIGNMENT_EXACT_COMPARISON_COMPLETED=%d\n", report.exact_comparison_completed);
fprintf("MATLAB_VECTOR_TEXT_ALIGNMENT_VISUAL_VERIFIED=false\n");
assert(report.summary.failed == 0 && report.summary.exported > 0, ...
    "test_vector_text_alignment:IncompleteDiagnostic", ...
    "Native diagnostic unavailable or failed; partial evidence retained in %s", reportPath);
end

function [available, evidence] = probe_font_availability(fontName)
evidence = struct("method", "listfonts/fc-list exact family equality", ...
    "listfonts_match", false, "listfonts_error", "", ...
    "fc_list_invoked", false, "fc_list_status", [], "fc_list_match", false, ...
    "fc_list_error", "");
try
    installedFonts = strtrim(string(listfonts));
    evidence.listfonts_match = any(strcmpi(installedFonts(:), fontName));
catch errorRecord
    evidence.listfonts_error = string(errorRecord.identifier) + ": " + string(errorRecord.message);
end
available = evidence.listfonts_match;
if available || ~isunix
    return;
end
try
    evidence.fc_list_invoked = true;
    [status, output] = system("fc-list -f '%{family}\n' 2>/dev/null");
    evidence.fc_list_status = status;
    if status == 0
        families = strtrim(string(regexp(output, '[\r\n,]+', 'split')));
        evidence.fc_list_match = any(strcmpi(families(:), fontName));
        available = evidence.fc_list_match;
    end
catch errorRecord
    evidence.fc_list_error = string(errorRecord.identifier) + ": " + string(errorRecord.message);
end
end

function records = candidate_records(sourceId)
png = struct("status", "not_requested", "file", "", "api_invoked", false, ...
    "export_call_succeeded", false, "file_exists", false, "bytes", 0, "sha256", "", ...
    "width", [], "height", [], "decoded", false, "pixel_min", [], "pixel_max", [], ...
    "drawnow_after_measurement_completed", false);
template = struct("id", "", "source_id", sourceId, "figure_instance_id", "", ...
    "predecessor_id", "", "predecessor_status", "not_applicable", ...
    "requested_api", "exportgraphics", "export_api", "", "export_target_class", "", ...
    "content_type", "vector", ...
    "exact_page_requested", true, "requested_options", struct(), ...
    "status", "pending", "skip_reason", "", "file", "", ...
    "api_invoked", false, "export_call_succeeded", false, ...
    "file_exists", false, "bytes", 0, "sha256", "", ...
    "png_precondition", png, "snapshots", repmat(snapshot_template(), 0, 1), ...
    "property_failures", 0, "error_identifier", "", "error_message", "");
ids = ["01-exact-first", "02-exact-second", "03-png-measure-drawnow-exact", "04-native-tight"];
instances = ["shared-exact", "shared-exact", "fresh-png", "fresh-tight"];
records = repmat(template, 4, 1);
for index = 1:4
    records(index).id = ids(index);
    records(index).file = ids(index) + ".pdf";
    records(index).figure_instance_id = instances(index);
    records(index).requested_options = struct("ContentType", "vector", "BackgroundColor", "white");
    if index <= 3
        records(index).requested_options.Units = "inches";
        records(index).requested_options.Width = 8;
        records(index).requested_options.Height = 5;
        records(index).requested_options.Padding = "figure";
        records(index).requested_options.PreserveAspectRatio = "on";
    else
        records(index).exact_page_requested = false;
    end
end
records(2).predecessor_id = ids(1);
records(3).png_precondition.status = "pending";
records(3).png_precondition.file = ids(3) + ".png";
end

function handles = make_figure(source, fontName)
figureHandle = figure("Visible", "off", "Color", "white", ...
    "Units", "inches", "Position", [1 1 8 5], ...
    "PaperUnits", "inches", "PaperSize", [8 5], ...
    "PaperPosition", [0 0 8 5], "PaperPositionMode", "manual", ...
    "InvertHardcopy", "off", "RendererMode", "auto", ...
    "DefaultAxesFontName", fontName, "DefaultTextFontName", fontName, ...
    "DefaultTextInterpreter", "none");
try
    axesHandle = axes("Parent", figureHandle, "Units", "normalized", ...
        "PositionConstraint", "outerposition", "OuterPosition", [0.04 0.04 0.92 0.92], ...
        "FontName", fontName, "FontSize", 11, "TickLabelInterpreter", "none", ...
        "NextPlot", "add", "YDir", "reverse", "XLim", [5 14], "YLim", [0 40]);
    plot(axesHandle, source.temperature_degC(:, 1), source.depth_m, "-o", ...
        "Color", [0 0.447 0.698], "LineWidth", 1.5, "DisplayName", source.series(1));
    plot(axesHandle, source.temperature_degC(:, 2), source.depth_m, "--s", ...
        "Color", [0.835 0.369 0], "LineWidth", 1.5, "DisplayName", source.series(2));
    titleHandle = title(axesHandle, source.title, "FontName", fontName, ...
        "FontSize", 14, "FontWeight", "normal", "Interpreter", "none");
    xlabelHandle = xlabel(axesHandle, source.xlabel, "FontName", fontName, ...
        "FontSize", 12, "Interpreter", "none");
    ylabelHandle = ylabel(axesHandle, source.ylabel, "FontName", fontName, ...
        "FontSize", 12, "Rotation", 90, "Interpreter", "none");
    drawnow;
    handles = struct("figure", figureHandle, "axes", axesHandle, ...
        "Title", titleHandle, "XLabel", xlabelHandle, "YLabel", ylabelHandle);
catch errorRecord
    close_if_valid(figureHandle);
    rethrow(errorRecord);
end
end

function record = run_candidate(handles, record, outputDirectory)
pdfPath = fullfile(outputDirectory, record.file);
exactOptions = {"Units", "inches", "Width", 8, "Height", 5, ...
    "Padding", "figure", "PreserveAspectRatio", "on", "BackgroundColor", "white"};
try
    record.snapshots(end + 1, 1) = capture_state(handles, "initial_public_properties");
    if record.png_precondition.status == "pending"
        pngPath = fullfile(outputDirectory, record.png_precondition.file);
        assert_fresh_file(pngPath);
        record.png_precondition.api_invoked = true;
        exportgraphics(handles.figure, pngPath, exactOptions{:}, "Resolution", 300);
        record.png_precondition.export_call_succeeded = true;
        record.png_precondition = file_evidence(pngPath, record.png_precondition);
        information = imfinfo(pngPath);
        pixels = imread(pngPath);
        record.png_precondition.width = information.Width;
        record.png_precondition.height = information.Height;
        record.png_precondition.decoded = ~isempty(pixels);
        record.png_precondition.pixel_min = double(min(pixels(:)));
        record.png_precondition.pixel_max = double(max(pixels(:)));
        assert(information.Width == 2400 && information.Height == 1500 ...
            && ~isempty(pixels) && min(pixels(:)) < max(pixels(:)), ...
            "test_vector_text_alignment:PngPrecondition", ...
            "The native PNG precondition must decode to a nonuniform 2400x1500 raster");
        record.snapshots(end + 1, 1) = capture_state(handles, "after_real_png_measurement");
        drawnow;
        record.png_precondition.drawnow_after_measurement_completed = true;
        record.snapshots(end + 1, 1) = capture_state(handles, "after_png_measurement_drawnow");
        record.png_precondition.status = "exported_and_measured";
    end
    assert_fresh_file(pdfPath);
    record.export_api = "exportgraphics";
    record.api_invoked = true;
    if record.exact_page_requested
        record.export_target_class = string(class(handles.figure));
        exportgraphics(handles.figure, pdfPath, exactOptions{:}, "ContentType", "vector");
    else
        record.export_target_class = string(class(handles.axes));
        exportgraphics(handles.axes, pdfPath, "ContentType", "vector", "BackgroundColor", "white");
    end
    record.export_call_succeeded = true;
catch errorRecord
    record = record_failure(record, errorRecord);
    if record.png_precondition.status == "pending"
        record.png_precondition.status = "failed";
    end
end
record.snapshots(end + 1, 1) = capture_state(handles, "after_native_attempt");
record.property_failures = sum([record.snapshots.property_failures]);
try
    record = file_evidence(pdfPath, record);
    if strlength(record.png_precondition.file) > 0
        record.png_precondition = file_evidence(fullfile(outputDirectory, record.png_precondition.file), record.png_precondition);
    end
    assert(record.export_call_succeeded && record.bytes > 0 && strlength(record.sha256) == 64, ...
        "test_vector_text_alignment:ArtifactEvidence", "Native PDF export evidence is incomplete");
    assert(record.property_failures == 0, ...
        "test_vector_text_alignment:PropertyEvidence", "Some public properties could not be recorded");
    if strlength(record.error_identifier) == 0 && strlength(record.error_message) == 0
        record.status = "exported";
    end
catch errorRecord
    if record.status ~= "failed"
        record = record_failure(record, errorRecord);
    end
end
end

function snapshot = capture_state(handles, phase)
snapshot = snapshot_template();
snapshot.phase = phase;
snapshot.captured_at = utc_timestamp();
roles = ["figure" "axes" "Title" "XLabel" "YLabel"];
for index = 1:numel(roles)
    role = roles(index);
    object = handles.(char(role));
    if role == "figure"
        properties = ["Units" "Position" "PaperUnits" "PaperSize" "PaperPosition" ...
            "PaperPositionMode" "Renderer" "RendererMode" "Visible"];
    elseif role == "axes"
        properties = ["Units" "Position" "OuterPosition" "TightInset" ...
            "PositionConstraint" "XLim" "YLim" "YDir" "FontName" "FontSize"];
    else
        properties = ["String" "Units" "Extent" "Position" ...
            "HorizontalAlignment" "VerticalAlignment" "Rotation" ...
            "FontName" "FontSize" "FontWeight" "Interpreter" "Visible"];
    end
    record = struct("role", role, "class", string(class(object)), "properties", struct());
    for propertyName = properties
        result = probe_public_api(@() get(object, char(propertyName)));
        record.properties.(char(propertyName)) = result;
        snapshot.property_failures = snapshot.property_failures + ~result.succeeded;
    end
    snapshot.objects(end + 1, 1) = record;
end
end

function snapshot = snapshot_template()
snapshot = struct("phase", "", "captured_at", "", "property_failures", 0, ...
    "objects", repmat(struct("role", "", "class", "", "properties", struct()), 0, 1));
end

function result = probe_public_api(callback)
result = struct("succeeded", false, "value", [], "value_class", "", ...
    "value_size", [], "error_identifier", "", "error_message", "");
try
    value = callback();
    result.value = value;
    result.value_class = string(class(value));
    result.value_size = size(value);
    result.succeeded = true;
catch errorRecord
    result.error_identifier = string(errorRecord.identifier);
    result.error_message = string(errorRecord.message);
end
end

function record = file_evidence(filePath, record)
record.file_exists = isfile(filePath);
if record.file_exists
    information = dir(filePath);
    record.bytes = information.bytes;
    if record.bytes > 0
        record.sha256 = string(oi_sha256_file(filePath));
    end
end
end

function record = record_failure(record, errorRecord)
record.status = "failed";
record.error_identifier = string(errorRecord.identifier);
record.error_message = string(errorRecord.message);
end

function assert_fresh_file(filePath)
assert(~isfile(filePath) && ~isfolder(filePath), ...
    "test_vector_text_alignment:FreshArtifact", "Refusing to overwrite %s", filePath);
end

function write_report(filePath, report)
encoded = unicode2native(jsonencode(report), "UTF-8");
fileHandle = fopen(filePath, "wb");
assert(fileHandle >= 0, "test_vector_text_alignment:Write", "Cannot write %s", filePath);
cleanup = onCleanup(@() fclose(fileHandle));
written = fwrite(fileHandle, encoded, "uint8");
assert(written == numel(encoded), "test_vector_text_alignment:Write", "Incomplete JSON write");
end

function value = utc_timestamp()
value = string(datetime("now", "TimeZone", "UTC", "Format", "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"));
end

function close_if_valid(figureHandle)
if isgraphics(figureHandle, "figure")
    close(figureHandle);
end
end
