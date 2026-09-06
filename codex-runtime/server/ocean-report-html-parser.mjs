import { createRequire } from 'node:module';

const { Parser, html: { TAG_ID } } = createRequire(import.meta.url)('parse5');
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const NON_EVIDENCE_ELEMENTS = new Set(['script', 'style', 'template', 'noscript']);
const NON_EVIDENCE_SVG_ELEMENTS = new Set(['script', 'style']);
const SVG_CAPTION_METADATA = new Set(['title', 'desc']);
const SUPPORTED_SELECT_START_TAGS = new Set([
  'html', 'option', 'optgroup', 'hr', 'input', 'keygen', 'textarea', 'select', 'script', 'template',
]);

class OceanEvidenceParser extends Parser {
  constructor(options, violations) {
    super(options);
    this.evidenceViolations = violations;
  }

  onStartTag(token) {
    if (!this.shouldProcessStartTagTokenInForeignContent(token)) {
      const current = this.openElements.current;
      if (current?.namespaceURI === HTML_NAMESPACE && this.openElements.hasInSelectScope(TAG_ID.SELECT)
        && !SUPPORTED_SELECT_START_TAGS.has(token.tagName)) {
        this.recordUnsupported('unsupported-select-content', token);
      }
      if (token.tagName === 'template' && token.attrs.some(({ name, value }) => name === 'shadowrootmode'
        && ['open', 'closed'].includes(value.toLowerCase()))) {
        this.recordUnsupported('unsupported-shadow-dom', token);
      }
    }
    super.onStartTag(token);
  }

  recordUnsupported(code, token) {
    this.evidenceViolations.push({ code, line: token.location.startLine, column: token.location.startCol });
  }
}

export function parseOceanEvidenceDocument(html) {
  const violations = [];
  if (typeof html !== 'string') {
    return { ok: false, document: null, violations: [{ code: 'parse_failed' }] };
  }
  try {
    const parser = new OceanEvidenceParser({
      scriptingEnabled: true,
      sourceCodeLocationInfo: true,
      onParseError(error) {
        if (error.code === 'duplicate-attribute') {
          violations.push({ code: error.code, line: error.startLine, column: error.startCol });
        }
      },
    }, violations);
    parser.tokenizer.write(html, true);
    return { ok: violations.length === 0, document: parser.document, violations };
  } catch {
    return { ok: false, document: null, violations: [...violations, { code: 'parse_failed' }] };
  }
}

export function parseOceanReportHtml(html) {
  const figures = [];
  const claims = [];
  const evidence = [];
  const { ok, document, violations: issues } = parseOceanEvidenceDocument(html);
  const violations = issues.map(({ code, line, column }) => code === 'parse_failed'
    ? 'html.parse_failed' : `html.${code}:${line}:${column}`);
  if (!document) return { ok, violations, figures, claims, evidence };
  for (const node of evidenceNodes(document)) {
    if (!node.tagName || node.namespaceURI !== HTML_NAMESPACE) continue;
    const attributes = Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]));
    if (node.tagName === 'figure') figures.push({ attributes, caption: figureCaption(node) });
    if (Object.hasOwn(attributes, 'data-claim-id')) claims.push({ attributes });
    if (Object.hasOwn(attributes, 'data-evidence-id')) evidence.push({ attributes });
  }
  return { ok, violations, figures, claims, evidence };
}

function* evidenceNodes(root, forCaption = false) {
  const pending = [...(root.childNodes || [])].reverse();
  while (pending.length > 0) {
    const node = pending.pop();
    if ((node.namespaceURI === HTML_NAMESPACE && NON_EVIDENCE_ELEMENTS.has(node.tagName))
      || (node.namespaceURI === SVG_NAMESPACE && NON_EVIDENCE_SVG_ELEMENTS.has(node.tagName))) continue;
    if (forCaption && ((node.namespaceURI === HTML_NAMESPACE && node.tagName === 'iframe')
      || (node.namespaceURI === SVG_NAMESPACE && SVG_CAPTION_METADATA.has(node.tagName)))) continue;
    yield node;
    const children = node.childNodes || [];
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]);
  }
}

function figureCaption(figure) {
  const caption = figure.childNodes?.find((node) => node.tagName === 'figcaption' && node.namespaceURI === HTML_NAMESPACE);
  if (!caption) return '';
  const text = [];
  for (const descendant of evidenceNodes(caption, true)) {
    if (descendant.nodeName === '#text') text.push(descendant.value);
    else if (descendant.namespaceURI === HTML_NAMESPACE && descendant.tagName === 'br') text.push('\n');
  }
  return text.join('').replace(/\s+/gu, ' ').trim();
}
