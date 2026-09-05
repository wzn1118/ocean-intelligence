function full100_family_c_contracts
testDirectory = fileparts(mfilename("fullpath"));
matlabDirectory = fileparts(testDirectory);
addpath(fullfile(matlabDirectory, "assets"));

theme = oi_ocean_theme();
test_vector_rotation_and_zero_speed(theme);
test_direction_conventions_bins_and_calm(theme);
test_direction_outer_layout(theme);
test_spectrum_evidence_confidence_and_toolbox(theme);
disp("FULL100_FAMILY_C_CONTRACTS=ok");
end

function test_vector_rotation_and_zero_speed(theme)
[figureHandle, axesHandle] = make_axes();
cleanup = onCleanup(@() close_if_valid(figureHandle));
options = struct("XUnit", "km", "YUnit", "km", "VectorUnit", "m/s", ...
    "ComponentFrame", "grid east/grid north", "PlotComponentFrame", ...
    "true east/true north", "XLabel", "East", "YLabel", "North", ...
    "ComponentRotationDegrees", 90, "RotationConvention", ...
    "counterclockwise-input-to-plot", "Theme", theme);
result = oi_plot_vector_field(axesHandle, [0 1], [0; 1], ...
    [1 0; 1 0], [0 0; 0 0], options);
assert(max(abs(result.PlotU), [], "all") < 1e-12 ...
    && isequal(result.PlotV, [1 0; 1 0]), ...
    "A 90 degree component rotation was not applied counterclockwise");
assert(result.ZeroSpeedCount == 2 && all(result.Speed(result.ZeroSpeedMask) == 0), ...
    "Zero-speed vectors must remain valid zeros rather than missing values");
clear cleanup;
close_if_valid(figureHandle);

[figureHandle, axesHandle] = make_axes();
cleanup = onCleanup(@() close_if_valid(figureHandle));
boundaryOptions = options;
boundaryOptions.ComponentRotationDegrees = 360;
boundary = oi_plot_vector_field(axesHandle, [0 1], [0; 1], ...
    ones(2), zeros(2), boundaryOptions);
assert(max(abs(boundary.PlotU - 1), [], "all") < 1e-12 ...
    && max(abs(boundary.PlotV), [], "all") < 1e-12, ...
    "The documented 360 degree rotation boundary must preserve components");
boundaryOptions.ComponentRotationDegrees = 361;
must_throw(@() oi_plot_vector_field(axesHandle, [0 1], [0; 1], ...
    ones(2), zeros(2), boundaryOptions), "ComponentRotation");
clear cleanup;
close_if_valid(figureHandle);
end

function test_direction_conventions_bins_and_calm(theme)
[figureHandle, axesHandle] = make_axes();
cleanup = onCleanup(@() close_if_valid(figureHandle));
options = struct("DirectionConvention", "from", "DisplayConvention", "to", ...
    "DirectionUnit", "degree", "Normalization", "count", ...
    "BinCount", 8, "Theme", theme);
converted = oi_plot_direction_rose(axesHandle, [0; 90], options);
assert(converted.ConventionConversionApplied ...
    && isequal(converted.DisplayedDirectionsDegrees, [180; 270]) ...
    && converted.BinValues(5) == 1 && converted.BinValues(7) == 1, ...
    "From/to conversion must rotate bearings by exactly 180 degrees");
clear cleanup;
close_if_valid(figureHandle);

[figureHandle, axesHandle] = make_axes();
cleanup = onCleanup(@() close_if_valid(figureHandle));
options.DisplayConvention = "from";
north = oi_plot_direction_rose(axesHandle, [359; 0; 1], options);
assert(north.BinValues(1) == 3 && north.BinEdgesDegrees(1) == -22.5, ...
    "The north-centered circular bin must not split samples across 0/360 degrees");
clear cleanup;
close_if_valid(figureHandle);

[figureHandle, axesHandle] = make_axes();
cleanup = onCleanup(@() close_if_valid(figureHandle));
speedOptions = options;
speedOptions.Weights = [0; 1];
speedOptions.WeightMeaning = "speed";
speedOptions.CalmThreshold = 0;
calm = oi_plot_direction_rose(axesHandle, [45; 90], speedOptions);
assert(calm.CalmCount == 1 && calm.DirectionalCount == 1 ...
    && sum(calm.SampleCounts) == 1, ...
    "Zero-speed calm samples must be reported separately from directional bins");
speedOptions.Weights = [0; 0];
must_throw(@() oi_plot_direction_rose(axesHandle, [45; 90], speedOptions), ...
    "NoDirectionalSamples");
clear cleanup;
close_if_valid(figureHandle);
end

function test_direction_outer_layout(theme)
figureHandle = oi_figure(2400, 1500, "off");
cleanup = onCleanup(@() close_if_valid(figureHandle));
figureHandle.Units = "inches";
figureHandle.Position(3:4) = [8 5];
axesHandle = axes("Parent", figureHandle, "Units", "pixels");
outerPosition = axesHandle.OuterPosition;
result = oi_plot_direction_rose(axesHandle, (0:45:315)', ...
    struct("DirectionConvention", "from", "DirectionUnit", "degree", ...
    "Normalization", "percent", "Theme", theme, "Title", "Directional rose"));
drawnow;
assert(string(result.Axes.Units) == "pixels", ...
    "Replacing Cartesian axes must preserve the parent coordinate units");
if isprop(result.Axes, "PositionConstraint") && isprop(result.Axes, "OuterPosition")
    assert(string(result.Axes.PositionConstraint) == "outerposition" ...
        && all(abs(result.Axes.OuterPosition - outerPosition) < 1e-6), ...
        "Polar axes must preserve the allocated outer layout rectangle");
end
bounds = oi_text_bounds(result.Axes.Title, figureHandle);
assert(all(bounds(1:2) >= 0) && all(bounds(1:2) + bounds(3:4) <= 1), ...
    "Directional title must fit the publication canvas: %s", mat2str(bounds, 17));
assert(sum(result.BinValues) == 100 && result.ValidCount == 8, ...
    "Polar layout must not change directional counts or normalization");
clear cleanup;
end

function test_spectrum_evidence_confidence_and_toolbox(theme)
frequency = [0.1; 0.2; 0.4; 0.8];
density = [4; 2; 1; 0.5];
base = struct("FrequencyUnit", "Hz", "PeriodUnit", "s", ...
    "DensityUnit", "m^2/Hz", "WindowDescription", "upstream metadata", ...
    "DetrendDescription", "mean removed upstream", ...
    "SegmentDescription", "one complete segment", "Theme", theme);

[figureHandle, axesHandle] = make_axes();
cleanup = onCleanup(@() close_if_valid(figureHandle));
fftOptions = base;
fftOptions.EstimatorKind = "fft";
must_throw(@() oi_plot_spectrum(axesHandle, frequency, density, fftOptions), ...
    "RegularSamplingEvidence");
fftOptions.RegularSamplingVerified = true;
fftOptions.SampleInterval = 0.5;
fftOptions.SampleIntervalUnit = "s";
fftResult = oi_plot_spectrum(axesHandle, frequency, density, fftOptions);
assert(fftResult.RegularSamplingVerified && fftResult.SampleInterval == 0.5, ...
    "Regular-sampling evidence must be retained in the result");
clear cleanup;
close_if_valid(figureHandle);

[figureHandle, axesHandle] = make_axes();
cleanup = onCleanup(@() close_if_valid(figureHandle));
welchOptions = fftOptions;
welchOptions.EstimatorKind = "welch";
must_throw(@() oi_plot_spectrum(axesHandle, frequency, density, welchOptions), ...
    "ToolboxEvidence");
welchOptions.EstimatorToolbox = "Signal Processing Toolbox";
welchOptions.ToolboxExecutionVerified = true;
welchResult = oi_plot_spectrum(axesHandle, frequency, density, welchOptions);
assert(welchResult.ToolboxExecutionVerified, ...
    "Verified upstream toolbox evidence must be retained");
clear cleanup;
close_if_valid(figureHandle);

[figureHandle, axesHandle] = make_axes();
cleanup = onCleanup(@() close_if_valid(figureHandle));
confidenceOptions = base;
confidenceOptions.DegreesOfFreedom = 8;
confidenceOptions.LowerBound = [3; NaN; 0.8; 0.4];
confidenceOptions.UpperBound = [5; NaN; 1.2; 0.6];
confidenceOptions.BoundType = "confidence-interval";
confidenceOptions.ConfidenceLevel = 0.95;
must_throw(@() oi_plot_spectrum(axesHandle, frequency, density, confidenceOptions), ...
    "IncompleteConfidenceInterval");
confidenceOptions.LowerBound = 0.8 * density;
confidenceOptions.UpperBound = 1.2 * density;
confidenceResult = oi_plot_spectrum(axesHandle, frequency, density, confidenceOptions);
assert(confidenceResult.BoundStatus == "present" ...
    && confidenceResult.MissingBoundCount == 0, ...
    "Complete confidence intervals must be accepted and reported");
clear cleanup;
close_if_valid(figureHandle);
end

function [figureHandle, axesHandle] = make_axes
figureHandle = figure("Visible", "off");
axesHandle = axes("Parent", figureHandle);
end

function must_throw(callback, identifierFragment)
thrown = false;
try
    callback();
catch exception
    thrown = contains(string(exception.identifier), identifierFragment);
end
assert(thrown, "Expected an error identifier containing " + identifierFragment);
end

function close_if_valid(figureHandle)
if isgraphics(figureHandle)
    close(figureHandle);
end
end
