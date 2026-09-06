import { createRequire } from 'node:module';

const { parse } = createRequire(import.meta.url)('parse5');
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const NON_EVIDENCE_ELEMENTS = new Set(['script', 'style', 'template', 'noscript']);

export function parseOceanReportHtml(html) {
  const figures = [];
  const claims = [];
  const evidence = [];
  const violations = [];
  if (typeof html !== 'string') {
    return { ok: false, violations: ['html.parse_failed'], figures, claims, evidence };
  }
  let document;
  try {
    document = parse(html, {
      scriptingEnabled: true,
      onParseError(error) {
        if (error.code === 'duplicate-attribute') {
          violations.push(`html.duplicate-attribute:${error.startLine}:${error.startCol}`);
        }
      },
    });
  } catch {
    return { ok: false, violations: ['html.parse_failed'], figures, claims, evidence };
  }
  for (const node of evidenceNodes(document)) {
    if (!node.tagName || node.namespaceURI !== HTML_NAMESPACE) continue;
    const attributes = Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]));
    if (node.tagName === 'figure') figures.push({ attributes, caption: figureCaption(node) });
    if (Object.hasOwn(attributes, 'data-claim-id')) claims.push({ attributes });
    if (Object.hasOwn(attributes, 'data-evidence-id')) evidence.push({ attributes });
  }
  return { ok: violations.length === 0, violations, figures, claims, evidence };
}

function* evidenceNodes(root, skipNestedFigures = false) {
  const pending = [...(root.childNodes || [])].reverse();
  while (pending.length > 0) {
    const node = pending.pop();
    if (NON_EVIDENCE_ELEMENTS.has(node.tagName)
      || (skipNestedFigures && node.tagName === 'figure')) continue;
    yield node;
    const children = node.childNodes || [];
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]);
  }
}

function figureCaption(figure) {
  for (const node of evidenceNodes(figure, true)) {
    if (node.tagName !== 'figcaption' || node.namespaceURI !== HTML_NAMESPACE) continue;
    const text = [];
    for (const descendant of evidenceNodes(node)) {
      if (descendant.nodeName === '#text') text.push(descendant.value);
    }
    return text.join(' ').replace(/\s+/gu, ' ').trim();
  }
  return '';
}
