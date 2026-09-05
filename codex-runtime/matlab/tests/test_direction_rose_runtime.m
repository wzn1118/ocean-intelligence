function test_direction_rose_runtime()
%TEST_DIRECTION_ROSE_RUNTIME Focused MATLAB runtime test for direction roses.
testDirectory = fileparts(mfilename("fullpath"));
assetDirectory = fullfile(testDirectory, "..", "assets");
addpath(assetDirectory);
cleanupPath = onCleanup(@() rmpath(assetDirectory));
theme = oi_ocean_theme();

test_wrapping_conversion_and_missing(theme);
test_zero_weights_and_input_validation(theme);
test_tiled_layout_and_exports(theme);

clear cleanupPath;
fprintf("MATLAB_DIRECTION_ROSE_RUNTIME=passed\n");
end

function test_wrapping_conversion_and_missing(theme)
[figureHandle, axesHandle] = make_axes();
cleanupFigure = onCleanup(@() close_if_valid(figureHandle));
directions = [-360 0 11.25 348.75 360 720 NaN];
result = oi_plot_direction_rose(axesHandle, directions, struct( ...
    "DirectionConvention", " FROM ", "DisplayConvention", "to", ...
    "DirectionUnit", "degree", "Normalization", "count", ...
    "MissingPolicy", "PRESERVE", "BinCount", 16, "Theme", theme));
assert(result.ValidCount == 6 && result.MissingCount == 1, ...
    "Direction rose did not preserve row-vector or NaN counts");
assert(result.ConventionConversionApplied && result.DisplayConvention == "to", ...
    "From/to direction conversion metadata is incorrect");
assert(isequal(result.BinCentersDegrees, 0:22.5:337.5), ...
    "Direction rose bin centers are not north-centered");
assert(result.SampleCounts(9) == 5 && result.SampleCounts(10) == 1, ...
    "Circular half-open bin assignment changed at a boundary");
assert(result.BinBoundaryConvention == ...
    "clockwise half-open; ties enter the clockwise bin", ...
    "Direction rose did not expose its boundary convention");
assert(isgraphics(axesHandle) && isgraphics(result.Axes), ...
    "Conventional axes replacement invalidated a caller handle");
clear cleanupFigure;
close_if_valid(figureHandle);
end

function test_zero_weights_and_input_validation(theme)
[figureHandle, axesHandle] = make_axes();
cleanupFigure = onCleanup(@() close_if_valid(figureHandle));
options = struct("Weights", [0; 0; 0], "DirectionConvention", "from", ...
    "DirectionUnit", "degrees-true", "Normalization", "weight", ...
    "Theme", theme);
result = oi_plot_direction_rose(axesHandle, [0; 90; 180], options);
assert(all(result.BinValues == 0) && result.ValidCount == 3, ...
    "Zero weights must remain valid zero-valued directional samples");
must_throw(@() oi_plot_direction_rose(axesHandle, [], options), "NoSamples");
must_throw(@() oi_plot_direction_rose(axesHandle, [NaN; NaN], options), ...
    "NoValidSamples");
percentOptions = options;
percentOptions.Normalization = "percent";
must_throw(@() oi_plot_direction_rose(axesHandle, [0; 90; 180], ...
    percentOptions), "ZeroWeight");
clear cleanupFigure;
close_if_valid(figureHandle);
end

function test_tiled_layout_and_exports(theme)
figureHandle = oi_figure(720, 540, "off");
cleanupFigure = onCleanup(@() close_if_valid(figureHandle));
layout = tiledlayout(figureHandle, 1, 1, ...
    "TileSpacing", "compact", "Padding", "compact");
placeholderAxes = nexttile(layout);
result = oi_plot_direction_rose(placeholderAxes, (0:45:315)', struct( ...
    "DirectionConvention", "to", "DirectionUnit", "degree", ...
    "Normalization", "percent", "Theme", theme));
assert(~isgraphics(placeholderAxes) && isgraphics(result.Axes) ...
    && result.Axes.Layout.Tile == 1, ...
    "Tiled axes were not replaced by a polar axes in the same tile");

outputDirectory = tempname;
[created, message] = mkdir(outputDirectory);
assert(created, "test_direction_rose_runtime:CreateDirectory", "%s", message);
cleanupOutput = onCleanup(@() remove_directory(outputDirectory));
pngPath = fullfile(outputDirectory, "direction-rose.png");
pdfPath = fullfile(outputDirectory, "direction-rose.pdf");
exportgraphics(result.Axes, pngPath, "Resolution", 150, ...
    "BackgroundColor", "white");
exportgraphics(result.Axes, pdfPath, "ContentType", "vector", ...
    "BackgroundColor", "white");
assert(isfile(pngPath) && dir(pngPath).bytes > 0, ...
    "Direction rose PNG export is missing or empty");
assert(isfile(pdfPath) && dir(pdfPath).bytes > 0, ...
    "Direction rose PDF export is missing or empty");
clear cleanupOutput cleanupFigure;
remove_directory(outputDirectory);
close_if_valid(figureHandle);
end

function [figureHandle, axesHandle] = make_axes()
figureHandle = oi_figure(640, 480, "off");
axesHandle = axes("Parent", figureHandle);
end

function must_throw(callback, identifierFragment)
didThrow = false;
try
    callback();
catch errorDetails
    didThrow = contains(string(errorDetails.identifier), identifierFragment);
end
assert(didThrow, "Expected an error containing '%s'", identifierFragment);
end

function remove_directory(directoryPath)
if isfolder(directoryPath)
    rmdir(directoryPath, "s");
end
end

function close_if_valid(figureHandle)
if isgraphics(figureHandle)
    close(figureHandle);
end
end
