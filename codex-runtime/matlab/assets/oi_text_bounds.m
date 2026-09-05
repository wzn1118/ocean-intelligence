function [bounds, diagnostics] = oi_text_bounds(textHandle, figureHandle)
%OI_TEXT_BOUNDS Measure a text object's rendered extent in figure coordinates.
% The returned [left bottom width height] bounds are normalized to the
% figure's drawable pixel canvas. Call this only after final fonts, strings,
% interpreters, and rotations are set. MATLAB's Extent includes alignment and
% rotation but excludes the Text Margin. The result is graphics geometry; it
% does not verify exported glyphs or artifact-level clipping.
arguments
    textHandle (1,1)
    figureHandle (1,1)
end

assert(isgraphics(textHandle, "text"), "oi_text_bounds:InvalidText", ...
    "textHandle must be a valid scalar MATLAB text object");
assert(isgraphics(figureHandle, "figure"), "oi_text_bounds:InvalidFigure", ...
    "figureHandle must be a valid scalar MATLAB figure");
ownerFigure = ancestor(textHandle, "figure");
assert(~isempty(ownerFigure) && isequal(ownerFigure, figureHandle), ...
    "oi_text_bounds:FigureMismatch", ...
    "textHandle must belong to figureHandle");
assert(isprop(textHandle, "Units") && isprop(textHandle, "Extent"), ...
    "oi_text_bounds:UnsupportedText", ...
    "textHandle must expose Units and Extent properties");

if nargout > 1
    entryState = text_state(textHandle);
end
drawnow;
assert(isgraphics(textHandle, "text") && isgraphics(figureHandle, "figure"), ...
    "oi_text_bounds:DeletedGraphics", ...
    "The text or figure was deleted while graphics were rendered");

figurePixels = double(getpixelposition(figureHandle));
validate_pixel_rectangle(figurePixels, "figure");

originalUnits = textHandle.Units;
if nargout > 1
    sourceState = text_state(textHandle);
    originalPosition = sourceState.position;
    originalExtent = sourceState.extent;
end
unitsCleanup = onCleanup(@() restore_units(textHandle, originalUnits));
textHandle.Units = "pixels";
if nargout > 1
    pixelsBeforeDraw = text_state(textHandle);
    positionPixelsBeforeDraw = pixelsBeforeDraw.position;
end
drawnow;
assert(isgraphics(textHandle, "text"), "oi_text_bounds:DeletedGraphics", ...
    "The text was deleted while its pixel extent was rendered");

extentPixels = double(textHandle.Extent);
if nargout > 1
    pixelsAfterDraw = text_state(textHandle);
    positionPixels = pixelsAfterDraw.position;
end
validate_pixel_rectangle(extentPixels, "text extent");
parentPixels = parent_pixel_position(textHandle.Parent, figureHandle, figurePixels);

originPixels = parentPixels(1:2) + extentPixels(1:2) - 2;
canvasSizePixels = figurePixels(3:4);
bounds = [originPixels ./ canvasSizePixels, ...
    extentPixels(3:4) ./ canvasSizePixels];
assert(all(isfinite(bounds)) && all(bounds(3:4) > 0), ...
    "oi_text_bounds:InvalidBounds", ...
    "Rendered text bounds must be finite with positive width and height: %s", ...
    mat2str(bounds, 17));

if nargout > 1
    diagnostics = struct("release", version('-release'), ...
        "figure_pixels", figurePixels, "parent_class", class(textHandle.Parent), ...
        "parent_pixels", parentPixels, "source_units", char(originalUnits), ...
        "source_position", originalPosition, "source_extent", originalExtent, ...
        "pixel_position_before_draw", positionPixelsBeforeDraw, ...
        "pixel_extent_before_draw", pixelsBeforeDraw.extent, ...
        "pixel_position", positionPixels, "pixel_extent", extentPixels, ...
        "bounds", bounds, "font_name", char(textHandle.FontName), ...
        "font_size", double(textHandle.FontSize), ...
        "font_units", char(textHandle.FontUnits), ...
        "interpreter", char(textHandle.Interpreter), ...
        "rotation", double(textHandle.Rotation), ...
        "horizontal_alignment", char(textHandle.HorizontalAlignment), ...
        "vertical_alignment", char(textHandle.VerticalAlignment), ...
        "screen_pixels_per_inch", double(get(groot, "ScreenPixelsPerInch")), ...
        "renderer", char(figureHandle.Renderer));
    diagnostics.string_value = sourceState.string_value;
    diagnostics.string_class = sourceState.string_class;
    diagnostics.string_size = sourceState.string_size;
    diagnostics.position_mode = sourceState.position_mode;
    diagnostics.entry_state = entryState;
    diagnostics.source_state = sourceState;
    diagnostics.pixels_before_draw = pixelsBeforeDraw;
    diagnostics.pixels_after_draw = pixelsAfterDraw;
end

clear unitsCleanup;
if nargout > 1
    diagnostics.restored_state = text_state(textHandle);
end
end

function state = text_state(textHandle)
state = struct();
state.units = char(textHandle.Units);
state.string_value = textHandle.String;
state.string_class = class(state.string_value);
state.string_size = size(state.string_value);
state.string_lengths = strlength(string(state.string_value));
state.position_mode = "unavailable";
if isprop(textHandle, "PositionMode")
    try
        state.position_mode = char(get(textHandle, "PositionMode"));
    catch errorDetails
        state.position_mode_error = errorDetails.message;
    end
end
state.position = double(textHandle.Position);
state.extent = double(textHandle.Extent);
state.position_after_extent_read = double(textHandle.Position);
end

function pixels = parent_pixel_position(parentHandle, figureHandle, figurePixels)
assert(isgraphics(parentHandle), "oi_text_bounds:InvalidParent", ...
    "The text object must have a valid graphics parent");
if isequal(parentHandle, figureHandle)
    pixels = [1 1 figurePixels(3:4)];
    return;
end

try
    pixels = double(getpixelposition(parentHandle, true));
catch errorDetails
    error("oi_text_bounds:ParentGeometryUnavailable", ...
        "Cannot measure text parent %s relative to its figure: %s", ...
        class(parentHandle), errorDetails.message);
end
validate_pixel_rectangle(pixels, "text parent");
end

function validate_pixel_rectangle(value, role)
assert(numel(value) == 4 && all(isfinite(value)) && all(value(3:4) > 0), ...
    "oi_text_bounds:InvalidPixelGeometry", ...
    "%s pixel geometry must be finite with positive width and height: %s", ...
    role, mat2str(value, 17));
end

function restore_units(textHandle, originalUnits)
if isgraphics(textHandle, "text")
    textHandle.Units = originalUnits;
end
end
