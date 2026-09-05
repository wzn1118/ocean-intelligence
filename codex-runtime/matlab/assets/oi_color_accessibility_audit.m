function [colorblindSafe, redundantEncoding, audit] = oi_color_accessibility_audit(figureHandle)
%OI_COLOR_ACCESSIBILITY_AUDIT Audit categorical line/scatter encodings.
% HandleVisibility affects handle discovery and legends, not whether finite
% data are audited. Continuous color scales remain a separate visual check.
assert(isscalar(figureHandle) && isgraphics(figureHandle, "figure"), ...
    "oi_color_accessibility_audit:InvalidFigure", ...
    "figureHandle must be a live traditional MATLAB figure");

axesHandles = visible_axes(figureHandle);
axesEvidence = repmat(axis_template(), 0, 1);
objectEvidence = repmat(object_template(), 0, 1);
for axesIndex = 1:numel(axesHandles)
    [currentAxis, currentObjects] = audit_axes(axesHandles(axesIndex), axesIndex);
    axesEvidence(end + 1, 1) = currentAxis; %#ok<AGROW>
    objectEvidence = [objectEvidence; currentObjects(:)]; %#ok<AGROW>
end

statuses = string({axesEvidence.status});
if any(statuses == "fail")
    status = "fail";
elseif any(statuses == "unknown")
    status = "unknown";
else
    status = "pass";
end
redundantEncoding = status == "pass";

paletteStatuses = string({axesEvidence.palette_status});
paletteDistinct = isempty(paletteStatuses) ...
    || all(paletteStatuses == "pass" | paletteStatuses == "not-applicable");
distances = [axesEvidence.minimum_pair_distance];
distances = distances(isfinite(distances));
if isempty(distances)
    minimumDistance = NaN;
else
    minimumDistance = min(distances);
end

roles = string({objectEvidence.role});
hasUnknown = any(statuses == "unknown");
colorblindSafe = ~hasUnknown && (redundantEncoding || paletteDistinct);
categoryStatus = status;
if ~isempty(axesEvidence) && all([axesEvidence.independent_series_count] < 2) ...
        && ~hasUnknown
    categoryStatus = "not-applicable";
end

audit = struct( ...
    "method", "semantic categorical line/scatter audit", ...
    "simulations", ["protanopia" "deuteranopia" "tritanopia"], ...
    "minimum_pair_distance", minimumDistance, ...
    "minimum_required_distance", 0.08, ...
    "palette_distinct", paletteDistinct, ...
    "redundant_encoding", redundantEncoding, ...
    "series_count", sum([axesEvidence.independent_series_count]), ...
    "visual_inspection_verified", false, ...
    "schema_version", 1, ...
    "status", status, ...
    "category_status", categoryStatus, ...
    "continuous_color_status", "not-evaluated", ...
    "continuous_color_object_count", sum([objectEvidence.continuous_color]), ...
    "colorblind_status", logical_status(colorblindSafe, hasUnknown), ...
    "redundant_encoding_status", status, ...
    "palette_status", combine_palette_status(paletteStatuses), ...
    "axes_count", numel(axesEvidence), ...
    "object_count", numel(objectEvidence), ...
    "data_object_count", sum(roles == "data"), ...
    "hidden_data_count", sum(roles == "data" ...
        & string({objectEvidence.handle_visibility}) == "off"), ...
    "legend_proxy_count", sum(roles == "legend-proxy"), ...
    "reference_count", sum(roles == "reference"), ...
    "auxiliary_count", sum(roles == "auxiliary"), ...
    "unknown_count", sum(roles == "unknown"), ...
    "same_series_collapsed_count", sum([axesEvidence.collapsed_object_count]), ...
    "axes", axesEvidence, ...
    "objects", objectEvidence);
end

function [axisEvidence, objects] = audit_axes(axesHandle, axesIndex)
series = findall(axesHandle, "Type", "line", "-or", "Type", "scatter");
series = flipud(series(:));
objects = repmat(object_template(), numel(series), 1);
for index = 1:numel(series)
    objects(index) = inspect_series(series(index), axesIndex, index);
end
objects = resolve_hidden_segments(objects);
objects = associate_hidden_overlays(objects);
[groups, objects] = group_series(objects);
[status, reasons] = categorical_status(groups, objects);
[paletteStatus, minimumDistance] = palette_status(groups);

axisEvidence = axis_template();
axisEvidence.index = axesIndex;
axisEvidence.class = string(class(axesHandle));
axisEvidence.status = status;
axisEvidence.palette_status = paletteStatus;
axisEvidence.minimum_pair_distance = minimumDistance;
axisEvidence.object_count = numel(objects);
axisEvidence.independent_series_count = numel(groups);
if ~isempty(groups)
    axisEvidence.collapsed_object_count = sum(max([groups.member_count] - 1, 0));
end
axisEvidence.continuous_color_object_count = sum([objects.continuous_color]);
axisEvidence.reasons = reasons;
axisEvidence.groups = groups;
end

function evidence = inspect_series(series, axesIndex, objectIndex)
evidence = object_template();
evidence.axes_index = axesIndex;
evidence.object_index = objectIndex;
evidence.class = string(class(series));
evidence.type = lower(property_string(series, "Type", ""));
evidence.display_name = strtrim(property_string(series, "DisplayName", ""));
evidence.tag = strtrim(property_string(series, "Tag", ""));
evidence.visible = property_string(series, "Visible", "on");
evidence.handle_visibility = property_string(series, "HandleVisibility", "on");
evidence.line_style = property_string(series, "LineStyle", "none");
evidence.marker = property_string(series, "Marker", "none");
[evidence.finite_data_count, evidence.point_count] = finite_pair_count(series);
evidence.has_finite_data = evidence.finite_data_count > 0;
evidence.continuous_color = has_continuous_cdata(series, evidence.point_count);
[evidence.color, evidence.color_known] = fixed_series_color( ...
    series, evidence.point_count, evidence.continuous_color);
[evidence.segment_orientation, evidence.segment_center] = segment_geometry(series);
evidence.non_color_signature = evidence.line_style + "|" + evidence.marker;
evidence.user_data_fields = user_data_fields(series);
evidence.appdata_keys = known_appdata_keys(series);

[role, roleBasis] = explicit_role(series);
[seriesId, seriesBasis] = explicit_series_id(series);
evidence.semantic_series_id = seriesId;
evidence.series_id_basis = seriesBasis;
if evidence.visible == "off"
    evidence.role = "auxiliary";
    evidence.role_basis = "Visible=off object is not rendered";
elseif strlength(role) > 0
    evidence.role = role;
    evidence.role_basis = roleBasis;
elseif is_reference(evidence)
    evidence.role = "reference";
    evidence.role_basis = "native display name or tag identifies a reference";
elseif ~evidence.has_finite_data
    evidence.role = "legend-proxy";
    evidence.role_basis = "no finite XData/YData; style-only legend proxy";
elseif is_hidden_short_line(evidence)
    evidence.role = "provisional-segment";
    evidence.role_basis = "hidden unlabeled two-point line";
else
    evidence.role = "data";
    if evidence.handle_visibility == "off"
        evidence.role_basis = ...
            "finite XData/YData; HandleVisibility does not suppress audit";
    else
        evidence.role_basis = "finite XData/YData";
    end
end
end

function objects = resolve_hidden_segments(objects)
indices = find(string({objects.role}) == "provisional-segment");
paired = false(size(indices));
for firstIndex = 1:numel(indices)
    first = objects(indices(firstIndex));
    if first.segment_orientation ~= "horizontal"
        continue;
    end
    for secondIndex = 1:numel(indices)
        second = objects(indices(secondIndex));
        if second.segment_orientation ~= "vertical"
            continue;
        end
        scale = max([1 abs(first.segment_center) abs(second.segment_center)]);
        if all(abs(first.segment_center - second.segment_center) <= 1e-9 * scale)
            paired(firstIndex) = true;
            paired(secondIndex) = true;
        end
    end
end
for index = 1:numel(indices)
    if paired(index)
        objects(indices(index)).role = "auxiliary";
        objects(indices(index)).role_basis = ...
            "orthogonal hidden pair inferred as one uncertainty glyph";
    else
        objects(indices(index)).role = "unknown";
        objects(indices(index)).role_basis = ...
            "hidden short line lacks role or series identity";
    end
end
end

function objects = associate_hidden_overlays(objects)
dataIndices = find(string({objects.role}) == "data");
for index = dataIndices(:)'
    item = objects(index);
    if item.handle_visibility ~= "off" || strlength(item.semantic_series_id) > 0 ...
            || strlength(item.display_name) > 0 || ~item.color_known
        continue;
    end
    matches = zeros(0, 1);
    for candidateIndex = dataIndices(:)'
        candidate = objects(candidateIndex);
        if candidateIndex ~= index && strlength(candidate.display_name) > 0 ...
                && candidate.color_known ...
                && max(abs(candidate.color - item.color)) <= 1e-9
            matches(end + 1, 1) = candidateIndex; %#ok<AGROW>
        end
    end
    if numel(matches) == 1
        objects(index).semantic_series_id = "display-name:" ...
            + normalize_id(objects(matches).display_name);
        objects(index).series_id_basis = ...
            "hidden overlay matched one named series by fixed native color";
    end
end
end

function [groups, objects] = group_series(objects)
groups = repmat(group_template(), 0, 1);
dataIndices = find(string({objects.role}) == "data");
keys = strings(numel(dataIndices), 1);
for index = 1:numel(dataIndices)
    objectIndex = dataIndices(index);
    item = objects(objectIndex);
    if strlength(item.semantic_series_id) > 0
        keys(index) = item.semantic_series_id;
    elseif strlength(item.display_name) > 0
        keys(index) = "display-name:" + normalize_id(item.display_name);
        objects(objectIndex).series_id_basis = "DisplayName";
    elseif strlength(item.tag) > 0
        keys(index) = "tag:" + normalize_id(item.tag);
        objects(objectIndex).series_id_basis = "Tag";
    else
        keys(index) = "object:" + string(item.object_index);
        objects(objectIndex).series_id_basis = "unique finite-data object";
    end
    objects(objectIndex).semantic_series_id = keys(index);
end

for key = unique(keys, "stable")'
    members = dataIndices(keys == key);
    group = group_template();
    group.id = key;
    group.member_count = numel(members);
    group.object_indices = [objects(members).object_index];
    signatures = unique(string({objects(members).non_color_signature}), "stable");
    group.non_color_signature = strjoin(sort(signatures), "+");
    group.continuous_color = any([objects(members).continuous_color]);
    colors = vertcat(objects(members).color);
    known = [objects(members).color_known];
    if all(known) && all(max(abs(colors - colors(1, :)), [], 2) <= 1e-9)
        group.color = colors(1, :);
        group.color_known = true;
    end
    group.series_id_basis = strjoin(unique( ...
        string({objects(members).series_id_basis}), "stable"), "; ");
    groups(end + 1, 1) = group; %#ok<AGROW>
    for member = members(:)'
        objects(member).considered_independent = true;
    end
end
end

function [status, reasons] = categorical_status(groups, objects)
reasons = strings(0, 1);
if any(string({objects.role}) == "unknown")
    status = "unknown";
    reasons = "ambiguous hidden line needs explicit role or series appdata";
    return;
end
if numel(groups) < 2
    status = "pass";
    return;
end
signatures = string({groups.non_color_signature});
if numel(unique(signatures)) == numel(signatures)
    status = "pass";
else
    status = "fail";
    duplicates = strings(0, 1);
    for signature = unique(signatures, "stable")'
        if sum(signatures == signature) > 1
            duplicates(end + 1, 1) = signature; %#ok<AGROW>
        end
    end
    reasons = "independent series share non-color signature: " ...
        + strjoin(duplicates, ", ");
end
end

function [status, minimumDistance] = palette_status(groups)
minimumDistance = NaN;
if numel(groups) < 2
    status = "not-applicable";
elseif ~all([groups.color_known])
    status = "unknown";
else
    [safe, minimumDistance] = simulated_palette_separation(vertcat(groups.color));
    if safe
        status = "pass";
    else
        status = "fail";
    end
end
end

function [safe, minimumDistance] = simulated_palette_separation(colors)
matrices = cat(3, ...
    [0.567 0.433 0; 0.558 0.442 0; 0 0.242 0.758], ...
    [0.625 0.375 0; 0.700 0.300 0; 0 0.300 0.700], ...
    [0.950 0.050 0; 0 0.433 0.567; 0 0.475 0.525]);
minimumDistance = Inf;
for matrixIndex = 1:size(matrices, 3)
    transformed = colors * matrices(:, :, matrixIndex)';
    for first = 1:size(transformed, 1)
        for second = first + 1:size(transformed, 1)
            minimumDistance = min(minimumDistance, ...
                norm(transformed(first, :) - transformed(second, :), 2));
        end
    end
end
safe = minimumDistance >= 0.08;
end

function axesHandles = visible_axes(figureHandle)
allObjects = findall(figureHandle);
axesHandles = gobjects(0, 1);
for index = 1:numel(allObjects)
    candidate = allObjects(index);
    isAxes = isgraphics(candidate, "axes") ...
        || isa(candidate, "matlab.graphics.axis.PolarAxes");
    if isAxes && property_string(candidate, "Visible", "on") == "on"
        axesHandles(end + 1, 1) = candidate; %#ok<AGROW>
    end
end
axesHandles = flipud(axesHandles);
end

function [count, pointCount] = finite_pair_count(series)
xMask = finite_mask(property_value(series, "XData"));
yMask = finite_mask(property_value(series, "YData"));
if isempty(xMask) || isempty(yMask)
    count = 0;
    pointCount = max(numel(xMask), numel(yMask));
    return;
end
pointCount = min(numel(xMask), numel(yMask));
count = sum(xMask(1:pointCount) & yMask(1:pointCount));
end

function mask = finite_mask(value)
mask = [];
if isnumeric(value) || islogical(value)
    mask = isfinite(double(value(:)));
elseif isdatetime(value)
    mask = ~isnat(value(:));
elseif isduration(value)
    mask = ~ismissing(value(:));
end
end

function result = has_continuous_cdata(series, pointCount)
result = false;
cData = numeric_property(series, "CData");
if isempty(cData) || pointCount < 2
    return;
end
if iscolumn(cData) && numel(cData) == pointCount
    finiteValues = cData(isfinite(cData));
    result = numel(finiteValues) > 1 && min(finiteValues) < max(finiteValues);
elseif size(cData, 1) == pointCount && size(cData, 2) == 3
    result = any(max(abs(cData - cData(1, :)), [], 2) > 1e-12);
end
end

function [colorValue, known] = fixed_series_color(series, pointCount, continuousColor)
colorValue = [NaN NaN NaN];
known = false;
candidate = numeric_property(series, "Color");
if is_rgb(candidate)
    colorValue = reshape(candidate, 1, 3);
    known = true;
    return;
end
if continuousColor
    return;
end
cData = numeric_property(series, "CData");
if isequal(size(cData), [1 3])
    colorValue = cData;
    known = is_rgb(cData);
elseif pointCount > 0 && size(cData, 1) == pointCount ...
        && size(cData, 2) == 3 ...
        && all(max(abs(cData - cData(1, :)), [], 2) <= 1e-12)
    colorValue = cData(1, :);
    known = is_rgb(colorValue);
end
end

function [orientation, center] = segment_geometry(series)
orientation = "not-applicable";
center = [NaN NaN];
if lower(property_string(series, "Type", "")) ~= "line"
    return;
end
xData = numeric_property(series, "XData");
yData = numeric_property(series, "YData");
if numel(xData) ~= 2 || numel(yData) ~= 2 ...
        || ~all(isfinite(xData)) || ~all(isfinite(yData))
    orientation = "other";
    return;
end
center = [mean(xData) mean(yData)];
if abs(diff(xData)) <= eps(max(1, max(abs(xData))))
    orientation = "vertical";
elseif abs(diff(yData)) <= eps(max(1, max(abs(yData))))
    orientation = "horizontal";
else
    orientation = "diagonal";
end
end

function result = is_hidden_short_line(evidence)
result = evidence.type == "line" ...
    && evidence.handle_visibility == "off" ...
    && strlength(evidence.display_name) == 0 ...
    && strlength(evidence.tag) == 0 ...
    && strlength(evidence.semantic_series_id) == 0 ...
    && evidence.finite_data_count == 2;
end

function result = is_reference(evidence)
text = lower(strtrim(evidence.display_name + " " + evidence.tag));
pattern = "(^|[ _:-])(reference|baseline|threshold|identity|guide)([ _:-]|$)" ...
    + "|1\s*:\s*1|one[ -]to[ -]one";
result = ~isempty(regexp(text, pattern, "once"));
end

function [role, source] = explicit_role(series)
role = "";
source = "";
for key = ["OI_ColorAccessibilityRole" "OI_AccessibilityRole" "OI_DisplayRole"]
    if isappdata(series, key)
        role = normalize_role(getappdata(series, key));
        if strlength(role) > 0
            source = "appdata." + key;
            return;
        end
    end
end
userData = property_value(series, "UserData");
if isstruct(userData) && isscalar(userData)
    for field = ["ColorAccessibilityRole" "AccessibilityRole" "DisplayRole"]
        if isfield(userData, field)
            role = normalize_role(userData.(field));
            if strlength(role) > 0
                source = "UserData." + field;
                return;
            end
        end
    end
end
end

function role = normalize_role(value)
role = lower(strtrim(string(value)));
if ~isscalar(role)
    role = "";
elseif any(role == ["data" "series" "observation"])
    role = "data";
elseif any(role == ["reference" "threshold" "baseline" "guide"])
    role = "reference";
elseif any(role == ["auxiliary" "uncertainty" "annotation" "ignore"])
    role = "auxiliary";
elseif any(role == ["legend-proxy" "legend_proxy" "legend"])
    role = "legend-proxy";
elseif role ~= "unknown"
    role = "";
end
end

function [seriesId, source] = explicit_series_id(series)
seriesId = "";
source = "";
for key = ["OI_ColorAccessibilitySeriesId" "OI_SeriesId"]
    if isappdata(series, key)
        value = scalar_text(getappdata(series, key));
        if strlength(value) > 0
            seriesId = "appdata:" + normalize_id(value);
            source = "appdata." + key;
            return;
        end
    end
end
userData = property_value(series, "UserData");
if isstruct(userData) && isscalar(userData)
    for field = ["ColorAccessibilitySeriesId" "SeriesId" "SeriesID"]
        if isfield(userData, field)
            value = scalar_text(userData.(field));
            if strlength(value) > 0
                seriesId = "userdata:" + normalize_id(value);
                source = "UserData." + field;
                return;
            end
        end
    end
end
end

function value = property_value(object, name)
value = [];
try
    if isprop(object, name)
        value = object.(name);
    end
catch
    value = [];
end
end

function value = property_string(object, name, fallback)
value = string(fallback);
try
    candidate = string(property_value(object, name));
    if isscalar(candidate) && ~ismissing(candidate)
        value = candidate;
    end
catch
end
end

function value = numeric_property(object, name)
value = property_value(object, name);
if ~(isnumeric(value) || islogical(value)) || ~isreal(value)
    value = [];
else
    value = double(value);
end
end

function fields = user_data_fields(series)
fields = "";
value = property_value(series, "UserData");
if isstruct(value) && isscalar(value)
    fields = strjoin(sort(string(fieldnames(value))), ",");
end
end

function keys = known_appdata_keys(series)
keys = strings(0, 1);
for key = ["OI_ColorAccessibilityRole" "OI_ColorAccessibilitySeriesId" ...
        "OI_AccessibilityRole" "OI_DisplayRole" "OI_SeriesId"]
    if isappdata(series, key)
        keys(end + 1, 1) = key; %#ok<AGROW>
    end
end
keys = strjoin(keys, ",");
end

function value = scalar_text(candidate)
value = string(candidate);
if ~isscalar(value) || ismissing(value) || strlength(strtrim(value)) == 0
    value = "";
else
    value = strtrim(value);
end
end

function value = normalize_id(value)
value = regexprep(lower(strtrim(string(value))), "\s+", " ");
end

function result = is_rgb(value)
result = isnumeric(value) && isreal(value) && numel(value) == 3 ...
    && all(isfinite(value)) && all(value >= 0) && all(value <= 1);
end

function status = combine_palette_status(statuses)
if isempty(statuses) || all(statuses == "not-applicable")
    status = "not-applicable";
elseif any(statuses == "fail")
    status = "fail";
elseif any(statuses == "unknown")
    status = "unknown";
else
    status = "pass";
end
end

function status = logical_status(value, unknown)
if unknown
    status = "unknown";
elseif value
    status = "pass";
else
    status = "fail";
end
end

function value = object_template()
value = struct( ...
    "axes_index", 0, "object_index", 0, "class", "", "type", "", ...
    "display_name", "", "tag", "", "visible", "", ...
    "handle_visibility", "", "line_style", "none", "marker", "none", ...
    "finite_data_count", 0, "point_count", 0, "has_finite_data", false, ...
    "continuous_color", false, "color", [NaN NaN NaN], ...
    "color_known", false, "segment_orientation", "not-applicable", ...
    "segment_center", [NaN NaN], "non_color_signature", "none|none", ...
    "role", "unknown", "role_basis", "", "semantic_series_id", "", ...
    "series_id_basis", "", "considered_independent", false, ...
    "user_data_fields", "", "appdata_keys", "");
end

function value = group_template()
value = struct( ...
    "id", "", "member_count", 0, "object_indices", zeros(1, 0), ...
    "non_color_signature", "none|none", "continuous_color", false, ...
    "color", [NaN NaN NaN], "color_known", false, "series_id_basis", "");
end

function value = axis_template()
value = struct( ...
    "index", 0, "class", "", "status", "pass", ...
    "palette_status", "not-applicable", "minimum_pair_distance", NaN, ...
    "object_count", 0, "independent_series_count", 0, ...
    "collapsed_object_count", 0, "continuous_color_object_count", 0, ...
    "reasons", strings(0, 1), "groups", repmat(group_template(), 0, 1));
end
