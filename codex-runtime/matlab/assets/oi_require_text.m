function textValue = oi_require_text(value, errorIdentifier, errorMessage)
%OI_REQUIRE_TEXT Validate explicit nonblank text metadata.
% Input contract: value is a char row, cellstr, or string array containing
% no missing or whitespace-only elements. Numeric and other implicit text
% conversions are rejected so units and labels remain caller-supplied text.
arguments
    value
    errorIdentifier (1,1) string
    errorMessage (1,1) string
end
isText = isstring(value) || iscellstr(value) ...
    || (ischar(value) && isrow(value));
if isText
    textValue = strtrim(string(value));
else
    textValue = strings(0, 1);
end
assert(isText && ~isempty(textValue) && all(~ismissing(textValue), "all") ...
    && all(strlength(textValue) > 0, "all"), ...
    errorIdentifier, errorMessage);
end
