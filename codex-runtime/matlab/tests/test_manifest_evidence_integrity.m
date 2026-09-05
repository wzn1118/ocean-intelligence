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
