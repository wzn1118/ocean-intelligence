import {
  MATLAB_RELEASE_RANGE,
  normalizeMatlabRelease,
  resolveMatlabPlotCapabilities,
  selectMatlabApi,
} from './matlab-release-capabilities.mjs';

export const MATLAB_TASK_ROUTING_SCHEMA_VERSION = 2;
export const MATLAB_SCIENTIFIC_DATA_SCHEMA_VERSION = 1;
export const MATLAB_PUBLICATION_SCHEMA_VERSION = 1;
export const MATLAB_OUTPUT_SCHEMA_VERSION = 1;
export const MATLAB_MANIFEST_SCHEMA_VERSION = 2;

const MATLAB_TASK_TYPES = new Set(['create', 'repair', 'refine', 'inspect', 'export', 'interactive', 'portability']);
const MATLAB_TASK_ROUTING_FIELDS = Object.freeze([
  'runtime', 'requestedRuntime', 'taskType', 'intent', 'targetRelease', 'matlabRelease',
  'matlabFirst', 'requiresMatlabNative', 'octaveFirst', 'requiresOctaveRender', 'matlabAvailable',
  'requiredToolboxes', 'toolboxes', 'toolboxAvailability', 'requestedCapabilities', 'outputFormats',
  'requireScientificContract', 'dataContract', 'scientificDataContract', 'scientificData',
  'requirePublicationContract', 'publicationContract', 'presentationContract', 'figureContract',
  'manifestRequired', 'manifestContract', 'manifestPath', 'unresolvedRequirements',
]);
const MATLAB_REQUEST_LIMITS = Object.freeze({
  maxDepth: 8,
  maxArrayLength: 256,
  maxObjectKeys: 128,
  maxStringLength: 16384,
  maxNodes: 4096,
});
const MATLAB_FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MATLAB_PLOT_REQUEST_FIELDS = Object.freeze([
  'scientificQuestion', 'question',
  'functionName', 'figureId', 'outputDirectory', 'assetDirectory', 'title', 'source',
  'interactive', 'strictMetadata', 'interactionEnvironment', 'interactionRuntime',
  'gridType', 'interpolation', 'precomputedSpectrum', 'spectrumMetadata', 'grouped',
  'vectorComponents', 'hasVectorComponents', 'variables', 'variableNames',
  'directionConvention', 'directionNormalization', 'normalization', 'referenceVector',
  'referenceSpeed', 'datelinePolicy', 'colorSemantics', 'fieldSemantics',
  'colorReference', 'divergingCenter', 'colorLimits', 'componentFrame', 'stride',
]);
const SCIENTIFIC_CONTRACT_FIELDS = new Set([
  'dataType', 'type', 'shape', 'dimensions', 'rank', 'dimensionOrder', 'dimensionsOrder',
  'observationDimension', 'observationAxis', 'coordinates', 'axes', 'quantities',
  'quantityNames', 'units', 'unitConversions', 'conversions', 'missing', 'missingStatus',
  'hasMissing', 'missingRepresentation', 'maskVariables', 'qc', 'qcStatus', 'hasQC',
  'qcVariable', 'qcAlignment', 'qcAction', 'qcFlagMeanings', 'qcAccepted', 'qcSuspect',
  'qcRejected', 'uncertainty', 'uncertaintyStatus', 'hasUncertainty', 'uncertaintyType',
  'uncertaintyUnit', 'uncertaintyAlignment', 'uncertaintyRepresentation',
  'confidenceLevel', 'coordinateDirections', 'directions', 'timeZone', 'timezone',
  'timeDirection', 'latitudeDirection', 'latitudeOrder', 'longitudeDirection',
  'longitudeOrder', 'longitudeConvention', 'vertical', 'verticalCoordinate',
  'verticalCoordinateType', 'verticalPositive', 'positiveDirection', 'verticalReference',
  ...MATLAB_PLOT_REQUEST_FIELDS.filter((name) => ![
    'scientificQuestion', 'question',
    'functionName', 'figureId', 'outputDirectory', 'assetDirectory', 'title', 'source',
    'interactive', 'strictMetadata', 'interactionEnvironment', 'interactionRuntime',
  ].includes(name)),
]);
const PUBLICATION_CONTRACT_FIELDS = new Set([
  'target', 'medium', 'figureWidth', 'figureHeight', 'figureUnits', 'dpi', 'outputFormats',
  'layout', 'typography', 'color', 'clipping', 'localization', 'accessibility',
  'interaction', 'headless',
]);
const TASK_TOP_LEVEL_FIELDS = new Set([
  ...MATLAB_TASK_ROUTING_FIELDS,
  ...MATLAB_PLOT_REQUEST_FIELDS,
  ...SCIENTIFIC_CONTRACT_FIELDS,
  ...PUBLICATION_CONTRACT_FIELDS,
  'productionRelease', 'octaveAvailable',
]);
const ERROR_CODES = Object.freeze({
  invalidRequest: 'MATLAB_REQUEST_INVALID',
  needsInput: 'MATLAB_NEEDS_INPUT',
  runtimeUnavailable: 'MATLAB_RUNTIME_UNAVAILABLE',
  unsupportedRelease: 'MATLAB_UNSUPPORTED_RELEASE',
  missingToolbox: 'MATLAB_MISSING_TOOLBOX',
  unsupportedOutput: 'MATLAB_UNSUPPORTED_OUTPUT',
  routedToOctave: 'MATLAB_ROUTED_TO_OCTAVE',
  invalidTaskType: 'MATLAB_TASK_TYPE_INVALID',
  invalidRuntime: 'MATLAB_RUNTIME_INVALID',
});

const MATLAB_PLOT_QUALITY_CRITERIA = Object.freeze([
  'axisLabelsUnits', 'fontSize', 'lineWidth', 'legendOcclusion',
  'colorbarLabels', 'clippingRisk', 'outputResolution', 'accessibility',
]);

const MATLAB_QUALITY_GATE = Object.freeze({
  evaluator: 'inspectMatlabPlotQuality',
  minimumScore: 70,
  requiredBoolean: 'plotQualityScoreOk',
  blockingResult: 'matlabPlotQualityOk',
  preflightContract: 'publicationContract',
  requiredCriteria: MATLAB_PLOT_QUALITY_CRITERIA,
});

export function buildMatlabScientificDataContract(input = {}, options = {}) {
  input = objectValue(input) || {};
  const nested = objectValue(input.dataContract || input.scientificDataContract || input.scientificData);
  const required = options.required ?? Boolean(input.requireScientificContract || nested);
  const active = options.active ?? Boolean(required || nested);
  const source = nested || input;
  const rawShape = source.shape ?? source.dimensions;
  const shape = Array.isArray(rawShape) ? rawShape.map(Number) : [];
  const dimensionOrder = uniqueStrings(source.dimensionOrder || source.dimensionsOrder || []);
  const observationDimension = cleanValue(source.observationDimension || source.observationAxis);
  const coordinates = uniqueStrings(Array.isArray(source.coordinates)
    ? source.coordinates
    : Object.entries(objectValue(source.coordinates || source.axes) || {}).filter(([, value]) => Boolean(value)).map(([key]) => key));
  const quantities = normalizeMetadataMap(source.quantities || source.quantityNames);
  const units = normalizeMetadataMap(source.units);
  const missingSource = objectValue(source.missing) || {};
  const qcSource = objectValue(source.qc) || {};
  const uncertaintySource = objectValue(source.uncertainty) || {};
  const directions = objectValue(source.coordinateDirections || source.directions) || {};
  const verticalSource = objectValue(directions.vertical || source.vertical) || {};
  const missingStatus = normalizePresence(missingSource.status ?? source.missingStatus ?? source.hasMissing ?? source.missing);
  const qcStatus = normalizePresence(qcSource.status ?? source.qcStatus ?? source.hasQC ?? (Object.keys(qcSource).length ? true : undefined));
  const uncertaintyStatus = normalizePresence(
    uncertaintySource.status ?? source.uncertaintyStatus ?? source.hasUncertainty ?? (Object.keys(uncertaintySource).length ? true : undefined),
  );
  const unitConversions = normalizeUnitConversions(source.unitConversions || source.conversions);
  const contract = {
    schemaVersion: MATLAB_SCIENTIFIC_DATA_SCHEMA_VERSION,
    required: Boolean(required),
    provided: Boolean(active),
    dataType: cleanValue(source.dataType || source.type),
    shape,
    rank: shape.length,
    dimensionOrder,
    observationDimension,
    coordinates: {
      names: coordinates,
      timeZone: cleanValue(source.timeZone || source.timezone),
      directions: {
        time: cleanValue(directions.time || source.timeDirection),
        latitude: cleanValue(directions.latitude || source.latitudeDirection || source.latitudeOrder),
        longitude: cleanValue(directions.longitude || source.longitudeDirection || source.longitudeOrder),
      },
      longitudeConvention: cleanValue(source.longitudeConvention || directions.longitudeConvention),
      vertical: {
        coordinate: cleanValue(verticalSource.coordinate || source.verticalCoordinate || source.verticalCoordinateType),
        positive: cleanValue(verticalSource.positive || source.verticalPositive || source.positiveDirection),
        reference: cleanValue(verticalSource.reference || source.verticalReference),
      },
    },
    quantities,
    units,
    unitConversions,
    missing: {
      status: missingStatus,
      representation: cleanValue(missingSource.representation || source.missingRepresentation),
      maskVariables: uniqueStrings(missingSource.maskVariables || source.maskVariables || []),
    },
    qc: {
      status: qcStatus,
      variable: cleanValue(qcSource.variable || source.qcVariable),
      alignment: cleanValue(qcSource.alignment || source.qcAlignment),
      action: cleanValue(qcSource.action || source.qcAction || 'preserve'),
      flagMeanings: normalizeMetadataMap(qcSource.flagMeanings || source.qcFlagMeanings),
    },
    uncertainty: {
      status: uncertaintyStatus,
      type: cleanValue(uncertaintySource.type || source.uncertaintyType),
      unit: cleanValue(uncertaintySource.unit || source.uncertaintyUnit || units.uncertainty),
      alignment: cleanValue(uncertaintySource.alignment || source.uncertaintyAlignment),
      representation: cleanValue(uncertaintySource.representation || source.uncertaintyRepresentation),
      confidenceLevel: normalizeOptionalNumber(uncertaintySource.confidenceLevel ?? source.confidenceLevel),
    },
  };
  contract.unresolvedRequirements = active ? scientificContractIssues(contract, rawShape, unitConversions) : [];
  return deepFreeze(contract);
}

export function buildMatlabPublicationContract(input = {}, options = {}) {
  input = objectValue(input) || {};
  const nested = objectValue(input.publicationContract || input.presentationContract || input.figureContract);
  const required = options.required ?? Boolean(input.requirePublicationContract || nested);
  const active = options.active ?? Boolean(required || nested);
  const source = nested || input;
  const target = objectValue(source.target) || {};
  const layout = objectValue(source.layout) || {};
  const typography = objectValue(source.typography) || {};
  const color = objectValue(source.color) || {};
  const clipping = objectValue(source.clipping) || {};
  const localization = objectValue(source.localization) || {};
  const accessibility = objectValue(source.accessibility) || {};
  const interaction = objectValue(source.interaction) || {};
  const headless = objectValue(source.headless) || {};
  const requestedFormats = input.outputFormats === undefined ? [] : normalizeFormatList(input.outputFormats);
  const contract = {
    schemaVersion: MATLAB_PUBLICATION_SCHEMA_VERSION,
    required: Boolean(required),
    provided: Boolean(active),
    target: {
      medium: cleanValue(target.medium || source.medium),
      width: normalizeOptionalNumber(target.width ?? source.figureWidth),
      height: normalizeOptionalNumber(target.height ?? source.figureHeight),
      units: cleanValue(target.units || source.figureUnits).toLowerCase(),
      dpi: normalizeOptionalNumber(target.dpi ?? source.dpi),
      formats: normalizeFormatList(target.formats || source.outputFormats || input.outputFormats || []),
    },
    layout: {
      architecture: cleanValue(layout.architecture),
      rows: normalizeOptionalNumber(layout.rows),
      columns: normalizeOptionalNumber(layout.columns),
      tileSpacing: cleanValue(layout.tileSpacing),
      padding: cleanValue(layout.padding),
      readingOrder: cleanValue(layout.readingOrder),
      explicitHandles: normalizeOptionalBoolean(layout.explicitHandles),
      legendPlacement: cleanValue(layout.legendPlacement),
      colorbarPlacement: cleanValue(layout.colorbarPlacement),
    },
    typography: {
      fontFamily: cleanValue(typography.fontFamily),
      fallbackFamilies: uniqueStrings(typography.fallbackFamilies || []),
      baseSizePt: normalizeOptionalNumber(typography.baseSizePt),
      labelSizePt: normalizeOptionalNumber(typography.labelSizePt),
      titleSizePt: normalizeOptionalNumber(typography.titleSizePt),
      lineWidthPt: normalizeOptionalNumber(typography.lineWidthPt),
      interpreter: cleanValue(typography.interpreter).toLowerCase(),
    },
    color: {
      paletteClass: cleanValue(color.paletteClass).toLowerCase(),
      paletteSource: cleanValue(color.paletteSource),
      background: cleanValue(color.background),
      missingAppearance: cleanValue(color.missingAppearance),
      minimumContrastRatio: normalizeOptionalNumber(color.minimumContrastRatio),
      colorOnlyEncodingAllowed: normalizeOptionalBoolean(color.colorOnlyEncodingAllowed),
      colorVisionCheckRequired: normalizeOptionalBoolean(color.colorVisionCheckRequired),
      grayscaleCheckRequired: normalizeOptionalBoolean(color.grayscaleCheckRequired),
    },
    clipping: {
      drawnowBeforeAudit: normalizeOptionalBoolean(clipping.drawnowBeforeAudit),
      boundsCheckRequired: normalizeOptionalBoolean(clipping.boundsCheckRequired),
      overlapCheckRequired: normalizeOptionalBoolean(clipping.overlapCheckRequired),
    },
    localization: {
      encoding: cleanValue(localization.encoding),
      languages: uniqueStrings(localization.languages || []),
      chineseRequired: normalizeOptionalBoolean(localization.chineseRequired),
      glyphCheckRequired: normalizeOptionalBoolean(localization.glyphCheckRequired),
      glyphFormats: normalizeFormatList(localization.glyphFormats || []),
    },
    accessibility: {
      descriptionRequired: normalizeOptionalBoolean(accessibility.descriptionRequired),
      redundantEncodingRequired: normalizeOptionalBoolean(accessibility.redundantEncodingRequired),
      readingOrderCheckRequired: normalizeOptionalBoolean(accessibility.readingOrderCheckRequired),
    },
    interaction: {
      mode: cleanValue(interaction.mode).toLowerCase(),
      stableObservationIdsRequired: normalizeOptionalBoolean(interaction.stableObservationIdsRequired),
      targetScopedCallbacksRequired: normalizeOptionalBoolean(interaction.targetScopedCallbacksRequired),
      cleanupRequired: normalizeOptionalBoolean(interaction.cleanupRequired),
      staticFallbackRequired: normalizeOptionalBoolean(interaction.staticFallbackRequired),
    },
    headless: {
      supported: normalizeOptionalBoolean(headless.supported),
      command: cleanValue(headless.command),
      figureVisible: cleanValue(headless.figureVisible).toLowerCase(),
      exportApi: cleanValue(headless.exportApi).toLowerCase(),
      exportApis: normalizeExportApiMap(headless.exportApis),
      desktopIndependent: normalizeOptionalBoolean(headless.desktopIndependent),
    },
  };
  contract.unresolvedRequirements = active
    ? publicationContractIssues(contract, normalizeTaskType(input.taskType || input.intent) || 'create', requestedFormats)
    : [];
  return deepFreeze(contract);
}

export function buildMatlabOutputContract(input = {}, options = {}) {
  input = objectValue(input) || {};
  const manifestSource = objectValue(input.manifestContract) || {};
  const formats = normalizeFormatList(input.outputFormats || ['png', 'pdf']);
  const rawManifestRequired = manifestSource.required ?? input.manifestRequired;
  const manifestRequired = rawManifestRequired === undefined ? true : strictOptionalBoolean(rawManifestRequired);
  const contract = {
    schemaVersion: MATLAB_OUTPUT_SCHEMA_VERSION,
    sourceRequired: true,
    formats,
    exportStrategies: normalizeExportStrategies(options.capabilities?.exportFormats),
    relativePathsOnly: true,
    runtimeEvidenceRequired: true,
    artifactValidationRequired: true,
    visualInspectionRequired: true,
    manifest: {
      required: manifestRequired,
      schemaVersion: normalizeOptionalNumber(
        manifestSource.schemaVersion ?? manifestSource.schema_version ?? MATLAB_MANIFEST_SCHEMA_VERSION,
      ),
      path: cleanValue(manifestSource.path || input.manifestPath || 'figures.json'),
      relativePathsOnly: strictBooleanWithDefault(manifestSource.relativePathsOnly, true),
      deterministicOrderRequired: strictBooleanWithDefault(manifestSource.deterministicOrderRequired, true),
      freshArtifactsOnly: strictBooleanWithDefault(manifestSource.freshArtifactsOnly, true),
      verifiedArtifactsOnly: strictBooleanWithDefault(manifestSource.verifiedArtifactsOnly, true),
      requiredTopLevelFields: Object.freeze([
        'schema_version', 'generated_at', 'generator', 'runtime_status', 'execution_verified',
        'matlab_release', 'toolboxes', 'artifact_validation', 'visual_inspection',
        'warnings', 'errors', 'figures',
      ]),
      requiredFigureFields: Object.freeze([
        'id', 'title', 'source', 'theme', 'exports', 'text_objects', 'axes_objects',
        'accessibility', 'rendering_evidence', 'publication', 'interaction',
      ]),
      requiredExportFields: buildManifestExportFields(formats),
    },
    fields: Object.freeze([
      'runtime_status', 'execution_verified', 'matlab_release', 'toolboxes', 'source', 'artifacts',
      'scientific_data_contract', 'publication_contract', 'manifest', 'artifact_validation',
      'visual_inspection', 'warnings', 'errors',
    ]),
  };
  contract.manifestRequired = contract.manifest.required;
  contract.unresolvedRequirements = outputContractIssues(contract);
  return deepFreeze(contract);
}

const MATLAB_SCIENTIFIC_FLAT_FIELDS = traceContractInputFields(buildMatlabScientificDataContract);
const MATLAB_PUBLICATION_FLAT_FIELDS = traceContractInputFields(buildMatlabPublicationContract);

export function isMatlabJsonObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

export function assertMatlabRequestJson(value, label = 'MATLAB request') {
  const seen = new Set();
  let nodes = 0;
  const visit = (item, path, depth) => {
    nodes += 1;
    if (nodes > MATLAB_REQUEST_LIMITS.maxNodes) {
      throw new Error(`${label} exceeds the ${MATLAB_REQUEST_LIMITS.maxNodes}-node JSON limit.`);
    }
    if (typeof item === 'string') {
      if (item.length > MATLAB_REQUEST_LIMITS.maxStringLength) {
        throw new Error(`${path} exceeds the ${MATLAB_REQUEST_LIMITS.maxStringLength}-character string limit.`);
      }
      return;
    }
    if (item === undefined || item === null || typeof item === 'boolean') return;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new Error(`${path} must be a finite JSON number.`);
      return;
    }
    if (typeof item !== 'object') throw new Error(`${path} contains a non-JSON ${typeof item} value.`);
    if (depth > MATLAB_REQUEST_LIMITS.maxDepth) {
      throw new Error(`${path} exceeds the maximum JSON depth of ${MATLAB_REQUEST_LIMITS.maxDepth}.`);
    }
    if (seen.has(item)) throw new Error(`${path} contains a cyclic object reference.`);
    seen.add(item);
    if (Array.isArray(item)) {
      if (item.length > MATLAB_REQUEST_LIMITS.maxArrayLength) {
        throw new Error(`${path} exceeds the ${MATLAB_REQUEST_LIMITS.maxArrayLength}-item array limit.`);
      }
      if (Object.getPrototypeOf(item) !== Array.prototype) throw new Error(`${path} must use the standard Array prototype.`);
      const arrayKeys = Reflect.ownKeys(item);
      const extraKeys = arrayKeys.filter((key) => key !== 'length' && (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(key)));
      if (extraKeys.length) throw new Error(`${path} contains non-index array properties.`);
      const arrayDescriptors = Object.getOwnPropertyDescriptors(item);
      for (let index = 0; index < item.length; index += 1) {
        if (!Object.hasOwn(item, index)) throw new Error(`${path} must not contain sparse array holes.`);
        const descriptor = arrayDescriptors[index];
        if (descriptor.get || descriptor.set || descriptor.enumerable !== true) {
          throw new Error(`${path}[${index}] must be an enumerable data property.`);
        }
        if (descriptor.value === undefined) throw new Error(`${path}[${index}] must not be undefined.`);
        visit(descriptor.value, `${path}[${index}]`, depth + 1);
      }
      seen.delete(item);
      return;
    }
    if (!isMatlabJsonObject(item)) throw new Error(`${path} must be a plain JSON object.`);
    const keys = Reflect.ownKeys(item);
    if (keys.some((key) => typeof key !== 'string')) throw new Error(`${path} contains a symbol-keyed property.`);
    if (keys.length > MATLAB_REQUEST_LIMITS.maxObjectKeys) {
      throw new Error(`${path} exceeds the ${MATLAB_REQUEST_LIMITS.maxObjectKeys}-key object limit.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(item);
    for (const key of keys) {
      if (MATLAB_FORBIDDEN_OBJECT_KEYS.has(key)) throw new Error(`${path}.${key} is a forbidden object key.`);
      if (key.length > MATLAB_REQUEST_LIMITS.maxStringLength) throw new Error(`${path} contains an oversized object key.`);
      if (descriptors[key].get || descriptors[key].set || descriptors[key].enumerable !== true) {
        throw new Error(`${path}.${key} must be an enumerable data property.`);
      }
      visit(descriptors[key].value, `${path}.${key}`, depth + 1);
    }
    seen.delete(item);
  };
  visit(value, label, 0);
}

export function assertMatlabTaskRequestShape(input) {
  assertMatlabRequestJson(input);
  if (!objectValue(input)) throw new Error('MATLAB route input must be a JSON object.');
  const issue = validateTaskClosedWorld(input);
  if (issue) throw new Error(issue);
}

export function matlabTaskRoutingFieldsPresent(input = {}) {
  const source = objectValue(input);
  if (!source) return Object.freeze([]);
  return Object.freeze(MATLAB_TASK_ROUTING_FIELDS.filter((name) => Object.hasOwn(source, name)));
}

export function rejectMatlabTaskRequest(input, reason, nextAction = 'Correct the request contract and retry routing.') {
  const safeInput = objectValue(input) || {};
  return finish(baseContract('create', 'auto', 'matlab', false, safeInput), 'needs-input', ERROR_CODES.invalidRequest,
    reason, nextAction);
}

export function routeMatlabTask(input = {}) {
  try {
    assertMatlabTaskRequestShape(input);
  } catch (error) {
    return rejectMatlabTaskRequest({}, String(error?.message || error));
  }
  const objectFields = [
    'dataContract', 'scientificDataContract', 'scientificData',
    'publicationContract', 'presentationContract', 'figureContract',
    'manifestContract', 'toolboxAvailability',
  ];
  const invalidObjectFields = objectFields.filter((name) => input[name] !== undefined && !objectValue(input[name]));
  if (invalidObjectFields.length) {
    return rejectMatlabTaskRequest(input,
      `Route contract fields must use JSON objects: ${invalidObjectFields.join(', ')}.`,
      'Replace arrays, strings, numbers, or null contract values with JSON objects.');
  }
  for (const { names, label } of [
    { names: ['dataContract', 'scientificDataContract', 'scientificData'], label: 'scientific data contract' },
    { names: ['publicationContract', 'presentationContract', 'figureContract'], label: 'publication contract' },
    { names: ['requiredToolboxes', 'toolboxes'], label: 'required toolbox list' },
  ]) {
    const supplied = ownDefinedFields(input, names);
    if (supplied.length > 1) {
      return rejectMatlabTaskRequest(input,
        `${label} aliases are mutually exclusive: ${supplied.join(', ')}.`,
        `Provide ${label} through exactly one canonical request field.`);
    }
  }
  const scientificContractField = ownDefinedFields(
    input, ['dataContract', 'scientificDataContract', 'scientificData'],
  )[0];
  if (scientificContractField) {
    const flatFields = ownDefinedFields(input, MATLAB_SCIENTIFIC_FLAT_FIELDS);
    if (flatFields.length) {
      return rejectMatlabTaskRequest(input,
        `${scientificContractField} cannot be combined with flat scientific metadata: ${flatFields.join(', ')}.`,
        `Keep all scientific metadata inside ${scientificContractField}, with plot-only metadata outside it.`);
    }
  }
  const publicationContractField = ownDefinedFields(
    input, ['publicationContract', 'presentationContract', 'figureContract'],
  )[0];
  if (publicationContractField) {
    const flatFields = ownDefinedFields(input, MATLAB_PUBLICATION_FLAT_FIELDS);
    if (flatFields.length) {
      return rejectMatlabTaskRequest(input,
        `${publicationContractField} cannot be combined with flat publication metadata: ${flatFields.join(', ')}.`,
        `Keep all publication metadata inside ${publicationContractField}, with plot-only metadata outside it.`);
    }
  }
  const invalidBooleanFields = [
    'matlabAvailable', 'matlabFirst', 'requiresMatlabNative', 'octaveFirst', 'requiresOctaveRender',
    'requireScientificContract', 'requirePublicationContract', 'manifestRequired',
  ].filter((name) => input[name] !== undefined && typeof input[name] !== 'boolean');
  const manifestSource = objectValue(input.manifestContract) || {};
  for (const name of ['required', 'relativePathsOnly', 'deterministicOrderRequired', 'freshArtifactsOnly', 'verifiedArtifactsOnly']) {
    if (manifestSource[name] !== undefined && typeof manifestSource[name] !== 'boolean') {
      invalidBooleanFields.push(`manifestContract.${name}`);
    }
  }
  if (typeof input.manifestRequired === 'boolean' && typeof manifestSource.required === 'boolean'
      && input.manifestRequired !== manifestSource.required) {
    return rejectMatlabTaskRequest(input,
      'manifestRequired and manifestContract.required conflict.', 'Provide one consistent manifest requirement.');
  }
  if (invalidBooleanFields.length) {
    return rejectMatlabTaskRequest(input,
      `Boolean route fields must use JSON booleans: ${invalidBooleanFields.join(', ')}.`,
      'Replace string, numeric, or null boolean values with true or false.');
  }
  const runtimeAlias = resolveNormalizedAlias(input.runtime, input.requestedRuntime, normalizeRuntime, 'auto');
  if (runtimeAlias.invalid || runtimeAlias.conflict || runtimeAlias.duplicate) {
    return finish(baseContract('create', 'auto', 'matlab', false, input), 'needs-input', ERROR_CODES.invalidRuntime,
      runtimeAlias.duplicate ? 'runtime and requestedRuntime are duplicate aliases.'
        : runtimeAlias.conflict ? 'runtime and requestedRuntime conflict.' : 'Runtime must be matlab, octave, or auto.',
      'Provide one consistent runtime selector.');
  }
  const taskAlias = resolveNormalizedAlias(input.taskType, input.intent, normalizeTaskType, 'create');
  if (taskAlias.invalid || taskAlias.conflict || taskAlias.duplicate) {
    return finish(baseContract('create', runtimeAlias.value, 'matlab', runtimeAlias.value === 'matlab', input),
      'needs-input', ERROR_CODES.invalidTaskType,
      taskAlias.duplicate ? 'taskType and intent are duplicate aliases.'
        : taskAlias.conflict ? 'taskType and intent conflict.' : 'Task type is not supported.',
      'Provide one consistent create, repair, refine, inspect, export, interactive, or portability value.');
  }
  const requestedRuntime = runtimeAlias.value;
  const taskType = taskAlias.value;
  const explicitMatlabSignal = input.matlabFirst === true || input.requiresMatlabNative === true;
  const explicitOctaveSignal = input.octaveFirst === true || input.requiresOctaveRender === true;
  if ((explicitMatlabSignal && explicitOctaveSignal)
      || (requestedRuntime === 'matlab' && explicitOctaveSignal)
      || (requestedRuntime === 'octave' && explicitMatlabSignal)) {
    return finish(baseContract(taskType, requestedRuntime, 'matlab', false, input), 'needs-input', ERROR_CODES.invalidRuntime,
      'MATLAB-first and Octave-first routing signals conflict.', 'Remove the contradictory runtime requirement.');
  }
  if (!requestedRuntime) {
    return finish(baseContract('create', 'auto', 'matlab', false, input), 'needs-input', ERROR_CODES.invalidRuntime,
      `Unknown runtime: ${String(input.runtime || input.requestedRuntime)}.`, 'Use runtime="matlab", runtime="octave", or runtime="auto".');
  }
  if (!taskType) {
    return finish(baseContract('create', requestedRuntime, 'matlab', requestedRuntime === 'matlab', input),
      'needs-input', ERROR_CODES.invalidTaskType, `Unknown MATLAB task type: ${String(input.taskType || input.intent)}.`,
      'Use create, repair, refine, inspect, export, interactive, or portability.');
  }
  const explicitMatlab = requestedRuntime === 'matlab' || explicitMatlabSignal;
  const explicitOctave = requestedRuntime === 'octave' || explicitOctaveSignal;
  const base = baseContract(taskType, requestedRuntime, explicitOctave ? 'octave' : 'matlab', explicitMatlab && !explicitOctave, input);

  if (explicitOctave) {
    return finish(base, 'routed-to-octave', ERROR_CODES.routedToOctave,
      'The request explicitly requires GNU Octave or an Octave-rendered artifact.',
      'Route to octave-scientific-plotting and stop MATLAB code generation.');
  }

  let targetRelease;
  try {
    const targetReleaseValue = input.targetRelease === undefined ? null : normalizeMatlabRelease(input.targetRelease, null);
    const matlabReleaseValue = input.matlabRelease === undefined ? null : normalizeMatlabRelease(input.matlabRelease, null);
    if (input.targetRelease !== undefined && input.matlabRelease !== undefined) {
      return finish(base, 'unsupported-release', ERROR_CODES.unsupportedRelease,
        'targetRelease and matlabRelease are duplicate aliases.', 'Provide the MATLAB release through one field only.');
    }
    if (targetReleaseValue && matlabReleaseValue && targetReleaseValue !== matlabReleaseValue) {
      return finish(base, 'unsupported-release', ERROR_CODES.unsupportedRelease,
        'targetRelease and matlabRelease conflict.', 'Provide one consistent MATLAB release.');
    }
    targetRelease = targetReleaseValue || matlabReleaseValue || MATLAB_RELEASE_RANGE.latestKnown;
  } catch (error) {
    return finish(base, 'unsupported-release', ERROR_CODES.unsupportedRelease,
      String(error?.message || error), `Choose a release between ${MATLAB_RELEASE_RANGE.earliest} and ${MATLAB_RELEASE_RANGE.latestKnown}.`);
  }

  const requiredToolboxes = uniqueStrings(input.requiredToolboxes || input.toolboxes || []);
  const requestedCapabilities = uniqueStrings(input.requestedCapabilities || []);
  const outputFormats = normalizeFormatList(input.outputFormats || ['png', 'pdf']);
  let capabilities;
  try {
    capabilities = resolveMatlabPlotCapabilities({
      targetRelease,
      runtime: 'matlab',
      requested: requestedCapabilities,
      exportFormats: outputFormats,
      toolboxes: requiredToolboxes,
    });
  } catch (error) {
    const message = String(error?.message || error);
    const unsupportedOutput = /format|export|svg|eps|png|pdf|jpeg|tiff/iu.test(message);
    return finish({ ...base, targetRelease }, unsupportedOutput ? 'unsupported-output' : 'missing-toolbox',
      unsupportedOutput ? ERROR_CODES.unsupportedOutput : ERROR_CODES.missingToolbox,
      message, 'Correct the requested format or toolbox identifier and retry routing.');
  }
  const routedBase = {
    ...base,
    outputContract: buildMatlabOutputContract(input, { capabilities }),
  };

  if (input.toolboxAvailability !== undefined && !objectValue(input.toolboxAvailability)) {
    return finish({ ...routedBase, targetRelease, capabilities, requiredToolboxes }, 'needs-input', ERROR_CODES.invalidRequest,
      'toolboxAvailability must be a JSON object of boolean values.', 'Provide true or false for each required toolbox.');
  }
  const invalidToolboxAvailability = requiredToolboxes.filter((name) => (
    input.toolboxAvailability?.[name] !== undefined && typeof input.toolboxAvailability[name] !== 'boolean'
  ));
  if (invalidToolboxAvailability.length) {
    return finish({ ...routedBase, targetRelease, capabilities, requiredToolboxes }, 'needs-input', ERROR_CODES.invalidRequest,
      `Toolbox availability must use JSON booleans: ${invalidToolboxAvailability.join(', ')}.`,
      'Replace string, numeric, or null availability values with true or false.');
  }
  const unavailableToolboxes = requiredToolboxes.filter((name) => input.toolboxAvailability?.[name] === false);
  if (unavailableToolboxes.length) {
    return finish({ ...routedBase, targetRelease, capabilities, requiredToolboxes }, 'missing-toolbox', ERROR_CODES.missingToolbox,
      `Required MATLAB toolbox is unavailable: ${unavailableToolboxes.join(', ')}.`,
      'Install/enable the toolbox or select a documented scientifically equivalent MATLAB fallback.');
  }

  const unsupportedFormats = Object.values(capabilities.exportFormats).filter((entry) => entry.status === 'unsupported');
  if (unsupportedFormats.length) {
    return finish({ ...routedBase, targetRelease, capabilities, requiredToolboxes }, 'unsupported-output', ERROR_CODES.unsupportedOutput,
      unsupportedFormats.map((entry) => entry.reason).join(' '),
      'Choose a supported format or a newer MATLAB release; do not substitute formats silently.');
  }

  const unresolved = uniqueStrings([
    ...uniqueStrings(input.unresolvedRequirements || []),
    ...routedBase.scientificDataContract.unresolvedRequirements,
    ...routedBase.publicationContract.unresolvedRequirements,
    ...routedBase.outputContract.unresolvedRequirements,
    ...publicationCapabilityIssues(routedBase.publicationContract, capabilities, outputFormats),
  ]);
  if (unresolved.length) {
    return finish({ ...routedBase, targetRelease, capabilities, requiredToolboxes, unresolvedRequirements: unresolved },
      'needs-input', ERROR_CODES.needsInput, `Required task metadata is unresolved: ${unresolved.join(', ')}.`,
      'Provide the missing metadata before code generation or execution.');
  }

  if (input.matlabAvailable === false) {
    return finish({ ...routedBase, targetRelease, capabilities, requiredToolboxes },
      'runtime-unavailable', ERROR_CODES.runtimeUnavailable, 'MATLAB is the authoritative runtime but was not found or verified.',
      'Return static validation only, with execution_verified=false; do not run Octave as a substitute.');
  }

  return Object.freeze({
    ...routedBase,
    targetRelease,
    requiredToolboxes,
    capabilities,
    status: 'ready',
    ready: true,
    error: null,
    executionPolicy: input.matlabAvailable === true ? 'execute-and-verify' : 'probe-before-execution',
  });
}

export function matlabTaskRoutingInstructionBlock() {
  return String.raw`【MATLAB-first 任务分诊与状态契约】
- 先判定任务类型 create/repair/refine/inspect/export/interactive/portability，再判定权威运行时；显式 MATLAB、MATLAB release、工具箱或 MATLAB-native API 请求必须走 MATLAB-first。
- 显式 Octave-first、Octave-only 或 Octave-rendered 请求返回 routed-to-octave 并停止 MATLAB 生成；不得因 .m 扩展名改变运行时。
- 执行前解析目标 release、所需工具箱、输出格式和可机读 scientificDataContract。数据契约须声明原始 shape、dimensionOrder、observationDimension、数据类型、坐标、变量物理量与单位，以及缺测、QC 和不确定度的 present/absent 状态。
- 时间坐标须使用 datetime/timetable 并声明 TimeZone 与顺序；经纬度须声明经度约定和坐标顺序；垂向坐标须声明 depth/pressure/height/elevation、正方向和基准。任何单位换算须记录 sourceUnit、targetUnit 和 formula。
- 缺测存在时声明 NaN/NaT/sentinel 表示；QC 存在时声明逐观测对齐变量、flag meanings，并分别保留 missing/invalid/suspect 掩膜；不确定度存在时声明类型、单位和对齐维。未决项返回 needs-input，不得自动 squeeze、transpose、sort、fillmissing、插值、坐标翻转或单位换算。
- 出版或交互交付须设置 requirePublicationContract=true，并声明最终物理尺寸/DPI/格式、layout 与显式句柄、字体字号线宽、色图类别与来源、对比度和非纯颜色编码、drawnow 后裁剪/重叠检查、UTF-8 中文字形验收、可访问描述，以及 MATLAB 无界面静态降级。
- interactive 请求必须声明 interaction.mode=dual、稳定观测 ID、event.Target/DataIndex 作用域回调、清理策略和不依赖桌面状态的静态 fallback。R2019a 及更新版本使用 matlab -batch；更旧版本必须使用含 try/catch/exit 的 matlab -r，并保留失败退出码。PNG/PDF/SVG 按 release 逐格式选择 exportgraphics 或 print，混合 API 时声明 headless.exportApis 映射，不得用单一 API 或替代格式掩盖差异。
- 状态只使用 ready、needs-input、runtime-unavailable、unsupported-release、missing-toolbox、unsupported-output、routed-to-octave、failed。
- 请求体视为不可信 JSON：只接受普通 JSON object，拒绝数组、Date/Map/类实例和自定义原型对象；runtime/requestedRuntime、taskType/intent、targetRelease/matlabRelease 冲突，以及 MATLAB-first/Octave-first 同时出现均须阻断；availability 和 required 字段只接受 JSON boolean，不得把字符串 "false" 当作可用或关闭门禁。
- runtime、release、task、toolbox、contract 与 output 字段仅允许位于请求顶层；plotInput 与兼容别名 plot 互斥。嵌套路由字段或顶层与 plot 对象中的重名元数据必须返回 MATLAB_REQUEST_INVALID，不得依赖对象展开顺序选择值。
- 输出扩展名先归一化再去重；manifest 路径拒绝 URI、绝对路径、.. 穿越与控制字符。旧版 matlab -r 的 catch 分支必须以非零 exit 保留失败，不得用 exit(0) 伪装成功。
- 非 ready 状态必须返回稳定错误码、原因和可恢复下一步；MATLAB 不可用时 execution_verified=false，只做静态检查，不得静默运行 Octave。
- 输出契约必须包含 .m 源码、相对 artifact/manifest 路径、runtime_status、MATLAB release、工具箱、执行证据、产物验证、视觉检查、warnings 和结构化 errors。manifest 使用 schema_version=2、确定顺序、相对路径，并逐格式记录尺寸、字节、SHA-256 与文本/字体证据；只有真实验证通过的新产物才能入表。预检只声明必做验收，实际通过仍须由 inspectMatlabPlotQuality 和产物证据确认。`;
}

function baseContract(taskType, requestedRuntime, authoritativeRuntime, matlabFirst, input) {
  return {
    schemaVersion: MATLAB_TASK_ROUTING_SCHEMA_VERSION,
    taskType,
    requestedRuntime,
    authoritativeRuntime,
    matlabFirst,
    scientificDataContract: buildMatlabScientificDataContract(input),
    publicationContract: buildMatlabPublicationContract(input),
    outputContract: buildMatlabOutputContract(input),
    qualityGate: MATLAB_QUALITY_GATE,
  };
}

function finish(base, status, code, reason, nextAction) {
  return Object.freeze({ ...base, status, ready: false, error: Object.freeze({ code, reason, nextAction }) });
}

function normalizeRuntime(value) {
  const runtime = String(value || 'auto').trim().toLowerCase();
  return ['matlab', 'octave', 'auto'].includes(runtime) ? runtime : null;
}

function normalizeTaskType(value) {
  const taskType = String(value || 'create').trim().toLowerCase();
  return MATLAB_TASK_TYPES.has(taskType) ? taskType : null;
}

function publicationContractIssues(contract, taskType, requestedFormats) {
  const issues = [];
  const required = contract.required;
  const positiveFields = [
    ['target.width', contract.target.width],
    ['target.height', contract.target.height],
    ['target.dpi', contract.target.dpi],
    ['typography.baseSizePt', contract.typography.baseSizePt],
    ['typography.labelSizePt', contract.typography.labelSizePt],
    ['typography.titleSizePt', contract.typography.titleSizePt],
    ['typography.lineWidthPt', contract.typography.lineWidthPt],
  ];
  for (const [name, value] of positiveFields) {
    if (value !== null && !(value > 0)) issues.push(`publicationContract.${name} positive`);
  }
  if (!required) return uniqueStrings(issues);

  if (!contract.target.medium) issues.push('publicationContract.target.medium');
  if (!(contract.target.width > 0)) issues.push('publicationContract.target.width');
  if (!(contract.target.height > 0)) issues.push('publicationContract.target.height');
  if (!['cm', 'centimeter', 'centimeters', 'in', 'inch', 'inches'].includes(contract.target.units)) {
    issues.push('publicationContract.target.units physical cm/in');
  }
  if (!(contract.target.dpi >= 150)) issues.push('publicationContract.target.dpi >= 150');
  if (!contract.target.formats.length) issues.push('publicationContract.target.formats');
  if (requestedFormats.length && !sameStringSet(contract.target.formats, requestedFormats)) {
    issues.push('publicationContract.target.formats matching outputFormats');
  }

  if (!['single-axes', 'tiledlayout', 'explicit-axes'].includes(contract.layout.architecture)) {
    issues.push('publicationContract.layout.architecture');
  }
  if (contract.layout.architecture === 'tiledlayout') {
    if (!(Number.isInteger(contract.layout.rows) && contract.layout.rows > 0)) issues.push('publicationContract.layout.rows');
    if (!(Number.isInteger(contract.layout.columns) && contract.layout.columns > 0)) issues.push('publicationContract.layout.columns');
    if (!contract.layout.tileSpacing) issues.push('publicationContract.layout.tileSpacing');
    if (!contract.layout.padding) issues.push('publicationContract.layout.padding');
  }
  if (!contract.layout.readingOrder) issues.push('publicationContract.layout.readingOrder');
  requireTrue(issues, 'publicationContract.layout.explicitHandles', contract.layout.explicitHandles);
  if (!contract.layout.legendPlacement) issues.push('publicationContract.layout.legendPlacement (or none)');
  if (!contract.layout.colorbarPlacement) issues.push('publicationContract.layout.colorbarPlacement (or none)');

  if (!contract.typography.fontFamily) issues.push('publicationContract.typography.fontFamily');
  if (!(contract.typography.baseSizePt >= 8)) issues.push('publicationContract.typography.baseSizePt >= 8');
  if (!(contract.typography.labelSizePt >= 9)) issues.push('publicationContract.typography.labelSizePt >= 9');
  if (!(contract.typography.titleSizePt >= 10)) issues.push('publicationContract.typography.titleSizePt >= 10');
  if (!(contract.typography.lineWidthPt >= 0.75)) issues.push('publicationContract.typography.lineWidthPt >= 0.75');
  if (!['none', 'tex', 'latex'].includes(contract.typography.interpreter)) issues.push('publicationContract.typography.interpreter');

  if (!['sequential', 'diverging', 'cyclic', 'categorical', 'mixed'].includes(contract.color.paletteClass)) {
    issues.push('publicationContract.color.paletteClass');
  }
  if (!contract.color.paletteSource) issues.push('publicationContract.color.paletteSource');
  if (!contract.color.background) issues.push('publicationContract.color.background');
  if (!contract.color.missingAppearance) issues.push('publicationContract.color.missingAppearance');
  if (!(contract.color.minimumContrastRatio >= 4.5)) issues.push('publicationContract.color.minimumContrastRatio >= 4.5');
  requireFalse(issues, 'publicationContract.color.colorOnlyEncodingAllowed', contract.color.colorOnlyEncodingAllowed);
  requireTrue(issues, 'publicationContract.color.colorVisionCheckRequired', contract.color.colorVisionCheckRequired);
  requireTrue(issues, 'publicationContract.color.grayscaleCheckRequired', contract.color.grayscaleCheckRequired);

  requireTrue(issues, 'publicationContract.clipping.drawnowBeforeAudit', contract.clipping.drawnowBeforeAudit);
  requireTrue(issues, 'publicationContract.clipping.boundsCheckRequired', contract.clipping.boundsCheckRequired);
  requireTrue(issues, 'publicationContract.clipping.overlapCheckRequired', contract.clipping.overlapCheckRequired);

  if (contract.localization.encoding.toLowerCase() !== 'utf-8') issues.push('publicationContract.localization.encoding UTF-8');
  if (contract.localization.chineseRequired === null) issues.push('publicationContract.localization.chineseRequired true/false');
  requireTrue(issues, 'publicationContract.localization.glyphCheckRequired', contract.localization.glyphCheckRequired);
  for (const format of contract.target.formats) {
    if (!contract.localization.glyphFormats.includes(format)) issues.push(`publicationContract.localization.glyphFormats.${format}`);
  }
  if (contract.localization.chineseRequired === true) {
    if (!contract.localization.languages.some((value) => /^zh(?:-|$)/iu.test(value))) issues.push('publicationContract.localization.languages zh');
    if (!contract.typography.fallbackFamilies.length) issues.push('publicationContract.typography.fallbackFamilies for Chinese');
    if (contract.typography.interpreter !== 'none') issues.push('publicationContract.typography.interpreter none for Chinese');
  }

  requireTrue(issues, 'publicationContract.accessibility.descriptionRequired', contract.accessibility.descriptionRequired);
  requireTrue(issues, 'publicationContract.accessibility.redundantEncodingRequired', contract.accessibility.redundantEncodingRequired);
  requireTrue(issues, 'publicationContract.accessibility.readingOrderCheckRequired', contract.accessibility.readingOrderCheckRequired);

  if (!['static', 'dual'].includes(contract.interaction.mode)) issues.push('publicationContract.interaction.mode static/dual');
  if (taskType === 'interactive' && contract.interaction.mode !== 'dual') {
    issues.push('publicationContract.interaction.mode dual for interactive task');
  }
  if (contract.interaction.mode === 'dual') {
    requireTrue(issues, 'publicationContract.interaction.stableObservationIdsRequired', contract.interaction.stableObservationIdsRequired);
    requireTrue(issues, 'publicationContract.interaction.targetScopedCallbacksRequired', contract.interaction.targetScopedCallbacksRequired);
    requireTrue(issues, 'publicationContract.interaction.cleanupRequired', contract.interaction.cleanupRequired);
    requireTrue(issues, 'publicationContract.interaction.staticFallbackRequired', contract.interaction.staticFallbackRequired);
  }

  requireTrue(issues, 'publicationContract.headless.supported', contract.headless.supported);
  if (!/\bmatlab\b[\s\S]*\s-(?:batch|r)(?:\s|$)/iu.test(contract.headless.command)) {
    issues.push('publicationContract.headless.command matlab -batch or release-compatible matlab -r');
  }
  if (contract.headless.figureVisible !== 'off') issues.push('publicationContract.headless.figureVisible off');
  if (contract.headless.exportApi && !['exportgraphics', 'print'].includes(contract.headless.exportApi)) {
    issues.push('publicationContract.headless.exportApi exportgraphics/print');
  }
  for (const [format, api] of Object.entries(contract.headless.exportApis)) {
    if (!contract.target.formats.includes(format) || !['exportgraphics', 'print'].includes(api.toLowerCase())) {
      issues.push(`publicationContract.headless.exportApis.${format} exportgraphics/print`);
    }
  }
  if (!contract.headless.exportApi && !Object.keys(contract.headless.exportApis).length) {
    issues.push('publicationContract.headless.exportApi or exportApis');
  }
  requireTrue(issues, 'publicationContract.headless.desktopIndependent', contract.headless.desktopIndependent);
  return uniqueStrings(issues);
}

function publicationCapabilityIssues(contract, capabilities, outputFormats) {
  if (!contract.required || !capabilities) return [];
  const issues = [];
  if (!sameStringSet(contract.target.formats, outputFormats)) {
    issues.push('publicationContract.target.formats matching outputFormats');
  }
  const exportPlans = capabilities.exportFormats || {};
  const exportApis = uniqueStrings(Object.values(exportPlans).map((entry) => entry.api));
  if (exportApis.length === 1 && contract.headless.exportApi !== exportApis[0]) {
    issues.push(`publicationContract.headless.exportApi matching target release (${exportApis[0]})`);
  }
  const hasPerFormatApis = Object.keys(contract.headless.exportApis).length > 0;
  if (exportApis.length > 1 || hasPerFormatApis) {
    for (const [format, plan] of Object.entries(exportPlans)) {
      if (contract.headless.exportApis[format]?.toLowerCase() !== plan.api) {
        issues.push(`publicationContract.headless.exportApis.${format} matching target release (${plan.api})`);
      }
    }
  }
  const batch = selectMatlabApi(capabilities.targetRelease, 'matlabBatch');
  const command = contract.headless.command;
  const usesBatch = /(?:^|\s)-batch(?:\s|$)/u.test(command);
  const usesLegacyRun = /(?:^|\s)-r(?:\s|$)/u.test(command);
  if (batch.status === 'native' && !usesBatch) {
    issues.push(`publicationContract.headless.command matching target release (${batch.api})`);
  }
  if (batch.status === 'fallback'
      && (!usesLegacyRun || usesBatch || !hasLegacyFailureExit(command))) {
    issues.push('publicationContract.headless.command legacy matlab -r with try/catch/exit');
  }
  if (contract.layout.architecture === 'tiledlayout' && capabilities.capabilities?.tiledlayout?.status !== 'native') {
    issues.push('publicationContract.layout.architecture release-compatible explicit fallback');
  }
  return issues;
}

function outputContractIssues(contract) {
  const issues = [];
  if (!contract.formats.length) issues.push('outputContract.formats');
  if (contract.manifest.required !== true && contract.manifest.required !== false) {
    issues.push('outputContract.manifest.required JSON boolean');
  }
  if (contract.manifest.required === false) return issues;
  if (contract.manifest.schemaVersion !== MATLAB_MANIFEST_SCHEMA_VERSION) {
    issues.push(`outputContract.manifest.schemaVersion ${MATLAB_MANIFEST_SCHEMA_VERSION}`);
  }
  if (!isSafeRelativeManifestPath(contract.manifest.path)) {
    issues.push('outputContract.manifest.path safe relative JSON path');
  }
  requireTrue(issues, 'outputContract.manifest.relativePathsOnly', contract.manifest.relativePathsOnly);
  requireTrue(issues, 'outputContract.manifest.deterministicOrderRequired', contract.manifest.deterministicOrderRequired);
  requireTrue(issues, 'outputContract.manifest.freshArtifactsOnly', contract.manifest.freshArtifactsOnly);
  requireTrue(issues, 'outputContract.manifest.verifiedArtifactsOnly', contract.manifest.verifiedArtifactsOnly);
  return uniqueStrings(issues);
}

function isSafeRelativeManifestPath(value) {
  if (!value || !/\.json$/iu.test(value) || /[\u0000-\u001f\u007f]/u.test(value)
      || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)
      || /^(?:[A-Za-z]:[\\/]|[\\/])/u.test(value)) return false;
  return !value.split(/[\\/]+/u).some((segment) => segment === '..');
}

function buildManifestExportFields(formats) {
  const fieldsByFormat = {
    png: ['file', 'width', 'height', 'dpi', 'bytes', 'sha256', 'export_api'],
    pdf: ['file', 'width', 'height', 'pages', 'text', 'bytes', 'sha256', 'export_api'],
    svg: [
      'file', 'width', 'height', 'title', 'description', 'accessible_name',
      'bytes', 'sha256', 'export_api', 'export_device',
    ],
  };
  return Object.freeze(Object.fromEntries(formats.map((format) => [
    format,
    Object.freeze(fieldsByFormat[format] || ['file', 'width', 'height', 'bytes', 'sha256', 'export_api']),
  ])));
}

function normalizeExportStrategies(exportFormats) {
  if (!exportFormats || typeof exportFormats !== 'object') return Object.freeze({});
  return Object.freeze(Object.fromEntries(Object.entries(exportFormats).map(([format, plan]) => [
    format,
    Object.freeze({ status: plan.status, strategy: plan.strategy, api: plan.api, syntax: plan.syntax, reason: plan.reason }),
  ])));
}

function requireTrue(issues, name, value) {
  if (value !== true) issues.push(`${name} true`);
}

function requireFalse(issues, name, value) {
  if (value !== false) issues.push(`${name} false`);
}

function sameStringSet(left, right) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function scientificContractIssues(contract, rawShape, unitConversions) {
  const issues = [];
  const coordinateNames = new Set(contract.coordinates.names.map((value) => value.toLowerCase()));
  const validShape = Array.isArray(rawShape) && rawShape.length > 0
    && contract.shape.every((value) => Number.isInteger(value) && value > 0);
  if (rawShape !== undefined && !validShape) issues.push('dataContract.shape (positive integer dimensions)');
  if (contract.dimensionOrder.length && contract.dimensionOrder.length !== contract.shape.length) {
    issues.push('dataContract.dimensionOrder length matching shape rank');
  }
  if (contract.dimensionOrder.length !== new Set(contract.dimensionOrder).size) {
    issues.push('dataContract.dimensionOrder unique names');
  }
  if (contract.observationDimension && !contract.dimensionOrder.includes(contract.observationDimension)) {
    issues.push('dataContract.observationDimension present in dimensionOrder');
  }
  for (const conversion of unitConversions) {
    if (!conversion.variable || !conversion.sourceUnit || !conversion.targetUnit || !conversion.formula) {
      issues.push('dataContract.unitConversions sourceUnit/targetUnit/formula');
      break;
    }
  }
  if (contract.required) {
    if (!validShape) issues.push('dataContract.shape');
    if (!contract.dimensionOrder.length) issues.push('dataContract.dimensionOrder');
    if (!contract.observationDimension) issues.push('dataContract.observationDimension');
    if (!coordinateNames.size) issues.push('dataContract.coordinates');
    if (!Object.keys(contract.quantities).length) issues.push('dataContract.quantities');
    if (!Object.keys(contract.units).length) issues.push('dataContract.units');
    for (const key of Object.keys(contract.quantities)) {
      if (!contract.units[key]) issues.push(`dataContract.units.${key}`);
    }
    if (contract.missing.status === 'unknown') issues.push('dataContract.missing.status (present/absent)');
    if (contract.qc.status === 'unknown') issues.push('dataContract.qc.status (present/absent)');
    if (contract.uncertainty.status === 'unknown') issues.push('dataContract.uncertainty.status (present/absent)');
  }
  if (contract.required) {
    if (coordinateNames.has('time')) {
      if (!['datetime', 'timetable'].includes(contract.dataType.toLowerCase())) issues.push('dataContract.dataType datetime/timetable');
      if (!contract.coordinates.timeZone) issues.push('dataContract.coordinates.timeZone');
      if (!contract.coordinates.directions.time) issues.push('dataContract.coordinates.directions.time');
    }
    if (coordinateNames.has('longitude')) {
      if (!contract.coordinates.longitudeConvention) issues.push('dataContract.coordinates.longitudeConvention');
      if (!contract.coordinates.directions.longitude) issues.push('dataContract.coordinates.directions.longitude');
    }
    if (coordinateNames.has('latitude') && !contract.coordinates.directions.latitude) {
      issues.push('dataContract.coordinates.directions.latitude');
    }
    if (coordinateNames.has('depth') || coordinateNames.has('pressure') || coordinateNames.has('height') || coordinateNames.has('elevation')) {
      if (!['depth', 'pressure', 'height', 'elevation'].includes(contract.coordinates.vertical.coordinate.toLowerCase())) {
        issues.push('dataContract.coordinates.vertical.coordinate');
      }
      if (!['down', 'up'].includes(contract.coordinates.vertical.positive.toLowerCase())) {
        issues.push('dataContract.coordinates.vertical.positive');
      }
      if (!contract.coordinates.vertical.reference) issues.push('dataContract.coordinates.vertical.reference');
    }
    if (contract.missing.status === 'present' && !contract.missing.representation) {
      issues.push('dataContract.missing.representation');
    }
    if (contract.qc.status === 'present') {
      if (!contract.qc.variable) issues.push('dataContract.qc.variable');
      if (!contract.qc.alignment) issues.push('dataContract.qc.alignment');
      if (contract.qc.action !== 'preserve') issues.push('dataContract.qc.action preserve');
      if (!Object.keys(contract.qc.flagMeanings).length) issues.push('dataContract.qc.flagMeanings');
      for (const mask of ['missing', 'invalid', 'suspect']) {
        if (!contract.missing.maskVariables.includes(mask)) issues.push(`dataContract.missing.maskVariables.${mask}`);
      }
    }
    if (contract.uncertainty.status === 'present') {
      if (!contract.uncertainty.type) issues.push('dataContract.uncertainty.type');
      if (!contract.uncertainty.unit) issues.push('dataContract.uncertainty.unit');
      if (!contract.uncertainty.alignment) issues.push('dataContract.uncertainty.alignment');
      if (contract.uncertainty.type === 'confidence-interval') {
        if (contract.uncertainty.representation !== 'bounds') issues.push('dataContract.uncertainty.representation bounds');
        if (!(contract.uncertainty.confidenceLevel > 0 && contract.uncertainty.confidenceLevel < 1)) {
          issues.push('dataContract.uncertainty.confidenceLevel between 0 and 1');
        }
      }
    }
  }
  if (contract.qc.alignment && contract.observationDimension && contract.qc.alignment !== contract.observationDimension) {
    issues.push('dataContract.qc.alignment matching observationDimension');
  }
  if (contract.uncertainty.status === 'present' && contract.units.value && contract.uncertainty.unit
      && contract.units.value !== contract.uncertainty.unit
      && !hasUnitConversion(contract.unitConversions, contract.uncertainty.unit, contract.units.value)) {
    issues.push('dataContract.uncertainty.unit compatible with units.value or explicit conversion');
  }
  if (contract.uncertainty.alignment && contract.observationDimension
      && contract.uncertainty.alignment !== contract.observationDimension) {
    issues.push('dataContract.uncertainty.alignment matching observationDimension');
  }
  return uniqueStrings(issues);
}

function normalizeMetadataMap(value) {
  const source = objectValue(value) || {};
  return Object.fromEntries(Object.entries(source)
    .map(([key, item]) => [cleanValue(key), cleanValue(item)])
    .filter(([key, item]) => key && item));
}

function normalizeExportApiMap(value) {
  const source = objectValue(value) || {};
  return Object.fromEntries(Object.entries(source)
    .map(([format, api]) => [cleanValue(format).toLowerCase().replace(/^\./u, ''), cleanValue(api).toLowerCase()])
    .filter(([format, api]) => format && api));
}

function normalizeFormatList(value) {
  const values = Array.isArray(value) ? value : [value];
  return uniqueStrings(values.map((item) => cleanValue(item).toLowerCase().replace(/^\./u, '')));
}

function resolveNormalizedAlias(primary, alias, normalize, fallback) {
  const primaryProvided = primary !== undefined && primary !== null && cleanValue(primary) !== '';
  const aliasProvided = alias !== undefined && alias !== null && cleanValue(alias) !== '';
  const primaryValue = primaryProvided ? normalize(primary) : null;
  const aliasValue = aliasProvided ? normalize(alias) : null;
  return {
    value: primaryValue || aliasValue || fallback,
    invalid: (primaryProvided && !primaryValue) || (aliasProvided && !aliasValue),
    conflict: Boolean(primaryValue && aliasValue && primaryValue !== aliasValue),
    duplicate: primaryProvided && aliasProvided,
  };
}

function strictOptionalBoolean(value) {
  return typeof value === 'boolean' ? value : null;
}

function strictBooleanWithDefault(value, fallback) {
  return value === undefined ? fallback : strictOptionalBoolean(value);
}

function hasLegacyFailureExit(command) {
  const tryIndex = command.search(/\btry\b/iu);
  const catchIndex = command.search(/\bcatch\b/iu);
  if (tryIndex < 0 || catchIndex <= tryIndex) return false;
  return /\bexit\s*\(\s*[1-9][0-9]*\s*\)/iu.test(command.slice(catchIndex));
}

function normalizeUnitConversions(value) {
  return (Array.isArray(value) ? value : []).map((entry) => ({
    variable: cleanValue(entry?.variable),
    sourceUnit: cleanValue(entry?.sourceUnit),
    targetUnit: cleanValue(entry?.targetUnit),
    formula: cleanValue(entry?.formula),
  }));
}

function normalizePresence(value) {
  if (value === true) return 'present';
  if (value === false) return 'absent';
  const normalized = cleanValue(value).toLowerCase();
  if (['present', 'yes', 'true'].includes(normalized)) return 'present';
  if (['absent', 'no', 'false', 'none'].includes(normalized)) return 'absent';
  return 'unknown';
}

function hasUnitConversion(conversions, sourceUnit, targetUnit) {
  return conversions.some((entry) => entry.sourceUnit === sourceUnit && entry.targetUnit === targetUnit && entry.formula);
}

function objectValue(value) {
  return isMatlabJsonObject(value) ? value : null;
}

function validateTaskClosedWorld(input) {
  const unknownTopLevel = unknownFields(input, TASK_TOP_LEVEL_FIELDS);
  if (unknownTopLevel.length) return `Unknown MATLAB request fields are not allowed: ${unknownTopLevel.join(', ')}.`;
  const duplicateTopLevel = duplicateAliasFields(input, [
    ['dataContract', 'scientificDataContract', 'scientificData'],
    ['publicationContract', 'presentationContract', 'figureContract'],
    ['requiredToolboxes', 'toolboxes'], ['coordinates', 'axes'], ['shape', 'dimensions'],
    ['dimensionOrder', 'dimensionsOrder'], ['scientificQuestion', 'question'], ['dataType', 'type'],
    ['quantities', 'quantityNames'], ['timeZone', 'timezone'],
  ]);
  if (duplicateTopLevel) return duplicateTopLevel;
  const invalidListFields = [
    'requiredToolboxes', 'toolboxes', 'requestedCapabilities', 'outputFormats', 'unresolvedRequirements',
  ].filter((name) => input[name] !== undefined && !Array.isArray(input[name]));
  if (invalidListFields.length) return `MATLAB request list fields must be arrays: ${invalidListFields.join(', ')}.`;

  const scientificContractField = ownDefinedFields(
    input, ['dataContract', 'scientificDataContract', 'scientificData'],
  )[0];
  if (scientificContractField) {
    const flatFields = ownDefinedFields(input, MATLAB_SCIENTIFIC_FLAT_FIELDS);
    if (flatFields.length) {
      return `${scientificContractField} cannot be combined with flat scientific metadata: ${flatFields.join(', ')}.`;
    }
  }
  const publicationContractField = ownDefinedFields(
    input, ['publicationContract', 'presentationContract', 'figureContract'],
  )[0];
  if (publicationContractField) {
    const flatFields = ownDefinedFields(input, MATLAB_PUBLICATION_FLAT_FIELDS);
    if (flatFields.length) {
      return `${publicationContractField} cannot be combined with flat publication metadata: ${flatFields.join(', ')}.`;
    }
  }

  for (const name of ['dataContract', 'scientificDataContract', 'scientificData']) {
    if (!objectValue(input[name])) continue;
    const issue = validateScientificContractObject(input[name], name);
    if (issue) return issue;
  }
  for (const name of ['publicationContract', 'presentationContract', 'figureContract']) {
    if (!objectValue(input[name])) continue;
    const issue = validatePublicationContractObject(input[name], name);
    if (issue) return issue;
  }
  if (objectValue(input.manifestContract)) {
    if (input.manifestPath !== undefined && input.manifestContract.path !== undefined) {
      return 'manifestPath and manifestContract.path are duplicate aliases.';
    }
    if (input.manifestRequired !== undefined && input.manifestContract.required !== undefined) {
      return 'manifestRequired and manifestContract.required are duplicate aliases.';
    }
    const issue = validateKnownObject(input.manifestContract, 'manifestContract', new Set([
      'required', 'schemaVersion', 'schema_version', 'path', 'relativePathsOnly',
      'deterministicOrderRequired', 'freshArtifactsOnly', 'verifiedArtifactsOnly',
    ]), [['schemaVersion', 'schema_version']]);
    if (issue) return issue;
  }
  return null;
}

function validateScientificContractObject(value, path) {
  let issue = validateKnownObject(value, path, SCIENTIFIC_CONTRACT_FIELDS, [
    ['coordinates', 'axes'], ['shape', 'dimensions'], ['dimensionOrder', 'dimensionsOrder'],
    ['dataType', 'type'], ['quantities', 'quantityNames'], ['timeZone', 'timezone'],
  ]);
  if (issue) return issue;
  for (const field of ['shape', 'dimensions', 'dimensionOrder', 'dimensionsOrder', 'unitConversions', 'conversions']) {
    if (value[field] !== undefined && !Array.isArray(value[field])) return `${path}.${field} must be an array.`;
  }
  for (const field of ['coordinates', 'axes']) {
    if (value[field] !== undefined && !Array.isArray(value[field]) && !objectValue(value[field])) {
      return `${path}.${field} must be an array or JSON object.`;
    }
  }
  for (const coordinateField of ['coordinates', 'axes']) {
    const coordinates = objectValue(value[coordinateField]);
    if (!coordinates) continue;
    issue = validateKnownObject(coordinates, `${path}.${coordinateField}`, new Set([
      'names', 'time', 'datetime', '时间', '日期时间', 'depth', 'pressure', 'vertical', '深度', '压力', '垂向',
      'longitude', 'lon', 'x-longitude', '经度', 'latitude', 'lat', 'y-latitude', '纬度',
      'distance', 'station', 'transect', '距离', '站位', '断面距离',
      'category', 'group', 'categorical', '类别', '分组', 'timeZone', 'timezone',
      'directions', 'longitudeConvention',
    ]), [['timeZone', 'timezone']]);
    if (issue) return issue;
    for (const field of ['directions']) {
      if (!objectValue(coordinates[field])) continue;
      issue = validateKnownObject(coordinates[field], `${path}.${coordinateField}.${field}`,
        new Set(['time', 'latitude', 'longitude', 'longitudeConvention', 'vertical']));
      if (issue) return issue;
      if (objectValue(coordinates[field].vertical)) {
        issue = validateKnownObject(coordinates[field].vertical, `${path}.${coordinateField}.${field}.vertical`,
          new Set(['coordinate', 'positive', 'reference']));
        if (issue) return issue;
      }
    }
    if (objectValue(coordinates.vertical)) {
      issue = validateKnownObject(coordinates.vertical, `${path}.${coordinateField}.vertical`,
        new Set(['coordinate', 'positive', 'reference']));
      if (issue) return issue;
    }
  }
  for (const [field, allowed, aliases] of [
    ['missing', new Set(['status', 'representation', 'maskVariables']), []],
    ['qc', new Set(['status', 'variable', 'alignment', 'action', 'flagMeanings', 'acceptedValues', 'accepted', 'suspectValues', 'suspect', 'rejectedValues', 'rejected']),
      [['acceptedValues', 'accepted'], ['suspectValues', 'suspect'], ['rejectedValues', 'rejected']]],
    ['uncertainty', new Set(['status', 'type', 'unit', 'alignment', 'representation', 'confidenceLevel']), []],
    ['coordinateDirections', new Set(['time', 'latitude', 'longitude', 'longitudeConvention', 'vertical']), []],
    ['directions', new Set(['time', 'latitude', 'longitude', 'longitudeConvention', 'vertical']), []],
    ['vertical', new Set(['coordinate', 'positive', 'reference']), []],
    ['interpolation', new Set(['method', 'maskPolicy']), []],
    ['spectrumMetadata', new Set(['periodUnit', 'windowDescription', 'detrendDescription', 'segmentDescription', 'degreesOfFreedom', 'confidenceLevel', 'confidenceMethod']), []],
  ]) {
    if (!objectValue(value[field])) continue;
    issue = validateKnownObject(value[field], `${path}.${field}`, allowed, aliases);
    if (issue) return issue;
  }
  for (const directionField of ['coordinateDirections', 'directions']) {
    const vertical = objectValue(value[directionField]?.vertical);
    if (!vertical) continue;
    issue = validateKnownObject(vertical, `${path}.${directionField}.vertical`, new Set(['coordinate', 'positive', 'reference']));
    if (issue) return issue;
  }
  for (const field of ['unitConversions', 'conversions']) {
    if (!Array.isArray(value[field])) continue;
    for (let index = 0; index < value[field].length; index += 1) {
      const entry = value[field][index];
      if (!objectValue(entry)) return `${path}.${field}[${index}] must be a JSON object.`;
      issue = validateKnownObject(entry, `${path}.${field}[${index}]`, new Set(['variable', 'sourceUnit', 'targetUnit', 'formula']));
      if (issue) return issue;
    }
  }
  return null;
}

function validatePublicationContractObject(value, path) {
  let issue = validateKnownObject(value, path, PUBLICATION_CONTRACT_FIELDS);
  if (issue) return issue;
  const schemas = {
    target: ['medium', 'width', 'height', 'units', 'dpi', 'formats'],
    layout: ['architecture', 'rows', 'columns', 'tileSpacing', 'padding', 'readingOrder', 'explicitHandles', 'legendPlacement', 'colorbarPlacement'],
    typography: ['fontFamily', 'fallbackFamilies', 'baseSizePt', 'labelSizePt', 'titleSizePt', 'lineWidthPt', 'interpreter'],
    color: ['paletteClass', 'paletteSource', 'background', 'missingAppearance', 'minimumContrastRatio', 'colorOnlyEncodingAllowed', 'colorVisionCheckRequired', 'grayscaleCheckRequired'],
    clipping: ['drawnowBeforeAudit', 'boundsCheckRequired', 'overlapCheckRequired'],
    localization: ['encoding', 'languages', 'chineseRequired', 'glyphCheckRequired', 'glyphFormats'],
    accessibility: ['descriptionRequired', 'redundantEncodingRequired', 'readingOrderCheckRequired'],
    interaction: ['mode', 'stableObservationIdsRequired', 'targetScopedCallbacksRequired', 'cleanupRequired', 'staticFallbackRequired'],
    headless: ['supported', 'command', 'figureVisible', 'exportApi', 'exportApis', 'desktopIndependent'],
  };
  for (const [field, keys] of Object.entries(schemas)) {
    if (!objectValue(value[field])) continue;
    issue = validateKnownObject(value[field], `${path}.${field}`, new Set(keys));
    if (issue) return issue;
  }
  return null;
}

function validateKnownObject(value, path, allowed, aliases = []) {
  const unknown = unknownFields(value, allowed);
  if (unknown.length) return `Unknown fields in ${path} are not allowed: ${unknown.join(', ')}.`;
  return duplicateAliasFields(value, aliases, path);
}

function unknownFields(value, allowed) {
  return Object.keys(value).filter((name) => !allowed.has(name)).sort();
}

function duplicateAliasFields(value, groups, path = 'MATLAB request') {
  for (const group of groups) {
    const supplied = ownDefinedFields(value, group);
    if (supplied.length > 1) return `${path} contains duplicate aliases: ${supplied.join(', ')}.`;
  }
  return null;
}

function ownDefinedFields(input, names) {
  return names.filter((name) => Object.hasOwn(input, name) && input[name] !== undefined);
}

function traceContractInputFields(builder) {
  const fields = new Set();
  const tracingInput = new Proxy({}, {
    get(_target, property) {
      if (typeof property === 'string') fields.add(property);
      return undefined;
    },
  });
  builder(tracingInput, { active: false, required: false });
  return Object.freeze([...fields].filter((name) => !MATLAB_TASK_ROUTING_FIELDS.includes(name)));
}

function cleanValue(value) {
  return String(value ?? '').replace(/[\r\n\t]+/gu, ' ').trim();
}

function normalizeOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeOptionalBoolean(value) {
  if (value === true || value === false) return value;
  const normalized = cleanValue(value).toLowerCase();
  if (['true', 'yes'].includes(normalized)) return true;
  if (['false', 'no'].includes(normalized)) return false;
  return null;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [values]).map((value) => String(value || '').trim()).filter(Boolean))];
}
