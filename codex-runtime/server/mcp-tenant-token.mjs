import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export function createMcpTenantToken({ ownerId, threadId, secret, ttlSeconds = 60, now = Math.floor(Date.now() / 1000), nonce }) {
  if (!ownerId || !secret) throw new Error('MCP tenant owner and secret are required.');
  const payload = Buffer.from(JSON.stringify({
    sub: String(ownerId),
    tid: String(threadId || ''),
    aud: 'ocean-intelligence-mcp',
    iat: now,
    exp: now + ttlSeconds,
    nonce: nonce || createHash('sha256').update(`${ownerId}\n${threadId}\n${now}\n${Math.random()}`).digest('hex').slice(0, 24),
  })).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyMcpTenantToken(token, secret, now = Math.floor(Date.now() / 1000)) {
  const [payload, signature] = String(token || '').split('.', 2);
  if (!payload || !signature || !secret) throw new Error('MCP tenant token is invalid.');
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== signatureBuffer.length || !timingSafeEqual(expectedBuffer, signatureBuffer)) throw new Error('MCP tenant token signature is invalid.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (claims.aud !== 'ocean-intelligence-mcp' || !claims.sub || Number(claims.exp || 0) < now) throw new Error('MCP tenant token is expired or out of scope.');
  return claims;
}
