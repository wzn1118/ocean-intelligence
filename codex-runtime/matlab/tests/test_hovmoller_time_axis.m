function test_hovmoller_time_axis(outputDirectory)
%TEST_HOVMOLLER_TIME_AXIS Native UTC rulers and publication tick spacing.
% Pass an output directory to retain 8-by-5-inch PNG/PDF fixtures for review.
if nargin < 1
    outputDirectory = "";
end
testDirectory = fileparts(mfilename("fullpath"));
addpath(fullfile(fileparts(testDirectory), "assets"));
theme = oi_ocean_theme();
startTimes = [datetime(2024,1,1,0,0,0,"TimeZone","UTC"); ...
    datetime(2024,1,1,22,0,0,"TimeZone","UTC"); ...
    datetime(2024,1,31,22,0,0,"TimeZone","UTC"); ...
    datetime(2024,12,31,22,0,0,"TimeZone","UTC")];
caseNames = ["same-day" "cross-day" "cross-month" "cross-year"];
for caseIndex = 1:numel(startTimes)
    times = startTimes(caseIndex) + hours((0:4)');
    test_regular_axis(times, caseNames(caseIndex), theme, outputDirectory);
end
test_irregular_times_rejected(theme);
test_explicit_format(theme, outputDirectory);
test_overlap_detection(theme);
test_invalid_times(theme);
disp("MATLAB_HOVMOLLER_TIME_AXIS=ok");
end

function test_regular_axis(times, caseName, theme, outputDirectory)
[figureHandle, axesHandle, cleanup] = make_axes();
values = [10 11 12 13 14;9 10 NaN 12 13;8 9 10 11 12];
result = oi_plot_hovmoller(axesHandle, times, [0;10;20], values, options(theme));
assert(isgraphics(result.Image,"image") && isequaln(result.Image.CData,values) ...
    && isequal(logical(result.Image.AlphaData),isfinite(values)), ...
    "Uniform time must preserve the image data and missing-cell alpha mask");
assert(result.MissingCount == 1 && result.ValidCount == 14 && ~result.Interpolated, ...
    "Time-axis formatting must not change field values or missing counts");
assert(result.NumericTimeFallback == verLessThan("matlab","23.2"), ...
    "The pre-R2023b graphics-coordinate fallback must remain explicit");
imageTimes = result.Image.XData;
if isnumeric(imageTimes)
    imageTimes = num2ruler(imageTimes,axesHandle.XAxis);
end
assert(isequal(imageTimes(:),times([1 end])), ...
    "Image pixel centers must retain their original UTC times on every release");
assert_native_axis(axesHandle, result, times, theme);
assert_uncluttered_ticks(axesHandle);
export_fixture(figureHandle, caseName, outputDirectory);
figureHandle.Position(3:4) = [6 5];
drawnow;
assert_uncluttered_ticks(axesHandle);
clear cleanup;
end

function test_irregular_times_rejected(theme)
[figureHandle, axesHandle, cleanup] = make_axes();
times = datetime(2024,1,31,22,0,0,"TimeZone","UTC") + hours([0;0.5;3;6;9]);
values = [10 NaN 12 13 14;9 10 11 NaN 13;8 9 10 11 12];
originalChildren = axesHandle.Children;
must_throw(@() oi_plot_hovmoller(axesHandle,times,[0;10;20],values,options(theme)), ...
    "oi_plot_hovmoller:TimeCadence");
assert(isequal(axesHandle.Children,originalChildren), ...
    "Irregular times must be rejected before creating any plot objects");
clear cleanup;
end

function test_explicit_format(theme, outputDirectory)
[figureHandle, axesHandle, cleanup] = make_axes();
times = datetime(2024,1,1,0,0,0,"TimeZone","UTC") + hours((0:4)');
plotOptions = options(theme);
plotOptions.TimeDisplayFormat = "MM-dd HH:mm";
values = [10 11 12 13 14;9 10 NaN 12 13];
result = oi_plot_hovmoller(axesHandle,times,[0;10],values,plotOptions);
assert(result.TimeDisplayFormat == plotOptions.TimeDisplayFormat ...
    && string(axesHandle.XAxis.TickLabelFormat) == plotOptions.TimeDisplayFormat, ...
    "Explicit native tick formats must be honored on every supported release");
assert_uncluttered_ticks(axesHandle);
export_fixture(figureHandle,"explicit-format",outputDirectory);
clear cleanup;
end

function test_invalid_times(theme)
[figureHandle, axesHandle, cleanup] = make_axes();
times = datetime(2024,1,1,0,0,0,"TimeZone","UTC") + hours((0:2)');
invalidTimes = {times([1 2 2]),times([1 3 2]),times};
invalidTimes{3}(2) = NaT("TimeZone","UTC");
for caseIndex = 1:numel(invalidTimes)
    must_throw(@() oi_plot_hovmoller(axesHandle,invalidTimes{caseIndex}, ...
        [0;10],ones(2,3),options(theme)),"oi_plot_hovmoller:TimeCoordinate");
end
times.TimeZone = "";
must_throw(@() oi_plot_hovmoller(axesHandle,times,[0;10],ones(2,3), ...
    options(theme)),"oi_plot_hovmoller:TimeZone");
clear cleanup;
end

function test_overlap_detection(theme)
[figureHandle, axesHandle, cleanup] = make_axes();
times = datetime(2024,1,1,0,0,0,"TimeZone","UTC") + hours((0:4)');
oi_plot_hovmoller(axesHandle,times,[0;10],ones(2,5),options(theme));
xticks(axesHandle,times);
xtickformat(axesHandle,"yyyy-MM-dd HH:mm");
must_throw(@() assert_uncluttered_ticks(axesHandle), ...
    "test_hovmoller_time_axis:TickOverlap");
clear cleanup;
end

function assert_native_axis(axesHandle, result, times, theme)
drawnow;
assert(isa(axesHandle.XAxis,"matlab.graphics.axis.decorator.DatetimeRuler") ...
    && isdatetime(axesHandle.XTick) && string(axesHandle.XTick.TimeZone) == "UTC", ...
    "All releases must use a native UTC datetime ruler, not datetick strings");
assert(string(axesHandle.XTickMode) == "auto" ...
    && string(axesHandle.XTickLabelMode) == "auto" ...
    && result.TimeDisplayFormat == "auto", ...
    "The native ruler must retain automatic tick locations and date context");
timePadding = (times(2) - times(1))/2;
expectedLimits = [times(1)-timePadding; times(end)+timePadding];
assert(isequal(axesHandle.XLim(:),expectedLimits) ...
    && isequal(axesHandle.YLim,[-5 25]) ...
    && string(axesHandle.YDir) == "reverse", ...
    "The full time-depth cell extent and original datetime samples must survive");
assert(string(axesHandle.XLabel.String) == "Time (UTC)" ...
    && axesHandle.FontSize == theme.FontSize ...
    && isempty(findall(axesHandle,"Type","line")), ...
    "UTC, font size, and removal of the temporary ruler seed must be preserved");
tickText = strjoin(string(axesHandle.XTickLabel)," ");
dateText = tickText + " " + strjoin(string(axesHandle.XAxis.SecondaryLabel.String)," ");
assert(contains(tickText,":") ...
    && any(contains(dateText,string(year(times([1 end]))))), ...
    "Hourly fixtures must show both clock times and native date context");
end

function assert_uncluttered_ticks(axesHandle)
drawnow;
ticks = axesHandle.XTick;
labels = string(axesHandle.XTickLabel);
inside = ticks >= axesHandle.XLim(1) & ticks <= axesHandle.XLim(2);
ticks = ticks(inside);
labels = labels(inside);
labels = labels(:);
assert(numel(ticks) >= 3 && numel(labels) == numel(ticks), ...
    "The hourly fixture needs several readable ticks, not a hidden time axis");
oldUnits = axesHandle.Units;
axesHandle.Units = "points";
axesWidth = axesHandle.Position(3);
axesHandle.Units = oldUnits;
positions = seconds(ticks - axesHandle.XLim(1)) ...
    / seconds(diff(axesHandle.XLim)) * axesWidth;
originalChildren = axesHandle.Children;
probe = text("Parent",axesHandle,"Units","normalized","Position",[0.5 0.5 0], ...
    "String","","Visible","on","FontUnits","points", ...
    "HorizontalAlignment","center","VerticalAlignment","middle", ...
    "Interpreter",axesHandle.TickLabelInterpreter, ...
    "FontName",axesHandle.FontName,"FontSize",axesHandle.FontSize, ...
    "FontWeight",axesHandle.FontWeight,"FontAngle",axesHandle.FontAngle);
probePng = [tempname '.png'];
probeCleanup = onCleanup(@() cleanup_tick_probe(probe,probePng));
probe.Units = "points";
widths = zeros(size(labels));
for labelIndex = 1:numel(labels)
    probe.String = labels(labelIndex);
    exportgraphics(axesHandle,probePng,'Resolution',150,'BackgroundColor','white');
    imageInfo = imfinfo(probePng);
    assert(imageInfo.Width > 0 && imageInfo.Height > 0, ...
        "test_hovmoller_time_axis:ProbeExport","Tick probe PNG must contain pixels");
    drawnow;
    extent = probe.Extent;
    widths(labelIndex) = extent(3);
    delete(probePng);
end
clear probeCleanup;
assert(isequal(axesHandle.Children,originalChildren) && ~isfile(probePng), ...
    "test_hovmoller_time_axis:ProbeCleanup","Tick probes must not enter fixture artifacts");
assert(all(isfinite(widths) & widths > 0), ...
    "Tick text extents must be measured, not assumed empty");
assert(all(diff(positions(:)) > (widths(1:end-1) + widths(2:end))/2 + 2), ...
    "test_hovmoller_time_axis:TickOverlap", ...
    "Adjacent datetime tick labels overlap at publication font size");
end

function cleanup_tick_probe(probe, probePng)
if isgraphics(probe)
    delete(probe);
end
if isfile(probePng)
    delete(probePng);
end
end

function export_fixture(figureHandle, caseName, outputDirectory)
if strlength(string(outputDirectory)) == 0
    return;
end
if ~isfolder(outputDirectory)
    mkdir(outputDirectory);
end
print(figureHandle,fullfile(outputDirectory,caseName + ".png"),"-dpng","-r300");
print(figureHandle,fullfile(outputDirectory,caseName + ".pdf"),"-dpdf","-painters");
end

function plotOptions = options(theme)
plotOptions = struct("DepthUnit","m","QuantityLabel","Temperature", ...
    "QuantityUnit","degC","ColorLimits",[7 15],"Theme",theme);
end

function [figureHandle, axesHandle, cleanup] = make_axes()
figureHandle = figure("Visible","off","Units","inches","Position",[1 1 8 5], ...
    "PaperUnits","inches","PaperSize",[8 5],"PaperPosition",[0 0 8 5], ...
    "PaperPositionMode","manual","Color","white");
axesHandle = axes("Parent",figureHandle);
cleanup = onCleanup(@() close(figureHandle));
end

function must_throw(callback, identifier)
try
    callback();
catch exception
    assert(string(exception.identifier) == identifier, ...
        "Expected %s, got %s",identifier,exception.identifier);
    return;
end
error("test_hovmoller_time_axis:MissingError","Expected %s",identifier);
end
