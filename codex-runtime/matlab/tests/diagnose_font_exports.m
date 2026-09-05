function report = diagnose_font_exports(outputDirectory)
%DIAGNOSE_FONT_EXPORTS Compare independent font exports without quality claims.
% Each backend receives a fresh figure. Success verifies only the export
% call, nonempty file, byte count, and SHA-256, never glyphs or embedding.
arguments
    outputDirectory (1,1) string
end
assert(~ismissing(outputDirectory) && strlength(strtrim(outputDirectory)) > 0, ...
    "diagnose_font_exports:OutputDirectory", "An output directory is required");
assert(~isfolder(outputDirectory) && ~isfile(outputDirectory), ...
    "diagnose_font_exports:FreshOutput", "Refusing to reuse %s", outputDirectory);
[created, message] = mkdir(outputDirectory);
assert(created, "diagnose_font_exports:CreateDirectory", "%s", message);
originalPath = path;
pathCleanup = onCleanup(@() path(originalPath));
addpath(fullfile(fileparts(fileparts(mfilename("fullpath"))), "assets"));

fontNames = ["Noto Sans CJK SC", "WenQuanYi Zen Hei", ...
    "Droid Sans Fallback", "DejaVu Sans", "Liberation Sans"];
fontIds = ["noto-sans-cjk-sc", "wenquanyi-zen-hei", ...
    "droid-sans-fallback", "dejavu-sans", "liberation-sans"];
release = "R" + string(version('-release'));
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
titleText = string(native2unicode(uint8([229 141 151 230 181 183 ...
    230 181 183 232 161 168 230 184 169 229 186 166]), "UTF-8"));
report = struct("schema_version", 1, "status", "running", ...
    "generated_at", utc_timestamp(), "release", release, ...
    "matlab_version", string(version), ...
    "screen_pixels_per_inch", get(groot, "ScreenPixelsPerInch"), ...
    "exportgraphics_path", string(which("exportgraphics")), ...
    "exportgraphics_file_type", exportFileType, ...
    "exportgraphics_available", exportAvailable, ...
    "listfonts_error", fontListError, "figure_inches", [6 4], ...
    "print_png_dpi", 150, "title", titleText, ...
    "data_source", "synthetic font diagnostic, not observations", ...
    "verification_scope", "export completion, nonempty files, bytes, SHA-256 only", ...
    "font_name_evidence", "graphics FontName properties, not rendered font identity", ...
    "pdf_exact_page_size_required", false, ...
    "font_embedding_verified", false, "cjk_visual_verified", false, ...
    "font_rendering_verified", false, "layout_verified", false);
fontTemplate = struct("font_name", "", "release", release, ...
    "font_available", false, "listfonts_match", false, ...
    "availability_method", "", "status", "pending", "skip_reason", "", ...
    "error_identifier", "", "error_message", "", "exports", struct([]));
report.fonts = repmat(fontTemplate, numel(fontNames), 1);
for fontIndex = 1:numel(fontNames)
    report.fonts(fontIndex).font_name = fontNames(fontIndex);
    report.fonts(fontIndex).exports = export_records(fontIds(fontIndex), ...
        fontNames(fontIndex), release);
end
reportPath = fullfile(outputDirectory, "font-export-probe.json");
write_report(reportPath, report);

for fontIndex = 1:numel(fontNames)
    fontRecord = report.fonts(fontIndex);
    try
        fontRecord.listfonts_match = any(strcmpi(installedFonts(:), fontRecord.font_name));
        fontRecord.font_available = oi_font_available(fontRecord.font_name, installedFonts);
        fontRecord.availability_method = "listfonts then Unix fontconfig exact families";
        if fontRecord.font_available
            fontRecord.status = "running";
        else
            fontRecord.status = "skipped";
            fontRecord.skip_reason = "font_not_confirmed_available";
        end
    catch errorRecord
        fontRecord.status = "failed";
        fontRecord.error_identifier = string(errorRecord.identifier);
        fontRecord.error_message = string(errorRecord.message);
        fontRecord.skip_reason = "font_availability_check_failed";
    end
    report.fonts(fontIndex) = fontRecord;
    for exportIndex = 1:numel(fontRecord.exports)
        record = fontRecord.exports(exportIndex);
        record.font_available = fontRecord.font_available;
        if ~fontRecord.font_available
            record.status = "skipped";
            record.skip_reason = fontRecord.skip_reason;
        elseif record.requested_api == "exportgraphics" && ~exportAvailable
            record.status = "skipped";
            record.skip_reason = "exportgraphics_unavailable";
        else
            record = export_one(outputDirectory, record, titleText);
        end
        report.fonts(fontIndex).exports(exportIndex) = record;
        write_report(reportPath, report);
    end
    if fontRecord.font_available
        statuses = [report.fonts(fontIndex).exports.status];
        if any(statuses == "failed")
            report.fonts(fontIndex).status = "failed";
        elseif any(statuses == "skipped")
            report.fonts(fontIndex).status = "completed_with_skips";
        else
            report.fonts(fontIndex).status = "exported";
        end
    end
    write_report(reportPath, report);
end

exports = vertcat(report.fonts.exports);
statuses = [exports.status];
report.summary = struct("candidate_count", numel(fontNames), ...
    "fonts_available", sum([report.fonts.font_available]), ...
    "fonts_skipped", sum([report.fonts.status] == "skipped"), ...
    "fonts_failed", sum([report.fonts.status] == "failed"), ...
    "exports_succeeded", sum(statuses == "exported"), ...
    "exports_failed", sum(statuses == "failed"), ...
    "exports_skipped", sum(statuses == "skipped"));
report.status = "completed";
if report.summary.fonts_failed > 0 || report.summary.fonts_available == 0
    report.status = "completed_with_failures";
end
report.completed_at = utc_timestamp();
write_report(reportPath, report);
fprintf("MATLAB_FONT_EXPORT_PROBE_JSON=%s\n", reportPath);
fprintf("MATLAB_FONT_EXPORT_PROBE_EXPORTED=%d\n", report.summary.exports_succeeded);
fprintf("MATLAB_FONT_EXPORT_PROBE_FAILED=%d\n", report.summary.exports_failed);
fprintf("MATLAB_FONT_EXPORT_PROBE_VISUAL_VERIFIED=false\n");
assert(report.summary.fonts_available > 0 && report.summary.fonts_failed == 0, ...
    "diagnose_font_exports:ExportFailures", ...
    "Font probe incomplete or failed; independent results are preserved in %s", reportPath);
end

function records = export_records(fontId, fontName, release)
template = struct("id", "", "font_name", fontName, "release", release, ...
    "font_available", false, "requested_api", "", "requested_device", "", ...
    "export_api", "", "export_device", "", "content_type", "", ...
    "status", "pending", "skip_reason", "", "file", "", ...
    "api_invoked", false, "export_call_succeeded", false, ...
    "file_exists", false, "bytes", 0, "sha256", "", ...
    "graphics_font_names", strings(0, 1), ...
    "figure_inches", [], "paper_size_inches", [], "paper_position_inches", [], ...
    "paper_position_mode", "", "figure_renderer_before_export", "", ...
    "figure_renderer_mode_before_export", "", ...
    "font_embedding_verified", false, "cjk_visual_verified", false, ...
    "font_rendering_verified", false, "layout_verified", false, ...
    "error_identifier", "", "error_message", "");
ids = ["print-painters-pdf", "exportgraphics-vector-pdf", "print-png"];
apis = ["print", "exportgraphics", "print"];
devices = ["-dpdf -painters", "", "-dpng -r150"];
extensions = [".pdf", ".pdf", ".png"];
if fontName == "WenQuanYi Zen Hei"
    ids(end + 1) = "print-default-pdf";
    apis(end + 1) = "print";
    devices(end + 1) = "-dpdf";
    extensions(end + 1) = ".pdf";
end
records = repmat(template, numel(ids), 1);
for exportIndex = 1:numel(ids)
    records(exportIndex).id = ids(exportIndex);
    records(exportIndex).requested_api = apis(exportIndex);
    records(exportIndex).requested_device = devices(exportIndex);
    records(exportIndex).file = fontId + "-" + ids(exportIndex) + extensions(exportIndex);
end
end

function record = export_one(outputDirectory, record, titleText)
filePath = fullfile(outputDirectory, record.file);
try
    figureHandle = figure("Visible", "off", "Color", "white", ...
        "Units", "inches", "Position", [1 1 6 4], ...
        "PaperUnits", "inches", "PaperSize", [6 4], ...
        "PaperPosition", [0 0 6 4], "PaperPositionMode", "manual", ...
        "InvertHardcopy", "off", "RendererMode", "auto", ...
        "DefaultAxesFontName", record.font_name, ...
        "DefaultTextFontName", record.font_name, "DefaultTextInterpreter", "none");
    cleanupFigure = onCleanup(@() close_if_valid(figureHandle));
    populate_figure(figureHandle, record.font_name, titleText);
    drawnow;
    figurePosition = get(figureHandle, "Position");
    record.figure_inches = figurePosition(3:4);
    record.paper_size_inches = get(figureHandle, "PaperSize");
    record.paper_position_inches = get(figureHandle, "PaperPosition");
    record.paper_position_mode = string(get(figureHandle, "PaperPositionMode"));
    record.figure_renderer_before_export = string(get(figureHandle, "Renderer"));
    record.figure_renderer_mode_before_export = string(get(figureHandle, "RendererMode"));
    fontObjects = findall(figureHandle, "-property", "FontName");
    record.graphics_font_names = sort(unique(string(get(fontObjects, "FontName"))));
    assert(all(strcmpi(record.graphics_font_names, record.font_name)), ...
        "diagnose_font_exports:FontAssignment", "Graphics FontName properties changed");
    record.export_api = record.requested_api;
    record.export_device = record.requested_device;
    record.api_invoked = true;
    switch record.id
        case "print-painters-pdf"
            print(figureHandle, char(filePath), "-dpdf", "-painters");
        case "print-default-pdf"
            print(figureHandle, char(filePath), "-dpdf");
        case "exportgraphics-vector-pdf"
            record.content_type = "vector";
            exportgraphics(figureHandle, filePath, ...
                "ContentType", "vector", "BackgroundColor", "white");
        case "print-png"
            print(figureHandle, char(filePath), "-dpng", "-r150");
    end
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
if record.export_call_succeeded && record.bytes > 0 && strlength(record.sha256) == 64
    record.status = "exported";
else
    record.status = "failed";
    if strlength(record.error_message) == 0
        record.error_identifier = "diagnose_font_exports:MissingArtifactEvidence";
        record.error_message = "Export did not produce a nonempty file with a SHA-256 digest";
    end
end
end

function populate_figure(figureHandle, fontName, titleText)
axesHandle = axes("Parent", figureHandle, "Units", "normalized", ...
    "Position", [0.14 0.30 0.80 0.56], "NextPlot", "add", ...
    "FontName", fontName, "FontSize", 11, "TickLabelInterpreter", "none", ...
    "XLim", [0 5], "YLim", [19 23], "XTick", 0:5, "YTick", 19:23, "Box", "on");
timeValues = 0:5;
observed = [20.125 21.50 22.25 20.75 19.50 20.0];
model = [20.50 21.25 22.0 21.0 19.75 20.25];
lineOne = plot(axesHandle, timeValues, observed, "-o", ...
    "Color", [0 0.447 0.698], "DisplayName", "Observed 20.125", "LineWidth", 1);
lineTwo = plot(axesHandle, timeValues, model, "--s", ...
    "Color", [0.835 0.369 0], "DisplayName", "Model 21.50", "LineWidth", 1);
title(axesHandle, titleText, "FontName", fontName, "FontSize", 14, ...
    "FontWeight", "normal", "Interpreter", "none");
xlabel(axesHandle, "Time (h)", "FontName", fontName, "FontSize", 11, "Interpreter", "none");
ylabel(axesHandle, "Temperature (degC)", "FontName", fontName, ...
    "FontSize", 11, "Interpreter", "none");
legend(axesHandle, [lineOne lineTwo], "Location", "southoutside", ...
    "Orientation", "horizontal", "FontName", fontName, "FontSize", 10, "Interpreter", "none");
end

function write_report(filePath, report)
encoded = unicode2native(jsonencode(report), "UTF-8");
fileHandle = fopen(filePath, "wb");
assert(fileHandle >= 0, "diagnose_font_exports:Write", "Cannot write %s", filePath);
cleanup = onCleanup(@() fclose(fileHandle));
written = fwrite(fileHandle, encoded, "uint8");
assert(written == numel(encoded), "diagnose_font_exports:Write", "Incomplete JSON write");
end

function value = utc_timestamp()
value = string(datetime("now", "TimeZone", "UTC", "Format", "yyyy-MM-dd'T'HH:mm:ss'Z'"));
end

function close_if_valid(figureHandle)
if isgraphics(figureHandle, "figure")
    close(figureHandle);
end
end
