import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_MINIMUM_WIDTH = 1200;
const DEFAULT_MINIMUM_HEIGHT = 675;
const DEFAULT_MINIMUM_PNG_BYTES = 10_000;
const DEFAULT_MINIMUM_PDF_BYTES = 100;
const DEFAULT_MINIMUM_PDF_TEXT_CHARACTERS = 3;
const DEFAULT_SCORE_WEIGHTS = {
  axisLabelsUnits: 16,
  fontSize: 12,
  lineWidth: 10,
  legendOcclusion: 12,
  colorbarLabels: 10,
  clippingRisk: 12,
  outputResolution: 16,
  accessibility: 12,
};

const SCORE_CRITERIA = Object.keys(DEFAULT_SCORE_WEIGHTS);

export function inspectMatlabPlotQuality(sourceOrOptions, manifestPath, outputDirectory) {
  const options = normalizeOptions(sourceOrOptions, manifestPath, outputDirectory);
  const sourcePaths = uniqueStrings([
    ...arrayValue(options.sourcePaths),
    ...arrayValue(options.matlabPaths),
    ...arrayValue(options.scriptPaths),
    options.sourcePath,
    options.matlabPath,
    options.scriptPath,
  ]).map((value) => path.resolve(value));
  const sources = sourcePaths.map((sourcePath) => ({
    path: sourcePath,
    text: readText(sourcePath),
  }));
  const sourceText = sources.map((source) => source.text).join('\n');
  const sourceFilesPresent = sourcePaths.length > 0 && sources.every((source) => source.text !== '');
  const sourceContract = inspectSourceContract(sources, sourceText, sourceFilesPresent);
  const {
    sourceViolations, prohibitedPatternsOk, themeUsageOk, pngExportOk, pdfExportOk,
    exportUsageOk, sourceQualityOk,
  } = sourceContract;

  const resolvedManifestPath = resolveOptionalPath(options.manifestPath || options.figureManifestPath);
  const manifestRead = readManifest(resolvedManifestPath);
  const manifest = manifestRead.value;
  const manifestRoot = resolvedManifestPath ? path.dirname(resolvedManifestPath) : process.cwd();
  const artifactRoot = resolveOptionalPath(options.outputDirectory || options.artifactDirectory)
    || manifestRoot;
  const figures = normalizeFigures(manifest?.figures);
  const manifestIntegrity = inspectManifestIntegrity(manifest, figures);
  const manifestTopLevelMissingFields = missingFields(manifest, ['schema_version', 'generated_at', 'generator', 'figures']);
  const manifestEntries = figures.map((figure, index) => inspectManifestFigure(figure, index));
  const manifestMissingFields = manifestEntries.flatMap((entry) => entry.missingFields.map((field) => `${entry.id}.${field}`));
  const manifestFieldsOk = manifestRead.ok
    && manifestTopLevelMissingFields.length === 0
    && figures.length > 0
    && manifestMissingFields.length === 0;
  const manifestIntegrityOk = manifestRead.ok && manifestIntegrity.ok;

  const minimumWidth = positiveInteger(options.minimumWidth, DEFAULT_MINIMUM_WIDTH);
  const minimumHeight = positiveInteger(options.minimumHeight, DEFAULT_MINIMUM_HEIGHT);
  const minimumPngBytes = positiveInteger(options.minimumPngBytes, DEFAULT_MINIMUM_PNG_BYTES);
  const minimumPdfBytes = positiveInteger(options.minimumPdfBytes, DEFAULT_MINIMUM_PDF_BYTES);
  const minimumPdfTextCharacters = positiveInteger(
    options.minimumPdfTextCharacters,
    DEFAULT_MINIMUM_PDF_TEXT_CHARACTERS,
  );
  const artifacts = figures.flatMap((figure, index) => inspectFigureArtifacts({
    figure,
    index,
    artifactRoot,
    minimumWidth,
    minimumHeight,
    minimumPngBytes,
    minimumPdfBytes,
    minimumPdfTextCharacters,
  }));
  const pngArtifacts = artifacts.filter((artifact) => artifact.format === 'png');
  const pdfArtifacts = artifacts.filter((artifact) => artifact.format === 'pdf');
  const pngArtifactsOk = figures.length > 0
    && pngArtifacts.length === figures.length
    && pngArtifacts.every((artifact) => artifact.ok);
  const pdfArtifactsOk = figures.length > 0
    && pdfArtifacts.length === figures.length
    && pdfArtifacts.every((artifact) => artifact.ok);
  const artifactPairsOk = figures.length > 0
    && figures.every((_, index) => ['png', 'pdf'].every((format) => artifacts.some((artifact) => (
      artifact.figureIndex === index && artifact.format === format
    ))));
  const crossFormatMetadataOk = figures.length > 0
    && figures.every((figure, index) => inspectCrossFormatMetadata(figure, artifacts, index));
  const manifestOk = manifestFieldsOk && manifestIntegrityOk && artifactPairsOk && crossFormatMetadataOk;
  const artifactsOk = pngArtifactsOk && pdfArtifactsOk;
  const manifestFreshness = inspectManifestFreshness({
    manifest,
    manifestPath: resolvedManifestPath,
    sourcePaths,
    artifacts,
    toleranceMs: positiveInteger(options.freshnessToleranceMs, 2_000),
  });
  const manifestFreshnessOk = manifestFieldsOk && manifestFreshness.ok;
  const plotQualityScore = buildPlotQualityScore({
    sourceText,
    sourceFilesPresent,
    sourceQualityOk,
    manifest,
    artifacts,
    options,
    minimumWidth,
    minimumHeight,
    sourceQualityOk,
    artifactEvidenceOk: sourceQualityOk && manifestOk && artifactsOk && manifestFreshnessOk,
  });

  return {
    sourceFilesPresent,
    prohibitedPatternsOk,
    themeUsageOk,
    pngExportOk,
    pdfExportOk,
    exportUsageOk,
    sourceQualityOk,
    sourceViolations,
    manifestPresent: manifestRead.present,
    manifestParseOk: manifestRead.parseOk,
    manifestFieldsOk,
    manifestIntegrityOk,
    manifestIntegrity,
    manifestOk,
    manifestFreshnessOk,
    manifestFreshness,
    manifestTopLevelMissingFields,
    manifestMissingFields,
    manifestEntries,
    figureCount: figures.length,
    artifactPairsOk,
    pngArtifactsOk,
    pdfArtifactsOk,
    artifactsOk,
    crossFormatMetadataOk,
    artifacts,
    ...plotQualityScore,
    matlabPlotQualityOk: sourceQualityOk && manifestOk && artifactsOk && manifestFreshnessOk,
    lowQualityPatternsOk: prohibitedPatternsOk,
    unifiedThemeOk: themeUsageOk,
    unifiedExportOk: exportUsageOk,
    pngOk: pngArtifactsOk,
    pdfOk: pdfArtifactsOk,
    manifestCompleteOk: manifestFieldsOk,
    crossFormatAuditOk: crossFormatMetadataOk,
    plotQualityOk: sourceQualityOk && manifestOk && artifactsOk && manifestFreshnessOk,
  };
}

export function scoreMatlabPlotQuality(sourceOrOptions, manifestPath, outputDirectory) {
  const options = normalizeOptions(sourceOrOptions, manifestPath, outputDirectory);
  const sourcePaths = uniqueStrings([
    ...arrayValue(options.sourcePaths),
    ...arrayValue(options.matlabPaths),
    ...arrayValue(options.scriptPaths),
    options.sourcePath,
    options.matlabPath,
    options.scriptPath,
  ]).map((value) => path.resolve(value));
  const sources = sourcePaths.map((sourcePath) => ({ path: sourcePath, text: readText(sourcePath) }));
  const sourceText = sources.map((source) => source.text).join('\n');
  const sourceFilesPresent = sourcePaths.length > 0 && sources.every((source) => source.text !== '');
  const sourceContract = inspectSourceContract(sources, sourceText, sourceFilesPresent);
  const resolvedManifestPath = resolveOptionalPath(options.manifestPath || options.figureManifestPath);
  const manifestRead = readManifest(resolvedManifestPath);
  const manifest = manifestRead.value;
  const artifactRoot = resolveOptionalPath(options.outputDirectory || options.artifactDirectory)
    || (resolvedManifestPath ? path.dirname(resolvedManifestPath) : process.cwd());
  const figures = normalizeFigures(manifest?.figures);
  const manifestIntegrity = inspectManifestIntegrity(manifest, figures);
  const minimumWidth = positiveInteger(options.minimumWidth, DEFAULT_MINIMUM_WIDTH);
  const minimumHeight = positiveInteger(options.minimumHeight, DEFAULT_MINIMUM_HEIGHT);
  const artifacts = figures.flatMap((figure, index) => inspectFigureArtifacts({
    figure,
    index,
    artifactRoot,
    minimumWidth,
    minimumHeight,
    minimumPngBytes: positiveInteger(options.minimumPngBytes, DEFAULT_MINIMUM_PNG_BYTES),
    minimumPdfBytes: positiveInteger(options.minimumPdfBytes, DEFAULT_MINIMUM_PDF_BYTES),
    minimumPdfTextCharacters: positiveInteger(
      options.minimumPdfTextCharacters,
      DEFAULT_MINIMUM_PDF_TEXT_CHARACTERS,
    ),
  }));
  const manifestFreshness = inspectManifestFreshness({
    manifest,
    manifestPath: resolvedManifestPath,
    sourcePaths,
    artifacts,
    toleranceMs: positiveInteger(options.freshnessToleranceMs, 2_000),
  });
  const manifestEntries = figures.map((figure, index) => inspectManifestFigure(figure, index));
  const manifestFieldsOk = manifestRead.ok
    && missingFields(manifest, ['schema_version', 'generated_at', 'generator', 'figures']).length === 0
    && figures.length > 0
    && manifestEntries.every((entry) => entry.missingFields.length === 0);
  const artifactPairsOk = figures.length > 0
    && figures.every((_, index) => ['png', 'pdf'].every((format) => artifacts.some((artifact) => (
      artifact.figureIndex === index && artifact.format === format
    ))));
  const artifactsOk = artifacts.length === figures.length * 2 && artifacts.every((artifact) => artifact.ok);
  return buildPlotQualityScore({
    sourceText,
    sourceFilesPresent,
    sourceQualityOk: sourceContract.sourceQualityOk,
    manifest,
    artifacts,
    options,
    minimumWidth,
    minimumHeight,
    artifactEvidenceOk: sourceContract.sourceQualityOk && manifestFieldsOk && manifestIntegrity.ok
      && artifactPairsOk && artifactsOk && manifestFreshness.ok,
  });
}

function buildPlotQualityScore({
  sourceText,
  sourceFilesPresent,
  sourceQualityOk,
  manifest,
  artifacts,
  options,
  minimumWidth,
  minimumHeight,
  artifactEvidenceOk,
}) {
  const audit = firstObject(options.plotQualityAudit, options.qualityAudit, options.visualAudit);
  const manifestAudit = firstObject(manifest?.plot_quality, manifest?.quality, manifest?.accessibility);
  const evidence = {
    axisLabelsUnits: criterionEvidence(audit, manifestAudit, 'axisLabelsUnits', sourceText, [
      /\bxlabel\s*\(/iu, /\bylabel\s*\(/iu, /\bzlabel\s*\(/iu,
    ], [/\bunit\b/iu, /\bunits\b/iu, /\([^\n;()]{1,24}(?:\/|°|deg|m|s|kg|Pa|Hz|K)[^\n;()]{0,24}\)/iu]),
    fontSize: criterionEvidence(audit, manifestAudit, 'fontSize', sourceText, [
      /['"]FontSize['"]\s*,\s*(?:1[0-9]|[2-9][0-9])\b/iu,
      /\bFontSize\s*=\s*(?:1[0-9]|[2-9][0-9])\b/iu,
    ]),
    lineWidth: criterionEvidence(audit, manifestAudit, 'lineWidth', sourceText, [
      /['"]LineWidth['"]\s*,\s*(?:1\.[2-9]|[2-9](?:\.\d+)?)\b/iu,
      /\bLineWidth\s*=\s*(?:1\.[2-9]|[2-9](?:\.\d+)?)\b/iu,
    ]),
    legendOcclusion: criterionEvidence(audit, manifestAudit, 'legendOcclusion', sourceText, [
      /\b(?:legend|lgd)\s*\([^\n;]*['"](?:northoutside|southoutside|eastoutside|westoutside|bestoutside)['"]/iu,
      /\bLayout\.Tile\s*=\s*['"](?:north|south|east|west)['"]/iu,
    ], [], { inverse: [/\b(?:legend|lgd)\s*\([^\n;]*['"](?:north|south|east|west|best)['"]/iu] }),
    colorbarLabels: criterionEvidence(audit, manifestAudit, 'colorbarLabels', sourceText, [
      /\bcolorbar\s*\([^\n;]*(?:['"]Label['"]\s*,|\bLabel\s*=)/iu,
      /\b(?:cb|cbar)\s*\.\s*Label\s*\.\s*(?:String|Text)\s*=/iu,
      /\bylabel\s*\([^\n;]*\b(?:colorbar|cb|cbar)\b/iu,
    ]),
    clippingRisk: criterionEvidence(audit, manifestAudit, 'clippingRisk', sourceText, [
      /\b(?:exportgraphics|oi_export_png|oi_export_figure|print)\s*\(/iu,
      /\b(?:exportgraphics|oi_export_png|oi_export_figure)\s*\([^\n;]*['"]Padding['"]\s*,\s*['"](?:tight|loose)['"]/iu,
      /\b(?:LooseInset|PositionConstraint)\s*=/iu,
    ], [], { inverse: [
      /\baxis\s+tight\b/iu,
      /\b(?:OuterPosition|ActivePositionProperty)\s*=/iu,
    ] }),
    outputResolution: outputResolutionEvidence(artifacts, minimumWidth, minimumHeight, audit, manifestAudit),
    accessibility: criterionEvidence(audit, manifestAudit, 'accessibility', sourceText, [
      /\b(?:parula|colororder|ColorOrder|cmocean|brewermap|tableau)\b/iu,
      /\b(?:alt|description|Description|Accessibility|accessible|colorblind|colourblind)\b/iu,
      /\b(?:Marker|MarkerFaceColor|LineStyle)\b/iu,
    ], [], { inverse: [
      /\b(?:jet|rainbow|hsv)\s*\(/iu,
      /\bcolormap\s*\(\s*['"](?:jet|hsv|rainbow)['"]/iu,
    ] }),
  };
  const criteria = Object.fromEntries(SCORE_CRITERIA.map((name) => {
    const item = evidence[name];
    const maxScore = DEFAULT_SCORE_WEIGHTS[name];
    const pass = item.status === 'pass' && artifactEvidenceOk;
    return [name, {
      score: pass ? maxScore : 0,
      maxScore,
      ok: pass,
      status: pass ? 'pass' : 'fail',
      evidence: pass ? item.evidence : [],
      issues: pass ? [] : uniqueStrings([
        ...item.issues,
        ...(artifactEvidenceOk ? [] : ['fresh, checksum-verified PNG/PDF artifacts are required for scoring']),
      ]),
    }];
  }));
  const total = SCORE_CRITERIA.reduce((sum, name) => sum + criteria[name].score, 0);
  const maxScore = SCORE_CRITERIA.reduce((sum, name) => sum + criteria[name].maxScore, 0);
  const score = maxScore === 0 ? 0 : Math.round((total / maxScore) * 100);
  const failedCriteria = SCORE_CRITERIA.filter((name) => !criteria[name].ok);
  return {
    plotQualityScore: score,
    plotQualityScoreMax: 100,
    plotQualityGrade: score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F',
    plotQualityScoreOk: sourceFilesPresent && sourceQualityOk
      && score >= positiveInteger(options.minimumPlotQualityScore, 70),
    plotQualityCriteria: criteria,
    plotQualityIssues: failedCriteria.flatMap((name) => criteria[name].issues.map((issue) => `${name}: ${issue}`)),
    plotQualityEvidence: Object.fromEntries(SCORE_CRITERIA.map((name) => [name, criteria[name].evidence])),
    plotQualityArtifactEvidenceOk: artifactEvidenceOk,
    plotQualitySourceEvidenceOk: sourceQualityOk,
  };
}

function inspectSourceContract(sources, sourceText, sourceFilesPresent) {
  const executableSourceText = matlabExecutableText(sourceText);
  const sourceViolations = inspectSourceViolations(sources);
  const prohibitedPatternsOk = sourceFilesPresent && sourceViolations.length === 0;
  const themeUsageOk = sourceFilesPresent
    && /\boi_ocean_theme\s*\(/iu.test(executableSourceText)
    && /\boi_figure\s*\(/iu.test(executableSourceText)
    && /\boi_apply_axes\s*\(/iu.test(executableSourceText);
  const pngExportOk = sourceFilesPresent && hasPngExport(sourceText);
  const pdfExportOk = sourceFilesPresent && hasPdfExport(sourceText);
  const exportUsageOk = pngExportOk && pdfExportOk;
  return {
    sourceViolations,
    prohibitedPatternsOk,
    themeUsageOk,
    pngExportOk,
    pdfExportOk,
    exportUsageOk,
    sourceQualityOk: prohibitedPatternsOk && themeUsageOk && exportUsageOk,
  };
}

function criterionEvidence(audit, manifestAudit, name, sourceText, positivePatterns = [], unitPatterns = [], extra = {}) {
  const explicit = explicitCriterion(audit, manifestAudit, name);
  if (explicit === false) return failEvidence('explicit audit marked this criterion as failed');
  const sourceLines = matlabCodeLines(sourceText);
  const inverseMatch = (extra.inverse || []).find((pattern) => sourceLines.some((line) => (
    trustedPatternMatch(pattern, line)
  )));
  if (inverseMatch) return failEvidence(`found ${inverseMatch}`);
  const matches = positivePatterns.filter((pattern) => sourceLines.some((line) => trustedPatternMatch(pattern, line)));
  const unitsOk = unitPatterns.length === 0 || unitPatterns.some((pattern) => sourceLines.some((line) => (
    trustedPatternMatch(pattern, line)
  )));
  if (matches.length > 0 && unitsOk) return passEvidence(matches.map(String).join(', '));
  return unknownOrFail(sourceText, `${name} requires explicit MATLAB evidence`);
}

function outputResolutionEvidence(artifacts, minimumWidth, minimumHeight, audit, manifestAudit) {
  const explicit = explicitCriterion(audit, manifestAudit, 'outputResolution');
  if (explicit === false) return failEvidence('explicit audit marked this criterion as failed');
  const pngs = artifacts.filter((artifact) => artifact.format === 'png');
  if (pngs.length === 0) return failEvidence('no PNG artifact was available');
  const good = pngs.every((artifact) => artifact.ok
    && artifact.width >= minimumWidth
    && artifact.height >= minimumHeight
    && artifact.dpiOk);
  return good ? passEvidence('PNG dimensions, bytes, checksum and DPI passed') : failEvidence('PNG dimensions or DPI failed');
}

function explicitCriterion(audit, manifestAudit, name) {
  const value = audit?.[name] ?? manifestAudit?.[name];
  return typeof value === 'boolean' ? value : undefined;
}

function firstObject(...values) {
  return values.find((value) => value && typeof value === 'object' && !Array.isArray(value)) || {};
}

function passEvidence(value) {
  return { status: 'pass', evidence: [value], issues: [] };
}

function failEvidence(value) {
  return { status: 'fail', evidence: [], issues: [value] };
}

function unknownOrFail(sourceText, issue) {
  return sourceText.trim() ? failEvidence(issue) : failEvidence('MATLAB source is unavailable');
}

function normalizeOptions(sourceOrOptions, manifestPath, outputDirectory) {
  if (typeof sourceOrOptions === 'object' && sourceOrOptions !== null && !Array.isArray(sourceOrOptions)) {
    return sourceOrOptions;
  }
  return {
    sourcePath: sourceOrOptions,
    manifestPath,
    outputDirectory,
  };
}

function inspectSourceViolations(sources) {
  const rules = [
    ['jet-colormap', /(?:\bjet\s*\(|\bcolormap\s*\(\s*['"]jet['"]|\bcolormap\s+jet\b)/giu],
    ['saveas-export', /\bsaveas\s*\(/giu],
    ['hardcopy-export', /\bhgexport\s*\(/giu],
    ['bitmap-screen-capture', /\bgetframe\s*\(/giu],
    ['jpeg-export', /(?:-djpeg\b|\.jpe?g\b)/giu],
    ['low-resolution-export', /(?:-r(?:72|96)\b|['"]Resolution['"]\s*,\s*(?:72|96)\b)/giu],
  ];
  return sources.flatMap((source) => rules.flatMap(([rule, pattern]) => {
    const matches = matlabExecutableText(source.text).match(pattern) || [];
    return matches.map((match) => ({
      file: source.path,
      rule,
      match,
    }));
  }));
}

function hasPngExport(sourceText) {
  return hasExecutableExport(sourceText, 'png');
}

function hasPdfExport(sourceText) {
  return hasExecutableExport(sourceText, 'pdf');
}

function hasExecutableExport(sourceText, format) {
  const helper = format === 'png'
    ? /\boi_export_(?:png|figure)\s*\(/iu
    : /\boi_export_(?:pdf|figure)\s*\(/iu;
  if (helper.test(matlabExecutableText(sourceText))) return true;
  return sourceText.split('\n').some((line) => {
    const executable = maskMatlabLine(line);
    const callPresent = /\b(?:exportgraphics|print)\s*\(/iu.test(executable);
    if (!callPresent) return false;
    return format === 'png'
      ? /(?:\.png\b|-dpng\b)/iu.test(line)
      : /(?:\.pdf\b|-dpdf\b)/iu.test(line);
  });
}

function inspectManifestFigure(figure, index) {
  const id = nonEmptyString(figure?.id) ? figure.id : `figures[${index}]`;
  return {
    id,
    missingFields: missingFields(figure, ['id', 'title', 'source', 'theme', 'exports'])
      .concat(missingExportFields(figure?.exports)),
  };
}

function inspectManifestIntegrity(manifest, figures) {
  const violations = [];
  if (manifest?.schema_version !== 2) violations.push('schema_version.expected_2');
  const ids = new Set();
  const artifactFiles = new Set();
  let previousId = '';
  figures.forEach((figure, index) => {
    const id = nonEmptyString(figure?.id) ? figure.id : '';
    if (!id) return;
    if (ids.has(id)) violations.push(`figures[${index}].id.duplicate`);
    if (previousId && id < previousId) violations.push(`figures[${index}].id.order`);
    ids.add(id);
    previousId = id;
    const formats = normalizeExports(figure.exports);
    for (const format of ['png', 'pdf']) {
      const file = formats[format]?.file;
      if (!validArtifactReference(file)) continue;
      const normalized = path.normalize(file);
      if (artifactFiles.has(normalized)) violations.push(`figures[${index}].exports.${format}.file.duplicate`);
      artifactFiles.add(normalized);
    }
  });
  return { ok: violations.length === 0, violations };
}

function missingExportFields(exportsValue) {
  const formats = normalizeExports(exportsValue);
  const missing = [];
  for (const format of ['png', 'pdf']) {
    const artifact = formats[format];
    if (!artifact) {
      missing.push(`exports.${format}`);
      continue;
    }
    for (const field of ['file', 'bytes', 'sha256']) {
      if (!validField(artifact, field)) missing.push(`exports.${format}.${field}`);
    }
    if (validField(artifact, 'file') && !validArtifactReference(artifact.file)) {
      missing.push(`exports.${format}.file`);
    }
    if (format === 'png') {
      for (const field of ['width', 'height', 'dpi']) {
        if (!validField(artifact, field)) missing.push(`exports.png.${field}`);
      }
    } else {
      for (const field of ['width', 'height']) {
        if (!validField(artifact, field)) missing.push(`exports.pdf.${field}`);
      }
      if (!validField(artifact, 'text') && !validField(artifact, 'text_file')) {
        missing.push('exports.pdf.text');
      }
    }
  }
  return missing;
}

function inspectFigureArtifacts({
  figure,
  index,
  artifactRoot,
  minimumWidth,
  minimumHeight,
  minimumPngBytes,
  minimumPdfBytes,
  minimumPdfTextCharacters,
}) {
  const id = nonEmptyString(figure?.id) ? figure.id : `figures[${index}]`;
  const formats = normalizeExports(figure?.exports);
  return ['png', 'pdf'].flatMap((format) => {
    const metadata = formats[format];
    if (!metadata) return [];
    const filePath = resolveArtifactPath(metadata.file, artifactRoot);
    const location = inspectArtifactLocation(filePath, artifactRoot);
    if (format === 'png') {
      return [inspectPngArtifact({
        figureIndex: index,
        id,
        metadata,
        filePath,
        location,
        minimumWidth,
        minimumHeight,
        minimumPngBytes,
      })];
    }
    return [inspectPdfArtifact({
      figureIndex: index,
      id,
      metadata,
      filePath,
      location,
      artifactRoot,
      minimumPdfBytes,
      minimumPdfTextCharacters,
    })];
  });
}

function inspectPngArtifact({
  figureIndex,
  id,
  metadata,
  filePath,
  location,
  minimumWidth,
  minimumHeight,
  minimumPngBytes,
}) {
  const fileInfo = inspectFile(filePath);
  const dimensions = fileInfo.present ? readPngDimensions(filePath) : undefined;
  const dimensionsOk = Boolean(dimensions)
    && dimensions.width >= minimumWidth
    && dimensions.height >= minimumHeight
    && dimensions.width === metadata.width
    && dimensions.height === metadata.height;
  const bytesOk = fileInfo.present
    && fileInfo.bytes >= minimumPngBytes
    && fileInfo.bytes === metadata.bytes;
  const checksumOk = fileInfo.present
    && validField(metadata, 'sha256')
    && fileSha256(filePath) === metadata.sha256.toLowerCase();
  const dpiOk = Number.isInteger(metadata.dpi) && metadata.dpi >= 150;
  return {
    figureIndex,
    id,
    format: 'png',
    file: filePath,
    present: fileInfo.present,
    bytes: fileInfo.bytes,
    width: dimensions?.width,
    height: dimensions?.height,
    dimensionsOk,
    bytesOk,
    checksumOk,
    pathOk: location.ok,
    pathViolations: location.violations,
    structureOk: dimensions?.structureOk === true,
    dpiOk,
    textOk: true,
    ok: fileInfo.present && location.ok && dimensions?.structureOk === true
      && dimensionsOk && bytesOk && checksumOk && dpiOk,
  };
}

function inspectPdfArtifact({
  figureIndex,
  id,
  metadata,
  filePath,
  location,
  artifactRoot,
  minimumPdfBytes,
  minimumPdfTextCharacters,
}) {
  const fileInfo = inspectFile(filePath);
  const dimensions = fileInfo.present ? readPdfDimensions(filePath) : undefined;
  const text = pdfAuditText(metadata, filePath, artifactRoot);
  const normalizedText = text.replace(/\s+/gu, ' ').trim();
  const bytesOk = fileInfo.present
    && fileInfo.bytes >= minimumPdfBytes
    && fileInfo.bytes === metadata.bytes;
  const dimensionsOk = Boolean(dimensions)
    && approximatelyEqual(dimensions.width, metadata.width)
    && approximatelyEqual(dimensions.height, metadata.height);
  const checksumOk = fileInfo.present
    && validField(metadata, 'sha256')
    && fileSha256(filePath) === metadata.sha256.toLowerCase();
  const textOk = normalizedText.length >= minimumPdfTextCharacters;
  return {
    figureIndex,
    id,
    format: 'pdf',
    file: filePath,
    present: fileInfo.present,
    bytes: fileInfo.bytes,
    width: dimensions?.width,
    height: dimensions?.height,
    dimensionsOk,
    bytesOk,
    checksumOk,
    pathOk: location.ok,
    pathViolations: location.violations,
    dpiOk: true,
    textOk,
    text: normalizedText,
    ok: fileInfo.present && location.ok && dimensionsOk && bytesOk && checksumOk && textOk,
  };
}

function inspectCrossFormatMetadata(figure, artifacts, figureIndex) {
  const formats = normalizeExports(figure?.exports);
  const png = formats.png;
  const pdf = formats.pdf;
  const pngArtifact = artifacts.find((artifact) => artifact.figureIndex === figureIndex && artifact.format === 'png');
  const pdfArtifact = artifacts.find((artifact) => artifact.figureIndex === figureIndex && artifact.format === 'pdf');
  if (!png || !pdf || !pngArtifact || !pdfArtifact) return false;
  const sharedFieldsOk = ['figure_id', 'title', 'source', 'theme'].every((field) => (
    validField(png, field)
    && validField(pdf, field)
    && png[field] === pdf[field]
  ));
  const figureLinkOk = png.figure_id === figure.id
    && pdf.figure_id === figure.id
    && png.title === figure.title
    && pdf.title === figure.title
    && png.source === figure.source
    && pdf.source === figure.source
    && png.theme === figure.theme
    && pdf.theme === figure.theme;
  const distinctFilesOk = nonEmptyString(png.file)
    && nonEmptyString(pdf.file)
    && path.extname(png.file).toLowerCase() === '.png'
    && path.extname(pdf.file).toLowerCase() === '.pdf'
    && png.file !== pdf.file;
  return sharedFieldsOk
    && figureLinkOk
    && distinctFilesOk
    && png.sha256 !== pdf.sha256
    && pngArtifact.ok
    && pdfArtifact.ok;
}

function normalizeExports(exportsValue) {
  if (Array.isArray(exportsValue)) {
    return Object.fromEntries(exportsValue.flatMap((artifact) => {
      const format = String(artifact?.format || '').toLowerCase();
      return ['png', 'pdf'].includes(format) ? [[format, artifact]] : [];
    }));
  }
  if (!exportsValue || typeof exportsValue !== 'object') return {};
  return {
    png: exportsValue.png,
    pdf: exportsValue.pdf,
  };
}

function normalizeFigures(figures) {
  const entries = Array.isArray(figures)
    ? figures.filter((figure) => figure && typeof figure === 'object')
    : [];
  const nested = entries.filter((figure) => figure.exports && typeof figure.exports === 'object');
  const flat = entries.filter((figure) => !figure.exports);
  const grouped = new Map();
  for (const entry of flat) {
    const format = manifestArtifactFormat(entry);
    const id = nonEmptyString(entry.id) ? entry.id : '';
    if (!id || !format) {
      nested.push(entry);
      continue;
    }
    const figure = grouped.get(id) || {
      id,
      title: entry.title,
      source: entry.source,
      theme: entry.theme,
      exports: {},
    };
    figure.exports[format] = {
      ...entry,
      figure_id: entry.figure_id || id,
    };
    grouped.set(id, figure);
  }
  return [...nested, ...grouped.values()];
}

function manifestArtifactFormat(entry) {
  const declaredFormat = String(entry?.format || '').toLowerCase();
  if (['png', 'pdf'].includes(declaredFormat)) return declaredFormat;
  if (!nonEmptyString(entry?.file)) return '';
  const extension = path.extname(entry.file).slice(1).toLowerCase();
  return ['png', 'pdf'].includes(extension) ? extension : '';
}

function readManifest(manifestPath) {
  if (!manifestPath || !existsSync(manifestPath)) {
    return { present: false, parseOk: false, ok: false, value: undefined };
  }
  try {
    return { present: true, parseOk: true, ok: true, value: JSON.parse(readFileSync(manifestPath, 'utf8')) };
  } catch {
    return { present: true, parseOk: false, ok: false, value: undefined };
  }
}

function inspectFile(filePath) {
  if (!filePath || !existsSync(filePath)) return { present: false, bytes: 0, mtimeMs: 0 };
  try {
    const stats = statSync(filePath);
    return {
      present: stats.isFile(),
      bytes: stats.isFile() ? stats.size : 0,
      mtimeMs: stats.isFile() ? stats.mtimeMs : 0,
    };
  } catch {
    return { present: false, bytes: 0, mtimeMs: 0 };
  }
}

function inspectArtifactLocation(filePath, artifactRoot) {
  const violations = [];
  if (!filePath || !artifactRoot) return { ok: false, violations: ['path.missing'] };
  try {
    const root = realpathSync(artifactRoot);
    const stats = lstatSync(filePath);
    if (stats.isSymbolicLink()) violations.push('path.symlink');
    if (!stats.isFile()) violations.push('path.not_regular_file');
    const resolved = realpathSync(filePath);
    const relative = path.relative(root, resolved);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      violations.push('path.outside_output_directory');
    }
  } catch {
    violations.push('path.unresolvable');
  }
  return { ok: violations.length === 0, violations };
}

function inspectManifestFreshness({ manifest, manifestPath, sourcePaths, artifacts, toleranceMs }) {
  const violations = [];
  const generatedAtMs = Date.parse(String(manifest?.generated_at || ''));
  const manifestInfo = inspectFile(manifestPath);
  const evidencePaths = uniqueStrings([
    ...sourcePaths,
    ...artifacts.map((artifact) => artifact.file),
  ]);
  const evidenceFiles = evidencePaths.map((file) => ({ file, ...inspectFile(file) }));
  if (!Number.isFinite(generatedAtMs)) violations.push('generated_at.invalid');
  if (!manifestInfo.present) violations.push('manifest.missing');
  if (Number.isFinite(generatedAtMs) && generatedAtMs > Date.now() + toleranceMs) {
    violations.push('generated_at.future');
  }
  if (manifestInfo.present && Number.isFinite(generatedAtMs)
      && generatedAtMs > manifestInfo.mtimeMs + toleranceMs) {
    violations.push('generated_at.after_manifest_file');
  }
  for (const evidence of evidenceFiles) {
    if (!evidence.present) continue;
    if (Number.isFinite(generatedAtMs) && evidence.mtimeMs > generatedAtMs + toleranceMs) {
      violations.push(`evidence.newer_than_generated_at:${evidence.file}`);
    }
    if (manifestInfo.present && evidence.mtimeMs > manifestInfo.mtimeMs + toleranceMs) {
      violations.push(`evidence.newer_than_manifest:${evidence.file}`);
    }
  }
  return {
    ok: violations.length === 0 && evidenceFiles.length > 0,
    generatedAt: Number.isFinite(generatedAtMs) ? new Date(generatedAtMs).toISOString() : undefined,
    manifestMtime: manifestInfo.present ? new Date(manifestInfo.mtimeMs).toISOString() : undefined,
    evidenceFiles,
    violations,
  };
}

function readPngDimensions(filePath) {
  try {
    const data = readFileSync(filePath);
    const header = data.subarray(0, 24);
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (header.length < 24 || !header.subarray(0, 8).equals(signature) || header.toString('ascii', 12, 16) !== 'IHDR') {
      return undefined;
    }
    const ihdrLengthOk = header.readUInt32BE(8) === 13;
    const iend = data.subarray(Math.max(0, data.length - 12));
    const iendOk = iend.length === 12
      && iend.readUInt32BE(0) === 0
      && iend.toString('ascii', 4, 8) === 'IEND';
    return {
      width: header.readUInt32BE(16),
      height: header.readUInt32BE(20),
      structureOk: ihdrLengthOk && iendOk,
    };
  } catch {
    return undefined;
  }
}

function readPdfDimensions(filePath) {
  try {
    const pdfText = readFileSync(filePath, 'latin1');
    const mediaBox = pdfText.match(/\/MediaBox\s*\[\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\]/u);
    if (!mediaBox) return undefined;
    const [, x1, y1, x2, y2] = mediaBox.map(Number);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    return width > 0 && height > 0 ? { width, height } : undefined;
  } catch {
    return undefined;
  }
}

function fileSha256(filePath) {
  try {
    return createHash('sha256').update(readFileSync(filePath)).digest('hex');
  } catch {
    return '';
  }
}

function approximatelyEqual(actual, expected) {
  return Number.isFinite(expected) && Math.abs(actual - expected) <= 0.1;
}

function pdfAuditText(metadata, filePath, artifactRoot) {
  if (!filePath || !existsSync(filePath)) return '';
  const extracted = spawnSync('pdftotext', ['-enc', 'UTF-8', filePath, '-'], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 5_000,
  });
  if (extracted.status === 0 && nonEmptyString(extracted.stdout)) return extracted.stdout;
  try {
    const pdfText = readFileSync(filePath, 'latin1');
    return [...pdfText.matchAll(/\(([^()]*)\)\s*Tj/gu), ...pdfText.matchAll(/\[(.*?)\]\s*TJ/gsu)]
      .flatMap((match) => match[1].match(/\(([^()]*)\)/gu)?.map((value) => value.slice(1, -1)) || [match[1]])
      .join(' ')
      .replace(/\\([()\\])/gu, '$1');
  } catch {
    return '';
  }
}

function missingFields(value, fields) {
  return fields.filter((field) => !validField(value, field));
}

function validField(value, field) {
  if (!value || typeof value !== 'object' || !(field in value)) return false;
  const fieldValue = value[field];
  if (field === 'figures') return Array.isArray(fieldValue) && fieldValue.length > 0;
  if (field === 'exports') return fieldValue !== null && typeof fieldValue === 'object';
  if (field === 'schema_version' || ['width', 'height', 'dpi', 'bytes'].includes(field)) {
    return Number.isInteger(fieldValue) && fieldValue > 0;
  }
  if (field === 'generated_at') {
    return nonEmptyString(fieldValue) && Number.isFinite(Date.parse(fieldValue));
  }
  if (field === 'sha256') return typeof fieldValue === 'string' && /^[a-f\d]{64}$/iu.test(fieldValue);
  return nonEmptyString(fieldValue);
}

function readText(filePath) {
  if (!filePath) return '';
  try { return readFileSync(filePath, 'utf8'); } catch { return ''; }
}

function resolveArtifactPath(file, root) {
  if (!nonEmptyString(file)) return undefined;
  return path.isAbsolute(file) ? file : path.resolve(root, file);
}

function validArtifactReference(file) {
  if (!nonEmptyString(file) || path.isAbsolute(file) || /^file:/iu.test(file)) return false;
  const normalized = path.normalize(file);
  return normalized !== '..' && !normalized.startsWith(`..${path.sep}`);
}

function resolveOptionalPath(value) {
  return nonEmptyString(value) ? path.resolve(value) : undefined;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values) {
  return [...new Set(values.filter(nonEmptyString))];
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function matlabExecutableText(sourceText) {
  const withoutBlockComments = sourceText.replace(/^\s*%\{[\s\S]*?^\s*%\}\s*$/gmu, '');
  return withoutBlockComments
    .split('\n')
    .map(maskMatlabLine)
    .join('\n');
}

function matlabCodeLines(sourceText) {
  return sourceText
    .replace(/^\s*%\{[\s\S]*?^\s*%\}\s*$/gmu, '')
    .split('\n')
    .map((line) => line.slice(0, maskMatlabLine(line).length));
}

function trustedPatternMatch(pattern, line) {
  pattern.lastIndex = 0;
  if (!pattern.test(line)) return false;
  const executable = maskMatlabLine(line);
  pattern.lastIndex = 0;
  if (pattern.test(executable)) return true;
  return /\b(?:axes|plot|plot3|scatter|scatter3|line|bar|errorbar|fill|patch|image|imagesc|surf|contour|contourf|xlabel|ylabel|zlabel|title|legend|colorbar|colormap|exportgraphics|print|set)\s*\(/iu.test(executable)
    || /\b[A-Za-z]\w*(?:\.[A-Za-z]\w*)+\s*=/u.test(executable);
}

function maskMatlabLine(line) {
  let quote = '';
  let result = '';
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      result += ' ';
      if (character === quote && line[index + 1] === quote) {
        result += ' ';
        index += 1;
      } else if (character === quote) {
        quote = '';
      }
      continue;
    }
    if (character === '%') break;
    if (character === '"' || (character === "'" && !isMatlabTransposeQuote(line, index))) {
      quote = character;
      result += ' ';
      continue;
    }
    result += character;
  }
  return result;
}

function isMatlabTransposeQuote(line, index) {
  if (index === 0) return false;
  return /[A-Za-z0-9_.'"\)\]\}]/u.test(line[index - 1]);
}
