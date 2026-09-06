import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const SECRET = 'synthetic-report-status-http-secret-not-production';
const OWNER = 'synthetic-report-owner';
const REPORT_ID = 'synthetic-report-status';
const FIXTURES = new URL('./test-fixtures/', import.meta.url);

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function createHarness(context) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'report-status-http-'));
  const workspace = path.join(root, 'workspace');
  const home = path.join(root, 'home');
  const bin = path.join(root, 'bin');
  for (const directory of [workspace, home, bin]) mkdirSync(directory);
  const fakeCodex = path.join(bin, 'codex');
  copyFileSync(new URL('report-status-fake-codex.cjs', FIXTURES), fakeCodex);
  chmodSync(fakeCodex, 0o755);
  symlinkSync(process.execPath, path.join(bin, 'node'));
  const readsPath = path.join(root, 'evidence-reads.jsonl');
  const protocolPath = path.join(root, 'fake-protocol.jsonl');
  writeFileSync(readsPath, '');
  let child;
  let closed;
  let baseUrl;

  async function stop() {
    if (!child?.pid) return;
    const pid = child.pid;
    const killGroup = (signal) => {
      try { process.kill(-pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    killGroup('SIGTERM');
    const timeout = setTimeout(() => killGroup('SIGKILL'), 5000);
    try { await closed; } finally {
      clearTimeout(timeout);
      killGroup('SIGKILL');
    }
  }

  context.after(async () => {
    await stop();
    rmSync(root, { recursive: true, force: true });
  });

  async function start() {
    const port = await availablePort();
    assert.notEqual(port, 8011);
    baseUrl = `http://127.0.0.1:${port}/api/codex-runtime/`;
    child = spawn(process.execPath, [
      '--import', new URL('report-status-guards.mjs', FIXTURES).href,
      fileURLToPath(new URL('./index.mjs', import.meta.url)),
    ], {
      cwd: workspace,
      detached: true,
      env: {
        PATH: bin, HOME: home, CODEX_HOME: home, CODEX_SQLITE_HOME: path.join(home, 'sqlite'), TZ: 'UTC',
        OCEAN_CODEX_BIN: fakeCodex, OCEAN_CODEX_HOST: '127.0.0.1', OCEAN_CODEX_PORT: String(port),
        OCEAN_CODEX_TENANT_SECRET: SECRET, OCEAN_CODEX_WORKSPACE: workspace,
        REPORT_STATUS_FAKE_ROOT: root,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    closed = new Promise((resolve) => child.once('close', resolve));
    await new Promise((resolve, reject) => {
      let stdout = '', stderr = '';
      const timeout = setTimeout(() => reject(new Error(`Synthetic HTTP startup timeout: ${stderr}`)), 10000);
      child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        const newline = stdout.indexOf('\n');
        if (newline < 0) return;
        clearTimeout(timeout);
        try {
          const ready = JSON.parse(stdout.slice(0, newline));
          assert.equal(ready.ready, true, stderr);
          assert.equal(ready.executablePath, fakeCodex);
          assert.match(ready.appServer, /report-status-fake-app-server/u);
          resolve();
        } catch (error) { reject(error); }
      });
      child.once('error', (error) => { clearTimeout(timeout); reject(error); });
      child.once('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`Synthetic HTTP server exited (${code}): ${stderr}`));
      });
    });
  }

  async function request(method, route, body, owner = OWNER) {
    const url = new URL(route, baseUrl);
    const runtimePath = url.pathname.replace(/^\/api\/codex-runtime\/?/u, '');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', SECRET).update(`${owner}\n${method}\n${runtimePath}\n${timestamp}`).digest('hex');
    const response = await fetch(url, {
      method, headers: { 'content-type': 'application/json', 'x-ocean-codex-user': owner,
        'x-ocean-codex-timestamp': timestamp, 'x-ocean-codex-signature': signature },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000),
    });
    return { status: response.status, body: await response.json() };
  }

  function generatedRoot(owner = OWNER) {
    const key = createHash('sha256').update(owner).digest('hex').slice(0, 32);
    return path.join(workspace, '.runtime', 'codex-users', key, 'generated');
  }

  function protocol() {
    return existsSync(protocolPath) ? readFileSync(protocolPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  }

  async function thread(owner = OWNER) {
    const result = await request('POST', 'threads', { regionId: 'synthetic-test-sea' }, owner);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.match(result.body.thread.id, /^http-fixture-thread-/u);
    return result.body.thread.id;
  }

  const turn = (threadId, options = {}) => request('POST', `threads/${threadId}/turns`, {
    text: 'Synthetic HTTP contract test only. Do not generate report artifacts or contact a model.',
    outputMode: 'illustrated_report', reportId: REPORT_ID, ...options,
  });
  const status = (threadId, query = '') => request('GET', `reports/status?threadId=${threadId}&reportId=${REPORT_ID}${query}`);
  await start();
  return { root, workspace, generatedRoot, request, thread, turn, status, protocol, stop, start,
    clearReads: () => writeFileSync(readsPath, ''),
    reads: () => readFileSync(readsPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) };
}

test('synthetic HTTP harness uses fake JSON protocol and keeps ordinary conversation compatible', async (context) => {
  const harness = await createHarness(context);
  const threadId = await harness.thread();
  const result = await harness.turn(threadId, { outputMode: 'conversation', reportRuntime: 'octave' });
  assert.equal(result.status, 202, JSON.stringify(result.body));
  assert.equal(result.body.report, undefined);
  const calls = harness.protocol();
  assert.ok(calls.some((entry) => entry.method === 'initialize'));
  assert.deepEqual(calls.filter((entry) => entry.method.startsWith('mcp')).map((entry) => entry.method), ['mcpServerStatus/list']);
  const turns = calls.filter((entry) => entry.method === 'turn/start');
  assert.equal(turns.length, 1);
  assert.doesNotMatch(turns[0].params.input[0].text, /MANDATORY ILLUSTRATED REPORT CONTRACT/u);
  assert.deepEqual(readdirSync(harness.generatedRoot()), []);
});

test('synthetic HTTP rejects unowned status before any generated evidence inspection', async (context) => {
  const harness = await createHarness(context);
  const threadId = await harness.thread();
  harness.clearReads();
  const result = await harness.request('GET', `reports/status?threadId=${threadId}&reportId=${REPORT_ID}`, undefined, 'other-synthetic-owner');
  assert.equal(result.status, 404);
  assert.equal(result.body.error.code, 'CODEX_THREAD_NOT_FOUND');
  assert.deepEqual(harness.reads(), []);
});

test('synthetic HTTP rejects invalid report ids before any generated evidence inspection', async (context) => {
  const harness = await createHarness(context);
  const threadId = await harness.thread();
  for (const reportId of ['', 'short', '../outside']) {
    harness.clearReads();
    const result = await harness.request('GET', `reports/status?threadId=${threadId}&reportId=${encodeURIComponent(reportId)}`);
    assert.equal(result.status, 400, JSON.stringify({ reportId, body: result.body }));
    assert.equal(result.body.error.code, 'CODEX_REPORT_ID_INVALID');
    assert.deepEqual(harness.reads(), []);
  }
});

function policyState(harness) {
  return JSON.parse(readFileSync(path.join(harness.workspace, '.runtime', 'codex-report-policies.json'), 'utf8'));
}

function assertEvidenceFailed(result, codes) {
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const body = result.body;
  assert.equal(body.complete, false);
  assert.equal(body.reportEvidenceQuality?.ok, false, JSON.stringify(body.reportEvidenceQuality));
  assert.ok(body.reportEvidenceQuality.violations.every((code) => typeof code === 'string' && code.length > 0));
  for (const code of codes) {
    assert.ok(body.reportEvidenceQuality.violations.includes(code), JSON.stringify(body.reportEvidenceQuality.violations));
    assert.ok(body.missingPaths.some((entry) => entry.includes(code)), JSON.stringify(body.missingPaths));
  }
  assert.deepEqual(body.matlabPlotQuality, body.reportEvidenceQuality.matlabPlotQuality);
  assert.deepEqual(body.pointInteractionQualities, body.reportEvidenceQuality.pointInteractionQualities);
  assert.deepEqual(body.illustratedReportEvidence, body.reportEvidenceQuality.illustratedReportEvidence);
  return body;
}

function assertLegacyReaderSkipped(harness, body) {
  assert.equal(body.quality, null);
  assert.equal(body.qualityInspected, false);
  assert.equal(body.visualCount, null);
  for (const extension of ['html', 'md']) {
    assert.ok(body.missingPaths.includes(`generated/${REPORT_ID}.${extension}`));
    assert.ok(!harness.reads().some((entry) => entry.operation === 'readFileSync'
      && entry.relative.endsWith(`/generated/${REPORT_ID}.${extension}`)), JSON.stringify(harness.reads()));
  }
}

function writeIncompleteSyntheticReport(harness) {
  const directory = harness.generatedRoot();
  writeFileSync(path.join(directory, `${REPORT_ID}.html`), '<!doctype html><html><body><p>Synthetic HTTP fixture, not a rendered scientific report.</p></body></html>');
  writeFileSync(path.join(directory, `${REPORT_ID}.md`), '# Synthetic HTTP fixture\nNo native MATLAB or visual evidence is asserted.');
  writeFileSync(path.join(directory, `${REPORT_ID}-figures.json`), JSON.stringify({
    schema_version: 2, generated_at: new Date().toISOString(), generator: 'synthetic HTTP fixture only', figures: [],
  }));
}

test('synthetic HTTP commits one policy before turn/start and permits identical binding retries', async (context) => {
  const harness = await createHarness(context);
  const threadId = await harness.thread();
  const first = await harness.turn(threadId);
  assert.equal(first.status, 202, JSON.stringify(first.body));
  assert.equal(first.body.report.id, REPORT_ID);
  assert.equal(first.body.report.evidenceProfile, 'matlab-illustrated-v1');
  assert.equal(first.body.report.manifestPath, `generated/${REPORT_ID}-figures.json`);
  const committed = policyState(harness);
  assert.equal(committed.bindings.length, 1);
  assert.deepEqual(committed.bindings[0], {
    tenantKey: createHash('sha256').update(OWNER).digest('hex').slice(0, 32),
    threadId, reportId: REPORT_ID, profile: 'matlab-illustrated-v1', schemaVersion: 1, createdAt: committed.bindings[0].createdAt,
  });
  const retry = await harness.turn(threadId, { reportRuntime: 'matlab' });
  assert.equal(retry.status, 202, JSON.stringify(retry.body));
  assert.deepEqual(policyState(harness), committed);
  const turns = harness.protocol().filter((entry) => entry.method === 'turn/start');
  assert.equal(turns.length, 2);
  for (const turn of turns) {
    assert.deepEqual(turn.policyBindings, committed.bindings);
    assert.ok(turn.params.input[0].text.includes(path.join(harness.generatedRoot(), `${REPORT_ID}-figures.json`)));
    assert.match(turn.params.input[0].text, /matlab-illustrated-v1/u);
  }
});

test('synthetic HTTP rejects another thread binding or reading an existing report before evidence reads', async (context) => {
  const harness = await createHarness(context);
  const firstThread = await harness.thread();
  const secondThread = await harness.thread();
  assert.equal((await harness.turn(firstThread)).status, 202);
  const committed = policyState(harness);
  harness.clearReads();
  const conflict = await harness.turn(secondThread);
  assert.equal(conflict.status, 409, JSON.stringify(conflict.body));
  assert.equal(conflict.body.error.code, 'CODEX_REPORT_POLICY_CONFLICT');
  assert.deepEqual(harness.reads(), []);
  assert.equal(harness.protocol().filter((entry) => entry.method === 'turn/start').length, 1);
  harness.clearReads();
  const hidden = await harness.status(secondThread);
  assert.equal(hidden.status, 404, JSON.stringify(hidden.body));
  assert.equal(hidden.body.error.code, 'CODEX_REPORT_POLICY_NOT_FOUND');
  assert.deepEqual(harness.reads(), []);
  assert.deepEqual(policyState(harness), committed);
});

test('synthetic HTTP retains the report policy across an isolated service restart', async (context) => {
  const harness = await createHarness(context);
  const threadId = await harness.thread();
  assert.equal((await harness.turn(threadId)).status, 202);
  const committed = policyState(harness);
  const before = assertEvidenceFailed(await harness.status(threadId), ['report-illustrated-evidence-failed']);
  assert.ok(!before.reportEvidenceQuality.violations.includes('report-policy-missing'));
  await harness.stop();
  await harness.start();
  const after = assertEvidenceFailed(await harness.status(threadId), ['report-illustrated-evidence-failed']);
  assert.deepEqual(after.reportEvidenceQuality.violations, before.reportEvidenceQuality.violations);
  assert.deepEqual(policyState(harness), committed);
  assert.equal((await harness.turn(threadId)).status, 202);
  assert.deepEqual(policyState(harness), committed);
  const other = await harness.thread();
  assert.equal((await harness.turn(other)).status, 409);
});

test('synthetic HTTP reports specific evidence failures with no manifest and no MATLAB source', async (context) => {
  const harness = await createHarness(context);
  const threadId = await harness.thread();
  assert.equal((await harness.turn(threadId)).status, 202);
  assert.deepEqual(readdirSync(harness.generatedRoot()), []);
  harness.clearReads();
  const body = assertEvidenceFailed(await harness.status(threadId), [
    'report-illustrated-evidence-failed', 'report-matlab-sources-missing',
    'report-matlab-plot-quality-failed', 'report-point-interaction-missing',
  ]);
  assert.equal(body.illustratedReportEvidence.manifestOk, false);
  assert.equal(body.illustratedReportEvidence.pathsOk, false);
  assert.equal(body.matlabPlotQuality.matlabPlotQualityOk, false);
  assertLegacyReaderSkipped(harness, body);
});

test('synthetic HTTP runtime query parameters cannot downgrade a bound MATLAB report', async (context) => {
  const harness = await createHarness(context);
  const threadId = await harness.thread();
  assert.equal((await harness.turn(threadId)).status, 202);
  const baseline = assertEvidenceFailed(await harness.status(threadId), ['report-matlab-sources-missing']);
  for (const query of ['&runtime=octave', '&reportRuntime=octave', '&runtime=conversation', '&policy=none&profile=none']) {
    harness.clearReads();
    const body = assertEvidenceFailed(await harness.status(threadId, query), ['report-matlab-sources-missing']);
    assert.deepEqual(body.reportEvidenceQuality.violations, baseline.reportEvidenceQuality.violations);
    assertLegacyReaderSkipped(harness, body);
  }
  assert.equal(policyState(harness).bindings[0].profile, 'matlab-illustrated-v1');
});

test('synthetic HTTP does not borrow the generic manifest or another report MATLAB source', async (context) => {
  const harness = await createHarness(context);
  const threadId = await harness.thread();
  assert.equal((await harness.turn(threadId)).status, 202);
  const directory = harness.generatedRoot();
  writeFileSync(path.join(directory, `${REPORT_ID}.html`), '<!doctype html><p>Synthetic incomplete report</p>');
  writeFileSync(path.join(directory, `${REPORT_ID}.md`), '# Synthetic incomplete report');
  writeFileSync(path.join(directory, 'figures.json'), JSON.stringify({ schema_version: 2, figures: [] }));
  writeFileSync(path.join(directory, 'other-report-source.m'), 'disp("Synthetic source, never executed");\n');
  harness.clearReads();
  const body = assertEvidenceFailed(await harness.status(threadId), ['report-illustrated-evidence-failed', 'report-matlab-sources-missing']);
  assert.equal(body.illustratedReportEvidence.manifestOk, false);
  assert.deepEqual(body.matlabPlotQuality.sourcePaths, []);
  assertLegacyReaderSkipped(harness, body);
  assert.ok(!harness.reads().some((entry) => /\/(?:figures\.json|other-report-source\.m)$/u.test(entry.relative)), JSON.stringify(harness.reads()));
});

test('synthetic HTTP binds callable MATLAB basenames inside the fixed report source directory', async (context) => {
  const harness = await createHarness(context);
  const threadId = await harness.thread();
  assert.equal((await harness.turn(threadId)).status, 202);
  writeIncompleteSyntheticReport(harness);
  const directory = harness.generatedRoot();
  const sourceDirectory = path.join(directory, `${REPORT_ID}-matlab`);
  mkdirSync(sourceDirectory);
  const sourcePath = path.join(sourceDirectory, 'ocean_trial.m');
  writeFileSync(sourcePath, 'function result = ocean_trial()\nresult = [];\nend\n');
  const foreignDirectory = path.join(directory, 'another-report-matlab');
  mkdirSync(foreignDirectory);
  writeFileSync(path.join(foreignDirectory, 'foreign_trial.m'), 'function result = foreign_trial()\nresult = [];\nend\n');
  harness.clearReads();
  const body = assertEvidenceFailed(await harness.status(threadId,
    '&sourceDirectory=another-report-matlab&sourcePaths=another-report-matlab/foreign_trial.m'),
  ['report-illustrated-evidence-failed']);
  assert.ok(!body.reportEvidenceQuality.violations.includes('report-matlab-sources-missing'));
  assert.equal(body.illustratedReportEvidence.pathsOk, true);
  assert.equal(body.matlabPlotQuality.sourceFilesPresent, true);
  assert.ok(harness.reads().some((entry) => entry.relative.endsWith(
    `/generated/${REPORT_ID}-matlab/ocean_trial.m`)));
  assert.ok(!harness.reads().some((entry) => entry.relative.includes('another-report-matlab')));
  assert.equal(body.complete, false);
});

test('synthetic HTTP reports missing historical policy without reading generated evidence or legacy prose', async (context) => {
  const harness = await createHarness(context);
  const threadId = await harness.thread();
  writeIncompleteSyntheticReport(harness);
  harness.clearReads();
  const body = assertEvidenceFailed(await harness.status(threadId, '&runtime=octave'), ['report-policy-missing']);
  assert.equal(body.illustratedReportEvidence.pathsOk, false);
  assert.equal(body.illustratedReportEvidence.skipped, true);
  assert.equal(body.illustratedReportEvidence.reason, 'report-policy-not-verified');
  assert.deepEqual(body.illustratedReportEvidence.artifactChecks, []);
  assert.equal(body.matlabPlotQuality.skipped, true);
  assert.equal(body.matlabPlotQuality.reason, 'report-policy-not-verified');
  assert.deepEqual(body.pointInteractionQualities, []);
  assert.deepEqual(harness.reads(), []);
  assertLegacyReaderSkipped(harness, body);
  assert.ok(!existsSync(path.join(harness.workspace, '.runtime', 'codex-report-policies.json')));
});

test('synthetic HTTP inspects legacy prose when paths are valid while retaining scientific failures', async (context) => {
  const harness = await createHarness(context);
  const threadId = await harness.thread();
  assert.equal((await harness.turn(threadId)).status, 202);
  writeIncompleteSyntheticReport(harness);
  harness.clearReads();
  const body = assertEvidenceFailed(await harness.status(threadId), ['report-illustrated-evidence-failed', 'report-matlab-sources-missing']);
  assert.equal(body.illustratedReportEvidence.pathsOk, true);
  assert.equal(body.qualityInspected, true);
  assert.equal(typeof body.quality, 'object');
  assert.notEqual(body.quality, null);
  assert.equal(body.visualCount, 0);
  for (const extension of ['html', 'md']) {
    assert.ok(harness.reads().some((entry) => entry.operation === 'readFileSync'
      && entry.relative.endsWith(`/generated/${REPORT_ID}.${extension}`)), JSON.stringify(harness.reads()));
  }
});

test('synthetic HTTP rejects explicit non-MATLAB report runtimes without creating a policy or turn', async (context) => {
  const harness = await createHarness(context);
  const threadId = await harness.thread();
  for (const reportRuntime of ['octave', 'unknown', '', null, false]) {
    const result = await harness.turn(threadId, { reportRuntime });
    assert.equal(result.status, 400, JSON.stringify({ reportRuntime, body: result.body }));
    assert.equal(result.body.error.code, 'CODEX_REPORT_PROFILE_UNSUPPORTED');
  }
  assert.equal(harness.protocol().filter((entry) => entry.method === 'turn/start').length, 0);
  assert.ok(!existsSync(path.join(harness.workspace, '.runtime', 'codex-report-policies.json')));
  assert.equal((await harness.turn(threadId, { reportRuntime: 'matlab' })).status, 202);
});
