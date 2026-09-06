#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { createInterface } = require('node:readline');

const root = process.env.REPORT_STATUS_FAKE_ROOT;
if (!root || !process.argv.includes('app-server') || !process.argv.includes('--stdio')) {
  throw new Error('This synthetic protocol fixture only runs inside report-status HTTP tests.');
}
const statePath = path.join(root, 'fake-codex-state.json');
const logPath = path.join(root, 'fake-protocol.jsonl');
const policyPath = path.join(process.cwd(), '.runtime', 'codex-report-policies.json');
const state = fs.existsSync(statePath)
  ? JSON.parse(fs.readFileSync(statePath, 'utf8'))
  : { nextThread: 1, nextTurn: 1, threads: {} };

function save() {
  fs.writeFileSync(statePath, JSON.stringify(state));
}

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ id, result })}\n`);
}

createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => {
  const message = JSON.parse(line);
  const params = message.params || {};
  const policyBindings = message.method === 'turn/start' && fs.existsSync(policyPath)
    ? JSON.parse(fs.readFileSync(policyPath, 'utf8')).bindings : null;
  fs.appendFileSync(logPath, `${JSON.stringify({ method: message.method, params, policyBindings })}\n`);
  if (message.id == null) return;
  if (message.method === 'initialize') {
    respond(message.id, { userAgent: 'report-status-fake-app-server; synthetic protocol only' });
  } else if (message.method === 'mcpServerStatus/list') {
    respond(message.id, { data: [] });
  } else if (message.method === 'thread/start') {
    const id = `http-fixture-thread-${state.nextThread++}`;
    const thread = { id, cwd: params.cwd, status: { type: 'idle' }, turns: [] };
    state.threads[id] = thread;
    save();
    respond(message.id, { thread });
  } else if (message.method === 'thread/read' || message.method === 'thread/resume') {
    const thread = state.threads[params.threadId];
    if (!thread) {
      process.stdout.write(`${JSON.stringify({ id: message.id, error: { code: -32001, message: 'Unknown synthetic thread' } })}\n`);
      return;
    }
    respond(message.id, { thread: params.includeTurns ? thread : { ...thread, turns: [] } });
  } else if (message.method === 'turn/start') {
    const thread = state.threads[params.threadId];
    if (!thread) throw new Error('Unknown synthetic turn target');
    const turn = { id: `http-fixture-turn-${state.nextTurn++}`, status: 'completed', items: [] };
    thread.turns.push(turn);
    save();
    respond(message.id, { turn });
  } else {
    process.stdout.write(`${JSON.stringify({ id: message.id, error: { code: -32601, message: 'Method not implemented by synthetic fixture' } })}\n`);
  }
}).on('close', () => process.exit(0));
