function entry = oi_export_figure(figureHandle, outputDirectory, figureId, widthPixels, heightPixels, dpi, options)
%OI_EXPORT_FIGURE Export and verify PNG/PDF and optional SVG artifacts.
% Input contract: outputDirectory exists or can be created; figureId is a
% safe relative stem; dimensions and dpi are positive; RequiredToolboxes
% contains exact product names returned by ver. Exports never reuse stale
% files. Output contract: requested files exist, are nonempty, and include
% byte counts, SHA-256 hashes, dimensions, normalized bounds, typography,
% contrast, release/toolbox provenance, and honest verification evidence.
arguments
    figureHandle (1,1)
    outputDirectory (1,1) string
    figureId (1,1) string
    widthPixels (1,1) double {mustBeInteger,mustBePositive} = 1200
    heightPixels (1,1) double {mustBeInteger,mustBePositive} = 675
    dpi (1,1) double {mustBeInteger,mustBePositive} = 180
    options.Title (1,1) string = ""
    options.Source (1,1) string = "MATLAB asset"
    options.Theme (1,1) string = "Ocean Intelligence MATLAB"
    options.ContrastRatio (1,1) double = NaN
    options.ExportSVG (1,1) logical = false
    options.RequiredToolboxes (1,:) string = strings(1, 0)
    options.RequireEmbeddedDPI (1,1) logical = true
end
assert(isgraphics(figureHandle, "figure"), "oi_export_figure:InvalidFigure", ...
    "figureHandle must be a valid traditional MATLAB figure");
assert(~verLessThan('matlab', '9.7'), "oi_export_figure:UnsupportedRelease", ...
    "MATLAB R2019b or newer is required by the native asset contract");
assert(~ismissing(outputDirectory) && strlength(strtrim(outputDirectory)) > 0, ...
    "oi_export_figure:EmptyDirectory", ...
    "outputDirectory must not be empty");
assert(~ismissing(figureId) && strlength(strtrim(figureId)) > 0, ...
    "oi_export_figure:InvalidId", "figureId must be explicit nonblank text");
assert(~any(contains(figureId, ["/" "\" ".."])), "oi_export_figure:UnsafeId", ...
    "figureId must be a relative file stem without separators");
assert(~isempty(regexp(figureId, "^[A-Za-z0-9][A-Za-z0-9._-]*$", "once")), ...
    "oi_export_figure:InvalidId", "figureId contains unsupported characters");
assert(~ismissing(options.Title) && strlength(strtrim(options.Title)) > 0, ...
    "oi_export_figure:EmptyTitle", ...
    "Title must be explicit and nonempty for artifact and SVG accessibility metadata");
assert(~ismissing(options.Source) && ~ismissing(options.Theme) ...
    && strlength(strtrim(options.Source)) > 0 ...
    && strlength(strtrim(options.Theme)) > 0, ...
    "oi_export_figure:EmptyProvenance", ...
    "Source and Theme must be explicit and nonempty");
options.Title = strtrim(options.Title);
options.Source = strtrim(options.Source);
options.Theme = strtrim(options.Theme);
assert(isreal(options.ContrastRatio) && (isnan(options.ContrastRatio) ...
    || (isfinite(options.ContrastRatio) && options.ContrastRatio > 0)), ...
    "oi_export_figure:ContrastRatio", ...
    "ContrastRatio must be a positive real scalar or NaN when measured internally");
[requiredToolboxes, installedToolboxes] = validate_required_toolboxes( ...
    options.RequiredToolboxes);
if ~isfolder(outputDirectory)
    [created, message] = mkdir(outputDirectory);
    assert(created, "oi_export_figure:CreateDirectory", "%s", message);
end
outputDirectory = canonical_path(outputDirectory);
finalPngPath = fullfile(outputDirectory, figureId + ".png");
finalPdfPath = fullfile(outputDirectory, figureId + ".pdf");
finalSvgPath = fullfile(outputDirectory, figureId + ".svg");
finalArtifactPaths = [finalPngPath finalPdfPath];
if options.ExportSVG
    finalArtifactPaths(end + 1) = finalSvgPath;
end
assert(~any(isfile(finalArtifactPaths)), "oi_export_figure:StaleArtifact", ...
    "Refusing to overwrite an existing export artifact");
stagingDirectory = string(tempname(outputDirectory));
[stagingCreated, stagingMessage] = mkdir(stagingDirectory);
assert(stagingCreated, "oi_export_figure:CreateStagingDirectory", "%s", stagingMessage);
pngPath = fullfile(stagingDirectory, figureId + ".png");
pdfPath = fullfile(stagingDirectory, figureId + ".pdf");
svgPath = fullfile(stagingDirectory, figureId + ".svg");
stagedArtifactPaths = [pngPath pdfPath];
if options.ExportSVG
    stagedArtifactPaths(end + 1) = svgPath;
end
artifactCleanup = onCleanup(@() cleanup_staging_export( ...
    stagedArtifactPaths, stagingDirectory));
exportStartedAt = utc_timestamp();
widthInches = widthPixels / dpi;
heightInches = heightPixels / dpi;
widthPoints = widthInches * 72;
heightPoints = heightInches * 72;
figureHandle.Units = "inches";
figureHandle.Position(3:4) = [widthInches heightInches];
figureHandle.PaperUnits = "inches";
figureHandle.PaperPosition = [0 0 widthInches heightInches];
figureHandle.PaperSize = [widthInches heightInches];
figureHandle.PaperPositionMode = "manual";
figureHandle.Color = [1 1 1];
figureHandle.InvertHardcopy = "off";
apply_export_font(figureHandle);
drawnow;
exportGraphicsAvailable = has_exportgraphics();
directSvgAvailable = options.ExportSVG && has_direct_svg_export();
pdfApi = "print";
pdfDevice = "-dpdf -painters";
if exportGraphicsAvailable
    exportgraphics(figureHandle, pngPath, "Resolution", dpi, "BackgroundColor", "white");
    exportgraphics(figureHandle, pdfPath, "ContentType", "vector", "BackgroundColor", "white");
    [probeWidthPoints, probeHeightPoints, probePages] = pdf_geometry(pdfPath);
    if probePages == 1 && abs(probeWidthPoints - widthPoints) <= 1 ...
            && abs(probeHeightPoints - heightPoints) <= 1
        pdfApi = "exportgraphics";
        pdfDevice = "";
    else
        delete(pdfPath);
        print_exact_pdf(figureHandle, pdfPath, widthInches, heightInches);
    end
else
    warning("oi_export_figure:LegacyPrintFallback", ...
        "exportgraphics is unavailable; using the documented print fallback");
    resolutionOption = char("-r" + string(dpi));
    print(figureHandle, char(pngPath), "-dpng", resolutionOption);
    print_exact_pdf(figureHandle, pdfPath, widthInches, heightInches);
end
if options.ExportSVG
    if directSvgAvailable
        exportgraphics(figureHandle, svgPath, "BackgroundColor", "white");
    else
        print(figureHandle, char(svgPath), "-dsvg", "-painters");
    end
end
pngInfo = verify_file(pngPath, "png");
pdfInfo = verify_file(pdfPath, "pdf");
imageInfo = imfinfo(pngPath);
assert(imageInfo.Width == widthPixels && imageInfo.Height == heightPixels, ...
    "oi_export_figure:InvalidPngDimensions", "PNG dimensions are invalid");
[embeddedDpiX, embeddedDpiY] = png_physical_dpi(pngPath);
if options.RequireEmbeddedDPI
    assert(isfinite(embeddedDpiX) && isfinite(embeddedDpiY), ...
        "oi_export_figure:MissingPngDpi", ...
        "PNG must contain one physical-resolution pHYs chunk");
end
if isfinite(embeddedDpiX) && isfinite(embeddedDpiY)
    assert(abs(embeddedDpiX - dpi) <= 0.6 && abs(embeddedDpiY - dpi) <= 0.6, ...
        "oi_export_figure:PngDpiMismatch", ...
        "PNG embedded DPI does not match the requested resolution");
end
[pdfWidthPoints, pdfHeightPoints, pdfPages] = pdf_geometry(pdfPath);
assert(pdfPages == 1 && abs(pdfWidthPoints - widthPoints) <= 1 ...
    && abs(pdfHeightPoints - heightPoints) <= 1, ...
    "oi_export_figure:InvalidPdfDimensions", ...
    "PDF MediaBox %.3fx%.3f pt (%d pages) must match requested %.3fx%.3f pt", ...
    pdfWidthPoints, pdfHeightPoints, pdfPages, widthPoints, heightPoints);
textEvidence = collect_text(figureHandle);
axesEvidence = collect_axes(figureHandle);
containerEvidence = collect_layout_containers(figureHandle);
assert(~isempty(textEvidence) && ~isempty(axesEvidence), ...
    "oi_export_figure:MissingLayoutEvidence", ...
    "A publication export requires visible nonempty text and axes evidence");
allEvidence = [textEvidence(:); axes_as_layout_evidence(axesEvidence); ...
    containerEvidence(:)];
clippedCount = sum([allEvidence.clipped]);
assert(clippedCount == 0, "oi_export_figure:ClippedContent", ...
    "Visible text or axes extend outside the export canvas");
textOverlapCount = count_text_overlaps(textEvidence);
assert(textOverlapCount == 0, "oi_export_figure:OverlappingText", ...
    "Visible text objects overlap in the final export layout");
normalizedMargins = layout_margins(allEvidence);
[fontSelectionVerified, cjkTextPresent, cjkFontVerified, selectedFonts] = font_audit( ...
    figureHandle, textEvidence, axesEvidence);
assert(fontSelectionVerified, "oi_export_figure:FontUnavailable", ...
    "Every visible text and axes font must match an installed MATLAB font");
assert(~cjkTextPresent || cjkFontVerified, "oi_export_figure:CJKFontUnavailable", ...
    "CJK text requires a configured CJK-capable font on every text-bearing object");
altText = make_alt_text(options.Title, axesEvidence);
svgInfo = struct([]);
if options.ExportSVG
    annotate_svg(svgPath, options.Title, altText, widthPoints, heightPoints, ...
        widthPixels, heightPixels);
    svgInfo = verify_file(svgPath, "svg");
end
entry = struct();
entry.id = figureId;
entry.title = options.Title;
entry.source = options.Source;
entry.theme = options.Theme;
entry.text_objects = textEvidence;
entry.axes_objects = axesEvidence;
[measuredContrast, foregroundColor, backgroundColor] = figure_contrast(figureHandle);
[colorblindSafe, redundantEncoding, colorAudit] = color_accessibility_audit(figureHandle);
assert(redundantEncoding, ...
    "oi_export_figure:ColorAccessibility", ...
    "Final series require non-color redundant encoding");
contrastRatio = measuredContrast;
if ~isnan(options.ContrastRatio)
    assert(abs(options.ContrastRatio - measuredContrast) <= 0.15, ...
        "oi_export_figure:ContrastMismatch", ...
        "ContrastRatio must match the measured visible axes color pair");
end
assert(isfinite(contrastRatio) && contrastRatio >= 4.5, ...
    "oi_export_figure:Contrast", "Text and axes colors must meet WCAG AA contrast");
entry.accessibility = struct("alt_text", altText, ...
    "contrast_ratio", contrastRatio, "foreground_color", foregroundColor, ...
    "background_color", backgroundColor, "color_only_encoding", ~redundantEncoding, ...
    "cjk_text_present", cjkTextPresent, "cjk_font_verified", cjkFontVerified, ...
    "selected_fonts", selectedFonts, "grayscale_redundant", redundantEncoding, ...
    "color_vision_simulation", colorAudit);
entry.rendering_evidence = struct("drawnow_completed", true, ...
    "bounds_audited", true, "bounds_units", "normalized", ...
    "clipped_count", clippedCount, "text_overlap_count", textOverlapCount, ...
    "normalized_margins", normalizedMargins, ...
    "font_selection_verified", fontSelectionVerified, ...
    "cjk_font_candidate_verified", cjkFontVerified, ...
    "cjk_font_evidence", struct("text_present", cjkTextPresent, ...
        "candidate_verified", cjkFontVerified, ...
        "selected_fonts", selectedFonts, ...
        "verification_method", "installed font-name allowlist", ...
        "glyph_rendering_verified", false), ...
    "png_embedded_dpi_verified", isfinite(embeddedDpiX) && isfinite(embeddedDpiY), ...
    "physical_dimensions_verified", true, ...
    "visual_inspection_verified", false, ...
    "pdf_font_embedding_verified", false);
entry.artifact_freshness = struct( ...
    "export_started_at", exportStartedAt, ...
    "export_completed_at", utc_timestamp(), ...
    "created_in_unique_staging_directory", true, ...
    "preexisting_destination_rejected", true, ...
    "content_verified_before_promotion", true, ...
    "promotion_strategy", "same-filesystem rename");
entry.publication = struct( ...
    "layout", struct("stable", true, "overlap_count", textOverlapCount, ...
        "clipped_count", clippedCount, "margins", normalizedMargins), ...
    "typography", struct("selected_fonts", selectedFonts, ...
        "glyphs_verified", false, "cjk_verified", false, ...
        "pdf_fonts_embedded", false), ...
    "color", struct("colorblind_safe", false, ...
        "automated_palette_safe", colorblindSafe, ...
        "redundant_encoding", redundantEncoding, "audit", colorAudit));
entry.interaction = struct("requested", false, "enabled", false, ...
    "desktop_available", logical(usejava("desktop")), ...
    "data_tips", false, "brush_selection", false, ...
    "keyboard_accessible", false, "observation_id_mapping", false, ...
    "cleanup_verified", false, ...
    "headless", struct("supported", true, "mode", "static_export", ...
        "verified", string(figureHandle.Visible) == "off"));
entry.runtime = runtime_evidence(figureHandle, requiredToolboxes, installedToolboxes, ...
    exportGraphicsAvailable, pdfApi, pdfDevice, options.ExportSVG, directSvgAvailable);
entry.exports = struct( ...
    "png", struct("figure_id", figureId, "title", options.Title, ...
        "source", options.Source, "theme", options.Theme, ...
        "file", figureId + ".png", "width", imageInfo.Width, ...
        "height", imageInfo.Height, "dpi", dpi, "bytes", pngInfo.bytes, ...
        "embedded_dpi_x", embeddedDpiX, "embedded_dpi_y", embeddedDpiY, ...
        "physical_width_in", widthInches, "physical_height_in", heightInches, ...
        "sha256", pngInfo.sha256, "export_api", entry.runtime.export_api.png), ...
    "pdf", struct("figure_id", figureId, "title", options.Title, ...
        "source", options.Source, "theme", options.Theme, ...
        "file", figureId + ".pdf", "width", pdfWidthPoints, ...
        "height", pdfHeightPoints, "pages", pdfPages, "bytes", pdfInfo.bytes, ...
        "physical_width_in", widthInches, "physical_height_in", heightInches, ...
        "sha256", pdfInfo.sha256, "export_api", entry.runtime.export_api.pdf, ...
        "text", strjoin(string({textEvidence.string}), " | ")));
if options.ExportSVG
    svgTitle = strtrim(options.Title);
    if strlength(svgTitle) == 0
        svgTitle = "Scientific figure";
    end
    entry.exports.svg = struct("figure_id", figureId, "title", svgTitle, ...
        "source", options.Source, "theme", options.Theme, ...
        "file", figureId + ".svg", "width", widthPixels, ...
        "height", heightPixels, "viewbox_width", widthPixels, ...
        "viewbox_height", heightPixels, "bytes", svgInfo.bytes, ...
        "physical_width_in", widthInches, "physical_height_in", heightInches, ...
        "sha256", svgInfo.sha256, "export_api", entry.runtime.export_api.svg, ...
        "export_device", entry.runtime.export_device.svg, "description", altText, ...
        "accessible_name", altText);
end
try
    promote_artifacts(stagedArtifactPaths, finalArtifactPaths);
    verify_promoted_artifacts(finalArtifactPaths, entry.exports);
catch errorRecord
    delete_artifacts(finalArtifactPaths);
    rethrow(errorRecord);
end
clear artifactCleanup;
end

function cleanup_staging_export(stagedArtifactPaths, stagingDirectory)
delete_artifacts(stagedArtifactPaths);
if isfolder(stagingDirectory)
    rmdir(stagingDirectory, "s");
end
end

function available = has_exportgraphics()
available = exist("exportgraphics", "file") == 2 || exist("exportgraphics", "builtin") == 5;
end

function available = has_direct_svg_export()
available = has_exportgraphics() && ~verLessThan("matlab", "25.1");
end

function info = verify_file(filePath, format)
assert(isfile(filePath), "oi_export_figure:MissingArtifact", ...
    "Expected export does not exist: %s", filePath);
fileInfo = dir(filePath);
assert(fileInfo.bytes > 0, "oi_export_figure:EmptyArtifact", ...
    "Export is empty: %s", filePath);
prefix = oi_read_file_prefix(filePath, 8192);
if format == "png"
    pngSignature = uint8([137 80 78 71 13 10 26 10]);
    validSignature = numel(prefix) >= numel(pngSignature) ...
        && isequal(prefix(1:numel(pngSignature))', pngSignature);
elseif format == "pdf"
    validSignature = numel(prefix) >= 5 && strcmp(char(prefix(1:5))', '%PDF-');
elseif format == "svg"
    validSignature = ~isempty(regexpi(char(prefix'), "<svg(?=[\\s>])", "once"));
else
    validSignature = false;
end
assert(validSignature, "oi_export_figure:InvalidArtifactSignature", ...
    "Export does not contain a valid %s signature: %s", upper(format), filePath);
[digest] = oi_sha256_file(filePath);
afterHash = dir(filePath);
assert(isscalar(afterHash) && afterHash.bytes == fileInfo.bytes, ...
    "oi_export_figure:ArtifactChanged", ...
    "Export changed while its metadata was collected: %s", filePath);
info = struct("bytes", afterHash.bytes, "sha256", digest);
end

function [dpiX, dpiY] = png_physical_dpi(filePath)
fileHandle = fopen(filePath, "rb");
assert(fileHandle >= 0, "oi_export_figure:ReadFailed", ...
    "Cannot inspect PNG metadata: %s", filePath);
cleanup = onCleanup(@() fclose(fileHandle));
signature = fread(fileHandle, 8, "*uint8")';
assert(isequal(signature, uint8([137 80 78 71 13 10 26 10])), ...
    "oi_export_figure:InvalidArtifactSignature", "PNG signature is invalid");
dpiX = NaN;
dpiY = NaN;
physicalChunkSeen = false;
while true
    chunkLength = fread(fileHandle, 1, "uint32", 0, "ieee-be");
    if isempty(chunkLength)
        break;
    end
    chunkType = char(fread(fileHandle, 4, "*uint8")');
    chunkData = fread(fileHandle, double(chunkLength), "*uint8")';
    chunkCrc = fread(fileHandle, 4, "*uint8");
    assert(numel(chunkType) == 4 && numel(chunkData) == double(chunkLength) ...
        && numel(chunkCrc) == 4, "oi_export_figure:InvalidPng", ...
        "PNG contains a truncated chunk");
    if strcmp(chunkType, 'pHYs')
        assert(~physicalChunkSeen && chunkLength == 9, ...
            "oi_export_figure:InvalidPng", ...
            "PNG must contain at most one valid pHYs chunk");
        physicalChunkSeen = true;
        if chunkData(9) == 1
            pixelsPerMeterX = double(typecast(uint8(chunkData(1:4)), "uint32"));
            pixelsPerMeterY = double(typecast(uint8(chunkData(5:8)), "uint32"));
            [~, ~, endian] = computer;
            if endian == 'L'
                pixelsPerMeterX = double(swapbytes(uint32(pixelsPerMeterX)));
                pixelsPerMeterY = double(swapbytes(uint32(pixelsPerMeterY)));
            end
            dpiX = pixelsPerMeterX * 0.0254;
            dpiY = pixelsPerMeterY * 0.0254;
        end
    elseif strcmp(chunkType, 'IDAT')
        break;
    elseif strcmp(chunkType, 'IEND')
        break;
    end
end
clear cleanup;
end

function pathValue = canonical_path(pathValue)
if usejava("jvm")
    pathValue = string(char(java.io.File(char(pathValue)).getCanonicalPath()));
    return;
end
[status, attributes] = fileattrib(char(pathValue));
assert(status, "oi_export_figure:JVMRequired", ...
    "Canonical path resolution failed without the MATLAB JVM: %s", pathValue);
pathValue = string(attributes.Name);
end

function [widthPoints, heightPoints, pageCount] = pdf_geometry(filePath)
fileHandle = fopen(filePath, "rb");
assert(fileHandle >= 0, "oi_export_figure:ReadFailed", ...
    "Cannot inspect PDF geometry: %s", filePath);
cleanup = onCleanup(@() fclose(fileHandle));
pdfText = char(fread(fileHandle, Inf, "*uint8")');
clear cleanup;
pageCount = numel(regexp(pdfText, "/Type\s*/Page(?!s)", "match"));
tokens = regexp(pdfText, ...
    "/MediaBox\s*\[\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\]", ...
    "tokens");
assert(~isempty(tokens), "oi_export_figure:InvalidPdfDimensions", ...
    "PDF does not expose a readable MediaBox");
dimensions = zeros(numel(tokens), 2);
for index = 1:numel(tokens)
    values = str2double(tokens{index});
    dimensions(index, :) = [abs(values(3) - values(1)) abs(values(4) - values(2))];
end
dimensions = unique(round(dimensions, 6), "rows");
assert(size(dimensions, 1) == 1, "oi_export_figure:InvalidPdfDimensions", ...
    "PDF pages do not share one physical size");
widthPoints = dimensions(1, 1);
heightPoints = dimensions(1, 2);
end

function [requiredToolboxes, installedToolboxes] = validate_required_toolboxes(requestedToolboxes)
requiredToolboxes = strtrim(requestedToolboxes(:));
assert(all(~ismissing(requiredToolboxes)) && all(strlength(requiredToolboxes) > 0), ...
    "oi_export_figure:InvalidToolboxName", ...
    "RequiredToolboxes must contain nonempty product names returned by ver");
requiredToolboxes = unique(requiredToolboxes, "stable");
products = ver;
installedToolboxes = sort(string({products.Name})');
missingToolboxes = requiredToolboxes(~ismember(lower(requiredToolboxes), ...
    lower(installedToolboxes)));
assert(isempty(missingToolboxes), "oi_export_figure:MissingToolbox", ...
    "Required MATLAB product is not installed: %s", strjoin(missingToolboxes, ", "));
end

function evidence = runtime_evidence(figureHandle, requiredToolboxes, installedToolboxes, exportGraphicsAvailable, pdfApi, pdfDevice, svgRequested, directSvgAvailable)
batchMode = false;
if exist("batchStartupOptionUsed", "file") == 2 ...
        || exist("batchStartupOptionUsed", "builtin") == 5
    batchMode = logical(batchStartupOptionUsed());
end
if exportGraphicsAvailable
    pngApi = "exportgraphics";
else
    pngApi = "print";
end
svgApi = "not_requested";
svgDevice = "";
if svgRequested
    if directSvgAvailable
        svgApi = "exportgraphics";
    else
        svgApi = "print";
        svgDevice = "-dsvg";
    end
end
visible = string(figureHandle.Visible);
evidence = struct("minimum_release", "R2019b", ...
    "matlab_version", string(version), ...
    "matlab_release", string(version("-release")), ...
    "jvm_available", logical(usejava("jvm")), ...
    "desktop_available", logical(usejava("desktop")), ...
    "display_environment_present", strlength(string(getenv("DISPLAY"))) > 0, ...
    "batch_startup_option_used", batchMode, ...
    "figure_visible", visible, ...
    "headless_static_export", visible == "off", ...
    "required_toolboxes", requiredToolboxes, ...
    "installed_toolboxes", installedToolboxes, ...
    "toolboxes_verified", true, ...
    "toolbox_verification", "installed product names returned by ver", ...
    "toolbox_installation_verified", true, ...
    "toolbox_license_verified", false, ...
    "toolbox_invocation_verified", false, ...
    "export_api", struct("png", pngApi, "pdf", pdfApi, "svg", svgApi), ...
    "export_device", struct("png", "", "pdf", pdfDevice, "svg", svgDevice));
end

function annotate_svg(svgPath, requestedTitle, description, widthPoints, heightPoints, widthPixels, heightPixels)
assert(isfile(svgPath), "oi_export_figure:MissingArtifact", ...
    "Expected SVG export does not exist: %s", svgPath);
if ~(exist("xmlread", "file") == 2 && exist("xmlwrite", "file") == 2)
    annotate_svg_text(svgPath, requestedTitle, description, widthPoints, ...
        heightPoints, widthPixels, heightPixels);
    return;
end
document = xmlread(char(svgPath));
root = document.getDocumentElement();
assert(strcmpi(char(root.getNodeName()), 'svg'), ...
    "oi_export_figure:InvalidSvg", "SVG export has no svg root element");
titleText = strtrim(requestedTitle);
if strlength(titleText) == 0
    titleText = "Scientific figure";
end
root.setAttribute('width', char(string(widthPixels) + "px"));
root.setAttribute('height', char(string(heightPixels) + "px"));
root.setAttribute('viewBox', char(compose("0 0 %d %d", widthPixels, heightPixels)));
root.setAttribute('style', char(compose("width:%.9gin;height:%.9gin", ...
    widthPoints / 72, heightPoints / 72)));
root.setAttribute('data-physical-width-in', char(compose("%.9g", widthPoints / 72)));
root.setAttribute('data-physical-height-in', char(compose("%.9g", heightPoints / 72)));
root.setAttribute('role', 'img');
root.setAttribute('aria-label', char(description));
titleNode = document.createElement('title');
titleNode.appendChild(document.createTextNode(char(titleText)));
descriptionNode = document.createElement('desc');
descriptionNode.appendChild(document.createTextNode(char(description)));
firstChild = root.getFirstChild();
root.insertBefore(descriptionNode, firstChild);
root.insertBefore(titleNode, descriptionNode);
xmlwrite(char(svgPath), document);
end

function annotate_svg_text(svgPath, requestedTitle, description, widthPoints, heightPoints, widthPixels, heightPixels)
svgText = string(fileread(svgPath));
rootStart = regexp(svgText, "<svg(?=[\\s>])", "start", "once");
assert(~isempty(rootStart), "oi_export_figure:InvalidSvg", ...
    "SVG export has no svg root element");
relativeEnd = regexp(extractAfter(svgText, rootStart - 1), ">", "end", "once");
assert(~isempty(relativeEnd), "oi_export_figure:InvalidSvg", ...
    "SVG root element is not terminated");
rootEnd = rootStart + relativeEnd - 1;
titleText = strtrim(requestedTitle);
if strlength(titleText) == 0
    titleText = "Scientific figure";
end
attributes = compose(" width=\"%dpx\" height=\"%dpx\" viewBox=\"0 0 %d %d\" style=\"width:%.9gin;height:%.9gin\" data-physical-width-in=\"%.9g\" data-physical-height-in=\"%.9g\" role=\"img\" aria-label=\"%s\"", ...
    widthPixels, heightPixels, widthPixels, heightPixels, widthPoints / 72, ...
    heightPoints / 72, widthPoints / 72, heightPoints / 72, xml_escape(description));
openingTag = extractBetween(svgText, rootStart, rootEnd - 1) + attributes + ">";
accessibleNodes = "<title>" + xml_escape(titleText) + "</title><desc>" ...
    + xml_escape(description) + "</desc>";
svgText = extractBefore(svgText, rootStart) + openingTag + accessibleNodes ...
    + extractAfter(svgText, rootEnd);
fileHandle = fopen(svgPath, "w", "n", "UTF-8");
assert(fileHandle >= 0, "oi_export_figure:WriteFailed", ...
    "Cannot rewrite SVG accessibility metadata: %s", svgPath);
cleanup = onCleanup(@() fclose(fileHandle));
fwrite(fileHandle, unicode2native(char(svgText), "UTF-8"), "uint8");
end

function value = xml_escape(value)
value = replace(string(value), "&", "&amp;");
value = replace(value, "<", "&lt;");
value = replace(value, ">", "&gt;");
value = replace(value, '"', "&quot;");
value = replace(value, "'", "&apos;");
end

function apply_export_font(figureHandle)
installedFonts = string(listfonts);
fontObjects = findall(figureHandle, "-property", "FontName");
assert(~isempty(fontObjects), "oi_export_figure:FontUnavailable", ...
    "The figure contains no font-bearing graphics objects");
allText = strings(0, 1);
stringObjects = findall(figureHandle, "-property", "String");
for index = 1:numel(stringObjects)
    try
        allText(end + 1, 1) = strjoin(string(stringObjects(index).String), " "); %#ok<AGROW>
    catch
    end
end
cjkPresent = contains_cjk(strjoin(allText, " "));
candidates = ["Noto Sans CJK SC" "Noto Sans CJK TC" "Noto Sans CJK HK" ...
    "Noto Sans CJK JP" "Noto Sans CJK KR" "Source Han Sans SC" ...
    "WenQuanYi Zen Hei" "Droid Sans Fallback" "Microsoft YaHei" ...
    "PingFang SC" "SimHei" ...
    "SimSun" "Arial Unicode MS"];
selectedFont = "";
if isappdata(figureHandle, "OI_OceanTheme")
    theme = getappdata(figureHandle, "OI_OceanTheme");
    if isstruct(theme) && isfield(theme, "FontName") ...
            && publication_font_available(string(theme.FontName), installedFonts)
        selectedFont = string(theme.FontName);
    end
end
if cjkPresent && (strlength(selectedFont) == 0 || ~is_cjk_font(selectedFont))
    candidateAvailable = false(size(candidates));
    for index = 1:numel(candidates)
        candidateAvailable(index) = publication_font_available(candidates(index), installedFonts);
    end
    match = candidates(candidateAvailable);
    assert(~isempty(match), "oi_export_figure:CJKFontUnavailable", ...
        "CJK text is present but no configured CJK-capable font is installed");
    selectedFont = match(1);
end
if strlength(selectedFont) == 0
    currentFonts = string(get(fontObjects, "FontName"));
    available = false(size(currentFonts));
    for index = 1:numel(currentFonts)
        available(index) = publication_font_available(currentFonts(index), installedFonts);
    end
    currentFonts = currentFonts(available);
    assert(~isempty(currentFonts), "oi_export_figure:FontUnavailable", ...
        "No selected figure font matches an installed MATLAB font");
    selectedFont = currentFonts(1);
end
for index = 1:numel(fontObjects)
    fontObjects(index).FontName = selectedFont;
end
if cjkPresent
    for index = 1:numel(stringObjects)
        try
            objectText = strjoin(string(stringObjects(index).String), " ");
            if contains_cjk(objectText) && isprop(stringObjects(index), "Interpreter")
                stringObjects(index).Interpreter = "none";
            end
        catch
        end
    end
end
end

function print_exact_pdf(figureHandle, pdfPath, widthInches, heightInches)
figureHandle.PaperUnits = "inches";
figureHandle.PaperOrientation = "portrait";
figureHandle.PaperSize = [widthInches heightInches];
figureHandle.PaperPosition = [0 0 widthInches heightInches];
figureHandle.PaperPositionMode = "manual";
print(figureHandle, char(pdfPath), "-dpdf", "-painters");
end

function evidence = collect_text(figureHandle)
objects = findall(figureHandle, "Type", "text");
evidence = repmat(struct("role", "text", "string", "", "font_name", "", ...
    "font_size", 0, "bounds", [0 0 0 0], "bounds_units", "normalized", ...
    "clip_mode", "off", "clipped", false), numel(objects), 1);
visibleIndex = 0;
for index = 1:numel(objects)
    if isprop(objects(index), "Visible") && string(objects(index).Visible) ~= "on"
        continue;
    end
    renderedString = strjoin(string(objects(index).String), " ");
    if strlength(strtrim(renderedString)) == 0
        continue;
    end
    visibleIndex = visibleIndex + 1;
    evidence(visibleIndex).role = string(objects(index).Tag);
    if strlength(evidence(visibleIndex).role) == 0
        evidence(visibleIndex).role = "text";
    end
    evidence(visibleIndex).string = renderedString;
    if isprop(objects(index), "FontName")
        evidence(visibleIndex).font_name = string(objects(index).FontName);
    end
    if isprop(objects(index), "FontSize")
        evidence(visibleIndex).font_size = objects(index).FontSize;
    end
    evidence(visibleIndex).bounds = text_bounds(objects(index), figureHandle);
    if isprop(objects(index), "Clipping")
        evidence(visibleIndex).clip_mode = string(objects(index).Clipping);
    end
    evidence(visibleIndex).clipped = ~bounds_inside_canvas( ...
        evidence(visibleIndex).bounds);
end
evidence = evidence(1:visibleIndex);
end

function evidence = collect_axes(figureHandle)
objects = collect_visible_axes(figureHandle);
evidence = repmat(struct("id", "", "xlabel", "", "ylabel", "", ...
    "font_name", "", "font_size", 0, "bounds", [0 0 0 0], ...
    "bounds_units", "normalized", "clipped", false), numel(objects), 1);
for index = 1:numel(objects)
    evidence(index).id = "axes-" + string(index);
    if isprop(objects(index), "XLabel") && isgraphics(objects(index).XLabel)
        evidence(index).xlabel = strjoin(string(objects(index).XLabel.String), " ");
    end
    if isprop(objects(index), "YLabel") && isgraphics(objects(index).YLabel)
        evidence(index).ylabel = strjoin(string(objects(index).YLabel.String), " ");
    end
    if isappdata(objects(index), "OI_AxisLabels")
        axisLabels = getappdata(objects(index), "OI_AxisLabels");
        if isstruct(axisLabels) && isfield(axisLabels, "xlabel") ...
                && strlength(string(evidence(index).xlabel)) == 0
            evidence(index).xlabel = string(axisLabels.xlabel);
        end
        if isstruct(axisLabels) && isfield(axisLabels, "ylabel") ...
                && strlength(string(evidence(index).ylabel)) == 0
            evidence(index).ylabel = string(axisLabels.ylabel);
        end
    end
    if isprop(objects(index), "FontName")
        evidence(index).font_name = string(objects(index).FontName);
    end
    if isprop(objects(index), "FontSize")
        evidence(index).font_size = objects(index).FontSize;
    end
    evidence(index).bounds = graphics_bounds(objects(index), figureHandle);
    evidence(index).clipped = ~bounds_inside_canvas(evidence(index).bounds);
end
end

function evidence = collect_layout_containers(figureHandle)
allObjects = findall(figureHandle);
evidence = repmat(struct("role", "container", "string", "", ...
    "font_name", "", "font_size", 0, "bounds", [0 0 0 0], ...
    "bounds_units", "normalized", "clip_mode", "off", ...
    "clipped", false), numel(allObjects), 1);
visibleIndex = 0;
for index = 1:numel(allObjects)
    object = allObjects(index);
    className = string(class(object));
    isContainer = contains(className, "Legend") || contains(className, "ColorBar");
    if ~isContainer || (isprop(object, "Visible") && string(object.Visible) ~= "on")
        continue;
    end
    visibleIndex = visibleIndex + 1;
    evidence(visibleIndex).role = lower(extractAfter(className, "."));
    if isprop(object, "FontName")
        evidence(visibleIndex).font_name = string(object.FontName);
    end
    if isprop(object, "FontSize")
        evidence(visibleIndex).font_size = double(object.FontSize);
    end
    evidence(visibleIndex).bounds = graphics_bounds(object, figureHandle);
    evidence(visibleIndex).clipped = ~bounds_inside_canvas( ...
        evidence(visibleIndex).bounds);
end
evidence = evidence(1:visibleIndex);
end

function objects = collect_visible_axes(figureHandle)
allObjects = findall(figureHandle);
objects = gobjects(0, 1);
for index = 1:numel(allObjects)
    candidate = allObjects(index);
    isAxes = isgraphics(candidate, "axes") ...
        || isa(candidate, "matlab.graphics.axis.PolarAxes");
    if ~isAxes || (isprop(candidate, "Visible") ...
            && string(candidate.Visible) ~= "on")
        continue;
    end
    objects(end + 1, 1) = candidate; %#ok<AGROW>
end
end

function bounds = text_bounds(textHandle, figureHandle)
originalUnits = textHandle.Units;
cleanup = onCleanup(@() set(textHandle, "Units", originalUnits));
textHandle.Units = "normalized";
extent = double(textHandle.Extent);
parentBounds = graphics_bounds(textHandle.Parent, figureHandle);
bounds = [parentBounds(1) + extent(1) * parentBounds(3), ...
    parentBounds(2) + extent(2) * parentBounds(4), ...
    extent(3) * parentBounds(3), extent(4) * parentBounds(4)];
clear cleanup;
end

function bounds = graphics_bounds(graphicsHandle, figureHandle)
if graphicsHandle == figureHandle
    bounds = [0 0 1 1];
    return;
end
try
    figurePixels = getpixelposition(figureHandle);
    objectPixels = getpixelposition(graphicsHandle, true);
    bounds = [(objectPixels(1) - 1) / figurePixels(3), ...
        (objectPixels(2) - 1) / figurePixels(4), ...
        objectPixels(3) / figurePixels(3), objectPixels(4) / figurePixels(4)];
catch
    bounds = [0 0 1 1];
    if isprop(graphicsHandle, "Units") && isprop(graphicsHandle, "Position")
        originalUnits = graphicsHandle.Units;
        cleanup = onCleanup(@() set(graphicsHandle, "Units", originalUnits));
        graphicsHandle.Units = "normalized";
        bounds = double(graphicsHandle.Position);
        clear cleanup;
    end
end
assert(numel(bounds) == 4 && all(isfinite(bounds)) ...
    && all(bounds(3:4) > 0), "oi_export_figure:InvalidBounds", ...
    "A visible graphics object has invalid layout bounds");
end

function inside = bounds_inside_canvas(bounds)
tolerance = 0.01;
inside = bounds(1) >= -tolerance && bounds(2) >= -tolerance ...
    && bounds(1) + bounds(3) <= 1 + tolerance ...
    && bounds(2) + bounds(4) <= 1 + tolerance;
end

function evidence = axes_as_layout_evidence(axesEvidence)
evidence = repmat(struct("role", "axes", "string", "", "font_name", "", ...
    "font_size", 0, "bounds", [0 0 0 0], "bounds_units", "normalized", ...
    "clip_mode", "off", "clipped", false), numel(axesEvidence), 1);
for index = 1:numel(axesEvidence)
    evidence(index).font_name = axesEvidence(index).font_name;
    evidence(index).font_size = axesEvidence(index).font_size;
    evidence(index).bounds = axesEvidence(index).bounds;
    evidence(index).clipped = axesEvidence(index).clipped;
end
end

function [verified, cjkPresent, cjkVerified, selectedFonts] = font_audit(figureHandle, textEvidence, axesEvidence)
fontObjects = findall(figureHandle, "-property", "FontName");
fontNames = strings(numel(fontObjects), 1);
for index = 1:numel(fontObjects)
    fontNames(index) = string(fontObjects(index).FontName);
end
installedFonts = string(listfonts);
fontAvailable = false(size(fontNames));
for index = 1:numel(fontNames)
    fontAvailable(index) = publication_font_available(fontNames(index), installedFonts);
end
verified = ~isempty(fontNames) && all(strlength(fontNames) > 0) ...
    && all(fontAvailable);
renderedText = strjoin([string({textEvidence.string}) ...
    string({axesEvidence.xlabel}) string({axesEvidence.ylabel})], " ");
cjkPresent = contains_cjk(renderedText);
cjkVerified = ~cjkPresent || all(is_cjk_font(fontNames));
selectedFonts = sort(unique(fontNames));
end

function available = publication_font_available(fontName, installedFonts)
fontName = strtrim(string(fontName));
available = strlength(fontName) > 0 ...
    && any(strcmpi(installedFonts, fontName));
if available || ~isunix
    return;
end
command = sprintf("fc-match -f '%%{family}' '%s' 2>/dev/null", char(fontName));
[status, output] = system(command);
available = status == 0 && contains(lower(string(output)), lower(fontName));
end

function present = contains_cjk(textValue)
codeUnits = double(char(textValue));
present = any((codeUnits >= hex2dec("3400") & codeUnits <= hex2dec("9FFF")) ...
    | (codeUnits >= hex2dec("F900") & codeUnits <= hex2dec("FAFF")) ...
    | (codeUnits >= hex2dec("3040") & codeUnits <= hex2dec("30FF")) ...
    | (codeUnits >= hex2dec("AC00") & codeUnits <= hex2dec("D7AF")));
end

function valid = is_cjk_font(fontNames)
normalized = lower(fontNames);
tokens = ["noto sans cjk" "source han" "yahei" "pingfang" ...
    "wenquanyi" "droid sans fallback" "simhei" "simsun" ...
    "heiti" "songti" "arial unicode"];
valid = false(size(normalized));
for index = 1:numel(tokens)
    valid = valid | contains(normalized, tokens(index));
end
end

function [ratio, foreground, background] = figure_contrast(figureHandle)
axesObjects = collect_visible_axes(figureHandle);
ratio = Inf;
foreground = [];
background = [];
for index = 1:numel(axesObjects)
    candidateForeground = axes_color(axesObjects(index), "XColor", "ThetaColor");
    candidateBackground = axes_color(axesObjects(index), "Color", "");
    if isempty(candidateBackground) && isnumeric(figureHandle.Color)
        candidateBackground = double(figureHandle.Color);
    end
    if numel(candidateForeground) ~= 3 || numel(candidateBackground) ~= 3
        continue;
    end
    candidateRatio = color_contrast(candidateForeground, candidateBackground);
    if candidateRatio < ratio
        ratio = candidateRatio;
        foreground = candidateForeground;
        background = candidateBackground;
    end
end
assert(isfinite(ratio), "oi_export_figure:ContrastUnavailable", ...
    "A numeric visible axes foreground/background color pair is required");
end

function colorValue = axes_color(axesHandle, primaryProperty, fallbackProperty)
colorValue = [];
if isprop(axesHandle, primaryProperty) && isnumeric(axesHandle.(primaryProperty))
    colorValue = double(axesHandle.(primaryProperty));
elseif strlength(fallbackProperty) > 0 && isprop(axesHandle, fallbackProperty) ...
        && isnumeric(axesHandle.(fallbackProperty))
    colorValue = double(axesHandle.(fallbackProperty));
end
end

function [safe, redundant, audit] = color_accessibility_audit(figureHandle)
axesObjects = collect_visible_axes(figureHandle);
redundant = true;
paletteSafe = true;
minimumDistance = Inf;
seriesCount = 0;
for axesIndex = 1:numel(axesObjects)
    series = findall(axesObjects(axesIndex), "Type", "line", ...
        "-or", "Type", "scatter");
    series = flipud(series(:));
    seriesCount = seriesCount + numel(series);
    if numel(series) > 1
        encodings = strings(numel(series), 1);
        colors = zeros(numel(series), 3);
        validColors = true(numel(series), 1);
        for seriesIndex = 1:numel(series)
            lineStyle = property_string(series(seriesIndex), "LineStyle", "none");
            marker = property_string(series(seriesIndex), "Marker", "none");
            encodings(seriesIndex) = lineStyle + "|" + marker;
            if isprop(series(seriesIndex), "Color") ...
                    && isnumeric(series(seriesIndex).Color) ...
                    && numel(series(seriesIndex).Color) == 3
                colors(seriesIndex, :) = double(series(seriesIndex).Color);
            else
                validColors(seriesIndex) = false;
            end
        end
        redundant = redundant && numel(unique(encodings)) == numel(encodings);
        colors = colors(validColors, :);
        [axesPaletteSafe, axesMinimumDistance] = simulated_palette_separation(colors);
        paletteSafe = paletteSafe && axesPaletteSafe;
        minimumDistance = min(minimumDistance, axesMinimumDistance);
    end
end
if isinf(minimumDistance)
    minimumDistance = NaN;
end
safe = paletteSafe || redundant;
audit = struct("method", "deterministic protanopia/deuteranopia/tritanopia RGB simulation", ...
    "simulations", ["protanopia" "deuteranopia" "tritanopia"], ...
    "minimum_pair_distance", minimumDistance, ...
    "minimum_required_distance", 0.08, ...
    "palette_distinct", paletteSafe, "redundant_encoding", redundant, ...
    "series_count", seriesCount, "visual_inspection_verified", false);
end

function value = property_string(object, propertyName, fallback)
value = string(fallback);
if isprop(object, propertyName)
    value = string(object.(propertyName));
end
end

function [safe, minimumDistance] = simulated_palette_separation(colors)
if size(colors, 1) < 2
    safe = true;
    minimumDistance = Inf;
    return;
end
matrices = cat(3, ...
    [0.567 0.433 0; 0.558 0.442 0; 0 0.242 0.758], ...
    [0.625 0.375 0; 0.700 0.300 0; 0 0.300 0.700], ...
    [0.950 0.050 0; 0 0.433 0.567; 0 0.475 0.525]);
minimumDistance = Inf;
for matrixIndex = 1:size(matrices, 3)
    transformed = colors * matrices(:, :, matrixIndex)';
    for first = 1:size(transformed, 1)
        for second = first + 1:size(transformed, 1)
            minimumDistance = min(minimumDistance, ...
                norm(transformed(first, :) - transformed(second, :), 2));
        end
    end
end
safe = minimumDistance >= 0.08;
end

function count = count_text_overlaps(textEvidence)
count = 0;
for first = 1:numel(textEvidence)
    for second = first + 1:numel(textEvidence)
        if rectangles_overlap(textEvidence(first).bounds, textEvidence(second).bounds)
            count = count + 1;
        end
    end
end
end

function overlap = rectangles_overlap(first, second)
overlap = first(1) < second(1) + second(3) ...
    && second(1) < first(1) + first(3) ...
    && first(2) < second(2) + second(4) ...
    && second(2) < first(2) + first(4);
end

function margins = layout_margins(evidence)
bounds = vertcat(evidence.bounds);
margins = [min(bounds(:,1)) min(bounds(:,2)) ...
    1 - max(bounds(:,1) + bounds(:,3)) ...
    1 - max(bounds(:,2) + bounds(:,4))];
assert(all(isfinite(margins)) && all(margins >= -1e-6), ...
    "oi_export_figure:InvalidMargins", ...
    "Final normalized layout margins must be finite and nonnegative");
margins(abs(margins) < 1e-6) = 0;
end

function altText = make_alt_text(titleText, axesEvidence)
labels = strings(0, 1);
for index = 1:numel(axesEvidence)
    labels(end + 1, 1) = string(axesEvidence(index).xlabel); %#ok<AGROW>
    labels(end + 1, 1) = string(axesEvidence(index).ylabel); %#ok<AGROW>
end
labels = labels(strlength(labels) > 0);
if isempty(labels)
    altText = "Scientific figure: " + string(titleText);
else
    altText = "Scientific figure: " + string(titleText) + "; axes: " ...
        + strjoin(labels, "; ");
end
end

function ratio = color_contrast(foreground, background)
foregroundLuminance = relative_luminance(foreground);
backgroundLuminance = relative_luminance(background);
ratio = (max(foregroundLuminance, backgroundLuminance) + 0.05) ...
    / (min(foregroundLuminance, backgroundLuminance) + 0.05);
end

function luminance = relative_luminance(colorValue)
linear = colorValue;
low = linear <= 0.03928;
linear(low) = linear(low) / 12.92;
linear(~low) = ((linear(~low) + 0.055) / 1.055) .^ 2.4;
luminance = 0.2126 * linear(1) + 0.7152 * linear(2) + 0.0722 * linear(3);
end

function delete_artifacts(artifactPaths)
for pathIndex = 1:numel(artifactPaths)
    if isfile(artifactPaths(pathIndex))
        delete(artifactPaths(pathIndex));
    end
end
end

function promote_artifacts(stagedPaths, finalPaths)
assert(numel(stagedPaths) == numel(finalPaths), ...
    "oi_export_figure:PromotionMismatch", ...
    "Staged and final artifact sets must have the same size");
for pathIndex = 1:numel(stagedPaths)
    assert(~isfile(finalPaths(pathIndex)), "oi_export_figure:StaleArtifact", ...
        "A destination artifact appeared during export: %s", finalPaths(pathIndex));
    [moved, message] = movefile(stagedPaths(pathIndex), finalPaths(pathIndex));
    assert(moved, "oi_export_figure:PromotionFailed", ...
        "Cannot atomically promote %s: %s", finalPaths(pathIndex), message);
end
end

function verify_promoted_artifacts(finalPaths, exports)
formats = ["png" "pdf"];
if isfield(exports, "svg")
    formats(end + 1) = "svg";
end
for pathIndex = 1:numel(finalPaths)
    info = verify_file(finalPaths(pathIndex), formats(pathIndex));
    record = exports.(char(formats(pathIndex)));
    assert(info.bytes == record.bytes ...
        && strcmpi(string(info.sha256), string(record.sha256)), ...
        "oi_export_figure:PromotionVerification", ...
        "Promoted artifact differs from the verified staged artifact: %s", ...
        finalPaths(pathIndex));
end
end

function value = utc_timestamp()
value = char(datetime("now", "TimeZone", "UTC", ...
    "Format", "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"));
end
