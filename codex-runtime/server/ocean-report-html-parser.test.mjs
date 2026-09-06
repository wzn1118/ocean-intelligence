import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { parseOceanEvidenceDocument, parseOceanReportHtml } from './ocean-report-html-parser.mjs';

test('parses browser attribute semantics and decodes references exactly once', () => {
  const result = parseOceanReportHtml(`<FIGURE DATA-FIGURE-ID=temperature
    data-unit="&#100;&#101;&#103;&#67;" data-method='A &amp; B &quot;C&quot;'
    data-literal="&amp;deg;C" data-boundary="x > y" data-temperature="&deg;C">
    <figcaption>Observed &lt; 25 <em>with</em> uncertainty.</figcaption></FIGURE>`);
  assert.equal(result.ok, true);
  assert.deepEqual(result.figures, [{
    attributes: {
      'data-figure-id': 'temperature', 'data-unit': 'degC', 'data-method': 'A & B "C"',
      'data-literal': '&deg;C', 'data-boundary': 'x > y', 'data-temperature': '\u00b0C',
    },
    caption: 'Observed < 25 with uncertainty.',
  }]);
});

test('duplicate attributes are rejected regardless of case, quotes, value or order', () => {
  for (const attributes of [
    'data-unit="bad" data-unit="degC"', 'data-unit="degC" data-unit="bad"',
    'DATA-UNIT=bad data-unit="degC"', 'data-unit="degC" data-unit="degC"',
    'data-unit data-unit="degC"',
  ]) {
    const result = parseOceanReportHtml(`<figure ${attributes}></figure>`);
    assert.equal(result.ok, false, attributes);
    assert.equal(result.violations.length, 1, attributes);
    assert.match(result.violations[0], /^html\.duplicate-attribute:\d+:\d+$/u);
  }
});

test('does not extract evidence, claims or captions from inert and raw-text content', () => {
  const decoy = '<figure data-figure-id="fake"><figcaption>Fake caption</figcaption></figure>'
    + '<p data-claim-id="fake" data-evidence-id="fake">Fake claim</p>';
  const result = parseOceanReportHtml(`<!-- ${decoy} -->
    <script>${decoy}</script><style>${decoy}</style><template>${decoy}</template>
    <noscript>${decoy}</noscript><textarea>${decoy}</textarea>
    <figure data-figure-id=real><figcaption>Real <script>not evidence</script>caption</figcaption></figure>
    <p data-claim-id=claim data-evidence-id=real>Real claim</p>`);
  assert.equal(result.ok, true);
  assert.equal(result.figures.length, 1);
  assert.equal(result.figures[0].caption, 'Real caption');
  assert.deepEqual(result.claims.map((entry) => entry.attributes['data-claim-id']), ['claim']);
  assert.deepEqual(result.evidence.map((entry) => entry.attributes['data-evidence-id']), ['real']);
});

test('follows repaired DOM boundaries without borrowing a nested figure caption', () => {
  const result = parseOceanReportHtml('<figure id=outer><figure id=inner><figcaption>Inner</figcaption>'
    + '</figure></figure><figure id=unclosed><figcaption>Unclosed');
  assert.equal(result.ok, true);
  assert.deepEqual(result.figures.map((entry) => [entry.attributes.id, entry.caption]), [
    ['outer', ''], ['inner', 'Inner'], ['unclosed', 'Unclosed'],
  ]);
});

test('non-text input fails closed without extracting partial evidence', () => {
  for (const invalid of [undefined, null, 42, {}, []]) {
    assert.deepEqual(parseOceanReportHtml(invalid), {
      ok: false, violations: ['html.parse_failed'], figures: [], claims: [], evidence: [],
    });
  }
});

test('R21 shared document parser retains structured diagnostics and the native tree', () => {
  const parsed = parseOceanEvidenceDocument('<!doctype html><html><body>\n'
    + '<section id=one id=two></section><select><option><span>Unsupported</span></option></select></body></html>');
  assert.equal(parsed.ok, false);
  assert.equal(parsed.document.nodeName, '#document');
  assert.deepEqual(parsed.violations.map((violation) => violation.code), ['duplicate-attribute', 'unsupported-select-content']);
  assert.ok(parsed.violations.every((violation) => Number.isInteger(violation.line) && violation.line > 0
    && Number.isInteger(violation.column) && violation.column > 0));
  assert.deepEqual(parseOceanEvidenceDocument(null), {
    ok: false, document: null, violations: [{ code: 'parse_failed' }],
  });
});

for (const mode of ['open', 'closed', 'OPEN', 'cl&#111;sed']) {
  test(`R21 rejects declarative shadow DOM before pruning mode=${mode}`, () => {
    const result = parseOceanReportHtml(`<div><template shadowrootmode="${mode}">`
      + '<figure id=shadow><figcaption>Shadow caption</figcaption></figure></template></div>');
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((violation) => violation.startsWith('html.unsupported-shadow-dom:')));
    assert.deepEqual(result.figures, []);
  });
}

for (const markup of [
  '<select><option><figure id=lost><figcaption>Lost</figcaption></figure></option></select>',
  '<select><optgroup label=group><section data-claim-id=lost>Lost</section></optgroup></select>',
  '<table><tr><td><select><option><span>Rich option</span></option></select></td></tr></table>',
  '<select><div><select><option>Nested</option></select></div></select>',
  '<svg><foreignObject><select><option><figure id=lost></figure></option></select></foreignObject></svg>',
]) {
  test(`R21 rejects unsupported rich HTML select tokens ${markup}`, () => {
    const result = parseOceanReportHtml(markup);
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((violation) => violation.startsWith('html.unsupported-select-content:')));
  });
}

for (const markup of [
  '<select><option>One<option>Two<optgroup label=group><option>Three</optgroup><hr></select>',
  '<select><template><div>Ordinary inert template</div></template><option>One</option></select>',
  '<select><script type="text/plain"><figure>Not a token</figure></script><option>One</option></select>',
  '<select><!-- <figure>Not a token</figure> --><option>One</option></select>',
  '<select><option>&lt;figure&gt;Text&lt;/figure&gt;</option></select><figure id=after></figure>',
  '<option><span>Outside a select</span></option><figure id=after></figure>',
  '<svg><select><option><figure>Foreign names</figure></option></select></svg>',
  '<template><select><option>Inert ordinary control</option></select></template>',
  '<div><template shadowrootmode=invalid><figure id=inert></figure></template></div>',
  '<script>const markup = "<template shadowrootmode=open><select><span>Not parsed</span></select></template>";</script>',
  '<!-- <template shadowrootmode=closed><select><span>Not parsed</span></select></template> -->',
  '<textarea><template shadowrootmode=open><select><span>Not parsed</span></select></template></textarea>',
  '<div data-example="<template shadowrootmode=open><select><span>Not parsed</span></select></template>"></div>',
  '<svg><template shadowrootmode=open><foreignObject><figure id=html></figure></foreignObject></template></svg>',
  '<select><option>Closed by parser</select><span>Outside the select</span>',
]) {
  test(`R21 preserves supported controls and namespace boundaries ${markup}`, () => {
    const result = parseOceanReportHtml(markup);
    assert.equal(result.ok, true, JSON.stringify(result.violations));
  });
}

test('R21 selects only the direct HTML caption and follows parser repairs', () => {
  const result = parseOceanReportHtml('<figure id=direct><div><figcaption>Borrowed</figcaption></div>'
    + '<figcaption>Direct</figcaption></figure><figure id=missing><div><figcaption>Borrowed</figcaption></div></figure>'
    + '<figure id=repaired><table><figcaption>Repaired</figcaption></table></figure>'
    + '<svg><foreignObject><figure id=integrated><figcaption>Integrated</figcaption></figure></foreignObject></svg>');
  assert.equal(result.ok, true);
  assert.deepEqual(result.figures.map((entry) => [entry.attributes.id, entry.caption]), [
    ['direct', 'Direct'], ['missing', ''], ['repaired', 'Repaired'], ['integrated', 'Integrated'],
  ]);
});

test('R21 guards HTML shadow templates inside SVG integration points', () => {
  const parsed = parseOceanReportHtml('<svg><foreignObject><div><template shadowrootmode=open>'
    + '<figure></figure></template></div></foreignObject></svg>');
  assert.equal(parsed.ok, false);
  assert.ok(parsed.violations.some((violation) => violation.startsWith('html.unsupported-shadow-dom:')));
});

test('R21 joins inline caption text without inserting character padding', () => {
  const text = 'Temperature increased.';
  const inline = [...text].map((letter) => `<span>${letter}</span>`).join('');
  const result = parseOceanReportHtml(`<figure><figcaption>${inline}</figcaption></figure>`
    + '<figure><figcaption>Measured <em>SST</em> &amp; uncertainty.</figcaption></figure>');
  assert.equal(result.ok, true);
  assert.deepEqual(result.figures.map((entry) => entry.caption), [text, 'Measured SST & uncertainty.']);
});

test('R21 excludes iframe fallback and SVG metadata but retains SVG text', () => {
  const result = parseOceanReportHtml('<figure><figcaption>Short.<iframe>Padding must not count.</iframe>'
    + '<svg><title>Title padding</title><desc>Description padding</desc><text>Actual SVG text.</text></svg>'
    + '</figcaption></figure><svg><template><foreignObject><figure id=foreign-template>'
    + '<figcaption>HTML inside a foreign element.</figcaption></figure></foreignObject></template></svg>');
  assert.equal(result.ok, true);
  assert.deepEqual(result.figures.map((entry) => entry.caption), ['Short.Actual SVG text.', 'HTML inside a foreign element.']);
});

test('resolves the pinned dependency outside a source bind mount through NODE_PATH', (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ocean-report-parser-deployment-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const isolatedModule = path.join(directory, 'parser.mjs');
  copyFileSync(new URL('./ocean-report-html-parser.mjs', import.meta.url), isolatedModule);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { parseOceanReportHtml } from ${JSON.stringify(pathToFileURL(isolatedModule).href)};
     if (!parseOceanReportHtml('<figure></figure>').ok) process.exit(1);`], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, NODE_PATH: fileURLToPath(new URL('./node_modules', import.meta.url)) },
  });
  assert.equal(child.status, 0, child.stderr || child.error?.message);
  const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('./package-lock.json', import.meta.url), 'utf8'));
  assert.equal(manifest.dependencies.parse5, '7.3.0');
  assert.equal(lock.packages['node_modules/parse5'].version, manifest.dependencies.parse5);
  const dockerfile = readFileSync(new URL('../../deploy/Dockerfile.codex-runtime', import.meta.url), 'utf8');
  assert.match(dockerfile, /COPY codex-runtime\/server\/package\.json codex-runtime\/server\/package-lock\.json \/opt\/ocean-codex-server\//u);
  assert.match(dockerfile, /npm ci --prefix \/opt\/ocean-codex-server --omit=dev --ignore-scripts/u);
  assert.match(dockerfile, /ENV NODE_PATH=\/opt\/ocean-codex-server\/node_modules/u);
});
