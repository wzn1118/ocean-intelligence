import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import {
  compareMatlabReleases,
  selectMatlabExportStrategy,
} from './matlab-release-capabilities.mjs';
import { MATLAB_MANIFEST_SCHEMA_VERSION } from './matlab-task-routing-contract.mjs';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const REQUIRED_FORMATS = ['png', 'pdf'];
const SUPPORTED_FORMATS = ['png', 'pdf', 'svg'];

export function inspectMatlabPlotRegression(options = {}) {
  const manifestPath = resolveOptionalPath(options.manifestPath);
  const outputDirectory = resolveOptionalPath(options.outputDirectory)
    || (manifestPath ? path.dirname(manifestPath) : undefined);
  const baselineDirectory = resolveOptionalPath(options.baselineDirectory);
  const maximumManifestBytes = Math.min(
    positiveInteger(options.maximumManifestBytes, 5 * 1024 * 1024),
    64 * 1024 * 1024,
  );
  const manifestRead = readJson(manifestPath, maximumManifestBytes);
  const figures = objectList(manifestRead.value?.figures);
  const requiredFormats = options.requireSvg === true ? [...REQUIRED_FORMATS, 'svg'] : REQUIRED_FORMATS;
  const manifest = inspectManifest(manifestRead, figures, requiredFormats);
  const figureChecks = figures.map((figure, index) => inspectFigure({
    figure,
    index,
    outputDirectory,
    baselineDirectory,
    requiredFormats,
    options,
  }));
  const manifestFreshness = inspectRegressionManifestFreshness({
    manifest: manifestRead.value,
    manifestPath,
    outputDirectory,
    figures,
    toleranceMs: positiveInteger(options.freshnessToleranceMs, 2_000),
  });
  manifest.freshnessOk = manifestFreshness.ok;
  manifest.freshness = manifestFreshness;
  manifest.violations.push(...manifestFreshness.violations);
  manifest.missing = manifest.violations;
  manifest.ok = manifest.ok && manifestFreshness.ok;
  const structureOk = manifest.ok && figureChecks.length > 0
    && figureChecks.every((figure) => figure.structureOk);
  const artifactsOk = figureChecks.length > 0 && figureChecks.every((figure) => figure.artifactsOk);
  const imageRegressionOk = figureChecks.length > 0
    && figureChecks.every((figure) => figure.pixelDiffOk);
  const fontsOk = figureChecks.length > 0 && figureChecks.every((figure) => figure.fontsOk);
  const textObjectsOk = figureChecks.length > 0
    && figureChecks.every((figure) => figure.textObjectsOk);
  const axesOk = figureChecks.length > 0 && figureChecks.every((figure) => figure.axesOk);
  const clippingOk = figureChecks.length > 0 && figureChecks.every((figure) => figure.clippingOk);
  const accessibilityOk = figureChecks.length > 0
    && figureChecks.every((figure) => figure.accessibilityOk);
  const publicationQualityOk = figureChecks.length > 0
    && figureChecks.every((figure) => figure.publicationQualityOk);
  const interactionOk = figureChecks.length > 0
    && figureChecks.every((figure) => figure.interactionOk);
  const publicationContractsPresent = figureChecks.filter((figure) => figure.publicationQuality.present).length;
  const interactionContractsPresent = figureChecks.filter((figure) => figure.interaction.present).length;
  const cjkFontsOk = figureChecks.length > 0
    && figureChecks.every((figure) => figure.cjkFontsOk);
  const scienceSemanticsOk = figureChecks.length > 0
    && figureChecks.every((figure) => figure.scienceSemanticsOk);
  const scienceContractsPresent = figureChecks.filter((figure) => figure.scienceContractPresent).length;
  const scienceContractsComplete = figureChecks.length > 0
    && scienceContractsPresent === figureChecks.length;
  const runtimeRequired = options.requireMatlab !== false;
  const matlab = runtimeRequired
    ? detectMatlab(options.matlabCommand || 'matlab', options)
    : { available: false, verified: false, command: options.matlabCommand || 'matlab', reason: 'not_required' };
  const runtime = inspectRuntimeManifest(manifestRead.value, figures, matlab, options);
  const runtimeMetadataOk = runtime.ok;
  const checksOk = structureOk && artifactsOk && imageRegressionOk
    && fontsOk && textObjectsOk && axesOk && clippingOk && accessibilityOk && scienceSemanticsOk
    && publicationQualityOk && interactionOk && cjkFontsOk && runtimeMetadataOk;
  const runtimeUnavailable = runtime.unavailable && runtime.ok && !matlab.available;
  const skipped = (runtimeRequired && !matlab.available) || runtimeUnavailable;
  const skipReason = runtimeUnavailable ? runtime.reason : matlab.reason;

  return {
    status: skipped ? 'skipped' : (checksOk ? 'passed' : 'failed'),
    skipped,
    skipReason: skipped ? skipReason : undefined,
    matlabAvailable: matlab.available,
    matlabVerified: matlab.verified,
    matlabRelease: matlab.release,
    matlabProbeMode: matlab.probeMode,
    matlabCommand: matlab.command,
    runtimeMetadataOk,
    exportCompatibilityOk: runtime.exportCompatibilityOk,
    toolboxesOk: runtime.toolboxesOk,
    headlessRuntimeOk: runtime.headlessOk,
    visualInspectionVerified: runtime.visualInspectionVerified,
    manifestOk: manifest.ok,
    manifestFreshnessOk: manifestFreshness.ok,
    manifestFreshness,
    structureOk,
    artifactsOk,
    imageRegressionOk,
    fontsOk,
    textObjectsOk,
    axesOk,
    clippingOk,
    accessibilityOk,
    publicationQualityOk,
    interactionOk,
    publicationContractsPresent,
    publicationContractsComplete: figureChecks.length > 0
      && publicationContractsPresent === figureChecks.length,
    interactionContractsPresent,
    interactionContractsComplete: figureChecks.length > 0
      && interactionContractsPresent === figureChecks.length,
    cjkFontsOk,
    scienceSemanticsOk,
    scienceContractsPresent,
    scienceContractsComplete,
    regressionOk: !skipped && checksOk,
    manifest,
    runtime,
    figures: figureChecks,
  };
}

export function runMatlabPlotRegressionCli(argumentsList = process.argv.slice(2)) {
  let options;
  try {
    options = parseCliArguments(argumentsList);
  } catch (error) {
    return { exitCode: 2, output: { status: 'error', error: error.message } };
  }
  const result = inspectMatlabPlotRegression(options);
  return { exitCode: result.status === 'failed' ? 1 : 0, output: result };
}

function inspectManifest(result, figures, requiredFormats) {
  const violations = [];
  if (!result.present) violations.push('manifest.missing');
  if (result.present && !result.parseOk) violations.push('manifest.invalid_json');
  if (result.tooLarge) violations.push('manifest.too_large');
  const manifest = result.value;
  if (manifest?.schema_version !== MATLAB_MANIFEST_SCHEMA_VERSION) {
    violations.push(`schema_version.expected_${MATLAB_MANIFEST_SCHEMA_VERSION}`);
  }
  if (!validUtcTimestamp(manifest?.generated_at)) {
    violations.push('generated_at');
  }
  if (!nonEmptyString(manifest?.generator)) violations.push('generator');
  if (figures.length === 0) violations.push('figures');

  const ids = new Set();
  const artifactFiles = new Set();
  let previousId = '';
  figures.forEach((figure, index) => {
    const prefix = `figures[${index}]`;
    if (!nonEmptyString(figure.id)) violations.push(`${prefix}.id`);
    else {
      if (ids.has(figure.id)) violations.push(`${prefix}.id.duplicate`);
      if (previousId && figure.id < previousId) violations.push(`${prefix}.id.order`);
      ids.add(figure.id);
      previousId = figure.id;
    }
    for (const field of ['title', 'source', 'theme']) {
      if (!nonEmptyString(figure[field])) violations.push(`${prefix}.${field}`);
    }
    if (objectList(figure.text_objects).length === 0) {
      violations.push(`${prefix}.text_objects`);
    }
    if (objectList(figure.axes_objects).length === 0) {
      violations.push(`${prefix}.axes_objects`);
    }
    inspectAccessibilityManifest(figure.accessibility, prefix, violations);
    for (const format of requiredFormats) {
      if (!figure.exports?.[format]) violations.push(`${prefix}.exports.${format}`);
    }
    for (const format of Object.keys(figure.exports || {})) {
      if (!SUPPORTED_FORMATS.includes(format)) violations.push(`${prefix}.exports.${format}.unsupported`);
    }
    for (const format of SUPPORTED_FORMATS) {
      const artifact = figure.exports?.[format];
      if (!artifact) continue;
      inspectArtifactManifest(artifact, format, prefix, violations, figure);
      if (relativeFile(artifact.file)) {
        const normalizedFile = path.normalize(artifact.file);
        if (artifactFiles.has(normalizedFile)) violations.push(`${prefix}.exports.${format}.file.duplicate`);
        artifactFiles.add(normalizedFile);
      }
    }
  });

  return {
    present: result.present,
    parseOk: result.parseOk,
    ok: result.present && result.parseOk && violations.length === 0,
    violations,
    missing: violations,
  };
}

function inspectAccessibilityManifest(accessibility, prefix, violations) {
  if (!accessibility || typeof accessibility !== 'object') {
    violations.push(`${prefix}.accessibility`);
    return;
  }
  if (!nonEmptyString(accessibility.alt_text)) violations.push(`${prefix}.accessibility.alt_text`);
  if (!positiveNumber(accessibility.contrast_ratio)) violations.push(`${prefix}.accessibility.contrast_ratio`);
  if (accessibility.color_only_encoding !== false) {
    violations.push(`${prefix}.accessibility.color_only_encoding`);
  }
}

function inspectArtifactManifest(artifact, format, prefix, violations, figure) {
  const artifactPrefix = `${prefix}.exports.${format}`;
  if (!relativeFile(artifact.file)) violations.push(`${artifactPrefix}.file`);
  if (path.extname(String(artifact.file || '')).toLowerCase() !== `.${format}`) {
    violations.push(`${artifactPrefix}.file.extension`);
  }
  if (!positiveInteger(artifact.bytes)) violations.push(`${artifactPrefix}.bytes`);
  if (!/^[a-f\d]{64}$/iu.test(String(artifact.sha256 || ''))) violations.push(`${artifactPrefix}.sha256`);
  if (!positiveNumber(artifact.width)) violations.push(`${artifactPrefix}.width`);
  if (!positiveNumber(artifact.height)) violations.push(`${artifactPrefix}.height`);
  if (!['exportgraphics', 'print'].includes(normalizeStatus(artifact.export_api))) {
    violations.push(`${artifactPrefix}.export_api`);
  }
  if (format === 'png' && !positiveInteger(artifact.dpi)) violations.push(`${artifactPrefix}.dpi`);
  if (format === 'pdf') {
    if (!positiveInteger(artifact.pages)) violations.push(`${artifactPrefix}.pages`);
    if (!nonEmptyString(artifact.text)) violations.push(`${artifactPrefix}.text`);
  }
  if (format === 'svg') {
    for (const field of ['title', 'description', 'accessible_name']) {
      if (!nonEmptyString(artifact[field])) violations.push(`${artifactPrefix}.${field}`);
    }
    if (typeof artifact.export_device !== 'string') violations.push(`${artifactPrefix}.export_device`);
    if (normalizeStatus(artifact.export_api) === 'print' && artifact.export_device !== '-dsvg') {
      violations.push(`${artifactPrefix}.export_device.print`);
    }
  }
  for (const field of ['figure_id', 'title', 'source', 'theme']) {
    const figureField = field === 'figure_id' ? 'id' : field;
    if (artifact[field] !== undefined && artifact[field] !== figure[figureField]) {
      violations.push(`${artifactPrefix}.${field}.mismatch`);
    }
  }
}

function inspectRuntimeManifest(manifest, figures, matlab, options) {
  const runtime = manifest?.runtime && typeof manifest.runtime === 'object' && !Array.isArray(manifest.runtime)
    ? manifest.runtime
    : {};
  const required = options.requireRuntimeContract === true;
  const present = Object.keys(runtime).length > 0 || [
    'runtime_status', 'execution_verified', 'matlab_release', 'toolboxes',
    'runtime', 'artifact_validation', 'visual_inspection', 'required_toolboxes', 'export_strategies',
  ].some((field) => Object.hasOwn(manifest || {}, field));
  if (!present) {
    return {
      present: false,
      required,
      status: required ? 'missing' : 'not_provided',
      ok: !required,
      unavailable: false,
      exportCompatibilityOk: !required,
      toolboxesOk: !required,
      headlessOk: !required,
      visualInspectionVerified: false,
      violations: required ? ['contract.missing'] : [],
    };
  }

  const violations = [];
  const runtimeStatus = normalizeStatus(firstDefined(runtime.runtime_status, runtime.status, manifest.runtime_status));
  const executionVerified = firstBoolean(runtime.execution_verified, runtime.executionVerified,
    manifest.execution_verified, manifest.executionVerified);
  const releaseValue = firstString(runtime.matlab_release, runtime.release, runtime.target_release,
    manifest.matlab_release);
  const release = canonicalMatlabRelease(releaseValue);
  const engine = normalizeStatus(firstString(runtime.engine, runtime.runtime, manifest.runtime));
  const artifactValidation = firstObject(runtime.artifact_validation, manifest.artifact_validation) || {};
  const visualInspection = firstObject(runtime.visual_inspection, manifest.visual_inspection) || {};
  const errors = firstDefined(runtime.errors, manifest.errors);
  const unavailable = ['unavailable', 'runtime_unavailable', 'skipped'].includes(runtimeStatus);
  const ready = runtimeStatus === 'ready';
  const reason = firstString(runtime.reason, runtime.skip_reason, manifest.skip_reason,
    firstRuntimeError(errors));

  if (engine && engine !== 'matlab') violations.push('runtime.engine.matlab_required');
  if (!ready && !unavailable) violations.push('runtime_status');
  if (typeof executionVerified !== 'boolean') violations.push('execution_verified');
  if (ready && executionVerified !== true) violations.push('execution_verified.ready');
  if (unavailable && executionVerified !== false) violations.push('execution_verified.unavailable');
  if (unavailable && !reason) violations.push('runtime.reason');
  if (unavailable && matlab.available) violations.push('runtime_status.actual_matlab_available');

  let normalizedRelease;
  if (ready || releaseValue) {
    if (!releaseValue) violations.push('matlab_release');
    else if (!release) violations.push('matlab_release.invalid');
    else {
      try {
        normalizedRelease = selectMatlabExportStrategy(release, 'png').targetRelease;
      } catch {
        violations.push('matlab_release.unsupported');
      }
    }
  }
  if (normalizedRelease && options.targetMatlabRelease) {
    try {
      const targetRelease = selectMatlabExportStrategy(
        canonicalMatlabRelease(options.targetMatlabRelease),
        'png',
      ).targetRelease;
      if (targetRelease !== normalizedRelease) violations.push('matlab_release.target_mismatch');
    } catch {
      violations.push('matlab_release.target_invalid');
    }
  }
  if (normalizedRelease && matlab.available && matlab.release !== normalizedRelease) {
    violations.push('matlab_release.runtime_mismatch');
  }

  const artifactValidationStatus = normalizeStatus(artifactValidation.status);
  if (ready && artifactValidationStatus !== 'passed') violations.push('artifact_validation.status');
  if (ready && artifactValidation.verified !== true) violations.push('artifact_validation.verified');
  const visualInspectionStatus = normalizeStatus(visualInspection.status);
  const visualInspectionVerified = visualInspection.verified === true;
  if (ready && typeof visualInspection.verified !== 'boolean') violations.push('visual_inspection.verified');
  if (ready && !visualInspectionVerified) violations.push('visual_inspection.required');
  if (visualInspectionVerified && !['passed', 'verified', 'complete', 'completed'].includes(visualInspectionStatus)) {
    violations.push('visual_inspection.status');
  }
  if (['passed', 'verified', 'complete', 'completed'].includes(visualInspectionStatus)
      && !visualInspectionVerified) {
    violations.push('visual_inspection.claim_mismatch');
  }
  if (ready && runtimeErrors(errors).length > 0) violations.push('errors.not_empty');

  const installedSource = firstDefined(runtime.installed_toolboxes, runtime.toolboxes, manifest.toolboxes);
  const requiredSource = firstDefined(runtime.required_toolboxes, runtime.requiredToolboxes,
    manifest.required_toolboxes, manifest.requiredToolboxes);
  if (required && ready && installedSource === undefined) violations.push('toolboxes');
  const installedToolboxes = toolboxList(installedSource);
  const requiredToolboxes = toolboxList(requiredSource);
  const installedIds = new Set(installedToolboxes.map(normalizeToolboxId));
  const missingToolboxes = requiredToolboxes.filter((toolbox) => {
    const toolboxId = normalizeToolboxId(toolbox);
    return toolboxId !== 'matlab' && !installedIds.has(toolboxId);
  });
  if (ready && missingToolboxes.length > 0) violations.push('toolboxes.missing');

  const exportViolations = [];
  const exportPlans = [];
  if (normalizedRelease) {
    figures.forEach((figure, figureIndex) => {
      for (const format of SUPPORTED_FORMATS) {
        const artifact = figure.exports?.[format];
        if (!artifact) continue;
        const declaredApi = declaredExportApi(runtime, manifest, artifact, format);
        if (declaredApi && !['exportgraphics', 'print'].includes(declaredApi)) {
          exportViolations.push(`figures[${figureIndex}].exports.${format}.api`);
          continue;
        }
        const strategy = selectMatlabExportStrategy(normalizedRelease, format, {
          preferredApi: declaredApi || 'exportgraphics',
        });
        exportPlans.push({ figure: figure.id, format, declaredApi: declaredApi || null, ...strategy });
        if (strategy.status === 'unsupported') {
          exportViolations.push(`figures[${figureIndex}].exports.${format}.release_unsupported`);
        } else if (declaredApi && strategy.api !== declaredApi) {
          exportViolations.push(`figures[${figureIndex}].exports.${format}.api_release_mismatch`);
        }
      }
    });
  }
  violations.push(...exportViolations);

  const headless = firstObject(runtime.headless, manifest.headless) || {};
  const headlessExpected = options.expectHeadless === true || runtime.headless === true
    || Object.keys(headless).length > 0;
  const headlessViolations = [];
  if (headlessExpected) {
    const figureVisible = normalizeStatus(firstString(headless.figure_visible, headless.figureVisible));
    const desktopIndependent = firstBoolean(headless.desktop_independent, headless.desktopIndependent);
    const nonInteractive = firstBoolean(headless.non_interactive, headless.nonInteractive);
    if (figureVisible !== 'off') headlessViolations.push('headless.figure_visible');
    if (desktopIndependent !== true) headlessViolations.push('headless.desktop_independent');
    if (nonInteractive !== true) headlessViolations.push('headless.non_interactive');
    if (headless.dialogs === true || headless.wait_for_input === true || headless.waitForInput === true) {
      headlessViolations.push('headless.interactive_input');
    }
    if (headless.no_jvm === true || headless.noJvm === true) headlessViolations.push('headless.no_jvm');
    const command = firstString(headless.batch_api, headless.batchApi, headless.command,
      runtime.batch_api, runtime.batchApi);
    if (!command) headlessViolations.push('headless.batch_api');
    else if (normalizedRelease) {
      const supportsBatch = compareMatlabReleases(normalizedRelease, 'R2019a') >= 0;
      const usesBatch = /(?:^|\s)-batch(?:\s|$)/iu.test(command);
      const usesLegacyRun = /(?:^|\s)-r(?:\s|$)/iu.test(command);
      if ((supportsBatch && !usesBatch) || (!supportsBatch && (!usesLegacyRun || usesBatch))) {
        headlessViolations.push('headless.batch_api.release_mismatch');
      }
    }
    figures.forEach((figure, figureIndex) => {
      const interaction = figure.interaction || {};
      if (interaction.enabled === true) headlessViolations.push(`figures[${figureIndex}].interaction.enabled`);
      if (interaction.desktop_available === true || interaction.desktopAvailable === true) {
        headlessViolations.push(`figures[${figureIndex}].interaction.desktop_available`);
      }
      if (interaction.headless?.supported !== true) {
        headlessViolations.push(`figures[${figureIndex}].interaction.headless.supported`);
      }
      if (interaction.headless?.verified !== true) {
        headlessViolations.push(`figures[${figureIndex}].interaction.headless.verified`);
      }
    });
  }
  violations.push(...headlessViolations);

  return {
    present: true,
    required,
    status: violations.length > 0 ? 'invalid' : runtimeStatus,
    ok: violations.length === 0,
    runtimeStatus,
    unavailable,
    reason,
    executionVerified,
    release: normalizedRelease || release,
    exportCompatibilityOk: exportViolations.length === 0,
    exportPlans,
    exportStrategiesComplete: exportPlans.length > 0
      && exportPlans.every((plan) => nonEmptyString(plan.declaredApi)),
    toolboxesOk: missingToolboxes.length === 0,
    installedToolboxes,
    requiredToolboxes,
    missingToolboxes,
    headlessExpected,
    headlessOk: headlessViolations.length === 0,
    visualInspectionStatus: visualInspectionStatus || 'not_provided',
    visualInspectionVerified,
    violations,
  };
}

function inspectFigure({ figure, index, outputDirectory, baselineDirectory, requiredFormats, options }) {
  const textObjects = objectList(figure.text_objects);
  const axesObjects = objectList(figure.axes_objects);
  const canvas = figureCanvas(figure);
  const textAudit = inspectTextObjects(textObjects);
  const fonts = inspectFonts(textObjects, axesObjects, options);
  const axes = inspectAxes(axesObjects);
  const clipping = inspectClipping([...textObjects, ...axesObjects], canvas);
  const accessibility = inspectAccessibility(figure.accessibility, options);
  const science = inspectScienceContract(figure, options);
  const publication = inspectPublicationContract(figure, options);
  const interaction = inspectInteractionContract(figure, options);
  const artifacts = {};
  let artifactsOk = true;
  let pixelDiffOk = true;

  for (const format of SUPPORTED_FORMATS) {
    const metadata = figure.exports?.[format];
    if (!metadata) continue;
    const filePath = resolveArtifactPath(metadata.file, outputDirectory);
    const pathRejected = Boolean(outputDirectory && relativeFile(metadata.file) && !filePath);
    const check = inspectArtifact({
      format,
      metadata,
      filePath,
      pathRejected,
      baselineDirectory,
      options,
    });
    artifacts[format] = check;
    artifactsOk = artifactsOk && check.ok;
    if (format === 'png') pixelDiffOk = check.pixelDiff.ok;
  }
  for (const format of requiredFormats) {
    if (!artifacts[format]) artifactsOk = false;
  }

  return {
    id: nonEmptyString(figure.id) ? figure.id : `figures[${index}]`,
    index,
    structureOk: textAudit.ok && fonts.ok && axes.ok && clipping.ok && accessibility.ok,
    artifactsOk,
    pixelDiffOk,
    textObjectsOk: textAudit.ok,
    fontsOk: fonts.ok,
    cjkFontsOk: fonts.cjkOk,
    axesOk: axes.ok,
    clippingOk: clipping.ok,
    accessibilityOk: accessibility.ok,
    publicationQualityOk: publication.ok,
    interactionOk: interaction.ok,
    scienceSemanticsOk: science.ok,
    scienceContractPresent: science.present,
    textObjects,
    axesObjects,
    textAudit,
    fonts,
    axesAudit: axes,
    clipping,
    accessibility,
    publicationQuality: publication,
    interaction,
    scienceSemantics: science,
    pixelDiff: artifacts.png?.pixelDiff,
    ...artifacts,
  };
}

function inspectArtifact({ format, metadata, filePath, pathRejected, baselineDirectory, options }) {
  const minimumBytes = minimumArtifactBytes(format, options);
  const maximumBytes = maximumArtifactBytes(format, options);
  const file = inspectFile(filePath);
  const readable = file.present && file.bytes <= maximumBytes;
  const base = {
    format,
    file: filePath,
    present: file.present,
    pathOk: !pathRejected,
    pathError: pathRejected ? 'artifact_path_outside_root' : undefined,
    bytes: file.bytes,
    nonEmpty: file.present && file.bytes >= minimumBytes,
    maximumBytes,
    sizeOk: readable,
    readable,
    bytesOk: file.present && file.bytes === metadata.bytes,
    checksumOk: readable && sha256(filePath) === String(metadata.sha256 || '').toLowerCase(),
  };
  if (format === 'png') return inspectPngArtifact(base, metadata, baselineDirectory, options);
  if (format === 'pdf') return inspectPdfArtifact(base, metadata);
  return inspectSvgArtifact(base, metadata);
}

function inspectPngArtifact(base, metadata, baselineDirectory, options) {
  const unreadableReason = base.pathOk === false
    ? 'artifact_path_outside_root'
    : (base.present ? 'artifact_size_limit_exceeded' : 'artifact_not_found');
  const candidate = base.readable
    ? inspectPngStructure(base.file, options)
    : { ok: false, reason: unreadableReason };
  const baselinePath = resolveArtifactPath(metadata.file, baselineDirectory);
  const pixelDiff = base.readable
    ? comparePng(candidate, baselinePath, options)
    : { ok: false, available: false, reason: base.pathOk === false
      ? 'artifact_path_outside_root'
      : (base.present ? 'artifact_size_limit_exceeded' : 'baseline_not_found') };
  const dimensionsOk = candidate.ok
    && candidate.width === metadata.width
    && candidate.height === metadata.height;
  const declaredDpiOk = positiveInteger(metadata.dpi)
    && metadata.dpi >= positiveInteger(options.minimumDpi, 150);
  const embeddedDpiPresent = Boolean(
    positiveNumber(candidate.embeddedDpiX) && positiveNumber(candidate.embeddedDpiY),
  );
  const embeddedDpiMatches = !embeddedDpiPresent
    || (approximatelyEqual(candidate.embeddedDpiX, metadata.dpi)
      && approximatelyEqual(candidate.embeddedDpiY, metadata.dpi));
  const dpiOk = declaredDpiOk && embeddedDpiMatches
    && (options.requireEmbeddedPngDpi !== true || embeddedDpiPresent);
  return {
    ...base,
    width: candidate.width,
    height: candidate.height,
    dimensionsOk,
    headerOk: candidate.ok,
    headerError: candidate.reason,
    embeddedDpi: embeddedDpiPresent
      ? (candidate.embeddedDpiX + candidate.embeddedDpiY) / 2
      : undefined,
    embeddedDpiX: candidate.embeddedDpiX,
    embeddedDpiY: candidate.embeddedDpiY,
    embeddedDpiPresent,
    embeddedDpiMatches,
    dpiOk,
    pixelDiff,
    ok: base.present && base.nonEmpty && base.sizeOk && base.bytesOk && base.checksumOk
      && candidate.ok && dimensionsOk && dpiOk && pixelDiff.ok,
  };
}

function inspectPdfArtifact(base, metadata) {
  const pdf = base.readable ? inspectPdf(base.file) : { pages: 0, pageSizes: [] };
  const dimensionsOk = pdf.pageSizes.length === pdf.pages
    && pdf.pageSizes.every((size) => approximatelyEqual(size.width, metadata.width)
      && approximatelyEqual(size.height, metadata.height));
  const pagesOk = pdf.pages === metadata.pages;
  return {
    ...base,
    pages: pdf.pages,
    pageSizes: pdf.pageSizes,
    width: pdf.pageSizes[0]?.width,
    height: pdf.pageSizes[0]?.height,
    pagesOk,
    dimensionsOk,
    ok: base.present && base.nonEmpty && base.sizeOk && base.bytesOk && base.checksumOk
      && pagesOk && dimensionsOk,
  };
}

function inspectSvgArtifact(base, metadata) {
  const svg = base.readable ? inspectSvg(base.file) : undefined;
  const dimensionsOk = Boolean(svg)
    && approximatelyEqual(svg.width, metadata.width)
    && approximatelyEqual(svg.height, metadata.height);
  const titleOk = nonEmptyString(svg?.title);
  const descriptionOk = nonEmptyString(svg?.description);
  const accessibleNameOk = nonEmptyString(svg?.accessibleName);
  const titleMatches = titleOk && normalizeSvgText(metadata.title) === svg.title;
  const descriptionMatches = descriptionOk
    && normalizeSvgText(metadata.description) === svg.description;
  const accessibleNameMatches = accessibleNameOk
    && normalizeSvgText(metadata.accessible_name) === svg.accessibleName;
  return {
    ...base,
    width: svg?.width,
    height: svg?.height,
    dimensionsOk,
    title: svg?.title,
    description: svg?.description,
    accessibleName: svg?.accessibleName,
    titleOk,
    descriptionOk,
    accessibleNameOk,
    titleMatches,
    descriptionMatches,
    accessibleNameMatches,
    securityOk: svg?.securityOk === true,
    unsafeFeatures: svg?.unsafeFeatures || [],
    ok: base.present && base.nonEmpty && base.sizeOk && base.bytesOk && base.checksumOk
      && dimensionsOk && titleOk && descriptionOk && accessibleNameOk
      && titleMatches && descriptionMatches && accessibleNameMatches
      && svg?.securityOk === true,
  };
}

function inspectFonts(textObjects, axesObjects, options) {
  const minimumFontSize = positiveNumber(options.minimumFontSize, 8);
  const objects = [...textObjects, ...axesObjects];
  const violations = [];
  const cjkViolations = [];
  objects.forEach((object, index) => {
    if (!nonEmptyString(object?.font_name)) violations.push(`${index}.font_name`);
    if (!positiveNumber(object?.font_size) || object.font_size < minimumFontSize) {
      violations.push(`${index}.font_size`);
    }
    const renderedText = [object?.string, object?.xlabel, object?.ylabel].filter(nonEmptyString).join(' ');
    if (containsCjk(renderedText) && !isCjkCapableFont(object?.font_name)) {
      cjkViolations.push(`${index}.font_name.cjk`);
    }
  });
  return {
    ok: objects.length > 0 && violations.length === 0 && cjkViolations.length === 0,
    cjkOk: cjkViolations.length === 0,
    minimumFontSize,
    violations: [...violations, ...cjkViolations],
    cjkViolations,
  };
}

function inspectTextObjects(textObjects) {
  const violations = [];
  textObjects.forEach((object, index) => {
    if (!nonEmptyString(object?.role)) violations.push(`${index}.role`);
    else if (hasUnsafeControlCharacters(object.role)) violations.push(`${index}.role.control_characters`);
    if (!nonEmptyString(object?.string)) violations.push(`${index}.string`);
    else if (hasUnsafeControlCharacters(object.string)) violations.push(`${index}.string.control_characters`);
  });
  return { ok: textObjects.length > 0 && violations.length === 0, violations };
}

function inspectAxes(axesObjects) {
  const violations = [];
  const ids = new Set();
  axesObjects.forEach((axis, index) => {
    if (!nonEmptyString(axis?.id)) violations.push(`${index}.id`);
    else if (ids.has(axis.id)) violations.push(`${index}.id.duplicate`);
    ids.add(axis?.id);
    if (!nonEmptyString(axis?.xlabel)) violations.push(`${index}.xlabel`);
    if (!nonEmptyString(axis?.ylabel)) violations.push(`${index}.ylabel`);
  });
  return { ok: axesObjects.length > 0 && violations.length === 0, violations };
}

function inspectClipping(objects, canvas) {
  const violations = [];
  const resolvedBounds = [];
  objects.forEach((object, index) => {
    if (object?.clipped !== false) violations.push(`${index}.clipped`);
    if (!validBounds(object?.bounds)) violations.push(`${index}.bounds`);
    else if (!canvas) violations.push(`${index}.canvas`);
    else {
      const resolved = resolveBounds(object.bounds, object.bounds_units || object.boundsUnits, canvas);
      resolvedBounds.push({ index, ...resolved });
      if (!resolved.supported) violations.push(`${index}.bounds_units.unsupported`);
      else if (!boundsInsideCanvas(resolved.bounds, canvas)) violations.push(`${index}.bounds.outside`);
    }
  });
  return {
    ok: objects.length > 0 && Boolean(canvas) && violations.length === 0,
    canvas,
    resolvedBounds,
    violations,
  };
}

function inspectAccessibility(accessibility, options) {
  const minimumContrastRatio = positiveNumber(options.minimumContrastRatio, 4.5);
  const violations = [];
  if (!nonEmptyString(accessibility?.alt_text)) violations.push('alt_text');
  if (!positiveNumber(accessibility?.contrast_ratio)
      || accessibility.contrast_ratio < minimumContrastRatio) violations.push('contrast_ratio');
  if (accessibility?.color_only_encoding !== false) violations.push('color_only_encoding');
  const foreground = parseColor(accessibility?.foreground_color || accessibility?.foreground);
  const background = parseColor(accessibility?.background_color || accessibility?.background);
  const actualContrastRatio = foreground && background ? contrastRatio(foreground, background) : undefined;
  if ((foreground && !background) || (!foreground && background)) violations.push('color_pair.incomplete');
  if (actualContrastRatio !== undefined && actualContrastRatio < minimumContrastRatio) {
    violations.push('color_pair.contrast_ratio');
  }
  if (actualContrastRatio !== undefined
      && Math.abs(actualContrastRatio - accessibility.contrast_ratio) > 0.15) {
    violations.push('contrast_ratio.mismatch');
  }
  return { ok: violations.length === 0, minimumContrastRatio, actualContrastRatio, violations };
}

function inspectPublicationContract(figure, options) {
  const contract = figure.publication || figure.publication_quality;
  const required = options.requirePublicationContract === true;
  if (!contract || typeof contract !== 'object') {
    return {
      present: false,
      required,
      status: required ? 'missing' : 'not_provided',
      ok: !required,
      violations: required ? ['contract.missing'] : [],
    };
  }
  const violations = [];
  const layout = contract.layout || {};
  const typography = contract.typography || contract.fonts || {};
  const color = contract.color || contract.colour || {};
  const minimumWidth = positiveInteger(options.minimumPublicationWidth, 1200);
  const minimumHeight = positiveInteger(options.minimumPublicationHeight, 675);
  const png = figure.exports?.png;
  if (!positiveNumber(png?.width) || png.width < minimumWidth) violations.push('layout.minimum_width');
  if (!positiveNumber(png?.height) || png.height < minimumHeight) violations.push('layout.minimum_height');
  if (layout.stable !== true) violations.push('layout.stable');
  if (layout.overlap_count !== 0) violations.push('layout.overlap_count');
  if (layout.clipped_count !== 0) violations.push('layout.clipped_count');
  if (!validMargins(layout.margins)) violations.push('layout.margins');
  if (typography.glyphs_verified !== true) violations.push('typography.glyphs_verified');
  if (figureContainsCjk(figure) && typography.cjk_verified !== true) {
    violations.push('typography.cjk_verified');
  }
  if (typography.pdf_fonts_embedded !== true) violations.push('typography.pdf_fonts_embedded');
  if (color.colorblind_safe !== true) violations.push('color.colorblind_safe');
  if (color.redundant_encoding !== true) violations.push('color.redundant_encoding');
  return {
    present: true,
    required,
    status: violations.length === 0 ? 'valid' : 'invalid',
    ok: violations.length === 0,
    minimumWidth,
    minimumHeight,
    violations,
  };
}

function inspectInteractionContract(figure, options) {
  const contract = figure.interaction || figure.interactive_contract;
  const required = options.requireInteractionContract === true;
  if (!contract || typeof contract !== 'object') {
    return {
      present: false,
      required,
      status: required ? 'missing' : 'not_provided',
      ok: !required,
      violations: required ? ['contract.missing'] : [],
    };
  }
  const violations = [];
  const requested = contract.requested === true;
  const enabled = contract.enabled === true;
  const desktopAvailable = contract.desktop_available === true || contract.desktopAvailable === true;
  const headless = contract.headless || contract.fallback || {};
  if (typeof contract.requested !== 'boolean') violations.push('requested');
  if (typeof contract.enabled !== 'boolean') violations.push('enabled');
  if (enabled && !desktopAvailable) violations.push('desktop.required_when_enabled');
  if (requested && desktopAvailable && !enabled) violations.push('desktop.requested_not_enabled');
  if (enabled) {
    if (contract.data_tips !== true) violations.push('data_tips');
    if (contract.brush_selection !== true) violations.push('brush_selection');
    if (contract.keyboard_accessible !== true) violations.push('keyboard_accessible');
    if (contract.observation_id_mapping !== true) violations.push('observation_id_mapping');
    if (contract.cleanup_verified !== true) violations.push('cleanup_verified');
  }
  if (requested && !desktopAvailable) {
    if (enabled) violations.push('headless.enabled');
    if (headless.supported !== true) violations.push('headless.supported');
    if (!['static_export', 'png_pdf', 'traditional_figure'].includes(normalizeStatus(headless.mode))) {
      violations.push('headless.mode');
    }
    if (headless.verified !== true) violations.push('headless.verified');
  }
  if (options.expectHeadless === true && desktopAvailable) violations.push('headless.desktop_available');
  if (options.expectHeadless === true && enabled) violations.push('headless.interaction_enabled');
  return {
    present: true,
    required,
    status: violations.length === 0 ? 'valid' : 'invalid',
    ok: violations.length === 0,
    requested,
    enabled,
    desktopAvailable,
    violations,
  };
}

function inspectScienceContract(figure, options) {
  const contract = figure.science || figure.data_contract || figure.science_contract
    || figure.scientific_data_contract || figure.scientific_metadata;
  const required = options.requireScienceContract === true;
  if (!contract || typeof contract !== 'object') {
    return {
      present: false,
      required,
      status: required ? 'missing' : 'not_provided',
      ok: !required,
      violations: required ? ['contract.missing'] : [],
    };
  }

  const violations = [];
  const dimensions = normalizeDimensionContract(contract);
  inspectDimensionContract(dimensions, contract, violations);
  inspectUnitContract(dimensions, contract, violations);
  inspectTimeZoneContract(dimensions, contract, violations);
  inspectMissingContract(dimensions, contract, violations);
  inspectQcContract(contract, violations);
  inspectUncertaintyContract(contract, violations);
  inspectCoordinateDirectionContract(dimensions, contract, violations);
  return {
    present: true,
    required,
    status: violations.length === 0 ? 'valid' : 'invalid',
    ok: violations.length === 0,
    violations,
    dimensions,
  };
}

function normalizeDimensionContract(contract) {
  const dimensionValue = contract.dimensions;
  let shape = firstArray(
    contract.shape,
    contract.sizes,
    dimensionValue?.shape,
    dimensionValue?.sizes,
    Array.isArray(dimensionValue) ? dimensionValue : undefined,
  );
  let order = stringList(firstPresent(
    contract.dimension_order,
    contract.dimensionOrder,
    contract.dimension_names,
    dimensionValue?.order,
    dimensionValue?.dimension_order,
    dimensionValue?.names,
  ));
  if (!shape && dimensionValue && typeof dimensionValue === 'object' && !Array.isArray(dimensionValue)) {
    const entries = Object.entries(dimensionValue).filter(([, value]) => positiveInteger(value));
    if (entries.length > 0) {
      order = order.length > 0 ? order : entries.map(([name]) => name);
      shape = entries.map(([, value]) => value);
    }
  }
  return { shape: normalizeShape(shape), order };
}

function inspectDimensionContract(dimensions, contract, violations) {
  const { shape, order } = dimensions;
  if (!shape || shape.length === 0) violations.push('dimensions.shape');
  if (order.length === 0) violations.push('dimensions.order');
  if (shape && order.length > 0 && shape.length !== order.length) {
    violations.push('dimensions.shape_order_length');
  }
  if (new Set(order).size !== order.length) violations.push('dimensions.order_duplicate');
  const coordinates = normalizeScienceCoordinates(contract, dimensions);
  for (const [index, name] of order.entries()) {
    const coordinate = coordinates[name];
    if (!coordinate) {
      violations.push(`coordinates.${name}.missing`);
      continue;
    }
    const count = coordinateCount(coordinate);
    if (shape?.[index] && count !== undefined && count !== shape[index]) {
      violations.push(`coordinates.${name}.length`);
    }
    const values = coordinate.values || coordinate.data;
    if (values !== undefined && !validCoordinateValues(values)) {
      violations.push(`coordinates.${name}.values`);
    }
    if (values !== undefined && numericValues(values)) {
      const numeric = values.map(Number);
      if (name.toLowerCase() === 'depth' && numeric.some((value) => value < 0)) {
        violations.push('coordinates.depth.nonnegative');
      }
      const direction = normalizeDirection(coordinate.direction || directionMap(contract)[name]);
      if (directionIsIncreasing(direction) && !strictlyIncreasing(numeric)) {
        violations.push(`coordinates.${name}.order`);
      }
      if (directionIsDecreasing(direction) && !strictlyDecreasing(numeric)) {
        violations.push(`coordinates.${name}.order`);
      }
    } else if (values !== undefined && /^(time|datetime|timestamp)$/iu.test(name)) {
      const timestamps = values.map((value) => Date.parse(value));
      if (timestamps.some((value) => !Number.isFinite(value))) {
        violations.push(`coordinates.${name}.datetime`);
      } else {
        const direction = normalizeDirection(coordinate.direction || directionMap(contract)[name]);
        if (directionIsIncreasing(direction) && !strictlyIncreasing(timestamps)) {
          violations.push(`coordinates.${name}.order`);
        }
        if (directionIsDecreasing(direction) && !strictlyDecreasing(timestamps)) {
          violations.push(`coordinates.${name}.order`);
        }
      }
    }
  }
}

function inspectUnitContract(dimensions, contract, violations) {
  const units = normalizeNamedValues(contract.units);
  const coordinates = normalizeScienceCoordinates(contract, dimensions);
  for (const name of dimensions.order) {
    const unit = coordinates[name]?.unit || units[name];
    if (!nonEmptyString(unit)) violations.push(`units.${name}`);
  }
  const valueUnit = units.value || units.variable || contract.value_unit
    || contract.variable?.unit || contract.value?.unit;
  if (!nonEmptyString(valueUnit)) violations.push('units.value');
}

function inspectTimeZoneContract(dimensions, contract, violations) {
  const timeNames = dimensions.order.filter((name) => /^(time|datetime|timestamp)$/iu.test(name));
  const coordinates = normalizeScienceCoordinates(contract, dimensions);
  const declared = contract.timezone || contract.time_zone || contract.timeZone
    || contract.time?.timezone || contract.time?.time_zone || contract.coordinates?.timeZone
    || contract.coordinates?.timezone || coordinates.time?.timezone;
  if (timeNames.length === 0) {
    if (declared !== undefined && !nonEmptyString(declared)) violations.push('time_zone.invalid');
    return;
  }
  if (!nonEmptyString(declared)) {
    violations.push('time_zone.missing');
    return;
  }
  if (!validTimeZone(declared)) violations.push('time_zone.invalid');
  const coordinateTimeZone = coordinates.time?.timezone || coordinates.time?.time_zone;
  if (coordinateTimeZone && coordinateTimeZone !== declared) violations.push('time_zone.mismatch');
}

function inspectMissingContract(dimensions, contract, violations) {
  const missing = normalizeStatusObject(contract.missing || contract.missingness);
  if (!missing) {
    violations.push('missing.status');
    return;
  }
  const status = normalizeStatus(missing.status || missing.policy);
  const policy = normalizeStatus(missing.policy || missing.action);
  const allowedStatuses = new Set(['present', 'preserve', 'mask', 'explicit_mask', 'reject', 'none', 'absent', 'not_applicable']);
  if (!allowedStatuses.has(status)) violations.push('missing.policy');
  if (status === 'present' && !policy) violations.push('missing.policy');
  if (policy && !allowedStatuses.has(policy)) violations.push('missing.policy');
  if (['fill', 'interpolate', 'smooth', 'replace', 'zero'].includes(status)
      || ['fill', 'interpolate', 'smooth', 'replace', 'zero'].includes(policy)) {
    violations.push('missing.silent_transform');
  }
  const counts = missing.counts && typeof missing.counts === 'object' ? missing.counts : missing;
  inspectNonnegativeCounts(counts, 'missing', violations);
  const total = countValue(counts, ['total_count', 'total', 'sample_count']);
  const valid = countValue(counts, ['valid_count', 'valid']);
  const missingCount = countValue(counts, ['missing_count', 'missing']);
  const masked = countValue(counts, ['masked_count', 'masked']);
  if (total !== undefined && dimensions.shape) {
    const product = dimensions.shape.reduce((result, value) => result * value, 1);
    if (total !== product) violations.push('missing.total_shape_mismatch');
  }
  if (total !== undefined && valid !== undefined && missingCount !== undefined
      && masked !== undefined && valid + missingCount + masked > total) {
    violations.push('missing.counts_sum');
  }
  if (missingCount > 0 && !nonEmptyString(missing.mask || missing.representation)) {
    violations.push('missing.representation');
  }
}

function inspectQcContract(contract, violations) {
  const qc = normalizeStatusObject(contract.qc || contract.quality_control || contract.qualityControl);
  if (!qc) {
    violations.push('qc.status');
    return;
  }
  const status = normalizeStatus(qc.status || (qc.field ? 'applied' : ''));
  if (!['applied', 'present', 'absent', 'none', 'not_applicable'].includes(status)) {
    violations.push('qc.status');
  }
  if (['applied', 'present'].includes(status)) {
    if (!nonEmptyString(qc.field || qc.variable || qc.name)) violations.push('qc.field');
    if (!nonEmptyString(qc.policy || qc.rule || qc.accepted_policy || qc.action)) violations.push('qc.policy');
  }
  inspectNonnegativeCounts(qc.counts || qc, 'qc', violations);
}

function inspectUncertaintyContract(contract, violations) {
  const uncertainty = normalizeStatusObject(contract.uncertainty || contract.uncertainties);
  if (!uncertainty) {
    violations.push('uncertainty.status');
    return;
  }
  const status = normalizeStatus(uncertainty.status || (uncertainty.present ? 'present' : ''));
  if (!['present', 'applied', 'absent', 'none', 'not_applicable'].includes(status)) {
    violations.push('uncertainty.status');
  }
  if (['present', 'applied'].includes(status)) {
    if (!nonEmptyString(uncertainty.type || uncertainty.method)) violations.push('uncertainty.type');
    if (!nonEmptyString(uncertainty.unit)) violations.push('uncertainty.unit');
    if (!nonEmptyString(uncertainty.alignment)) violations.push('uncertainty.alignment');
    const representation = normalizeStatus(uncertainty.representation || uncertainty.form);
    const hasBounds = Array.isArray(uncertainty.bounds) && uncertainty.bounds.length === 2;
    const hasNamedBounds = nonEmptyString(uncertainty.lower) && nonEmptyString(uncertainty.upper);
    if (representation === 'bounds' && !hasBounds && !hasNamedBounds) {
      violations.push('uncertainty.bounds');
    }
    if (representation && !['magnitude', 'bounds'].includes(representation)) violations.push('uncertainty.representation');
    const confidenceLevel = uncertainty.confidenceLevel ?? uncertainty.confidence_level;
    if (/confidence/iu.test(String(uncertainty.type || uncertainty.method))
        && (!(Number(confidenceLevel) > 0) || !(Number(confidenceLevel) < 1))) {
      violations.push('uncertainty.confidence_level');
    }
  }
}

function inspectCoordinateDirectionContract(dimensions, contract, violations) {
  const coordinates = normalizeScienceCoordinates(contract, dimensions);
  const directions = directionMap(contract);
  for (const name of dimensions.order) {
    const direction = normalizeDirection(coordinates[name]?.direction || directions[name]);
    if (!direction) {
      if (!isCanonicalScientificContract(contract) || requiresCanonicalDirection(name)) {
        violations.push(`coordinates.${name}.direction`);
      }
      continue;
    }
    if (!allowedDirection(direction)) violations.push(`coordinates.${name}.direction.invalid`);
    if (/depth|pressure/iu.test(name) && !['positive_down', 'down'].includes(direction)) {
      violations.push(`coordinates.${name}.direction.positive_down`);
    }
  }
}

function inspectNonnegativeCounts(value, prefix, violations) {
  if (!value || typeof value !== 'object') return;
  for (const [name, count] of Object.entries(value)) {
    if (/(?:count|total|valid|missing|masked|suspect|good|bad)$/iu.test(name)
        && count !== undefined && (!Number.isInteger(count) || count < 0)) {
      violations.push(`${prefix}.${name}.nonnegative_integer`);
    }
  }
}

function normalizeStatusObject(value) {
  if (typeof value === 'string') return { status: value };
  return value && typeof value === 'object' ? value : undefined;
}

function normalizeShape(value) {
  const shape = Array.isArray(value) ? value.map(Number) : undefined;
  return shape && shape.length > 0 && shape.every((entry) => positiveInteger(entry)) ? shape : undefined;
}

function normalizeNamedValues(value) {
  if (Array.isArray(value)) {
    return Object.fromEntries(value.filter((entry) => nonEmptyString(entry?.name))
      .map((entry) => [entry.name, entry.value ?? entry.unit ?? entry]));
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeNamedObjects(value) {
  if (Array.isArray(value)) {
    return Object.fromEntries(value.filter((entry) => nonEmptyString(entry?.name)).map((entry) => [entry.name, entry]));
  }
  return normalizeNamedValues(value);
}

function normalizeScienceCoordinates(contract, dimensions) {
  const source = contract.coordinates;
  if (!Array.isArray(source?.names)) return normalizeNamedObjects(source);
  const units = normalizeNamedValues(contract.units);
  const directions = directionMap(contract);
  const coordinates = {};
  for (const [index, name] of source.names.entries()) {
    const lowerName = String(name).toLowerCase();
    const vertical = source.vertical || {};
    const verticalDirection = ['depth', 'pressure', 'height', 'elevation'].includes(lowerName)
      ? vertical.positive
      : undefined;
    coordinates[name] = {
      count: dimensions.shape?.[dimensions.order.indexOf(name)] ?? dimensions.shape?.[index],
      unit: units[name] || (/^(time|datetime|timestamp)$/iu.test(name) ? contract.dataType : undefined),
      timezone: /^(time|datetime|timestamp)$/iu.test(name) ? (source.timeZone || source.timezone) : undefined,
      direction: directions[name] || verticalDirection,
    };
  }
  return coordinates;
}

function firstArray(...values) {
  return values.find((value) => Array.isArray(value)) || undefined;
}

function firstPresent(...values) {
  return values.find((value) => Array.isArray(value) || nonEmptyString(value));
}

function stringList(value) {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter(nonEmptyString) : [];
}

function coordinateCount(coordinate) {
  if (positiveInteger(coordinate?.count)) return coordinate.count;
  const values = coordinate?.values || coordinate?.data;
  return Array.isArray(values) ? values.length : undefined;
}

function validCoordinateValues(values) {
  if (!Array.isArray(values) || values.length === 0) return false;
  return values.every((value) => (typeof value === 'number' ? Number.isFinite(value) : nonEmptyString(value)));
}

function numericValues(values) {
  return Array.isArray(values) && values.length > 0 && values.every((value) => typeof value === 'number' && Number.isFinite(value));
}

function directionMap(contract) {
  return normalizeNamedValues(contract.coordinate_direction || contract.coordinate_directions
    || contract.directions || contract.coordinateDirection || contract.coordinates?.directions);
}

function normalizeDirection(value) {
  const direction = nonEmptyString(value) ? value.toLowerCase().trim().replace(/[\s-]+/gu, '_') : '';
  if (direction === 'strictly_increasing') return 'increasing';
  if (direction === 'strictly_decreasing') return 'decreasing';
  return direction;
}

function isCanonicalScientificContract(contract) {
  return positiveInteger(contract?.schemaVersion) && Array.isArray(contract?.coordinates?.names);
}

function requiresCanonicalDirection(name) {
  return /^(time|datetime|timestamp|latitude|longitude|depth|pressure|height|elevation)$/iu.test(name);
}

function allowedDirection(direction) {
  return new Set([
    'positive_down', 'positive_up', 'down', 'up', 'increasing', 'decreasing',
    'ascending', 'descending', 'eastward', 'westward', 'northward', 'southward',
    '0_to_360', '-180_to_180', 'from', 'to', 'clockwise_from_true_north',
  ]).has(direction);
}

function directionIsIncreasing(direction) {
  return ['positive_down', 'down', 'increasing', 'ascending', 'eastward', 'northward'].includes(direction);
}

function directionIsDecreasing(direction) {
  return ['positive_up', 'up', 'decreasing', 'descending', 'westward', 'southward'].includes(direction);
}

function strictlyIncreasing(values) {
  return values.every((value, index) => index === 0 || value > values[index - 1]);
}

function strictlyDecreasing(values) {
  return values.every((value, index) => index === 0 || value < values[index - 1]);
}

function countValue(value, names) {
  for (const name of names) {
    if (Number.isInteger(value?.[name]) && value[name] >= 0) return value[name];
  }
  return undefined;
}

function normalizeStatus(value) {
  return normalizeDirection(value);
}

function validTimeZone(value) {
  if (!nonEmptyString(value)) return false;
  if (/^(?:UTC|GMT|Z|[+-]\d{2}:?\d{2})$/iu.test(value)) return true;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function comparePng(candidate, baselinePath, options) {
  if (!baselinePath || !existsSync(baselinePath)) {
    return { ok: false, available: false, reason: 'baseline_not_found' };
  }
  const maximumBytes = maximumArtifactBytes('png', options);
  if (inspectFile(baselinePath).bytes > maximumBytes) {
    return { ok: false, available: false, reason: 'artifact_size_limit_exceeded' };
  }
  try {
    const channelThreshold = boundedOption(
      options.pixelChannelThreshold,
      0,
      0,
      255,
      'invalid_pixel_channel_threshold',
    );
    const ratioThreshold = boundedOption(
      options.pixelDiffRatioThreshold,
      0,
      0,
      1,
      'invalid_pixel_diff_ratio_threshold',
    );
    if (!candidate?.ok) throw new Error(candidate?.reason || 'invalid_png_structure');
    const baseline = inspectPngStructure(baselinePath, options);
    if (!baseline.ok) throw new Error(baseline.reason);
    if (candidate.width !== baseline.width || candidate.height !== baseline.height) {
      return { ok: false, available: true, reason: 'dimensions_mismatch', differingPixels: null, ratio: 1 };
    }
    const candidatePixels = decodePng(candidate);
    const baselinePixels = decodePng(baseline);
    let differingPixels = 0;
    let maximumChannelDelta = 0;
    let totalAbsoluteDelta = 0;
    for (let offset = 0; offset < candidatePixels.length; offset += 4) {
      let pixelDiffers = false;
      for (let channel = 0; channel < 4; channel += 1) {
        const delta = Math.abs(candidatePixels[offset + channel] - baselinePixels[offset + channel]);
        maximumChannelDelta = Math.max(maximumChannelDelta, delta);
        totalAbsoluteDelta += delta;
        if (delta > channelThreshold) pixelDiffers = true;
      }
      if (pixelDiffers) differingPixels += 1;
    }
    const pixelCount = candidate.width * candidate.height;
    const ratio = differingPixels / pixelCount;
    return {
      ok: ratio <= ratioThreshold,
      available: true,
      pixelCount,
      differingPixels,
      ratio,
      meanAbsoluteChannelDelta: totalAbsoluteDelta / (pixelCount * 4),
      maximumChannelDelta,
      channelThreshold,
      ratioThreshold,
    };
  } catch (error) {
    return { ok: false, available: true, reason: error.message };
  }
}

function decodePng(parsed) {
  const {
    width, height, bitDepth, colorType, interlace, idatChunks,
  } = parsed;
  if (bitDepth !== 8) throw new Error('unsupported_png_header');
  if (![0, 2, 4, 6].includes(colorType) || interlace !== 0) {
    throw new Error('unsupported_png_color_or_interlace');
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  const stride = width * channels;
  const expectedBytes = height * (stride + 1);
  if (!Number.isSafeInteger(expectedBytes)) throw new Error('png_size_overflow');
  const raw = zlib.inflateSync(Buffer.concat(idatChunks), { maxOutputLength: expectedBytes });
  if (raw.length !== expectedBytes) throw new Error('invalid_png_scanline_length');
  const pixels = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  let sourceOffset = 0;
  for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
    const filter = raw[sourceOffset];
    sourceOffset += 1;
    const row = Buffer.alloc(stride);
    for (let byteIndex = 0; byteIndex < stride; byteIndex += 1) {
      const left = byteIndex >= channels ? row[byteIndex - channels] : 0;
      const up = previous[byteIndex];
      const upperLeft = byteIndex >= channels ? previous[byteIndex - channels] : 0;
      const filtered = raw[sourceOffset];
      sourceOffset += 1;
      row[byteIndex] = unfilterByte(filter, filtered, left, up, upperLeft);
    }
    writeRgbaRow(pixels, row, rowIndex, width, colorType, channels);
    previous = row;
  }
  return pixels;
}

function parsePngStructure(data, options = {}) {
  if (!data.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('invalid_png_signature');
  let offset = 8;
  const idatChunks = [];
  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
  let embeddedDpiX;
  let embeddedDpiY;
  let chunkIndex = 0;
  let sawPhysicalDimensions = false;
  let sawImageData = false;
  let imageDataEnded = false;
  let sawEnd = false;
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > data.length) throw new Error('invalid_png_chunk_length');
    const type = data.toString('ascii', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/u.test(type) || /[a-z]/u.test(type[2])) {
      throw new Error('invalid_png_chunk_type');
    }
    if (chunkIndex === 0 && type !== 'IHDR') throw new Error('invalid_png_chunk_order');
    if (/^[A-Z]/u.test(type) && !['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type)) {
      throw new Error('unsupported_png_critical_chunk');
    }
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = data.readUInt32BE(offset + 8 + length);
    const actualCrc = pngCrc32(data.subarray(offset + 4, offset + 8 + length));
    if (expectedCrc !== actualCrc) throw new Error('invalid_png_crc');
    offset = chunkEnd;
    if (type === 'IHDR') {
      if (length !== 13 || width !== undefined) throw new Error('invalid_png_header');
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
      interlace = chunk[12];
    } else if (type === 'pHYs') {
      if (length !== 9 || sawPhysicalDimensions || sawImageData) {
        throw new Error('invalid_png_physical_dimensions');
      }
      sawPhysicalDimensions = true;
      if (chunk[8] === 1) {
        embeddedDpiX = chunk.readUInt32BE(0) * 0.0254;
        embeddedDpiY = chunk.readUInt32BE(4) * 0.0254;
      }
    } else if (type === 'tRNS') {
      throw new Error('unsupported_png_transparency');
    } else if (type === 'IDAT') {
      if (imageDataEnded) throw new Error('invalid_png_chunk_order');
      sawImageData = true;
      idatChunks.push(chunk);
    }
    else if (type === 'IEND') {
      if (length !== 0) throw new Error('invalid_png_end');
      sawEnd = true;
      break;
    } else if (sawImageData) {
      imageDataEnded = true;
    }
    chunkIndex += 1;
  }
  if (!positiveInteger(width) || !positiveInteger(height) || bitDepth !== 8) {
    throw new Error('unsupported_png_header');
  }
  if (!sawEnd || idatChunks.length === 0) throw new Error('invalid_png_structure');
  if (offset !== data.length) throw new Error('invalid_png_trailing_data');
  const pixelCount = width * height;
  const maximumPixels = boundedOption(
    options.maximumPngPixels,
    25_000_000,
    1,
    40_000_000,
    'invalid_maximum_png_pixels',
  );
  if (!Number.isSafeInteger(pixelCount) || pixelCount > maximumPixels) {
    throw new Error('png_pixel_limit_exceeded');
  }
  return {
    width,
    height,
    bitDepth,
    colorType,
    interlace,
    embeddedDpiX,
    embeddedDpiY,
    idatChunks,
  };
}

function unfilterByte(filter, value, left, up, upperLeft) {
  if (filter === 0) return value;
  if (filter === 1) return (value + left) & 255;
  if (filter === 2) return (value + up) & 255;
  if (filter === 3) return (value + Math.floor((left + up) / 2)) & 255;
  if (filter === 4) return (value + paeth(left, up, upperLeft)) & 255;
  throw new Error(`unsupported_png_filter_${filter}`);
}

function writeRgbaRow(pixels, row, rowIndex, width, colorType, channels) {
  for (let column = 0; column < width; column += 1) {
    const source = column * channels;
    const target = (rowIndex * width + column) * 4;
    if (colorType === 0 || colorType === 4) {
      pixels[target] = row[source];
      pixels[target + 1] = row[source];
      pixels[target + 2] = row[source];
      pixels[target + 3] = colorType === 4 ? row[source + 1] : 255;
    } else {
      pixels[target] = row[source];
      pixels[target + 1] = row[source + 1];
      pixels[target + 2] = row[source + 2];
      pixels[target + 3] = colorType === 6 ? row[source + 3] : 255;
    }
  }
}

function paeth(left, up, upperLeft) {
  const prediction = left + up - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function inspectPngStructure(filePath, options) {
  try {
    return { ok: true, ...parsePngStructure(readFileSync(filePath), options) };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

function pngCrc32(data) {
  let checksum = 0xffffffff;
  for (const byte of data) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ (0xedb88320 & -(checksum & 1));
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function inspectPdf(filePath) {
  try {
    const text = readFileSync(filePath, 'latin1');
    if (!text.startsWith('%PDF-') || !/%%EOF\s*$/u.test(text)) return { pages: 0, pageSizes: [] };
    const structure = text
      .replace(/\bstream\r?\n[\s\S]*?\bendstream\b/gu, '')
      .replace(/^%[^\r\n]*/gmu, '');
    const objects = [...structure.matchAll(/\b\d+\s+\d+\s+obj\b([\s\S]*?)\bendobj\b/gu)]
      .map((match) => match[1]);
    const pageObjects = objects.filter((object) => /\/Type\s*\/Page\b/gu.test(object));
    const pages = pageObjects.length;
    const pageMediaBoxes = pageObjects.map(pdfMediaBox).filter(Boolean);
    const inheritedMediaBoxes = objects.map(pdfMediaBox).filter(Boolean);
    const pageSizes = pageMediaBoxes.length === pages
      ? pageMediaBoxes
      : (inheritedMediaBoxes.length === 1 && pages > 0
        ? Array.from({ length: pages }, () => inheritedMediaBoxes[0])
        : inheritedMediaBoxes.slice(0, pages));
    return { pages, pageSizes };
  } catch {
    return { pages: 0, pageSizes: [] };
  }
}

function pdfMediaBox(value) {
  const match = value.match(/\/MediaBox\s*\[\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\]/u);
  if (!match) return undefined;
  return {
    width: Math.abs(Number(match[3]) - Number(match[1])),
    height: Math.abs(Number(match[4]) - Number(match[2])),
  };
}

function inspectSvg(filePath) {
  try {
    const text = readFileSync(filePath, 'utf8');
    const source = text.replace(/<!--[\s\S]*?-->/gu, '');
    const roots = [...source.matchAll(/<svg\b([^>]*)>/giu)];
    const closingRoots = [...source.matchAll(/<\/svg\s*>/giu)];
    const root = roots[0];
    if (!root) return undefined;
    const width = svgLength(root[1], 'width');
    const height = svgLength(root[1], 'height');
    const viewBox = root[1].match(/\bviewBox\s*=\s*["']\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*["']/iu);
    const resolvedWidth = width ?? (viewBox ? Number(viewBox[3]) : undefined);
    const resolvedHeight = height ?? (viewBox ? Number(viewBox[4]) : undefined);
    const title = svgElementText(source, 'title');
    const description = svgElementText(source, 'desc');
    const ariaLabel = svgAttribute(root[1], 'aria-label');
    const labelledBy = svgAttribute(root[1], 'aria-labelledby');
    const labelledText = labelledBy
      ? labelledBy.split(/\s+/u).map((id) => svgTextById(source, id)).filter(nonEmptyString).join(' ')
      : '';
    const roleIsImage = normalizeStatus(svgAttribute(root[1], 'role')) === 'img';
    const accessibleName = normalizeSvgText(ariaLabel || labelledText || (roleIsImage ? title : ''));
    const unsafeFeatures = [];
    if (roots.length !== 1) unsafeFeatures.push('multiple_roots');
    if (closingRoots.length !== 1) unsafeFeatures.push('invalid_root_closure');
    if (root && closingRoots.length === 1) {
      const prefix = source.slice(0, root.index).replace(/^\s*<\?xml\b[^?]*\?>/iu, '').trim();
      const suffix = source.slice(closingRoots[0].index + closingRoots[0][0].length).trim();
      if (prefix || suffix) unsafeFeatures.push('content_outside_root');
    }
    if (/<!DOCTYPE\b|<!ENTITY\b/iu.test(source)) unsafeFeatures.push('doctype_or_entity');
    if (/<(?:script|foreignObject|iframe|object|embed)\b/iu.test(source)) unsafeFeatures.push('script');
    if (/\son[a-z]+\s*=/iu.test(source)) unsafeFeatures.push('event_handler');
    if (/\b(?:href|xlink:href)\s*=\s*["']\s*(?:javascript:|https?:|file:|\/\/)/iu.test(source)) {
      unsafeFeatures.push('external_reference');
    }
    if (/@import\b|url\(\s*["']?\s*(?:javascript:|https?:|file:|\/\/)/iu.test(source)) {
      unsafeFeatures.push('external_css_reference');
    }
    if (labelledBy) {
      const requestedIds = labelledBy.split(/\s+/u).filter(Boolean);
      if (requestedIds.length === 0 || requestedIds.some((id) => !nonEmptyString(svgTextById(source, id)))) {
        unsafeFeatures.push('invalid_aria_labelledby');
      }
    }
    return {
      width: resolvedWidth,
      height: resolvedHeight,
      title,
      description,
      accessibleName,
      unsafeFeatures,
      securityOk: unsafeFeatures.length === 0,
    };
  } catch {
    return undefined;
  }
}

function svgElementText(source, tagName) {
  const match = source.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'iu'));
  return normalizeSvgText(match?.[1]);
}

function svgTextById(source, id) {
  const escapedId = escapeRegExp(id);
  const match = source.match(new RegExp(`<([A-Za-z][\\w:.-]*)\\b[^>]*\\bid\\s*=\\s*["']${escapedId}["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'iu'));
  return normalizeSvgText(match?.[2]);
}

function svgAttribute(attributes, name) {
  return attributes.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'iu'))?.[1] || '';
}

function normalizeSvgText(value) {
  if (!nonEmptyString(value)) return '';
  return value.replace(/<[^>]*>/gu, ' ')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/\s+/gu, ' ')
    .trim();
}

function svgLength(attributes, name) {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*["'](\\d+(?:\\.\\d+)?)(?:px|pt)?["']`, 'iu'));
  return match ? Number(match[1]) : undefined;
}

function figureCanvas(figure) {
  const png = figure.exports?.png;
  if (positiveNumber(png?.width) && positiveNumber(png?.height)) {
    return { width: png.width, height: png.height, dpi: positiveNumber(png.dpi, 72) };
  }
  const svg = figure.exports?.svg;
  if (positiveNumber(svg?.width) && positiveNumber(svg?.height)) {
    return { width: svg.width, height: svg.height };
  }
  return undefined;
}

function validBounds(bounds) {
  return Array.isArray(bounds) && bounds.length === 4
    && bounds.every((value) => Number.isFinite(value))
    && bounds[2] > 0 && bounds[3] > 0;
}

function boundsInsideCanvas(bounds, canvas) {
  if (!canvas) return false;
  const [x, y, width, height] = bounds;
  return x >= 0 && y >= 0 && x + width <= canvas.width && y + height <= canvas.height;
}

function resolveBounds(bounds, declaredUnits, canvas) {
  const units = normalizeStatus(declaredUnits) || inferBoundsUnits(bounds);
  if (units === 'pixels' || units === 'pixel' || units === 'px') {
    return { supported: true, units: 'pixels', inferred: !declaredUnits, bounds };
  }
  if (units === 'normalized' || units === 'normalised') {
    return {
      supported: true,
      units: 'normalized',
      inferred: !declaredUnits,
      bounds: [bounds[0] * canvas.width, bounds[1] * canvas.height,
        bounds[2] * canvas.width, bounds[3] * canvas.height],
    };
  }
  if (units === 'points' || units === 'point' || units === 'pt') {
    const scale = canvas.dpi / 72;
    return { supported: true, units: 'points', inferred: false, bounds: bounds.map((value) => value * scale) };
  }
  if (units === 'inches' || units === 'inch' || units === 'in') {
    return { supported: true, units: 'inches', inferred: false, bounds: bounds.map((value) => value * canvas.dpi) };
  }
  return { supported: false, units, inferred: !declaredUnits, bounds };
}

function inferBoundsUnits(bounds) {
  return bounds.every((value) => value >= 0 && value <= 1)
    && bounds[0] + bounds[2] <= 1 && bounds[1] + bounds[3] <= 1
    ? 'normalized'
    : 'pixels';
}

function containsCjk(value) {
  return nonEmptyString(value) && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(value);
}

function isCjkCapableFont(value) {
  return nonEmptyString(value) && /(?:Noto\s+(?:Sans|Serif)\s+CJK|Source\s+Han\s+(?:Sans|Serif)|YaHei|PingFang|SimHei|SimSun|Heiti|Songti|Arial\s+Unicode)/iu.test(value);
}

function figureContainsCjk(figure) {
  return [...objectList(figure.text_objects), ...objectList(figure.axes_objects)]
    .some((object) => containsCjk([object.string, object.xlabel, object.ylabel].filter(nonEmptyString).join(' ')));
}

function validMargins(value) {
  return Array.isArray(value) && value.length === 4
    && value.every((margin) => Number.isFinite(margin) && margin >= 0);
}

function parseColor(value) {
  if (Array.isArray(value) && value.length === 3
      && value.every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 1)) {
    return value;
  }
  if (!nonEmptyString(value)) return undefined;
  const hex = value.trim().match(/^#?([a-f\d]{6})$/iu)?.[1];
  if (!hex) return undefined;
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
}

function contrastRatio(foreground, background) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

function relativeLuminance(color) {
  const linear = color.map((channel) => (channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function minimumArtifactBytes(format, options) {
  if (format === 'png') return positiveInteger(options.minimumPngBytes, 100);
  if (format === 'pdf') return positiveInteger(options.minimumPdfBytes, 100);
  return positiveInteger(options.minimumSvgBytes, 50);
}

function maximumArtifactBytes(format, options) {
  if (format === 'svg') return Math.min(positiveInteger(options.maximumSvgBytes, 32 * 1024 * 1024), 64 * 1024 * 1024);
  if (format === 'pdf') return Math.min(positiveInteger(options.maximumPdfBytes, 256 * 1024 * 1024), 512 * 1024 * 1024);
  return Math.min(positiveInteger(options.maximumPngBytes, 256 * 1024 * 1024), 512 * 1024 * 1024);
}

function inspectFile(filePath) {
  if (!filePath) return { present: false, bytes: 0, mtimeMs: 0 };
  try {
    const info = statSync(filePath);
    return {
      present: info.isFile(),
      bytes: info.isFile() ? info.size : 0,
      mtimeMs: info.isFile() ? info.mtimeMs : 0,
    };
  } catch {
    return { present: false, bytes: 0, mtimeMs: 0 };
  }
}

function inspectRegressionManifestFreshness({ manifest, manifestPath, outputDirectory, figures, toleranceMs }) {
  const violations = [];
  const generatedAtMs = Date.parse(String(manifest?.generated_at || ''));
  const manifestInfo = inspectFile(manifestPath);
  const artifactPaths = [...new Set(figures.flatMap((figure) => (
    Object.values(figure.exports || {}).map((artifact) => resolveArtifactPath(artifact?.file, outputDirectory))
  )).filter(nonEmptyString))];
  const artifacts = artifactPaths.map((file) => ({ file, ...inspectFile(file) }));
  if (!Number.isFinite(generatedAtMs)) violations.push('freshness.generated_at.invalid');
  if (!manifestInfo.present) violations.push('freshness.manifest.missing');
  if (Number.isFinite(generatedAtMs) && generatedAtMs > Date.now() + toleranceMs) {
    violations.push('freshness.generated_at.future');
  }
  if (manifestInfo.present && Number.isFinite(generatedAtMs)
      && generatedAtMs > manifestInfo.mtimeMs + toleranceMs) {
    violations.push('freshness.generated_at.after_manifest_file');
  }
  artifacts.forEach((artifact, index) => {
    if (!artifact.present) return;
    if (Number.isFinite(generatedAtMs) && artifact.mtimeMs > generatedAtMs + toleranceMs) {
      violations.push(`freshness.artifacts[${index}].newer_than_generated_at`);
    }
    if (manifestInfo.present && artifact.mtimeMs > manifestInfo.mtimeMs + toleranceMs) {
      violations.push(`freshness.artifacts[${index}].newer_than_manifest`);
    }
  });
  return {
    ok: violations.length === 0 && artifacts.length > 0,
    generatedAt: Number.isFinite(generatedAtMs) ? new Date(generatedAtMs).toISOString() : undefined,
    manifestMtime: manifestInfo.present ? new Date(manifestInfo.mtimeMs).toISOString() : undefined,
    artifacts,
    violations,
  };
}

function sha256(filePath) {
  try {
    return createHash('sha256').update(readFileSync(filePath)).digest('hex');
  } catch {
    return '';
  }
}

function declaredExportApi(runtime, manifest, artifact, format) {
  const strategies = firstObject(runtime.export_strategies, runtime.exportStrategies,
    manifest.export_strategies, manifest.exportStrategies) || {};
  const strategy = strategies[format];
  const headless = firstObject(runtime.headless, manifest.headless) || {};
  return normalizeStatus(firstString(
    artifact.export_api,
    artifact.exportApi,
    artifact.api,
    typeof strategy === 'string' ? strategy : undefined,
    strategy?.api,
    strategy?.export_api,
    runtime.export_api,
    runtime.exportApi,
    headless.export_api,
    headless.exportApi,
  ));
}

function toolboxList(value) {
  const entries = Array.isArray(value) ? value : (value === undefined || value === null ? [] : [value]);
  return entries.map((entry) => {
    if (nonEmptyString(entry)) return entry.trim();
    if (!entry || typeof entry !== 'object') return '';
    return firstString(entry.id, entry.name, entry.Name, entry.product, entry.display_name) || '';
  }).filter(nonEmptyString);
}

function normalizeToolboxId(value) {
  const normalized = normalizeStatus(value);
  const compact = normalized.replaceAll('_', '');
  const aliases = {
    matlab: 'matlab',
    signal: 'signal',
    signalprocessing: 'signal',
    signalprocessingtoolbox: 'signal',
    statistics: 'statistics',
    statisticsandmachinelearning: 'statistics',
    statisticsandmachinelearningtoolbox: 'statistics',
    mapping: 'mapping',
    mappingtoolbox: 'mapping',
    image: 'image',
    imageprocessing: 'image',
    imageprocessingtoolbox: 'image',
  };
  return aliases[compact] || normalized.replace(/_toolbox$/u, '');
}

function runtimeErrors(value) {
  if (Array.isArray(value)) return value.filter((entry) => entry !== null && entry !== undefined);
  if (nonEmptyString(value)) return [value];
  if (value && typeof value === 'object' && Object.keys(value).length > 0) return [value];
  return [];
}

function firstRuntimeError(value) {
  const error = runtimeErrors(value)[0];
  if (nonEmptyString(error)) return error;
  return firstString(error?.code, error?.identifier, error?.message);
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function firstBoolean(...values) {
  return values.find((value) => typeof value === 'boolean');
}

function firstString(...values) {
  return values.find(nonEmptyString)?.trim();
}

function firstObject(...values) {
  return values.find((value) => value && typeof value === 'object' && !Array.isArray(value));
}

function canonicalMatlabRelease(value) {
  const match = String(value || '').trim().match(/^R?(\d{4})([ab])$/iu);
  return match ? `R${match[1]}${match[2].toLowerCase()}` : undefined;
}

function detectMatlab(command, options) {
  const lookup = spawnSync('sh', ['-c', `command -v -- ${shellQuote(command)}`], { encoding: 'utf8' });
  if (lookup.status !== 0) {
    return { available: false, verified: false, command, reason: 'matlab_not_found' };
  }
  const resolvedCommand = lookup.stdout.trim();
  const marker = 'OI_MATLAB_RUNTIME=';
  const timeout = positiveInteger(options.matlabProbeTimeoutMs, 120_000);
  const help = spawnSync(resolvedCommand, ['-help'], { encoding: 'utf8', timeout });
  const helpOutput = `${help.stdout || ''}\n${help.stderr || ''}`;
  const helpDescribesOptions = helpOutput.trim().length > 0;
  const supportsBatch = /(?:^|\s)-batch(?:\s|$)/imu.test(helpOutput);
  const useLegacyRun = helpDescribesOptions && !supportsBatch;
  const probeMode = useLegacyRun ? 'legacy-r' : 'batch';
  const probeCommand = "assert(exist('OCTAVE_VERSION','builtin') == 0, 'oi:MatlabRequired', 'GNU Octave is not MATLAB'); fprintf('OI_MATLAB_RUNTIME=%s\\n', version('-release'));";
  const legacyCommand = `try, ${probeCommand} catch exception, disp(getReport(exception,'extended')); exit(1); end; exit(0);`;
  const probeArguments = useLegacyRun
    ? ['-nodesktop', '-nodisplay', '-r', legacyCommand]
    : ['-batch', probeCommand];
  const probe = spawnSync(resolvedCommand, probeArguments, {
    encoding: 'utf8',
    timeout,
  });
  const output = `${probe.stdout || ''}\n${probe.stderr || ''}`;
  const release = canonicalMatlabRelease(output.match(/OI_MATLAB_RUNTIME=([^\s]+)/u)?.[1]);
  const available = probe.status === 0 && nonEmptyString(release) && output.includes(marker);
  return {
    available,
    verified: available,
    command: resolvedCommand,
    release,
    probeMode,
    reason: available ? undefined : (probe.error?.code === 'ETIMEDOUT' ? 'matlab_probe_timeout' : 'matlab_probe_failed'),
  };
}

function parseCliArguments(argumentsList) {
  const options = {};
  const valueFlags = new Map([
    ['--manifest', ['manifestPath', String]],
    ['--output', ['outputDirectory', String]],
    ['--baseline', ['baselineDirectory', String]],
    ['--matlab-command', ['matlabCommand', String]],
    ['--target-matlab-release', ['targetMatlabRelease', String]],
    ['--minimum-png-bytes', ['minimumPngBytes', Number]],
    ['--minimum-pdf-bytes', ['minimumPdfBytes', Number]],
    ['--minimum-svg-bytes', ['minimumSvgBytes', Number]],
    ['--maximum-png-bytes', ['maximumPngBytes', Number]],
    ['--maximum-pdf-bytes', ['maximumPdfBytes', Number]],
    ['--maximum-svg-bytes', ['maximumSvgBytes', Number]],
    ['--maximum-manifest-bytes', ['maximumManifestBytes', Number]],
    ['--maximum-png-pixels', ['maximumPngPixels', Number]],
    ['--minimum-dpi', ['minimumDpi', Number]],
    ['--minimum-font-size', ['minimumFontSize', Number]],
    ['--minimum-contrast-ratio', ['minimumContrastRatio', Number]],
    ['--minimum-publication-width', ['minimumPublicationWidth', Number]],
    ['--minimum-publication-height', ['minimumPublicationHeight', Number]],
    ['--pixel-channel-threshold', ['pixelChannelThreshold', Number]],
    ['--pixel-diff-ratio-threshold', ['pixelDiffRatioThreshold', Number]],
    ['--matlab-probe-timeout-ms', ['matlabProbeTimeoutMs', Number]],
  ]);
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--require-svg') options.requireSvg = true;
    else if (argument === '--require-embedded-png-dpi') options.requireEmbeddedPngDpi = true;
    else if (argument === '--require-science-contract') options.requireScienceContract = true;
    else if (argument === '--require-publication-contract') options.requirePublicationContract = true;
    else if (argument === '--require-interaction-contract') options.requireInteractionContract = true;
    else if (argument === '--require-runtime-contract') options.requireRuntimeContract = true;
    else if (argument === '--expect-headless') options.expectHeadless = true;
    else if (argument === '--no-require-matlab') options.requireMatlab = false;
    else if (valueFlags.has(argument)) {
      const value = argumentsList[index + 1];
      if (value === undefined) throw new Error(`missing value for ${argument}`);
      const [name, convert] = valueFlags.get(argument);
      const converted = convert(value);
      if (convert === Number && !Number.isFinite(converted)) throw new Error(`invalid number for ${argument}`);
      options[name] = converted;
      index += 1;
    } else throw new Error(`unknown argument: ${argument}`);
  }
  if (!nonEmptyString(options.manifestPath)) throw new Error('--manifest is required');
  return options;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function readJson(filePath, maximumBytes) {
  if (!filePath || !existsSync(filePath)) return { present: false, parseOk: false, value: undefined };
  try {
    if (statSync(filePath).size > maximumBytes) {
      return { present: true, parseOk: false, tooLarge: true, value: undefined };
    }
    return { present: true, parseOk: true, value: JSON.parse(readFileSync(filePath, 'utf8')) };
  } catch {
    return { present: true, parseOk: false, value: undefined };
  }
}

function resolveArtifactPath(file, root) {
  if (!root || !relativeFile(file)) return undefined;
  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(resolvedRoot, file);
  if (!pathInside(resolvedFile, resolvedRoot)) return undefined;
  try {
    const realRoot = realpathSync(resolvedRoot);
    const realFile = realpathSync(resolvedFile);
    if (!pathInside(realFile, realRoot)) return undefined;
  } catch {
    return resolvedFile;
  }
  return resolvedFile;
}

function pathInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function relativeFile(value) {
  if (!nonEmptyString(value) || path.isAbsolute(value) || /^file:/iu.test(value)) return false;
  const normalized = path.normalize(value);
  return normalized !== '..' && !normalized.startsWith(`..${path.sep}`);
}

function resolveOptionalPath(value) {
  return nonEmptyString(value) ? path.resolve(value) : undefined;
}

function positiveInteger(value, fallback) {
  if (Number.isInteger(value) && value > 0) return value;
  return fallback;
}

function positiveNumber(value, fallback) {
  if (Number.isFinite(value) && value > 0) return value;
  return fallback;
}

function nonNegativeNumber(value, fallback) {
  if (Number.isFinite(value) && value >= 0) return value;
  return fallback;
}

function boundedOption(value, fallback, minimum, maximum, errorCode) {
  if (value === undefined) return fallback;
  if (Number.isFinite(value) && value >= minimum && value <= maximum) return value;
  throw new RangeError(errorCode);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasUnsafeControlCharacters(value) {
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

function validUtcTimestamp(value) {
  if (!nonEmptyString(value)) return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/u);
  if (!match) return false;
  const milliseconds = Number((match[7] || '').padEnd(3, '0'));
  const timestamp = Date.UTC(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6]), milliseconds,
  );
  const parsed = new Date(timestamp);
  return parsed.getUTCFullYear() === Number(match[1])
    && parsed.getUTCMonth() === Number(match[2]) - 1
    && parsed.getUTCDate() === Number(match[3])
    && parsed.getUTCHours() === Number(match[4])
    && parsed.getUTCMinutes() === Number(match[5])
    && parsed.getUTCSeconds() === Number(match[6]);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function objectList(value) {
  if (Array.isArray(value)) return value.filter((entry) => entry && typeof entry === 'object');
  return value && typeof value === 'object' ? [value] : [];
}

function approximatelyEqual(actual, expected) {
  return Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= 0.1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cli = runMatlabPlotRegressionCli();
  process.stdout.write(`${JSON.stringify(cli.output, null, 2)}\n`);
  process.exitCode = cli.exitCode;
}
