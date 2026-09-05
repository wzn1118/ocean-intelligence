function test_export_manifest_runtime(outputDirectory)
%TEST_EXPORT_MANIFEST_RUNTIME Exercise staged exports and atomic manifests.
if nargin == 0
    outputRoot = string(tempdir);
else
    outputRoot = string(outputDirectory);
end
if ~isfolder(outputRoot)
    mkdir(outputRoot);
end
outputDirectory = string(tempname(outputRoot));
mkdir(outputDirectory);
cleanupDirectory = onCleanup(@() remove_directory(outputDirectory));

testsDirectory = fileparts(mfilename("fullpath"));
matlabDirectory = fileparts(testsDirectory);
addpath(fullfile(matlabDirectory, "assets"));

figureHandle = oi_figure(640, 420, "off");
cleanupFigure = onCleanup(@() close_if_valid(figureHandle));
axesHandle = axes("Parent", figureHandle);
cjkTitle = string(char([hex2dec("6D4B") hex2dec("8BD5") ...
    hex2dec("6D77") hex2dec("533A") hex2dec("6E29") hex2dec("5EA6")]));
plot(axesHandle, 1:4, [2 3 2.5 4], "-o", "LineWidth", 1.5, ...
    "MarkerSize", 5, "DisplayName", "Temperature");
title(axesHandle, cjkTitle, "Interpreter", "none");
xlabel(axesHandle, "Station", "Interpreter", "none");
ylabel(axesHandle, "Temperature (degC)", "Interpreter", "none");
grid(axesHandle, "on");
oi_apply_axes(axesHandle, oi_theme());

stalePath = fullfile(outputDirectory, "export-contract.png");
write_bytes(stalePath, uint8("stale"));
staleDigest = oi_sha256_file(stalePath);
must_throw(@() oi_export_figure(figureHandle, outputDirectory, ...
    "export-contract", 640, 420, 120, "Title", cjkTitle), ...
    "StaleArtifact");
assert(strcmpi(oi_sha256_file(stalePath), staleDigest), ...
    "Stale destination was modified before export rejection");
delete(stalePath);

entry = oi_export_figure(figureHandle, outputDirectory, ...
    "export-contract", 640, 420, 120, ...
    "Title", cjkTitle, ...
    "Source", "thread-4 runtime contract", ...
    "Theme", "Ocean Intelligence MATLAB");
assert(entry.artifact_freshness.created_in_unique_staging_directory ...
    && entry.artifact_freshness.preexisting_destination_rejected ...
    && entry.artifact_freshness.content_verified_before_promotion ...
    && entry.artifact_freshness.promotion_strategy == "same-filesystem rename", ...
    "Export freshness evidence is incomplete");
assert(entry.accessibility.cjk_text_present ...
    && entry.rendering_evidence.cjk_font_evidence.text_present ...
    && entry.rendering_evidence.cjk_font_evidence.candidate_verified ...
    && ~entry.rendering_evidence.cjk_font_evidence.glyph_rendering_verified, ...
    "CJK font evidence is missing or overstated");

pngPath = fullfile(outputDirectory, entry.exports.png.file);
pdfPath = fullfile(outputDirectory, entry.exports.pdf.file);
assert(isfile(pngPath) && isfile(pdfPath), ...
    "Promoted PNG/PDF artifacts are missing");
pngInfo = imfinfo(pngPath);
pngFileInfo = dir(pngPath);
pdfFileInfo = dir(pdfPath);
assert(pngInfo.Width == entry.exports.png.width ...
    && pngInfo.Height == entry.exports.png.height ...
    && pngFileInfo.bytes == entry.exports.png.bytes ...
    && strcmpi(oi_sha256_file(pngPath), entry.exports.png.sha256) ...
    && pdfFileInfo.bytes == entry.exports.pdf.bytes ...
    && strcmpi(oi_sha256_file(pdfPath), entry.exports.pdf.sha256), ...
    "Export dimensions, bytes, or SHA-256 evidence is stale");

manifestPath = fullfile(outputDirectory, "figures.json");
manifest = oi_write_manifest(manifestPath, entry);
decoded = jsondecode(fileread(manifestPath));
assert(manifest.schema_version == 2 && decoded.schema_version == 2 ...
    && strcmp(decoded.figures.exports.png.file, "export-contract.png") ...
    && strcmp(decoded.figures.exports.pdf.file, "export-contract.pdf") ...
    && ~startsWith(string(decoded.figures.exports.png.file), filesep) ...
    && strcmpi(decoded.figures.exports.png.sha256, oi_sha256_file(pngPath)) ...
    && strcmpi(decoded.figures.exports.pdf.sha256, oi_sha256_file(pdfPath)), ...
    "Manifest paths or artifact hashes are invalid");

firstManifestDigest = oi_sha256_file(manifestPath);
pause(0.05);
manifest = oi_write_manifest(manifestPath, entry); %#ok<NASGU>
manifestFileInfo = dir(manifestPath);
assert(isfile(manifestPath) && manifestFileInfo.bytes > 0 ...
    && ~strcmpi(oi_sha256_file(manifestPath), firstManifestDigest), ...
    "Atomic manifest replacement did not publish a fresh manifest");

clear cleanupFigure;
close_if_valid(figureHandle);
clear cleanupDirectory;
remove_directory(outputDirectory);
fprintf("MATLAB_EXPORT_MANIFEST_RUNTIME=passed\n");
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

function write_bytes(pathValue, bytes)
fileHandle = fopen(char(pathValue), "wb");
assert(fileHandle >= 0, "Cannot create stale artifact fixture");
cleanup = onCleanup(@() fclose(fileHandle));
fwrite(fileHandle, bytes, "uint8");
clear cleanup;
end

function close_if_valid(figureHandle)
if isgraphics(figureHandle)
    close(figureHandle);
end
end

function remove_directory(directoryPath)
if isfolder(directoryPath)
    rmdir(directoryPath, "s");
end
end
