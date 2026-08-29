import { createHash, createHmac } from 'node:crypto';

const [, , ownerId, threadId] = process.argv;
const secret = String(process.env.OCEAN_CODEX_TENANT_SECRET || '');
const baseUrl = String(process.env.OCEAN_CODEX_SMOKE_URL || 'http://127.0.0.1:8011/api/codex-runtime');

if (!ownerId || !threadId || !secret) {
  console.error('Usage: recovery-smoke.mjs <owner-id> <thread-id>');
  process.exit(2);
}

async function request(method, signaturePath, urlPath, body) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secret)
    .update(`${ownerId}\n${method}\n${signaturePath}\n${timestamp}`)
    .digest('hex');
  const response = await fetch(`${baseUrl}/${urlPath}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-ocean-codex-user': ownerId,
      'x-ocean-codex-timestamp': timestamp,
      'x-ocean-codex-signature': signature,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, payload: await response.json() };
}

const listed = await request('GET', 'threads', 'threads?limit=30');
const summary = (listed.payload.data || listed.payload.threads || []).find((thread) => thread.id === threadId);
const restored = await request('POST', `threads/${threadId}/resume`, `threads/${threadId}/resume`, {});
const turns = restored.payload.thread?.turns || [];
const itemCount = turns.reduce((total, turn) => total + (turn.items?.length || 0), 0);

console.log(JSON.stringify({
  listHttp: listed.status,
  before: summary?.status || null,
  restoreHttp: restored.status,
  recovery: restored.payload.recovery || null,
  turnCount: turns.length,
  itemCount,
  lastStatus: turns.at(-1)?.status || null,
  turnFingerprint: createHash('sha256').update(JSON.stringify(turns)).digest('hex'),
}));
