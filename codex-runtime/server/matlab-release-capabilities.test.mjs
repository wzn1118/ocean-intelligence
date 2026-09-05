import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MATLAB_CI_EVIDENCE_SCHEMA_VERSION,
  MATLAB_CI_EXIT_CODES,
  MATLAB_DATA_SEMANTIC_RULES,
  MATLAB_DATA_SEMANTIC_SCHEMA_VERSION,
  MATLAB_PRESENTATION_RULES,
  MATLAB_PRESENTATION_SCHEMA_VERSION,
  MATLAB_RELEASE_CAPABILITY_MATRIX,
  MATLAB_RELEASE_CAPABILITY_SCHEMA_VERSION,
  MATLAB_RELEASE_RANGE,
  MATLAB_RUNTIME_EXPORT_RULES,
  MATLAB_RUNTIME_EXPORT_SCHEMA_VERSION,
  compareMatlabReleases,
  buildMatlabRuntimeCiMatrix,
  classifyMatlabCiEvidence,
  matlabCapabilityInstructionBlock,
  matlabReleaseSupports,
  normalizeMatlabExportFormat,
  normalizeMatlabRelease,
  parseMatlabRelease,
  resolveMatlabDataSemantics,
  resolveMatlabPlotCapabilities,
  resolveMatlabPresentationCapabilities,
  resolveMatlabRuntimeExportCompatibility,
  resolveMatlabToolboxDependencies,
  resolveMatlabToolboxReadiness,
  selectMatlabApi,
  selectMatlabExportStrategy,
} from './matlab-release-capabilities.mjs';
import { generateMatlabPlotScript, routeMatlabPlot } from './matlab-plot-router.mjs';
import {
  buildMatlabPublicationContract,
  buildMatlabScientificDataContract,
  routeMatlabTask,
} from './matlab-task-routing-contract.mjs';

function completeDataContract(overrides = {}) {
  return {
    shape: [24],
    dimensionOrder: ['time'],
    observationDimension: 1,
    coordinates: ['time'],
    units: { value: 'degC', uncertainty: 'degC' },
    requiredUnitKeys: ['value'],
    timeClass: 'datetime',
    timeZone: 'UTC',
    timeValidation: { nonNaT: true, unique: true, strictlyIncreasing: true },
    missingStatus: 'present',
    zeroIsValid: true,
    masks: { separate: true },
    qualityControl: {
      present: true,
      aligned: true,
      preserveRawFlags: true,
      separateSuspectMask: true,
      method: 'flags',
      shape: [24],
    },
    uncertainty: {
      present: true,
      type: 'standard-deviation',
      unit: 'degC',
      aligned: true,
      finiteNonnegative: true,
      shape: [24],
    },
    ...overrides,
  };
}

function completePresentationContract(overrides = {}) {
  const base = {
    mode: 'publication',
    layout: {
      width: 18,
      height: 12,
      units: 'centimeters',
      baseFontSize: 9,
      multiPanel: true,
      spacingExplicit: true,
      clippingAudit: true,
      exactDimensions: true,
    },
    typography: {
      languages: ['en'],
      fontCandidates: ['Noto Sans'],
      fontProbe: true,
      glyphAudit: true,
      literalText: true,
      interpreter: 'none',
    },
    color: {
      paletteClass: 'sequential',
      paletteSource: 'oi_ocean_theme.SequentialMap',
      missingAppearance: 'explicit mask color distinct from valid extrema and zero',
    },
    accessibility: {
      altText: 'Ocean temperature observations with uncertainty.',
      contrastAudit: true,
      nonColorEncoding: true,
      grayscaleAudit: true,
      colorVisionAudit: true,
    },
    export: {
      formats: ['png', 'pdf'],
      background: 'white',
      freshOutput: true,
      contentType: 'vector',
      fontEmbeddingAudit: true,
      multipagePdf: false,
    },
    execution: { headless: false },
    interaction: { required: false },
  };
  return {
    ...base,
    ...overrides,
    layout: { ...base.layout, ...overrides.layout },
    typography: { ...base.typography, ...overrides.typography },
    color: { ...base.color, ...overrides.color },
    accessibility: { ...base.accessibility, ...overrides.accessibility },
    export: { ...base.export, ...overrides.export },
    execution: { ...base.execution, ...overrides.execution },
    interaction: { ...base.interaction, ...overrides.interaction },
  };
}

function completeManifestContract(overrides = {}) {
  const base = {
    schemaVersion: 2,
    relativePaths: true,
    freshNonemptyFiles: true,
    byteCountsVerified: true,
    sha256Verified: true,
    deterministicOrder: true,
    runtimeRecorded: true,
    releaseRecorded: true,
    toolboxEvidenceRecorded: true,
    toolboxEvidenceScope: 'installation-only',
    executionRecorded: true,
    artifactValidationPassed: true,
    pngDimensionsVerified: true,
    pdfTextVerified: true,
    pdfPagesVerified: true,
    visualInspection: { status: 'not_run', verified: false },
  };
  return {
    ...base,
    ...overrides,
    visualInspection: { ...base.visualInspection, ...overrides.visualInspection },
  };
}

function completeRuntimeContract(targetRelease = 'R2024b', overrides = {}) {
  const legacy = compareMatlabReleases(targetRelease, 'R2019a') < 0;
  const executable = `/opt/MATLAB/${targetRelease}/bin/matlab`;
  const base = {
    matlabAvailable: true,
    executable,
    executableIdentityVerified: true,
    detectedRelease: targetRelease,
    releaseEvidenceSource: compareMatlabReleases(targetRelease, 'R2020b') >= 0
      ? 'matlabRelease'
      : "version('-release')",
    headless: true,
    command: legacy
      ? `${executable} -r "try, run_task; catch error, disp(error); exit(1); end; exit(0)"`
      : `${executable} -batch "run_task"`,
    jvmAvailable: true,
    displayAvailable: false,
    desktopAvailable: false,
    nonInteractive: true,
    figureVisible: false,
    exportFormats: ['png', 'pdf'],
    toolboxEvidence: { matlab: { installed: true } },
    manifestRequired: true,
    externalManifestWriterVerified: compareMatlabReleases(targetRelease, 'R2019b') < 0,
    externalManifestWriter: 'verified-test-manifest-writer-v1',
    executionCompleted: true,
    exitCode: 0,
    logCaptured: true,
    workingDirectory: '/tmp/matlab-run',
    manifestContract: completeManifestContract(),
  };
  return {
    ...base,
    ...overrides,
    toolboxEvidence: { ...base.toolboxEvidence, ...overrides.toolboxEvidence },
    manifestContract: completeManifestContract(overrides.manifestContract),
  };
}

function taskRouterPublicationContract() {
  return buildMatlabPublicationContract({
    taskType: 'interactive',
    outputFormats: ['png', 'pdf'],
    publicationContract: {
      target: { medium: 'journal', width: 18, height: 12, units: 'cm', dpi: 300, formats: ['png', 'pdf'] },
      layout: {
        architecture: 'tiledlayout',
        rows: 1,
        columns: 2,
        tileSpacing: 'compact',
        padding: 'compact',
        readingOrder: 'row-major',
        explicitHandles: true,
        legendPlacement: 'south',
        colorbarPlacement: 'east',
      },
      typography: {
        fontFamily: 'Noto Sans',
        fallbackFamilies: ['Noto Sans CJK SC'],
        baseSizePt: 9,
        labelSizePt: 10,
        titleSizePt: 11,
        lineWidthPt: 1.2,
        interpreter: 'none',
      },
      color: {
        paletteClass: 'sequential',
        paletteSource: 'oi_ocean_theme.SequentialMap',
        background: 'white',
        missingAppearance: 'explicit mask color',
        minimumContrastRatio: 4.5,
        colorOnlyEncodingAllowed: false,
        colorVisionCheckRequired: true,
        grayscaleCheckRequired: true,
      },
      clipping: { drawnowBeforeAudit: true, boundsCheckRequired: true, overlapCheckRequired: true },
      localization: {
        encoding: 'UTF-8',
        languages: ['en', 'zh-CN'],
        chineseRequired: true,
        glyphCheckRequired: true,
        glyphFormats: ['png', 'pdf'],
      },
      accessibility: {
        descriptionRequired: true,
        redundantEncodingRequired: true,
        readingOrderCheckRequired: true,
      },
      interaction: {
        mode: 'dual',
        stableObservationIdsRequired: true,
        targetScopedCallbacksRequired: true,
        cleanupRequired: true,
        staticFallbackRequired: true,
      },
      headless: {
        supported: true,
        command: 'matlab -batch',
        figureVisible: 'off',
        exportApi: 'exportgraphics',
        desktopIndependent: true,
      },
    },
  });
}

test('parses, normalizes and compares MATLAB releases without promoting invalid input', () => {
  assert.deepEqual(parseMatlabRelease(' R2018B '), { release: 'R2018b', year: 2018, half: 'b', ordinal: 4037 });
  assert.equal(normalizeMatlabRelease('R2013a'), 'R2013a');
  assert.throws(() => normalizeMatlabRelease('future'), /Unsupported MATLAB release/u);
  assert.equal(normalizeMatlabRelease('future', 'R2020b'), 'R2020b');
  assert.ok(compareMatlabReleases('R2020a', 'R2019b') > 0);
  assert.ok(compareMatlabReleases('R2013a', 'R2013b') < 0);
  assert.throws(() => compareMatlabReleases('future', 'R2019b'), /Unsupported MATLAB release/u);
  assert.throws(() => normalizeMatlabRelease('future', null), /Unsupported MATLAB release/u);
});

test('matrix covers release range and requested MATLAB plotting APIs', () => {
  assert.equal(MATLAB_RELEASE_CAPABILITY_SCHEMA_VERSION, 6);
  assert.equal(MATLAB_DATA_SEMANTIC_SCHEMA_VERSION, 1);
  assert.equal(MATLAB_PRESENTATION_SCHEMA_VERSION, 1);
  assert.equal(MATLAB_RUNTIME_EXPORT_SCHEMA_VERSION, 3);
  assert.equal(MATLAB_RELEASE_CAPABILITY_MATRIX.releaseOrder[0], 'R2006a');
  assert.equal(MATLAB_RELEASE_CAPABILITY_MATRIX.releaseOrder.at(-1), 'R2026a');
  for (const name of [
    'table', 'datetime', 'uifigure', 'uiaxes', 'timetable', 'tiledlayout', 'nexttile',
    'dataTipTemplate', 'dataTipTextRow', 'colororder', 'matlabBatch', 'exportgraphics',
    'auditedFigureManifest', 'matlabRelease', 'exportapp', 'exportgraphicsAppend', 'clim', 'exportgraphicsAnimatedGif',
    'brushAxesUifigure', 'exportgraphicsSvg', 'exportgraphicsSizing', 'brushAxesTraditional',
  ]) {
    assert.ok(MATLAB_RELEASE_CAPABILITY_MATRIX.capabilities[name], name);
  }
  assert.equal(MATLAB_RELEASE_CAPABILITY_MATRIX.dataSemanticRules, MATLAB_DATA_SEMANTIC_RULES);
  assert.deepEqual(MATLAB_DATA_SEMANTIC_RULES.dimensions.forbiddenImplicitTransforms, ['transpose', 'squeeze', 'reshape', 'sort']);
  assert.equal(MATLAB_DATA_SEMANTIC_RULES.missing.forbidSilentFillOrInterpolation, true);
  assert.equal(MATLAB_DATA_SEMANTIC_RULES.coordinateDirection.forbidPressureRelabelledAsDepth, true);
  assert.equal(MATLAB_RELEASE_CAPABILITY_MATRIX.presentationRules, MATLAB_PRESENTATION_RULES);
  assert.equal(MATLAB_PRESENTATION_RULES.export.directSvgExportIntroduced, 'R2025a');
  assert.deepEqual(MATLAB_PRESENTATION_RULES.color.forbiddenPalettes, ['jet', 'rainbow', 'hsv']);
  assert.equal(MATLAB_PRESENTATION_RULES.interaction.uifigureAxesBrushIntroduced, 'R2023a');
  assert.equal(MATLAB_PRESENTATION_RULES.headless.forbidOctaveSubstitution, true);
  assert.equal(MATLAB_RELEASE_CAPABILITY_MATRIX.runtimeExportRules, MATLAB_RUNTIME_EXPORT_RULES);
  assert.equal(MATLAB_RUNTIME_EXPORT_RULES.manifest.schemaVersion, 2);
  assert.deepEqual(MATLAB_RUNTIME_EXPORT_RULES.manifest.nativeFormats, ['png', 'pdf', 'svg']);
  assert.deepEqual(MATLAB_RUNTIME_EXPORT_RULES.manifest.requiredNativeFormats, ['png', 'pdf']);
  assert.deepEqual(MATLAB_RUNTIME_EXPORT_RULES.manifest.optionalNativeFormats, ['svg']);
  assert.equal(MATLAB_RUNTIME_EXPORT_RULES.manifest.nativeToolboxEvidenceScope, 'installation-only');
  assert.equal(MATLAB_RUNTIME_EXPORT_RULES.manifest.requireNamedExternalWriter, true);
  assert.equal(MATLAB_RUNTIME_EXPORT_RULES.runtime.forbidOctaveSubstitution, true);
  assert.equal(MATLAB_RUNTIME_EXPORT_RULES.runtime.requireAbsoluteExecutablePath, true);
});

test('enforces API introduction thresholds and explicit legacy fallbacks', () => {
  assert.equal(matlabReleaseSupports('R2019a', 'tiledlayout'), false);
  assert.equal(matlabReleaseSupports('R2019b', 'tiledlayout'), true);
  assert.equal(matlabReleaseSupports('R2020a', 'exportapp'), false);
  assert.equal(matlabReleaseSupports('R2020b', 'exportapp'), true);
  assert.equal(matlabReleaseSupports('R2021b', 'clim'), false);
  assert.equal(matlabReleaseSupports('R2022a', 'clim'), true);
  assert.equal(matlabReleaseSupports('R2018b', 'matlabBatch'), false);
  assert.equal(matlabReleaseSupports('R2019a', 'matlabBatch'), true);
  assert.equal(matlabReleaseSupports('R2024b', 'exportgraphicsSvg'), false);
  assert.equal(matlabReleaseSupports('R2025a', 'exportgraphicsSvg'), true);

  const legacy = resolveMatlabPlotCapabilities({
    targetRelease: 'R2013a',
    requested: ['table', 'datetime', 'tiledlayout', 'exportgraphics', 'clim'],
  });
  assert.equal(legacy.capabilities.table.fallback, 'numeric arrays / struct');
  assert.equal(legacy.capabilities.datetime.fallback, 'datenum');
  assert.equal(legacy.capabilities.tiledlayout.fallback, 'subplot / explicit axes positions');
  assert.equal(legacy.capabilities.exportgraphics.fallback, 'print');
  assert.equal(legacy.capabilities.clim.fallback, 'caxis');
  assert.ok(Object.values(legacy.capabilities).every((entry) => entry.strategy === 'explicit-fallback'));
});

test('selectMatlabApi remains consumable by the plot router', () => {
  const native = selectMatlabApi('R2024b', 'tiledlayout');
  assert.equal(native.api, 'tiledlayout');
  assert.equal(native.status, 'native');
  assert.deepEqual(native.requiredProducts, ['matlab']);

  const fallback = selectMatlabApi('R2018b', 'tiledlayout');
  assert.equal(fallback.api, 'subplot / explicit axes positions');
  assert.equal(fallback.strategy, 'explicit-fallback');

  assert.deepEqual(selectMatlabApi('R2024b', 'unknown', { required: false }), {
    status: 'unsupported', strategy: 'fail', api: null, targetRelease: 'R2024b',
  });
  assert.throws(() => selectMatlabApi('R2024b', 'unknown'), /Unknown MATLAB plotting capability/u);
});

test('selects release-aware export strategies without changing requested format', () => {
  const modernSvg = selectMatlabExportStrategy('R2025a', '.SVG');
  assert.equal(modernSvg.api, 'exportgraphics');
  assert.equal(modernSvg.format, 'svg');
  assert.equal(modernSvg.status, 'preferred');

  const preR2025Svg = selectMatlabExportStrategy('R2024b', 'svg');
  assert.equal(preR2025Svg.api, 'print');
  assert.equal(preR2025Svg.strategy, 'explicit-fallback');

  const legacySvg = selectMatlabExportStrategy('R2018b', 'svg');
  assert.equal(legacySvg.api, 'print');
  assert.equal(legacySvg.strategy, 'explicit-fallback');
  assert.match(legacySvg.syntax, /-dsvg/u);

  const unsupportedSvg = selectMatlabExportStrategy('R2013b', 'svg');
  assert.equal(unsupportedSvg.status, 'unsupported');
  assert.equal(unsupportedSvg.strategy, 'fail');
  assert.equal(unsupportedSvg.api, null);
  assert.match(unsupportedSvg.reason, /No format substitution/u);

  assert.equal(selectMatlabExportStrategy('R2019b', 'pdf').api, 'print');
  assert.equal(selectMatlabExportStrategy('R2020a', 'pdf').api, 'exportgraphics');
  assert.match(selectMatlabExportStrategy('R2024b', 'pdf', { preferredApi: 'print' }).syntax, /rendererFlag/u);
  assert.doesNotMatch(selectMatlabExportStrategy('R2025a', 'pdf', { preferredApi: 'print' }).syntax, /rendererFlag/u);
  assert.doesNotMatch(selectMatlabExportStrategy('R2025a', 'eps', { preferredApi: 'print' }).syntax, /rendererFlag/u);
  assert.doesNotMatch(selectMatlabExportStrategy('R2006a', 'png').syntax, /"/u);
  assert.throws(() => selectMatlabExportStrategy('R2024b', 'webp'), /Unknown MATLAB export format/u);
});

test('normalizes common filename extensions before export routing', () => {
  assert.equal(normalizeMatlabExportFormat('.JPG'), 'jpeg');
  assert.equal(normalizeMatlabExportFormat('jpeg'), 'jpeg');
  assert.equal(normalizeMatlabExportFormat('.TIF'), 'tiff');
  assert.equal(normalizeMatlabExportFormat('tiff'), 'tiff');

  const plan = resolveMatlabPlotCapabilities({
    targetRelease: 'R2024b',
    exportFormats: ['.jpg', 'jpeg', '.tif', 'tiff'],
  });
  assert.deepEqual(Object.keys(plan.exportFormats), ['jpeg', 'tiff']);
  assert.equal(plan.exportFormats.jpeg.api, 'exportgraphics');
  assert.equal(plan.exportFormats.tiff.api, 'exportgraphics');
});

test('resolves base and optional product dependencies accurately', () => {
  const products = resolveMatlabToolboxDependencies(['matlab', 'statistics', 'signal', 'mapping', 'image']);
  assert.deepEqual(products.map((entry) => entry.id), ['matlab', 'statistics', 'signal', 'mapping', 'image']);
  assert.equal(products[0].licenseFeature, null);
  assert.equal(products.find((entry) => entry.id === 'statistics').licenseFeature, 'Statistics_Toolbox');
  assert.match(products.find((entry) => entry.id === 'mapping').requiredFor.join(' '), /projections/u);
  assert.doesNotMatch(products.find((entry) => entry.id === 'mapping').requiredFor.join(' '), /uiaxes|geoaxes/u);
  assert.throws(() => resolveMatlabToolboxDependencies(['unknown']), /Unknown MATLAB toolbox dependency/u);
});

test('returns capabilities, formats and products in one generator-facing plan', () => {
  const result = resolveMatlabPlotCapabilities({
    targetRelease: 'R2019b',
    requested: ['tiledlayout', 'exportgraphics', 'dataTipTemplate'],
    exportFormats: ['png', 'pdf', 'svg'],
    toolboxes: ['signal'],
  });
  assert.equal(result.runtime, 'matlab');
  assert.equal(result.capabilities.tiledlayout.status, 'native');
  assert.equal(result.capabilities.exportgraphics.status, 'fallback');
  assert.equal(result.exportFormats.png.api, 'print');
  assert.equal(result.exportFormats.svg.api, 'print');
  assert.deepEqual(result.toolboxDependencies.map((entry) => entry.id), ['matlab', 'signal']);
  assert.match(result.policy, /No silent Octave substitution/u);
  assert.equal(result.semanticContract, null);
  assert.equal(result.presentationContract, null);
});

test('returns a generator-facing publication plan with explicit SVG and sizing strategies', () => {
  const presentationContract = completePresentationContract({
    typography: {
      languages: ['en', 'zh-CN'],
      fontCandidates: ['Noto Sans CJK SC', 'Microsoft YaHei'],
      missingFontPolicy: 'fail',
    },
    export: {
      formats: ['png', 'pdf', 'svg'],
      svgAccessibilityAudit: true,
    },
  });
  const result = resolveMatlabPlotCapabilities({
    targetRelease: 'R2025a',
    requested: ['tiledlayout', 'exportgraphicsSvg', 'exportgraphicsSizing'],
    exportFormats: ['png', 'pdf', 'svg'],
    presentationContract,
  });
  assert.equal(result.presentationContract.status, 'ready');
  assert.equal(result.presentationContract.layout.sizing.status, 'native');
  assert.equal(result.presentationContract.exports.plans.svg.api, 'exportgraphics');
  assert.equal(result.presentationContract.typography.hasCjk, true);
  assert.deepEqual(result.presentationContract.requiredProducts.map((entry) => entry.id), ['matlab']);

  const block = matlabCapabilityInstructionBlock({
    targetRelease: 'R2025a',
    requested: ['exportgraphicsSvg'],
    presentationContract,
  });
  assert.match(block, /出版与交互契约：ready/u);
  assert.match(block, /精确尺寸：native/u);
});

test('resolves publication sizing across every known MATLAB release', () => {
  for (const release of MATLAB_RELEASE_CAPABILITY_MATRIX.releaseOrder) {
    const result = resolveMatlabPresentationCapabilities({
      targetRelease: release,
      presentationContract: completePresentationContract(),
    });
    assert.equal(result.status, 'ready', release);
    assert.equal(
      result.layout.sizing.status,
      compareMatlabReleases(release, 'R2025a') >= 0 ? 'native' : 'fallback',
      release,
    );
    assert.deepEqual(Object.keys(result.exports.plans), ['png', 'pdf'], release);
    assert.equal(result.interaction.dataTips, null, release);
  }
});

test('accepts the task router publication contract shape without false conflicts', () => {
  const normalized = taskRouterPublicationContract();
  assert.deepEqual(normalized.unresolvedRequirements, []);
  const result = resolveMatlabPresentationCapabilities({
    targetRelease: 'R2024b',
    presentationContract: normalized,
  });
  assert.equal(result.status, 'needs-input');
  assert.equal(result.errors.length, 0);
  assert.equal(result.mode, 'interactive');
  assert.equal(result.layout.units, 'centimeters');
  assert.equal(result.layout.multiPanel, true);
  assert.equal(result.typography.hasCjk, true);
  assert.equal(result.interaction.headlessSupported, true);
  assert.equal(result.interaction.batch.api, 'matlab -batch');
  for (const code of [
    'FONT_PROBE_REQUIRED',
    'CJK_MISSING_FONT_POLICY_REQUIRED',
    'ALT_TEXT_REQUIRED',
    'FRESH_OUTPUT_REQUIRED',
    'PDF_CONTENT_TYPE_REQUIRED',
    'FONT_EMBEDDING_AUDIT_REQUIRED',
  ]) {
    assert.ok(result.missingInputs.some((entry) => entry.code === code), code);
  }

  const legacy = resolveMatlabPresentationCapabilities({
    targetRelease: 'R2018b',
    presentationContract: normalized,
  });
  assert.equal(legacy.status, 'invalid');
  assert.ok(legacy.errors.some((entry) => entry.code === 'HEADLESS_COMMAND_RELEASE_CONFLICT'));
});

test('gates batch, multipage PDF, SVG, and exact export geometry independently', () => {
  assert.equal(selectMatlabApi('R2018b', 'matlabBatch').strategy, 'explicit-fallback');
  assert.equal(selectMatlabApi('R2019a', 'matlabBatch').api, 'matlab -batch');
  assert.equal(selectMatlabApi('R2021a', 'exportgraphicsAppend').strategy, 'explicit-fallback');
  assert.match(selectMatlabApi('R2021b', 'exportgraphicsAppend').api, /Append/u);
  assert.equal(selectMatlabApi('R2024b', 'exportgraphicsSizing').strategy, 'explicit-fallback');
  assert.match(selectMatlabApi('R2025a', 'exportgraphicsSizing').api, /Padding/u);

  const legacyMultipage = resolveMatlabPresentationCapabilities({
    targetRelease: 'R2021a',
    presentationContract: completePresentationContract({ export: { multipagePdf: true } }),
  });
  assert.equal(legacyMultipage.status, 'ready');
  assert.equal(legacyMultipage.exports.multipage.strategy, 'explicit-fallback');
  assert.ok(legacyMultipage.warnings.some((entry) => entry.code === 'MULTIPAGE_PDF_FALLBACK'));

  const nativeMultipage = resolveMatlabPresentationCapabilities({
    targetRelease: 'R2021b',
    presentationContract: completePresentationContract({ export: { multipagePdf: true } }),
  });
  assert.equal(nativeMultipage.status, 'ready');
  assert.equal(nativeMultipage.exports.multipage.status, 'native');
});

test('requires CJK font probing, per-format glyph checks, and non-color accessibility', () => {
  const cjk = resolveMatlabPresentationCapabilities({
    targetRelease: 'R2025a',
    presentationContract: completePresentationContract({
      typography: {
        languages: ['en', 'zh-CN'],
        fontCandidates: ['Noto Sans CJK SC'],
        missingFontPolicy: 'fail',
      },
    }),
  });
  assert.equal(cjk.status, 'ready');
  assert.equal(cjk.typography.glyphAudit, 'per-export-format');

  const missingPolicy = resolveMatlabPresentationCapabilities({
    targetRelease: 'R2025a',
    presentationContract: completePresentationContract({ typography: { languages: ['zh-CN'] } }),
  });
  assert.equal(missingPolicy.status, 'needs-input');
  assert.ok(missingPolicy.missingInputs.some((entry) => entry.code === 'CJK_MISSING_FONT_POLICY_REQUIRED'));

  const hardCodedFont = resolveMatlabPresentationCapabilities({
    targetRelease: 'R2025a',
    presentationContract: completePresentationContract({ typography: { fontProbe: false } }),
  });
  assert.equal(hardCodedFont.status, 'invalid');
  assert.ok(hardCodedFont.errors.some((entry) => entry.code === 'FONT_PROBE_REQUIRED'));

  const colorOnly = resolveMatlabPresentationCapabilities({
    targetRelease: 'R2025a',
    presentationContract: completePresentationContract({ accessibility: { nonColorEncoding: false } }),
  });
  assert.equal(colorOnly.status, 'invalid');
  assert.ok(colorOnly.errors.some((entry) => entry.code === 'NON_COLOR_ENCODING_REQUIRED'));

  const rainbow = resolveMatlabPresentationCapabilities({
    targetRelease: 'R2025a',
    presentationContract: completePresentationContract({ color: { paletteSource: 'jet' } }),
  });
  assert.equal(rainbow.status, 'invalid');
  assert.ok(rainbow.errors.some((entry) => entry.code === 'RAINBOW_PALETTE_FORBIDDEN'));

  const unauditedSvg = resolveMatlabPresentationCapabilities({
    targetRelease: 'R2025a',
    presentationContract: completePresentationContract({ export: { formats: ['svg'] } }),
  });
  assert.equal(unauditedSvg.status, 'needs-input');
  assert.ok(unauditedSvg.missingInputs.some((entry) => entry.code === 'SVG_ACCESSIBILITY_AUDIT_REQUIRED'));
});

test('selects release-aware desktop interactions and disables them in headless fallback', () => {
  const uiInteraction = completePresentationContract({
    mode: 'interactive',
    interaction: {
      required: true,
      target: 'uiaxes',
      stableIdentifiers: true,
      staticEquivalent: true,
      staticFallback: true,
      dataTips: true,
      brushing: true,
    },
  });
  const preAxesBrush = resolveMatlabPresentationCapabilities({
    targetRelease: 'R2022b',
    presentationContract: uiInteraction,
  });
  assert.equal(preAxesBrush.status, 'ready');
  assert.equal(preAxesBrush.interaction.brushing.api, "brush(figureHandle,'on')");
  assert.equal(preAxesBrush.interaction.dataTips.api, 'dataTipTemplate');

  const nativeUiAxesBrush = resolveMatlabPresentationCapabilities({
    targetRelease: 'R2023a',
    presentationContract: uiInteraction,
  });
  assert.equal(nativeUiAxesBrush.interaction.brushing.api, "brush(uiAxesHandle,'on')");

  const traditional = completePresentationContract({
    mode: 'interactive',
    interaction: { ...uiInteraction.interaction, target: 'axes' },
  });
  assert.equal(
    resolveMatlabPresentationCapabilities({ targetRelease: 'R2024b', presentationContract: traditional }).interaction.brushing.api,
    "brush(figureHandle,'on')",
  );
  assert.equal(
    resolveMatlabPresentationCapabilities({ targetRelease: 'R2025a', presentationContract: traditional }).interaction.brushing.api,
    "brush(axesHandle,'on')",
  );

  const headless = resolveMatlabPresentationCapabilities({
    targetRelease: 'R2024b',
    presentationContract: completePresentationContract({
      mode: 'interactive',
      execution: { headless: true, nonInteractive: true, figureVisible: 'off' },
      interaction: uiInteraction.interaction,
    }),
  });
  assert.equal(headless.status, 'ready');
  assert.equal(headless.interaction.strategy, 'static-equivalent-with-interactions-disabled');
  assert.equal(headless.interaction.dataTips, null);
  assert.equal(headless.interaction.brushing, null);
  assert.equal(headless.interaction.batch.api, 'matlab -batch');
  assert.ok(headless.warnings.some((entry) => entry.code === 'INTERACTION_DISABLED_FOR_HEADLESS'));

  const noStaticFallback = resolveMatlabPresentationCapabilities({
    targetRelease: 'R2024b',
    presentationContract: completePresentationContract({
      mode: 'interactive',
      execution: { headless: true, nonInteractive: true, figureVisible: 'off' },
      interaction: { ...uiInteraction.interaction, staticFallback: false },
    }),
  });
  assert.equal(noStaticFallback.status, 'unsupported');
  assert.ok(noStaticFallback.errors.some((entry) => entry.code === 'HEADLESS_INTERACTION_UNSUPPORTED'));
});

test('fails explicit full-app export when exportapp or headless UI verification is unavailable', () => {
  const appContract = completePresentationContract({
    mode: 'app',
    interaction: {
      required: true,
      target: 'uiaxes',
      stableIdentifiers: true,
      staticEquivalent: true,
      staticFallback: true,
      fullAppExport: true,
    },
  });
  const oldRelease = resolveMatlabPresentationCapabilities({
    targetRelease: 'R2020a',
    presentationContract: appContract,
  });
  assert.equal(oldRelease.status, 'unsupported');
  assert.ok(oldRelease.errors.some((entry) => entry.code === 'FULL_APP_EXPORT_UNSUPPORTED'));

  const desktop = resolveMatlabPresentationCapabilities({
    targetRelease: 'R2020b',
    presentationContract: appContract,
  });
  assert.equal(desktop.status, 'ready');
  assert.equal(desktop.interaction.appExport.api, 'exportapp');

  const unverifiedHeadless = resolveMatlabPresentationCapabilities({
    targetRelease: 'R2024b',
    presentationContract: completePresentationContract({
      ...appContract,
      execution: { headless: true, nonInteractive: true, figureVisible: 'off' },
    }),
  });
  assert.equal(unverifiedHeadless.status, 'unsupported');
  assert.ok(unverifiedHeadless.errors.some((entry) => entry.code === 'HEADLESS_APP_EXPORT_UNSUPPORTED'));
});

test('resolves a complete scientific data contract with release-aware time behavior', () => {
  const modern = resolveMatlabDataSemantics({
    targetRelease: 'R2024b',
    dataContract: completeDataContract(),
  });
  assert.equal(modern.status, 'ready');
  assert.equal(modern.time.status, 'native');
  assert.equal(modern.time.api, 'datetime');
  assert.equal(modern.missing.strategy, 'preserve-gaps-no-silent-fill');
  assert.equal(modern.qualityControl.strategy, 'preserve-flags-and-separate-suspect-mask');
  assert.equal(modern.uncertainty.type, 'standard-deviation');

  const legacy = resolveMatlabPlotCapabilities({
    targetRelease: 'R2013b',
    requested: ['datetime'],
    dataContract: completeDataContract(),
  });
  assert.equal(legacy.semanticContract.status, 'ready');
  assert.equal(legacy.semanticContract.time.status, 'fallback');
  assert.equal(legacy.semanticContract.time.api, 'datenum');
  assert.ok(legacy.semanticContract.warnings.some((entry) => entry.code === 'DATETIME_RELEASE_FALLBACK'));

  const block = matlabCapabilityInstructionBlock({
    targetRelease: 'R2013b',
    requested: ['datetime'],
    dataContract: completeDataContract(),
  });
  assert.match(block, /数据语义契约：ready/u);
  assert.match(block, /时间表示：datenum \(explicit-fallback\)/u);
});

test('selects timetable fallbacks consistently across every known release', () => {
  for (const release of MATLAB_RELEASE_CAPABILITY_MATRIX.releaseOrder) {
    const result = resolveMatlabDataSemantics({
      targetRelease: release,
      dataContract: completeDataContract({ timeClass: 'timetable' }),
    });
    assert.equal(result.status, 'ready', release);
    if (compareMatlabReleases(release, 'R2016b') >= 0) {
      assert.equal(result.time.api, 'timetable', release);
      assert.equal(result.time.strategy, 'native', release);
    } else if (compareMatlabReleases(release, 'R2014b') >= 0) {
      assert.equal(result.time.api, 'table + datetime column', release);
      assert.equal(result.time.strategy, 'explicit-fallback', release);
    } else if (compareMatlabReleases(release, 'R2013b') >= 0) {
      assert.equal(result.time.api, 'table + datenum column', release);
      assert.equal(result.time.strategy, 'explicit-fallback', release);
    } else {
      assert.equal(result.time.api, 'numeric arrays / struct + datenum', release);
      assert.equal(result.time.strategy, 'explicit-fallback', release);
    }
  }
});

test('accepts the task router scientific contract shape without false dimension conflicts', () => {
  const normalized = buildMatlabScientificDataContract({
    requireScientificContract: true,
    dataContract: {
      dataType: 'datetime',
      shape: [24],
      dimensionOrder: ['time'],
      observationDimension: 'time',
      coordinates: ['time'],
      quantities: { value: 'Sea water temperature' },
      units: { value: 'degC' },
      timeZone: 'UTC',
      timeDirection: 'increasing',
      missing: { status: 'absent' },
      qc: { status: 'absent' },
      uncertainty: { status: 'absent' },
    },
  });
  const result = resolveMatlabPlotCapabilities({
    targetRelease: 'R2024b',
    dataContract: normalized,
  }).semanticContract;
  assert.equal(result.status, 'needs-input');
  assert.equal(result.errors.length, 0);
  assert.equal(result.dimensions.observationDimension, 'time');
  assert.ok(result.missingInputs.some((entry) => entry.code === 'TIME_NON_NAT_REQUIRED'));
  assert.ok(result.missingInputs.some((entry) => entry.code === 'TIME_UNIQUE_REQUIRED'));
  assert.ok(result.missingInputs.some((entry) => entry.code === 'ZERO_VALIDITY_REQUIRED'));
  assert.ok(!result.missingInputs.some((entry) => entry.code === 'OBSERVATION_DIMENSION_REQUIRED'));
});

test('rejects dimension and unit contradictions instead of reshaping or inferring conversion', () => {
  const dimensions = resolveMatlabDataSemantics({
    targetRelease: 'R2024b',
    dataContract: completeDataContract({
      shape: [24, 2],
      dimensionOrder: ['time'],
      pairedShapes: [{ left: [24, 2], right: [24, 3] }],
    }),
  });
  assert.equal(dimensions.status, 'invalid');
  assert.ok(dimensions.errors.some((entry) => entry.code === 'DIMENSION_ORDER_MISMATCH'));
  assert.ok(dimensions.errors.some((entry) => entry.code === 'PAIRED_SHAPE_MISMATCH'));

  const units = resolveMatlabDataSemantics({
    targetRelease: 'R2024b',
    dataContract: completeDataContract({
      units: { value: 'degC', reference: 'K', uncertainty: 'degC' },
      compatibleUnitPairs: [{ left: 'value', right: 'reference' }],
    }),
  });
  assert.equal(units.status, 'invalid');
  assert.ok(units.errors.some((entry) => entry.code === 'UNIT_CONVERSION_REQUIRED'));
});

test('requires valid timezone and explicit missing-value semantics', () => {
  const badTimeZone = resolveMatlabDataSemantics({
    targetRelease: 'R2024b',
    dataContract: completeDataContract({ timeZone: 'Mars/Olympus_Mons' }),
  });
  assert.equal(badTimeZone.status, 'invalid');
  assert.ok(badTimeZone.errors.some((entry) => entry.code === 'TIMEZONE_INVALID'));

  const missingMasks = resolveMatlabDataSemantics({
    targetRelease: 'R2024b',
    dataContract: completeDataContract({ masks: { separate: false } }),
  });
  assert.equal(missingMasks.status, 'needs-input');
  assert.ok(missingMasks.missingInputs.some((entry) => entry.code === 'SEPARATE_MASKS_REQUIRED'));

  const undeclaredSentinel = resolveMatlabDataSemantics({
    targetRelease: 'R2024b',
    dataContract: completeDataContract({ missingSentinel: -9999 }),
  });
  assert.equal(undeclaredSentinel.status, 'invalid');
  assert.ok(undeclaredSentinel.errors.some((entry) => entry.code === 'MISSING_SENTINEL_UNDECLARED'));
});

test('makes QC toolbox requirements and uncertainty validity explicit', () => {
  const undeclaredStatistics = resolveMatlabDataSemantics({
    targetRelease: 'R2024b',
    dataContract: completeDataContract({
      qualityControl: {
        present: true,
        aligned: true,
        preserveRawFlags: true,
        separateSuspectMask: true,
        method: 'isoutlier',
        shape: [24],
      },
    }),
  });
  assert.equal(undeclaredStatistics.status, 'needs-input');
  assert.deepEqual(undeclaredStatistics.requiredProducts.map((entry) => entry.id), ['matlab', 'statistics']);
  assert.ok(undeclaredStatistics.missingInputs.some((entry) => entry.code === 'TOOLBOX_DECLARATION_REQUIRED'));

  const declaredStatistics = resolveMatlabDataSemantics({
    targetRelease: 'R2024b',
    dataContract: completeDataContract({
      toolboxes: ['statistics'],
      qualityControl: {
        present: true,
        aligned: true,
        preserveRawFlags: true,
        separateSuspectMask: true,
        method: 'isoutlier',
        shape: [24],
      },
    }),
  });
  assert.equal(declaredStatistics.status, 'ready');

  const invalidUncertainty = resolveMatlabDataSemantics({
    targetRelease: 'R2024b',
    dataContract: completeDataContract({
      uncertainty: {
        present: true,
        type: 'standard-deviation',
        unit: 'K',
        aligned: true,
        finiteNonnegative: false,
        shape: [24],
      },
    }),
  });
  assert.equal(invalidUncertainty.status, 'invalid');
  assert.ok(invalidUncertainty.errors.some((entry) => entry.code === 'UNCERTAINTY_UNIT_MISMATCH'));
  assert.ok(invalidUncertainty.errors.some((entry) => entry.code === 'UNCERTAINTY_MAGNITUDE_REQUIRED'));
});

test('preserves vertical coordinate meaning and rejects silent direction changes', () => {
  const verticalBase = completeDataContract({
    coordinates: ['time', 'depth'],
    units: { value: 'degC', uncertainty: 'degC', depth: 'm' },
    verticalCoordinate: 'depth',
    verticalPositive: 'down',
    verticalReference: 'mean sea level',
  });
  const depth = resolveMatlabDataSemantics({ targetRelease: 'R2024b', dataContract: verticalBase });
  assert.equal(depth.status, 'ready');
  assert.equal(depth.coordinateDirection.strategy, 'preserve-declared-direction');

  const conflict = resolveMatlabDataSemantics({
    targetRelease: 'R2024b',
    dataContract: { ...verticalBase, verticalPositive: 'up' },
  });
  assert.equal(conflict.status, 'invalid');
  assert.ok(conflict.errors.some((entry) => entry.code === 'VERTICAL_DIRECTION_CONFLICT'));

  const transformed = resolveMatlabDataSemantics({
    targetRelease: 'R2024b',
    dataContract: { ...verticalBase, verticalPositive: 'up', explicitVerticalTransformation: true },
  });
  assert.equal(transformed.status, 'ready');
  assert.equal(transformed.coordinateDirection.strategy, 'explicit-direction-transform');

  const pressure = resolveMatlabDataSemantics({
    targetRelease: 'R2024b',
    dataContract: {
      ...verticalBase,
      coordinates: ['time', 'pressure'],
      units: { value: 'degC', uncertainty: 'degC', pressure: 'dbar' },
      verticalCoordinate: 'pressure',
      labelAsDepth: true,
    },
  });
  assert.equal(pressure.status, 'invalid');
  assert.ok(pressure.errors.some((entry) => entry.code === 'PRESSURE_RELABELLED_AS_DEPTH'));
});

test('accepts scalar capability, format and toolbox inputs from direct consumers', () => {
  const result = resolveMatlabPlotCapabilities({
    targetRelease: 'R2024b',
    requested: 'tiledlayout',
    exportFormats: '.jpg',
    toolboxes: 'signal',
  });
  assert.deepEqual(Object.keys(result.capabilities), ['tiledlayout']);
  assert.deepEqual(Object.keys(result.exportFormats), ['jpeg']);
  assert.deepEqual(result.toolboxDependencies.map((entry) => entry.id), ['matlab', 'signal']);
});

test('rejects Octave resolution and renders explicit compatibility instructions', () => {
  assert.throws(() => resolveMatlabPlotCapabilities({ runtime: 'octave' }), /Octave is never an implicit fallback/u);
  assert.throws(() => resolveMatlabDataSemantics({ runtime: 'octave' }), /Octave is never an implicit fallback/u);
  assert.throws(() => resolveMatlabPresentationCapabilities({ runtime: 'octave' }), /Octave is never an implicit fallback/u);
  assert.throws(() => selectMatlabApi('R2024b', 'table', { runtime: 'octave' }), /Octave is never an implicit fallback/u);

  const block = matlabCapabilityInstructionBlock({
    targetRelease: 'R2018b',
    requested: ['tiledlayout', 'exportgraphics'],
    exportFormats: ['svg', 'pdf'],
    toolboxes: ['statistics'],
  });
  assert.match(block, /目标：R2018b/u);
  assert.match(block, /tiledlayout: 明确降级/u);
  assert.match(block, /svg 导出：print/u);
  assert.match(block, /不能误报为 Mapping Toolbox/u);
  assert.match(block, /不得静默删功能、换格式/u);
  assert.match(block, /禁止以 Octave 执行/u);
});

test('all known releases produce monotonic capability and export plans', () => {
  const capabilityNames = Object.keys(MATLAB_RELEASE_CAPABILITY_MATRIX.capabilities);
  for (const release of MATLAB_RELEASE_CAPABILITY_MATRIX.releaseOrder) {
    const plan = resolveMatlabPlotCapabilities({
      targetRelease: release,
      requested: capabilityNames,
      exportFormats: ['png', 'pdf'],
    });
    assert.equal(plan.targetRelease, release);
    assert.equal(plan.runtime, 'matlab');
    assert.ok(Object.values(plan.capabilities).every((entry) => ['native', 'fallback'].includes(entry.status)));
    assert.ok(Object.values(plan.exportFormats).every((entry) => entry.api === 'print' || entry.api === 'exportgraphics'));
    for (const name of capabilityNames) {
      const definition = MATLAB_RELEASE_CAPABILITY_MATRIX.capabilities[name];
      const expected = compareMatlabReleases(release, definition.introduced) >= 0 ? 'native' : 'fallback';
      assert.equal(plan.capabilities[name].status, expected, `${release} ${name}`);
    }
  }
});

test('task router and plot router consume every release without contract drift', () => {
  for (const release of MATLAB_RELEASE_CAPABILITY_MATRIX.releaseOrder) {
    const task = routeMatlabTask({
      runtime: 'matlab',
      targetRelease: release,
      matlabAvailable: true,
      outputFormats: ['jpg', 'tif', 'pdf'],
      requestedCapabilities: ['tiledlayout', 'exportgraphics', 'clim'],
    });
    assert.equal(task.status, 'ready', release);
    assert.deepEqual(Object.keys(task.capabilities.exportFormats), ['jpeg', 'tiff', 'pdf']);

    const route = routeMatlabPlot({
      question: 'trend',
      coordinates: ['time'],
      dimensions: [12],
      targetRelease: release,
    });
    assert.equal(route.targetRelease, release);
    assert.equal(route.apiPlan.layout.status, matlabReleaseSupports(release, 'tiledlayout') ? 'native' : 'fallback');
    assert.equal(route.apiPlan.export.status, matlabReleaseSupports(release, 'exportgraphics') ? 'native' : 'fallback');
    assert.equal(route.apiPlan.colorLimits.status, matlabReleaseSupports(release, 'clim') ? 'native' : 'fallback');
  }
});

test('routers reject invalid and future releases instead of generating latest-release code', () => {
  for (const release of ['R2005b', 'R2026b', 'R2099a', 'latest', '2024b']) {
    assert.throws(
      () => routeMatlabPlot({ question: 'trend', coordinates: ['time'], dimensions: [12], targetRelease: release }),
      /Unsupported MATLAB release/u,
      release,
    );
    const task = routeMatlabTask({ runtime: 'matlab', targetRelease: release });
    assert.equal(task.status, 'unsupported-release', release);
    assert.equal(task.error.code, 'MATLAB_UNSUPPORTED_RELEASE');
  }
});

test('datetime fallback remains explicit while audited generation uses a supported release', () => {
  const base = {
    question: 'trend',
    coordinates: ['time'],
    dimensions: [12],
    units: { value: 'degC' },
    quantities: { value: 'Sea water temperature' },
    timeZone: 'UTC',
    missing: false,
    qcStatus: 'absent',
    dataType: 'datetime',
    assetDirectory: '/opt/ocean-intelligence/codex-runtime/matlab/assets',
    title: 'Temperature time series',
    source: 'verified test fixture',
  };
  const legacy = selectMatlabApi('R2014a', 'datetime');
  const native = generateMatlabPlotScript({ ...base, targetRelease: 'R2020a' });
  assert.equal(legacy.status, 'fallback');
  assert.equal(legacy.api, 'datenum');
  assert.match(native, /graphicsHandle = plot\(axesHandle, time/u);
  assert.doesNotMatch(native, /datenum\(time\)/u);
});

test('gates the repository audited manifest helper independently from raw export APIs', () => {
  const legacy = selectMatlabApi('R2019a', 'auditedFigureManifest');
  assert.equal(legacy.introduced, 'R2019b');
  assert.equal(legacy.status, 'fallback');
  assert.match(legacy.api, /external manifest writer/u);

  const native = selectMatlabApi('R2019b', 'auditedFigureManifest');
  assert.equal(native.status, 'native');
  assert.equal(native.api, 'oi_export_figure + oi_write_manifest');
});

test('keeps toolbox installation, license, function and invocation evidence separate', () => {
  const notInstalled = resolveMatlabToolboxReadiness({
    requested: ['statistics'],
    evidence: { matlab: { installed: true }, statistics: { installed: false } },
  });
  assert.equal(notInstalled.status, 'unavailable');
  assert.ok(notInstalled.errors.some((entry) => entry.code === 'TOOLBOX_NOT_INSTALLED'));

  const licenseNotTested = resolveMatlabToolboxReadiness({
    requested: ['statistics'],
    evidence: { matlab: { installed: true }, statistics: { installed: true, licenseTested: false } },
  });
  assert.equal(licenseNotTested.status, 'needs-input');
  assert.ok(licenseNotTested.missingInputs.some((entry) => entry.code === 'TOOLBOX_LICENSE_TEST_REQUIRED'));

  const noLicense = resolveMatlabToolboxReadiness({
    requested: ['statistics'],
    evidence: {
      matlab: { installed: true },
      statistics: { installed: true, licenseTested: true, licenseAvailable: false },
    },
  });
  assert.equal(noLicense.status, 'unavailable');
  assert.ok(noLicense.errors.some((entry) => entry.code === 'TOOLBOX_LICENSE_UNAVAILABLE'));

  const unresolvedFunction = resolveMatlabToolboxReadiness({
    requested: ['statistics'],
    requiredFunctions: { statistics: ['isoutlier'] },
    evidence: {
      matlab: { installed: true },
      statistics: {
        installed: true,
        licenseTested: true,
        licenseAvailable: true,
        functions: { isoutlier: false },
      },
    },
  });
  assert.equal(unresolvedFunction.status, 'unavailable');
  assert.ok(unresolvedFunction.errors.some((entry) => entry.code === 'TOOLBOX_FUNCTION_UNAVAILABLE'));

  const verified = resolveMatlabToolboxReadiness({
    requested: ['statistics'],
    requiredFunctions: { statistics: ['isoutlier'] },
    requireInvocation: true,
    evidence: {
      matlab: { installed: true, invocationVerified: true },
      statistics: {
        installed: true,
        licenseTested: true,
        licenseAvailable: true,
        functions: { isoutlier: true },
        invocationVerified: true,
      },
    },
  });
  assert.equal(verified.status, 'verified');
  assert.throws(
    () => resolveMatlabToolboxReadiness({ runtime: 'octave' }),
    /Octave is never an implicit fallback/u,
  );
});

test('resolves old and current MATLAB runtime/export plans across every audited release', () => {
  for (const release of MATLAB_RELEASE_CAPABILITY_MATRIX.releaseOrder) {
    const result = resolveMatlabRuntimeExportCompatibility({
      targetRelease: release,
      ...completeRuntimeContract(release),
    });
    assert.equal(result.status, 'verified', release);
    assert.equal(result.runtime, 'matlab', release);
    assert.equal(result.runtimeEvidence.detectedRelease, release, release);
    assert.equal(result.runtimeEvidence.exactReleaseMatch, true, release);
    assert.equal(
      result.environment.commandPlan.status,
      compareMatlabReleases(release, 'R2019a') >= 0 ? 'native' : 'fallback',
      release,
    );
    assert.equal(
      result.exports.png.api,
      compareMatlabReleases(release, 'R2020a') >= 0 ? 'exportgraphics' : 'print',
      release,
    );
    assert.equal(
      result.manifest.status,
      compareMatlabReleases(release, 'R2019b') >= 0 ? 'native' : 'explicit-fallback',
      release,
    );
  }
});

test('rejects runtime identity, release and headless command contradictions', () => {
  const unavailable = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2024b',
    ...completeRuntimeContract('R2024b', { matlabAvailable: false }),
  });
  assert.equal(unavailable.status, 'unavailable');
  assert.ok(unavailable.errors.some((entry) => entry.code === 'MATLAB_UNAVAILABLE'));

  const legacyBatch = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2018b',
    ...completeRuntimeContract('R2018b', { command: 'matlab -batch "run_task"' }),
  });
  assert.equal(legacyBatch.status, 'invalid');
  assert.ok(legacyBatch.errors.some((entry) => entry.code === 'MATLAB_COMMAND_RELEASE_CONFLICT'));

  const modernLegacyCommand = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2024b',
    ...completeRuntimeContract('R2024b', {
      command: 'matlab -r "try, run_task; catch error, disp(error); exit(1); end; exit(0)"',
    }),
  });
  assert.equal(modernLegacyCommand.status, 'invalid');

  const olderRuntime = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2024b',
    ...completeRuntimeContract('R2024b', { detectedRelease: 'R2023b' }),
  });
  assert.equal(olderRuntime.status, 'unsupported');
  assert.ok(olderRuntime.errors.some((entry) => entry.code === 'MATLAB_DETECTED_RELEASE_TOO_OLD'));

  const newerRuntime = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2024b',
    ...completeRuntimeContract('R2024b', { detectedRelease: 'R2025a' }),
  });
  assert.equal(newerRuntime.status, 'ready');
  assert.ok(newerRuntime.warnings.some((entry) => entry.code === 'MATLAB_RELEASE_NOT_EXACT'));

  for (const detectedRelease of ['future', 'R2026b']) {
    const invalidDetectedRelease = resolveMatlabRuntimeExportCompatibility({
      targetRelease: 'R2024b',
      ...completeRuntimeContract('R2024b', { detectedRelease }),
    });
    assert.equal(invalidDetectedRelease.status, 'invalid', detectedRelease);
    assert.ok(invalidDetectedRelease.errors.some((entry) => (
      entry.code === 'MATLAB_DETECTED_RELEASE_INVALID'
      || entry.code === 'MATLAB_DETECTED_RELEASE_UNSUPPORTED'
    )), detectedRelease);
  }

  const visibleHeadlessFigure = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2024b',
    ...completeRuntimeContract('R2024b', { figureVisible: true }),
  });
  assert.equal(visibleHeadlessFigure.status, 'invalid');
  assert.ok(visibleHeadlessFigure.errors.some((entry) => entry.code === 'MATLAB_HEADLESS_VISIBLE_FIGURE'));

  assert.throws(
    () => resolveMatlabRuntimeExportCompatibility({ runtime: 'octave' }),
    /Octave is never an implicit fallback/u,
  );
  assert.throws(
    () => resolveMatlabRuntimeExportCompatibility({ targetRelease: 'R2026b' }),
    /Unsupported MATLAB release/u,
  );
});

test('keeps PNG, PDF and SVG export and manifest support distinct', () => {
  const unsupportedSvg = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2013b',
    ...completeRuntimeContract('R2013b', { exportFormats: ['svg'], manifestRequired: false }),
  });
  assert.equal(unsupportedSvg.status, 'unsupported');
  assert.equal(unsupportedSvg.exports.svg.api, null);

  const legacySvg = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2014b',
    ...completeRuntimeContract('R2014b', { exportFormats: ['svg'], manifestRequired: false }),
  });
  assert.equal(legacySvg.status, 'ready');
  assert.equal(legacySvg.runtimeEvidence.executionVerified, true);
  assert.equal(legacySvg.runtimeEvidence.artifactsVerified, false);
  assert.equal(legacySvg.exports.svg.api, 'print');

  const preDirectSvg = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2024b',
    ...completeRuntimeContract('R2024b', { exportFormats: ['svg'], manifestRequired: false }),
  });
  assert.equal(preDirectSvg.exports.svg.api, 'print');

  const directSvg = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2025a',
    ...completeRuntimeContract('R2025a', { exportFormats: ['svg'], manifestRequired: false }),
  });
  assert.equal(directSvg.exports.svg.api, 'exportgraphics');

  const nativeManifestAuditsSvg = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2025a',
    ...completeRuntimeContract('R2025a', {
      exportFormats: ['png', 'pdf', 'svg'],
      manifestContract: { svgAccessibilityVerified: true },
    }),
  });
  assert.equal(nativeManifestAuditsSvg.status, 'verified');
  assert.equal(nativeManifestAuditsSvg.manifest.status, 'native');
  assert.deepEqual(nativeManifestAuditsSvg.manifest.unsupportedNativeFormats, []);

  const nativeManifestRemainsPreferred = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2025a',
    ...completeRuntimeContract('R2025a', {
      exportFormats: ['png', 'pdf', 'svg'],
      externalManifestWriterVerified: true,
      manifestContract: { svgAccessibilityVerified: true },
    }),
  });
  assert.equal(nativeManifestRemainsPreferred.status, 'verified');
  assert.equal(nativeManifestRemainsPreferred.manifest.status, 'native');
  assert.deepEqual(nativeManifestRemainsPreferred.manifest.unsupportedNativeFormats, []);
});

test('requires JVM and honest machine-verifiable manifest evidence', () => {
  const noJvm = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2024b',
    ...completeRuntimeContract('R2024b', { jvmAvailable: false }),
  });
  assert.equal(noJvm.status, 'unsupported');
  assert.ok(noJvm.errors.some((entry) => entry.code === 'AUDITED_MANIFEST_JVM_UNSUPPORTED'));

  const badHash = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2024b',
    ...completeRuntimeContract('R2024b', { manifestContract: { sha256Verified: false } }),
  });
  assert.equal(badHash.status, 'invalid');
  assert.ok(badHash.errors.some((entry) => entry.code === 'MANIFEST_SHA256_REQUIRED'));

  const overstatedVisualCheck = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2024b',
    ...completeRuntimeContract('R2024b', {
      manifestContract: { visualInspection: { status: 'not_run', verified: true } },
    }),
  });
  assert.equal(overstatedVisualCheck.status, 'invalid');
  assert.ok(overstatedVisualCheck.errors.some((entry) => entry.code === 'MANIFEST_VISUAL_VERIFICATION_CONFLICT'));

  const anonymousFallback = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2018b',
    ...completeRuntimeContract('R2018b', { externalManifestWriter: '' }),
  });
  assert.equal(anonymousFallback.status, 'needs-input');
  assert.equal(anonymousFallback.manifest.status, 'needs-input');
  assert.ok(anonymousFallback.missingInputs.some((entry) => entry.code === 'AUDITED_MANIFEST_EXTERNAL_WRITER_ID_REQUIRED'));
});

test('records optional toolbox installation natively without overstating license or invocation evidence', () => {
  const toolboxEvidence = {
    matlab: { installed: true, invocationVerified: true },
    statistics: {
      installed: true,
      licenseTested: true,
      licenseAvailable: true,
      functions: { isoutlier: true },
      invocationVerified: true,
    },
  };
  const nativeManifest = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2024b',
    ...completeRuntimeContract('R2024b', {
      toolboxes: ['statistics'],
      toolboxEvidence,
      requiredFunctions: { statistics: ['isoutlier'] },
      requireToolboxInvocation: true,
    }),
  });
  assert.equal(nativeManifest.status, 'verified');
  assert.equal(nativeManifest.toolboxReadiness.status, 'verified');
  assert.equal(nativeManifest.manifest.status, 'native');
  assert.deepEqual(nativeManifest.manifest.optionalToolboxes, ['statistics']);
  assert.deepEqual(nativeManifest.manifest.unrecordedNativeToolboxes, []);
  assert.equal(nativeManifest.manifest.nativeToolboxEvidenceScope, 'installation-only');

  const enrichedManifest = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2024b',
    ...completeRuntimeContract('R2024b', {
      toolboxes: ['statistics'],
      toolboxEvidence,
      requiredFunctions: { statistics: ['isoutlier'] },
      requireToolboxInvocation: true,
      externalManifestWriterVerified: true,
    }),
  });
  assert.equal(enrichedManifest.status, 'verified');
  assert.equal(enrichedManifest.toolboxReadiness.status, 'verified');
  assert.equal(enrichedManifest.manifest.status, 'native');
});

test('rejects inherited object keys as capabilities, formats and toolbox ids', () => {
  for (const key of ['constructor', 'toString', '__proto__']) {
    assert.equal(matlabReleaseSupports('R2024b', key), false, key);
    assert.equal(selectMatlabApi('R2024b', key, { required: false }).status, 'unsupported', key);
    assert.equal(
      resolveMatlabPlotCapabilities({ targetRelease: 'R2024b', requested: [key] }).capabilities[key].status,
      'unknown',
      key,
    );
    assert.throws(() => resolveMatlabToolboxDependencies([key]), /Unknown MATLAB toolbox dependency/u, key);
    assert.throws(() => normalizeMatlabExportFormat(key), /Unknown MATLAB export format/u, key);
  }
});

test('rejects spoofed executables and unsupported release evidence sources', () => {
  const octaveSpoof = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2024b',
    ...completeRuntimeContract('R2024b', {
      executable: '/usr/bin/octave',
      executableIdentityVerified: true,
      command: 'octave --eval "disp(\'-batch\')"',
    }),
  });
  assert.equal(octaveSpoof.status, 'unavailable');
  assert.equal(octaveSpoof.runtimeEvidence.executionVerified, false);
  assert.ok(octaveSpoof.errors.some((entry) => entry.code === 'MATLAB_EXECUTABLE_INVALID'));
  assert.ok(octaveSpoof.errors.some((entry) => entry.code === 'MATLAB_COMMAND_RUNTIME_CONFLICT'));

  const argumentSpoof = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2024b',
    ...completeRuntimeContract('R2024b', { command: 'printf -- -batch /opt/MATLAB/R2024b/bin/matlab' }),
  });
  assert.equal(argumentSpoof.status, 'invalid');
  assert.equal(argumentSpoof.runtimeEvidence.executionVerified, false);
  assert.ok(argumentSpoof.errors.some((entry) => entry.code === 'MATLAB_COMMAND_EXECUTABLE_MISMATCH'));

  const relativeExecutable = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2024b',
    ...completeRuntimeContract('R2024b', {
      executable: 'matlab',
      command: 'matlab -batch "run_task"',
    }),
  });
  assert.equal(relativeExecutable.status, 'unavailable');
  assert.equal(relativeExecutable.runtimeEvidence.executionVerified, false);
  assert.ok(relativeExecutable.errors.some((entry) => entry.code === 'MATLAB_EXECUTABLE_INVALID'));

  const missingIdentitySources = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2024b',
    ...completeRuntimeContract('R2024b', { executable: '', releaseEvidenceSource: '', command: '' }),
  });
  assert.equal(missingIdentitySources.status, 'needs-input');
  assert.equal(missingIdentitySources.runtimeEvidence.executionVerified, false);
  assert.ok(missingIdentitySources.missingInputs.some((entry) => entry.code === 'MATLAB_EXECUTABLE_REQUIRED'));
  assert.ok(missingIdentitySources.missingInputs.some((entry) => entry.code === 'MATLAB_RELEASE_SOURCE_REQUIRED'));

  const unavailableReleaseApi = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2019b',
    ...completeRuntimeContract('R2019b', { releaseEvidenceSource: 'matlabRelease' }),
  });
  assert.equal(unavailableReleaseApi.status, 'invalid');
  assert.ok(unavailableReleaseApi.errors.some((entry) => entry.code === 'MATLAB_RELEASE_SOURCE_UNSUPPORTED'));

  const legacyReleaseProbe = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2019b',
    ...completeRuntimeContract('R2019b', { releaseEvidenceSource: 'version("-release")' }),
  });
  assert.equal(legacyReleaseProbe.status, 'verified');
  assert.equal(legacyReleaseProbe.runtimeEvidence.releaseEvidenceSource, "version('-release')");

  const windowsExecutable = 'C:\\Program Files\\MATLAB\\R2024b\\bin\\matlab.exe';
  const quotedExecutable = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2024b',
    ...completeRuntimeContract('R2024b', {
      executable: windowsExecutable,
      command: `"${windowsExecutable}" -batch "run_task"`,
    }),
  });
  assert.equal(quotedExecutable.status, 'verified');
});

test('rejects command-line tricks that hide MATLAB failures', () => {
  const falseLegacySuccess = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2018b',
    ...completeRuntimeContract('R2018b', {
      command: 'matlab -r "try, run_task; catch error, disp(error); exit(0); end; exit(0)"',
    }),
  });
  assert.equal(falseLegacySuccess.status, 'invalid');
  assert.equal(falseLegacySuccess.runtimeEvidence.executionVerified, false);
  assert.ok(falseLegacySuccess.errors.some((entry) => entry.code === 'MATLAB_COMMAND_RELEASE_CONFLICT'));

  const shellMaskedFailure = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2024b',
    ...completeRuntimeContract('R2024b', { command: 'matlab -batch "run_task" || true' }),
  });
  assert.equal(shellMaskedFailure.status, 'invalid');
  assert.ok(shellMaskedFailure.errors.some((entry) => entry.code === 'MATLAB_COMMAND_EXIT_MASKING'));

  for (const command of [
    '/opt/MATLAB/R2024b/bin/matlab -batch "run_task"; true',
    '/opt/MATLAB/R2024b/bin/matlab -batch "run_task" | tee run.log',
    '/opt/MATLAB/R2024b/bin/matlab -batch "$(printf run_task)"',
  ]) {
    const composedCommand = resolveMatlabRuntimeExportCompatibility({
      targetRelease: 'R2024b',
      ...completeRuntimeContract('R2024b', { command }),
    });
    assert.equal(composedCommand.status, 'invalid', command);
    assert.equal(composedCommand.runtimeEvidence.executionVerified, false, command);
    assert.ok(composedCommand.errors.some((entry) => entry.code === 'MATLAB_COMMAND_EXIT_MASKING'), command);
  }

  const malformedCommand = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2024b',
    ...completeRuntimeContract('R2024b', {
      command: '/opt/MATLAB/R2024b/bin/matlab -batch "run_task',
    }),
  });
  assert.equal(malformedCommand.status, 'invalid');
  assert.ok(malformedCommand.errors.some((entry) => entry.code === 'MATLAB_COMMAND_SYNTAX_INVALID'));

  const payloadMentionsLegacySwitch = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2024b',
    ...completeRuntimeContract('R2024b', {
      command: '/opt/MATLAB/R2024b/bin/matlab -batch "disp(\' -r \')"',
    }),
  });
  assert.equal(payloadMentionsLegacySwitch.status, 'verified');

  const payloadMentionsOctave = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2024b',
    ...completeRuntimeContract('R2024b', {
      command: '/opt/MATLAB/R2024b/bin/matlab -batch "disp(\'Octave is not the runtime\')"',
    }),
  });
  assert.equal(payloadMentionsOctave.status, 'verified');

  const delegatedOctave = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2024b',
    ...completeRuntimeContract('R2024b', {
      command: '/opt/MATLAB/R2024b/bin/matlab -batch "system(\'octave --eval run_task\')"',
    }),
  });
  assert.equal(delegatedOctave.status, 'invalid');
  assert.ok(delegatedOctave.errors.some((entry) => entry.code === 'MATLAB_COMMAND_RUNTIME_CONFLICT'));

  const mixedModes = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2024b',
    ...completeRuntimeContract('R2024b', { command: 'matlab -batch "run_task" -r "run_task"' }),
  });
  assert.equal(mixedModes.status, 'invalid');
  assert.ok(mixedModes.errors.some((entry) => entry.code === 'MATLAB_COMMAND_RELEASE_CONFLICT'));
});

test('rejects orphan required functions instead of silently inferring a toolbox declaration', () => {
  const evidence = {
    matlab: { installed: true },
    statistics: {
      installed: true,
      licenseTested: true,
      licenseAvailable: true,
      functions: { isoutlier: true },
    },
  };
  const orphan = resolveMatlabToolboxReadiness({
    requiredFunctions: { statistics: ['isoutlier'] },
    evidence,
  });
  assert.equal(orphan.status, 'invalid');
  assert.deepEqual(orphan.dependencies.map((entry) => entry.id), ['matlab', 'statistics']);
  assert.ok(orphan.errors.some((entry) => entry.code === 'TOOLBOX_DEPENDENCY_DECLARATION_REQUIRED'));

  const runtimeOrphan = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2024b',
    ...completeRuntimeContract('R2024b', {
      requiredFunctions: { statistics: ['isoutlier'] },
      toolboxEvidence: evidence,
    }),
  });
  assert.equal(runtimeOrphan.status, 'invalid');
  assert.ok(runtimeOrphan.errors.some((entry) => entry.code === 'TOOLBOX_DEPENDENCY_DECLARATION_REQUIRED'));

  const inheritedProduct = JSON.parse('{"__proto__":["pollute"]}');
  assert.throws(
    () => resolveMatlabToolboxReadiness({ requiredFunctions: inheritedProduct }),
    /Unknown MATLAB toolbox dependency/u,
  );

  const inheritedInstallation = Object.create({ installed: true });
  const inheritedEvidence = resolveMatlabToolboxReadiness({
    evidence: { matlab: inheritedInstallation },
  });
  assert.equal(inheritedEvidence.status, 'needs-input');
  assert.equal(inheritedEvidence.dependencies[0].installed, null);
  assert.ok(inheritedEvidence.missingInputs.some((entry) => entry.code === 'TOOLBOX_INSTALLATION_EVIDENCE_REQUIRED'));
});

test('does not overstate artifact or native manifest toolbox verification', () => {
  const executionOnly = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2025a',
    ...completeRuntimeContract('R2025a', { manifestRequired: false }),
  });
  assert.equal(executionOnly.status, 'ready');
  assert.equal(executionOnly.runtimeEvidence.executionVerified, true);
  assert.equal(executionOnly.runtimeEvidence.artifactsRequired, true);
  assert.equal(executionOnly.runtimeEvidence.artifactsVerified, false);

  const failedExecution = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2025a',
    ...completeRuntimeContract('R2025a', { exitCode: 1 }),
  });
  assert.equal(failedExecution.status, 'unavailable');
  assert.equal(failedExecution.runtimeEvidence.executionVerified, false);
  assert.equal(failedExecution.runtimeEvidence.artifactsVerified, false);
  assert.equal(failedExecution.manifest.verified, false);

  const inheritedManifestContract = Object.create(completeManifestContract());
  const inheritedManifest = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2025a',
    ...completeRuntimeContract('R2025a'),
    manifestContract: inheritedManifestContract,
  });
  assert.equal(inheritedManifest.status, 'needs-input');
  assert.equal(inheritedManifest.runtimeEvidence.artifactsVerified, false);
  assert.equal(inheritedManifest.manifest.verified, false);
  assert.ok(inheritedManifest.missingInputs.some((entry) => entry.code === 'MANIFEST_SCHEMA_VERSION_REQUIRED'));

  const overstatedNativeManifest = resolveMatlabRuntimeExportCompatibility({
    targetRelease: 'R2025a',
    ...completeRuntimeContract('R2025a', {
      manifestContract: { toolboxEvidenceScope: 'invocation' },
    }),
  });
  assert.equal(overstatedNativeManifest.status, 'invalid');
  assert.ok(overstatedNativeManifest.errors.some((entry) => entry.code === 'MANIFEST_TOOLBOX_SCOPE_OVERSTATED'));

  assert.throws(
    () => resolveMatlabRuntimeExportCompatibility({ targetRelease: 'Ｒ2024b' }),
    /Unsupported MATLAB release/u,
  );
  assert.throws(() => normalizeMatlabExportFormat('../plot.png'), /Unknown MATLAB export format/u);
});

test('exposes runtime/export compatibility through the generator-facing plan', () => {
  const runtimeContract = completeRuntimeContract('R2024b');
  const plan = resolveMatlabPlotCapabilities({
    targetRelease: 'R2024b',
    requested: ['tiledlayout', 'exportgraphics', 'auditedFigureManifest'],
    exportFormats: ['png', 'pdf'],
    runtimeContract,
  });
  assert.equal(plan.runtimeExportContract.status, 'verified');
  assert.equal(plan.runtimeExportContract.manifest.strategy, 'repository-matlab-helper');
  assert.equal(plan.runtimeExportContract.exports.png.api, 'exportgraphics');

  const instruction = matlabCapabilityInstructionBlock({
    targetRelease: 'R2024b',
    requested: ['auditedFigureManifest'],
    exportFormats: ['png', 'pdf'],
    runtimeContract,
  });
  assert.match(instruction, /运行时与导出契约：verified/u);
  assert.match(instruction, /Manifest：native/u);
  assert.match(instruction, /执行证据 已核验/u);
});

test('defines R2021a, R2024b and production MATLAB CI lanes with archival evidence', () => {
  const matrix = buildMatlabRuntimeCiMatrix({ productionRelease: 'R2026a', artifactRoot: 'evidence' });
  assert.equal(matrix.schemaVersion, MATLAB_CI_EVIDENCE_SCHEMA_VERSION);
  assert.deepEqual(matrix.statusVocabulary, ['unavailable', 'skipped', 'failed', 'passed']);
  assert.deepEqual(matrix.exitCodes, MATLAB_CI_EXIT_CODES);
  assert.deepEqual(matrix.jobs.map((job) => job.targetRelease), ['R2021a', 'R2024b', 'R2026a']);
  for (const job of matrix.jobs) {
    assert.equal(job.exactReleaseRequired, true);
    assert.match(job.command, new RegExp(`--expected-release ${job.targetRelease}`, 'u'));
    assert.ok(job.expectedArtifacts.includes('matlab-ci-evidence.json'));
    assert.ok(job.expectedArtifacts.includes('matlab-command.log'));
    assert.ok(job.failureConditions.some((condition) => /Octave/u.test(condition)));
    assert.deepEqual(job.runnerInputs.requiredToolboxes[1].evidence,
      ['installed', 'licenseTested', 'licenseAvailable', 'functionResolved', 'invocationVerified']);
  }
});

test('classifies MATLAB CI evidence without conflating unavailable, skipped, failed and passed', () => {
  const base = { jobId: 'matlab-r2024b', targetRelease: 'R2024b' };
  const unavailable = classifyMatlabCiEvidence({
    ...base,
    runtimeContract: { status: 'unavailable', runtimeEvidence: { matlabAvailable: false } },
  });
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.exitCode, 78);

  const skipped = classifyMatlabCiEvidence({ ...base, skipRequested: true, skipReason: 'scheduled lane disabled' });
  assert.equal(skipped.status, 'skipped');
  assert.equal(skipped.exitCode, 77);

  const failed = classifyMatlabCiEvidence({
    ...base,
    runtimeContract: {
      status: 'failed', runtimeEvidence: { matlabAvailable: true, executionVerified: false, artifactsVerified: false },
      errors: [{ code: 'MATLAB_EXIT_CODE_FAILED' }],
    },
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.exitCode, 1);

  const passed = classifyMatlabCiEvidence({
    ...base,
    runtimeContract: {
      status: 'verified',
      runtimeEvidence: {
        matlabAvailable: true, detectedRelease: 'R2024b', exactReleaseMatch: true,
        executionVerified: true, artifactsVerified: true,
      },
      environment: { headless: true },
      toolboxReadiness: { status: 'verified' },
      manifest: { verified: true },
    },
  });
  assert.equal(passed.status, 'passed');
  assert.equal(passed.exitCode, 0);
  assert.equal(passed.octaveEvidenceAccepted, false);
});
