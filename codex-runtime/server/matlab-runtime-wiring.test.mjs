import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

import { routeMatlabRuntimeRequest } from './matlab-runtime-route-service.mjs';

const runtimeSource = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('registers the MATLAB task route in the runtime API', () => {
  assert.match(runtimeSource, /import \{ routeMatlabRuntimeRequest \} from '\.\/matlab-runtime-route-service\.mjs'/u);
  assert.match(runtimeSource, /POST' && url\.pathname === '\/api\/codex-runtime\/matlab\/route'/u);
  assert.match(runtimeSource, /routeMatlabRuntimeRequest\(body\)/u);
});

test('runtime composition exposes release-aware exports and manifest without a plot generator', () => {
  const route = routeMatlabRuntimeRequest({
    runtime: 'matlab', taskType: 'export', targetRelease: 'R2024b', matlabAvailable: true,
    outputFormats: ['png', 'svg'], manifestContract: { path: 'artifacts/figures.json' },
  });
  assert.equal(route.status, 'ready');
  assert.equal(route.outputContract.exportStrategies.png.api, 'exportgraphics');
  assert.equal(route.outputContract.exportStrategies.svg.api, 'print');
  assert.equal(route.outputContract.manifest.schemaVersion, 2);
  assert.equal(route.outputContract.manifest.path, 'artifacts/figures.json');
  assert.deepEqual(route.runtimeCiMatrix.jobs.map((job) => job.targetRelease), ['R2021a', 'R2024b', 'R2026a']);
});

test('production wiring keeps MATLAB evidence external and rejects Octave relabeling', () => {
  const regressionScript = readFileSync(path.resolve('scripts/matlab-plot-regression.sh'), 'utf8');
  const reportScript = readFileSync(path.resolve('scripts/full-matlab-capability-report.sh'), 'utf8');
  const dockerfile = readFileSync(path.resolve('deploy/Dockerfile.codex-runtime'), 'utf8');
  const compose = readFileSync(path.resolve('compose.prod.yaml'), 'utf8');
  assert.match(regressionScript, /OCEAN_MATLAB_EXECUTABLE/u);
  assert.match(regressionScript, /exit 78/u);
  assert.doesNotMatch(regressionScript, /\boctave\s+--/u);
  assert.doesNotMatch(reportScript, /\boctave\s+--/u);
  assert.match(reportScript, /matlab-capability-\$\{expected_release\}\.tar\.gz/u);
  assert.match(dockerfile, /external-mathworks-only/u);
  assert.match(dockerfile, /octave-evidence-accepted="false"/u);
  assert.match(dockerfile, /^\s+ca-certificates\s+\\$/mu);
  assert.match(compose, /OCEAN_MATLAB_RELEASE: \$\{OCEAN_MATLAB_RELEASE:-R2026a\}/u);
  assert.match(compose, /MATLAB_LICENSE_FILE: \$\{MATLAB_LICENSE_FILE:-\}/u);
});

test('runtime composition returns stable contracts for malformed JSON shapes', () => {
  const nullPayload = routeMatlabRuntimeRequest(null);
  assert.equal(nullPayload.status, 'needs-input');
  assert.equal(nullPayload.error.code, 'MATLAB_REQUEST_INVALID');

  const hostileProxy = new Proxy({}, { getPrototypeOf: () => { throw new Error('hostile prototype trap'); } });
  for (const nonJsonObject of [new Date(), new Map(), Object.create({ runtime: 'octave' }), hostileProxy]) {
    const rejected = routeMatlabRuntimeRequest(nonJsonObject);
    assert.equal(rejected.status, 'needs-input');
    assert.equal(rejected.error.code, 'MATLAB_REQUEST_INVALID');
  }

  const invalidPlot = routeMatlabRuntimeRequest({ runtime: 'matlab', plotInput: 'plot something' });
  assert.equal(invalidPlot.status, 'needs-input');
  assert.equal(invalidPlot.error.code, 'MATLAB_REQUEST_INVALID');
  assert.match(invalidPlot.error.reason, /plotInput must be a JSON object/u);
  assert.equal(invalidPlot.outputContract.manifest.schemaVersion, 2);

  for (const request of [
    { runtime: 'matlab', plotInput: null },
    { runtime: 'matlab', plotInput: {}, plot: {} },
    { runtime: 'matlab', plotInput: { runtime: 'octave', question: 'trend' } },
    { runtime: 'matlab', targetRelease: 'R2024b', plotInput: { targetRelease: 'R2025a', question: 'trend' } },
    { runtime: 'matlab', outputFormats: ['png'], plotInput: { outputFormats: ['svg'], question: 'trend' } },
    { runtime: 'matlab', title: 'outer', plotInput: { title: 'inner', question: 'trend' } },
    {
      runtime: 'matlab', dataContract: { units: { value: 'K' } },
      plotInput: { question: 'profile', units: { value: 'degC' } },
    },
    {
      runtime: 'matlab', publicationContract: { target: { dpi: 300 } },
      plotInput: { question: 'trend', dpi: 150 },
    },
  ]) {
    const rejected = routeMatlabRuntimeRequest(request);
    assert.equal(rejected.status, 'needs-input');
    assert.equal(rejected.error.code, 'MATLAB_REQUEST_INVALID');
    assert.equal(rejected.plotRoute ?? null, null);
    assert.equal(rejected.script ?? null, null);
  }

  const legacyAlias = routeMatlabRuntimeRequest({
    runtime: 'matlab',
    plot: { question: 'trend', dimensions: [12], coordinates: ['time'] },
  });
  assert.equal(legacyAlias.status, 'needs-input');
  assert.equal(legacyAlias.plotRoute.plotType, 'time-series');
  assert.equal(legacyAlias.error.code, 'MATLAB_NEEDS_INPUT');
});

test('end-to-end contract reaches template, release matrix and quality gate', () => {
  const route = routeMatlabRuntimeRequest({
    runtime: 'matlab', taskType: 'create', targetRelease: 'R2024b', matlabAvailable: true,
    requireScientificContract: true, requirePublicationContract: true,
    publicationContract: completePublicationContract('static', 'print'),
    requestedCapabilities: ['tiledlayout', 'exportgraphics'], outputFormats: ['png', 'pdf'],
    plotInput: {
      question: 'profile', dimensions: [30], coordinates: ['depth'], missing: false, qcStatus: 'absent',
      dimensionOrder: ['depth'], observationDimension: 'depth', qcStatus: 'absent', uncertaintyStatus: 'absent',
      verticalCoordinate: 'depth', verticalPositive: 'down', verticalReference: 'mean sea level',
      title: 'Temperature profile', source: 'test fixture',
      assetDirectory: 'codex-runtime/matlab/assets',
      units: { depth: 'm', value: 'degC' }, quantities: { depth: 'Depth', value: 'Temperature' },
    },
  });
  assert.equal(route.status, 'ready');
  assert.equal(route.plotRoute.template, 'oi_plot_profile.m');
  assert.equal(route.taskRoute.capabilities.capabilities.tiledlayout.status, 'native');
  assert.equal(route.taskRoute.capabilities.capabilities.exportgraphics.status, 'native');
  assert.equal(route.taskRoute.capabilities.capabilities.auditedFigureManifest.status, 'native');
  assert.equal(route.plotRoute.apiPlan.layout.api, 'tiledlayout');
  assert.equal(route.qualityGate.requiredBoolean, 'plotQualityScoreOk');
  assert.equal(route.scientificDataContract.required, true);
  assert.deepEqual(route.scientificDataContract, route.taskRoute.scientificDataContract);
  assert.equal(route.scientificDataContract.coordinates.vertical.positive, 'down');
  assert.deepEqual(route.scientificDataContract.unresolvedRequirements, []);
  assert.equal(route.taskRoute.scientificDataContract.qc.status, 'absent');
  assert.equal(route.publicationContract.required, true);
  assert.deepEqual(route.publicationContract.unresolvedRequirements, []);
  assert.equal(route.qualityGate.preflightContract, 'publicationContract');
  assert.equal(route.outputContract.manifest.schemaVersion, 2);
  assert.equal(route.outputContract.manifest.path, 'figures.json');
  assert.equal(route.outputContract.exportStrategies.png.api, 'print');
  assert.equal(route.outputContract.exportStrategies.pdf.api, 'print');
  assert.equal(route.outputContract.exportStrategies.png.asset, 'oi_export_figure');
  assert.match(route.script, /exportEntry\.scientific_data_contract = scientificDataContract/u);
});

test('runtime composition canonicalizes Chinese and normalized coordinate contracts once', () => {
  const commonPlot = {
    question: '时间序列', dimensions: [12], dimensionOrder: ['时间'], observationDimension: '时间',
    coordinates: ['时间'], coordinateDirections: { time: 'increasing' }, dataType: 'datetime', timeZone: 'Asia/Shanghai',
    missing: { status: 'absent', representation: 'NaN' }, qc: { status: 'absent' }, uncertainty: { status: 'absent' },
    title: '南海温度', source: 'verified fixture', assetDirectory: 'codex-runtime/matlab/assets',
    units: { value: 'degC' }, quantities: { value: '海水温度' },
  };
  const chinese = routeMatlabRuntimeRequest({
    runtime: 'matlab', taskType: 'create', matlabAvailable: true, requireScientificContract: true,
    plotInput: commonPlot,
  });
  assert.equal(chinese.status, 'ready');
  assert.equal(chinese.schemaVersion, 5);
  assert.deepEqual(chinese.scientificDataContract, chinese.taskRoute.scientificDataContract);
  assert.deepEqual(chinese.scientificDataContract.coordinates.names, ['time']);
  assert.deepEqual(chinese.scientificDataContract.dimensionOrder, ['time']);
  assert.equal(chinese.scientificDataContract.observationDimension, 'time');

  const normalized = routeMatlabRuntimeRequest({
    runtime: 'matlab', taskType: 'create', matlabAvailable: true, requireScientificContract: true,
    plotInput: {
      ...commonPlot,
      question: 'trend',
      coordinates: { names: ['time'], timeZone: 'Asia/Shanghai', directions: { time: 'increasing' } },
      timeZone: undefined,
      coordinateDirections: undefined,
    },
  });
  assert.equal(normalized.status, 'ready');
  assert.deepEqual(normalized.scientificDataContract.coordinates.names, ['time']);
  assert.equal(normalized.scientificDataContract.coordinates.timeZone, 'Asia/Shanghai');
  assert.deepEqual(normalized.scientificDataContract, normalized.taskRoute.scientificDataContract);
  assert.match(normalized.script, /"coordinates":\{"names":\["time"\],"timeZone":"Asia\/Shanghai"/u);
});

test('runtime composition forwards interactive tasks into the native data-tip template', () => {
  const route = routeMatlabRuntimeRequest({
    runtime: 'matlab', taskType: 'interactive', targetRelease: 'R2024b', matlabAvailable: true,
    requireScientificContract: true, requirePublicationContract: true,
    publicationContract: completePublicationContract('dual', 'print'),
    requestedCapabilities: ['tiledlayout', 'exportgraphics'], outputFormats: ['png', 'pdf'],
    plotInput: {
      question: 'trend', dimensions: [12], dimensionOrder: ['time'], observationDimension: 'time',
      coordinates: ['time'], coordinateDirections: { time: 'strictly-increasing' }, dataType: 'datetime', timeZone: 'UTC',
      missing: true, missingRepresentation: 'NaN', maskVariables: ['missing', 'invalid', 'suspect'], uncertaintyStatus: 'absent',
      qcStatus: 'present', qc: {
        status: 'present', variable: 'sampleQC', alignment: 'time',
        flagMeanings: { good: 'accepted', suspect: 'suspect', bad: 'rejected' },
        accepted: ['good'], suspect: ['suspect'], rejected: ['bad'], action: 'preserve',
      },
      title: 'Temperature time series', source: 'test fixture', assetDirectory: 'codex-runtime/matlab/assets',
      units: { value: 'degC' }, quantities: { value: 'Temperature' },
      variableNames: { time: 'sampleTime', value: 'sampleValue', observationId: 'sampleID', station: 'sampleStation', qcFlag: 'sampleQC' },
    },
  });
  assert.equal(route.status, 'ready');
  assert.equal(route.plotRoute.template, 'interactive_timeseries_native_template.m');
  assert.equal(route.taskRoute.capabilities.capabilities.exportgraphics.status, 'native');
  assert.equal(route.taskRoute.capabilities.capabilities.auditedFigureManifest.status, 'native');
  assert.equal(route.outputContract.exportStrategies.png.api, 'print');
  assert.equal(route.outputContract.exportStrategies.pdf.api, 'print');
  assert.equal(route.publicationContract.headless.exportApi, 'print');
  assert.equal(route.taskRoute.scientificDataContract.required, true);
  assert.deepEqual(route.scientificDataContract.unresolvedRequirements, []);
  assert.equal(route.publicationContract.interaction.mode, 'dual');
  assert.equal(route.publicationContract.headless.desktopIndependent, true);
  assert.match(route.script, /interactive_timeseries_native_template\(interactionData/u);
  assert.match(route.script, /'FontName', selectedFontName/u);
});

test('runtime composition preserves interactive confidence-bound metadata', () => {
  const route = routeMatlabRuntimeRequest({
    runtime: 'matlab', taskType: 'interactive', targetRelease: 'R2024b', matlabAvailable: true,
    requireScientificContract: true,
    requestedCapabilities: ['tiledlayout', 'exportgraphics'], outputFormats: ['png', 'pdf'],
    plotInput: {
      question: 'confidence', dimensions: [12], dimensionOrder: ['time'], observationDimension: 'time',
      coordinates: ['time'], coordinateDirections: { time: 'strictly-increasing' }, dataType: 'datetime', timeZone: 'UTC',
      missing: { status: 'present', representation: 'NaN', maskVariables: ['missing', 'invalid', 'suspect'] },
      uncertainty: { status: 'present', type: 'confidence-interval', unit: 'degC', alignment: 'time', representation: 'bounds', confidenceLevel: 0.95 },
      qc: {
        status: 'present', variable: 'sampleQC', alignment: 'time',
        flagMeanings: { good: 'accepted', suspect: 'suspect', bad: 'rejected' },
        accepted: ['good'], suspect: ['suspect'], rejected: ['bad'], action: 'preserve',
      },
      title: 'Temperature confidence interval', source: 'test fixture', assetDirectory: 'codex-runtime/matlab/assets',
      units: { value: 'degC', uncertainty: 'degC' }, quantities: { value: 'Temperature' },
      variableNames: { time: 'sampleTime', value: 'sampleValue', uncertaintyLower: 'sampleLower', uncertaintyUpper: 'sampleUpper', observationId: 'sampleID', station: 'sampleStation', qcFlag: 'sampleQC' },
    },
  });
  assert.equal(route.status, 'ready');
  assert.equal(route.plotRoute.plotType, 'uncertainty-series');
  assert.equal(route.plotRoute.template, 'interactive_timeseries_native_template.m');
  assert.deepEqual(route.scientificDataContract.unresolvedRequirements, []);
  assert.match(route.script, /'UncertaintyLower', 'UncertaintyUpper', 'ObservationID'/u);
  assert.match(route.script, /'ConfidenceLevel', 0\.95/u);
});

test('runtime composition blocks incomplete scientific semantics before plot generation', () => {
  const route = routeMatlabRuntimeRequest({
    runtime: 'matlab', taskType: 'create', targetRelease: 'R2024b', matlabAvailable: true,
    requireScientificContract: true,
    plotInput: { question: 'trend', dimensions: [12], coordinates: ['time'] },
  });
  assert.equal(route.status, 'needs-input');
  assert.equal(route.script, null);
  assert.equal(route.plotRoute, null);
  assert.equal(route.error.code, 'MATLAB_NEEDS_INPUT');
  assert.ok(route.scientificDataContract.unresolvedRequirements.includes('dataContract.coordinates.timeZone'));
  assert.ok(route.taskRoute.scientificDataContract.unresolvedRequirements.includes('dataContract.units'));
});

test('runtime composition blocks incomplete publication and headless semantics before generation', () => {
  const route = routeMatlabRuntimeRequest({
    runtime: 'matlab', taskType: 'interactive', targetRelease: 'R2024b', matlabAvailable: true,
    requirePublicationContract: true,
    publicationContract: { target: { medium: 'journal' }, interaction: { mode: 'interactive' } },
    plotInput: { question: 'trend', dimensions: [12], coordinates: ['time'] },
  });
  assert.equal(route.status, 'needs-input');
  assert.equal(route.plotRoute, null);
  assert.equal(route.script, null);
  assert.ok(route.publicationContract.unresolvedRequirements.includes('publicationContract.headless.command matlab -batch or release-compatible matlab -r'));
  assert.ok(route.taskRoute.publicationContract.unresolvedRequirements.includes('publicationContract.interaction.mode dual for interactive task'));
});

test('serves the composed MATLAB route through the signed runtime HTTP endpoint', async () => {
  const port = await availablePort();
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'matlab-runtime-route-'));
  const secret = 'matlab-runtime-route-test-secret';
  const child = spawn(process.execPath, [new URL('./index.mjs', import.meta.url).pathname], {
    env: {
      ...process.env,
      OCEAN_CODEX_BIN: '/bin/false',
      OCEAN_CODEX_HOST: '127.0.0.1',
      OCEAN_CODEX_PORT: String(port),
      OCEAN_CODEX_TENANT_SECRET: secret,
      OCEAN_CODEX_WORKSPACE: workspace,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForStartup(child);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const owner = 'matlab-route-test-user';
    const signature = createHmac('sha256', secret).update(`${owner}\nPOST\nmatlab/route\n${timestamp}`).digest('hex');
    const headers = {
      'content-type': 'application/json',
      'x-ocean-codex-user': owner,
      'x-ocean-codex-timestamp': timestamp,
      'x-ocean-codex-signature': signature,
    };
    const request = {
      runtime: 'matlab', targetRelease: 'R2024b', matlabAvailable: true,
      requireScientificContract: true, requirePublicationContract: true,
      publicationContract: completePublicationContract('static', 'print'),
      requestedCapabilities: ['tiledlayout'],
      plotInput: {
        question: 'profile', dimensions: [12], coordinates: ['depth'], missing: false, qcStatus: 'absent',
        dimensionOrder: ['depth'], observationDimension: 'depth', qcStatus: 'absent', uncertaintyStatus: 'absent',
        verticalCoordinate: 'depth', verticalPositive: 'down', verticalReference: 'mean sea level',
        title: 'Temperature profile', source: 'test fixture',
        assetDirectory: 'codex-runtime/matlab/assets',
        units: { depth: 'm', value: 'degC' }, quantities: { depth: 'Depth', value: 'Temperature' },
      },
    };
    const response = await fetch(`http://127.0.0.1:${port}/api/codex-runtime/matlab/route`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'ready');
    assert.equal(body.plotRoute.template, 'oi_plot_profile.m');
    assert.equal(body.taskRoute.capabilities.capabilities.tiledlayout.status, 'native');
    assert.equal(body.taskRoute.capabilities.capabilities.auditedFigureManifest.status, 'native');
    assert.equal(body.plotRoute.apiPlan.export.status, 'native');
    assert.equal(body.qualityGate.evaluator, 'inspectMatlabPlotQuality');
    assert.equal(body.scientificDataContract.required, true);
    assert.deepEqual(body.scientificDataContract.unresolvedRequirements, []);
    assert.equal(body.publicationContract.required, true);
    assert.deepEqual(body.publicationContract.unresolvedRequirements, []);
    assert.equal(body.outputContract.manifest.schemaVersion, 2);
    assert.equal(body.outputContract.exportStrategies.png.api, 'print');
    assert.equal(body.outputContract.exportStrategies.pdf.api, 'print');
    assert.equal(body.outputContract.exportStrategies.pdf.asset, 'oi_export_figure');
    assert.equal(body.outputContract.exportStrategies.pdf.exactSizingRequired, true);
    assert.equal(body.publicationContract.headless.exportApi, 'print');
    assert.equal(body.runtimeReport.status, 'ready-for-runtime-validation');
    assert.match(body.script, /release-aware APIs: png=print, pdf=print/u);

    const mismatchedRequest = structuredClone(request);
    mismatchedRequest.publicationContract.headless.exportApi = 'exportgraphics';
    const mismatchedResponse = await fetch(`http://127.0.0.1:${port}/api/codex-runtime/matlab/route`, {
      method: 'POST',
      headers,
      body: JSON.stringify(mismatchedRequest),
    });
    assert.equal(mismatchedResponse.status, 200);
    const mismatchedBody = await mismatchedResponse.json();
    assert.equal(mismatchedBody.status, 'needs-input');
    assert.equal(mismatchedBody.script, null);
    assert.equal(mismatchedBody.error.code, 'MATLAB_NEEDS_INPUT');
    assert.match(mismatchedBody.error.reason, /headless.exportApi matching target release \(print\)/u);

    const malformedResponse = await fetch(`http://127.0.0.1:${port}/api/codex-runtime/matlab/route`, {
      method: 'POST',
      headers,
      body: 'null',
    });
    assert.equal(malformedResponse.status, 200);
    const malformedBody = await malformedResponse.json();
    assert.equal(malformedBody.status, 'needs-input');
    assert.equal(malformedBody.error.code, 'MATLAB_REQUEST_INVALID');

    const conflictResponse = await fetch(`http://127.0.0.1:${port}/api/codex-runtime/matlab/route`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ runtime: 'matlab', plotInput: { runtime: 'octave', question: 'trend' } }),
    });
    assert.equal(conflictResponse.status, 200);
    const conflictBody = await conflictResponse.json();
    assert.equal(conflictBody.status, 'needs-input');
    assert.equal(conflictBody.error.code, 'MATLAB_REQUEST_INVALID');
    assert.match(conflictBody.error.reason, /must not contain task routing fields: runtime/u);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('close', resolve));
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('keeps legacy release fallbacks visible while blocking unsupported arguments-based generation', () => {
  const route = routeMatlabRuntimeRequest({
    runtime: 'matlab', targetRelease: 'R2018b', matlabAvailable: true,
    requestedCapabilities: ['tiledlayout', 'exportgraphics'],
    plotInput: {
      question: 'profile', dimensions: [12], dimensionOrder: ['depth'], coordinates: ['depth'], missing: false, qcStatus: 'absent',
      verticalCoordinate: 'depth', verticalPositive: 'down', verticalReference: 'mean sea level',
      title: 'Temperature profile', source: 'test fixture',
      assetDirectory: 'codex-runtime/matlab/assets',
      units: { depth: 'm', value: 'degC' }, quantities: { depth: 'Depth', value: 'Temperature' },
    },
  });
  assert.equal(route.status, 'needs-input');
  assert.equal(route.plotRoute.apiPlan.layout.strategy, 'explicit-fallback');
  assert.ok(route.plotRoute.unresolvedRequirements.some((item) => /R2019b.*arguments-based audited assets/u.test(item)));
  assert.equal(route.outputContract.exportStrategies.png.api, 'print');
  assert.equal(route.outputContract.exportStrategies.pdf.api, 'print');
  assert.equal(route.script, null);
});

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function waitForStartup(child) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => reject(new Error(`runtime startup timed out: ${stderr}`)), 10_000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (!stdout.includes('\n')) return;
      clearTimeout(timeout);
      resolve();
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('exit', (code) => {
      if (!stdout.includes('\n')) {
        clearTimeout(timeout);
        reject(new Error(`runtime exited before startup (${code}): ${stderr}`));
      }
    });
  });
}

function completePublicationContract(interactionMode, exportApi = 'exportgraphics') {
  return {
    target: { medium: 'journal', width: 18, height: 12, units: 'cm', dpi: 300, formats: ['png', 'pdf'] },
    layout: {
      architecture: 'tiledlayout', rows: 1, columns: 1, tileSpacing: 'compact', padding: 'compact',
      readingOrder: 'row-major', explicitHandles: true, legendPlacement: 'outside-north', colorbarPlacement: 'none',
    },
    typography: {
      fontFamily: 'Noto Sans CJK SC', fallbackFamilies: ['Helvetica'], baseSizePt: 9,
      labelSizePt: 10, titleSizePt: 11, lineWidthPt: 1.3, interpreter: 'none',
    },
    color: {
      paletteClass: 'sequential', paletteSource: 'oi_ocean_theme', background: 'white',
      missingAppearance: 'distinct from valid extrema and zero', minimumContrastRatio: 4.5,
      colorOnlyEncodingAllowed: false, colorVisionCheckRequired: true, grayscaleCheckRequired: true,
    },
    clipping: { drawnowBeforeAudit: true, boundsCheckRequired: true, overlapCheckRequired: true },
    localization: {
      encoding: 'UTF-8', languages: ['zh-CN', 'en'], chineseRequired: true,
      glyphCheckRequired: true, glyphFormats: ['png', 'pdf'],
    },
    accessibility: { descriptionRequired: true, redundantEncodingRequired: true, readingOrderCheckRequired: true },
    interaction: {
      mode: interactionMode, stableObservationIdsRequired: interactionMode === 'dual',
      targetScopedCallbacksRequired: interactionMode === 'dual', cleanupRequired: interactionMode === 'dual',
      staticFallbackRequired: interactionMode === 'dual',
    },
    headless: {
      supported: true, command: 'matlab -batch', figureVisible: 'off',
      exportApi, desktopIndependent: true,
    },
  };
}
