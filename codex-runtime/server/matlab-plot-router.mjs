import {
  assertMatlabTaskRequestShape,
  buildMatlabPublicationContract,
  routeMatlabTask,
  selectMatlabAuditedExportStrategy,
} from './matlab-task-routing-contract.mjs';
import {
  MATLAB_RELEASE_CAPABILITY_MATRIX,
  compareMatlabReleases,
  normalizeMatlabRelease,
  selectMatlabApi,
  selectMatlabRuntimeValidationLane,
} from './matlab-release-capabilities.mjs';

export const MATLAB_PLOT_ROUTER_SCHEMA_VERSION = 5;

const AUDITED_GENERATOR_MINIMUM_RELEASE = 'R2019b';
const MATLAB_VERSION_BY_RELEASE = Object.freeze({
  R2019b: '9.7', R2020a: '9.8', R2020b: '9.9', R2021a: '9.10', R2021b: '9.11',
  R2022a: '9.12', R2022b: '9.13', R2023a: '9.14', R2023b: '23.2', R2024a: '24.1',
  R2024b: '24.2', R2025a: '25.1', R2025b: '25.2', R2026a: '26.1',
});

const PLOT_DEFINITIONS = Object.freeze({
  'time-series': definition('plot', 'inline MATLAB time series', 'ordered time evolution'),
  'uncertainty-series': definition('errorbar', 'inline MATLAB uncertainty series', 'time evolution with stated uncertainty'),
  profile: definition('oi_plot_profile', 'oi_plot_profile.m', 'one or more variables against positive-down depth or pressure'),
  section: definition('oi_plot_section', 'oi_plot_section.m', 'gridded horizontal-distance/depth section'),
  hovmoller: definition('oi_plot_hovmoller', 'oi_plot_hovmoller.m', 'gridded time/depth evolution'),
  'geospatial-field': definition('surface/view(2)', 'inline MATLAB geospatial field', 'longitude/latitude scalar field without implied projection'),
  'vector-field': definition('oi_plot_vector_field', 'oi_plot_vector_field.m', 'paired horizontal vector components'),
  'scalar-field': definition('surface/view(2)', 'inline MATLAB scalar field', 'validated two-dimensional scalar field'),
  comparison: definition('oi_plot_comparison', 'oi_plot_comparison.m', 'observation-model or instrument-instrument agreement'),
  relationship: definition('scatter', 'inline MATLAB relationship', 'paired relationship without an ordering coordinate'),
  'ts-diagram': definition('oi_plot_ts_diagram', 'oi_plot_ts_diagram.m', 'temperature-salinity water-mass relationship'),
  spectrum: definition('oi_plot_spectrum', 'oi_plot_spectrum.m', 'precomputed positive-frequency spectral density'),
  'direction-rose': definition('oi_plot_direction_rose', 'oi_plot_direction_rose.m', 'wrapped directional distribution'),
  distribution: definition('histogram', 'inline MATLAB distribution', 'univariate distribution'),
  'grouped-distribution': definition('boxchart', 'inline MATLAB grouped distribution', 'distribution comparison across explicit groups'),
  categorical: definition('bar', 'inline MATLAB categorical chart', 'categorical magnitudes or counts'),
  surface: definition('surf', 'inline MATLAB surface', 'scientifically required three-dimensional surface'),
});

const QUESTION_ALIASES = Object.freeze({
  trend: 'time-series', timeseries: 'time-series', 'time-series': 'time-series', temporal: 'time-series',
  '时间趋势': 'time-series', '时间序列': 'time-series', '时序': 'time-series',
  uncertainty: 'uncertainty-series', 'uncertainty-series': 'uncertainty-series', confidence: 'uncertainty-series',
  '不确定度': 'uncertainty-series', '不确定性': 'uncertainty-series', '置信区间': 'uncertainty-series',
  profile: 'profile', vertical: 'profile', 'depth-profile': 'profile',
  '垂向剖面': 'profile', '深度剖面': 'profile',
  section: 'section', transect: 'section', crosssection: 'section', 'cross-section': 'section',
  '断面': 'section', '海洋断面': 'section',
  hovmoller: 'hovmoller', 'time-depth': 'hovmoller', time_depth: 'hovmoller',
  '霍夫穆勒': 'hovmoller', '时间深度': 'hovmoller', '时深图': 'hovmoller',
  map: 'geospatial-field', spatial: 'geospatial-field', geospatial: 'geospatial-field', 'geospatial-field': 'geospatial-field',
  '地图': 'geospatial-field', '空间分布': 'geospatial-field', '经纬度场': 'geospatial-field',
  vector: 'vector-field', 'vector-field': 'vector-field', current: 'vector-field', wind: 'vector-field',
  '矢量场': 'vector-field', '流场': 'vector-field', '风场': 'vector-field',
  field: 'scalar-field', heatmap: 'scalar-field', contour: 'scalar-field', 'scalar-field': 'scalar-field',
  '标量场': 'scalar-field', '二维场': 'scalar-field',
  comparison: 'comparison', agreement: 'comparison', validation: 'comparison',
  '对比': 'comparison', '一致性': 'comparison', '验证': 'comparison',
  relationship: 'relationship', correlation: 'relationship', scatter: 'relationship',
  '关系': 'relationship', '相关关系': 'relationship',
  'ts-diagram': 'ts-diagram', ts: 'ts-diagram', 'temperature-salinity': 'ts-diagram',
  '温盐图': 'ts-diagram', '温盐关系': 'ts-diagram',
  spectrum: 'spectrum', spectral: 'spectrum', frequency: 'spectrum',
  '频谱': 'spectrum', '谱分析': 'spectrum',
  direction: 'direction-rose', rose: 'direction-rose', 'direction-rose': 'direction-rose',
  '方向玫瑰图': 'direction-rose', '玫瑰图': 'direction-rose',
  distribution: 'distribution', histogram: 'distribution',
  '分布': 'distribution', '直方图': 'distribution',
  'grouped-distribution': 'grouped-distribution', groups: 'grouped-distribution', boxplot: 'grouped-distribution',
  '分组分布': 'grouped-distribution', '箱线图': 'grouped-distribution',
  categorical: 'categorical', category: 'categorical',
  '分类': 'categorical', '类别': 'categorical',
  surface: 'surface', '3d-surface': 'surface',
  '三维表面': 'surface', '表面': 'surface',
});

const COORDINATE_ALIASES = Object.freeze({
  time: Object.freeze(['time', 'datetime', 'date', '时间', '日期']),
  depth: Object.freeze(['depth', 'pressure', 'vertical', '深度', '压力', '垂向']),
  longitude: Object.freeze(['longitude', 'lon', 'x-longitude', '经度']),
  latitude: Object.freeze(['latitude', 'lat', 'y-latitude', '纬度']),
  distance: Object.freeze(['distance', 'station', 'transect', '距离', '站位', '断面距离']),
  category: Object.freeze(['category', 'group', 'categorical', '类别', '分组']),
});

const COORDINATE_METADATA_KEYS = new Set(['names', 'timezone', 'directions', 'vertical', 'longitudeconvention']);

export function routeMatlabPlot(input = {}) {
  assertMatlabTaskRequestShape(input);
  return buildMatlabPlotRoute(normalizeSpec(input));
}

function buildMatlabPlotRoute(spec) {
  const plotType = selectPlotType(spec);
  validateRoute(spec, plotType);
  const definitionValue = selectedDefinition(spec, plotType);
  const layoutApi = selectMatlabApi(spec.targetRelease, 'tiledlayout');
  const exportApi = selectMatlabApi(spec.targetRelease, 'exportgraphics');
  const colorLimitApi = selectMatlabApi(spec.targetRelease, 'clim');
  const exportFormats = Object.fromEntries(spec.publication.target.formats.map((format) => [
    format,
    selectMatlabAuditedExportStrategy(spec.targetRelease, format),
  ]));
  const runtimeValidation = selectMatlabRuntimeValidationLane(spec.targetRelease);
  const route = {
    schemaVersion: MATLAB_PLOT_ROUTER_SCHEMA_VERSION,
    runtime: 'matlab',
    targetRelease: spec.targetRelease,
    plotType,
    interactive: spec.interactive,
    helper: definitionValue.helper,
    template: definitionValue.template,
    rationale: buildRationale(spec, plotType, definitionValue.purpose),
    selectionReason: buildSelectionReason(spec, plotType),
    inputContract: buildInputContract(spec, plotType),
    unitPolicy: buildUnitPolicy(spec, plotType),
    axisPolicy: buildAxisPolicy(spec, plotType),
    missingPolicy: buildMissingPolicy(spec, plotType),
    qcPolicy: buildQcPolicy(spec),
    colorPolicy: buildColorPolicy(spec, plotType),
    publicationPolicy: spec.publication,
    accessibilityPolicy: buildAccessibilityPolicy(spec, plotType),
    interactionPolicy: buildInteractionPolicy(spec),
    apiPlan: {
      layout: layoutApi,
      export: exportApi,
      exportSizing: selectMatlabApi(spec.targetRelease, 'exportgraphicsSizing'),
      exportFormats,
      colorLimits: colorLimitApi,
      runtimeValidation,
    },
    prohibitedTransforms: ['silent sort', 'silent squeeze/transpose', 'silent interpolation', 'silent smoothing', 'NaN-to-zero replacement'],
  };
  route.unresolvedRequirements = unresolvedRequirements(spec, plotType);
  route.readyForGeneration = route.unresolvedRequirements.length === 0;
  if (spec.strictMetadata && !route.readyForGeneration) {
    throw new Error(`MATLAB plot contract is incomplete: ${route.unresolvedRequirements.join(', ')}.`);
  }
  return deepFreeze(route);
}

export function resolveMatlabPlotRequest(input = {}) {
  try {
    assertMatlabTaskRequestShape(input);
  } catch {
    const rejected = routeMatlabTask(input);
    return deepFreeze({ schemaVersion: MATLAB_PLOT_ROUTER_SCHEMA_VERSION, status: rejected.status, ready: false,
      taskRoute: rejected, plotRoute: null, script: null, error: rejected.error });
  }
  let taskInput;
  try {
    taskInput = buildTaskRoutingInput(input);
  } catch (error) {
    return invalidPlotResolution(error, null);
  }
  let preflight;
  try {
    preflight = routeMatlabTask(taskInput);
  } catch (error) {
    return deepFreeze({
      schemaVersion: MATLAB_PLOT_ROUTER_SCHEMA_VERSION,
      status: 'invalid-task-contract',
      ready: false,
      taskRoute: null,
      plotRoute: null,
      script: null,
      error: {
        code: 'MATLAB_TASK_CONTRACT_INVALID',
        reason: String(error?.message || error),
        nextAction: 'Use a supported MATLAB task type before plot routing.',
      },
    });
  }
  if (!preflight.ready) {
    return deepFreeze({ schemaVersion: MATLAB_PLOT_ROUTER_SCHEMA_VERSION, status: preflight.status, ready: false,
      taskRoute: preflight, plotRoute: null, script: null, error: preflight.error });
  }
  let spec;
  let plotRoute;
  try {
    spec = normalizeSpec(input);
    plotRoute = buildMatlabPlotRoute(spec);
  } catch (error) {
    return invalidPlotResolution(error, preflight);
  }
  const taskRoute = plotRoute.readyForGeneration
    ? preflight
    : routeMatlabTask({ ...taskInput, unresolvedRequirements: plotRoute.unresolvedRequirements });
  if (!taskRoute.ready) {
    return deepFreeze({ schemaVersion: MATLAB_PLOT_ROUTER_SCHEMA_VERSION, status: taskRoute.status, ready: false,
      taskRoute, plotRoute, script: null, error: taskRoute.error });
  }
  return deepFreeze({
    schemaVersion: MATLAB_PLOT_ROUTER_SCHEMA_VERSION,
    status: 'ready',
    ready: true,
    taskRoute,
    plotRoute,
    script: buildMatlabPlotScript(taskRoute, spec, plotRoute),
    error: null,
  });
}

export function generateMatlabPlotScript(input = {}) {
  const taskRoute = requireReadyMatlabTaskRoute(input);
  const spec = normalizeSpec({ ...input, strictMetadata: true });
  const route = buildMatlabPlotRoute(spec);
  return buildMatlabPlotScript(taskRoute, spec, route);
}

function buildMatlabPlotScript(taskRoute, spec, route) {
  const scientificDataContract = buildManifestScientificDataContract(taskRoute, spec);
  const names = variableNames(spec, route.plotType);
  assertUniqueVariableNames(names.arguments);
  const labels = plotLabels(spec, route.plotType);
  const interactiveSeries = spec.interactive && ['time-series', 'uncertainty-series'].includes(route.plotType);
  const setupLines = [
    ...themeAndFontLines(spec),
    ...(interactiveSeries ? [] : staticFigureLines(spec)),
  ];
  const lines = [
    `function result = ${spec.functionName}(${names.arguments.join(', ')})`,
    `% Generated deterministically by MATLAB plot router schema ${MATLAB_PLOT_ROUTER_SCHEMA_VERSION}.`,
    `% Selection reason: ${matlabComment(route.rationale)}`,
    `% Units preserved: ${matlabComment(JSON.stringify(route.unitPolicy.units))}`,
    `% Missing-data status: ${spec.missingStatus}.`,
    `% QC status: ${spec.qc.status}; policy: ${spec.qc.action}.`,
    `% Publication target: ${spec.publication.target.width} ${spec.publication.target.units} x ${spec.publication.target.height} ${spec.publication.target.units} at ${spec.dpi} DPI.`,
    `% Output formats: ${spec.publication.target.formats.join(', ')}; release-aware APIs: ${Object.entries(route.apiPlan.exportFormats).map(([format, plan]) => `${format}=${plan.api}`).join(', ')}.`,
    `% Artifact checks pending: glyph rendering, clipping/overlap, grayscale, color-vision simulation, and PDF font embedding.`,
    ...(route.plotType === 'geospatial-field' ? [`% Longitude convention: ${spec.longitudeConvention}; dateline policy: ${spec.datelinePolicy}.`] : []),
    ...(route.plotType === 'uncertainty-series'
      ? [`% Uncertainty semantics: ${spec.uncertaintyType}; representation: ${spec.uncertaintyRepresentation}; confidence level: ${spec.confidenceLevel ?? 'not-applicable'}.`]
      : []),
    `assert(~exist('OCTAVE_VERSION', 'builtin'), 'plot:MatlabRequired', 'MATLAB is the authoritative runtime.');`,
    ...runtimePreflightLines(spec, taskRoute),
    `outputDirectory = ${matlabString(spec.outputDirectory)};`,
    `if ~isfolder(outputDirectory), mkdir(outputDirectory); end`,
    `assetDirectory = ${matlabString(spec.assetDirectory)};`,
    `assert(isfolder(assetDirectory), 'plot:MissingAssets', 'MATLAB assetDirectory does not exist.');`,
    `addpath(assetDirectory);`,
    `assert(exist('oi_export_figure', 'file') == 2 && exist('oi_write_manifest', 'file') == 2, ...`,
    `  'plot:MissingAssets', 'Required MATLAB export/manifest assets are unavailable.');`,
    ...(interactiveSeries ? [`assert(exist('interactive_timeseries_native_template', 'file') == 2, 'plot:MissingAssets', 'Interactive MATLAB template is unavailable.');`] : []),
    ...setupLines,
    ...validationLines(spec, route.plotType, names),
    ...declaredShapeLines(spec, route.plotType, names),
    ...missingStatusLines(spec, route.plotType, names),
    ...qcValidationLines(spec, route.plotType, names),
    ...plotLines(spec, route.plotType, names),
    ...(interactiveSeries ? [`cleanupFigure = onCleanup(@() close(figureHandle));`] : []),
    `setappdata(figureHandle, 'OI_OceanTheme', theme);`,
    `axesHandle = plotResult.Axes;`,
    ...accessibilityEnhancementLines(spec, route.plotType, names),
    ...labelLines(labels, route.plotType, interactiveSeries ? '' : spec.title),
    `oi_apply_axes(axesHandle, theme);`,
    ...typographyLines(spec),
    ...(interactiveSeries ? [`interactionPlot.Layout.Title.FontSize = theme.TitleSize;`] : []),
    `drawnow;`,
    ...runtimeLayoutAuditLines(spec),
    `exportEntry = oi_export_figure(figureHandle, outputDirectory, ${matlabString(spec.figureId)}, publicationWidthPixels, publicationHeightPixels, publicationDpi, ...`,
    `  'Title', ${matlabString(spec.title)}, 'Source', ${matlabString(spec.source)}, 'Theme', 'Ocean Intelligence MATLAB', ...`,
    `  'ExportSVG', ${spec.publication.target.formats.includes('svg') ? 'true' : 'false'}, 'RequiredToolboxes', requiredToolboxLabels);`,
    ...runtimeManifestLines(spec, taskRoute, route),
    ...publicationManifestLines(spec, route.plotType),
    `scientificDataContract = jsondecode(${matlabString(JSON.stringify(scientificDataContract))});`,
    `scientificDataContract.missing.total_count = numel(${primaryValueName(route.plotType, names.arguments)});`,
    `scientificDataContract.missing.valid_count = plotResult.ValidCount;`,
    `scientificDataContract.missing.missing_count = plotResult.MissingCount;`,
    `scientificDataContract.missing.masked_count = 0;`,
    ...(spec.qc.status === 'present' ? [
      `scientificDataContract.qc.accepted_count = sum(qcAcceptedMask, 'all');`,
      `scientificDataContract.qc.suspect_count = sum(qcSuspectMask, 'all');`,
      `scientificDataContract.qc.rejected_count = sum(qcRejectedMask, 'all');`,
    ] : []),
    `exportEntry.scientific_data_contract = scientificDataContract;`,
    `manifest = oi_write_manifest(fullfile(outputDirectory, 'figures.json'), exportEntry);`,
    `result = struct('route', ${matlabString(route.plotType)}, 'helper', ${matlabString(route.helper)}, ...`,
    `  'valid_count', plotResult.ValidCount, 'missing_count', plotResult.MissingCount, ...`,
    `  'qc', ${qcResultExpression(spec)}, ...`,
    `  'runtime', exportEntry.runtime, 'export_contract', exportEntry.export_contract, ...`,
    `  'publication', exportEntry.publication, 'accessibility', exportEntry.accessibility, ...`,
    `  'interaction', exportEntry.interaction, ...`,
    `  'exports', exportEntry.exports, 'manifest', manifest);`,
    `end`,
  ];
  return `${lines.join('\n')}\n`;
}

function requireReadyMatlabTaskRoute(input) {
  const taskRoute = routeMatlabTask(buildTaskRoutingInput(input));
  if (!taskRoute.ready) {
    const reason = taskRoute.error?.reason || `MATLAB task status is ${taskRoute.status}.`;
    throw new Error(`MATLAB task preflight failed (${taskRoute.status}): ${reason}`);
  }
  return taskRoute;
}

function invalidPlotResolution(error, taskRoute) {
  return deepFreeze({
    schemaVersion: MATLAB_PLOT_ROUTER_SCHEMA_VERSION,
    status: 'invalid-plot-contract',
    ready: false,
    taskRoute,
    plotRoute: null,
    script: null,
    error: {
      code: 'MATLAB_PLOT_CONTRACT_INVALID',
      reason: String(error?.message || error),
      nextAction: 'Correct the scientific question, coordinates, dimensions, or metadata before generation.',
    },
  });
}

function buildTaskRoutingInput(input) {
  assertMatlabTaskRequestShape(input);
  const taskInput = { ...input };
  taskInput.requestedCapabilities = [...new Set([
    ...(input.requestedCapabilities?.length
      ? input.requestedCapabilities : Object.keys(MATLAB_RELEASE_CAPABILITY_MATRIX.capabilities)),
    'auditedFigureManifest',
  ])];
  delete taskInput.unresolvedRequirements;
  const nestedFields = ['dataContract', 'scientificDataContract', 'scientificData'];
  let hasNestedContract = false;
  for (const field of nestedFields) {
    if (!objectValue(taskInput[field])) continue;
    taskInput[field] = canonicalScientificDataInputIfValid(taskInput[field]);
    hasNestedContract = true;
  }
  return hasNestedContract ? taskInput : canonicalScientificDataInputIfValid(taskInput);
}

function canonicalScientificDataInputIfValid(source) {
  try {
    return canonicalScientificDataInput(source);
  } catch {
    return source;
  }
}

function canonicalScientificDataInput(source) {
  const coordinateValue = source.coordinates ?? source.axes;
  if (coordinateValue === undefined || coordinateValue === null) return source;
  const coordinateSource = objectValue(coordinateValue) || {};
  const directions = objectValue(source.coordinateDirections ?? source.directions ?? coordinateSource.directions) || {};
  const vertical = objectValue(directions.vertical ?? source.vertical ?? coordinateSource.vertical) || {};
  const dimensionOrderValue = source.dimensionOrder ?? source.dimensionsOrder;
  const observationDimension = normalizeDimensionName(source.observationDimension ?? source.observationAxis, 'observationDimension');
  const timeZone = cleanSingleLine(source.timeZone || source.timezone || coordinateSource.timeZone || coordinateSource.timezone, '');
  const longitudeConvention = cleanSingleLine(source.longitudeConvention || directions.longitudeConvention || coordinateSource.longitudeConvention, '');
  const verticalCoordinate = normalizeToken(vertical.coordinate || source.verticalCoordinate || source.verticalCoordinateType || '');
  const verticalPositive = normalizeToken(vertical.positive || source.verticalPositive || source.positiveDirection || '');
  const verticalReference = cleanSingleLine(vertical.reference || source.verticalReference, '');
  const canonicalDirections = {
    ...(normalizeToken(directions.time || source.timeDirection || '') ? { time: normalizeToken(directions.time || source.timeDirection) } : {}),
    ...(normalizeToken(directions.latitude || source.latitudeDirection || source.latitudeOrder || '')
      ? { latitude: normalizeToken(directions.latitude || source.latitudeDirection || source.latitudeOrder) } : {}),
    ...(normalizeToken(directions.longitude || source.longitudeDirection || source.longitudeOrder || '')
      ? { longitude: normalizeToken(directions.longitude || source.longitudeDirection || source.longitudeOrder) } : {}),
    ...(longitudeConvention ? { longitudeConvention } : {}),
    ...((verticalCoordinate || verticalPositive || verticalReference) ? {
      vertical: {
        ...(verticalCoordinate ? { coordinate: verticalCoordinate } : {}),
        ...(verticalPositive ? { positive: verticalPositive } : {}),
        ...(verticalReference ? { reference: verticalReference } : {}),
      },
    } : {}),
  };
  const qc = objectValue(source.qc);
  const uncertainty = objectValue(source.uncertainty);
  return {
    ...source,
    coordinates: coordinateNames(normalizeCoordinates(coordinateValue)),
    ...(dimensionOrderValue !== undefined ? { dimensionOrder: normalizeDimensionOrder(dimensionOrderValue) } : {}),
    ...(observationDimension ? { observationDimension } : {}),
    ...(Object.keys(canonicalDirections).length ? { coordinateDirections: canonicalDirections } : {}),
    ...(timeZone ? { timeZone } : {}),
    ...(longitudeConvention ? { longitudeConvention } : {}),
    ...(verticalCoordinate ? { verticalCoordinate } : {}),
    ...(verticalPositive ? { verticalPositive } : {}),
    ...(verticalReference ? { verticalReference } : {}),
    ...(source.qcAlignment !== undefined ? { qcAlignment: normalizeDimensionName(source.qcAlignment, 'qcAlignment') } : {}),
    ...(source.uncertaintyAlignment !== undefined
      ? { uncertaintyAlignment: normalizeDimensionName(source.uncertaintyAlignment, 'uncertaintyAlignment') } : {}),
    ...(qc ? { qc: { ...qc, ...(qc.alignment !== undefined ? { alignment: normalizeDimensionName(qc.alignment, 'qc.alignment') } : {}) } } : {}),
    ...(uncertainty ? {
      uncertainty: {
        ...uncertainty,
        ...(uncertainty.alignment !== undefined
          ? { alignment: normalizeDimensionName(uncertainty.alignment, 'uncertainty.alignment') } : {}),
      },
    } : {}),
  };
}

function runtimePreflightLines(spec, taskRoute) {
  const minimumVersion = MATLAB_VERSION_BY_RELEASE[spec.targetRelease];
  if (!minimumVersion) throw new Error(`No MATLAB version mapping exists for ${spec.targetRelease}.`);
  const dependencies = (taskRoute.capabilities?.toolboxDependencies || []).filter((entry) => entry.id !== 'matlab');
  const dependencyIds = dependencies.map((entry) => entry.id);
  const dependencyLabels = dependencies.map((entry) => entry.label);
  const dependencyFeatures = dependencies.map((entry) => entry.licenseFeature || '');
  return [
    `targetMatlabRelease = ${matlabString(spec.targetRelease)};`,
    `targetMatlabVersion = ${matlabString(minimumVersion)};`,
    `assert(~verLessThan('matlab', targetMatlabVersion), 'plot:UnsupportedMatlabRelease', 'This generated script requires MATLAB %s or newer.', targetMatlabRelease);`,
    `actualMatlabVersion = string(version);`,
    `actualMatlabRelease = string(version('-release'));`,
    `requiredToolboxIds = ${matlabStringVector(dependencyIds)};`,
    `requiredToolboxLabels = ${matlabStringVector(dependencyLabels)};`,
    `requiredToolboxLicenseFeatures = ${matlabStringVector(dependencyFeatures)};`,
    ...(dependencies.length ? [
      `installedProducts = ver;`,
      `installedProductNames = string({installedProducts.Name});`,
      `for requiredToolboxIndex = 1:numel(requiredToolboxIds)`,
      `  assert(any(strcmpi(requiredToolboxLabels(requiredToolboxIndex), installedProductNames)), 'plot:MissingToolbox', 'Required MATLAB toolbox is not installed: %s.', requiredToolboxLabels(requiredToolboxIndex));`,
      `  if strlength(requiredToolboxLicenseFeatures(requiredToolboxIndex)) > 0`,
      `    assert(logical(license('test', requiredToolboxLicenseFeatures(requiredToolboxIndex))), 'plot:ToolboxLicenseUnavailable', 'Required MATLAB toolbox license is unavailable: %s.', requiredToolboxLabels(requiredToolboxIndex));`,
      `  end`,
      `end`,
    ] : []),
  ];
}

function runtimeManifestLines(spec, taskRoute, route) {
  const dependencies = (taskRoute.capabilities?.toolboxDependencies || []).filter((entry) => entry.id !== 'matlab');
  const exportContract = {
    targetRelease: spec.targetRelease,
    formats: spec.publication.target.formats,
    strategies: route.apiPlan.exportFormats,
    freshArtifactsRequired: true,
    manifestPath: 'figures.json',
  };
  return [
    `assert(isfield(exportEntry, 'runtime') && isfield(exportEntry.runtime, 'minimum_release') ...`,
    `  && isfield(exportEntry.runtime, 'export_api'), 'plot:RuntimeEvidence', 'Export helper did not return required runtime evidence.');`,
    `exportEntry.runtime.authoritative_runtime = 'MATLAB';`,
    `exportEntry.runtime.target_release = targetMatlabRelease;`,
    `exportEntry.runtime.actual_release = actualMatlabRelease;`,
    `exportEntry.runtime.actual_version = actualMatlabVersion;`,
    `exportEntry.runtime.required_toolbox_ids = requiredToolboxIds;`,
    `exportEntry.runtime.required_toolbox_labels = requiredToolboxLabels;`,
    `exportEntry.runtime.required_toolbox_license_features = requiredToolboxLicenseFeatures;`,
    `exportEntry.runtime.octave_substitution = false;`,
    `exportEntry.export_contract = jsondecode(${matlabString(JSON.stringify(exportContract))});`,
    `exportEntry.export_contract.actual_png_pdf_api = exportEntry.runtime.export_api.png;`,
    ...(spec.publication.target.formats.includes('svg')
      ? [`exportEntry.export_contract.actual_svg_api = exportEntry.runtime.export_api.svg;`]
      : []),
  ];
}

function buildManifestScientificDataContract(taskRoute, spec) {
  const contract = { ...taskRoute.scientificDataContract, provided: true };
  return {
    ...contract,
    missing: { ...contract.missing, policy: 'preserve' },
    qc: { ...contract.qc, action: spec.qc.action },
    uncertainty: {
      ...contract.uncertainty,
      representation: spec.uncertaintyRepresentation || contract.uncertainty.representation,
      confidenceLevel: spec.confidenceLevel ?? contract.uncertainty.confidenceLevel,
      ...(spec.uncertaintyRepresentation === 'bounds' ? {
        lower: cleanSingleLine(spec.variableNames.uncertaintyLower, 'uncertaintyLower'),
        upper: cleanSingleLine(spec.variableNames.uncertaintyUpper, 'uncertaintyUpper'),
      } : {}),
    },
  };
}

export function matlabPlotRoutingInstructionBlock() {
  return String.raw`【MATLAB 智能选图与脚本生成路由】
- 先建立数据契约：类型、原始 size、维度顺序、观测维、坐标、单位、QC、缺测约定和科学问题；不得先画图再猜维度。
- 路由优先级固定：显式科学问题 > 坐标组合 > 数据类型/维数。time+depth 二维场→hovmoller；水平坐标+depth 二维场→section；longitude+latitude 二维场→geospatial-field；u/v 成对分量→vector-field；单变量+depth→profile；单变量+time→time-series；无序成对变量→relationship。
- timetable/datetime 保持原生时间；时间必须非 NaT、严格递增且唯一，并标明 UTC 或来源时区。深度只有在非负且正向下时才设置 YDir='reverse'；压力不得无依据改称深度。
- NaN 保留为线段或面域缺口，Inf 作为非法值拒绝；QC 必须明确 present/absent，存在时提供互斥且完整的 accepted/suspect/rejected 编码并按原样保留、分开统计。不得自动 fillmissing、smooth、sort、squeeze、transpose、插值或把缺测矢量分量置零。
- 二维字段必须验证 Z 与坐标尺寸、规则/曲线/散点网格类型；只有规则等像素网格可直接 imagesc，断面优先 contourf，散点数据必须先获得明确插值方法和掩膜策略。
- 生成脚本必须先通过任务层 MATLAB 可用性、目标 release、工具箱和输出格式预检，再消费 publicationContract 并复用路由给出的真实 helper/template；按声明的 cm/in 物理尺寸与 DPI 换算像素，使用显式 figure/layout/axes 句柄、声明字号线宽、带单位标签、drawnow、同一最终 figure 的 PNG/PDF 基线导出、可选 SVG 和可审计 manifest。单图生成器收到多面板契约时必须拒绝，不得只画第一个面板。
- 本生成器固定调用 oi_export_figure 严格尺寸审计资产，并向任务预检声明 auditedFigureManifest：R2019b-R2024b 的 PNG/PDF/SVG 均使用明确声明的 print 回退（SVG 为 print -dsvg），因为旧版原生 tight 裁切不能保证指定像素和页尺寸；R2025a 起使用 exportgraphics，PNG 使用 Units="pixels"、整数 Width/Height 和 Resolution=dpi，PDF/SVG 使用 Units="inches"、Width=widthPixels/dpi、Height=heightPixels/dpi；两类均保留 Padding="figure" 和 PreserveAspectRatio="on"。R2020a-R2024b 仍有 exportgraphics，缺少的是严格尺寸参数；apiPlan.export 仅说明通用 API 可用性，实际目标策略见 apiPlan.exportFormats 与 headless.exportApis，不改写其他一般路由的通用能力。
- 绘图前的 figure/layout 仍按像素/DPI 设置最终 inches，不把屏幕像素作为输出尺寸。runtime.export_size_units 按实际路径记录：原生 PNG 为 pixels，print PNG 为 inches，PDF 及请求的 SVG 为 inches。不做导出后 resize，不通过重采样、裁切或填边掩盖尺寸错误；本次 PNG 单位策略调整尚待 CI 验证，不得声称尺寸偏差已经修复。
- headless.exportApi 与逐格式 headless.exportApis 必须匹配所选审计路径，不得静默改声明或换格式。exportgraphics 的 exist(file) 返回 2/3/6（含 P-code）或 exist(builtin) 返回 5 均可调用；实际调用路径由资产探测并写入 runtime.export_api，目标策略不能冒充运行证据。脚本必须拒绝旧于 R2019b 的 arguments-based 资产，并在 MATLAB 内核验实际版本和所需工具箱许可证。
- 中文标题或标签使用 oi_font_available，依据 listfonts 或 fc-list 精确安装证据按声明候选链选择 CJK 字体，普通文本使用 Interpreter='none'；无字体时明确失败。运行时字体存在和最终 PNG/PDF 字形、PDF 嵌入是不同证据，未检查产物时必须记录 not-verified。
- 字段必须显式声明 sequential/diverging 色彩语义和 colorLimits；发散色图还须声明 colorReference，并让色限关于该参考对称。禁止 jet/hsv/rainbow；等值线、标记、线型、误差棒或几何方向提供冗余编码，灰度和色觉模拟仍须以最终产物验证。
- 导出前在最终物理尺寸 drawnow，结合源图实测边界与导出器几何证据检查布局，保留未测覆盖；该运行时检查不得冒充 PNG/PDF 裁剪、重叠、中文字形、灰度、色觉或字体嵌入验收。
- interactive 生成必须区分 auto/desktop/headless：desktop 显式要求不可静默降级，auto 无桌面时输出同科学内容的静态图，headless 强制关闭交互；静态 fallback 必须记录 interaction_verified=false。
- 中英文科学问题和坐标名称仅按内置白名单归一化；未知名称、伪布尔坐标、空维名、非安全整数维度和三坐标立方体必须拒绝，立方体须先显式切片或约简。
- 未知科学问题、冲突坐标、未声明单位/时区/垂向类型/不确定度类型/二维维度顺序时不得猜测；路由必须返回 unresolvedRequirements，脚本生成器必须拒绝继续。
- 未明确的 3-D 不得路由到 surf；科学问题确需表面几何时使用原生 surf 并验证维度、坐标与单位，不声称仓库已有 3D 模板。`;
}

function normalizeSpec(input) {
  const nestedContract = objectValue(input.dataContract || input.scientificDataContract || input.scientificData);
  const source = nestedContract ? { ...input, ...nestedContract } : input;
  const coordinateSource = objectValue(source.coordinates) || {};
  const directions = objectValue(source.coordinateDirections ?? source.directions ?? coordinateSource.directions) || {};
  const vertical = objectValue(directions.vertical ?? source.vertical ?? coordinateSource.vertical) || {};
  const missing = objectValue(source.missing) || {};
  const uncertainty = objectValue(source.uncertainty) || {};
  const coordinates = normalizeCoordinateAliases(source.coordinates, source.axes);
  const shape = normalizeShapeAliases(source.shape, source.dimensions);
  const uncertaintyTypeInput = source.uncertaintyType || uncertainty.type || '';
  const uncertaintyType = normalizeUncertaintyType(uncertaintyTypeInput);
  const uncertaintyStatus = normalizePresence(
    uncertainty.status ?? source.uncertaintyStatus ?? source.hasUncertainty ?? (Object.keys(uncertainty).length ? true : undefined),
  );
  const units = normalizeMetadataMap(source.units);
  const uncertaintyUnit = cleanSingleLine(uncertainty.unit || source.uncertaintyUnit, '');
  const targetRelease = normalizeReleaseAliases(input.targetRelease, input.matlabRelease);
  const publicationContract = buildMatlabPublicationContract(input);
  const publication = effectivePublicationPolicy(input, source, publicationContract, targetRelease);
  return {
    dataType: normalizeToken(source.dataType || source.type || 'numeric'),
    shape,
    rank: normalizeRank(source.rank, shape),
    observationDimension: normalizeDimensionName(source.observationDimension ?? source.observationAxis, 'observationDimension'),
    question: normalizeQuestionAliases(source.scientificQuestion, source.question),
    coordinates,
    coordinateDirections: Object.freeze({
      time: normalizeToken(directions.time || source.timeDirection || ''),
      latitude: normalizeToken(directions.latitude || source.latitudeDirection || source.latitudeOrder || ''),
      longitude: normalizeToken(directions.longitude || source.longitudeDirection || source.longitudeOrder || ''),
    }),
    gridType: normalizeToken(source.gridType || ''),
    dimensionOrder: normalizeDimensionOrderAliases(source.dimensionOrder, source.dimensionsOrder),
    missingStatus: normalizePresence(missing.status ?? source.missingStatus ?? source.hasMissing ?? source.missing),
    missingRepresentation: normalizeToken(missing.representation || source.missingRepresentation || ''),
    uncertainty: uncertaintyStatus === 'present' || source.hasUncertainty === true,
    uncertaintyStatus,
    uncertaintyType,
    uncertaintyRepresentation: normalizeUncertaintyRepresentation(
      source.uncertaintyRepresentation || uncertainty.representation,
      uncertaintyType,
    ),
    confidenceLevel: normalizeConfidenceLevel(source.confidenceLevel ?? uncertainty.confidenceLevel, uncertaintyTypeInput),
    uncertaintyAlignment: normalizeDimensionName(uncertainty.alignment ?? source.uncertaintyAlignment, 'uncertaintyAlignment'),
    qc: normalizeQcContract(source),
    timeZone: cleanSingleLine(source.timeZone || source.timezone || coordinateSource.timeZone || coordinateSource.timezone, ''),
    verticalCoordinate: normalizeToken(vertical.coordinate || source.verticalCoordinate || source.verticalCoordinateType || ''),
    verticalPositive: normalizeToken(vertical.positive || source.verticalPositive || source.positiveDirection || ''),
    verticalReference: cleanSingleLine(vertical.reference || source.verticalReference, ''),
    units: uncertaintyUnit && !units.uncertainty ? Object.freeze({ ...units, uncertainty: uncertaintyUnit }) : units,
    quantities: normalizeMetadataMap(source.quantities ?? source.quantityNames),
    interpolation: normalizeInterpolation(source.interpolation),
    precomputedSpectrum: source.precomputedSpectrum === true,
    spectrumMetadata: normalizeSpectrumMetadata(source.spectrumMetadata || source),
    grouped: normalizeBooleanFlag(source.grouped, 'grouped') || coordinates.category,
    vectorComponents: normalizeBooleanFlag(source.vectorComponents ?? source.hasVectorComponents, 'vectorComponents')
      || Boolean(source.variables?.u && source.variables?.v),
    interactive: input.interactive === true || normalizeToken(input.taskType || input.intent) === 'interactive',
    targetRelease,
    functionName: matlabIdentifier(input.functionName, 'make_ocean_figure'),
    figureId: fileStem(input.figureId, 'ocean_figure'),
    outputDirectory: normalizeRequestPath(input.outputDirectory, 'generated', 'outputDirectory', false),
    assetDirectory: normalizeRequestPath(input.assetDirectory, '', 'assetDirectory', true),
    title: cleanSingleLine(input.title, ''),
    source: cleanSingleLine(input.source, ''),
    dpi: publication.target.dpi,
    variableNames: source.variableNames || source.variables || {},
    directionConvention: normalizeToken(source.directionConvention || ''),
    directionNormalization: normalizeToken(source.directionNormalization || source.normalization || ''),
    referenceVector: normalizeOptionalNumber(source.referenceVector ?? source.referenceSpeed, 'referenceVector'),
    longitudeConvention: normalizeLongitudeConvention(source.longitudeConvention || directions.longitudeConvention || coordinateSource.longitudeConvention),
    datelinePolicy: normalizeToken(source.datelinePolicy || ''),
    colorSemantics: normalizeToken(source.colorSemantics || source.fieldSemantics || publicationContract.color.paletteClass || ''),
    colorReference: normalizeOptionalNumber(source.colorReference ?? source.divergingCenter, 'colorReference'),
    colorLimits: normalizeNumericPair(source.colorLimits),
    componentFrame: cleanSingleLine(source.componentFrame, ''),
    stride: positiveInteger(source.stride, 1, 'stride'),
    publicationContract,
    publication,
    interactionEnvironment: normalizeInteractionEnvironment(input.interactionEnvironment || input.interactionRuntime || 'auto'),
    strictMetadata: input.strictMetadata === true,
  };
}

function selectPlotType(spec) {
  if (spec.question && !QUESTION_ALIASES[spec.question]) {
    throw new Error(`Unknown scientific question: ${spec.question}. Refuse to guess a plot type.`);
  }
  const explicit = QUESTION_ALIASES[spec.question];
  if (explicit) {
    if (spec.interactive && explicit === 'time-series' && spec.uncertainty) return 'uncertainty-series';
    return explicit === 'distribution' && spec.grouped ? 'grouped-distribution' : explicit;
  }
  if (spec.vectorComponents) return 'vector-field';
  if (spec.coordinates.time && spec.coordinates.depth && spec.rank >= 2) return 'hovmoller';
  if (spec.coordinates.depth && hasHorizontalCoordinate(spec.coordinates) && spec.rank >= 2) return 'section';
  if (spec.coordinates.longitude && spec.coordinates.latitude && spec.rank >= 2) return 'geospatial-field';
  if (spec.coordinates.depth) return 'profile';
  if (spec.coordinates.time) return spec.uncertainty ? 'uncertainty-series' : 'time-series';
  if (spec.dataType === 'categorical' || spec.coordinates.category) return 'categorical';
  if (spec.rank >= 2) return 'scalar-field';
  return spec.grouped ? 'grouped-distribution' : 'distribution';
}

function validateRoute(spec, plotType) {
  const fieldColorRequired = colorLimitPlotTypes().includes(plotType);
  if (spec.dimensionOrder.length && spec.dimensionOrder.length !== spec.rank) {
    throw new Error('dimensionOrder length must match the declared shape rank.');
  }
  if (new Set(spec.dimensionOrder).size !== spec.dimensionOrder.length) {
    throw new Error('dimensionOrder names must be unique.');
  }
  if (spec.observationDimension && !spec.dimensionOrder.includes(spec.observationDimension)) {
    throw new Error('observationDimension must name one declared dimensionOrder entry.');
  }
  if (spec.interactive && !['time-series', 'uncertainty-series'].includes(plotType)) {
    throw new Error('The native interactive MATLAB template supports time-series data with optional uncertainty only.');
  }
  if (!spec.interactive && spec.interactionEnvironment !== 'auto') {
    throw new Error('interactionEnvironment applies only to an interactive MATLAB task.');
  }
  if (fieldColorRequired && spec.colorSemantics && !['sequential', 'diverging'].includes(spec.colorSemantics)) {
    throw new Error('Field colorSemantics must be "sequential" or "diverging"; unsupported palettes are not guessed.');
  }
  if (spec.publicationContract.provided && fieldColorRequired
      && spec.publicationContract.color.paletteClass && spec.colorSemantics
      && spec.publicationContract.color.paletteClass !== spec.colorSemantics) {
    throw new Error('colorSemantics must match publicationContract.color.paletteClass.');
  }
  if (spec.publication.localization.detectedChinese
      && spec.publicationContract.localization.chineseRequired === false) {
    throw new Error('Visible Chinese text conflicts with publicationContract.localization.chineseRequired=false.');
  }
  if (plotType === 'surface' && QUESTION_ALIASES[spec.question] !== 'surface') {
    throw new Error('A 3-D surface requires an explicit scientific surface question.');
  }
  if (plotType === 'direction-rose' && !['from', 'to'].includes(spec.directionConvention)) {
    throw new Error('Directional plots require directionConvention="from" or "to".');
  }
  if (plotType === 'direction-rose' && spec.directionNormalization && !['count', 'percent'].includes(spec.directionNormalization)) {
    throw new Error('Directional normalization must be "count" or "percent".');
  }
  if (spec.coordinates.time && spec.timeZone && !isValidTimeZoneContract(spec.timeZone)) {
    throw new Error('timeZone must be UTC or an explicit IANA-style source timezone; local/floating time is unsafe.');
  }
  if (spec.qc.status === 'present') {
    if (spec.qc.action !== 'preserve') throw new Error('QC action must be "preserve"; automatic filtering is not supported.');
    const allCodes = [...spec.qc.accepted, ...spec.qc.suspect, ...spec.qc.rejected];
    if (new Set(allCodes).size !== allCodes.length) throw new Error('QC accepted/suspect/rejected codes must be mutually exclusive.');
  }
  if (spec.interactive && spec.qc.status === 'absent') {
    throw new Error('Interactive time-series data require QC status present because QCFlag is part of the template contract.');
  }
  if (spec.uncertaintyRepresentation === 'bounds' && spec.uncertaintyType !== 'confidence-interval') {
    throw new Error('Lower/upper uncertainty bounds are supported only for a stated confidence interval.');
  }
  if (['section', 'hovmoller', 'geospatial-field', 'scalar-field', 'vector-field', 'surface'].includes(plotType) && spec.rank < 2) {
    throw new Error(`${plotType} requires a two-dimensional data contract.`);
  }
  if (plotType === 'hovmoller' && !(spec.coordinates.time && spec.coordinates.depth)) {
    throw new Error('A Hovmoller plot requires both time and depth coordinates.');
  }
  if (plotType === 'geospatial-field' && !(spec.coordinates.longitude && spec.coordinates.latitude)) {
    throw new Error('A geospatial field requires longitude and latitude coordinates.');
  }
  if (plotType === 'geospatial-field' && !spec.longitudeConvention) {
    throw new Error('A geospatial field requires longitudeConvention="[-180, 180]" or "[0, 360]".');
  }
  if (plotType === 'geospatial-field' && spec.datelinePolicy && !['none', 'prewrapped'].includes(spec.datelinePolicy)) {
    throw new Error('datelinePolicy must be "none" or "prewrapped"; this generator will not guess a split or wrap.');
  }
  if (plotType === 'vector-field' && !spec.vectorComponents) {
    throw new Error('A vector field requires paired u/v components.');
  }
  if (['time-series', 'uncertainty-series'].includes(plotType) && !spec.coordinates.time) {
    throw new Error(`${plotType} requires an explicit time coordinate.`);
  }
  if (plotType === 'uncertainty-series' && !spec.uncertainty) {
    throw new Error('An uncertainty series requires hasUncertainty=true and a stated uncertainty type.');
  }
  if (plotType === 'profile' && !spec.coordinates.depth) {
    throw new Error('A profile requires an explicit depth or pressure coordinate.');
  }
  if (plotType === 'section' && !spec.coordinates.depth) {
    throw new Error('A section requires an explicit depth or pressure coordinate.');
  }
  if (spec.coordinates.depth && spec.coordinates.longitude && spec.coordinates.latitude && spec.rank < 3) {
    throw new Error('Depth plus longitude plus latitude is ambiguous below rank 3; refuse to guess a section or map slice.');
  }
  if (spec.rank >= 3 && coordinateNames(spec.coordinates).length > 2 && plotType !== 'surface') {
    throw new Error('More than two routing coordinates require an explicit slice or reduction; refuse to guess a 3-D cube view.');
  }
  if (spec.coordinates.depth && spec.verticalPositive && spec.verticalPositive !== 'down') {
    throw new Error('Positive-up vertical coordinates cannot use positive-down profile/section templates without an explicit transformation.');
  }
  if (coordinateNames(spec.coordinates).length > spec.rank) {
    throw new Error('Coordinate count exceeds declared data rank; refuse to guess a slice or collapsed dimension.');
  }
  if (spec.gridType === 'scattered' && ['section', 'hovmoller', 'geospatial-field', 'scalar-field', 'surface'].includes(plotType)
      && (!spec.interpolation.method || !spec.interpolation.maskPolicy)) {
    throw new Error('Scattered fields require an explicit interpolation method and mask policy.');
  }
  if (spec.colorSemantics === 'diverging' && spec.colorLimits && spec.colorReference !== null
      && !(spec.colorLimits[0] < spec.colorReference && spec.colorReference < spec.colorLimits[1])) {
    throw new Error('A diverging colorReference must lie strictly inside colorLimits.');
  }
  if (spec.colorSemantics === 'diverging' && spec.colorLimits && spec.colorReference !== null
      && Math.abs((spec.colorLimits[0] + spec.colorLimits[1]) / 2 - spec.colorReference)
        > Math.max(1, Math.abs(spec.colorReference)) * 1e-12) {
    throw new Error('Diverging colorLimits must be symmetric about colorReference for the selected centered colormap.');
  }
  if (spec.publication.layout.architecture === 'tiledlayout'
      && spec.publication.layout.rows * spec.publication.layout.columns !== 1) {
    throw new Error('The single-route generator requires a 1-by-1 publication tiledlayout; multi-panel composition must use an explicit composer.');
  }
  const expectedOrder = canonicalDimensionOrder(plotType, spec);
  if (spec.dimensionOrder.length && expectedOrder.length && spec.dimensionOrder.join('|') !== expectedOrder.join('|')) {
    throw new Error(`dimensionOrder must be ${expectedOrder.join(',')} for ${plotType}; no silent permute/transpose is allowed.`);
  }
}

function buildRationale(spec, plotType, purpose) {
  const evidence = [];
  if (spec.question) evidence.push(`scientific question=${spec.question}`);
  if (spec.coordinates.time) evidence.push('time coordinate');
  if (spec.coordinates.depth) evidence.push('depth/pressure coordinate');
  if (spec.coordinates.longitude && spec.coordinates.latitude) evidence.push('longitude+latitude coordinates');
  if (spec.vectorComponents) evidence.push('paired u/v components');
  evidence.push(`rank=${spec.rank}`);
  return `${plotType} communicates ${purpose}; selected from ${evidence.join(', ')}.`;
}

function buildSelectionReason(spec, plotType) {
  const explicit = Boolean(spec.question);
  const coordinateEvidence = coordinateNames(spec.coordinates);
  return {
    priority: explicit ? 'scientific-question' : coordinateEvidence.length ? 'coordinate-combination' : 'data-type-and-rank',
    selected: plotType,
    scientificQuestion: spec.question || null,
    coordinateEvidence,
    shape: spec.shape,
    rejectedGuessing: ['unknown question', 'coordinate/rank conflict', 'implicit transpose', 'implicit unit conversion'],
  };
}

function buildInputContract(spec, plotType) {
  return {
    dataType: spec.dataType,
    shape: spec.shape,
    rank: spec.rank,
    coordinates: spec.coordinates,
    gridType: spec.gridType,
    interpolation: spec.interpolation,
    dimensionOrder: spec.dimensionOrder,
    observationDimension: spec.observationDimension || null,
    interactive: spec.interactive,
    canonicalDimensionOrder: canonicalDimensionOrder(plotType, spec),
    missingStatus: spec.missingStatus,
    qc: buildQcPolicy(spec),
    uncertaintyType: spec.uncertaintyType || null,
    uncertaintyRepresentation: spec.uncertaintyRepresentation || null,
    confidenceLevel: spec.confidenceLevel,
    longitudeConvention: spec.longitudeConvention || null,
    datelinePolicy: spec.datelinePolicy || null,
    requiredChecks: requiredChecks(plotType, spec),
  };
}

function requiredChecks(plotType, spec) {
  const checks = [
    'finite coordinates',
    'data/coordinate size agreement',
    'units present',
    'missing/invalid/suspect masks separated',
    'final physical size and typography applied before drawnow',
    'axes bounds checked after drawnow',
    'PNG/PDF clipping, glyph, grayscale and color-vision checks remain artifact-backed',
  ];
  if (spec.coordinates.time) checks.push('non-NaT strictly increasing unique time and explicit timezone');
  if (spec.interactive && ['time-series', 'uncertainty-series'].includes(plotType)) {
    checks.push('stable unique ObservationID aligned with Station and QCFlag');
    checks.push('DataTipTemplate and BrushData are bound to plotted rows');
    if (plotType === 'uncertainty-series') checks.push('uncertainty values and units are bound to plotted rows');
  }
  if (spec.coordinates.depth) checks.push('depth/pressure meaning, units, sign and cast order');
  if (spec.coordinates.longitude) checks.push('longitude convention and dateline handling');
  if (['section', 'hovmoller', 'geospatial-field', 'scalar-field'].includes(plotType)) checks.push('grid geometry and dimension order');
  if (plotType === 'vector-field') checks.push('u/v units, matching masks, stride and reference vector');
  if (plotType === 'spectrum') checks.push('positive frequency/density, estimator metadata and gap-safe confidence bounds');
  return checks;
}

function buildAxisPolicy(spec, plotType) {
  return {
    x: spec.coordinates.time ? 'datetime with explicit timezone' : spec.coordinates.longitude ? 'longitude with stated convention' : 'quantity and unit required',
    y: spec.coordinates.depth ? 'positive-down only when nonnegative depth is verified' : spec.coordinates.latitude ? 'latitude order verified' : 'quantity and unit required',
    equalLimits: plotType === 'comparison',
    logScale: plotType === 'spectrum' ? 'positive finite values only' : 'linear unless scientifically specified',
    coordinateDirections: coordinateDirectionPolicy(spec, plotType),
  };
}

function buildMissingPolicy(spec, plotType) {
  return {
    status: spec.missingStatus,
    representation: ['time-series', 'uncertainty-series', 'profile', 'spectrum'].includes(plotType)
      ? 'preserve NaN as line/band breaks'
      : 'preserve mask and distinguish it from valid extrema and zero',
    interpolation: 'forbidden unless method, target, extrapolation and affected fraction are explicit',
    reportCounts: true,
  };
}

function buildQcPolicy(spec) {
  return {
    status: spec.qc.status,
    action: spec.qc.action,
    variable: spec.qc.variable || null,
    alignment: spec.qc.alignment || null,
    flagMeanings: { ...spec.qc.flagMeanings },
    accepted: [...spec.qc.accepted],
    suspect: [...spec.qc.suspect],
    rejected: [...spec.qc.rejected],
    reportCounts: spec.qc.status === 'present',
  };
}

function buildUnitPolicy(spec, plotType) {
  return {
    units: { ...spec.units },
    quantities: { ...spec.quantities },
    required: requiredUnitKeys(plotType),
    conversion: 'forbidden unless source unit, target unit and formula are explicit',
    labels: plotLabels(spec, plotType),
  };
}

function unresolvedRequirements(spec, plotType) {
  const unresolved = [...spec.publicationContract.unresolvedRequirements];
  for (const key of requiredUnitKeys(plotType)) {
    if (!isMeaningfulMetadata(spec.units[key])) unresolved.push(`units.${key}`);
  }
  for (const key of requiredQuantityKeys(plotType)) {
    if (!isMeaningfulMetadata(spec.quantities[key])) unresolved.push(`quantities.${key}`);
  }
  if (spec.missingStatus === 'unknown') unresolved.push('missing status (present/absent)');
  if (spec.qc.status === 'unknown') unresolved.push('QC status (present/absent)');
  if (spec.qc.status === 'present') {
    if (!spec.observationDimension) unresolved.push('observationDimension for QC alignment');
    if (!spec.qc.variable) unresolved.push('qcPolicy.variable');
    if (!spec.qc.alignment) unresolved.push('qcPolicy.alignment');
    if (spec.qc.alignment && spec.observationDimension && spec.qc.alignment !== spec.observationDimension) {
      unresolved.push('qcPolicy.alignment matching observationDimension');
    }
    if (!spec.qc.declared.accepted || !spec.qc.accepted.length) unresolved.push('qcPolicy.accepted codes');
    if (!spec.qc.declared.suspect) unresolved.push('qcPolicy.suspect codes (use [] when none)');
    if (!spec.qc.declared.rejected) unresolved.push('qcPolicy.rejected codes (use [] when none)');
    if (spec.qc.unclassified.length) unresolved.push('qcPolicy flag meanings classifiable as accepted/suspect/rejected');
  }
  if (!spec.assetDirectory) unresolved.push('assetDirectory');
  if (!spec.title) unresolved.push('title');
  if (!spec.source) unresolved.push('source');
  if (spec.coordinates.time && !spec.timeZone) unresolved.push('timeZone');
  if (spec.coordinates.time && spec.dataType !== 'datetime') {
    unresolved.push('dataType datetime (extract timetable row times explicitly)');
  }
  if (spec.coordinates.depth) {
    if (!['depth', 'pressure'].includes(spec.verticalCoordinate)) unresolved.push('verticalCoordinate (depth/pressure)');
    if (!['down', 'up'].includes(spec.verticalPositive)) unresolved.push('verticalPositive (down/up)');
  }
  if (plotType === 'profile' && !spec.verticalReference) unresolved.push('verticalReference');
  if (spec.verticalCoordinate === 'pressure' && ['profile', 'section', 'hovmoller'].includes(plotType)) {
    unresolved.push('explicit pressure-coordinate implementation; selected assets are depth-specific');
  }
  if (plotType === 'uncertainty-series') {
    if (!allowedUncertaintyTypes().includes(spec.uncertaintyType)) unresolved.push('uncertaintyType');
    if (!['magnitude', 'bounds'].includes(spec.uncertaintyRepresentation)) unresolved.push('uncertaintyRepresentation (magnitude/bounds)');
    if (spec.uncertaintyType === 'confidence-interval' && !(spec.confidenceLevel > 0 && spec.confidenceLevel < 1)) {
      unresolved.push('confidenceLevel between 0 and 1');
    }
    if (!spec.observationDimension) unresolved.push('observationDimension for uncertainty alignment');
    if (!spec.uncertaintyAlignment) unresolved.push('uncertaintyAlignment');
    if (spec.uncertaintyAlignment && spec.observationDimension && spec.uncertaintyAlignment !== spec.observationDimension) {
      unresolved.push('uncertaintyAlignment matching observationDimension');
    }
    if (spec.units.value && spec.units.uncertainty && spec.units.value !== spec.units.uncertainty) {
      unresolved.push('uncertainty unit compatible with value unit');
    }
  }
  if (plotType === 'comparison' && spec.units.reference && spec.units.candidate && spec.units.reference !== spec.units.candidate) {
    unresolved.push('matching comparison units');
  }
  if (plotType === 'vector-field' && spec.units.u && spec.units.v && spec.units.u !== spec.units.v) {
    unresolved.push('matching u/v component units');
  }
  if (plotType === 'vector-field' && !(Number.isFinite(spec.referenceVector) && spec.referenceVector > 0)) {
    unresolved.push('positive referenceVector');
  }
  if (plotType === 'direction-rose' && !['count', 'percent'].includes(spec.directionNormalization)) {
    unresolved.push('directionNormalization (count/percent)');
  }
  if (plotType === 'direction-rose' && !isDegreeUnit(spec.units.direction)) {
    unresolved.push('units.direction must be degrees clockwise from true north');
  }
  if (plotType === 'spectrum' && !spec.precomputedSpectrum) unresolved.push('precomputedSpectrum=true');
  if (plotType === 'spectrum') {
    for (const key of ['periodUnit', 'windowDescription', 'detrendDescription', 'segmentDescription']) {
      if (!spec.spectrumMetadata[key]) unresolved.push(`spectrumMetadata.${key}`);
    }
  }
  if (plotType === 'vector-field' && !spec.componentFrame) unresolved.push('componentFrame');
  if (plotType === 'geospatial-field' && !['none', 'prewrapped'].includes(spec.datelinePolicy)) unresolved.push('datelinePolicy (none/prewrapped)');
  if (colorLimitPlotTypes().includes(plotType) && !spec.colorLimits) unresolved.push('colorLimits');
  if (colorLimitPlotTypes().includes(plotType) && !spec.colorSemantics) unresolved.push('colorSemantics (sequential/diverging)');
  if (spec.colorSemantics === 'diverging' && spec.colorReference === null) unresolved.push('colorReference for diverging data');
  if (!spec.shape.length) unresolved.push('shape/dimensions');
  if (canonicalDimensionOrder(plotType, spec).length && !spec.dimensionOrder.length) unresolved.push('dimensionOrder');
  if (fieldPlotTypes().includes(plotType) && !allowedGridTypes().includes(spec.gridType)) unresolved.push('gridType');
  if (spec.gridType === 'scattered') unresolved.push('pregridded field for deterministic script generation');
  if (!releaseAtLeast(spec.targetRelease, AUDITED_GENERATOR_MINIMUM_RELEASE)) {
    unresolved.push(`targetRelease ${AUDITED_GENERATOR_MINIMUM_RELEASE} or newer for arguments-based audited assets`);
  }
  const formats = [...spec.publication.target.formats];
  const unsupportedFormats = formats.filter((format) => !['png', 'pdf', 'svg'].includes(format));
  if (unsupportedFormats.length) unresolved.push('outputFormats limited to png,pdf,svg for the selected generator');
  if (!formats.includes('png') || !formats.includes('pdf')) {
    unresolved.push('outputFormats must include png and pdf for oi_export_figure audit');
  }
  if (spec.publicationContract.provided) {
    if (normalizeToken(spec.publication.color.paletteSource) !== 'oi-ocean-theme') {
      unresolved.push('publicationContract.color.paletteSource oi_ocean_theme for the selected generator');
    }
    if (normalizeToken(spec.publication.color.background) !== 'white') {
      unresolved.push('publicationContract.color.background white for oi_export_figure');
    }
    if (colorLimitPlotTypes().includes(plotType)
        && normalizeToken(spec.publication.layout.colorbarPlacement) !== 'adjacent') {
      unresolved.push('publicationContract.layout.colorbarPlacement adjacent for the selected field generator');
    }
    const expectedExportApi = selectMatlabAuditedExportStrategy(spec.targetRelease, 'png').api;
    if (normalizeToken(spec.publicationContract.headless.exportApi) !== expectedExportApi
        && (spec.publicationContract.headless.exportApi || !Object.keys(spec.publicationContract.headless.exportApis).length)) {
      unresolved.push(`publicationContract.headless.exportApi ${expectedExportApi} for targetRelease ${spec.targetRelease}`);
    }
    const expectedFormatApis = Object.fromEntries(formats.map((format) => [
      format,
      selectMatlabAuditedExportStrategy(spec.targetRelease, format).api,
    ]));
    if (new Set(Object.values(expectedFormatApis)).size > 1 || Object.keys(spec.publication.headless.exportApis).length) {
      for (const [format, api] of Object.entries(expectedFormatApis)) {
        if (normalizeToken(spec.publication.headless.exportApis[format]) !== api) {
          unresolved.push(`publicationContract.headless.exportApis.${format} ${api} for targetRelease ${spec.targetRelease}`);
        }
      }
    }
  }
  if (plotType === 'hovmoller' && !releaseAtLeast(spec.targetRelease, 'R2023b')) {
    unresolved.push('targetRelease R2023b or newer for datetime Hovmoller coordinates');
  }
  return [...new Set(unresolved)];
}

function requiredUnitKeys(plotType) {
  return {
    'time-series': ['value'],
    'uncertainty-series': ['value', 'uncertainty'],
    profile: ['depth', 'value'],
    section: ['horizontal', 'depth', 'value'],
    hovmoller: ['depth', 'value'],
    'geospatial-field': ['longitude', 'latitude', 'value'],
    'vector-field': ['x', 'y', 'u', 'v'],
    'scalar-field': ['x', 'y', 'value'],
    comparison: ['reference', 'candidate'],
    relationship: ['x', 'y'],
    'ts-diagram': ['salinity', 'temperature', 'depth'],
    spectrum: ['frequency', 'density'],
    'direction-rose': ['direction', 'weight'],
    distribution: ['value'],
    'grouped-distribution': ['value'],
    categorical: ['value'],
    surface: ['x', 'y', 'value'],
  }[plotType] || [];
}

function requiredQuantityKeys(plotType) {
  return requiredUnitKeys(plotType).filter((key) => !['uncertainty', 'weight'].includes(key));
}

function canonicalDimensionOrder(plotType, spec = {}) {
  if (spec.rank > 1 && ['time-series', 'uncertainty-series'].includes(plotType)) return ['time', 'series'];
  if (spec.rank > 1 && plotType === 'profile') return ['depth', 'series'];
  return {
    section: ['depth', 'horizontal'],
    hovmoller: ['depth', 'time'],
    'geospatial-field': ['latitude', 'longitude'],
    'vector-field': ['y', 'x'],
    'scalar-field': ['y', 'x'],
    surface: ['y', 'x'],
  }[plotType] || [];
}

function plotLabels(spec, plotType) {
  const label = (key, fallback) => formatLabel(spec.quantities[key] || fallback, spec.units[key]);
  const labels = {
    'time-series': { x: `Time (${spec.timeZone || 'timezone required'})`, y: label('value', 'Value') },
    'uncertainty-series': { x: `Time (${spec.timeZone || 'timezone required'})`, y: label('value', 'Value') },
    profile: { x: label('value', 'Value'), y: label('depth', spec.verticalCoordinate || 'Vertical coordinate') },
    section: { x: label('horizontal', 'Horizontal coordinate'), y: label('depth', spec.verticalCoordinate || 'Vertical coordinate'), colorbar: label('value', 'Value') },
    hovmoller: { x: `Time (${spec.timeZone || 'timezone required'})`, y: label('depth', spec.verticalCoordinate || 'Vertical coordinate'), colorbar: label('value', 'Value') },
    'geospatial-field': { x: label('longitude', 'Longitude'), y: label('latitude', 'Latitude'), colorbar: label('value', 'Value') },
    'vector-field': { x: label('x', 'X coordinate'), y: label('y', 'Y coordinate') },
    'scalar-field': { x: label('x', 'X coordinate'), y: label('y', 'Y coordinate'), colorbar: label('value', 'Value') },
    comparison: { x: label('reference', 'Reference'), y: label('candidate', 'Candidate') },
    relationship: { x: label('x', 'X'), y: label('y', 'Y') },
    'ts-diagram': { x: label('salinity', 'Salinity'), y: label('temperature', 'Temperature'), colorbar: label('depth', 'Depth') },
    spectrum: { x: label('frequency', 'Frequency'), y: label('density', 'Spectral density') },
    'direction-rose': { x: label('direction', 'Direction'), y: label('weight', 'Weight') },
    distribution: { x: label('value', 'Value'), y: 'Count (1)' },
    'grouped-distribution': { x: 'Group (category)', y: label('value', 'Value') },
    categorical: { x: 'Category (category)', y: label('value', 'Value') },
    surface: { x: label('x', 'X coordinate'), y: label('y', 'Y coordinate'), colorbar: label('value', 'Value') },
  };
  return labels[plotType] || {};
}

function labelLines(labels, plotType, titleText) {
  if (assetHelperPlotTypes().includes(plotType)) return [];
  const lines = [];
  if (labels.x) lines.push(`xlabel(axesHandle, ${matlabString(labels.x)}, 'Interpreter', 'none');`);
  if (labels.y) lines.push(`ylabel(axesHandle, ${matlabString(labels.y)}, 'Interpreter', 'none');`);
  if (titleText) lines.push(`title(axesHandle, ${matlabString(titleText)}, 'FontWeight', 'normal', 'Interpreter', 'none');`);
  if (labels.colorbar) {
    lines.push(`colorbarHandle = colorbar(axesHandle);`);
    lines.push(`colorbarHandle.Label.String = ${matlabString(labels.colorbar)};`);
    lines.push(`colorbarHandle.Label.Interpreter = 'none';`);
  }
  return lines;
}

function themeAndFontLines(spec) {
  const fontCandidates = spec.publication.typography.fontCandidates;
  const interactionRequested = spec.interactive
    ? spec.interactionEnvironment === 'desktop' ? 'true' : spec.interactionEnvironment === 'headless' ? 'false' : 'desktopAvailable'
    : 'false';
  return [
    `publicationWidthPixels = ${spec.publication.target.widthPixels};`,
    `publicationHeightPixels = ${spec.publication.target.heightPixels};`,
    `publicationDpi = ${spec.publication.target.dpi};`,
    `publicationSizeInches = [publicationWidthPixels publicationHeightPixels] / publicationDpi;`,
    `publicationPageMargin = min(0.25 ./ publicationSizeInches, 0.1);`,
    `desktopAvailable = usejava('desktop');`,
    ...(spec.interactive && spec.interactionEnvironment === 'desktop'
      ? [`assert(desktopAvailable, 'plot:DesktopRequired', 'interactionEnvironment="desktop" requires the MATLAB desktop; no silent headless downgrade is allowed.');`]
      : []),
    `interactionRequested = ${interactionRequested};`,
    `theme = oi_ocean_theme();`,
    `availableFontNames = string(listfonts);`,
    ...(fontCandidates.length ? [
      `fontCandidates = ${matlabStringVector(fontCandidates)};`,
      `selectedFontName = "";`,
      `for fontCandidateIndex = 1:numel(fontCandidates)`,
      `  if oi_font_available(fontCandidates(fontCandidateIndex), availableFontNames)`,
      `    selectedFontName = fontCandidates(fontCandidateIndex);`,
      `    break;`,
      `  end`,
      `end`,
      `assert(strlength(selectedFontName) > 0, 'plot:FontUnavailable', 'None of the publication font candidates is available by exact installed family name.');`,
    ] : [
      `selectedFontName = string(theme.FontName);`,
      `assert(oi_font_available(selectedFontName, availableFontNames), 'plot:FontUnavailable', 'The theme font is not available by exact installed family name.');`,
    ]),
    ...(spec.publication.localization.chineseRequired ? [
      `cjkFontCandidates = ["Noto Sans CJK SC" "Source Han Sans SC" "Microsoft YaHei" "PingFang SC" "Arial Unicode MS" "WenQuanYi Zen Hei"];`,
      `assert(any(strcmpi(selectedFontName, cjkFontCandidates)), 'plot:CJKFontUnavailable', 'CJK text requires a verified CJK-capable MATLAB font; refusing tofu glyph export.');`,
    ] : []),
    `theme.FontName = selectedFontName;`,
    `theme.FontSize = ${spec.publication.typography.baseSizePt};`,
    `theme.LabelSize = ${spec.publication.typography.labelSizePt};`,
    `theme.TitleSize = ${spec.publication.typography.titleSizePt};`,
  ];
}

function staticFigureLines(spec) {
  const figureLines = [
    `figureHandle = oi_figure(publicationWidthPixels, publicationHeightPixels, 'off');`,
    `cleanupFigure = onCleanup(@() close(figureHandle));`,
    `figureHandle.Units = 'inches';`,
    `figureHandle.Position(3:4) = publicationSizeInches;`,
    `figureHandle.PaperUnits = 'inches';`,
    `figureHandle.PaperPosition = [0 0 publicationSizeInches];`,
    `figureHandle.PaperSize = publicationSizeInches;`,
    `figureHandle.PaperPositionMode = 'manual';`,
    `set(figureHandle, 'DefaultAxesFontName', selectedFontName, 'DefaultTextFontName', selectedFontName, 'DefaultAxesFontSize', theme.FontSize, 'DefaultTextFontSize', theme.FontSize);`,
  ];
  if (spec.publication.layout.architecture === 'tiledlayout') {
    return [
      ...figureLines,
      `layoutHandle = tiledlayout(figureHandle, ${spec.publication.layout.rows}, ${spec.publication.layout.columns}, 'TileSpacing', ${matlabString(spec.publication.layout.tileSpacing)}, 'Padding', ${matlabString(spec.publication.layout.padding)});`,
      `layoutHandle.Units = 'normalized';`,
      `if isprop(layoutHandle, 'PositionConstraint'), layoutHandle.PositionConstraint = 'outerposition'; end`,
      `layoutHandle.OuterPosition = [publicationPageMargin 1 - 2 * publicationPageMargin];`,
      `axesHandle = nexttile(layoutHandle, 1);`,
    ];
  }
  return [
    ...figureLines,
    `axesHandle = axes('Parent', figureHandle, 'Units', 'normalized');`,
    `if isprop(axesHandle, 'PositionConstraint'), axesHandle.PositionConstraint = 'outerposition'; else, axesHandle.ActivePositionProperty = 'outerposition'; end`,
    `axesHandle.OuterPosition = [publicationPageMargin 1 - 2 * publicationPageMargin];`,
  ];
}

function accessibilityEnhancementLines(spec, plotType, names) {
  if (!['section', 'geospatial-field', 'scalar-field'].includes(plotType)) return [];
  const [xName, yName, fieldName] = names.arguments;
  return [
    `hold(axesHandle, 'on');`,
    `[~, accessibilityContourHandle] = contour(axesHandle, ${xName}, ${yName}, ${fieldName}, 7, 'LineColor', theme.TextColor, 'LineWidth', ${spec.publication.typography.lineWidthPt}, 'HandleVisibility', 'off');`,
    ...(spec.colorSemantics === 'diverging' ? [
      `[~, referenceContourHandle] = contour(axesHandle, ${xName}, ${yName}, ${fieldName}, [${spec.colorReference} ${spec.colorReference}], 'LineColor', theme.TextColor, 'LineStyle', '--', 'LineWidth', ${Math.max(1.2, spec.publication.typography.lineWidthPt)}, 'HandleVisibility', 'off');`,
    ] : []),
    `hold(axesHandle, 'off');`,
  ];
}

function typographyLines(spec) {
  return [
    `axesHandle.FontName = selectedFontName;`,
    `axesHandle.FontSize = ${spec.publication.typography.baseSizePt};`,
    `axesHandle.XLabel.FontName = selectedFontName; axesHandle.XLabel.FontSize = ${spec.publication.typography.labelSizePt}; axesHandle.XLabel.Interpreter = ${matlabString(spec.publication.typography.interpreter)};`,
    `axesHandle.YLabel.FontName = selectedFontName; axesHandle.YLabel.FontSize = ${spec.publication.typography.labelSizePt}; axesHandle.YLabel.Interpreter = ${matlabString(spec.publication.typography.interpreter)};`,
    `axesHandle.Title.FontName = selectedFontName; axesHandle.Title.FontSize = ${spec.publication.typography.titleSizePt}; axesHandle.Title.Interpreter = ${matlabString(spec.publication.typography.interpreter)};`,
    `if isprop(axesHandle, 'TickLabelInterpreter'), axesHandle.TickLabelInterpreter = ${matlabString(spec.publication.typography.interpreter)}; end`,
    `fontHandles = findall(figureHandle, '-property', 'FontName');`,
    `for fontHandleIndex = 1:numel(fontHandles)`,
    `  fontHandles(fontHandleIndex).FontName = selectedFontName;`,
    `end`,
    `interpreterHandles = findall(figureHandle, '-property', 'Interpreter');`,
    `for interpreterIndex = 1:numel(interpreterHandles)`,
    `  interpreterHandles(interpreterIndex).Interpreter = ${matlabString(spec.publication.typography.interpreter)};`,
    `end`,
    `lineWidthHandles = findall(figureHandle, '-property', 'LineWidth');`,
    `for lineWidthIndex = 1:numel(lineWidthHandles)`,
    `  if isnumeric(lineWidthHandles(lineWidthIndex).LineWidth) && isscalar(lineWidthHandles(lineWidthIndex).LineWidth)`,
    `    lineWidthHandles(lineWidthIndex).LineWidth = max(lineWidthHandles(lineWidthIndex).LineWidth, ${spec.publication.typography.lineWidthPt});`,
    `  end`,
    `end`,
  ];
}

function runtimeLayoutAuditLines(spec) {
  return [
    `figureHandle.Units = 'inches';`,
    `qualityFigureSizeInches = double(figureHandle.Position(3:4));`,
    `assert(all(isfinite(qualityFigureSizeInches)) && all(abs(qualityFigureSizeInches - publicationSizeInches) <= 1e-6), 'plot:FigureSize', 'Physical figure size changed before export.');`,
    `figureHandle.PaperUnits = 'inches';`,
    `assert(all(abs(figureHandle.PaperSize - publicationSizeInches) <= 1e-6) && all(abs(figureHandle.PaperPosition - [0 0 publicationSizeInches]) <= 1e-6) && strcmp(figureHandle.PaperPositionMode, 'manual'), 'plot:PaperSize', 'Physical page geometry changed before export.');`,
    `visibleFontHandles = findall(figureHandle, '-property', 'FontSize');`,
    `qualityMinimumFontSize = Inf;`,
    `for fontAuditIndex = 1:numel(visibleFontHandles)`,
    `  if ~isprop(visibleFontHandles(fontAuditIndex), 'Visible') || string(visibleFontHandles(fontAuditIndex).Visible) == "on"`,
    `    qualityMinimumFontSize = min(qualityMinimumFontSize, double(visibleFontHandles(fontAuditIndex).FontSize));`,
    `  end`,
    `end`,
    `assert(isfinite(qualityMinimumFontSize) && qualityMinimumFontSize >= 8, 'plot:FontSize', 'Visible publication text must be at least 8 pt.');`,
  ];
}

function publicationManifestLines(spec, plotType) {
  const publicationJson = JSON.stringify(spec.publication);
  const accessibility = buildAccessibilityPolicy(spec, plotType);
  const interactionStatusLines = spec.interactive ? [
    `interactionEnabled = interactionPlot.InteractiveEnabled;`,
    `if interactionEnabled, interactionStatus = "enabled-not-verified"; else, interactionStatus = "static-fallback-not-interactive"; end`,
  ] : [
    `interactionEnabled = false;`,
    `interactionStatus = "not-requested";`,
  ];
  return [
    `assert(exportEntry.rendering_evidence.bounds_audited && exportEntry.rendering_evidence.physical_dimensions_verified, 'plot:LayoutEvidence', 'Export must supply audited final bounds and physical dimensions.');`,
    `exportedFontNames = string(exportEntry.publication.typography.selected_fonts);`,
    `assert(exportEntry.rendering_evidence.font_selection_verified && ~isempty(exportedFontNames) && all(strcmpi(exportedFontNames, selectedFontName), 'all'), 'plot:ExportFontMismatch', 'Exported font evidence must match the selected publication font.');`,
    `publicationContract = jsondecode(${matlabString(publicationJson)});`,
    `publicationContract.verification.runtime_bounds = "pending";`,
    `if exportEntry.rendering_evidence.bounds_audit_complete`,
    `  publicationContract.verification.runtime_bounds = "passed";`,
    `end`,
    `exportEntry.publication.contract = publicationContract;`,
    `exportEntry.publication.typography.selected_font = selectedFontName;`,
    `exportEntry.publication.typography.runtime_font_resolved = true;`,
    `exportEntry.publication.layout.runtime_figure_size_inches = qualityFigureSizeInches;`,
    `exportEntry.publication.layout.runtime_margins_inches = exportEntry.rendering_evidence.normalized_margins .* [qualityFigureSizeInches qualityFigureSizeInches];`,
    `exportEntry.publication.verification = publicationContract.verification;`,
    `exportEntry.publication_contract = publicationContract;`,
    `exportEntry.accessibility.alt_text = ${matlabString(accessibility.altText)};`,
    `exportEntry.accessibility.color_only_encoding = false;`,
    `exportEntry.accessibility.redundant_encoding = ${matlabString(accessibility.redundantEncoding)};`,
    `exportEntry.accessibility.glyph_artifact_status = "not-verified";`,
    `exportEntry.accessibility.grayscale_status = "not-verified";`,
    `exportEntry.accessibility.color_vision_status = "not-verified";`,
    ...interactionStatusLines,
    `exportEntry.interaction.requested = ${spec.interactive ? 'true' : 'false'};`,
    `exportEntry.interaction.enabled = logical(interactionEnabled);`,
    `exportEntry.interaction.desktop_available = logical(desktopAvailable);`,
    `exportEntry.interaction.headless.verified = logical(~interactionEnabled);`,
    `exportEntry.interaction.requested_mode = ${matlabString(spec.publication.interaction.mode)};`,
    `exportEntry.interaction.runtime_activation_requested = logical(interactionRequested);`,
    `exportEntry.interaction.interaction_verified = false;`,
    `exportEntry.interaction.static_fallback_used = logical(${spec.interactive ? '~interactionEnabled' : 'false'});`,
    `exportEntry.interaction.status = interactionStatus;`,
  ];
}

function assetHelperPlotTypes() {
  return ['profile', 'section', 'hovmoller', 'vector-field', 'comparison', 'ts-diagram', 'spectrum', 'direction-rose'];
}

function buildColorPolicy(spec, plotType) {
  const field = ['section', 'hovmoller', 'geospatial-field', 'scalar-field', 'ts-diagram', 'surface'].includes(plotType);
  return field
    ? {
      class: spec.colorSemantics || null,
      source: spec.publication.color.paletteSource,
      reference: spec.colorReference,
      limits: spec.colorLimits,
      missing: spec.publication.color.missingAppearance,
      centeredReferenceRequired: spec.colorSemantics === 'diverging',
      rainbow: false,
    }
    : { class: 'accessible categorical series palette plus line/marker redundancy', source: spec.publication.color.paletteSource, rainbow: false };
}

function buildAccessibilityPolicy(spec, plotType) {
  const contourRedundancy = ['section', 'geospatial-field', 'scalar-field'].includes(plotType);
  const geometryRedundancy = ['time-series', 'uncertainty-series', 'profile', 'comparison', 'relationship', 'vector-field', 'surface'].includes(plotType);
  return {
    altText: buildAltText(spec, plotType),
    minimumContrastRatio: spec.publication.color.minimumContrastRatio,
    colorOnlyEncodingAllowed: false,
    redundantEncoding: contourRedundancy
      ? 'labeled colorbar plus contour geometry; diverging reference receives a distinct contour'
      : geometryRedundancy
        ? 'position, line, marker, error-bar or vector geometry remains meaningful without hue'
        : 'ordered luminance and labeled scale; final grayscale and color-vision artifact checks required',
    runtimeChecks: ['font installed', 'minimum font size', 'axes bounds after drawnow'],
    artifactChecks: ['PNG/PDF glyph rendering', 'PNG clipping/overlap', 'grayscale', 'color-vision simulation', 'PDF font embedding'],
    artifactVerificationStatus: 'not-run-by-router',
  };
}

function buildInteractionPolicy(spec) {
  return {
    requested: spec.interactive,
    environment: spec.interactionEnvironment,
    desktopRequired: spec.interactive && spec.interactionEnvironment === 'desktop',
    staticFallback: spec.interactive && spec.interactionEnvironment !== 'desktop',
    staticContentEquivalent: true,
    interactionVerification: spec.interactive ? 'runtime-required' : 'not-applicable',
  };
}

function variableNames(spec, plotType) {
  const variable = (key, fallback) => matlabIdentifier(spec.variableNames[key], fallback);
  const uncertaintyArguments = spec.uncertaintyRepresentation === 'bounds'
    ? [variable('time', 'time'), variable('value', 'values'), variable('uncertaintyLower', 'lowerBound'), variable('uncertaintyUpper', 'upperBound')]
    : [variable('time', 'time'), variable('value', 'values'), variable('uncertainty', 'uncertainty')];
  const interactionMetadataArguments = [
    variable('observationId', 'observationId'),
    variable('station', 'station'),
    variable('qcFlag', 'qcFlag'),
  ];
  const map = {
    'time-series': spec.interactive
      ? [variable('time', 'time'), variable('value', 'values'), ...interactionMetadataArguments]
      : [variable('time', 'time'), variable('value', 'values')],
    'uncertainty-series': spec.interactive
      ? [...uncertaintyArguments, ...interactionMetadataArguments]
      : uncertaintyArguments,
    profile: [variable('depth', 'depth'), variable('value', 'values')],
    section: [variable('horizontal', 'distance'), variable('depth', 'depth'), variable('field', 'fieldValues')],
    hovmoller: [variable('time', 'time'), variable('depth', 'depth'), variable('field', 'fieldValues')],
    'geospatial-field': [variable('longitude', 'longitude'), variable('latitude', 'latitude'), variable('field', 'fieldValues')],
    'vector-field': [variable('x', 'xCoordinate'), variable('y', 'yCoordinate'), variable('u', 'uComponent'), variable('v', 'vComponent')],
    'scalar-field': [variable('x', 'xCoordinate'), variable('y', 'yCoordinate'), variable('field', 'fieldValues')],
    comparison: [variable('reference', 'referenceValues'), variable('candidate', 'candidateValues')],
    relationship: [variable('x', 'xValues'), variable('y', 'yValues')],
    'ts-diagram': [variable('salinity', 'salinity'), variable('temperature', 'temperature'), variable('depth', 'depth')],
    spectrum: [variable('frequency', 'frequency'), variable('density', 'spectralDensity')],
    'direction-rose': [variable('direction', 'directionDegrees'), variable('weight', 'weights')],
    distribution: [variable('value', 'values')],
    'grouped-distribution': [variable('value', 'values'), variable('group', 'groups')],
    categorical: [variable('category', 'categories'), variable('value', 'values')],
    surface: [variable('x', 'xCoordinate'), variable('y', 'yCoordinate'), variable('field', 'fieldValues')],
  };
  const argumentsList = [...map[plotType]];
  const qcFlag = variable('qcFlag', matlabIdentifier(spec.qc.variable, 'qcFlag'));
  if (spec.qc.status === 'present' && !argumentsList.includes(qcFlag)) argumentsList.push(qcFlag);
  return { arguments: argumentsList, qcFlag };
}

function validationLines(spec, plotType, names) {
  const [first, second, third, fourth, fifth] = names.arguments;
  const common = [numericValueAssertion(second || first, 'Plot values')];
  if (['time-series', 'uncertainty-series'].includes(plotType)) {
    const timeSizeCheck = spec.rank > 1
      ? `assert(size(${second}, 1) == numel(${first}), 'plot:SizeMismatch', 'Time must align with the first value dimension.');`
      : `assert(numel(${first}) == numel(${second}), 'plot:SizeMismatch', 'Time and values must align.');`;
    const checks = [`assert(isdatetime(${first}), 'plot:TimeType', 'Time must remain datetime.');`, `assert(~any(isnat(${first})) && all(diff(${first}) > seconds(0)), 'plot:TimeOrder', 'Time must be unique and increasing.');`, `assert(strcmp(string(${first}.TimeZone), ${matlabString(spec.timeZone)}), 'plot:TimeZone', 'Datetime TimeZone must match the declared timeZone.');`, timeSizeCheck, ...common];
    if (spec.interactive) {
      const metadataStart = plotType === 'uncertainty-series'
        ? (spec.uncertaintyRepresentation === 'bounds' ? 4 : 3)
        : 2;
      const [observationId, station, qcFlag] = names.arguments.slice(metadataStart, metadataStart + 3);
      checks.push(`assert(numel(${observationId}) == numel(${second}) && numel(${station}) == numel(${second}) && numel(${qcFlag}) == numel(${second}), 'plot:MetadataSizeMismatch', 'ObservationID, Station, QCFlag and values must align.');`);
      checks.push(`observationIdText = strtrim(string(${observationId}));`);
      checks.push(`assert(all(~ismissing(${observationId}), 'all') && all(~ismissing(observationIdText), 'all') && all(strlength(observationIdText) > 0, 'all') && numel(unique(observationIdText)) == numel(${observationId}), 'plot:ObservationID', 'ObservationID must be nonmissing, nonempty and unique.');`);
      checks.push(`assert(all(~ismissing(${station}), 'all') && all(strlength(strtrim(string(${station}))) > 0, 'all') && all(~ismissing(${qcFlag}), 'all') && all(strlength(strtrim(string(${qcFlag}))) > 0, 'all'), 'plot:MetadataMissing', 'Station and QCFlag must be nonmissing and nonempty.');`);
    }
    if (plotType === 'uncertainty-series' && spec.uncertaintyRepresentation === 'bounds') {
      checks.push(numericValueAssertion(third, 'Lower confidence bounds'));
      checks.push(numericValueAssertion(fourth, 'Upper confidence bounds'));
      checks.push(`assert(isequal(size(${third}), size(${second})) && isequal(size(${fourth}), size(${second})), 'plot:UncertaintySize', 'Confidence bounds must match values exactly.');`);
      checks.push(`completeUncertaintyMask = isfinite(${second}) & isfinite(${third}) & isfinite(${fourth});`);
      checks.push(`assert(all(${third}(completeUncertaintyMask) <= ${second}(completeUncertaintyMask)) && all(${second}(completeUncertaintyMask) <= ${fourth}(completeUncertaintyMask)), 'plot:UncertaintyOrder', 'Confidence bounds must enclose every complete value.');`);
    } else if (plotType === 'uncertainty-series') {
      checks.push(numericValueAssertion(third, 'Uncertainty magnitudes'));
      checks.push(`assert(isequal(size(${third}), size(${second})) && all(isnan(${third}) | (isfinite(${third}) & ${third} >= 0), 'all'), 'plot:UncertaintyContract', 'Uncertainty must be nonnegative or NaN and match values exactly.');`);
    }
    return checks;
  }
  if (plotType === 'profile') return [`assert(all(isfinite(${first})) && all(${first} >= 0) && all(diff(${first}) > 0), 'plot:DepthContract', 'Depth must be finite, nonnegative, strictly increasing and positive-down.');`, `assert(size(${second}, 1) == numel(${first}), 'plot:SizeMismatch', 'Depth must align with the first profile dimension.');`, ...common];
  if (['section', 'hovmoller', 'geospatial-field', 'scalar-field', 'surface'].includes(plotType)) {
    const checks = [`assert(ismatrix(${third}), 'plot:FieldRank', 'Field must be two-dimensional.');`, numericValueAssertion(third, 'Field values'), `assert(size(${third}, 1) == numel(${second}) && size(${third}, 2) == numel(${first}), 'plot:SizeMismatch', 'Field must be [numel(y), numel(x)].');`];
    if (plotType === 'hovmoller') checks.unshift(`assert(isdatetime(${first}) && ~any(isnat(${first})) && all(diff(${first}) > seconds(0)), 'plot:TimeOrder', 'Time must be datetime, unique and increasing.');`, `assert(strcmp(string(${first}.TimeZone), ${matlabString(spec.timeZone)}), 'plot:TimeZone', 'Datetime TimeZone must match the declared timeZone.');`, `assert(all(isfinite(${second})) && all(${second} >= 0) && all(diff(${second}) > 0), 'plot:DepthContract', 'Depth must be finite, nonnegative, strictly increasing and positive-down.');`);
    if (plotType === 'section') checks.unshift(`assert(all(isfinite(${first})) && all(diff(${first}) > 0), 'plot:HorizontalCoordinate', 'Section horizontal coordinates must be finite and strictly increasing.');`, `assert(all(isfinite(${second})) && all(${second} >= 0) && all(diff(${second}) > 0), 'plot:DepthContract', 'Depth must be finite, nonnegative, strictly increasing and positive-down.');`);
    if (plotType === 'geospatial-field') checks.unshift(...geospatialCoordinateAssertions(spec, first, second));
    if (['scalar-field', 'surface'].includes(plotType)) checks.unshift(`assert(isvector(${first}) && all(isfinite(${first})) && (all(diff(${first}) > 0) || all(diff(${first}) < 0)), 'plot:XCoordinate', 'X coordinates must be finite, unique and monotonic.');`, `assert(isvector(${second}) && all(isfinite(${second})) && (all(diff(${second}) > 0) || all(diff(${second}) < 0)), 'plot:YCoordinate', 'Y coordinates must be finite, unique and monotonic.');`);
    return checks;
  }
  if (plotType === 'vector-field') return [`assert(isvector(${first}) && all(isfinite(${first})) && all(diff(${first}) > 0), 'plot:XCoordinate', 'Vector x coordinates must be finite and strictly increasing.');`, `assert(isvector(${second}) && all(isfinite(${second})) && all(diff(${second}) > 0), 'plot:YCoordinate', 'Vector y coordinates must be finite and strictly increasing.');`, numericValueAssertion(third, 'U components'), numericValueAssertion(fourth, 'V components'), `assert(isequal(size(${third}), [numel(${second}) numel(${first})]) && isequal(size(${fourth}), size(${third})), 'plot:VectorSize', 'u and v must both be y-by-x.');`, `assert(isequal(isfinite(${third}), isfinite(${fourth})), 'plot:VectorMask', 'u and v missing masks must match.');`];
  if (plotType === 'spectrum') return [numericValueAssertion(second, 'Spectral density'), `assert(numel(${first}) == numel(${second}), 'plot:SizeMismatch', 'Frequency and density must align.');`, `assert(all(isfinite(${first}) & ${first} > 0) && all(diff(${first}) > 0), 'plot:FrequencyContract', 'Frequency must be finite and positive, unique and strictly increasing.');`, `assert(all(isnan(${second}) | ${second} > 0), 'plot:SpectrumContract', 'Finite spectral density must be positive.');`];
  if (['comparison', 'relationship'].includes(plotType)) return [numericValueAssertion(first, 'First paired values'), numericValueAssertion(second, 'Second paired values'), `assert(isequal(size(${first}), size(${second})), 'plot:SizeMismatch', 'Paired values must have identical size and orientation.');`];
  if (plotType === 'ts-diagram') return [numericValueAssertion(first, 'Salinity values'), numericValueAssertion(second, 'Temperature values'), numericValueAssertion(third, 'Color values'), `assert(isequal(size(${first}), size(${second})) && isequal(size(${first}), size(${third})), 'plot:SizeMismatch', 'T-S values and color coordinate must have identical size and orientation.');`];
  if (plotType === 'direction-rose') return [numericValueAssertion(first, 'Directions'), numericValueAssertion(second, 'Direction weights'), `assert(isequal(size(${first}), size(${second})) && all(${second}(isfinite(${second})) >= 0), 'plot:DirectionWeights', 'Direction weights must match directions and be nonnegative.');`];
  if (plotType === 'grouped-distribution') return [numericValueAssertion(first, 'Distribution values'), `assert(numel(${first}) == numel(${second}), 'plot:SizeMismatch', 'Groups and values must align.');`];
  if (plotType === 'categorical') return [numericValueAssertion(second, 'Categorical values'), `assert(numel(${first}) == numel(${second}), 'plot:SizeMismatch', 'Categories and values must align.');`];
  return [numericValueAssertion(first, 'Plot values')];
}

function declaredShapeLines(spec, plotType, names) {
  const valueName = primaryValueName(plotType, names.arguments);
  if (spec.shape.length <= 1) {
    return [`assert(numel(${valueName}) == ${spec.shape[0]}, 'plot:DeclaredShape', 'Values do not match the declared observation count.');`];
  }
  return [`assert(isequal(size(${valueName}), ${matlabNumericVector(spec.shape)}), 'plot:DeclaredShape', 'Values do not match the declared shape/dimension order.');`];
}

function missingStatusLines(spec, plotType, names) {
  const expression = missingExpression(spec, plotType, names.arguments);
  if (spec.missingStatus === 'present') {
    return [`assert(any(${expression}, 'all'), 'plot:MissingContract', 'Input declares missing data but no missing values were found.');`];
  }
  return [`assert(~any(${expression}, 'all'), 'plot:MissingContract', 'Input declares no missing data but missing values were found.');`];
}

function primaryValueName(plotType, argumentsList) {
  const [first, second, third] = argumentsList;
  if (plotType === 'grouped-distribution' || plotType === 'distribution') return first;
  if (['time-series', 'uncertainty-series', 'profile', 'spectrum', 'categorical'].includes(plotType)) return second || first;
  if (['section', 'hovmoller', 'geospatial-field', 'scalar-field', 'ts-diagram', 'surface'].includes(plotType)) return third;
  if (plotType === 'vector-field') return third;
  return first;
}

function missingExpression(spec, plotType, argumentsList) {
  const [first, second, third, fourth] = argumentsList;
  if (plotType === 'uncertainty-series' && spec.uncertaintyRepresentation === 'bounds') return `isnan(${second}) | isnan(${third}) | isnan(${fourth})`;
  if (plotType === 'uncertainty-series') return `isnan(${second}) | isnan(${third})`;
  if (plotType === 'comparison' || plotType === 'relationship') return `isnan(${first}) | isnan(${second})`;
  if (plotType === 'vector-field') return `isnan(${third}) | isnan(${fourth})`;
  if (plotType === 'ts-diagram') return `isnan(${first}) | isnan(${second}) | isnan(${third})`;
  if (plotType === 'grouped-distribution') return `isnan(${first}) | ismissing(${second})`;
  if (plotType === 'categorical') return `ismissing(${first}) | isnan(${second})`;
  return `isnan(${primaryValueName(plotType, argumentsList)})`;
}

function qcValidationLines(spec, plotType, names) {
  if (spec.qc.status !== 'present') return [];
  const valueName = primaryValueName(plotType, names.arguments);
  return [
    `assert(isequal(size(${names.qcFlag}), size(${valueName})), 'plot:QCSize', 'QC flags must match the primary value array exactly.');`,
    `qcText = string(${names.qcFlag});`,
    `assert(~any(ismissing(qcText), 'all') && all(strlength(qcText) > 0, 'all'), 'plot:QCMissing', 'QC flags must be nonmissing and nonempty.');`,
    `qcAcceptedCodes = ${matlabStringVector(spec.qc.accepted)};`,
    `qcSuspectCodes = ${matlabStringVector(spec.qc.suspect)};`,
    `qcRejectedCodes = ${matlabStringVector(spec.qc.rejected)};`,
    `qcAcceptedMask = ismember(qcText, qcAcceptedCodes);`,
    `qcSuspectMask = ismember(qcText, qcSuspectCodes);`,
    `qcRejectedMask = ismember(qcText, qcRejectedCodes);`,
    `assert(all(qcAcceptedMask | qcSuspectMask | qcRejectedMask, 'all'), 'plot:QCUnknownCode', 'Every QC flag must map to accepted, suspect or rejected.');`,
  ];
}

function qcResultExpression(spec) {
  if (spec.qc.status !== 'present') return `struct('status', 'absent', 'action', 'preserve')`;
  return `struct('status', 'present', 'action', 'preserve', 'accepted_count', sum(qcAcceptedMask, 'all'), 'suspect_count', sum(qcSuspectMask, 'all'), 'rejected_count', sum(qcRejectedMask, 'all'))`;
}

function plotLines(spec, plotType, names) {
  const [first, second, third, fourth] = names.arguments;
  const colorLimits = matlabNumericVector(spec.colorLimits);
  const colormapField = spec.colorSemantics === 'diverging' ? 'DivergingMap' : 'SequentialMap';
  const helperCalls = {
    profile: `plotResult = oi_plot_profile(axesHandle, ${first}, ${second}, struct('MissingPolicy', 'preserve', 'Theme', theme, 'QuantityLabel', ${matlabString(spec.quantities.value)}, 'QuantityUnit', ${matlabString(spec.units.value)}, 'DepthUnit', ${matlabString(spec.units.depth)}, 'VerticalReference', ${matlabString(spec.verticalReference)}, 'Title', ${matlabString(spec.title)}));`,
    section: `plotResult = oi_plot_section(axesHandle, ${first}, ${second}, ${third}, struct('MissingPolicy', 'preserve', 'Theme', theme, 'Colormap', theme.${colormapField}, 'ColorLimits', ${colorLimits}, 'DistanceUnit', ${matlabString(spec.units.horizontal)}, 'DepthUnit', ${matlabString(spec.units.depth)}, 'QuantityLabel', ${matlabString(spec.quantities.value)}, 'QuantityUnit', ${matlabString(spec.units.value)}, 'Title', ${matlabString(spec.title)}));`,
    hovmoller: `plotResult = oi_plot_hovmoller(axesHandle, ${first}, ${second}, ${third}, struct('TimeZone', ${matlabString(spec.timeZone)}, 'MissingPolicy', 'preserve', 'Theme', theme, 'Colormap', theme.${colormapField}, 'ColorLimits', ${colorLimits}, 'DepthUnit', ${matlabString(spec.units.depth)}, 'QuantityLabel', ${matlabString(spec.quantities.value)}, 'QuantityUnit', ${matlabString(spec.units.value)}, 'Title', ${matlabString(spec.title)}));`,
    'vector-field': `plotResult = oi_plot_vector_field(axesHandle, ${first}, ${second}, ${third}, ${fourth}, struct('XUnit', ${matlabString(spec.units.x)}, 'YUnit', ${matlabString(spec.units.y)}, 'VectorUnit', ${matlabString(spec.units.u)}, 'ComponentFrame', ${matlabString(spec.componentFrame)}, 'ReferenceMagnitude', ${spec.referenceVector}, 'Stride', ${spec.stride}, 'XLabel', ${matlabString(spec.quantities.x)}, 'YLabel', ${matlabString(spec.quantities.y)}, 'MissingPolicy', 'preserve', 'Theme', theme, 'Title', ${matlabString(spec.title)}));`,
    comparison: `plotResult = oi_plot_comparison(axesHandle, ${first}, ${second}, struct('QuantityUnit', ${matlabString(spec.units.reference)}, 'ObservationLabel', ${matlabString(spec.quantities.reference)}, 'ModelLabel', ${matlabString(spec.quantities.candidate)}, 'MissingPolicy', 'preserve', 'Theme', theme, 'Title', ${matlabString(spec.title)}));`,
    'ts-diagram': `plotResult = oi_plot_ts_diagram(axesHandle, ${first}, ${second}, ${third}, struct('MissingPolicy', 'preserve', 'Theme', theme, 'Colormap', theme.${colormapField}, 'SalinityLabel', ${matlabString(spec.quantities.salinity)}, 'SalinityUnit', ${matlabString(spec.units.salinity)}, 'TemperatureLabel', ${matlabString(spec.quantities.temperature)}, 'TemperatureUnit', ${matlabString(spec.units.temperature)}, 'ColorLabel', ${matlabString(spec.quantities.depth)}, 'ColorUnit', ${matlabString(spec.units.depth)}, 'ColorLimits', ${colorLimits}, 'Title', ${matlabString(spec.title)}));`,
    spectrum: `plotResult = oi_plot_spectrum(axesHandle, ${first}, ${second}, struct('MissingPolicy', 'preserve', 'Theme', theme, 'FrequencyUnit', ${matlabString(spec.units.frequency)}, 'PeriodUnit', ${matlabString(spec.spectrumMetadata.periodUnit)}, 'DensityUnit', ${matlabString(spec.units.density)}, 'WindowDescription', ${matlabString(spec.spectrumMetadata.windowDescription)}, 'DetrendDescription', ${matlabString(spec.spectrumMetadata.detrendDescription)}, 'SegmentDescription', ${matlabString(spec.spectrumMetadata.segmentDescription)}, 'DegreesOfFreedom', ${matlabNumber(spec.spectrumMetadata.degreesOfFreedom)}, 'Title', ${matlabString(spec.title)}));`,
    'direction-rose': `plotResult = oi_plot_direction_rose(axesHandle, ${first}, struct('Weights', ${second}, 'DirectionConvention', ${matlabString(spec.directionConvention)}, 'DirectionUnit', ${matlabString(spec.units.direction)}, 'Normalization', ${matlabString(spec.directionNormalization)}, 'MissingPolicy', 'preserve', 'Theme', theme, 'Title', ${matlabString(spec.title)}));`,
  };
  if (helperCalls[plotType]) return [helperCalls[plotType]];
  if (spec.interactive && ['time-series', 'uncertainty-series'].includes(plotType)) {
    let tableLine;
    let uncertaintyOptions = '';
    if (plotType === 'uncertainty-series' && spec.uncertaintyRepresentation === 'bounds') {
      const [observationId, station, qcFlag] = names.arguments.slice(4, 7);
      tableLine = `interactionData = table(${first}(:), ${second}(:), ${third}(:), ${fourth}(:), ${observationId}(:), ${station}(:), ${qcFlag}(:), 'VariableNames', {'Time', 'Value', 'UncertaintyLower', 'UncertaintyUpper', 'ObservationID', 'Station', 'QCFlag'});`;
      uncertaintyOptions = `, 'UncertaintyType', ${matlabString(spec.uncertaintyType)}, 'UncertaintyUnit', ${matlabString(spec.units.uncertainty)}, 'ConfidenceLevel', ${matlabNumber(spec.confidenceLevel)}`;
    } else if (plotType === 'uncertainty-series') {
      const [observationId, station, qcFlag] = names.arguments.slice(3, 6);
      tableLine = `interactionData = table(${first}(:), ${second}(:), ${third}(:), ${observationId}(:), ${station}(:), ${qcFlag}(:), 'VariableNames', {'Time', 'Value', 'Uncertainty', 'ObservationID', 'Station', 'QCFlag'});`;
      uncertaintyOptions = `, 'UncertaintyType', ${matlabString(spec.uncertaintyType)}, 'UncertaintyUnit', ${matlabString(spec.units.uncertainty)}, 'ConfidenceLevel', ${matlabNumber(spec.confidenceLevel)}`;
    } else {
      const [observationId, station, qcFlag] = names.arguments.slice(2, 5);
      tableLine = `interactionData = table(${first}(:), ${second}(:), ${observationId}(:), ${station}(:), ${qcFlag}(:), 'VariableNames', {'Time', 'Value', 'ObservationID', 'Station', 'QCFlag'});`;
    }
    return [
      tableLine,
      `interactionPlot = interactive_timeseries_native_template(interactionData, fullfile(outputDirectory, ${matlabString(spec.figureId)}), 'Interactive', interactionRequested, 'Export', false, 'PublicationWidthPixels', publicationWidthPixels, 'PublicationHeightPixels', publicationHeightPixels, 'PublicationDPI', publicationDpi, 'Title', ${matlabString(spec.title)}, 'FontName', selectedFontName, 'TimeZone', ${matlabString(spec.timeZone)}, 'ValueLabel', ${matlabString(spec.quantities.value)}, 'ValueUnit', ${matlabString(spec.units.value)}${uncertaintyOptions});`,
      `interactionPlot.Layout.TileSpacing = ${matlabString(spec.publication.layout.tileSpacing)};`,
      `interactionPlot.Layout.Padding = ${matlabString(spec.publication.layout.padding)};`,
      `figureHandle = interactionPlot.Figure;`,
      `graphicsHandle = interactionPlot.Lines(1);`,
      `plotResult = struct('Axes', interactionPlot.Axes(1), 'Handle', graphicsHandle, 'ValidCount', interactionPlot.ValidCount, 'MissingCount', interactionPlot.MissingCount);`,
    ];
  }
  if (plotType === 'time-series') {
    return [
      `validMask = isfinite(${second});`,
      `graphicsHandle = plot(axesHandle, ${first}, ${second}, '-o', 'LineWidth', ${spec.publication.typography.lineWidthPt}, 'Color', theme.LineColors(1,:), 'MarkerSize', 4);`,
      `plotResult = struct('Axes', axesHandle, 'Handle', graphicsHandle, 'ValidCount', sum(validMask, 'all'), 'MissingCount', sum(~validMask, 'all'));`,
    ];
  }
  if (plotType === 'uncertainty-series') {
    if (spec.uncertaintyRepresentation === 'bounds') {
      return [
        `lowerError = ${second} - ${third};`,
        `upperError = ${fourth} - ${second};`,
        `validMask = isfinite(${second}) & isfinite(${third}) & isfinite(${fourth});`,
        `graphicsHandle = errorbar(axesHandle, ${first}, ${second}, lowerError, upperError, '-o', 'LineWidth', ${spec.publication.typography.lineWidthPt}, 'Color', theme.LineColors(1,:), 'MarkerSize', 4);`,
        `plotResult = struct('Axes', axesHandle, 'Handle', graphicsHandle, 'ValidCount', sum(validMask, 'all'), 'MissingCount', sum(~validMask, 'all'));`,
      ];
    }
    return [
      `validMask = isfinite(${second}) & isfinite(${third});`,
      `graphicsHandle = errorbar(axesHandle, ${first}, ${second}, ${third}, '-o', 'LineWidth', ${spec.publication.typography.lineWidthPt}, 'Color', theme.LineColors(1,:), 'MarkerSize', 4);`,
      `plotResult = struct('Axes', axesHandle, 'Handle', graphicsHandle, 'ValidCount', sum(validMask, 'all'), 'MissingCount', sum(~validMask, 'all'));`,
    ];
  }
  if (['geospatial-field', 'scalar-field'].includes(plotType)) {
    return [
      `[xGrid, yGrid] = meshgrid(${first}, ${second});`,
      `graphicsHandle = surface(axesHandle, xGrid, yGrid, zeros(size(${third})), ${third}, 'FaceColor', 'texturemap', 'EdgeColor', 'none', 'AlphaData', isfinite(${third}), 'FaceAlpha', 'texturemap');`,
      `view(axesHandle, 2);`,
      `colormap(axesHandle, theme.${colormapField});`,
      `if exist('clim', 'file') == 2, clim(axesHandle, ${colorLimits}); else, caxis(axesHandle, ${colorLimits}); end`,
      `validMask = isfinite(${third});`,
      `plotResult = struct('Axes', axesHandle, 'Handle', graphicsHandle, 'ValidCount', sum(validMask, 'all'), 'MissingCount', sum(~validMask, 'all'));`,
    ];
  }
  if (plotType === 'surface') {
    return [
      `graphicsHandle = surf(axesHandle, ${first}, ${second}, ${third}, 'EdgeColor', 'none');`,
      `colormap(axesHandle, theme.${colormapField});`,
      `if exist('clim', 'file') == 2, clim(axesHandle, ${colorLimits}); else, caxis(axesHandle, ${colorLimits}); end`,
      `validMask = isfinite(${third});`,
      `plotResult = struct('Axes', axesHandle, 'Handle', graphicsHandle, 'ValidCount', sum(validMask, 'all'), 'MissingCount', sum(~validMask, 'all'));`,
    ];
  }
  const native = {
    relationship: `graphicsHandle = scatter(axesHandle, ${first}, ${second}, 28, 'filled', 'MarkerEdgeColor', theme.TextColor);`,
    distribution: `graphicsHandle = histogram(axesHandle, ${first});`,
    'grouped-distribution': `graphicsHandle = boxchart(axesHandle, ${second}, ${first});`,
    categorical: `graphicsHandle = bar(axesHandle, ${first}, ${second});`,
  }[plotType];
  return [native, `validMask = ${nativeValidityExpression(plotType, names.arguments)};`, `plotResult = struct('Axes', axesHandle, 'Handle', graphicsHandle, 'ValidCount', sum(validMask(:)), 'MissingCount', sum(~validMask(:)));`];
}

function nativeValidityExpression(plotType, argumentsList) {
  const [first, second, third] = argumentsList;
  if (plotType === 'distribution') return `isfinite(${first})`;
  if (plotType === 'grouped-distribution') return `isfinite(${first}) & ~ismissing(${second})`;
  if (plotType === 'categorical') return `~ismissing(${first}) & isfinite(${second})`;
  if (plotType === 'surface') return `isfinite(${third})`;
  return `isfinite(${first}) & isfinite(${second})`;
}

function effectivePublicationPolicy(input, source, contract, targetRelease) {
  const requestedDpi = contract.target.dpi ?? input.dpi ?? 300;
  if (!Number.isInteger(requestedDpi) || requestedDpi < 150) {
    throw new Error('Publication DPI must be an integer of at least 150.');
  }
  const providedUnit = normalizePhysicalUnit(contract.target.units);
  const targetUnits = providedUnit || 'in';
  const defaultWidth = targetUnits === 'cm' ? (1200 / requestedDpi) * 2.54 : 1200 / requestedDpi;
  const defaultHeight = targetUnits === 'cm' ? (675 / requestedDpi) * 2.54 : 675 / requestedDpi;
  const width = contract.target.width > 0 ? contract.target.width : defaultWidth;
  const height = contract.target.height > 0 ? contract.target.height : defaultHeight;
  const inchesPerUnit = targetUnits === 'cm' ? 1 / 2.54 : 1;
  const detectedChinese = containsCjkText([
    source.title,
    ...Object.values(source.quantities || source.quantityNames || {}),
  ]);
  const chineseRequired = contract.localization.chineseRequired ?? detectedChinese;
  const fontCandidates = [contract.typography.fontFamily, ...contract.typography.fallbackFamilies].filter(Boolean);
  return {
    contractProvided: contract.provided,
    contractRequired: contract.required,
    target: {
      medium: contract.target.medium || 'audited-static-export',
      width,
      height,
      units: targetUnits,
      widthInches: width * inchesPerUnit,
      heightInches: height * inchesPerUnit,
      widthPixels: Math.round(width * inchesPerUnit * requestedDpi),
      heightPixels: Math.round(height * inchesPerUnit * requestedDpi),
      dpi: requestedDpi,
      formats: contract.target.formats.length ? [...contract.target.formats] : ['png', 'pdf'],
    },
    layout: {
      architecture: contract.layout.architecture || 'single-axes',
      rows: Number.isInteger(contract.layout.rows) ? contract.layout.rows : 1,
      columns: Number.isInteger(contract.layout.columns) ? contract.layout.columns : 1,
      tileSpacing: contract.layout.tileSpacing || 'compact',
      padding: contract.layout.padding || (normalizeToken(input.taskType || input.intent) === 'interactive' ? 'loose' : 'compact'),
      readingOrder: contract.layout.readingOrder || 'single-panel',
      explicitHandles: contract.layout.explicitHandles ?? true,
      legendPlacement: contract.layout.legendPlacement || 'none',
      colorbarPlacement: contract.layout.colorbarPlacement || 'adjacent',
    },
    typography: {
      fontFamily: contract.typography.fontFamily || null,
      fallbackFamilies: [...contract.typography.fallbackFamilies],
      fontCandidates,
      baseSizePt: contract.typography.baseSizePt ?? 10,
      labelSizePt: contract.typography.labelSizePt ?? 11,
      titleSizePt: contract.typography.titleSizePt ?? 13,
      lineWidthPt: contract.typography.lineWidthPt ?? 1.2,
      interpreter: contract.typography.interpreter || 'none',
    },
    color: {
      paletteClass: contract.color.paletteClass || null,
      paletteSource: contract.color.paletteSource || 'oi_ocean_theme',
      background: contract.color.background || 'white',
      missingAppearance: contract.color.missingAppearance || 'theme.MissingColor plus transparent field mask',
      minimumContrastRatio: contract.color.minimumContrastRatio ?? 4.5,
      colorOnlyEncodingAllowed: contract.color.colorOnlyEncodingAllowed ?? false,
      colorVisionCheckRequired: contract.color.colorVisionCheckRequired ?? true,
      grayscaleCheckRequired: contract.color.grayscaleCheckRequired ?? true,
    },
    clipping: {
      drawnowBeforeAudit: contract.clipping.drawnowBeforeAudit ?? true,
      boundsCheckRequired: contract.clipping.boundsCheckRequired ?? true,
      overlapCheckRequired: contract.clipping.overlapCheckRequired ?? true,
    },
    localization: {
      encoding: contract.localization.encoding || 'UTF-8',
      languages: [...contract.localization.languages],
      chineseRequired,
      detectedChinese,
      glyphCheckRequired: contract.localization.glyphCheckRequired ?? true,
      glyphFormats: contract.localization.glyphFormats.length
        ? [...contract.localization.glyphFormats]
        : (contract.target.formats.length ? [...contract.target.formats] : ['png', 'pdf']),
    },
    accessibility: {
      descriptionRequired: contract.accessibility.descriptionRequired ?? true,
      redundantEncodingRequired: contract.accessibility.redundantEncodingRequired ?? true,
      readingOrderCheckRequired: contract.accessibility.readingOrderCheckRequired ?? true,
    },
    interaction: {
      mode: contract.interaction.mode || (normalizeToken(input.taskType || input.intent) === 'interactive' ? 'dual' : 'static'),
      stableObservationIdsRequired: contract.interaction.stableObservationIdsRequired ?? true,
      targetScopedCallbacksRequired: contract.interaction.targetScopedCallbacksRequired ?? true,
      cleanupRequired: contract.interaction.cleanupRequired ?? true,
      staticFallbackRequired: contract.interaction.staticFallbackRequired ?? true,
    },
    headless: {
      supported: contract.headless.supported ?? true,
      command: contract.headless.command || 'matlab -batch',
      figureVisible: contract.headless.figureVisible || 'off',
      exportApi: contract.headless.exportApi || selectMatlabAuditedExportStrategy(targetRelease, 'png').api,
      exportApis: Object.keys(contract.headless.exportApis).length
        ? { ...contract.headless.exportApis }
        : Object.fromEntries((contract.target.formats.length ? contract.target.formats : ['png', 'pdf']).map((format) => [
          format,
          selectMatlabAuditedExportStrategy(targetRelease, format).api,
        ])),
      desktopIndependent: contract.headless.desktopIndependent ?? true,
    },
    verification: {
      runtimeBounds: 'generated-check-required',
      glyphArtifacts: 'not-verified-until-PNG/PDF-inspection',
      colorVision: 'not-verified-until-artifact-inspection',
      grayscale: 'not-verified-until-artifact-inspection',
      pdfFonts: 'not-verified-until-PDF-inspection',
    },
  };
}

function buildAltText(spec, plotType) {
  const labels = plotLabels(spec, plotType);
  const parts = [`Scientific ${plotType} figure`, spec.title];
  if (labels.x) parts.push(`x-axis: ${labels.x}`);
  if (labels.y) parts.push(`y-axis: ${labels.y}`);
  if (labels.colorbar) parts.push(`color scale: ${labels.colorbar}`);
  return parts.filter(Boolean).join('; ');
}

function containsCjkText(values) {
  return values.some((value) => /[\u3400-\u9fff\uf900-\ufaff]/u.test(String(value ?? '')));
}

function normalizePhysicalUnit(value) {
  const normalized = normalizeToken(value);
  if (['cm', 'centimeter', 'centimeters'].includes(normalized)) return 'cm';
  if (['in', 'inch', 'inches'].includes(normalized)) return 'in';
  return '';
}

function normalizeInteractionEnvironment(value) {
  const normalized = normalizeToken(value || 'auto');
  if (!['auto', 'desktop', 'headless'].includes(normalized)) {
    throw new Error('interactionEnvironment must be "auto", "desktop", or "headless".');
  }
  return normalized;
}

function normalizeCoordinates(value) {
  const declared = [];
  if (value !== undefined && value !== null) {
    if (Array.isArray(value)) {
      declared.push(...normalizeCoordinateNameList(value, 'coordinates'));
    } else if (objectValue(value)) {
      if (Object.hasOwn(value, 'names')) declared.push(...normalizeCoordinateNameList(value.names, 'coordinates.names'));
      for (const [key, flag] of Object.entries(value)) {
        const normalizedKey = normalizeToken(key);
        if (COORDINATE_METADATA_KEYS.has(normalizedKey)) continue;
        const canonical = canonicalCoordinateName(normalizedKey);
        if (!canonical) throw new Error(`Unknown coordinate name: ${normalizedKey || '<empty>'}. Refuse to guess coordinate semantics.`);
        if (flag === false || flag === null || flag === undefined) continue;
        if (flag !== true && !objectValue(flag)) {
          throw new Error(`Coordinate flag ${key} must be boolean or a structured coordinate descriptor.`);
        }
        declared.push(canonical);
      }
    } else {
      throw new Error('coordinates must be an array of names or an object with explicit coordinate flags.');
    }
  }
  if (new Set(declared).size !== declared.length) {
    throw new Error('Coordinate declarations must be unique after alias normalization.');
  }
  const enabled = new Set(declared);
  return Object.freeze(Object.fromEntries(Object.keys(COORDINATE_ALIASES).map((name) => [name, enabled.has(name)])));
}

function normalizeCoordinateAliases(primary, alias) {
  const primaryProvided = primary !== undefined && primary !== null;
  const aliasProvided = alias !== undefined && alias !== null;
  const primaryCoordinates = primaryProvided ? normalizeCoordinates(primary) : null;
  const aliasCoordinates = aliasProvided ? normalizeCoordinates(alias) : null;
  if (primaryCoordinates && aliasCoordinates
      && coordinateNames(primaryCoordinates).join('|') !== coordinateNames(aliasCoordinates).join('|')) {
    throw new Error('coordinates and axes conflict after coordinate alias normalization.');
  }
  return primaryCoordinates || aliasCoordinates || normalizeCoordinates({});
}

function normalizeCoordinateNameList(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array of recognized coordinate names.`);
  return value.map((item) => {
    if (typeof item !== 'string' || !item.trim()) throw new Error(`${label} entries must be non-empty strings.`);
    const normalized = normalizeToken(item);
    const canonical = canonicalCoordinateName(normalized);
    if (!canonical) throw new Error(`Unknown coordinate name: ${normalized}. Refuse to guess coordinate semantics.`);
    return canonical;
  });
}

function canonicalCoordinateName(value) {
  return Object.entries(COORDINATE_ALIASES).find(([, aliases]) => aliases.includes(value))?.[0] || '';
}

function normalizeShape(value) {
  if (Array.isArray(value)) {
    if (!value.length || value.some((item) => typeof item !== 'number' || !Number.isSafeInteger(item) || item <= 0)) {
      throw new Error('shape/dimensions must contain only positive safe-integer numeric extents; invalid dimensions cannot be dropped, and input values cannot be coerced or dropped.');
    }
    let elementCount = 1;
    for (const extent of value) {
      if (elementCount > Number.MAX_SAFE_INTEGER / extent) {
        throw new Error('shape/dimensions element count exceeds the safe-integer range.');
      }
      elementCount *= extent;
    }
    return [...value];
  }
  if (value === undefined || value === null || value === '') return [];
  throw new Error('shape/dimensions must be an array of positive integer extents; use rank for rank-only metadata.');
}

function normalizeShapeAliases(primary, alias) {
  const primaryProvided = primary !== undefined && primary !== null && primary !== '';
  const aliasProvided = alias !== undefined && alias !== null && alias !== '';
  const primaryShape = primaryProvided ? normalizeShape(primary) : null;
  const aliasShape = aliasProvided ? normalizeShape(alias) : null;
  if (primaryShape && aliasShape && primaryShape.join('|') !== aliasShape.join('|')) {
    throw new Error('shape and dimensions declare conflicting extents.');
  }
  return primaryShape || aliasShape || [];
}

function normalizeRank(value, shape) {
  if (value === undefined || value === null || value === '') return shape.length || 1;
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('rank must be a positive safe integer.');
  if (shape.length && value !== shape.length) throw new Error('rank must equal the number of declared shape/dimension extents.');
  return value;
}

function normalizeDimensionOrder(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('dimensionOrder must be an array of non-empty dimension names.');
  return value.map((item) => {
    if (typeof item !== 'string' || !item.trim()) throw new Error('dimensionOrder entries must be non-empty strings.');
    return normalizeDimensionName(item, 'dimensionOrder entry');
  });
}

function normalizeDimensionOrderAliases(primary, alias) {
  const primaryProvided = primary !== undefined && primary !== null;
  const aliasProvided = alias !== undefined && alias !== null;
  const primaryOrder = primaryProvided ? normalizeDimensionOrder(primary) : null;
  const aliasOrder = aliasProvided ? normalizeDimensionOrder(alias) : null;
  if (primaryOrder && aliasOrder && primaryOrder.join('|') !== aliasOrder.join('|')) {
    throw new Error('dimensionOrder and dimensionsOrder conflict after dimension alias normalization.');
  }
  return primaryOrder || aliasOrder || [];
}

function normalizeQuestionAliases(primary, alias) {
  const primaryQuestion = normalizeOptionalStringToken(primary, 'scientificQuestion');
  const aliasQuestion = normalizeOptionalStringToken(alias, 'question');
  const primaryMeaning = QUESTION_ALIASES[primaryQuestion] || primaryQuestion;
  const aliasMeaning = QUESTION_ALIASES[aliasQuestion] || aliasQuestion;
  if (primaryMeaning && aliasMeaning && primaryMeaning !== aliasMeaning) {
    throw new Error('scientificQuestion and question declare conflicting plot semantics.');
  }
  return primaryQuestion || aliasQuestion;
}

function normalizeReleaseAliases(primary, alias) {
  const primaryProvided = primary !== undefined && primary !== null && primary !== '';
  const aliasProvided = alias !== undefined && alias !== null && alias !== '';
  if (primaryProvided && aliasProvided) {
    throw new Error('targetRelease and matlabRelease are duplicate aliases; provide exactly one release field.');
  }
  const primaryRelease = primaryProvided ? normalizeMatlabRelease(primary) : null;
  const aliasRelease = aliasProvided ? normalizeMatlabRelease(alias) : null;
  return primaryRelease || aliasRelease || 'R2026a';
}

function normalizeOptionalStringToken(value, label) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  return normalizeToken(value);
}

function normalizeDimensionName(value, label) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  const normalized = normalizeToken(value);
  return canonicalCoordinateName(normalized) || normalized;
}

function normalizeBooleanFlag(value, label) {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean when provided.`);
  return value;
}

function normalizePresence(value) {
  if (value === true || normalizeToken(value) === 'present') return 'present';
  if (value === false || normalizeToken(value) === 'absent') return 'absent';
  return 'unknown';
}

function normalizeUncertaintyType(value) {
  const normalized = normalizeToken(value || '');
  const aliases = {
    '95%-confidence-interval': 'confidence-interval',
    '95-confidence-interval': 'confidence-interval',
    ci: 'confidence-interval',
    sd: 'standard-deviation',
    std: 'standard-deviation',
    se: 'standard-error',
  };
  return aliases[normalized] || normalized;
}

function normalizeUncertaintyRepresentation(value, uncertaintyType) {
  const normalized = normalizeToken(value || '');
  const aliases = {
    symmetric: 'magnitude',
    'symmetric-magnitude': 'magnitude',
    'error-magnitude': 'magnitude',
    'lower-upper-bounds': 'bounds',
    'interval-bounds': 'bounds',
  };
  if (aliases[normalized]) return aliases[normalized];
  if (normalized) return normalized;
  return uncertaintyType && uncertaintyType !== 'confidence-interval' ? 'magnitude' : '';
}

function normalizeConfidenceLevel(value, uncertaintyTypeInput) {
  const explicit = normalizeOptionalNumber(value, 'confidenceLevel');
  if (explicit !== null) return explicit;
  return /(^|-)95(?:%|percent)?(?:-|$)/u.test(normalizeToken(uncertaintyTypeInput)) ? 0.95 : null;
}

function normalizeQcContract(input) {
  const config = input.qc && typeof input.qc === 'object' && !Array.isArray(input.qc) ? input.qc : {};
  const flagMeanings = normalizeMetadataMap(config.flagMeanings || input.qcFlagMeanings);
  const classified = classifyQcFlagMeanings(flagMeanings);
  const meaningsDeclared = Object.keys(flagMeanings).length > 0;
  const acceptedSource = config.acceptedValues ?? config.accepted ?? input.qcAccepted ?? (meaningsDeclared ? classified.accepted : undefined);
  const suspectSource = config.suspectValues ?? config.suspect ?? input.qcSuspect ?? (meaningsDeclared ? classified.suspect : undefined);
  const rejectedSource = config.rejectedValues ?? config.rejected ?? input.qcRejected ?? (meaningsDeclared ? classified.rejected : undefined);
  return Object.freeze({
    status: normalizePresence(config.status ?? input.qcStatus ?? input.hasQC ?? (Object.keys(config).length ? true : undefined)),
    action: normalizeToken(config.action || input.qcAction || 'preserve'),
    variable: cleanSingleLine(config.variable || input.qcVariable || input.variableNames?.qcFlag, ''),
    alignment: normalizeDimensionName(config.alignment ?? input.qcAlignment, 'qc alignment'),
    flagMeanings,
    accepted: normalizeQcCodes(acceptedSource),
    suspect: normalizeQcCodes(suspectSource),
    rejected: normalizeQcCodes(rejectedSource),
    unclassified: classified.unclassified,
    declared: Object.freeze({
      accepted: meaningsDeclared || Array.isArray(acceptedSource),
      suspect: meaningsDeclared || Array.isArray(suspectSource),
      rejected: meaningsDeclared || Array.isArray(rejectedSource),
    }),
  });
}

function normalizeQcCodes(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  const codes = value.map((item) => cleanSingleLine(item, '')).filter(Boolean);
  return Object.freeze([...new Set(codes)]);
}

function classifyQcFlagMeanings(flagMeanings) {
  const groups = { accepted: [], suspect: [], rejected: [], unclassified: [] };
  const aliases = {
    accepted: new Set(['accepted', 'good', 'valid', 'usable', 'pass', 'passed']),
    suspect: new Set(['suspect', 'questionable', 'review', 'probably-good']),
    rejected: new Set(['rejected', 'bad', 'invalid', 'fail', 'failed']),
  };
  for (const [code, meaning] of Object.entries(flagMeanings)) {
    const normalized = normalizeToken(meaning);
    const group = Object.entries(aliases).find(([, values]) => values.has(normalized))?.[0];
    if (group) groups[group].push(code);
    else groups.unclassified.push(code);
  }
  return Object.freeze(Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, Object.freeze(value)])));
}

function normalizeMetadataMap(value) {
  if (value === undefined || value === null) return Object.freeze({});
  if (!objectValue(value)) throw new Error('Units, quantities, and QC flag meanings must be metadata objects.');
  const entries = Object.entries(value).map(([key, item]) => {
    if (typeof item !== 'string') throw new Error(`Metadata value for ${key} must be a string; structured values are not inferred.`);
    const normalizedKey = normalizeToken(key);
    const normalizedValue = cleanSingleLine(item, '');
    if (!normalizedKey || !normalizedValue) throw new Error('Metadata keys and values must be non-empty strings.');
    return [normalizedKey, normalizedValue];
  }).sort(([left], [right]) => left.localeCompare(right));
  if (new Set(entries.map(([key]) => key)).size !== entries.length) {
    throw new Error('Metadata keys must be unique after normalization.');
  }
  return Object.freeze(Object.fromEntries(entries));
}

function normalizeInterpolation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return Object.freeze({ method: '', maskPolicy: '' });
  return Object.freeze({
    method: normalizeToken(value.method || ''),
    maskPolicy: cleanSingleLine(value.maskPolicy, ''),
  });
}

function normalizeSpectrumMetadata(value) {
  const degreesOfFreedom = normalizeOptionalNumber(value?.degreesOfFreedom, 'degreesOfFreedom');
  return Object.freeze({
    periodUnit: cleanSingleLine(value?.periodUnit, ''),
    windowDescription: cleanSingleLine(value?.windowDescription, ''),
    detrendDescription: cleanSingleLine(value?.detrendDescription, ''),
    segmentDescription: cleanSingleLine(value?.segmentDescription, ''),
    degreesOfFreedom,
  });
}

function normalizeNumericPair(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!Array.isArray(value) || value.length !== 2
      || value.some((item) => typeof item !== 'number' || !Number.isFinite(item)) || value[0] >= value[1]) {
    throw new Error('colorLimits must be two finite ascending numbers; string values are not coerced.');
  }
  return Object.freeze([...value]);
}

function numericValueAssertion(name, label) {
  return `assert(isnumeric(${name}) && isreal(${name}) && ~any(isinf(${name}), 'all'), 'plot:InvalidValues', '${label} must be real numeric data and may contain NaN but not Inf.');`;
}

function geospatialCoordinateAssertions(spec, longitudeName, latitudeName) {
  const [minimumLongitude, maximumLongitude] = spec.longitudeConvention === '[0, 360]' ? [0, 360] : [-180, 180];
  return [
    `assert(isvector(${longitudeName}) && all(isfinite(${longitudeName})) && all(${longitudeName} >= ${minimumLongitude} & ${longitudeName} <= ${maximumLongitude}), 'plot:LongitudeRange', 'Longitude values violate the declared ${spec.longitudeConvention} convention.');`,
    `assert(all(diff(${longitudeName}) > 0) || all(diff(${longitudeName}) < 0), 'plot:LongitudeOrder', 'Longitude must be unique and monotonic after the declared dateline policy.');`,
    `assert(isvector(${latitudeName}) && all(isfinite(${latitudeName})) && all(${latitudeName} >= -90 & ${latitudeName} <= 90), 'plot:LatitudeRange', 'Latitude values must be finite and within [-90, 90].');`,
    `assert(all(diff(${latitudeName}) > 0) || all(diff(${latitudeName}) < 0), 'plot:LatitudeOrder', 'Latitude must be unique and monotonic; no implicit reversal is performed.');`,
  ];
}

function coordinateDirectionPolicy(spec, plotType) {
  if (['profile', 'section', 'hovmoller'].includes(plotType)) return { vertical: 'strictly increasing positive-down; no reversal or sorting' };
  if (plotType === 'geospatial-field') return { longitude: `monotonic within ${spec.longitudeConvention || 'declared convention'}`, latitude: 'monotonic within [-90, 90]; no reversal' };
  if (plotType === 'vector-field') return { x: 'strictly increasing', y: 'strictly increasing', components: spec.componentFrame || 'explicit frame required' };
  if (['scalar-field', 'surface'].includes(plotType)) return { x: 'strictly monotonic', y: 'strictly monotonic' };
  if (spec.coordinates.time) return { time: 'strictly increasing unique datetime' };
  return {};
}

function isMeaningfulMetadata(value) {
  const normalized = normalizeToken(value || '');
  return Boolean(normalized) && !['unknown', 'unspecified', 'n-a', 'na', 'none', 'unitless-unknown', '?'].includes(normalized);
}

function isDegreeUnit(value) {
  return ['degree', 'degrees', 'deg', 'degree-true', 'degrees-true'].includes(normalizeToken(value));
}

function isValidTimeZoneContract(value) {
  const normalized = cleanSingleLine(value, '');
  if (normalized === 'UTC') return true;
  if (['local', 'floating', 'naive', 'unspecified'].includes(normalized.toLowerCase())) return false;
  return /^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)+$/u.test(normalized);
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function coordinateNames(coordinates) {
  return Object.entries(coordinates).filter(([, enabled]) => enabled).map(([name]) => name);
}

function fieldPlotTypes() {
  return ['section', 'hovmoller', 'geospatial-field', 'vector-field', 'scalar-field', 'surface'];
}

function allowedGridTypes() {
  return ['regular', 'rectilinear', 'curvilinear', 'scattered'];
}

function allowedUncertaintyTypes() {
  return ['standard-deviation', 'standard-error', 'confidence-interval', 'instrument-accuracy', 'ensemble-spread'];
}

function colorLimitPlotTypes() {
  return ['section', 'hovmoller', 'geospatial-field', 'scalar-field', 'ts-diagram', 'surface'];
}

function releaseAtLeast(targetRelease, minimumRelease) {
  return compareMatlabReleases(targetRelease, minimumRelease) >= 0;
}

function formatLabel(quantity, unit) {
  return unit ? `${quantity} (${unit})` : `${quantity} (unit required)`;
}

function normalizeOptionalNumber(value, label = 'numeric metadata') {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number; string values are not coerced.`);
  }
  return value;
}

function hasHorizontalCoordinate(coordinates) {
  return coordinates.distance || coordinates.longitude || coordinates.latitude;
}

function normalizeLongitudeConvention(value) {
  const normalized = cleanSingleLine(value, '');
  if (['[-180, 180]', '[0, 360]'].includes(normalized)) return normalized;
  return '';
}

function definition(helper, template, purpose) { return Object.freeze({ helper, template, purpose }); }

function selectedDefinition(spec, plotType) {
  if (spec.interactive && ['time-series', 'uncertainty-series'].includes(plotType)) {
    return definition('interactive_timeseries_native_template', 'interactive_timeseries_native_template.m', 'ordered time evolution with native data tips, uncertainty and brush selection');
  }
  return PLOT_DEFINITIONS[plotType];
}
function normalizeToken(value) { return String(value ?? '').trim().toLowerCase().replace(/[\s_]+/gu, '-'); }
function positiveInteger(value, fallback, label = 'value') {
  if (value === undefined || value === null || value === '') return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer.`);
  return value;
}
function cleanSingleLine(value, fallback) { return String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/gu, ' ').trim() || fallback; }
function matlabIdentifier(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') throw new Error('MATLAB identifiers must be strings; structured values are not inferred.');
  const candidate = cleanSingleLine(value, '');
  if (!/^[A-Za-z]\w*$/u.test(candidate)) throw new Error(`Invalid MATLAB identifier: ${candidate || '<empty>'}. Refuse to substitute a guessed name.`);
  return candidate;
}
function fileStem(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || /[\\/]|\.\./u.test(value)) {
    throw new Error('figureId must be a plain file stem without path separators or traversal segments.');
  }
  const candidate = cleanSingleLine(value, '').replace(/[^A-Za-z0-9_-]+/gu, '_');
  if (!/[A-Za-z0-9]/u.test(candidate)) throw new Error('figureId must contain at least one alphanumeric character.');
  return candidate;
}
function normalizeRequestPath(value, fallback, label, allowAbsolute) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') throw new Error(`${label} must be a string path.`);
  if (/[\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(value)) throw new Error(`${label} must not contain control characters.`);
  const candidate = value.trim();
  if (!candidate) return fallback;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(candidate) && !/^[A-Za-z]:[\\/]/u.test(candidate)) {
    throw new Error(`${label} must be a filesystem path, not a URI.`);
  }
  if (!allowAbsolute && /^(?:[A-Za-z]:[\\/]|[\\/])/u.test(candidate)) {
    throw new Error(`${label} must be a relative path.`);
  }
  if (candidate.split(/[\\/]+/u).some((segment) => segment === '..')) {
    throw new Error(`${label} must not contain parent-directory traversal.`);
  }
  return candidate.replace(/[\\/]+$/u, '') || fallback;
}
function matlabString(value) { return `'${String(value).replace(/'/gu, "''")}'`; }
function matlabStringVector(value) { return value.length ? `[${value.map((item) => `"${String(item).replace(/"/gu, '""')}"`).join(' ')}]` : 'strings(1,0)'; }
function matlabNumber(value) { return Number.isFinite(value) ? String(value) : 'NaN'; }
function matlabNumericVector(value) { return Array.isArray(value) ? `[${value.map(matlabNumber).join(' ')}]` : '[]'; }
function matlabComment(value) { return cleanSingleLine(value, '').replace(/%/gu, 'percent'); }
function assertUniqueVariableNames(names) {
  if (new Set(names).size !== names.length) throw new Error('MATLAB variableNames must be unique after identifier normalization.');
}
function deepFreeze(value) { Object.values(value).filter((item) => item && typeof item === 'object').forEach(deepFreeze); return Object.freeze(value); }
