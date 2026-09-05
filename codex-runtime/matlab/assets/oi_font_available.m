function available = oi_font_available(fontName, installedFonts)
%OI_FONT_AVAILABLE Check exact installed families, not substitute fonts.
% installedFonts may be a cached listfonts result; omitted means listfonts.
% Invalid names and failed fontconfig queries return false. This does not
% verify glyph coverage, rendering, or font embedding.
available = false;
if ~((ischar(fontName) && (isrow(fontName) || isempty(fontName))) ...
        || (isstring(fontName) && isscalar(fontName)))
    return;
end
fontName = string(fontName);
if ismissing(fontName)
    return;
end
characters = double(char(fontName));
if any(characters < 32 | (characters >= 127 & characters <= 159))
    return;
end
fontName = strtrim(fontName);
if strlength(fontName) == 0
    return;
end
if nargin < 2
    try
        installedFonts = listfonts;
    catch
        installedFonts = strings(0, 1);
    end
end
installedFonts = strtrim(string(installedFonts));
available = any(strcmpi(installedFonts(:), fontName));
if available || ~isunix
    return;
end
fontPattern = replace(fontName, "\", "\\");
fontPattern = replace(fontPattern, ["-" ":" ","], ["\-" "\:" "\,"]);
shellArgument = "'" + replace(fontPattern, "'", "'""'""'") + "'";
command = "fc-match -f '%{[]family{%{family}\n}}' -- " ...
    + shellArgument + " 2>/dev/null";
try
    [status, output] = system(char(command));
catch
    return;
end
if status ~= 0
    return;
end
families = strtrim(string(regexp(output, '\r\n|\n|\r', 'split')));
available = any(strcmpi(families(:), fontName));
end
