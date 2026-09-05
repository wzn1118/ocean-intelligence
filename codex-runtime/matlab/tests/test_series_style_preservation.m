function test_series_style_preservation()
figureHandle = oi_figure(1200, 750, "off");
cleanup = onCleanup(@() close(figureHandle));
axesHandle = axes("Parent", figureHandle);
hold(axesHandle, "on");
observed = scatter(axesHandle, [1 2], [2 3], 30, [10; 20], ...
    "Marker", "s", "HandleVisibility", "off");
legendProxy = plot(axesHandle, NaN, NaN, "s", "LineStyle", "none");
reference = plot(axesHandle, [0 4], [0 4], "k--", ...
    "Marker", "none", "DisplayName", "1:1 reference");
uncertainty = plot(axesHandle, [0.8 1.2], [2 2], "-", ...
    "Marker", "none", "HandleVisibility", "off");
model = plot(axesHandle, [1 2], [2.1 3.2], "-.^", "DisplayName", "Model");
legend(axesHandle, [legendProxy model reference], {"Observed", "Model", "Reference"});
theme = oi_ocean_theme();
for iteration = 1:2
    oi_apply_axes(axesHandle, theme);
    drawnow;
    assert(string(observed.Marker) == "s" && string(legendProxy.Marker) == "s", ...
        "Axes styling must preserve matching observation and legend markers");
    assert(string(legendProxy.LineStyle) == "none");
    assert(string(reference.LineStyle) == "--" && string(reference.Marker) == "none", ...
        "Axes styling must not add observation markers to reference lines");
    assert(string(uncertainty.LineStyle) == "-" && string(uncertainty.Marker) == "none", ...
        "Axes styling must not turn uncertainty strokes into extra observations");
    assert(string(model.LineStyle) == "-." && string(model.Marker) == "^", ...
        "Axes styling must preserve explicit categorical encodings");
end
clear cleanup;
fprintf("MATLAB_SERIES_STYLE_PRESERVATION=passed\n");
end
