import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { generateMatlabPlotScript, resolveMatlabPlotRequest } from '../../server/matlab-plot-router.mjs';
import { generateRouterSmoke } from './generate_router_smoke.mjs';

function freshRoot(context) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'matlab-router-smoke-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function assertFileEvidence(root, evidence) {
  assert.equal(path.isAbsolute(evidence.file), false);
  assert.equal(evidence.file.split('/').includes('..'), false);
  const bytes = readFileSync(path.join(root, evidence.file));
  assert.equal(evidence.bytes, bytes.length);
  assert.equal(evidence.sha256, createHash('sha256').update(bytes).digest('hex'));
}

for (const release of ['R2021a', 'R2024b', 'R2026a']) {
  test(`${release}: two unchanged generated functions share hashed synthetic inputs`, (context) => {
    const outputRoot = freshRoot(context);
    const catalog = generateRouterSmoke({ release, outputRoot });
    const generatedRoot = path.join(outputRoot, 'generated-router');
    assert.deepEqual(JSON.parse(readFileSync(path.join(generatedRoot, 'catalog.json'), 'utf8')), catalog);
    assert.equal(catalog.target_release, release);
    assert.equal(catalog.scope, 'two-route-smoke');
    assert.equal(catalog.runtime_status, 'not-run');
    assert.equal(catalog.execution_verified, false);
    assert.equal(catalog.visual_inspection_verified, false);
    assert.equal(catalog.desktop_interaction_verified, false);
    assertFileEvidence(generatedRoot, catalog.inputs);
    const inputs = JSON.parse(readFileSync(path.join(generatedRoot, catalog.inputs.file), 'utf8'));
    assert.equal(inputs.synthetic, true);
    assert.equal(inputs.time_zone, 'UTC');
    assert.equal(inputs.value_unit, 'degC');
    assert.deepEqual(inputs.Value, [10, null, 12, 13, 14, 15]);
    assert.equal(inputs.Time.length, 6);
    assert.ok(inputs.Time.every((time, index) => time.endsWith('Z') && (!index || time > inputs.Time[index - 1])));
    assert.equal(new Set(inputs.ObservationID).size, 6);
    assert.equal(inputs.Station.length, 6);
    assert.deepEqual(inputs.QCFlag, ['good', 'missing', 'good', 'good', 'suspect', 'bad']);
    assert.deepEqual(catalog.cases.map((entry) => entry.id), ['static', 'interactive']);
    for (const entry of catalog.cases) {
      assertFileEvidence(generatedRoot, entry.script);
      const script = readFileSync(path.join(generatedRoot, entry.script.file), 'utf8');
      assert.equal(script, generateMatlabPlotScript(entry.request));
      assert.equal(script, resolveMatlabPlotRequest(entry.request).script);
      assert.ok(script.startsWith(`function result = ${entry.function_name}(${entry.parameters.join(', ')})\n`));
      assert.equal(entry.request.targetRelease, release);
      assert.equal(entry.request.assetDirectory, catalog.asset_directory);
      assert.equal(entry.request.outputDirectory, entry.id);
      assert.deepEqual(entry.request.publicationContract.target,
        { medium: 'journal', width: 8, height: 5, units: 'in', dpi: 300, formats: ['png', 'pdf', 'svg'] });
      assert.equal(entry.request.publicationContract.typography.fontFamily, 'WenQuanYi Zen Hei');
      assert.deepEqual(entry.request.publicationContract.typography.fallbackFamilies, ['Noto Sans CJK SC']);
      assert.deepEqual(readdirSync(path.join(generatedRoot, entry.output_directory)), []);
      assert.match(script, /'ExportSVG', true/u);
      assert.doesNotMatch(script, /system\s*\(/u);
      if (entry.id === 'interactive') {
        assert.equal(entry.request.interactionEnvironment, 'headless');
        assert.equal(entry.helper, 'interactive_timeseries_native_template');
        assert.match(script, /interactionRequested = false/u);
        assert.match(script, /'Export', false/u);
      } else {
        assert.equal(entry.helper, 'plot');
      }
    }
    assert.deepEqual(readdirSync(path.join(generatedRoot, 'source')).sort(),
      ['generated_router_interactive.m', 'generated_router_static.m', 'inputs.json']);
    assert.equal(existsSync(path.join(generatedRoot, 'generated-router-evidence.json')), false);
  });
}

test('reuse is rejected without overwriting existing source or output', (context) => {
  const outputRoot = freshRoot(context);
  generateRouterSmoke({ release: 'R2021a', outputRoot });
  const generatedRoot = path.join(outputRoot, 'generated-router');
  const catalogBefore = readFileSync(path.join(generatedRoot, 'catalog.json'));
  const inputPath = path.join(generatedRoot, 'source', 'inputs.json');
  writeFileSync(inputPath, 'changed evidence');
  const sentinel = path.join(generatedRoot, 'static', 'router_static.png');
  writeFileSync(sentinel, 'existing artifact');
  assert.throws(() => generateRouterSmoke({ release: 'R2024b', outputRoot }), { code: 'EEXIST' });
  assert.deepEqual(readFileSync(path.join(generatedRoot, 'catalog.json')), catalogBefore);
  assert.equal(readFileSync(inputPath, 'utf8'), 'changed evidence');
  assert.equal(readFileSync(sentinel, 'utf8'), 'existing artifact');
});

test('even an empty existing generated-router directory is rejected', (context) => {
  const outputRoot = freshRoot(context);
  mkdirSync(path.join(outputRoot, 'generated-router'));
  assert.throws(() => generateRouterSmoke({ release: 'R2021a', outputRoot }), { code: 'EEXIST' });
  assert.deepEqual(readdirSync(path.join(outputRoot, 'generated-router')), []);
});

test('missing, malformed, unknown and unsupported releases create no evidence', (context) => {
  const outputRoot = freshRoot(context);
  for (const release of [undefined, '', '2021a', 'latest', 'R2021c', 'R2099a', 'R2018b']) {
    assert.throws(() => generateRouterSmoke({ release, outputRoot }));
    assert.deepEqual(readdirSync(outputRoot), []);
  }
});

test('output root and asset directory must already exist as directories', (context) => {
  const outputRoot = freshRoot(context);
  const missingRoot = path.join(outputRoot, 'missing');
  assert.throws(() => generateRouterSmoke({ release: 'R2021a', outputRoot: missingRoot }));
  assert.equal(existsSync(missingRoot), false);
  assert.throws(() => generateRouterSmoke({ release: 'R2021a', outputRoot, assetDirectory: missingRoot }));
  const filePath = path.join(outputRoot, 'not-a-directory');
  writeFileSync(filePath, 'keep');
  assert.throws(() => generateRouterSmoke({ release: 'R2021a', outputRoot: filePath }));
  assert.throws(() => generateRouterSmoke({ release: 'R2021a', outputRoot, assetDirectory: filePath }));
  assert.equal(existsSync(path.join(outputRoot, 'generated-router')), false);
});

test('CLI accepts release and existing output_root only, with no shell', (context) => {
  const outputRoot = freshRoot(context);
  const scriptPath = fileURLToPath(new URL('./generate_router_smoke.mjs', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8', shell: false });
  const missing = run();
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Usage:/u);
  const extra = run('R2021a', outputRoot, 'unexpected');
  assert.equal(extra.status, 1);
  assert.equal(existsSync(path.join(outputRoot, 'generated-router')), false);
  const generated = run('R2021a', outputRoot);
  assert.equal(generated.status, 0, generated.stderr);
  assert.deepEqual(JSON.parse(generated.stdout), {
    catalog: path.join(outputRoot, 'generated-router', 'catalog.json'),
    target_release: 'R2021a', generated_cases: 2, execution_verified: false,
  });
  assert.equal(run('R2021a', outputRoot).status, 1);
});
