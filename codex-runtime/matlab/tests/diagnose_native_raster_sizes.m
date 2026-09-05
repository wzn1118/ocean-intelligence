function report = diagnose_native_raster_sizes(outputDirectory)
arguments
    outputDirectory (1,1) string
end
assert(~isfolder(outputDirectory) && ~isfile(outputDirectory), ...
    "diagnose_native_raster_sizes:FreshOutput", "Refusing to reuse %s", outputDirectory);
[created, message] = mkdir(outputDirectory);
assert(created, "diagnose_native_raster_sizes:CreateDirectory", "%s", message);
originalPath = path;
pathCleanup = onCleanup(@() path(originalPath));
addpath(fullfile(fileparts(fileparts(mfilename("fullpath"))), "assets"));
report = struct("schema_version", 1, "status", "running", ...
    "release", "R" + string(version('-release')), "matlab_version", string(version), ...
    "screen_pixels_per_inch", get(groot, "ScreenPixelsPerInch"), ...
    "display", string(getenv("DISPLAY")), "desktop_available", logical(usejava("desktop")), ...
    "generated_at", string(datetime("now", "TimeZone", "UTC", ...
        "Format", "yyyy-MM-dd'T'HH:mm:ss'Z'")), ...
    "data_source", "synthetic native sizing diagnostic, not observations", ...
    "verification_scope", "native call, PNG header dimensions, bytes and hash only", ...
    "visual_verified", false, "layout_verified", false, "candidates", struct([]));
reportPath = fullfile(outputDirectory, "native-raster-sizing-probe.json");
if verLessThan('matlab', '25.1')
    report.status = "unsupported_release";
    write_report(reportPath, report);
    return;
end
theme = oi_ocean_theme();
sizes = [400 300 150; 1200 675 180; 997 613 300];
units = ["pixels" "inches"];
aspectModes = ["on" "off"];
write_report(reportPath, report);
for sizeIndex = 1:size(sizes, 1)
    for unit = units
        for aspectMode = aspectModes
            record = export_candidate(outputDirectory, sizes(sizeIndex, :), unit, aspectMode, theme);
            if isempty(report.candidates)
                report.candidates = record;
            else
                report.candidates(end + 1, 1) = record;
            end
            write_report(reportPath, report);
        end
    end
end
report.status = "completed_diagnostics_only";
report.summary = struct("candidate_count", numel(report.candidates), ...
    "exported", sum([report.candidates.status] == "exported"), ...
    "exact_raster_dimensions", sum([report.candidates.exact_raster_dimensions]));
write_report(reportPath, report);
fprintf("MATLAB_NATIVE_RASTER_SIZING_PROBE=%s\n", reportPath);
fprintf("MATLAB_NATIVE_RASTER_SIZING_SUMMARY=%s\n", jsonencode(report.summary));
end

function record = export_candidate(outputDirectory, sizeSpec, unit, aspectMode, theme)
width = sizeSpec(1);
height = sizeSpec(2);
dpi = sizeSpec(3);
identifier = string(width) + "x" + string(height) + "-dpi" + string(dpi) ...
    + "-" + unit + "-aspect-" + aspectMode;
filePath = fullfile(outputDirectory, identifier + ".png");
requestedSize = [width height];
if unit == "inches"
    requestedSize = requestedSize / dpi;
end
record = struct("id", identifier, "status", "pending", "file", identifier + ".png", ...
    "requested_api", "exportgraphics", "api_invoked", false, "export_call_succeeded", false, ...
    "units", unit, "width", requestedSize(1), ...
    "height", requestedSize(2), "resolution", dpi, "padding", "figure", ...
    "preserve_aspect_ratio", aspectMode, "target_pixels", [width height], ...
    "font_name", theme.FontName, "figure_before_export", struct(), ...
    "figure_after_export", struct(), "png_pixels", [], "png_x_resolution", [], ...
    "png_y_resolution", [], "png_resolution_unit", "", "bytes", 0, "sha256", "", ...
    "exact_raster_dimensions", false, "visual_verified", false, ...
    "error_identifier", "", "error_message", "");
try
    figureHandle = oi_figure(width, height, "off");
    figureCleanup = onCleanup(@() close_if_valid(figureHandle));
    figureHandle.Units = "inches";
    figureHandle.Position(3:4) = [width height] / dpi;
    axesHandle = axes("Parent", figureHandle, "Units", "normalized", ...
        "PositionConstraint", "outerposition", "OuterPosition", [0.05 0.05 0.9 0.9]);
    lineHandle = plot(axesHandle, [1 2 3], [1 3 2], "-o");
    xlabel(axesHandle, "Time (s)", "Interpreter", "none");
    ylabel(axesHandle, "Value (1)", "Interpreter", "none");
    title(axesHandle, "Raster sizing", "Interpreter", "none");
    oi_apply_axes(axesHandle, theme);
    drawnow;
    record.figure_before_export = figure_geometry(figureHandle, axesHandle, lineHandle);
    record.api_invoked = true;
    exportgraphics(figureHandle, filePath, "Units", unit, ...
        "Width", requestedSize(1), "Height", requestedSize(2), "Resolution", dpi, ...
        "Padding", "figure", "PreserveAspectRatio", aspectMode, "BackgroundColor", "white");
    record.export_call_succeeded = true;
    record.figure_after_export = figure_geometry(figureHandle, axesHandle, lineHandle);
    fileInfo = dir(filePath);
    imageInfo = imfinfo(filePath);
    record.png_pixels = [imageInfo.Width imageInfo.Height];
    record.exact_raster_dimensions = isequal(record.png_pixels, [width height]);
    record.bytes = fileInfo.bytes;
    record.sha256 = string(oi_sha256_file(filePath));
    if isfield(imageInfo, "XResolution")
        record.png_x_resolution = imageInfo.XResolution;
    end
    if isfield(imageInfo, "YResolution")
        record.png_y_resolution = imageInfo.YResolution;
    end
    if isfield(imageInfo, "ResolutionUnit")
        record.png_resolution_unit = string(imageInfo.ResolutionUnit);
    end
    record.status = "exported";
catch errorRecord
    record.status = "failed";
    record.error_identifier = string(errorRecord.identifier);
    record.error_message = string(errorRecord.message);
end
end

function geometry = figure_geometry(figureHandle, axesHandle, lineHandle)
geometry = struct("figure_units", string(figureHandle.Units), ...
    "figure_position", double(figureHandle.Position), ...
    "figure_pixels", double(getpixelposition(figureHandle)), ...
    "axes_units", string(axesHandle.Units), "axes_position", double(axesHandle.Position), ...
    "axes_pixels", double(getpixelposition(axesHandle, true)), ...
    "data_aspect_ratio", double(axesHandle.DataAspectRatio), ...
    "plot_box_aspect_ratio", double(axesHandle.PlotBoxAspectRatio), ...
    "x_limits", double(axesHandle.XLim), "y_limits", double(axesHandle.YLim), ...
    "native_x_values", double(lineHandle.XData), "native_y_values", double(lineHandle.YData));
end

function write_report(filePath, report)
fileHandle = fopen(filePath, "w", "n", "UTF-8");
assert(fileHandle >= 0, "diagnose_native_raster_sizes:Write", "Cannot write %s", filePath);
fileCleanup = onCleanup(@() fclose(fileHandle));
fprintf(fileHandle, "%s\n", jsonencode(report));
end

function close_if_valid(figureHandle)
if isgraphics(figureHandle)
    close(figureHandle);
end
end
