function full100_export_contracts(outputDirectory, keepArtifacts)
%FULL100_EXPORT_CONTRACTS Exercise the publication export and manifest gates.
arguments
    outputDirectory (1,1) string = ""
    keepArtifacts (1,1) logical = false
end
assetDirectory = fullfile(fileparts(fileparts(mfilename("fullpath"))), "assets");
addpath(assetDirectory);
if strlength(outputDirectory) == 0
    outputDirectory = fullfile(tempdir, "oi-full100-export-" + string(char(java.util.UUID.randomUUID())));
end
assert(~isfolder(outputDirectory), "full100_export_contracts:FreshOutput", ...
    "Runtime gate requires a fresh output directory: %s", outputDirectory);
mkdir(outputDirectory);
cleanupOutput = onCleanup(@() maybe_remove_output(outputDirectory, keepArtifacts));
theme = oi_ocean_theme();
if oi_font_available("WenQuanYi Zen Hei")
    assert(theme.FontName == "WenQuanYi Zen Hei", ...
        "full100_export_contracts:FontPreference", ...
        "The available cross-release CJK and Latin font must be preferred");
end
figureHandle = oi_figure(1200, 675, "off");
cleanupFigure = onCleanup(@() close_if_valid(figureHandle));
figureHandle.Units = "inches";
figureHandle.Position(3:4) = [4 2.25];
layoutHandle = tiledlayout(figureHandle, 1, 1, ...
    "Padding", "loose", "TileSpacing", "compact");
layoutHandle.Units = "normalized";
layoutHandle.OuterPosition = [0.04 0.04 0.92 0.92];
axesHandle = nexttile(layoutHandle);
timeValues = 1:20;
lineOne = plot(axesHandle, timeValues, sin(timeValues / 3), "-o", ...
    "DisplayName", "observed");
hold(axesHandle, "on");
lineTwo = plot(axesHandle, timeValues, cos(timeValues / 4), "--s", ...
    "DisplayName", "model");
assert(isgraphics(lineOne) && isgraphics(lineTwo));
oi_apply_axes(axesHandle, theme);
titleText = string(native2unicode(uint8([229 141 151 230 181 183 230 181 183 232 161 168 230 184 169 229 186 166]), "UTF-8"));
xLabelText = string(native2unicode(uint8([230 151 182 233 151 180 32 40 85 84 67 41]), "UTF-8"));
yLabelText = string(native2unicode(uint8([230 184 169 229 186 166 32 40 100 101 103 67 41]), "UTF-8"));
title(axesHandle, titleText);
xlabel(axesHandle, xLabelText);
ylabel(axesHandle, yLabelText);
legendHandle = legend(axesHandle, [lineOne lineTwo], ...
    "Orientation", "horizontal", "NumColumns", 2);
legendHandle.Layout.Tile = "south";
drawnow;
entry = oi_export_figure(figureHandle, outputDirectory, "publication", ...
    1200, 675, 300, "Title", titleText, ...
    "Source", "full100 export regression", "Theme", theme.Name, ...
    "ExportSVG", true);
assert(entry.exports.png.width == 1200 && entry.exports.png.height == 675);
assert(entry.exports.png.dpi == 300);
assert(entry.exports.png.embedded_dpi_x > 299 && entry.exports.png.embedded_dpi_x < 301);
assert(abs(entry.exports.pdf.width - 288) < 1 && abs(entry.exports.pdf.height - 162) < 1);
assert_export_api(entry, "png", ["exportgraphics" "print"]);
assert_export_api(entry, "pdf", ["exportgraphics" "print"]);
assert_export_api(entry, "svg", ["exportgraphics" "print"]);
assert(entry.runtime.exportgraphics_available, ...
    "The installed MATLAB exportgraphics P-code must be detected");
if ~verLessThan('matlab', '25.1')
    assert(entry.runtime.exact_exportgraphics_available ...
        && entry.runtime.export_api.png == "exportgraphics" ...
        && entry.runtime.export_api.pdf == "exportgraphics" ...
        && entry.runtime.export_api.svg == "exportgraphics" ...
        && strlength(entry.runtime.export_fallback_reason) == 0, ...
        "Modern MATLAB must use exact native exportgraphics without a silent print retry");
else
    assert(~entry.runtime.exact_exportgraphics_available ...
        && entry.runtime.export_api.png == "print" ...
        && entry.runtime.export_api.pdf == "print" ...
        && strlength(entry.runtime.export_fallback_reason) > 0 ...
        && entry.runtime.export_device.png == "-dpng -r300", ...
        "Legacy exact-size exports must document the actual print compatibility path");
end
svgPath = fullfile(outputDirectory, entry.exports.svg.file);
assert_svg_geometry(entry.exports.svg, svgPath, ...
    entry.exports.png.width, entry.exports.png.height);
assert(abs(entry.exports.svg.physical_width_in - 4) < 1e-9);
assert(abs(entry.exports.svg.physical_height_in - 2.25) < 1e-9);
assert(entry.rendering_evidence.physical_dimensions_verified);
assert(entry.rendering_evidence.png_embedded_dpi_verified);
assert(entry.accessibility.cjk_text_present && entry.accessibility.cjk_font_verified);
for labelRole = ["title" "xlabel" "ylabel"]
    assert(any(string({entry.text_objects.role}) == labelRole), ...
        "full100_export_contracts:MissingTextRole", ...
        "Final layout evidence must identify the %s object", labelRole);
end
assert(entry.publication.color.automated_palette_safe);
assert(~entry.publication.color.colorblind_safe);
assert(entry.publication.color.redundant_encoding);
manifestPath = fullfile(outputDirectory, "figures.json");
manifest = oi_write_manifest(manifestPath, entry);
assert(manifest.runtime_status == "ready");
assert_svg_geometry(manifest.figures.exports.svg, svgPath, ...
    manifest.figures.exports.png.width, manifest.figures.exports.png.height);
assert(manifest.figures.exports.png.bytes == dir(fullfile(outputDirectory, "publication.png")).bytes);
assert(strcmpi(manifest.figures.exports.png.sha256, ...
    oi_sha256_file(fullfile(outputDirectory, "publication.png"))));
assert(~is_absolute_path(manifest.figures.exports.png.file));
assert(~is_absolute_path(manifest.figures.exports.pdf.file));
assert(~is_absolute_path(manifest.figures.exports.svg.file));
invalidBytesEntry = entry;
invalidBytesEntry.exports.png.bytes = 1;
invalidBytesPath = fullfile(outputDirectory, "invalid-bytes.json");
assert_throws(@() oi_write_manifest(invalidBytesPath, invalidBytesEntry), "ByteMismatch");
assert(~isfile(invalidBytesPath), ...
    "full100_export_contracts:TamperedManifest", ...
    "Byte-mismatched evidence must not produce a manifest");
invalidHashEntry = entry;
invalidHashEntry.exports.pdf.sha256 = string(repmat('0', 1, 64));
invalidHashPath = fullfile(outputDirectory, "invalid-hash.json");
assert_throws(@() oi_write_manifest(invalidHashPath, invalidHashEntry), "HashMismatch");
assert(~isfile(invalidHashPath), ...
    "full100_export_contracts:TamperedManifest", ...
    "Hash-mismatched evidence must not produce a manifest");
fprintf("MATLAB_FULL100_EXPORT_CONTRACTS=passed\n");
end

function assert_export_api(entry, format, allowedApis)
exportRecord = entry.exports.(char(format));
runtimeApi = string(entry.runtime.export_api.(char(format)));
assert(any(runtimeApi == allowedApis) && string(exportRecord.export_api) == runtimeApi, ...
    "full100_export_contracts:ExportApi", ...
    "%s export API evidence is invalid or inconsistent", upper(format));
end

function assert_svg_geometry(svgRecord, svgPath, referenceWidth, referenceHeight)
document = xmlread(char(svgPath));
root = document.getDocumentElement();
assert(strcmpi(char(root.getNodeName()), "svg"), ...
    "full100_export_contracts:InvalidSvg", "SVG has no root element");
measuredWidth = svg_numeric_length(root, "width");
measuredHeight = svg_numeric_length(root, "height");
viewBox = svg_view_box(root);
assert_close(double(svgRecord.width), measuredWidth, ...
    "SVG width evidence does not match the artifact");
assert_close(double(svgRecord.height), measuredHeight, ...
    "SVG height evidence does not match the artifact");
assert_close(double(svgRecord.viewbox_width), viewBox(3), ...
    "SVG viewBox width evidence does not match the artifact");
assert_close(double(svgRecord.viewbox_height), viewBox(4), ...
    "SVG viewBox height evidence does not match the artifact");
assert_close(viewBox(3) / viewBox(4), measuredWidth / measuredHeight, ...
    "SVG viewBox and viewport aspect ratios differ");
assert_close(viewBox(3) / viewBox(4), double(referenceWidth) / double(referenceHeight), ...
    "SVG and reference raster aspect ratios differ");
end

function value = svg_numeric_length(root, attributeName)
attribute = strtrim(string(char(root.getAttribute(char(attributeName)))));
token = regexp(attribute, ...
    "^([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)(?:[A-Za-z%]+)?$", ...
    "tokens", "once");
assert(~isempty(token), "full100_export_contracts:InvalidSvg", ...
    "SVG %s is not an explicit numeric length", attributeName);
value = str2double(token{1});
assert(isfinite(value) && value > 0, ...
    "full100_export_contracts:InvalidSvg", ...
    "SVG %s must be positive", attributeName);
end

function values = svg_view_box(root)
attribute = string(char(root.getAttribute('viewBox')));
tokens = regexp(attribute, ...
    "[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?", "match");
values = str2double(tokens);
assert(numel(values) == 4 && all(isfinite(values)) ...
    && values(3) > 0 && values(4) > 0, ...
    "full100_export_contracts:InvalidSvg", ...
    "SVG viewBox must contain four finite values with positive dimensions");
end

function assert_close(actual, expected, message)
tolerance = 1e-8 * max([1 abs(actual) abs(expected)]);
assert(isfinite(actual) && isfinite(expected) && abs(actual - expected) <= tolerance, ...
    "full100_export_contracts:GeometryMismatch", "%s", message);
end

function assert_throws(callback, expectedText)
thrown = false;
try
    callback();
catch errorRecord
    thrown = true;
    assert(contains(string(errorRecord.identifier), expectedText) ...
        || contains(string(errorRecord.message), expectedText), ...
        "full100_export_contracts:UnexpectedError", ...
        "Expected %s rejection, received %s: %s", ...
        expectedText, errorRecord.identifier, errorRecord.message);
end
assert(thrown, "full100_export_contracts:MissingRejection", ...
    "Expected a rejection containing %s", expectedText);
end

function result = is_absolute_path(pathValue)
normalized = replace(string(pathValue), "\", "/");
result = startsWith(normalized, "/") || ~isempty(regexp(normalized, "^[A-Za-z]:/", "once"));
end

function maybe_remove_output(outputDirectory, keepArtifacts)
if ~keepArtifacts && isfolder(outputDirectory)
    rmdir(outputDirectory, "s");
end
end

function close_if_valid(figureHandle)
if ~isempty(figureHandle) && isgraphics(figureHandle)
    close(figureHandle);
end
end
