import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

export const MATLAB_ILLUSTRATED_PROFILE = 'matlab-illustrated-v1';

const STORE_SCHEMA = 'codex-report-evidence-policies';
const STORE_VERSION = 1;
const REPORT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,79}$/u;
const IDENTITY_PATTERN = /^[a-zA-Z0-9_-]{1,160}$/u;
const IDENTITY_FIELDS = ['tenantKey', 'threadId', 'reportId'];
const RECORD_FIELDS = [...IDENTITY_FIELDS, 'profile', 'schemaVersion', 'createdAt'];

export function createReportEvidencePolicyStore(options = {}) {
  if (!hasFields(options, ['filePath'], true)) {
    throw policyError('CODEX_REPORT_POLICY_INVALID_INPUT', 'A service-owned policy filePath is required.', 400);
  }
  const { filePath } = options;
  if (typeof filePath !== 'string' || !filePath || filePath !== filePath.trim() || filePath.includes('\0')) {
    throw policyError('CODEX_REPORT_POLICY_INVALID_INPUT', 'A service-owned policy filePath is required.', 400);
  }
  const storagePath = path.resolve(filePath);
  let allowEmpty = true;
  let queue = Promise.resolve();

  function enqueue(operation) {
    const pending = queue.then(operation);
    queue = pending.catch(() => {});
    return pending;
  }

  async function load() {
    let contents;
    try {
      contents = await readFile(storagePath, 'utf8');
    } catch (cause) {
      if (cause.code === 'ENOENT' && allowEmpty) return new Map();
      allowEmpty = false;
      throw policyError('CODEX_REPORT_POLICY_STORE_READ_FAILED', 'Report policy storage could not be read.', 503, cause);
    }
    allowEmpty = false;
    try {
      return parseStore(JSON.parse(contents));
    } catch (cause) {
      throw policyError('CODEX_REPORT_POLICY_STORE_INVALID', 'Report policy storage is invalid.', 503, cause);
    }
  }

  async function persist(bindings) {
    const directory = path.dirname(storagePath);
    const temporaryPath = path.join(directory, `.${path.basename(storagePath)}.${process.pid}.${randomUUID()}.tmp`);
    let handle;
    let ownsTemporary = false;
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      handle = await open(temporaryPath, 'wx', 0o600);
      ownsTemporary = true;
      await handle.chmod(0o600);
      await handle.writeFile(`${JSON.stringify({
        schema: STORE_SCHEMA, schemaVersion: STORE_VERSION, bindings: [...bindings.values()],
      })}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, storagePath);
      ownsTemporary = false;
      allowEmpty = false;
    } catch (cause) {
      throw policyError('CODEX_REPORT_POLICY_STORE_WRITE_FAILED', 'Report policy storage could not be committed.', 503, cause);
    } finally {
      if (handle) await handle.close().catch(() => {});
      if (ownsTemporary) await unlink(temporaryPath).catch(() => {});
    }
  }

  return {
    async bind(input) {
      const request = validateRequest(input, true);
      return enqueue(async () => {
        const bindings = await load();
        const key = bindingKey(request);
        const existing = bindings.get(key);
        if (existing) {
          if (existing.threadId !== request.threadId) throw conflictError();
          return { ...existing };
        }
        if (hasNamespaceConflict(bindings, request)) {
          throw policyError('CODEX_REPORT_POLICY_CONFLICT', 'The report namespace overlaps an existing report for this tenant.', 409);
        }
        const record = { ...request, schemaVersion: STORE_VERSION, createdAt: new Date().toISOString() };
        bindings.set(key, record);
        await persist(bindings);
        return { ...record };
      });
    },
    async get(input) {
      const request = validateRequest(input, false);
      return enqueue(async () => {
        const bindings = await load();
        const record = bindings.get(bindingKey(request));
        if (!record) return null;
        if (record.threadId !== request.threadId) {
          throw policyError('CODEX_REPORT_POLICY_NOT_FOUND', 'The report policy does not belong to this thread.', 404);
        }
        return { ...record };
      });
    },
  };
}

function validateRequest(input, binding) {
  const fields = binding ? [...IDENTITY_FIELDS, 'profile'] : IDENTITY_FIELDS;
  if (!hasFields(input, fields) || !validIdentities(input)
    || (binding && input.profile !== undefined && typeof input.profile !== 'string')) {
    throw policyError('CODEX_REPORT_POLICY_INVALID_INPUT', 'Report policy identifiers or fields are invalid.', 400);
  }
  const request = Object.fromEntries(IDENTITY_FIELDS.map((field) => [field, input[field]]));
  if (binding) request.profile = input.profile === undefined ? MATLAB_ILLUSTRATED_PROFILE : input.profile;
  if (binding && request.profile !== MATLAB_ILLUSTRATED_PROFILE) {
    throw policyError('CODEX_REPORT_PROFILE_UNSUPPORTED', 'Only the MATLAB illustrated report profile is supported.', 400);
  }
  return request;
}

function parseStore(value) {
  if (!hasFields(value, ['schema', 'schemaVersion', 'bindings'], true)
    || value.schema !== STORE_SCHEMA || value.schemaVersion !== STORE_VERSION || !Array.isArray(value.bindings)) {
    throw new Error('Unsupported report policy schema.');
  }
  const bindings = new Map();
  for (const record of value.bindings) {
    if (!hasFields(record, RECORD_FIELDS, true) || !validIdentities(record)
      || record.profile !== MATLAB_ILLUSTRATED_PROFILE || record.schemaVersion !== STORE_VERSION || !validTimestamp(record.createdAt)) {
      throw new Error('Invalid report policy record.');
    }
    const key = bindingKey(record);
    if (bindings.has(key)) throw new Error('Duplicate report policy binding.');
    if (hasNamespaceConflict(bindings, record)) throw new Error('Overlapping report policy namespaces.');
    bindings.set(key, record);
  }
  return bindings;
}

function hasFields(value, fields, exact = false) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const keys = Reflect.ownKeys(value);
  return (!exact || keys.length === fields.length) && keys.every((key) => fields.includes(key)
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
}

function validIdentities(value) {
  return IDENTITY_FIELDS.every((field) => typeof value[field] === 'string'
    && (field === 'reportId' ? REPORT_ID_PATTERN : IDENTITY_PATTERN).test(value[field]));
}

function validTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function bindingKey({ tenantKey, reportId }) {
  return JSON.stringify([tenantKey, reportId]);
}

function hasNamespaceConflict(bindings, candidate) {
  for (const existing of bindings.values()) {
    if (existing.tenantKey === candidate.tenantKey && existing.reportId !== candidate.reportId
      && (existing.reportId.startsWith(`${candidate.reportId}-`)
        || candidate.reportId.startsWith(`${existing.reportId}-`))) return true;
  }
  return false;
}

function conflictError() {
  return policyError('CODEX_REPORT_POLICY_CONFLICT', 'The report is already bound to a different thread.', 409);
}

function policyError(code, message, status, cause) {
  return Object.assign(new Error(message, { cause }), { code, status });
}
