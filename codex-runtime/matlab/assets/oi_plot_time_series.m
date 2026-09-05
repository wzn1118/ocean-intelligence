function result = oi_plot_time_series(axesHandle, data, options)
%OI_PLOT_TIME_SERIES Plot validated table or timetable observations.
% Input contract: data is a table or timetable with explicit value variables,
% units, datetime semantics, QC policy, and uncertainty metadata. NaN and NaT
% are preserved as breaks; acquisition gaps are never bridged implicitly.
arguments
    axesHandle (1,1) matlab.graphics.axis.Axes
    data
    options (1,1) struct = struct()
end
assert(istable(data) || istimetable(data), "oi_plot_time_series:InputType", ...
    "data must be a table or timetable");

missingPolicy = string(oi_get_option(options,"MissingPolicy","preserve"));
assert(missingPolicy == "preserve", "oi_plot_time_series:MissingPolicy", ...
    "Only MissingPolicy='preserve' is supported");
[rowTimes, sourceTimeZone, displayTimeZone] = resolve_times(data,options);
valueVariables = text_vector(oi_get_option(options,"ValueVariables",strings(0,1)), ...
    "oi_plot_time_series:ValueVariables", "ValueVariables must be explicit nonblank text");
assert(~isempty(valueVariables) && all(ismember(valueVariables,string(data.Properties.VariableNames))), ...
    "oi_plot_time_series:ValueVariables", "Every ValueVariables entry must exist in data");
assert(numel(unique(valueVariables)) == numel(valueVariables), ...
    "oi_plot_time_series:ValueVariables", "ValueVariables must be unique");

valueLabels = optional_text_vector(oi_get_option(options,"ValueLabels",valueVariables), ...
    numel(valueVariables), "oi_plot_time_series:ValueLabels", ...
    "ValueLabels must match ValueVariables and contain nonblank text");
valueUnits = resolve_units(data,valueVariables, ...
    oi_get_option(options,"ValueUnits",strings(0,1)), ...
    "oi_plot_time_series:ValueUnits");
titleText = scalar_text(oi_get_option(options,"Title","Time series"), ...
    "oi_plot_time_series:Title", "Title must be explicit nonblank text");
timeLabel = scalar_text(oi_get_option(options,"TimeLabel","Time"), ...
    "oi_plot_time_series:TimeLabel", "TimeLabel must be explicit nonblank text");

gapThreshold = oi_get_option(options,"GapThreshold",[]);
if ~isempty(gapThreshold)
    assert(isduration(gapThreshold) && isscalar(gapThreshold) ...
        && isfinite(seconds(gapThreshold)) && gapThreshold > seconds(0), ...
        "oi_plot_time_series:GapThreshold", ...
        "GapThreshold must be one finite positive duration");
end

qcVariables = normalize_parallel_names(oi_get_option(options,"QCVariables",strings(0,1)), ...
    numel(valueVariables), "oi_plot_time_series:QCVariables");
acceptedQCValues = oi_get_option(options,"AcceptedQCValues",[]);
qcPolicy = string(oi_get_option(options,"QCPolicy","exclude"));
assert(any(qcPolicy == ["exclude" "mark"]), "oi_plot_time_series:QCPolicy", ...
    "QCPolicy must be 'exclude' or 'mark'");
if ~isempty(qcVariables)
    assert(~isempty(acceptedQCValues), "oi_plot_time_series:QCPolicy", ...
        "AcceptedQCValues must be explicit when QCVariables are supplied");
    assert(all(ismember(qcVariables,string(data.Properties.VariableNames))), ...
        "oi_plot_time_series:QCVariables", "Every QC variable must exist in data");
end

uncertainty = resolve_uncertainty(data,valueVariables,valueUnits,options);
sampleLabels = resolve_sample_labels(data,options,height(data));
theme = oi_get_option(options,"Theme",struct());
if isempty(fieldnames(theme))
    theme = oi_ocean_theme();
end
lineColors = theme.LineColors;
assert(size(lineColors,1) >= numel(valueVariables), ...
    "oi_plot_time_series:Theme", "Theme must provide one line color per series");

holdCleanup = oi_hold_axes(axesHandle);
lineHandles = gobjects(numel(valueVariables),1);
qcHandles = gobjects(numel(valueVariables),1);
uncertaintyHandles = cell(numel(valueVariables),1);
validMasks = false(height(data),numel(valueVariables));
missingMasks = false(height(data),numel(valueVariables));
uncertaintyMissingMasks = false(height(data),numel(valueVariables));
qcRejectedMasks = false(height(data),numel(valueVariables));
gapMasks = false(max(height(data)-1,0),numel(valueVariables));

for seriesIndex = 1:numel(valueVariables)
    values = data.(valueVariables(seriesIndex));
    assert(isnumeric(values) && isreal(values) && isvector(values) ...
        && numel(values) == height(data) && ~any(isinf(values),"all"), ...
        "oi_plot_time_series:InvalidValues", ...
        "Value variables must be aligned real numeric vectors containing no Inf");
    values = values(:);
    missingMask = ~isfinite(values);
    qcAcceptedMask = true(height(data),1);
    if ~isempty(qcVariables)
        qcAcceptedMask = accepted_qc_mask(data.(qcVariables(seriesIndex)),acceptedQCValues);
    end
    uncertaintyCompleteMask = uncertainty.CompleteMask(:,seriesIndex);
    validMask = ~missingMask & qcAcceptedMask;
    uncertaintyValidMask = validMask & uncertaintyCompleteMask;
    plottedValues = values;
    plottedValues(~validMask) = NaN;
    [plotTimes,plotValues,gapMask,plotSourceIndices] = insert_gap_breaks( ...
        rowTimes,plottedValues,gapThreshold);
    uncertaintyHandles{seriesIndex} = plot_uncertainty(axesHandle,rowTimes,values, ...
        uncertaintyValidMask,gapThreshold,uncertainty,seriesIndex,lineColors(seriesIndex,:));
    lineHandles(seriesIndex) = plot(axesHandle,plotTimes,plotValues, ...
        "Color",lineColors(seriesIndex,:),"LineWidth",1.3, ...
        "DisplayName",valueLabels(seriesIndex));
    rejectedMask = ~missingMask & ~qcAcceptedMask;
    if qcPolicy == "mark" && any(rejectedMask)
        qcHandles(seriesIndex) = scatter(axesHandle,rowTimes(rejectedMask),values(rejectedMask), ...
            30,lineColors(seriesIndex,:),"x","LineWidth",1.0, ...
            "HandleVisibility","off");
    end
    if isprop(lineHandles(seriesIndex),"DataTipTemplate")
        plotLabels = strings(numel(plotSourceIndices),1);
        realPointMask = plotSourceIndices > 0;
        plotLabels(realPointMask) = sampleLabels(plotSourceIndices(realPointMask));
        lineHandles(seriesIndex).DataTipTemplate.DataTipRows = [ ...
            dataTipTextRow("Observation",plotLabels); ...
            dataTipTextRow(timeLabel + " (" + displayTimeZone + ")",plotTimes); ...
            dataTipTextRow(valueLabels(seriesIndex) + " (" + valueUnits(seriesIndex) + ")",plotValues)];
    end
    validMasks(:,seriesIndex) = validMask;
    missingMasks(:,seriesIndex) = missingMask;
    uncertaintyMissingMasks(:,seriesIndex) = ~missingMask & ~uncertaintyCompleteMask;
    qcRejectedMasks(:,seriesIndex) = rejectedMask;
    gapMasks(:,seriesIndex) = gapMask;
end
clear holdCleanup;

xlabel(axesHandle,timeLabel + " (" + displayTimeZone + ")","Interpreter","none");
ylabel(axesHandle,compose_shared_ylabel(valueLabels,valueUnits),"Interpreter","none");
title(axesHandle,titleText,"FontWeight","normal","Interpreter","none");
legendHandle = legend(axesHandle,lineHandles,"Location", ...
    string(oi_get_option(options,"LegendLocation","best")),"Interpreter","none");
oi_apply_axes(axesHandle,theme);

result = struct("Axes",axesHandle,"Lines",lineHandles,"QCSuspectMarkers",qcHandles, ...
    "UncertaintyGraphics",{uncertaintyHandles},"Legend",legendHandle, ...
    "RowTimes",rowTimes,"SourceTimeZone",sourceTimeZone, ...
    "DisplayTimeZone",displayTimeZone,"ValueVariables",valueVariables, ...
    "ValueUnits",valueUnits,"ValidMask",validMasks,"MissingMask",missingMasks, ...
    "UncertaintyMissingMask",uncertaintyMissingMasks, ...
    "QCRejectedMask",qcRejectedMasks,"GapMask",gapMasks, ...
    "ValidCount",sum(validMasks,1),"MissingCount",sum(missingMasks,1), ...
    "UncertaintyMissingCount",sum(uncertaintyMissingMasks,1), ...
    "QCRejectedCount",sum(qcRejectedMasks,1),"GapCount",sum(gapMasks,1), ...
    "MissingPolicy",missingPolicy,"QCPolicy",qcPolicy, ...
    "UncertaintyType",uncertainty.Type,"UncertaintyUnit",uncertainty.Unit, ...
    "ConfidenceLevel",uncertainty.ConfidenceLevel, ...
    "valid_count",sum(validMasks,1),"missing_count",sum(missingMasks,1));
end

function [rowTimes,sourceTimeZone,displayTimeZone] = resolve_times(data,options)
if istimetable(data)
    rowTimes = data.Properties.RowTimes;
else
    timeVariable = scalar_text(oi_get_option(options,"TimeVariable",""), ...
        "oi_plot_time_series:TimeVariable", ...
        "TimeVariable must be explicit for table input");
    assert(ismember(timeVariable,string(data.Properties.VariableNames)), ...
        "oi_plot_time_series:TimeVariable", "TimeVariable must exist in data");
    rowTimes = data.(timeVariable);
end
assert(isdatetime(rowTimes) && isvector(rowTimes) && numel(rowTimes) == height(data) ...
    && ~any(isnat(rowTimes)), "oi_plot_time_series:InvalidTime", ...
    "Row times must be aligned non-NaT datetime values");
rowTimes = rowTimes(:);
sourceTimeZone = string(rowTimes.TimeZone);
declaredSourceZone = string(oi_get_option(options,"SourceTimeZone",""));
if strlength(sourceTimeZone) == 0
    assert(isscalar(declaredSourceZone) && ~ismissing(declaredSourceZone) ...
        && strlength(strtrim(declaredSourceZone)) > 0, ...
        "oi_plot_time_series:TimeZone", ...
        "Unzoned datetime input requires explicit SourceTimeZone");
    rowTimes.TimeZone = char(strtrim(declaredSourceZone));
    sourceTimeZone = strtrim(declaredSourceZone);
elseif strlength(strtrim(declaredSourceZone)) > 0
    assert(sourceTimeZone == strtrim(declaredSourceZone), ...
        "oi_plot_time_series:TimeZone", ...
        "SourceTimeZone must match the datetime TimeZone");
end
assert(all(diff(rowTimes) > seconds(0)), "oi_plot_time_series:TimeOrder", ...
    "Datetime values must be unique and strictly increasing");
displayTimeZone = string(oi_get_option(options,"DisplayTimeZone",sourceTimeZone));
assert(isscalar(displayTimeZone) && ~ismissing(displayTimeZone) ...
    && strlength(strtrim(displayTimeZone)) > 0, ...
    "oi_plot_time_series:TimeZone", "DisplayTimeZone must be explicit nonblank text");
displayTimeZone = strtrim(displayTimeZone);
rowTimes.TimeZone = char(displayTimeZone);
end

function units = resolve_units(data,variables,requestedUnits,errorIdentifier)
if isempty(requestedUnits)
    units = strings(numel(variables),1);
    variableUnits = string(data.Properties.VariableUnits);
    for variableIndex = 1:numel(variables)
        position = find(string(data.Properties.VariableNames) == variables(variableIndex),1);
        if ~isempty(variableUnits) && numel(variableUnits) >= position
            units(variableIndex) = strtrim(variableUnits(position));
        end
    end
else
    units = optional_text_vector(requestedUnits,numel(variables),errorIdentifier, ...
        "ValueUnits must match ValueVariables and contain nonblank text");
    variableUnits = string(data.Properties.VariableUnits);
    for variableIndex = 1:numel(variables)
        position = find(string(data.Properties.VariableNames) == variables(variableIndex),1);
        if ~isempty(variableUnits) && numel(variableUnits) >= position ...
                && strlength(strtrim(variableUnits(position))) > 0
            assert(strtrim(variableUnits(position)) == units(variableIndex), ...
                errorIdentifier, ...
                "ValueUnits conflicts with table VariableUnits metadata");
        end
    end
end
assert(all(strlength(units) > 0),errorIdentifier, ...
    "Every plotted variable requires an explicit unit or table VariableUnits metadata");
end

function uncertainty = resolve_uncertainty(data,valueVariables,valueUnits,options)
seriesCount = numel(valueVariables);
uncertainty = struct("Mode","none","Type","none","Unit",strings(seriesCount,1), ...
    "ConfidenceLevel",NaN,"Lower",nan(height(data),seriesCount), ...
    "Upper",nan(height(data),seriesCount),"CompleteMask",true(height(data),seriesCount));
magnitudeVariables = normalize_parallel_names( ...
    oi_get_option(options,"UncertaintyVariables",strings(0,1)),seriesCount, ...
    "oi_plot_time_series:UncertaintyVariables");
lowerVariables = normalize_parallel_names( ...
    oi_get_option(options,"UncertaintyLowerVariables",strings(0,1)),seriesCount, ...
    "oi_plot_time_series:UncertaintyVariables");
upperVariables = normalize_parallel_names( ...
    oi_get_option(options,"UncertaintyUpperVariables",strings(0,1)),seriesCount, ...
    "oi_plot_time_series:UncertaintyVariables");
assert(isempty(magnitudeVariables) || (isempty(lowerVariables) && isempty(upperVariables)), ...
    "oi_plot_time_series:UncertaintyVariables", ...
    "Use uncertainty magnitudes or lower/upper bounds, not both");
assert(isempty(lowerVariables) == isempty(upperVariables), ...
    "oi_plot_time_series:UncertaintyVariables", ...
    "Lower and upper uncertainty variables must be supplied together");
if isempty(magnitudeVariables) && isempty(lowerVariables)
    return;
end
uncertaintyType = scalar_text(oi_get_option(options,"UncertaintyType",""), ...
    "oi_plot_time_series:UncertaintyType", ...
    "UncertaintyType must define the supplied uncertainty");
allowedTypes = ["standard-deviation" "standard-error" "confidence-interval" ...
    "instrument-accuracy" "ensemble-spread"];
assert(any(uncertaintyType == allowedTypes), "oi_plot_time_series:UncertaintyType", ...
    "UncertaintyType is not a supported scientific definition");
uncertaintyUnits = optional_text_vector(oi_get_option(options,"UncertaintyUnits",valueUnits), ...
    seriesCount,"oi_plot_time_series:UncertaintyUnit", ...
    "UncertaintyUnits must match the plotted series");
assert(all(uncertaintyUnits == valueUnits), "oi_plot_time_series:UncertaintyUnit", ...
    "Uncertainty units must equal the corresponding value units");
confidenceLevel = oi_get_option(options,"ConfidenceLevel",NaN);
if uncertaintyType == "confidence-interval"
    assert(isnumeric(confidenceLevel) && isscalar(confidenceLevel) ...
        && isfinite(confidenceLevel) && confidenceLevel > 0 && confidenceLevel < 1, ...
        "oi_plot_time_series:ConfidenceLevel", ...
        "Confidence intervals require ConfidenceLevel strictly between zero and one");
else
    assert(isnumeric(confidenceLevel) && isscalar(confidenceLevel) && isnan(confidenceLevel), ...
        "oi_plot_time_series:ConfidenceLevel", ...
        "ConfidenceLevel must be omitted for non-confidence uncertainty");
end
uncertainty.Type = uncertaintyType;
uncertainty.Unit = uncertaintyUnits;
uncertainty.ConfidenceLevel = confidenceLevel;
if ~isempty(magnitudeVariables)
    uncertainty.Mode = "magnitude";
    assert(all(ismember(magnitudeVariables,string(data.Properties.VariableNames))), ...
        "oi_plot_time_series:UncertaintyVariables", ...
        "Every uncertainty variable must exist in data");
    for seriesIndex = 1:seriesCount
        magnitude = data.(magnitudeVariables(seriesIndex));
        validate_aligned_numeric(magnitude,height(data), ...
            "oi_plot_time_series:UncertaintyValues");
        magnitude = magnitude(:);
        assert(all(isnan(magnitude) | magnitude >= 0), ...
            "oi_plot_time_series:UncertaintyValues", ...
            "Uncertainty magnitudes must be nonnegative finite values or NaN");
        values = data.(valueVariables(seriesIndex));
        assert(~any(isfinite(magnitude) & ~isfinite(values(:))), ...
            "oi_plot_time_series:UncertaintyValues", ...
            "Finite uncertainty cannot accompany a missing value");
        uncertainty.Lower(:,seriesIndex) = values(:) - magnitude;
        uncertainty.Upper(:,seriesIndex) = values(:) + magnitude;
        uncertainty.CompleteMask(:,seriesIndex) = isfinite(magnitude);
    end
else
    uncertainty.Mode = "bounds";
    assert(uncertaintyType == "confidence-interval", ...
        "oi_plot_time_series:UncertaintyType", ...
        "Lower/upper bounds require UncertaintyType='confidence-interval'");
    assert(all(ismember([lowerVariables;upperVariables],string(data.Properties.VariableNames))), ...
        "oi_plot_time_series:UncertaintyVariables", ...
        "Every uncertainty bound variable must exist in data");
    for seriesIndex = 1:seriesCount
        lower = data.(lowerVariables(seriesIndex));
        upper = data.(upperVariables(seriesIndex));
        validate_aligned_numeric(lower,height(data),"oi_plot_time_series:UncertaintyValues");
        validate_aligned_numeric(upper,height(data),"oi_plot_time_series:UncertaintyValues");
        values = data.(valueVariables(seriesIndex));
        completeMask = isfinite(lower(:)) & isfinite(upper(:)) & isfinite(values(:));
        assert(isequal(isfinite(lower(:)),isfinite(upper(:))), ...
            "oi_plot_time_series:UncertaintyValues", ...
            "Lower and upper bounds must share the same finite mask");
        assert(all(lower(completeMask) <= values(completeMask)) ...
            && all(values(completeMask) <= upper(completeMask)), ...
            "oi_plot_time_series:UncertaintyValues", ...
            "Uncertainty bounds must enclose each complete value");
        uncertainty.Lower(:,seriesIndex) = lower(:);
        uncertainty.Upper(:,seriesIndex) = upper(:);
        uncertainty.CompleteMask(:,seriesIndex) = isfinite(lower(:));
    end
end
assert(all(isfinite(uncertainty.Lower(uncertainty.CompleteMask))) ...
    && all(isfinite(uncertainty.Upper(uncertainty.CompleteMask))), ...
    "oi_plot_time_series:UncertaintyValues", ...
    "Finite uncertainty inputs must not overflow their plotted endpoints");
end

function handles = plot_uncertainty(axesHandle,rowTimes,values,validMask,gapThreshold,uncertainty,seriesIndex,color)
handles = gobjects(0);
if uncertainty.Mode == "none"
    return;
end
lower = uncertainty.Lower(:,seriesIndex);
upper = uncertainty.Upper(:,seriesIndex);
segmentGroups = contiguous_groups(rowTimes,validMask,gapThreshold);
handles = gobjects(numel(segmentGroups),1);
for groupIndex = 1:numel(segmentGroups)
    indices = segmentGroups{groupIndex};
    polygonTimes = [rowTimes(indices);flipud(rowTimes(indices))];
    polygonValues = [lower(indices);flipud(upper(indices))];
    handles(groupIndex) = fill(axesHandle,polygonTimes,polygonValues,color, ...
        "FaceAlpha",0.16,"EdgeColor","none","HandleVisibility","off");
end
assert(all(isfinite(values(validMask))), "oi_plot_time_series:InvalidValues", ...
    "Uncertainty graphics require finite complete values");
end

function groups = contiguous_groups(rowTimes,validMask,gapThreshold)
validIndices = find(validMask);
groups = cell(0,1);
if isempty(validIndices)
    return;
end
breakAfter = diff(validIndices) > 1;
if ~isempty(gapThreshold)
    breakAfter = breakAfter | diff(rowTimes(validIndices)) > gapThreshold;
end
starts = [1;find(breakAfter)+1];
ends = [find(breakAfter);numel(validIndices)];
for groupIndex = 1:numel(starts)
    groups{groupIndex,1} = validIndices(starts(groupIndex):ends(groupIndex));
end
end

function [plotTimes,plotValues,gapMask,sourceIndices] = insert_gap_breaks(rowTimes,values,gapThreshold)
gapMask = false(max(numel(rowTimes)-1,0),1);
if isempty(gapThreshold) || numel(rowTimes) < 2
    plotTimes = rowTimes;
    plotValues = values;
    sourceIndices = (1:numel(rowTimes))';
    return;
end
gapMask = diff(rowTimes) > gapThreshold;
extraCount = sum(gapMask);
plotTimes = NaT(numel(rowTimes)+extraCount,1,"TimeZone",rowTimes.TimeZone);
plotValues = nan(numel(values)+extraCount,1);
sourceIndices = zeros(numel(values)+extraCount,1);
outputIndex = 1;
for inputIndex = 1:numel(rowTimes)
    plotTimes(outputIndex) = rowTimes(inputIndex);
    plotValues(outputIndex) = values(inputIndex);
    sourceIndices(outputIndex) = inputIndex;
    outputIndex = outputIndex + 1;
    if inputIndex < numel(rowTimes) && gapMask(inputIndex)
        outputIndex = outputIndex + 1;
    end
end
end

function mask = accepted_qc_mask(values,acceptedValues)
assert(isvector(values),"oi_plot_time_series:QCValues", ...
    "QC variables must be vectors aligned with data rows");
if isnumeric(values) || islogical(values) || isdatetime(values) || isduration(values)
    mask = ismember(values(:),acceptedValues);
    missingMask = ismissing(values(:));
else
    textValues = string(values(:));
    mask = ismember(textValues,string(acceptedValues));
    missingMask = ismissing(textValues);
end
mask = mask & ~missingMask;
end

function labels = resolve_sample_labels(data,options,rowCount)
labelVariable = string(oi_get_option(options,"SampleLabelVariable",""));
if strlength(strtrim(labelVariable)) > 0
    assert(ismember(labelVariable,string(data.Properties.VariableNames)), ...
        "oi_plot_time_series:SampleLabels", "SampleLabelVariable must exist in data");
    labels = string(data.(labelVariable));
else
    labels = "Sample " + string((1:rowCount)');
end
assert(numel(labels) == rowCount && all(~ismissing(labels)) ...
    && all(strlength(strtrim(labels)) > 0), ...
    "oi_plot_time_series:SampleLabels", ...
    "Sample labels must be aligned nonblank text");
labels = labels(:);
end

function names = normalize_parallel_names(value,seriesCount,errorIdentifier)
if isempty(value)
    names = strings(0,1);
    return;
end
names = text_vector(value,errorIdentifier,"Variable names must be nonblank text");
if isscalar(names) && seriesCount > 1
    names = repmat(names,seriesCount,1);
end
assert(numel(names) == seriesCount,errorIdentifier, ...
    "Variable-name options must contain one entry per plotted series");
end

function value = scalar_text(value,errorIdentifier,errorMessage)
value = oi_require_text(value,errorIdentifier,errorMessage);
assert(isscalar(value),errorIdentifier,errorMessage);
end

function values = text_vector(value,errorIdentifier,errorMessage)
values = oi_require_text(value,errorIdentifier,errorMessage);
values = values(:);
end

function values = optional_text_vector(value,expectedCount,errorIdentifier,errorMessage)
values = text_vector(value,errorIdentifier,errorMessage);
if isscalar(values) && expectedCount > 1
    values = repmat(values,expectedCount,1);
end
assert(numel(values) == expectedCount,errorIdentifier,errorMessage);
end

function validate_aligned_numeric(values,rowCount,errorIdentifier)
assert(isnumeric(values) && isreal(values) && isvector(values) ...
    && numel(values) == rowCount && ~any(isinf(values),"all"), ...
    errorIdentifier,"Uncertainty values must be aligned real numeric vectors without Inf");
end

function label = compose_shared_ylabel(valueLabels,valueUnits)
if numel(unique(valueUnits)) == 1
    label = strjoin(valueLabels,", ") + " (" + valueUnits(1) + ")";
else
    label = "Values (see legend; units differ)";
end
end
