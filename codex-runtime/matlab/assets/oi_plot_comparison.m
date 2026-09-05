function result = oi_plot_comparison(axesHandle, observations, modelValues, options)
%OI_PLOT_COMPARISON Plot explicitly paired agreement data with diagnostics.
% Input contract: numeric vectors use row-aligned pairing; table/timetable
% inputs require an explicit PairingRule and variable metadata. NaN, failed QC,
% unmatched keys, and incomplete uncertainty are counted and never imputed.
arguments
    axesHandle (1,1) matlab.graphics.axis.Axes
    observations
    modelValues
    options (1,1) struct = struct()
end

missingPolicy = string(oi_get_option(options,"MissingPolicy","preserve"));
assert(isscalar(missingPolicy) && missingPolicy == "preserve", ...
    "oi_plot_comparison:MissingPolicy", ...
    "Only MissingPolicy='preserve' is supported");
[pairData,pairing] = resolve_pairs(observations,modelValues,options);
observationValues = pairData.Observation;
modelData = pairData.Model;
assert(isnumeric(observationValues) && isnumeric(modelData) ...
    && isvector(observationValues) && isvector(modelData) ...
    && isreal(observationValues) && isreal(modelData) ...
    && ~any(isinf(observationValues)) && ~any(isinf(modelData)), ...
    "oi_plot_comparison:InvalidValues", ...
    "Paired values may contain NaN but not Inf or complex values");

observationQC = resolve_aligned_option(pairData,options,"ObservationQC", ...
    "ObservationQCVariable",pairing.ObservationIndices);
modelQC = resolve_aligned_option(pairData,options,"ModelQC", ...
    "ModelQCVariable",pairing.ModelIndices);
acceptedQCValues = oi_get_option(options,"AcceptedQCValues",[]);
if isempty(observationQC) && isempty(modelQC)
    qcMask = true(size(observationValues));
else
    assert(~isempty(acceptedQCValues),"oi_plot_comparison:QCPolicy", ...
        "AcceptedQCValues must be explicit when QC data are supplied");
    qcMask = true(size(observationValues));
    if ~isempty(observationQC)
        qcMask = qcMask & accepted_qc_mask(observationQC,acceptedQCValues);
    end
    if ~isempty(modelQC)
        qcMask = qcMask & accepted_qc_mask(modelQC,acceptedQCValues);
    end
end
finitePairMask = isfinite(observationValues) & isfinite(modelData);
pairedMask = finitePairMask & qcMask;
assert(any(pairedMask),"oi_plot_comparison:NoCompletePairs", ...
    "At least one finite QC-accepted pair is required");

uncertainty = resolve_uncertainty(pairData,options,pairing,finitePairMask);
pairedMask = pairedMask & uncertainty.CompleteMask;
assert(any(pairedMask),"oi_plot_comparison:NoCompletePairs", ...
    "At least one pair must have complete uncertainty when uncertainty is supplied");
pairedObservations = observationValues(pairedMask);
pairedModel = modelData(pairedMask);
residual = pairedModel - pairedObservations;
assert(all(isfinite(residual)),"oi_plot_comparison:MetricOverflow", ...
    "Finite inputs must not overflow while computing paired residuals");
metrics = calculate_metrics(pairedObservations,pairedModel);

quantityUnit = scalar_text(oi_get_option(options,"QuantityUnit",""), ...
    "oi_plot_comparison:Units","QuantityUnit must be explicit nonblank text");
assert_comparison_units(pairData,quantityUnit);
observationLabel = scalar_text(oi_get_option(options,"ObservationLabel","Observation"), ...
    "oi_plot_comparison:Units","ObservationLabel must be explicit nonblank text");
modelLabel = scalar_text(oi_get_option(options,"ModelLabel","Model"), ...
    "oi_plot_comparison:Units","ModelLabel must be explicit nonblank text");
titleText = scalar_text(oi_get_option(options,"Title","Observation-model comparison"), ...
    "oi_plot_comparison:Title","Title must be explicit nonblank text");
sampleLabels = resolve_sample_labels(pairData,options,pairing,numel(observationValues));
[confounderValues,confounderLabel] = resolve_confounder(pairData,options,pairing);

limits = equal_limits([pairedObservations;pairedModel; ...
    uncertainty.ObservationLower(pairedMask);uncertainty.ObservationUpper(pairedMask); ...
    uncertainty.ModelLower(pairedMask);uncertainty.ModelUpper(pairedMask)]);
theme = oi_get_option(options,"Theme",struct());
assert(isstruct(theme) && isscalar(theme), "oi_plot_comparison:Theme", ...
    "Theme must be a scalar struct");
if isempty(fieldnames(theme))
    theme = oi_ocean_theme();
end
holdCleanup = oi_hold_axes(axesHandle);
uncertaintyHandles = plot_uncertainty(axesHandle,observationValues,modelData, ...
    uncertainty,pairedMask,theme.GridColor);
[scatterHandles,legendLabels] = plot_groups(axesHandle,pairedObservations,pairedModel, ...
    confounderValues(pairedMask),confounderLabel,theme);
oneToOneHandle = plot(axesHandle,limits,limits,"k--","LineWidth",1.0, ...
    "DisplayName","1:1 reference");
clear holdCleanup;
axis(axesHandle,"equal");
xlim(axesHandle,limits);
ylim(axesHandle,limits);
xlabel(axesHandle,observationLabel + " (" + quantityUnit + ")","Interpreter","none");
ylabel(axesHandle,modelLabel + " (" + quantityUnit + ")","Interpreter","none");
title(axesHandle,titleText,"FontWeight","normal","Interpreter","none");
metricText = compose_metric_text(metrics,quantityUnit,sum(~finitePairMask), ...
    sum(finitePairMask & ~qcMask),pairing);
text(axesHandle,0.04,0.96,metricText,"Units","normalized", ...
    "VerticalAlignment","top","Interpreter","none", ...
    "FontName",theme.FontName,"FontSize",theme.FontSize,"Color",theme.TextColor);
legendHandle = legend(axesHandle,[scatterHandles(:);oneToOneHandle], ...
    [legendLabels(:);"1:1 reference"],"Location", ...
    string(oi_get_option(options,"LegendLocation","best")),"Interpreter","none");
oi_apply_axes(axesHandle,theme);
configure_data_tips(scatterHandles,pairedObservations,pairedModel,residual, ...
    sampleLabels(pairedMask),confounderValues(pairedMask),confounderLabel, ...
    observationLabel,modelLabel,quantityUnit);

metrics.QuantityUnit = quantityUnit;
stratifiedMetrics = calculate_stratified_metrics(pairedObservations,pairedModel, ...
    confounderValues(pairedMask));
result = struct("Axes",axesHandle,"Scatter",scatterHandles,"OneToOne",oneToOneHandle, ...
    "UncertaintyGraphics",uncertaintyHandles,"Legend",legendHandle, ...
    "PairedMask",pairedMask,"FinitePairMask",finitePairMask,"QCAcceptedMask",qcMask, ...
    "PairingRule",pairing.Rule,"ObservationPairIndices",pairing.ObservationIndices, ...
    "ModelPairIndices",pairing.ModelIndices,"UnmatchedObservationCount",pairing.UnmatchedObservationCount, ...
    "UnmatchedModelCount",pairing.UnmatchedModelCount,"DuplicateKeyPolicy","reject", ...
    "MissingCount",sum(~finitePairMask),"QCRejectedCount",sum(finitePairMask & ~qcMask), ...
    "ValidCount",sum(pairedMask),"MissingPolicy",missingPolicy,"Metrics",metrics, ...
    "StratifiedMetrics",stratifiedMetrics,"ConfounderLabel",confounderLabel, ...
    "UncertaintyType",uncertainty.Type,"UncertaintyUnit",uncertainty.Unit, ...
    "ConfidenceLevel",uncertainty.ConfidenceLevel,"Limits",limits, ...
    "valid_count",sum(pairedMask),"missing_count",sum(~finitePairMask));
end

function [pairData,pairing] = resolve_pairs(observations,modelValues,options)
isObservationTable = istable(observations) || istimetable(observations);
isModelTable = istable(modelValues) || istimetable(modelValues);
assert(isObservationTable == isModelTable,"oi_plot_comparison:InputType", ...
    "observations and modelValues must both be numeric vectors or both tabular inputs");
if ~isObservationTable
    assert(isnumeric(observations) && isnumeric(modelValues) ...
        && isvector(observations) && isvector(modelValues) ...
        && numel(observations) == numel(modelValues) && ~isempty(observations), ...
        "oi_plot_comparison:SizeMismatch", ...
        "Numeric comparison vectors must have equal nonzero length");
    rule = string(oi_get_option(options,"PairingRule","row-aligned"));
    assert(rule == "row-aligned","oi_plot_comparison:PairingRule", ...
        "Numeric vectors support only PairingRule='row-aligned'");
    pairData = struct("Observation",observations(:),"Model",modelValues(:), ...
        "ObservationTable",[],"ModelTable",[], ...
        "ObservationVariable","","ModelVariable","");
    indices = (1:numel(observations))';
    pairing = pairing_result(rule,indices,indices,0,0);
    return;
end
rule = scalar_text(oi_get_option(options,"PairingRule",""), ...
    "oi_plot_comparison:PairingRule", ...
    "Tabular comparison requires explicit PairingRule");
observationVariable = scalar_text(oi_get_option(options,"ObservationVariable",""), ...
    "oi_plot_comparison:Variables","ObservationVariable must be explicit");
modelVariable = scalar_text(oi_get_option(options,"ModelVariable",""), ...
    "oi_plot_comparison:Variables","ModelVariable must be explicit");
assert(ismember(observationVariable,string(observations.Properties.VariableNames)) ...
    && ismember(modelVariable,string(modelValues.Properties.VariableNames)), ...
    "oi_plot_comparison:Variables","Comparison variables must exist in their tables");
if rule == "row-aligned"
    assert(height(observations) == height(modelValues) && height(observations) > 0, ...
        "oi_plot_comparison:SizeMismatch", ...
        "Row-aligned tables must have equal nonzero heights");
    observationIndices = (1:height(observations))';
    modelIndices = observationIndices;
elseif rule == "row-time-inner"
    assert(istimetable(observations) && istimetable(modelValues), ...
        "oi_plot_comparison:PairingRule", ...
        "row-time-inner requires two timetables");
    observationTimes = observations.Properties.RowTimes;
    modelTimes = modelValues.Properties.RowTimes;
    validate_unique_times(observationTimes,"observation");
    validate_unique_times(modelTimes,"model");
    assert(string(observationTimes.TimeZone) == string(modelTimes.TimeZone), ...
        "oi_plot_comparison:TimeZone", ...
        "Timetable row times must use the same explicit TimeZone");
    [matched,modelIndices] = ismember(observationTimes,modelTimes);
    observationIndices = find(matched);
    modelIndices = modelIndices(matched);
elseif rule == "inner-key"
    pairKeys = text_vector(oi_get_option(options,"PairKeys",strings(0,1)), ...
        "oi_plot_comparison:PairKeys","PairKeys must be explicit nonblank text");
    assert(~isempty(pairKeys) ...
        && all(ismember(pairKeys,string(observations.Properties.VariableNames))) ...
        && all(ismember(pairKeys,string(modelValues.Properties.VariableNames))), ...
        "oi_plot_comparison:PairKeys","Every PairKeys variable must exist in both tables");
    observationKeys = composite_keys(observations,pairKeys);
    modelKeys = composite_keys(modelValues,pairKeys);
    assert(numel(unique(observationKeys)) == numel(observationKeys) ...
        && numel(unique(modelKeys)) == numel(modelKeys), ...
        "oi_plot_comparison:DuplicateKeys", ...
        "Pair keys must be unique; duplicate-key aggregation is never implicit");
    [matched,modelIndices] = ismember(observationKeys,modelKeys);
    observationIndices = find(matched);
    modelIndices = modelIndices(matched);
else
    error("oi_plot_comparison:PairingRule", ...
        "PairingRule must be row-aligned, row-time-inner, or inner-key");
end
assert(~isempty(observationIndices),"oi_plot_comparison:NoMatchedPairs", ...
    "The explicit pairing rule produced no matched rows");
observationColumn = observations.(observationVariable);
modelColumn = modelValues.(modelVariable);
pairData = struct("Observation",observationColumn(observationIndices), ...
    "Model",modelColumn(modelIndices), ...
    "ObservationTable",observations,"ModelTable",modelValues, ...
    "ObservationVariable",observationVariable,"ModelVariable",modelVariable);
pairing = pairing_result(rule,observationIndices,modelIndices, ...
    height(observations)-numel(observationIndices),height(modelValues)-numel(modelIndices));
end

function pairing = pairing_result(rule,observationIndices,modelIndices,unmatchedObservations,unmatchedModels)
pairing = struct("Rule",rule,"ObservationIndices",observationIndices(:), ...
    "ModelIndices",modelIndices(:),"UnmatchedObservationCount",unmatchedObservations, ...
    "UnmatchedModelCount",unmatchedModels);
end

function values = resolve_aligned_option(pairData,options,arrayField,variableField,indices)
values = [];
if isfield(options,arrayField) && ~isempty(options.(arrayField))
    sourceValues = options.(arrayField);
    assert(isvector(sourceValues),"oi_plot_comparison:AlignedMetadata", ...
        "Aligned metadata options must be vectors");
    if numel(sourceValues) == numel(indices)
        values = sourceValues(:);
    else
        assert(numel(sourceValues) >= max(indices),"oi_plot_comparison:AlignedMetadata", ...
            "Aligned metadata must match paired rows or the source table height");
        values = sourceValues(indices);
    end
elseif isfield(options,variableField) && strlength(string(options.(variableField))) > 0
    variableName = scalar_text(options.(variableField), ...
        "oi_plot_comparison:AlignedMetadata","Metadata variable names must be scalar text");
    if startsWith(variableField,"Observation")
        sourceTable = pairData.ObservationTable;
    else
        sourceTable = pairData.ModelTable;
    end
    assert(~isempty(sourceTable) && ismember(variableName,string(sourceTable.Properties.VariableNames)), ...
        "oi_plot_comparison:AlignedMetadata","Metadata variable must exist in its source table");
    sourceColumn = sourceTable.(variableName);
    values = sourceColumn(indices);
end
end

function uncertainty = resolve_uncertainty(pairData,options,pairing,baseMask)
observationMagnitude = resolve_aligned_option(pairData,options,"ObservationUncertainty", ...
    "ObservationUncertaintyVariable",pairing.ObservationIndices);
modelMagnitude = resolve_aligned_option(pairData,options,"ModelUncertainty", ...
    "ModelUncertaintyVariable",pairing.ModelIndices);
count = numel(pairData.Observation);
uncertainty = struct("Type","none","Unit","","ConfidenceLevel",NaN, ...
    "ObservationLower",pairData.Observation,"ObservationUpper",pairData.Observation, ...
    "ModelLower",pairData.Model,"ModelUpper",pairData.Model, ...
    "CompleteMask",true(count,1));
if isempty(observationMagnitude) && isempty(modelMagnitude)
    return;
end
assert(~isempty(observationMagnitude) && ~isempty(modelMagnitude), ...
    "oi_plot_comparison:UncertaintyValues", ...
    "Observation and model uncertainty must be supplied together");
validate_uncertainty_magnitude(observationMagnitude,count);
validate_uncertainty_magnitude(modelMagnitude,count);
uncertaintyType = scalar_text(oi_get_option(options,"UncertaintyType",""), ...
    "oi_plot_comparison:UncertaintyType","UncertaintyType must be explicit");
allowedTypes = ["standard-deviation" "standard-error" "confidence-interval" ...
    "instrument-accuracy" "ensemble-spread"];
assert(any(uncertaintyType == allowedTypes),"oi_plot_comparison:UncertaintyType", ...
    "UncertaintyType is not a supported scientific definition");
uncertaintyUnit = scalar_text(oi_get_option(options,"UncertaintyUnit",""), ...
    "oi_plot_comparison:UncertaintyUnit","UncertaintyUnit must be explicit");
quantityUnit = scalar_text(oi_get_option(options,"QuantityUnit",""), ...
    "oi_plot_comparison:Units","QuantityUnit must be explicit nonblank text");
assert(uncertaintyUnit == quantityUnit,"oi_plot_comparison:UncertaintyUnit", ...
    "UncertaintyUnit must equal QuantityUnit");
confidenceLevel = oi_get_option(options,"ConfidenceLevel",NaN);
if uncertaintyType == "confidence-interval"
    assert(isnumeric(confidenceLevel) && isscalar(confidenceLevel) ...
        && isfinite(confidenceLevel) && confidenceLevel > 0 && confidenceLevel < 1, ...
        "oi_plot_comparison:ConfidenceLevel", ...
        "Confidence intervals require ConfidenceLevel between zero and one");
else
    assert(isnumeric(confidenceLevel) && isscalar(confidenceLevel) && isnan(confidenceLevel), ...
        "oi_plot_comparison:ConfidenceLevel", ...
        "ConfidenceLevel must be omitted for non-confidence uncertainty");
end
completeMask = isfinite(observationMagnitude) & isfinite(modelMagnitude);
assert(~any(completeMask & ~baseMask),"oi_plot_comparison:UncertaintyValues", ...
    "Finite uncertainty cannot accompany missing or QC-rejected pairs");
uncertainty.Type = uncertaintyType;
uncertainty.Unit = uncertaintyUnit;
uncertainty.ConfidenceLevel = confidenceLevel;
uncertainty.ObservationLower = pairData.Observation - observationMagnitude(:);
uncertainty.ObservationUpper = pairData.Observation + observationMagnitude(:);
uncertainty.ModelLower = pairData.Model - modelMagnitude(:);
uncertainty.ModelUpper = pairData.Model + modelMagnitude(:);
uncertainty.CompleteMask = completeMask;
assert(all(isfinite(uncertainty.ObservationLower(completeMask))) ...
    && all(isfinite(uncertainty.ObservationUpper(completeMask))) ...
    && all(isfinite(uncertainty.ModelLower(completeMask))) ...
    && all(isfinite(uncertainty.ModelUpper(completeMask))), ...
    "oi_plot_comparison:MetricOverflow", ...
    "Finite uncertainty magnitudes must not overflow their endpoints");
end

function [values,label] = resolve_confounder(pairData,options,pairing)
values = repmat("All pairs",numel(pairData.Observation),1);
label = "";
if isfield(options,"ConfounderValues") && ~isempty(options.ConfounderValues)
    sourceValues = options.ConfounderValues;
    assert(isvector(sourceValues),"oi_plot_comparison:Confounder", ...
        "ConfounderValues must be a vector");
    if numel(sourceValues) == numel(values)
        values = string(sourceValues(:));
    else
        assert(numel(sourceValues) >= max(pairing.ObservationIndices), ...
            "oi_plot_comparison:Confounder", ...
            "ConfounderValues must match paired rows or observation-table height");
        values = string(sourceValues(pairing.ObservationIndices));
    end
elseif isfield(options,"ConfounderVariable") ...
        && strlength(string(options.ConfounderVariable)) > 0
    variableName = scalar_text(options.ConfounderVariable, ...
        "oi_plot_comparison:Confounder","ConfounderVariable must be scalar text");
    assert(~isempty(pairData.ObservationTable) ...
        && ismember(variableName,string(pairData.ObservationTable.Properties.VariableNames)), ...
        "oi_plot_comparison:Confounder","ConfounderVariable must exist in the observation table");
    sourceColumn = pairData.ObservationTable.(variableName);
    values = string(sourceColumn(pairing.ObservationIndices));
end
if any(values ~= "All pairs")
    label = scalar_text(oi_get_option(options,"ConfounderLabel",""), ...
        "oi_plot_comparison:Confounder", ...
        "ConfounderLabel must be explicit when a confounder is supplied");
end
assert(all(~ismissing(values)) && all(strlength(strtrim(values)) > 0), ...
    "oi_plot_comparison:Confounder","Confounder values must be complete nonblank categories");
end

function [handles,labels] = plot_groups(axesHandle,observations,modelValues,confounders,label,theme)
groups = unique(confounders,"stable");
assert(numel(groups) <= size(theme.LineColors,1),"oi_plot_comparison:Confounder", ...
    "Confounder has more categories than the explicit publication palette");
handles = gobjects(numel(groups),1);
labels = strings(numel(groups),1);
for groupIndex = 1:numel(groups)
    groupMask = confounders == groups(groupIndex);
    if strlength(label) > 0
        labels(groupIndex) = label + ": " + groups(groupIndex);
    else
        labels(groupIndex) = "Paired samples";
    end
    handles(groupIndex) = scatter(axesHandle,observations(groupMask),modelValues(groupMask), ...
        30,theme.LineColors(groupIndex,:),"filled","MarkerEdgeColor",[0.15 0.15 0.15], ...
        "DisplayName",labels(groupIndex));
end
end

function handles = plot_uncertainty(axesHandle,observations,modelValues,uncertainty,mask,color)
if uncertainty.Type == "none"
    handles = gobjects(0);
    return;
end
selectedIndices = find(mask);
handles = gobjects(numel(selectedIndices)*2,1);
for pointIndex = 1:numel(selectedIndices)
    sourceIndex = selectedIndices(pointIndex);
    handles(2*pointIndex-1) = plot(axesHandle, ...
        [uncertainty.ObservationLower(sourceIndex) uncertainty.ObservationUpper(sourceIndex)], ...
        [modelValues(sourceIndex) modelValues(sourceIndex)],"-","Color",color, ...
        "LineWidth",0.8,"HandleVisibility","off");
    handles(2*pointIndex) = plot(axesHandle, ...
        [observations(sourceIndex) observations(sourceIndex)], ...
        [uncertainty.ModelLower(sourceIndex) uncertainty.ModelUpper(sourceIndex)], ...
        "-","Color",color,"LineWidth",0.8,"HandleVisibility","off");
end
end

function configure_data_tips(handles,observations,modelValues,residuals,sampleLabels, ...
    confounders,confounderLabel,observationLabel,modelLabel,unit)
groups = unique(confounders,"stable");
for groupIndex = 1:numel(handles)
    if ~isprop(handles(groupIndex),"DataTipTemplate")
        continue;
    end
    groupMask = confounders == groups(groupIndex);
    rows = [dataTipTextRow("Sample",sampleLabels(groupMask)); ...
        dataTipTextRow(observationLabel + " (" + unit + ")",observations(groupMask)); ...
        dataTipTextRow(modelLabel + " (" + unit + ")",modelValues(groupMask)); ...
        dataTipTextRow("Residual (" + unit + ")",residuals(groupMask))];
    if strlength(confounderLabel) > 0
        rows = [rows;dataTipTextRow(confounderLabel,confounders(groupMask))];
    end
    handles(groupIndex).DataTipTemplate.DataTipRows = rows;
end
end

function metrics = calculate_metrics(observations,modelValues)
residual = modelValues - observations;
pairCount = numel(residual);
biasValue = sum(residual / pairCount);
maeValue = sum(abs(residual) / pairCount);
rmseValue = norm(residual) / sqrt(pairCount);
observationScale = max(abs(observations));
modelScale = max(abs(modelValues));
scaledObservations = observations / max(1,observationScale);
scaledModel = modelValues / max(1,modelScale);
if pairCount >= 2 && std(scaledObservations) > 0 && std(scaledModel) > 0
    correlationMatrix = corrcoef(scaledObservations,scaledModel);
    correlationValue = correlationMatrix(1,2);
else
    correlationValue = NaN;
end
assert(all(isfinite([biasValue maeValue rmseValue])), ...
    "oi_plot_comparison:MetricOverflow", ...
    "Comparison metrics must remain finite for finite complete pairs");
metrics = struct("PairedCount",pairCount,"Bias",biasValue,"MAE",maeValue, ...
    "RMSE",rmseValue,"Correlation",correlationValue);
end

function summary = calculate_stratified_metrics(observations,modelValues,confounders)
groups = unique(confounders,"stable");
summary = repmat(struct("Group","","PairedCount",0,"Bias",NaN, ...
    "MAE",NaN,"RMSE",NaN,"Correlation",NaN),numel(groups),1);
for groupIndex = 1:numel(groups)
    groupMask = confounders == groups(groupIndex);
    groupMetrics = calculate_metrics(observations(groupMask),modelValues(groupMask));
    summary(groupIndex).Group = groups(groupIndex);
    summary(groupIndex).PairedCount = groupMetrics.PairedCount;
    summary(groupIndex).Bias = groupMetrics.Bias;
    summary(groupIndex).MAE = groupMetrics.MAE;
    summary(groupIndex).RMSE = groupMetrics.RMSE;
    summary(groupIndex).Correlation = groupMetrics.Correlation;
end
end

function textValue = compose_metric_text(metrics,unit,missingCount,qcRejectedCount,pairing)
textValue = "N = " + string(metrics.PairedCount) + newline ...
    + "Bias = " + compose("%.4g",metrics.Bias) + " " + unit + newline ...
    + "MAE = " + compose("%.4g",metrics.MAE) + " " + unit + newline ...
    + "RMSE = " + compose("%.4g",metrics.RMSE) + " " + unit + newline ...
    + "r = " + compose("%.3f",metrics.Correlation) + newline ...
    + "Missing/QC rejected = " + string(missingCount) + "/" + string(qcRejectedCount) + newline ...
    + "Unmatched obs/model = " + string(pairing.UnmatchedObservationCount) ...
    + "/" + string(pairing.UnmatchedModelCount);
end

function labels = resolve_sample_labels(pairData,options,pairing,pairCount)
labels = "Pair " + string((1:pairCount)');
if isfield(options,"SampleLabels") && ~isempty(options.SampleLabels)
    sourceLabels = string(options.SampleLabels);
    if numel(sourceLabels) == pairCount
        labels = sourceLabels(:);
    else
        assert(numel(sourceLabels) >= max(pairing.ObservationIndices), ...
            "oi_plot_comparison:SampleLabels", ...
            "SampleLabels must match paired rows or observation-table height");
        labels = sourceLabels(pairing.ObservationIndices);
    end
elseif isfield(options,"SampleLabelVariable") ...
        && strlength(string(options.SampleLabelVariable)) > 0
    variableName = scalar_text(options.SampleLabelVariable, ...
        "oi_plot_comparison:SampleLabels","SampleLabelVariable must be scalar text");
    assert(~isempty(pairData.ObservationTable) ...
        && ismember(variableName,string(pairData.ObservationTable.Properties.VariableNames)), ...
        "oi_plot_comparison:SampleLabels", ...
        "SampleLabelVariable must exist in the observation table");
    sourceColumn = pairData.ObservationTable.(variableName);
    labels = string(sourceColumn(pairing.ObservationIndices));
end
assert(numel(labels) == pairCount && all(~ismissing(labels)) ...
    && all(strlength(strtrim(labels)) > 0), ...
    "oi_plot_comparison:SampleLabels","Sample labels must be aligned nonblank text");
labels = labels(:);
end

function keys = composite_keys(data,keyVariables)
keys = strings(height(data),1);
for keyIndex = 1:numel(keyVariables)
    component = string(data.(keyVariables(keyIndex)));
    assert(numel(component) == height(data) && all(~ismissing(component)) ...
        && all(strlength(component) > 0), ...
        "oi_plot_comparison:PairKeys", ...
        "Pair key components must be aligned, complete, and nonblank");
    keys = keys + string(char(30)) + string(strlength(component)) + ":" + component;
end
end

function validate_unique_times(times,role)
assert(isdatetime(times) && ~any(isnat(times)) && strlength(string(times.TimeZone)) > 0, ...
    "oi_plot_comparison:TimeZone",string(role) + " timetable requires zoned non-NaT row times");
assert(numel(unique(times)) == numel(times),"oi_plot_comparison:DuplicateKeys", ...
    string(role) + " timetable row times must be unique");
end

function mask = accepted_qc_mask(values,acceptedValues)
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

function validate_uncertainty_magnitude(values,count)
assert(isnumeric(values) && isreal(values) && isvector(values) && numel(values) == count ...
    && all(isnan(values(:)) | (isfinite(values(:)) & values(:) >= 0)), ...
    "oi_plot_comparison:UncertaintyValues", ...
    "Uncertainty magnitudes must be aligned nonnegative finite values or NaN");
end

function assert_comparison_units(pairData,quantityUnit)
if isempty(pairData.ObservationTable)
    return;
end
assert_table_unit(pairData.ObservationTable,pairData.ObservationVariable,quantityUnit);
assert_table_unit(pairData.ModelTable,pairData.ModelVariable,quantityUnit);
end

function assert_table_unit(data,variableName,expectedUnit)
variableNames = string(data.Properties.VariableNames);
variableUnits = string(data.Properties.VariableUnits);
position = find(variableNames == variableName,1);
if ~isempty(variableUnits) && numel(variableUnits) >= position ...
        && strlength(strtrim(variableUnits(position))) > 0
    assert(strtrim(variableUnits(position)) == expectedUnit, ...
        "oi_plot_comparison:UnitMismatch", ...
        "QuantityUnit conflicts with table VariableUnits metadata");
end
end

function limits = equal_limits(values)
values = values(isfinite(values));
minimumValue = min(values);
maximumValue = max(values);
if minimumValue == maximumValue
    padding = max(1,abs(minimumValue)) * 0.05;
else
    scale = max(abs([minimumValue maximumValue]));
    padding = scale * (maximumValue / scale - minimumValue / scale) * 0.05;
end
limits = [minimumValue-padding maximumValue+padding];
assert(all(isfinite(limits)) && limits(1) < limits(2), ...
    "oi_plot_comparison:LimitOverflow", ...
    "Equal plot limits overflowed; rescale the explicitly declared input unit");
end

function value = scalar_text(value,errorIdentifier,errorMessage)
value = oi_require_text(value,errorIdentifier,errorMessage);
assert(isscalar(value),errorIdentifier,errorMessage);
end

function values = text_vector(value,errorIdentifier,errorMessage)
values = oi_require_text(value,errorIdentifier,errorMessage);
values = values(:);
end
