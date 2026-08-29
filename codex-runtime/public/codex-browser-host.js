(function installCodexBrowserHost() {
  'use strict';

  const appSessionId = `codex-browser-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const query = new URLSearchParams(window.location.search);
  const requestedDeviceId = query.get('deviceId') || '';
  const embeddedProductRequested = query.get('embedded') === '1';
  const sharedRelaySessionId = query.get('relaySessionId') || '';
  const sharedRelayTicket = query.get('relayTicket') || '';
  const sharedRelayBrowserInstanceId = query.get('relayBrowserInstanceId') || '';
  const sharedRelayRequested = Boolean(sharedRelaySessionId && sharedRelayTicket && sharedRelayBrowserInstanceId);
  const relayBrowserInstanceId = sharedRelayRequested ? sharedRelayBrowserInstanceId : appSessionId;
  const remoteDeviceRequested = Boolean(requestedDeviceId);
  const localDeviceRequested = remoteDeviceRequested && query.get('connector') === 'local';
  const requestedDeviceLabel = localDeviceRequested ? '本机设备' : '远程设备';
  const relaySessionAttempts = remoteDeviceRequested ? 20 : 8;
  const retryableRelayStatuses = new Set([409, 500, 502, 503]);
  const observedMessages = [];
  const productWorkspace = {
    selectedProjectId: '',
    starting: false,
    lastError: '',
  };
  const relay = {
    sessionId: null,
    connectionToken: null,
    leaseEpoch: null,
    state: 'connecting',
  };
  const hostRpc = {
    protocol: 'codex-host-rpc.v1',
    version: 1,
    socket: null,
    streamId: null,
    state: 'idle',
    reconnectAttempt: 0,
    reconnectTimer: null,
    fallbackPollTimer: null,
    lastError: null,
    capabilities: [],
    recipes: [],
    pendingRequests: new Map(),
    commandsSent: 0,
    commandsCompleted: 0,
    commandErrors: 0,
    httpFallbacks: 0,
  };
  let relayRecoveryScheduled = false;
  let relayRecoveryAttempt = 0;
  let relayRecoveryTimer = null;
  let relayReady = null;
  let observedServerProcessId = null;
  let serverEpochPollTimer = null;
  let serverReloadScheduled = false;
  const sharedObjects = new Map([
    ['host_config', requestedDeviceId
      ? { id: requestedDeviceId, display_name: 'Paired device', kind: 'remote' }
      : { id: 'local', display_name: 'Local', kind: 'local' }],
    ['remote_ssh_connections', []],
    ['remote_wsl_connections', []],
    ['remote_control_connections', []],
  ]);
  const themeListeners = new Set();
  const workerListeners = new Map();
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  let lastContextMenuPoint = { x: 16, y: 16, at: 0 };
  let activeContextMenu = null;
  const sentryNoopTransport = {
    sendRendererStart() {},
    sendScope() {},
    sendEnvelope() {},
    sendStatus() {},
    sendStructuredLog() {},
    sendMetric() {},
  };

  window.addEventListener('contextmenu', (event) => {
    lastContextMenuPoint = { x: event.clientX, y: event.clientY, at: Date.now() };
  }, { capture: true });

  function dispatchHostMessage(message) {
    window.dispatchEvent(new MessageEvent('message', {
      data: message,
      origin: window.location.origin,
      source: window,
    }));
  }

  function workspaceProjectIdFromMessage(message) {
    if (message?.type !== 'fetch') return '';
    const requestUrl = String(message.url || '');
    const route = requestUrl.startsWith('vscode://codex/') ? requestUrl.slice('vscode://codex/'.length) : requestUrl;
    if (route !== 'set-global-state') return '';
    let params;
    try {
      params = message.body ? JSON.parse(message.body) : {};
    } catch {
      return '';
    }
    if (params?.key !== 'selected-project') return '';
    return String(params?.value?.projectId || '').trim();
  }

  function observeWorkspaceSelection(message) {
    const projectId = workspaceProjectIdFromMessage(message);
    if (projectId) productWorkspace.selectedProjectId = projectId;
    const atomKey = String(message?.key || '');
    const expandedPrefix = 'sidebar-project-expanded-v1-codex:';
    if (!projectId && atomKey.startsWith(expandedPrefix)) {
      productWorkspace.selectedProjectId = atomKey.slice(expandedPrefix.length);
    }
    if (!productWorkspace.selectedProjectId) return;
    queueMicrotask(ensureWorkspaceTaskAction);
  }

  function workspaceToast(message, isError = false) {
    let toast = document.getElementById('codex-product-workspace-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'codex-product-workspace-toast';
      toast.setAttribute('role', 'status');
      toast.style.cssText = [
        'position:fixed', 'right:20px', 'bottom:20px', 'z-index:2147483647',
        'max-width:min(420px,calc(100vw - 40px))', 'padding:10px 12px',
        'border:1px solid rgba(255,255,255,.18)', 'border-radius:6px',
        'box-shadow:0 12px 32px rgba(0,0,0,.36)', 'font:13px/1.4 ui-sans-serif,system-ui,sans-serif',
      ].join(';');
      document.body.append(toast);
    }
    toast.textContent = String(message || '');
    toast.style.color = isError ? '#fecaca' : '#dcfce7';
    toast.style.background = isError ? '#450a0a' : '#052e16';
    clearTimeout(workspaceToast.timer);
    workspaceToast.timer = setTimeout(() => toast?.remove(), isError ? 8_000 : 3_000);
  }

  async function startWorkspaceTask(projectId = productWorkspace.selectedProjectId) {
    const id = String(projectId || '').trim();
    if (!id || productWorkspace.starting) return null;
    productWorkspace.starting = true;
    productWorkspace.lastError = '';
    ensureWorkspaceTaskAction();
    try {
      const response = await fetch(`/api/codex-product/workspaces/${encodeURIComponent(id)}/threads`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.thread?.id) {
        throw new Error(payload?.error?.message || payload?.message || `Workspace task creation returned HTTP ${response.status}`);
      }
      // A newly started thread is not included in thread/list until its first
      // turn is persisted. Deliver the canonical notification immediately so
      // the current runtime can render and open the task without a reload.
      dispatchHostMessage({
        type: 'mcp-notification',
        hostId: 'local',
        method: 'thread/started',
        params: { thread: payload.thread },
      });
      workspaceToast('Workspace task created. It is ready for your first instruction.');
      return payload;
    } catch (error) {
      productWorkspace.lastError = String(error?.message || error);
      workspaceToast(`Could not create workspace task: ${productWorkspace.lastError}`, true);
      throw error;
    } finally {
      productWorkspace.starting = false;
      ensureWorkspaceTaskAction();
    }
  }

  function ensureWorkspaceTaskAction() {
    const projectId = productWorkspace.selectedProjectId;
    if (!projectId.startsWith('product-')) return;
    const editButton = [...document.querySelectorAll('button')].find((button) => /edit project/i.test(button.textContent || ''));
    if (!editButton) return;
    const container = editButton.closest('[role="dialog"]') || editButton.parentElement?.parentElement || editButton.parentElement;
    if (!container || container.querySelector('[data-codex-product-workspace-action]')) return;
    const action = document.createElement('button');
    action.type = 'button';
    action.dataset.codexProductWorkspaceAction = 'true';
    action.textContent = productWorkspace.starting ? 'Creating task...' : 'Start task';
    action.title = 'Create an interactive Codex task for this product workspace';
    action.style.cssText = editButton?.style?.cssText || '';
    action.className = editButton?.className || '';
    action.addEventListener('click', () => void startWorkspaceTask(projectId));
    if (editButton.parentElement) editButton.parentElement.insertBefore(action, editButton);
    else container.append(action);
  }

  function ensureEmptyWorkspaceActions() {
    if (!document.getElementById('codex-product-empty-action-styles')) {
      const style = document.createElement('style');
      style.id = 'codex-product-empty-action-styles';
      style.textContent = `
        [data-codex-product-empty-action] { opacity: 1 !important; cursor: pointer; font-size: 0 !important; }
        [data-codex-product-empty-action]::after { content: 'Start task'; font-size: 14px; color: inherit; }
        [data-codex-product-empty-action]:focus-visible { outline: 2px solid currentColor; outline-offset: -2px; }
      `;
      document.head.append(style);
    }
    const lists = document.querySelectorAll('[data-app-action-sidebar-project-list-id^="product-"]');
    for (const list of lists) {
      const empty = [...list.children].find((child) => child.textContent?.trim() === 'No chats');
      if (!empty || empty.dataset.codexProductEmptyAction === 'true') continue;
      const projectId = String(list.dataset.appActionSidebarProjectListId || '').trim();
      const projectItem = list.closest('[role="listitem"]');
      const projectLabel = String(projectItem?.getAttribute('aria-label') || projectId).trim();
      empty.dataset.codexProductEmptyAction = 'true';
      empty.setAttribute('role', 'button');
      empty.setAttribute('tabindex', '0');
      empty.setAttribute('aria-label', `Start task in ${projectLabel}`);
      const activate = (event) => {
        event.preventDefault();
        event.stopPropagation();
        productWorkspace.selectedProjectId = projectId;
        void startWorkspaceTask(projectId);
      };
      empty.addEventListener('click', activate);
      empty.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') activate(event);
      });
    }
  }

  const workspaceMutationObserver = new MutationObserver(() => {
    ensureWorkspaceTaskAction();
    ensureEmptyWorkspaceActions();
  });
  workspaceMutationObserver.observe(document.documentElement, { childList: true, subtree: true });

  function publishRelayConnectionState(state) {
    const hostId = requestedDeviceId || 'local';
    dispatchHostMessage({ type: 'codex-app-server-connection-changed', hostId, state });
    if (state === 'connected') {
      dispatchHostMessage({
        type: 'codex-app-server-initialized',
        hostId,
        appServerVersion: '0.0.0',
        installedCodexVersion: '26.803.81509',
      });
    }
    if (typeof window.codexLocalConnector?.syncRelayState === 'function') {
      window.codexLocalConnector.syncRelayState();
    }
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function checkServerEpoch() {
    if (serverReloadScheduled) return;
    try {
      const response = await fetch('/api/health', { credentials: 'include', cache: 'no-store' });
      if (!response.ok) return;
      const health = await response.json();
      const processId = Number(health?.pid) || null;
      if (!processId) return;
      if (observedServerProcessId === null) {
        observedServerProcessId = processId;
        return;
      }
      if (processId === observedServerProcessId) return;
      serverReloadScheduled = true;
      window.location.reload();
    } catch {
      // A temporary outage is expected during a local backend restart. The
      // next successful poll compares process identities and reloads once.
    }
  }

  function relayHeaders() {
    return relay.connectionToken ? { 'X-Codex-Relay-Connection': relay.connectionToken } : {};
  }

  function publishHostRpcState() {
    window.__codexHostRpc = {
      protocol: hostRpc.protocol,
      version: hostRpc.version,
      state: hostRpc.state,
      streamId: hostRpc.streamId,
      cursor: eventCursor,
      reconnectAttempt: hostRpc.reconnectAttempt,
      fallbackPolling: Boolean(hostRpc.fallbackPollTimer),
      capabilities: [...hostRpc.capabilities],
      recipes: hostRpc.recipes.map((recipe) => ({ ...recipe })),
      pendingRequests: hostRpc.pendingRequests.size,
      commandsSent: hostRpc.commandsSent,
      commandsCompleted: hostRpc.commandsCompleted,
      commandErrors: hostRpc.commandErrors,
      httpFallbacks: hostRpc.httpFallbacks,
      error: hostRpc.lastError,
    };
  }

  async function initializeRelaySession() {
    try {
      const createBody = JSON.stringify({
        mode: 'semantic',
        ...(requestedDeviceId ? { deviceId: requestedDeviceId } : {}),
        browserSessionId: appSessionId,
        browserInstanceId: relayBrowserInstanceId,
        requestedCapabilities: ['thread.read', 'thread.write', 'turn.start', 'approval.respond', 'artifact.read'],
      });
      let created;
      if (sharedRelayRequested) {
        created = {
          session: { id: sharedRelaySessionId },
          ticket: { value: sharedRelayTicket },
        };
      } else {
        let createdResponse = null;
        let createFailure = null;
        for (let attempt = 0; attempt < relaySessionAttempts; attempt += 1) {
          try {
            createdResponse = await fetch('/api/codex-relay/sessions', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: createBody,
            });
            if (createdResponse.ok || !retryableRelayStatuses.has(createdResponse.status) || attempt === relaySessionAttempts - 1) break;
          } catch (error) {
            createFailure = error;
            if (attempt === relaySessionAttempts - 1) throw error;
          }
          await delay(Math.min(1_000, 250 * (attempt + 1)));
        }
        if (!createdResponse) throw createFailure || new Error('Relay session creation did not return a response.');
        if (!createdResponse.ok) throw new Error(`Session creation returned HTTP ${createdResponse.status}`);
        created = await createdResponse.json();
      }
      let connectedResponse = null;
      let connectFailure = null;
      for (let attempt = 0; attempt < relaySessionAttempts; attempt += 1) {
        try {
          connectedResponse = await fetch(`/api/codex-relay/sessions/${encodeURIComponent(created.session.id)}/connect`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticket: created.ticket.value, browserInstanceId: relayBrowserInstanceId }),
          });
          if (connectedResponse.ok || !retryableRelayStatuses.has(connectedResponse.status) || attempt === relaySessionAttempts - 1) break;
        } catch (error) {
          connectFailure = error;
          if (attempt === relaySessionAttempts - 1) throw error;
        }
        await delay(Math.min(1_000, 250 * (attempt + 1)));
      }
      if (!connectedResponse) throw connectFailure || new Error('Relay session connection did not return a response.');
      if (!connectedResponse.ok) throw new Error(`Session connection returned HTTP ${connectedResponse.status}`);
      const connected = await connectedResponse.json();
      relay.sessionId = created.session.id;
      relay.connectionToken = connected.connectionToken;
      relay.leaseEpoch = connected.lease.epoch;
      relay.state = 'connected';
      window.__codexRelay = {
        sessionId: relay.sessionId,
        state: relay.state,
        leaseEpoch: relay.leaseEpoch,
      };
      publishRelayConnectionState('connected');
      return relay;
    } catch (error) {
      relay.state = remoteDeviceRequested ? 'remote-unavailable' : 'legacy-fallback';
      window.__codexRelay = { state: relay.state, error: String(error?.message || error) };
      publishRelayConnectionState('disconnected');
      if (typeof window.codexLocalConnector?.syncRelayState === 'function') window.codexLocalConnector.syncRelayState();
      scheduleRelayRecovery(error);
      console.warn(remoteDeviceRequested
        ? '[Codex browser host] The requested paired device is unavailable.'
        : '[Codex browser host] Relay session is unavailable; using the local compatibility bridge.', error);
      return null;
    }
  }

  relayReady = initializeRelaySession();

  function startRelaySession({ force = false } = {}) {
    if (!force && relayReady) return relayReady;
    if (!force) relayRecoveryScheduled = false;
    if (force) {
      relay.sessionId = null;
      relay.connectionToken = null;
      relay.leaseEpoch = null;
      relay.state = 'connecting';
      hostRpc.state = 'reconnecting';
      hostRpc.lastError = null;
      publishHostRpcState();
    }
    relayReady = initializeRelaySession();
    return relayReady;
  }

  function scheduleRelayRecovery(error, { force = false } = {}) {
    const message = String(error?.message || error || '');
    if (error?.code === 'CODEX_RELAY_LEASE_EXPIRED' || /control lease/i.test(message)) return;
    const recoverableState = ['remote-unavailable', 'control-lost', 'connecting'].includes(relay.state);
    if (relayRecoveryScheduled || (!force && !recoverableState && !/(?:HTTP (404|409|410|500|502|503)\b|failed to fetch|networkerror)/i.test(message))) return;
    relayRecoveryScheduled = true;
    relayRecoveryAttempt += 1;
    const baseDelay = remoteDeviceRequested ? 500 : 250;
    const recoveryDelay = Math.min(10_000, baseDelay * (2 ** Math.min(relayRecoveryAttempt - 1, 5)));
    relayRecoveryTimer = setTimeout(async () => {
      relayRecoveryTimer = null;
      relayRecoveryScheduled = false;
      try {
        const current = await startRelaySession({ force: true });
        if (!current?.sessionId) throw new Error('Relay recovery did not create a session.');
        await connectHostRpcStream();
        relayRecoveryAttempt = 0;
        syncLocalConnectorRelayState();
      } catch (recoveryError) {
        scheduleRelayRecovery(recoveryError, { force: true });
      }
    }, recoveryDelay);
  }

  async function renewRelayLease() {
    const current = await relayReady;
    if (!current?.sessionId || !['connected', 'control-lost'].includes(relay.state)) return;
    try {
      const response = await fetch(`/api/codex-relay/sessions/${encodeURIComponent(relay.sessionId)}/lease/renew`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...relayHeaders() },
        body: JSON.stringify({ browserInstanceId: relayBrowserInstanceId, leaseEpoch: relay.leaseEpoch }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const error = new Error(`Lease renewal returned HTTP ${response.status}`);
        error.code = String(payload?.error?.code || '');
        throw error;
      }
      const lease = await response.json();
      relay.leaseEpoch = lease.epoch;
      relay.state = 'connected';
      window.__codexRelay = { sessionId: relay.sessionId, state: relay.state, leaseEpoch: relay.leaseEpoch };
    } catch (error) {
      relay.state = 'control-lost';
      window.__codexRelay = { sessionId: relay.sessionId, state: relay.state, error: String(error?.message || error) };
      console.warn('[Codex browser host] Relay control lease was lost.', error);
      if (typeof window.codexLocalConnector?.syncRelayState === 'function') window.codexLocalConnector.syncRelayState();
      scheduleRelayRecovery(error);
    }
  }

  async function sendMessageFromView(message) {
    observedMessages.push(message);
    if (observedMessages.length > 500) observedMessages.splice(0, observedMessages.length - 500);
    observeWorkspaceSelection(message);
    if (message?.type === 'ready' && window.parent !== window) {
      window.parent.postMessage({ type: 'codex-browser-ready', sessionId: appSessionId }, window.location.origin);
    }
    const commandId = newHostRpcCommandId();
    try {
      const currentRelay = await relayReady;
      if (!currentRelay?.sessionId && remoteDeviceRequested) throw new Error('The requested paired device is unavailable.');
      if (currentRelay?.sessionId && hostRpc.state === 'connected' && hostRpc.capabilities.includes('host.message.send')) {
        try {
          const result = await requestHostRpc('host.message.send', {
            leaseEpoch: relay.leaseEpoch,
            message,
          }, { id: commandId });
          for (const event of result.events || []) dispatchHostMessage(event);
          return;
        } catch (error) {
          if (error?.transport !== true) throw error;
        }
      }
      hostRpc.httpFallbacks += 1;
      publishHostRpcState();
      const response = await fetch(currentRelay?.sessionId
        ? `/api/codex-relay/sessions/${encodeURIComponent(currentRelay.sessionId)}/messages`
        : '/api/codex-browser/messages', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(currentRelay?.sessionId ? relayHeaders() : {}) },
        body: JSON.stringify(currentRelay?.sessionId
          ? { commandId, browserInstanceId: relayBrowserInstanceId, leaseEpoch: relay.leaseEpoch, message }
          : { commandId, sessionId: appSessionId, message }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      for (const event of result.events || []) dispatchHostMessage(event);
    } catch (error) {
      console.warn('[Codex browser host] message delivery failed', message?.type, error);
    }
  }

  let eventCursor = 0;
  let eventPollInFlight = false;

  function deliverSequencedEvent(event) {
    const sequence = Number(event?.sequence) || 0;
    if (sequence && sequence <= eventCursor) return false;
    dispatchHostMessage(event?.message);
    if (sequence) eventCursor = sequence;
    window.__codexBrowserEventCursor = eventCursor;
    return true;
  }

  async function pollHostEvents() {
    if (eventPollInFlight) return;
    eventPollInFlight = true;
    window.__codexBrowserEventPhase = 'fetching';
    try {
        const currentRelay = await relayReady;
        if (!currentRelay?.sessionId && remoteDeviceRequested) throw new Error('The requested paired device is unavailable.');
        const eventUrl = currentRelay?.sessionId
          ? `/api/codex-relay/sessions/${encodeURIComponent(currentRelay.sessionId)}/events?after=${eventCursor}`
          : `/api/codex-browser/events?sessionId=${encodeURIComponent(appSessionId)}&after=${eventCursor}`;
        const response = await fetch(
          eventUrl,
          { credentials: 'include', cache: 'no-store', headers: currentRelay?.sessionId ? relayHeaders() : {} },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        const batch = result.events || [];
        let deliveryFailed = false;
        for (let index = 0; index < batch.length; index += 1) {
          const event = batch[index];
          try {
            deliverSequencedEvent(event);
          } catch (error) {
            window.__codexBrowserEventError = String(error?.stack || error);
            console.warn('[Codex browser host] host event delivery failed', event.message?.type, error);
            deliveryFailed = true;
            break;
          }
          if (index > 0 && index % 10 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
        if (!deliveryFailed) eventCursor = Math.max(eventCursor, Number(result.cursor) || 0);
        window.__codexBrowserEventCursor = eventCursor;
        window.__codexBrowserEventPhase = 'idle';
    } catch (error) {
      window.__codexBrowserEventError = String(error?.stack || error);
      window.__codexBrowserEventPhase = 'errored';
      console.warn('[Codex browser host] event polling failed', error);
      scheduleRelayRecovery(error);
    } finally {
      eventPollInFlight = false;
    }
  }

  function startFallbackPolling() {
    if (hostRpc.fallbackPollTimer || remoteDeviceRequested) return;
    void pollHostEvents();
    hostRpc.fallbackPollTimer = setInterval(() => void pollHostEvents(), 1_000);
    publishHostRpcState();
  }

  function stopFallbackPolling() {
    if (!hostRpc.fallbackPollTimer) return;
    clearInterval(hostRpc.fallbackPollTimer);
    hostRpc.fallbackPollTimer = null;
    publishHostRpcState();
  }

  function sendHostRpc(message) {
    if (hostRpc.socket?.readyState !== WebSocket.OPEN) return false;
    hostRpc.socket.send(JSON.stringify({
      rpc: hostRpc.protocol,
      version: hostRpc.version,
      ...message,
    }));
    return true;
  }

  function newHostRpcCommandId() {
    if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
    return `command-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function requestHostRpc(method, params, { id = newHostRpcCommandId(), timeoutMs = 20_000 } = {}) {
    if (hostRpc.socket?.readyState !== WebSocket.OPEN || hostRpc.state !== 'connected') {
      return Promise.reject(hostRpcRequestError('CODEX_HOST_RPC_TRANSPORT_UNAVAILABLE', 'Host RPC transport is unavailable.', true));
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        hostRpc.pendingRequests.delete(id);
        hostRpc.commandErrors += 1;
        publishHostRpcState();
        reject(hostRpcRequestError('CODEX_HOST_RPC_REQUEST_TIMEOUT', `Host RPC request timed out: ${method}`, true));
      }, timeoutMs);
      hostRpc.pendingRequests.set(id, { resolve, reject, timeout, method });
      hostRpc.commandsSent += 1;
      publishHostRpcState();
      if (!sendHostRpc({ kind: 'request', id, method, params })) {
        clearTimeout(timeout);
        hostRpc.pendingRequests.delete(id);
        hostRpc.commandErrors += 1;
        publishHostRpcState();
        reject(hostRpcRequestError('CODEX_HOST_RPC_TRANSPORT_UNAVAILABLE', 'Host RPC transport closed before the request was sent.', true));
      }
    });
  }

  function hostRpcRequestError(code, message, transport = false) {
    const error = new Error(message);
    error.code = code;
    error.transport = transport;
    return error;
  }

  function settleHostRpcRequest(message) {
    const pending = hostRpc.pendingRequests.get(String(message?.id || ''));
    if (!pending) return false;
    clearTimeout(pending.timeout);
    hostRpc.pendingRequests.delete(String(message.id));
    if (message.kind === 'result') {
      hostRpc.commandsCompleted += 1;
      pending.resolve(message.result || {});
    } else {
      hostRpc.commandErrors += 1;
      pending.reject(hostRpcRequestError(
        message.code || 'CODEX_HOST_RPC_COMMAND_ERROR',
        message.message || 'Host RPC command failed.',
        false,
      ));
    }
    publishHostRpcState();
    return true;
  }

  function rejectPendingHostRpcRequests(reason) {
    for (const [id, pending] of hostRpc.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(hostRpcRequestError('CODEX_HOST_RPC_TRANSPORT_CLOSED', reason, true));
      hostRpc.pendingRequests.delete(id);
      hostRpc.commandErrors += 1;
    }
  }

  async function connectHostRpcStream() {
    const currentRelay = await relayReady;
    if (!currentRelay?.sessionId || relay.state !== 'connected') {
      startFallbackPolling();
      return false;
    }
    if (hostRpc.socket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(hostRpc.socket.readyState)) return true;
    hostRpc.state = 'ticketing';
    hostRpc.lastError = null;
    publishHostRpcState();
    try {
      const ticketResponse = await fetch(`/api/codex-relay/sessions/${encodeURIComponent(relay.sessionId)}/stream-ticket`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...relayHeaders() },
        body: JSON.stringify({ browserInstanceId: relayBrowserInstanceId, after: eventCursor }),
      });
      if (!ticketResponse.ok) throw new Error(`Stream ticket returned HTTP ${ticketResponse.status}`);
      const issued = await ticketResponse.json();
      const ticket = String(issued?.ticket?.value || '');
      if (!ticket) throw new Error('Stream ticket response did not include a ticket.');
      const streamUrl = new URL(
        `/api/codex-relay/sessions/${encodeURIComponent(relay.sessionId)}/stream?browserInstanceId=${encodeURIComponent(relayBrowserInstanceId)}`,
        window.location.href,
      );
      streamUrl.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(streamUrl, [hostRpc.protocol, `codex-ticket.${ticket}`]);
      hostRpc.socket = socket;
      hostRpc.state = 'connecting';
      publishHostRpcState();
      socket.addEventListener('message', (event) => handleHostRpcMessage(socket, event.data));
      socket.addEventListener('close', () => handleHostRpcDisconnect(socket, 'closed'));
      socket.addEventListener('error', () => handleHostRpcDisconnect(socket, 'socket error'));
      return true;
    } catch (error) {
      hostRpc.lastError = String(error?.message || error);
      hostRpc.state = 'fallback';
      publishHostRpcState();
      startFallbackPolling();
      scheduleHostRpcReconnect();
      return false;
    }
  }

  function handleHostRpcMessage(socket, value) {
    if (socket !== hostRpc.socket) return;
    try {
      const message = JSON.parse(String(value));
      if (message?.rpc !== hostRpc.protocol || message?.version !== hostRpc.version) return;
      if (message.kind === 'hello') {
        hostRpc.streamId = String(message.stream?.id || '');
        hostRpc.capabilities = Array.isArray(message.capabilities) ? [...message.capabilities] : [];
        hostRpc.recipes = Array.isArray(message.recipes) ? [...message.recipes] : [];
        hostRpc.state = 'connected';
        hostRpc.reconnectAttempt = 0;
        hostRpc.lastError = null;
        stopFallbackPolling();
        publishHostRpcState();
        return;
      }
      if ((message.kind === 'result' || message.kind === 'error') && settleHostRpcRequest(message)) return;
      if (message.kind === 'event') {
        deliverSequencedEvent({ sequence: message.sequence, message: message.message });
        sendHostRpc({ kind: 'ack', cursor: eventCursor });
        window.__codexBrowserEventPhase = 'streaming';
        publishHostRpcState();
        return;
      }
      if (message.kind === 'error') {
        hostRpc.lastError = `${message.code || 'CODEX_HOST_RPC_ERROR'}: ${message.message || ''}`;
        window.__codexBrowserEventError = hostRpc.lastError;
        publishHostRpcState();
      }
    } catch (error) {
      hostRpc.lastError = String(error?.stack || error);
      window.__codexBrowserEventError = hostRpc.lastError;
      publishHostRpcState();
      if (socket.readyState === WebSocket.OPEN) socket.close(1011, 'event delivery failed');
    }
  }

  function handleHostRpcDisconnect(socket, reason) {
    if (socket !== hostRpc.socket) return;
    hostRpc.socket = null;
    hostRpc.streamId = null;
    rejectPendingHostRpcRequests(`Host RPC transport ${reason}.`);
    hostRpc.state = 'reconnecting';
    hostRpc.lastError = reason;
    publishHostRpcState();
    startFallbackPolling();
    scheduleHostRpcReconnect();
  }

  function scheduleHostRpcReconnect() {
    if (hostRpc.reconnectTimer || relay.state !== 'connected') return;
    hostRpc.reconnectAttempt += 1;
    const delay = Math.min(10_000, 250 * (2 ** Math.min(hostRpc.reconnectAttempt - 1, 5)));
    hostRpc.reconnectTimer = setTimeout(() => {
      hostRpc.reconnectTimer = null;
      void connectHostRpcStream();
    }, delay);
    publishHostRpcState();
  }

  function systemTheme() {
    return darkQuery.matches ? 'dark' : 'light';
  }

  function dispatchWorkerMessage(workerId, message) {
    const listeners = workerListeners.get(String(workerId || ''));
    if (!listeners?.size) return;
    for (const listener of [...listeners]) listener(message);
  }

  async function sendWorkerMessageFromView(workerId, message) {
    const normalizedWorkerId = String(workerId || '');
    const commandId = newHostRpcCommandId();
    const currentRelay = await relayReady;
    if (!currentRelay?.sessionId && remoteDeviceRequested) {
      throw hostRpcRequestError('CODEX_WORKER_REMOTE_UNAVAILABLE', 'The requested paired device is unavailable.', true);
    }
    let result = null;
    if (currentRelay?.sessionId && hostRpc.state === 'connected' && hostRpc.capabilities.includes('host.worker.send')) {
      try {
        result = await requestHostRpc('host.worker.send', {
          leaseEpoch: relay.leaseEpoch,
          workerId: normalizedWorkerId,
          message,
        }, { id: commandId, timeoutMs: 120_000 });
      } catch (error) {
        if (error?.transport !== true) throw error;
      }
    }
    if (!result) {
      hostRpc.httpFallbacks += 1;
      publishHostRpcState();
      const response = await fetch(currentRelay?.sessionId
        ? `/api/codex-relay/sessions/${encodeURIComponent(currentRelay.sessionId)}/worker-messages`
        : '/api/codex-browser/worker-messages', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(currentRelay?.sessionId ? relayHeaders() : {}) },
        body: JSON.stringify({
          commandId,
          sessionId: appSessionId,
          browserInstanceId: relayBrowserInstanceId,
          leaseEpoch: relay.leaseEpoch,
          workerId: normalizedWorkerId,
          message,
        }),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        throw hostRpcRequestError(
          failure?.error?.code || 'CODEX_WORKER_HTTP_FAILED',
          failure?.error?.message || `Worker request returned HTTP ${response.status}.`,
          true,
        );
      }
      result = await response.json();
    }
    for (const workerMessage of result.messages || []) dispatchWorkerMessage(normalizedWorkerId, workerMessage);
  }

  function subscribeToWorkerMessages(workerId, listener) {
    if (typeof listener !== 'function') return () => {};
    const key = String(workerId || '');
    const listeners = workerListeners.get(key) || new Set();
    listeners.add(listener);
    workerListeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) workerListeners.delete(key);
    };
  }

  function ensureContextMenuStyles() {
    if (document.getElementById('codex-browser-context-menu-styles')) return;
    const style = document.createElement('style');
    style.id = 'codex-browser-context-menu-styles';
    style.textContent = `
      .codex-browser-context-menu {
        position: fixed;
        z-index: 2147483646;
        box-sizing: border-box;
        width: max-content;
        min-width: 180px;
        max-width: min(360px, calc(100vw - 16px));
        padding: 4px;
        color: var(--text-primary, #f3f4f6);
        background: color-mix(in srgb, var(--background-primary, #202123) 94%, transparent);
        border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
        border-radius: 8px;
        box-shadow: 0 12px 28px rgba(0, 0, 0, .28);
        backdrop-filter: blur(14px);
        font: 13px/1.35 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
        user-select: none;
      }
      .codex-browser-context-menu [role="menu"] {
        position: absolute;
        display: none;
        box-sizing: border-box;
        width: max-content;
        top: -5px;
        left: calc(100% + 5px);
        min-width: 190px;
        max-width: min(360px, calc(100vw - 16px));
        padding: 4px;
        color: inherit;
        background: inherit;
        border: inherit;
        border-radius: 8px;
        box-shadow: inherit;
        backdrop-filter: inherit;
      }
      .codex-browser-context-menu [role="menu"].is-open { display: block; }
      .codex-browser-context-menu button {
        width: 100%;
        min-height: 30px;
        display: grid;
        grid-template-columns: 18px minmax(0, 1fr) 16px;
        align-items: center;
        gap: 6px;
        padding: 5px 7px;
        border: 0;
        border-radius: 6px;
        color: inherit;
        background: transparent;
        font: inherit;
        letter-spacing: 0;
        text-align: left;
        white-space: normal;
      }
      .codex-browser-context-menu button:hover,
      .codex-browser-context-menu button:focus-visible,
      .codex-browser-context-menu button[aria-expanded="true"] {
        outline: 0;
        background: color-mix(in srgb, currentColor 11%, transparent);
      }
      .codex-browser-context-menu button:disabled { opacity: .45; }
      .codex-browser-context-menu__mark,
      .codex-browser-context-menu__arrow { text-align: center; }
      .codex-browser-context-menu__label { min-width: 0; overflow-wrap: anywhere; }
      .codex-browser-context-menu__separator {
        height: 1px;
        margin: 4px 5px;
        background: color-mix(in srgb, currentColor 14%, transparent);
      }
      @media (prefers-color-scheme: light) {
        .codex-browser-context-menu {
          color: var(--text-primary, #171717);
          background: color-mix(in srgb, var(--background-primary, #fff) 96%, transparent);
          box-shadow: 0 12px 28px rgba(0, 0, 0, .16);
        }
      }
    `;
    document.head.append(style);
  }

  function showContextMenu(items) {
    activeContextMenu?.close(null);
    ensureContextMenuStyles();
    const templates = Array.isArray(items) ? items : [];
    if (!templates.length) return Promise.resolve({ id: null });
    return new Promise((resolve) => {
      const root = document.createElement('div');
      root.className = 'codex-browser-context-menu';
      root.setAttribute('role', 'menu');
      root.setAttribute('aria-label', 'Context menu');
      let settled = false;
      const cleanups = [];
      const close = (id) => {
        if (settled) return;
        settled = true;
        activeContextMenu = null;
        for (const cleanup of cleanups) cleanup();
        root.remove();
        resolve({ id: id == null ? null : String(id) });
      };
      activeContextMenu = { close };

      const hideSiblingMenus = (parent, keep = null) => {
        for (const submenu of parent.querySelectorAll(':scope > [role="menu"]')) {
          if (submenu === keep) continue;
          submenu.classList.remove('is-open');
          submenu.previousElementSibling?.setAttribute?.('aria-expanded', 'false');
        }
      };
      const placeSubmenu = (submenu) => {
        const parentBounds = submenu.parentElement.getBoundingClientRect();
        const bounds = submenu.getBoundingClientRect();
        const rightPlacement = parentBounds.right + 5;
        const leftPlacement = parentBounds.left - bounds.width - 5;
        const fitsRight = rightPlacement + bounds.width <= window.innerWidth - 8;
        const fitsLeft = leftPlacement >= 8;
        const absoluteLeft = fitsRight
          ? rightPlacement
          : fitsLeft
            ? leftPlacement
            : Math.max(8, Math.min(parentBounds.left, window.innerWidth - bounds.width - 8));
        let absoluteTop = Math.max(8, Math.min(parentBounds.top - 5, window.innerHeight - bounds.height - 8));
        if (!fitsRight && !fitsLeft) {
          absoluteTop = parentBounds.top - bounds.height - 5 >= 8
            ? parentBounds.top - bounds.height - 5
            : parentBounds.bottom + bounds.height + 5 <= window.innerHeight - 8
              ? parentBounds.bottom + 5
              : absoluteTop;
        }
        submenu.style.left = `${absoluteLeft - parentBounds.left}px`;
        submenu.style.top = `${absoluteTop - parentBounds.top}px`;
      };
      const render = (templatesToRender, container) => {
        for (const item of templatesToRender.slice(0, 200)) {
          if (item?.type === 'separator') {
            const separator = document.createElement('div');
            separator.className = 'codex-browser-context-menu__separator';
            separator.setAttribute('role', 'separator');
            container.append(separator);
            continue;
          }
          if (!item || item.id == null) continue;
          const button = document.createElement('button');
          button.type = 'button';
          button.setAttribute('role', item.type === 'checkbox' ? 'menuitemcheckbox' : 'menuitem');
          button.dataset.menuItemId = String(item.id);
          button.disabled = item.enabled === false;
          if (item.type === 'checkbox') button.setAttribute('aria-checked', item.checked === true ? 'true' : 'false');
          if (item.toolTip) button.title = String(item.toolTip);
          const mark = document.createElement('span');
          mark.className = 'codex-browser-context-menu__mark';
          mark.textContent = item.type === 'checkbox' && item.checked === true ? '\u2713' : '';
          const label = document.createElement('span');
          label.className = 'codex-browser-context-menu__label';
          label.textContent = String(item.label || item.id);
          const arrow = document.createElement('span');
          arrow.className = 'codex-browser-context-menu__arrow';
          const submenuItems = Array.isArray(item.submenu) ? item.submenu : [];
          arrow.textContent = submenuItems.length ? '\u203a' : '';
          button.append(mark, label, arrow);
          container.append(button);
          if (submenuItems.length) {
            const submenu = document.createElement('div');
            submenu.setAttribute('role', 'menu');
            render(submenuItems, submenu);
            container.append(submenu);
            button.setAttribute('aria-haspopup', 'menu');
            button.setAttribute('aria-expanded', 'false');
            const openSubmenu = () => {
              hideSiblingMenus(container, submenu);
              submenu.classList.add('is-open');
              button.setAttribute('aria-expanded', 'true');
              placeSubmenu(submenu);
            };
            button.addEventListener('mouseenter', openSubmenu);
            button.addEventListener('click', (event) => {
              event.preventDefault();
              openSubmenu();
              submenu.querySelector('button:not(:disabled)')?.focus();
            });
          } else {
            button.addEventListener('mouseenter', () => hideSiblingMenus(container));
            button.addEventListener('click', () => close(item.id));
          }
        }
      };
      render(templates, root);
      document.body.append(root);
      const point = Date.now() - lastContextMenuPoint.at < 2_000
        ? lastContextMenuPoint
        : { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) };
      root.style.left = `${Math.max(8, point.x)}px`;
      root.style.top = `${Math.max(8, point.y)}px`;
      const bounds = root.getBoundingClientRect();
      if (bounds.right > window.innerWidth - 8) root.style.left = `${Math.max(8, window.innerWidth - bounds.width - 8)}px`;
      if (bounds.bottom > window.innerHeight - 8) root.style.top = `${Math.max(8, window.innerHeight - bounds.height - 8)}px`;
      const placedBounds = root.getBoundingClientRect();
      if (placedBounds.right > window.innerWidth - 8) {
        root.style.left = `${Math.max(8, placedBounds.left - (placedBounds.right - window.innerWidth + 8))}px`;
      }
      if (placedBounds.bottom > window.innerHeight - 8) {
        root.style.top = `${Math.max(8, placedBounds.top - (placedBounds.bottom - window.innerHeight + 8))}px`;
      }

      const outside = (event) => { if (!root.contains(event.target)) close(null); };
      const onBlur = () => close(null);
      const onKeyDown = (event) => {
        const buttons = [...root.querySelectorAll('button:not(:disabled)')].filter((button) => button.offsetParent !== null);
        if (event.key === 'Escape') {
          event.preventDefault();
          close(null);
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && buttons.length) {
          event.preventDefault();
          const current = buttons.indexOf(document.activeElement);
          const next = event.key === 'Home' ? 0
            : event.key === 'End' ? buttons.length - 1
              : event.key === 'ArrowDown' ? (current + 1 + buttons.length) % buttons.length
                : (current - 1 + buttons.length) % buttons.length;
          buttons[next].focus();
        }
      };
      document.addEventListener('pointerdown', outside, true);
      window.addEventListener('blur', onBlur);
      root.addEventListener('keydown', onKeyDown);
      cleanups.push(
        () => document.removeEventListener('pointerdown', outside, true),
        () => window.removeEventListener('blur', onBlur),
        () => root.removeEventListener('keydown', onKeyDown),
      );
      root.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
    });
  }

  const localConnector = {
    state: remoteDeviceRequested ? 'remote_device_selected' : 'idle',
    intentId: '',
    expiresAt: '',
    replaceDeviceId: '',
    pollTimer: null,
    launchFallbackTimer: null,
    connectionFallbackTimer: null,
    pollInFlight: false,
    shareInFlight: false,
    installerUrl: '/api/codex-connect/installer',
    root: null,
    status: null,
    connectButton: null,
    retryButton: null,
    installButton: null,
    shareButton: null,
  };

  function ensureLocalConnectorControl() {
    if (localConnector.root || !document.body) return;
    const style = document.createElement('style');
    style.id = 'codex-local-connector-styles';
    style.textContent = `
      .codex-local-connector {
        position: fixed;
        pointer-events: none;
        z-index: 2147483600;
        right: 16px;
        top: 72px;
        bottom: auto;
        width: min(292px, calc(100vw - 32px));
        box-sizing: border-box;
        display: grid;
        gap: 9px;
        padding: 11px;
        color: #f3f4f6;
        background: rgba(31, 35, 39, .96);
        border: 1px solid rgba(255, 255, 255, .14);
        border-radius: 8px;
        box-shadow: 0 10px 26px rgba(0, 0, 0, .28);
        font: 13px/1.35 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
      }
      .codex-local-connector__heading { color: inherit; font-weight: 650; }
      .codex-local-connector__status { min-height: 18px; color: rgba(243, 244, 246, .74); overflow-wrap: anywhere; }
      .codex-local-connector__actions { display: flex; gap: 8px; align-items: center; }
      .codex-local-connector button {
        pointer-events: auto;
        min-height: 32px;
        padding: 6px 10px;
        border: 1px solid rgba(255, 255, 255, .18);
        border-radius: 6px;
        color: inherit;
        background: transparent;
        font: inherit;
        letter-spacing: 0;
        cursor: pointer;
      }
      .codex-local-connector button:hover,
      .codex-local-connector button:focus-visible { outline: 0; background: rgba(255, 255, 255, .1); }
      .codex-local-connector button:disabled { opacity: .55; cursor: wait; }
      .codex-local-connector__connect { flex: 1 1 auto; color: #101418 !important; background: #e6f0ff !important; border-color: #e6f0ff !important; font-weight: 650 !important; }
      .codex-local-connector__retry { display: none; flex: 1 1 auto; }
      .codex-local-connector.is-reconnectable .codex-local-connector__retry { display: inline-flex; }
      .codex-local-connector__install { display: none; flex: 0 0 auto; }
      .codex-local-connector.is-installable .codex-local-connector__install { display: inline-flex; }
      .codex-local-connector__share { flex: 0 0 auto; }
      @media (prefers-color-scheme: light) {
        .codex-local-connector { color: #1b1f23; background: rgba(255, 255, 255, .97); border-color: rgba(0, 0, 0, .16); box-shadow: 0 10px 26px rgba(0, 0, 0, .16); }
        .codex-local-connector__status { color: rgba(27, 31, 35, .68); }
        .codex-local-connector button { border-color: rgba(0, 0, 0, .18); }
        .codex-local-connector button:hover,
        .codex-local-connector button:focus-visible { background: rgba(0, 0, 0, .07); }
      }
      @media (max-width: 600px) {
        .codex-local-connector {
          top: 56px;
          right: 12px;
          bottom: auto;
          width: min(268px, calc(100vw - 24px));
          gap: 6px;
          padding: 9px;
        }
        .codex-local-connector__heading { display: none; }
        .codex-local-connector__actions { gap: 6px; }
        .codex-local-connector button { padding-inline: 8px; }
      }
    `;
    document.head.append(style);
    const root = document.createElement('section');
    root.className = 'codex-local-connector';
    root.setAttribute('aria-label', '本机连接器');
    const heading = document.createElement('div');
    heading.className = 'codex-local-connector__heading';
    heading.textContent = '本机连接器';
    const status = document.createElement('div');
    status.className = 'codex-local-connector__status';
    const actions = document.createElement('div');
    actions.className = 'codex-local-connector__actions';
    const connectButton = document.createElement('button');
    connectButton.className = 'codex-local-connector__connect';
    connectButton.type = 'button';
    connectButton.textContent = remoteDeviceRequested ? '已选择设备' : '连接本机';
    const retryButton = document.createElement('button');
    retryButton.className = 'codex-local-connector__retry';
    retryButton.type = 'button';
    retryButton.textContent = '重新连接设备';
    retryButton.title = `重新建立${requestedDeviceLabel}会话`;
    const installButton = document.createElement('button');
    installButton.className = 'codex-local-connector__install';
    installButton.type = 'button';
    installButton.textContent = '下载安装包';
    installButton.title = '下载本机连接器安装包';
    const shareButton = document.createElement('button');
    shareButton.className = 'codex-local-connector__share';
    shareButton.type = 'button';
    shareButton.textContent = '分享';
    shareButton.title = '复制一次性 Session 接入链接';
    shareButton.setAttribute('aria-label', '复制一次性 Session 接入链接');
    actions.append(connectButton, retryButton, installButton, shareButton);
    root.append(heading, status, actions);
    document.body.append(root);
    localConnector.root = root;
    localConnector.status = status;
    localConnector.connectButton = connectButton;
    localConnector.retryButton = retryButton;
    localConnector.installButton = installButton;
    localConnector.shareButton = shareButton;
    connectButton.addEventListener('click', () => void startLocalConnector());
    retryButton.addEventListener('click', () => void retryRemoteRelay());
    installButton.addEventListener('click', downloadLocalConnector);
    shareButton.addEventListener('click', () => void shareLocalCodexSession());
    updateLocalConnectorControl(remoteDeviceRequested
      ? (relay.state === 'connected' ? `已连接${requestedDeviceLabel}` : relay.state === 'remote-unavailable' ? `${requestedDeviceLabel}暂不可用` : `正在连接${requestedDeviceLabel}`)
      : '准备连接此电脑');
    if (!remoteDeviceRequested) void discoverLocalConnectorDevice();
  }

  async function discoverLocalConnectorDevice() {
    try {
      const response = await fetch('/api/codex-connect/devices', { credentials: 'include', cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json();
      const devices = Array.isArray(payload?.devices) ? payload.devices : [];
      const online = devices.find((device) => device?.online && device?.health?.runtimeReady);
      if (online?.id) {
        localConnector.state = 'connected';
        updateLocalConnectorControl('已发现在线本机，正在进入');
        if (embeddedProductRequested) return;
        selectLocalConnectorDevice(online.id);
        return;
      }
      const offline = devices.find((device) => device?.id);
      if (offline) {
        localConnector.replaceDeviceId = String(offline.id);
        updateLocalConnectorControl('已发现离线本机，可一键重新连接');
      }
    } catch {
      // The control remains usable for first pairing when discovery is unavailable.
    }
  }

  function updateLocalConnectorControl(message, { installable = false, busy = false } = {}) {
    localConnector.status && (localConnector.status.textContent = message);
    localConnector.root?.classList.toggle('is-installable', installable);
    localConnector.root?.classList.toggle('is-reconnectable', remoteDeviceRequested && !['connected', 'connecting'].includes(relay.state) && !busy);
    if (localConnector.connectButton) {
      localConnector.connectButton.disabled = busy || remoteDeviceRequested || localConnector.state === 'connected';
      if (!remoteDeviceRequested && localConnector.state !== 'connected') {
        localConnector.connectButton.textContent = busy ? '正在连接' : '连接本机';
      }
    }
    if (localConnector.retryButton) localConnector.retryButton.disabled = busy;
    if (localConnector.shareButton) localConnector.shareButton.disabled = localConnector.shareInFlight || relay.state !== 'connected';
  }

  async function shareLocalCodexSession() {
    if (localConnector.shareInFlight || relay.state !== 'connected') return;
    localConnector.shareInFlight = true;
    updateLocalConnectorControl('正在生成一次性 Session 链接');
    try {
      const response = await fetch('/api/codex-relay/invites', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestedDeviceId ? { deviceId: requestedDeviceId } : {}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.shareUrl) {
        throw new Error(payload?.error?.message || payload?.message || `Session invite returned HTTP ${response.status}`);
      }
      await writeClipboardText(String(payload.shareUrl));
      const expiresAt = Date.parse(String(payload?.invite?.expiresAt || ''));
      const expiresLabel = Number.isFinite(expiresAt)
        ? new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : '';
      updateLocalConnectorControl(`一次性 Session 链接已复制${expiresLabel ? `，${expiresLabel} 前有效` : ''}`);
    } catch (error) {
      updateLocalConnectorControl(`Session 链接生成失败：${String(error?.message || error)}`);
    } finally {
      localConnector.shareInFlight = false;
      if (localConnector.shareButton) localConnector.shareButton.disabled = relay.state !== 'connected';
    }
  }

  async function writeClipboardText(value) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return;
      } catch {
        // Fall back when the browser exposes the API but denies the current context.
      }
    }
    const input = document.createElement('textarea');
    input.value = value;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.append(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    if (!copied) throw new Error('Clipboard unavailable');
  }

  async function retryRemoteRelay() {
    if (!remoteDeviceRequested || localConnector.pollInFlight) return;
    localConnector.state = 'reconnecting';
    updateLocalConnectorControl(`正在重新连接${requestedDeviceLabel}`, { busy: true });
    try {
      const current = await startRelaySession({ force: true });
      if (!current?.sessionId) throw new Error(`${requestedDeviceLabel}当前不可用`);
      localConnector.state = 'remote_device_selected';
      updateLocalConnectorControl(`${requestedDeviceLabel}已重新连接`);
      await connectHostRpcStream();
    } catch (error) {
      localConnector.state = 'error';
      updateLocalConnectorControl(`重连未完成：${String(error?.message || error)}`);
    }
  }

  function syncLocalConnectorRelayState() {
    if (!remoteDeviceRequested || !localConnector.root || localConnector.state === 'reconnecting') return;
    if (relay.state === 'connected') localConnector.state = 'connected';
    if (relay.state === 'control-lost') localConnector.state = 'error';
    const message = relay.state === 'connected'
      ? `已连接${requestedDeviceLabel}`
      : relay.state === 'remote-unavailable'
        ? `${requestedDeviceLabel}暂不可用`
        : relay.state === 'control-lost'
          ? `${requestedDeviceLabel}连接已断开`
          : `正在连接${requestedDeviceLabel}`;
    updateLocalConnectorControl(message);
  }

  async function startLocalConnector() {
    if (remoteDeviceRequested || localConnector.pollInFlight) return;
    stopLocalConnectorLaunchFallback();
    stopLocalConnectorConnectionFallback();
    localConnector.state = 'creating_intent';
    updateLocalConnectorControl('正在创建本机连接请求', { busy: true });
    try {
      const response = await fetch('/api/codex-connect/intents', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceName: navigator.platform ? `${navigator.platform} device` : '',
          ...(localConnector.replaceDeviceId ? { replaceDeviceId: localConnector.replaceDeviceId } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.intent?.id || !payload?.launchUrl) {
        throw new Error(payload?.error?.message || `Connection request returned HTTP ${response.status}`);
      }
      localConnector.intentId = String(payload.intent.id);
      localConnector.expiresAt = String(payload.intent.expiresAt || '');
      localConnector.installerUrl = String(payload.installerUrl || localConnector.installerUrl);
      localConnector.state = 'waiting_for_connector';
      updateLocalConnectorControl('正在等待本机连接器确认', { busy: true, installable: true });
      const launch = document.createElement('a');
      launch.href = String(payload.launchUrl);
      launch.style.display = 'none';
      document.body.append(launch);
      launch.click();
      launch.remove();
      startLocalConnectorLaunchFallback();
      startLocalConnectorPolling();
    } catch (error) {
      localConnector.state = 'error';
      updateLocalConnectorControl(`连接请求未完成: ${String(error?.message || error)}`, { installable: true });
    }
  }

  function startLocalConnectorPolling() {
    if (localConnector.pollTimer) clearInterval(localConnector.pollTimer);
    void pollLocalConnector();
    localConnector.pollTimer = setInterval(() => void pollLocalConnector(), 1_000);
  }

  async function pollLocalConnector() {
    if (!localConnector.intentId || localConnector.pollInFlight) return;
    if (localConnector.expiresAt && Date.parse(localConnector.expiresAt) <= Date.now()) {
      stopLocalConnectorPolling();
      stopLocalConnectorLaunchFallback();
      stopLocalConnectorConnectionFallback();
      localConnector.state = 'expired';
      updateLocalConnectorControl('本机连接请求已过期', { installable: true });
      return;
    }
    localConnector.pollInFlight = true;
    try {
      const response = await fetch(`/api/codex-connect/intents/${encodeURIComponent(localConnector.intentId)}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error?.message || `Connection status returned HTTP ${response.status}`);
      if (payload?.intent?.state === 'connected' && payload?.device?.id) {
        stopLocalConnectorPolling();
        stopLocalConnectorLaunchFallback();
        stopLocalConnectorConnectionFallback();
        localConnector.state = 'connected';
        updateLocalConnectorControl('本机连接已就绪');
        setTimeout(() => selectLocalConnectorDevice(payload.device.id), 250);
        return;
      }
      if (payload?.intent?.state === 'paired') {
        stopLocalConnectorLaunchFallback();
        if (payload?.device?.id) localConnector.replaceDeviceId = String(payload.device.id);
        if (localConnector.state !== 'paired') startLocalConnectorConnectionFallback();
        localConnector.state = 'paired';
        updateLocalConnectorControl('本机已配对，正在建立连接', { busy: true, installable: true });
        return;
      }
      if (payload?.intent?.state === 'expired') {
        stopLocalConnectorPolling();
        stopLocalConnectorLaunchFallback();
        stopLocalConnectorConnectionFallback();
        localConnector.state = 'expired';
        updateLocalConnectorControl('本机连接请求已过期', { installable: true });
      }
    } catch (error) {
      updateLocalConnectorControl(`正在等待本机连接器: ${String(error?.message || error)}`, { busy: true, installable: true });
    } finally {
      localConnector.pollInFlight = false;
    }
  }

  function stopLocalConnectorPolling() {
    if (!localConnector.pollTimer) return;
    clearInterval(localConnector.pollTimer);
    localConnector.pollTimer = null;
  }

  function startLocalConnectorLaunchFallback() {
    stopLocalConnectorLaunchFallback();
    localConnector.launchFallbackTimer = setTimeout(() => {
      localConnector.launchFallbackTimer = null;
      if (localConnector.state !== 'waiting_for_connector') return;
      localConnector.state = 'connector_not_detected';
      updateLocalConnectorControl('未检测到连接器启动。请先下载并运行安装程序，安装后点击重试。', { installable: true });
    }, 4_000);
  }

  function stopLocalConnectorLaunchFallback() {
    if (!localConnector.launchFallbackTimer) return;
    clearTimeout(localConnector.launchFallbackTimer);
    localConnector.launchFallbackTimer = null;
  }

  function startLocalConnectorConnectionFallback() {
    stopLocalConnectorConnectionFallback();
    localConnector.connectionFallbackTimer = setTimeout(() => {
      localConnector.connectionFallbackTimer = null;
      if (localConnector.state !== 'paired') return;
      stopLocalConnectorPolling();
      localConnector.state = 'connector_offline';
      updateLocalConnectorControl('连接器已启动，但本机 Relay 未上线。请确认本产品后端已启动，然后重试。', { installable: true });
    }, 12_000);
  }

  function stopLocalConnectorConnectionFallback() {
    if (!localConnector.connectionFallbackTimer) return;
    clearTimeout(localConnector.connectionFallbackTimer);
    localConnector.connectionFallbackTimer = null;
  }

  function downloadLocalConnector() {
    const download = document.createElement('a');
    download.href = localConnector.installerUrl;
    download.style.display = 'none';
    document.body.append(download);
    download.click();
    download.remove();
  }

  function selectLocalConnectorDevice(deviceId) {
    const destination = new URL(window.location.href);
    destination.searchParams.set('deviceId', String(deviceId));
    destination.searchParams.set('connector', 'local');
    window.location.replace(destination.toString());
  }

  darkQuery.addEventListener('change', () => {
    document.documentElement.classList.toggle('electron-dark', darkQuery.matches);
    document.documentElement.classList.toggle('electron-light', !darkQuery.matches);
    for (const listener of themeListeners) listener();
  });
  document.documentElement.classList.add(darkQuery.matches ? 'electron-dark' : 'electron-light');

  window.codexWindowType = 'electron';
  window.__SENTRY_IPC__ = { 'sentry-ipc': sentryNoopTransport };
  window.__codexBrowserMessages = observedMessages;
  window.__codexBrowserDispatch = dispatchHostMessage;
  window.codexProductWorkspace = Object.freeze({
    startTask: (projectId) => startWorkspaceTask(projectId),
    getStatus: () => ({
      selectedProjectId: productWorkspace.selectedProjectId || null,
      starting: productWorkspace.starting,
      error: productWorkspace.lastError || null,
    }),
  });
  window.codexLocalConnector = Object.freeze({
    connect: () => startLocalConnector(),
    reconnectRemote: () => retryRemoteRelay(),
    syncRelayState: () => syncLocalConnectorRelayState(),
    getStatus: () => ({
      state: localConnector.state,
      intentId: localConnector.intentId || null,
      expiresAt: localConnector.expiresAt || null,
      relayState: relay.state,
      relaySessionId: relay.sessionId || null,
    }),
  });
  window.codexHostRpc = Object.freeze({
    protocol: hostRpc.protocol,
    version: hostRpc.version,
    getStatus: () => ({ ...(window.__codexHostRpc || {}) }),
    reconnect: () => connectHostRpcStream(),
    resume: (cursor) => sendHostRpc({ kind: 'resume', id: `resume-${Date.now()}`, cursor: Number(cursor) || 0 }),
  });
  window.electronBridge = {
    windowType: 'electron',
    acknowledgeChunkedMessage() {},
    getPreloadStartedAtMs: () => performance.timeOrigin,
    sendMessageFromView,
    getPathForFile: () => null,
    startFileDrag: () => false,
    sendWorkerMessageFromView,
    subscribeToWorkerMessages,
    showContextMenu,
    getFastModeRolloutMetrics: async () => null,
    getSharedObjectSnapshotValue: (key) => sharedObjects.get(key),
    getInitialSidebarBootstrap: () => null,
    getSystemThemeVariant: systemTheme,
    subscribeToSystemThemeVariant: (listener) => {
      themeListeners.add(listener);
      return () => themeListeners.delete(listener);
    },
    triggerSentryTestError: async () => {},
    getSentryInitOptions: () => ({
      appVersion: '26.803.81509',
      buildNumber: '6415',
      buildFlavor: 'prod',
      codexAppSessionId: appSessionId,
      desktopTraceSampleRate: 0,
      initialDesktopTraceSampleRate: 0,
    }),
    getDesktopUserAgent: () => 'Codex Desktop/26.803.81509 (Windows NT 10.0; x64)',
    getAppSessionId: () => appSessionId,
    getBuildFlavor: () => 'prod',
    isDeviceCheckSupported: () => false,
    isIntelMacBuild: () => false,
    usesOwlAppShell: () => false,
  };

  function publishInitialHostState() {
    dispatchHostMessage({ type: 'shared-object-updated', key: 'host_config', value: sharedObjects.get('host_config') });
    publishRelayConnectionState(relay.state === 'remote-unavailable' ? 'disconnected' : 'connected');
    syncLocalConnectorRelayState();
  }
  let hostRuntimeStarted = false;
  let relayLeaseRenewTimer = null;
  function publishRendererBootstrap() {
    if (document.body) ensureLocalConnectorControl();
    window.__codexBrowserEventCursor = eventCursor;
    publishInitialHostState();
    publishHostRpcState();
  }
  function startHostRuntime() {
    if (hostRuntimeStarted) return;
    hostRuntimeStarted = true;
    // The embedded renderer can keep DOMContentLoaded pending while it waits
    // for these host events. Start the bridge during document loading and
    // replay bootstrap state so both iframe and top-level runtimes converge.
    publishRendererBootstrap();
    for (const delayMs of [0, 50, 150, 300, 750, 1_500, 3_000, 6_000, 12_000]) {
      setTimeout(publishRendererBootstrap, delayMs);
    }
    void connectHostRpcStream();
    relayLeaseRenewTimer = setInterval(() => void renewRelayLease(), 10_000);
    void checkServerEpoch();
    serverEpochPollTimer = setInterval(() => void checkServerEpoch(), 2_500);
  }
  if (document.readyState === 'loading') {
    startHostRuntime();
    window.addEventListener('DOMContentLoaded', publishRendererBootstrap, { once: true });
  } else {
    startHostRuntime();
  }
  window.addEventListener('beforeunload', () => {
    stopLocalConnectorPolling();
    if (relayRecoveryTimer) clearTimeout(relayRecoveryTimer);
    if (serverEpochPollTimer) clearInterval(serverEpochPollTimer);
    if (hostRpc.reconnectTimer) clearTimeout(hostRpc.reconnectTimer);
    if (hostRpc.fallbackPollTimer) clearInterval(hostRpc.fallbackPollTimer);
    if (relayLeaseRenewTimer) clearInterval(relayLeaseRenewTimer);
    hostRpc.socket?.close(1000, 'page unloading');
    if (relay.sessionId && relay.connectionToken) {
      void fetch(`/api/codex-relay/sessions/${encodeURIComponent(relay.sessionId)}/lease/release`, {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', ...relayHeaders() },
        body: JSON.stringify({ browserInstanceId: relayBrowserInstanceId, leaseEpoch: relay.leaseEpoch }),
      });
    }
  }, { once: true });
})();
