function report = test_native_pdf_page_probe(outputDirectory)
%TEST_NATIVE_PDF_PAGE_PROBE Inspect native container exports without page claims.
arguments
    outputDirectory (1,1) string = string(tempname)
end
assert(~ismissing(outputDirectory) && strlength(strtrim(outputDirectory)) > 0, ...
    "test_native_pdf_page_probe:OutputDirectory", "An output directory is required");
assert(~isfolder(outputDirectory) && ~isfile(outputDirectory), ...
    "test_native_pdf_page_probe:FreshOutput", "Refusing to reuse %s", outputDirectory);
[created, message] = mkdir(outputDirectory);
assert(created, "test_native_pdf_page_probe:CreateDirectory", "%s", message);
originalPath = path;
pathCleanup = onCleanup(@() path(originalPath));
addpath(fullfile(fileparts(fileparts(mfilename("fullpath"))), "assets"));

fontName = "WenQuanYi Zen Hei";
installedFonts = strings(0, 1);
fontListError = "";
try
    installedFonts = strtrim(string(listfonts));
catch errorRecord
    fontListError = string(errorRecord.identifier) + ": " + string(errorRecord.message);
end
exportFileType = exist("exportgraphics", "file");
exportAvailable = any(exportFileType == [2 3 6]) ...
    || exist("exportgraphics", "builtin") == 5;
titleText = string(char([21335 28023 28023 34920 28201 24230]));
yLabelText = string(char([28201 24230])) + " (degC)";
report = struct("schema_version", 1, "status", "running", ...
    "generated_at", utc_timestamp(), "release", "R" + string(version('-release')), ...
    "matlab_version", string(version), ...
    "screen_pixels_per_inch", get(groot, "ScreenPixelsPerInch"), ...
    "exportgraphics_path", string(which("exportgraphics")), ...
    "exportgraphics_file_type", exportFileType, ...
    "exportgraphics_available", exportAvailable, "font_name", fontName, ...
    "font_available", oi_font_available(fontName, installedFonts), ...
    "listfonts_match", any(strcmpi(installedFonts(:), fontName)), ...
    "listfonts_error", fontListError, ...
    "availability_method", "listfonts then Unix fontconfig exact families", ...
    "target_page_inches", [8 5], "target_page_points", [576 360], ...
    "export_options", struct("ContentType", "vector", "BackgroundColor", "white"), ...
    "data_source", "synthetic font and page diagnostic, not observations", ...
    "expected_text", [titleText yLabelText "Time (h)" "Observed 20.125" "Model 21.50"], ...
    "verification_scope", "export completion, nonempty PDF, bytes and SHA-256 only", ...
    "geometry_read_scope", "literal PDF dictionary scan, not a full PDF parser", ...
    "font_name_evidence", "graphics properties, not rendered font identity", ...
    "stage_status_scope", "original_three_candidates_export_checks_only", ...
    "supplementary_report", "canvas-extent-experiment/canvas-extent-experiment.json", ...
    "supplementary_status_scope", "read the separate diagnostic report and stderr; not counted in this stage", ...
    "external_inspection_status", "pending", "exact_page_verified", false, ...
    "font_embedding_verified", false, "cjk_visual_verified", false, ...
    "text_extraction_verified", false, "layout_verified", false);
candidateIds = ["axes-outerposition", "tiledlayout-loose", "panel-fullpage"];
template = struct("id", "", "file", "", "status", "pending", "skip_reason", "", ...
    "requested_api", "exportgraphics", "requested_device", "pdf", ...
    "export_api", "", "export_device", "", "api_invoked", false, ...
    "export_call_succeeded", false, "export_object_class", "", ...
    "figure_inches", [], "paper_size_inches", [], "paper_position_inches", [], ...
    "target_position_inches", [], "target_outer_position_inches", [], ...
    "target_position_constraint", "", "layout_padding", "", "tile_spacing", "", ...
    "panel_border_type", "", "axes_position_inches", [], "axes_tight_inset_inches", [], ...
    "graphics_font_names", strings(0, 1), "file_exists", false, ...
    "pdf_header_present", false, "bytes", 0, "sha256", "", ...
    "media_box_literals", zeros(0, 4), "crop_box_literals", zeros(0, 4), ...
    "geometry_status", "pending", "geometry_error", "", ...
    "exact_page_verified", false, "font_embedding_verified", false, ...
    "cjk_visual_verified", false, "text_extraction_verified", false, ...
    "layout_verified", false, "error_identifier", "", "error_message", "");
report.candidates = repmat(template, numel(candidateIds), 1);
for candidateIndex = 1:numel(candidateIds)
    report.candidates(candidateIndex).id = candidateIds(candidateIndex);
    report.candidates(candidateIndex).file = candidateIds(candidateIndex) + ".pdf";
end
reportPath = fullfile(outputDirectory, "native-pdf-page-probe.json");
write_report(reportPath, report);
for candidateIndex = 1:numel(candidateIds)
    record = report.candidates(candidateIndex);
    if ~report.font_available
        record.status = "skipped";
        record.skip_reason = "wenquanyi_not_confirmed_available";
    elseif ~exportAvailable
        record.status = "skipped";
        record.skip_reason = "exportgraphics_unavailable";
    else
        record = export_candidate(outputDirectory, record, fontName, titleText, yLabelText);
    end
    report.candidates(candidateIndex) = record;
    write_report(reportPath, report);
end
statuses = [report.candidates.status];
report.summary = struct("candidate_count", numel(candidateIds), ...
    "exports_succeeded", sum(statuses == "exported"), ...
    "exports_failed", sum(statuses == "failed"), "exports_skipped", sum(statuses == "skipped"));
report.status = "completed_export_checks_only";
if any(statuses ~= "exported")
    report.status = "incomplete";
end
report.completed_at = utc_timestamp();
write_report(reportPath, report);
try
    report.canvas_extent_experiment = run_canvas_extent_experiment(outputDirectory, ...
        report.font_available, exportAvailable, fontName, titleText, yLabelText);
catch errorRecord
    report.canvas_extent_experiment = struct("status", "failed", ...
        "counts_toward_stage", false, "directory", "canvas-extent-experiment", ...
        "report_file", "canvas-extent-experiment/canvas-extent-experiment.json", ...
        "error_identifier", string(errorRecord.identifier), ...
        "error_message", string(errorRecord.message));
    fprintf(2, "MATLAB_NATIVE_CANVAS_EXTENT_EXPERIMENT_FAILED=%s: %s\n", ...
        errorRecord.identifier, errorRecord.message);
end
fprintf("MATLAB_NATIVE_PDF_PAGE_PROBE_JSON=%s\n", reportPath);
fprintf("MATLAB_NATIVE_PDF_PAGE_PROBE_EXPORTED=%d\n", report.summary.exports_succeeded);
fprintf("MATLAB_NATIVE_PDF_PAGE_PROBE_EXACT_PAGE_VERIFIED=false\n");
fprintf("MATLAB_NATIVE_PDF_PAGE_PROBE_FONT_EMBEDDING_VERIFIED=false\n");
assert(all(statuses == "exported"), "test_native_pdf_page_probe:ExportIncomplete", ...
    "Native export probe incomplete; independent evidence is preserved in %s", reportPath);
end

function experiment = run_canvas_extent_experiment(outputDirectory, fontAvailable, ...
        exportAvailable, fontName, titleText, yLabelText)
experimentDirectory = fullfile(outputDirectory, "canvas-extent-experiment");
[created, message] = mkdir(experimentDirectory);
assert(created, "test_native_pdf_page_probe:CanvasDirectory", "%s", message);
insets = [0 3];
artifactTemplate = struct("file", "", "status", "not_attempted", ...
    "requested_api", "", "export_api", "", "api_invoked", false, ...
    "export_call_succeeded", false, "export_object_class", "", ...
    "file_exists", false, "bytes", 0, "sha256", "", ...
    "pdf_header_present", false, "media_box_literals", zeros(0, 4), ...
    "crop_box_literals", zeros(0, 4), "png_pixels", [], ...
    "inspection_status", "pending", "inspection_error", "", ...
    "error_identifier", "", "error_message", "");
candidateTemplate = struct("id", "", "status", "pending", "skip_reason", "", ...
    "inset_points", 0, "requested_rectangle_points", [], ...
    "setup_status", "pending", "error_identifier", "", "error_message", "", ...
    "geometry_before_pdf", struct(), "geometry_after_pdf", struct(), ...
    "geometry_after_png", struct(), "pdf", artifactTemplate, "png", artifactTemplate);
experiment = struct("schema_version", 1, "status", "running", ...
    "generated_at", utc_timestamp(), "release", "R" + string(version('-release')), ...
    "counts_toward_stage", false, "directory", "canvas-extent-experiment", ...
    "report_file", "canvas-extent-experiment/canvas-extent-experiment.json", ...
    "artifact_paths_relative_to", "experiment_directory", ...
    "scope", "native canvas extent diagnostic; not a production export strategy", ...
    "background_role", "visible white rectangle face, not data or hidden text", ...
    "target_page_points", [576 360], "target_page_inches", [8 5], ...
    "font_name", fontName, "font_available", fontAvailable, ...
    "exportgraphics_available", exportAvailable, ...
    "screen_pixels_per_inch", get(groot, "ScreenPixelsPerInch"), ...
    "expected_text", [titleText yLabelText "Time (h)" "Observed 20.125" "Model 21.50"], ...
    "data_source", "same synthetic panel diagnostic as panel-fullpage", ...
    "export_order", ["exportgraphics(panel) PDF first" "print(figure) PNG second"], ...
    "pdf_options", struct("ContentType", "vector", "BackgroundColor", "white"), ...
    "png_options", struct("device", "-dpng", "resolution", 300), ...
    "verification_scope", "native calls, raw files, geometry snapshots and hash only", ...
    "geometry_read_scope", "literal PDF dictionary scan, not a full PDF parser", ...
    "font_name_evidence", "graphics properties, not rendered font identity", ...
    "external_inspection_status", "pending", "exact_page_verified", false, ...
    "font_embedding_verified", false, "cjk_visual_verified", false, ...
    "text_extraction_verified", false, "layout_verified", false, ...
    "api_documentation", [ ...
        "https://www.mathworks.com/help/releases/R2021a/matlab/ref/exportgraphics.html" ...
        "https://www.mathworks.com/help/releases/R2021a/matlab/ref/rectangle.html" ...
        "https://www.mathworks.com/help/releases/R2021a/matlab/ref/matlab.graphics.axis.axes-properties.html"]);
experiment.candidates = repmat(candidateTemplate, numel(insets), 1);
for candidateIndex = 1:numel(insets)
    record = candidateTemplate;
    record.id = "panel-canvas-inset-" + string(insets(candidateIndex)) + "pt";
    record.inset_points = insets(candidateIndex);
    record.requested_rectangle_points = [record.inset_points record.inset_points ...
        576 - 2 * record.inset_points 360 - 2 * record.inset_points];
    record.pdf.file = record.id + "/native.pdf";
    record.pdf.requested_api = "exportgraphics(panel, ContentType=vector)";
    record.png.file = record.id + "/native-reference.png";
    record.png.requested_api = "print(figure, -dpng, -r300)";
    experiment.candidates(candidateIndex) = record;
end
experimentPath = fullfile(experimentDirectory, "canvas-extent-experiment.json");
write_report(experimentPath, experiment);
for candidateIndex = 1:numel(insets)
    record = experiment.candidates(candidateIndex);
    if ~fontAvailable || ~exportAvailable
        record.status = "skipped";
        record.skip_reason = "exportgraphics_unavailable";
        if ~fontAvailable
            record.skip_reason = "wenquanyi_not_confirmed_available";
        end
        record.pdf.status = "skipped";
        record.png.status = "skipped";
    else
        record = export_canvas_candidate(experimentDirectory, record, fontName, titleText, yLabelText);
    end
    experiment.candidates(candidateIndex) = record;
    write_report(experimentPath, experiment);
    fprintf("MATLAB_NATIVE_CANVAS_EXTENT_CANDIDATE=%s STATUS=%s PDF=%s PNG=%s\n", ...
        record.id, record.status, record.pdf.status, record.png.status);
    if record.status ~= "export_pair_completed"
        fprintf(2, "MATLAB_NATIVE_CANVAS_EXTENT_CANDIDATE_INCOMPLETE=%s\n", jsonencode(record));
    end
end
statuses = [experiment.candidates.status];
experiment.summary = struct("candidate_count", numel(insets), ...
    "export_pairs_completed", sum(statuses == "export_pair_completed"), ...
    "failed", sum(statuses == "failed"), "skipped", sum(statuses == "skipped"));
experiment.status = "completed_diagnostics_only";
if any(statuses ~= "export_pair_completed")
    experiment.status = "incomplete";
end
experiment.completed_at = utc_timestamp();
write_report(experimentPath, experiment);
fprintf("MATLAB_NATIVE_CANVAS_EXTENT_EXPERIMENT_JSON=%s\n", experimentPath);
fprintf("MATLAB_NATIVE_CANVAS_EXTENT_EXPERIMENT_COUNTS_TOWARD_STAGE=false\n");
end

function record = export_canvas_candidate(outputDirectory, record, fontName, titleText, yLabelText)
figureHandle = gobjects(0);
panelHandle = gobjects(0);
axesHandle = gobjects(0);
backgroundAxes = gobjects(0);
rectangleHandle = gobjects(0);
candidateDirectory = fullfile(outputDirectory, record.id);
recordPath = fullfile(candidateDirectory, "candidate.json");
try
    [created, message] = mkdir(candidateDirectory);
    assert(created, "test_native_pdf_page_probe:CanvasCandidateDirectory", "%s", message);
    write_report(recordPath, record);
    figureHandle = figure("Visible", "off", "WindowStyle", "normal", "Color", "white", ...
        "Units", "inches", "Position", [1 1 8 5], ...
        "PaperUnits", "inches", "PaperSize", [8 5], ...
        "PaperPosition", [0 0 8 5], "PaperPositionMode", "manual", ...
        "DefaultAxesFontName", fontName, "DefaultTextFontName", fontName, ...
        "DefaultAxesFontUnits", "points", "DefaultTextFontUnits", "points", ...
        "DefaultTextInterpreter", "none");
    figureCleanup = onCleanup(@() close_if_valid(figureHandle));
    panelHandle = uipanel("Parent", figureHandle, "Units", "inches", ...
        "Position", [0 0 8 5], "BorderType", "none", "BackgroundColor", "white", ...
        "FontName", fontName, "FontUnits", "points", "Tag", "canvas-panel");
    backgroundAxes = axes("Parent", panelHandle, "Units", "inches", ...
        "PositionConstraint", "innerposition", "Position", [0 0 8 5], ...
        "XLim", [0 576], "YLim", [0 360], "XTick", [], "YTick", [], ...
        "XColor", "none", "YColor", "none", "Color", "none", "Box", "off", ...
        "Visible", "on", "NextPlot", "add", "Tag", "canvas-background-axes");
    rectangleHandle = rectangle(backgroundAxes, "Position", record.requested_rectangle_points, ...
        "FaceColor", "white", "EdgeColor", "none", "LineStyle", "none", ...
        "Visible", "on", "Clipping", "on", "Tag", "canvas-background-face");
    axesHandle = axes("Parent", panelHandle, "Units", "inches", ...
        "PositionConstraint", "outerposition", "OuterPosition", [0 0 8 5], ...
        "Tag", "synthetic-data-axes");
    populate_axes(axesHandle, fontName, titleText, yLabelText);
    uistack(backgroundAxes, "bottom");
    drawnow;
    record.setup_status = "created";
catch errorRecord
    record.setup_status = "failed";
    record.error_identifier = string(errorRecord.identifier);
    record.error_message = string(errorRecord.message);
end
record.geometry_before_pdf = canvas_geometry(figureHandle, panelHandle, axesHandle, ...
    backgroundAxes, rectangleHandle);
if record.setup_status == "created"
    write_report(recordPath, record);
    record.pdf = export_canvas_artifact(outputDirectory, record.pdf, panelHandle, "pdf");
    record.geometry_after_pdf = canvas_geometry(figureHandle, panelHandle, axesHandle, ...
        backgroundAxes, rectangleHandle);
    write_report(recordPath, record);
    record.png = export_canvas_artifact(outputDirectory, record.png, figureHandle, "png");
    record.geometry_after_png = canvas_geometry(figureHandle, panelHandle, axesHandle, ...
        backgroundAxes, rectangleHandle);
else
    record.pdf.status = "not_attempted_setup_failed";
    record.png.status = "not_attempted_setup_failed";
end
record.status = "failed";
if record.pdf.status == "exported" && record.png.status == "exported" ...
        && record.geometry_before_pdf.status == "captured" ...
        && record.geometry_after_pdf.status == "captured" ...
        && record.geometry_after_png.status == "captured"
    record.status = "export_pair_completed";
end
if isfolder(candidateDirectory)
    write_report(recordPath, record);
end
end

function artifact = export_canvas_artifact(outputDirectory, artifact, targetHandle, format)
filePath = fullfile(outputDirectory, artifact.file);
artifact.export_object_class = string(class(targetHandle));
try
    if format == "pdf"
        artifact.export_api = "exportgraphics";
        artifact.api_invoked = true;
        exportgraphics(targetHandle, filePath, "ContentType", "vector", "BackgroundColor", "white");
    else
        artifact.export_api = "print";
        artifact.api_invoked = true;
        print(targetHandle, filePath, "-dpng", "-r300");
    end
    artifact.export_call_succeeded = true;
catch errorRecord
    artifact.error_identifier = string(errorRecord.identifier);
    artifact.error_message = string(errorRecord.message);
end
artifact.file_exists = isfile(filePath);
try
    if artifact.file_exists
        fileInformation = dir(filePath);
        artifact.bytes = fileInformation.bytes;
        artifact.sha256 = string(oi_sha256_file(filePath));
        if format == "pdf"
            [artifact.pdf_header_present, artifact.media_box_literals, artifact.crop_box_literals] = ...
                inspect_pdf_literals(filePath);
            artifact.inspection_status = "literal_values_only_external_check_required";
            if isempty(artifact.media_box_literals)
                artifact.inspection_status = "no_literal_mediabox_external_check_required";
            end
        else
            imageInformation = imfinfo(filePath);
            artifact.png_pixels = [imageInformation.Width imageInformation.Height];
            artifact.inspection_status = "png_header_only_visual_check_required";
        end
    else
        artifact.inspection_status = "file_missing";
    end
catch errorRecord
    artifact.inspection_status = "read_failed_external_check_required";
    artifact.inspection_error = string(errorRecord.identifier) + ": " + string(errorRecord.message);
end
artifact.status = "failed";
if artifact.export_call_succeeded && artifact.bytes > 0 && strlength(artifact.sha256) == 64 ...
        && strlength(artifact.inspection_error) == 0 ...
        && ((format == "pdf" && artifact.pdf_header_present) ...
        || (format == "png" && numel(artifact.png_pixels) == 2))
    artifact.status = "exported";
elseif strlength(artifact.error_message) == 0
    artifact.error_identifier = "test_native_pdf_page_probe:CanvasArtifactIncomplete";
    artifact.error_message = "Raw artifact evidence incomplete; inspect status and inspection_error";
end
end

function snapshot = canvas_geometry(figureHandle, panelHandle, axesHandle, backgroundAxes, rectangleHandle)
snapshot = struct("status", "pending", "figure", struct(), "panel", struct(), ...
    "data_axes", struct(), "background_axes", struct(), "rectangle", struct(), ...
    "rectangle_panel_points", [], "panel_children_front_to_back", strings(0, 1), ...
    "fonts", struct([]), "error_identifier", "", "error_message", "");
try
    snapshot.figure = graphics_properties(figureHandle, ["Units" "Position" "PaperUnits" ...
        "PaperSize" "PaperPosition" "PaperPositionMode" "PaperOrientation" ...
        "Renderer" "RendererMode" "InvertHardcopy" "Color"]);
    snapshot.panel = graphics_properties(panelHandle, ...
        ["Units" "Position" "InnerPosition" "BorderType" "BackgroundColor" "Visible"]);
    axesProperties = ["Units" "Position" "OuterPosition" "TightInset" "PositionConstraint" ...
        "XLim" "YLim" "XLimMode" "YLimMode" "XDir" "YDir" "XScale" "YScale" ...
        "DataAspectRatio" "DataAspectRatioMode" "PlotBoxAspectRatio" "PlotBoxAspectRatioMode" ...
        "XTick" "YTick" "XColor" "YColor" "Color" "Visible" "Clipping"];
    snapshot.data_axes = graphics_properties(axesHandle, axesProperties);
    snapshot.background_axes = graphics_properties(backgroundAxes, axesProperties);
    snapshot.rectangle = graphics_properties(rectangleHandle, ...
        ["Position" "FaceColor" "EdgeColor" "LineStyle" "LineWidth" "Visible" "Clipping"]);
    axesPosition = get(backgroundAxes, "Position") * 72;
    limitsX = get(backgroundAxes, "XLim");
    limitsY = get(backgroundAxes, "YLim");
    rectanglePosition = get(rectangleHandle, "Position");
    scale = axesPosition(3:4) ./ [diff(limitsX) diff(limitsY)];
    snapshot.rectangle_panel_points = [axesPosition(1:2) ...
        + (rectanglePosition(1:2) - [limitsX(1) limitsY(1)]) .* scale ...
        rectanglePosition(3:4) .* scale];
    children = get(panelHandle, "Children");
    for childIndex = 1:numel(children)
        snapshot.panel_children_front_to_back(childIndex, 1) = ...
            string(class(children(childIndex))) + ":" + string(get(children(childIndex), "Tag"));
    end
    fontObjects = findall(figureHandle, "-property", "FontName");
    for fontIndex = 1:numel(fontObjects)
        snapshot.fonts(fontIndex, 1) = graphics_properties(fontObjects(fontIndex), ...
            ["FontName" "FontSize" "FontUnits" "FontWeight" "FontAngle" ...
            "String" "Units" "Position" "Extent" "Visible" "Interpreter"]);
    end
    snapshot.status = "captured";
catch errorRecord
    snapshot.status = "capture_failed";
    snapshot.error_identifier = string(errorRecord.identifier);
    snapshot.error_message = string(errorRecord.message);
end
end

function record = graphics_properties(objectHandle, propertyNames)
record = struct("class", string(class(objectHandle)), "properties", struct(), ...
    "unavailable_properties", strings(0, 1));
assert(isscalar(objectHandle) && isgraphics(objectHandle), ...
    "test_native_pdf_page_probe:CanvasGeometryHandle", "Graphics object was not created or was deleted");
for propertyName = propertyNames
    if isprop(objectHandle, propertyName)
        value = get(objectHandle, propertyName);
        if isa(value, "matlab.lang.OnOffSwitchState")
            value = string(value);
        end
        record.properties.(char(propertyName)) = value;
    else
        record.unavailable_properties(end + 1, 1) = propertyName;
    end
end
end

function record = export_candidate(outputDirectory, record, fontName, titleText, yLabelText)
filePath = fullfile(outputDirectory, record.file);
try
    figureHandle = figure("Visible", "off", "WindowStyle", "normal", "Color", "white", ...
        "Units", "inches", "Position", [1 1 8 5], ...
        "PaperUnits", "inches", "PaperSize", [8 5], ...
        "PaperPosition", [0 0 8 5], "PaperPositionMode", "manual", ...
        "DefaultAxesFontName", fontName, "DefaultTextFontName", fontName, ...
        "DefaultTextInterpreter", "none");
    figureCleanup = onCleanup(@() close_if_valid(figureHandle));
    switch record.id
        case "axes-outerposition"
            axesHandle = axes("Parent", figureHandle, "Units", "inches", ...
                "PositionConstraint", "outerposition", "OuterPosition", [0 0 8 5]);
            targetHandle = axesHandle;
        case "tiledlayout-loose"
            targetHandle = tiledlayout(figureHandle, 1, 1, ...
                "Padding", "loose", "TileSpacing", "loose");
            set(targetHandle, "Units", "inches", ...
                "PositionConstraint", "outerposition", "OuterPosition", [0 0 8 5]);
            axesHandle = nexttile(targetHandle);
        case "panel-fullpage"
            targetHandle = uipanel("Parent", figureHandle, "Units", "inches", ...
                "Position", [0 0 8 5], "BorderType", "none", ...
                "BackgroundColor", "white", "FontName", fontName);
            axesHandle = axes("Parent", targetHandle, "Units", "inches", ...
                "PositionConstraint", "outerposition", "OuterPosition", [0 0 8 5]);
        otherwise
            error("test_native_pdf_page_probe:Candidate", "Unknown candidate: %s", record.id);
    end
    populate_axes(axesHandle, fontName, titleText, yLabelText);
    drawnow;
    figurePosition = get(figureHandle, "Position");
    record.figure_inches = figurePosition(3:4);
    record.paper_size_inches = get(figureHandle, "PaperSize");
    record.paper_position_inches = get(figureHandle, "PaperPosition");
    record.export_object_class = string(class(targetHandle));
    record.target_position_inches = get(targetHandle, "Position");
    if record.id ~= "panel-fullpage"
        record.target_outer_position_inches = get(targetHandle, "OuterPosition");
        record.target_position_constraint = string(get(targetHandle, "PositionConstraint"));
    else
        record.panel_border_type = string(get(targetHandle, "BorderType"));
    end
    if record.id == "tiledlayout-loose"
        record.layout_padding = string(get(targetHandle, "Padding"));
        record.tile_spacing = string(get(targetHandle, "TileSpacing"));
    end
    record.axes_position_inches = get(axesHandle, "Position");
    record.axes_tight_inset_inches = get(axesHandle, "TightInset");
    fontObjects = findall(figureHandle, "-property", "FontName");
    record.graphics_font_names = sort(unique(string(get(fontObjects, "FontName"))));
    record.export_api = "exportgraphics";
    record.export_device = "pdf";
    record.api_invoked = true;
    exportgraphics(targetHandle, filePath, "ContentType", "vector", "BackgroundColor", "white");
    record.export_call_succeeded = true;
catch errorRecord
    record.error_identifier = string(errorRecord.identifier);
    record.error_message = string(errorRecord.message);
end
record.file_exists = isfile(filePath);
try
    if record.file_exists
        information = dir(filePath);
        record.bytes = information.bytes;
        if record.bytes > 0
            record.sha256 = string(oi_sha256_file(filePath));
        end
    end
catch errorRecord
    if strlength(record.error_message) == 0
        record.error_identifier = string(errorRecord.identifier);
        record.error_message = string(errorRecord.message);
    end
end
if record.bytes > 0
    try
        [record.pdf_header_present, record.media_box_literals, record.crop_box_literals] = ...
            inspect_pdf_literals(filePath);
        record.geometry_status = "literal_values_only_external_check_required";
        if isempty(record.media_box_literals)
            record.geometry_status = "no_literal_mediabox_external_check_required";
        end
    catch errorRecord
        record.geometry_status = "read_failed_external_check_required";
        record.geometry_error = string(errorRecord.identifier) + ": " + string(errorRecord.message);
    end
end
if record.export_call_succeeded && record.pdf_header_present ...
        && record.bytes > 0 && strlength(record.sha256) == 64
    record.status = "exported";
else
    record.status = "failed";
    if strlength(record.error_message) == 0
        record.error_identifier = "test_native_pdf_page_probe:MissingArtifactEvidence";
        record.error_message = "Native export needs a nonempty PDF header and SHA-256 evidence";
    end
end
end

function populate_axes(axesHandle, fontName, titleText, yLabelText)
set(axesHandle, "Units", "inches", "NextPlot", "add", "Color", "white", ...
    "XColor", "black", "YColor", "black", "FontName", fontName, "FontSize", 11, ...
    "TickLabelInterpreter", "none", "XLim", [0 5], "YLim", [19 23], ...
    "XTick", 0:5, "YTick", 19:23, "Box", "on");
timeValues = 0:5;
observed = [20.125 21.50 22.25 20.75 19.50 20.0];
model = [20.50 21.25 22.0 21.0 19.75 20.25];
lineOne = plot(axesHandle, timeValues, observed, "-o", ...
    "Color", [0 0.447 0.698], "LineWidth", 1, "DisplayName", "Observed 20.125");
lineTwo = plot(axesHandle, timeValues, model, "--s", ...
    "Color", [0.835 0.369 0], "LineWidth", 1, "DisplayName", "Model 21.50");
title(axesHandle, titleText, "FontName", fontName, "FontSize", 14, ...
    "FontWeight", "normal", "Interpreter", "none");
xlabel(axesHandle, "Time (h)", "FontName", fontName, "Interpreter", "none");
ylabel(axesHandle, yLabelText, "FontName", fontName, "Interpreter", "none");
legend(axesHandle, [lineOne lineTwo], "Location", "northeast", ...
    "FontName", fontName, "FontSize", 10, "Interpreter", "none");
end

function [headerPresent, mediaBoxes, cropBoxes] = inspect_pdf_literals(filePath)
fileHandle = fopen(filePath, "rb");
assert(fileHandle >= 0, "test_native_pdf_page_probe:ReadPDF", "Cannot read %s", filePath);
fileCleanup = onCleanup(@() fclose(fileHandle));
pdfText = char(fread(fileHandle, Inf, "*uint8")');
headerPresent = startsWith(pdfText, "%PDF-");
mediaBoxes = box_literals(pdfText, "MediaBox");
cropBoxes = box_literals(pdfText, "CropBox");
end

function boxes = box_literals(pdfText, boxName)
number = "([-+]?(?:\d+\.?\d*|\.\d+))";
pattern = "/" + boxName + "\s*\[\s*" + number + "\s+" + number ...
    + "\s+" + number + "\s+" + number + "\s*\]";
tokens = regexp(pdfText, pattern, "tokens");
boxes = zeros(numel(tokens), 4);
for tokenIndex = 1:numel(tokens)
    boxes(tokenIndex, :) = str2double(tokens{tokenIndex});
end
end

function write_report(filePath, report)
encoded = unicode2native(jsonencode(report), "UTF-8");
fileHandle = fopen(filePath, "wb");
assert(fileHandle >= 0, "test_native_pdf_page_probe:Write", "Cannot write %s", filePath);
fileCleanup = onCleanup(@() fclose(fileHandle));
written = fwrite(fileHandle, encoded, "uint8");
assert(written == numel(encoded), "test_native_pdf_page_probe:Write", "Incomplete JSON write");
end

function value = utc_timestamp()
value = string(datetime("now", "TimeZone", "UTC", "Format", "yyyy-MM-dd'T'HH:mm:ss'Z'"));
end

function close_if_valid(figureHandle)
if isgraphics(figureHandle, "figure")
    close(figureHandle);
end
end
