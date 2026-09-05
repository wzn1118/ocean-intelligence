function test_text_bounds()
%TEST_TEXT_BOUNDS Exercise rendered text geometry without claiming visual QA.
testDirectory = fileparts(mfilename("fullpath"));
assetDirectory = fullfile(testDirectory, "..", "assets");
originalPath = path;
pathCleanup = onCleanup(@() path(originalPath));
addpath(assetDirectory);
fontName = installed_font();

test_axes_text_and_rotation(fontName);
test_colorbar_label(fontName);
test_font_refresh(fontName);
test_true_clipping_case(fontName);
test_invalid_inputs(fontName);

clear pathCleanup;
fprintf("MATLAB_TEXT_BOUNDS=passed\n");
end

function test_axes_text_and_rotation(fontName)
figureHandle = make_pixel_figure([800 480]);
figureCleanup = onCleanup(@() close_if_valid(figureHandle));
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
    "HorizontalAlignment", "center", "VerticalAlignment", "middle", ...
    "Interpreter", "none");

originalUnits = string(textHandle.Units);
titleBounds = oi_text_bounds(titleHandle, figureHandle);
xlabelBounds = oi_text_bounds(xlabelHandle, figureHandle);
ylabelBounds = oi_text_bounds(ylabelHandle, figureHandle);
horizontalBounds = oi_text_bounds(textHandle, figureHandle);
assert(string(textHandle.Units) == originalUnits, ...
    "test_text_bounds:Units", "oi_text_bounds did not restore text Units");
assert_inside(titleBounds, "axes title");
assert_inside(xlabelBounds, "x label");
assert_inside(ylabelBounds, "rotated y label");
assert_inside(horizontalBounds, "axes text");
assert_centered_in_parent(horizontalBounds, axesHandle, figureHandle, [0.32 0.55]);
assert(horizontalBounds(3) > horizontalBounds(4), ...
    "test_text_bounds:HorizontalExtent", ...
    "Horizontal text must be wider than it is tall");

textHandle.Rotation = 90;
verticalBounds = oi_text_bounds(textHandle, figureHandle);
assert_inside(verticalBounds, "90-degree axes text");
assert(verticalBounds(4) > verticalBounds(3), ...
    "test_text_bounds:RotatedExtent", ...
    "A 90-degree text extent must reflect its rendered rotation");
assert_rotated_dimensions(horizontalBounds, verticalBounds, figureHandle);

clear figureCleanup;
close_if_valid(figureHandle);
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

labelBounds = oi_text_bounds(colorbarHandle.Label, figureHandle);
assert(string(colorbarHandle.Label.Units) == labelUnits, ...
    "test_text_bounds:ColorbarUnits", ...
    "Colorbar label Units were not restored");
assert_inside(labelBounds, "colorbar label");
assert(labelBounds(1) > 0.75 && labelBounds(4) > labelBounds(3), ...
    "test_text_bounds:ColorbarGeometry", ...
    "Colorbar label bounds were not measured in the colorbar parent frame");

clear figureCleanup;
close_if_valid(figureHandle);
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

smallBounds = oi_text_bounds(textHandle, figureHandle);
textHandle.FontSize = 22;
largeBounds = oi_text_bounds(textHandle, figureHandle);
assert(largeBounds(3) > smallBounds(3) && largeBounds(4) > smallBounds(4), ...
    "test_text_bounds:FontRefresh", ...
    "Text bounds must be re-rendered after final typography changes");

fontNames = unique(string(listfonts), "stable");
alternate = fontNames(fontNames ~= string(fontName));
if ~isempty(alternate)
    textHandle.FontName = alternate(1);
    switchedBounds = oi_text_bounds(textHandle, figureHandle);
    assert(all(isfinite(switchedBounds)) && all(switchedBounds(3:4) > 0) ...
        && string(textHandle.FontName) == alternate(1), ...
        "test_text_bounds:FontNameRefresh", ...
        "Final FontName geometry was not measured after renderer refresh");
end

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

bounds = oi_text_bounds(titleHandle, figureHandle);
assert(bounds(1) < 0 && bounds(1) + bounds(3) > 1 && bounds(3) > 1, ...
    "test_text_bounds:TrueClipping", ...
    "A genuinely oversized title must remain outside the figure bounds");

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

function fontName = installed_font()
fontNames = string(listfonts);
assert(~isempty(fontNames), "test_text_bounds:Fonts", ...
    "At least one installed MATLAB font is required");
fontName = fontNames(1);
end

function assert_inside(bounds, role)
assert(all(isfinite(bounds)) && all(bounds(3:4) > 0) ...
    && bounds(1) >= 0 && bounds(2) >= 0 ...
    && bounds(1) + bounds(3) <= 1 ...
    && bounds(2) + bounds(4) <= 1, ...
    "test_text_bounds:UnexpectedClipping", ...
    "%s should fit inside the figure canvas", role);
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
