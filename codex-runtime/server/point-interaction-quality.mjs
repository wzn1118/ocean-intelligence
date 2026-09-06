import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { MIMEType } from 'node:util';
import { parseOceanEvidenceTime } from './ocean-evidence-time.mjs';
import { parseOceanEvidenceDocument } from './ocean-report-html-parser.mjs';

const require = createRequire(import.meta.url);
const { parse: parseJavaScript } = require('acorn');
const { selectAll, is: matchesSelector } = require('css-select');
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const INERT_HTML_ELEMENTS = new Set(['template', 'noscript']);
const CODE_ELEMENTS = new Set(['script', 'style']);
const EVIDENCE_ELEMENTS = new Set(['html', 'body', 'main', 'section']);
const JAVASCRIPT_TYPES = new Set([
  'application/ecmascript', 'application/javascript', 'application/x-ecmascript', 'application/x-javascript',
  'text/ecmascript', 'text/javascript', 'text/javascript1.0', 'text/javascript1.1', 'text/javascript1.2',
  'text/javascript1.3', 'text/javascript1.4', 'text/javascript1.5', 'text/jscript', 'text/livescript',
  'text/x-ecmascript', 'text/x-javascript',
]);
const HOVER_EVENTS = new Set(['pointerenter', 'pointerover', 'mouseenter', 'mouseover']);
const FOCUS_EVENTS = new Set(['focus', 'focusin']);
const BUBBLING_EVENTS = new Set(['pointerover', 'mouseover', 'focusin']);
const DOM_SELECTOR_ADAPTER = {
  isTag: node => Boolean(node.tagName),
  getAttributeValue: (node, name) => node.attrs?.find(attribute => attribute.name === name && !attribute.prefix)?.value,
  getChildren: node => node.childNodes || [],
  getName: node => node.tagName,
  getParent: node => node.parentNode || null,
  getSiblings: node => node.parentNode?.childNodes || [node],
  getText: node => node.nodeName === '#text' ? node.value : elementText(node),
  hasAttrib: (node, name) => node.attrs?.some(attribute => attribute.name === name && !attribute.prefix) === true,
  removeSubsets: nodes => [...new Set(nodes)].filter(node => !nodes.some(other => other !== node && isDescendantOf(node, other))),
};

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
  const parsed = htmlRead.ok ? parseOceanEvidenceDocument(html) : { ok: false, document: null, violations: [] };
  const elements = extractDocumentElements(parsed.document);
  const evidenceMarkup = extractEvidenceAttributes(parsed, elements);
  const pointElements = extractPointElements(elements);
  const dataModel = extractDataModel(elements);
  const executableScripts = extractExecutableScripts(elements);
  const styleText = extractStyleText(elements);
  const externalResources = htmlRead.ok ? inspectExternalResources(html, executableScripts, styleText) : [];

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
  if (htmlRead.ok && dataModel.candidateCount > 1) {
    pointCountViolations.push({ rule: 'embedded-data-ambiguous', candidateCount: dataModel.candidateCount });
  } else if (htmlRead.ok && !dataModel.found) pointCountViolations.push({ rule: 'embedded-data-missing' });
  if (htmlRead.ok && dataModel.found && dataPointCount === 0) pointCountViolations.push({ rule: 'temperature-data-empty' });
  if (htmlRead.ok && renderedPointCount !== dataPointCount) pointCountViolations.push({
    rule: 'point-count-mismatch',
    renderedPointCount,
    dataPointCount,
  });
  const pointCountCheck = makeCheck('point-count', pointCountOk, pointCountViolations, {
    renderedPointCount,
    dataPointCount,
    dataModelCandidateCount: dataModel.candidateCount,
  });

  const identityAudit = inspectStablePointIdentity(pointElements, dataModel);
  const identityCheck = makeCheck('stable-point-identity', htmlRead.ok && identityAudit.ok, identityAudit.violations, identityAudit);

  const interactionAudit = inspectInteractions(executableScripts, styleText, pointElements, parsed.document);
  const interactionCheck = makeCheck('point-interaction', htmlRead.ok && interactionAudit.ok, interactionAudit.violations, interactionAudit);

  const tooltipAudit = inspectTooltipFields(elements, pointElements, dataModel);
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

function extractDocumentElements(document) {
  const elements = [];
  const pending = document ? [document] : [];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node.namespaceURI === HTML_NAMESPACE && INERT_HTML_ELEMENTS.has(node.tagName)) continue;
    if (node.tagName && [HTML_NAMESPACE, SVG_NAMESPACE].includes(node.namespaceURI)) {
      elements.push({
        node,
        tag: node.tagName,
        namespace: node.namespaceURI,
        attributes: Object.fromEntries(node.attrs.map(({ name, prefix, value }) => [prefix ? `${prefix}:${name}` : name, value])),
        text: CODE_ELEMENTS.has(node.tagName) ? elementText(node) : '',
      });
      if (CODE_ELEMENTS.has(node.tagName)) continue;
    }
    const children = node.childNodes || [];
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]);
  }
  return elements;
}

function elementText(element) {
  const text = [];
  const pending = [...(element.childNodes || [])].reverse();
  while (pending.length > 0) {
    const node = pending.pop();
    if (node.nodeName === '#text') text.push(node.value);
    const children = node.childNodes || [];
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]);
  }
  return text.join('');
}

function extractPointElements(elements) {
  return elements.filter(({ tag, attributes }) => !CODE_ELEMENTS.has(tag) && (
    Object.hasOwn(attributes, 'data-point-index') || Object.hasOwn(attributes, 'data-temperature-point')
    || (attributes.class || '').split(/[\t\n\f\r ]+/u).includes('temperature-point')
  ));
}

function parseAttributes(source) {
  const attributes = {};
  const pattern = /([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;
  for (const match of source.matchAll(pattern)) {
    attributes[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

function extractDataModel(elements) {
  const candidates = [];
  for (const element of elements) {
    if (element.tag !== 'script') continue;
    try {
      if (new MIMEType(element.attributes.type || '').essence !== 'application/json') continue;
      const value = JSON.parse(element.text);
      const model = normalizeDataModel(value);
      if (model.found) candidates.push(model);
    } catch {
      continue;
    }
  }
  return { ...(candidates.length === 1 ? candidates[0] : emptyDataModel()), candidateCount: candidates.length };
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

function inspectInteractions(executableScripts, styleText, pointElements, document) {
  const bindingAudit = inspectPointEventBindings(executableScripts, pointElements, document);
  const css = styleText.replace(/\/\*[\s\S]*?\*\//gu, ' ');
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
  if ((!hoverBinding || !focusBinding) && bindingAudit.diagnostics.length > 0) {
    violations.push({ rule: 'point-bindings-not-verified', details: bindingAudit.diagnostics });
  }
  return {
    ok: violations.length === 0,
    hoverOk: hoverBinding && hoverStyling && pointElements.length > 0,
    focusOk: focusBinding && focusStyling && pointElements.length > 0 && nonFocusablePoints.length === 0,
    nonFocusablePoints,
    bindingStatus: hoverBinding && focusBinding ? 'statically-matched' : 'not-verified',
    unverifiedHoverPointIndexes: bindingAudit.unverifiedHoverPointIndexes,
    unverifiedFocusPointIndexes: bindingAudit.unverifiedFocusPointIndexes,
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

function inspectTooltipFields(elements, pointElements, dataModel) {
  const tooltipPresent = elements.some(({ tag, attributes }) => !CODE_ELEMENTS.has(tag) && attributes.role === 'tooltip');
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

function inspectExternalResources(html, executableScripts, styleText) {
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
  const css = styleText.replace(/\/\*[\s\S]*?\*\//gu, ' ');
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
  for (const script of executableScripts) {
    const executableCode = tokenizeJavaScriptStrings(script.text).code;
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

function extractEvidenceAttributes(parsed, elements) {
  const violations = parsed.violations.map(({ code, ...location }) => ({
    rule: code === 'parse_failed' ? 'html-parse-failed' : `html-${code}`, ...location,
  }));
  const declaration = elements.find(({ namespace, tag, attributes }) => namespace === HTML_NAMESPACE
    && EVIDENCE_ELEMENTS.has(tag) && Object.hasOwn(attributes, 'data-snapshot-id'));
  return { ok: parsed.ok, attributes: declaration?.attributes || {}, violations };
}

function splitResourceReferences(value, attribute) {
  if (attribute !== 'srcset') return [value.trim()].filter(Boolean);
  return value.split(',').map((candidate) => candidate.trim().split(/\s+/u)[0]).filter(Boolean);
}

function isEmbeddedReference(reference) {
  const value = String(reference || '').trim();
  return value === '' || value.startsWith('#') || /^(?:data|about:blank$)/iu.test(value);
}

function extractStyleText(elements) {
  return elements.filter(({ tag }) => tag === 'style').map(({ text }) => text).join('\n');
}

function extractExecutableScripts(elements) {
  return elements.filter(({ tag, namespace, attributes }) => {
    if (tag !== 'script') return false;
    const externalAttributes = namespace === HTML_NAMESPACE ? ['src'] : ['href', 'xlink:href'];
    if (externalAttributes.some(attribute => Object.hasOwn(attributes, attribute))) return false;
    const defaultType = namespace === HTML_NAMESPACE && attributes.language ? `text/${attributes.language}` : 'text/javascript';
    const type = (attributes.type ?? defaultType).replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/gu, '').toLowerCase();
    if (type === 'module') return true;
    if (namespace === HTML_NAMESPACE && Object.hasOwn(attributes, 'nomodule')) return false;
    return type === '' || JAVASCRIPT_TYPES.has(type);
  }).map(({ text, attributes }) => ({
    text,
    sourceType: attributes.type?.trim().toLowerCase() === 'module' ? 'module' : 'script',
  }));
}

function isDescendantOf(node, ancestor) {
  for (let current = node.parentNode; current; current = current.parentNode) {
    if (current === ancestor) return true;
  }
  return false;
}

function bindingNames(pattern) {
  if (!pattern) return [];
  if (pattern.type === 'Identifier') return [pattern.name];
  if (pattern.type === 'RestElement') return bindingNames(pattern.argument);
  if (pattern.type === 'AssignmentPattern') return bindingNames(pattern.left);
  if (pattern.type === 'ArrayPattern') return pattern.elements.flatMap(bindingNames);
  if (pattern.type === 'ObjectPattern') return pattern.properties.flatMap(property => bindingNames(property.value || property.argument));
  return [];
}

function inspectPointEventBindings(scripts, pointElements, document) {
  const unknown = Symbol('not-verified');
  const pointNodes = new Set(pointElements.map(element => element.node));
  const hover = new Set();
  const focus = new Set();
  const propertyHandlers = new Map();
  const diagnostics = [];
  const globalScope = { parent: null, bindings: new Map(), functionScope: true };
  const selectorOptions = { adapter: DOM_SELECTOR_ADAPTER, xmlMode: true, relativeSelector: false };
  let invalidated = false;
  let effectsOnly = false;
  let steps = 0;

  function note(reason) {
    if (diagnostics.length < 20 && !diagnostics.some(entry => entry.reason === reason)) diagnostics.push({ reason });
  }

  function nodesValue(nodes, collection = false, eventSource, nullable = false) {
    return { kind: 'nodes', nodes: [...new Set(nodes)], collection, eventSource, nullable };
  }

  function invalidateMutation(receiver, reason) {
    if (receiver?.kind === 'nodes' && !receiver.nodes.some(root =>
      [...pointNodes].some(point => point === root || isDescendantOf(point, root)))) return;
    invalidated = true;
    note(reason);
  }

  function inspectPossibleEffects(statements, scope, context, depth) {
    const previous = effectsOnly;
    effectsOnly = true;
    try { visitStatements(statements, scope, context, depth); }
    finally { effectsOnly = previous; }
  }

  function inspectPossibleExpression(expression, scope, context, depth) {
    inspectPossibleEffects([{ type: 'ExpressionStatement', expression }], scope, context, depth);
  }

  function lookup(scope, name) {
    for (let current = scope; current; current = current.parent) {
      if (current.bindings.has(name)) return { scope: current, value: current.bindings.get(name) };
    }
    return null;
  }

  function variableScope(scope) {
    while (!scope.functionScope) scope = scope.parent;
    return scope;
  }

  function prepare(statements, scope, hoistVars = false) {
    const pending = hoistVars ? [...statements] : [];
    while (pending.length > 0) {
      const node = pending.pop();
      if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) continue;
      if (node.type === 'VariableDeclaration' && node.kind === 'var') {
        for (const declaration of node.declarations) {
          for (const name of bindingNames(declaration.id)) {
            if (!scope.bindings.has(name)) scope.bindings.set(name, unknown);
          }
        }
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) pending.push(...value.filter(child => child?.type));
        else if (value?.type) pending.push(value);
      }
    }
    for (const statement of statements) {
      if (statement.type === 'FunctionDeclaration' && statement.id) {
        scope.bindings.set(statement.id.name, { kind: 'function', node: statement, scope });
      } else if (statement.type === 'VariableDeclaration') {
        const target = statement.kind === 'var' ? variableScope(scope) : scope;
        for (const declaration of statement.declarations) {
          for (const name of bindingNames(declaration.id)) {
            if (!target.bindings.has(name)) target.bindings.set(name, unknown);
          }
        }
      } else if (statement.type === 'ClassDeclaration' && statement.id) scope.bindings.set(statement.id.name, unknown);
      else if (statement.type === 'ImportDeclaration') {
        for (const specifier of statement.specifiers) scope.bindings.set(specifier.local.name, unknown);
      }
    }
  }

  function truth(value) {
    if (value === unknown) return unknown;
    if (value?.kind === 'nodes') {
      if (value.collection) return true;
      return value.nullable && value.nodes.length > 0 ? unknown : value.nodes.length > 0;
    }
    return Boolean(value);
  }

  function select(receiver, selector, method) {
    if (receiver?.kind !== 'nodes' || receiver.collection || receiver.nullable || typeof selector !== 'string') {
      note('dynamic-selector-or-receiver');
      return unknown;
    }
    if (!selector.trim() || /[:!<\\]/u.test(selector)) {
      note('selector-outside-static-subset');
      return unknown;
    }
    try {
      const matchesByRoot = receiver.nodes.map(root => {
        if (method !== 'closest') {
          const matches = selectAll(selector, root, selectorOptions);
          return method === 'querySelector' ? matches.slice(0, 1) : matches;
        }
        for (let current = root; current?.tagName; current = current.parentNode) {
          if (matchesSelector(current, selector, selectorOptions)) return [current];
        }
        return [];
      });
      const selected = matchesByRoot.flat();
      if (selected.length === 0) note('selector-matches-no-nodes');
      return nodesValue(selected, method === 'querySelectorAll', method === 'closest' ? receiver.eventSource : undefined,
        method !== 'querySelectorAll' && matchesByRoot.some(matches => matches.length === 0));
    } catch {
      note('selector-invalid-or-unsupported');
      return unknown;
    }
  }

  function record(eventName, value) {
    if (effectsOnly) return;
    const target = HOVER_EVENTS.has(eventName) ? hover : FOCUS_EVENTS.has(eventName) ? focus : null;
    if (target && value?.kind === 'nodes' && !value.collection && !value.nullable) {
      for (const node of value.nodes) if (pointNodes.has(node)) target.add(node);
    }
  }

  function invoke(callback, args, context, depth) {
    if (callback?.kind !== 'function' || callback.node.async || callback.node.generator || depth > 16) {
      note('callback-not-statically-resolved');
      return unknown;
    }
    const scope = { parent: callback.scope, bindings: new Map(), functionScope: true };
    for (const [index, parameter] of callback.node.params.entries()) {
      for (const name of bindingNames(parameter)) scope.bindings.set(name, parameter.type === 'Identifier' ? args[index] ?? unknown : unknown);
    }
    const body = callback.node.body;
    if (body.type === 'BlockStatement') {
      prepare(body.body, scope, true);
      visitStatements(body.body, scope, context, depth);
    } else evaluate(body, scope, context, depth);
    return unknown;
  }

  function register(receiver, eventName, callback, options, depth) {
    if (receiver?.kind !== 'nodes' || receiver.collection || receiver.nullable || callback?.kind !== 'function') {
      note('listener-receiver-or-callback-not-resolved');
      return;
    }
    if (eventName === 'DOMContentLoaded' && receiver.nodes.includes(document)) {
      invoke(callback, [unknown], null, depth + 1);
      return;
    }
    if (!HOVER_EVENTS.has(eventName) && !FOCUS_EVENTS.has(eventName)) return;
    record(eventName, receiver);
    const capture = options?.type === 'Literal' && options.value === true
      || options?.type === 'ObjectExpression' && options.properties.some(property => !property.computed
        && (property.key.name || property.key.value) === 'capture' && property.value.type === 'Literal' && property.value.value === true);
    if (!BUBBLING_EVENTS.has(eventName) && !capture) return;
    const reachable = [...pointNodes].filter(node => receiver.nodes.some(root => isDescendantOf(node, root)));
    if (reachable.length === 0) return;
    const delegation = { eventName };
    const event = { kind: 'event', target: nodesValue(reachable, false, delegation), currentTarget: receiver };
    invoke(callback, [event], delegation, depth + 1);
  }

  function evaluate(node, scope, context, depth) {
    if (!node || ++steps > 20000) {
      if (steps > 20000) { invalidated = true; note('static-analysis-budget'); }
      return unknown;
    }
    if (node.type === 'Literal') return node.regex ? unknown : node.value;
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
    if (node.type === 'Identifier') {
      const binding = lookup(scope, node.name);
      return binding ? binding.value : node.name === 'document' && document ? nodesValue([document]) : unknown;
    }
    if (node.type === 'ThisExpression') return context?.inlinePoint || unknown;
    if (['FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) return { kind: 'function', node, scope };
    if (node.type === 'MemberExpression') {
      const receiver = evaluate(node.object, scope, context, depth);
      const property = node.computed ? evaluate(node.property, scope, context, depth) : node.property.name;
      if (receiver?.kind === 'event' && ['target', 'currentTarget'].includes(property)) return receiver[property];
      if (receiver?.kind === 'nodes' && receiver.nodes.length === 1 && receiver.nodes[0] === document && property === 'body') {
        return select(receiver, 'body', 'querySelector');
      }
      if (receiver?.kind === 'nodes' && !receiver.collection && ['parentNode', 'parentElement'].includes(property)) {
        const parents = receiver.nodes.map(node => node.parentNode)
          .filter(parent => parent && (property === 'parentNode' || parent.tagName));
        return nodesValue(parents, false, undefined, receiver.nullable || parents.length !== receiver.nodes.length);
      }
      return unknown;
    }
    if (node.type === 'UnaryExpression' && node.operator === '!') {
      const value = truth(evaluate(node.argument, scope, context, depth));
      return value === unknown ? unknown : !value;
    }
    if (node.type === 'LogicalExpression') {
      const left = evaluate(node.left, scope, context, depth);
      const condition = truth(left);
      if (condition === unknown) {
        inspectPossibleExpression(node.right, scope, context, depth);
        return unknown;
      }
      if (node.operator === '&&') return condition ? evaluate(node.right, scope, context, depth) : left;
      if (node.operator === '||') return condition ? left : evaluate(node.right, scope, context, depth);
      return unknown;
    }
    if (node.type === 'ConditionalExpression') {
      const condition = truth(evaluate(node.test, scope, context, depth));
      if (condition !== unknown) return evaluate(condition ? node.consequent : node.alternate, scope, context, depth);
      inspectPossibleExpression(node.consequent, scope, context, depth);
      inspectPossibleExpression(node.alternate, scope, context, depth);
      return unknown;
    }
    if (node.type === 'ChainExpression') {
      inspectPossibleExpression(node.expression, scope, context, depth);
      return unknown;
    }
    if (node.type === 'SequenceExpression') {
      let value = unknown;
      for (const expression of node.expressions) value = evaluate(expression, scope, context, depth);
      return value;
    }
    if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
      const target = node.left || node.argument;
      const value = node.type === 'AssignmentExpression' && node.operator === '=' ? evaluate(node.right, scope, context, depth) : unknown;
      if (target.type === 'Identifier') {
        const binding = lookup(scope, target.name);
        if (binding) binding.scope.bindings.set(target.name, effectsOnly ? unknown : value);
      } else if (target.type === 'MemberExpression') {
        const property = target.computed ? evaluate(target.property, scope, context, depth) : target.property.name;
        if (['addEventListener', 'querySelectorAll', 'querySelector', 'forEach', 'closest'].includes(property)) {
          invalidated = true;
          note('binding-method-reassigned');
        } else if (typeof property === 'string' && property.startsWith('on')) {
          const receiver = evaluate(target.object, scope, context, depth);
          if (effectsOnly && (HOVER_EVENTS.has(property.slice(2)) || FOCUS_EVENTS.has(property.slice(2)))) {
            invalidateMutation(receiver, 'point-listener-removal-not-verified');
          } else if (!effectsOnly && receiver?.kind === 'nodes' && !receiver.collection && !receiver.nullable) {
            for (const node of receiver.nodes) {
              if (!propertyHandlers.has(node)) propertyHandlers.set(node, new Map());
              propertyHandlers.get(node).set(property.slice(2), value?.kind === 'function');
            }
          }
        } else if (['innerHTML', 'outerHTML', 'textContent', 'innerText'].includes(property)) {
          invalidateMutation(evaluate(target.object, scope, context, depth), 'point-dom-mutation-not-verified');
        }
      }
      return value;
    }
    if (node.type !== 'CallExpression') return unknown;
    if (node.callee.type !== 'MemberExpression') {
      const callback = evaluate(node.callee, scope, context, depth);
      const args = node.arguments.map(argument => evaluate(argument, scope, context, depth));
      if (callback?.kind !== 'function') return unknown;
      if (context?.inlinePoint) record(context.eventName, context.inlinePoint);
      else if (context) for (const value of args) if (value?.eventSource === context) record(context.eventName, value);
      return invoke(callback, args, context, depth + 1);
    }
    const receiver = evaluate(node.callee.object, scope, context, depth);
    const method = node.callee.computed ? evaluate(node.callee.property, scope, context, depth) : node.callee.property.name;
    const args = node.arguments.map(argument => evaluate(argument, scope, context, depth));
    if (['querySelectorAll', 'querySelector', 'closest'].includes(method)) return select(receiver, args[0], method);
    if (method === 'forEach') {
      if (receiver?.kind !== 'nodes' || !receiver.collection) note('foreach-collection-not-resolved');
      else if (receiver.nodes.length > 0) invoke(args[0], [nodesValue(receiver.nodes)], context, depth + 1);
    } else if (method === 'addEventListener') register(receiver, args[0], args[1], node.arguments[2], depth);
    else if (method === 'removeEventListener') {
      if (typeof args[0] !== 'string' || HOVER_EVENTS.has(args[0]) || FOCUS_EVENTS.has(args[0]) || args[0] === 'DOMContentLoaded') {
        invalidateMutation(receiver, 'point-listener-removal-not-verified');
      }
    } else if (['remove', 'replaceWith', 'replaceChildren'].includes(method)) {
      invalidateMutation(receiver, 'point-dom-mutation-not-verified');
    } else if (['removeChild', 'replaceChild'].includes(method)) {
      invalidateMutation(args[method === 'removeChild' ? 0 : 1], 'point-dom-mutation-not-verified');
    }
    return unknown;
  }

  function visitStatements(statements, scope, context, depth) {
    for (const [index, statement] of statements.entries()) {
      if (statement.type === 'FunctionDeclaration' || statement.type === 'EmptyStatement') continue;
      if (statement.type === 'ExpressionStatement') evaluate(statement.expression, scope, context, depth);
      else if (statement.type === 'VariableDeclaration') {
        for (const declaration of statement.declarations) {
          const target = statement.kind === 'var' ? variableScope(scope) : scope;
          if (!declaration.init && statement.kind === 'var') continue;
          const value = declaration.id.type === 'Identifier' ? evaluate(declaration.init, scope, context, depth) : unknown;
          for (const name of bindingNames(declaration.id)) target.bindings.set(name, effectsOnly && statement.kind === 'var' ? unknown : value);
        }
      } else if (statement.type === 'BlockStatement') {
        const child = { parent: scope, bindings: new Map(), functionScope: false };
        prepare(statement.body, child);
        const outcome = visitStatements(statement.body, child, context, depth);
        if (outcome !== true) {
          if (outcome === unknown) inspectPossibleEffects(statements.slice(index + 1), scope, context, depth);
          return outcome;
        }
      } else if (statement.type === 'ReturnStatement') {
        evaluate(statement.argument, scope, context, depth);
        return false;
      } else if (statement.type === 'IfStatement') {
        const condition = truth(evaluate(statement.test, scope, context, depth));
        if (condition === unknown) {
          note('control-flow-not-verified');
          if (!effectsOnly) {
            inspectPossibleEffects(statements.slice(index), scope, context, depth);
            return unknown;
          }
          visitStatements([statement.consequent], scope, context, depth);
          if (statement.alternate) visitStatements([statement.alternate], scope, context, depth);
          continue;
        }
        const branch = condition ? statement.consequent : statement.alternate;
        const outcome = branch ? visitStatements([branch], scope, context, depth) : true;
        if (outcome !== true) {
          if (outcome === unknown) inspectPossibleEffects(statements.slice(index + 1), scope, context, depth);
          return outcome;
        }
      } else {
        invalidated = true;
        note('statement-not-verified');
        return false;
      }
    }
    return true;
  }

  for (const script of scripts) {
    let ast;
    try {
      ast = parseJavaScript(script.text, { ecmaVersion: 2022, sourceType: script.sourceType });
    } catch {
      note('script-syntax-not-verified');
      continue;
    }
    try {
      const scope = script.sourceType === 'module' ? { parent: globalScope, bindings: new Map(), functionScope: true } : globalScope;
      prepare(ast.body, scope, true);
      visitStatements(ast.body, scope, null, 0);
    } catch {
      invalidated = true;
      note('script-analysis-not-verified');
    }
  }
  for (const point of pointElements) {
    for (const [eventName, attached] of propertyHandlers.get(point.node) || []) {
      if (attached) record(eventName, nodesValue([point.node]));
    }
    for (const [attribute, source] of Object.entries(point.attributes)) {
      const eventName = attribute.startsWith('on') ? attribute.slice(2) : '';
      if (!HOVER_EVENTS.has(eventName) && !FOCUS_EVENTS.has(eventName)) continue;
      if (propertyHandlers.get(point.node)?.has(eventName)) continue;
      try {
        const ast = parseJavaScript(source, { ecmaVersion: 2022, sourceType: 'script', allowReturnOutsideFunction: true });
        const scope = { parent: globalScope, bindings: new Map(), functionScope: true };
        prepare(ast.body, scope, true);
        visitStatements(ast.body, scope, { eventName, inlinePoint: nodesValue([point.node]) }, 0);
      } catch { note('inline-handler-not-verified'); }
    }
  }
  const unverifiedHoverPointIndexes = pointElements.flatMap((point, index) => !invalidated && hover.has(point.node) ? [] : [index]);
  const unverifiedFocusPointIndexes = pointElements.flatMap((point, index) => !invalidated && focus.has(point.node) ? [] : [index]);
  return {
    hoverBinding: pointElements.length > 0 && unverifiedHoverPointIndexes.length === 0,
    focusBinding: pointElements.length > 0 && unverifiedFocusPointIndexes.length === 0,
    unverifiedHoverPointIndexes,
    unverifiedFocusPointIndexes,
    diagnostics,
  };
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
