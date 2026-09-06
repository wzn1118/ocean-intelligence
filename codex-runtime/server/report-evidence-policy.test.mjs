import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createIllustratedReportContract } from './illustrated-report-contract.mjs';
import { createReportEvidencePolicyStore, MATLAB_ILLUSTRATED_PROFILE } from './report-evidence-policy.mjs';

const REQUEST = { tenantKey: 'tenant-a', threadId: 'thread-1', reportId: 'report-0001' };
const PROFILE = 'matlab-illustrated-v1';

test('bootstraps only on missing storage and persists a versioned binding with service time and mode 0600', async (context) => {
  const { store, filePath } = await fixture(context);
  assert.equal(MATLAB_ILLUSTRATED_PROFILE, PROFILE);
  assert.equal(await store.get(REQUEST), null);
  await assert.rejects(fs.stat(filePath), { code: 'ENOENT' });
  const started = Date.now();
  const record = await store.bind(REQUEST);
  assert.deepEqual(record, { ...REQUEST, profile: PROFILE, schemaVersion: 1, createdAt: record.createdAt });
  assert.ok(Date.parse(record.createdAt) >= started && Date.parse(record.createdAt) <= Date.now());
  assert.equal(new Date(record.createdAt).toISOString(), record.createdAt);
  assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await fs.readFile(filePath, 'utf8')), envelope([record]));
  assert.deepEqual(await fs.readdir(path.dirname(filePath)), ['codex-report-policies.json']);
});

test('identical retries and recreated stores return the original record without writing or leaking mutable state', async (context) => {
  const { store, filePath } = await fixture(context);
  const record = await store.bind(REQUEST);
  const original = { ...record };
  const before = await snapshot(filePath);
  record.threadId = 'caller-mutated';
  record.profile = 'octave';
  record.createdAt = 'caller-time';
  const restored = await store.get(REQUEST);
  assert.deepEqual(restored, original);
  restored.tenantKey = 'different';
  await withMock(context, 'open', async () => { throw new Error('Retries must not write.'); }, async () => {
    assert.deepEqual(await store.bind({ ...REQUEST, profile: PROFILE }), original);
    const reloaded = createReportEvidencePolicyStore({ filePath });
    assert.deepEqual(await reloaded.get(REQUEST), original);
    assert.deepEqual(await reloaded.bind(REQUEST), original);
  });
  assert.deepEqual(await snapshot(filePath), before);
});

test('tenant plus report is the unique key, independent of thread and safe from separator collisions', async (context) => {
  const { store, filePath } = await fixture(context);
  const requests = [REQUEST, { ...REQUEST, tenantKey: 'tenant-b', threadId: 'thread-2' },
    { ...REQUEST, tenantKey: 'a-b', reportId: 'report-02' },
    { ...REQUEST, tenantKey: 'a', reportId: 'b-report-02' },
    { ...REQUEST, tenantKey: '__proto__', reportId: 'constructor' }];
  for (const request of requests) {
    assert.equal(await store.get(request), null);
    assert.deepEqual(await store.bind(request), await store.get(request));
  }
  assert.equal(JSON.parse(await fs.readFile(filePath, 'utf8')).bindings.length, requests.length);
  assert.equal(await store.get({ ...REQUEST, tenantKey: 'unbound-tenant' }), null);
  assert.equal(await store.get({ ...REQUEST, reportId: 'unbound-report' }), null);
});

test('cross-thread bind conflicts and get not-found errors do not disclose or replace the original binding', async (context) => {
  const { store, filePath } = await fixture(context);
  const original = await store.bind(REQUEST);
  const before = await snapshot(filePath);
  await assert.rejects(store.bind({ ...REQUEST, threadId: 'thread-2' }),
    { code: 'CODEX_REPORT_POLICY_CONFLICT', status: 409 });
  await assert.rejects(store.get({ ...REQUEST, threadId: 'thread-2' }),
    { code: 'CODEX_REPORT_POLICY_NOT_FOUND', status: 404 });
  assert.deepEqual(await snapshot(filePath), before);
  assert.deepEqual(await store.get(REQUEST), original);
});

for (const [firstId, secondId] of [['report-alpha', 'report-alpha-child'], ['report-alpha-child', 'report-alpha']]) {
  test(`report namespace rejects ${secondId} after ${firstId}, including after reload, without writing`, async (context) => {
    const { store, filePath } = await fixture(context);
    const first = { ...REQUEST, reportId: firstId };
    const second = { ...REQUEST, reportId: secondId };
    const original = await store.bind(first);
    const before = await snapshot(filePath);
    await withMock(context, 'open', async () => { throw new Error('Namespace conflicts and retries must not write.'); }, async () => {
      for (const candidate of [store, createReportEvidencePolicyStore({ filePath })]) {
        for (const threadId of [REQUEST.threadId, 'thread-2']) {
          await assert.rejects(candidate.bind({ ...second, threadId }), { code: 'CODEX_REPORT_POLICY_CONFLICT', status: 409 });
        }
        assert.equal(await candidate.get(second), null);
        assert.deepEqual(await candidate.bind(first), original);
        assert.deepEqual(await candidate.get(first), original);
      }
    });
    assert.deepEqual(await snapshot(filePath), before);
    assert.deepEqual(await fs.readdir(path.dirname(filePath)), ['codex-report-policies.json']);
  });

  test(`report namespace loading rejects overlapping ${firstId}, ${secondId} without selecting or repairing records`, async (context) => {
    const { store, filePath } = await fixture(context);
    const first = { ...REQUEST, reportId: firstId };
    const second = { ...REQUEST, threadId: 'thread-2', reportId: secondId };
    const original = await store.bind(first);
    await fs.writeFile(filePath, JSON.stringify(envelope([original, { ...original, ...second }])));
    const before = await snapshot(filePath);
    for (const candidate of [store, createReportEvidencePolicyStore({ filePath })]) {
      for (const request of [first, second, { ...REQUEST, reportId: 'unbound-report' }]) {
        await assert.rejects(candidate.get(request), { code: 'CODEX_REPORT_POLICY_STORE_INVALID', status: 503 });
        await assert.rejects(candidate.bind(request), { code: 'CODEX_REPORT_POLICY_STORE_INVALID', status: 503 });
      }
    }
    assert.deepEqual(await snapshot(filePath), before);
    assert.deepEqual(await fs.readdir(path.dirname(filePath)), ['codex-report-policies.json']);
  });

  test(`report namespace serializes concurrent ${firstId}, ${secondId} and preserves retries and later binds`, async (context) => {
    const { store, filePath } = await fixture(context);
    const first = { ...REQUEST, reportId: firstId };
    const second = { ...REQUEST, reportId: secondId };
    const independent = { ...REQUEST, reportId: 'report-independent' };
    const outcomes = await Promise.allSettled([
      store.bind(first), store.bind(second), store.bind(first), store.bind(independent),
    ]);
    assert.equal(outcomes[0].status, 'fulfilled');
    assert.equal(outcomes[1].status, 'rejected');
    assert.equal(outcomes[1].reason.code, 'CODEX_REPORT_POLICY_CONFLICT');
    assert.equal(outcomes[1].reason.status, 409);
    assert.equal(outcomes[2].status, 'fulfilled');
    assert.deepEqual(outcomes[2].value, outcomes[0].value);
    assert.equal(outcomes[3].status, 'fulfilled');
    const reloaded = createReportEvidencePolicyStore({ filePath });
    assert.deepEqual(await reloaded.get(first), outcomes[0].value);
    assert.equal(await reloaded.get(second), null);
    assert.deepEqual(await reloaded.get(independent), outcomes[3].value);
    assert.deepEqual(JSON.parse(await fs.readFile(filePath, 'utf8')).bindings, [outcomes[0].value, outcomes[3].value]);
  });
}

for (const [name, requests] of [
  ['parent then child across tenants', [
    { ...REQUEST, reportId: 'report-alpha' }, { ...REQUEST, tenantKey: 'tenant-b', reportId: 'report-alpha-child' },
  ]],
  ['child then parent across tenants', [
    { ...REQUEST, reportId: 'report-alpha-child' }, { ...REQUEST, tenantKey: 'tenant-b', reportId: 'report-alpha' },
  ]],
  ['non-delimited prefix', [{ ...REQUEST, reportId: 'report-alpha' }, { ...REQUEST, reportId: 'report-alphabet' }]],
  ['sibling names', [{ ...REQUEST, reportId: 'report-alpha-left' }, { ...REQUEST, reportId: 'report-alpha-right' }]],
]) {
  test(`report namespace permits ${name}, including after reload`, async (context) => {
    const { store, filePath } = await fixture(context);
    const originals = [];
    for (const request of requests) originals.push(await store.bind(request));
    const before = await snapshot(filePath);
    const reloaded = createReportEvidencePolicyStore({ filePath });
    for (const [index, request] of requests.entries()) {
      assert.deepEqual(await reloaded.get(request), originals[index]);
      assert.deepEqual(await reloaded.bind(request), originals[index]);
    }
    assert.deepEqual(await snapshot(filePath), before);
    assert.deepEqual(JSON.parse(await fs.readFile(filePath, 'utf8')).bindings, originals);
  });
}

for (const profile of ['octave', 'octave-illustrated-v1', 'matlab-illustrated-v2', '', ' matlab-illustrated-v1']) {
  test(`unsupported profile ${JSON.stringify(profile)} is rejected before storage access for both new and bound reports`, async (context) => {
    const { store, filePath } = await fixture(context);
    await withMock(context, 'readFile', async () => { throw new Error('Unsupported profiles must not access storage.'); }, async () => {
      await assert.rejects(store.bind({ ...REQUEST, profile }), { code: 'CODEX_REPORT_PROFILE_UNSUPPORTED', status: 400 });
    });
    await assert.rejects(fs.stat(filePath), { code: 'ENOENT' });
    await store.bind(REQUEST);
    const before = await snapshot(filePath);
    await withMock(context, 'readFile', async () => { throw new Error('Unsupported profiles must not access storage.'); }, async () => {
      await assert.rejects(store.bind({ ...REQUEST, profile }), { code: 'CODEX_REPORT_PROFILE_UNSUPPORTED', status: 400 });
      await assert.rejects(store.bind({ ...REQUEST, profile, threadId: 'thread-2' }),
        { code: 'CODEX_REPORT_PROFILE_UNSUPPORTED', status: 400 });
    });
    assert.deepEqual(await snapshot(filePath), before);
  });
}

const badRequests = [undefined, null, [], 'report-0001', {},
  ...['tenantKey', 'threadId', 'reportId'].flatMap((field) => [undefined, null, 42, '', ' ', '../outside', 'bad\0id', ' padded ']
    .map((value) => ({ ...REQUEST, [field]: value }))),
  { ...REQUEST, tenantKey: 'x'.repeat(161) }, { ...REQUEST, threadId: 'x'.repeat(161) },
  { ...REQUEST, reportId: 'short' }, { ...REQUEST, reportId: 'Uppercase' },
  { ...REQUEST, reportId: 'a'.repeat(81) }, { ...REQUEST, reportId: '-report-01' },
  { ...REQUEST, filePath: '/tmp/caller-choice.json' }, { ...REQUEST, path: '/tmp/other' },
  { ...REQUEST, createdAt: '2000-01-01T00:00:00.000Z' }, { ...REQUEST, schemaVersion: 1 }, { ...REQUEST, unknown: true },
  { ...REQUEST, [Symbol('unknown')]: true }, Object.assign(Object.create({ inherited: true }), REQUEST),
  Object.defineProperty({ ...REQUEST }, 'tenantKey', { get() { throw new Error('Must not invoke a getter.'); } }),
];

for (const [index, input] of badRequests.entries()) {
  test(`invalid request ${index} is rejected by bind and get without creating storage`, async (context) => {
    const { store, filePath } = await fixture(context);
    for (const operation of ['bind', 'get']) {
      await assert.rejects(store[operation](input), { code: 'CODEX_REPORT_POLICY_INVALID_INPUT', status: 400 });
    }
    await assert.rejects(fs.stat(filePath), { code: 'ENOENT' });
  });
}

test('profile must be a string or omitted, get accepts no caller-controlled profile, and config requires a path', async (context) => {
  const { store } = await fixture(context);
  for (const profile of [null, false, 1, {}, []]) {
    await assert.rejects(store.bind({ ...REQUEST, profile }), { code: 'CODEX_REPORT_POLICY_INVALID_INPUT' });
  }
  await assert.rejects(store.get({ ...REQUEST, profile: PROFILE }), { code: 'CODEX_REPORT_POLICY_INVALID_INPUT' });
  for (const filePath of [undefined, null, '', ' ', '/tmp/has\0null', '/tmp/padded ']) {
    assert.throws(() => createReportEvidencePolicyStore({ filePath }), { code: 'CODEX_REPORT_POLICY_INVALID_INPUT' });
  }
  for (const options of [undefined, null, [], {}, '/tmp/policies.json']) {
    assert.throws(() => createReportEvidencePolicyStore(options), { code: 'CODEX_REPORT_POLICY_INVALID_INPUT', status: 400 });
  }
});

test('report IDs agree with the existing contract at accepted boundaries', async (context) => {
  const { store, root } = await fixture(context);
  for (const reportId of ['a1234567', '9--valid', 'a'.repeat(80), 'report-trailing-']) {
    assert.equal(createIllustratedReportContract(root, reportId).id, reportId);
    assert.equal((await store.bind({ ...REQUEST, reportId })).reportId, reportId);
  }
});

const validRecord = { ...REQUEST, profile: PROFILE, schemaVersion: 1, createdAt: '2026-09-06T00:00:00.000Z' };
const invalidStores = [
  ['truncated', '{"schema":'], ['empty file', ''], ['null', 'null'], ['array', '[]'], ['empty object', '{}'],
  ['wrong schema', JSON.stringify({ ...envelope([]), schema: 'other' })],
  ['wrong version', JSON.stringify({ ...envelope([]), schemaVersion: 2 })],
  ['string version', JSON.stringify({ ...envelope([]), schemaVersion: '1' })],
  ['missing bindings', JSON.stringify({ schema: 'codex-report-evidence-policies', schemaVersion: 1 })],
  ['object bindings', JSON.stringify({ ...envelope([]), bindings: {} })],
  ['unknown top field', JSON.stringify({ ...envelope([]), createdAt: validRecord.createdAt })],
  ['duplicate identical key', JSON.stringify(envelope([validRecord, validRecord]))],
  ['duplicate different thread', JSON.stringify(envelope([validRecord, { ...validRecord, threadId: 'thread-2' }]))],
  ...Object.keys(validRecord).map((field) => [`missing ${field}`, JSON.stringify(envelope([
    Object.fromEntries(Object.entries(validRecord).filter(([name]) => name !== field)),
  ]))]),
  ...[
    { tenantKey: '../other' }, { threadId: 42 }, { reportId: 'Invalid' }, { profile: 'octave' },
    { schemaVersion: 2 }, { schemaVersion: '1' },
    { createdAt: 'yesterday' }, { createdAt: '2026-02-30T00:00:00.000Z' },
    { createdAt: '2026-09-06T00:00:00Z' }, { filePath: '/tmp/forged' },
  ].map((change) => [`invalid record ${JSON.stringify(change)}`, JSON.stringify(envelope([{ ...validRecord, ...change }]))]),
];

for (const [name, contents] of invalidStores) {
  test(`invalid persisted store ${name} fails closed and is never overwritten`, async (context) => {
    const { store, filePath } = await fixture(context);
    await fs.mkdir(path.dirname(filePath));
    await fs.writeFile(filePath, contents);
    const before = await snapshot(filePath);
    for (const candidate of [store, createReportEvidencePolicyStore({ filePath })]) {
      await assert.rejects(candidate.get(REQUEST), { code: 'CODEX_REPORT_POLICY_STORE_INVALID', status: 503 });
      await assert.rejects(candidate.bind(REQUEST), { code: 'CODEX_REPORT_POLICY_STORE_INVALID', status: 503 });
    }
    assert.deepEqual(await snapshot(filePath), before);
    assert.deepEqual(await fs.readdir(path.dirname(filePath)), ['codex-report-policies.json']);
  });
}

for (const code of ['EACCES', 'EIO', 'EISDIR']) {
  test(`read failure ${code} does not become an empty store or overwrite existing bytes`, async (context) => {
    const { store, filePath } = await fixture(context);
    await store.bind(REQUEST);
    const before = await snapshot(filePath);
    await withMock(context, 'readFile', async () => { throw Object.assign(new Error('Injected read failure'), { code }); }, async () => {
      for (const candidate of [store, createReportEvidencePolicyStore({ filePath })]) {
        for (const operation of ['get', 'bind']) {
          await assert.rejects(candidate[operation](REQUEST), errorWithCause('CODEX_REPORT_POLICY_STORE_READ_FAILED', code));
        }
      }
    });
    assert.deepEqual(await snapshot(filePath), before);
    assert.equal((await store.get(REQUEST)).profile, PROFILE);
  });
}

test('a previously observed store cannot silently reset after deletion or corruption', async (context) => {
  const { store, filePath } = await fixture(context);
  await store.bind(REQUEST);
  await fs.writeFile(filePath, '{');
  await assert.rejects(store.bind({ ...REQUEST, reportId: 'report-0002' }), { code: 'CODEX_REPORT_POLICY_STORE_INVALID' });
  assert.equal(await fs.readFile(filePath, 'utf8'), '{');
  await fs.unlink(filePath);
  for (const operation of ['get', 'bind']) {
    await assert.rejects(store[operation](REQUEST), errorWithCause('CODEX_REPORT_POLICY_STORE_READ_FAILED', 'ENOENT'));
  }
});

test('concurrent calls serialize binding, conflict detection and reads without poisoning the queue', async (context) => {
  const { store, filePath } = await fixture(context);
  const operations = [store.bind(REQUEST), store.bind(REQUEST), store.get(REQUEST),
    store.bind({ ...REQUEST, threadId: 'wrong-thread' }),
    ...Array.from({ length: 20 }, (_, index) => store.bind({ ...REQUEST, reportId: `report-next-${index}` })),
    store.get(REQUEST)];
  const outcomes = await Promise.allSettled(operations);
  assert.equal(outcomes[3].status, 'rejected');
  assert.equal(outcomes[3].reason.code, 'CODEX_REPORT_POLICY_CONFLICT');
  assert.ok(outcomes.every((outcome, index) => index === 3 || outcome.status === 'fulfilled'));
  for (const index of [1, 2, outcomes.length - 1]) assert.deepEqual(outcomes[index].value, outcomes[0].value);
  const saved = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.equal(saved.bindings.length, 21);
  const reloaded = createReportEvidencePolicyStore({ filePath });
  for (const record of saved.bindings) {
    assert.deepEqual(await reloaded.get({ tenantKey: record.tenantKey, threadId: record.threadId, reportId: record.reportId }), record);
  }
});

test('queued requests capture caller values before later mutation', async (context) => {
  const { store } = await fixture(context);
  const input = { ...REQUEST };
  const pending = store.bind(input);
  input.threadId = 'changed-thread';
  input.profile = 'octave';
  assert.deepEqual(await pending, await store.get(REQUEST));
});

test('a failed first commit leaves no binding and permits a later retry', async (context) => {
  const { store, filePath } = await fixture(context);
  await withMock(context, 'rename', async () => {
    throw Object.assign(new Error('Injected first commit failure'), { code: 'EIO' });
  }, async () => {
    await assert.rejects(store.bind(REQUEST), errorWithCause('CODEX_REPORT_POLICY_STORE_WRITE_FAILED', 'EIO'));
  });
  await assert.rejects(fs.stat(filePath), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(path.dirname(filePath)), []);
  assert.equal(await store.get(REQUEST), null);
  assert.equal(await createReportEvidencePolicyStore({ filePath }).get(REQUEST), null);
  assert.equal((await store.bind(REQUEST)).reportId, REQUEST.reportId);
});

test('partial temporary writes do not corrupt the original or poison later queued binds', async (context) => {
  const { store, filePath } = await fixture(context);
  const originalRecord = await store.bind(REQUEST);
  const before = await snapshot(filePath);
  const originalOpen = fs.open;
  let injected = false;
  let failedTemporary;
  const failing = { ...REQUEST, reportId: 'report-failed' };
  const succeeding = { ...REQUEST, reportId: 'report-later' };
  await withMock(context, 'open', async (...args) => {
    const handle = await originalOpen(...args);
    if (!injected) {
      injected = true;
      failedTemporary = args[0];
      const originalWrite = handle.writeFile.bind(handle);
      handle.writeFile = async (contents) => {
        await originalWrite(contents.slice(0, 20));
        assert.deepEqual(await snapshot(filePath), before);
        throw Object.assign(new Error('Injected partial write failure'), { code: 'ENOSPC' });
      };
    } else {
      assert.deepEqual(await snapshot(filePath), before);
      await assert.rejects(fs.stat(failedTemporary), { code: 'ENOENT' });
    }
    return handle;
  }, async () => {
    const outcomes = await Promise.allSettled([store.bind(failing), store.bind(succeeding)]);
    assert.equal(outcomes[0].status, 'rejected');
    assert.ok(errorWithCause('CODEX_REPORT_POLICY_STORE_WRITE_FAILED', 'ENOSPC')(outcomes[0].reason));
    assert.equal(outcomes[1].status, 'fulfilled');
  });
  assert.equal(await store.get(failing), null);
  assert.deepEqual(await store.get(REQUEST), originalRecord);
  assert.equal((await store.get(succeeding)).reportId, succeeding.reportId);
  assert.deepEqual(await fs.readdir(path.dirname(filePath)), ['codex-report-policies.json']);
});

for (const stage of ['mkdir', 'open', 'chmod', 'writeFile', 'sync', 'close', 'rename']) {
  test(`write failure at ${stage} preserves original bytes, cleans owned temporary files and allows retry`, async (context) => {
    const { store, filePath } = await fixture(context);
    await store.bind(REQUEST);
    const before = await snapshot(filePath);
    const fail = () => { throw Object.assign(new Error(`Injected ${stage} failure`), { code: 'EIO' }); };
    const method = ['mkdir', 'open', 'rename'].includes(stage) ? stage : 'open';
    const originalOpen = fs.open;
    const replacement = method === stage ? fail : async (...args) => {
      const handle = await originalOpen(...args);
      const original = handle[stage].bind(handle);
      let failed = false;
      handle[stage] = async (...values) => {
        if (!failed) { failed = true; return fail(); }
        return original(...values);
      };
      return handle;
    };
    await withMock(context, method, replacement, async () => {
      await assert.rejects(store.bind({ ...REQUEST, reportId: 'report-next' }),
        errorWithCause('CODEX_REPORT_POLICY_STORE_WRITE_FAILED', 'EIO'));
    });
    assert.deepEqual(await snapshot(filePath), before);
    assert.deepEqual(await fs.readdir(path.dirname(filePath)), ['codex-report-policies.json']);
    assert.equal(await store.get({ ...REQUEST, reportId: 'report-next' }), null);
    assert.equal(await createReportEvidencePolicyStore({ filePath }).get({ ...REQUEST, reportId: 'report-next' }), null);
    assert.equal((await store.bind({ ...REQUEST, reportId: 'report-next' })).reportId, 'report-next');
  });
}

test('atomic replacement keeps the old complete document visible until rename and uses exclusive private temporary files', async (context) => {
  const { store, filePath } = await fixture(context);
  await store.bind(REQUEST);
  const before = await snapshot(filePath);
  const originalRename = fs.rename;
  await withMock(context, 'rename', async (temporary, target) => {
    assert.equal(target, filePath);
    assert.equal(path.dirname(temporary), path.dirname(filePath));
    assert.notEqual(temporary, filePath);
    assert.equal((await fs.stat(temporary)).mode & 0o777, 0o600);
    assert.deepEqual(await snapshot(filePath), before);
    assert.equal(JSON.parse(await fs.readFile(temporary, 'utf8')).bindings.length, 2);
    await originalRename(temporary, target);
  }, () => store.bind({ ...REQUEST, reportId: 'report-next' }));
  const originalOpen = fs.open;
  let collisionPath;
  await withMock(context, 'open', async (temporary, flags, mode) => {
    assert.equal(flags, 'wx');
    assert.equal(mode, 0o600);
    collisionPath = temporary;
    await fs.writeFile(temporary, 'unowned temporary sentinel');
    return originalOpen(temporary, flags, mode);
  }, async () => {
    await assert.rejects(store.bind({ ...REQUEST, reportId: 'report-third' }),
      errorWithCause('CODEX_REPORT_POLICY_STORE_WRITE_FAILED', 'EEXIST'));
  });
  assert.equal(await fs.readFile(collisionPath, 'utf8'), 'unowned temporary sentinel');
  assert.equal(JSON.parse(await fs.readFile(filePath, 'utf8')).bindings.length, 2);
});

async function fixture(context) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'report-evidence-policy-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, '.runtime', 'codex-report-policies.json');
  return { root, filePath, store: createReportEvidencePolicyStore({ filePath }) };
}

function envelope(bindings) {
  return { schema: 'codex-report-evidence-policies', schemaVersion: 1, bindings };
}

function errorWithCause(code, causeCode) {
  return (error) => {
    assert.equal(error.code, code);
    assert.equal(error.status, 503);
    assert.equal(error.cause.code, causeCode);
    return true;
  };
}

async function snapshot(filePath) {
  const contents = await fs.readFile(filePath);
  const info = await fs.stat(filePath);
  return { sha256: createHash('sha256').update(contents).digest('hex'), bytes: info.size,
    ino: info.ino, mode: info.mode, mtimeMs: info.mtimeMs };
}

async function withMock(context, method, replacement, operation) {
  const mocked = context.mock.method(fs, method, replacement);
  syncBuiltinESMExports();
  try {
    return await operation();
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
  }
}
