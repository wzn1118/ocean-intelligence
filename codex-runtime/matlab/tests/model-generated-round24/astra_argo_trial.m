function [figureHandle,result] = astra_argo_trial(inputPath)
%ASTRA_ARGO_TRIAL Construct one native T-S figure from the frozen raw archive.
% The caller supplies assets on the MATLAB path and owns export and disposal.
% No MATLAB execution or artifact validation is implied by this source file.
arguments
    inputPath (1,1) string
end
assert(~verLessThan('matlab','9.10'), ...
    'astra_argo_trial:UnsupportedRelease','MATLAB R2021a or newer is required.');
required = ["oi_plot_ts_diagram" "oi_figure" "oi_ocean_theme" ...
    "oi_font_available" "oi_sha256_file"];
helperPaths = strings(numel(required),1);
for k = 1:numel(required)
    helperPaths(k) = string(which(char(required(k))));
    assert(strlength(helperPaths(k)) > 0,'astra_argo_trial:MissingHelper', ...
        'The caller must add the repository assets to the MATLAB path.');
end
assert(license('test','MATLAB'),'astra_argo_trial:MissingProduct', ...
    'The MATLAB base product license is required; no add-on toolbox is used.');
expectedHash = "33959a0d9296cf3d0739375d0d551550d493dddbe3aa8cc3606b67ac7df0b7fa";
inputHash = string(oi_sha256_file(inputPath));
assert(inputHash == expectedHash,'astra_argo_trial:InputHash', ...
    'The input must be the specified unmodified raw Argovis JSON archive.');
rawText = fileread(inputPath);
assert(string(oi_sha256_file(inputPath)) == inputHash, ...
    'astra_argo_trial:InputChanged','The input changed during reading.');
profiles = jsondecode(rawText);
assert(isstruct(profiles) && numel(profiles) == 3, ...
    'astra_argo_trial:ProfileCount','Expected exactly three raw profiles.');
profileIDs = ["4903822_067";"4903822_066";"4903822_065"];
expectedCounts = [595;596;594];
fieldOrder = ["pressure";"pressure_argoqc";"salinity"; ...
    "salinity_argoqc";"temperature";"temperature_argoqc"];
expectedUnits = ["decibar";"psu";"degree_Celsius"];
valueIndices = [1 3 5];
idField = matlab.lang.makeValidName('_id');
sources = cell(3,1);
dataInfo = cell(3,1);
sourceData = cell(3,1);
samplingStatements = strings(3,1);
profileTimes = NaT(3,1,'TimeZone','UTC');
counts = zeros(3,1);
N = sum(expectedCounts);
R = table();
R.ObservationID = strings(N,1);
R.ProfileID = strings(N,1);
R.PlatformID = repmat("4903822",N,1);
R.ProfileIndex = zeros(N,1);
R.SourceRow = zeros(N,1);
R.SourceFileRow = zeros(N,1);
R.Time = NaT(N,1,'TimeZone','UTC');
R.TimeText = strings(N,1);
R.Longitude = zeros(N,1);
R.Latitude = zeros(N,1);
R.pressure = zeros(N,1);
R.temperature = zeros(N,1);
R.salinity = zeros(N,1);
R.pressure_argoqc = zeros(N,1);
R.temperature_argoqc = zeros(N,1);
R.salinity_argoqc = zeros(N,1);
R.PressureMode = strings(N,1);
R.TemperatureMode = strings(N,1);
R.SalinityMode = strings(N,1);
R.PressureUnit = strings(N,1);
R.TemperatureUnit = strings(N,1);
R.SalinityUnit = strings(N,1);
R.ProfileDirection = strings(N,1);
R.PositionQC = zeros(N,1);
R.TimeQC = zeros(N,1);
R.Series = strings(N,1);
offset = 0;
for p = 1:3
    profile = profiles(p);
    assert(string(profile.(idField)) == profileIDs(p), ...
        'astra_argo_trial:ProfileOrder','Raw profile order must remain 067/066/065.');
    assert(iscell(profile.data_info) && numel(profile.data_info) == 3, ...
        'astra_argo_trial:DataInfo','Expected raw three-part data_info.');
    info = profile.data_info;
    assert(isequal(text_sequence(info{1}),fieldOrder) ...
        && isequal(text_sequence(info{2}),["units";"data_keys_mode"]), ...
        'astra_argo_trial:DataInfo','Variable or metadata order is unexpected.');
    for v = 1:6
        unit = metadata_entry(info{3},v,1);
        mode = metadata_entry(info{3},v,2);
        quantity = find(valueIndices == v,1);
        if isempty(quantity)
            assert(is_json_null(unit) && is_json_null(mode), ...
                'astra_argo_trial:QCMetadata','QC units and modes must retain null semantics.');
        else
            assert(string(unit) == expectedUnits(quantity) && string(mode) == "A", ...
                'astra_argo_trial:UnitsMode','Original units and A modes must match.');
        end
    end
    D = profile.data;
    assert(isa(D,'double') && isreal(D) && isequal(size(D),[6 expectedCounts(p)]), ...
        'astra_argo_trial:Shape','Raw data must be variable-by-layer; no transpose is allowed.');
    assert(all(isfinite(D),'all'),'astra_argo_trial:UnexpectedMissing', ...
        'This frozen input contains no missing/nonfinite values. Do not fill or repair it.');
    assert(all(D([2 4 6],:) == 1,'all'),'astra_argo_trial:QCFlags', ...
        'This archive must retain all three original QC arrays of flag 1.');
    assert(all(diff(D(1,:)) > 0),'astra_argo_trial:PressureOrder', ...
        'Layer pressure must retain its original strictly increasing order.');
    coordinates = profile.geolocation.coordinates;
    assert(string(profile.geolocation.type) == "Point" && isnumeric(coordinates) ...
        && numel(coordinates) == 2 && all(isfinite(coordinates)) ...
        && coordinates(1) >= -180 && coordinates(1) <= 180 ...
        && coordinates(2) >= -90 && coordinates(2) <= 90, ...
        'astra_argo_trial:Coordinates','Expected GeoJSON longitude then latitude.');
    profileTimes(p) = datetime(profile.timestamp,'InputFormat', ...
        'yyyy-MM-dd''T''HH:mm:ss.SSS''Z''','TimeZone','UTC');
    assert(~isnat(profileTimes(p)),'astra_argo_trial:Time','Profile time cannot be NaT.');
    sources{p} = profile.source;
    dataInfo{p} = profile.data_info;
    sourceData{p} = D;
    samplingStatements(p) = string(profile.vertical_sampling_scheme);
    counts(p) = size(D,2);
    % Explicit coordinate addressing preserves JSON variable-by-layer order.
    for j = 1:counts(p)
        i = offset + j;
        R.ObservationID(i) = profileIDs(p) + ":layer:" + string(sprintf('%04d',j));
        R.ProfileID(i) = profileIDs(p);
        R.ProfileIndex(i) = p;
        R.SourceRow(i) = j;
        R.SourceFileRow(i) = i;
        R.Time(i) = profileTimes(p);
        R.TimeText(i) = string(profile.timestamp);
        R.Longitude(i) = coordinates(1);
        R.Latitude(i) = coordinates(2);
        R.pressure(i) = D(1,j);
        R.pressure_argoqc(i) = D(2,j);
        R.salinity(i) = D(3,j);
        R.salinity_argoqc(i) = D(4,j);
        R.temperature(i) = D(5,j);
        R.temperature_argoqc(i) = D(6,j);
        R.PressureUnit(i) = string(metadata_entry(info{3},1,1));
        R.SalinityUnit(i) = string(metadata_entry(info{3},3,1));
        R.TemperatureUnit(i) = string(metadata_entry(info{3},5,1));
        R.PressureMode(i) = string(metadata_entry(info{3},1,2));
        R.SalinityMode(i) = string(metadata_entry(info{3},3,2));
        R.TemperatureMode(i) = string(metadata_entry(info{3},5,2));
        R.ProfileDirection(i) = string(profile.profile_direction);
        R.PositionQC(i) = profile.geolocation_argoqc;
        R.TimeQC(i) = profile.timestamp_argoqc;
        R.Series(i) = "Profile: " + profileIDs(p);
    end
    offset = offset + counts(p);
end
assert(offset == 1785 && numel(unique(R.ObservationID)) == 1785, ...
    'astra_argo_trial:RecordIdentity','All 1785 locally derived layer IDs must be unique.');
assert(all(diff(profileTimes) < seconds(0)),'astra_argo_trial:TimeOrder', ...
    'The three profile blocks must remain in original descending time order.');
variableUnits = repmat({''},1,width(R));
variableUnits{strcmp(R.Properties.VariableNames,'pressure')} = 'decibar';
variableUnits{strcmp(R.Properties.VariableNames,'temperature')} = 'degree_Celsius';
variableUnits{strcmp(R.Properties.VariableNames,'salinity')} = 'psu';
variableUnits{strcmp(R.Properties.VariableNames,'Longitude')} = 'degrees_east';
variableUnits{strcmp(R.Properties.VariableNames,'Latitude')} = 'degrees_north';
R.Properties.VariableUnits = variableUnits;
qcAccepted = R.pressure_argoqc == 1 & R.temperature_argoqc == 1 & R.salinity_argoqc == 1;
missing = [isnan(R.pressure) isnan(R.temperature) isnan(R.salinity)];
scientific = scientific_contract(counts,profileIDs,R,inputHash);
publication = publication_contract();

theme = oi_ocean_theme();
assert(oi_font_available(theme.FontName),'astra_argo_trial:FontUnavailable', ...
    'The theme font must have exact installed-family evidence.');
theme.FontSize = 10;
theme.LabelSize = 11;
theme.TitleSize = 13;
theme.AxesColor = [1 1 1];
% Only the color lookup table is interpolated, never scientific samples.
palette = zeros(256,3);
startRGB = [0.05 0.20 0.28];
endRGB = [0.78 0.88 0.62];
for k = 1:256
    palette(k,:) = startRGB + ((k-1)/255)*(endRGB-startRGB);
end
theme.SequentialMap = palette;
figureHandle = oi_figure(2400,1500,"off");
try
    figureHandle.Units = 'inches';
    figureHandle.Position(3:4) = [8 5];
    figureHandle.PaperUnits = 'inches';
    figureHandle.PaperSize = [8 5];
    figureHandle.PaperPosition = [0 0 8 5];
    set(figureHandle,'DefaultAxesFontName',theme.FontName, ...
        'DefaultTextFontName',theme.FontName,'DefaultTextInterpreter','none');
    setappdata(figureHandle,'OI_OceanTheme',theme);
    axesHandle = axes('Parent',figureHandle,'Units','normalized', ...
        'OuterPosition',[0.035 0.18 0.91 0.77],'PositionConstraint','outerposition');
    options = struct('SalinityLabel',"Salinity",'SalinityUnit',"psu", ...
        'SalinityType',"unspecified", ...
        'SalinityDefinition',"Original salinity field; source unit psu; no conversion", ...
        'TemperatureLabel',"Temperature",'TemperatureUnit',"degree_Celsius", ...
        'TemperatureType',"unspecified", ...
        'TemperatureDefinition',"Original temperature field; subtype not declared in archive", ...
        'ColorLabel',"Pressure",'ColorUnit',"decibar", ...
        'ColorLimits',[min(R.pressure) max(R.pressure)], ...
        'ColorOutOfRangePolicy',"error",'MissingPolicy',"preserve", ...
        'QCValues',qcAccepted,'AcceptedQCValues',true, ...
        'SampleLabels',R.ObservationID,'ConfounderValues',R.ProfileID, ...
        'ConfounderLabel',"Profile",'LegendLocation',"southoutside", ...
        'Theme',theme,'Colormap',palette,'Title',"Argo 4903822: T-S (3 profiles)");
    helperResult = oi_plot_ts_diagram(axesHandle,R.salinity,R.temperature,R.pressure,options);
    assert(isequal(ancestor(helperResult.Axes,'figure'),figureHandle) ...
        && helperResult.ValidCount == N && numel(helperResult.Scatter) == 3, ...
        'astra_argo_trial:HelperResult','The helper must use the same native figure and all records.');
    xlim(axesHandle,[33.78 34.78]);
    ylim(axesHandle,[-0.5 2.3]);
    set(axesHandle,'XTick',33.8:0.2:34.6,'YTick',-0.5:0.5:2.0);
    set(helperResult.Legend,'Units','normalized','Orientation','horizontal', ...
        'FontName',theme.FontName,'FontSize',9,'Box','off');
    helperResult.Legend.Position = [0.07 0.035 0.84 0.055];
    graphicalMap = cell(3,1);
    for p = 1:3
        rows = find(helperResult.CompleteMask & R.ProfileIndex == p);
        scatterHandle = helperResult.Scatter(p);
        assert(numel(scatterHandle.XData) == numel(rows), ...
            'astra_argo_trial:ScatterMapping','Native scatter count differs from its raw-record mapping.');
        for j = 1:numel(rows)
            i = rows(j);
            assert(scatterHandle.XData(j) == R.salinity(i) ...
                && scatterHandle.YData(j) == R.temperature(i) ...
                && scatterHandle.CData(j) == R.pressure(i), ...
                'astra_argo_trial:ScatterValues','Native graphics and raw values must agree exactly.');
        end
        graphicalMap{p} = struct('Scatter',scatterHandle,'ProfileID',profileIDs(p), ...
            'RawRecordRows',rows,'ObservationID',R.ObservationID(rows), ...
            'SourceRow',R.SourceRow(rows),'SourceFileRow',R.SourceFileRow(rows));
        scatterHandle.UserData = struct('OriginalUserData',scatterHandle.UserData, ...
            'RecordMapping',graphicalMap{p},'RawRecordsField',"result.RawRecords");
        scatterHandle.SizeData = 14;
        if isprop(scatterHandle,'DataTipTemplate')
            scatterHandle.DataTipTemplate.FontName = theme.FontName;
            scatterHandle.DataTipTemplate.Interpreter = 'none';
        end
    end
    drawnow;
    result = struct();
    result.RawRecords = R;
    result.SourceDeclarations = sources;
    result.SourceDeclarationTextPolicy = "Original source structures and all string values retained without paraphrase";
    result.RawJSONText = rawText;
    result.OriginalDataInfo = dataInfo;
    result.OriginalData = sourceData;
    result.VerticalSamplingSchemeText = samplingStatements;
    result.HelperResult = helperResult;
    result.Figure = figureHandle;
    result.GraphicsRecordMap = graphicalMap;
    result.DisplayPermutation = R.SourceFileRow;
    result.IDDerivation = "Local derived ID: original profile ID + ':layer:' + four-digit one-based original layer row";
    result.SourceRowOrigin = "One-based layer row within each original profile; SourceFileRow is original concatenation 067/066/065";
    result.QC = struct('Status',"present",'VariableOrder', ...
        ["pressure" "temperature" "salinity"],'AcceptedMask',qcAccepted, ...
        'MissingMask',missing,'InvalidMask',false(N,3),'SuspectMask',false(N,3), ...
        'Policy',"All three source QC flags must equal 1; original flags retained in RawRecords", ...
        'FlagMeaning',"1 interpreted as Argo good; archive has no flag dictionary; upstream QC not independently verified");
    result.Uncertainty = struct('Status',"not_provided",'pressure',"not_provided", ...
        'temperature',"not_provided",'salinity',"not_provided");
    result.Statistics = record_statistics(R,profileIDs);
    result.scientific_data_contract = scientific;
    result.publication_contract = publication;
    result.Font = struct('Selected',theme.FontName,'ExactFamilyCheck',true, ...
        'Policy',"oi_ocean_theme then oi_font_available; CJK preference starts with WenQuanYi Zen Hei", ...
        'GlyphValidation',"pending",'EmbeddingValidation',"pending");
    result.InputSnapshot = struct('SHA256',inputHash,'Binding',"hash checked during this function invocation", ...
        'UpstreamAuthenticity',"not_verified",'SnapshotID',"argo-4903822-" + extractBefore(inputHash,13));
    result.Runtime = struct('MATLABRelease',string(version('-release')), ...
        'HelperNames',required,'HelperPaths',helperPaths,'Product',"MATLAB", ...
        'AdditionalToolboxes',strings(0,1),'ConstructionReachedReturn',true, ...
        'Export',"pending",'NativeReaderAudit',"pending",'Visual',"pending", ...
        'DesktopInteraction',"pending",'HeadlessExport',"pending");
    result.outputContract = struct('source',"astra_argo_trial.m", ...
        'report_id',"astra-argo-round24",'manifest_draft',"astra-argo-round24-figures.json", ...
        'final_manifest_binding',"pending_service_response",'runtime_status',"ready", ...
        'execution_verified',false,'artifact_validation',"pending",'visual_inspection',"pending", ...
        'complete',false,'exports',[],'warnings', ...
        ["Construction assertions do not replace driver execution evidence or visual review"; ...
         "No uncertainty supplied; helper internal defaults are not measurements"; ...
         "TemperatureType remains unspecified to retain degree_Celsius without helper unit coercion"; ...
         "R2021a helper native tips expose only X/Y; all-record metadata remains in UserData and offline HTML"; ...
         "Archive source-prefix conflict remains for future service source-missing review"], ...
        'errors',[]);
catch exception
    if isgraphics(figureHandle)
        delete(figureHandle);
    end
    rethrow(exception);
end
end

function values = text_sequence(input)
assert(iscell(input) || isstring(input),'astra_argo_trial:DataInfo', ...
    'Expected a JSON text sequence.');
values = strings(numel(input),1);
for i = 1:numel(input)
    if iscell(input)
        value = input{i};
    else
        value = input(i);
    end
    assert(ischar(value) || (isstring(value) && isscalar(value)), ...
        'astra_argo_trial:DataInfo','Metadata names must be text.');
    values(i) = string(value);
end
end

function value = metadata_entry(metadata,row,column)
% jsondecode can retain heterogeneous nested rows as cells or a cell matrix.
assert(iscell(metadata),'astra_argo_trial:DataInfo','Expected metadata cell storage.');
if isequal(size(metadata),[6 2])
    value = metadata{row,column};
elseif isvector(metadata) && numel(metadata) == 6
    pair = metadata{row};
    assert(numel(pair) == 2,'astra_argo_trial:DataInfo','Each metadata pair has two entries.');
    if iscell(pair)
        value = pair{column};
    else
        value = pair(column);
    end
else
    error('astra_argo_trial:DataInfo','Unrecognized data_info metadata shape; no reordering is allowed.');
end
end

function yes = is_json_null(value)
yes = isempty(value) || (isnumeric(value) && isscalar(value) && isnan(value));
end

function contract = scientific_contract(counts,profileIDs,R,inputHash)
contract = struct();
contract.requireScientificContract = true;
contract.shape = {[6 counts(1)],[6 counts(2)],[6 counts(3)]};
contract.dimensionOrder = ["variable" "layer"];
contract.observationDimension = "layer";
contract.dataType = "double (raw numeric arrays); table RawRecords; datetime Time";
contract.rawProfileOrder = profileIDs;
contract.variableOrder = ["pressure" "pressure_argoqc" "salinity" ...
    "salinity_argoqc" "temperature" "temperature_argoqc"];
contract.recordCount = height(R);
contract.time = struct('TimeZone',"UTC",'order', ...
    "Descending profile blocks, repeated per layer; three unique profile instants; not a time series");
contract.longitude = struct('unit',"degrees_east",'convention',"[-180,180]", ...
    'order',"GeoJSON longitude then latitude, original profile order");
contract.latitude = struct('unit',"degrees_north",'order',"original profile order");
contract.pressure = struct('type',"pressure",'unit',"decibar", ...
    'positiveDirection',"increasing source pressure; no depth conversion", ...
    'reference',"not provided in archive",'order',"strictly increasing original layer order per profile");
contract.variables = struct('pressure',"decibar",'temperature',"degree_Celsius",'salinity',"psu");
contract.quantityTypes = struct('temperature',"unspecified in source",'salinity',"unspecified in source");
contract.unitConversions = [];
contract.missing = struct('status',"absent",'representation',"none in frozen arrays; unexpected nonfinite input rejected");
contract.qc = struct('status',"present",'alignment',"layer", ...
    'variables',["pressure_argoqc" "temperature_argoqc" "salinity_argoqc"], ...
    'observedFlag',1,'meaning',"interpreted as Argo good; not independently revalidated", ...
    'accepted',1,'observedSuspect',[],'observedRejected',[], ...
    'masks',"result.QC.MissingMask, InvalidMask, SuspectMask, AcceptedMask");
contract.uncertainty = struct('status',"absent",'availability',"not_provided");
contract.mode = "A in all three original quantity metadata entries; retained without reprocessing";
contract.processing = "No sorting, smoothing, interpolation, coordinate reversal, density calculation or unit conversion";
contract.plot_data_evidence = struct('status',"not_verified",'input_sha256',inputHash, ...
    'scope',"Construction assertions only; independent native-array/driver audit pending");
end

function contract = publication_contract()
contract = struct();
contract.requirePublicationContract = true;
contract.target = struct('medium',"minimal report component",'size',[8 5], ...
    'unit',"inches",'plannedDPI',300,'plannedFormats',["png" "pdf"], ...
    'exportsPerformedBy',"future coordinating driver");
contract.layout = struct('type',"single-axes",'readingOrder',"title, plot, colorbar, legend", ...
    'axesOuterPosition',[0.035 0.18 0.91 0.77], ...
    'legendPosition',[0.07 0.035 0.84 0.055],'colorbar',"eastoutside", ...
    'explicitHandles',true,'geometryVerified',false);
contract.typography = struct('fontPolicy',"oi_ocean_theme with oi_font_available", ...
    'CJKFirstCandidate',"WenQuanYi Zen Hei",'tickPoints',10,'labelPoints',11, ...
    'titlePoints',13,'legendPoints',9,'axesLineWidthPoints',0.9,'Interpreter',"none");
contract.color = struct('category',"sequential", ...
    'source',"Local 256-entry linear RGB ramp [0.05 0.20 0.28] to [0.78 0.88 0.62]", ...
    'background',"white",'missingAppearance',"omitted complete tuples; none missing in input", ...
    'redundantEncoding',"profile circle/square/triangle plus labels; pressure numerals in point view", ...
    'minimumContrast',4.5,'contrastCheck',"pending",'grayscale',"pending",'colorVision',"pending");
contract.clipping = struct('drawnowRequired',true,'bounds',"pending", ...
    'perFormatGlyphs',"pending",'overlap',"pending");
contract.accessibility = struct('title',"Argo 4903822 temperature-salinity relationship", ...
    'description',"1785 original layers, three profiles, pressure color; no density or uncertainty", ...
    'offlinePointHTML',"astra-argo-round24-points.html",'validation',"pending");
contract.interaction = struct('nativeMode',"static create; no desktop callbacks enabled", ...
    'desktopVerified',false,'offlineHTML',"all original records; hover and keyboard focus");
contract.headless = struct('visible',"off",'entry',"caller MATLAB -batch", ...
    'exportInFunction',false,'exportApis',struct( ...
    'R2021a',struct('png',"print -dpng",'pdf',"print -dpdf"), ...
    'R2024b',struct('png',"print -dpng",'pdf',"print -dpdf"), ...
    'R2026a',struct('png',"exportgraphics inches/off",'pdf',"exportgraphics inches/on")));
end

function stats = record_statistics(R,profileIDs)
stats = struct('RawLayerCount',height(R),'ProfileCount',numel(profileIDs), ...
    'PlatformCount',numel(unique(R.PlatformID)),'Uncertainty',"not_provided");
names = ["pressure" "temperature" "salinity"];
for k = 1:numel(names)
    values = R.(names(k));
    stats.(names(k)) = struct('FiniteCount',sum(isfinite(values)), ...
        'Minimum',min(values),'Maximum',max(values),'UnweightedLayerMean',mean(values));
end
stats.PerProfile = cell(numel(profileIDs),1);
for p = 1:numel(profileIDs)
    part = R(R.ProfileIndex == p,:);
    item = struct('ProfileID',profileIDs(p),'LayerCount',height(part));
    for k = 1:numel(names)
        values = part.(names(k));
        item.(names(k)) = struct('Minimum',min(values),'Maximum',max(values), ...
            'UnweightedLayerMean',mean(values));
    end
    stats.PerProfile{p} = item;
end
stats.MeanLimitation = "Unequal source pressure sampling; layer means are not pressure/volume weighted or temporal trends";
end
