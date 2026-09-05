function test_manifest_evidence_integrity(outputRoot)
%TEST_MANIFEST_EVIDENCE_INTEGRITY Reject stale evidence and audit SVG geometry.
if nargin == 0
    outputRoot = string(tempdir);
else
    outputRoot = string(outputRoot);
end
assert(isfolder(outputRoot), ...
    "test_manifest_evidence_integrity:MissingOutputRoot", ...
    "Output root does not exist: %s", outputRoot);
outputDirectory = string(tempname(outputRoot));
[created, message] = mkdir(outputDirectory);
assert(created, "test_manifest_evidence_integrity:CreateDirectory", "%s", message);
cleanupDirectory = onCleanup(@() remove_directory(outputDirectory));

testsDirectory = fileparts(mfilename("fullpath"));
assetDirectory = fullfile(fileparts(testsDirectory), "assets");
addpath(assetDirectory);

figureHandle = oi_figure(1200, 675, "off");
cleanupFigure = onCleanup(@() close_if_valid(figureHandle));
axesHandle = axes("Parent", figureHandle);
plot(axesHandle, 1:5, [1 2 1.5 3 2.5], "-o", ...
    "LineWidth", 1.5, "MarkerSize", 5, "DisplayName", "Observed");
title(axesHandle, "Manifest evidence integrity", "Interpreter", "none");
xlabel(axesHandle, "Sample", "Interpreter", "none");
ylabel(axesHandle, "Value (1)", "Interpreter", "none");
grid(axesHandle, "on");
oi_apply_axes(axesHandle, oi_ocean_theme());

entry = oi_export_figure(figureHandle, outputDirectory, "evidence", ...
    1200, 675, 300, "Title", "Manifest evidence integrity", ...
    "Source", "manifest evidence regression", ...
    "Theme", "Ocean Intelligence MATLAB", "ExportSVG", true);
svgPath = fullfile(outputDirectory, entry.exports.svg.file);
document = xmlread(char(svgPath));
root = document.getDocumentElement();
root.setAttribute('viewBox', '10 20 1600 900');
root.setAttribute('style', char("width:1in;height:1in;" ...
    + string(char(root.getAttribute('style')))));
xmlwrite(char(svgPath), document);
svgInfo = dir(svgPath);
entry.exports.svg.viewbox_width = 1600;
entry.exports.svg.viewbox_height = 900;
entry.exports.svg.bytes = svgInfo.bytes;
entry.exports.svg.sha256 = oi_sha256_file(svgPath);

manifest = oi_write_manifest(fullfile(outputDirectory, "valid.json"), entry);
assert(manifest.figures.exports.svg.width == 1200 ...
    && manifest.figures.exports.svg.height == 675 ...
    && manifest.figures.exports.svg.viewbox_width == 1600 ...
    && manifest.figures.exports.svg.viewbox_height == 900, ...
    "Valid SVG pixel and viewBox geometry was not preserved");
for format = ["png" "pdf" "svg"]
    expectedStrategy = struct("api", entry.exports.(char(format)).export_api);
    assert(isequal(manifest.export_strategies.(char(format)), expectedStrategy) ...
        && isequal(manifest.runtime.export_strategies.(char(format)), expectedStrategy), ...
        "Single-API summaries must preserve their existing schema");
end
if ~verLessThan('matlab', '25.1')
    test_mixed_export_apis(figureHandle, outputDirectory, entry);
else
    fprintf("MATLAB_MANIFEST_MIXED_EXPORT_APIS=not_supported_before_R2025a_exact_sizing\n");
end

forged = entry;
forged.exports.svg.bytes = forged.exports.svg.bytes + 1;
must_throw(@() oi_write_manifest(fullfile(outputDirectory, "bad-bytes.json"), ...
    forged), "ByteMismatch");

forged = entry;
forged.exports.svg.sha256 = string(repmat('0', 1, 64));
must_throw(@() oi_write_manifest(fullfile(outputDirectory, "bad-hash.json"), ...
    forged), "HashMismatch");

forged = entry;
forged.exports.svg.title = "Forged title";
must_throw(@() oi_write_manifest(fullfile(outputDirectory, "bad-identity.json"), ...
    forged), "MetadataMismatch");

forged = entry;
forged.exports.svg.viewbox_width = 1601;
must_throw(@() oi_write_manifest(fullfile(outputDirectory, "bad-viewbox.json"), ...
    forged), "InvalidSvg");

forged = entry;
forged.exports.png.width = forged.exports.png.width + 1;
must_throw(@() oi_write_manifest(fullfile(outputDirectory, "bad-png.json"), ...
    forged), "InvalidPng");

svgText = string(fileread(svgPath));
tamperedText = replace(svgText, "Manifest evidence integrity", ...
    "Manifest evidence integritx");
assert(strlength(tamperedText) == strlength(svgText) && tamperedText ~= svgText, ...
    "Same-size SVG tamper fixture was not created");
write_utf8(svgPath, tamperedText);
tamperedInfo = dir(svgPath);
assert(tamperedInfo.bytes == entry.exports.svg.bytes, ...
    "Same-size SVG tamper fixture changed the artifact byte count");
must_throw(@() oi_write_manifest(fullfile(outputDirectory, "tampered.json"), ...
    entry), "HashMismatch");

clear cleanupFigure;
close_if_valid(figureHandle);
clear cleanupDirectory;
remove_directory(outputDirectory);
fprintf("MATLAB_MANIFEST_EVIDENCE_INTEGRITY=passed\n");
end

function test_mixed_export_apis(figureHandle, outputDirectory, entry)
assert(entry.exports.png.export_api == "exportgraphics", ...
    "Mixed-API regression requires the real exportgraphics PNG path");
entry.exports = rmfield(entry.exports, 'svg');
stagingDirectory = string(tempname(outputDirectory));
[created, message] = mkdir(stagingDirectory);
assert(created, "test_manifest_evidence_integrity:CreateDirectory", "%s", message);
cleanupStaging = onCleanup(@() remove_directory(stagingDirectory));
printedEntry = oi_export_figure(figureHandle, stagingDirectory, "a-printed", ...
    1200, 675, 300, "Title", entry.title, ...
    "Source", entry.source, "Theme", entry.theme);
pngPath = fullfile(stagingDirectory, printedEntry.exports.png.file);
print(figureHandle, char(pngPath), "-dpng", "-r300");
imageInfo = imfinfo(pngPath);
assert(imageInfo.Width == 1200 && imageInfo.Height == 675 ...
    && strcmpi(imageInfo.ResolutionUnit, 'meter'), ...
    "Printed PNG fixture must retain pixel dimensions and physical resolution");
printedEntry.exports.png.embedded_dpi_x = double(imageInfo.XResolution) * 0.0254;
printedEntry.exports.png.embedded_dpi_y = double(imageInfo.YResolution) * 0.0254;
printedEntry.exports.png.export_api = "print";
printedEntry.runtime.export_api.png = "print";
fileInfo = dir(pngPath);
printedEntry.exports.png.bytes = fileInfo.bytes;
printedEntry.exports.png.sha256 = oi_sha256_file(pngPath);
for format = ["png" "pdf"]
    record = printedEntry.exports.(char(format));
    finalPath = fullfile(outputDirectory, record.file);
    assert(~isfile(finalPath), "Mixed-API fixture destination must be fresh");
    [moved, message] = movefile(fullfile(stagingDirectory, record.file), finalPath);
    assert(moved, "test_manifest_evidence_integrity:MoveFailed", "%s", message);
    finalInfo = dir(finalPath);
    assert(finalInfo.bytes == record.bytes ...
        && strcmpi(oi_sha256_file(finalPath), record.sha256), ...
        "Promoted mixed-API fixture differs from its recorded evidence");
end
printedEntry.artifact_freshness.export_completed_at = string(datetime("now", ...
    "TimeZone", "UTC", "Format", "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"));
clear cleanupStaging;

entries = [printedEntry; entry];
manifestPath = fullfile(outputDirectory, "mixed-apis.json");
manifest = oi_write_manifest(manifestPath, entries);
expectedApis = ["exportgraphics"; "print"];
assert(manifest.schema_version == 2 ...
    && manifest.export_strategies.png.api == "mixed" ...
    && isequal(manifest.export_strategies.png.apis(:), expectedApis) ...
    && isequal(manifest.export_strategies, manifest.runtime.export_strategies) ...
    && isequal(manifest.figures, entries), ...
    "Mixed-API summary must enumerate both real APIs without changing figure evidence");
decoded = jsondecode(fileread(manifestPath));
assert(strcmp(decoded.export_strategies.png.api, 'mixed') ...
    && isequal(string(decoded.export_strategies.png.apis(:)), expectedApis) ...
    && isequal(decoded.runtime.export_strategies, decoded.export_strategies) ...
    && strcmp(decoded.figures(1).exports.png.export_api, 'print') ...
    && strcmp(decoded.figures(1).runtime.export_api.png, 'print') ...
    && strcmp(decoded.figures(2).exports.png.export_api, 'exportgraphics') ...
    && strcmp(decoded.figures(2).runtime.export_api.png, 'exportgraphics'), ...
    "JSON round trip lost mixed-API or per-figure evidence");
manifestDigest = oi_sha256_file(manifestPath);

forged = entries;
forged(1).exports.png.export_api = "exportgraphics";
must_reject_manifest(manifestPath, forged, "ExportApiMismatch", manifestDigest);
forged = entries;
forged(1).runtime.export_api.png = "exportgraphics";
must_reject_manifest(manifestPath, forged, "ExportApiMismatch", manifestDigest);
forged = entries;
forged(1).exports.png.export_api = "mixed";
forged(1).runtime.export_api.png = "mixed";
must_reject_manifest(manifestPath, forged, "ExportApiMismatch", manifestDigest);
forged = entries;
forged(1).exports.png.export_api = expectedApis;
forged(1).runtime.export_api.png = expectedApis;
must_reject_manifest(manifestPath, forged, "ExportApiMismatch", manifestDigest);

forged = entries;
forged(1).exports.png.sha256 = string(repmat('0', 1, 64));
must_reject_manifest(manifestPath, forged, "HashMismatch", manifestDigest);
forged = entries;
forged(1).exports.pdf.bytes = forged(1).exports.pdf.bytes + 1;
must_reject_manifest(manifestPath, forged, "ByteMismatch", manifestDigest);
forged = entries;
forged(1).exports.png.width = forged(1).exports.png.width + 1;
must_reject_manifest(manifestPath, forged, "InvalidPng", manifestDigest);
forged = entries;
forged(1).exports.png.source = "forged source";
must_reject_manifest(manifestPath, forged, "MetadataMismatch", manifestDigest);
fprintf("MATLAB_MANIFEST_MIXED_EXPORT_APIS=passed\n");
end

function must_reject_manifest(manifestPath, entries, expectedText, originalDigest)
must_throw(@() oi_write_manifest(manifestPath, entries), expectedText);
assert(strcmpi(oi_sha256_file(manifestPath), originalDigest), ...
    "Rejected mixed-API evidence must not replace the existing manifest");
end

function must_throw(callback, expectedText)
thrown = false;
try
    callback();
catch errorRecord
    thrown = true;
    assert(contains(string(errorRecord.identifier), expectedText) ...
        || contains(string(errorRecord.message), expectedText), ...
        "Unexpected MATLAB error: %s", errorRecord.message);
end
assert(thrown, "Expected MATLAB rejection containing %s", expectedText);
end

function write_utf8(filePath, value)
fileHandle = fopen(char(filePath), "w", "n", "UTF-8");
assert(fileHandle >= 0, ...
    "test_manifest_evidence_integrity:WriteFailed", ...
    "Cannot write SVG tamper fixture: %s", filePath);
cleanup = onCleanup(@() fclose(fileHandle));
fwrite(fileHandle, unicode2native(char(value), "UTF-8"), "uint8");
clear cleanup;
end

function close_if_valid(figureHandle)
if ~isempty(figureHandle) && isgraphics(figureHandle)
    close(figureHandle);
end
end

function remove_directory(directoryPath)
if isfolder(directoryPath)
    rmdir(directoryPath, "s");
end
end
