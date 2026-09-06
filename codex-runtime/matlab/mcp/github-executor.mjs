import { execFile as nodeExecFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKFLOW = '.github/workflows/matlab-execute.yml';
const MATLAB_STEP = 'Execute MATLAB request';
const RELEASES = ['R2021a', 'R2024b', 'R2026a'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const ZIP_LIMIT = 32 * 1024 * 1024;
const FILE_LIMIT = 16 * 1024 * 1024;
const TOTAL_LIMIT = 64 * 1024 * 1024;
const HELPER = fileURLToPath(new URL('./extract_artifact.py', import.meta.url));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function requireThat(condition, code, message) {
  if (!condition) fail(code, message);
}

function argumentsOnly(value, allowed) {
  requireThat(object(value) && Object.keys(value).every((key) => allowed.includes(key)),
    'MATLAB_INVALID_INPUT', 'Unexpected or missing arguments.');
}

function utf8(value, limit, label) {
  requireThat(typeof value === 'string' && value.length > 0,
    'MATLAB_INVALID_INPUT', `${label} must be a nonempty UTF-8 string.`);
  const bytes = Buffer.from(value, 'utf8');
  requireThat(bytes.length <= limit && bytes.toString('utf8') === value,
    'MATLAB_INVALID_INPUT', `${label} exceeds its byte limit or contains invalid Unicode.`);
  return bytes;
}

function json(bytes, code, label) {
  try {
    const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : bytes;
    if (Buffer.isBuffer(bytes) && !Buffer.from(text).equals(bytes)) throw new Error();
    const value = JSON.parse(text);
    const pending = [value];
    while (pending.length) {
      const current = pending.pop();
      if (typeof current === 'number' && !Number.isFinite(current)) throw new Error();
      if (typeof current === 'string' && Buffer.from(current).toString() !== current) throw new Error();
      if (current !== null && typeof current === 'object') pending.push(...Object.values(current));
    }
    return value;
  } catch {
    fail(code, `${label} is not valid finite UTF-8 JSON.`);
  }
}

async function directoryTree(directory) {
  const absolute = path.resolve(directory);
  let current = path.parse(absolute).root;
  for (const component of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const info = await fs.lstat(current);
    requireThat(info.isDirectory() && !info.isSymbolicLink(), 'MATLAB_UNSAFE_STORAGE', 'Directory tree contains a link or non-directory.');
  }
  requireThat(await fs.realpath(absolute) === absolute, 'MATLAB_UNSAFE_STORAGE', 'Directory root changed.');
}

async function privateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await directoryTree(directory);
  const info = await fs.lstat(directory);
  requireThat((info.mode & 0o077) === 0 && info.uid === process.getuid(),
    'MATLAB_UNSAFE_STORAGE', 'Service storage must be owner-only (0700).');
}

async function regularBytes(filename, limit) {
  await directoryTree(path.dirname(filename));
  const before = await fs.lstat(filename);
  requireThat(before.isFile() && before.nlink === 1 && before.size <= limit,
    'MATLAB_EVIDENCE_INVALID', 'Expected a bounded, unlinked regular file.');
  const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    requireThat(opened.dev === before.dev && opened.ino === before.ino,
      'MATLAB_EVIDENCE_INVALID', 'File identity changed while opening.');
    const bytes = Buffer.alloc(before.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const result = await handle.read(bytes, size, bytes.length - size, null);
      if (!result.bytesRead) break;
      size += result.bytesRead;
    }
    const after = await handle.stat();
    const named = await fs.lstat(filename);
    requireThat(size === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs
      && after.ctimeMs === before.ctimeMs && named.dev === before.dev && named.ino === before.ino,
    'MATLAB_EVIDENCE_INVALID', 'File changed while reading.');
    await directoryTree(path.dirname(filename));
    return bytes.subarray(0, size);
  } finally {
    await handle.close();
  }
}

function artifactPath(name) {
  return typeof name === 'string' && name.length <= 2048 && !/[\\:\x00-\x1f\x7f]/.test(name)
    && name.split('/').every((part) => part && part !== '.' && part !== '..' && Buffer.byteLength(part) <= 255)
    && (['diary.log', 'request.json', 'code.m', 'input.json', 'display.log'].includes(name) || name.startsWith('outputs/'));
}

export function createMatlabExecutor({
  repo = 'wzn1118/ocean-intelligence', ref = 'main',
  stateDirectory = path.join(homedir(), '.cache', 'ocean-matlab-mcp'),
  execFile = nodeExecFile,
} = {}) {
  requireThat(typeof repo === 'string' && /^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(repo)
    && !repo.endsWith('/.') && !repo.endsWith('/..'), 'MATLAB_INVALID_CONFIG', 'Invalid service repository.');
  requireThat(typeof ref === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref)
    && !ref.includes('..') && !ref.includes('//') && !ref.endsWith('/') && !ref.startsWith('refs/'),
  'MATLAB_INVALID_CONFIG', 'ref must be a branch name, not a path or refs/ expression.');
  requireThat(typeof stateDirectory === 'string' && path.isAbsolute(stateDirectory)
    && !stateDirectory.split(path.sep).includes('..') && typeof execFile === 'function',
  'MATLAB_INVALID_CONFIG', 'Invalid service storage or process adapter.');
  const root = path.resolve(stateDirectory);
  const requests = path.join(root, 'requests');
  const downloads = path.join(root, 'downloads');
  const endpoint = `repos/${repo}`;
  let queue = Promise.resolve();

  function serialize(operation) {
    const result = queue.then(async () => {
      try {
        await privateDirectory(root);
        await privateDirectory(requests);
        await privateDirectory(downloads);
        return await operation();
      } catch (error) {
        if (typeof error?.code === 'string' && error.code.startsWith('MATLAB_')) throw error;
        fail('MATLAB_STORAGE_UNAVAILABLE', 'Local evidence storage operation failed.');
      }
    });
    queue = result.catch(() => {});
    return result;
  }

  function command(executable, args, { input, limit = 4 * 1024 * 1024, timeout = 30000, stage } = {}) {
    return new Promise((resolve, reject) => {
      const rejectCommand = (error) => {
        let reason = 'process failure';
        if (error?.killed || error?.code === 'ETIMEDOUT') reason = 'timeout';
        else if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') reason = 'output size limit';
        else if (Number.isInteger(error?.code)) reason = `exit ${error.code}`;
        else if (error?.code === 'ENOENT') reason = 'executable unavailable';
        const failure = new Error(`MATLAB_REMOTE_ERROR: ${stage}: ${reason}. No remote output was disclosed.`);
        failure.code = 'MATLAB_REMOTE_ERROR';
        reject(failure);
      };
      try {
        const child = execFile(executable, args, { encoding: 'buffer', shell: false, timeout, maxBuffer: limit },
          (error, stdout) => error ? rejectCommand(error) : resolve(Buffer.from(stdout || '')));
        if (child?.stdin) {
          child.stdin.on('error', rejectCommand);
          child.stdin.end(input);
        } else if (input !== undefined) {
          rejectCommand(new Error());
        }
      } catch (error) {
        rejectCommand(error);
      }
    });
  }

  async function api(route, stage) {
    const bytes = await command('gh', ['api', '--hostname', 'github.com', route, '--method', 'GET'], { stage });
    const value = json(bytes, 'MATLAB_REMOTE_METADATA', stage);
    requireThat(object(value), 'MATLAB_REMOTE_METADATA', `${stage}: expected a metadata object.`);
    return value;
  }

  async function list(route, field, stage) {
    const values = [];
    for (let page = 1; page <= 10; page += 1) {
      const result = await api(`${route}${route.includes('?') ? '&' : '?'}per_page=100&page=${page}`, stage);
      requireThat(object(result) && Number.isSafeInteger(result.total_count) && result.total_count >= 0
        && result.total_count <= 1000 && Array.isArray(result[field]), 'MATLAB_REMOTE_METADATA', `${stage}: invalid or oversized listing.`);
      values.push(...result[field]);
      if (values.length >= result.total_count) return values;
      requireThat(result[field].length > 0, 'MATLAB_REMOTE_METADATA', `${stage}: incomplete listing.`);
    }
    fail('MATLAB_REMOTE_METADATA', `${stage}: pagination limit exceeded.`);
  }

  async function save(record, initial = false) {
    const filename = path.join(requests, `${record.request_id}.json`);
    const bytes = Buffer.from(JSON.stringify(record));
    if (initial) {
      await fs.writeFile(filename, bytes, { flag: 'wx', mode: 0o600 });
      return;
    }
    const temporary = path.join(requests, `.${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, filename);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }

  async function load(requestId) {
    let bytes;
    try {
      bytes = await regularBytes(path.join(requests, `${requestId}.json`), 32768);
    } catch (error) {
      if (error.code === 'ENOENT') fail('MATLAB_REQUEST_NOT_FOUND', 'Request was not submitted by this service.');
      throw error;
    }
    const record = json(bytes, 'MATLAB_STATE_INVALID', 'Request binding');
    requireThat(object(record) && record.schema_version === 1 && record.request_id === requestId
      && record.repo === repo && record.ref === ref && COMMIT.test(record.commit)
      && SHA.test(record.code_sha256) && RELEASES.includes(record.release) && positive(record.workflow_id)
      && Number.isSafeInteger(record.code_bytes) && record.code_bytes > 0 && record.code_bytes <= 32768
      && (record.input_sha256 === null || SHA.test(record.input_sha256))
      && Number.isSafeInteger(record.input_bytes) && record.input_bytes >= 0 && record.input_bytes <= 16384
      && (record.input_sha256 === null) === (record.input_bytes === 0)
      && typeof record.created_at === 'string' && Number.isFinite(Date.parse(record.created_at))
      && ['prepared', 'submitted', 'unknown'].includes(record.dispatch_state)
      && (record.run_id === undefined || positive(record.run_id))
      && (record.download === undefined || (object(record.download) && UUID.test(record.download.slot)
        && positive(record.download.run_id) && positive(record.download.run_attempt) && SHA.test(record.download.receipt_sha256))),
    'MATLAB_STATE_INVALID', 'Invalid or incompatible persisted request binding.');
    return record;
  }

  function runMatches(run, record) {
    return object(run) && positive(run.id) && run.workflow_id === record.workflow_id
      && run.path === WORKFLOW && run.event === 'workflow_dispatch'
      && run.display_title === `MATLAB Execute ${record.request_id}`
      && run.repository?.full_name?.toLowerCase() === repo.toLowerCase()
      && run.head_repository?.full_name?.toLowerCase() === repo.toLowerCase()
      && run.head_branch === ref && run.head_sha === record.commit && positive(run.run_attempt);
  }

  async function resolveRun(record, requestedId) {
    let runId = requestedId ?? record.run_id;
    requireThat(!(requestedId && record.run_id && requestedId !== record.run_id),
      'MATLAB_RUN_MISMATCH', 'Supplied run differs from the bound run.');
    if (!runId) {
      const candidates = await list(`${endpoint}/actions/workflows/${record.workflow_id}/runs?event=workflow_dispatch&branch=${encodeURIComponent(ref)}&created=${encodeURIComponent(`>=${record.created_at.slice(0, 10)}`)}`,
        'workflow_runs', 'Find submitted workflow');
      const named = candidates.filter((run) => run.display_title === `MATLAB Execute ${record.request_id}`);
      requireThat(named.length <= 1, 'MATLAB_RUN_AMBIGUOUS', 'Multiple runs have this request title; refusing to select one.');
      if (!named.length) return null;
      requireThat(runMatches(named[0], record), 'MATLAB_RUN_MISMATCH', 'Run title matched but workflow/repository/ref/commit did not.');
      runId = named[0].id;
    }
    const run = await api(`${endpoint}/actions/runs/${runId}`, 'Read bound workflow run');
    requireThat(run.id === runId && runMatches(run, record), 'MATLAB_RUN_MISMATCH', 'Run identity does not match the persisted submission.');
    requireThat(typeof run.status === 'string' && (run.conclusion === null || typeof run.conclusion === 'string'),
      'MATLAB_REMOTE_METADATA', 'Invalid workflow status.');
    if (!record.run_id) {
      record.run_id = runId;
      await save(record);
    }
    return run;
  }

  async function jobEvidence(run) {
    const jobs = await list(`${endpoint}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, 'jobs', 'Read MATLAB job steps');
    requireThat(jobs.every((job) => object(job) && job.run_id === run.id && positive(job.id)
      && (job.run_attempt === undefined || job.run_attempt === run.run_attempt) && Array.isArray(job.steps)),
    'MATLAB_REMOTE_METADATA', 'Job metadata does not belong to the bound run attempt.');
    const matlabJobs = jobs.filter((job) => job.name === 'execute');
    const steps = matlabJobs.flatMap((job) => job.steps.filter((step) => step.name === MATLAB_STEP));
    const succeeded = matlabJobs.length === 1 && steps.length === 1
      && matlabJobs[0].status === 'completed' && matlabJobs[0].conclusion === 'success'
      && steps[0].status === 'completed' && steps[0].conclusion === 'success';
    return { succeeded, jobs: jobs.map((job) => ({
      job_id: job.id, status: job.status, conclusion: job.conclusion,
      matlab_steps: job.steps.filter((step) => step.name === MATLAB_STEP)
        .map((step) => ({ name: MATLAB_STEP, status: step.status, conclusion: step.conclusion })),
    })) };
  }

  async function verifyFiles(record, run, directory) {
    await directoryTree(directory);
    const receiptBytes = await regularBytes(path.join(directory, 'execution.json'), 1024 * 1024);
    const receipt = json(receiptBytes, 'MATLAB_EVIDENCE_INVALID', 'Execution receipt');
    requireThat(object(receipt) && receipt.schema_version === 1 && receipt.request_id === record.request_id
      && receipt.code_sha256 === record.code_sha256 && receipt.requested_release === record.release
      && String(receipt.ci_run_id) === String(run.id) && String(receipt.run_attempt) === String(run.run_attempt)
      && receipt.commit === record.commit && ['succeeded', 'failed'].includes(receipt.status)
      && (receipt.matlab_release === record.release || (receipt.status === 'failed' && receipt.matlab_release === ''))
      && Array.isArray(receipt.artifacts) && receipt.artifacts.length <= 255,
    'MATLAB_EVIDENCE_INVALID', 'Receipt identity, release, attempt or completion status does not match.');
    requireThat(receipt.analysis_verified === false && receipt.visual_verified === false,
      'MATLAB_EVIDENCE_INVALID', 'Execution receipt must not claim scientific or visual certification.');
    const declared = new Map();
    for (const item of receipt.artifacts) {
      requireThat(object(item) && artifactPath(item.file) && !declared.has(item.file)
        && Number.isSafeInteger(item.bytes) && item.bytes >= 0 && item.bytes <= FILE_LIMIT && SHA.test(item.sha256),
      'MATLAB_EVIDENCE_INVALID', 'Invalid or duplicate artifact declaration.');
      declared.set(item.file, item);
    }
    requireThat(declared.has('diary.log'), 'MATLAB_EVIDENCE_INVALID', 'Receipt does not bind diary.log.');
    let total = receiptBytes.length;
    let entries = 0;
    const actual = new Map();
    async function walk(relative = '') {
      for (const entry of await fs.readdir(path.join(directory, relative), { withFileTypes: true })) {
        entries += 1;
        requireThat(entries <= 256, 'MATLAB_EVIDENCE_INVALID', 'Artifact tree exceeds entry limit.');
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          requireThat(name === 'outputs' || name.startsWith('outputs/'), 'MATLAB_EVIDENCE_INVALID', 'Unexpected artifact directory.');
          await directoryTree(path.join(directory, name));
          await walk(name);
        } else if (name !== 'execution.json') {
          requireThat(entry.isFile() && declared.has(name), 'MATLAB_EVIDENCE_INVALID', 'Undeclared artifact or non-regular file.');
          const bytes = await regularBytes(path.join(directory, name), FILE_LIMIT);
          total += bytes.length;
          requireThat(total <= TOTAL_LIMIT && bytes.length === declared.get(name).bytes
            && digest(bytes) === declared.get(name).sha256, 'MATLAB_EVIDENCE_INVALID', 'Artifact byte count or SHA-256 mismatch.');
          actual.set(name, { ...declared.get(name), path: path.join(directory, name) });
        }
      }
    }
    await walk();
    requireThat(actual.size === declared.size && total <= TOTAL_LIMIT, 'MATLAB_EVIDENCE_INVALID', 'Declared artifact is missing or total bytes exceed the limit.');
    if (actual.has('request.json')) {
      const bytes = await regularBytes(path.join(directory, 'request.json'), 1024 * 1024);
      requireThat(digest(bytes) === actual.get('request.json').sha256, 'MATLAB_EVIDENCE_INVALID', 'Request metadata changed during verification.');
      const metadata = json(bytes, 'MATLAB_EVIDENCE_INVALID', 'Request metadata');
      requireThat(object(metadata) && metadata.request_id === record.request_id && metadata.requested_release === record.release
        && metadata.code_sha256 === record.code_sha256 && metadata.code_bytes === record.code_bytes
        && metadata.input_provided === (record.input_sha256 !== null) && metadata.input_sha256 === (record.input_sha256 ?? '')
        && metadata.input_bytes === record.input_bytes && String(metadata.ci_run_id) === String(run.id)
        && String(metadata.run_attempt) === String(run.run_attempt) && metadata.commit === record.commit,
      'MATLAB_EVIDENCE_INVALID', 'Request metadata does not match the persisted submission.');
    }
    if (receipt.status === 'succeeded') {
      requireThat(actual.has('request.json'), 'MATLAB_EVIDENCE_INVALID', 'Successful receipt must bind request.json.');
      requireThat(['matlab_started', 'code_started', 'code_completed'].every((key) => receipt[key] === true)
        && receipt.matlab_step_outcome === 'success' && typeof receipt.matlab_version === 'string' && receipt.matlab_version.length > 0
        && ['started_at', 'finished_at'].every((key) => typeof receipt[key] === 'string'
          && receipt[key].endsWith('Z') && Number.isFinite(Date.parse(receipt[key])))
        && Date.parse(receipt.finished_at) >= Date.parse(receipt.started_at),
      'MATLAB_EVIDENCE_INVALID', 'Successful receipt lacks actual MATLAB completion evidence.');
      for (const name of ['code.m', 'outputs/request_code.m']) {
        requireThat(actual.get(name)?.sha256 === record.code_sha256 && actual.get(name)?.bytes === record.code_bytes,
          'MATLAB_EVIDENCE_INVALID', 'Archived code does not match submitted bytes.');
      }
      if (record.input_sha256 !== null) {
        for (const name of ['input.json', 'outputs/input.json']) {
          requireThat(actual.get(name)?.sha256 === record.input_sha256, 'MATLAB_EVIDENCE_INVALID', 'Archived input does not match submitted JSON.');
        }
      }
    }
    return { receipt_status: receipt.status, receipt_sha256: digest(receiptBytes),
      receipt_path: path.join(directory, 'execution.json'), directory, artifacts: [...actual.values()] };
  }

  function result(record, run, jobs, evidence) {
    const native = run.status === 'completed' && run.conclusion === 'success'
      && jobs.succeeded && evidence?.receipt_status === 'succeeded';
    return { request_id: record.request_id, code_sha256: record.code_sha256, release: record.release,
      run_id: run.id, run_attempt: run.run_attempt, commit: run.head_sha,
      url: `https://github.com/${repo}/actions/runs/${run.id}`,
      status: native ? 'native_verified' : evidence?.receipt_status === 'failed' ? 'failed_native_unverified'
        : run.status === 'completed' ? 'completed_native_unverified' : 'native_pending',
      workflow_status: run.status, workflow_conclusion: run.conclusion, jobs: jobs.jobs,
      native_verified: Boolean(native), analysis_verified: false, visual_verified: false,
      ...(evidence || {}) };
  }

  async function query(arguments_, download) {
    argumentsOnly(arguments_, ['request_id', 'run_id']);
    requireThat(UUID.test(arguments_.request_id) && (arguments_.run_id === undefined || positive(arguments_.run_id)),
      'MATLAB_INVALID_INPUT', 'Expected a submitted UUID and optional positive integer run_id.');
    const record = await load(arguments_.request_id);
    const run = await resolveRun(record, arguments_.run_id);
    if (!run) return { request_id: record.request_id, status: 'submitted_native_pending', native_verified: false };
    const jobs = await jobEvidence(run);
    if (run.status !== 'completed') return result(record, run, jobs);
    if (record.download?.run_id === run.id && record.download?.run_attempt === run.run_attempt) {
      const evidence = await verifyFiles(record, run, path.join(downloads, record.download.slot, 'files'));
      requireThat(evidence.receipt_sha256 === record.download.receipt_sha256,
        'MATLAB_EVIDENCE_INVALID', 'Cached receipt changed after verification.');
      return result(record, run, jobs, evidence);
    }
    if (!download) return result(record, run, jobs);
    const artifacts = await list(`${endpoint}/actions/runs/${run.id}/artifacts`, 'artifacts', 'Find execution artifact');
    const matches = artifacts.filter((artifact) => artifact.name === `matlab-execution-${record.request_id}`);
    requireThat(matches.length === 1, 'MATLAB_ARTIFACT_UNAVAILABLE', 'Expected exactly one named execution artifact; it may be absent or expired.');
    const artifact = matches[0];
    requireThat(positive(artifact.id) && artifact.expired === false && Number.isSafeInteger(artifact.size_in_bytes)
      && artifact.size_in_bytes > 0 && artifact.size_in_bytes <= ZIP_LIMIT
      && artifact.workflow_run?.id === run.id && artifact.workflow_run?.head_sha === record.commit,
    'MATLAB_EVIDENCE_INVALID', 'Artifact metadata is expired, oversized or belongs to another run.');
    const slot = randomUUID();
    const slotDirectory = path.join(downloads, slot);
    await fs.mkdir(slotDirectory, { mode: 0o700 });
    try {
      const archive = await command('gh', ['api', '--hostname', 'github.com', `${endpoint}/actions/artifacts/${artifact.id}/zip`, '--method', 'GET'],
        { limit: ZIP_LIMIT, timeout: 120000, stage: 'Download bound artifact ZIP' });
      requireThat(archive.length > 0 && archive.length <= ZIP_LIMIT, 'MATLAB_EVIDENCE_INVALID', 'Downloaded ZIP exceeds limits or is empty.');
      if (artifact.digest !== undefined && artifact.digest !== null) {
        requireThat(artifact.digest === `sha256:${digest(archive)}`, 'MATLAB_EVIDENCE_INVALID', 'GitHub artifact digest does not match downloaded bytes.');
      }
      const archivePath = path.join(slotDirectory, 'artifact.zip');
      await fs.writeFile(archivePath, archive, { flag: 'wx', mode: 0o600 });
      const directory = path.join(slotDirectory, 'files');
      await command('python3', ['-B', HELPER, archivePath, directory], { timeout: 30000, stage: 'Extract bounded artifact ZIP' });
      const evidence = await verifyFiles(record, run, directory);
      const currentRun = await resolveRun(record, run.id);
      requireThat(currentRun.run_attempt === run.run_attempt && currentRun.status === 'completed'
        && currentRun.conclusion === run.conclusion, 'MATLAB_RUN_MISMATCH', 'Run changed during artifact verification.');
      record.download = { slot, run_id: run.id, run_attempt: run.run_attempt, receipt_sha256: evidence.receipt_sha256 };
      await save(record);
      return result(record, run, jobs, evidence);
    } catch (error) {
      await fs.rm(slotDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  return {
    execute(arguments_) {
      return serialize(async () => {
        argumentsOnly(arguments_, ['code', 'release', 'input_json']);
        const code = utf8(arguments_.code, 32768, 'code');
        requireThat(!code.includes(0), 'MATLAB_INVALID_INPUT', 'code must not contain NUL bytes.');
        const release = arguments_.release === undefined ? 'R2026a' : arguments_.release;
        requireThat(RELEASES.includes(release), 'MATLAB_INVALID_INPUT', 'Unsupported MATLAB release.');
        let input = null;
        if (arguments_.input_json !== undefined) {
          input = utf8(arguments_.input_json, 16384, 'input_json');
          json(input, 'MATLAB_INVALID_INPUT', 'input_json');
        }
        const requestId = randomUUID();
        const codeSha256 = digest(code);
        const payload = JSON.stringify({ ref, inputs: { request_id: requestId, release,
          code_base64: code.toString('base64'), code_sha256: codeSha256,
          input_json_base64: input?.toString('base64') ?? '' } });
        requireThat(Buffer.byteLength(payload) <= 65535, 'MATLAB_INVALID_INPUT', 'Encoded dispatch payload exceeds 65535 bytes; reduce code or input JSON.');
        const workflow = await api(`${endpoint}/actions/workflows/matlab-execute.yml`, 'Resolve MATLAB workflow');
        requireThat(positive(workflow.id) && workflow.path === WORKFLOW && workflow.state === 'active',
          'MATLAB_REMOTE_METADATA', 'Expected an active MATLAB execution workflow.');
        const commit = await api(`${endpoint}/commits/${encodeURIComponent(ref)}`, 'Resolve execution commit');
        requireThat(COMMIT.test(commit.sha), 'MATLAB_REMOTE_METADATA', 'Expected a full Git commit SHA.');
        const record = { schema_version: 1, request_id: requestId, repo, ref, commit: commit.sha,
          workflow_id: workflow.id, code_sha256: codeSha256, code_bytes: code.length,
          input_sha256: input === null ? null : digest(input), input_bytes: input?.length ?? 0,
          release, created_at: new Date().toISOString(), dispatch_state: 'prepared' };
        await save(record, true);
        try {
          await command('gh', ['api', '--hostname', 'github.com', `${endpoint}/actions/workflows/matlab-execute.yml/dispatches`, '--method', 'POST', '--input', '-'],
            { input: payload, stage: 'Dispatch MATLAB request' });
          record.dispatch_state = 'submitted';
          await save(record);
        } catch (error) {
          record.dispatch_state = 'unknown';
          await save(record);
          fail('MATLAB_DISPATCH_UNCERTAIN', `Request ${record.request_id} may have been submitted; query status before retrying. ${error.code || 'MATLAB_STORAGE_UNAVAILABLE'}`);
        }
        return { status: 'submitted_native_pending', native_verified: false, request_id: record.request_id,
          code_sha256: record.code_sha256, release, commit: record.commit };
      });
    },
    status(arguments_) { return serialize(() => query(arguments_, false)); },
    artifacts(arguments_) { return serialize(() => query(arguments_, true)); },
  };
}
