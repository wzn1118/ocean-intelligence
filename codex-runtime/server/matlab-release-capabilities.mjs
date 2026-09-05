export const MATLAB_RELEASE_CAPABILITY_SCHEMA_VERSION = 6;
export const MATLAB_DATA_SEMANTIC_SCHEMA_VERSION = 1;
export const MATLAB_PRESENTATION_SCHEMA_VERSION = 1;
export const MATLAB_RUNTIME_EXPORT_SCHEMA_VERSION = 3;
export const MATLAB_CI_EVIDENCE_SCHEMA_VERSION = 1;
export const MATLAB_AUDITED_RUNTIME_RELEASES = Object.freeze(['R2021a', 'R2024b', 'R2026a']);

export const MATLAB_CI_EXIT_CODES = deepFreeze({
  passed: 0,
  failed: 1,
  skipped: 77,
  unavailable: 78,
});

export const MATLAB_RELEASE_RANGE = Object.freeze({
  earliest: 'R2006a',
  latestKnown: 'R2026a',
});

const RELEASE_ORDER = Object.freeze(buildReleaseOrder(
  MATLAB_RELEASE_RANGE.earliest,
  MATLAB_RELEASE_RANGE.latestKnown,
));

const CAPABILITY_DEFINITIONS = deepFreeze({
  table: capability('R2013b', 'numeric arrays / struct', 'Preserve names and units explicitly when table is unavailable.'),
  datetime: capability('R2014b', 'datenum', 'Convert only at the plotting boundary and report timezone and calendar-format loss.'),
  uifigure: capability('R2016a', 'figure', 'Use a conventional figure and document loss of web-based UI component behavior.'),
  uiaxes: capability('R2016a', 'axes', 'Use axes in a conventional figure; do not emit uiaxes-only properties.'),
  timetable: capability('R2016b', 'table + datetime column', 'Keep row time explicit; never silently replace it with unlabelled serial dates.'),
  tiledlayout: capability('R2019b', 'subplot / explicit axes positions', 'Manually implement shared labels, spacing, legends, and colorbars.'),
  nexttile: capability('R2019b', 'subplot / explicit axes positions', 'Select axes explicitly instead of relying on current axes state.'),
  dataTipTemplate: capability('R2019b', 'datacursormode + UpdateFcn', 'Custom template rows are unavailable; callback metadata must remain index-safe.'),
  dataTipTextRow: capability('R2019b', 'datacursormode + UpdateFcn', 'Build equivalent text from event.Target and event.DataIndex.'),
  colororder: capability('R2019b', "set(axesHandle,'ColorOrder',...)", 'Set ColorOrder on the intended axes and reset ColorOrderIndex deliberately.'),
  matlabBatch: capability('R2019a', 'matlab -r with tested try/catch/exit handling', 'Preserve uncaught failure status and record the exact legacy command.', ['matlab'], 'matlab -batch'),
  exportgraphics: capability('R2020a', 'print', 'Use an explicit device, renderer, resolution, and paper geometry.'),
  auditedFigureManifest: capability('R2019b', 'verified external manifest writer after MATLAB artifact validation', 'The repository oi_export_figure and oi_write_manifest path requires R2019b or newer and audits PNG/PDF with optional SVG. Older releases or other formats require an explicitly verified external writer; otherwise fail.', ['matlab'], 'oi_export_figure + oi_write_manifest'),
  matlabRelease: capability('R2020b', "version('-release')", 'Report the fallback source and do not infer MATLAB release from a toolbox version.'),
  exportapp: capability('R2020b', 'print / exportgraphics on the containing figure', 'Document that UI component and app-state fidelity can differ.'),
  exportgraphicsAppend: capability('R2021b', 'separate PDF files / verified external merge', 'Do not silently claim a multipage PDF when Append is unavailable.', ['matlab'], "exportgraphics(...,'Append',true)"),
  clim: capability('R2022a', 'caxis', 'Use caxis(axesHandle,[low high]) with the same scientific limits.'),
  exportgraphicsAnimatedGif: capability('R2022a', 'explicit frame sequence', 'Do not substitute an animation format or merge frames without reporting it.', ['matlab'], 'exportgraphics GIF append'),
  brushAxesUifigure: capability('R2023a', "brush(figureHandle,'on')", 'Use a figure-target brush mode and preserve stable observation identifiers.', ['matlab'], "brush(uiAxesHandle,'on')"),
  exportgraphicsSvg: capability('R2025a', "print(figureHandle,file,'-dsvg')", 'Direct exportgraphics SVG is unavailable before R2025a; do not substitute PDF.', ['matlab'], "exportgraphics(container,'figure.svg')"),
  exportgraphicsSizing: capability('R2025a', 'explicit figure physical size and legacy paper geometry', 'Verify final dimensions and clipping because Width, Height, Units, Padding, and PreserveAspectRatio are unavailable.', ['matlab'], 'exportgraphics Width/Height/Units/Padding/PreserveAspectRatio'),
  brushAxesTraditional: capability('R2025a', "brush(figureHandle,'on')", 'Traditional axes-target brushing is unavailable; use the owning figure explicitly.', ['matlab'], "brush(axesHandle,'on')"),
});

const EXPORT_FORMAT_DEFINITIONS = deepFreeze({
  png: exportFormat('R2006a', [
    exportPath('exportgraphics', 'R2020a', "exportgraphics(container,file,'Resolution',dpi)"),
    exportPath('print', 'R2006a', "print(figureHandle,file,'-dpng',resolutionFlag)"),
  ]),
  jpeg: exportFormat('R2006a', [
    exportPath('exportgraphics', 'R2020a', "exportgraphics(container,file,'Resolution',dpi)"),
    exportPath('print', 'R2006a', "print(figureHandle,file,'-djpeg',resolutionFlag)"),
  ]),
  tiff: exportFormat('R2006a', [
    exportPath('exportgraphics', 'R2020a', "exportgraphics(container,file,'Resolution',dpi)"),
    exportPath('print', 'R2006a', "print(figureHandle,file,'-dtiff',resolutionFlag)"),
  ]),
  pdf: exportFormat('R2006a', [
    exportPath('exportgraphics', 'R2020a', "exportgraphics(container,file,'ContentType','vector')"),
    exportPath('print', 'R2025a', "print(figureHandle,file,'-dpdf')"),
    exportPath('print', 'R2006a', "print(figureHandle,file,'-dpdf',rendererFlag)"),
  ]),
  eps: exportFormat('R2006a', [
    exportPath('print', 'R2025a', "print(figureHandle,file,'-depsc')"),
    exportPath('print', 'R2006a', "print(figureHandle,file,'-depsc',rendererFlag)"),
  ]),
  svg: exportFormat('R2014b', [
    exportPath('exportgraphics', 'R2025a', 'exportgraphics(container,file)'),
    exportPath('print', 'R2014b', "print(figureHandle,file,'-dsvg')"),
  ], 'No format substitution: releases older than R2014b must fail an SVG request explicitly; direct exportgraphics SVG requires R2025a.'),
});

const EXPORT_FORMAT_ALIASES = Object.freeze({
  jpg: 'jpeg',
  jpeg: 'jpeg',
  tif: 'tiff',
  tiff: 'tiff',
  png: 'png',
  pdf: 'pdf',
  eps: 'eps',
  svg: 'svg',
});

const TOOLBOX_DEFINITIONS = deepFreeze({
  matlab: product('matlab', 'MATLAB', null, ['core graphics', 'table/timetable/datetime', 'uifigure/uiaxes/exportapp']),
  statistics: product('statistics', 'Statistics and Machine Learning Toolbox', 'Statistics_Toolbox', ['isoutlier', 'filloutliers', 'boxplot and statistical diagnostics']),
  signal: product('signal', 'Signal Processing Toolbox', 'Signal_Toolbox', ['pwelch', 'spectrogram', 'windowed spectral estimates']),
  mapping: product('mapping', 'Mapping Toolbox', 'Map_Toolbox', ['map projections', 'projected map axes', 'specialized geospatial analysis']),
  image: product('image', 'Image Processing Toolbox', 'Image_Toolbox', ['image morphology', 'specialized image filtering and segmentation']),
});

export const MATLAB_DATA_SEMANTIC_RULES = deepFreeze({
  dimensions: {
    requiredFields: ['shape', 'dimensionOrder', 'observationDimension'],
    forbiddenImplicitTransforms: ['transpose', 'squeeze', 'reshape', 'sort'],
    pairedArraysRequireEqualShape: true,
  },
  units: {
    requireExplicitUnits: true,
    requireExplicitConversionForDifferentUnits: true,
    forbidMagnitudeInference: true,
  },
  time: {
    requireTimeZone: true,
    requireNonNaT: true,
    requireUniqueStrictlyIncreasingValues: true,
    datetimeIntroduced: CAPABILITY_DEFINITIONS.datetime.introduced,
    timetableIntroduced: CAPABILITY_DEFINITIONS.timetable.introduced,
  },
  missing: {
    requireDeclaredStatus: true,
    requireSeparateMissingInvalidSuspectMasks: true,
    requireValidZeroDeclaration: true,
    forbidSilentFillOrInterpolation: true,
  },
  qualityControl: {
    requireObservationAlignment: true,
    preserveRawFlags: true,
    requireSeparateSuspectMask: true,
    statisticalOutlierMethodsRequire: 'statistics',
  },
  uncertainty: {
    allowedTypes: [
      'standard-deviation',
      'standard-error',
      'confidence-interval',
      'instrument-accuracy',
      'ensemble-spread',
    ],
    requireObservationAlignment: true,
    requireCompatibleUnits: true,
    requireFiniteNonnegativeMagnitude: true,
    requirePositiveBoundsForLogScale: true,
  },
  coordinateDirection: {
    requireKindUnitsPositiveDirectionAndReference: true,
    forbidSilentAxisReversal: true,
    forbidPressureRelabelledAsDepth: true,
  },
});

export const MATLAB_PRESENTATION_RULES = deepFreeze({
  layout: {
    requirePhysicalSize: true,
    requireExplicitMultiPanelSpacing: true,
    requireFinalClippingAudit: true,
    exactExportSizingIntroduced: CAPABILITY_DEFINITIONS.exportgraphicsSizing.introduced,
  },
  typography: {
    requireExplicitFontProbe: true,
    requirePerFormatGlyphAudit: true,
    cjkMissingFontPolicy: 'fail',
    literalMultilingualInterpreter: 'none',
  },
  color: {
    allowedPaletteClasses: ['sequential', 'diverging', 'cyclic', 'categorical', 'line-series', 'monochrome', 'mixed'],
    forbiddenPalettes: ['jet', 'rainbow', 'hsv'],
    requireMissingValueAppearance: true,
    requireDivergingReference: true,
  },
  accessibility: {
    requireAltText: true,
    requireContrastAudit: true,
    forbidColorOnlyEncoding: true,
    requireGrayscaleAudit: true,
    requireColorVisionAudit: true,
  },
  export: {
    requireFreshOutput: true,
    requireExplicitBackground: true,
    directSvgExportIntroduced: CAPABILITY_DEFINITIONS.exportgraphicsSvg.introduced,
    multipagePdfAppendIntroduced: CAPABILITY_DEFINITIONS.exportgraphicsAppend.introduced,
  },
  interaction: {
    requireStableObservationIdentifiers: true,
    requireStaticEquivalent: true,
    disableTransientInteractionForStaticExport: true,
    uifigureAxesBrushIntroduced: CAPABILITY_DEFINITIONS.brushAxesUifigure.introduced,
    traditionalAxesBrushIntroduced: CAPABILITY_DEFINITIONS.brushAxesTraditional.introduced,
  },
  headless: {
    batchIntroduced: CAPABILITY_DEFINITIONS.matlabBatch.introduced,
    requireInvisibleTraditionalFigureFallback: true,
    forbidDialogsAndInteractiveWaits: true,
    forbidOctaveSubstitution: true,
  },
});

export const MATLAB_RUNTIME_EXPORT_RULES = deepFreeze({
  runtime: {
    requiredRuntime: 'matlab',
    forbidOctaveSubstitution: true,
    requireExecutablePath: true,
    requireAbsoluteExecutablePath: true,
    requireExecutableIdentity: true,
    requireDetectedRelease: true,
    releaseEvidenceSources: ['matlabRelease', "version('-release')"],
    requireExactCommandAndExitEvidence: true,
  },
  commands: {
    batchIntroduced: CAPABILITY_DEFINITIONS.matlabBatch.introduced,
    modern: 'matlab -batch',
    legacy: 'matlab -r with tested try/catch/exit handling',
    forbidMixedBatchAndRun: true,
    forbidShellExitMasking: true,
  },
  toolboxEvidence: {
    separateChecks: ['installed', 'licenseTested', 'licenseAvailable', 'functionResolved', 'invocationVerified'],
    baseProductLicenseFeature: null,
    requireLicenseTestForOptionalProducts: true,
  },
  headless: {
    requireInvisibleFigure: true,
    requireNonInteractiveScript: true,
    auditedManifestRequiresJvm: true,
    recordEnvironment: ['headless', 'displayAvailable', 'desktopAvailable', 'jvmAvailable'],
  },
  exports: {
    preserveRequestedFormat: true,
    requireFreshNonemptyFiles: true,
    pngEvidence: ['width', 'height', 'dpi', 'bytes', 'sha256'],
    pdfEvidence: ['width', 'height', 'pages', 'text', 'bytes', 'sha256'],
    svgEvidence: ['accessibleDescription', 'bytes', 'sha256'],
  },
  manifest: {
    schemaVersion: 2,
    nativeHelperIntroduced: CAPABILITY_DEFINITIONS.auditedFigureManifest.introduced,
    nativeHelperFiles: ['oi_export_figure.m', 'oi_write_manifest.m'],
    nativeFormats: ['png', 'pdf', 'svg'],
    requiredNativeFormats: ['png', 'pdf'],
    optionalNativeFormats: ['svg'],
    nativeToolboxEvidenceScope: 'installation-only',
    requiredTopLevelFields: [
      'schema_version', 'generated_at', 'generator', 'runtime_status',
      'execution_verified', 'matlab_release', 'toolboxes',
      'artifact_validation', 'visual_inspection', 'warnings', 'errors', 'figures',
    ],
    requireRelativeSafePaths: true,
    requireFreshNonemptyFiles: true,
    requireByteAndSha256Revalidation: true,
    requireDeterministicUniqueIdsAndFiles: true,
    requireNamedExternalWriter: true,
    forbidUnverifiedVisualSuccess: true,
  },
});

export const MATLAB_RELEASE_CAPABILITY_MATRIX = deepFreeze({
  schemaVersion: MATLAB_RELEASE_CAPABILITY_SCHEMA_VERSION,
  releaseRange: MATLAB_RELEASE_RANGE,
  releaseOrder: RELEASE_ORDER,
  capabilities: CAPABILITY_DEFINITIONS,
  exportFormats: EXPORT_FORMAT_DEFINITIONS,
  toolboxes: TOOLBOX_DEFINITIONS,
  dataSemanticRules: MATLAB_DATA_SEMANTIC_RULES,
  presentationRules: MATLAB_PRESENTATION_RULES,
  runtimeExportRules: MATLAB_RUNTIME_EXPORT_RULES,
});

export function buildMatlabRuntimeCiMatrix({
  productionRelease = MATLAB_RELEASE_RANGE.latestKnown,
  artifactRoot = 'matlab-ci-artifacts',
} = {}) {
  const normalizedProductionRelease = requireKnownRelease(productionRelease).release;
  const definitions = [
    ['matlab-r2021a', MATLAB_AUDITED_RUNTIME_RELEASES[0], 'compatibility-floor'],
    ['matlab-r2024b', MATLAB_AUDITED_RUNTIME_RELEASES[1], 'long-term-compatibility'],
    ['matlab-production', normalizedProductionRelease, 'production'],
  ];
  return deepFreeze({
    schemaVersion: MATLAB_CI_EVIDENCE_SCHEMA_VERSION,
    authoritativeRuntime: 'mathworks-matlab',
    statusVocabulary: ['unavailable', 'skipped', 'failed', 'passed'],
    exitCodes: MATLAB_CI_EXIT_CODES,
    jobs: definitions.map(([id, release, purpose]) => ({
      id,
      purpose,
      targetRelease: release,
      exactReleaseRequired: true,
      runnerInputs: {
        matlabExecutable: 'absolute path to MathWorks MATLAB',
        matlabRelease: release,
        matlabLicense: 'MATLAB_LICENSE_FILE or an already activated runner',
        headless: true,
        requiredToolboxes: Object.values(TOOLBOX_DEFINITIONS).map((definition) => ({
          id: definition.id,
          product: definition.label,
          licenseFeature: definition.licenseFeature,
          evidence: ['installed', 'licenseTested', 'licenseAvailable', 'functionResolved', 'invocationVerified'],
        })),
      },
      command: `scripts/matlab-plot-regression.sh --expected-release ${release} --evidence-dir ${artifactRoot}/${id}`,
      expectedArtifacts: [
        'figures.json', 'matlab-runtime-probe.json', 'matlab-command.log', 'matlab-ci-evidence.json',
        '*.png', '*.pdf', '*.svg',
      ],
      failureConditions: [
        'MathWorks MATLAB is absent or its identity is unverified',
        'detected release differs from targetRelease',
        'required toolbox installation, license, function, or invocation evidence is missing',
        'headless execution is interactive, hides figures incorrectly, or exits nonzero',
        'PNG/PDF/SVG or figures.json is missing, empty, stale, or fails hash/metadata validation',
        'an Octave process or artifact is presented as MATLAB evidence',
      ],
    })),
  });
}

export function selectMatlabRuntimeValidationLane(targetRelease, {
  productionRelease = MATLAB_RELEASE_RANGE.latestKnown,
  artifactRoot = 'matlab-ci-artifacts',
} = {}) {
  const release = requireKnownRelease(targetRelease).release;
  const matrix = buildMatlabRuntimeCiMatrix({ productionRelease, artifactRoot });
  const exact = matrix.jobs.find((job) => job.targetRelease === release);
  if (exact) return deepFreeze({ status: 'exact', targetRelease: release, lane: exact });
  const compatible = matrix.jobs
    .filter((job) => compareMatlabReleases(job.targetRelease, release) <= 0)
    .sort((left, right) => compareMatlabReleases(right.targetRelease, left.targetRelease))[0];
  if (compatible) {
    return deepFreeze({
      status: 'compatibility-baseline',
      targetRelease: release,
      lane: compatible,
      limitation: `Runtime evidence for ${release} is not exact; ${compatible.targetRelease} is only a lower-bound compatibility lane.`,
    });
  }
  return deepFreeze({
    status: 'uncovered',
    targetRelease: release,
    lane: null,
    limitation: `No audited MATLAB runtime lane covers ${release}; add an exact MathWorks MATLAB lane before claiming runtime verification.`,
  });
}

export function classifyMatlabCiEvidence({
  jobId = 'matlab-runtime',
  targetRelease = MATLAB_RELEASE_RANGE.latestKnown,
  skipRequested = false,
  skipReason = '',
  runtimeContract = null,
  command = null,
  evidencePaths = {},
} = {}) {
  const release = requireKnownRelease(targetRelease).release;
  const contract = semanticObject(runtimeContract);
  const runtimeEvidence = semanticObject(contract.runtimeEvidence);
  const explicitSkipReason = String(skipReason || '').trim();
  let status;
  let reason;
  if (skipRequested === true) {
    status = 'skipped';
    reason = explicitSkipReason || 'explicit_policy_skip';
  } else if (runtimeEvidence.matlabAvailable === false) {
    status = 'unavailable';
    reason = 'mathworks_matlab_not_available';
  } else if (contract.status === 'verified'
      && runtimeEvidence.executionVerified === true
      && runtimeEvidence.artifactsVerified === true
      && runtimeEvidence.exactReleaseMatch === true
      && semanticObject(contract.manifest).verified === true
      && semanticObject(contract.toolboxReadiness).status === 'verified'
      && semanticObject(contract.environment).headless === true) {
    status = 'passed';
    reason = 'all_matlab_runtime_gates_passed';
  } else {
    status = 'failed';
    reason = contract.errors?.[0]?.code || contract.missingInputs?.[0]?.code || 'matlab_runtime_evidence_incomplete';
  }
  return deepFreeze({
    schemaVersion: MATLAB_CI_EVIDENCE_SCHEMA_VERSION,
    jobId: String(jobId || 'matlab-runtime'),
    status,
    reason,
    exitCode: MATLAB_CI_EXIT_CODES[status],
    authoritativeRuntime: 'mathworks-matlab',
    octaveEvidenceAccepted: false,
    targetRelease: release,
    detectedRelease: runtimeEvidence.detectedRelease || null,
    exactReleaseMatch: runtimeEvidence.exactReleaseMatch === true,
    command: String(command || runtimeEvidence.command || '').trim() || null,
    runtime: runtimeEvidence,
    environment: semanticObject(contract.environment),
    toolboxes: semanticObject(contract.toolboxReadiness),
    manifest: semanticObject(contract.manifest),
    exports: semanticObject(contract.exports),
    errors: Array.isArray(contract.errors) ? contract.errors : [],
    missingInputs: Array.isArray(contract.missingInputs) ? contract.missingInputs : [],
    warnings: Array.isArray(contract.warnings) ? contract.warnings : [],
    evidencePaths: normalizeSemanticStringMap(evidencePaths),
  });
}

export function parseMatlabRelease(value) {
  const match = String(value ?? '').trim().match(/^R(\d{4})([ab])$/iu);
  if (!match) return null;
  const release = `R${match[1]}${match[2].toLowerCase()}`;
  const ordinal = Number(match[1]) * 2 + (match[2].toLowerCase() === 'b' ? 1 : 0);
  return { release, year: Number(match[1]), half: match[2].toLowerCase(), ordinal };
}

export function normalizeMatlabRelease(value, fallback = null) {
  const parsed = parseMatlabRelease(value);
  if (parsed && releaseWithinKnownRange(parsed.release)) return parsed.release;
  const parsedFallback = parseMatlabRelease(fallback);
  if (parsedFallback && releaseWithinKnownRange(parsedFallback.release)) return parsedFallback.release;
  throw new RangeError(`Unsupported MATLAB release: ${String(value ?? '')}`);
}

export function normalizeMatlabExportFormat(value) {
  const extension = String(value || '').trim().toLowerCase().replace(/^\./u, '');
  const format = Object.hasOwn(EXPORT_FORMAT_ALIASES, extension)
    ? EXPORT_FORMAT_ALIASES[extension]
    : null;
  if (!format) throw new Error(`Unknown MATLAB export format: ${value}`);
  return format;
}

export function compareMatlabReleases(left, right) {
  const leftRelease = requireKnownRelease(left);
  const rightRelease = requireKnownRelease(right);
  return leftRelease.ordinal - rightRelease.ordinal;
}

export function matlabReleaseSupports(targetRelease, capabilityName) {
  const name = String(capabilityName || '');
  const capabilityValue = Object.hasOwn(CAPABILITY_DEFINITIONS, name)
    ? CAPABILITY_DEFINITIONS[name]
    : null;
  if (!capabilityValue) return false;
  return compareMatlabReleases(targetRelease, capabilityValue.introduced) >= 0;
}

export function selectMatlabApi(targetRelease, capabilityName, { runtime = 'matlab', required = true } = {}) {
  const resolved = resolveMatlabPlotCapabilities({ targetRelease, runtime, requested: [capabilityName] });
  const capabilityValue = resolved.capabilities[capabilityName];
  if (!capabilityValue || capabilityValue.status === 'unknown') {
    if (required) throw new Error(`Unknown MATLAB plotting capability: ${capabilityName}`);
    return { status: 'unsupported', strategy: 'fail', api: null, targetRelease: resolved.targetRelease };
  }
  return {
    capability: capabilityName,
    targetRelease: resolved.targetRelease,
    introduced: capabilityValue.introduced,
    status: capabilityValue.status,
    strategy: capabilityValue.strategy,
    api: capabilityValue.status === 'native' ? (capabilityValue.nativeApi || capabilityName) : capabilityValue.fallback,
    fallback: capabilityValue.status === 'native' ? null : capabilityValue.fallback,
    notes: capabilityValue.notes,
    requiredProducts: capabilityValue.requiredProducts,
  };
}

export function selectMatlabExportStrategy(targetRelease, format, { preferredApi = 'exportgraphics' } = {}) {
  const release = normalizeMatlabRelease(targetRelease, null);
  const normalizedFormat = normalizeMatlabExportFormat(format);
  const definitionValue = EXPORT_FORMAT_DEFINITIONS[normalizedFormat];
  if (compareMatlabReleases(release, definitionValue.introduced) < 0) {
    return {
      targetRelease: release,
      format: normalizedFormat,
      status: 'unsupported',
      strategy: 'fail',
      api: null,
      reason: definitionValue.notes || `${normalizedFormat} export requires ${definitionValue.introduced} or newer.`,
    };
  }
  const supportedPaths = definitionValue.paths.filter((entry) => compareMatlabReleases(release, entry.introduced) >= 0);
  const selected = supportedPaths.find((entry) => entry.api === preferredApi) || supportedPaths[0];
  return {
    targetRelease: release,
    format: normalizedFormat,
    status: selected.api === preferredApi ? 'preferred' : 'fallback',
    strategy: selected.api === preferredApi ? 'native' : 'explicit-fallback',
    api: selected.api,
    syntax: selected.syntax,
    introduced: selected.introduced,
    reason: selected.api === preferredApi ? null : `Preferred ${preferredApi} path is unavailable in ${release}.`,
  };
}

export function resolveMatlabToolboxDependencies(requested = []) {
  const names = uniqueStrings(requested);
  return names.map((name) => {
    const productValue = Object.hasOwn(TOOLBOX_DEFINITIONS, name)
      ? TOOLBOX_DEFINITIONS[name]
      : null;
    if (!productValue) throw new Error(`Unknown MATLAB toolbox dependency: ${name}`);
    return productValue;
  });
}

export function resolveMatlabToolboxReadiness({
  runtime = 'matlab',
  requested = [],
  evidence = {},
  requiredFunctions = {},
  requireInvocation = false,
} = {}) {
  const runtimeName = String(runtime || 'matlab').trim().toLowerCase();
  if (runtimeName !== 'matlab') {
    throw new Error('MATLAB toolbox resolution requires runtime="matlab"; Octave is never an implicit fallback.');
  }
  const evidenceByProduct = semanticObject(evidence);
  const functionsByProduct = semanticObject(requiredFunctions);
  const requestedProductIds = uniqueStrings(requested);
  const functionProductIds = Object.entries(functionsByProduct)
    .filter(([, functions]) => uniqueStrings(functions).length > 0)
    .map(([productId]) => productId);
  const declaredProductIds = new Set(['matlab', ...requestedProductIds]);
  const declarationErrors = [];
  for (const productId of functionProductIds) {
    if (!declaredProductIds.has(productId)) {
      addSemanticIssue(declarationErrors, 'TOOLBOX_DEPENDENCY_DECLARATION_REQUIRED', `requiredFunctions.${productId}`, `Declare ${productId} in toolboxes before requiring its functions.`);
    }
  }
  const dependencyProductIds = uniqueStrings(['matlab', ...requestedProductIds, ...functionProductIds]);
  const dependencies = resolveMatlabToolboxDependencies(dependencyProductIds).map((definition) => {
    const productEvidence = semanticObject(ownValue(evidenceByProduct, definition.id));
    const missingInputs = [];
    const errors = [];
    const installed = readEvidenceBoolean(
      productEvidence,
      'installed',
      `${definition.id}.installed`,
      'TOOLBOX_INSTALLATION_EVIDENCE_REQUIRED',
      missingInputs,
      errors,
    );
    if (installed === false) {
      addSemanticIssue(errors, 'TOOLBOX_NOT_INSTALLED', `${definition.id}.installed`, `${definition.label} is not installed.`);
    }

    let licenseTested = null;
    let licenseAvailable = null;
    if (installed === true && definition.licenseFeature) {
      licenseTested = readEvidenceBoolean(
        productEvidence,
        'licenseTested',
        `${definition.id}.licenseTested`,
        'TOOLBOX_LICENSE_TEST_REQUIRED',
        missingInputs,
        errors,
      );
      if (licenseTested === false) {
        addSemanticIssue(missingInputs, 'TOOLBOX_LICENSE_TEST_REQUIRED', `${definition.id}.licenseTested`, `Run license('test','${definition.licenseFeature}') before selecting ${definition.label}.`);
      } else if (licenseTested === true) {
        licenseAvailable = readEvidenceBoolean(
          productEvidence,
          'licenseAvailable',
          `${definition.id}.licenseAvailable`,
          'TOOLBOX_LICENSE_RESULT_REQUIRED',
          missingInputs,
          errors,
        );
        if (licenseAvailable === false) {
          addSemanticIssue(errors, 'TOOLBOX_LICENSE_UNAVAILABLE', `${definition.id}.licenseAvailable`, `${definition.label} has no available license.`);
        }
      }
    }

    const functions = uniqueStrings(functionsByProduct[definition.id]);
    const functionEvidence = semanticObject(productEvidence.functions);
    const functionResults = Object.fromEntries(functions.map((name) => {
      const resolved = readEvidenceBoolean(
        functionEvidence,
        name,
        `${definition.id}.functions.${name}`,
        'TOOLBOX_FUNCTION_RESOLUTION_REQUIRED',
        missingInputs,
        errors,
      );
      if (resolved === false) {
        addSemanticIssue(errors, 'TOOLBOX_FUNCTION_UNAVAILABLE', `${definition.id}.functions.${name}`, `${name} did not resolve to an available MATLAB function.`);
      }
      return [name, resolved];
    }));

    let invocationVerified = null;
    if (installed === true && (requireInvocation || Object.hasOwn(productEvidence, 'invocationVerified'))) {
      invocationVerified = readEvidenceBoolean(
        productEvidence,
        'invocationVerified',
        `${definition.id}.invocationVerified`,
        'TOOLBOX_INVOCATION_EVIDENCE_REQUIRED',
        missingInputs,
        errors,
      );
      if (invocationVerified === false) {
        addSemanticIssue(errors, 'TOOLBOX_INVOCATION_FAILED', `${definition.id}.invocationVerified`, `${definition.label} function invocation was not verified.`);
      }
    }
    const invalid = errors.some((entry) => entry.code === 'EVIDENCE_BOOLEAN_INVALID');
    const status = invalid
      ? 'invalid'
      : (errors.length ? 'unavailable' : (missingInputs.length ? 'needs-input' : (invocationVerified === true ? 'verified' : 'ready')));
    return {
      ...definition,
      status,
      installed,
      licenseTested,
      licenseAvailable,
      functions: functionResults,
      invocationVerified,
      missingInputs,
      errors,
    };
  });
  const allMissingInputs = dependencies.flatMap((entry) => entry.missingInputs);
  const allErrors = [...declarationErrors, ...dependencies.flatMap((entry) => entry.errors)];
  const status = declarationErrors.length || dependencies.some((entry) => entry.status === 'invalid')
    ? 'invalid'
    : (dependencies.some((entry) => entry.status === 'unavailable')
      ? 'unavailable'
      : (allMissingInputs.length ? 'needs-input'
        : (requireInvocation && dependencies.every((entry) => entry.invocationVerified === true) ? 'verified' : 'ready')));
  return deepFreeze({
    schemaVersion: MATLAB_RUNTIME_EXPORT_SCHEMA_VERSION,
    runtime: 'matlab',
    status,
    declaredProductIds: [...declaredProductIds],
    dependencies,
    missingInputs: allMissingInputs,
    errors: allErrors,
    policy: 'Installation, license test, function resolution, and successful invocation are separate evidence; no one check implies another and Octave evidence is invalid.',
  });
}

export function resolveMatlabRuntimeExportCompatibility({
  targetRelease = MATLAB_RELEASE_RANGE.latestKnown,
  runtime = 'matlab',
  exportFormats = ['png', 'pdf'],
  toolboxes = [],
  toolboxEvidence = {},
  requiredFunctions = {},
  requireToolboxInvocation = false,
  manifestRequired = true,
  externalManifestWriterVerified = false,
  externalManifestWriter,
  matlabAvailable,
  executable,
  executableIdentityVerified,
  detectedRelease,
  releaseEvidenceSource,
  headless,
  command,
  jvmAvailable,
  displayAvailable,
  desktopAvailable,
  nonInteractive,
  figureVisible,
  executionCompleted,
  exitCode,
  logCaptured,
  workingDirectory,
  manifestContract = {},
} = {}) {
  const release = normalizeMatlabRelease(targetRelease, null);
  const runtimeName = String(runtime || 'matlab').trim().toLowerCase();
  if (runtimeName !== 'matlab') {
    throw new Error('MATLAB runtime/export resolution requires runtime="matlab"; Octave is never an implicit fallback.');
  }
  const missingInputs = [];
  const errors = [];
  const warnings = [];
  const availability = readRuntimeBoolean(matlabAvailable, 'matlabAvailable', 'MATLAB_AVAILABILITY_REQUIRED', missingInputs, errors);
  if (availability === false) {
    addSemanticIssue(errors, 'MATLAB_UNAVAILABLE', 'matlabAvailable', 'MATLAB is unavailable; execution remains unverified and Octave must not be substituted.');
  }
  const executableValue = availability === true ? normalizeExecutablePath(executable) : '';
  if (availability === true && !executableValue) {
    addSemanticIssue(missingInputs, 'MATLAB_EXECUTABLE_REQUIRED', 'executable', 'Record the exact MathWorks MATLAB executable path.');
  } else if (availability === true && !isAbsoluteMatlabExecutable(executableValue)) {
    addSemanticIssue(errors, 'MATLAB_EXECUTABLE_INVALID', 'executable', `Executable must be an absolute path to MathWorks MATLAB: ${executableValue}.`);
  }
  const identityVerified = availability === true
    ? readRuntimeBoolean(executableIdentityVerified, 'executableIdentityVerified', 'MATLAB_IDENTITY_EVIDENCE_REQUIRED', missingInputs, errors)
    : null;
  if (identityVerified === false) {
    addSemanticIssue(errors, 'MATLAB_IDENTITY_UNVERIFIED', 'executableIdentityVerified', 'The selected executable was not verified as MathWorks MATLAB.');
  }

  let normalizedDetectedRelease = null;
  let normalizedReleaseEvidenceSource = null;
  let exactReleaseMatch = false;
  if (availability === true) {
    normalizedReleaseEvidenceSource = normalizeReleaseEvidenceSource(releaseEvidenceSource);
    if (!String(releaseEvidenceSource || '').trim()) {
      addSemanticIssue(missingInputs, 'MATLAB_RELEASE_SOURCE_REQUIRED', 'releaseEvidenceSource', 'Record matlabRelease or version("-release") as the release evidence source.');
    } else if (!normalizedReleaseEvidenceSource) {
      addSemanticIssue(errors, 'MATLAB_RELEASE_SOURCE_INVALID', 'releaseEvidenceSource', `Unsupported MATLAB release evidence source: ${String(releaseEvidenceSource)}.`);
    }
    const parsedDetectedRelease = parseMatlabRelease(detectedRelease);
    if (!parsedDetectedRelease) {
      if (String(detectedRelease || '').trim()) {
        addSemanticIssue(errors, 'MATLAB_DETECTED_RELEASE_INVALID', 'detectedRelease', `Invalid detected MATLAB release: ${String(detectedRelease)}.`);
      } else {
        addSemanticIssue(missingInputs, 'MATLAB_DETECTED_RELEASE_REQUIRED', 'detectedRelease', 'Record version("-release") or the explicit legacy version source.');
      }
    } else if (!releaseWithinKnownRange(parsedDetectedRelease.release)) {
      addSemanticIssue(errors, 'MATLAB_DETECTED_RELEASE_UNSUPPORTED', 'detectedRelease', `Detected release ${parsedDetectedRelease.release} is outside the audited matrix.`);
    } else {
      normalizedDetectedRelease = parsedDetectedRelease.release;
      if (normalizedReleaseEvidenceSource === 'matlabRelease'
          && compareMatlabReleases(normalizedDetectedRelease, CAPABILITY_DEFINITIONS.matlabRelease.introduced) < 0) {
        addSemanticIssue(errors, 'MATLAB_RELEASE_SOURCE_UNSUPPORTED', 'releaseEvidenceSource', `matlabRelease is unavailable in ${normalizedDetectedRelease}; use version('-release').`);
      }
      const releaseComparison = compareMatlabReleases(normalizedDetectedRelease, release);
      exactReleaseMatch = releaseComparison === 0;
      if (releaseComparison < 0) {
        addSemanticIssue(errors, 'MATLAB_DETECTED_RELEASE_TOO_OLD', 'detectedRelease', `${normalizedDetectedRelease} cannot verify code targeted at ${release}.`);
      } else if (releaseComparison > 0) {
        addSemanticIssue(warnings, 'MATLAB_RELEASE_NOT_EXACT', 'detectedRelease', `${normalizedDetectedRelease} may execute target-compatible code but does not verify behavior on ${release}.`);
      }
    }
  }

  const environment = resolveRuntimeEnvironment({
    release,
    availability,
    executable: executableValue,
    headless,
    command,
    jvmAvailable,
    displayAvailable,
    desktopAvailable,
    nonInteractive,
    figureVisible,
    executionCompleted,
  }, missingInputs, errors);
  const normalizedFormats = uniqueStrings(exportFormats).map(normalizeMatlabExportFormat);
  const exports = Object.fromEntries(normalizedFormats.map((format) => {
    const plan = selectMatlabExportStrategy(release, format);
    if (plan.status === 'unsupported') {
      addSemanticIssue(errors, 'MATLAB_EXPORT_FORMAT_UNSUPPORTED', `exportFormats.${format}`, plan.reason);
    }
    return [format, plan];
  }));

  const toolboxEvidenceValue = semanticObject(toolboxEvidence);
  const matlabToolboxEvidence = semanticObject(ownValue(toolboxEvidenceValue, 'matlab'));
  const combinedToolboxEvidence = {
    ...toolboxEvidenceValue,
    matlab: {
      ...matlabToolboxEvidence,
      installed: ownValue(matlabToolboxEvidence, 'installed') ?? availability,
    },
  };
  const toolboxReadiness = resolveMatlabToolboxReadiness({
    runtime: runtimeName,
    requested: toolboxes,
    evidence: combinedToolboxEvidence,
    requiredFunctions,
    requireInvocation: requireToolboxInvocation,
  });
  missingInputs.push(...toolboxReadiness.missingInputs);
  errors.push(...toolboxReadiness.errors);

  let executionVerified = false;
  if (executionCompleted !== undefined) {
    const completed = readRuntimeBoolean(executionCompleted, 'executionCompleted', 'MATLAB_EXECUTION_STATUS_REQUIRED', missingInputs, errors);
    if (completed === false) {
      addSemanticIssue(errors, 'MATLAB_EXECUTION_FAILED', 'executionCompleted', 'MATLAB execution did not complete successfully.');
    } else if (completed === true) {
      if (!Number.isInteger(exitCode)) {
        addSemanticIssue(missingInputs, 'MATLAB_EXIT_CODE_REQUIRED', 'exitCode', 'Record the exact MATLAB process exit code.');
      } else if (exitCode !== 0) {
        addSemanticIssue(errors, 'MATLAB_EXIT_CODE_FAILED', 'exitCode', `MATLAB exited with status ${exitCode}.`);
      }
      const captured = readRuntimeBoolean(logCaptured, 'logCaptured', 'MATLAB_LOG_EVIDENCE_REQUIRED', missingInputs, errors);
      if (captured === false) {
        addSemanticIssue(errors, 'MATLAB_LOG_NOT_CAPTURED', 'logCaptured', 'Capture MATLAB stdout/stderr before claiming execution success.');
      }
      if (!String(workingDirectory || '').trim()) {
        addSemanticIssue(missingInputs, 'MATLAB_WORKING_DIRECTORY_REQUIRED', 'workingDirectory', 'Record the MATLAB process working directory.');
      }
      executionVerified = availability === true
        && isAbsoluteMatlabExecutable(executableValue)
        && identityVerified === true
        && normalizedDetectedRelease !== null
        && normalizedReleaseEvidenceSource !== null
        && exitCode === 0
        && captured === true
        && Boolean(String(command || '').trim())
        && Boolean(String(workingDirectory || '').trim());
    }
  }
  if (errors.some((entry) => entry.code.startsWith('MATLAB_COMMAND_'))) executionVerified = false;

  const manifest = resolveRuntimeManifest({
    release,
    formats: normalizedFormats,
    toolboxes: toolboxReadiness.dependencies.map((entry) => entry.id),
    manifestRequired,
    externalManifestWriterVerified,
    externalManifestWriter,
    jvmAvailable: environment.jvmAvailable,
    executionCompleted,
    executionVerified,
    manifestContract,
  }, missingInputs, errors, warnings);

  const unavailable = errors.some((entry) => [
    'MATLAB_UNAVAILABLE', 'MATLAB_EXECUTABLE_INVALID', 'MATLAB_IDENTITY_UNVERIFIED', 'MATLAB_EXECUTION_FAILED',
    'MATLAB_EXIT_CODE_FAILED', 'TOOLBOX_NOT_INSTALLED', 'TOOLBOX_LICENSE_UNAVAILABLE',
    'TOOLBOX_FUNCTION_UNAVAILABLE', 'TOOLBOX_INVOCATION_FAILED',
  ].includes(entry.code));
  const unsupported = errors.some((entry) => [
    'MATLAB_DETECTED_RELEASE_TOO_OLD', 'MATLAB_EXPORT_FORMAT_UNSUPPORTED',
    'AUDITED_MANIFEST_UNSUPPORTED', 'AUDITED_MANIFEST_FORMAT_UNSUPPORTED',
    'AUDITED_MANIFEST_JVM_UNSUPPORTED',
  ].includes(entry.code));
  const artifactsRequired = normalizedFormats.length > 0;
  const artifactsVerified = artifactsRequired && executionVerified && manifest.verified;
  const requestedEvidenceVerified = !artifactsRequired || artifactsVerified;
  const status = unavailable
    ? 'unavailable'
    : (unsupported
      ? 'unsupported'
      : (errors.length ? 'invalid'
        : (missingInputs.length ? 'needs-input'
          : (executionVerified && exactReleaseMatch && requestedEvidenceVerified ? 'verified' : 'ready'))));
  return deepFreeze({
    schemaVersion: MATLAB_RUNTIME_EXPORT_SCHEMA_VERSION,
    runtime: 'matlab',
    targetRelease: release,
    status,
    missingInputs,
    errors,
    warnings,
    runtimeEvidence: {
      matlabAvailable: availability,
      executable: executableValue || null,
      executableIdentityVerified: identityVerified,
      detectedRelease: normalizedDetectedRelease,
      releaseEvidenceSource: normalizedReleaseEvidenceSource,
      exactReleaseMatch,
      executionCompleted: executionCompleted === true,
      executionVerified,
      exitCode: Number.isInteger(exitCode) ? exitCode : null,
      logCaptured: typeof logCaptured === 'boolean' ? logCaptured : null,
      workingDirectory: String(workingDirectory || '').trim() || null,
      artifactsRequired,
      artifactsVerified,
    },
    environment,
    exports,
    toolboxReadiness,
    manifest,
    policy: 'MATLAB identity, release, toolbox readiness, headless environment, exports, and manifest evidence are independent checks; no Octave result can satisfy them.',
  });
}

export function resolveMatlabPlotCapabilities({
  targetRelease = MATLAB_RELEASE_RANGE.latestKnown,
  runtime = 'matlab',
  requested = [],
  exportFormats = [],
  toolboxes = [],
  dataContract,
  presentationContract,
  runtimeContract,
} = {}) {
  const release = normalizeMatlabRelease(targetRelease, null);
  const runtimeName = String(runtime || 'matlab').trim().toLowerCase();
  if (runtimeName !== 'matlab') {
    throw new Error('MATLAB release capability resolution requires runtime="matlab"; Octave is never an implicit fallback.');
  }
  const requestedNames = uniqueStrings(requested);
  const names = requestedNames.length ? requestedNames : Object.keys(CAPABILITY_DEFINITIONS);
  const capabilities = Object.fromEntries(names.map((name) => {
    const definitionValue = Object.hasOwn(CAPABILITY_DEFINITIONS, name)
      ? CAPABILITY_DEFINITIONS[name]
      : null;
    if (!definitionValue) return [name, { status: 'unknown', strategy: 'fail', reason: 'Capability is not in the matrix.' }];
    const native = matlabReleaseSupports(release, name);
    return [name, {
      ...definitionValue,
      status: native ? 'native' : 'fallback',
      strategy: native ? 'native' : 'explicit-fallback',
    }];
  }));
  const normalizedFormats = uniqueStrings(exportFormats).map(normalizeMatlabExportFormat);
  const formats = Object.fromEntries(normalizedFormats.map((format) => [
    format,
    selectMatlabExportStrategy(release, format),
  ]));
  return {
    schemaVersion: MATLAB_RELEASE_CAPABILITY_SCHEMA_VERSION,
    runtime: 'matlab',
    targetRelease: release,
    capabilities,
    exportFormats: formats,
    toolboxDependencies: resolveMatlabToolboxDependencies(['matlab', ...uniqueStrings(toolboxes)]),
    semanticContract: dataContract === undefined
      ? null
      : resolveMatlabDataSemantics({ targetRelease: release, runtime: runtimeName, dataContract }),
    presentationContract: presentationContract === undefined
      ? null
      : resolveMatlabPresentationCapabilities({
        targetRelease: release,
        runtime: runtimeName,
        presentationContract,
      }),
    runtimeExportContract: runtimeContract === undefined
      ? null
      : resolveMatlabRuntimeExportCompatibility({
        ...semanticObject(runtimeContract),
        targetRelease: release,
        runtime: runtimeName,
        exportFormats: normalizedFormats.length
          ? normalizedFormats
          : semanticObject(runtimeContract).exportFormats,
        toolboxes: uniqueStrings([
          ...uniqueStrings(toolboxes),
          ...uniqueStrings(semanticObject(runtimeContract).toolboxes),
        ]),
      }),
    policy: 'No silent Octave substitution; unsupported native APIs must use the listed MATLAB fallback or fail explicitly.',
  };
}

export function resolveMatlabDataSemantics({
  targetRelease = MATLAB_RELEASE_RANGE.latestKnown,
  runtime = 'matlab',
  dataContract = {},
} = {}) {
  const release = normalizeMatlabRelease(targetRelease, null);
  const runtimeName = String(runtime || 'matlab').trim().toLowerCase();
  if (runtimeName !== 'matlab') {
    throw new Error('MATLAB data semantic resolution requires runtime="matlab"; Octave is never an implicit fallback.');
  }

  const contract = semanticObject(dataContract);
  const missingInputs = [];
  const errors = [];
  const warnings = [];
  const requiredProductIds = new Set(['matlab']);
  const dimensions = resolveDimensionSemantics(contract, missingInputs, errors);
  const units = resolveUnitSemantics(contract, missingInputs, errors);
  const time = resolveTimeSemantics(release, contract, missingInputs, errors, warnings);
  const missing = resolveMissingSemantics(contract, missingInputs, errors);
  const qualityControl = resolveQualityControlSemantics(
    contract,
    dimensions,
    missingInputs,
    errors,
    requiredProductIds,
  );
  const uncertainty = resolveUncertaintySemantics(
    contract,
    dimensions,
    units,
    missingInputs,
    errors,
  );
  const coordinateDirection = resolveCoordinateDirectionSemantics(
    contract,
    units,
    missingInputs,
    errors,
    warnings,
  );
  const status = errors.length ? 'invalid' : (missingInputs.length ? 'needs-input' : 'ready');

  return deepFreeze({
    schemaVersion: MATLAB_DATA_SEMANTIC_SCHEMA_VERSION,
    runtime: 'matlab',
    targetRelease: release,
    status,
    missingInputs,
    errors,
    warnings,
    dimensions,
    units,
    time,
    missing,
    qualityControl,
    uncertainty,
    coordinateDirection,
    requiredProducts: resolveMatlabToolboxDependencies([...requiredProductIds]),
    policy: 'Preserve dimensions, units, timezone, missing/QC masks, uncertainty meaning, and coordinate direction; never infer or silently transform scientific semantics.',
  });
}

export function resolveMatlabPresentationCapabilities({
  targetRelease = MATLAB_RELEASE_RANGE.latestKnown,
  runtime = 'matlab',
  presentationContract = {},
} = {}) {
  const release = normalizeMatlabRelease(targetRelease, null);
  const runtimeName = String(runtime || 'matlab').trim().toLowerCase();
  if (runtimeName !== 'matlab') {
    throw new Error('MATLAB presentation capability resolution requires runtime="matlab"; Octave is never an implicit fallback.');
  }

  const contract = semanticObject(presentationContract);
  const missingInputs = [];
  const errors = [];
  const warnings = [];
  const contractInteractionMode = normalizeSemanticToken(semanticObject(contract.interaction).mode);
  const modeValue = contract.mode || contract.outputMode
    || (contractInteractionMode === 'dual' ? 'interactive' : null)
    || (contractInteractionMode === 'static' ? 'publication' : null)
    || 'publication';
  const mode = normalizeSemanticToken(modeValue);
  if (!['publication', 'interactive', 'app'].includes(mode)) {
    addSemanticIssue(errors, 'PRESENTATION_MODE_INVALID', 'mode', 'Use publication, interactive, or app presentation mode.');
  }
  const layout = resolvePresentationLayout(release, mode, contract, missingInputs, errors, warnings);
  const typography = resolvePresentationTypography(contract, missingInputs, errors);
  const color = resolvePresentationColor(contract, missingInputs, errors);
  const accessibility = resolvePresentationAccessibility(contract, missingInputs, errors);
  const exports = resolvePresentationExports(release, contract, missingInputs, errors, warnings);
  const interaction = resolvePresentationInteraction(release, mode, contract, missingInputs, errors, warnings);
  const hasUnsupported = errors.some((entry) => entry.code.endsWith('_UNSUPPORTED'));
  const status = hasUnsupported
    ? 'unsupported'
    : (errors.length ? 'invalid' : (missingInputs.length ? 'needs-input' : 'ready'));

  return deepFreeze({
    schemaVersion: MATLAB_PRESENTATION_SCHEMA_VERSION,
    runtime: 'matlab',
    targetRelease: release,
    mode,
    status,
    missingInputs,
    errors,
    warnings,
    layout,
    typography,
    color,
    accessibility,
    exports,
    interaction,
    requiredProducts: resolveMatlabToolboxDependencies(['matlab']),
    policy: 'Fix physical layout, typography, accessible encodings, clipping checks, export semantics, and static interaction fallbacks explicitly; never infer MATLAB rendering success or substitute Octave.',
  });
}

export function matlabCapabilityInstructionBlock(options = {}) {
  const resolved = resolveMatlabPlotCapabilities(options);
  const capabilityRows = Object.entries(resolved.capabilities).map(([name, value]) => {
    const detail = value.status === 'native'
      ? `${name}: 原生 (${value.introduced}+)`
      : `${name}: 明确降级 → ${value.fallback}；${value.notes}`;
    return `- ${detail}`;
  });
  const exportRows = Object.values(resolved.exportFormats).map((value) => (
    value.status === 'unsupported'
      ? `- ${value.format} 导出：不支持，必须失败；${value.reason}`
      : `- ${value.format} 导出：${value.api} (${value.strategy})`
  ));
  const semanticRows = resolved.semanticContract
    ? [
      `- 数据语义契约：${resolved.semanticContract.status}；缺失输入 ${resolved.semanticContract.missingInputs.length} 项；冲突 ${resolved.semanticContract.errors.length} 项。`,
      `- 时间表示：${resolved.semanticContract.time.api || '未请求'} (${resolved.semanticContract.time.strategy || 'not-requested'})；坐标方向：${resolved.semanticContract.coordinateDirection.strategy}.`,
    ]
    : [];
  const presentationRows = resolved.presentationContract
    ? [
      `- 出版与交互契约：${resolved.presentationContract.status}；缺失输入 ${resolved.presentationContract.missingInputs.length} 项；冲突 ${resolved.presentationContract.errors.length} 项。`,
      `- 无界面策略：${resolved.presentationContract.interaction.headless ? resolved.presentationContract.interaction.strategy : 'desktop'}；精确尺寸：${resolved.presentationContract.layout.sizing.strategy}.`,
    ]
    : [];
  const runtimeRows = resolved.runtimeExportContract
    ? [
      `- 运行时与导出契约：${resolved.runtimeExportContract.status}；MATLAB 身份 ${resolved.runtimeExportContract.runtimeEvidence.executableIdentityVerified === true ? '已核验' : '未核验'}；实际 release ${resolved.runtimeExportContract.runtimeEvidence.detectedRelease || '未记录'}。`,
      `- Manifest：${resolved.runtimeExportContract.manifest.status} (${resolved.runtimeExportContract.manifest.strategy})；执行证据 ${resolved.runtimeExportContract.runtimeEvidence.executionVerified ? '已核验' : '未核验'}。`,
    ]
    : [];
  return [
    `【MATLAB release 能力矩阵】目标：${resolved.targetRelease}；运行时：MATLAB。`,
    ...capabilityRows,
    ...exportRows,
    ...semanticRows,
    ...presentationRows,
    ...runtimeRows,
    '- 工具箱依赖必须显式声明并用 license("test",feature) 与 which 双重核验；MATLAB UI 与 geographic axes 属于 MATLAB 基础产品，不能误报为 Mapping Toolbox 或独立 App Designer 工具箱。',
    '- 缺失产品时失败或切换到已记录且科学含义等价的算法；不得静默删功能、换格式或改变数据处理。',
    '- 禁止以 Octave 执行、替代或声称验证 MATLAB API；若 MATLAB 不可用，只能报告“未执行”，不能自动改用 Octave。',
  ].join('\n');
}

function resolveRuntimeEnvironment({
  release,
  availability,
  executable,
  headless,
  command,
  jvmAvailable,
  displayAvailable,
  desktopAvailable,
  nonInteractive,
  figureVisible,
  executionCompleted,
}, missingInputs, errors) {
  const commandPlan = selectMatlabApi(release, 'matlabBatch');
  if (availability !== true) {
    return {
      headless: null,
      command: String(command || '').trim() || null,
      commandPlan,
      jvmAvailable: null,
      displayAvailable: null,
      desktopAvailable: null,
      nonInteractive: null,
      figureVisible: null,
    };
  }
  const headlessValue = readRuntimeBoolean(headless, 'headless', 'MATLAB_HEADLESS_STATUS_REQUIRED', missingInputs, errors);
  const displayValue = readRuntimeBoolean(displayAvailable, 'displayAvailable', 'MATLAB_DISPLAY_STATUS_REQUIRED', missingInputs, errors);
  const desktopValue = readRuntimeBoolean(desktopAvailable, 'desktopAvailable', 'MATLAB_DESKTOP_STATUS_REQUIRED', missingInputs, errors);
  const jvmValue = readRuntimeBoolean(jvmAvailable, 'jvmAvailable', 'MATLAB_JVM_STATUS_REQUIRED', missingInputs, errors);
  const commandValue = String(command || '').trim();
  if ((headlessValue === true || executionCompleted === true) && !commandValue) {
    addSemanticIssue(missingInputs, 'MATLAB_COMMAND_REQUIRED', 'command', 'Record the exact MATLAB command used for execution.');
  }
  if (commandValue) {
    const commandAnalysis = analyzeMatlabCommand(commandValue, executable);
    const { hasBatch, hasRun } = commandAnalysis;
    if (commandAnalysis.invokesOctave) {
      addSemanticIssue(errors, 'MATLAB_COMMAND_RUNTIME_CONFLICT', 'command', 'The execution command references GNU Octave and cannot verify MATLAB.');
    }
    if (!commandAnalysis.wellFormed) {
      addSemanticIssue(errors, 'MATLAB_COMMAND_SYNTAX_INVALID', 'command', 'The MATLAB command contains an unmatched shell quote.');
    }
    if (!commandAnalysis.startsWithExecutable) {
      addSemanticIssue(errors, 'MATLAB_COMMAND_EXECUTABLE_MISMATCH', 'command', 'The command must start with the exact verified MATLAB executable.');
    }
    if (hasBatch && hasRun) {
      addSemanticIssue(errors, 'MATLAB_COMMAND_RELEASE_CONFLICT', 'command', 'Do not combine MATLAB -batch and -r in one invocation.');
    }
    if (commandAnalysis.exitStatusCanBeMasked) {
      addSemanticIssue(errors, 'MATLAB_COMMAND_EXIT_MASKING', 'command', 'Do not compose MATLAB with shell pipelines, background execution, sequential commands, or command substitution that can replace its exit status.');
    }
    if (commandPlan.status === 'native' && (!hasBatch || hasRun)) {
      addSemanticIssue(errors, 'MATLAB_COMMAND_RELEASE_CONFLICT', 'command', `${release} headless execution must select matlab -batch unless an explicit separately audited launcher is declared.`);
    }
    if (commandPlan.status === 'fallback') {
      const hasFailureExit = /\bcatch\b[\s\S]*?\bexit\s*\(\s*[1-9]\d*\s*\)/iu.test(commandValue);
      const hasSuccessExit = /\bexit\s*\(\s*0\s*\)/iu.test(commandValue);
      const hasLegacyContract = hasRun
        && /\btry\b/iu.test(commandValue)
        && /\bcatch\b/iu.test(commandValue)
        && hasFailureExit
        && hasSuccessExit;
      if (hasBatch || !hasLegacyContract) {
        addSemanticIssue(errors, 'MATLAB_COMMAND_RELEASE_CONFLICT', 'command', `${release} requires matlab -r with success exit(0) and a nonzero catch exit; -batch starts at ${MATLAB_RUNTIME_EXPORT_RULES.commands.batchIntroduced}.`);
      }
    }
  }

  let nonInteractiveValue = null;
  let figureVisibleValue = null;
  if (headlessValue === true) {
    nonInteractiveValue = readRuntimeBoolean(nonInteractive, 'nonInteractive', 'MATLAB_NONINTERACTIVE_EVIDENCE_REQUIRED', missingInputs, errors);
    figureVisibleValue = readRuntimeBoolean(figureVisible, 'figureVisible', 'MATLAB_FIGURE_VISIBILITY_REQUIRED', missingInputs, errors);
    if (nonInteractiveValue === false) {
      addSemanticIssue(errors, 'MATLAB_HEADLESS_INTERACTION_FORBIDDEN', 'nonInteractive', 'Headless MATLAB scripts must not open dialogs or wait for interactive input.');
    }
    if (figureVisibleValue === true) {
      addSemanticIssue(errors, 'MATLAB_HEADLESS_VISIBLE_FIGURE', 'figureVisible', 'Headless MATLAB export requires invisible traditional figures.');
    }
  }
  return {
    headless: headlessValue,
    command: commandValue || null,
    commandPlan,
    jvmAvailable: jvmValue,
    displayAvailable: displayValue,
    desktopAvailable: desktopValue,
    nonInteractive: nonInteractiveValue,
    figureVisible: figureVisibleValue,
  };
}

function resolveRuntimeManifest({
  release,
  formats,
  toolboxes,
  manifestRequired,
  externalManifestWriterVerified,
  externalManifestWriter,
  jvmAvailable,
  executionCompleted,
  executionVerified,
  manifestContract,
}, missingInputs, errors, warnings) {
  if (typeof manifestRequired !== 'boolean') {
    addSemanticIssue(errors, 'EVIDENCE_BOOLEAN_INVALID', 'manifestRequired', 'manifestRequired must be boolean.');
  }
  if (manifestRequired !== true) {
    return {
      required: false,
      status: 'not-requested',
      strategy: 'not-requested',
      api: null,
      fallback: null,
      requiresJvm: false,
      verified: false,
      schemaVersion: MATLAB_RUNTIME_EXPORT_RULES.manifest.schemaVersion,
      externalWriter: null,
      supportedNativeFormats: [...MATLAB_RUNTIME_EXPORT_RULES.manifest.nativeFormats],
      requiredNativeFormats: [...MATLAB_RUNTIME_EXPORT_RULES.manifest.requiredNativeFormats],
      optionalNativeFormats: [...MATLAB_RUNTIME_EXPORT_RULES.manifest.optionalNativeFormats],
      unsupportedNativeFormats: [],
      unrecordedNativeToolboxes: [],
      nativeToolboxEvidenceScope: MATLAB_RUNTIME_EXPORT_RULES.manifest.nativeToolboxEvidenceScope,
      requiredTopLevelFields: [...MATLAB_RUNTIME_EXPORT_RULES.manifest.requiredTopLevelFields],
    };
  }
  const localMissingInputs = [];
  const localErrors = [];
  const localWarnings = [];
  if (typeof externalManifestWriterVerified !== 'boolean') {
    addSemanticIssue(localErrors, 'EVIDENCE_BOOLEAN_INVALID', 'externalManifestWriterVerified', 'externalManifestWriterVerified must be boolean.');
  }
  const externalWriter = String(externalManifestWriter || '').trim();
  if (externalManifestWriterVerified === true && !externalWriter) {
    addSemanticIssue(localMissingInputs, 'AUDITED_MANIFEST_EXTERNAL_WRITER_ID_REQUIRED', 'externalManifestWriter', 'Name the verified external manifest writer and version.');
  }
  const helperPlan = selectMatlabApi(release, 'auditedFigureManifest');
  const nativeFormats = MATLAB_RUNTIME_EXPORT_RULES.manifest.nativeFormats;
  const requiredNativeFormats = MATLAB_RUNTIME_EXPORT_RULES.manifest.requiredNativeFormats;
  const optionalNativeFormats = MATLAB_RUNTIME_EXPORT_RULES.manifest.optionalNativeFormats;
  const unsupportedNativeFormats = formats.filter((format) => !nativeFormats.includes(format));
  const nativeFormatSetMatches = requiredNativeFormats.every((format) => formats.includes(format))
    && unsupportedNativeFormats.length === 0;
  const optionalToolboxes = uniqueStrings(toolboxes).filter((toolbox) => toolbox !== 'matlab');
  let status = 'native';
  let strategy = 'repository-matlab-helper';
  let api = helperPlan.api;
  let fallback = null;
  let requiresJvm = true;
  if (helperPlan.status !== 'native' || !nativeFormatSetMatches) {
    if (externalManifestWriterVerified === true) {
      status = externalWriter ? 'explicit-fallback' : 'needs-input';
      strategy = externalWriter
        ? 'verified-external-manifest-writer-after-matlab-artifact-validation'
        : 'declare-verified-external-manifest-writer';
      api = null;
      fallback = helperPlan.fallback;
      requiresJvm = null;
      addSemanticIssue(localWarnings, 'AUDITED_MANIFEST_EXTERNAL_FALLBACK', 'externalManifestWriterVerified', `The repository MATLAB helper cannot audit ${release} with [${formats.join(', ')}]; use the declared verified external writer without changing formats or evidence.`);
    } else if (helperPlan.status !== 'native') {
      status = 'unsupported';
      strategy = 'fail';
      api = null;
      fallback = helperPlan.fallback;
      requiresJvm = false;
      addSemanticIssue(localErrors, 'AUDITED_MANIFEST_UNSUPPORTED', 'targetRelease', `The repository audited manifest helper requires ${helperPlan.introduced}+; ${release} needs an explicitly verified external writer.`);
    } else if (!nativeFormatSetMatches) {
      status = 'unsupported';
      strategy = 'fail';
      api = null;
      fallback = helperPlan.fallback;
      requiresJvm = false;
      addSemanticIssue(localErrors, 'AUDITED_MANIFEST_FORMAT_UNSUPPORTED', 'exportFormats', `The repository audited manifest helper requires PNG/PDF and accepts optional SVG; requested [${formats.join(', ')}] needs an explicitly verified external writer.`);
    }
  }
  if (status === 'native') {
    if (jvmAvailable === null) {
      addSemanticIssue(localMissingInputs, 'AUDITED_MANIFEST_JVM_EVIDENCE_REQUIRED', 'jvmAvailable', 'Record usejava("jvm") before selecting the repository manifest helper.');
    } else if (jvmAvailable === false) {
      status = 'unsupported';
      strategy = 'fail';
      api = null;
      addSemanticIssue(localErrors, 'AUDITED_MANIFEST_JVM_UNSUPPORTED', 'jvmAvailable', 'oi_export_figure and oi_write_manifest require the MATLAB JVM for canonical paths and SHA-256.');
    }
  }
  const contract = semanticObject(manifestContract);
  const postflight = executionCompleted === true || Object.keys(contract).length > 0;
  if (postflight) validateRuntimeManifestContract(contract, formats, status === 'native', localMissingInputs, localErrors);
  const verified = executionCompleted === true
    && executionVerified === true
    && postflight
    && status !== 'unsupported'
    && localMissingInputs.length === 0
    && localErrors.length === 0
    && ownValue(contract, 'artifactValidationPassed') === true;
  missingInputs.push(...localMissingInputs);
  errors.push(...localErrors);
  warnings.push(...localWarnings);
  return {
    required: true,
    status,
    strategy,
    api,
    fallback,
    requiresJvm,
    verified,
    externalWriter: externalWriter || null,
    schemaVersion: MATLAB_RUNTIME_EXPORT_RULES.manifest.schemaVersion,
    supportedNativeFormats: [...nativeFormats],
    requiredNativeFormats: [...requiredNativeFormats],
    optionalNativeFormats: [...optionalNativeFormats],
    unsupportedNativeFormats,
    optionalToolboxes,
    unrecordedNativeToolboxes: [],
    nativeToolboxEvidenceScope: MATLAB_RUNTIME_EXPORT_RULES.manifest.nativeToolboxEvidenceScope,
    requiredTopLevelFields: [...MATLAB_RUNTIME_EXPORT_RULES.manifest.requiredTopLevelFields],
  };
}

function validateRuntimeManifestContract(contract, formats, nativeHelper, missingInputs, errors) {
  const schemaVersion = ownValue(contract, 'schemaVersion');
  if (schemaVersion === undefined) {
    addSemanticIssue(missingInputs, 'MANIFEST_SCHEMA_VERSION_REQUIRED', 'manifestContract.schemaVersion', 'Record the generated manifest schema version.');
  } else if (schemaVersion !== MATLAB_RUNTIME_EXPORT_RULES.manifest.schemaVersion) {
    addSemanticIssue(errors, 'MANIFEST_SCHEMA_VERSION_INVALID', 'manifestContract.schemaVersion', `Expected manifest schema ${MATLAB_RUNTIME_EXPORT_RULES.manifest.schemaVersion}.`);
  }
  for (const [key, code] of [
    ['relativePaths', 'MANIFEST_RELATIVE_PATHS_REQUIRED'],
    ['freshNonemptyFiles', 'MANIFEST_FRESH_FILES_REQUIRED'],
    ['byteCountsVerified', 'MANIFEST_BYTE_COUNTS_REQUIRED'],
    ['sha256Verified', 'MANIFEST_SHA256_REQUIRED'],
    ['deterministicOrder', 'MANIFEST_DETERMINISTIC_ORDER_REQUIRED'],
    ['runtimeRecorded', 'MANIFEST_RUNTIME_REQUIRED'],
    ['releaseRecorded', 'MANIFEST_RELEASE_REQUIRED'],
    ['toolboxEvidenceRecorded', 'MANIFEST_TOOLBOX_EVIDENCE_REQUIRED'],
    ['executionRecorded', 'MANIFEST_EXECUTION_EVIDENCE_REQUIRED'],
    ['artifactValidationPassed', 'MANIFEST_ARTIFACT_VALIDATION_REQUIRED'],
  ]) {
    const value = readEvidenceBoolean(contract, key, `manifestContract.${key}`, code, missingInputs, errors);
    if (value === false) addSemanticIssue(errors, code, `manifestContract.${key}`, `${key} must be verified before manifest success.`);
  }
  const toolboxEvidenceScope = normalizeSemanticToken(ownValue(contract, 'toolboxEvidenceScope'));
  if (!toolboxEvidenceScope) {
    addSemanticIssue(missingInputs, 'MANIFEST_TOOLBOX_SCOPE_REQUIRED', 'manifestContract.toolboxEvidenceScope', 'Record installation-only, license, or invocation toolbox evidence scope.');
  } else if (!['installation-only', 'license', 'invocation'].includes(toolboxEvidenceScope)) {
    addSemanticIssue(errors, 'MANIFEST_TOOLBOX_SCOPE_INVALID', 'manifestContract.toolboxEvidenceScope', 'Toolbox evidence scope must be installation-only, license, or invocation.');
  } else if (nativeHelper && toolboxEvidenceScope !== MATLAB_RUNTIME_EXPORT_RULES.manifest.nativeToolboxEvidenceScope) {
    addSemanticIssue(errors, 'MANIFEST_TOOLBOX_SCOPE_OVERSTATED', 'manifestContract.toolboxEvidenceScope', `oi_write_manifest records ${MATLAB_RUNTIME_EXPORT_RULES.manifest.nativeToolboxEvidenceScope} toolbox evidence only.`);
  }
  if (formats.includes('png')) {
    const dimensions = readEvidenceBoolean(contract, 'pngDimensionsVerified', 'manifestContract.pngDimensionsVerified', 'MANIFEST_PNG_DIMENSIONS_REQUIRED', missingInputs, errors);
    if (dimensions === false) addSemanticIssue(errors, 'MANIFEST_PNG_DIMENSIONS_REQUIRED', 'manifestContract.pngDimensionsVerified', 'PNG width, height, and DPI must be verified.');
  }
  if (formats.includes('pdf')) {
    for (const [key, reason] of [
      ['pdfTextVerified', 'PDF text evidence must be recorded.'],
      ['pdfPagesVerified', 'PDF page count and physical dimensions must be verified.'],
    ]) {
      const value = readEvidenceBoolean(contract, key, `manifestContract.${key}`, 'MANIFEST_PDF_EVIDENCE_REQUIRED', missingInputs, errors);
      if (value === false) addSemanticIssue(errors, 'MANIFEST_PDF_EVIDENCE_REQUIRED', `manifestContract.${key}`, reason);
    }
  }
  if (formats.includes('svg')) {
    const accessibility = readEvidenceBoolean(contract, 'svgAccessibilityVerified', 'manifestContract.svgAccessibilityVerified', 'MANIFEST_SVG_ACCESSIBILITY_REQUIRED', missingInputs, errors);
    if (accessibility === false) addSemanticIssue(errors, 'MANIFEST_SVG_ACCESSIBILITY_REQUIRED', 'manifestContract.svgAccessibilityVerified', 'SVG description, text, and accessibility evidence must be verified.');
  }
  const visualInspection = semanticObject(ownValue(contract, 'visualInspection'));
  const visualStatus = normalizeSemanticToken(ownValue(visualInspection, 'status'));
  if (!visualStatus) {
    addSemanticIssue(missingInputs, 'MANIFEST_VISUAL_STATUS_REQUIRED', 'manifestContract.visualInspection.status', 'Record passed, failed, or not_run visual inspection status.');
  } else if (!['passed', 'failed', 'not-run'].includes(visualStatus)) {
    addSemanticIssue(errors, 'MANIFEST_VISUAL_STATUS_INVALID', 'manifestContract.visualInspection.status', 'Visual inspection status must be passed, failed, or not_run.');
  }
  const visuallyVerified = readEvidenceBoolean(visualInspection, 'verified', 'manifestContract.visualInspection.verified', 'MANIFEST_VISUAL_VERIFICATION_REQUIRED', missingInputs, errors);
  if ((visualStatus === 'not-run' && visuallyVerified === true) || (visualStatus === 'passed' && visuallyVerified !== true)) {
    addSemanticIssue(errors, 'MANIFEST_VISUAL_VERIFICATION_CONFLICT', 'manifestContract.visualInspection', 'Visual inspection status and verified flag conflict.');
  }
  if (visualStatus === 'failed') {
    addSemanticIssue(errors, 'MANIFEST_VISUAL_INSPECTION_FAILED', 'manifestContract.visualInspection.status', 'A failed visual inspection cannot produce a successful manifest.');
  }
}

function resolvePresentationLayout(release, mode, contract, missingInputs, errors, warnings) {
  const layout = semanticObject(contract.layout);
  const target = semanticObject(contract.target);
  const typography = semanticObject(contract.typography);
  const clipping = semanticObject(contract.clipping);
  const width = Number(layout.width ?? target.width);
  const height = Number(layout.height ?? target.height);
  const units = normalizePhysicalUnits(layout.units ?? target.units);
  const baseFontSize = Number(layout.baseFontSize ?? typography.baseSizePt);
  const architecture = normalizeSemanticToken(layout.architecture);
  const multiPanel = layout.multiPanel === true || architecture === 'tiledlayout'
    || (Number(layout.rows) * Number(layout.columns) > 1);
  const spacingExplicit = layout.spacingExplicit ?? Boolean(layout.tileSpacing && layout.padding);
  const clippingAudit = layout.clippingAudit ?? (
    clipping.drawnowBeforeAudit === true
    && clipping.boundsCheckRequired === true
    && clipping.overlapCheckRequired === true
  );

  if (!(width > 0)) addSemanticIssue(missingInputs, 'LAYOUT_WIDTH_REQUIRED', 'layout.width', 'Declare the final positive figure width.');
  if (!(height > 0)) addSemanticIssue(missingInputs, 'LAYOUT_HEIGHT_REQUIRED', 'layout.height', 'Declare the final positive figure height.');
  if (!['centimeters', 'inches', 'points', 'pixels'].includes(units)) {
    addSemanticIssue(missingInputs, 'LAYOUT_UNITS_REQUIRED', 'layout.units', 'Declare centimeters, inches, points, or pixels.');
  }
  if (!(baseFontSize > 0)) addSemanticIssue(missingInputs, 'BASE_FONT_SIZE_REQUIRED', 'layout.baseFontSize', 'Declare the final-size base font size.');
  validateRequiredBoolean({ clippingAudit }, 'clippingAudit', 'CLIPPING_AUDIT_REQUIRED', 'layout.clippingAudit', missingInputs, errors);
  if (multiPanel) {
    validateRequiredBoolean({ spacingExplicit }, 'spacingExplicit', 'LAYOUT_SPACING_REQUIRED', 'layout.spacingExplicit', missingInputs, errors);
  }

  const exactDimensions = layout.exactDimensions !== false;
  const sizing = exactDimensions
    ? selectMatlabApi(release, 'exportgraphicsSizing')
    : { status: 'not-requested', strategy: 'not-requested', api: null, targetRelease: release };
  if (exactDimensions && sizing.status === 'fallback') {
    addSemanticIssue(warnings, 'EXPORT_SIZING_FALLBACK', 'layout.exactDimensions', `Use explicit figure size and paper geometry in ${release}, then verify exported dimensions and clipping.`);
  }

  return {
    mode,
    width: width > 0 ? width : null,
    height: height > 0 ? height : null,
    units: units || null,
    baseFontSize: baseFontSize > 0 ? baseFontSize : null,
    multiPanel,
    sizing,
    strategy: 'fixed-final-size-with-post-export-clipping-audit',
  };
}

function resolvePresentationTypography(contract, missingInputs, errors) {
  const typography = semanticObject(contract.typography);
  const localization = semanticObject(contract.localization);
  const languages = normalizeSemanticStringArray(typography.languages ?? localization.languages).map(normalizeSemanticToken);
  const fontCandidates = uniqueStrings([
    ...normalizeSemanticStringArray(typography.fontCandidates),
    ...normalizeSemanticStringArray(typography.fallbackFamilies),
    typography.fontFamily,
  ]);
  const hasCjk = localization.chineseRequired === true
    || languages.some((language) => /^(?:zh|ja|ko)(?:-|$)|cjk|chinese|japanese|korean/u.test(language));
  const interpreter = normalizeSemanticToken(typography.interpreter);
  const glyphAudit = typography.glyphAudit ?? localization.glyphCheckRequired;

  if (!languages.length) addSemanticIssue(missingInputs, 'TEXT_LANGUAGES_REQUIRED', 'typography.languages', 'Declare all language and script requirements.');
  validateRequiredBoolean(typography, 'fontProbe', 'FONT_PROBE_REQUIRED', 'typography.fontProbe', missingInputs, errors);
  validateRequiredBoolean({ glyphAudit }, 'glyphAudit', 'GLYPH_AUDIT_REQUIRED', 'typography.glyphAudit', missingInputs, errors);
  if (hasCjk && normalizeSemanticToken(typography.missingFontPolicy) !== 'fail') {
    addSemanticIssue(missingInputs, 'CJK_MISSING_FONT_POLICY_REQUIRED', 'typography.missingFontPolicy', 'CJK output must fail explicitly when no verified font is available.');
  }
  if (hasCjk && !fontCandidates.length) {
    addSemanticIssue(missingInputs, 'CJK_FONT_CANDIDATES_REQUIRED', 'typography.fontCandidates', 'Declare an ordered list of CJK-capable font candidates for the execution host.');
  }
  if (typography.literalText === true && interpreter !== 'none') {
    addSemanticIssue(errors, 'LITERAL_TEXT_INTERPRETER_INVALID', 'typography.interpreter', 'Literal multilingual labels require Interpreter="none".');
  }

  return {
    languages,
    hasCjk,
    fontCandidates,
    interpreter: interpreter || null,
    fontProbe: typography.fontProbe === true ? 'listfonts / configured host font probe' : null,
    glyphAudit: glyphAudit === true ? 'per-export-format' : null,
    missingFontPolicy: hasCjk ? 'fail' : normalizeSemanticToken(typography.missingFontPolicy) || null,
    strategy: 'probe-select-apply-and-audit-every-text-object',
  };
}

function resolvePresentationColor(contract, missingInputs, errors) {
  const color = semanticObject(contract.color);
  const paletteClass = normalizeSemanticToken(color.paletteClass);
  const paletteSource = String(color.paletteSource || '').trim();
  const missingAppearance = String(color.missingAppearance || '').trim();
  if (!MATLAB_PRESENTATION_RULES.color.allowedPaletteClasses.includes(paletteClass)) {
    addSemanticIssue(missingInputs, 'PALETTE_CLASS_REQUIRED', 'color.paletteClass', 'Declare sequential, diverging, cyclic, categorical, line-series, or monochrome color semantics.');
  }
  if (!paletteSource) addSemanticIssue(missingInputs, 'PALETTE_SOURCE_REQUIRED', 'color.paletteSource', 'Declare the palette source and deterministic ordering.');
  if (MATLAB_PRESENTATION_RULES.color.forbiddenPalettes.some((name) => normalizeSemanticToken(paletteSource).includes(name))) {
    addSemanticIssue(errors, 'RAINBOW_PALETTE_FORBIDDEN', 'color.paletteSource', 'jet, rainbow, and hsv palettes are forbidden for quantitative publication graphics.');
  }
  if (!missingAppearance) {
    addSemanticIssue(missingInputs, 'MISSING_COLOR_APPEARANCE_REQUIRED', 'color.missingAppearance', 'Declare how missing or masked values differ from valid extrema and zero.');
  }
  const reference = color.reference;
  if (paletteClass === 'diverging' && reference === undefined) {
    addSemanticIssue(missingInputs, 'DIVERGING_REFERENCE_REQUIRED', 'color.reference', 'Declare the scientifically meaningful diverging center.');
  }
  return {
    paletteClass: paletteClass || null,
    paletteSource: paletteSource || null,
    missingAppearance: missingAppearance || null,
    reference: reference ?? null,
    strategy: 'perceptual-palette-with-explicit-missing-and-reference-semantics',
  };
}

function resolvePresentationAccessibility(contract, missingInputs, errors) {
  const accessibility = semanticObject(contract.accessibility);
  const color = semanticObject(contract.color);
  const contrastAudit = accessibility.contrastAudit ?? (Number(color.minimumContrastRatio) >= 4.5 || undefined);
  const nonColorEncoding = accessibility.nonColorEncoding ?? (
    color.colorOnlyEncodingAllowed === false && accessibility.redundantEncodingRequired === true
      ? true
      : undefined
  );
  const grayscaleAudit = accessibility.grayscaleAudit ?? color.grayscaleCheckRequired;
  const colorVisionAudit = accessibility.colorVisionAudit ?? color.colorVisionCheckRequired;
  validateRequiredBoolean({ contrastAudit }, 'contrastAudit', 'CONTRAST_AUDIT_REQUIRED', 'accessibility.contrastAudit', missingInputs, errors);
  validateRequiredBoolean({ nonColorEncoding }, 'nonColorEncoding', 'NON_COLOR_ENCODING_REQUIRED', 'accessibility.nonColorEncoding', missingInputs, errors);
  validateRequiredBoolean({ grayscaleAudit }, 'grayscaleAudit', 'GRAYSCALE_AUDIT_REQUIRED', 'accessibility.grayscaleAudit', missingInputs, errors);
  validateRequiredBoolean({ colorVisionAudit }, 'colorVisionAudit', 'COLOR_VISION_AUDIT_REQUIRED', 'accessibility.colorVisionAudit', missingInputs, errors);
  const altText = String(accessibility.altText || '').trim();
  if (!altText) addSemanticIssue(missingInputs, 'ALT_TEXT_REQUIRED', 'accessibility.altText', 'Provide a concise scientific description for the artifact manifest or accessible container.');

  return {
    altText,
    contrastAudit: contrastAudit === true,
    nonColorEncoding: nonColorEncoding === true,
    grayscaleAudit: grayscaleAudit === true,
    colorVisionAudit: colorVisionAudit === true,
    strategy: 'audited-contrast-plus-redundant-encoding',
  };
}

function resolvePresentationExports(release, contract, missingInputs, errors, warnings) {
  const exportContract = semanticObject(contract.export);
  const target = semanticObject(contract.target);
  const color = semanticObject(contract.color);
  const localization = semanticObject(contract.localization);
  const formats = uniqueStrings(exportContract.formats ?? contract.exportFormats ?? target.formats).map(normalizeMatlabExportFormat);
  if (!formats.length) addSemanticIssue(missingInputs, 'EXPORT_FORMATS_REQUIRED', 'export.formats', 'Declare every required output format.');
  const background = String(exportContract.background || color.background || '').trim();
  if (!background) addSemanticIssue(missingInputs, 'EXPORT_BACKGROUND_REQUIRED', 'export.background', 'Declare an opaque or intentionally transparent background.');
  validateRequiredBoolean(exportContract, 'freshOutput', 'FRESH_OUTPUT_REQUIRED', 'export.freshOutput', missingInputs, errors);

  const contentType = normalizeSemanticToken(exportContract.contentType);
  if (formats.includes('pdf') && !['vector', 'image', 'auto'].includes(contentType)) {
    addSemanticIssue(missingInputs, 'PDF_CONTENT_TYPE_REQUIRED', 'export.contentType', 'Declare vector, image, or explicit auto PDF content type.');
  }
  const plans = Object.fromEntries(formats.map((format) => [
    format,
    selectMatlabExportStrategy(release, format),
  ]));
  if (formats.some((format) => ['pdf', 'svg'].includes(format))) {
    validateRequiredBoolean(exportContract, 'fontEmbeddingAudit', 'FONT_EMBEDDING_AUDIT_REQUIRED', 'export.fontEmbeddingAudit', missingInputs, errors);
  }

  const multipagePdf = exportContract.multipagePdf === true;
  let multipage = { status: 'not-requested', strategy: 'not-requested', api: null };
  if (multipagePdf) {
    if (!formats.includes('pdf')) {
      addSemanticIssue(errors, 'MULTIPAGE_PDF_FORMAT_INVALID', 'export.formats', 'Multipage PDF requires pdf in export.formats.');
    }
    multipage = selectMatlabApi(release, 'exportgraphicsAppend');
    if (multipage.status === 'fallback') {
      addSemanticIssue(warnings, 'MULTIPAGE_PDF_FALLBACK', 'export.multipagePdf', `Append is unavailable in ${release}; emit separate PDFs or use a separately verified merge tool.`);
    }
  }

  if (formats.includes('svg')) {
    const svgAccessibilityAudit = exportContract.svgAccessibilityAudit
      ?? (localization.glyphCheckRequired === true && localization.glyphFormats?.includes('svg') ? true : undefined);
    validateRequiredBoolean({ svgAccessibilityAudit }, 'svgAccessibilityAudit', 'SVG_ACCESSIBILITY_AUDIT_REQUIRED', 'export.svgAccessibilityAudit', missingInputs, errors);
    if (plans.svg.api === 'print') {
      addSemanticIssue(warnings, 'SVG_PRINT_FALLBACK', 'export.formats', `Direct exportgraphics SVG is unavailable in ${release}; use print -dsvg and audit clipping, fonts, and text anchoring.`);
    }
  }

  return {
    formats,
    background: background || null,
    contentType: contentType || null,
    plans,
    multipage,
    strategy: 'fresh-format-specific-export-with-artifact-verification',
  };
}

function resolvePresentationInteraction(release, mode, contract, missingInputs, errors, warnings) {
  const interaction = semanticObject(contract.interaction);
  const execution = semanticObject(contract.execution);
  const headlessContract = semanticObject(contract.headless);
  const headless = execution.headless === true || contract.headless === true;
  const headlessSupported = headlessContract.supported === true;
  const requested = interaction.required === true || normalizeSemanticToken(interaction.mode) === 'dual'
    || ['interactive', 'app'].includes(mode);
  const fullAppExport = interaction.fullAppExport === true || normalizeSemanticToken(interaction.exportTarget) === 'app';
  const target = normalizeSemanticToken(interaction.target || (mode === 'app' ? 'uiaxes' : 'axes'));
  const batch = headless || headlessSupported ? selectMatlabApi(release, 'matlabBatch') : null;

  if (headlessSupported) {
    if (normalizeSemanticToken(headlessContract.figureVisible) !== 'off') {
      addSemanticIssue(missingInputs, 'HEADLESS_INVISIBLE_FIGURE_REQUIRED', 'headless.figureVisible', 'Set the canonical headless figure visibility explicitly to off.');
    }
    validateRequiredBoolean(headlessContract, 'desktopIndependent', 'HEADLESS_DESKTOP_INDEPENDENCE_REQUIRED', 'headless.desktopIndependent', missingInputs, errors);
    const command = String(headlessContract.command || '').trim();
    const usesBatch = /(?:^|\s)-batch(?:\s|$)/u.test(command);
    if (batch.status === 'native' && !usesBatch) {
      addSemanticIssue(errors, 'HEADLESS_COMMAND_RELEASE_CONFLICT', 'headless.command', `${release} should use matlab -batch for unattended execution.`);
    }
    if (batch.status === 'fallback' && usesBatch) {
      addSemanticIssue(errors, 'HEADLESS_COMMAND_RELEASE_CONFLICT', 'headless.command', `${release} does not support matlab -batch; use the explicit legacy try/catch/exit path.`);
    }
  }

  if (headless) {
    validateRequiredBoolean(execution, 'nonInteractive', 'HEADLESS_NONINTERACTIVE_REQUIRED', 'execution.nonInteractive', missingInputs, errors);
    if (normalizeSemanticToken(execution.figureVisible) !== 'off') {
      addSemanticIssue(missingInputs, 'HEADLESS_INVISIBLE_FIGURE_REQUIRED', 'execution.figureVisible', 'Set the canonical export figure visibility explicitly to off.');
    }
    if (execution.dialogs === true || execution.waitForInput === true) {
      addSemanticIssue(errors, 'HEADLESS_INPUT_UNSUPPORTED', 'execution', 'Headless output cannot use dialogs, ginput, pauses, or UI waits.');
    }
    if (execution.noJvm === true) {
      addSemanticIssue(errors, 'HEADLESS_NOJVM_UNSUPPORTED', 'execution.noJvm', 'Do not use -nojvm for publication fonts, Java-backed graphics, or UI components.');
    }
  }
  if (!requested) {
    return {
      requested: false,
      headless,
      headlessSupported,
      target,
      batch,
      strategy: headless ? 'invisible-traditional-figure-export' : 'static-desktop-or-batch-export',
      dataTips: null,
      brushing: null,
      appExport: null,
    };
  }

  const stableIdentifiers = interaction.stableIdentifiers ?? interaction.stableObservationIdsRequired;
  const staticFallback = interaction.staticFallback ?? interaction.staticFallbackRequired;
  const staticEquivalent = interaction.staticEquivalent ?? staticFallback;
  validateRequiredBoolean({ stableIdentifiers }, 'stableIdentifiers', 'STABLE_IDENTIFIERS_REQUIRED', 'interaction.stableIdentifiers', missingInputs, errors);
  validateRequiredBoolean({ staticEquivalent }, 'staticEquivalent', 'STATIC_EQUIVALENT_REQUIRED', 'interaction.staticEquivalent', missingInputs, errors);
  validateRequiredBoolean({ staticFallback }, 'staticFallback', 'STATIC_FALLBACK_REQUIRED', 'interaction.staticFallback', missingInputs, errors);

  let appExport = null;
  if (fullAppExport) {
    appExport = selectMatlabApi(release, 'exportapp');
    if (appExport.status === 'fallback') {
      addSemanticIssue(errors, 'FULL_APP_EXPORT_UNSUPPORTED', 'interaction.fullAppExport', `exportapp requires ${CAPABILITY_DEFINITIONS.exportapp.introduced} or newer; a conventional figure is not a full-interface equivalent.`);
    }
  }
  if (headless && fullAppExport && interaction.headlessUiVerified !== true) {
    addSemanticIssue(errors, 'HEADLESS_APP_EXPORT_UNSUPPORTED', 'interaction.headlessUiVerified', 'Full uifigure export requires verification on the exact headless host and startup combination.');
  }
  if (headless && staticFallback !== true) {
    addSemanticIssue(errors, 'HEADLESS_INTERACTION_UNSUPPORTED', 'interaction.staticFallback', 'Disable transient interactions and provide an invisible traditional-figure static fallback.');
  }

  if (headless && staticFallback === true && !fullAppExport) {
    addSemanticIssue(warnings, 'INTERACTION_DISABLED_FOR_HEADLESS', 'interaction', 'Disable data tips, brushing, toolbars, and callbacks in the canonical static export.');
    return {
      requested: true,
      headless: true,
      headlessSupported,
      target,
      batch,
      strategy: 'static-equivalent-with-interactions-disabled',
      dataTips: null,
      brushing: null,
      appExport: null,
    };
  }
  if (headless && fullAppExport && interaction.headlessUiVerified === true) {
    addSemanticIssue(warnings, 'TRANSIENT_INTERACTION_EXCLUDED_FROM_APP_EXPORT', 'interaction', 'Verified headless exportapp captures the interface, not transient hover, brushing, or toolbar state.');
    return {
      requested: true,
      headless: true,
      headlessSupported,
      target,
      batch,
      strategy: 'verified-headless-app-export-with-transient-interactions-disabled',
      dataTips: null,
      brushing: null,
      appExport,
    };
  }

  const dataTips = interaction.dataTips === false ? null : selectMatlabApi(release, 'dataTipTemplate');
  let brushing = null;
  if (interaction.brushing === true) {
    brushing = selectMatlabApi(
      release,
      ['uiaxes', 'uifigure'].includes(target) ? 'brushAxesUifigure' : 'brushAxesTraditional',
    );
  }
  return {
    requested: true,
    headless,
    headlessSupported,
    target,
    batch,
    strategy: headless ? 'static-equivalent-with-interactions-disabled' : 'desktop-interaction-plus-static-equivalent',
    dataTips,
    brushing,
    appExport,
  };
}

function resolveDimensionSemantics(contract, missingInputs, errors) {
  const rawShape = contract.shape ?? contract.dimensions;
  const shape = normalizePositiveIntegerArray(rawShape);
  const dimensionOrder = normalizeSemanticStringArray(contract.dimensionOrder);
  const observationDimension = normalizeObservationDimension(contract.observationDimension, dimensionOrder);

  if (!shape.length) {
    addSemanticIssue(
      rawShape === undefined ? missingInputs : errors,
      rawShape === undefined ? 'DIMENSION_SHAPE_REQUIRED' : 'DIMENSION_SHAPE_INVALID',
      'shape',
      'Declare the full data shape as positive integer dimensions.',
    );
  }
  if (!dimensionOrder.length) {
    addSemanticIssue(missingInputs, 'DIMENSION_ORDER_REQUIRED', 'dimensionOrder', 'Declare the meaning and order of every dimension.');
  }
  if (shape.length && dimensionOrder.length && shape.length !== dimensionOrder.length) {
    addSemanticIssue(errors, 'DIMENSION_ORDER_MISMATCH', 'dimensionOrder', 'dimensionOrder must contain one label for every shape entry.');
  }
  if (dimensionOrder.length !== new Set(dimensionOrder).size) {
    addSemanticIssue(errors, 'DIMENSION_ORDER_DUPLICATE', 'dimensionOrder', 'dimensionOrder labels must be unique.');
  }
  if (!observationDimension.value) {
    addSemanticIssue(missingInputs, 'OBSERVATION_DIMENSION_REQUIRED', 'observationDimension', 'Declare the one-based observation dimension.');
  } else if (observationDimension.invalid || (shape.length && observationDimension.index > shape.length)) {
    addSemanticIssue(errors, 'OBSERVATION_DIMENSION_INVALID', 'observationDimension', 'observationDimension is outside the declared rank.');
  }

  const pairedShapes = Array.isArray(contract.pairedShapes) ? contract.pairedShapes : [];
  pairedShapes.forEach((pair, index) => {
    const left = normalizePositiveIntegerArray(pair?.left ?? pair?.leftShape);
    const right = normalizePositiveIntegerArray(pair?.right ?? pair?.rightShape);
    if (!sameArray(left, right)) {
      addSemanticIssue(errors, 'PAIRED_SHAPE_MISMATCH', `pairedShapes[${index}]`, 'Paired scientific arrays must have equal shape.');
    }
  });

  return {
    shape,
    dimensionOrder,
    observationDimension: observationDimension.value,
    observationDimensionIndex: observationDimension.index,
    strategy: 'preserve-exact-shape-and-order',
    forbiddenImplicitTransforms: MATLAB_DATA_SEMANTIC_RULES.dimensions.forbiddenImplicitTransforms,
  };
}

function resolveUnitSemantics(contract, missingInputs, errors) {
  const units = normalizeSemanticStringMap(contract.units);
  const quantityKeys = Object.keys(semanticObject(contract.quantities));
  const requiredUnitKeys = contract.requiresUnits === false
    ? []
    : uniqueStrings(contract.requiredUnitKeys?.length ? contract.requiredUnitKeys : (quantityKeys.length ? quantityKeys : ['value']));

  requiredUnitKeys.forEach((key) => {
    if (!units[key]) addSemanticIssue(missingInputs, 'UNIT_REQUIRED', `units.${key}`, `Declare units for ${key}.`);
  });

  const compatibleUnitPairs = Array.isArray(contract.compatibleUnitPairs) ? contract.compatibleUnitPairs : [];
  compatibleUnitPairs.forEach((pair, index) => {
    const leftKey = String(pair?.left || '').trim();
    const rightKey = String(pair?.right || '').trim();
    const leftUnit = units[leftKey];
    const rightUnit = units[rightKey];
    if (!leftKey || !rightKey) {
      addSemanticIssue(errors, 'UNIT_PAIR_INVALID', `compatibleUnitPairs[${index}]`, 'Unit compatibility pairs require left and right field names.');
    } else if (leftUnit && rightUnit && leftUnit !== rightUnit
      && !String(pair?.conversion || '').trim()
      && !hasExplicitUnitConversion(contract, leftUnit, rightUnit)) {
      addSemanticIssue(errors, 'UNIT_CONVERSION_REQUIRED', `compatibleUnitPairs[${index}]`, 'Different units require an explicit conversion.');
    }
  });

  return {
    values: units,
    requiredUnitKeys,
    compatibleUnitPairs,
    strategy: 'explicit-units-and-conversions',
  };
}

function resolveTimeSemantics(release, contract, missingInputs, errors, warnings) {
  const coordinateMetadata = semanticObject(contract.coordinates);
  const coordinates = normalizeCoordinateNames(contract.coordinates);
  const requested = contract.hasTime === true
    || coordinates.includes('time')
    || Boolean(contract.timeClass || contract.timeType || contract.timeZone || coordinateMetadata.timeZone);
  if (!requested) return { status: 'not-requested', strategy: 'not-requested', api: null };

  const timeClass = normalizeSemanticToken(contract.timeClass || contract.timeType || contract.dataType);
  const timeZone = String(contract.timeZone || coordinateMetadata.timeZone || '').trim();
  const validation = {
    ...semanticObject(contract.timeValidation),
  };
  const timeDirection = normalizeSemanticToken(coordinateMetadata.directions?.time || contract.timeDirection);
  if (validation.strictlyIncreasing === undefined && timeDirection === 'increasing') validation.strictlyIncreasing = true;
  let status = 'native';
  let strategy = 'native';
  let api = timeClass || null;

  if (!['datetime', 'timetable', 'datenum'].includes(timeClass)) {
    addSemanticIssue(missingInputs, 'TIME_CLASS_REQUIRED', 'timeClass', 'Declare datetime, timetable, or explicit legacy datenum representation.');
  }
  if (!timeZone) {
    addSemanticIssue(missingInputs, 'TIMEZONE_REQUIRED', 'timeZone', 'Declare an explicit source timezone.');
  } else if (!validTimeZone(timeZone)) {
    addSemanticIssue(errors, 'TIMEZONE_INVALID', 'timeZone', `Unknown timezone: ${timeZone}.`);
  }
  validateRequiredBoolean(validation, 'nonNaT', 'TIME_NON_NAT_REQUIRED', 'timeValidation.nonNaT', missingInputs, errors);
  validateRequiredBoolean(validation, 'unique', 'TIME_UNIQUE_REQUIRED', 'timeValidation.unique', missingInputs, errors);
  validateRequiredBoolean(validation, 'strictlyIncreasing', 'TIME_ORDER_REQUIRED', 'timeValidation.strictlyIncreasing', missingInputs, errors);

  if (timeClass === 'datetime' && compareMatlabReleases(release, CAPABILITY_DEFINITIONS.datetime.introduced) < 0) {
    status = 'fallback';
    strategy = 'explicit-fallback';
    api = 'datenum';
    addSemanticIssue(warnings, 'DATETIME_RELEASE_FALLBACK', 'timeClass', `datetime is unavailable in ${release}; convert at the plotting boundary and report timezone and format loss.`);
  } else if (timeClass === 'timetable' && compareMatlabReleases(release, CAPABILITY_DEFINITIONS.timetable.introduced) < 0) {
    status = 'fallback';
    strategy = 'explicit-fallback';
    if (compareMatlabReleases(release, CAPABILITY_DEFINITIONS.datetime.introduced) >= 0) {
      api = 'table + datetime column';
    } else if (compareMatlabReleases(release, CAPABILITY_DEFINITIONS.table.introduced) >= 0) {
      api = 'table + datenum column';
    } else {
      api = 'numeric arrays / struct + datenum';
    }
    addSemanticIssue(warnings, 'TIMETABLE_RELEASE_FALLBACK', 'timeClass', `timetable is unavailable in ${release}; preserve row time as an explicit column.`);
  } else if (timeClass === 'datenum') {
    status = 'fallback';
    strategy = 'explicit-legacy';
    api = 'datenum';
    addSemanticIssue(warnings, 'DATENUM_SEMANTIC_LOSS', 'timeClass', 'datenum cannot preserve timezone metadata; retain the declared timezone separately.');
  }

  return { status, strategy, api, timeClass, timeZone, validation };
}

function resolveMissingSemantics(contract, missingInputs, errors) {
  const missingMetadata = semanticObject(contract.missing);
  const statusValue = contract.missingStatus ?? missingMetadata.status;
  const rawStatus = typeof statusValue === 'boolean'
    ? (statusValue ? 'present' : 'absent')
    : normalizeSemanticToken(statusValue);
  const status = ['present', 'absent', 'unknown'].includes(rawStatus) ? rawStatus : '';
  const maskVariables = normalizeSemanticStringArray(missingMetadata.maskVariables);
  const masks = {
    ...semanticObject(contract.masks),
  };
  if (masks.separate === undefined && ['missing', 'invalid', 'suspect'].every((name) => maskVariables.includes(name))) {
    masks.separate = true;
  }
  const zeroIsValid = contract.zeroIsValid ?? missingMetadata.zeroIsValid;
  const missingSentinel = contract.missingSentinel ?? missingMetadata.sentinel;
  const sentinelDeclared = contract.sentinelDeclared ?? missingMetadata.sentinelDeclared;

  if (!status || status === 'unknown') {
    addSemanticIssue(missingInputs, 'MISSING_STATUS_REQUIRED', 'missingStatus', 'Declare whether missing values are present.');
  }
  if (typeof zeroIsValid !== 'boolean') {
    addSemanticIssue(missingInputs, 'ZERO_VALIDITY_REQUIRED', 'zeroIsValid', 'Declare whether zero is a valid observation.');
  }
  if (status === 'present' && masks.separate !== true) {
    addSemanticIssue(missingInputs, 'SEPARATE_MASKS_REQUIRED', 'masks.separate', 'Keep missing, invalid, and suspect masks separate.');
  }
  if (missingSentinel !== undefined && sentinelDeclared !== true) {
    addSemanticIssue(errors, 'MISSING_SENTINEL_UNDECLARED', 'missingSentinel', 'A numeric sentinel must be explicitly declared before conversion to NaN or NaT.');
  }

  return {
    status: status || 'undeclared',
    zeroIsValid,
    masks,
    representation: String(missingMetadata.representation || '').trim(),
    strategy: 'preserve-gaps-no-silent-fill',
  };
}

function resolveQualityControlSemantics(contract, dimensions, missingInputs, errors, requiredProductIds) {
  const qualityControl = semanticObject(contract.qualityControl ?? contract.qc);
  const status = normalizeSemanticToken(qualityControl.status);
  const present = status === 'present' || qualityControl.present === true
    || Boolean(qualityControl.flagName || qualityControl.variable || contract.qcFlag);
  if (!present) return { status: 'not-requested', strategy: 'not-requested' };

  const alignment = qualityControl.alignment;
  const aligned = qualityControl.aligned !== undefined
    ? qualityControl.aligned
    : (alignment ? alignment === dimensions.observationDimension : undefined);
  validateRequiredBoolean({ aligned }, 'aligned', 'QC_ALIGNMENT_REQUIRED', 'qualityControl.aligned', missingInputs, errors);
  validateRequiredBoolean(qualityControl, 'preserveRawFlags', 'QC_FLAGS_PRESERVED_REQUIRED', 'qualityControl.preserveRawFlags', missingInputs, errors);
  const maskVariables = normalizeSemanticStringArray(semanticObject(contract.missing).maskVariables);
  const separateSuspectMask = qualityControl.separateSuspectMask !== undefined
    ? qualityControl.separateSuspectMask
    : (maskVariables.length ? maskVariables.includes('suspect') : undefined);
  validateRequiredBoolean({ separateSuspectMask }, 'separateSuspectMask', 'QC_SUSPECT_MASK_REQUIRED', 'qualityControl.separateSuspectMask', missingInputs, errors);
  validateAlignedShape(qualityControl.shape, dimensions.shape, 'QC_SHAPE_MISMATCH', 'qualityControl.shape', errors);

  const method = normalizeSemanticToken(qualityControl.method || 'flags');
  const statisticsMethods = new Set(['isoutlier', 'filloutliers', 'rmoutliers', 'boxplot']);
  if (statisticsMethods.has(method)) {
    requiredProductIds.add('statistics');
    const declaredToolboxes = uniqueStrings(contract.requiredToolboxes?.length ? contract.requiredToolboxes : contract.toolboxes);
    if (!declaredToolboxes.includes('statistics')) {
      addSemanticIssue(missingInputs, 'TOOLBOX_DECLARATION_REQUIRED', 'toolboxes', `${method} requires an explicit statistics toolbox dependency.`);
    }
  }

  return {
    status: 'requested',
    strategy: 'preserve-flags-and-separate-suspect-mask',
    method,
    observationDimension: dimensions.observationDimension,
  };
}

function resolveUncertaintySemantics(contract, dimensions, units, missingInputs, errors) {
  const uncertainty = semanticObject(contract.uncertainty);
  const uncertaintyStatus = normalizeSemanticToken(uncertainty.status);
  const present = contract.requiresUncertainty === true
    || uncertaintyStatus === 'present'
    || uncertainty.present === true
    || Boolean(contract.uncertaintyType || uncertainty.type);
  if (!present) return { status: 'not-requested', strategy: 'not-requested' };

  const type = normalizeSemanticToken(contract.uncertaintyType || uncertainty.type);
  const unit = String(uncertainty.unit || units.values.uncertainty || '').trim();
  if (!type) {
    addSemanticIssue(missingInputs, 'UNCERTAINTY_TYPE_REQUIRED', 'uncertainty.type', 'Declare the scientific meaning of uncertainty.');
  } else if (!MATLAB_DATA_SEMANTIC_RULES.uncertainty.allowedTypes.includes(type)) {
    addSemanticIssue(errors, 'UNCERTAINTY_TYPE_UNSUPPORTED', 'uncertainty.type', `Unsupported uncertainty type: ${type}.`);
  }
  if (!unit) addSemanticIssue(missingInputs, 'UNCERTAINTY_UNIT_REQUIRED', 'uncertainty.unit', 'Declare uncertainty units.');
  if (unit && units.values.value && unit !== units.values.value
    && !String(uncertainty.conversion || '').trim()
    && !hasExplicitUnitConversion(contract, unit, units.values.value)) {
    addSemanticIssue(errors, 'UNCERTAINTY_UNIT_MISMATCH', 'uncertainty.unit', 'Uncertainty units must match value units or declare a conversion.');
  }
  const aligned = uncertainty.aligned !== undefined
    ? uncertainty.aligned
    : (uncertainty.alignment ? uncertainty.alignment === dimensions.observationDimension : undefined);
  validateRequiredBoolean({ aligned }, 'aligned', 'UNCERTAINTY_ALIGNMENT_REQUIRED', 'uncertainty.aligned', missingInputs, errors);
  validateRequiredBoolean(uncertainty, 'finiteNonnegative', 'UNCERTAINTY_MAGNITUDE_REQUIRED', 'uncertainty.finiteNonnegative', missingInputs, errors);
  validateAlignedShape(uncertainty.shape, dimensions.shape, 'UNCERTAINTY_SHAPE_MISMATCH', 'uncertainty.shape', errors);
  if (uncertainty.hasBounds === true) {
    validateRequiredBoolean(uncertainty, 'boundsOrdered', 'UNCERTAINTY_BOUNDS_ORDER_REQUIRED', 'uncertainty.boundsOrdered', missingInputs, errors);
  }
  if (contract.logScale === true) {
    validateRequiredBoolean(uncertainty, 'positiveForLogScale', 'UNCERTAINTY_LOG_POSITIVE_REQUIRED', 'uncertainty.positiveForLogScale', missingInputs, errors);
  }

  return {
    status: 'requested',
    strategy: 'preserve-type-units-and-alignment',
    type,
    unit,
    observationDimension: dimensions.observationDimension,
  };
}

function resolveCoordinateDirectionSemantics(contract, units, missingInputs, errors, warnings) {
  const coordinateMetadata = semanticObject(contract.coordinates);
  const verticalMetadata = semanticObject(coordinateMetadata.vertical || contract.vertical);
  const coordinates = normalizeCoordinateNames(contract.coordinates);
  const requested = contract.requiresVerticalDirection === true
    || coordinates.some((name) => ['depth', 'pressure', 'elevation', 'height', 'vertical'].includes(name))
    || Boolean(contract.verticalCoordinate || contract.verticalPositive || contract.verticalReference
      || verticalMetadata.coordinate || verticalMetadata.positive || verticalMetadata.reference);
  if (!requested) return { status: 'not-requested', strategy: 'not-requested' };

  const kind = normalizeSemanticToken(contract.verticalCoordinate || contract.verticalCoordinateType || verticalMetadata.coordinate);
  const positive = normalizeSemanticToken(contract.verticalPositive || contract.positiveDirection || verticalMetadata.positive);
  const reference = String(contract.verticalReference || verticalMetadata.reference || '').trim();
  const unit = String(units.values[kind] || units.values.vertical || '').trim();
  let strategy = 'preserve-declared-direction';

  if (!['depth', 'pressure', 'elevation', 'height'].includes(kind)) {
    addSemanticIssue(missingInputs, 'VERTICAL_KIND_REQUIRED', 'verticalCoordinate', 'Declare depth, pressure, elevation, or height.');
  }
  if (!['up', 'down'].includes(positive)) {
    addSemanticIssue(missingInputs, 'VERTICAL_POSITIVE_REQUIRED', 'verticalPositive', 'Declare whether positive values point up or down.');
  }
  if (!reference) addSemanticIssue(missingInputs, 'VERTICAL_REFERENCE_REQUIRED', 'verticalReference', 'Declare the vertical datum or reference surface.');
  if (!unit) addSemanticIssue(missingInputs, 'VERTICAL_UNIT_REQUIRED', `units.${kind || 'vertical'}`, 'Declare vertical-coordinate units.');
  if (['depth', 'pressure'].includes(kind) && positive === 'up') {
    if (contract.explicitVerticalTransformation === true) {
      strategy = 'explicit-direction-transform';
      addSemanticIssue(warnings, 'VERTICAL_DIRECTION_TRANSFORM', 'verticalPositive', 'Apply and report the explicit positive-up to positive-down transformation.');
    } else {
      addSemanticIssue(errors, 'VERTICAL_DIRECTION_CONFLICT', 'verticalPositive', `${kind} positive-up data require an explicit transformation; do not reverse the axis silently.`);
    }
  }
  if (kind === 'pressure' && contract.labelAsDepth === true) {
    addSemanticIssue(errors, 'PRESSURE_RELABELLED_AS_DEPTH', 'labelAsDepth', 'Pressure cannot be labelled as depth without an explicit physical conversion.');
  }

  return { status: 'requested', strategy, kind, positive, reference, unit };
}

function normalizeExecutablePath(value) {
  return String(value || '').trim().replace(/^(?:"([^"\r\n]*)"|'([^'\r\n]*)')$/u, '$1$2');
}

function isAbsoluteMatlabExecutable(value) {
  const executable = normalizeExecutablePath(value);
  if (!executable || /[\u0000\r\n]/u.test(executable)) return false;
  const absolute = executable.startsWith('/')
    || /^[A-Za-z]:[\\/]/u.test(executable)
    || /^\\\\[^\\/]+[\\/][^\\/]+[\\/]/u.test(executable);
  const basename = executable.split(/[\\/]/u).at(-1)?.toLowerCase();
  return absolute && (basename === 'matlab' || basename === 'matlab.exe');
}

function analyzeMatlabCommand(command, executable) {
  const source = String(command || '');
  const tokens = [];
  let token = '';
  let quote = null;
  let exitStatusCanBeMasked = false;
  const pushToken = () => {
    if (!token) return;
    tokens.push(token);
    token = '';
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1] || '';
    if (quote) {
      if (character === quote) {
        quote = null;
      } else if (quote === '"' && character === '\\' && ['"', '\\', '$', '`'].includes(next)) {
        token += next;
        index += 1;
      } else {
        if (quote === '"' && (character === '`' || (character === '$' && next === '('))) {
          exitStatusCanBeMasked = true;
        }
        token += character;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/u.test(character)) {
      if (character === '\n' || character === '\r') exitStatusCanBeMasked = true;
      pushToken();
      continue;
    }
    const standaloneBackground = character === '&'
      && next !== '&'
      && source[index - 1] !== '>'
      && next !== '>';
    if (character === ';' || character === '|' || standaloneBackground
        || character === '`' || (character === '$' && next === '(')) {
      exitStatusCanBeMasked = true;
    }
    token += character;
  }
  pushToken();

  const expectedExecutable = normalizeExecutablePath(executable);
  const firstExecutable = tokens[0] || '';
  const firstExecutableBasename = firstExecutable.split(/[\\/]/u).at(-1)?.toLowerCase();
  const matlabPayload = tokens.slice(2).join(' ');
  return {
    wellFormed: quote === null,
    startsWithExecutable: firstExecutable === expectedExecutable,
    hasBatch: tokens.slice(1).includes('-batch'),
    hasRun: tokens.slice(1).includes('-r'),
    exitStatusCanBeMasked,
    invokesOctave: firstExecutableBasename === 'octave'
      || firstExecutableBasename === 'octave-cli'
      || firstExecutableBasename === 'octave.exe'
      || firstExecutableBasename === 'octave-cli.exe'
      || /\b(?:system|unix|dos)\s*\([^)]*\boctave(?:-cli)?(?:\.exe)?\b/iu.test(matlabPayload)
      || /(?:^|[;\s])!\s*octave(?:-cli)?(?:\.exe)?\b/iu.test(matlabPayload),
  };
}

function ownValue(source, key) {
  return Object.hasOwn(source, key) ? source[key] : undefined;
}

function normalizeReleaseEvidenceSource(value) {
  const source = String(value || '').trim();
  if (/^matlabRelease$/u.test(source)) return 'matlabRelease';
  if (/^version\(\s*(['"])-release\1\s*\)$/u.test(source)) return "version('-release')";
  return null;
}

function addSemanticIssue(collection, code, field, reason) {
  collection.push({ code, field, reason });
}

function readEvidenceBoolean(source, key, field, requiredCode, missingInputs, errors) {
  if (!Object.hasOwn(source, key) || source[key] === undefined) {
    addSemanticIssue(missingInputs, requiredCode, field, `Record ${field} as true or false.`);
    return null;
  }
  if (typeof source[key] !== 'boolean') {
    addSemanticIssue(errors, 'EVIDENCE_BOOLEAN_INVALID', field, `${field} must be boolean.`);
    return null;
  }
  return source[key];
}

function readRuntimeBoolean(value, field, requiredCode, missingInputs, errors) {
  if (value === undefined) {
    addSemanticIssue(missingInputs, requiredCode, field, `Record ${field} as true or false.`);
    return null;
  }
  if (typeof value !== 'boolean') {
    addSemanticIssue(errors, 'EVIDENCE_BOOLEAN_INVALID', field, `${field} must be boolean.`);
    return null;
  }
  return value;
}

function validateRequiredBoolean(source, key, code, field, missingInputs, errors) {
  if (source[key] === undefined) {
    addSemanticIssue(missingInputs, code, field, `Declare and validate ${field}.`);
  } else if (source[key] !== true) {
    addSemanticIssue(errors, code, field, `${field} must be true before plotting.`);
  }
}

function validateAlignedShape(candidate, expected, code, field, errors) {
  if (candidate === undefined) return;
  const shape = normalizePositiveIntegerArray(candidate);
  if (!sameArray(shape, expected)) addSemanticIssue(errors, code, field, `${field} must match the data shape.`);
}

function normalizePositiveIntegerArray(value) {
  const values = Array.isArray(value) ? value : [];
  return values.every((entry) => Number.isInteger(entry) && entry > 0) ? [...values] : [];
}

function normalizePositiveInteger(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function normalizeObservationDimension(value, dimensionOrder) {
  const numeric = normalizePositiveInteger(value);
  if (numeric) return { value: numeric, index: numeric, invalid: false };
  const label = String(value || '').trim();
  if (!label) return { value: null, index: null, invalid: false };
  const index = dimensionOrder.indexOf(label);
  return { value: label, index: index + 1, invalid: index < 0 };
}

function normalizeSemanticStringArray(value) {
  return Array.isArray(value) ? value.map((entry) => String(entry || '').trim()).filter(Boolean) : [];
}

function normalizeSemanticStringMap(value) {
  const source = semanticObject(value);
  return Object.fromEntries(Object.entries(source)
    .map(([key, entry]) => [String(key).trim(), String(entry || '').trim()])
    .filter(([key, entry]) => key && entry));
}

function normalizeCoordinateNames(value) {
  if (Array.isArray(value)) return value.map(normalizeSemanticToken).filter(Boolean);
  const source = semanticObject(value);
  if (Array.isArray(source.names)) return source.names.map(normalizeSemanticToken).filter(Boolean);
  return Object.entries(source)
    .filter(([name, enabled]) => !['directions', 'timeZone', 'vertical'].includes(name) && enabled)
    .map(([name]) => normalizeSemanticToken(name));
}

function normalizeSemanticToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_]+/gu, '-');
}

function normalizePhysicalUnits(value) {
  const units = normalizeSemanticToken(value);
  if (['cm', 'centimeter', 'centimeters'].includes(units)) return 'centimeters';
  if (['in', 'inch', 'inches'].includes(units)) return 'inches';
  if (['pt', 'point', 'points'].includes(units)) return 'points';
  if (['px', 'pixel', 'pixels'].includes(units)) return 'pixels';
  return units;
}

function semanticObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function sameArray(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function hasExplicitUnitConversion(contract, sourceUnit, targetUnit) {
  const conversions = Array.isArray(contract.unitConversions) ? contract.unitConversions : [];
  return conversions.some((conversion) => {
    const source = String(conversion?.sourceUnit || '').trim();
    const target = String(conversion?.targetUnit || '').trim();
    const formula = String(conversion?.formula || '').trim();
    return formula && ((source === sourceUnit && target === targetUnit) || (source === targetUnit && target === sourceUnit));
  });
}

function validTimeZone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function capability(introduced, fallback, notes, requiredProducts = ['matlab'], nativeApi = null) {
  return nativeApi
    ? { introduced, fallback, notes, requiredProducts, nativeApi }
    : { introduced, fallback, notes, requiredProducts };
}

function exportFormat(introduced, paths, notes = '') {
  return { introduced, paths, notes, requiredProducts: ['matlab'] };
}

function exportPath(api, introduced, syntax) {
  return { api, introduced, syntax };
}

function product(id, label, licenseFeature, requiredFor) {
  return { id, label, licenseFeature, requiredFor };
}

function requireKnownRelease(value) {
  const parsed = parseMatlabRelease(value);
  if (!parsed || !releaseWithinKnownRange(parsed.release)) {
    throw new RangeError(`Unsupported MATLAB release: ${String(value ?? '')}`);
  }
  return parsed;
}

function releaseWithinKnownRange(release) {
  const parsed = parseMatlabRelease(release);
  const earliest = parseMatlabRelease(MATLAB_RELEASE_RANGE.earliest);
  const latest = parseMatlabRelease(MATLAB_RELEASE_RANGE.latestKnown);
  return Boolean(parsed && parsed.ordinal >= earliest.ordinal && parsed.ordinal <= latest.ordinal);
}

function buildReleaseOrder(earliestRelease, latestRelease) {
  const earliest = parseMatlabRelease(earliestRelease);
  const latest = parseMatlabRelease(latestRelease);
  const releases = [];
  for (let year = earliest.year; year <= latest.year; year += 1) {
    for (const half of ['a', 'b']) {
      const release = `R${year}${half}`;
      const ordinal = year * 2 + (half === 'b' ? 1 : 0);
      if (ordinal >= earliest.ordinal && ordinal <= latest.ordinal) releases.push(release);
    }
  }
  return releases;
}

function uniqueStrings(values) {
  const candidates = Array.isArray(values) ? values : [values];
  return [...new Set(candidates.map((value) => String(value || '').trim()).filter(Boolean))];
}

function deepFreeze(value) {
  Object.values(value).filter((entry) => entry && typeof entry === 'object').forEach(deepFreeze);
  return Object.freeze(value);
}
