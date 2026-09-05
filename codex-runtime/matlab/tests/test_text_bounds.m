function test_text_bounds()
%TEST_TEXT_BOUNDS Exercise rendered text geometry without claiming visual QA.
testDirectory = fileparts(mfilename("fullpath"));
assetDirectory = fullfile(testDirectory, "..", "assets");
originalPath = path;
pathCleanup = onCleanup(@() path(originalPath));
addpath(assetDirectory);
fontName = publication_font();

test_native_layout_text_diagnostics();
test_original_nested_geometry("Courier", "nested-courier");
test_original_nested_geometry(fontName, "nested-publication-original");
test_axes_text_and_rotation(fontName);
test_colorbar_label(fontName);
test_font_refresh(fontName);
test_true_clipping_case(fontName);
test_invalid_inputs(fontName);

clear pathCleanup;
fprintf("MATLAB_TEXT_BOUNDS=passed\n");
end

function test_native_layout_text_diagnostics()
figureHandle = make_pixel_figure([800 480]);
figureCleanup = onCleanup(@() close_if_valid(figureHandle));
layoutHandle = tiledlayout(figureHandle, 1, 1);
axesHandle = nexttile(layoutHandle);
plot(axesHandle, 0:4, [1 3 2 4 3]);
titleHandle = title(layoutHandle, "Native layout title");
xlabelHandle = xlabel(layoutHandle, "Time (UTC)");
ylabelHandle = ylabel(layoutHandle, "Sea temperature (degC)");
drawnow;

evidence = struct("release", version('-release'), ...
    "geometry_reference", "raw public API results in reported units; no bounds inferred");
evidence.figure_pixels = probe_public_api(@() getpixelposition(figureHandle));
evidence.layout_class = probe_public_api(@() class(layoutHandle));
evidence.layout_pixels_in_figure = probe_public_api(@() getpixelposition(layoutHandle, true));
evidence.Title = native_layout_text_record(titleHandle, figureHandle);
evidence.XLabel = native_layout_text_record(xlabelHandle, figureHandle);
evidence.YLabel = native_layout_text_record(ylabelHandle, figureHandle);
fprintf("MATLAB_NATIVE_LAYOUT_TEXT_DIAGNOSTIC=%s\n", jsonencode(evidence));
outputRoot = string(getenv("MATLAB_FULL100_OUTPUT"));
if strlength(outputRoot) > 0
    outputDirectory = fullfile(outputRoot, "text-bounds");
    if ~isfolder(outputDirectory)
        mkdir(outputDirectory);
    end
    write_evidence_json(fullfile(outputDirectory, "native-layout-text.json"), evidence);
end

clear figureCleanup;
close_if_valid(figureHandle);
end

function record = native_layout_text_record(textHandle, figureHandle)
record = struct();
record.class = probe_public_api(@() class(textHandle));
record.properties = probe_public_api(@() properties(textHandle));
for propertyName = ["Type" "String" "FontName" "FontSize" "Units" "Extent" "Position"]
    record.(char(propertyName)) = probe_public_api(@() get(textHandle, char(propertyName)));
end
record.getpixelposition = probe_public_api(@() getpixelposition(textHandle));
record.getpixelposition_recursive = probe_public_api(@() getpixelposition(textHandle, true));
record.isgraphics_text = probe_public_api(@() isgraphics(textHandle, "text"));
record.found_by_findall_type_text = probe_public_api(@() any(arrayfun( ...
    @(candidate) isequal(candidate, textHandle), findall(figureHandle, "Type", "text"))));
end

function result = probe_public_api(callback)
result = struct("succeeded", false, "value", [], "value_class", "", ...
    "value_size", [], "error_identifier", "", "error_message", "");
try
    value = callback();
    result.value = value;
    result.value_class = class(value);
    result.value_size = size(value);
    result.succeeded = true;
catch errorDetails
    result.error_identifier = errorDetails.identifier;
    result.error_message = errorDetails.message;
end
end

function test_axes_text_and_rotation(fontName)
[figureHandle, axesHandle, titleHandle, xlabelHandle, ylabelHandle, textHandle] ...
    = make_nested_figure(fontName);
figureCleanup = onCleanup(@() close_if_valid(figureHandle));
[~, beforeRender] = measure_bounds(xlabelHandle, figureHandle, "publication before renderer export");
export_nested_evidence(figureHandle, axesHandle, "nested-publication-unfitted", beforeRender);
fit_nested_bottom_margin(figureHandle, axesHandle, xlabelHandle);
[~, beforeFittedRender] = measure_bounds(xlabelHandle, figureHandle, "fitted before renderer export");
export_nested_evidence(figureHandle, axesHandle, "nested-publication-fitted", beforeFittedRender);

originalUnits = string(textHandle.Units);
[titleBounds, titleDetails] = measure_bounds(titleHandle, figureHandle, "axes title");
[xlabelBounds, xlabelDetails] = measure_bounds(xlabelHandle, figureHandle, "x label");
[ylabelBounds, ylabelDetails] = measure_bounds(ylabelHandle, figureHandle, "rotated y label");
[horizontalBounds, horizontalDetails] = measure_bounds(textHandle, figureHandle, "axes text");
assert(string(textHandle.Units) == originalUnits, ...
    "test_text_bounds:Units", "oi_text_bounds did not restore text Units");
assert_inside(titleBounds, "axes title", titleDetails);
assert_inside(xlabelBounds, "x label", xlabelDetails);
assert_inside(ylabelBounds, "rotated y label", ylabelDetails);
assert_inside(horizontalBounds, "axes text", horizontalDetails);
assert_centered_in_parent(horizontalBounds, axesHandle, figureHandle, [0.32 0.55]);
assert(horizontalBounds(3) > horizontalBounds(4), ...
    "test_text_bounds:HorizontalExtent", ...
    "Horizontal text must be wider than it is tall; geometry=%s", horizontalDetails);

textHandle.Rotation = 90;
[verticalBounds, verticalDetails] = render_text_state(textHandle, figureHandle, axesHandle, "nested-rotation-90");
assert_inside(verticalBounds, "90-degree axes text", verticalDetails);
assert(verticalBounds(4) > verticalBounds(3), ...
    "test_text_bounds:RotatedExtent", ...
    "A 90-degree text extent must reflect its rendered rotation; geometry=%s", verticalDetails);
assert_rotated_dimensions(horizontalBounds, verticalBounds, figureHandle);

clear figureCleanup;
close_if_valid(figureHandle);
end

function [figureHandle, axesHandle, titleHandle, xlabelHandle, ylabelHandle, textHandle] ...
        = make_nested_figure(fontName)
figureHandle = make_pixel_figure([800 480]);
panelHandle = uipanel("Parent", figureHandle, "Units", "pixels", ...
    "Position", [40 30 720 420], "BorderType", "none");
axesHandle = axes("Parent", panelHandle, "Units", "pixels", ...
    "Position", [80 55 520 300], "FontName", fontName);
plot(axesHandle, 0:4, [1 3 2 4 3]);
titleHandle = title(axesHandle, "Compact rendered title", ...
    "FontName", fontName, "FontSize", 13, "Interpreter", "none");
xlabelHandle = xlabel(axesHandle, "Time (UTC)", ...
    "FontName", fontName, "Interpreter", "none");
ylabelHandle = ylabel(axesHandle, "Sea temperature (degC)", ...
    "FontName", fontName, "Interpreter", "none");
textHandle = text(axesHandle, 0.32, 0.55, "Rotated geometry probe", ...
    "Units", "normalized", "FontName", fontName, "FontSize", 12, ...
    "Tag", "TextBoundsProbe", ...
    "HorizontalAlignment", "center", "VerticalAlignment", "middle", ...
    "Interpreter", "none");
end

function test_original_nested_geometry(fontName, artifactName)
[figureHandle, axesHandle, ~, xlabelHandle] = make_nested_figure(fontName);
figureCleanup = onCleanup(@() close_if_valid(figureHandle));
[~, beforeRender] = measure_bounds(xlabelHandle, figureHandle, fontName + " before renderer export");
renderEvidence = export_nested_evidence(figureHandle, axesHandle, artifactName, beforeRender);
drawnow;
nativeExtent = double(xlabelHandle.Extent);
nativeUnits = string(xlabelHandle.Units);
nativeGeometry = nested_public_geometry(figureHandle, axesHandle);
nativeGeometry.text_units = nativeUnits;
nativeGeometry.text_extent = nativeExtent;
renderEvidence.native_reference_geometry = nativeGeometry;
write_evidence_json(renderEvidence.json_path, renderEvidence);
assert(nativeUnits == "data" && axesHandle.XScale == "linear" ...
    && axesHandle.YScale == "linear" && axesHandle.XDir == "normal" ...
    && axesHandle.YDir == "normal" && axesHandle.DataAspectRatioMode == "auto" ...
    && axesHandle.PlotBoxAspectRatioMode == "auto" && isequal(axesHandle.View, [0 90]), ...
    "test_text_bounds:OriginalFixture", ...
    "The original fixture must retain linear 2-D data coordinates without fixed aspect ratios; geometry=%s", ...
    jsonencode(nativeGeometry));
assert(nativeGeometry.axes.Units.succeeded && nativeGeometry.axes.Position.succeeded ...
    && nativeGeometry.axes.getpixelposition_recursive.succeeded ...
    && nativeGeometry.figure.getpixelposition.succeeded ...
    && nativeGeometry.axes.XLim.succeeded && nativeGeometry.axes.YLim.succeeded ...
    && string(nativeGeometry.axes.Units.value) == "pixels", ...
    "test_text_bounds:OriginalFixture", ...
    "The independent reference requires direct public axes Position in pixels; geometry=%s", ...
    jsonencode(nativeGeometry));
axesPosition = double(nativeGeometry.axes.Position.value);
axesPixels = double(nativeGeometry.axes.getpixelposition_recursive.value);
figurePixels = double(nativeGeometry.figure.getpixelposition.value);
xLimits = double(nativeGeometry.axes.XLim.value);
yLimits = double(nativeGeometry.axes.YLim.value);
assert(numel(axesPosition) == 4 && all(isfinite(axesPosition)) ...
    && all(axesPosition(3:4) > 0) && all(isfinite([xLimits yLimits])) ...
    && diff(xLimits) > 0 && diff(yLimits) > 0, ...
    "test_text_bounds:OriginalFixture", ...
    "The independent reference requires finite axes dimensions and increasing limits; geometry=%s", ...
    jsonencode(nativeGeometry));
dataScale = axesPosition(3:4) ./ [diff(xLimits) diff(yLimits)];
axesOriginInFigure = axesPixels(1:2) - 1;
nativeOrigin = axesOriginInFigure ...
    + (nativeExtent(1:2) - [xLimits(1) yLimits(1)]) .* dataScale;
nativeSize = nativeExtent(3:4) .* dataScale;
nativeBounds = [nativeOrigin nativeSize] ./ figurePixels([3 4 3 4]);

[bounds, details] = measure_bounds(xlabelHandle, figureHandle, fontName + " original x label");
evidence = jsondecode(details);
evidence.font_listed = oi_font_available(fontName, string(listfonts));
evidence.native_reference_geometry = nativeGeometry;
evidence.public_geometry_after_measurement = nested_public_geometry(figureHandle, axesHandle);
evidence.native_scale_source = "direct axes.Position(3:4) in pixels, not getpixelposition size or inferred text ratios";
evidence.native_origin_reference = "getpixelposition(axes,true)(1:2) minus one: zero-based figure drawable canvas";
evidence.native_axes_origin_in_figure_pixels = axesOriginInFigure;
evidence.native_data_scale_pixels = dataScale;
evidence.axes_size_minus_getpixelposition = axesPosition(3:4) - axesPixels(3:4);
evidence.native_bounds = nativeBounds;
evidence.native_size_pixels = nativeSize;
evidence.horizontal_metrics_anomalous = nativeSize(1) <= nativeSize(2);
nativeClipped = nativeBounds(1) < 0 || nativeBounds(2) < 0 ...
    || nativeBounds(1) + nativeBounds(3) > 1 ...
    || nativeBounds(2) + nativeBounds(4) > 1;
evidence.native_clipped = nativeClipped;
errorPixels = abs(bounds - nativeBounds) .* figurePixels([3 4 3 4]);
evidence.error_pixels = errorPixels;
evidence.data_estimate_matches_pixel_bounds = all(errorPixels <= 1e-6);
evidence.data_estimate_scope = "diagnostic only; original linear data estimate and error retained, not the acceptance reference";
evidence.reference_scope = "public points/pixels conversion and parent offset only; not raw data Extent reliability or artifact rendering";
pointsReference = probe_public_api(@() measure_points_reference(xlabelHandle, figureHandle));
evidence.points_reference = pointsReference;
if pointsReference.succeeded
    pointsErrorPixels = abs(bounds - pointsReference.value.bounds) .* figurePixels([3 4 3 4]);
    pointsExtentErrorPixels = abs(evidence.pixel_extent - pointsReference.value.pixel_extent_from_points);
    evidence.points_vs_pixel = struct("extent_points", pointsReference.value.extent_points, ...
        "pixel_extent", evidence.pixel_extent, ...
        "pixel_extent_from_points", pointsReference.value.pixel_extent_from_points, ...
        "extent_error_pixels", pointsExtentErrorPixels, "bounds_error_pixels", pointsErrorPixels);
end
details = jsonencode(evidence);
fprintf("MATLAB_ORIGINAL_NESTED_EVIDENCE=%s\n", details);
renderEvidence.original_geometry_after_export = evidence;
write_evidence_json(renderEvidence.json_path, renderEvidence);
assert(string(xlabelHandle.FontName) == fontName ...
    && string(xlabelHandle.Units) == nativeUnits, ...
    "test_text_bounds:OriginalMutation", ...
    "Measurement must preserve the selected font and original text units; geometry=%s", details);
assert(pointsReference.succeeded, "test_text_bounds:PointsReference", ...
    "The public points reference could not be measured; geometry=%s", details);
assert(pointsReference.value.state_restored, "test_text_bounds:OriginalMutation", ...
    "The points probe must restore text Units, Position, PositionMode and typography; geometry=%s", details);
assert(all(pointsErrorPixels <= 1e-6) && all(pointsExtentErrorPixels <= 1e-6), ...
    "test_text_bounds:OriginalNativeGeometry", ...
    "Public points conversion and parent offset must match pixel bounds; bounds_error_pixels=%s; extent_error_pixels=%s; geometry=%s", ...
    mat2str(pointsErrorPixels, 17), mat2str(pointsExtentErrorPixels, 17), details);
if pointsReference.value.clipped
    must_throw(@() assert_inside(bounds, "original x label", details), "UnexpectedClipping");
else
    assert_inside(bounds, "original x label", details);
end

clear figureCleanup;
close_if_valid(figureHandle);
end

function reference = measure_points_reference(textHandle, figureHandle)
reference = struct("before_state", reference_text_state(textHandle));
unitsCleanup = onCleanup(@() restore_reference_text(textHandle, reference.before_state));
textHandle.Units = "points";
drawnow;
reference.extent_points = double(textHandle.Extent);
reference.points_state = reference_text_state(textHandle);
reference.screen_pixels_per_inch = double(get(groot, "ScreenPixelsPerInch"));
reference.parent_pixels_in_figure = double(getpixelposition(textHandle.Parent, true));
reference.figure_pixels = double(getpixelposition(figureHandle));
assert(string(textHandle.Units) == "points" ...
    && all(isfinite(reference.extent_points)) && all(reference.extent_points(3:4) > 0) ...
    && isscalar(reference.screen_pixels_per_inch) ...
    && isfinite(reference.screen_pixels_per_inch) && reference.screen_pixels_per_inch > 0, ...
    "test_text_bounds:PointsReference", "Expected a finite public points Extent and measured screen DPI");
reference.points_to_pixels = reference.screen_pixels_per_inch / 72;
relativePixels = reference.extent_points * reference.points_to_pixels;
reference.origin_reference = "points start at zero in the axes; pixels start at one; parent offset is figure-relative";
reference.pixel_extent_from_points = relativePixels + [1 1 0 0];
originPixels = reference.parent_pixels_in_figure(1:2) - 1 + relativePixels(1:2);
reference.bounds = [originPixels relativePixels(3:4)] ./ reference.figure_pixels([3 4 3 4]);
reference.clipped = reference.bounds(1) < 0 || reference.bounds(2) < 0 ...
    || reference.bounds(1) + reference.bounds(3) > 1 ...
    || reference.bounds(2) + reference.bounds(4) > 1;
clear unitsCleanup;
reference.restored_state = reference_text_state(textHandle);
reference.state_restored = isequaln(reference.before_state, reference.restored_state);
end

function state = reference_text_state(textHandle)
state = struct();
for propertyName = ["Units" "Position" "FontName" "FontSize" "FontUnits" ...
        "String" "Interpreter" "Rotation" "HorizontalAlignment" "VerticalAlignment"]
    state.(char(propertyName)) = get(textHandle, char(propertyName));
end
state.PositionMode = probe_public_api(@() get(textHandle, "PositionMode"));
end

function restore_reference_text(textHandle, state)
if ~isgraphics(textHandle, "text")
    return;
end
textHandle.Units = state.Units;
if state.PositionMode.succeeded
    if ~isequaln(textHandle.Position, state.Position)
        textHandle.Position = state.Position;
    end
    if ~isequal(get(textHandle, "PositionMode"), state.PositionMode.value)
        set(textHandle, "PositionMode", state.PositionMode.value);
    end
end
end

function fit_nested_bottom_margin(figureHandle, axesHandle, xlabelHandle)
[bounds, details] = measure_bounds(xlabelHandle, figureHandle, "before bottom margin");
figurePixels = double(getpixelposition(figureHandle));
requiredMarginPixels = 12;
addedPixels = ceil(max(0, requiredMarginPixels - bounds(2) * figurePixels(4)));
panelHandle = axesHandle.Parent;
layout = struct("original_figure_pixels", figurePixels, ...
    "original_panel_position", double(panelHandle.Position), ...
    "original_axes_position", double(axesHandle.Position), ...
    "original_geometry", jsondecode(details), ...
    "required_bottom_margin_pixels", requiredMarginPixels, ...
    "added_bottom_pixels", addedPixels);
figureHandle.Position = figureHandle.Position + [0 0 0 addedPixels];
panelHandle.Position = panelHandle.Position + [0 0 0 addedPixels];
axesHandle.Position = axesHandle.Position + [0 addedPixels 0 0];
drawnow;
layout.fitted_figure_pixels = double(getpixelposition(figureHandle));
layout.fitted_axes_pixels = double(getpixelposition(axesHandle, true));
setappdata(figureHandle, "TextBoundsLayoutEvidence", layout);
fprintf("MATLAB_TEXT_BOUNDS_LAYOUT=%s\n", jsonencode(layout));
end

function test_colorbar_label(fontName)
figureHandle = make_pixel_figure([800 480]);
figureCleanup = onCleanup(@() close_if_valid(figureHandle));
axesHandle = axes("Parent", figureHandle, "Units", "pixels", ...
    "Position", [90 75 520 320], "FontName", fontName);
imagesc(axesHandle, reshape(1:100, 10, 10));
colorbarHandle = colorbar(axesHandle);
colorbarHandle.Units = "pixels";
colorbarHandle.Position = [680 110 24 250];
colorbarHandle.Label.String = "Temperature (degC)";
colorbarHandle.Label.FontName = fontName;
colorbarHandle.Label.FontSize = 11;
colorbarHandle.Label.Interpreter = "none";
colorbarHandle.Label.Rotation = 90;
labelUnits = string(colorbarHandle.Label.Units);

[evidencePath, renderSucceeded] = render_colorbar_evidence(figureHandle, axesHandle, colorbarHandle);
[labelBounds, labelDetails] = measure_bounds(colorbarHandle.Label, figureHandle, "colorbar label");
assert(string(colorbarHandle.Label.Units) == labelUnits, ...
    "test_text_bounds:ColorbarUnits", ...
    "Colorbar label Units were not restored; geometry=%s; evidence=%s", labelDetails, evidencePath);
assert_inside(labelBounds, "colorbar label", labelDetails);
assert(labelBounds(1) > 0.75 && labelBounds(4) > labelBounds(3), ...
    "test_text_bounds:ColorbarGeometry", ...
    "Colorbar label geometry failed after native export; bounds=%s; geometry=%s; evidence=%s", ...
    mat2str(labelBounds, 17), labelDetails, evidencePath);
assert(renderSucceeded, "test_text_bounds:DiagnosticExport", ...
    "No colorbar diagnostic PNG was exported; see %s", evidencePath);

clear figureCleanup;
close_if_valid(figureHandle);
end

function [jsonPath, renderSucceeded] = render_colorbar_evidence(figureHandle, axesHandle, colorbarHandle)
outputRoot = string(getenv("MATLAB_FULL100_OUTPUT"));
if strlength(outputRoot) == 0
    outputRoot = string(tempname);
end
outputDirectory = fullfile(outputRoot, "text-bounds");
if ~isfolder(outputDirectory)
    mkdir(outputDirectory);
end
jsonPath = fullfile(outputDirectory, "colorbar-label.json");
evidence = struct("release", version('-release'), ...
    "bounds_reference", "helper bounds use the figure drawable canvas; PNGs are content crops");
drawnow;
evidence.before_export = colorbar_native_state(figureHandle, axesHandle, colorbarHandle, "colorbar before export");
write_evidence_json(jsonPath, evidence);
evidence.exports = export_diagnostic_crop(axesHandle, "axes-with-colorbar", ...
    fullfile(outputDirectory, "colorbar-axes.png"));
drawnow;
evidence.after_axes_export = colorbar_native_state(figureHandle, axesHandle, colorbarHandle, "colorbar after axes export");
write_evidence_json(jsonPath, evidence);
evidence.exports(2) = export_diagnostic_crop(figureHandle, "figure-content", ...
    fullfile(outputDirectory, "colorbar-figure-content.png"));
drawnow;
evidence.after_figure_export = colorbar_native_state(figureHandle, axesHandle, colorbarHandle, "colorbar after figure export");
evidence.pixel_sizes = [evidence.before_export.measurement.pixel_extent(3:4); ...
    evidence.after_axes_export.measurement.pixel_extent(3:4); ...
    evidence.after_figure_export.measurement.pixel_extent(3:4)];
evidence.pixel_size_phases = ["before_export" "after_axes_export" "after_figure_export"];
write_evidence_json(jsonPath, evidence);
renderSucceeded = any([evidence.exports.succeeded]);
fprintf("MATLAB_COLORBAR_RENDER_EVIDENCE=%s\n", jsonencode(evidence));
end

function state = colorbar_native_state(figureHandle, axesHandle, colorbarHandle, role)
state = struct();
state.figure_pixels = probe_public_api(@() getpixelposition(figureHandle));
state.axes_pixels_in_figure = probe_public_api(@() getpixelposition(axesHandle, true));
state.colorbar_class = probe_public_api(@() class(colorbarHandle));
state.colorbar_properties = probe_public_api(@() properties(colorbarHandle));
state.colorbar_pixels_in_figure = probe_public_api(@() getpixelposition(colorbarHandle, true));
for propertyName = ["Type" "Units" "Position" "Limits" "Location" "AxisLocation" "Direction"]
    state.(char(propertyName)) = probe_public_api(@() get(colorbarHandle, char(propertyName)));
end
state.native_label = native_layout_text_record(colorbarHandle.Label, figureHandle);
[~, details] = measure_bounds(colorbarHandle.Label, figureHandle, role);
state.measurement = jsondecode(details);
end

function test_font_refresh(fontName)
figureHandle = make_pixel_figure([800 480]);
figureCleanup = onCleanup(@() close_if_valid(figureHandle));
axesHandle = axes("Parent", figureHandle, "Units", "pixels", ...
    "Position", [100 80 600 320]);
textHandle = text(axesHandle, 0.5, 0.5, "MMMMMMMM geometry", ...
    "Units", "normalized", "FontName", fontName, "FontSize", 9, ...
    "HorizontalAlignment", "center", "VerticalAlignment", "middle", ...
    "Interpreter", "none");

[smallBounds, smallDetails] = render_text_state(textHandle, figureHandle, axesHandle, "font-refresh-9pt");
textHandle.FontSize = 22;
[largeBounds, largeDetails] = render_text_state(textHandle, figureHandle, axesHandle, "font-refresh-22pt");
assert(largeBounds(3) > smallBounds(3) && largeBounds(4) > smallBounds(4), ...
    "test_text_bounds:FontRefresh", ...
    "Text bounds must be re-rendered after final typography changes; before=%s; after=%s", ...
    smallDetails, largeDetails);

textHandle.String = "MMMMMMMMMMMMMMMM geometry";
[longerBounds, longerDetails] = render_text_state(textHandle, figureHandle, axesHandle, "font-refresh-longer-string");
assert(longerBounds(3) > largeBounds(3), ...
    "test_text_bounds:StringRefresh", ...
    "Longer text must be re-rendered after String changes; before=%s; after=%s", ...
    largeDetails, longerDetails);

textHandle.FontName = "Courier";
[switchedBounds, switchedDetails] = render_text_state(textHandle, figureHandle, axesHandle, "font-refresh-courier");
assert(all(isfinite(switchedBounds)) && all(switchedBounds(3:4) > 0) ...
    && string(textHandle.FontName) == "Courier", ...
    "test_text_bounds:FontNameRefresh", ...
    "Final FontName geometry was not measured after renderer refresh; geometry=%s", ...
    switchedDetails);

clear figureCleanup;
close_if_valid(figureHandle);
end

function test_true_clipping_case(fontName)
figureHandle = figure("Visible", "off", "Units", "inches", ...
    "Position", [1 1 4 2.25], "Color", "white");
figureCleanup = onCleanup(@() close_if_valid(figureHandle));
axesHandle = axes("Parent", figureHandle, "Units", "normalized", ...
    "Position", [0.16 0.20 0.72 0.62], "FontName", fontName);
titleHandle = title(axesHandle, repmat('W', 1, 80), ...
    "FontName", fontName, "FontSize", 14, "Interpreter", "none");

[bounds, details] = render_text_state(titleHandle, figureHandle, axesHandle, "true-clipping-title");
assert(bounds(1) < 0 && bounds(1) + bounds(3) > 1 && bounds(3) > 1, ...
    "test_text_bounds:TrueClipping", ...
    "A genuinely oversized title must remain outside the figure bounds; geometry=%s", details);

clear figureCleanup;
close_if_valid(figureHandle);
end

function test_invalid_inputs(fontName)
figureHandle = make_pixel_figure([640 360]);
otherFigure = make_pixel_figure([640 360]);
cleanupFigures = onCleanup(@() close_figures(figureHandle, otherFigure));
axesHandle = axes("Parent", figureHandle);
textHandle = text(axesHandle, 0.5, 0.5, "probe", ...
    "Units", "normalized", "FontName", fontName);

must_throw(@() oi_text_bounds(axesHandle, figureHandle), "InvalidText");
must_throw(@() oi_text_bounds(textHandle, otherFigure), "FigureMismatch");

clear cleanupFigures;
close_figures(figureHandle, otherFigure);
end

function figureHandle = make_pixel_figure(sizePixels)
figureHandle = figure("Visible", "off", "Units", "pixels", ...
    "Position", [100 100 sizePixels], "Color", "white");
end

function fontName = publication_font()
theme = oi_ocean_theme();
fontName = string(theme.FontName);
assert(fontName ~= "Courier", "test_text_bounds:PublicationFont", ...
    "The positive geometry fixture requires a configured publication font");
fprintf("MATLAB_TEXT_BOUNDS_PUBLICATION_FONT=%s\n", fontName);
end

function evidence = export_nested_evidence(figureHandle, axesHandle, artifactName, details)
outputRoot = string(getenv("MATLAB_FULL100_OUTPUT"));
if strlength(outputRoot) == 0
    outputRoot = string(tempname);
end
outputDirectory = fullfile(outputRoot, "text-bounds");
if ~isfolder(outputDirectory)
    mkdir(outputDirectory);
end
evidence = jsondecode(details);
evidence.bounds_reference = "normalized to original figure drawable canvas, not exported crop";
evidence.figure_pixels_before_export = double(getpixelposition(figureHandle));
evidence.axes_pixels_before_export = double(getpixelposition(axesHandle, true));
evidence.panel_pixels_before_export = double(getpixelposition(axesHandle.Parent, true));
if isappdata(figureHandle, "TextBoundsLayoutEvidence")
    evidence.layout = getappdata(figureHandle, "TextBoundsLayoutEvidence");
end
jsonPath = fullfile(outputDirectory, artifactName + ".json");
evidence.json_path = jsonPath;
evidence.text_before_export = nested_text_state(figureHandle, axesHandle);
write_evidence_json(jsonPath, evidence);
axesPath = fullfile(outputDirectory, artifactName + "-axes.png");
panelPath = fullfile(outputDirectory, artifactName + "-panel.png");
evidence.exports = export_diagnostic_crop(axesHandle, "axes", axesPath);
drawnow;
evidence.text_after_axes_export = nested_text_state(figureHandle, axesHandle);
write_evidence_json(jsonPath, evidence);
evidence.exports(2) = export_diagnostic_crop(axesHandle.Parent, "panel", panelPath);
drawnow;
evidence.text_after_panel_export = nested_text_state(figureHandle, axesHandle);
[~, afterExport] = oi_text_bounds(axesHandle.XLabel, figureHandle);
evidence.after_export = afterExport;
write_evidence_json(jsonPath, evidence);
assert(any([evidence.exports.succeeded]), "test_text_bounds:DiagnosticExport", ...
    "Neither axes nor panel diagnostic PNG could be exported; exports=%s", ...
    jsonencode(evidence.exports));
end

function state = nested_text_state(figureHandle, axesHandle)
state = struct();
state.public_geometry = nested_public_geometry(figureHandle, axesHandle);
[~, state.title] = oi_text_bounds(axesHandle.Title, figureHandle);
[~, state.xlabel] = oi_text_bounds(axesHandle.XLabel, figureHandle);
[~, state.ylabel] = oi_text_bounds(axesHandle.YLabel, figureHandle);
probeHandle = findobj(axesHandle, "Type", "text", "Tag", "TextBoundsProbe");
[~, state.axes_text] = oi_text_bounds(probeHandle, figureHandle);
state.pixel_size_roles = ["title" "xlabel" "ylabel" "axes_text"];
state.pixel_sizes = [state.title.pixel_extent(3:4); state.xlabel.pixel_extent(3:4); ...
    state.ylabel.pixel_extent(3:4); state.axes_text.pixel_extent(3:4)];
state.all_pixel_sizes_equal = all(abs(state.pixel_sizes - state.pixel_sizes(1, :)) <= 1e-9, "all");
end

function state = nested_public_geometry(figureHandle, axesHandle)
state = struct("position_reference", "raw public Position/InnerPosition in each object's recorded Units", ...
    "axes_origin_reference", "recursive getpixelposition is figure-relative, not screen-relative", ...
    "figure_origin_reference", "figure Position/getpixelposition origin is screen-relative and is not added to bounds");
roles = ["figure" "axes" "parent"];
handles = {figureHandle, axesHandle, axesHandle.Parent};
for index = 1:numel(roles)
    handle = handles{index};
    record = struct("class", class(handle), "parent_class", class(handle.Parent));
    for propertyName = ["Units" "Position" "InnerPosition"]
        record.(char(propertyName)) = probe_public_api(@() get(handle, char(propertyName)));
    end
    record.getpixelposition = probe_public_api(@() getpixelposition(handle));
    record.getpixelposition_recursive = probe_public_api(@() getpixelposition(handle, true));
    state.(char(roles(index))) = record;
end
for propertyName = ["XLim" "YLim" "XScale" "YScale" "XDir" "YDir" ...
        "DataAspectRatioMode" "PlotBoxAspectRatioMode" "View" "PositionConstraint"]
    state.axes.(char(propertyName)) = probe_public_api(@() get(axesHandle, char(propertyName)));
end
end

function record = export_diagnostic_crop(targetHandle, targetName, pngPath)
record = struct("target", targetName, "api", "exportgraphics", ...
    "file", pngPath, "canvas_reference", ...
    "content crop of named target; not a full figure canvas or figure-clipping verdict", ...
    "target_pixels_in_figure", [], "target_pixels_on_screen", [], ...
    "succeeded", false, "image_size_pixels", [], ...
    "error_identifier", "", "error_message", "");
try
    targetPixels = double(getpixelposition(targetHandle, true));
    if isgraphics(targetHandle, "figure")
        record.target_pixels_on_screen = targetPixels;
    else
        record.target_pixels_in_figure = targetPixels;
    end
    exportgraphics(targetHandle, char(pngPath), 'Resolution', 150, 'BackgroundColor', 'white');
    imageInfo = imfinfo(pngPath);
    assert(imageInfo.Width > 0 && imageInfo.Height > 0, ...
        "test_text_bounds:EmptyDiagnosticImage", "Diagnostic PNG has no pixels");
    record.image_size_pixels = [imageInfo.Width imageInfo.Height];
    record.succeeded = true;
catch errorDetails
    record.error_identifier = errorDetails.identifier;
    record.error_message = errorDetails.message;
end
fprintf("MATLAB_TEXT_BOUNDS_EXPORT=%s\n", jsonencode(record));
end

function write_evidence_json(jsonPath, evidence)
fileId = fopen(jsonPath, "w");
assert(fileId >= 0, "test_text_bounds:EvidenceFile", ...
    "Cannot write nested figure evidence: %s", jsonPath);
fileCleanup = onCleanup(@() fclose(fileId));
fprintf(fileId, "%s\n", jsonencode(evidence));
clear fileCleanup;
end

function [bounds, details] = render_text_state(textHandle, figureHandle, axesHandle, artifactName)
outputRoot = string(getenv("MATLAB_FULL100_OUTPUT"));
if strlength(outputRoot) == 0
    outputRoot = string(tempname);
end
outputDirectory = fullfile(outputRoot, "text-bounds");
if ~isfolder(outputDirectory)
    mkdir(outputDirectory);
end
jsonPath = fullfile(outputDirectory, artifactName + ".json");
[~, beforeDetails] = measure_bounds(textHandle, figureHandle, artifactName + " before export");
evidence = struct("before_export", jsondecode(beforeDetails));
write_evidence_json(jsonPath, evidence);
evidence.export = export_diagnostic_crop(axesHandle, "axes", ...
    fullfile(outputDirectory, artifactName + "-axes.png"));
drawnow;
[bounds, details] = measure_bounds(textHandle, figureHandle, artifactName + " after export");
evidence.after_export = jsondecode(details);
write_evidence_json(jsonPath, evidence);
assert(evidence.export.succeeded, "test_text_bounds:DiagnosticExport", ...
    "Text state requires a successful native render; evidence=%s; export=%s", ...
    jsonPath, jsonencode(evidence.export));
end

function [bounds, details] = measure_bounds(textHandle, figureHandle, role)
[bounds, diagnostics] = oi_text_bounds(textHandle, figureHandle);
diagnostics.role = char(role);
details = jsonencode(diagnostics);
fprintf("MATLAB_TEXT_BOUNDS_DIAGNOSTIC=%s\n", details);
end

function assert_inside(bounds, role, details)
assert(all(isfinite(bounds)) && all(bounds(3:4) > 0) ...
    && bounds(1) >= 0 && bounds(2) >= 0 ...
    && bounds(1) + bounds(3) <= 1 ...
    && bounds(2) + bounds(4) <= 1, ...
    "test_text_bounds:UnexpectedClipping", ...
    "%s should fit inside the figure canvas; bounds=%s; geometry=%s", ...
    role, mat2str(bounds, 17), details);
end

function assert_rotated_dimensions(horizontalBounds, verticalBounds, figureHandle)
figurePixels = double(getpixelposition(figureHandle));
horizontalSize = horizontalBounds(3:4) .* figurePixels(3:4);
verticalSize = verticalBounds(3:4) .* figurePixels(3:4);
assert(max(abs(horizontalSize - fliplr(verticalSize))) <= 3, ...
    "test_text_bounds:RotationPixels", ...
    "Rotated text bounds must preserve the renderer's pixel dimensions");
end

function assert_centered_in_parent(bounds, parentHandle, figureHandle, parentPosition)
figurePixels = double(getpixelposition(figureHandle));
parentPixels = double(getpixelposition(parentHandle, true));
expectedCenter = (parentPixels(1:2) - 1 ...
    + parentPosition .* parentPixels(3:4)) ./ figurePixels(3:4);
actualCenter = bounds(1:2) + bounds(3:4) / 2;
errorPixels = abs(actualCenter - expectedCenter) .* figurePixels(3:4);
assert(all(errorPixels <= 2), "test_text_bounds:ParentCoordinates", ...
    "Text bounds were not mapped through nested parent pixel coordinates");
end

function must_throw(callback, identifierFragment)
didThrow = false;
try
    callback();
catch errorDetails
    didThrow = contains(string(errorDetails.identifier), identifierFragment);
end
assert(didThrow, "test_text_bounds:ExpectedError", ...
    "Expected an error containing '%s'", identifierFragment);
end

function close_figures(varargin)
for index = 1:nargin
    close_if_valid(varargin{index});
end
end

function close_if_valid(figureHandle)
if isgraphics(figureHandle, "figure")
    close(figureHandle);
end
end
