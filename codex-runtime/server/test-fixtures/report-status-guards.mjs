import fs from 'node:fs';
import childProcess from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';

const root = process.env.REPORT_STATUS_FAKE_ROOT;
if (!root) throw new Error('report-status guards require an isolated test root');
const logPath = path.join(root, 'evidence-reads.jsonl');
const append = fs.appendFileSync.bind(fs);

function record(operation, value) {
  if (value instanceof URL) value = fileURLToPath(value);
  if (Buffer.isBuffer(value)) value = value.toString();
  if (typeof value !== 'string') return;
  const relative = path.relative(process.env.OCEAN_CODEX_WORKSPACE, path.resolve(value));
  const parts = relative.split(path.sep);
  if (parts[0] === '.runtime' && parts[1] === 'codex-users' && parts[3] === 'generated') {
    append(logPath, `${JSON.stringify({ operation, relative })}\n`);
  }
}

for (const name of ['readFileSync', 'readdirSync', 'statSync', 'lstatSync', 'existsSync', 'realpathSync', 'openSync']) {
  const original = fs[name];
  const wrapped = function (...args) {
    record(name, args[0]);
    return Reflect.apply(original, this, args);
  };
  Object.assign(wrapped, original);
  fs[name] = wrapped;
}
for (const name of ['readFile', 'readdir', 'stat', 'lstat', 'realpath', 'open']) {
  const original = fs.promises[name];
  fs.promises[name] = function (...args) {
    record(name, args[0]);
    return Reflect.apply(original, this, args);
  };
}

function forbid() {
  throw new Error('Outbound network or non-fixture process is forbidden in report-status HTTP tests');
}
globalThis.fetch = async () => forbid();
net.Socket.prototype.connect = forbid;
const originalSpawn = childProcess.spawn;
childProcess.spawn = function (executable, args, options) {
  if (executable !== process.env.OCEAN_CODEX_BIN || !args.includes('app-server') || !args.includes('--stdio')) forbid();
  return originalSpawn.call(this, executable, args, options);
};
for (const name of ['exec', 'execFile', 'execSync', 'execFileSync', 'spawnSync', 'fork']) childProcess[name] = forbid;
const originalListen = net.Server.prototype.listen;
net.Server.prototype.listen = function (port, host, ...args) {
  if (host !== '127.0.0.1' || Number(port) === 8011 || Number(port) !== Number(process.env.OCEAN_CODEX_PORT)) forbid();
  return originalListen.call(this, port, host, ...args);
};
syncBuiltinESMExports();
