function bounds = oi_text_bounds(textHandle, figureHandle)
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

drawnow;
assert(isgraphics(textHandle, "text") && isgraphics(figureHandle, "figure"), ...
    "oi_text_bounds:DeletedGraphics", ...
    "The text or figure was deleted while graphics were rendered");

figurePixels = double(getpixelposition(figureHandle));
validate_pixel_rectangle(figurePixels, "figure");

originalUnits = textHandle.Units;
unitsCleanup = onCleanup(@() restore_units(textHandle, originalUnits));
textHandle.Units = "pixels";
drawnow;
assert(isgraphics(textHandle, "text"), "oi_text_bounds:DeletedGraphics", ...
    "The text was deleted while its pixel extent was rendered");

extentPixels = double(textHandle.Extent);
validate_pixel_rectangle(extentPixels, "text extent");
parentPixels = parent_pixel_position(textHandle.Parent, figureHandle, figurePixels);

originPixels = parentPixels(1:2) + extentPixels(1:2) - 2;
canvasSizePixels = figurePixels(3:4);
bounds = [originPixels ./ canvasSizePixels, ...
    extentPixels(3:4) ./ canvasSizePixels];
assert(all(isfinite(bounds)) && all(bounds(3:4) > 0), ...
    "oi_text_bounds:InvalidBounds", ...
    "Rendered text bounds must be finite with positive width and height");

clear unitsCleanup;
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
    "%s pixel geometry must be finite with positive width and height", role);
end

function restore_units(textHandle, originalUnits)
if isgraphics(textHandle, "text")
    textHandle.Units = originalUnits;
end
end
