import { existsSync, readFileSync } from 'node:fs';
import { parseOceanEvidenceTime } from './ocean-evidence-time.mjs';
import { parseOceanEvidenceDocument } from './ocean-report-html-parser.mjs';

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const NON_EVIDENCE_ELEMENTS = new Set(['script', 'style', 'template', 'noscript']);
const EVIDENCE_ELEMENTS = new Set(['html', 'body', 'main', 'section']);

export const POINT_INTERACTION_CHECK_IDS = Object.freeze([
  'html-readable',
  'evidence-markup',
  'point-count',
  'stable-point-identity',
  'point-interaction',
  'tooltip-fields',
  'legend-series',
  'self-contained',
  'scientific-context',
  'matlab-evidence',
]);

const REQUIRED_SCIENTIFIC_CONTEXT = Object.freeze([
  ['snapshotId', 'data-snapshot-id'],
  ['source', 'data-source'],
  ['variable', 'data-variable'],
  ['unit', 'data-unit'],
  ['timeStart', 'data-time-start'],
  ['timeEnd', 'data-time-end'],
  ['timezone', 'data-timezone'],
  ['spatialCoverage', 'data-spatial-coverage'],
  ['qcSummary', 'data-qc-summary'],
  ['uncertainty', 'data-uncertainty'],
  ['anomalyStatus', 'data-anomaly-status'],
]);

const FIELD_DEFINITIONS = Object.freeze({
  point: {
    keys: ['observation_id', 'observationId', 'id', 'point_id', 'pointId', 'station', 'station_id', 'stationId', 'name'],
    attributes: ['data-observation-id', 'data-point-id', 'data-point-name', 'data-station', 'data-station-id'],
    labels: ['点位', '站位', '测站', 'point', 'station'],
  },
  temperature: {
    keys: ['temperature', 'temp', 'value'],
    attributes: ['data-temperature', 'data-temp', 'data-value'],
    labels: ['温度', 'temperature', 'temp'],
  },
  unit: {
    keys: ['unit', 'temperature_unit', 'temperatureUnit'],
    attributes: ['data-unit', 'data-temperature-unit'],
    labels: ['单位', 'unit', '°c', '℃', '°f', 'kelvin'],
  },
  time: {
    keys: ['time', 'timestamp', 'date', 'valid_time', 'validTime', 'observation_time', 'observationTime'],
    attributes: ['data-time', 'data-timestamp', 'data-date', 'data-valid-time'],
    labels: ['时间', '日期', 'time', 'timestamp', 'date', 'utc'],
  },
  longitude: {
    keys: ['longitude', 'lon', 'lng'],
    attributes: ['data-longitude', 'data-lon', 'data-lng'],
    labels: ['经度', 'longitude', 'lon'],
  },
  latitude: {
    keys: ['latitude', 'lat'],
    attributes: ['data-latitude', 'data-lat'],
    labels: ['纬度', 'latitude', 'lat'],
  },
  qc: {
    keys: ['qc', 'qc_status', 'qcStatus', 'quality', 'quality_flag', 'qualityFlag', 'status'],
    attributes: ['data-qc', 'data-qc-status', 'data-quality', 'data-quality-flag'],
    labels: ['qc', '质量', 'quality'],
  },
});

export function composePointInteractionQuality(checks) {
  const normalizedChecks = checks.map((check) => ({
    ...check,
    id: String(check.id),
    ok: check.ok === true,
    violations: Array.isArray(check.violations) ? check.violations : [],
  }));
  const checkResults = Object.fromEntries(normalizedChecks.map((check) => [check.id, check]));
  const violations = normalizedChecks.flatMap((check) => check.violations.map((violation) => ({
    check: check.id,
    ...violation,
  })));
  return {
    checks: normalizedChecks,
    checkResults,
    violations,
    qualityOk: normalizedChecks.length > 0 && normalizedChecks.every((check) => check.ok),
  };
}

export function inspectPointInteractionQuality(htmlOrOptions) {
  const options = normalizeOptions(htmlOrOptions);
  const htmlRead = readHtml(options);
  const html = htmlRead.html;
  const evidenceMarkup = htmlRead.ok ? extractEvidenceAttributes(html) : { ok: false, attributes: {}, violations: [] };
  const pointElements = htmlRead.ok ? extractPointElements(html) : [];
  const dataModel = htmlRead.ok ? extractDataModel(html) : emptyDataModel();
  const externalResources = htmlRead.ok ? inspectExternalResources(html) : [];

  const readableCheck = makeCheck('html-readable', htmlRead.ok, htmlRead.ok ? [] : [{
    rule: htmlRead.present ? 'html-unreadable' : 'html-missing',
    path: htmlRead.path,
  }], {
    htmlPresent: htmlRead.present,
    htmlPath: htmlRead.path,
  });
  const evidenceMarkupCheck = makeCheck('evidence-markup', evidenceMarkup.ok, evidenceMarkup.violations);

  const renderedPointCount = pointElements.length;
  const dataPointCount = dataModel.points.length;
  const pointCountOk = htmlRead.ok && dataModel.found && dataPointCount > 0 && renderedPointCount === dataPointCount;
  const pointCountViolations = [];
  if (htmlRead.ok && !dataModel.found) pointCountViolations.push({ rule: 'embedded-data-missing' });
  if (htmlRead.ok && dataModel.found && dataPointCount === 0) pointCountViolations.push({ rule: 'temperature-data-empty' });
  if (htmlRead.ok && renderedPointCount !== dataPointCount) pointCountViolations.push({
    rule: 'point-count-mismatch',
    renderedPointCount,
    dataPointCount,
  });
  const pointCountCheck = makeCheck('point-count', pointCountOk, pointCountViolations, {
    renderedPointCount,
    dataPointCount,
  });

  const identityAudit = inspectStablePointIdentity(pointElements, dataModel);
  const identityCheck = makeCheck('stable-point-identity', htmlRead.ok && identityAudit.ok, identityAudit.violations, identityAudit);

  const interactionAudit = inspectInteractions(html, pointElements);
  const interactionCheck = makeCheck('point-interaction', htmlRead.ok && interactionAudit.ok, interactionAudit.violations, interactionAudit);

  const tooltipAudit = inspectTooltipFields(html, pointElements, dataModel);
  const tooltipCheck = makeCheck('tooltip-fields', htmlRead.ok && tooltipAudit.ok, tooltipAudit.violations, tooltipAudit);

  const legendAudit = inspectLegend(html, dataModel.seriesNames);
  const legendCheck = makeCheck('legend-series', htmlRead.ok && legendAudit.ok, legendAudit.violations, legendAudit);

  const selfContainedCheck = makeCheck('self-contained', htmlRead.ok && externalResources.length === 0, externalResources, {
    externalResources,
  });

  const scientificAudit = inspectScientificContext(evidenceMarkup.attributes);
  const scientificContextRequired = options.requireScientificEvidence === true;
  const scientificCheck = makeCheck(
    'scientific-context',
    htmlRead.ok && (!scientificContextRequired || scientificAudit.ok),
    scientificContextRequired ? scientificAudit.violations : [],
    { context: scientificAudit.context, required: scientificContextRequired },
  );

  const matlabAudit = inspectMatlabEvidence(evidenceMarkup.attributes);
  const matlabEvidenceRequired = options.requireMatlabEvidence === true;
  const matlabCheck = makeCheck(
    'matlab-evidence',
    htmlRead.ok && (!matlabEvidenceRequired || matlabAudit.ok),
    matlabEvidenceRequired ? matlabAudit.violations : [],
    { evidence: matlabAudit.evidence, required: matlabEvidenceRequired },
  );

  const composed = composePointInteractionQuality([
    readableCheck,
    evidenceMarkupCheck,
    pointCountCheck,
    identityCheck,
    interactionCheck,
    tooltipCheck,
    legendCheck,
    selfContainedCheck,
    scientificCheck,
    matlabCheck,
  ]);

  return {
    ...composed,
    htmlPresent: htmlRead.present,
    htmlReadable: htmlRead.ok,
    htmlPath: htmlRead.path,
    evidenceMarkupOk: evidenceMarkupCheck.ok,
    renderedPointCount,
    dataPointCount,
    pointCountOk: pointCountCheck.ok,
    stablePointIdentityOk: identityCheck.ok,
    hoverOk: interactionAudit.hoverOk,
    focusOk: interactionAudit.focusOk,
    pointInteractionOk: interactionCheck.ok,
    tooltipPresent: tooltipAudit.tooltipPresent,
    tooltipFieldsOk: tooltipCheck.ok,
    legendPresent: legendAudit.legendPresent,
    expectedSeries: legendAudit.expectedSeries,
    legendSeries: legendAudit.legendSeries,
    legendSeriesOk: legendCheck.ok,
    externalResources,
    selfContainedOk: selfContainedCheck.ok,
    scientificContextOk: scientificCheck.ok,
    scientificContext: scientificAudit.context,
    matlabEvidenceOk: matlabCheck.ok,
    matlabEvidence: matlabAudit.evidence,
    pointInteractionQualityOk: composed.qualityOk,
  };
}

function normalizeOptions(htmlOrOptions) {
  if (typeof htmlOrOptions === 'object' && htmlOrOptions !== null && !Array.isArray(htmlOrOptions)) {
    return htmlOrOptions;
  }
  return { htmlPath: htmlOrOptions };
}

function readHtml(options) {
  if (typeof options.html === 'string') {
    return { present: true, ok: options.html.trim().length > 0, html: options.html, path: options.htmlPath };
  }
  const htmlPath = typeof options.htmlPath === 'string' ? options.htmlPath : undefined;
  if (!htmlPath || !existsSync(htmlPath)) return { present: false, ok: false, html: '', path: htmlPath };
  try {
    return { present: true, ok: true, html: readFileSync(htmlPath, 'utf8'), path: htmlPath };
  } catch {
    return { present: true, ok: false, html: '', path: htmlPath };
  }
}

function makeCheck(id, ok, violations, details = {}) {
  return { id, ok: ok === true, violations, ...details };
}

function extractPointElements(html) {
  const elements = [];
  html = stripHtmlComments(html);
  const tagPattern = /<([a-z][\w:-]*)\b([^>]*\b(?:data-point-index|data-temperature-point|class\s*=\s*["'][^"']*\btemperature-point\b)[^>]*)>/giu;
  for (const match of html.matchAll(tagPattern)) {
    elements.push({ tag: match[1].toLowerCase(), attributes: parseAttributes(match[2]), source: match[0] });
  }
  return elements;
}

function parseAttributes(source) {
  const attributes = {};
  const pattern = /([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;
  for (const match of source.matchAll(pattern)) {
    attributes[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

function extractDataModel(html) {
  html = stripHtmlComments(html);
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)];
  for (const script of scripts) {
    const attributes = parseAttributes(script[1]);
    if (!/application\/json/iu.test(attributes.type || '')) continue;
    try {
      const value = JSON.parse(script[2].trim());
      const model = normalizeDataModel(value);
      if (model.found) return model;
    } catch {
      continue;
    }
  }
  return emptyDataModel();
}

function normalizeDataModel(value) {
  if (Array.isArray(value)) return { found: true, points: value, seriesNames: seriesNamesFromPoints(value) };
  if (!value || typeof value !== 'object') return emptyDataModel();
  if (Array.isArray(value.points)) {
    return {
      found: true,
      points: value.points,
      seriesNames: uniqueStrings([...seriesNamesFromPoints(value.points), value.series, value.seriesName, value.name]),
      root: value,
    };
  }
  for (const collectionName of ['series', 'datasets']) {
    if (!Array.isArray(value[collectionName])) continue;
    const points = [];
    const seriesNames = [];
    for (const series of value[collectionName]) {
      if (!series || typeof series !== 'object') continue;
      const name = firstDefined(series, ['name', 'label', 'id', 'series']);
      if (nonEmptyString(name)) seriesNames.push(String(name));
      const seriesPoints = ['points', 'data', 'values'].map((key) => series[key]).find(Array.isArray) || [];
      for (const point of seriesPoints) {
        points.push(point && typeof point === 'object' && nonEmptyString(name) && !hasAnyKey(point, ['series', 'seriesName', 'series_name'])
          ? { ...point, series: name }
          : point);
      }
    }
    return { found: true, points, seriesNames: uniqueStrings([...seriesNames, ...seriesNamesFromPoints(points)]), root: value };
  }
  return emptyDataModel();
}

function emptyDataModel() {
  return { found: false, points: [], seriesNames: [], root: undefined };
}

function seriesNamesFromPoints(points) {
  return uniqueStrings(points.map((point) => firstDefined(point, ['series', 'seriesName', 'series_name', 'dataset'])));
}

function inspectInteractions(html, pointElements) {
  const executableScripts = extractExecutableScripts(html);
  const bindingAudit = inspectPointEventBindings(executableScripts);
  const css = extractStyleText(html).replace(/\/\*[\s\S]*?\*\//gu, ' ');
  const hoverBinding = bindingAudit.hoverBinding;
  const hoverStyling = /\.temperature-point\s*:hover\b/iu.test(css);
  const focusBinding = bindingAudit.focusBinding;
  const focusStyling = /\.temperature-point\s*:focus(?:-visible)?\b/iu.test(css);
  const nonFocusablePoints = pointElements.flatMap((element, index) => isFocusable(element) ? [] : [index]);
  const violations = [];
  if (pointElements.length === 0) violations.push({ rule: 'temperature-points-missing' });
  if (!hoverBinding) violations.push({ rule: 'hover-handler-missing' });
  if (!hoverStyling) violations.push({ rule: 'hover-state-missing' });
  if (!focusBinding) violations.push({ rule: 'focus-handler-missing' });
  if (!focusStyling) violations.push({ rule: 'focus-state-missing' });
  if (nonFocusablePoints.length > 0) violations.push({ rule: 'points-not-focusable', pointIndexes: nonFocusablePoints });
  return {
    ok: violations.length === 0,
    hoverOk: hoverBinding && hoverStyling && pointElements.length > 0,
    focusOk: focusBinding && focusStyling && pointElements.length > 0 && nonFocusablePoints.length === 0,
    nonFocusablePoints,
    violations,
  };
}

function inspectStablePointIdentity(pointElements, dataModel) {
  const modelIds = dataModel.points.map((point) => normalizedValue(firstDefined(point, FIELD_DEFINITIONS.point.keys)));
  const missingModelIds = modelIds.flatMap((value, index) => value === '' ? [index] : []);
  const duplicateModelIds = duplicates(modelIds.filter(Boolean));
  const rendered = pointElements.map((element, index) => ({
    index,
    pointIndex: parseNonnegativeInteger(element.attributes['data-point-index']),
    observationId: normalizedValue(element.attributes['data-observation-id'] ?? element.attributes['data-point-id']),
  }));
  const invalidRenderedIndexes = rendered.flatMap((entry) => entry.pointIndex === undefined ? [entry.index] : []);
  const duplicateRenderedIndexes = duplicates(rendered.map((entry) => entry.pointIndex).filter((value) => value !== undefined));
  const missingRenderedIds = rendered.flatMap((entry) => entry.observationId === '' ? [entry.index] : []);
  const duplicateRenderedIds = duplicates(rendered.map((entry) => entry.observationId).filter(Boolean));
  const expectedIndexes = Array.from({ length: dataModel.points.length }, (_, index) => index);
  const renderedIndexes = rendered.map((entry) => entry.pointIndex).filter((value) => value !== undefined).sort((left, right) => left - right);
  const indexCoverageOk = JSON.stringify(renderedIndexes) === JSON.stringify(expectedIndexes);
  const mismatches = rendered.flatMap((entry) => {
    if (entry.pointIndex === undefined || entry.pointIndex >= modelIds.length) return [];
    return entry.observationId === modelIds[entry.pointIndex] ? [] : [{
      renderedIndex: entry.index,
      pointIndex: entry.pointIndex,
      renderedObservationId: entry.observationId,
      dataObservationId: modelIds[entry.pointIndex],
    }];
  });
  const violations = [];
  if (missingModelIds.length > 0) violations.push({ rule: 'observation-id-missing', pointIndexes: missingModelIds });
  if (duplicateModelIds.length > 0) violations.push({ rule: 'observation-id-duplicate', observationIds: duplicateModelIds });
  if (invalidRenderedIndexes.length > 0) violations.push({ rule: 'rendered-point-index-invalid', pointIndexes: invalidRenderedIndexes });
  if (duplicateRenderedIndexes.length > 0) violations.push({ rule: 'rendered-point-index-duplicate', pointIndexes: duplicateRenderedIndexes });
  if (!indexCoverageOk) violations.push({ rule: 'rendered-point-index-coverage', expectedIndexes, renderedIndexes });
  if (missingRenderedIds.length > 0) violations.push({ rule: 'rendered-observation-id-missing', pointIndexes: missingRenderedIds });
  if (duplicateRenderedIds.length > 0) violations.push({ rule: 'rendered-observation-id-duplicate', observationIds: duplicateRenderedIds });
  if (mismatches.length > 0) violations.push({ rule: 'rendered-observation-id-mismatch', points: mismatches });
  return {
    ok: dataModel.found && dataModel.points.length > 0 && pointElements.length > 0 && violations.length === 0,
    modelObservationIds: modelIds,
    renderedObservationIds: rendered.map((entry) => entry.observationId),
    renderedIndexes,
    violations,
  };
}

function isFocusable(element) {
  if (['a', 'button', 'input', 'select', 'textarea'].includes(element.tag)) return element.attributes.disabled === undefined;
  const tabIndex = element.attributes.tabindex;
  return tabIndex !== undefined && Number(tabIndex) >= 0;
}

function inspectTooltipFields(html, pointElements, dataModel) {
  html = stripHtmlComments(html);
  const tooltipPresent = /<[^>]+\brole\s*=\s*["']tooltip["'][^>]*>/iu.test(html);
  const rootUnitPresent = hasNonemptyKey(dataModel.root, FIELD_DEFINITIONS.unit.keys);
  const pointMissingFields = dataModel.points.map((point, index) => ({
    index,
    fields: Object.entries(FIELD_DEFINITIONS).flatMap(([field, definition]) => {
      if (field === 'unit' && rootUnitPresent) return [];
      return hasNonemptyKey(point, definition.keys) ? [] : [field];
    }),
  })).filter((entry) => entry.fields.length > 0);
  const elementMissingFields = pointElements.map((element, index) => {
    const accessibleText = `${element.attributes['aria-label'] || ''} ${element.attributes['aria-description'] || ''}`.toLowerCase();
    const fields = Object.entries(FIELD_DEFINITIONS).flatMap(([field, definition]) => {
      const hasAttribute = definition.attributes.some((attribute) => attribute in element.attributes);
      const hasLabel = definition.labels.some((label) => accessibleText.includes(label.toLowerCase()));
      return hasAttribute && normalizedValue(element.attributes[definition.attributes.find((attribute) => attribute in element.attributes)]) !== '' && hasLabel ? [] : [field];
    });
    return { index, fields };
  }).filter((entry) => entry.fields.length > 0);
  const violations = [];
  if (!tooltipPresent) violations.push({ rule: 'tooltip-missing' });
  if (pointMissingFields.length > 0) violations.push({ rule: 'tooltip-data-fields-missing', points: pointMissingFields });
  if (elementMissingFields.length > 0) violations.push({ rule: 'tooltip-point-fields-missing', points: elementMissingFields });
  return {
    ok: tooltipPresent && violations.length === 0 && dataModel.points.length > 0 && pointElements.length > 0,
    tooltipPresent,
    requiredFields: Object.keys(FIELD_DEFINITIONS),
    missingGlobalLabels: [],
    pointMissingFields,
    elementMissingFields,
    violations,
  };
}

function inspectLegend(html, expectedSeries) {
  html = stripHtmlComments(html);
  const legendMatches = [...html.matchAll(/<([a-z][\w:-]*)\b([^>]*(?:class\s*=\s*["'][^"']*\blegend\b|data-legend|aria-label\s*=\s*["'][^"']*图例)[^>]*)>([\s\S]*?)<\/\1>/giu)];
  const legendPresent = legendMatches.length > 0;
  const legendText = legendMatches.map((match) => `${parseAttributes(match[2])['aria-label'] || ''} ${stripTags(match[3])}`).join(' ');
  const declaredSeries = legendMatches.flatMap((match) => [...match[0].matchAll(/data-series(?:-name)?\s*=\s*["']([^"']+)["']/giu)].map((series) => decodeHtml(series[1])));
  const legendSeries = uniqueStrings([...declaredSeries, ...expectedSeries.filter((series) => includesNormalized(legendText, series))]);
  const missingSeries = expectedSeries.filter((series) => !includesNormalized(legendText, series) && !legendSeries.includes(series));
  const violations = [];
  if (expectedSeries.length > 1 && !legendPresent) violations.push({ rule: 'legend-missing' });
  if (missingSeries.length > 0) violations.push({ rule: 'legend-series-missing', series: missingSeries });
  return {
    ok: expectedSeries.length <= 1 || (legendPresent && missingSeries.length === 0),
    legendPresent,
    expectedSeries,
    legendSeries,
    missingSeries,
    violations,
  };
}

function inspectExternalResources(html) {
  html = stripHtmlComments(html);
  const violations = [];
  const resourceTags = /<(script|link|img|source|video|audio|iframe|embed|object)\b([^>]*)>/giu;
  const resourceAttributes = {
    script: ['src'], link: ['href'], img: ['src', 'srcset'], source: ['src', 'srcset'],
    video: ['src', 'poster'], audio: ['src'], iframe: ['src'], embed: ['src'], object: ['data'],
  };
  for (const match of html.matchAll(resourceTags)) {
    const tag = match[1].toLowerCase();
    const attributes = parseAttributes(match[2]);
    for (const attribute of resourceAttributes[tag]) {
      if (!(attribute in attributes)) continue;
      for (const reference of splitResourceReferences(attributes[attribute], attribute)) {
        if (!isEmbeddedReference(reference)) violations.push({ rule: 'external-resource', tag, attribute, reference });
      }
    }
  }
  const css = extractStyleText(html).replace(/\/\*[\s\S]*?\*\//gu, ' ');
  for (const match of css.matchAll(/@import\s+(?:url\(\s*)?["']?([^\s"') ;]+)|url\(\s*["']?([^"')]+)["']?\s*\)/giu)) {
    const reference = match[1] || match[2];
    if (!isEmbeddedReference(reference)) violations.push({ rule: 'external-css-resource', reference });
  }
  const networkPatterns = [
    ['network-fetch', /\bfetch\s*\(/iu],
    ['xml-http-request', /\bXMLHttpRequest\b/iu],
    ['web-socket', /\bWebSocket\s*\(/iu],
    ['event-source', /\bEventSource\s*\(/iu],
    ['worker-resource', /\b(?:Worker|SharedWorker|importScripts)\s*\(/iu],
    ['module-import', /\bimport\s*\(\s*["']/iu],
  ];
  for (const script of extractExecutableScripts(html)) {
    const executableCode = tokenizeJavaScriptStrings(script).code;
    for (const [rule, pattern] of networkPatterns) {
      if (pattern.test(executableCode)) violations.push({ rule });
    }
  }
  return deduplicateViolations(violations);
}

function inspectScientificContext(attributes) {
  const context = Object.fromEntries(REQUIRED_SCIENTIFIC_CONTEXT.map(([field, attribute]) => [field, normalizedValue(attributes[attribute])]));
  const violations = REQUIRED_SCIENTIFIC_CONTEXT.flatMap(([field, attribute]) => context[field] ? [] : [{
    rule: 'scientific-context-field-missing',
    field,
    attribute,
  }]);
  const start = parseOceanEvidenceTime(context.timeStart, context.timezone);
  const end = parseOceanEvidenceTime(context.timeEnd, context.timezone);
  if (context.timeStart && !Number.isFinite(start)) violations.push({ rule: 'scientific-time-invalid', field: 'timeStart' });
  if (context.timeEnd && !Number.isFinite(end)) violations.push({ rule: 'scientific-time-invalid', field: 'timeEnd' });
  if (Number.isFinite(start) && Number.isFinite(end) && end < start) violations.push({ rule: 'scientific-time-reversed' });
  if (context.timezone && !/^utc(?:[+-]00(?::?00)?)?$/iu.test(context.timezone)) {
    violations.push({ rule: 'scientific-timezone-not-utc', value: context.timezone });
  }
  if (context.anomalyStatus && !/^(?:present|absent|unknown|not-evaluated)$/u.test(context.anomalyStatus)) {
    violations.push({ rule: 'scientific-anomaly-status-invalid', value: context.anomalyStatus });
  }
  return { ok: violations.length === 0, context, violations };
}

function inspectMatlabEvidence(attributes) {
  const evidence = {
    authoritativeRuntime: normalizedValue(attributes['data-authoritative-runtime']),
    matlabRelease: normalizedValue(attributes['data-matlab-release']),
    runtimeStatus: normalizedValue(attributes['data-runtime-status']),
    executionVerified: normalizedValue(attributes['data-execution-verified']),
    artifactValidation: normalizedValue(attributes['data-artifact-validation']),
    visualInspection: normalizedValue(attributes['data-visual-inspection']),
  };
  const violations = [];
  if (evidence.authoritativeRuntime !== 'MATLAB') violations.push({ rule: 'authoritative-runtime-not-matlab', value: evidence.authoritativeRuntime });
  if (!/^R20\d{2}[ab]$/u.test(evidence.matlabRelease)) violations.push({ rule: 'matlab-release-invalid', value: evidence.matlabRelease });
  if (evidence.runtimeStatus !== 'passed') violations.push({ rule: 'matlab-runtime-not-passed', value: evidence.runtimeStatus });
  if (evidence.executionVerified !== 'true') violations.push({ rule: 'matlab-execution-unverified', value: evidence.executionVerified });
  if (evidence.artifactValidation !== 'passed') violations.push({ rule: 'matlab-artifact-validation-not-passed', value: evidence.artifactValidation });
  if (evidence.visualInspection !== 'passed') violations.push({ rule: 'matlab-visual-inspection-not-passed', value: evidence.visualInspection });
  return { ok: violations.length === 0, evidence, violations };
}

function extractEvidenceAttributes(html) {
  const { document, violations: issues } = parseOceanEvidenceDocument(html);
  const violations = issues.map(({ code, ...location }) => ({
    rule: code === 'parse_failed' ? 'html-parse-failed' : `html-${code}`, ...location,
  }));
  if (!document) return { ok: false, attributes: {}, violations };
  const pending = [document];
  while (pending.length > 0) {
    const node = pending.pop();
    if (NON_EVIDENCE_ELEMENTS.has(node.tagName)) continue;
    if (node.namespaceURI === HTML_NAMESPACE && EVIDENCE_ELEMENTS.has(node.tagName)
      && node.attrs.some(({ name }) => name === 'data-snapshot-id')) {
      return { ok: violations.length === 0, attributes: Object.fromEntries(node.attrs.map(({ name, value }) => [name, value])), violations };
    }
    const children = node.childNodes || [];
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]);
  }
  return { ok: violations.length === 0, attributes: {}, violations };
}

function splitResourceReferences(value, attribute) {
  if (attribute !== 'srcset') return [value.trim()].filter(Boolean);
  return value.split(',').map((candidate) => candidate.trim().split(/\s+/u)[0]).filter(Boolean);
}

function isEmbeddedReference(reference) {
  const value = String(reference || '').trim();
  return value === '' || value.startsWith('#') || /^(?:data|about:blank$)/iu.test(value);
}

function extractStyleText(html) {
  return [...stripHtmlComments(html).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/giu)].map((match) => match[1]).join('\n');
}

function extractExecutableScripts(html) {
  return [...stripHtmlComments(html).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)]
    .filter((match) => !/application\/json/iu.test(parseAttributes(match[1]).type || ''))
    .map((match) => match[2]);
}

function inspectPointEventBindings(scripts) {
  let hoverBinding = false;
  let focusBinding = false;
  for (const script of scripts) {
    const tokenized = tokenizeJavaScriptStrings(script);
    const collectionPattern = /querySelectorAll\s*\(\s*__STRING_(\d+)__\s*\)\s*\.forEach\s*\(\s*\(?\s*([A-Za-z_$][\w$]*)/gu;
    for (const match of tokenized.code.matchAll(collectionPattern)) {
      const selector = tokenized.strings[Number(match[1])] || '';
      if (!/(?:^|[\s>+~,])\.temperature-point(?:$|[\s>+~,.#[:])/u.test(selector)) continue;
      const variable = escapeRegExp(match[2]);
      const listenerPattern = new RegExp(`${variable}\\s*\\.\\s*addEventListener\\s*\\(\\s*__STRING_(\\d+)__`, 'gu');
      for (const listener of tokenized.code.matchAll(listenerPattern)) {
        const eventName = (tokenized.strings[Number(listener[1])] || '').toLowerCase();
        hoverBinding ||= ['pointerenter', 'mouseenter', 'mouseover'].includes(eventName);
        focusBinding ||= ['focus', 'focusin'].includes(eventName);
      }
    }
  }
  return { hoverBinding, focusBinding };
}

function tokenizeJavaScriptStrings(source) {
  const strings = [];
  let code = '';
  let index = 0;
  while (index < source.length) {
    if (source[index] === '/' && source[index + 1] === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n') index += 1;
      code += '\n';
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
      index = Math.min(source.length, index + 2);
      code += ' ';
      continue;
    }
    if (['"', "'", '`'].includes(source[index])) {
      const quote = source[index];
      let value = '';
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') {
          value += source[index + 1] || '';
          index += 2;
          continue;
        }
        if (source[index] === quote) {
          index += 1;
          break;
        }
        value += source[index];
        index += 1;
      }
      const tokenIndex = strings.push(value) - 1;
      code += `__STRING_${tokenIndex}__`;
      continue;
    }
    code += source[index];
    index += 1;
  }
  return { code, strings };
}

function stripHtmlComments(value) {
  return String(value).replace(/<!--[\s\S]*?-->/gu, ' ');
}

function parseNonnegativeInteger(value) {
  if (!/^\d+$/u.test(String(value ?? ''))) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function duplicates(values) {
  const seen = new Set();
  const duplicateValues = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicateValues.add(value);
    seen.add(value);
  }
  return [...duplicateValues];
}

function normalizedValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return String(value).trim();
}

function hasNonemptyKey(value, keys) {
  const selected = firstDefined(value, keys);
  return normalizedValue(selected) !== '';
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function deduplicateViolations(violations) {
  const seen = new Set();
  return violations.filter((violation) => {
    const key = JSON.stringify(violation);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stripTags(value) {
  return decodeHtml(String(value).replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim());
}

function decodeHtml(value) {
  return String(value)
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&amp;/giu, '&');
}

function firstDefined(value, keys) {
  if (!value || typeof value !== 'object') return undefined;
  for (const key of keys) {
    if (key in value) return value[key];
  }
  return undefined;
}

function hasAnyKey(value, keys) {
  return value !== null && typeof value === 'object' && keys.some((key) => key in value);
}

function uniqueStrings(values) {
  return [...new Set(values.filter(nonEmptyString).map((value) => String(value).trim()))];
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function includesNormalized(text, value) {
  return String(text).toLocaleLowerCase().includes(String(value).trim().toLocaleLowerCase());
}
