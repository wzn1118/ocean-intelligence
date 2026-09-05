function theme = oi_ocean_theme()
%OI_OCEAN_THEME Return deterministic colors and typography for ocean plots.
% Output contract: all RGB values are finite doubles in [0,1]. The theme is
% data-independent and never changes units, missing values, or color limits.
theme = struct();
theme.Name = "Ocean Intelligence MATLAB";
[theme.FontName, theme.CJKFontCapable] = resolve_font();
theme.FontSize = 10;
theme.TitleSize = 13;
theme.LabelSize = 11;
theme.CanvasColor = [1.000 1.000 1.000];
theme.AxesColor = [0.975 0.985 0.990];
theme.MissingColor = [0.86 0.88 0.89];
theme.TextColor = [0.055 0.145 0.200];
theme.GridColor = [0.745 0.820 0.850];
theme.PositiveColor = [0.835 0.369 0.000];
theme.NegativeColor = [0.000 0.447 0.698];
theme.AccentColor = [0.000 0.620 0.451];
theme.LineColors = [
    0.000 0.447 0.698
    0.902 0.624 0.000
    0.000 0.620 0.451
    0.835 0.369 0.000
    0.800 0.475 0.655
    0.337 0.706 0.914];
theme.LineStyles = ["-" "--" ":" "-." "-" "--"];
theme.Markers = ["o" "s" "^" "d" "v" ">"];
theme.SequentialMap = ocean_colormap(256);
theme.DivergingMap = diverging_colormap(257);
assert(all(structfun(@is_valid_value, theme)), "oi_ocean_theme:InvalidTheme", ...
    "Theme contains an invalid value");
end

function [fontName, cjkCapable] = resolve_font()
% Prefer a CJK-capable publication font, with deterministic Latin fallback.
installedFonts = string(listfonts);
candidates = ["Noto Sans CJK SC" "Noto Sans CJK TC" "Noto Sans CJK HK" ...
    "Noto Sans CJK JP" "Noto Sans CJK KR" "Source Han Sans SC" ...
    "WenQuanYi Zen Hei" "Droid Sans Fallback" "Microsoft YaHei" ...
    "PingFang SC" "SimHei" "SimSun" ...
    "Arial Unicode MS" "Helvetica" "Arial" "Liberation Sans" "DejaVu Sans"];
match = candidates(ismember(lower(candidates), lower(installedFonts)));
assert(~isempty(match), "oi_ocean_theme:FontUnavailable", ...
    "No configured publication font candidate is installed");
fontName = match(1);
cjkCapable = any(contains(lower(fontName), ["noto sans cjk" "source han" ...
    "wenquanyi" "droid sans fallback" "yahei" "pingfang" ...
    "simhei" "simsun" "arial unicode"]));
end

function colors = ocean_colormap(colorCount)
anchors = [
    0.025 0.090 0.180
    0.015 0.230 0.390
    0.000 0.455 0.610
    0.070 0.690 0.690
    0.470 0.820 0.710
    0.875 0.920 0.670
    0.985 0.740 0.350
    0.860 0.285 0.180];
colors = interp1(linspace(0,1,size(anchors,1)), anchors, ...
    linspace(0,1,colorCount), "pchip");
colors = min(max(colors, 0), 1);
end

function colors = diverging_colormap(colorCount)
anchors = [
    0.050 0.260 0.520
    0.220 0.520 0.740
    0.760 0.880 0.930
    0.985 0.985 0.970
    0.960 0.790 0.650
    0.820 0.410 0.250
    0.560 0.120 0.120];
colors = interp1(linspace(0,1,size(anchors,1)), anchors, ...
    linspace(0,1,colorCount), "pchip");
colors = min(max(colors, 0), 1);
end

function valid = is_valid_value(value)
if isnumeric(value)
    valid = all(isfinite(value), "all") && all(value >= 0, "all") ...
        && (isscalar(value) || all(value <= 1, "all"));
else
    valid = all(strlength(string(value)) > 0, "all");
end
end
