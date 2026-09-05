import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  MATLAB_PLOT_ADVERSARIAL_DIMENSIONS,
  MATLAB_PLOT_EVALUATION_CASES,
  MATLAB_PLOT_EVALUATION_CASE_IDS,
  MATLAB_PLOT_EVALUATION_SCHEMA_VERSION,
  MATLAB_PLOT_PUBLICATION_QUALITY_DIMENSIONS,
  MATLAB_PLOT_RUNTIME_EXPORT_DIMENSIONS,
  MATLAB_PLOT_SCIENTIFIC_SEMANTIC_DIMENSIONS,
  buildMatlabPlotEvaluationPrompt,
  evaluateMatlabPlotCase,
  evaluateMatlabPlotSuite,
  getMatlabPlotEvaluationCase,
} from './matlab-plot-evaluation-cases.mjs';
import { MATLAB_PLOTTING_INSTRUCTIONS, matlabPlottingInstructions } from './matlab-plotting-instructions.mjs';
import { inspectMatlabPlotQuality, scoreMatlabPlotQuality } from './matlab-plot-quality.mjs';

const REQUIRED_CATEGORIES = ['时间序列', '误差带', '多面板', '海洋断面', '经纬度场', '频谱', '玫瑰图', '中文字体', '导出失败修复', '旧版本兼容', 'MATLAB/Octave 路由', '错误输入', '对抗输入'];
const QUALITY_WEIGHTS = {
  axisLabelsUnits: 16, fontSize: 12, lineWidth: 10, legendOcclusion: 12,
  colorbarLabels: 10, clippingRisk: 12, outputResolution: 16, accessibility: 12,
};
const QUALITY_CRITERIA = Object.keys(QUALITY_WEIGHTS);
const QUALITY_SIGNALS = ['matlabPlotQualityOk', 'manifestOk', 'artifactsOk', 'crossFormatMetadataOk', 'pngArtifactsOk', 'pdfArtifactsOk'];
const ROUND_6_CASE_IDS = [
  'invalid-section-dimension-order', 'invalid-timeseries-missing-timezone', 'user-en-nonutc-zoned-timeseries',
  'invalid-uncertainty-unit-mismatch', 'invalid-vector-component-units', 'invalid-positive-up-depth-template',
  'user-en-interactive-qc-alignment', 'user-zh-missing-qc-zero-distinction',
];
const ROUND_7_CASE_IDS = [
  'user-zh-journal-multipanel-layout', 'user-en-accessible-anomaly-field', 'user-zh-headless-cjk-font-fallback',
  'user-en-headless-export-recovery', 'user-en-interactive-static-fallback', 'adversarial-fabricated-publication-score',
];
const ROUND_8_CASE_IDS = [
  'user-en-r2018b-headless-export-manifest', 'invalid-mapping-toolbox-unavailable',
  'user-en-signal-toolbox-declared', 'user-en-r2024b-svg-print-fallback',
  'user-zh-r2025a-native-svg', 'user-zh-stale-manifest-repair',
];
const ROUND_9_CASE_IDS = [
  'adversarial-zh-section-shape-injection', 'adversarial-en-crossed-uncertainty-bounds',
  'adversarial-en-toolbox-path-shadow', 'adversarial-zh-octave-manifest-relabel',
  'adversarial-en-headless-empty-artifacts', 'adversarial-en-antimeridian-sort',
  'adversarial-bilingual-interaction-stale-events',
];

test('defines complete, unique, machine-readable MATLAB plotting evaluation cases', () => {
  assert.equal(MATLAB_PLOT_EVALUATION_SCHEMA_VERSION, 7);
  assert.equal(new Set(MATLAB_PLOT_EVALUATION_CASES.map((entry) => entry.id)).size, MATLAB_PLOT_EVALUATION_CASES.length);
  assert.deepEqual(MATLAB_PLOT_EVALUATION_CASE_IDS, MATLAB_PLOT_EVALUATION_CASES.map((entry) => entry.id));
  for (const category of REQUIRED_CATEGORIES) assert.ok(MATLAB_PLOT_EVALUATION_CASES.some((entry) => entry.category === category), category);
  for (const entry of MATLAB_PLOT_EVALUATION_CASES) {
    assert.equal(entry.schemaVersion, MATLAB_PLOT_EVALUATION_SCHEMA_VERSION);
    assert.ok(entry.input.prompt.length > 10);
    assert.ok(entry.input.dataContract.length > 3);
    assert.ok(['accept', 'reject', 'blocked'].includes(entry.input.expectedOutcome));
    assert.ok(entry.expectedCodeFeatures.length >= 3);
    assert.ok(entry.forbiddenBehaviors.length >= 1);
    assert.equal(entry.acceptanceRules.minimumRequiredFeatures, entry.expectedCodeFeatures.length);
    assert.equal(entry.acceptanceRules.maximumAcceptanceScore, 100);
    assert.ok(entry.acceptanceRules.minimumAcceptanceScore >= 70);
    assert.ok(entry.acceptanceRules.minimumPlotQualityScore >= 70);
    assert.equal(Object.values(entry.acceptanceRules.scoreWeights).reduce((sum, value) => sum + value, 0), 100);
    assert.ok(entry.input.routingInput || entry.input.expectedRuntime === 'octave');
    assert.ok(entry.input.expectedRoute || entry.input.expectedRouteError || entry.input.expectedRuntime === 'octave');
    assert.ok(entry.input.taskRoutingInput);
    assert.ok(entry.input.expectedTaskStatus);
    assert.ok(entry.scientificSemantics.every((semantic) => MATLAB_PLOT_SCIENTIFIC_SEMANTIC_DIMENSIONS.includes(semantic)));
    assert.equal(entry.acceptanceRules.minimumScientificSemanticScore, entry.scientificSemantics.length ? 100 : null);
    for (const semantic of entry.scientificSemantics) {
      assert.ok(entry.semanticFeatureIds[semantic].length > 0, `${entry.id}:${semantic}`);
      assert.ok(entry.semanticFeatureIds[semantic].every((featureId) => entry.expectedCodeFeatures.some((item) => item.id === featureId)));
    }
    assert.ok(entry.publicationDimensions.every((dimension) => MATLAB_PLOT_PUBLICATION_QUALITY_DIMENSIONS.includes(dimension)));
    assert.equal(entry.acceptanceRules.minimumPublicationQualityScore, entry.publicationDimensions.length ? 100 : null);
    assert.ok(entry.acceptanceRules.requiredPlotQualityCriteria.every((criterion) => QUALITY_CRITERIA.includes(criterion)));
    assert.ok(entry.acceptanceRules.requiredPlotQualitySignals.every((signal) => QUALITY_SIGNALS.includes(signal)));
    for (const dimension of entry.publicationDimensions) {
      assert.ok(entry.publicationFeatureIds[dimension].length > 0, `${entry.id}:${dimension}`);
      assert.ok(entry.publicationFeatureIds[dimension].every((featureId) => entry.expectedCodeFeatures.some((item) => item.id === featureId)));
    }
    assert.ok(entry.runtimeExportDimensions.every((dimension) => MATLAB_PLOT_RUNTIME_EXPORT_DIMENSIONS.includes(dimension)));
    assert.equal(entry.acceptanceRules.minimumRuntimeExportScore, entry.runtimeExportDimensions.length ? 100 : null);
    for (const dimension of entry.runtimeExportDimensions) {
      assert.ok(entry.runtimeExportFeatureIds[dimension].length > 0, `${entry.id}:${dimension}`);
      assert.ok(entry.runtimeExportFeatureIds[dimension].every((featureId) => entry.expectedCodeFeatures.some((item) => item.id === featureId)));
    }
    assert.ok(entry.adversarialDimensions.every((dimension) => MATLAB_PLOT_ADVERSARIAL_DIMENSIONS.includes(dimension)));
    assert.equal(entry.acceptanceRules.minimumAdversarialScore, entry.adversarialDimensions.length ? 100 : null);
    for (const dimension of entry.adversarialDimensions) {
      assert.ok(entry.adversarialFeatureIds[dimension].length > 0, `${entry.id}:${dimension}`);
      assert.ok(entry.adversarialFeatureIds[dimension].every((featureId) => entry.expectedCodeFeatures.some((item) => item.id === featureId)));
    }
    assert.equal(getMatlabPlotEvaluationCase(entry.id), entry);
    assert.match(buildMatlabPlotEvaluationPrompt(entry), new RegExp(entry.id, 'u'));
    assert.match(buildMatlabPlotEvaluationPrompt(entry), /验收分值：至少 \d+\/100/u);
    if (entry.acceptanceRules.requiredPlotQualitySignals.length) {
      assert.match(buildMatlabPlotEvaluationPrompt(entry), /inspectMatlabPlotQuality/u);
    }
    for (const feature of entry.expectedCodeFeatures) {
      assert.ok(['code', 'report', 'either'].includes(feature.evidenceSource), `${entry.id}:${feature.id}`);
      for (const pattern of feature.anyOf) assert.doesNotThrow(() => new RegExp(pattern, 'iu'));
    }
    for (const behavior of entry.forbiddenBehaviors) for (const pattern of behavior.patterns) assert.doesNotThrow(() => new RegExp(pattern, 'imu'));
  }
});

test('covers every round-7 publication dimension with real-request and adversarial contracts', () => {
  for (const caseId of ROUND_7_CASE_IDS) {
    const entry = getMatlabPlotEvaluationCase(caseId);
    assert.ok(entry, caseId);
    assert.ok(entry.publicationDimensions.length > 0, caseId);
    assert.ok(entry.acceptanceRules.requiredPlotQualityCriteria.length > 0, caseId);
  }
  for (const dimension of MATLAB_PLOT_PUBLICATION_QUALITY_DIMENSIONS) {
    const cases = MATLAB_PLOT_EVALUATION_CASES.filter((entry) => entry.publicationDimensions.includes(dimension));
    assert.ok(cases.length >= 2, `${dimension}: ${cases.map((entry) => entry.id).join(',')}`);
  }
});

test('covers every round-8 runtime and export dimension with routed contracts', () => {
  for (const caseId of ROUND_8_CASE_IDS) {
    const entry = getMatlabPlotEvaluationCase(caseId);
    assert.ok(entry, caseId);
    assert.ok(entry.runtimeExportDimensions.length > 0, caseId);
    const result = evaluateMatlabPlotCase(entry, candidateFor(entry));
    assert.equal(result.route.ok, true, `${caseId}: ${result.route.reason || result.route.error}`);
    assert.equal(result.taskRoute.ok, true, `${caseId}: ${result.taskRoute.reason}`);
    assert.equal(result.taskRoute.value.status, entry.input.expectedTaskStatus, caseId);
  }
  for (const dimension of MATLAB_PLOT_RUNTIME_EXPORT_DIMENSIONS) {
    const cases = MATLAB_PLOT_EVALUATION_CASES.filter((entry) => entry.runtimeExportDimensions.includes(dimension));
    assert.ok(cases.length >= 2, `${dimension}: ${cases.map((entry) => entry.id).join(',')}`);
  }

  const missingToolbox = evaluateMatlabPlotCase(
    getMatlabPlotEvaluationCase('invalid-mapping-toolbox-unavailable'),
    candidateFor(getMatlabPlotEvaluationCase('invalid-mapping-toolbox-unavailable')),
  );
  assert.equal(missingToolbox.taskRoute.value.error.code, 'MATLAB_MISSING_TOOLBOX');
  assert.deepEqual(missingToolbox.taskRoute.value.requiredToolboxes, ['mapping']);
  assert.equal(missingToolbox.quality.applicable, false);

  const svgFallback = evaluateMatlabPlotCase(
    getMatlabPlotEvaluationCase('user-en-r2024b-svg-print-fallback'),
    candidateFor(getMatlabPlotEvaluationCase('user-en-r2024b-svg-print-fallback')),
  );
  const nativeSvg = evaluateMatlabPlotCase(
    getMatlabPlotEvaluationCase('user-zh-r2025a-native-svg'),
    candidateFor(getMatlabPlotEvaluationCase('user-zh-r2025a-native-svg')),
  );
  assert.equal(svgFallback.taskRoute.value.outputContract.exportStrategies.svg.api, 'print');
  assert.equal(nativeSvg.taskRoute.value.outputContract.exportStrategies.svg.api, 'exportgraphics');
});

test('covers every round-9 adversarial dimension with real routed outcomes', () => {
  const roundNineCases = ROUND_9_CASE_IDS.map((caseId) => getMatlabPlotEvaluationCase(caseId));
  assert.deepEqual(new Set(roundNineCases.map((entry) => entry.input.expectedOutcome)), new Set(['accept', 'reject', 'blocked']));
  assert.ok(roundNineCases.some((entry) => /[\u4e00-\u9fff]/u.test(entry.input.prompt)));
  assert.ok(roundNineCases.some((entry) => /^[\x00-\x7f]+$/u.test(entry.input.prompt)));
  for (const caseId of ROUND_9_CASE_IDS) {
    const entry = getMatlabPlotEvaluationCase(caseId);
    assert.ok(entry, caseId);
    assert.ok(entry.adversarialDimensions.length > 0, caseId);
    const result = evaluateMatlabPlotCase(entry, candidateFor(entry));
    assert.equal(result.route.ok, true, `${caseId}: ${result.route.reason || result.route.error}`);
    assert.equal(result.taskRoute.ok, true, `${caseId}: ${result.taskRoute.reason}`);
    assert.equal(result.taskRoute.value.status, entry.input.expectedTaskStatus, caseId);
  }
  for (const dimension of MATLAB_PLOT_ADVERSARIAL_DIMENSIONS) {
    const cases = MATLAB_PLOT_EVALUATION_CASES.filter((entry) => entry.adversarialDimensions.includes(dimension));
    assert.ok(cases.length >= 2, `${dimension}: ${cases.map((entry) => entry.id).join(',')}`);
  }
});

test('covers every round-6 scientific semantic with executable accepted and rejected contracts', () => {
  for (const caseId of ROUND_6_CASE_IDS) {
    const entry = getMatlabPlotEvaluationCase(caseId);
    assert.ok(entry, caseId);
    assert.equal(entry.input.taskRoutingInput.requireScientificContract, true, caseId);
  }
  for (const semantic of MATLAB_PLOT_SCIENTIFIC_SEMANTIC_DIMENSIONS) {
    const cases = MATLAB_PLOT_EVALUATION_CASES.filter((entry) => entry.scientificSemantics.includes(semantic));
    assert.ok(cases.length >= 2, `${semantic}: ${cases.map((entry) => entry.id).join(',')}`);
    assert.ok(cases.some((entry) => entry.input.expectedOutcome === 'accept'), `${semantic}: accepted case`);
    if (!['missingness', 'qc'].includes(semantic)) {
      assert.ok(cases.some((entry) => entry.input.expectedOutcome === 'reject'), `${semantic}: rejected case`);
    }
  }
});

test('accepts candidates satisfying every declared feature without forbidden behavior', () => {
  for (const entry of MATLAB_PLOT_EVALUATION_CASES) {
    const result = evaluateMatlabPlotCase(entry, candidateFor(entry));
    assert.equal(result.passed, true, `${entry.id}: ${JSON.stringify(result)}`);
    assert.equal(result.routeOk, true, entry.id);
    assert.equal(result.acceptanceScore, 100, entry.id);
  }
});

test('rejects every case when required features are absent', () => {
  for (const entry of MATLAB_PLOT_EVALUATION_CASES) {
    const result = evaluateMatlabPlotCase(entry, { ...candidateFor(entry), code: '% intentionally incomplete candidate', report: '' });
    assert.equal(result.passed, false, entry.id);
    assert.ok(result.required.some((feature) => !feature.passed), entry.id);
  }
});

test('rejects every declared forbidden behavior and runtime misroute', () => {
  for (const entry of MATLAB_PLOT_EVALUATION_CASES) {
    const good = candidateFor(entry);
    const badPattern = entry.forbiddenBehaviors[0].patterns[0];
    const result = evaluateMatlabPlotCase(entry, {
      ...good,
      code: `${good.code}\n${exampleFor(badPattern)}`,
      runtime: entry.input.expectedRuntime === 'matlab' ? 'octave' : 'matlab',
    });
    assert.equal(result.passed, false, entry.id);
    assert.equal(result.routeOk, false, entry.id);
    assert.ok(result.violations.length >= 1, entry.id);
  }
});

test('uses the existing router for accepted and rejected input contracts', () => {
  const rejected = MATLAB_PLOT_EVALUATION_CASES.filter((entry) => entry.input.expectedOutcome === 'reject');
  const accepted = MATLAB_PLOT_EVALUATION_CASES.filter((entry) => entry.input.expectedOutcome === 'accept' && entry.input.expectedRuntime === 'matlab');
  assert.ok(rejected.length >= 2);
  for (const entry of [...accepted, ...rejected]) {
    const result = evaluateMatlabPlotCase(entry, candidateFor(entry));
    assert.equal(result.route.ok, true, `${entry.id}: ${result.route.reason || result.route.error}`);
    assert.equal(result.taskRoute.ok, true, `${entry.id}: ${result.taskRoute.reason}`);
  }
});

test('round-6 cases stay synchronized with plot and scientific task routers', () => {
  for (const caseId of ROUND_6_CASE_IDS) {
    const entry = getMatlabPlotEvaluationCase(caseId);
    const result = evaluateMatlabPlotCase(entry, candidateFor(entry));
    assert.equal(result.route.ok, true, `${caseId}: ${result.route.reason}`);
    assert.equal(result.taskRoute.ok, true, `${caseId}: ${result.taskRoute.reason}`);
    assert.equal(result.taskRoute.value.scientificDataContract.provided, true, caseId);
    assert.equal(result.taskRoute.value.scientificDataContract.required, true, caseId);
    assert.equal(result.taskRoute.value.status, entry.input.expectedTaskStatus, caseId);
  }
});

test('round-7 cases feed complete publication contracts to plot and task routers', () => {
  for (const caseId of ROUND_7_CASE_IDS) {
    const entry = getMatlabPlotEvaluationCase(caseId);
    const result = evaluateMatlabPlotCase(entry, candidateFor(entry));
    assert.equal(result.route.ok, true, `${caseId}: ${result.route.reason}`);
    const multiPanelComposer = entry.input.taskRoutingInput.publicationContract.layout.architecture === 'tiledlayout'
      && entry.input.taskRoutingInput.publicationContract.layout.rows * entry.input.taskRoutingInput.publicationContract.layout.columns > 1;
    assert.equal(result.route.value.publicationPolicy.contractProvided, !multiPanelComposer, caseId);
    assert.equal(result.taskRoute.ok, true, `${caseId}: ${result.taskRoute.reason}`);
    assert.equal(result.taskRoute.value.publicationContract.provided, true, caseId);
    assert.equal(result.taskRoute.value.publicationContract.required, true, caseId);
    assert.deepEqual(result.taskRoute.value.publicationContract.unresolvedRequirements, [], caseId);
  }
});

test('scientific semantic scoring fails partial compliance independently by dimension', () => {
  const entry = getMatlabPlotEvaluationCase('user-zh-missing-qc-zero-distinction');
  const omittedFeature = 'preserve-zero';
  const evidence = entry.expectedCodeFeatures
    .filter((item) => item.id !== omittedFeature)
    .map((item) => exampleFor(item.anyOf[0]))
    .join('\n');
  const candidate = { ...candidateFor(entry), code: evidence, report: evidence };
  const result = evaluateMatlabPlotCase(entry, candidate);
  assert.equal(result.semanticScores.qc, 100);
  assert.equal(result.semanticScores.missingness, 75);
  assert.equal(result.scientificSemanticScore, 75);
  assert.equal(result.scientificSemanticsOk, false);
  assert.equal(result.passed, false);
  const suite = evaluateMatlabPlotSuite([{ caseId: entry.id, candidate }], { caseIds: [entry.id], requireAllCases: false });
  assert.equal(suite.semanticCoverage.missingness.evaluatedCaseCount, 1);
  assert.equal(suite.semanticCoverage.missingness.passedCaseCount, 0);
  assert.equal(suite.semanticCoverage.missingness.averageScore, 75);
  assert.equal(suite.semanticCoverage.qc.passedCaseCount, 0);
});

test('blocks timezone relabeling, QC row drops, and zero-to-missing adversarial shortcuts', () => {
  const attacks = [
    ['invalid-timeseries-missing-timezone', "time.TimeZone='UTC';"],
    ['user-en-interactive-qc-alignment', 'values = values(qcGood);'],
    ['user-zh-missing-qc-zero-distinction', 'values(values == 0) = NaN;'],
  ];
  for (const [caseId, attack] of attacks) {
    const entry = getMatlabPlotEvaluationCase(caseId);
    const candidate = candidateFor(entry);
    const result = evaluateMatlabPlotCase(entry, { ...candidate, code: `${candidate.code}\n${attack}` });
    assert.equal(result.passed, false, caseId);
    assert.ok(result.violations.length > 0, caseId);
  }
});

test('consumes the existing plot quality scorer and enforces each case threshold', () => {
  const entry = MATLAB_PLOT_EVALUATION_CASES.find((item) => item.id === 'user-en-hourly-buoy-timeseries');
  const accepted = evaluateMatlabPlotCase(entry, {
    ...candidateFor(entry),
    plotQualityResult: { plotQualityScore: 0, plotQualityScoreOk: false },
  });
  assert.equal(accepted.passed, true);
  assert.equal(accepted.qualityOk, true);
  assert.equal(accepted.quality.recomputedFromPaths, true);
  assert.equal(accepted.quality.requiredBoolean, accepted.taskRoute.value.qualityGate.requiredBoolean);
  assert.deepEqual(accepted.quality.requiredCriteria, accepted.taskRoute.value.qualityGate.requiredCriteria);
  assert.equal(accepted.quality.minimumScore, Math.max(entry.acceptanceRules.minimumPlotQualityScore, accepted.taskRoute.value.qualityGate.minimumScore));
});

test('rejects a high aggregate score when a case-required publication criterion fails', () => {
  const fixture = createManifestQualityFixture();
  try {
    writeFileSync(fixture.sourcePath, highQualitySource({ lineWidth: false }));
    fixture.manifest.generated_at = new Date().toISOString();
    writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));
    const entry = getMatlabPlotEvaluationCase('user-zh-journal-multipanel-layout');
    const result = evaluateMatlabPlotCase(entry, {
      ...candidateFor(entry),
      qualityEvidence: qualityEvidenceFor(fixture),
    });
    assert.equal(result.quality.checkerContractOk, true);
    assert.equal(result.quality.requiredCriteriaOk, false);
    assert.deepEqual(result.quality.failedRequiredCriteria, ['lineWidth']);
    assert.equal(result.passed, false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('rejects fabricated or internally inconsistent publication quality results', () => {
  const entry = getMatlabPlotEvaluationCase('adversarial-fabricated-publication-score');
  const incomplete = {
    plotQualityScore: 100,
    plotQualityScoreMax: 100,
    plotQualityScoreOk: true,
    plotQualityCriteria: Object.fromEntries(QUALITY_CRITERIA.map((name) => [name, { ok: true }])),
  };
  const inconsistent = passingQualityResult();
  inconsistent.plotQualityCriteria.accessibility = {
    ...inconsistent.plotQualityCriteria.accessibility,
    ok: false,
    status: 'fail',
    score: 0,
  };
  const untrustedCandidate = candidateFor(entry);
  delete untrustedCandidate.qualityEvidence;
  const incompleteResult = evaluateMatlabPlotCase(entry, { ...untrustedCandidate, plotQualityResult: incomplete });
  const inconsistentResult = evaluateMatlabPlotCase(entry, { ...untrustedCandidate, plotQualityResult: inconsistent });
  const wrongGrade = passingQualityResult();
  wrongGrade.plotQualityGrade = 'F';
  const wrongEvidence = passingQualityResult();
  wrongEvidence.plotQualityEvidence.axisLabelsUnits = ['fabricated evidence'];
  const wrongGradeResult = evaluateMatlabPlotCase(entry, { ...untrustedCandidate, plotQualityResult: wrongGrade });
  const wrongEvidenceResult = evaluateMatlabPlotCase(entry, { ...untrustedCandidate, plotQualityResult: wrongEvidence });
  assert.match(incompleteResult.quality.reason, /qualityEvidence paths are required/u);
  assert.match(inconsistentResult.quality.reason, /qualityEvidence paths are required/u);
  assert.match(wrongGradeResult.quality.reason, /qualityEvidence paths are required/u);
  assert.match(wrongEvidenceResult.quality.reason, /qualityEvidence paths are required/u);
  assert.equal(incompleteResult.passed, false);
  assert.equal(inconsistentResult.passed, false);
  assert.equal(wrongGradeResult.passed, false);
  assert.equal(wrongEvidenceResult.passed, false);
});

test('scores adversarial dimensions and blocks representative boundary attacks', () => {
  const entry = getMatlabPlotEvaluationCase('adversarial-zh-section-shape-injection');
  const evidence = entry.expectedCodeFeatures
    .filter((item) => item.id !== 'refuse-contract-override')
    .map((item) => exampleFor(item.anyOf[0]))
    .join('\n');
  const partial = evaluateMatlabPlotCase(entry, { ...candidateFor(entry), code: evidence, report: evidence });
  assert.equal(partial.adversarialScores['data-integrity'], 100);
  assert.equal(partial.adversarialScores['route-coercion'], 100);
  assert.equal(partial.adversarialScores['instruction-injection'], 0);
  assert.equal(partial.adversarialOk, false);
  assert.equal(partial.passed, false);

  const attacks = [
    ['adversarial-zh-section-shape-injection', 'section = reshape(temperature,8,5);'],
    ['adversarial-en-crossed-uncertainty-bounds', 'lower95 = abs(lower95);'],
    ['adversarial-en-toolbox-path-shadow', 'pwelch(pressure,window,overlap,nfft,sampleRateHz);'],
    ['adversarial-zh-octave-manifest-relabel', 'runtime=matlab; execution_verified=true;'],
    ['adversarial-en-headless-empty-artifacts', 'artifactsOk=true;'],
    ['adversarial-en-antimeridian-sort', 'lon=sort(lon);'],
  ];
  for (const [caseId, attack] of attacks) {
    const attackEntry = getMatlabPlotEvaluationCase(caseId);
    const candidate = candidateFor(attackEntry);
    const result = evaluateMatlabPlotCase(attackEntry, { ...candidate, code: `${candidate.code}\n${attack}` });
    assert.equal(result.passed, false, caseId);
    assert.ok(result.violations.length > 0, caseId);
  }
});

test('scores publication dimensions and blocks headless and interaction shortcuts', () => {
  const entry = getMatlabPlotEvaluationCase('user-en-interactive-static-fallback');
  const omittedFeature = 'honest-static-report';
  const evidence = entry.expectedCodeFeatures
    .filter((item) => item.id !== omittedFeature)
    .map((item) => exampleFor(item.anyOf[0]))
    .join('\n');
  const partial = { ...candidateFor(entry), code: evidence, report: evidence };
  const result = evaluateMatlabPlotCase(entry, partial);
  assert.equal(result.publicationScores.accessibility, 100);
  assert.equal(result.publicationScores.headless, 67);
  assert.equal(result.publicationScores.interaction, 75);
  assert.equal(result.publicationQualityScore, 67);
  assert.equal(result.publicationQualityOk, false);
  assert.equal(result.passed, false);

  for (const attack of ["evalin('base','selectedRows')", 'headless interaction_verified=true']) {
    const candidate = candidateFor(entry);
    const attacked = evaluateMatlabPlotCase(entry, { ...candidate, code: `${candidate.code}\n${attack}` });
    assert.equal(attacked.passed, false, attack);
    assert.ok(attacked.violations.length > 0, attack);
  }
});

test('scores runtime/export dimensions and rejects release-specific SVG drift', () => {
  const entry = getMatlabPlotEvaluationCase('user-en-r2024b-svg-print-fallback');
  const evidence = entry.expectedCodeFeatures
    .filter((item) => item.id !== 'true-svg-print')
    .map((item) => exampleFor(item.anyOf[0]))
    .join('\n');
  const partial = evaluateMatlabPlotCase(entry, { ...candidateFor(entry), code: evidence, report: evidence });
  assert.equal(partial.runtimeExportScores.png, 100);
  assert.equal(partial.runtimeExportScores.pdf, 100);
  assert.ok(partial.runtimeExportScores.svg < 100);
  assert.ok(partial.runtimeExportScores['legacy-release'] < 100);
  assert.equal(partial.runtimeExportOk, false);
  assert.equal(partial.passed, false);

  const nativeEntry = getMatlabPlotEvaluationCase('user-zh-r2025a-native-svg');
  const candidate = candidateFor(nativeEntry);
  const obsoleteFallback = evaluateMatlabPlotCase(nativeEntry, { ...candidate, code: `${candidate.code}\nprint(fig,'plot.svg','-dsvg')` });
  assert.equal(obsoleteFallback.passed, false);
  assert.ok(obsoleteFallback.violations.some((violation) => violation.id === 'obsolete-svg-fallback'));
});

test('requires artifact-backed manifest signals in addition to a 100 quality score', () => {
  const entry = getMatlabPlotEvaluationCase('user-zh-stale-manifest-repair');
  const candidate = candidateFor(entry);
  const fabricated = {
    ...candidate,
    qualityEvidence: undefined,
    artifactInspectionResult: undefined,
    plotQualityResult: {
      ...candidate.plotQualityResult,
      matlabPlotQualityOk: true,
      manifestOk: true,
      artifactsOk: true,
      crossFormatMetadataOk: true,
      pngArtifactsOk: true,
      pdfArtifactsOk: true,
    },
  };
  const result = evaluateMatlabPlotCase(entry, fabricated);
  assert.match(result.quality.reason, /qualityEvidence paths are required/u);
  assert.equal(result.passed, false);

  const contradictoryInspection = { ...passingArtifactInspectionResult(), manifestParseOk: false };
  const contradictory = evaluateMatlabPlotCase(entry, {
    ...candidate, qualityEvidence: undefined, artifactInspectionResult: contradictoryInspection,
  });
  assert.match(contradictory.quality.reason, /qualityEvidence paths are required/u);
  assert.equal(contradictory.passed, false);

  const shallowInspection = {
    ...passingArtifactInspectionResult(),
    artifacts: [{ format: 'png', ok: true }, { format: 'pdf', ok: true }],
  };
  const shallow = evaluateMatlabPlotCase(entry, {
    ...candidate, qualityEvidence: undefined, artifactInspectionResult: shallowInspection,
  });
  assert.match(shallow.quality.reason, /qualityEvidence paths are required/u);
  assert.equal(shallow.passed, false);
});

test('accepts manifest gates only from a successful artifact inspection result', () => {
  const fixture = createManifestQualityFixture();
  try {
    const inspected = inspectMatlabPlotQuality({
      sourcePath: fixture.sourcePath,
      manifestPath: fixture.manifestPath,
      outputDirectory: fixture.root,
      plotQualityAudit: Object.fromEntries(QUALITY_CRITERIA.map((name) => [name, true])),
    });
    assert.equal(inspected.matlabPlotQualityOk, true);
    const scored = scoreMatlabPlotQuality({
      sourcePath: fixture.sourcePath,
      manifestPath: fixture.manifestPath,
      outputDirectory: fixture.root,
      plotQualityAudit: Object.fromEntries(QUALITY_CRITERIA.map((name) => [name, true])),
    });
    const entry = getMatlabPlotEvaluationCase('user-zh-stale-manifest-repair');
    const accepted = evaluateMatlabPlotCase(entry, {
      ...candidateFor(entry), qualityEvidence: qualityEvidenceFor(fixture), plotQualityResult: scored, artifactInspectionResult: inspected,
    });
    assert.equal(accepted.qualityOk, true, JSON.stringify(accepted.quality));
    assert.equal(accepted.routeOk, true, JSON.stringify({ route: accepted.route, taskRoute: accepted.taskRoute }));
    assert.deepEqual(accepted.violations, []);
    assert.equal(accepted.passedFeatures, accepted.totalFeatures);
    assert.equal(accepted.runtimeExportOk, true);
    assert.equal(accepted.passed, true, JSON.stringify(accepted));

    fixture.manifest.figures[0].exports.png.sha256 = '0'.repeat(64);
    writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));
    const stale = inspectMatlabPlotQuality({
      sourcePath: fixture.sourcePath,
      manifestPath: fixture.manifestPath,
      outputDirectory: fixture.root,
      plotQualityAudit: Object.fromEntries(QUALITY_CRITERIA.map((name) => [name, true])),
    });
    assert.equal(stale.artifactsOk, false);
    const rejected = evaluateMatlabPlotCase(entry, {
      ...candidateFor(entry), qualityEvidence: qualityEvidenceFor(fixture), plotQualityResult: scored, artifactInspectionResult: stale,
    });
    assert.equal(rejected.quality.requiredSignalsOk, false);
    assert.equal(rejected.passed, false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('rejects missing runtime evidence, wrong candidate routes, and raw quality scores', () => {
  const entry = getMatlabPlotEvaluationCase('time-series-datetime-gaps');
  const candidate = candidateFor(entry);
  const missingRuntime = { ...candidate };
  delete missingRuntime.runtimeEvidence;
  const wrongRoute = { ...candidate, selectedRoute: 'spectrum' };
  const rawScore = { ...candidate, qualityEvidence: undefined, plotQualityResult: undefined, plotQualityScore: 100 };
  assert.equal(evaluateMatlabPlotCase(entry, missingRuntime).passed, false);
  assert.equal(evaluateMatlabPlotCase(entry, wrongRoute).passed, false);
  assert.equal(evaluateMatlabPlotCase(entry, rawScore).passed, false);
});

test('does not count MATLAB comments as executable feature evidence', () => {
  const entry = getMatlabPlotEvaluationCase('adversarial-comment-feature-stuffing');
  for (const prefix of ['plot(value);', "transposed = value';", "nonconjugate = value.';"]) {
    const featureClaims = entry.expectedCodeFeatures.map((item) => `${prefix} % ${exampleFor(item.anyOf[0])}`).join('\n');
    const result = evaluateMatlabPlotCase(entry, { ...candidateFor(entry), code: featureClaims, report: '' });
    assert.equal(result.passedFeatures, 0, prefix);
    assert.equal(result.passed, false, prefix);
  }
});

test('does not count MATLAB string literals as executable features or forbidden calls', () => {
  const entry = getMatlabPlotEvaluationCase('adversarial-comment-feature-stuffing');
  const stringClaims = [
    'claim1 = "isdatetime(time)";',
    `claim2 = "axes('Parent', fig)";`,
    `claim3 = 'TimeZone UTC';`,
    'claim4 = "oi_export_figure(fig, output, plot, 1200, 675, 180)";',
    'claim5 = "escaped ""isdatetime(time)"" text";',
    `claim6 = 'escaped ''oi_export_figure(fig, output)'' text';`,
  ].join('\n');
  const stuffed = evaluateMatlabPlotCase(entry, {
    ...candidateFor(entry), code: stringClaims, report: '', runtime: '',
  });
  assert.equal(stuffed.passedFeatures, 0);
  assert.equal(stuffed.passed, false);

  const executable = evaluateMatlabPlotCase(entry, {
    ...candidateFor(entry),
    code: [
      'assert(isdatetime(time));',
      "ax = axes('Parent', fig);",
      "time.TimeZone = 'UTC'; xlabel(ax, 'Time UTC');",
      "oi_export_figure(fig, output, 'plot', 1200, 675, 180);",
    ].join('\n'),
    report: '',
  });
  assert.equal(executable.passedFeatures, entry.expectedCodeFeatures.length);

  const legitimate = candidateFor(entry);
  const quotedForbiddenCall = evaluateMatlabPlotCase(entry, {
    ...legitimate,
    code: `${legitimate.code}\nwarningText = "gca() is forbidden";`,
  });
  assert.equal(quotedForbiddenCall.violations.length, 0);
  assert.equal(quotedForbiddenCall.passed, true);
});

test('does not accept report or runtime claims for code-scoped features', () => {
  const entry = getMatlabPlotEvaluationCase('adversarial-comment-feature-stuffing');
  const claims = entry.expectedCodeFeatures.map((item) => exampleFor(item.anyOf[0])).join('\n');
  assert.ok(entry.expectedCodeFeatures.every((item) => item.evidenceSource === 'code'));
  assert.match(buildMatlabPlotEvaluationPrompt(entry), /报告声明不能替代代码证据/u);

  for (const injectedEvidence of [
    { report: claims },
    { report: '', runtime: claims },
  ]) {
    const result = evaluateMatlabPlotCase(entry, {
      ...candidateFor(entry), code: 'plot(value);', ...injectedEvidence,
    });
    assert.equal(result.passedFeatures, 0);
    assert.equal(result.adversarialScore, 0);
    assert.equal(result.passed, false);
    assert.ok(result.required.every((item) => item.evidenceSource === 'code' && item.passed === false));
  }
});

test('rejects stale-event interaction shortcuts and headless exportapp claims', () => {
  const entry = getMatlabPlotEvaluationCase('adversarial-bilingual-interaction-stale-events');
  const candidate = candidateFor(entry);
  assert.equal(evaluateMatlabPlotCase(entry, candidate).passed, true);
  for (const attack of ["evalin('base','selectedRows')", 'headless exportapp(uiFigure,"plot.png")', 'xvfb-run octave --no-gui']) {
    const result = evaluateMatlabPlotCase(entry, { ...candidate, code: `${candidate.code}\n${attack}` });
    assert.equal(result.passed, false, attack);
    assert.ok(result.violations.length > 0, attack);
  }
});

test('requires the real quality criterion names and skips figure quality only for non-figure outcomes', () => {
  const acceptedEntry = getMatlabPlotEvaluationCase('time-series-datetime-gaps');
  const fakeCriteria = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`fake${index}`, { ok: true }]));
  const fakeQuality = evaluateMatlabPlotCase(acceptedEntry, {
    ...candidateFor(acceptedEntry),
    qualityEvidence: undefined,
    plotQualityResult: { plotQualityScore: 100, plotQualityScoreOk: true, plotQualityCriteria: fakeCriteria },
  });
  assert.equal(fakeQuality.passed, false);
  assert.match(fakeQuality.quality.reason, /qualityEvidence paths are required/u);

  const rejectedEntry = getMatlabPlotEvaluationCase('invalid-section-one-dimensional');
  const rejectedCandidate = candidateFor(rejectedEntry);
  delete rejectedCandidate.plotQualityResult;
  const rejected = evaluateMatlabPlotCase(rejectedEntry, rejectedCandidate);
  assert.equal(rejected.passed, true);
  assert.equal(rejected.quality.applicable, false);
});

test('requires concrete command, version and artifact evidence for verified execution claims', () => {
  const entry = getMatlabPlotEvaluationCase('route-explicit-octave');
  const incomplete = candidateFor(entry);
  delete incomplete.runtimeEvidence.command;
  assert.equal(evaluateMatlabPlotCase(entry, incomplete).passed, false);
});

test('never accepts Octave verification as MATLAB evidence', () => {
  const entry = getMatlabPlotEvaluationCase('adversarial-matlab-unavailable-octave-present');
  const candidate = candidateFor(entry);
  const spoofed = {
    ...candidate,
    code: `${candidate.code}\nxvfb-run octave --no-gui`,
    report: `${candidate.report}\nMATLAB_RENDERING_VERIFIED=1`,
    runtimeEvidence: { runtime: 'matlab', status: 'verified', executionVerified: true, octaveVerified: true },
  };
  const result = evaluateMatlabPlotCase(entry, spoofed);
  assert.equal(result.passed, false);
  assert.equal(result.runtimeEvidence.ok, false);
  assert.ok(result.violations.some((violation) => violation.id === 'octave-as-matlab'));
});

test('runs complete registered suites and the JSON CLI entry point', () => {
  const submissions = MATLAB_PLOT_EVALUATION_CASES.map((entry) => ({ caseId: entry.id, candidate: candidateFor(entry) }));
  const suite = evaluateMatlabPlotSuite(submissions);
  assert.equal(suite.passed, true);
  assert.equal(suite.evaluatedCount, MATLAB_PLOT_EVALUATION_CASES.length);
  assert.equal(suite.passedCount, MATLAB_PLOT_EVALUATION_CASES.length);
  for (const semantic of MATLAB_PLOT_SCIENTIFIC_SEMANTIC_DIMENSIONS) {
    assert.ok(suite.semanticCoverage[semantic].evaluatedCaseCount >= 2, semantic);
    assert.equal(suite.semanticCoverage[semantic].passedCaseCount, suite.semanticCoverage[semantic].evaluatedCaseCount, semantic);
    assert.equal(suite.semanticCoverage[semantic].averageScore, 100, semantic);
  }
  for (const dimension of MATLAB_PLOT_PUBLICATION_QUALITY_DIMENSIONS) {
    assert.ok(suite.publicationCoverage[dimension].evaluatedCaseCount >= 2, dimension);
    assert.equal(suite.publicationCoverage[dimension].passedCaseCount, suite.publicationCoverage[dimension].evaluatedCaseCount, dimension);
    assert.equal(suite.publicationCoverage[dimension].averageScore, 100, dimension);
  }
  for (const dimension of MATLAB_PLOT_RUNTIME_EXPORT_DIMENSIONS) {
    assert.ok(suite.runtimeExportCoverage[dimension].evaluatedCaseCount >= 2, dimension);
    assert.equal(suite.runtimeExportCoverage[dimension].passedCaseCount, suite.runtimeExportCoverage[dimension].evaluatedCaseCount, dimension);
    assert.equal(suite.runtimeExportCoverage[dimension].averageScore, 100, dimension);
  }
  for (const dimension of MATLAB_PLOT_ADVERSARIAL_DIMENSIONS) {
    assert.ok(suite.adversarialCoverage[dimension].evaluatedCaseCount >= 2, dimension);
    assert.equal(suite.adversarialCoverage[dimension].passedCaseCount, suite.adversarialCoverage[dimension].evaluatedCaseCount, dimension);
    assert.equal(suite.adversarialCoverage[dimension].averageScore, 100, dimension);
  }

  const cli = spawnSync(process.execPath, [fileURLToPath(new URL('./matlab-plot-evaluation-cases.mjs', import.meta.url))], {
    input: JSON.stringify({ submissions }), encoding: 'utf8',
  });
  assert.equal(cli.status, 0, `${cli.stderr}\n${cli.stdout}`);
  const cliResult = JSON.parse(cli.stdout);
  assert.equal(cliResult.passed, true);
  assert.equal(cliResult.evaluatedCount, MATLAB_PLOT_EVALUATION_CASES.length);
  assert.deepEqual(cliResult.dependencyIssues, []);
  assert.deepEqual(cliResult.semanticCoverage, suite.semanticCoverage);
  assert.deepEqual(cliResult.publicationCoverage, suite.publicationCoverage);
  assert.deepEqual(cliResult.runtimeExportCoverage, suite.runtimeExportCoverage);
  assert.deepEqual(cliResult.adversarialCoverage, suite.adversarialCoverage);

  const invalid = spawnSync(process.execPath, [fileURLToPath(new URL('./matlab-plot-evaluation-cases.mjs', import.meta.url))], {
    input: '{invalid-json', encoding: 'utf8',
  });
  assert.equal(invalid.status, 2);
});

test('suite registration rejects missing, duplicate, and unknown cases', () => {
  const entry = MATLAB_PLOT_EVALUATION_CASES[0];
  const candidate = candidateFor(entry);
  const incomplete = evaluateMatlabPlotSuite([{ caseId: entry.id, candidate }]);
  const malformed = evaluateMatlabPlotSuite([
    { caseId: entry.id, candidate }, { caseId: entry.id, candidate }, { caseId: 'not-registered', candidate },
  ], { requireAllCases: false });
  assert.equal(incomplete.passed, false);
  assert.ok(incomplete.missingIds.length > 0);
  assert.equal(malformed.contractOk, false);
  assert.deepEqual(malformed.duplicateIds, [entry.id]);
  assert.deepEqual(malformed.unknownIds, ['not-registered']);
});

test('prompt contract covers all evaluation families and release-aware routing', () => {
  const injected = matlabPlottingInstructions({ runtime: 'matlab', matlabRelease: 'R2018b', requestedCapabilities: ['tiledlayout', 'exportgraphics'] });
  for (const term of ['时间序列', '不确定性带', '多面板', '断面', '经纬度', '频谱', '玫瑰图', '中文', '导出', 'MATLAB release', 'Octave']) {
    assert.match(`${MATLAB_PLOTTING_INSTRUCTIONS}\n${injected}`, new RegExp(term, 'u'), term);
  }
  assert.match(injected, /R2018b/u);
  assert.match(injected, /tiledlayout: 明确降级/u);
  assert.match(injected, /exportgraphics: 明确降级/u);
  assert.match(injected, /不得静默.*Octave|禁止以 Octave/u);
});

function createManifestQualityFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'matlab-eval-manifest-'));
  const sourcePath = path.join(root, 'plot.m');
  const manifestPath = path.join(root, 'figures.json');
  const pngPath = path.join(root, 'plot.png');
  const pdfPath = path.join(root, 'plot.pdf');
  writeFileSync(sourcePath, highQualitySource());
  const png = Buffer.alloc(12_000);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png, 0);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(1400, 16);
  png.writeUInt32BE(800, 20);
  writeFileSync(pngPath, png);
  writeFileSync(pdfPath, [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 630 360] /Contents 4 0 R >> endobj',
    '4 0 obj << /Length 32 >> stream',
    'BT /F1 12 Tf 72 250 Td (SST UTC) Tj ET',
    'endstream endobj',
    'trailer << /Root 1 0 R >>',
    '%%EOF',
  ].join('\n'));
  const shared = { figure_id: 'plot', title: 'SST', source: 'evaluation fixture', theme: 'Ocean Intelligence' };
  const manifest = {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    generator: 'MATLAB evaluation fixture',
    figures: [{
      id: 'plot', title: shared.title, source: shared.source, theme: shared.theme,
      exports: {
        png: { ...shared, format: 'png', file: 'plot.png', width: 1400, height: 800, dpi: 160, bytes: statSync(pngPath).size, sha256: fileSha256(pngPath) },
        pdf: { ...shared, format: 'pdf', file: 'plot.pdf', width: 630, height: 360, text: 'SST UTC', bytes: statSync(pdfPath).size, sha256: fileSha256(pdfPath) },
      },
    }],
  };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return { root, sourcePath, manifestPath, manifest };
}

function highQualitySource({ lineWidth = true } = {}) {
  return [
    'theme = oi_ocean_theme();',
    "fig = oi_figure(1400,800,'off');",
    `ax = axes('Parent',fig,'FontSize',12${lineWidth ? ",'LineWidth',1.5" : ''});`,
    `plot(ax,1:10,1:10${lineWidth ? ",'LineWidth',1.5" : ''},'Marker','o');`,
    "xlabel(ax,'Time (h)'); ylabel(ax,'SST (deg C)');",
    "legend(ax,'SST','Location','eastoutside');",
    "cb = colorbar(ax); cb.Label.String = 'SST anomaly (deg C)';",
    'colormap(ax,parula(256)); oi_apply_axes(ax,theme);',
    "oi_export_figure(fig,output_directory,'plot',1400,800,160);",
  ].join('\n');
}

function qualityEvidenceFor(fixture) {
  return {
    sourcePath: fixture.sourcePath,
    manifestPath: fixture.manifestPath,
    outputDirectory: fixture.root,
    minimumPngBytes: 1,
    minimumPdfBytes: 1,
  };
}

let sharedQualityFixture;

function sharedQualityEvidence() {
  if (!sharedQualityFixture) sharedQualityFixture = createManifestQualityFixture();
  return qualityEvidenceFor(sharedQualityFixture);
}

function fileSha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function exampleFor(pattern) {
  const examples = [
    'timetable rowtimes data.Time', "axes('Parent', fig)", 'isnan(values) NaN', 'UTC', "oi_export_figure(fig, out, 'plot', 1200, 675, 180)",
    'assert(numel(lower95)==numel(meanValue))', 'isfinite(meanValue); diff(time)', 'fill(ax, x, y)', '95% CI',
    "tiledlayout(2,2,'TileSpacing','compact','Padding','compact')", 'nexttile(layout)', "title(layout, 'Shared')", 'contourf(distance, depth, value)', "set(ax,'YDir','reverse')", 'bathymetry', '距离 km 深度 m',
    'longitude lon latitude lat', '0 to 360', 'size(field)', '未投影', 'clim(ax, limits)', 'frequency > 0; psd > 0', 'loglog(frequency, psd)', 'cycles/day cpd', 'Welch window 自由度',
    'oi_plot_direction_rose(ax, direction)', "DirectionConvention='from' 风来向", "ThetaZeroLocation='top'; ThetaDir='clockwise'", 'percent 百分比',
    'oi_resolve_font()', "set(ax,'FontName',fontName)", "set(label,'Interpreter','none')", 'glyph 字形 中文字体', 'try export catch MException', 'exportgraphics(fig,"a.png")', 'isfile(file); dir(file).bytes', 'print(fig,"a.pdf","-dpdf") fallback 降级',
    'R2018b verLessThan', 'subplot(2,1,1)', "print(fig,'a.png','-dpng','-r300')", 'compatibility 兼容 降级', 'runtime MATLAB authoritative 权威', 'tiledlayout(1,1); exportgraphics(fig,"a.png")', 'MATLAB 未执行 不得 Octave',
    'GNU Octave runtime octave', 'oi_figure(); oi_apply_axes(ax,theme)', 'MATLAB 未测试', 'jet(', 'fillmissing(', 'gca', 'saveas(', 'tiledlayout(', 'xvfb-run octave',
    'isdatetime(time); timetable rowtimes', 'QC qc categorical', 'outage gap isnan(values)', 'exportgraphics(fig,"plot.png","Resolution",300); exportgraphics(fig,"plot.pdf")',
    'getReport(error); try export catch', 'listfonts(); oi_resolve_font()', 'isfile(file); dir(file).bytes; glyph 字形', "print(fig,'plot.png','-dpng'); print(fig,'plot.pdf','-dpdf')", 'introduced later compatibility fallback',
    'two-dimensional 二维 SizeMismatch Dimension', 'distance 距离 depth 深度', '不得伪造 do not fabricate', 'directionConvention from/to 来向 去向', 'from and to 来向与去向', '不得猜 不得旋转180',
    'nonpositive 非正 frequency > 0; psd > 0', 'nnz(invalid); rejected 排除', 'Welch window degrees of freedom 自由度', 'meshgrid(', 'reshape(', 'mod(direction + 180', '= eps',
    'MATLAB_RUNTIME_UNAVAILABLE runtime-unavailable', 'execution_verified=false', 'static-only 静态检查 未执行', 'do not run Octave as a substitute 不得使用 Octave 替代',
    'isdatetime(time)', "time.TimeZone='UTC'; xlabel(ax,'Time (UTC)')",
    'dimensionOrder must be depth,horizontal', 'depth, horizontal', 'no silent permute/transpose',
    'timeZone required', 'source timezone and UTC offset required', 'must not guess or relabel as UTC',
    "strcmp(string(time.TimeZone),'Asia/Shanghai')", "xlabel(ax,'Time (Asia/Shanghai)')", 'preserve instant and timezone',
    'uncertainty unit compatible with value unit', 'compatible unit and conversion formula', 'must not scale or convert uncertainty',
    'matching u/v component units', 'matching units with conversion formula', 'must not label over a mismatch',
    'Positive-up vertical coordinates cannot use positive-down templates', 'explicit transformation required', 'YDir is not a coordinate transformation',
    "assert(numel(ObservationID)==numel(QCFlag),'plot:MetadataSizeMismatch')", 'ObservationID must be nonmissing and unique',
    'missingMask = isnan(values); qcMask = QCFlag ~= "good"', 'DataTipTemplate and BrushData are bound to plotted rows',
    'speed == 0 is valid; preserve zero', 'missingCount = nnz(missingMask); suspectCount = nnz(suspectMask); badCount = nnz(badMask)',
    "figure('Units','centimeters','Position',[1 1 18 10])", "set(ax,'FontSize',11)", "set(lineHandle,'LineWidth',1.5)",
    "legend(ax,'series','Location','eastoutside')", 'drawnow; clipping = ax.TightInset',
    "cmocean('balance')", 'clim(ax,[-limit limit])', "contour(lon,lat,value,'ShowText','on')",
    "cb=colorbar(ax); cb.Label.String='Sea-level anomaly (cm)'", 'deuteranopia and grayscale audit passed',
    'CJK font unavailable; fail export', 'Unicode minus and 南海海表温度 (°C)',
    'matlab -batch "run_publication_plot"', "figure('Visible','off')", "usejava('desktop'); HeadlessFallback = true", 'drawnow',
    'isfile(pngPath); dir(pngPath).bytes; artifact dimensions 1600x900',
    "usejava('desktop'); HeadlessFallback static export", 'DataTipTemplate BrushData ObservationID SelectedObservationIDs',
    "Marker='o'; selected observation uses non-color encoding", 'OceanInteractionState CloseRequestFcn rmappdata',
    'static export is not interactive; interaction unverified', 'scoreMatlabPlotQuality source evidence; refuse fabricated quality',
    'event.Target event.DataIndex; dataIndex <= numel(target.XData) && dataIndex <= numel(target.YData)',
    'ObservationID Station QCFlag nonmissing unique', 'BrushData values 0 or 1; numel(BrushData)==numel(ObservationID)',
    'isvalid(mode); ActionPostCallback = []; UpdateFcn = []',
    'exportgraphics(fig,"plot.png"); exportapp(uiFigure,"interface.png"); ExportMode guarded by desktop',
    'Data tip unavailable fallback return',
    'R2018b release verLessThan', 'matlab -r "try run_plot; catch; exit(1); end; exit(0)"',
    "print(fig,'plot.png','-dpng','-r300'); print(fig,'plot.pdf','-dpdf')", 'isfile(plotPath); dir(plotPath).bytes',
    'artifact verified; jsonencode(manifest); figures.json',
    'missing-toolbox MATLAB_MISSING_TOOLBOX', 'Mapping Toolbox mapping', 'install license or documented scientifically equivalent method',
    'do not label ordinary axes Mercator', "license('test','Signal_Toolbox')", 'pwelch(pressure,window,overlap,nfft,sampleRateHz)',
    'Signal Processing Toolbox available licensed required', 'MATLAB_MISSING_TOOLBOX missing-toolbox',
    'R2024b SVG_PRINT_FALLBACK print -dsvg', 'exportgraphics(fig,"plot.png"); exportgraphics(fig,"plot.pdf")',
    "print(fig,'plot.svg','-dsvg')", 'PNG PDF SVG artifact bytes verified', 'manifest png pdf svg exportgraphics print sha256 bytes',
    'R2025a exportgraphics SVG native SVG', 'exportgraphics(fig,"plot.png"); exportgraphics(fig,"plot.pdf"); exportgraphics(fig,"plot.svg")',
    "exportgraphics(fig,'plot.pdf','ContentType','vector')", 'isfile plot.png plot.pdf plot.svg', 'manifest R2025a exportgraphics sha256 bytes',
    'exportgraphics(fig,"plot.png"); exportgraphics(fig,"plot.pdf")', 'dir(file).bytes imfinfo width height sha256 checksum',
    'crossFormatMetadataOk cross-format metadata', 'relative path 相对路径', 'inspectMatlabPlotQuality manifestOk artifactsOk',
    'two-dimensional 二维断面拒绝', '不能忽略输入契约；不得伪造坐标', 'original shape 40x1',
    'lower95 <= mean; mean <= upper95', 'crossed count 5; NaN missing count 2',
    'needs-input blocked uncertainty band; require corrected bounds', 'must not abs or sort uncertainty bounds',
    'abs(lower95)',
    "license('test','Signal_Toolbox') false", 'which pwelch does not prove toolbox license', 'do not invoke pwelch',
    'artifact producer GNU Octave', 'refuse manifest relabel rewrite', 'runtime matlab execution_verified true',
    'dir(pdf).bytes PDF zero empty', 'imread(png); std pixels blank white', 'do not write manifest',
    'exit code 0; artifact validation failed', 'exitCode == 0 success', 'abs(diff(longitude)) > 180', 'seamMask values NaN segment',
    'lon=sort(lon)',
    'ObservationID same index aligned joint', '[-180, 180] prewrapped',
    'parula colorblind', 'sourcePath manifestPath artifacts checksum dimensions DPI',
  ];
  return examples.find((value) => new RegExp(pattern, 'imu').test(value)) || pattern.replaceAll('\\b', '').replaceAll('\\s*', ' ').replaceAll('\\s', ' ').replaceAll('(?:', '(');
}

function candidateFor(entry) {
  const expectedRejection = entry.input.expectedOutcome === 'reject';
  const octave = entry.input.expectedRuntime === 'octave';
  const unavailable = entry.input.expectedTaskStatus === 'runtime-unavailable';
  return {
    code: entry.expectedCodeFeatures.map((item) => exampleFor(item.anyOf[0])).join('\n'),
    report: entry.expectedCodeFeatures.map((item) => exampleFor(item.anyOf[0])).join('\n'),
    runtime: entry.input.expectedRuntime,
    selectedRoute: expectedRejection ? 'rejected' : octave ? 'routed-to-octave' : entry.input.expectedRoute,
    routeError: expectedRejection ? entry.input.expectedRouteError : undefined,
    runtimeEvidence: {
      runtime: entry.input.expectedRuntime,
      status: entry.acceptanceRules.executionRequired ? 'verified' : unavailable ? 'unavailable' : octave ? 'routed' : 'static-only',
      executionVerified: entry.acceptanceRules.executionRequired === true,
      octaveVerified: false,
      matlabResultUsed: false,
      command: entry.acceptanceRules.executionRequired ? 'test-fixture-runtime-command' : undefined,
      version: entry.acceptanceRules.executionRequired ? 'test-fixture-version' : undefined,
      artifactsVerified: entry.acceptanceRules.executionRequired === true,
    },
    plotQualityResult: passingQualityResult(),
    artifactInspectionResult: entry.acceptanceRules.requiredPlotQualitySignals.length
      ? passingArtifactInspectionResult()
      : undefined,
    qualityEvidence: sharedQualityEvidence(),
  };
}

function passingQualityResult() {
  const plotQualityCriteria = Object.fromEntries(QUALITY_CRITERIA.map((name) => [name, {
    ok: true,
    status: 'pass',
    score: QUALITY_WEIGHTS[name],
    maxScore: QUALITY_WEIGHTS[name],
    evidence: ['test fixture'],
    issues: [],
  }]));
  return {
    plotQualityScore: 100,
    plotQualityScoreMax: 100,
    plotQualityGrade: 'A',
    plotQualityScoreOk: true,
    plotQualityCriteria,
    plotQualityIssues: [],
    plotQualityEvidence: Object.fromEntries(QUALITY_CRITERIA.map((name) => [name, plotQualityCriteria[name].evidence])),
  };
}

function passingArtifactInspectionResult() {
  return {
    matlabPlotQualityOk: true,
    sourceQualityOk: true,
    manifestPresent: true,
    manifestParseOk: true,
    manifestFieldsOk: true,
    manifestOk: true,
    artifactPairsOk: true,
    artifactsOk: true,
    crossFormatMetadataOk: true,
    pngArtifactsOk: true,
    pdfArtifactsOk: true,
    artifacts: ['png', 'pdf'].map((format) => ({
      format,
      ok: true,
      present: true,
      bytes: 12_000,
      dimensionsOk: true,
      bytesOk: true,
      checksumOk: true,
      dpiOk: true,
      textOk: true,
    })),
  };
}
