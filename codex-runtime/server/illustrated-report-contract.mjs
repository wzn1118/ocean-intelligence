import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { OCEAN_REPORT_SPEC } from './ocean-report-spec.mjs';
import { UNIVERSAL_OCEAN_REPORT_SPEC } from './beibu-gulf-report-spec.mjs';
import { WIND_REPORT_SPEC } from './wind-report-spec.mjs';
import { OCEAN_VARIABLE_REPORT_SPEC } from './ocean-variable-report-spec.mjs';
import { PHYSICAL_OCEANOGRAPHY_SPEC } from './physical-oceanography-spec.mjs';
import { PROFESSIONAL_VISUALIZATION_SPEC } from './professional-visualization-spec.mjs';
import { EDITORIAL_STYLE_SPEC } from './editorial-style-spec.mjs';
import { PHYSICAL_INTERPRETATION_IMPACT_SPEC } from './physical-interpretation-impact-spec.mjs';
import { ANOMALY_LINKAGE_REPORT_SPEC } from './anomaly-linkage-report-spec.mjs';
import { POINT_TEMPERATURE_INTERACTION_SPEC } from './point-temperature-interaction-spec.mjs';
import { inspectPointInteractionQuality } from './point-interaction-quality.mjs';
import { parseOceanEvidenceTime } from './ocean-evidence-time.mjs';
import { parseOceanReportHtml } from './ocean-report-html-parser.mjs';

const REPORT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,79}$/u;
const MATLAB_COMPATIBLE_SOURCE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,62}\.m$/u;
const MATLAB_KEYWORDS = new Set([
  'break', 'case', 'catch', 'classdef', 'continue', 'else', 'elseif', 'end', 'for', 'function',
  'global', 'if', 'otherwise', 'parfor', 'persistent', 'return', 'spmd', 'switch', 'try', 'while',
]);
export const MINIMUM_REPORT_VISUALS = 20;
export const MINIMUM_REPORT_HEADINGS = 28;
export const MINIMUM_MARKDOWN_BYTES = 18_000;
export const MINIMUM_HTML_BYTES = 32_000;
export const MINIMUM_HTML_FIGURES = 24;
export const MINIMUM_CHART_TYPES = 10;
export const MINIMUM_ANALYTICAL_CLAIMS = 15;
export const MINIMUM_COMPARISONS = 9;
export const MINIMUM_EVIDENCE_MARKERS = 15;
export const REQUIRED_REPORT_ZONES = 9;
export const REQUIRED_REPORT_ZONE_NAMES = Object.freeze(['西北', '北', '东北', '西', '中间', '东', '西南', '南', '东南']);
export const REQUIRED_MATLAB_REPORT_RELEASES = Object.freeze(['R2021a', 'R2024b', 'R2026a']);
export const REQUIRED_REPORT_EXPORT_FORMATS = Object.freeze(['png', 'pdf']);
export const MINIMUM_INTERACTIVE_FIGURES = 1;
export const FULL_OCEAN_OBSERVATION_REPORT_SPEC_PROMPT = [
  OCEAN_REPORT_SPEC,
  UNIVERSAL_OCEAN_REPORT_SPEC,
  WIND_REPORT_SPEC,
  OCEAN_VARIABLE_REPORT_SPEC,
  PHYSICAL_OCEANOGRAPHY_SPEC,
  PROFESSIONAL_VISUALIZATION_SPEC,
  EDITORIAL_STYLE_SPEC,
  PHYSICAL_INTERPRETATION_IMPACT_SPEC,
  ANOMALY_LINKAGE_REPORT_SPEC,
  POINT_TEMPERATURE_INTERACTION_SPEC,
].join('\n\n');

export function createIllustratedReportContract(generatedRoot, requestedId = '') {
  const reportId = REPORT_ID_PATTERN.test(String(requestedId || '').trim())
    ? String(requestedId).trim()
    : `visual-report-${compactTimestamp(new Date())}-${randomUUID().slice(0, 8)}`;
  const relativePaths = [
    `generated/${reportId}.html`,
    `generated/${reportId}.md`,
  ];
  const fileNames = relativePaths.map((value) => value.slice('generated/'.length));
  return {
    id: reportId,
    relativePaths,
    absolutePaths: fileNames.map((fileName) => path.join(generatedRoot, fileName)),
    minimumVisuals: MINIMUM_REPORT_VISUALS,
    minimumHeadings: MINIMUM_REPORT_HEADINGS,
    minimumMarkdownBytes: MINIMUM_MARKDOWN_BYTES,
    minimumHtmlBytes: MINIMUM_HTML_BYTES,
    minimumHtmlFigures: MINIMUM_HTML_FIGURES,
    minimumChartTypes: MINIMUM_CHART_TYPES,
    minimumAnalyticalClaims: MINIMUM_ANALYTICAL_CLAIMS,
    minimumComparisons: MINIMUM_COMPARISONS,
    minimumEvidenceMarkers: MINIMUM_EVIDENCE_MARKERS,
    requiredZoneCount: REQUIRED_REPORT_ZONES,
    requiredZoneNames: REQUIRED_REPORT_ZONE_NAMES,
    requiredMatlabReleases: REQUIRED_MATLAB_REPORT_RELEASES,
    requiredExportFormats: REQUIRED_REPORT_EXPORT_FORMATS,
    minimumInteractiveFigures: MINIMUM_INTERACTIVE_FIGURES,
    requiresPointInventory: true,
    requiresWindAnalysis: true,
    requiresVariableAnalysis: true,
    requiresPhysicalOceanography: true,
    visualPrefix: `generated/${reportId}-visual-`,
    absoluteVisualPrefix: path.join(generatedRoot, `${reportId}-visual-`),
  };
}

export function illustratedReportInstructions(contract) {
  const [htmlPath, markdownPath] = contract.absolutePaths;
  return [
    '',
    'MANDATORY ILLUSTRATED REPORT CONTRACT:',
    FULL_OCEAN_OBSERVATION_REPORT_SPEC_PROMPT,
    `Report id: ${contract.id}`,
    `Create the self-contained HTML report at ${htmlPath}.`,
    `Create the matching Markdown report at ${markdownPath}.`,
    `Create at least ${contract.minimumVisuals} substantial visual assets. There is no fixed maximum: use as many as the topic needs for a rich visual narrative.`,
    `Every visual asset filename must begin with ${contract.absoluteVisualPrefix} followed by a two-digit sequence and a suitable .svg, .png, .jpg, .jpeg, .webp, or .gif extension.`,
    `Use at least ${contract.minimumChartTypes} distinct professional chart types and the mandatory spatial, temporal, profile, directional, uncertainty and physics chart families. Every HTML figure must declare data-chart-type, data-chart-family and data-source, and include a substantive figcaption.`,
    'Visuals must carry real explanatory value and be grounded in the report evidence. Do not use empty placeholders, repeated decorative graphics, or meaningless stock-like imagery.',
    'Every scientific conclusion must be encoded on a real HTML element with a unique data-claim-id, space-separated data-evidence-ids, and a substantive data-limitations value. Report prose, comments, hidden text, self-ratings, or statements that a check passed are not evidence.',
    'Every analytical <figure> must declare a unique data-figure-id matching a figure id in the freshly generated manifest, and its figcaption must state what is shown, the evidence window/sample/QC context, the supported conclusion, and limitations. A filename mention without a matching checked artifact does not establish correspondence.',
    'Every analytical <figure> must also declare data-snapshot-id, data-variable, data-unit, data-time-start, data-time-end, data-spatial-coverage, data-qc-summary, data-uncertainty, data-uncertainty-status, data-uncertainty-method, data-anomaly-status and data-matlab-release. These values must agree with the figure scientific_context and runtime evidence in figures.json.',
    'data-uncertainty-status must exactly match the declared present/absent/unknown/not-evaluated status; data-uncertainty-method must exactly match the complete declared method. Only leading/trailing whitespace is trimmed; case and internal whitespace remain significant. data-uncertainty must retain a nonempty natural-language explanation, but cannot substitute for either machine field. Matching machine fields does not certify that the narrative is free of contradictions.',
    'Coverage timestamps must be calendar-valid date-only or ISO seconds with at most three fractional digits and an optional legal offset; timestamps without a suffix use the declared UTC timezone. Main HTML time endpoints must match their figure declarations literally. Each interactive HTML export must represent the same start/end instants as its owning figure. Requested, effective and individual figure windows need not be identical.',
    `The manifest ocean_report object must record the named sea area, numeric bounds, all ${contract.requiredZoneCount} named zones, requested and effective UTC coverage, data sources with versions/access times, variables with quantities/units/source ids, and explicit anomaly, uncertainty and conclusion limitations. Unknown or unavailable evidence must remain explicit rather than fabricated.`,
    `Every figure must provide freshly hashed ${contract.requiredExportFormats.join(' and ').toUpperCase()} exports from the same snapshot. At least ${contract.minimumInteractiveFigures} point-capable figure must additionally provide a self-contained HTML export that passes complete hover/focus, stable ObservationID, scientific-context and MATLAB-evidence checks.`,
    `The manifest matlab_ci matrix must contain ${contract.requiredMatlabReleases.join(', ')} exactly once in required_releases and in runs. Each release must identify MATLAB as the authoritative runtime, record a reproducible command and toolboxes, and prove execution, artifact validation and visual inspection passed. Duplicate or conflicting release records, pending, static-only, failed or Octave evidence must not satisfy the report gate.`,
    'Manifest figure ids, data-source ids and variable names must be nonempty and unique. Every variable source_ids entry must reference a declared data source; mixed invalid entries or ambiguous identifiers do not establish an evidence link.',
    'Each figure scientific_context.variables list must use unique names from ocean_report.variables with exactly matching units. A figure may use an ordered subset of the catalog, but an unknown variable, conflicting unit or ambiguous catalog entry must fail validation. HTML attributes must still reference a variable in that same figure.',
    'Freeze scripts, reports, and visual artifacts first, then generate the manifest last. The manifest generated_at and file mtime must not predate any referenced report or artifact, and every declared byte count and SHA-256 must match the current file.',
    'Make the HTML publication-quality and responsive: include a strong cover, executive summary, table of contents, clearly paced sections, highlighted findings, captions, source notes, methodology, limitations, and references when evidence is available.',
    `This is a deep report, not a short briefing: the Markdown must be at least ${contract.minimumMarkdownBytes} bytes, the HTML at least ${contract.minimumHtmlBytes} bytes, and the main report must contain at least ${contract.minimumHeadings} meaningful section headings and ${contract.minimumHtmlFigures} figure/visual placements. Expand the analysis with real evidence, comparisons, mechanisms, uncertainty, data tables, and an appendix; never pad with repeated sentences.`,
    `Analysis is mandatory: include at least ${contract.minimumAnalyticalClaims} explicit analytical claims, ${contract.minimumComparisons} quantified comparisons, and ${contract.minimumEvidenceMarkers} evidence citations/record references. Every claim must answer what changed, where, when, by how much, compared with what, why it may matter, and how certain the conclusion is. A list of observations without comparisons or interpretation does not pass.`,
    `Spatial refinement is mandatory: locate and label the analysis center point, render the 3x3 index map, and explicitly cover all ${contract.requiredZoneCount} zones (西北、北、东北、西、中间、东、西南、南、东南) in the Markdown and HTML.`,
    'Point-observation accounting is mandatory: reconcile raw records, valid records and unique stations/platforms; provide a nine-zone point-count and density table; report QC, freshness, unassigned/out-of-bounds records, sampling bias and zero-versus-unknown semantics.',
    'Wind analysis is mandatory: distinguish requested/effective windows and timestamps/intervals; audit vector versus component counts, zero masks and area weighting; report speed, u/v, direction, directional constancy, nine-zone statistics, previous-window comparison and in-situ validation limits.',
    'All other numerical variables require the same rigor: define physical quantity and units, reconcile raw/sample/valid/missing/masked/zero counts, report requested versus effective space-time-depth coverage, weighting, nine-zone statistics, previous-window or baseline comparison, point validation and explicit unavailable-data downgrades.',
    'Physical-oceanography reasoning is mandatory: call ocean_physics_diagnostics for reproducible calculations; report center-point rotation parameters, U-L-H-T scales, Rossby number, applicable Froude/Burger/deformation-radius diagnostics, governing-balance ranking, nine-zone mechanism regimes, sensitivity, uncertainty and falsifiable alternatives.',
    'Editorial quality is mandatory: use direct professional Chinese. The report must contain no defensive constructions such as 不是…而是, 并非…而是, 不只是 or 不仅仅是; no canned AI transitions such as 值得注意的是, 总体来看 or 综上所述; and no colloquial single-character action verbs used to drive sentences. Academic notation and formal scientific verbs remain valid.',
    `Every analytical figure must be followed by a figure-interpretation section linked through data-figure-id. Each interpretation must contain observation, physical-mechanism, operational-meaning, uncertainty and validation data-role paragraphs. At least ${contract.minimumHtmlFigures} complete interpretation blocks are required.`,
    'Cross-variable contradictions require explicit diagnosis. For wind-wave reports, quantify the Hs-squared wave-energy implication, align common windows, examine direction/fetch/swell and lag, and separate conditional operational exposure from unsupported loss or warning claims.',
    'Anomaly linkage is mandatory: call ocean_anomaly_point_linkage, rank the global top 10 and each zone top 3, report score components, and list nearby platforms with distance, time difference, depth difference, QC, source independence and L1-L5 linkage level. Same-source products never count as independent validation.',
    'Use an intentional multi-tone visual system, readable typography, generous spacing, restrained motion, print styles, and coherent art direction suited to the chosen topic. Avoid generic dashboard grids and excessive card decoration.',
    'For MATLAB-authoritative work, only a real MathWorks MATLAB run can verify rendering, export, fonts, interaction, or visual quality. GNU Octave output may be retained only as separately labelled compatibility evidence and must never satisfy MATLAB runtime gates.',
    'The HTML must remain fully usable offline. Inline every visual in the HTML as SVG markup or a data URI while also keeping the separate visual files as deliverables.',
    `Before answering, verify the content quality gates: the HTML, Markdown, and at least ${contract.minimumVisuals} non-empty visual files exist; byte length, heading count, figure count, analytical-claim count, comparison count, and evidence-marker count meet the minimums; every important section contains specific evidence or an explicit data limitation. In the final answer list the main report paths and summarize the visual assets.`,
  ].join('\n');
}

export function inspectIllustratedReportEvidence(options = {}) {
  const outputDirectory = inspectOutputDirectory(options.outputDirectory);
  const scoped = options.expectedReportId !== undefined;
  const expectedNames = {
    htmlPath: `${options.expectedReportId}.html`,
    markdownPath: `${options.expectedReportId}.md`,
    manifestPath: `${options.expectedReportId}-figures.json`,
  };
  const inputPaths = Object.fromEntries(['htmlPath', 'markdownPath', 'manifestPath'].map((name) => [
    name, scoped && (!validReportId(options.expectedReportId)
      || !outputDirectory.ok || resolvePath(options[name]) !== path.join(outputDirectory.directory, expectedNames[name]))
      ? rejectedEvidencePath('report_id_mismatch') : inspectEvidencePath(options[name], outputDirectory),
  ]));
  const inputPathsOk = outputDirectory.ok && Object.values(inputPaths).every((location) => location.ok);
  const pathViolations = [
    ...outputDirectory.violations.map((violation) => `outputDirectory.${violation}`),
    ...Object.entries(inputPaths).flatMap(([name, location]) => location.violations.map((violation) => `${name}.${violation}`)),
  ];
  const toleranceMs = positiveInteger(options.freshnessToleranceMs, 2_000);
  const htmlContents = readEvidence(inputPaths.htmlPath);
  const markdownContents = readEvidence(inputPaths.markdownPath);
  const html = htmlContents?.toString('utf8') || '';
  const markdown = markdownContents?.toString('utf8') || '';
  const manifestRead = readJson(inputPaths.manifestPath);
  const inputReads = { htmlPath: htmlContents !== undefined, markdownPath: markdownContents !== undefined, manifestPath: manifestRead.readOk };
  const pathsOk = inputPathsOk && (!scoped || Object.values(inputReads).every(Boolean));
  if (scoped) {
    for (const [name, readOk] of Object.entries(inputReads)) {
      if (inputPaths[name].ok && !readOk) pathViolations.push(`${name}.unreadable`);
    }
  }
  const manifest = manifestRead.value;
  const htmlEvidence = parseOceanReportHtml(html);
  const { figures, claims } = htmlEvidence;
  const manifestFigures = Array.isArray(manifest?.figures) ? manifest.figures : [];
  const oceanReportAudit = inspectOceanReportMetadata(manifest?.ocean_report);
  const matlabRuntimeAudit = inspectMatlabRuntimeMatrix(manifest?.matlab_ci);
  const manifestFigureIds = new Set(manifestFigures.map((figure) => stringValue(figure?.id)).filter(Boolean));
  const declaredEvidenceIds = new Set([
    ...manifestFigureIds,
    ...htmlEvidence.evidence
      .map((entry) => stringValue(entry.attributes['data-evidence-id']))
      .filter(Boolean),
  ]);
  const claimIds = claims.map((entry) => stringValue(entry.attributes['data-claim-id'])).filter(Boolean);
  const claimViolations = claims.flatMap((entry, index) => {
    const evidenceIds = tokenList(entry.attributes['data-evidence-ids']);
    const violations = [];
    if (!stringValue(entry.attributes['data-claim-id'])) violations.push(`claims[${index}].id`);
    if (evidenceIds.length === 0) violations.push(`claims[${index}].evidence_ids`);
    if (evidenceIds.some((id) => !declaredEvidenceIds.has(id))) violations.push(`claims[${index}].evidence_missing`);
    if (stringValue(entry.attributes['data-limitations']).length < 12) violations.push(`claims[${index}].limitations`);
    return violations;
  });
  if (new Set(claimIds).size !== claimIds.length) claimViolations.push('claims.id.duplicate');

  const figureIds = figures.map((entry) => stringValue(entry.attributes['data-figure-id'])).filter(Boolean);
  const figureViolations = figures.flatMap((entry, index) => {
    const id = stringValue(entry.attributes['data-figure-id']);
    const manifestFigure = manifestFigures.find((figure) => stringValue(figure?.id) === id);
    const caption = entry.caption;
    const violations = [];
    if (!id) violations.push(`figures[${index}].id`);
    else if (!manifestFigureIds.has(id)) violations.push(`figures[${index}].manifest_link`);
    if (caption.length < 40) violations.push(`figures[${index}].caption`);
    for (const attribute of [
      'data-snapshot-id', 'data-variable', 'data-unit', 'data-time-start', 'data-time-end',
      'data-spatial-coverage', 'data-qc-summary', 'data-uncertainty', 'data-uncertainty-status',
      'data-uncertainty-method', 'data-anomaly-status',
      'data-matlab-release',
    ]) {
      if (!stringValue(entry.attributes[attribute])) violations.push(`figures[${index}].${attribute}`);
    }
    if (manifestFigure) violations.push(...inspectHtmlFigureCorrespondence(entry, manifestFigure, index, matlabRuntimeAudit));
    return violations;
  });
  if (new Set(figureIds).size !== figureIds.length) figureViolations.push('figures.id.duplicate');

  const reportVariables = Array.isArray(manifest?.ocean_report?.variables) ? manifest.ocean_report.variables : [];
  const figureEvidence = manifestFigures.map((figure, figureIndex) => inspectFigureScientificEvidence(figure, figureIndex, reportVariables));
  const figureEvidenceViolations = figureEvidence.flatMap((entry) => entry.violations);
  const nonemptyManifestFigureIds = manifestFigures.map((figure) => stringValue(figure?.id)).filter(Boolean);
  if (manifestFigureIds.size !== nonemptyManifestFigureIds.length) figureEvidenceViolations.push('manifest.figures.id.duplicate');
  const declaredArtifacts = manifestFigures.flatMap((figure, figureIndex) => normalizeReportExports(figure?.exports)
    .map((artifact, artifactIndex) => ({
      artifact,
      figure,
      id: `figures[${figureIndex}].exports[${artifactIndex}]`,
    })));
  const artifactPaths = scoped
    ? inspectScopedArtifactPaths(manifestFigures, declaredArtifacts, outputDirectory, options.expectedReportId, pathsOk)
    : undefined;
  const artifactChecks = declaredArtifacts.map((entry, index) => inspectReportArtifact({
    ...entry,
    outputDirectory,
    location: artifactPaths?.locations[index],
    allowRead: !scoped || (pathsOk && artifactPaths.ok),
  }));
  if (scoped && pathsOk && artifactPaths.ok) {
    for (const artifact of artifactChecks) {
      if (!artifact.readOk) artifactPaths.violations.push(`${artifact.id}.unreadable`);
    }
    artifactPaths.ok = artifactPaths.violations.length === 0;
  }
  const interactiveChecks = artifactChecks.filter((artifact) => artifact.format === 'html');
  const reportFiles = [inputPaths.htmlPath, inputPaths.markdownPath].map((location) => ({
    file: location.file, ...location.info,
  }));
  const freshness = inspectReportFreshness({
    generatedAt: manifest?.generated_at,
    manifest: inputPaths.manifestPath.info,
    files: [...reportFiles, ...artifactChecks.map((artifact) => ({
      file: artifact.file,
      present: artifact.present,
      mtimeMs: artifact.mtimeMs,
    }))],
    toleranceMs,
  });
  const contentOk = html.length > 0 && markdown.length > 0;
  const claimsOk = claims.length > 0 && claimViolations.length === 0;
  const figureLinksOk = figures.length > 0 && figureViolations.length === 0;
  const figureEvidenceOk = manifestFigures.length > 0 && figureEvidenceViolations.length === 0;
  const artifactsOk = (!scoped || artifactPaths.ok) && artifactChecks.length > 0 && artifactChecks.every((artifact) => artifact.ok)
    && interactiveChecks.length >= MINIMUM_INTERACTIVE_FIGURES;
  return {
    ok: pathsOk && contentOk && htmlEvidence.ok && manifestRead.ok && claimsOk && figureLinksOk && figureEvidenceOk
      && artifactsOk && freshness.ok && oceanReportAudit.ok && matlabRuntimeAudit.ok,
    pathsOk,
    pathViolations,
    contentOk,
    htmlParsingOk: htmlEvidence.ok,
    htmlParsingViolations: htmlEvidence.violations,
    manifestOk: manifestRead.ok,
    claimsOk,
    claimCount: claims.length,
    claimViolations,
    figureLinksOk,
    figureCount: figures.length,
    figureViolations,
    figureEvidenceOk,
    figureEvidence,
    figureEvidenceViolations,
    artifactsOk,
    artifactChecks,
    ...(scoped ? { artifactPathsOk: artifactPaths.ok, artifactPathViolations: artifactPaths.violations } : {}),
    interactiveFigureCount: interactiveChecks.length,
    oceanReportOk: oceanReportAudit.ok,
    oceanReport: oceanReportAudit,
    matlabRuntimeOk: matlabRuntimeAudit.ok,
    matlabRuntime: matlabRuntimeAudit,
    manifestFreshnessOk: freshness.ok,
    freshness,
  };
}

export function inspectReportMatlabSources({ outputDirectory: directory, expectedReportId } = {}) {
  const outputDirectory = inspectOutputDirectory(directory);
  const violations = [...outputDirectory.violations];
  const sourcePaths = [];
  if (!validReportId(expectedReportId)) violations.push('report_id_invalid');
  if (violations.length === 0) {
    try {
      const entries = readdirSync(outputDirectory.directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === `${expectedReportId}-matlab`) {
          const scoped = inspectDirectMatlabSourceDirectory(entry.name, outputDirectory);
          sourcePaths.push(...scoped.sourcePaths);
          violations.push(...scoped.violations);
          continue;
        }
        if (!entry.name.startsWith(`${expectedReportId}-`) || !/\.m$/iu.test(entry.name)) continue;
        const location = inspectEvidencePath(entry.name, outputDirectory, true);
        if (!location.ok || readEvidence(location) === undefined) {
          violations.push(`${entry.name}.${location.violations.join('.') || 'unreadable'}`);
        } else sourcePaths.push(location.file);
      }
    } catch {
      violations.push('unavailable');
    }
  }
  if (sourcePaths.length === 0) violations.push('missing');
  return { ok: violations.length === 0, sourcePaths: sourcePaths.sort(), violations };
}

function inspectDirectMatlabSourceDirectory(relativeDirectory, outputDirectory) {
  const sourcePaths = [];
  const violations = [];
  const directory = inspectOutputDirectory(path.join(outputDirectory.directory, relativeDirectory));
  if (!directory.ok) {
    return { sourcePaths, violations: directory.violations.map(violation => `${relativeDirectory}.${violation}`) };
  }
  const unchanged = () => {
    const current = inspectOutputDirectory(directory.directory);
    return current.ok && current.realDirectory === directory.realDirectory
      && pathInside(outputDirectory.realDirectory, current.realDirectory)
      && sameFileIdentity(current.identity, directory.identity);
  };
  try {
    const entries = readdirSync(directory.directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!unchanged()) {
        violations.push(`${relativeDirectory}.directory_changed`);
        break;
      }
      const relative = `${relativeDirectory}/${entry.name}`;
      if (!MATLAB_COMPATIBLE_SOURCE_NAME.test(entry.name) || MATLAB_KEYWORDS.has(entry.name.slice(0, -2))) {
        violations.push(`${relative}.invalid_source_name`);
        continue;
      }
      const location = inspectEvidencePath(relative, outputDirectory, true);
      if (location.ok && location.identity.nlink !== 1) {
        violations.push(`${relative}.hardlink`);
      } else if (!location.ok || readEvidence(location) === undefined) {
        violations.push(`${relative}.${location.violations.join('.') || 'unreadable'}`);
      } else sourcePaths.push(location.file);
    }
    if (!unchanged() && !violations.includes(`${relativeDirectory}.directory_changed`)) {
      violations.push(`${relativeDirectory}.directory_changed`);
    }
  } catch {
    violations.push(`${relativeDirectory}.unavailable`);
  }
  return { sourcePaths, violations };
}

function validReportId(value) {
  return typeof value === 'string' && REPORT_ID_PATTERN.test(value);
}

function rejectedEvidencePath(violation) {
  return { ok: false, violations: [violation], info: { present: false, bytes: 0, mtimeMs: 0 } };
}

function inspectScopedReference(value, outputDirectory, reportId) {
  if (!validReportId(reportId)) return rejectedEvidencePath('report_id_invalid');
  if (typeof value !== 'string' || !value || value !== value.trim()) return rejectedEvidencePath('invalid_reference');
  if (path.isAbsolute(value) || path.win32.isAbsolute(value)) return rejectedEvidencePath('absolute');
  if (value.split(/[\\/]/u).includes('..')) return rejectedEvidencePath('traversal');
  const basename = path.basename(value);
  if (value.includes('\\') || (!basename.startsWith(`${reportId}-`) && basename !== `${reportId}.html`)) {
    return rejectedEvidencePath('report_id_mismatch');
  }
  return inspectEvidencePath(value, outputDirectory, true);
}

function inspectScopedArtifactPaths(figures, declarations, outputDirectory, reportId, readAuxiliary) {
  const violations = [];
  const auxiliaryLocations = [];
  const inspectAuxiliary = (value, id) => {
    const location = inspectScopedReference(value, outputDirectory, reportId);
    violations.push(...location.violations.map((violation) => `${id}.${violation}`));
    auxiliaryLocations.push({ location, id });
  };
  figures.forEach((figure, index) => {
    const exports = figure?.exports;
    const entries = Array.isArray(exports) ? exports : exports && typeof exports === 'object' ? Object.values(exports) : [];
    if (entries.length !== normalizeReportExports(exports).length) violations.push(`figures[${index}].exports.invalid`);
    for (const field of ['file', 'text_file']) {
      if (figure && Object.hasOwn(figure, field)) inspectAuxiliary(figure[field], `figures[${index}].${field}`);
    }
  });
  const locations = declarations.map(({ artifact, id }) => {
    const location = inspectScopedReference(artifact.file, outputDirectory, reportId);
    violations.push(...location.violations.map((violation) => `${id}.${violation}`));
    if (Object.hasOwn(artifact, 'text_file')) {
      inspectAuxiliary(artifact.text_file, `${id}.text_file`);
    }
    return location;
  });
  if (readAuxiliary && violations.length === 0) {
    for (const { location, id } of auxiliaryLocations) {
      if (readEvidence(location) === undefined) violations.push(`${id}.unreadable`);
    }
  }
  return { ok: violations.length === 0, violations, locations };
}

function normalizeReportExports(exportsValue) {
  if (Array.isArray(exportsValue)) return exportsValue.filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({ ...entry, format: stringValue(entry.format) || extensionFormat(entry.file) }));
  if (!exportsValue || typeof exportsValue !== 'object') return [];
  return Object.entries(exportsValue).filter(([, entry]) => entry && typeof entry === 'object')
    .map(([format, entry]) => ({ ...entry, format: stringValue(entry.format) || format.toLowerCase() }));
}

function inspectReportArtifact({ artifact, figure, outputDirectory, id, location: checkedLocation, allowRead = true }) {
  const relative = stringValue(artifact?.file);
  const location = checkedLocation || inspectEvidencePath(relative, outputDirectory, true);
  const { file, info } = location;
  const contents = allowRead ? readEvidence(location) : undefined;
  const format = (stringValue(artifact?.format) || extensionFormat(relative)).toLowerCase();
  const bytesOk = info.present && Number.isInteger(artifact?.bytes) && artifact.bytes === info.bytes;
  const hashOk = info.present && /^[a-f\d]{64}$/iu.test(String(artifact?.sha256 || ''))
    && contents !== undefined && createHash('sha256').update(contents).digest('hex') === String(artifact.sha256).toLowerCase();
  const metadataViolations = inspectArtifactMetadata(artifact, format);
  const interactionQuality = format === 'html' && contents !== undefined ? inspectPointInteractionQuality({
    html: contents.toString('utf8'),
    htmlPath: file,
    requireScientificEvidence: true,
    requireMatlabEvidence: true,
  }) : undefined;
  if (format === 'html' && interactionQuality) {
    const context = interactionQuality.scientificContext;
    const coverage = figure?.scientific_context?.temporal_coverage;
    if (!/^UTC(?:[+-]00(?::?00)?)?$/iu.test(stringValue(context?.timezone))) {
      metadataViolations.push('html.temporal_coverage.timezone');
    }
    for (const [field, contextField] of [['start', 'timeStart'], ['end', 'timeEnd']]) {
      const actual = parseOceanEvidenceTime(stringValue(context?.[contextField]), stringValue(context?.timezone));
      const expected = parseOceanEvidenceTime(stringValue(coverage?.[field]), stringValue(coverage?.timezone));
      if (!Number.isFinite(actual) || !Number.isFinite(expected) || actual !== expected) {
        metadataViolations.push(`html.temporal_coverage.${field}.mismatch`);
      }
    }
  }
  const interactionOk = format !== 'html' || interactionQuality?.pointInteractionQualityOk === true;
  return {
    id, file, format, ...info, pathOk: location.ok, pathViolations: location.violations, bytesOk, hashOk,
    readOk: contents !== undefined,
    metadataOk: metadataViolations.length === 0, metadataViolations,
    interactionOk, interactionQuality,
    ok: location.ok && bytesOk && hashOk && metadataViolations.length === 0 && interactionOk,
  };
}

function inspectOceanReportMetadata(report) {
  const violations = [];
  if (!report || typeof report !== 'object') return { ok: false, violations: ['ocean_report.missing'] };
  if (!stringValue(report.area?.name)) violations.push('ocean_report.area.name');
  if (!validBounds(report.area?.bounds)) violations.push('ocean_report.area.bounds');
  const zones = Array.isArray(report.area?.zones) ? report.area.zones.map(stringValue).filter(Boolean) : [];
  for (const zone of REQUIRED_REPORT_ZONE_NAMES) if (!zones.includes(zone)) violations.push(`ocean_report.area.zones.${zone}`);
  inspectCoverage(report.requested_coverage, 'ocean_report.requested_coverage', violations, true);
  inspectCoverage(report.effective_coverage, 'ocean_report.effective_coverage', violations, true);
  const sources = Array.isArray(report.data_sources) ? report.data_sources : [];
  if (sources.length === 0) violations.push('ocean_report.data_sources');
  const sourceIds = new Set();
  sources.forEach((source, index) => {
    for (const key of ['id', 'name', 'version', 'accessed_at']) if (!stringValue(source?.[key])) violations.push(`ocean_report.data_sources[${index}].${key}`);
    if (stringValue(source?.accessed_at) && !Number.isFinite(Date.parse(source.accessed_at))) violations.push(`ocean_report.data_sources[${index}].accessed_at.invalid`);
    const sourceId = stringValue(source?.id);
    if (sourceId && sourceIds.has(sourceId)) violations.push(`ocean_report.data_sources[${index}].id.duplicate`);
    if (sourceId) sourceIds.add(sourceId);
  });
  const variables = Array.isArray(report.variables) ? report.variables : [];
  if (variables.length === 0) violations.push('ocean_report.variables');
  const variableNames = new Set();
  variables.forEach((variable, index) => {
    for (const key of ['name', 'quantity', 'unit']) if (!stringValue(variable?.[key])) violations.push(`ocean_report.variables[${index}].${key}`);
    const variableName = stringValue(variable?.name);
    if (variableName && variableNames.has(variableName)) violations.push(`ocean_report.variables[${index}].name.duplicate`);
    if (variableName) variableNames.add(variableName);
    if (!Array.isArray(variable?.source_ids) || variable.source_ids.length === 0) {
      violations.push(`ocean_report.variables[${index}].source_ids`);
    } else {
      const referencedSources = new Set();
      variable.source_ids.forEach((value, sourceIndex) => {
        const sourceId = stringValue(value);
        const prefix = `ocean_report.variables[${index}].source_ids[${sourceIndex}]`;
        if (!sourceId) violations.push(prefix);
        else if (!sourceIds.has(sourceId)) violations.push(`${prefix}.unknown_reference`);
        if (sourceId && referencedSources.has(sourceId)) violations.push(`${prefix}.duplicate`);
        if (sourceId) referencedSources.add(sourceId);
      });
    }
  });
  inspectExplicitAssessment(report.anomaly, 'ocean_report.anomaly', violations);
  inspectExplicitAssessment(report.uncertainty, 'ocean_report.uncertainty', violations);
  if (report.conclusion?.status !== 'audited') violations.push('ocean_report.conclusion.status');
  if (stringValue(report.conclusion?.limitations).length < 12) violations.push('ocean_report.conclusion.limitations');
  return { ok: violations.length === 0, violations, zoneCount: zones.length, sourceCount: sources.length, variableCount: variables.length };
}

function inspectMatlabRuntimeMatrix(matrix) {
  const violations = [];
  if (!matrix || typeof matrix !== 'object') return { ok: false, violations: ['matlab_ci.missing'], releases: {} };
  const required = Array.isArray(matrix.required_releases) ? matrix.required_releases.map(stringValue) : [];
  if (required.some((release) => !release)) violations.push('matlab_ci.required_releases.invalid');
  if (new Set(required).size !== required.length) violations.push('matlab_ci.required_releases.duplicate');
  for (const release of REQUIRED_MATLAB_REPORT_RELEASES) if (!required.includes(release)) violations.push(`matlab_ci.required_releases.${release}`);
  const runs = Array.isArray(matrix.runs) ? matrix.runs : [];
  const runCounts = new Map();
  runs.forEach((run, index) => {
    const release = stringValue(run?.release);
    if (!release) violations.push(`matlab_ci.runs[${index}].release`);
    else runCounts.set(release, (runCounts.get(release) || 0) + 1);
  });
  for (const [release, count] of runCounts) if (count > 1) violations.push(`matlab_ci.runs.${release}.duplicate`);
  const releases = {};
  for (const release of REQUIRED_MATLAB_REPORT_RELEASES) {
    if ((runCounts.get(release) || 0) > 1) continue;
    const run = runs.find((entry) => stringValue(entry?.release) === release);
    releases[release] = run;
    if (!run) { violations.push(`matlab_ci.runs.${release}.missing`); continue; }
    if (run.authoritative_runtime !== 'MATLAB') violations.push(`matlab_ci.runs.${release}.runtime`);
    if (run.runtime_status !== 'passed') violations.push(`matlab_ci.runs.${release}.status`);
    if (run.execution_verified !== true) violations.push(`matlab_ci.runs.${release}.execution_verified`);
    if (!stringValue(run.command)) violations.push(`matlab_ci.runs.${release}.command`);
    if (!Array.isArray(run.toolboxes) || run.toolboxes.length === 0 || run.toolboxes.some((toolbox) => !stringValue(toolbox))) violations.push(`matlab_ci.runs.${release}.toolboxes`);
    if (run.artifact_validation?.status !== 'passed') violations.push(`matlab_ci.runs.${release}.artifact_validation`);
    if (run.visual_inspection?.status !== 'passed') violations.push(`matlab_ci.runs.${release}.visual_inspection`);
    if (!stringValue(run.evidence_id)) violations.push(`matlab_ci.runs.${release}.evidence_id`);
  }
  return { ok: violations.length === 0, violations, releases };
}

function inspectFigureScientificEvidence(figure, index, reportVariables) {
  const violations = [];
  const prefix = `manifest.figures[${index}]`;
  if (!stringValue(figure?.id)) violations.push(`${prefix}.id`);
  if (!stringValue(figure?.source)) violations.push(`${prefix}.source`);
  const context = figure?.scientific_context;
  if (!stringValue(context?.snapshot_id)) violations.push(`${prefix}.scientific_context.snapshot_id`);
  const variables = Array.isArray(context?.variables) ? context.variables : [];
  if (variables.length === 0) violations.push(`${prefix}.scientific_context.variables`);
  const variableNames = new Set();
  variables.forEach((variable, variableIndex) => {
    const variablePrefix = `${prefix}.scientific_context.variables[${variableIndex}]`;
    const name = stringValue(variable?.name);
    const unit = stringValue(variable?.unit);
    if (!name) violations.push(`${variablePrefix}.name`);
    if (!unit) violations.push(`${variablePrefix}.unit`);
    if (!name) return;
    if (variableNames.has(name)) violations.push(`${variablePrefix}.name.duplicate`);
    variableNames.add(name);
    const definitions = reportVariables.filter((candidate) => stringValue(candidate?.name) === name);
    if (definitions.length === 0) violations.push(`${variablePrefix}.name.unknown_reference`);
    else if (definitions.length !== 1) violations.push(`${variablePrefix}.name.ambiguous_reference`);
    else if (unit && unit !== stringValue(definitions[0]?.unit)) violations.push(`${variablePrefix}.unit.mismatch`);
  });
  inspectCoverage(context?.temporal_coverage, `${prefix}.scientific_context.temporal_coverage`, violations);
  if (!stringValue(context?.spatial_coverage?.name) || !validBounds(context?.spatial_coverage?.bounds)) violations.push(`${prefix}.scientific_context.spatial_coverage`);
  for (const key of ['raw', 'valid', 'missing', 'qc_rejected']) if (!Number.isInteger(context?.qc?.[key]) || context.qc[key] < 0) violations.push(`${prefix}.scientific_context.qc.${key}`);
  inspectExplicitAssessment(context?.uncertainty, `${prefix}.scientific_context.uncertainty`, violations);
  inspectExplicitAssessment(context?.anomaly, `${prefix}.scientific_context.anomaly`, violations);
  const exports = normalizeReportExports(figure?.exports);
  const formats = exports.map((artifact) => artifact.format);
  for (const format of REQUIRED_REPORT_EXPORT_FORMATS) if (!formats.includes(format)) violations.push(`${prefix}.exports.${format}`);
  exports.forEach((artifact, artifactIndex) => {
    if (stringValue(artifact?.snapshot_id) !== stringValue(context?.snapshot_id)) violations.push(`${prefix}.exports[${artifactIndex}].snapshot_id`);
  });
  const runtime = figure?.runtime;
  if (runtime?.authoritative_runtime !== 'MATLAB') violations.push(`${prefix}.runtime.authoritative_runtime`);
  if (!REQUIRED_MATLAB_REPORT_RELEASES.includes(stringValue(runtime?.matlab_release))) violations.push(`${prefix}.runtime.matlab_release`);
  if (runtime?.runtime_status !== 'passed') violations.push(`${prefix}.runtime.runtime_status`);
  if (runtime?.execution_verified !== true) violations.push(`${prefix}.runtime.execution_verified`);
  if (runtime?.artifact_validation?.status !== 'passed') violations.push(`${prefix}.runtime.artifact_validation`);
  if (runtime?.visual_inspection?.status !== 'passed') violations.push(`${prefix}.runtime.visual_inspection`);
  if (figure?.interaction?.required === true) {
    if (!formats.includes('html')) violations.push(`${prefix}.exports.html`);
    if (figure.interaction.self_contained !== true) violations.push(`${prefix}.interaction.self_contained`);
    if (figure.interaction.validation_status !== 'passed') violations.push(`${prefix}.interaction.validation_status`);
    if (stringValue(figure.interaction.snapshot_id) !== stringValue(context?.snapshot_id)) violations.push(`${prefix}.interaction.snapshot_id`);
  }
  return { id: stringValue(figure?.id), ok: violations.length === 0, violations };
}

function inspectArtifactMetadata(artifact, format) {
  const violations = [];
  if (!['png', 'pdf', 'html'].includes(format)) violations.push('format.unsupported');
  if (format === 'png') {
    for (const key of ['width', 'height', 'dpi']) if (!Number.isFinite(artifact?.[key]) || artifact[key] <= 0) violations.push(`png.${key}`);
  }
  if (format === 'pdf') {
    for (const key of ['width', 'height']) if (!Number.isFinite(artifact?.[key]) || artifact[key] <= 0) violations.push(`pdf.${key}`);
    if (!stringValue(artifact?.text) && !stringValue(artifact?.text_file)) violations.push('pdf.text_evidence');
  }
  if (format === 'html' && artifact?.self_contained !== true) violations.push('html.self_contained');
  return violations;
}

function inspectCoverage(coverage, prefix, violations, requireScope = false) {
  const start = parseOceanEvidenceTime(stringValue(coverage?.start), stringValue(coverage?.timezone));
  const end = parseOceanEvidenceTime(stringValue(coverage?.end), stringValue(coverage?.timezone));
  if (!Number.isFinite(start)) violations.push(`${prefix}.start`);
  if (!Number.isFinite(end)) violations.push(`${prefix}.end`);
  if (Number.isFinite(start) && Number.isFinite(end) && end < start) violations.push(`${prefix}.reversed`);
  if (!/^UTC(?:[+-]00(?::?00)?)?$/iu.test(stringValue(coverage?.timezone))) violations.push(`${prefix}.timezone`);
  if (requireScope && !stringValue(coverage?.spatial)) violations.push(`${prefix}.spatial`);
  if (requireScope && !stringValue(coverage?.depth)) violations.push(`${prefix}.depth`);
}

function inspectHtmlFigureCorrespondence(entry, figure, index, matlabRuntimeAudit) {
  const violations = [];
  const context = figure?.scientific_context || {};
  const attributes = entry.attributes;
  const variable = Array.isArray(context.variables)
    ? context.variables.find((candidate) => stringValue(candidate?.name) === stringValue(attributes['data-variable']))
    : undefined;
  const compare = (attribute, expected) => {
    if (stringValue(attributes[attribute]) !== stringValue(expected)) violations.push(`figures[${index}].${attribute}.mismatch`);
  };
  compare('data-snapshot-id', context.snapshot_id);
  if (!variable) violations.push(`figures[${index}].data-variable.mismatch`);
  else compare('data-unit', variable.unit);
  compare('data-time-start', context.temporal_coverage?.start);
  compare('data-time-end', context.temporal_coverage?.end);
  if (!stringValue(attributes['data-spatial-coverage']).includes(stringValue(context.spatial_coverage?.name))) {
    violations.push(`figures[${index}].data-spatial-coverage.mismatch`);
  }
  const qcCounts = parseQcSummary(attributes['data-qc-summary']);
  for (const key of ['raw', 'valid', 'missing', 'qc_rejected']) {
    if (!qcCounts || qcCounts[key] !== context.qc?.[key]) violations.push(`figures[${index}].data-qc-summary.${key}.mismatch`);
  }
  compare('data-uncertainty-status', context.uncertainty?.status);
  compare('data-uncertainty-method', context.uncertainty?.method);
  compare('data-anomaly-status', context.anomaly?.status);
  const release = stringValue(attributes['data-matlab-release']);
  if (release !== stringValue(figure.runtime?.matlab_release)
    || !matlabRuntimeAudit.releases?.[release] || matlabRuntimeAudit.releases[release].runtime_status !== 'passed') {
    violations.push(`figures[${index}].data-matlab-release.mismatch`);
  }
  return violations;
}

function parseQcSummary(value) {
  const tokens = tokenList(value);
  if (tokens.length !== 4) return undefined;
  const counts = {};
  for (const token of tokens) {
    const match = /^(raw|valid|missing|qc_rejected)=(0|[1-9][0-9]*)$/u.exec(token);
    if (!match || Object.hasOwn(counts, match[1])) return undefined;
    const count = Number(match[2]);
    if (!Number.isSafeInteger(count)) return undefined;
    counts[match[1]] = count;
  }
  return counts;
}

function inspectExplicitAssessment(value, prefix, violations) {
  if (!['present', 'absent', 'unknown', 'not-evaluated'].includes(stringValue(value?.status))) violations.push(`${prefix}.status`);
  if (!stringValue(value?.method)) violations.push(`${prefix}.method`);
  if (stringValue(value?.limitations).length < 12) violations.push(`${prefix}.limitations`);
}

function validBounds(value) {
  return Array.isArray(value) && value.length === 4 && value.every(Number.isFinite)
    && value[0] < value[2] && value[1] < value[3]
    && value[0] >= -180 && value[2] <= 180 && value[1] >= -90 && value[3] <= 90;
}

function extensionFormat(file) {
  return path.extname(stringValue(file)).slice(1).toLowerCase();
}

function pathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function inspectOutputDirectory(value) {
  const directory = resolvePath(value);
  const reject = (violation) => ({ ok: false, directory, violations: [violation] });
  if (!directory) return reject('missing');
  try {
    const filesystemRoot = path.parse(directory).root;
    let current = filesystemRoot;
    let info = lstatSync(current);
    for (const segment of path.relative(filesystemRoot, directory).split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      info = lstatSync(current);
      if (info.isSymbolicLink()) return reject('symlink');
      if (!info.isDirectory()) return reject('not_directory');
    }
    return { ok: true, directory, realDirectory: realpathSync(directory), identity: info, violations: [] };
  } catch {
    return reject('unavailable');
  }
}

function inspectEvidencePath(value, outputDirectory, relativeOnly = false) {
  const reference = stringValue(value);
  let file;
  const reject = (violation) => ({
    ok: false, file, violations: [violation], info: { present: false, bytes: 0, mtimeMs: 0 },
  });
  if (!outputDirectory.ok) return reject('output_directory_invalid');
  if (!reference) return reject('missing');
  if (relativeOnly && (path.isAbsolute(reference) || path.win32.isAbsolute(reference))) return reject('absolute');
  if (relativeOnly && reference.split(/[\\/]/u).includes('..')) return reject('traversal');
  file = relativeOnly ? path.resolve(outputDirectory.directory, reference) : path.resolve(reference);
  if (!pathInside(outputDirectory.directory, file)) return reject('outside_output_directory');
  try {
    const segments = path.relative(outputDirectory.directory, file).split(path.sep);
    let current = outputDirectory.directory;
    let info;
    for (const [index, segment] of segments.entries()) {
      current = path.join(current, segment);
      info = lstatSync(current);
      if (info.isSymbolicLink()) return reject('symlink');
      if (index < segments.length - 1 && !info.isDirectory()) return reject('not_directory');
    }
    if (!info.isFile()) return reject('not_file');
    const realFile = realpathSync(file);
    if (!pathInside(outputDirectory.realDirectory, realFile)) return reject('outside_output_directory');
    return {
      ok: true, file, realFile, outputDirectory, identity: info, violations: [],
      info: { present: true, bytes: info.size, mtimeMs: info.mtimeMs },
    };
  } catch {
    return reject('unavailable');
  }
}

function inspectReportFreshness({ generatedAt, manifest, files, toleranceMs }) {
  const violations = [];
  const generatedAtMs = Date.parse(String(generatedAt || ''));
  if (!Number.isFinite(generatedAtMs)) violations.push('generated_at.invalid');
  if (!manifest.present) violations.push('manifest.missing');
  if (Number.isFinite(generatedAtMs) && generatedAtMs > Date.now() + toleranceMs) violations.push('generated_at.future');
  if (manifest.present && Number.isFinite(generatedAtMs) && generatedAtMs > manifest.mtimeMs + toleranceMs) {
    violations.push('generated_at.after_manifest_file');
  }
  files.forEach((file, index) => {
    if (!file.present) {
      violations.push(`files[${index}].missing`);
      return;
    }
    if (Number.isFinite(generatedAtMs) && file.mtimeMs > generatedAtMs + toleranceMs) {
      violations.push(`files[${index}].newer_than_generated_at`);
    }
    if (manifest.present && file.mtimeMs > manifest.mtimeMs + toleranceMs) {
      violations.push(`files[${index}].newer_than_manifest`);
    }
  });
  return { ok: violations.length === 0 && files.length > 0, violations };
}

function readJson(location) {
  const contents = readEvidence(location);
  const readOk = contents !== undefined;
  try { return { ok: true, readOk, value: JSON.parse(contents?.toString('utf8')) }; } catch { return { ok: false, readOk }; }
}

function readEvidence(location) {
  if (!location.ok || !Number.isInteger(constants.O_NOFOLLOW)) return undefined;
  let descriptor;
  try {
    if (!evidenceLocationUnchanged(location)) return undefined;
    descriptor = openSync(location.realFile, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = fstatSync(descriptor);
    if (!info.isFile() || !sameFileIdentity(info, location.identity)
      || info.size !== location.info.bytes || info.mtimeMs !== location.info.mtimeMs
      || !evidenceLocationUnchanged(location)) return undefined;
    const contents = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) return undefined;
    return contents;
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function evidenceLocationUnchanged(location) {
  const root = inspectOutputDirectory(location.outputDirectory.directory);
  if (!root.ok || root.realDirectory !== location.outputDirectory.realDirectory
    || !sameFileIdentity(root.identity, location.outputDirectory.identity)) return false;
  const current = inspectEvidencePath(location.file, root);
  return current.ok && current.realFile === location.realFile
    && sameFileIdentity(current.identity, location.identity)
    && current.info.bytes === location.info.bytes && current.info.mtimeMs === location.info.mtimeMs;
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function resolvePath(value) {
  return stringValue(value) ? path.resolve(value) : undefined;
}

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function tokenList(value) {
  return stringValue(value).split(/\s+/u).filter(Boolean);
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function compactTimestamp(date) {
  return date.toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'z').replace('T', '-').toLowerCase();
}
