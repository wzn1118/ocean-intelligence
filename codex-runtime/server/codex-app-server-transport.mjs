import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync } from 'node:fs';

const INITIALIZATION_TIMEOUT_MS = 60_000;

export function createCodexAppServerTransport({
  executablePath,
  workspaceRoot,
  sqliteHome = process.env.CODEX_SQLITE_HOME || null,
  contextMcp = null,
  contextMcps = null,
  modelProvider = null,
  clientInfo = { name: 'codex-browser-host', version: '1.0.0' },
  capabilities = { experimentalApi: true },
  initializationTimeoutMs = INITIALIZATION_TIMEOUT_MS,
  spawnProcess = spawn,
}) {
  const configuredContextMcps = normalizeContextMcps(contextMcps ?? (contextMcp ? [contextMcp] : []));
  const configuredModelProvider = normalizeModelProvider(modelProvider);
  let child = null;
  let starting = null;
  let initialized = false;
  let appServerVersion = '';
  let stderrTail = [];
  const internalRequests = new Map();
  const messageListeners = new Set();
  const connectionListeners = new Set();

  function onMessage(listener) {
    messageListeners.add(listener);
    return () => messageListeners.delete(listener);
  }

  function onConnection(listener) {
    connectionListeners.add(listener);
    return () => connectionListeners.delete(listener);
  }

  function emitMessage(message) {
    for (const listener of messageListeners) listener(message);
  }

  function emitConnection(event) {
    for (const listener of connectionListeners) listener(event);
  }

  function sendRaw(message) {
    if (!child?.stdin?.writable) {
      const error = new Error('Codex app-server stdin is unavailable.');
      error.code = 'CODEX_APP_SERVER_STDIN_UNAVAILABLE';
      throw error;
    }
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function request(message, { timeoutMs = INITIALIZATION_TIMEOUT_MS } = {}) {
    if (message?.id == null) throw new Error('Codex app-server request id is required.');
    const id = String(message.id);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        internalRequests.delete(id);
        const error = new Error(`Codex app-server request timed out: ${message.method || id}`);
        error.code = 'CODEX_APP_SERVER_REQUEST_TIMEOUT';
        reject(error);
      }, timeoutMs);
      internalRequests.set(id, {
        resolve: (result) => { clearTimeout(timeout); resolve(result); },
        reject: (error) => { clearTimeout(timeout); reject(error); },
      });
      try {
        sendRaw(message);
      } catch (error) {
        clearTimeout(timeout);
        internalRequests.delete(id);
        reject(error);
      }
    });
  }

  function handleMessage(message) {
    if (message?.id != null && message?.method == null && internalRequests.has(String(message.id))) {
      const pending = internalRequests.get(String(message.id));
      internalRequests.delete(String(message.id));
      if (message.error) {
        const error = new Error(message.error.message || 'Codex app-server request failed.');
        error.code = message.error.code;
        error.details = message.error.data;
        pending.reject(error);
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    emitMessage(message);
  }

  async function start() {
    if (child && initialized) return { userAgent: appServerVersion };
    if (starting) return starting;
    starting = (async () => {
      let process = null;
      try {
        if (sqliteHome) mkdirSync(sqliteHome, { recursive: true });
        const appServerArgs = [
          '-c',
          'features.code_mode_host=true',
          ...modelProviderOverrides(configuredModelProvider),
          ...contextMcpOverrides(configuredContextMcps),
          'app-server',
          '--stdio',
        ];
        const environment = { ...globalThis.process.env };
        if (sqliteHome) environment.CODEX_SQLITE_HOME = sqliteHome;
        else delete environment.CODEX_SQLITE_HOME;
        for (const server of configuredContextMcps) environment[server.bearerTokenEnvVar] = server.token;
        if (configuredModelProvider) environment[configuredModelProvider.apiKeyEnvVar] = configuredModelProvider.apiKey;
        process = spawnProcess(executablePath, appServerArgs, {
          cwd: workspaceRoot,
          env: environment,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        child = process;
        initialized = false;
        appServerVersion = '';
        const lines = createInterface({ input: process.stdout, crlfDelay: Infinity });
        lines.on('line', (line) => {
          const text = String(line || '').trim();
          if (!text) return;
          try {
            handleMessage(JSON.parse(text));
          } catch {
            appendStderr(`stdout: ${text}`);
          }
        });
        process.stderr.on('data', (chunk) => {
          for (const line of String(chunk).split(/\r?\n/u).filter(Boolean)) appendStderr(line);
        });
      process.once('exit', (code, signal) => {
        if (child !== process) return;
        child = null;
        initialized = false;
        const detail = stderrTail.slice(-5).join('\n');
        const error = new Error(`Codex app-server exited${code == null ? '' : ` with code ${code}`}.${detail ? `\n${detail}` : ''}`);
        error.code = 'CODEX_APP_SERVER_EXITED';
        for (const pending of internalRequests.values()) pending.reject(error);
        internalRequests.clear();
        emitConnection({ state: 'disconnected', code, signal });
      });
        process.once('error', (error) => {
          appendStderr(error?.message || error);
          if (child !== process) return;
          for (const pending of internalRequests.values()) pending.reject(error);
          internalRequests.clear();
        });

        // Current app-server connects its stdio transport asynchronously. Sending
        // initialize in the same tick can be dropped before ConnectionId(0) exists.
        await new Promise((resolve) => setTimeout(resolve, 750));

        const requestId = `app-server-init-${randomUUID()}`;
        const result = await request({
          id: requestId,
          method: 'initialize',
          params: { clientInfo, capabilities },
        }, { timeoutMs: initializationTimeoutMs });
        if (process !== child) throw new Error('Codex app-server restarted during initialization.');
        sendRaw({ method: 'initialized', params: {} });
        appServerVersion = String(result?.userAgent || '');
        initialized = true;
        emitConnection({ state: 'connected', result });
        return result;
      } catch (error) {
        if (process && child === process) {
          child = null;
          initialized = false;
          appServerVersion = '';
          terminateProcess(process);
        }
        emitConnection({ state: 'error', code: error?.code || null, message: String(error?.message || error) });
        throw error;
      }
    })().finally(() => {
      starting = null;
    });
    return starting;
  }

  function status() {
    return {
      transport: 'stdio-jsonl',
      running: Boolean(child),
      initialized,
      pid: child?.pid || null,
      appServerVersion,
      stderrTail: stderrTail.slice(-10),
      contextMcp: configuredContextMcps[0] ? {
        configured: true,
        name: configuredContextMcps[0].name,
        endpoint: configuredContextMcps[0].url,
      } : { configured: false },
      contextMcps: configuredContextMcps.map((server) => ({ configured: true, name: server.name, endpoint: server.url })),
      modelProvider: configuredModelProvider ? {
        configured: true,
        id: configuredModelProvider.id,
        name: configuredModelProvider.name,
        endpoint: configuredModelProvider.baseUrl,
        model: configuredModelProvider.model,
        wireApi: 'responses',
      } : { configured: false },
    };
  }

  async function close() {
    const process = child;
    child = null;
    initialized = false;
    appServerVersion = '';
    if (!process) return;
    terminateProcess(process);
  }

  return Object.freeze({ start, request, sendRaw, onMessage, onConnection, status, close });

  function appendStderr(value) {
    stderrTail.push(String(value));
    if (stderrTail.length > 50) stderrTail = stderrTail.slice(-50);
  }

  function terminateProcess(process) {
    try { process.stdin.end(); } catch { /* process is already closing */ }
    try { process.kill(); } catch { /* process has already exited */ }
  }
}

export function normalizeContextMcp(value) {
  if (!value || typeof value !== 'object') return null;
  const name = String(value.name || 'xhs-context').trim();
  const url = String(value.url || '').trim();
  const token = String(value.token || '');
  const bearerTokenEnvVar = String(value.bearerTokenEnvVar || 'XHS_CONTEXT_TOKEN').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(name) || !/^https?:\/\/[^\s]+$/i.test(url) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(bearerTokenEnvVar) || !token) return null;
  return { name, url, token, bearerTokenEnvVar };
}

export function normalizeContextMcps(value) {
  const values = Array.isArray(value) ? value : [];
  const normalized = [];
  const names = new Set();
  for (const item of values) {
    const server = normalizeContextMcp(item);
    if (!server || names.has(server.name)) continue;
    names.add(server.name);
    normalized.push(server);
  }
  return normalized;
}

export function normalizeModelProvider(value) {
  if (!value || typeof value !== 'object') return null;
  const id = String(value.id || 'xhs_product_api').trim();
  const name = String(value.name || 'Product API').trim();
  const baseUrl = String(value.baseUrl || '').replace(/\/+$/u, '');
  const model = String(value.model || '').trim();
  const apiKey = String(value.apiKey || '');
  const apiKeyEnvVar = String(value.apiKeyEnvVar || 'XHS_CODEX_MODEL_BRIDGE_TOKEN').trim();
  if (!/^[A-Za-z0-9_-]+$/u.test(id)
    || !name
    || !/^https?:\/\/[^\s]+$/iu.test(baseUrl)
    || !model
    || !apiKey
    || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(apiKeyEnvVar)) return null;
  return { id, name, baseUrl, model, apiKey, apiKeyEnvVar };
}

function contextMcpOverrides(contextMcps) {
  return contextMcps.flatMap((contextMcp) => [
    '-c',
    `mcp_servers.${contextMcp.name}.url=${JSON.stringify(contextMcp.url)}`,
    '-c',
    `mcp_servers.${contextMcp.name}.bearer_token_env_var=${JSON.stringify(contextMcp.bearerTokenEnvVar)}`,
  ]);
}

function modelProviderOverrides(modelProvider) {
  if (!modelProvider) return [];
  const prefix = `model_providers.${modelProvider.id}`;
  return [
    '-c',
    `model_provider=${JSON.stringify(modelProvider.id)}`,
    '-c',
    `model=${JSON.stringify(modelProvider.model)}`,
    '-c',
    `${prefix}.name=${JSON.stringify(modelProvider.name)}`,
    '-c',
    `${prefix}.base_url=${JSON.stringify(modelProvider.baseUrl)}`,
    '-c',
    `${prefix}.wire_api=${JSON.stringify('responses')}`,
    '-c',
    `${prefix}.env_key=${JSON.stringify(modelProvider.apiKeyEnvVar)}`,
    '-c',
    `${prefix}.requires_openai_auth=false`,
  ];
}
