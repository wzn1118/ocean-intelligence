import assert from 'node:assert/strict';
import test from 'node:test';

import { createMcpTenantToken, verifyMcpTenantToken } from './mcp-tenant-token.mjs';

test('signs short-lived owner-bound MCP tenant claims', () => {
  const token = createMcpTenantToken({ ownerId: 'user-a', threadId: 'thread-a', secret: 'secret', now: 1000, ttlSeconds: 60, nonce: 'fixed' });
  const claims = verifyMcpTenantToken(token, 'secret', 1050);
  assert.equal(claims.sub, 'user-a');
  assert.equal(claims.tid, 'thread-a');
  assert.equal(claims.exp, 1060);
});

test('rejects tampered and expired MCP tenant claims', () => {
  const token = createMcpTenantToken({ ownerId: 'user-a', threadId: 'thread-a', secret: 'secret', now: 1000, ttlSeconds: 10, nonce: 'fixed' });
  assert.throws(() => verifyMcpTenantToken(`${token}x`, 'secret', 1001), /signature/);
  assert.throws(() => verifyMcpTenantToken(token, 'secret', 1011), /expired/);
});
