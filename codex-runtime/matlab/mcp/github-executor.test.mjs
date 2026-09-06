import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import test from 'node:test';
import { createMatlabExecutor } from './github-executor.mjs';

const REPO = 'wzn1118/ocean-intelligence';
const COMMIT = 'a'.repeat(40);
const REQUEST = '12345678-1234-4123-8123-123456789012';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const CODE = 'disp("native MATLAB");';

function zip(files) {
  const script = 'import base64,io,json,sys,zipfile\noutput=io.BytesIO()\nwith zipfile.ZipFile(output,"w",zipfile.ZIP_STORED) as archive:\n for name,content in json.load(sys.stdin).items(): archive.writestr(name,base64.b64decode(content))\nsys.stdout.buffer.write(output.getvalue())';
  const result = spawnSync('python3', ['-B', '-c', script], {
    input: JSON.stringify(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, Buffer.from(content).toString('base64')]))),
    maxBuffer: 40 * 1024 * 1024,
  });
  assert.equal(result.status, 0, 'Fixture ZIP generation must succeed');
  return result.stdout;
}

async function fixture(context) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matlab-executor-test-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const stateDirectory = path.join(root, 'state');
  const calls = [];
  const state = { run: null, extraRuns: [], jobs: null, archive: null, artifact: {}, override: null, dispatchError: null };
  const processAdapter = (executable, args, options, callback) => {
    if (executable === 'python3') return execFile(executable, args, options, callback);
    assert.equal(executable, 'gh');
    const chunks = [];
    const stdin = new Writable({ write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
    stdin.on('finish', () => {
      const input = Buffer.concat(chunks).toString();
      calls.push({ executable, args, options, input });
      const route = args[3];
      try {
        let response;
        if (state.override) response = state.override(route, input);
        if (response === undefined) {
          if (route.endsWith('/dispatches')) {
            state.payload = JSON.parse(input);
            if (state.dispatchError) throw state.dispatchError;
            response = '';
          } else if (route.endsWith('/workflows/matlab-execute.yml')) {
            response = { id: 42, path: '.github/workflows/matlab-execute.yml', state: 'active' };
          } else if (route.includes('/commits/')) {
            response = { sha: COMMIT };
          } else if (route.includes('/workflows/42/runs?')) {
            const runs = [...(state.run ? [state.run] : []), ...state.extraRuns];
            response = { total_count: runs.length, workflow_runs: runs };
          } else if (/\/actions\/runs\/\d+$/.test(route)) {
            response = state.run;
          } else if (route.includes('/jobs?')) {
            const jobs = state.jobs ?? [];
            response = { total_count: jobs.length, jobs };
          } else if (route.includes('/artifacts?')) {
            response = { total_count: 1, artifacts: [{ id: 222,
              name: `matlab-execution-${state.payload.inputs.request_id}`, expired: false,
              size_in_bytes: state.archive?.length ?? 1, workflow_run: { id: 901, head_sha: COMMIT }, ...state.artifact }] };
          } else if (route.endsWith('/artifacts/222/zip')) {
            response = state.archive;
          } else {
            throw new Error(`Unhandled mock API ${route}`);
          }
        }
        callback(null, Buffer.isBuffer(response) ? response : Buffer.from(typeof response === 'string' ? response : JSON.stringify(response)), Buffer.alloc(0));
      } catch (error) {
        callback(error, Buffer.from('PRIVATE-CODE'), Buffer.from('SECRET-CREDENTIAL (HTTP 429)'));
      }
    });
    return { stdin };
  };
  const factory = () => createMatlabExecutor({ stateDirectory, execFile: processAdapter });
  const executor = factory();
  async function submit(arguments_ = { code: CODE }) {
    const submitted = await executor.execute(arguments_);
    state.run = { id: 901, workflow_id: 42, path: '.github/workflows/matlab-execute.yml',
      event: 'workflow_dispatch', display_title: `MATLAB Execute ${submitted.request_id}`,
      repository: { full_name: REPO }, head_repository: { full_name: REPO },
      head_branch: 'main', head_sha: COMMIT, run_attempt: 1, status: 'completed', conclusion: 'success' };
    state.jobs = [{ id: 333, run_id: 901, run_attempt: 1, name: 'execute', status: 'completed', conclusion: 'success',
      steps: [{ name: 'Execute MATLAB request', status: 'completed', conclusion: 'success' }] }];
    return submitted;
  }
  function bundle(change = () => {}) {
    const inputs = state.payload.inputs;
    const code = Buffer.from(inputs.code_base64, 'base64');
    const input = Buffer.from(inputs.input_json_base64, 'base64');
    const metadata = { request_id: inputs.request_id, requested_release: inputs.release,
      code_sha256: inputs.code_sha256, code_bytes: code.length,
      input_provided: input.length > 0, input_sha256: input.length ? hash(input) : '', input_bytes: input.length,
      ci_run_id: '901', run_attempt: '1', commit: COMMIT };
    const files = { 'diary.log': 'native log', 'code.m': code, 'outputs/request_code.m': code, 'outputs/result.json': '{"answer":42}' };
    if (input.length) Object.assign(files, { 'input.json': input, 'outputs/input.json': input });
    files['request.json'] = JSON.stringify(metadata);
    const receipt = { schema_version: 1, request_id: inputs.request_id,
      code_sha256: inputs.code_sha256, requested_release: inputs.release, matlab_release: inputs.release,
      ci_run_id: '901', run_attempt: '1', commit: COMMIT, status: 'succeeded',
      matlab_started: true, code_started: true, code_completed: true, matlab_step_outcome: 'success',
      matlab_version: '26.1 test fixture', started_at: '2026-09-06T03:00:00Z', finished_at: '2026-09-06T03:00:01Z',
      analysis_verified: false, visual_verified: false,
      artifacts: Object.entries(files).map(([file, content]) => ({ file, bytes: Buffer.byteLength(content), sha256: hash(content) })) };
    change({ receipt, files, metadata });
    files['execution.json'] = JSON.stringify(receipt);
    state.archive = zip(files);
    return { receipt, files };
  }
  return { executor, factory, state, calls, root, stateDirectory, submit, bundle };
}

test('execute sends exact UTF-8 bytes through stdin only and persists a private reloadable binding', async (context) => {
  const fixture_ = await fixture(context);
  const code = 'disp("真实 MATLAB");';
  const submitted = await fixture_.submit({ code, input_json: '{"salinity":[35,36]}' });
  assert.deepEqual(Object.keys(submitted).sort(), ['code_sha256', 'commit', 'native_verified', 'release', 'request_id', 'status']);
  assert.equal(submitted.status, 'submitted_native_pending');
  assert.equal(submitted.native_verified, false);
  assert.equal(submitted.release, 'R2026a');
  assert.equal(submitted.commit, COMMIT);
  assert.equal(submitted.code_sha256, hash(code));
  const dispatch = fixture_.calls.find((call) => call.args.includes('POST'));
  assert.equal(dispatch.options.shell, false);
  assert.ok(dispatch.args.includes('--input'));
  assert.ok(!dispatch.args.join(' ').includes(code));
  assert.deepEqual(Buffer.from(fixture_.state.payload.inputs.code_base64, 'base64'), Buffer.from(code));
  assert.equal(fixture_.state.payload.inputs.release, 'R2026a');
  const filename = path.join(fixture_.stateDirectory, 'requests', `${submitted.request_id}.json`);
  assert.equal((await fs.stat(filename)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(fixture_.stateDirectory)).mode & 0o777, 0o700);
  assert.ok(!(await fs.readFile(filename, 'utf8')).includes(code));
  const status = await fixture_.factory().status({ request_id: submitted.request_id });
  assert.equal(status.run_id, 901);
  assert.equal(status.native_verified, false);
  assert.equal(status.status, 'completed_native_unverified');
  assert.equal(status.jobs[0].matlab_steps[0].conclusion, 'success');
});

test('invalid input and combined dispatch-size overflow fail before any gh calls', async (context) => {
  const { executor, calls } = await fixture(context);
  const invalid = [{}, { code: '' }, { code: false }, { code: '\ud800' }, { code: '\0' },
    { code: '中'.repeat(10923) }, { code: CODE, release: 'Octave' }, { code: CODE, release: null },
    ...['', 'NaN', '{"number":1e400}', '{"text":"\\ud800"}', '"' + 'x'.repeat(16384) + '"']
      .map((input_json) => ({ code: CODE, input_json })),
    { code: 'x'.repeat(32768), input_json: '"' + 'x'.repeat(16382) + '"' },
    { code: CODE, output_directory: '/tmp' }];
  for (const arguments_ of invalid) {
    await assert.rejects(executor.execute(arguments_), { code: 'MATLAB_INVALID_INPUT' });
  }
  assert.equal(calls.length, 0);
});

test('all release choices and finite JSON scalars are accepted', async (context) => {
  const { executor, state } = await fixture(context);
  for (const [release, input_json] of [['R2021a', 'null'], ['R2024b', 'false'], ['R2026a', '0']]) {
    await executor.execute({ code: CODE, release, input_json });
    assert.equal(state.payload.inputs.release, release);
    assert.equal(Buffer.from(state.payload.inputs.input_json_base64, 'base64').toString(), input_json);
  }
});

test('unknown requests and unsafe output/run arguments never access GitHub', async (context) => {
  const { executor, calls } = await fixture(context);
  await assert.rejects(executor.status({ request_id: REQUEST }), { code: 'MATLAB_REQUEST_NOT_FOUND' });
  for (const arguments_ of [{ request_id: '../../escape' }, { request_id: REQUEST, run_id: 0 },
    { request_id: REQUEST, run_id: '901' }, { request_id: REQUEST, output_directory: '/tmp/escape' }]) {
    await assert.rejects(executor.artifacts(arguments_), { code: 'MATLAB_INVALID_INPUT' });
  }
  assert.equal(calls.length, 0);
});

test('no matching run remains pending and never selects latest unrelated run', async (context) => {
  const fixture_ = await fixture(context);
  const submitted = await fixture_.submit();
  fixture_.state.run.display_title = 'MATLAB Execute different-request';
  const status = await fixture_.executor.status({ request_id: submitted.request_id });
  assert.equal(status.status, 'submitted_native_pending');
  assert.equal(status.native_verified, false);
  assert.ok(!fixture_.calls.some((call) => /\/actions\/runs\/901$/.test(call.args[3])));
});

test('explicit run IDs must match every workflow/repo/ref/commit/request field', async (context) => {
  const fixture_ = await fixture(context);
  const submitted = await fixture_.submit();
  const original = structuredClone(fixture_.state.run);
  for (const mutation of [{ id: 902 }, { workflow_id: 43 }, { path: '.github/workflows/other.yml' },
    { event: 'push' }, { display_title: 'MATLAB Execute fake' }, { head_branch: 'other' },
    { head_sha: 'b'.repeat(40) }, { repository: { full_name: 'other/repo' } },
    { head_repository: { full_name: 'fork/repo' } }, { run_attempt: 0 }]) {
    fixture_.state.run = { ...original, ...mutation };
    await assert.rejects(fixture_.executor.status({ request_id: submitted.request_id, run_id: 901 }), { code: 'MATLAB_RUN_MISMATCH' });
  }
  fixture_.state.run = original;
  await fixture_.executor.status({ request_id: submitted.request_id, run_id: 901 });
  await assert.rejects(fixture_.executor.status({ request_id: submitted.request_id, run_id: 902 }), { code: 'MATLAB_RUN_MISMATCH' });
});

test('duplicate exact request titles fail closed instead of choosing a newer run', async (context) => {
  const fixture_ = await fixture(context);
  const submitted = await fixture_.submit();
  fixture_.state.extraRuns = [{ ...fixture_.state.run, id: 902 }];
  await assert.rejects(fixture_.executor.status({ request_id: submitted.request_id }), { code: 'MATLAB_RUN_AMBIGUOUS' });
});

test('artifacts without run_id safely extract and verify all bindings before native success', async (context) => {
  const fixture_ = await fixture(context);
  const submitted = await fixture_.submit({ code: CODE, input_json: '{"values":[1,2,3]}' });
  fixture_.bundle();
  const evidence = await fixture_.executor.artifacts({ request_id: submitted.request_id });
  assert.equal(evidence.status, 'native_verified');
  assert.equal(evidence.native_verified, true);
  assert.equal(evidence.analysis_verified, false);
  assert.equal(evidence.visual_verified, false);
  assert.ok(evidence.artifacts.some((item) => item.file === 'request.json'));
  assert.ok(evidence.directory.startsWith(path.join(fixture_.stateDirectory, 'downloads') + path.sep));
  assert.equal((await fs.stat(evidence.artifacts[0].path)).mode & 0o777, 0o600);
  assert.equal((await fs.readFile(evidence.receipt_path, 'utf8')).includes(submitted.request_id), true);
  const reload = await fixture_.factory().status({ request_id: submitted.request_id });
  assert.equal(reload.native_verified, true);
  assert.equal(reload.directory, evidence.directory);
  await fixture_.factory().artifacts({ request_id: submitted.request_id });
  assert.equal(fixture_.calls.filter((call) => call.args[3].endsWith('/zip')).length, 1);
  assert.ok(fixture_.calls.every((call) => !call.args.includes('download')));
});

test('failed MATLAB jobs retain verified diagnostics but never claim native success', async (context) => {
  const fixture_ = await fixture(context);
  const submitted = await fixture_.submit();
  fixture_.state.run.conclusion = 'failure';
  fixture_.state.jobs[0].conclusion = 'failure';
  fixture_.state.jobs[0].steps[0].conclusion = 'failure';
  fixture_.bundle(({ receipt }) => { receipt.status = 'failed'; receipt.code_completed = false; receipt.matlab_step_outcome = 'failure'; });
  const evidence = await fixture_.executor.artifacts({ request_id: submitted.request_id });
  assert.equal(evidence.native_verified, false);
  assert.equal(evidence.receipt_status, 'failed');
  assert.equal(evidence.jobs[0].matlab_steps[0].conclusion, 'failure');
  assert.ok(evidence.artifacts.some((item) => item.file === 'diary.log'));
});

test('failure before MATLAB startup permits bound diary-only diagnostics without request metadata', async (context) => {
  const fixture_ = await fixture(context);
  const submitted = await fixture_.submit();
  fixture_.state.run.conclusion = 'failure';
  fixture_.state.jobs[0].conclusion = 'failure';
  fixture_.state.jobs[0].steps[0].conclusion = 'skipped';
  fixture_.bundle(({ receipt, files }) => {
    receipt.status = 'failed'; receipt.matlab_release = ''; receipt.matlab_version = '';
    receipt.matlab_started = false; receipt.code_started = false; receipt.code_completed = false;
    receipt.matlab_step_outcome = 'skipped'; receipt.started_at = '';
    receipt.artifacts = receipt.artifacts.filter((item) => item.file === 'diary.log');
    for (const name of Object.keys(files)) if (name !== 'diary.log') delete files[name];
  });
  const evidence = await fixture_.executor.artifacts({ request_id: submitted.request_id });
  assert.equal(evidence.status, 'failed_native_unverified');
  assert.equal(evidence.native_verified, false);
  assert.deepEqual(evidence.artifacts.map((item) => item.file), ['diary.log']);
  assert.ok((await fs.stat(evidence.receipt_path)).isFile());
});

test('request.json must be declared and correctly hashed, then match original input metadata', async (context) => {
  const fixture_ = await fixture(context);
  const submitted = await fixture_.submit({ code: CODE, input_json: '{"x":1}' });
  const mutations = [
    ({ receipt }) => { receipt.artifacts = receipt.artifacts.filter((item) => item.file !== 'request.json'); },
    ({ receipt, files }) => {
      receipt.artifacts = receipt.artifacts.filter((item) => item.file !== 'request.json');
      delete files['request.json'];
    },
    ...[{ input_provided: false }, { input_sha256: 'f'.repeat(64) }, { input_bytes: 999 },
      { code_bytes: 999 }, { commit: 'b'.repeat(40) }, { run_attempt: '2' }].map((mutation) => ({ receipt, metadata, files }) => {
      files['request.json'] = JSON.stringify({ ...metadata, ...mutation });
      const item = receipt.artifacts.find((entry) => entry.file === 'request.json');
      item.bytes = Buffer.byteLength(files['request.json']); item.sha256 = hash(files['request.json']);
    }),
  ];
  for (const mutate of mutations) {
    fixture_.bundle(mutate);
    await assert.rejects(fixture_.executor.artifacts({ request_id: submitted.request_id }), { code: 'MATLAB_EVIDENCE_INVALID' });
  }
});

test('in-progress execution reports real job state without downloading artifacts', async (context) => {
  const fixture_ = await fixture(context);
  const submitted = await fixture_.submit();
  fixture_.state.run.status = 'in_progress'; fixture_.state.run.conclusion = null;
  fixture_.state.jobs[0].status = 'in_progress'; fixture_.state.jobs[0].conclusion = null;
  fixture_.state.jobs[0].steps[0].status = 'in_progress'; fixture_.state.jobs[0].steps[0].conclusion = null;
  const evidence = await fixture_.executor.artifacts({ request_id: submitted.request_id });
  assert.equal(evidence.status, 'native_pending');
  assert.equal(evidence.native_verified, false);
  assert.equal(evidence.jobs[0].matlab_steps[0].status, 'in_progress');
  assert.ok(!fixture_.calls.some((call) => call.args[3].includes('/artifacts')));
});

test('successful receipt cannot replace missing, skipped, failed or duplicate native steps', async (context) => {
  const fixture_ = await fixture(context);
  const submitted = await fixture_.submit();
  fixture_.bundle();
  const original = structuredClone(fixture_.state.jobs);
  const cases = [[], [{ name: 'Other step', status: 'completed', conclusion: 'success' }],
    [{ name: 'Execute MATLAB request', status: 'completed', conclusion: 'skipped' }],
    [{ name: 'Execute MATLAB request', status: 'completed', conclusion: 'failure' }],
    [...original[0].steps, ...original[0].steps]];
  for (const steps of cases) {
    fixture_.state.jobs[0].steps = steps;
    const evidence = await fixture_.executor.artifacts({ request_id: submitted.request_id });
    assert.equal(evidence.native_verified, false);
  }
});

test('receipt identity, execution flags, file hashes, undeclared files and metadata tampering are rejected', async (context) => {
  const fixture_ = await fixture(context);
  const submitted = await fixture_.submit();
  const mutations = [
    ...[{ request_id: REQUEST }, { code_sha256: 'f'.repeat(64) }, { requested_release: 'R2021a' },
      { matlab_release: 'R2024b' }, { ci_run_id: '902' }, { run_attempt: '2' }, { commit: 'b'.repeat(40) },
      { status: 'prepared' }, { code_completed: false }, { matlab_step_outcome: 'failure' }, { analysis_verified: true },
      { visual_verified: true }, { finished_at: '2026-09-06T02:00:00Z' }]
      .map((mutation) => ({ receipt }) => Object.assign(receipt, mutation)),
    ({ files }) => { files['outputs/result.json'] = 'changed'; },
    ({ files }) => { files['undeclared.txt'] = 'not declared'; },
    ({ files }) => { delete files['diary.log']; },
    ({ receipt }) => { receipt.artifacts.push(receipt.artifacts[0]); },
    ({ receipt }) => { receipt.artifacts[0].file = '/tmp/escape'; },
    ({ receipt }) => { receipt.artifacts[0].bytes = -1; },
    ({ files, metadata }) => { files['request.json'] = JSON.stringify({ ...metadata, code_bytes: 999 }); },
    ({ receipt, files }) => {
      files['code.m'] = 'different executable';
      const declaration = receipt.artifacts.find((item) => item.file === 'code.m');
      declaration.sha256 = hash(files['code.m']); declaration.bytes = Buffer.byteLength(files['code.m']);
    },
  ];
  for (const mutate of mutations) {
    fixture_.bundle(mutate);
    await assert.rejects(fixture_.executor.artifacts({ request_id: submitted.request_id }), { code: 'MATLAB_EVIDENCE_INVALID' });
    assert.deepEqual(await fs.readdir(path.join(fixture_.stateDirectory, 'downloads')), []);
  }
});

test('unsafe ZIP paths fail before extraction and do not leave a partial bundle', async (context) => {
  const fixture_ = await fixture(context);
  const submitted = await fixture_.submit();
  fixture_.bundle(({ files }) => { files['../outside.txt'] = 'escape'; });
  await assert.rejects(fixture_.executor.artifacts({ request_id: submitted.request_id }), { code: 'MATLAB_REMOTE_ERROR' });
  assert.deepEqual(await fs.readdir(path.join(fixture_.stateDirectory, 'downloads')), []);
  await assert.rejects(fs.stat(path.join(fixture_.stateDirectory, 'outside.txt')), { code: 'ENOENT' });
});

test('cached evidence hashes, receipt and declared metadata are rechecked, never refreshed', async (context) => {
  for (const file of ['outputs/result.json', 'execution.json', 'request.json']) {
    const fixture_ = await fixture(context);
    const submitted = await fixture_.submit();
    fixture_.bundle();
    const evidence = await fixture_.executor.artifacts({ request_id: submitted.request_id });
    const target = path.join(evidence.directory, file);
    if (file === 'outputs/result.json') await fs.writeFile(target, 'tampered');
    else {
      const value = JSON.parse(await fs.readFile(target, 'utf8'));
      value.extra = 'tampered';
      await fs.writeFile(target, JSON.stringify(value));
    }
    await assert.rejects(fixture_.factory().status({ request_id: submitted.request_id }), { code: 'MATLAB_EVIDENCE_INVALID' });
    assert.ok((await fs.readFile(target, 'utf8')).includes('tampered'));
  }
});

test('cached symlink files and intermediate directories are rejected', async (context) => {
  for (const intermediate of [false, true]) {
    const fixture_ = await fixture(context);
    const submitted = await fixture_.submit();
    fixture_.bundle();
    const evidence = await fixture_.executor.artifacts({ request_id: submitted.request_id });
    const outside = path.join(fixture_.root, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'result.json'), '{"answer":42}');
    const target = path.join(evidence.directory, intermediate ? 'outputs' : 'outputs/result.json');
    await fs.rm(target, { recursive: true });
    await fs.symlink(intermediate ? outside : path.join(outside, 'result.json'), target);
    await assert.rejects(fixture_.executor.status({ request_id: submitted.request_id }),
      (error) => ['MATLAB_EVIDENCE_INVALID', 'MATLAB_UNSAFE_STORAGE'].includes(error.code));
  }
});

test('rerun attempt cannot reuse old receipt or cached native status', async (context) => {
  const fixture_ = await fixture(context);
  const submitted = await fixture_.submit();
  fixture_.bundle();
  const original = await fixture_.executor.artifacts({ request_id: submitted.request_id });
  fixture_.state.run.run_attempt = 2;
  fixture_.state.jobs[0].run_attempt = 2;
  const status = await fixture_.executor.status({ request_id: submitted.request_id });
  assert.equal(status.native_verified, false);
  await assert.rejects(fixture_.executor.artifacts({ request_id: submitted.request_id }), { code: 'MATLAB_EVIDENCE_INVALID' });
  assert.ok((await fs.stat(original.receipt_path)).isFile());
});

test('artifact metadata size, expiration, digest and run association fail closed', async (context) => {
  const fixture_ = await fixture(context);
  const submitted = await fixture_.submit();
  fixture_.bundle();
  for (const artifact of [{ expired: true }, { size_in_bytes: 33 * 1024 * 1024 },
    { workflow_run: { id: 999, head_sha: COMMIT } }, { workflow_run: { id: 901, head_sha: 'b'.repeat(40) } },
    { digest: 'sha256:' + 'f'.repeat(64) }]) {
    fixture_.state.artifact = artifact;
    await assert.rejects(fixture_.executor.artifacts({ request_id: submitted.request_id }), { code: 'MATLAB_EVIDENCE_INVALID' });
  }
});

test('dispatch transport failure preserves a recoverable UUID without exposing stdout or credentials', async (context) => {
  const fixture_ = await fixture(context);
  fixture_.state.dispatchError = Object.assign(new Error('SECRET-CREDENTIAL PRIVATE-CODE'), { killed: true });
  await assert.rejects(fixture_.executor.execute({ code: CODE }), (error) => {
    assert.equal(error.code, 'MATLAB_DISPATCH_UNCERTAIN');
    assert.match(error.message, new RegExp(fixture_.state.payload.inputs.request_id));
    assert.doesNotMatch(error.message, /SECRET|PRIVATE|native MATLAB/);
    return true;
  });
  const record = JSON.parse(await fs.readFile(path.join(fixture_.stateDirectory, 'requests', `${fixture_.state.payload.inputs.request_id}.json`)));
  assert.equal(record.dispatch_state, 'unknown');
  assert.equal((await fixture_.factory().status({ request_id: record.request_id })).native_verified, false);
});

test('metadata/process failures are bounded and diagnostic without leaking remote content', async (context) => {
  const fixture_ = await fixture(context);
  for (const error of [{ code: 'ENOENT' }, { killed: true }, { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, { code: 1 }]) {
    fixture_.state.override = () => { throw Object.assign(new Error('PRIVATE-CODE SECRET-CREDENTIAL'), error); };
    await assert.rejects(fixture_.executor.execute({ code: CODE }), (failure) => {
      assert.equal(failure.code, 'MATLAB_REMOTE_ERROR');
      assert.match(failure.message, /Resolve MATLAB workflow/);
      assert.match(failure.message, /HTTP 429/);
      assert.doesNotMatch(failure.message, /PRIVATE|SECRET/);
      return true;
    });
  }
  fixture_.state.override = () => '{"secret":"PRIVATE-CODE"';
  await assert.rejects(fixture_.executor.execute({ code: CODE }), { code: 'MATLAB_REMOTE_METADATA' });
});

test('corrupt and symlinked request bindings fail closed and remain unchanged', async (context) => {
  const fixture_ = await fixture(context);
  const submitted = await fixture_.submit();
  const filename = path.join(fixture_.stateDirectory, 'requests', `${submitted.request_id}.json`);
  const callsBefore = fixture_.calls.length;
  await fs.writeFile(filename, '{truncated');
  await assert.rejects(fixture_.factory().status({ request_id: submitted.request_id }), { code: 'MATLAB_STATE_INVALID' });
  assert.equal(await fs.readFile(filename, 'utf8'), '{truncated');
  assert.equal(fixture_.calls.length, callsBefore);
  await fs.unlink(filename);
  const outside = path.join(fixture_.root, 'external.json');
  await fs.writeFile(outside, '{}');
  await fs.symlink(outside, filename);
  await assert.rejects(fixture_.executor.status({ request_id: submitted.request_id }), { code: 'MATLAB_EVIDENCE_INVALID' });
});

test('download timeout removes only its own partial slot and never records verified evidence', async (context) => {
  const fixture_ = await fixture(context);
  const submitted = await fixture_.submit();
  fixture_.bundle();
  fixture_.state.override = (route) => {
    if (route.endsWith('/zip')) throw Object.assign(new Error('PRIVATE-CODE'), { killed: true });
  };
  await assert.rejects(fixture_.executor.artifacts({ request_id: submitted.request_id }), (error) => {
    assert.equal(error.code, 'MATLAB_REMOTE_ERROR');
    assert.match(error.message, /Download bound artifact ZIP: timeout/);
    assert.doesNotMatch(error.message, /PRIVATE|SECRET/);
    return true;
  });
  assert.deepEqual(await fs.readdir(path.join(fixture_.stateDirectory, 'downloads')), []);
  assert.equal((await fixture_.factory().status({ request_id: submitted.request_id })).native_verified, false);
});

test('run discovery checks later pages and rejects oversized or malformed API listings', async (context) => {
  const fixture_ = await fixture(context);
  const submitted = await fixture_.submit();
  fixture_.state.override = (route) => {
    if (!route.includes('/workflows/42/runs?')) return;
    return { total_count: 2, workflow_runs: route.endsWith('page=1')
      ? [{ ...fixture_.state.run, id: 900, display_title: 'Another request' }] : [fixture_.state.run] };
  };
  assert.equal((await fixture_.executor.status({ request_id: submitted.request_id })).run_id, 901);
  for (const response of [{ total_count: 1001, workflow_runs: [] }, { total_count: 2, workflow_runs: [] }, null]) {
    const another = await fixture_.executor.execute({ code: CODE });
    fixture_.state.override = (route) => route.includes('/workflows/42/runs?') ? response : undefined;
    await assert.rejects(fixture_.executor.status({ request_id: another.request_id }), { code: 'MATLAB_REMOTE_METADATA' });
  }
});

test('parallel submissions serialize and never overwrite distinct bindings', async (context) => {
  const fixture_ = await fixture(context);
  const submissions = await Promise.all(Array.from({ length: 6 }, (_, index) => fixture_.executor.execute({ code: `disp(${index})` })));
  assert.equal(new Set(submissions.map((item) => item.request_id)).size, 6);
  assert.equal((await fs.readdir(path.join(fixture_.stateDirectory, 'requests'))).length, 6);
  for (const item of submissions) {
    const record = JSON.parse(await fs.readFile(path.join(fixture_.stateDirectory, 'requests', `${item.request_id}.json`)));
    assert.equal(record.code_sha256, item.code_sha256);
  }
});
