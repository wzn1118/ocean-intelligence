function oi_apply_axes(axesHandle, theme)
%OI_APPLY_AXES Apply deterministic MATLAB-native axes styling.
% Input contract: axesHandle is an explicit Cartesian or polar axes handle.
% Styling does not alter units, limits, direction, scale, or missing values.
arguments
    axesHandle (1,1) {mustBeValidAxes}
    theme (1,1) struct = struct()
end
replacement = [];
if isappdata(axesHandle, "OI_ReplacementAxes")
    candidate = getappdata(axesHandle, "OI_ReplacementAxes");
    if ~isempty(candidate) && isgraphics(candidate)
        replacement = candidate;
    end
end
if ~isempty(replacement)
    axesHandle = replacement;
end
if isempty(fieldnames(theme))
    theme = oi_ocean_theme();
end
set_if_property(axesHandle, "Color", theme.AxesColor);
set_if_property(axesHandle, "FontName", theme.FontName);
set_if_property(axesHandle, "FontSize", theme.FontSize);
set_if_property(axesHandle, "LineWidth", 0.9);
set_if_property(axesHandle, "GridColor", theme.GridColor);
set_if_property(axesHandle, "GridAlpha", 0.35);
set_if_property(axesHandle, "MinorGridAlpha", 0.18);
set_if_property(axesHandle, "ColorOrder", theme.LineColors);
set_if_property(axesHandle, "LineStyleOrder", cellstr(theme.LineStyles));
set_if_property(axesHandle, "TickLabelInterpreter", "none");
if isa(axesHandle, "matlab.graphics.axis.PolarAxes")
    set_if_property(axesHandle, "ThetaColor", theme.TextColor);
    set_if_property(axesHandle, "RColor", theme.TextColor);
else
    set_if_property(axesHandle, "TickDir", "out");
    set_if_property(axesHandle, "TickLength", [0.008 0.008]);
    set_if_property(axesHandle, "Box", "on");
end
grid(axesHandle, "on");
if isprop(axesHandle, "Layer")
    axesHandle.Layer = "top";
end
if ~isa(axesHandle, "matlab.graphics.axis.PolarAxes") && isprop(axesHandle, "XColor")
    axesHandle.XColor = theme.TextColor;
end
if ~isa(axesHandle, "matlab.graphics.axis.PolarAxes") && isprop(axesHandle, "YColor")
    axesHandle.YColor = theme.TextColor;
end
style_axis_text(axesHandle, theme);
apply_redundant_series_encoding(axesHandle, theme);
setappdata(axesHandle, "OI_PublicationTheme", theme.Name);
end

function apply_redundant_series_encoding(axesHandle, theme)
series = findall(axesHandle, "Type", "line", "-or", "Type", "scatter");
series = flipud(series(:));
if numel(series) < 2
    return;
end
for index = 1:numel(series)
    styleIndex = mod(index - 1, numel(theme.LineStyles)) + 1;
    markerIndex = mod(index - 1, numel(theme.Markers)) + 1;
    if isprop(series(index), "LineStyle") ...
            && string(series(index).LineStyle) ~= "none"
        series(index).LineStyle = theme.LineStyles(styleIndex);
    end
    if isprop(series(index), "Marker")
        series(index).Marker = theme.Markers(markerIndex);
    end
end
end

function set_if_property(objectHandle, propertyName, propertyValue)
if isprop(objectHandle, propertyName)
    objectHandle.(propertyName) = propertyValue;
end
end

function style_axis_text(axesHandle, theme)
textObjects = findall(axesHandle, "Type", "text");
for index = 1:numel(textObjects)
    set_if_property(textObjects(index), "FontName", theme.FontName);
    set_if_property(textObjects(index), "FontUnits", "points");
    set_if_property(textObjects(index), "Color", theme.TextColor);
    set_if_property(textObjects(index), "Interpreter", "none");
    set_if_property(textObjects(index), "Clipping", "off");
    if isprop(textObjects(index), "FontSize")
        textObjects(index).FontSize = max(textObjects(index).FontSize, theme.FontSize);
    end
end
style_named_text(axesHandle, "XLabel", theme.LabelSize, theme);
style_named_text(axesHandle, "YLabel", theme.LabelSize, theme);
style_named_text(axesHandle, "ZLabel", theme.LabelSize, theme);
style_named_text(axesHandle, "Title", theme.TitleSize, theme);
end

function style_named_text(axesHandle, propertyName, fontSize, theme)
if ~isprop(axesHandle, propertyName)
    return;
end
textHandle = axesHandle.(propertyName);
if isempty(textHandle) || ~isgraphics(textHandle)
    return;
end
set_if_property(textHandle, "FontName", theme.FontName);
set_if_property(textHandle, "FontUnits", "points");
set_if_property(textHandle, "FontSize", fontSize);
set_if_property(textHandle, "Color", theme.TextColor);
set_if_property(textHandle, "Interpreter", "none");
set_if_property(textHandle, "Clipping", "off");
end

function mustBeValidAxes(value)
assert(isgraphics(value, "axes") || isa(value, "matlab.graphics.axis.PolarAxes"), ...
    "oi_apply_axes:InvalidAxes", "axesHandle must be a valid axes object");
end
