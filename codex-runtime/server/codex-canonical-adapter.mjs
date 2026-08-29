const CAPABILITY_METHODS = Object.freeze({
  initialize: ['initialize'],
  threads: ['thread/list', 'thread/read', 'thread/start', 'thread/resume'],
  turns: ['turn/start', 'turn/steer', 'turn/interrupt'],
  approvals: ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval', 'item/tool/call'],
  models: ['model/list'],
  mcp: ['mcpServerStatus/list', 'mcpServer/tool/call', 'mcpServer/resource/read'],
  skills: ['skills/list'],
  plugins: ['plugin/list', 'plugin/read', 'plugin/install', 'plugin/uninstall'],
  filesystem: ['fs/readFile', 'fs/writeFile', 'fs/readDirectory', 'fs/getMetadata'],
  terminal: ['process/spawn', 'process/writeStdin', 'process/resizePty', 'process/kill'],
  settings: ['config/read', 'config/value/write'],
  account: ['account/read'],
  remoteControl: ['remoteControl/enable', 'remoteControl/disable', 'remoteControl/status/read'],
});

const CANONICAL_METHODS = Object.freeze({
  'threads.list': 'thread/list',
  'threads.read': 'thread/read',
  'threads.start': 'thread/start',
  'threads.resume': 'thread/resume',
  'turns.start': 'turn/start',
  'turns.steer': 'turn/steer',
  'turns.interrupt': 'turn/interrupt',
  'models.list': 'model/list',
  'mcp.list': 'mcpServerStatus/list',
  'mcp.callTool': 'mcpServer/tool/call',
  'mcp.readResource': 'mcpServer/resource/read',
  'skills.list': 'skills/list',
  'plugins.list': 'plugin/list',
  'plugins.read': 'plugin/read',
  'files.read': 'fs/readFile',
  'files.write': 'fs/writeFile',
  'files.list': 'fs/readDirectory',
  'terminal.spawn': 'process/spawn',
  'terminal.write': 'process/writeStdin',
  'settings.read': 'config/read',
  'settings.write': 'config/value/write',
  'account.read': 'account/read',
});

export function createCodexCanonicalAdapter({
  transport,
  hostId = 'local',
  protocolVersion = 'unknown',
  supportedMethods = null,
  protocolEvidence = null,
  getRuntimeVersion = null,
} = {}) {
  if (!transport || typeof transport.sendRaw !== 'function') throw new Error('Codex app-server transport is required.');
  const knownMethods = new Set(Object.values(CAPABILITY_METHODS).flat());
  const legacyObservedMethods = supportedMethods == null ? null : new Set([...supportedMethods].map((method) => String(method)));
  const schemaMethods = protocolEvidence?.state === 'ready'
    ? new Set((protocolEvidence.methods?.all || []).map(String))
    : null;
  const livePassedMethods = new Set((protocolEvidence?.probes?.passed || []).map(String));
  const liveFailedMethods = new Set((protocolEvidence?.probes?.failed || []).map(String));

  function capabilities() {
    const evidenceDetail = inspectEvidence();
    const observedMethods = evidenceDetail.state === 'matched'
      ? (schemaMethods || legacyObservedMethods)
      : null;
    const supports = (methods) => {
      if (!observedMethods) return 'unknown';
      return methods.every((method) => observedMethods.has(method)) ? 'supported' : 'unsupported';
    };
    const capabilityEvidence = Object.fromEntries(Object.entries(CAPABILITY_METHODS).map(([name, methods]) => {
      const passed = methods.filter((method) => livePassedMethods.has(method));
      const failed = methods.filter((method) => liveFailedMethods.has(method));
      return [name, {
        state: supports(methods),
        methods,
        liveVerification: passed.length === methods.length
          ? 'full'
          : passed.length > 0
            ? 'partial'
            : 'schema-only',
        passed,
        failed,
      }];
    }));
    return {
      schemaVersion: 1,
      hostId,
      protocolVersion: evidenceDetail.expectedVersion || protocolVersion,
      methods: [...knownMethods].sort(),
      capabilities: Object.fromEntries(Object.entries(CAPABILITY_METHODS).map(([name, methods]) => [name, supports(methods)])),
      capabilityEvidence,
      evidence: evidenceDetail.label,
      evidenceDetail,
    };
  }

  function supports(capability) {
    return capabilities().capabilities[String(capability || '')] === 'supported';
  }

  function toRawRequest({ id, method, params = {} } = {}) {
    const canonicalMethod = String(method || '').trim();
    const rawMethod = CANONICAL_METHODS[canonicalMethod] || canonicalMethod;
    if (!rawMethod) throw new Error('Canonical app-server method is required.');
    return { id: id == null ? `canonical-${Date.now()}` : id, method: rawMethod, params };
  }

  async function request(request, options = {}) {
    return transport.request(toRawRequest(request), options);
  }

  function normalizeInbound(message) {
    if (message?.id != null && message?.method == null) {
      return { kind: 'response', id: message.id, result: message.result, error: message.error, raw: message };
    }
    if (message?.id != null && typeof message?.method === 'string') {
      return { kind: 'server-request', id: message.id, method: message.method, params: message.params, raw: message };
    }
    if (typeof message?.method === 'string') {
      return { kind: 'notification', method: message.method, params: message.params, raw: message };
    }
    return { kind: 'unknown', raw: message };
  }

  function fromLegacyMessage(message) {
    const type = String(message?.type || '');
    if (type === 'mcp-request' || type === 'thread-prewarm-start') return message.request || null;
    if (type === 'mcp-notification') return message.request || null;
    if (type === 'mcp-response') return message.response || null;
    return null;
  }

  function inspectEvidence() {
    if (schemaMethods) {
      const expectedVersion = String(protocolEvidence.protocolVersion || protocolVersion || 'unknown');
      const runtimeValue = typeof getRuntimeVersion === 'function' ? getRuntimeVersion() : '';
      const actualVersion = extractProtocolVersion(runtimeValue);
      if (!actualVersion) {
        return evidenceDetail('pending-runtime', 'protocol-evidence-pending-runtime', expectedVersion, null);
      }
      if (expectedVersion !== 'unknown' && actualVersion !== expectedVersion) {
        return evidenceDetail('mismatch', 'protocol-evidence-mismatch', expectedVersion, actualVersion);
      }
      return evidenceDetail('matched', protocolEvidence.source || 'generated-schema', expectedVersion, actualVersion);
    }
    if (legacyObservedMethods) {
      return {
        state: 'matched',
        label: 'schema-or-probe',
        expectedVersion: protocolVersion,
        actualVersion: null,
        source: 'in-memory-method-set',
        schemaPath: null,
        probePath: null,
        schemaSha256: null,
      };
    }
    return {
      state: 'unavailable',
      label: 'declarative-only',
      expectedVersion: protocolVersion,
      actualVersion: null,
      source: 'none',
      schemaPath: null,
      probePath: null,
      schemaSha256: null,
    };
  }

  function evidenceDetail(state, label, expectedVersion, actualVersion) {
    return {
      state,
      label,
      expectedVersion,
      actualVersion,
      source: protocolEvidence.source,
      schemaPath: protocolEvidence.schemaPath,
      probePath: protocolEvidence.probePath,
      schemaSha256: protocolEvidence.schemaSha256,
    };
  }

  return Object.freeze({
    capabilities,
    supports,
    toRawRequest,
    request,
    normalizeInbound,
    fromLegacyMessage,
    canonicalMethods: CANONICAL_METHODS,
  });
}

export function extractProtocolVersion(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const version = text.match(/(?:^|\/)(\d+\.\d+\.\d+(?:-[^\s()]+)?)/u)?.[1];
  return version || (/^\d+\.\d+\.\d+/u.test(text) ? text : null);
}

export { CAPABILITY_METHODS, CANONICAL_METHODS };
