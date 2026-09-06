import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { parseOceanReportHtml } from './ocean-report-html-parser.mjs';

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
