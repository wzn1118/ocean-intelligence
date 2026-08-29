import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { createCodexGitWorkerService } from './codex-git-worker-service.mjs';

const MAX_OBSERVED_MESSAGES = 500;
const DEFAULT_RESULT_CACHE_SIZE = 1_000;
const DEFAULT_RESULT_TTL_MS = 2 * 60_000;
const COMMAND_ID = /^[A-Za-z0-9._:-]{1,160}$/u;

const RECIPE_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'persisted-atoms', state: 'implemented', messageTypes: ['persisted-atom-sync-request', 'persisted-atom-update'] }),
  Object.freeze({ id: 'fetch', state: 'implemented', messageTypes: ['fetch'] }),
  Object.freeze({ id: 'shared-objects', state: 'implemented', messageTypes: ['shared-object-set', 'shared-object-subscribe'] }),
  Object.freeze({ id: 'context-menu', state: 'browser-native', bridgeMethods: ['showContextMenu'], messageTypes: [] }),
  Object.freeze({ id: 'file-path', state: 'secure-browser-null', bridgeMethods: ['getPathForFile'], messageTypes: [] }),
  Object.freeze({ id: 'file-drag', state: 'browser-unavailable', bridgeMethods: ['startFileDrag'], messageTypes: [] }),
  Object.freeze({ id: 'worker', state: 'implemented-core', bridgeMethods: ['sendWorkerMessageFromView', 'subscribeToWorkerMessages'], workerIds: ['git'], messageTypes: ['worker-request', 'worker-request-cancel'] }),
  Object.freeze({ id: 'dialog', state: 'not-in-current-preload', bridgeMethods: [], messageTypes: [] }),
  Object.freeze({ id: 'clipboard', state: 'not-in-current-preload', bridgeMethods: [], messageTypes: [] }),
]);

export function createCodexHostCommandService(options = {}) {
  return new CodexHostCommandService(options);
}

export class CodexHostCommandService {
  constructor({
    config = {},
    codexBrowserService,
    relayService,
    workspaceService,
    workerService,
    now = () => Date.now(),
    resultCacheSize = DEFAULT_RESULT_CACHE_SIZE,
    resultTtlMs = DEFAULT_RESULT_TTL_MS,
  } = {}) {
    this.config = config;
    this.codexBrowserService = codexBrowserService;
    this.relayService = relayService;
    this.workspaceService = workspaceService;
    this.workerService = workerService || createCodexGitWorkerService({
      workspaceRoot: config.workspaceRoot || config.projectRoot || process.cwd(),
      worktreeRoot: config.codexWorktreeRoot,
    });
    this.now = now;
    this.resultCacheSize = Math.max(1, Number(resultCacheSize) || DEFAULT_RESULT_CACHE_SIZE);
    this.resultTtlMs = Math.max(1_000, Number(resultTtlMs) || DEFAULT_RESULT_TTL_MS);
    this.observedMessages = [];
    this.results = new Map();
    this.state = createHostState(config, workspaceService);
    this.stats = {
      commandRequests: 0,
      commandsExecuted: 0,
      commandErrors: 0,
      deduplicatedCommands: 0,
      workspaceThreadStarts: 0,
    };
  }

  capabilities() {
    return {
      methods: ['host.message.send', 'host.worker.send'],
      recipes: RECIPE_DEFINITIONS.map((recipe) => ({
        ...recipe,
        ...(recipe.bridgeMethods ? { bridgeMethods: [...recipe.bridgeMethods] } : {}),
        ...(recipe.workerIds ? { workerIds: [...recipe.workerIds] } : {}),
        messageTypes: [...recipe.messageTypes],
      })),
      workers: this.workerService?.capabilities?.() || null,
      idempotency: {
        key: 'commandId',
        scope: 'relay-session',
        ttlMs: this.resultTtlMs,
      },
    };
  }

  status() {
    this._cleanupResults();
    return {
      schemaVersion: 1,
      ...this.stats,
      cachedResults: this.results.size,
      observedMessageTypes: this.observedMessageTypes(),
      workers: this.workerService?.status?.() || null,
      workspace: this.workspaceService?.status?.() || { available: false },
      capabilities: this.capabilities(),
    };
  }

  observedMessageTypes() {
    return [...new Set(this.observedMessages.map((entry) => entry.type).filter(Boolean))];
  }

  async sendRelay(relaySessionId, {
    commandId,
    connectionToken,
    browserInstanceId,
    leaseEpoch,
    message,
  } = {}) {
    if (!this.relayService?.send) throw hostCommandError('CODEX_HOST_COMMAND_RELAY_UNAVAILABLE', 'Codex Relay command transport is unavailable.', 503);
    return this._executeOnce(`relay:${String(relaySessionId || '')}`, commandId, () => this.relayService.send(relaySessionId, {
      connectionToken,
      browserInstanceId,
      leaseEpoch,
      message,
    }, (payload) => this._forward(payload)));
  }

  async sendStream(streamId, {
    relaySessionId,
    commandId,
    leaseEpoch,
    message,
  } = {}) {
    if (!this.relayService?.sendStreamMessage) throw hostCommandError('CODEX_HOST_COMMAND_STREAM_UNAVAILABLE', 'Codex Host RPC command transport is unavailable.', 503);
    return this._executeOnce(`relay:${String(relaySessionId || '')}`, commandId, () => this.relayService.sendStreamMessage(streamId, {
      leaseEpoch,
      message,
    }, (payload) => this._forward(payload)));
  }

  async sendLegacy({ sessionId, commandId, message } = {}) {
    return this._executeOnce(`legacy:${String(sessionId || 'anonymous')}`, commandId, () => this._forward({
      sessionId: String(sessionId || ''),
      message,
      relaySession: null,
    }));
  }

  async sendWorkerRelay(relaySessionId, {
    commandId,
    connectionToken,
    browserInstanceId,
    leaseEpoch,
    workerId,
    message,
  } = {}) {
    if (!this.relayService?.send) throw hostCommandError('CODEX_HOST_COMMAND_RELAY_UNAVAILABLE', 'Codex Relay worker transport is unavailable.', 503);
    return this._executeOnce(`worker:relay:${String(relaySessionId || '')}`, commandId, () => this.relayService.send(relaySessionId, {
      connectionToken,
      browserInstanceId,
      leaseEpoch,
      message,
    }, (payload) => this._forwardWorker(workerId, payload)));
  }

  async sendWorkerStream(streamId, {
    relaySessionId,
    commandId,
    leaseEpoch,
    workerId,
    message,
  } = {}) {
    if (!this.relayService?.sendStreamMessage) throw hostCommandError('CODEX_HOST_COMMAND_STREAM_UNAVAILABLE', 'Codex Host RPC worker transport is unavailable.', 503);
    return this._executeOnce(`worker:relay:${String(relaySessionId || '')}`, commandId, () => this.relayService.sendStreamMessage(streamId, {
      leaseEpoch,
      message,
    }, (payload) => this._forwardWorker(workerId, payload)));
  }

  async sendWorkerLegacy({ sessionId, commandId, workerId, message } = {}) {
    return this._executeOnce(`worker:legacy:${String(sessionId || 'anonymous')}`, commandId, () => this._forwardWorker(workerId, {
      sessionId: String(sessionId || ''),
      message,
    }));
  }

  async startWorkspaceThread(projectId) {
    const id = String(projectId || '').trim();
    const project = this.workspaceService?.project?.(id);
    if (!project?.id || !Array.isArray(project.rootPaths) || !project.rootPaths[0]) {
      throw hostCommandError('CODEX_WORKSPACE_NOT_FOUND', 'The requested Codex workspace was not found.', 404);
    }
    if (typeof this.codexBrowserService?.request !== 'function') {
      throw hostCommandError('CODEX_WORKSPACE_THREAD_UNAVAILABLE', 'The Codex browser runtime is unavailable.', 503);
    }
    const workspaceRoot = path.resolve(project.rootPaths[0]);
    const writable = project.metadata?.writable === true;
    const jobId = String(project.metadata?.jobId || '').trim();
    const developerInstructions = [
      this.workspaceService?.developerInstructions?.() || '',
      `This browser-owned task is attached to the ${project.kind === 'source' ? 'product source' : 'historical product task'} workspace: ${project.name}.`,
      jobId
        ? `Use codex-product MCP resources for job ${jobId} before drawing conclusions from its artifacts.`
        : 'Inspect, run, test, and modify the product source directly in this workspace when requested.',
      writable
        ? 'You may make source changes in this workspace when the user asks for implementation.'
        : 'Treat this historical artifact workspace as read-only evidence. Make implementation changes in the product source workspace.',
    ].filter(Boolean).join('\n');
    this.stats.workspaceThreadStarts += 1;
    const result = await this.codexBrowserService.request('threads.start', {
      cwd: workspaceRoot,
      runtimeWorkspaceRoots: [workspaceRoot],
      developerInstructions,
      sandbox: writable ? 'workspace-write' : 'read-only',
      ephemeral: false,
    });
    const threadName = project.kind === 'source'
      ? `${project.name} - Browser task`
      : `${project.name} - Analysis`;
    if (result?.thread?.id) {
      await this.codexBrowserService.request('thread/name/set', {
        threadId: result.thread.id,
        name: threadName,
      });
    }
    return {
      accepted: true,
      project: {
        id: project.id,
        kind: project.kind,
        name: project.name,
        writable,
        ...(jobId ? { jobId } : {}),
      },
      thread: result?.thread ? { ...result.thread, name: threadName } : null,
      model: result?.model || null,
      modelProvider: result?.modelProvider || null,
      cwd: result?.cwd || workspaceRoot,
    };
  }

  hostEvents(message) {
    return hostEventsForMessage(message, this.config, this.state);
  }

  async _executeOnce(scope, rawCommandId, operation) {
    const commandId = normalizeCommandId(rawCommandId);
    this.stats.commandRequests += 1;
    this._cleanupResults();
    if (!commandId) return this._execute(operation);
    const key = `${scope}\u0000${commandId}`;
    const cached = this.results.get(key);
    if (cached) {
      this.stats.deduplicatedCommands += 1;
      return cached.promise;
    }
    const entry = {
      expiresAt: this._nowMs() + this.resultTtlMs,
      promise: this._execute(operation),
    };
    this.results.set(key, entry);
    while (this.results.size > this.resultCacheSize) this.results.delete(this.results.keys().next().value);
    return entry.promise;
  }

  async _execute(operation) {
    this.stats.commandsExecuted += 1;
    try {
      return await operation();
    } catch (error) {
      this.stats.commandErrors += 1;
      throw error;
    }
  }

  async _forward({ sessionId, message }) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      throw hostCommandError('CODEX_HOST_COMMAND_MESSAGE_INVALID', 'Host command message must be a JSON object.');
    }
    this.observedMessages.push({
      type: String(message.type || ''),
      message,
      receivedAt: new Date(this._nowMs()).toISOString(),
    });
    if (this.observedMessages.length > MAX_OBSERVED_MESSAGES) {
      this.observedMessages.splice(0, this.observedMessages.length - MAX_OBSERVED_MESSAGES);
    }
    try {
      await this.codexBrowserService?.send?.(message, { sessionId });
    } catch (error) {
      error.code ||= 'CODEX_RELAY_ADAPTER_UNAVAILABLE';
      error.status ||= 503;
      throw error;
    }
    return {
      accepted: true,
      events: this.hostEvents(message),
    };
  }

  async _forwardWorker(workerId, { sessionId, message }) {
    if (!this.workerService?.handleMessage) {
      throw hostCommandError('CODEX_GIT_WORKER_UNAVAILABLE', 'Codex Git worker service is unavailable.', 503);
    }
    return this.workerService.handleMessage(String(workerId || ''), message, { sessionId });
  }

  _cleanupResults() {
    const now = this._nowMs();
    for (const [key, entry] of this.results) {
      if (entry.expiresAt <= now) this.results.delete(key);
    }
  }

  _nowMs() {
    const value = this.now();
    const milliseconds = value instanceof Date ? value.getTime() : Number(value);
    if (!Number.isFinite(milliseconds)) throw hostCommandError('CODEX_HOST_COMMAND_CLOCK_INVALID', 'Host command clock returned an invalid value.', 500);
    return milliseconds;
  }
}

function createHostState(config, workspaceService) {
  const workspaceRoot = path.resolve(config.workspaceRoot || config.projectRoot || process.cwd());
  const workspaceName = path.basename(workspaceRoot);
  const workspaceProjectId = `browser-${createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 16)}`;
  const workspaceProject = {
    id: workspaceProjectId,
    name: workspaceName,
    rootPaths: [workspaceRoot],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const workspace = workspaceService?.hostState?.() || {
    source: workspaceProject,
    history: [],
    projects: { [workspaceProjectId]: workspaceProject },
    projectOrder: [workspaceProjectId],
    selectedProject: { type: 'local', projectId: workspaceProjectId },
    activeWorkspaceRoots: [workspaceRoot],
    workspaceRoots: [workspaceRoot],
    workspaceRootLabels: { [workspaceRoot]: workspaceName },
    selectedProjectRoot: workspaceRoot,
  };
  return {
    configuration: new Map(),
    global: new Map([
      ['active-workspace-roots', workspace.activeWorkspaceRoots],
      ['electron-saved-workspace-roots', workspace.workspaceRoots],
      ['electron-workspace-root-labels', workspace.workspaceRootLabels],
      ['local-projects', workspace.projects],
      ['project-order', workspace.projectOrder],
      ['selected-project', workspace.selectedProject],
    ]),
    persistedAtoms: {},
    settings: new Map(),
    workspaceName,
    workspaceProjectId,
    workspaceRoot,
    workspaceService,
  };
}

function hostEventsForMessage(message, config, state) {
  const type = String(message?.type || '');
  if (type === 'persisted-atom-sync-request') {
    return [{
      type: 'persisted-atom-sync',
      state: { ...(state.persistedAtoms || {}) },
      canWritePrimaryWindowTabPersistence: true,
    }];
  }
  if (type === 'persisted-atom-update' && message.key) {
    if (message.deleted) delete state.persistedAtoms[message.key];
    else state.persistedAtoms[message.key] = message.value;
    return [];
  }
  if (type === 'fetch') {
    const requestUrl = String(message.url || '');
    const route = requestUrl.startsWith('vscode://codex/') ? requestUrl.slice('vscode://codex/'.length) : requestUrl;
    let params = {};
    try {
      params = message.body ? JSON.parse(message.body) : {};
    } catch {
      params = {};
    }
    return [{
      type: 'fetch-response',
      responseType: 'success',
      requestId: message.requestId,
      status: 200,
      headers: { 'content-type': 'application/json' },
      bodyJsonString: JSON.stringify(fetchBodyForRoute(route, params, config, state)),
    }];
  }
  if (type === 'shared-object-set' && message.key) {
    return [{ type: 'shared-object-updated', key: message.key, value: message.value }];
  }
  if (type === 'shared-object-subscribe' && message.key === 'host_config') {
    return [{
      type: 'shared-object-updated',
      key: 'host_config',
      value: { id: 'local', display_name: 'Local', kind: 'local' },
    }];
  }
  return [];
}

function fetchBodyForRoute(route, params, config, state) {
  const workspace = currentWorkspaceState(state);
  const workspaceRoot = workspace.selectedProjectRoot || state.workspaceRoot;
  const workspaceName = workspace.source?.name || state.workspaceName;
  const codexHome = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
  switch (route) {
    case 'active-workspace-roots':
      return workspace.activeWorkspaceRoots;
    case 'workspace-root-options':
      return {
        roots: workspace.workspaceRoots,
        labels: workspace.workspaceRootLabels,
        canonicalPathByRoot: Object.fromEntries(workspace.workspaceRoots.map((root) => [root, root])),
      };
    case 'codex-home':
      return { codexHome, worktreesSegment: path.join(codexHome, 'worktrees') };
    case 'projectless-workspace-root':
      return { workspaceRoot };
    case 'projectless-thread-cwd':
      return { cwd: workspaceRoot, outputDirectory: workspaceRoot, workspaceRoot };
    case 'mcp-codex-config':
      return { config: {} };
    case 'worktree-shell-environment-config':
      return { shellEnvironment: null };
    case 'developer-instructions':
      return { instructions: state.workspaceService?.developerInstructions?.() || '' };
    case 'git-origins':
      return { origins: [] };
    case 'auto-deny-some-permissions':
      return { permissions: params?.permissions || [] };
    case 'home-directory':
      return { homeDirectory: os.homedir() };
    case 'os-info':
      return {
        platform: process.platform,
        osVersion: os.version(),
        osRelease: os.release(),
        isSystemBackdropSupported: false,
        isVsCodeRunningInsideWsl: false,
        windowsAccountType: null,
      };
    case 'locale-info':
      return { ideLocale: 'zh-CN', systemLocale: Intl.DateTimeFormat().resolvedOptions().locale };
    case 'is-packaged':
      return { isPackaged: true };
    case 'is-copilot-api-available':
      return { available: false };
    case 'get-copilot-api-proxy-info':
      return null;
    case 'get-global-state':
      return { value: globalStateValue(String(params?.key || ''), state, workspace) };
    case 'set-global-state':
      setGlobalState(String(params?.key || ''), params?.value, state, workspace);
      return { success: true };
    case 'get-configuration':
      return { value: state.configuration.get(String(params?.key || '')) ?? null };
    case 'set-configuration':
      state.configuration.set(String(params?.key || ''), params?.value);
      return { success: true };
    case 'get-setting':
      return { value: state.settings.get(String(params?.key || '')) ?? null };
    case 'get-settings':
      return { configuredValues: Object.fromEntries(state.settings), values: Object.fromEntries(state.settings) };
    case 'set-setting':
      state.settings.set(String(params?.key || ''), params?.value);
      return { success: true };
    case 'queued-follow-up-send-lock-acquire':
      return { acquired: true };
    case 'queued-follow-up-send-lock-release':
      return { success: true };
    default:
      return null;
  }
}

function currentWorkspaceState(state) {
  const fresh = state.workspaceService?.hostState?.(state.global.get('selected-project')?.projectId);
  if (fresh) {
    state.global.set('active-workspace-roots', fresh.activeWorkspaceRoots);
    state.global.set('electron-saved-workspace-roots', fresh.workspaceRoots);
    state.global.set('electron-workspace-root-labels', fresh.workspaceRootLabels);
    state.global.set('local-projects', fresh.projects);
    state.global.set('project-order', fresh.projectOrder);
    state.global.set('selected-project', fresh.selectedProject);
    return fresh;
  }
  return {
    source: null,
    history: [],
    projects: state.global.get('local-projects') || {},
    projectOrder: state.global.get('project-order') || [],
    selectedProject: state.global.get('selected-project'),
    activeWorkspaceRoots: state.global.get('active-workspace-roots') || [state.workspaceRoot],
    workspaceRoots: state.global.get('electron-saved-workspace-roots') || [state.workspaceRoot],
    workspaceRootLabels: state.global.get('electron-workspace-root-labels') || { [state.workspaceRoot]: state.workspaceName },
    selectedProjectRoot: state.workspaceRoot,
  };
}

function globalStateValue(key, state, workspace) {
  if (key === 'active-workspace-roots') return workspace.activeWorkspaceRoots;
  if (key === 'electron-saved-workspace-roots') return workspace.workspaceRoots;
  if (key === 'electron-workspace-root-labels') return workspace.workspaceRootLabels;
  if (key === 'local-projects') return workspace.projects;
  if (key === 'project-order') return workspace.projectOrder;
  if (key === 'selected-project') return workspace.selectedProject;
  return state.global.get(key) ?? null;
}

function setGlobalState(key, value, state, workspace) {
  if (key === 'selected-project' && value && typeof value === 'object') {
    const projectId = String(value.projectId || '');
    if (workspace.projects?.[projectId]) {
      state.global.set('selected-project', { type: 'local', projectId });
      return;
    }
  }
  if (key === 'active-workspace-roots' || key === 'electron-saved-workspace-roots' || key === 'local-projects' || key === 'project-order') return;
  state.global.set(key, value);
}

function normalizeCommandId(value) {
  if (value == null || value === '') return '';
  const commandId = String(value).trim();
  if (!COMMAND_ID.test(commandId)) throw hostCommandError('CODEX_HOST_COMMAND_ID_INVALID', 'Host command id is invalid.');
  return commandId;
}

function hostCommandError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

export { RECIPE_DEFINITIONS };
