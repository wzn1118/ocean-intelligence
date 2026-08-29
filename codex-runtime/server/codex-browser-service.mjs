import { randomUUID } from 'node:crypto';
import { createCodexAppServerTransport } from './codex-app-server-transport.mjs';
import { createCodexCanonicalAdapter } from './codex-canonical-adapter.mjs';

const MAX_EVENTS = 10_000;

export function createCodexBrowserService({
  executablePath,
  workspaceRoot,
  sqliteHome = process.env.CODEX_SQLITE_HOME || null,
  contextMcp = null,
  contextMcps = null,
  modelProvider = null,
  dynamicToolHandler = null,
  dynamicMcpCacheMs = 60_000,
  protocolEvidence = null,
  spawnProcess,
}) {
  const configuredContextMcps = normalizeContextMcps(contextMcps ?? (contextMcp ? [contextMcp] : []));
  let sequence = 0;
  let events = [];
  let connectionPublished = false;
  let dynamicMcpCatalog = null;
  let dynamicMcpCatalogAt = 0;
  let dynamicMcpCatalogError = '';
  const dynamicNamespaces = new Map();
  const dynamicFunctions = new Map();
  const dynamicToolStats = { calls: 0, completed: 0, failed: 0 };
  const pendingRequests = new Map();
  const transport = createCodexAppServerTransport({
    executablePath,
    workspaceRoot,
    sqliteHome,
    contextMcps: configuredContextMcps,
    modelProvider,
    ...(spawnProcess ? { spawnProcess } : {}),
  });
  const adapter = createCodexCanonicalAdapter({
    transport,
    hostId: 'local',
    protocolVersion: protocolEvidence?.protocolVersion || 'unknown',
    protocolEvidence,
    getRuntimeVersion: () => transport.status().appServerVersion,
  });

  function publish(message, sessionId = null) {
    sequence += 1;
    events.push({ sequence, sessionId, message });
    if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);
  }

  function handleProtocolMessage(message) {
    if (message?.id != null && message?.method == null) {
      const request = pendingRequests.get(String(message.id));
      pendingRequests.delete(String(message.id));
      publish({
        type: 'mcp-response',
        hostId: 'local',
        requestMethod: request?.method || '',
        message,
      }, request?.sessionId || null);
      return;
    }
    if (message?.id != null && typeof message?.method === 'string') {
      const approvalMeta = message.params?._meta;
      const trustedMcpApproval = message.method === 'mcpServer/elicitation/request'
        && approvalMeta?.codex_approval_kind === 'mcp_tool_call'
        && configuredContextMcps.some((server) => server.name === message.params?.serverName);
      if (trustedMcpApproval) {
        publish({
          type: 'mcp-auto-approved',
          hostId: 'local',
          request: message,
        });
        transport.sendRaw({ id: message.id, result: { action: 'accept', content: {} } });
        return;
      }
      if (message.method === 'item/tool/call' && dynamicNamespaces.size > 0) {
        void handleDynamicToolCall(message);
        return;
      }
      publish({
        type: 'mcp-request',
        hostId: 'local',
        request: message,
      });
      return;
    }
    if (typeof message?.method === 'string') {
      publish({
        type: 'mcp-notification',
        hostId: 'local',
        method: message.method,
        params: message.params,
        ...(message.emittedAtMs == null ? {} : { emittedAtMs: message.emittedAtMs }),
      });
    }
  }

  async function start() {
    const wasInitialized = transport.status().initialized;
    const result = await transport.start();
    if (wasInitialized || connectionPublished) return result;
    connectionPublished = true;
    publish({
      type: 'codex-app-server-initialized',
      hostId: 'local',
      appServerVersion: transport.status().appServerVersion || 'unknown',
      installedCodexVersion: String(result?.userAgent || ''),
    });
    publish({ type: 'codex-app-server-connection-changed', hostId: 'local', state: 'connected' });
    try {
      await loadDynamicMcpTools();
      dynamicMcpCatalogError = '';
    } catch (error) {
      dynamicMcpCatalogError = String(error?.message || error);
    }
    return result;
  }

  transport.onMessage(handleProtocolMessage);
  transport.onConnection((event) => {
    if (event.state === 'connected') connectionPublished = false;
    if (event.state === 'disconnected') {
      connectionPublished = false;
      publish({ type: 'codex-app-server-connection-changed', hostId: 'local', state: 'disconnected', code: event.code, signal: event.signal });
    }
  });

  async function send(message, { sessionId = null } = {}) {
    const type = String(message?.type || '');
    if (!['mcp-request', 'thread-prewarm-start', 'mcp-notification', 'mcp-response'].includes(type)) return;
    await start();
    if (type === 'mcp-request' || type === 'thread-prewarm-start') {
      const request = message.request;
      if (!request || request.id == null || typeof request.method !== 'string') return;
      pendingRequests.set(String(request.id), { method: request.method, sessionId });
      transport.sendRaw(await withRuntimeThreadDefaults(adapter.fromLegacyMessage(message)));
      return;
    }
    if (type === 'mcp-notification' && message.request) {
      transport.sendRaw(adapter.fromLegacyMessage(message));
      return;
    }
    if (type === 'mcp-response' && message.response) transport.sendRaw(adapter.fromLegacyMessage(message));
  }

  async function request(method, params = {}, { timeoutMs } = {}) {
    await start();
    return transport.request(await withRuntimeThreadDefaults(adapter.toRawRequest({
      id: `browser-service-${randomUUID()}`,
      method,
      params,
    })), timeoutMs == null ? {} : { timeoutMs });
  }

  async function withRuntimeThreadDefaults(request) {
    if (!request || !['thread/start', 'thread/resume'].includes(request.method)) return request;
    const runtimeProvider = transport.status().modelProvider;
    const dynamicTools = request.method === 'thread/start' ? await loadDynamicMcpTools() : null;
    return {
      ...request,
      params: {
        ...(request.params || {}),
        ...(runtimeProvider?.configured ? {
          modelProvider: runtimeProvider.id,
          model: runtimeProvider.model,
          ...(request.method === 'thread/start' ? { allowProviderModelFallback: false } : {}),
        } : {}),
        ...(dynamicTools?.length ? { dynamicTools } : {}),
      },
    };
  }

  async function loadDynamicMcpTools() {
    if (dynamicMcpCatalog && Date.now() - dynamicMcpCatalogAt < dynamicMcpCacheMs) return dynamicMcpCatalog;
    const result = await transport.request({
      id: `dynamic-mcp-catalog-${randomUUID()}`,
      method: 'mcpServerStatus/list',
      params: {},
    });
    dynamicNamespaces.clear();
    dynamicFunctions.clear();
    const usedNamespaces = new Set();
    const specs = [];
    for (const server of result?.data || []) {
      const serverName = String(server?.name || '').trim();
      const tools = Object.values(server?.tools || {}).filter((tool) => tool?.name);
      if (!serverName || !tools.length) continue;
      const namespace = uniqueNamespace(serverName, usedNamespaces);
      usedNamespaces.add(namespace);
      dynamicNamespaces.set(namespace, serverName);
      const namespaceTools = tools.map((tool) => {
        const dynamicName = String(tool.name).replace(/[^A-Za-z0-9_-]+/gu, '_');
        dynamicFunctions.set(`${namespace}:${dynamicName}`, { server: serverName, tool: String(tool.name), namespace });
        return {
          type: 'function',
          name: dynamicName,
          description: String(tool.description || `Call ${serverName}.${tool.name}.`),
          inputSchema: tool.inputSchema && typeof tool.inputSchema === 'object'
            ? tool.inputSchema
            : { type: 'object', properties: {} },
          deferLoading: !CORE_DYNAMIC_TOOLS.has(String(tool.name)),
        };
      });
      specs.push({
        type: 'namespace',
        name: namespace,
        description: `Tools provided by the ${serverName} MCP server.`,
        tools: namespaceTools,
      });
    }
    dynamicMcpCatalog = specs;
    dynamicMcpCatalogAt = Date.now();
    dynamicMcpCatalogError = '';
    return specs;
  }

  async function handleDynamicToolCall(message) {
    dynamicToolStats.calls += 1;
    const params = message.params || {};
    const namespace = String(params.namespace || '');
    const requestedTool = String(params.tool || '');
    const flattened = dynamicFunctions.get(`${namespace}:${requestedTool}`) || dynamicFunctions.get(requestedTool);
    const server = flattened?.server || dynamicNamespaces.get(namespace);
    const tool = flattened?.tool || requestedTool;
    const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
    try {
      if (!server || !tool) throw new Error(`Unknown dynamic MCP tool: ${namespace}.${tool}`);
      const internal = typeof dynamicToolHandler === 'function'
        ? await dynamicToolHandler({ server, namespace, tool, arguments: args, threadId: params.threadId, turnId: params.turnId, callId: params.callId })
        : null;
      const result = internal?.handled
        ? internal.value
        : await transport.request({
            id: `dynamic-mcp-call-${randomUUID()}`,
            method: 'mcpServer/tool/call',
            params: { threadId: params.threadId, server, tool, arguments: args },
          }, { timeoutMs: 180_000 });
      transport.sendRaw({
        id: message.id,
        result: {
          contentItems: dynamicToolContentItems(result),
          success: result?.isError !== true,
        },
      });
      dynamicToolStats.completed += 1;
    } catch (error) {
      dynamicToolStats.failed += 1;
      transport.sendRaw({
        id: message.id,
        result: {
          contentItems: [{ type: 'inputText', text: `MCP tool failed: ${String(error?.message || error)}` }],
          success: false,
        },
      });
    }
  }

  function listEvents({ after = 0, sessionId = null } = {}) {
    return events
      .filter((event) => event.sequence > after && (!event.sessionId || event.sessionId === sessionId))
      .map(({ sequence: eventSequence, message }) => ({ sequence: eventSequence, message }));
  }

  function status() {
    return {
      ...transport.status(),
      sequence,
      adapter: adapter.capabilities(),
      dynamicMcp: {
        namespaces: [...dynamicNamespaces.entries()].map(([namespace, server]) => ({ namespace, server })),
        tools: dynamicMcpCatalog?.length || 0,
        catalogReady: Array.isArray(dynamicMcpCatalog),
        catalogError: dynamicMcpCatalogError,
        ...dynamicToolStats,
      },
    };
  }

  async function close() {
    await transport.close();
  }

  return { start, send, request, listEvents, status, close, transport, adapter };
}

const CORE_DYNAMIC_TOOLS = new Set([
  'ocean_product_health',
  'ocean_list_regions',
  'ocean_resolve_marine_area',
  'ocean_data_catalog',
  'ocean_data_search',
  'ocean_data_page',
  'ocean_mcp_coverage',
]);

function uniqueNamespace(serverName, used) {
  const preferred = String(serverName || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, '_')
    .replace(/^_+|_+$/gu, '') || 'mcp';
  let candidate = preferred;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${preferred}_${suffix++}`;
  return candidate;
}

function dynamicToolContentItems(value) {
  const content = Array.isArray(value?.content) ? value.content : null;
  if (content?.length) {
    return content.flatMap((item) => {
      if (item?.type === 'text') return [{ type: 'inputText', text: String(item.text || '') }];
      if (item?.type === 'image' && item.data && item.mimeType) return [{ type: 'inputImage', imageUrl: `data:${item.mimeType};base64,${item.data}` }];
      if (item?.type === 'audio' && item.data && item.mimeType) return [{ type: 'inputAudio', audioUrl: `data:${item.mimeType};base64,${item.data}` }];
      return [{ type: 'inputText', text: JSON.stringify(item) }];
    });
  }
  const output = value?.structuredContent ?? value;
  return [{ type: 'inputText', text: typeof output === 'string' ? output : JSON.stringify(output ?? null) }];
}


function normalizeContextMcp(value) {
  if (!value || typeof value !== 'object') return null;
  const name = String(value.name || 'xhs-context').trim();
  const url = String(value.url || '').trim();
  const token = String(value.token || '');
  const bearerTokenEnvVar = String(value.bearerTokenEnvVar || 'XHS_CONTEXT_TOKEN').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(name) || !/^https?:\/\/[^\s]+$/i.test(url) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(bearerTokenEnvVar) || !token) return null;
  return { name, url, token, bearerTokenEnvVar };
}

function normalizeContextMcps(value) {
  const values = Array.isArray(value) ? value : [];
  const names = new Set();
  return values.map(normalizeContextMcp).filter((server) => {
    if (!server || names.has(server.name)) return false;
    names.add(server.name);
    return true;
  });
}
