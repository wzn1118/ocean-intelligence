import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs, { linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createIllustratedReportContract, inspectReportMatlabSources,
  REQUIRED_MATLAB_REPORT_RELEASES, REQUIRED_REPORT_ZONE_NAMES,
} from './illustrated-report-contract.mjs';
import { inspectReportStatusEvidence } from './report-status-evidence.mjs';
import { createReportEvidencePolicyStore } from './report-evidence-policy.mjs';

const REPORT_ID = 'report-alpha';
const SOURCE = 'function output = plot_report()\noutput = 42;\nend\n';

function fixture(context) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'report-matlab-source-scope-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const outputDirectory = path.join(directory, 'generated');
  mkdirSync(outputDirectory);
  const options = { outputDirectory, expectedReportId: REPORT_ID };
  const sourceDirectory = path.join(outputDirectory, `${REPORT_ID}-matlab`);
  return { directory, outputDirectory, sourceDirectory, options };
}

function createSource(state, filename = 'plot_report.m', contents = SOURCE) {
  mkdirSync(state.sourceDirectory, { recursive: true });
  const file = path.join(state.sourceDirectory, filename);
  writeFileSync(file, contents);
  return file;
}

function traceRead(context, callback) {
  const reads = [];
  const descriptors = new Map();
  const mocks = ['openSync', 'readFileSync'].map(method => {
    const native = fs[method];
    return context.mock.method(fs, method, (...args) => {
      const file = typeof args[0] === 'number' ? descriptors.get(args[0]) : args[0];
      reads.push({ method, file });
      const result = native(...args);
      if (method === 'openSync') descriptors.set(result, args[0]);
      return result;
    });
  });
  syncBuiltinESMExports();
  try { return { result: callback(), reads }; }
  finally { for (const mocked of mocks.reverse()) mocked.mock.restore(); syncBuiltinESMExports(); }
}

test('discovers a directly owned source with a legal matching function filename without executing MATLAB', context => {
  const state = fixture(context);
  const file = createSource(state);
  assert.match(path.basename(file), /^[A-Za-z][A-Za-z0-9_]*\.m$/u);
  assert.match(readFileSync(file, 'utf8'), /^function output = plot_report\(\)/u);
  assert.deepEqual(inspectReportMatlabSources(state.options), { ok: true, sourcePaths: [file], violations: [] });
});

test('legacy root prefix evidence remains accepted without certifying function callability', context => {
  const state = fixture(context);
  const file = path.join(state.outputDirectory, `${REPORT_ID}-plot.m`);
  writeFileSync(file, SOURCE);
  assert.doesNotMatch(path.basename(file), /^[A-Za-z][A-Za-z0-9_]*\.m$/u);
  assert.deepEqual(inspectReportMatlabSources(state.options), { ok: true, sourcePaths: [file], violations: [] });
});

test('both source forms are retained once and sorted without selecting a replacement implementation', context => {
  const state = fixture(context);
  const first = createSource(state, 'Alpha_01.m');
  const second = createSource(state, 'z.m');
  const legacy = path.join(state.outputDirectory, `${REPORT_ID}-plot.M`);
  writeFileSync(legacy, SOURCE);
  assert.deepEqual(inspectReportMatlabSources(state.options), { ok: true, sourcePaths: [first, second, legacy].sort(), violations: [] });
});

for (const folder of ['elsewhere', 'other-report-matlab', `${REPORT_ID}bet-matlab`, `${REPORT_ID}-child-matlab`, `${REPORT_ID}-matlab-extra`]) {
  test(`does not enumerate or borrow a different source directory: ${folder}`, context => {
    const state = fixture(context);
    const other = path.join(state.outputDirectory, folder);
    mkdirSync(other);
    writeFileSync(path.join(other, 'plot_report.m'), SOURCE);
    const { result, reads } = traceRead(context, () => inspectReportMatlabSources(state.options));
    assert.deepEqual(result, { ok: false, sourcePaths: [], violations: ['missing'] });
    assert.deepEqual(reads, []);
  });
}

for (const filename of ['1plot.m', '_plot.m', 'plot-report.m', 'plot report.m', 'plot.M', 'plot.m.bak', 'plot.m/', 'nested', 'README.md']) {
  test(`reserved directory rejects invalid direct entry ${filename} alongside a valid source`, context => {
    const state = fixture(context);
    createSource(state);
    if (filename === 'plot.m/') mkdirSync(path.join(state.sourceDirectory, 'plot.m'));
    else if (filename === 'nested') {
      mkdirSync(path.join(state.sourceDirectory, filename));
      writeFileSync(path.join(state.sourceDirectory, filename, 'other.m'), SOURCE);
    } else writeFileSync(path.join(state.sourceDirectory, filename), SOURCE);
    const result = inspectReportMatlabSources(state.options);
    assert.equal(result.ok, false);
    assert.ok(result.violations.some(violation => violation.startsWith(`${REPORT_ID}-matlab/`)));
    assert.ok(!result.sourcePaths.some(file => file.includes('/nested/')));
  });
}

for (const name of [
  'break', 'case', 'catch', 'classdef', 'continue', 'else', 'elseif', 'end', 'for', 'function',
  'global', 'if', 'otherwise', 'parfor', 'persistent', 'return', 'spmd', 'switch', 'try', 'while',
]) {
  test(`new source basename rejects the MATLAB keyword ${name} without reading it`, context => {
    const state = fixture(context);
    createSource(state, `${name}.m`);
    const { result, reads } = traceRead(context, () => inspectReportMatlabSources(state.options));
    assert.equal(result.ok, false);
    assert.deepEqual(result.sourcePaths, []);
    assert.ok(result.violations.includes(`${REPORT_ID}-matlab/${name}.m.invalid_source_name`));
    assert.deepEqual(reads, []);
  });
}

for (const name of ['a', 'If', 'function_plot', 'A'.repeat(63)]) {
  test(`new source basename permits the cross-release identifier ${name}`, context => {
    const state = fixture(context);
    const file = createSource(state, `${name}.m`, `function ${name}()\nend\n`);
    assert.deepEqual(inspectReportMatlabSources(state.options), { ok: true, sourcePaths: [file], violations: [] });
  });
}

test('new source basename rejects identifiers exceeding the R2021a-compatible 63-character limit', context => {
  const state = fixture(context);
  createSource(state, `${'A'.repeat(64)}.m`);
  const { result, reads } = traceRead(context, () => inspectReportMatlabSources(state.options));
  assert.equal(result.ok, false);
  assert.ok(result.violations.some(violation => violation.endsWith('invalid_source_name')));
  assert.deepEqual(reads, []);
});

for (const location of ['directory-outside', 'directory-inside', 'source-outside', 'source-other-report', 'hardlink']) {
  test(`new source scope rejects links before reading linked evidence: ${location}`, context => {
    const state = fixture(context);
    const outside = path.join(state.directory, 'outside');
    mkdirSync(outside);
    const external = path.join(outside, 'plot_report.m');
    writeFileSync(external, SOURCE);
    const other = path.join(state.outputDirectory, 'other-report-matlab');
    mkdirSync(other);
    const foreign = path.join(other, 'plot_report.m');
    writeFileSync(foreign, SOURCE);
    if (location.startsWith('directory-')) symlinkSync(location === 'directory-outside' ? outside : other, state.sourceDirectory, 'dir');
    else {
      mkdirSync(state.sourceDirectory);
      const candidate = path.join(state.sourceDirectory, 'plot_report.m');
      if (location === 'hardlink') linkSync(external, candidate);
      else symlinkSync(location === 'source-outside' ? external : foreign, candidate);
    }
    const { result, reads } = traceRead(context, () => inspectReportMatlabSources(state.options));
    assert.equal(result.ok, false);
    assert.deepEqual(result.sourcePaths, []);
    assert.deepEqual(reads, []);
    assert.ok(result.violations.some(violation => /symlink|hardlink/u.test(violation)), JSON.stringify(result));
  });
}

test('reserved directory name occupied by a file cannot be hidden by a valid legacy source', context => {
  const state = fixture(context);
  writeFileSync(path.join(state.outputDirectory, `${REPORT_ID}-plot.m`), SOURCE);
  writeFileSync(state.sourceDirectory, 'Not a source directory');
  assert.equal(inspectReportMatlabSources(state.options).ok, false);
});

test('enumeration-time directory replacement is rejected before a replacement source is read', context => {
  const state = fixture(context);
  createSource(state);
  const native = fs.readdirSync;
  const mocked = context.mock.method(fs, 'readdirSync', (...args) => {
    const entries = native(...args);
    if (args[0] === state.sourceDirectory) {
      renameSync(state.sourceDirectory, `${state.sourceDirectory}-original`);
      mkdirSync(state.sourceDirectory);
      writeFileSync(path.join(state.sourceDirectory, 'plot_report.m'), SOURCE);
    }
    return entries;
  });
  syncBuiltinESMExports();
  try {
    const { result, reads } = traceRead(context, () => inspectReportMatlabSources(state.options));
    assert.equal(result.ok, false);
    assert.ok(result.violations.some(violation => violation.endsWith('directory_changed')));
    assert.deepEqual(reads, []);
  } finally { mocked.mock.restore(); syncBuiltinESMExports(); }
});

test('source replacement at guarded open does not become accepted evidence', context => {
  const state = fixture(context);
  const file = createSource(state);
  const native = fs.openSync;
  const mocked = context.mock.method(fs, 'openSync', (...args) => {
    if (args[0] === file) {
      renameSync(file, `${file}.original`);
      writeFileSync(file, SOURCE);
    }
    return native(...args);
  });
  syncBuiltinESMExports();
  try {
    const result = inspectReportMatlabSources(state.options);
    assert.equal(result.ok, false);
    assert.deepEqual(result.sourcePaths, []);
    assert.ok(result.violations.some(violation => violation.endsWith('unreadable')));
  } finally { mocked.mock.restore(); syncBuiltinESMExports(); }
});

test('source directory is derived from the report ID rather than an additional path option', context => {
  const state = fixture(context);
  const other = path.join(state.directory, 'user-supplied');
  mkdirSync(other);
  writeFileSync(path.join(other, 'plot_report.m'), SOURCE);
  const { result, reads } = traceRead(context, () => inspectReportMatlabSources({
    ...state.options, sourceDirectory: other, sourcePaths: [path.join(other, 'plot_report.m')],
  }));
  assert.equal(result.ok, false);
  assert.deepEqual(result.sourcePaths, []);
  assert.deepEqual(reads, []);
});

for (const badId of ['../report-alpha', 'report-alpha/../other-report', 'report-alpha\\other', 'report-alpha/extra', 'short']) {
  test(`invalid report identity never reaches source reads: ${badId}`, context => {
    const state = fixture(context);
    createSource(state);
    const { result, reads } = traceRead(context, () => inspectReportMatlabSources({ ...state.options, expectedReportId: badId }));
    assert.equal(result.ok, false);
    assert.ok(result.violations.includes('report_id_invalid'));
    assert.deepEqual(reads, []);
  });
}

test('unchanged policy rejects delimiter-prefix namespace collisions and path inputs', async context => {
  const state = fixture(context);
  const filePath = path.join(state.directory, 'policy.json');
  const store = createReportEvidencePolicyStore({ filePath });
  const request = { tenantKey: 'tenant-a', threadId: 'thread-a', reportId: REPORT_ID };
  await store.bind(request);
  const before = readFileSync(filePath);
  for (const collision of [`${REPORT_ID}-child`, `${REPORT_ID}-matlab`]) {
    await assert.rejects(store.bind({ ...request, reportId: collision }), { code: 'CODEX_REPORT_POLICY_CONFLICT' });
  }
  await assert.rejects(store.bind({ ...request, sourceDirectory: 'arbitrary' }), { code: 'CODEX_REPORT_POLICY_INVALID_INPUT' });
  assert.deepEqual(readFileSync(filePath), before);
  await store.bind({ ...request, reportId: `${REPORT_ID}bet` });
});

test('synthetic component forwards full scoped source paths without certifying real MATLAB execution', context => {
  const state = createComponentFixture(context);
  const result = inspectReportStatusEvidence(state);
  assert.equal(result.ok, true, JSON.stringify(result.violations));
  assert.deepEqual(inspectReportMatlabSources(state.options).sourcePaths, [state.sourcePath]);
  assert.deepEqual(result.matlabPlotQuality.manifestFreshness.evidenceFiles.filter(entry => entry.file.endsWith('.m')).map(entry => entry.file), [state.sourcePath]);
  assert.equal(state.manifest.synthetic, true);
});

for (const missing of ['manifest', 'interaction', 'runtime']) {
  test(`new source discovery cannot elevate missing ${missing} evidence`, context => {
    const state = createComponentFixture(context);
    if (missing === 'manifest') rmSync(state.manifestPath);
    else if (missing === 'interaction') { delete state.manifest.figures[0].exports.html; writeManifest(state); }
    else { state.manifest.matlab_ci.runs[0].execution_verified = false; writeManifest(state); }
    const result = inspectReportStatusEvidence(state);
    assert.equal(result.ok, false);
    assert.ok(!result.violations.includes('report-matlab-sources-missing'));
    assert.ok(result.violations.includes(missing === 'manifest' ? 'report-manifest-invalid-or-missing'
      : missing === 'interaction' ? 'report-point-interaction-missing' : 'report-illustrated-evidence-failed'));
  });
}

test('scoped source contents and mtime still participate in source quality and freshness failures', context => {
  const state = createComponentFixture(context);
  writeFileSync(state.sourcePath, 'jet(99);\n');
  const future = new Date(Date.now() + 10000);
  utimesSync(state.sourcePath, future, future);
  const result = inspectReportStatusEvidence(state);
  assert.equal(result.ok, false);
  assert.equal(result.matlabPlotQuality.sourceQualityOk, false);
  assert.equal(result.matlabPlotQuality.manifestFreshnessOk, false);
});

function createComponentFixture(context) {
  const state = fixture(context);
  const generatedRoot = state.outputDirectory;
  const report = createIllustratedReportContract(generatedRoot, REPORT_ID);
  const policy = { profile: 'matlab-illustrated-v1', reportId: report.id };
  const [htmlPath, markdownPath] = report.absolutePaths;
  const manifestPath = path.join(generatedRoot, `${report.id}-figures.json`);
  const sourcePath = createSource(state, 'plot_report.m', `function plot_report()\n`
    + `theme = oi_ocean_theme();\nfigure_handle = oi_figure(1400, 800, 'off');\naxes_handle = axes('Parent', figure_handle);\n`
    + `plot(axes_handle, 1:2, [20 18]);\noi_apply_axes(axes_handle, theme);\n`
    + `oi_export_png(figure_handle, 'synthetic.png', 1400, 800, 160);\nprint(figure_handle, 'synthetic.pdf', '-dpdf', '-painters');\nend\n`);
  const pngPath = path.join(generatedRoot, `${report.id}-chart.png`);
  const pdfPath = path.join(generatedRoot, `${report.id}-chart.pdf`);
  const interactionPath = path.join(generatedRoot, `${report.id}-detail.html`);
  const coverage = { start: '2026-09-03T00:00:00Z', end: '2026-09-03T01:00:00Z', timezone: 'UTC' };
  const uncertainty = { status: 'present', method: 'Synthetic standard uncertainty', limitations: 'Only synthetic test declarations, not field calibration evidence.' };
  const anomaly = { status: 'not-evaluated', method: 'No baseline', limitations: 'No real anomaly assessment is possible from this synthetic fixture.' };
  const variable = { name: 'sea_water_temperature', unit: 'degree_Celsius' };
  const attributes = `data-snapshot-id="synthetic-snapshot" data-source="synthetic-source" data-variable="${variable.name}" data-unit="${variable.unit}" data-time-start="${coverage.start}" data-time-end="${coverage.end}" data-timezone="UTC" data-spatial-coverage="Synthetic Sea 120-121E 30-31N" data-qc-summary="raw=2 valid=2 missing=0 qc_rejected=0" data-uncertainty="Synthetic uncertainty, no field evidence" data-uncertainty-status="present" data-uncertainty-method="${uncertainty.method}" data-anomaly-status="not-evaluated" data-matlab-release="R2026a"`;
  writeFileSync(htmlPath, `<!doctype html><html><body><p data-claim-id="claim-1" data-evidence-ids="fig-1" data-limitations="Only this synthetic test window is represented.">Synthetic component test.</p><figure data-figure-id="fig-1" ${attributes}><figcaption>Two synthetic temperatures in the declared UTC window, with supplied QC and uncertainty; no real sea-state inference is supported.</figcaption></figure></body></html>`);
  writeFileSync(markdownPath, '# Synthetic component fixture\nNot a complete ocean report or MATLAB execution record.');
  const png = Buffer.alloc(12000);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(1400, 16);
  png.writeUInt32BE(800, 20);
  png.write('IEND', png.length - 8, 'ascii');
  writeFileSync(pngPath, png);
  writeFileSync(pdfPath, '%PDF-1.4\n1 0 obj << /Type /Page /MediaBox [0 0 630 360] >> endobj\n2 0 obj << /Length 75 >> stream\nBT (Synthetic temperature degree Celsius UTC, not MATLAB output) Tj ET\nendstream endobj\n%%EOF');
  const points = [20, 18].map((temperature, index) => ({ id: `P${index + 1}`, series: index ? 'bottom' : 'surface', temperature, unit: variable.unit, time: index ? coverage.end : coverage.start, longitude: 120.2 + index / 10, latitude: 30.2 + index / 10, qc: 'good' }));
  const pointMarkup = points.map((point, index) => `<g class="temperature-point" tabindex="0" role="img" data-point-index="${index}" data-observation-id="${point.id}" data-temperature="${point.temperature}" data-unit="${point.unit}" data-time="${point.time}" data-longitude="${point.longitude}" data-latitude="${point.latitude}" data-qc="${point.qc}" aria-label="point ${point.id} temperature ${point.temperature} unit ${point.unit} time ${point.time} longitude ${point.longitude} latitude ${point.latitude} QC ${point.qc}"></g>`).join('');
  writeFileSync(interactionPath, `<!doctype html><html><head><style>.temperature-point:hover{opacity:.8}.temperature-point:focus-visible{outline:2px solid black}</style></head><body ${attributes} data-authoritative-runtime="MATLAB" data-runtime-status="passed" data-execution-verified="true" data-artifact-validation="passed" data-visual-inspection="passed"><svg>${pointMarkup}</svg><div class="legend" aria-label="Series legend"><span data-series-name="surface">surface</span><span data-series-name="bottom">bottom</span></div><div role="tooltip" hidden></div><script type="application/json">${JSON.stringify({ points })}</script><script>document.querySelectorAll('.temperature-point').forEach((point)=>{point.addEventListener('pointerenter',showTooltip);point.addEventListener('focus',showTooltip);});function showTooltip(){}</script></body></html>`);
  const shared = { figure_id: 'fig-1', title: 'Synthetic component figure', source: 'synthetic-source', theme: 'Ocean Intelligence', snapshot_id: 'synthetic-snapshot' };
  const runtime = { authoritative_runtime: 'MATLAB', runtime_status: 'passed', execution_verified: true, artifact_validation: { status: 'passed' }, visual_inspection: { status: 'passed' } };
  const manifest = {
    schema_version: 2, synthetic: true, generator: 'Synthetic unit-test composition, not MATLAB execution evidence',
    ocean_report: {
      area: { name: 'Synthetic Sea', bounds: [120, 30, 121, 31], zones: REQUIRED_REPORT_ZONE_NAMES },
      requested_coverage: { ...coverage, spatial: 'Synthetic Sea bounds', depth: 'Synthetic surface and bottom' },
      effective_coverage: { ...coverage, spatial: 'Synthetic Sea bounds', depth: 'Synthetic surface and bottom' },
      data_sources: [{ id: shared.source, name: 'Synthetic test data', version: '1', accessed_at: '2026-09-05T00:00:00Z' }],
      variables: [{ ...variable, quantity: 'sea water temperature', source_ids: [shared.source] }],
      uncertainty, anomaly, conclusion: { status: 'audited', limitations: 'Synthetic contract tests only, not a real ocean report assessment.' },
    },
    matlab_ci: {
      required_releases: REQUIRED_MATLAB_REPORT_RELEASES,
      runs: REQUIRED_MATLAB_REPORT_RELEASES.map(release => ({ ...runtime, release, command: 'synthetic unit-test declaration, not executed', toolboxes: ['MATLAB'], evidence_id: `synthetic-${release}` })),
    },
    figures: [{
      id: shared.figure_id, title: shared.title, source: shared.source, theme: shared.theme,
      scientific_context: { snapshot_id: shared.snapshot_id, variables: [variable], temporal_coverage: coverage, spatial_coverage: { name: 'Synthetic Sea', bounds: [120, 30, 121, 31] }, qc: { raw: 2, valid: 2, missing: 0, qc_rejected: 0 }, uncertainty, anomaly },
      runtime: { ...runtime, matlab_release: 'R2026a' },
      interaction: { required: true, self_contained: true, validation_status: 'passed', snapshot_id: shared.snapshot_id },
      exports: {
        png: { ...shared, ...artifactMetadata(pngPath), width: 1400, height: 800, dpi: 160 },
        pdf: { ...shared, ...artifactMetadata(pdfPath), width: 630, height: 360, text: 'Synthetic temperature UTC' },
        html: { ...shared, ...artifactMetadata(interactionPath), self_contained: true },
      },
    }],
  };
  Object.assign(state, { report, policy, generatedRoot, htmlPath, markdownPath, manifestPath, sourcePath, manifest });
  writeManifest(state);
  return state;
}

function artifactMetadata(file) {
  const contents = readFileSync(file);
  return { file: path.basename(file), bytes: contents.length, sha256: createHash('sha256').update(contents).digest('hex') };
}

function writeManifest(state) {
  state.manifest.generated_at = new Date().toISOString();
  writeFileSync(state.manifestPath, JSON.stringify(state.manifest));
}
