import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMatlabMcpServer } from './server.mjs';

const identifier = 'b0ca6dd2-8ef8-4dfb-a7be-28a50951085d';

async function withClient(callback, overrides = {}) {
  const calls = [];
  const executor = Object.fromEntries(['execute', 'status', 'artifacts'].map((method) => [method, async (arguments_) => {
    calls.push({ method, arguments_ });
    return { request_id: identifier, status: 'submitted_native_pending', native_verified: false };
  }]));
  const server = createMatlabMcpServer({ ...executor, ...overrides });
  const client = new Client({ name: 'matlab-mcp-test', version: '1.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { await callback(client, calls); } finally { await client.close(); await server.close(); }
}

test('SDK handshake publishes actual execution, status and artifact tools with safety hints', async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name), ['matlab_execute', 'matlab_status', 'matlab_artifacts']);
    assert.equal(tools[0].annotations.readOnlyHint, false);
    assert.equal(tools[0].annotations.idempotentHint, false);
    assert.equal(tools[1].annotations.readOnlyHint, true);
    assert.equal(tools[2].annotations.readOnlyHint, false);
    assert.match(tools[0].description, /public/);
  });
});

test('MATLAB source reaches executor unchanged and submission remains unverified', async () => {
  await withClient(async (client, calls) => {
    const code = 'values = [1 2 3];\ndisp(mean(values));';
    const response = await client.callTool({ name: 'matlab_execute', arguments: { code, input_json: '{"values":[1,2,3]}' } });
    assert.equal(response.isError, false);
    assert.equal(response.structuredContent.native_verified, false);
    assert.equal(calls[0].arguments_.code, code);
    assert.equal(calls[0].arguments_.release, 'R2026a');
    assert.equal(calls[0].arguments_.input_json, '{"values":[1,2,3]}');
    assert.deepEqual(JSON.parse(response.content[0].text), response.structuredContent);
  });
});

for (const arguments_ of [{}, { code: 2 }, { code: '' }, { code: 'disp(1)', release: 'Octave' },
  { code: 'disp(1)', unexpected: true }, { code: '\u6d77'.repeat(10923) }, { code: 'disp(1)', input_json: 'x'.repeat(16385) }]) {
  test(`invalid execution input is rejected before dispatch (${JSON.stringify(arguments_).slice(0, 75)})`, async () => {
    await withClient(async (client, calls) => {
      const response = await client.callTool({ name: 'matlab_execute', arguments: arguments_ });
      assert.equal(response.isError, true);
      assert.equal(calls.length, 0);
    });
  });
}

for (const name of ['matlab_status', 'matlab_artifacts']) {
  test(`${name} binds the original request and optional run without an arbitrary download path`, async () => {
    await withClient(async (client, calls) => {
      await client.callTool({ name, arguments: { request_id: identifier, run_id: 12345 } });
      assert.deepEqual(calls[0].arguments_, { request_id: identifier, run_id: 12345 });
      for (const arguments_ of [{ request_id: '../other' }, { request_id: identifier, run_id: -2 },
        { request_id: identifier, output_directory: '/tmp/arbitrary' }]) {
        const response = await client.callTool({ name, arguments: arguments_ });
        assert.equal(response.isError, true);
      }
      assert.equal(calls.length, 1);
    });
  });
}

test('executor errors remain MCP tool errors without success payloads', async () => {
  await withClient(async (client) => {
    const response = await client.callTool({ name: 'matlab_execute', arguments: { code: 'disp(1)' } });
    assert.equal(response.isError, true);
    assert.equal(response.structuredContent, undefined);
    assert.equal(response.content[0].text, 'GitHub authentication unavailable');
  }, { execute: async () => { throw new Error('GitHub authentication unavailable'); } });
});
