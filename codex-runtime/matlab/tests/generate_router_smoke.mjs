import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateMatlabPlotScript, resolveMatlabPlotRequest } from '../../server/matlab-plot-router.mjs';
import { selectMatlabAuditedExportStrategy } from '../../server/matlab-task-routing-contract.mjs';

const DEFAULT_ASSET_DIRECTORY = fileURLToPath(new URL('../assets', import.meta.url));
const FORMATS = ['png', 'pdf', 'svg'];

function publicationContract(release, interactive) {
  const exportApis = Object.fromEntries(FORMATS.map((format) => [
    format, selectMatlabAuditedExportStrategy(release, format).api,
  ]));
  return {
    target: { medium: 'journal', width: 8, height: 5, units: 'in', dpi: 300, formats: FORMATS },
    layout: {
      architecture: 'tiledlayout', rows: 1, columns: 1, tileSpacing: 'loose', padding: 'loose',
      readingOrder: 'row-major', explicitHandles: true, legendPlacement: 'none', colorbarPlacement: 'adjacent',
    },
    typography: {
      fontFamily: 'WenQuanYi Zen Hei', fallbackFamilies: ['Noto Sans CJK SC'],
      baseSizePt: 10, labelSizePt: 11, titleSizePt: 13, lineWidthPt: 1.4, interpreter: 'none',
    },
    color: {
      paletteClass: 'categorical', paletteSource: 'oi_ocean_theme', background: 'white',
      missingAppearance: 'NaN line gaps', minimumContrastRatio: 4.5,
      colorOnlyEncodingAllowed: false, colorVisionCheckRequired: true, grayscaleCheckRequired: true,
    },
    clipping: { drawnowBeforeAudit: true, boundsCheckRequired: true, overlapCheckRequired: true },
    localization: {
      encoding: 'UTF-8', languages: ['en'], chineseRequired: false,
      glyphCheckRequired: true, glyphFormats: FORMATS,
    },
    accessibility: { descriptionRequired: true, redundantEncodingRequired: true, readingOrderCheckRequired: true },
    interaction: {
      mode: interactive ? 'dual' : 'static', stableObservationIdsRequired: interactive,
      targetScopedCallbacksRequired: interactive, cleanupRequired: interactive, staticFallbackRequired: interactive,
    },
    headless: {
      supported: true, command: 'matlab -batch', figureVisible: 'off',
      exportApi: exportApis.png, exportApis, desktopIndependent: true,
    },
  };
}

function fixtureInputs() {
  return {
    schema_version: 1, synthetic: true, source: 'Explicit synthetic router smoke fixture; not observations',
    time_zone: 'UTC', value_unit: 'degC', missing_encoding: 'JSON null represents NaN',
    Time: [
      '2024-01-01T00:00:00Z', '2024-01-01T01:00:00Z', '2024-01-01T02:00:00Z',
      '2024-01-01T06:00:00Z', '2024-01-01T07:00:00Z', '2024-01-01T08:00:00Z',
    ],
    Value: [10, null, 12, 13, 14, 15],
    ObservationID: ['smoke-001', 'smoke-002', 'smoke-003', 'smoke-004', 'smoke-005', 'smoke-006'],
    Station: ['Station A', 'Station A', 'Station A', 'Station A', 'Station A', 'Station A'],
    QCFlag: ['good', 'missing', 'good', 'good', 'suspect', 'bad'],
  };
}

function fileEvidence(root, relativeFile) {
  const bytes = readFileSync(path.join(root, relativeFile));
  return { file: relativeFile, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export function generateRouterSmoke({ release, outputRoot, assetDirectory = DEFAULT_ASSET_DIRECTORY } = {}) {
  assert.equal(typeof release, 'string', 'An explicit MATLAB release is required');
  assert.match(release, /^R20\d{2}[ab]$/u, 'Use an explicit MATLAB release such as R2021a');
  assert.equal(typeof outputRoot, 'string', 'An existing output_root is required');
  assert.ok(outputRoot.trim(), 'An existing output_root is required');
  const outputRootPath = realpathSync(outputRoot);
  const assetDirectoryPath = realpathSync(assetDirectory);
  assert.ok(statSync(outputRootPath).isDirectory(), 'output_root must be an existing directory');
  assert.ok(statSync(assetDirectoryPath).isDirectory(), 'assetDirectory must be an existing directory');
  const generatedRoot = path.join(outputRootPath, 'generated-router');
  const inputs = fixtureInputs();
  const cases = ['static', 'interactive'].map((caseId) => {
    const interactive = caseId === 'interactive';
    const functionName = `generated_router_${caseId}`;
    const parameters = interactive
      ? ['sampleTime', 'sampleValue', 'sampleID', 'sampleStation', 'sampleQC']
      : ['sampleTime', 'sampleValue', 'sampleQC'];
    const request = {
      runtime: 'matlab', matlabAvailable: true, targetRelease: release, outputFormats: FORMATS,
      taskType: interactive ? 'interactive' : 'create',
      ...(interactive ? { interactionEnvironment: 'headless' } : {}),
      question: 'time-series', dataType: 'datetime', dimensions: [6],
      dimensionOrder: ['time'], observationDimension: 'time', coordinates: ['time'], timeZone: 'UTC',
      coordinateDirections: { time: 'increasing' }, uncertainty: { status: 'absent' },
      units: { time: 'datetime', value: 'degC' }, quantities: { value: 'Temperature' },
      missing: { status: 'present', representation: 'NaN', policy: 'preserve' },
      qc: {
        status: 'present', variable: 'sampleQC', alignment: 'time', action: 'preserve',
        accepted: ['good'], suspect: ['missing', 'suspect'], rejected: ['bad'],
        flagMeanings: { good: 'accepted', missing: 'suspect', suspect: 'suspect', bad: 'rejected' },
      },
      variableNames: {
        time: 'sampleTime', value: 'sampleValue', observationId: 'sampleID', station: 'sampleStation', qcFlag: 'sampleQC',
      },
      functionName, figureId: `router_${caseId}`, title: `Synthetic ${caseId} temperature`,
      source: inputs.source, assetDirectory: assetDirectoryPath, outputDirectory: caseId,
      publicationContract: publicationContract(release, interactive),
    };
    const resolved = resolveMatlabPlotRequest(request);
    assert.equal(resolved.status, 'ready', JSON.stringify(resolved.error));
    assert.equal(resolved.ready, true);
    assert.equal(resolved.plotRoute.targetRelease, release);
    const script = generateMatlabPlotScript(request);
    assert.equal(script, resolved.script, 'Router resolution and generation must produce identical source');
    assert.ok(script.startsWith(`function result = ${functionName}(${parameters.join(', ')})\n`));
    return {
      id: caseId, function_name: functionName, parameters, output_directory: caseId,
      helper: resolved.plotRoute.helper, request, script,
    };
  });
  mkdirSync(generatedRoot);
  mkdirSync(path.join(generatedRoot, 'source'));
  writeFileSync(path.join(generatedRoot, 'source', 'inputs.json'), `${JSON.stringify(inputs, null, 2)}\n`, { flag: 'wx' });
  const catalogCases = cases.map(({ script, ...entry }) => {
    mkdirSync(path.join(generatedRoot, entry.output_directory));
    const scriptFile = `source/${entry.function_name}.m`;
    writeFileSync(path.join(generatedRoot, scriptFile), script, { flag: 'wx' });
    return { ...entry, script: fileEvidence(generatedRoot, scriptFile) };
  });
  const catalog = {
    schema_version: 1, scope: 'two-route-smoke', target_release: release,
    generator: 'resolveMatlabPlotRequest/generateMatlabPlotScript',
    output_root: outputRootPath, asset_directory: assetDirectoryPath, source_directory: 'source',
    runtime_status: 'not-run', execution_verified: false,
    visual_inspection_verified: false, desktop_interaction_verified: false,
    inputs: fileEvidence(generatedRoot, 'source/inputs.json'), cases: catalogCases,
  };
  writeFileSync(path.join(generatedRoot, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`, { flag: 'wx' });
  return catalog;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 4, 'Usage: node generate_router_smoke.mjs <release> <output_root>');
    const catalog = generateRouterSmoke({ release: process.argv[2], outputRoot: process.argv[3] });
    process.stdout.write(`${JSON.stringify({
      catalog: path.join(catalog.output_root, 'generated-router', 'catalog.json'),
      target_release: catalog.target_release, generated_cases: catalog.cases.length, execution_verified: false,
    })}\n`);
  } catch (error) {
    process.stderr.write(`MATLAB_GENERATED_ROUTER_SOURCE=failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
