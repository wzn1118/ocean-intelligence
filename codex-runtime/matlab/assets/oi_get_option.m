function value = oi_get_option(options, name, defaultValue)
%OI_GET_OPTION Read one named option without mutating caller input.
% Input contract: options is a scalar struct and name is a nonempty scalar
% string. Missing fields return defaultValue; present empty fields are kept.
arguments
    options (1,1) struct
    name (1,1) string
    defaultValue
end
assert(strlength(name) > 0, "oi_get_option:EmptyName", ...
    "Option name must not be empty");
fieldName = char(name);
if isfield(options, fieldName)
    value = options.(fieldName);
else
    value = defaultValue;
end
end
