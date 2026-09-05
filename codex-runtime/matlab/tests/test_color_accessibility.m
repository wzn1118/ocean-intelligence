function test_color_accessibility()
%TEST_COLOR_ACCESSIBILITY Exercise semantic color-accessibility evidence.
testsDirectory = fileparts(mfilename("fullpath"));
addpath(fullfile(fileparts(testsDirectory), "assets"));

test_distinct_native_encodings();
test_hidden_data_remains_audited();
test_legend_proxy_is_not_a_series();
test_named_segments_collapse_to_one_series();
test_reference_line_is_not_a_series();
test_continuous_color_does_not_block_categories();
test_explicit_appdata_series_identity();

fprintf("MATLAB_COLOR_ACCESSIBILITY=passed\n");
end

function test_distinct_native_encodings()
[figureHandle, axesHandle, cleanup] = test_figure();
plot(axesHandle, 1:4, [1 2 3 4], "-o", "Color", [0 0 0], ...
    "DisplayName", "Observed");
hold(axesHandle, "on");
plot(axesHandle, 1:4, [4 3 2 1], "--s", "Color", [1 1 1], ...
    "DisplayName", "Modeled");
[safe, redundant, audit] = oi_color_accessibility_audit(figureHandle);
assert(safe && redundant && audit.status == "pass" ...
    && audit.series_count == 2 && audit.palette_distinct, ...
    "Distinct native line and marker encodings must pass");
clear cleanup;
close_if_valid(figureHandle);
end

function test_hidden_data_remains_audited()
[figureHandle, axesHandle, cleanup] = test_figure();
scatter(axesHandle, [1 2], [1 2], 24, [0 0 0], "filled", ...
    "Marker", "o", "HandleVisibility", "off");
hold(axesHandle, "on");
scatter(axesHandle, [1 2], [2 1], 24, [1 1 1], "filled", ...
    "Marker", "o", "HandleVisibility", "off");
[safe, redundant, audit] = oi_color_accessibility_audit(figureHandle);
assert(~redundant && audit.status == "fail" ...
    && audit.hidden_data_count == 2 && audit.series_count == 2, ...
    "Finite HandleVisibility=off data must remain in the audit");
assert(safe, "A safe palette may be reported separately from failed redundancy");
clear cleanup;
close_if_valid(figureHandle);
end

function test_legend_proxy_is_not_a_series()
[figureHandle, axesHandle, cleanup] = test_figure();
plot(axesHandle, 1:3, [1 2 3], "-o", "Color", [0 0 0], ...
    "DisplayName", "Observed");
hold(axesHandle, "on");
plot(axesHandle, 1:3, [3 2 1], "--s", "Color", [1 1 1], ...
    "DisplayName", "Modeled");
plot(axesHandle, NaN, NaN, "-o", "Color", [0 0 0]);
[~, redundant, audit] = oi_color_accessibility_audit(figureHandle);
assert(redundant && audit.legend_proxy_count == 1 && audit.series_count == 2, ...
    "Style-only legend proxies must not become independent data series");
clear cleanup;
close_if_valid(figureHandle);
end

function test_named_segments_collapse_to_one_series()
[figureHandle, axesHandle, cleanup] = test_figure();
plot(axesHandle, [1 2], [1 2], "-o", "Color", [0 0 0], ...
    "DisplayName", "Observed");
hold(axesHandle, "on");
plot(axesHandle, [3 4], [3 4], "-o", "Color", [0 0 0], ...
    "DisplayName", "Observed");
plot(axesHandle, 1:4, [4 3 2 1], "--s", "Color", [1 1 1], ...
    "DisplayName", "Modeled");
[~, redundant, audit] = oi_color_accessibility_audit(figureHandle);
assert(redundant && audit.series_count == 2 ...
    && audit.same_series_collapsed_count == 1, ...
    "Named segments of one displayed series must collapse before comparison");
clear cleanup;
close_if_valid(figureHandle);
end

function test_reference_line_is_not_a_series()
[figureHandle, axesHandle, cleanup] = test_figure();
scatter(axesHandle, [1 2 3], [1.1 1.9 3.2], 24, [0 0 0], "filled", ...
    "Marker", "o", "DisplayName", "Paired samples");
hold(axesHandle, "on");
plot(axesHandle, [1 3], [1 3], "-o", "Color", [0 0 0], ...
    "DisplayName", "1:1 reference");
[~, redundant, audit] = oi_color_accessibility_audit(figureHandle);
assert(redundant && audit.reference_count == 1 && audit.series_count == 1, ...
    "An explicit reference line must not compete with data-series encoding");
clear cleanup;
close_if_valid(figureHandle);
end

function test_continuous_color_does_not_block_categories()
[figureHandle, axesHandle, cleanup] = test_figure();
scatter(axesHandle, [1 2 3], [3 1 2], 24, [10; 20; 30], "filled", ...
    "Marker", "o", "HandleVisibility", "off");
[safe, redundant, audit] = oi_color_accessibility_audit(figureHandle);
assert(safe && redundant && audit.status == "pass" ...
    && audit.category_status == "not-applicable" ...
    && audit.continuous_color_status == "not-evaluated" ...
    && audit.continuous_color_object_count == 1 ...
    && ~audit.visual_inspection_verified, ...
    "Continuous CData must remain pending without becoming a category failure");
clear cleanup;
close_if_valid(figureHandle);
end

function test_explicit_appdata_series_identity()
[figureHandle, axesHandle, cleanup] = test_figure();
firstSegment = plot(axesHandle, [1 2], [1 2], "-o", "Color", [0 0 0], ...
    "HandleVisibility", "off");
hold(axesHandle, "on");
secondSegment = plot(axesHandle, [3 4], [3 4], "-o", "Color", [0 0 0], ...
    "HandleVisibility", "off");
setappdata(firstSegment, "OI_ColorAccessibilityRole", "data");
setappdata(secondSegment, "OI_ColorAccessibilityRole", "data");
setappdata(firstSegment, "OI_ColorAccessibilitySeriesId", "observed");
setappdata(secondSegment, "OI_ColorAccessibilitySeriesId", "observed");
plot(axesHandle, 1:4, [4 3 2 1], "--s", "Color", [1 1 1], ...
    "DisplayName", "Modeled");
[~, redundant, audit] = oi_color_accessibility_audit(figureHandle);
assert(redundant && audit.series_count == 2 ...
    && audit.hidden_data_count == 2 ...
    && audit.same_series_collapsed_count == 1, ...
    "Explicit role and series appdata must provide traceable grouping evidence");
clear cleanup;
close_if_valid(figureHandle);
end

function [figureHandle, axesHandle, cleanup] = test_figure()
figureHandle = figure("Visible", "off", "Color", "white");
cleanup = onCleanup(@() close_if_valid(figureHandle));
axesHandle = axes("Parent", figureHandle);
end

function close_if_valid(figureHandle)
if ~isempty(figureHandle) && isgraphics(figureHandle)
    close(figureHandle);
end
end
