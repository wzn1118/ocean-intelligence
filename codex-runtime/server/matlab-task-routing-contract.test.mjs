import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  MATLAB_MANIFEST_SCHEMA_VERSION,
  MATLAB_TASK_ROUTING_SCHEMA_VERSION,
  buildMatlabOutputContract,
  buildMatlabPublicationContract,
  buildMatlabScientificDataContract,
  isMatlabJsonObject,
  matlabTaskRoutingInstructionBlock,
  routeMatlabTask,
} from './matlab-task-routing-contract.mjs';
import { selectMatlabExportStrategy } from './matlab-release-capabilities.mjs';

test('routes explicit MATLAB-first tasks with release, toolbox and output contracts', () => {
  const route = routeMatlabTask({
    runtime: 'matlab', taskType: 'interactive', targetRelease: 'R2024b', matlabAvailable: true,
    requiredToolboxes: ['signal'], toolboxAvailability: { signal: true },
    requestedCapabilities: ['tiledlayout', 'exportgraphics', 'dataTipTemplate'], outputFormats: ['png', 'pdf'],
  });
  assert.equal(route.schemaVersion, MATLAB_TASK_ROUTING_SCHEMA_VERSION);
  assert.equal(route.schemaVersion, 2);
  assert.equal(route.status, 'ready');
  assert.equal(route.authoritativeRuntime, 'matlab');
  assert.equal(route.executionPolicy, 'execute-and-verify');
  assert.equal(route.capabilities.capabilities.tiledlayout.status, 'native');
  assert.ok(route.outputContract.fields.includes('artifact_validation'));
  assert.ok(route.outputContract.fields.includes('scientific_data_contract'));
  assert.ok(route.outputContract.fields.includes('publication_contract'));
  assert.equal(route.qualityGate.evaluator, 'inspectMatlabPlotQuality');
  assert.deepEqual(route.qualityGate.requiredCriteria, [
    'axisLabelsUnits', 'fontSize', 'lineWidth', 'legendOcclusion',
    'colorbarLabels', 'clippingRisk', 'outputResolution', 'accessibility',
  ]);
});

test('accepts a complete publication, accessibility and dual-interaction contract', () => {
  const route = routeMatlabTask({
    runtime: 'matlab', taskType: 'interactive', matlabAvailable: true,
    publicationContract: completePublicationContract('dual'),
  });
  assert.equal(route.status, 'ready');
  assert.equal(route.publicationContract.required, true);
  assert.equal(route.publicationContract.target.dpi, 300);
  assert.equal(route.publicationContract.localization.chineseRequired, true);
  assert.equal(route.publicationContract.interaction.mode, 'dual');
  assert.deepEqual(route.publicationContract.unresolvedRequirements, []);
  assert.ok(Object.isFrozen(route.publicationContract.typography));
});

test('blocks incomplete layout, typography, color, clipping, Chinese, accessibility and headless contracts', () => {
  const route = routeMatlabTask({
    runtime: 'matlab', taskType: 'interactive', matlabAvailable: true, requirePublicationContract: true,
    publicationContract: { target: { medium: 'journal' }, interaction: { mode: 'interactive' } },
  });
  assert.equal(route.status, 'needs-input');
  assert.equal(route.error.code, 'MATLAB_NEEDS_INPUT');
  const unresolved = route.publicationContract.unresolvedRequirements.join('\n');
  for (const term of [
    'target.width', 'target.dpi', 'layout.architecture', 'layout.explicitHandles',
    'typography.fontFamily', 'typography.baseSizePt', 'color.paletteClass', 'minimumContrastRatio',
    'colorOnlyEncodingAllowed', 'drawnowBeforeAudit', 'localization.encoding UTF-8',
    'chineseRequired', 'glyphCheckRequired', 'descriptionRequired', 'redundantEncodingRequired',
    'interaction.mode static/dual', 'interaction.mode dual for interactive task',
    'headless.command matlab -batch or release-compatible matlab -r', 'headless.figureVisible off',
  ]) assert.match(unresolved, new RegExp(term.replaceAll('.', '\\.'), 'u'));
});

test('normalizes publication aliases without claiming completed visual checks', () => {
  const contract = buildMatlabPublicationContract({
    requirePublicationContract: true,
    publicationContract: completePublicationContract('static'),
    outputFormats: ['.PNG', 'PDF'],
  });
  assert.equal(contract.provided, true);
  assert.equal(contract.clipping.boundsCheckRequired, true);
  assert.equal(contract.color.colorVisionCheckRequired, true);
  assert.equal('visualInspectionPassed' in contract, false);
});

test('blocks publication formats and headless APIs that drift from task and release contracts', () => {
  const formatContract = completePublicationContract('static');
  formatContract.target.formats = ['png'];
  const formatMismatch = routeMatlabTask({
    runtime: 'matlab', matlabAvailable: true, outputFormats: ['pdf'], publicationContract: formatContract,
  });
  assert.ok(formatMismatch.unresolvedRequirements.includes('publicationContract.target.formats matching outputFormats'));

  const releaseMismatch = routeMatlabTask({
    runtime: 'matlab', matlabAvailable: true, targetRelease: 'R2018b',
    outputFormats: ['png', 'pdf'], publicationContract: completePublicationContract('static'),
  });
  assert.equal(releaseMismatch.status, 'needs-input');
  assert.ok(releaseMismatch.unresolvedRequirements.includes('publicationContract.headless.exportApi matching target release (print)'));
  assert.ok(releaseMismatch.unresolvedRequirements.includes('publicationContract.layout.architecture release-compatible explicit fallback'));
});

test('gates unattended MATLAB commands by release and preserves legacy failure status', () => {
  const legacyContract = completePublicationContract('static');
  legacyContract.layout.architecture = 'explicit-axes';
  legacyContract.headless.exportApi = 'print';
  const invalid = routeMatlabTask({
    runtime: 'matlab', matlabAvailable: true, targetRelease: 'R2018b',
    outputFormats: ['png', 'pdf'], publicationContract: legacyContract,
  });
  assert.equal(invalid.status, 'needs-input');
  assert.ok(invalid.unresolvedRequirements.includes('publicationContract.headless.command legacy matlab -r with try/catch/exit'));

  legacyContract.headless.command = 'matlab -r "try, render_plot; catch errorInfo, disp(errorInfo.message); exit(0); end"';
  const falseSuccess = routeMatlabTask({
    runtime: 'matlab', matlabAvailable: true, targetRelease: 'R2018b',
    outputFormats: ['png', 'pdf'], publicationContract: legacyContract,
  });
  assert.equal(falseSuccess.status, 'needs-input');
  assert.ok(falseSuccess.unresolvedRequirements.includes('publicationContract.headless.command legacy matlab -r with try/catch/exit'));

  legacyContract.headless.command = 'matlab -r "try, render_plot; catch errorInfo, disp(errorInfo.message); exit(1); end; exit(0)"';
  const valid = routeMatlabTask({
    runtime: 'matlab', matlabAvailable: true, targetRelease: 'R2018b',
    outputFormats: ['png', 'pdf'], publicationContract: legacyContract,
  });
  assert.equal(valid.status, 'ready');
  assert.equal(valid.capabilities.capabilities.matlabBatch.status, 'fallback');
});

test('requires per-format export APIs when a release mixes exportgraphics and print', () => {
  const mixedContract = completePublicationContract('static');
  mixedContract.layout.architecture = 'explicit-axes';
  mixedContract.target.formats = ['png', 'svg'];
  mixedContract.localization.glyphFormats = ['png', 'svg'];
  mixedContract.headless.exportApi = '';
  mixedContract.headless.exportApis = { PNG: 'EXPORTGRAPHICS', SVG: 'PRINT' };
  const valid = routeMatlabTask({
    runtime: 'matlab', matlabAvailable: true, targetRelease: 'R2024b',
    outputFormats: ['png', 'svg'], publicationContract: mixedContract,
  });
  assert.equal(valid.status, 'ready');
  assert.equal(valid.outputContract.exportStrategies.png.api, 'exportgraphics');
  assert.equal(valid.outputContract.exportStrategies.svg.api, 'print');

  delete mixedContract.headless.exportApis;
  mixedContract.headless.exportApi = 'exportgraphics';
  const invalid = routeMatlabTask({
    runtime: 'matlab', matlabAvailable: true, targetRelease: 'R2024b',
    outputFormats: ['png', 'svg'], publicationContract: mixedContract,
  });
  assert.equal(invalid.status, 'needs-input');
  assert.ok(invalid.unresolvedRequirements.includes('publicationContract.headless.exportApis.svg matching target release (print)'));
});

for (const [targetRelease, exportApi, generalStatus] of [
  ['R2019b', 'print', 'fallback'],
  ['R2020a', 'print', 'native'],
  ['R2021a', 'print', 'native'],
  ['R2024b', 'print', 'native'],
  ['R2025a', 'exportgraphics', 'native'],
  ['R2026a', 'exportgraphics', 'native'],
]) {
  test(`${targetRelease} explicitly requested audited manifest uses exact-size ${exportApi} through preflight`, () => {
    const publicationContract = completePublicationContract('static');
    publicationContract.target.formats = ['png', 'pdf', 'svg'];
    publicationContract.localization.glyphFormats = ['png', 'pdf', 'svg'];
    publicationContract.headless.exportApi = exportApi;
    publicationContract.headless.exportApis = { png: exportApi, pdf: exportApi, svg: exportApi };
    const route = routeMatlabTask({
      runtime: 'matlab', targetRelease, matlabAvailable: true,
      requestedCapabilities: ['auditedFigureManifest', 'exportgraphics'],
      manifestContract: { required: true }, outputFormats: ['png', 'pdf', 'svg'], publicationContract,
    });
    assert.equal(route.status, 'ready', route.error?.reason);
    assert.equal(route.capabilities.capabilities.exportgraphics.status, generalStatus);
    assert.deepEqual(route.publicationContract.headless.exportApis, { png: exportApi, pdf: exportApi, svg: exportApi });
    for (const format of ['png', 'pdf', 'svg']) {
      const plan = route.outputContract.exportStrategies[format];
      assert.equal(plan.api, exportApi);
      assert.equal(plan.asset, 'oi_export_figure');
      assert.equal(plan.exactSizingRequired, true);
      assert.equal(route.capabilities.exportFormats[format].api, plan.api);
      if (exportApi === 'print') {
        assert.equal(plan.status, 'fallback');
        assert.equal(plan.strategy, 'explicit-fallback');
        assert.match(plan.reason, /explicit figure and paper geometry/u);
        if (generalStatus === 'native') {
          assert.match(plan.reason, /exportgraphics exists/u);
          assert.doesNotMatch(plan.reason, /unavailable/u);
        }
      } else {
        assert.equal(plan.status, 'preferred');
        assert.match(plan.syntax, /'Units','inches','Width',widthPixels\/dpi,'Height',heightPixels\/dpi/u);
        assert.match(plan.syntax, /'Padding','figure','PreserveAspectRatio','on'/u);
      }
    }
    assert.equal(selectMatlabExportStrategy(targetRelease, 'png').api,
      generalStatus === 'native' ? 'exportgraphics' : 'print');
    delete publicationContract.headless.exportApi;
    const perFormatOnly = routeMatlabTask({
      targetRelease, requestedCapabilities: ['auditedFigureManifest'],
      outputFormats: ['png', 'pdf', 'svg'], publicationContract,
    });
    assert.equal(perFormatOnly.status, 'ready', perFormatOnly.error?.reason);
  });
}

test('manifest requirement and physical sizing alone preserve general routing and do not authorize legacy print', () => {
  for (const targetRelease of ['R2021a', 'R2024b']) {
    const publicationContract = completePublicationContract('static');
    const input = { runtime: 'matlab', targetRelease, matlabAvailable: true,
      manifestRequired: true, publicationContract };
    const general = routeMatlabTask(input);
    assert.equal(general.status, 'ready');
    assert.equal(general.outputContract.exportStrategies.png.api, 'exportgraphics');
    assert.equal(general.outputContract.exportStrategies.png.asset, undefined);
    publicationContract.headless.exportApi = 'print';
    const undeclaredFallback = routeMatlabTask(input);
    assert.equal(undeclaredFallback.status, 'needs-input');
    assert.ok(undeclaredFallback.unresolvedRequirements.includes(
      'publicationContract.headless.exportApi matching target release (exportgraphics)',
    ));
  }
});

test('audited preflight rejects missing, conflicting and release-mismatched headless API declarations', () => {
  for (const [targetRelease, expectedApi, wrongApi] of [
    ['R2021a', 'print', 'exportgraphics'], ['R2024b', 'print', 'exportgraphics'],
    ['R2026a', 'exportgraphics', 'print'],
  ]) {
    for (const headlessOverrides of [
      { exportApi: wrongApi },
      { exportApis: { png: wrongApi, pdf: expectedApi, svg: expectedApi } },
      { exportApis: { png: expectedApi, pdf: expectedApi } },
      { exportApi: '', exportApis: {} },
      { exportApi: 'saveas' },
    ]) {
      const publicationContract = completePublicationContract('static');
      publicationContract.target.formats = ['png', 'pdf', 'svg'];
      publicationContract.localization.glyphFormats = ['png', 'pdf', 'svg'];
      Object.assign(publicationContract.headless, { exportApi: expectedApi,
        exportApis: { png: expectedApi, pdf: expectedApi, svg: expectedApi } }, headlessOverrides);
      const route = routeMatlabTask({ runtime: 'matlab', targetRelease,
        requestedCapabilities: ['auditedFigureManifest'], outputFormats: ['png', 'pdf', 'svg'], publicationContract });
      assert.equal(route.status, 'needs-input', JSON.stringify({ targetRelease, headlessOverrides }));
      assert.match(route.unresolvedRequirements.join('\n'), /publicationContract\.headless\.exportApi/u);
    }
  }
});

test('audited selection cannot opt out of its native manifest and PNG/PDF evidence', () => {
  for (const override of [{ manifestRequired: false }, { manifestContract: { required: false } }, { outputFormats: ['png'] }]) {
    const input = { targetRelease: 'R2024b', ...override };
    assert.equal(routeMatlabTask(input).status, 'ready');
    const audited = routeMatlabTask({ ...input, requestedCapabilities: ['auditedFigureManifest'] });
    assert.equal(audited.status, 'needs-input');
    assert.match(audited.unresolvedRequirements.join('\n'), /manifest.required true|must include png and pdf/u);
  }
});

test('normalizes and gates the schema-version-2 artifact manifest contract', () => {
  const contract = buildMatlabOutputContract({
    outputFormats: ['png', 'svg'],
    manifestContract: { path: 'artifacts/figures.json' },
  });
  assert.equal(contract.manifest.schemaVersion, MATLAB_MANIFEST_SCHEMA_VERSION);
  assert.equal(contract.manifest.path, 'artifacts/figures.json');
  assert.deepEqual(contract.manifest.requiredExportFields.png, [
    'file', 'width', 'height', 'dpi', 'bytes', 'sha256', 'export_api',
  ]);
  assert.deepEqual(contract.manifest.requiredExportFields.svg, [
    'file', 'width', 'height', 'title', 'description', 'accessible_name',
    'bytes', 'sha256', 'export_api', 'export_device',
  ]);
  assert.ok(contract.manifest.requiredTopLevelFields.includes('execution_verified'));
  assert.deepEqual(contract.unresolvedRequirements, []);

  const invalid = routeMatlabTask({
    runtime: 'matlab', matlabAvailable: true,
    manifestContract: { path: '/tmp/figures.json', schemaVersion: 1, freshArtifactsOnly: false },
  });
  assert.equal(invalid.status, 'needs-input');
  assert.ok(invalid.unresolvedRequirements.includes('outputContract.manifest.path safe relative JSON path'));
  assert.ok(invalid.unresolvedRequirements.includes('outputContract.manifest.schemaVersion 2'));
  assert.ok(invalid.unresolvedRequirements.includes('outputContract.manifest.freshArtifactsOnly true'));
});

test('rejects non-object payloads and contradictory routing aliases', () => {
  const malformed = routeMatlabTask(null);
  assert.equal(malformed.status, 'needs-input');
  assert.equal(malformed.error.code, 'MATLAB_REQUEST_INVALID');

  const hostileProxy = new Proxy({}, { getPrototypeOf: () => { throw new Error('hostile prototype trap'); } });
  for (const nonJsonObject of [new Date(), new Map(), Object.create({ runtime: 'octave' }), hostileProxy]) {
    assert.equal(isMatlabJsonObject(nonJsonObject), false);
    const rejected = routeMatlabTask(nonJsonObject);
    assert.equal(rejected.status, 'needs-input');
    assert.equal(rejected.error.code, 'MATLAB_REQUEST_INVALID');
  }
  assert.equal(isMatlabJsonObject(Object.create(null)), true);

  const runtimeConflict = routeMatlabTask({ runtime: 'matlab', requestedRuntime: 'octave' });
  assert.equal(runtimeConflict.status, 'needs-input');
  assert.equal(runtimeConflict.error.code, 'MATLAB_RUNTIME_INVALID');

  const taskConflict = routeMatlabTask({ runtime: 'matlab', taskType: 'export', intent: 'interactive' });
  assert.equal(taskConflict.status, 'needs-input');
  assert.equal(taskConflict.error.code, 'MATLAB_TASK_TYPE_INVALID');

  const releaseConflict = routeMatlabTask({ runtime: 'matlab', targetRelease: 'R2024b', matlabRelease: 'R2025a' });
  assert.equal(releaseConflict.status, 'unsupported-release');

  const signalConflict = routeMatlabTask({ runtime: 'matlab', requiresOctaveRender: true });
  assert.equal(signalConflict.status, 'needs-input');
  assert.equal(signalConflict.error.code, 'MATLAB_RUNTIME_INVALID');
});

test('rejects duplicate contract aliases and split metadata ownership', () => {
  for (const request of [
    { runtime: 'matlab', dataContract: {}, scientificDataContract: {} },
    { runtime: 'matlab', publicationContract: {}, figureContract: {} },
    { runtime: 'matlab', requiredToolboxes: ['signal'], toolboxes: ['signal'] },
    { runtime: 'matlab', dataContract: { units: { value: 'K' } }, units: { value: 'degC' } },
    { runtime: 'matlab', dataContract: { coordinates: ['depth'] }, axes: ['depth'] },
    { runtime: 'matlab', publicationContract: { target: { dpi: 300 } }, dpi: 150 },
  ]) {
    const rejected = routeMatlabTask(request);
    assert.equal(rejected.status, 'needs-input');
    assert.equal(rejected.error.code, 'MATLAB_REQUEST_INVALID');
  }
});

test('rejects weakly typed availability and manifest booleans', () => {
  const runtimeString = routeMatlabTask({ runtime: 'matlab', matlabAvailable: 'false' });
  assert.equal(runtimeString.status, 'needs-input');
  assert.equal(runtimeString.error.code, 'MATLAB_REQUEST_INVALID');

  const toolboxString = routeMatlabTask({
    runtime: 'matlab', requiredToolboxes: ['signal'], toolboxAvailability: { signal: 'false' },
  });
  assert.equal(toolboxString.status, 'needs-input');
  assert.equal(toolboxString.error.code, 'MATLAB_REQUEST_INVALID');

  const manifestString = routeMatlabTask({ runtime: 'matlab', manifestContract: { required: 'false' } });
  assert.equal(manifestString.status, 'needs-input');
  assert.equal(manifestString.error.code, 'MATLAB_REQUEST_INVALID');

  for (const input of [
    { runtime: 'matlab', dataContract: [] },
    { runtime: 'matlab', publicationContract: 'trust me' },
    { runtime: 'matlab', manifestContract: null },
    { runtime: 'matlab', manifestRequired: false, manifestContract: { required: true } },
  ]) {
    const malformedContract = routeMatlabTask(input);
    assert.equal(malformedContract.status, 'needs-input');
    assert.equal(malformedContract.error.code, 'MATLAB_REQUEST_INVALID');
  }

  assert.equal(routeMatlabTask({ runtime: 'matlab', matlabAvailable: false }).status, 'runtime-unavailable');
  assert.equal(routeMatlabTask({
    runtime: 'matlab', requiredToolboxes: ['signal'], toolboxAvailability: { signal: false },
  }).status, 'missing-toolbox');
});

test('canonicalizes duplicate formats and blocks URI or control-character manifest paths', () => {
  const canonical = routeMatlabTask({ runtime: 'matlab', outputFormats: ['PNG', '.png', 'PDF'] });
  assert.equal(canonical.status, 'ready');
  assert.deepEqual(canonical.outputContract.formats, ['png', 'pdf']);

  for (const manifestPath of ['https://example.test/figures.json', 'artifacts/../figures.json', 'artifacts/figures\u0000.json']) {
    const invalid = routeMatlabTask({ runtime: 'matlab', manifestPath });
    assert.equal(invalid.status, 'needs-input', manifestPath);
    assert.ok(invalid.unresolvedRequirements.includes('outputContract.manifest.path safe relative JSON path'));
  }
});

test('accepts a complete machine-readable scientific data contract', () => {
  const route = routeMatlabTask({
    runtime: 'matlab', matlabAvailable: true,
    dataContract: {
      dataType: 'datetime', shape: [24], dimensionOrder: ['time'], observationDimension: 'time',
      coordinates: ['time'], quantities: { value: 'Sea water temperature' }, units: { value: 'degC' },
      timeZone: 'UTC', coordinateDirections: { time: 'strictly-increasing' },
      missing: { status: 'present', representation: 'NaN/NaT', maskVariables: ['missing', 'invalid', 'suspect'] },
      qc: { status: 'present', variable: 'QCFlag', alignment: 'time', flagMeanings: { 1: 'good', 3: 'suspect', 4: 'bad' } },
      uncertainty: { status: 'present', type: 'standard-deviation', unit: 'degC', alignment: 'time' },
    },
  });
  assert.equal(route.status, 'ready');
  assert.equal(route.scientificDataContract.required, true);
  assert.deepEqual(route.scientificDataContract.shape, [24]);
  assert.equal(route.scientificDataContract.coordinates.timeZone, 'UTC');
  assert.equal(route.scientificDataContract.qc.status, 'present');
  assert.equal(route.scientificDataContract.qc.action, 'preserve');
  assert.equal(route.scientificDataContract.uncertainty.type, 'standard-deviation');
  assert.deepEqual(route.scientificDataContract.unresolvedRequirements, []);
});

test('blocks incomplete or contradictory dimensions, units, timezone, QC, uncertainty and coordinate direction', () => {
  const route = routeMatlabTask({
    runtime: 'matlab', matlabAvailable: true, requireScientificContract: true,
    dataContract: {
      dataType: 'numeric', shape: [24, 2], dimensionOrder: ['time'], observationDimension: 'station',
      coordinates: ['time', 'longitude', 'latitude', 'depth'], quantities: { value: 'Temperature' }, units: {},
      missing: { status: 'present' }, qc: { status: 'present' },
      uncertainty: { status: 'present', unit: 'm/s', alignment: 'station' },
    },
  });
  assert.equal(route.status, 'needs-input');
  assert.equal(route.error.code, 'MATLAB_NEEDS_INPUT');
  const unresolved = route.scientificDataContract.unresolvedRequirements.join('\n');
  for (const term of [
    'dimensionOrder length', 'observationDimension', 'units.value', 'dataType datetime/timetable',
    'timeZone', 'directions.time', 'longitudeConvention', 'directions.longitude', 'directions.latitude',
    'vertical.coordinate', 'vertical.positive', 'vertical.reference', 'missing.representation',
    'qc.variable', 'qc.alignment', 'qc.flagMeanings', 'maskVariables.missing', 'uncertainty.type',
  ]) assert.match(unresolved, new RegExp(term.replace('.', '\\.'), 'u'));
});

test('requires explicit uncertainty unit conversion provenance', () => {
  const contract = buildMatlabScientificDataContract({
    requireScientificContract: true,
    dataType: 'numeric', shape: [10], dimensionOrder: ['sample'], observationDimension: 'sample',
    coordinates: ['sample'], quantities: { value: 'Temperature' }, units: { value: 'degC' },
    missing: false, qcStatus: 'absent', uncertaintyStatus: 'present', uncertaintyType: 'standard-deviation',
    uncertaintyUnit: 'K', uncertaintyAlignment: 'sample',
  });
  assert.ok(contract.unresolvedRequirements.includes('dataContract.uncertainty.unit compatible with units.value or explicit conversion'));
});

test('never silently substitutes Octave for an unavailable MATLAB runtime', () => {
  const route = routeMatlabTask({ runtime: 'matlab', matlabAvailable: false, octaveAvailable: true });
  assert.equal(route.status, 'runtime-unavailable');
  assert.equal(route.error.code, 'MATLAB_RUNTIME_UNAVAILABLE');
  assert.match(route.error.nextAction, /execution_verified=false/u);
});

test('routes explicit Octave work away from MATLAB generation', () => {
  const route = routeMatlabTask({ runtime: 'octave', taskType: 'export' });
  assert.equal(route.status, 'routed-to-octave');
  assert.equal(route.authoritativeRuntime, 'octave');
  assert.equal(route.error.code, 'MATLAB_ROUTED_TO_OCTAVE');
});

test('returns stable states for unresolved metadata, release, toolbox and output failures', () => {
  assert.equal(routeMatlabTask({ runtime: 'matlab', unresolvedRequirements: ['units.value'] }).status, 'needs-input');
  assert.equal(routeMatlabTask({ runtime: 'matlab', targetRelease: 'R2099a' }).status, 'unsupported-release');
  assert.equal(routeMatlabTask({ runtime: 'matlab', requiredToolboxes: ['signal'], toolboxAvailability: { signal: false } }).status, 'missing-toolbox');
  assert.equal(routeMatlabTask({ runtime: 'matlab', targetRelease: 'R2013b', outputFormats: ['svg'] }).status, 'unsupported-output');
  assert.equal(routeMatlabTask({ runtime: 'python' }).error.code, 'MATLAB_RUNTIME_INVALID');
  assert.equal(routeMatlabTask({ runtime: 'matlab', taskType: 'animate' }).error.code, 'MATLAB_TASK_TYPE_INVALID');
});

test('documents the routing contract in prompts and versioned skill core', () => {
  const block = matlabTaskRoutingInstructionBlock();
  const skill = readFileSync(new URL('../matlab/SKILL.md', import.meta.url), 'utf8');
  const agent = readFileSync(new URL('../matlab/agents/openai.yaml', import.meta.url), 'utf8');
  for (const term of [
    'MATLAB-first', 'runtime-unavailable', 'missing-toolbox', 'unsupported-output', 'execution_verified',
    'scientificDataContract', 'dimensionOrder', 'TimeZone', 'missing/invalid/suspect', '不确定度',
    'requirePublicationContract', 'inspectMatlabPlotQuality', 'matlab -batch', 'UTF-8',
    'plotInput', '顶层',
  ]) {
    assert.match(`${block}\n${skill}\n${agent}`, new RegExp(term, 'u'));
  }
});

function completePublicationContract(interactionMode) {
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
      exportApi: 'exportgraphics', desktopIndependent: true,
    },
  };
}

test('enforces closed-world fields and blocks nested runtime or semantic overrides', () => {
  for (const request of [
    { runtime: 'matlab', runTime: 'octave' },
    { runtime: 'matlab', dataContract: { runtime: 'octave' } },
    { runtime: 'matlab', dataContract: { question: 'map', shape: [12] } },
    { runtime: 'matlab', publicationContract: { target: { width: 10, typoDpi: 300 } } },
    { runtime: 'matlab', manifestContract: { path: 'figures.json', schema_version: 2, schemaVersion: 2 } },
  ]) {
    const rejected = routeMatlabTask(request);
    assert.equal(rejected.status, 'needs-input');
    assert.equal(rejected.error.code, 'MATLAB_REQUEST_INVALID');
  }

  const nestedOctave = routeMatlabTask({ runtime: 'matlab', dataContract: { requiresOctaveRender: true } });
  assert.notEqual(nestedOctave.status, 'routed-to-octave');
  assert.equal(nestedOctave.error.code, 'MATLAB_REQUEST_INVALID');
});

test('rejects duplicate runtime task and release aliases even when values agree', () => {
  const runtime = routeMatlabTask({ runtime: 'matlab', requestedRuntime: 'MATLAB' });
  assert.equal(runtime.status, 'needs-input');
  assert.equal(runtime.error.code, 'MATLAB_RUNTIME_INVALID');
  assert.match(runtime.error.reason, /duplicate aliases/u);

  const task = routeMatlabTask({ runtime: 'matlab', taskType: 'create', intent: 'create' });
  assert.equal(task.error.code, 'MATLAB_TASK_TYPE_INVALID');
  assert.match(task.error.reason, /duplicate aliases/u);

  const release = routeMatlabTask({ runtime: 'matlab', targetRelease: 'R2024b', matlabRelease: 'r2024B' });
  assert.equal(release.status, 'unsupported-release');
  assert.match(release.error.reason, /duplicate aliases/u);
});

test('bounds untrusted JSON depth, arrays, strings, accessors and dangerous keys', () => {
  const tooDeep = { runtime: 'matlab', dataContract: { units: {} } };
  let cursor = tooDeep.dataContract.units;
  for (let index = 0; index < 9; index += 1) {
    cursor.value = {};
    cursor = cursor.value;
  }

  const accessor = { runtime: 'matlab' };
  Object.defineProperty(accessor, 'title', { enumerable: true, get() { return 'unsafe'; } });

  const dangerous = Object.create(null);
  dangerous.runtime = 'matlab';
  dangerous.constructor = 'octave';
  const sparse = [];
  sparse.length = 1;

  for (const request of [
    tooDeep,
    { runtime: 'matlab', requestedCapabilities: Array.from({ length: 257 }, (_, index) => `cap-${index}`) },
    { runtime: 'matlab', title: '海'.repeat(16385) },
    { runtime: 'matlab', outputFormats: 'png' },
    { runtime: 'matlab', dpi: Number.NaN },
    { runtime: 'matlab', requestedCapabilities: sparse },
    accessor,
    dangerous,
  ]) {
    const rejected = routeMatlabTask(request);
    assert.equal(rejected.status, 'needs-input');
    assert.equal(rejected.error.code, 'MATLAB_REQUEST_INVALID');
  }
});

test('rejects additional manifest traversal spellings without weakening MATLAB authority', () => {
  for (const manifestPath of ['../figures.json', 'artifacts/../../figures.json', 'file:figures.json', 'C:\\temp\\figures.json']) {
    const rejected = routeMatlabTask({ runtime: 'matlab', matlabAvailable: false, manifestPath });
    assert.equal(rejected.status, 'needs-input');
    assert.ok(rejected.unresolvedRequirements.includes('outputContract.manifest.path safe relative JSON path'));
    assert.equal(rejected.authoritativeRuntime, 'matlab');
  }
});
