import assert from 'node:assert/strict';
import test from 'node:test';

import { routeMatlabPlot } from './matlab-plot-router.mjs';
import {
  buildMatlabRuntimeCiMatrix,
  selectMatlabRuntimeValidationLane,
} from './matlab-release-capabilities.mjs';
import { routeMatlabRuntimeRequest } from './matlab-runtime-route-service.mjs';

test('selects exact audited MATLAB lanes for R2021a, R2024b and R2026a', () => {
  const matrix = buildMatlabRuntimeCiMatrix();
  assert.deepEqual(matrix.jobs.map((job) => job.targetRelease), ['R2021a', 'R2024b', 'R2026a']);
  for (const release of ['R2021a', 'R2024b', 'R2026a']) {
    const selection = selectMatlabRuntimeValidationLane(release);
    assert.equal(selection.status, 'exact');
    assert.equal(selection.lane.targetRelease, release);
    assert.equal(selection.lane.exactReleaseRequired, true);
  }
});

test('marks non-exact releases as compatibility evidence rather than verified evidence', () => {
  const selection = selectMatlabRuntimeValidationLane('R2025a');
  assert.equal(selection.status, 'compatibility-baseline');
  assert.equal(selection.targetRelease, 'R2025a');
  assert.equal(selection.lane.targetRelease, 'R2024b');
  assert.match(selection.limitation, /not exact/u);

  const route = routeMatlabPlot({
    runtime: 'matlab', targetRelease: 'R2025a', question: 'profile', dimensions: [8],
    dimensionOrder: ['depth'], observationDimension: 'depth', coordinates: ['depth'],
    verticalCoordinate: 'depth', verticalPositive: 'down', verticalReference: 'mean sea level',
    missing: false, qcStatus: 'absent', uncertaintyStatus: 'absent',
    units: { depth: 'm', value: 'degC' }, quantities: { depth: 'Depth', value: 'Temperature' },
    title: 'Profile', source: 'verified fixture', outputFormats: ['png', 'pdf'],
  });
  assert.equal(route.apiPlan.runtimeValidation.status, 'compatibility-baseline');
  assert.equal(route.apiPlan.runtimeValidation.lane.targetRelease, 'R2024b');
});

test('runtime service reports exact MATLAB validation requirements without accepting Octave evidence', () => {
  const route = routeMatlabRuntimeRequest({
    runtime: 'matlab', taskType: 'export', targetRelease: 'R2024b', matlabAvailable: true,
    outputFormats: ['png', 'pdf'], manifestContract: { path: 'artifacts/figures.json' },
  });
  assert.equal(route.status, 'ready');
  assert.equal(route.runtimeReport.status, 'ready-for-runtime-validation');
  assert.equal(route.runtimeReport.authoritativeRuntime, 'mathworks-matlab');
  assert.equal(route.runtimeReport.octaveAcceptedAsMatlabEvidence, false);
  assert.equal(route.runtimeReport.validationLane.status, 'exact');
  assert.equal(route.runtimeReport.validationLane.lane.targetRelease, 'R2024b');
  assert.ok(route.runtimeReport.evidenceRequired.some((item) => /PNG\/PDF/u.test(item)));

  const rejected = routeMatlabRuntimeRequest({ runtime: 'octave', taskType: 'create' });
  assert.notEqual(rejected.status, 'ready');
  assert.equal(rejected.runtimeReport.octaveAcceptedAsMatlabEvidence, false);
  assert.ok(rejected.runtimeReport.failures.some((failure) => /Octave|octave/u.test(failure.reason)));
});

test('runtime service blocks invalid production releases instead of silently falling back', () => {
  const route = routeMatlabRuntimeRequest({
    runtime: 'matlab', taskType: 'export', targetRelease: 'R2024b', productionRelease: 'R2099a',
    matlabAvailable: true, outputFormats: ['png'],
  });
  assert.equal(route.status, 'needs-input');
  assert.equal(route.ready, false);
  assert.equal(route.script, null);
  assert.equal(route.runtimeCiMatrix, null);
  assert.equal(route.error.code, 'MATLAB_CI_RELEASE_INVALID');
  assert.equal(route.runtimeReport.status, 'blocked');
  assert.ok(route.runtimeReport.failures.some((failure) => failure.code === 'MATLAB_CI_RELEASE_INVALID'));
});

test('runtime service exposes unresolved plot requirements as structured failure evidence', () => {
  const route = routeMatlabRuntimeRequest({
    runtime: 'matlab', taskType: 'create', targetRelease: 'R2024b', matlabAvailable: true,
    requireScientificContract: true,
    plotInput: { question: 'trend', dimensions: [12], coordinates: ['time'] },
  });
  assert.equal(route.status, 'needs-input');
  assert.equal(route.runtimeReport.status, 'blocked');
  assert.ok(route.runtimeReport.failures.some((failure) => failure.code === 'MATLAB_PLOT_REQUIREMENT_UNRESOLVED'));
  assert.ok(route.runtimeReport.failures.some((failure) => /timeZone/u.test(failure.reason)));
});
