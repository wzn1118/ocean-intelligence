import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { OCEAN_REPORT_SPEC } from './ocean-report-spec.mjs';
import { UNIVERSAL_OCEAN_REPORT_SPEC } from './beibu-gulf-report-spec.mjs';
import { WIND_REPORT_SPEC } from './wind-report-spec.mjs';
import { OCEAN_VARIABLE_REPORT_SPEC } from './ocean-variable-report-spec.mjs';
import { PHYSICAL_OCEANOGRAPHY_SPEC } from './physical-oceanography-spec.mjs';
import { PROFESSIONAL_VISUALIZATION_SPEC } from './professional-visualization-spec.mjs';
import { EDITORIAL_STYLE_SPEC } from './editorial-style-spec.mjs';
import { PHYSICAL_INTERPRETATION_IMPACT_SPEC } from './physical-interpretation-impact-spec.mjs';
import { ANOMALY_LINKAGE_REPORT_SPEC } from './anomaly-linkage-report-spec.mjs';

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
    'The HTML must remain fully usable offline. Inline every visual in the HTML as SVG markup or a data URI while also keeping the separate visual files as deliverables.',
    `Before answering, verify the content quality gates: the HTML, Markdown, and at least ${contract.minimumVisuals} non-empty visual files exist; byte length, heading count, figure count, analytical-claim count, comparison count, and evidence-marker count meet the minimums; every important section contains specific evidence or an explicit data limitation. In the final answer list the main report paths and summarize the visual assets.`,
  ].join('\n');
}

function compactTimestamp(date) {
  return date.toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'z').replace('T', '-').toLowerCase();
}
