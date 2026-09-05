function test_hovmoller_time_axis(outputDirectory)
%TEST_HOVMOLLER_TIME_AXIS Native UTC rulers and publication tick spacing.
% Pass an output directory to retain 8-by-5-inch PNG/PDF fixtures for review.
if nargin < 1
    outputDirectory = "";
end
testDirectory = fileparts(mfilename("fullpath"));
addpath(fullfile(fileparts(testDirectory), "assets"));
theme = oi_ocean_theme();
test_coordinate_tolerance();
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
test_overlap_detection(theme, outputDirectory);
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
render_axes(axesHandle);
assert_image_centers(result.Image, axesHandle, times, outputDirectory, caseName);
assert_native_axis(axesHandle, result, times, theme, outputDirectory, caseName);
assert_uncluttered_ticks(axesHandle, theme, outputDirectory, caseName + "-8in");
export_fixture(figureHandle, caseName, outputDirectory);
figureHandle.Position(3:4) = [6 5];
drawnow;
assert_uncluttered_ticks(axesHandle, theme, outputDirectory, caseName + "-6in");
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
assert_uncluttered_ticks(axesHandle, theme, outputDirectory, "explicit-format");
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

function test_overlap_detection(theme, outputDirectory)
[figureHandle, axesHandle, cleanup] = make_axes();
times = datetime(2024,1,1,0,0,0,"TimeZone","UTC") + hours((0:4)');
oi_plot_hovmoller(axesHandle,times,[0;10],ones(2,5),options(theme));
xticks(axesHandle,times);
xtickformat(axesHandle,"yyyy-MM-dd HH:mm");
xticklabels(axesHandle,string(times,"yyyy-MM-dd HH:mm"));
xtickangle(axesHandle,0);
try
    details = assert_uncluttered_ticks(axesHandle,theme,outputDirectory,"overlap-negative");
catch exception
    if string(exception.identifier) ~= "test_hovmoller_time_axis:TickOverlap"
        rethrow(exception);
    end
    clear cleanup;
    return;
end
error("test_hovmoller_time_axis:MissingOverlap", ...
    "Five forced full-date labels must overlap; measured=%s",details);
end

function assert_image_centers(imageHandle, axesHandle, times, outputDirectory, caseName)
evidence = struct("release",version('-release'),"ruler_class",class(axesHandle.XAxis), ...
    "image_xdata",coordinate_record(imageHandle.XData,axesHandle.XAxis), ...
    "expected_times",coordinate_record(times,axesHandle.XAxis), ...
    "pixel_columns",size(imageHandle.CData,2), ...
    "geometry_rule","Image uses first/last XData as outer pixel centers; interior centers are uniform");
rawNumeric = evidence.image_xdata.ruler_numeric;
expectedNumeric = evidence.expected_times.ruler_numeric;
details = record_diagnostic(outputDirectory,caseName + "-coordinates",evidence);
assert(isvector(rawNumeric) && numel(rawNumeric) >= 2 ...
    && evidence.pixel_columns == numel(times), ...
    "test_hovmoller_time_axis:ImageCoordinates","Unexpected image coordinates; measured=%s",details);
actualCenters = linspace(rawNumeric(1),rawNumeric(end),evidence.pixel_columns)';
evidence.comparison = compare_numeric_coordinates(actualCenters,expectedNumeric);
evidence.sample_spacing_ruler = diff(expectedNumeric(:));
evidence.ruler_timezone = string(axesHandle.XLim.TimeZone);
timezonePreserved = evidence.ruler_timezone == "UTC" ...
    && evidence.expected_times.timezone == "UTC" ...
    && (~isdatetime(imageHandle.XData) || evidence.image_xdata.timezone == "UTC");
evidence.timezone_preserved = timezonePreserved;
details = record_diagnostic(outputDirectory,caseName + "-coordinates",evidence);
assert(timezonePreserved && evidence.comparison.within_ulp, ...
    "test_hovmoller_time_axis:ImageCoordinates", ...
    "Image centers differ in the same ruler units or timezone; measured=%s",details);
end

function assert_native_axis(axesHandle, result, times, theme, outputDirectory, caseName)
timePadding = (times(2) - times(1))/2;
expectedLimits = [times(1)-timePadding; times(end)+timePadding];
evidence = struct("ruler_class",class(axesHandle.XAxis), ...
    "limits",coordinate_record(axesHandle.XLim,axesHandle.XAxis), ...
    "expected_limits",coordinate_record(expectedLimits,axesHandle.XAxis), ...
    "tick_mode",string(axesHandle.XTickMode),"label_mode",string(axesHandle.XTickLabelMode), ...
    "format",result.TimeDisplayFormat,"ylabel_limits",axesHandle.YLim, ...
    "ydir",string(axesHandle.YDir),"xlabel",string(axesHandle.XLabel.String), ...
    "font_size",axesHandle.FontSize,"expected_font_size",theme.FontSize, ...
    "line_count",numel(findall(axesHandle,"Type","line")), ...
    "labels",string(axesHandle.XTickLabel), ...
    "secondary_label",string(axesHandle.XAxis.SecondaryLabel.String));
evidence.limits_comparison = compare_numeric_coordinates( ...
    evidence.limits.ruler_numeric,evidence.expected_limits.ruler_numeric);
details = record_diagnostic(outputDirectory,caseName + "-axis",evidence);
assert(isa(axesHandle.XAxis,"matlab.graphics.axis.decorator.DatetimeRuler") ...
    && isdatetime(axesHandle.XTick) && string(axesHandle.XTick.TimeZone) == "UTC", ...
    "test_hovmoller_time_axis:NativeAxis","Expected native UTC datetime ruler; measured=%s",details);
assert(string(axesHandle.XTickMode) == "auto" ...
    && string(axesHandle.XTickLabelMode) == "auto" ...
    && result.TimeDisplayFormat == "auto", ...
    "test_hovmoller_time_axis:NativeAxis","Expected automatic ticks and date context; measured=%s",details);
assert(evidence.limits_comparison.within_ulp ...
    && isequal(axesHandle.YLim,[-5 25]) ...
    && string(axesHandle.YDir) == "reverse", ...
    "test_hovmoller_time_axis:NativeAxis","Time-depth image extent changed; measured=%s",details);
assert(string(axesHandle.XLabel.String) == "Time (UTC)" ...
    && axesHandle.FontSize == theme.FontSize ...
    && isempty(findall(axesHandle,"Type","line")), ...
    "test_hovmoller_time_axis:NativeAxis","UTC, font size, or seed cleanup changed; measured=%s",details);
tickText = strjoin(string(axesHandle.XTickLabel)," ");
dateText = tickText + " " + strjoin(string(axesHandle.XAxis.SecondaryLabel.String)," ");
assert(contains(tickText,":") ...
    && any(contains(dateText,string(year(times([1 end]))))), ...
    "test_hovmoller_time_axis:DateContext","Expected clock times and date context; measured=%s",details);
end

function details = assert_uncluttered_ticks(axesHandle, theme, outputDirectory, caseName)
evidence = struct("release",version('-release'),"pre_render_png_pixels",render_axes(axesHandle));
state = tick_state(axesHandle);
evidence.before_probes = state;
details = record_diagnostic(outputDirectory,caseName + "-ticks",evidence);
labels = state.labels;
ticks = state.ticks.ruler_numeric(:);
limits = state.limits.ruler_numeric(:);
assert(numel(labels) == numel(ticks), ...
    "test_hovmoller_time_axis:TickLabels","Native tick/label lengths differ; measured=%s",details);
visible = ticks >= limits(1) & ticks <= limits(2) ...
    & ~ismissing(labels) & strlength(strtrim(labels)) > 0;
evidence.visible_indices = find(visible);
evidence.omitted_empty_or_outside_indices = find(~visible);
labels = labels(visible);
positions = (ticks(visible) - limits(1)) / diff(limits) * state.axes_position_points(3);
evidence.positions_points = positions;
evidence.expected_font_size = theme.FontSize;
details = record_diagnostic(outputDirectory,caseName + "-ticks",evidence);
assert(numel(labels) >= 3 && state.axes_visible == "on" && state.ruler_visible == "on", ...
    "test_hovmoller_time_axis:VisibleTicks", ...
    "Expected at least three visible nonempty ticks after native render; measured=%s",details);
assert(state.font_size == theme.FontSize && state.font_units == "points", ...
    "test_hovmoller_time_axis:TickFont","Tick font size/units changed; measured=%s",details);
originalChildren = axesHandle.Children;
probe = text("Parent",axesHandle,"Units","normalized","Position",[0.5 0.5 0], ...
    "String","","Visible","on","FontUnits","points", ...
    "HorizontalAlignment","center","VerticalAlignment","middle", ...
    "Interpreter",axesHandle.TickLabelInterpreter, ...
    "FontName",axesHandle.FontName,"FontSize",axesHandle.FontSize, ...
    "FontWeight",axesHandle.FontWeight,"FontAngle",axesHandle.FontAngle, ...
    "Rotation",state.rotation);
probeCleanup = onCleanup(@() delete(probe));
probe.Units = "points";
extents = NaN(numel(labels),4);
evidence.measured_labels = labels;
evidence.probe_visible = string(probe.Visible);
evidence.probe_units = string(probe.Units);
evidence.probe_png_pixels = NaN(numel(labels),2);
for labelIndex = 1:numel(labels)
    probe.String = labels(labelIndex);
    evidence.current_label_index = labelIndex;
    evidence.extents_points = extents;
    record_diagnostic(outputDirectory,caseName + "-ticks",evidence);
    evidence.probe_png_pixels(labelIndex,:) = render_axes(axesHandle);
    extents(labelIndex,:) = probe.Extent;
    evidence.extents_points = extents;
    details = record_diagnostic(outputDirectory,caseName + "-ticks",evidence);
    assert(all(isfinite(extents(labelIndex,:))) && all(extents(labelIndex,3:4) > 0), ...
        "test_hovmoller_time_axis:TickExtent", ...
        "Nonempty visible label has invalid native extent after export; measured=%s",details);
end
clear probeCleanup;
evidence.post_render_png_pixels = render_axes(axesHandle);
evidence.after_probes = tick_state(axesHandle);
evidence.probe_cleanup_complete = isequal(axesHandle.Children,originalChildren);
evidence.gaps_points = diff(positions) - (extents(1:end-1,3) + extents(2:end,3))/2;
evidence.position_comparison_points = compare_numeric_coordinates( ...
    evidence.after_probes.axes_position_points,state.axes_position_points);
evidence.layout_stable = evidence.position_comparison_points.within_ulp ...
    && isequal(rmfield(state,"axes_position_points"), ...
    rmfield(evidence.after_probes,"axes_position_points"));
details = record_diagnostic(outputDirectory,caseName + "-ticks",evidence);
assert(evidence.probe_cleanup_complete, ...
    "test_hovmoller_time_axis:ProbeCleanup","Probe cleanup failed; measured=%s",details);
assert(evidence.layout_stable, ...
    "test_hovmoller_time_axis:TickLayoutChanged", ...
    "Native tick layout changed during measurement; cannot conclude spacing; measured=%s",details);
assert(all(evidence.gaps_points > 2), ...
    "test_hovmoller_time_axis:TickOverlap", ...
    "Adjacent rendered tick labels lack the required two-point gap; measured=%s",details);
end

function state = tick_state(axesHandle)
oldUnits = axesHandle.Units;
unitsCleanup = onCleanup(@() set(axesHandle,"Units",oldUnits));
axesHandle.Units = "points";
state = struct("axes_position_points",axesHandle.Position, ...
    "ticks",coordinate_record(axesHandle.XTick,axesHandle.XAxis), ...
    "limits",coordinate_record(axesHandle.XLim,axesHandle.XAxis), ...
    "labels",string(axesHandle.XTickLabel),"font_name",string(axesHandle.FontName), ...
    "font_size",axesHandle.FontSize,"font_units",string(axesHandle.FontUnits), ...
    "rotation",axesHandle.XTickLabelRotation,"axes_visible",string(axesHandle.Visible), ...
    "ruler_visible",string(axesHandle.XAxis.Visible));
state.labels = state.labels(:);
clear unitsCleanup;
end

function record = coordinate_record(values, ruler)
numericValues = ruler2num(values,ruler);
record = struct("class",class(values),"size",size(values),"timezone","", ...
    "format","","ruler_numeric_class",class(numericValues), ...
    "ruler_numeric",double(numericValues), ...
    "conversion","ruler2num with the same axes ruler; input timezone unchanged");
if isdatetime(values)
    record.values = string(values,"yyyy-MM-dd HH:mm:ss.SSSSSSSSS");
    record.timezone = string(values.TimeZone);
    record.format = string(values.Format);
else
    record.values = mat2str(values,17);
end
record.ruler_numeric_hex = cellstr(num2hex(record.ruler_numeric(:)));
end

function comparison = compare_numeric_coordinates(actual, expected)
actual = actual(:);
expected = expected(:);
endpointUlp = max(eps(abs([actual([1 end]); expected([1 end])])));
ulp = max(max(eps(abs(actual)),eps(abs(expected))),endpointUlp);
errorValues = abs(actual-expected);
tolerance = 4*ulp;
comparison = struct("actual",actual,"expected",expected,"absolute_error",errorValues, ...
    "ulp",ulp,"error_in_ulp",errorValues./ulp,"tolerance",tolerance, ...
    "tolerance_rule","4 ULP of coordinates/endpoints in identical units; no sample-interval tolerance", ...
    "within_ulp",all(isfinite(actual) & isfinite(expected) & errorValues <= tolerance));
end

function test_coordinate_tolerance()
expected = [0;3600;7200];
rounded = expected;
rounded(2) = rounded(2) + eps(rounded(2));
rounding = compare_numeric_coordinates(rounded,expected);
shifted = compare_numeric_coordinates(expected + 3600,expected);
assert(rounding.within_ulp && ~shifted.within_ulp, ...
    "test_hovmoller_time_axis:CoordinateTolerance", ...
    "Tolerance must accept one ULP but reject a whole sample shift; rounding=%s; shifted=%s", ...
    jsonencode(rounding),jsonencode(shifted));
end

function pixels = render_axes(axesHandle)
pngPath = [tempname '.png'];
pngCleanup = onCleanup(@() delete_if_present(pngPath));
exportgraphics(axesHandle,pngPath,'Resolution',150,'BackgroundColor','white');
imageInfo = imfinfo(pngPath);
pixels = [imageInfo.Width imageInfo.Height];
assert(all(pixels > 0),"test_hovmoller_time_axis:NativeRender", ...
    "Native pre-render PNG must contain pixels; file=%s; size=%s",pngPath,mat2str(pixels));
drawnow;
clear pngCleanup;
end

function delete_if_present(filePath)
if isfile(filePath)
    delete(filePath);
end
end

function details = record_diagnostic(outputDirectory, caseName, evidence)
details = jsonencode(evidence);
fprintf("MATLAB_HOVMOLLER_DIAGNOSTIC %s=%s\n",caseName,details);
if strlength(string(outputDirectory)) == 0
    return;
end
if ~isfolder(outputDirectory)
    mkdir(outputDirectory);
end
jsonPath = fullfile(outputDirectory,caseName + ".json");
fileId = fopen(jsonPath,"w");
assert(fileId >= 0,"test_hovmoller_time_axis:DiagnosticFile", ...
    "Cannot write measured diagnostics: %s",jsonPath);
fileCleanup = onCleanup(@() fclose(fileId));
fprintf(fileId,"%s\n",details);
clear fileCleanup;
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
