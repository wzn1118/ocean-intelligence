import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
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

const REPORT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,79}$/u;
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
  const htmlPath = resolvePath(options.htmlPath);
  const markdownPath = resolvePath(options.markdownPath);
  const manifestPath = resolvePath(options.manifestPath);
  const outputDirectory = resolvePath(options.outputDirectory)
    || (manifestPath ? path.dirname(manifestPath) : process.cwd());
  const toleranceMs = positiveInteger(options.freshnessToleranceMs, 2_000);
  const html = readText(htmlPath);
  const markdown = readText(markdownPath);
  const manifestRead = readJson(manifestPath);
  const manifest = manifestRead.value;
  const sanitizedHtml = stripNonEvidenceHtml(html);
  const figures = extractFigureBlocks(sanitizedHtml);
  const claims = extractAttributedTags(sanitizedHtml, 'data-claim-id');
  const manifestFigures = Array.isArray(manifest?.figures) ? manifest.figures : [];
  const manifestFigureIds = new Set(manifestFigures.map((figure) => stringValue(figure?.id)).filter(Boolean));
  const declaredEvidenceIds = new Set([
    ...manifestFigureIds,
    ...extractAttributedTags(sanitizedHtml, 'data-evidence-id')
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
    const caption = entry.body.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/iu)?.[1]
      ?.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim() || '';
    const violations = [];
    if (!id) violations.push(`figures[${index}].id`);
    else if (!manifestFigureIds.has(id)) violations.push(`figures[${index}].manifest_link`);
    if (caption.length < 40) violations.push(`figures[${index}].caption`);
    return violations;
  });
  if (new Set(figureIds).size !== figureIds.length) figureViolations.push('figures.id.duplicate');

  const artifactChecks = manifestFigures.flatMap((figure, figureIndex) => normalizeReportExports(figure?.exports)
    .map((artifact, artifactIndex) => inspectReportArtifact({
      artifact,
      outputDirectory,
      id: `figures[${figureIndex}].exports[${artifactIndex}]`,
    })));
  const reportFiles = [htmlPath, markdownPath].filter(Boolean).map((file) => ({ file, ...fileInfo(file) }));
  const freshness = inspectReportFreshness({
    generatedAt: manifest?.generated_at,
    manifestPath,
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
  const artifactsOk = artifactChecks.length > 0 && artifactChecks.every((artifact) => artifact.ok);
  return {
    ok: contentOk && manifestRead.ok && claimsOk && figureLinksOk && artifactsOk && freshness.ok,
    contentOk,
    manifestOk: manifestRead.ok,
    claimsOk,
    claimCount: claims.length,
    claimViolations,
    figureLinksOk,
    figureCount: figures.length,
    figureViolations,
    artifactsOk,
    artifactChecks,
    manifestFreshnessOk: freshness.ok,
    freshness,
  };
}

function stripNonEvidenceHtml(html) {
  return html
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/<script\b[\s\S]*?<\/script>/giu, '')
    .replace(/<style\b[\s\S]*?<\/style>/giu, '');
}

function extractFigureBlocks(html) {
  return [...html.matchAll(/<figure\b([^>]*)>([\s\S]*?)<\/figure>/giu)]
    .map((match) => ({ attributes: parseAttributes(match[1]), body: match[2] }));
}

function extractAttributedTags(html, attribute) {
  const expression = new RegExp(`<[a-z][^>]*\\b${attribute}\\s*=\\s*(?:"[^"]*"|'[^']*')[^>]*>`, 'giu');
  return [...html.matchAll(expression)].map((match) => ({ attributes: parseAttributes(match[0]) }));
}

function parseAttributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu)]
    .map((match) => [match[1].toLowerCase(), match[2] ?? match[3] ?? '']));
}

function normalizeReportExports(exportsValue) {
  if (Array.isArray(exportsValue)) return exportsValue.filter((entry) => entry && typeof entry === 'object');
  if (!exportsValue || typeof exportsValue !== 'object') return [];
  return Object.values(exportsValue).filter((entry) => entry && typeof entry === 'object');
}

function inspectReportArtifact({ artifact, outputDirectory, id }) {
  const relative = stringValue(artifact?.file);
  const safeRelative = relative && !path.isAbsolute(relative)
    && path.normalize(relative) !== '..' && !path.normalize(relative).startsWith(`..${path.sep}`);
  const file = safeRelative ? path.resolve(outputDirectory, relative) : undefined;
  const info = fileInfo(file);
  const bytesOk = info.present && Number.isInteger(artifact?.bytes) && artifact.bytes === info.bytes;
  const hashOk = info.present && /^[a-f\d]{64}$/iu.test(String(artifact?.sha256 || ''))
    && sha256(file) === String(artifact.sha256).toLowerCase();
  return { id, file, ...info, pathOk: Boolean(safeRelative), bytesOk, hashOk, ok: Boolean(safeRelative) && bytesOk && hashOk };
}

function inspectReportFreshness({ generatedAt, manifestPath, files, toleranceMs }) {
  const violations = [];
  const generatedAtMs = Date.parse(String(generatedAt || ''));
  const manifest = fileInfo(manifestPath);
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

function readJson(file) {
  if (!file || !existsSync(file)) return { ok: false };
  try { return { ok: true, value: JSON.parse(readFileSync(file, 'utf8')) }; } catch { return { ok: false }; }
}

function readText(file) {
  try { return file ? readFileSync(file, 'utf8') : ''; } catch { return ''; }
}

function fileInfo(file) {
  try {
    const info = file ? statSync(file) : undefined;
    return { present: Boolean(info?.isFile()), bytes: info?.isFile() ? info.size : 0, mtimeMs: info?.isFile() ? info.mtimeMs : 0 };
  } catch { return { present: false, bytes: 0, mtimeMs: 0 }; }
}

function sha256(file) {
  try { return createHash('sha256').update(readFileSync(file)).digest('hex'); } catch { return ''; }
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
