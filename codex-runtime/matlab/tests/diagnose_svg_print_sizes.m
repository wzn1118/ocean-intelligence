function report = diagnose_svg_print_sizes(outputDirectory)
%DIAGNOSE_SVG_PRINT_SIZES Compare native painters SVG with and without -r.
% Raw SVG files are never annotated, normalized, or rewritten after print.
arguments
    outputDirectory (1,1) string
end
assert(~ismissing(outputDirectory) && strlength(strtrim(outputDirectory)) > 0, ...
    "diagnose_svg_print_sizes:OutputDirectory", "An output directory is required");
assert(~isfolder(outputDirectory) && ~isfile(outputDirectory), ...
    "diagnose_svg_print_sizes:FreshOutput", "Refusing to reuse %s", outputDirectory);
[created, message] = mkdir(outputDirectory);
assert(created, "diagnose_svg_print_sizes:CreateDirectory", "%s", message);
originalPath = path;
pathCleanup = onCleanup(@() path(originalPath));
addpath(fullfile(fileparts(fileparts(mfilename("fullpath"))), "assets"));

report = struct("schema_version", 1, "status", "running", ...
    "started_at", utc_timestamp(), "release", "R" + string(version('-release')), ...
    "matlab_version", string(version), "display", string(getenv("DISPLAY")), ...
    "screen_pixels_per_inch", get(groot, "ScreenPixelsPerInch"), ...
    "jvm_available", logical(usejava("jvm")), ...
    "print_path", string(which("print")), "print_file_type", exist("print", "file"), ...
    "xmlread_path", string(which("xmlread")), ...
    "xmlread_file_type", exist("xmlread", "file"), ...
    "source", struct("description", "Synthetic sizing diagnostic, not observations", ...
        "time_s", [1 2 3], "value", [1 3 2], "title", "Raster sizing", ...
        "xlabel", "Time (s)", "ylabel", "Value (1)"), ...
    "theme", struct(), "font_available", false, ...
    "font_availability_method", "oi_font_available exact installed families", ...
    "font_name_evidence", "Graphics properties, not rendered glyph identity", ...
    "verification_scope", "Native print, XML readability, bytes and unchanged SHA-256 only", ...
    "geometry_scope", "Raw XML attributes; no inferred units, viewBox or path bounds", ...
    "geometry_verified", false, "exact_page_verified", false, "visual_verified", false, ...
    "font_embedding_verified", false, "candidates", candidate_records());
reportPath = fullfile(outputDirectory, "svg-print-sizes.json");
write_report(reportPath, report);
themeError = [];
theme = struct();
try
    theme = oi_ocean_theme();
    report.theme = struct("name", theme.Name, "font_name", theme.FontName, ...
        "font_size", theme.FontSize, "title_size", theme.TitleSize, ...
        "label_size", theme.LabelSize, "canvas_color", theme.CanvasColor, ...
        "axes_color", theme.AxesColor, "line_colors", theme.LineColors);
    report.font_available = oi_font_available(theme.FontName);
catch errorRecord
    themeError = errorRecord;
end
write_report(reportPath, report);
for candidateIndex = 1:numel(report.candidates)
    record = report.candidates(candidateIndex);
    if isempty(themeError)
        record = run_candidate(outputDirectory, record, theme, report.source);
    else
        record = record_error(record, "theme", themeError);
        record.status = "failed";
    end
    report.candidates(candidateIndex) = record;
    write_report(reportPath, report);
end
statuses = [report.candidates.status];
report.summary = struct("candidate_count", numel(statuses), ...
    "export_checks_completed", sum(statuses == "export_checks_completed"), ...
    "failed", sum(statuses == "failed"));
report.status = "exports_completed_pending_external_review";
if report.summary.failed > 0
    report.status = "completed_with_failures";
end
report.completed_at = utc_timestamp();
write_report(reportPath, report);
fprintf("MATLAB_SVG_PRINT_SIZES_JSON=%s\n", reportPath);
fprintf("MATLAB_SVG_PRINT_SIZES_STATUS=%s\n", report.status);
fprintf("MATLAB_SVG_PRINT_SIZES_EXACT_PAGE_VERIFIED=false\n");
fprintf("MATLAB_SVG_PRINT_SIZES_VISUAL_VERIFIED=false\n");
assert(report.summary.failed == 0, "diagnose_svg_print_sizes:IncompleteDiagnostic", ...
    "Native SVG diagnostic failed; all candidate evidence is retained in %s", reportPath);
end

function records = candidate_records()
sizes = [400 300 150; 997 613 300; 1200 675 300];
backends = ["default", "explicit-resolution"];
template = struct("id", "", "backend", "", "file", "", "target", struct(), ...
    "requested_api", "print", "requested_print_options", strings(0, 1), ...
    "export_api", "", "export_device", "", "invoked_print_options", strings(0, 1), ...
    "api_invoked", false, "export_call_succeeded", false, ...
    "status", "pending", "before_print", struct(), "after_print", struct(), ...
    "file_exists", false, "bytes", 0, "sha256", "", "sha256_after_xml", "", ...
    "xml_parse_succeeded", false, "native_svg", struct(), ...
    "native_file_unchanged_after_xml", false, ...
    "exact_page_verified", false, "visual_verified", false, ...
    "errors", struct("phase", {}, "identifier", {}, "message", {}));
records = repmat(template, size(sizes, 1) * numel(backends), 1);
for sizeIndex = 1:size(sizes, 1)
    for backendIndex = 1:numel(backends)
        recordIndex = (sizeIndex - 1) * numel(backends) + backendIndex;
        record = template;
        record.backend = backends(backendIndex);
        record.id = string(sprintf("%dx%d-%ddpi-", sizes(sizeIndex, :))) + record.backend;
        record.file = record.id + ".native.svg";
        record.target = struct("width_pixels", sizes(sizeIndex, 1), ...
            "height_pixels", sizes(sizeIndex, 2), "dpi", sizes(sizeIndex, 3), ...
            "figure_inches", sizes(sizeIndex, 1:2) / sizes(sizeIndex, 3));
        record.requested_print_options = ["-dsvg" "-painters"];
        if record.backend == "explicit-resolution"
            record.requested_print_options(end + 1) = "-r" + string(record.target.dpi);
        end
        records(recordIndex) = record;
    end
end
end

function record = run_candidate(outputDirectory, record, theme, source)
filePath = fullfile(outputDirectory, record.file);
try
    figureHandle = figure("Visible", "off", "WindowStyle", "normal", ...
        "Color", theme.CanvasColor, "Units", "inches", ...
        "Position", [1 1 record.target.figure_inches], ...
        "PaperUnits", "inches", "PaperSize", record.target.figure_inches, ...
        "PaperPosition", [0 0 record.target.figure_inches], "PaperPositionMode", "manual", ...
        "InvertHardcopy", "off", "DefaultAxesColorOrder", theme.LineColors, ...
        "DefaultAxesFontName", theme.FontName, "DefaultAxesFontSize", theme.FontSize, ...
        "DefaultTextFontName", theme.FontName, "DefaultTextFontSize", theme.FontSize, ...
        "DefaultTextFontUnits", "points", "DefaultTextInterpreter", "none");
    figureCleanup = onCleanup(@() close_if_valid(figureHandle));
    axesHandle = axes("Parent", figureHandle, "Units", "normalized", ...
        "PositionConstraint", "outerposition", "OuterPosition", [0.05 0.05 0.9 0.9]);
    plot(axesHandle, source.time_s, source.value);
    xlabel(axesHandle, source.xlabel, "Interpreter", "none");
    ylabel(axesHandle, source.ylabel, "Interpreter", "none");
    title(axesHandle, source.title, "Interpreter", "none");
    oi_apply_axes(axesHandle, theme);
    drawnow;
    record.before_print = graphics_snapshot(figureHandle, axesHandle);
    record.export_api = "print";
    record.export_device = "-dsvg";
    record.api_invoked = true;
    if record.backend == "default"
        record.invoked_print_options = ["-dsvg" "-painters"];
        print(figureHandle, char(filePath), '-dsvg', '-painters');
    else
        resolutionOption = char("-r" + string(record.target.dpi));
        record.invoked_print_options = ["-dsvg" "-painters" string(resolutionOption)];
        print(figureHandle, char(filePath), '-dsvg', '-painters', resolutionOption);
    end
    record.export_call_succeeded = true;
    record.after_print = graphics_snapshot(figureHandle, axesHandle);
catch errorRecord
    record = record_error(record, "figure_or_print", errorRecord);
end
record.file_exists = isfile(filePath);
if record.file_exists
    try
        information = dir(filePath);
        record.bytes = information.bytes;
        record.sha256 = string(oi_sha256_file(filePath));
    catch errorRecord
        record = record_error(record, "artifact_hash", errorRecord);
    end
    try
        record.native_svg = read_native_svg(filePath);
        record.xml_parse_succeeded = true;
    catch errorRecord
        record = record_error(record, "xml_read", errorRecord);
    end
    try
        record.sha256_after_xml = string(oi_sha256_file(filePath));
        information = dir(filePath);
        record.native_file_unchanged_after_xml = strlength(record.sha256) == 64 ...
            && record.sha256 == record.sha256_after_xml && record.bytes == information.bytes;
        assert(record.native_file_unchanged_after_xml, ...
            "diagnose_svg_print_sizes:FileChanged", "Native SVG changed during inspection");
    catch errorRecord
        record = record_error(record, "artifact_integrity", errorRecord);
    end
end
if record.export_call_succeeded && record.bytes > 0 && record.xml_parse_succeeded ...
        && record.native_file_unchanged_after_xml && isempty(record.errors)
    record.status = "export_checks_completed";
else
    record.status = "failed";
    if isempty(record.errors)
        record.errors = struct("phase", "artifact", ...
            "identifier", "diagnose_svg_print_sizes:MissingArtifact", ...
            "message", "Native print did not produce an inspectable nonempty SVG");
    end
end
end

function snapshot = graphics_snapshot(figureHandle, axesHandle)
fontObjects = findall(figureHandle, "-property", "FontName");
snapshot = struct("display", string(getenv("DISPLAY")), ...
    "screen_pixels_per_inch", get(groot, "ScreenPixelsPerInch"), ...
    "figure", struct("units", string(get(figureHandle, "Units")), ...
        "position", get(figureHandle, "Position"), ...
        "paper_units", string(get(figureHandle, "PaperUnits")), ...
        "paper_size", get(figureHandle, "PaperSize"), ...
        "paper_position", get(figureHandle, "PaperPosition"), ...
        "paper_position_mode", string(get(figureHandle, "PaperPositionMode")), ...
        "renderer", string(get(figureHandle, "Renderer")), ...
        "renderer_mode", string(get(figureHandle, "RendererMode"))), ...
    "axes", struct("units", string(get(axesHandle, "Units")), ...
        "position", get(axesHandle, "Position"), ...
        "outer_position", get(axesHandle, "OuterPosition"), ...
        "tight_inset", get(axesHandle, "TightInset"), ...
        "position_constraint", string(get(axesHandle, "PositionConstraint")), ...
        "font_name", string(get(axesHandle, "FontName")), ...
        "font_size", get(axesHandle, "FontSize"), ...
        "xlim", get(axesHandle, "XLim"), "ylim", get(axesHandle, "YLim")), ...
    "graphics_font_names", sort(unique(string(get(fontObjects, "FontName")))));
end

function evidence = read_native_svg(filePath)
document = xmlread(char(filePath));
root = document.getDocumentElement();
assert(local_name(root) == "svg", "diagnose_svg_print_sizes:SvgRoot", ...
    "Native artifact has no SVG root");
evidence = struct("root_node_name", string(char(root.getNodeName())), ...
    "root_namespace_uri", string(char(root.getNamespaceURI())), ...
    "root_attributes", attribute_records(root), ...
    "width_raw", string(char(root.getAttribute('width'))), ...
    "height_raw", string(char(root.getAttribute('height'))), ...
    "viewbox_present", logical(root.hasAttribute('viewBox')), ...
    "viewbox_raw", string(char(root.getAttribute('viewBox'))), ...
    "preserve_aspect_ratio_raw", string(char(root.getAttribute('preserveAspectRatio'))), ...
    "rectangles", struct("node_name", {}, "attributes", {}, "ancestors_nearest_first", {}), ...
    "clip_paths", struct("element", {}, "descendants", {}));
elements = root.getElementsByTagName('*');
for elementIndex = 0:elements.getLength() - 1
    element = elements.item(elementIndex);
    if local_name(element) == "rect"
        evidence.rectangles(end + 1, 1) = element_record(element);
    elseif local_name(element) == "clipPath"
        clip = struct("element", element_record(element), ...
            "descendants", struct("node_name", {}, "attributes", {}, "ancestors_nearest_first", {}));
        descendants = element.getElementsByTagName('*');
        for descendantIndex = 0:descendants.getLength() - 1
            clip.descendants(end + 1, 1) = element_record(descendants.item(descendantIndex));
        end
        evidence.clip_paths(end + 1, 1) = clip;
    end
end
end

function record = element_record(element)
record = struct("node_name", string(char(element.getNodeName())), ...
    "attributes", attribute_records(element), ...
    "ancestors_nearest_first", struct("node_name", {}, "attributes", {}));
parent = element.getParentNode();
while ~isempty(parent) && parent.getNodeType() == 1
    record.ancestors_nearest_first(end + 1, 1) = struct( ...
        "node_name", string(char(parent.getNodeName())), "attributes", attribute_records(parent));
    parent = parent.getParentNode();
end
end

function records = attribute_records(element)
attributes = element.getAttributes();
records = repmat(struct("name", "", "value", ""), attributes.getLength(), 1);
for attributeIndex = 0:attributes.getLength() - 1
    attribute = attributes.item(attributeIndex);
    records(attributeIndex + 1).name = string(char(attribute.getNodeName()));
    records(attributeIndex + 1).value = string(char(attribute.getNodeValue()));
end
end

function name = local_name(element)
parts = split(string(char(element.getNodeName())), ":");
name = parts(end);
end

function record = record_error(record, phase, errorRecord)
record.errors(end + 1, 1) = struct("phase", phase, ...
    "identifier", string(errorRecord.identifier), "message", string(errorRecord.message));
end

function write_report(filePath, report)
encoded = unicode2native(jsonencode(report), "UTF-8");
fileHandle = fopen(filePath, "wb");
assert(fileHandle >= 0, "diagnose_svg_print_sizes:Write", "Cannot write %s", filePath);
fileCleanup = onCleanup(@() fclose(fileHandle));
written = fwrite(fileHandle, encoded, "uint8");
assert(written == numel(encoded), "diagnose_svg_print_sizes:Write", "Incomplete JSON write");
end

function value = utc_timestamp()
value = string(datetime("now", "TimeZone", "UTC", "Format", "yyyy-MM-dd'T'HH:mm:ss'Z'"));
end

function close_if_valid(figureHandle)
if isgraphics(figureHandle, "figure")
    close(figureHandle);
end
end
