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
figureHandle = oi_figure(1200, 675, "off");
cleanupFigure = onCleanup(@() close_if_valid(figureHandle));
axesHandle = axes("Parent", figureHandle);
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
legend(axesHandle, [lineOne lineTwo], "Location", "southoutside");
drawnow;
entry = oi_export_figure(figureHandle, outputDirectory, "publication", ...
    1200, 675, 300, "Title", titleText, ...
    "Source", "full100 export regression", "Theme", theme.Name, ...
    "ExportSVG", true);
assert(entry.exports.png.width == 1200 && entry.exports.png.height == 675);
assert(entry.exports.png.dpi == 300);
assert(entry.exports.png.embedded_dpi_x > 299 && entry.exports.png.embedded_dpi_x < 301);
assert(abs(entry.exports.pdf.width - 288) < 1 && abs(entry.exports.pdf.height - 162) < 1);
assert(entry.exports.svg.width == 1200 && entry.exports.svg.height == 675);
assert(abs(entry.exports.svg.physical_width_in - 4) < 1e-9);
assert(abs(entry.exports.svg.physical_height_in - 2.25) < 1e-9);
assert(entry.rendering_evidence.physical_dimensions_verified);
assert(entry.rendering_evidence.png_embedded_dpi_verified);
assert(entry.accessibility.cjk_text_present && entry.accessibility.cjk_font_verified);
assert(entry.publication.color.automated_palette_safe);
assert(~entry.publication.color.colorblind_safe);
assert(entry.publication.color.redundant_encoding);
manifestPath = fullfile(outputDirectory, "figures.json");
manifest = oi_write_manifest(manifestPath, entry);
assert(manifest.runtime_status == "ready");
assert(manifest.figures.exports.png.bytes == dir(fullfile(outputDirectory, "publication.png")).bytes);
assert(manifest.figures.exports.png.sha256 == oi_sha256_file(fullfile(outputDirectory, "publication.png")));
assert(~is_absolute_path(manifest.figures.exports.png.file));
assert(~is_absolute_path(manifest.figures.exports.pdf.file));
assert(~is_absolute_path(manifest.figures.exports.svg.file));
oldEntry = entry;
oldEntry.exports.png.bytes = 1;
oldEntry.exports.png.sha256 = string(repmat('0', 1, 64));
oldEntry.exports.pdf.bytes = 1;
oldEntry.exports.pdf.sha256 = string(repmat('0', 1, 64));
repaired = oi_write_manifest(fullfile(outputDirectory, "repaired.json"), oldEntry);
assert(repaired.figures.exports.png.bytes > 1);
assert(repaired.figures.exports.png.sha256 == oi_sha256_file(fullfile(outputDirectory, "publication.png")));
assert(repaired.figures.exports.pdf.bytes == dir(fullfile(outputDirectory, "publication.pdf")).bytes);
assert(repaired.figures.exports.pdf.sha256 == oi_sha256_file(fullfile(outputDirectory, "publication.pdf")));
fprintf("MATLAB_FULL100_EXPORT_CONTRACTS=passed\n");
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
