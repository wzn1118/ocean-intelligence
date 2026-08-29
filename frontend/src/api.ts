import type {
  ArgoEventCoverage,
  ArgoFloatSnapshot,
  ArgoFloatHistory,
  MonitoredBuoy,
  CopernicusWavePoint,
  CopernicusWindPoint,
  CopernicusCurrentField,
  CopernicusGlobalDataVolume,
  DailyBriefingEnvelope,
  DailyBriefingDashboard,
  CopernicusHistoryPage,
  CopernicusEventPage,
  ArgoPointSelection,
  ArgoRegionSnapshot,
  BathymetryProfile,
  EventSummary,
  EventLifecycleRecord,
  EventExplanation,
  LiteratureSearchResponse,
  Metrics,
  MarineContext,
  MarineKnowledge,
  RegionalObservationSummary,
  OceanRegion,
  OceanEvent,
  RefreshResult,
  RefreshJob,
  ScientificReport,
  SourceHealth,
  WorkspaceSnapshot,
  AgentChatRequest,
  AgentChatResponse,
  AgentContextManifest,
  AgentMemory,
  AgentSession,
  AgentSessionDetail,
  AuthSession,
  AuthenticatedSession,
  ProviderConnectionTestResult,
  ProviderModelDiscoveryRequest,
  ProviderModelDiscoveryResult,
  ProviderPreset,
  UserApiConfig,
  UserApiConfigUpdate,
} from "./types";

function normalizeApiRoot(configuredRoot?: string): string {
  const candidate = configuredRoot?.trim();
  if (!candidate) return "/api";

  const withoutTrailingSlash = candidate.replace(/\/+$/, "");
  if (/^https?:\/\//i.test(withoutTrailingSlash)) {
    const url = new URL(withoutTrailingSlash);
    if (url.pathname === "" || url.pathname === "/") url.pathname = "/api";
    return url.toString().replace(/\/$/, "");
  }
  if (withoutTrailingSlash === "" || withoutTrailingSlash === "/") return "/api";
  return withoutTrailingSlash.startsWith("/") ? withoutTrailingSlash : `/${withoutTrailingSlash}`;
}

export const API_ROOT = normalizeApiRoot(import.meta.env.VITE_API_ROOT);

export class ApiRequestError extends Error {
  readonly method: string;
  readonly path: string;
  readonly status: number | null;

  constructor(message: string, method: string, path: string, status: number | null = null) {
    super(message);
    this.name = "ApiRequestError";
    this.method = method;
    this.path = path;
    this.status = status;
  }
}

let inMemoryCsrfToken: string | null = null;

function cookieCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const acceptedNames = new Set(["x-csrf-token", "csrf-token", "csrf_token", "ocean_csrf"]);
  for (const part of document.cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = decodeURIComponent(part.slice(0, separator).trim()).toLowerCase();
    if (!acceptedNames.has(name)) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return null;
}

export function csrfHeadersFor(method: string): Record<string, string> {
  if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return {};
  const token = cookieCsrfToken() ?? inMemoryCsrfToken;
  return token ? { "X-CSRF-Token": token } : {};
}

function rememberSession(session: AuthSession): AuthSession {
  inMemoryCsrfToken = session.csrf_token;
  return session;
}

async function responseDetail(response: Response): Promise<string> {
  try {
    const payload = await response.json() as {
      detail?: string | Array<{ msg?: string }>;
      message?: string;
    };
    if (typeof payload.detail === "string") return payload.detail;
    if (Array.isArray(payload.detail)) {
      return payload.detail.map((item) => item.msg).filter(Boolean).join("；");
    }
    return typeof payload.message === "string" ? payload.message : "";
  } catch {
    return "";
  }
}

async function request<T>(path: string, signal?: AbortSignal, method = "GET"): Promise<T> {
  const endpoint = `${API_ROOT}${path}`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      signal,
      method,
      credentials: "include",
      headers: { Accept: "application/json", ...csrfHeadersFor(method) },
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiRequestError(`无法连接数据服务（${method} ${path}）`, method, path);
  }
  if (!response.ok) {
    const detail = await responseDetail(response);
    throw new ApiRequestError(
      detail || `数据接口返回 ${response.status}（${method} ${path}）`,
      method,
      path,
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function requestJson<T>(path: string, body: unknown, signal?: AbortSignal, method = "POST"): Promise<T> {
  const endpoint = `${API_ROOT}${path}`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      signal,
      method,
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...csrfHeadersFor(method),
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiRequestError(`无法连接数据服务（${method} ${path}）`, method, path);
  }
  if (!response.ok) {
    const detail = await responseDetail(response);
    throw new ApiRequestError(detail || `数据接口返回 ${response.status}（${method} ${path}）`, method, path, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const authApi = {
  session: async (signal?: AbortSignal) => {
    try {
      return rememberSession(await request<AuthSession>("/auth/session", signal));
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        return rememberSession({ user: null, csrf_token: null });
      }
      throw error;
    }
  },
  login: async (payload: { email: string; password: string }, signal?: AbortSignal) =>
    rememberSession(await requestJson<AuthenticatedSession>("/auth/login", payload, signal)) as AuthenticatedSession,
  register: async (payload: { email: string; password: string; display_name: string }, signal?: AbortSignal) =>
    rememberSession(await requestJson<AuthenticatedSession>("/auth/register", payload, signal)) as AuthenticatedSession,
  csrf: async (signal?: AbortSignal) => {
    const result = await request<{ csrf_token: string }>("/auth/csrf", signal);
    inMemoryCsrfToken = result.csrf_token;
    return result;
  },
  logout: async (signal?: AbortSignal) => {
    await request<void>("/auth/logout", signal, "POST");
    inMemoryCsrfToken = null;
  },
  providerPresets: (signal?: AbortSignal) =>
    request<ProviderPreset[]>("/account/provider-presets", signal),
  apiConfig: (signal?: AbortSignal) =>
    request<UserApiConfig | null>("/account/api-config", signal),
  updateApiConfig: (payload: UserApiConfigUpdate, signal?: AbortSignal) =>
    requestJson<UserApiConfig>("/account/api-config", payload, signal, "PUT"),
  testApiConfig: (payload: UserApiConfigUpdate, signal?: AbortSignal) =>
    requestJson<ProviderConnectionTestResult>("/account/api-config/test", payload, signal),
  discoverModels: (payload: ProviderModelDiscoveryRequest, signal?: AbortSignal) =>
    requestJson<ProviderModelDiscoveryResult>("/account/api-config/models", payload, signal),
  deleteApiConfig: (signal?: AbortSignal) =>
    request<void>("/account/api-config", signal, "DELETE"),
  monitoredBuoys: (signal?: AbortSignal) =>
    request<MonitoredBuoy[]>("/account/monitored-buoys", signal),
  setMonitoredBuoy: (platform: string, enabled: boolean, signal?: AbortSignal) =>
    request<MonitoredBuoy>(`/account/monitored-buoys/${encodeURIComponent(platform)}?enabled=${enabled}`, signal, "PUT"),
};

export const oceanApi = {
  health: () => request<{ status: string; service: string }>("/health"),
  regions: (signal?: AbortSignal) => request<OceanRegion[]>("/regions", signal),
  events: (region?: string, mode: "live" | "scenario" | "all" = "live", refresh = false, signal?: AbortSignal) => {
    const query = new URLSearchParams();
    if (region) query.set("region", region);
    query.set("mode", mode);
    if (refresh) query.set("refresh", "true");
    return request<EventSummary[]>(`/events?${query.toString()}`, signal);
  },
  signals: (region = "global_ocean", refresh = false, signal?: AbortSignal) =>
    request<EventSummary[]>(`/signals?region=${encodeURIComponent(region)}${refresh ? "&refresh=true" : ""}`, signal),
  observations: (region = "global_ocean", variable?: string, refresh = false, signal?: AbortSignal) => {
    const query = new URLSearchParams({ region });
    if (variable) query.set("variable", variable);
    if (refresh) query.set("refresh", "true");
    return request<EventSummary[]>(`/observations?${query.toString()}`, signal);
  },
  event: (eventId: string) => request<OceanEvent>(`/events/${eventId}`),
  eventTimeline: (eventId: string) => request<OceanEvent["timeline"]>(`/events/${eventId}/timeline`),
  eventLifecycle: (region = "global_ocean") =>
    request<EventLifecycleRecord[]>(`/event-lifecycle?region=${encodeURIComponent(region)}`),
  report: (eventId: string) =>
    request<ScientificReport>(`/events/${eventId}/report`),
  explanation: (eventId: string, refresh = false) =>
    request<EventExplanation>(`/events/${eventId}/explanation${refresh ? "?refresh=true" : ""}`),
  literature: (eventId: string, refresh = false, signal?: AbortSignal) =>
    request<LiteratureSearchResponse>(`/events/${eventId}/literature${refresh ? "?refresh=true" : ""}`, signal),
  metrics: (region?: string) => request<Metrics>(`/metrics${region ? `?region=${encodeURIComponent(region)}` : ""}`),
  observationSummary: (region: string) =>
    request<RegionalObservationSummary>(`/observations/summary?region=${encodeURIComponent(region)}`),
  sources: (region: string) => request<SourceHealth[]>(`/sources?region=${encodeURIComponent(region)}`),
  refresh: (region: string) => request<RefreshResult>(`/refresh?region=${encodeURIComponent(region)}`, undefined, "POST"),
  workspaceSnapshot: (region: string, refresh = false, signal?: AbortSignal) => {
    const query = new URLSearchParams({ region });
    if (refresh) query.set("refresh", "true");
    return request<WorkspaceSnapshot>(`/workspace/snapshot?${query.toString()}`, signal);
  },
  copernicusEventPage: (cursor: number, refresh = false, signal?: AbortSignal) =>
    request<CopernicusEventPage>(`/copernicus/events/page?cursor=${cursor}${refresh ? "&refresh=true" : ""}`, signal),
  agentContext: (region: string, signal?: AbortSignal) =>
    request<AgentContextManifest>(`/agent/context?region=${encodeURIComponent(region)}`, signal),
  agentChat: (payload: AgentChatRequest, signal?: AbortSignal) =>
    requestJson<AgentChatResponse>("/agent/chat", payload, signal),
  agentSessions: (region: string, signal?: AbortSignal) =>
    request<AgentSession[]>(`/agent/sessions?region=${encodeURIComponent(region)}`, signal),
  agentSession: (sessionId: string, signal?: AbortSignal) =>
    request<AgentSessionDetail>(`/agent/sessions/${encodeURIComponent(sessionId)}`, signal),
  createAgentSession: (payload: { region_id: string; title?: string; selected_event_id?: string | null }, signal?: AbortSignal) =>
    requestJson<AgentSession>("/agent/sessions", payload, signal),
  updateAgentSession: (sessionId: string, payload: { title?: string; archived?: boolean }, signal?: AbortSignal) =>
    requestJson<AgentSession>(`/agent/sessions/${encodeURIComponent(sessionId)}`, payload, signal, "PATCH"),
  deleteAgentSession: (sessionId: string, signal?: AbortSignal) =>
    request<void>(`/agent/sessions/${encodeURIComponent(sessionId)}`, signal, "DELETE"),
  agentMemories: (region: string, signal?: AbortSignal) =>
    request<AgentMemory[]>(`/agent/memories?region=${encodeURIComponent(region)}&include_disabled=true`, signal),
  createAgentMemory: (payload: { kind: AgentMemory["kind"]; content: string; region_id?: string | null }, signal?: AbortSignal) =>
    requestJson<AgentMemory>("/agent/memories", payload, signal),
  updateAgentMemory: (memoryId: string, payload: { content?: string; enabled?: boolean }, signal?: AbortSignal) =>
    requestJson<AgentMemory>(`/agent/memories/${encodeURIComponent(memoryId)}`, payload, signal, "PATCH"),
  deleteAgentMemory: (memoryId: string, signal?: AbortSignal) =>
    request<void>(`/agent/memories/${encodeURIComponent(memoryId)}`, signal, "DELETE"),
  enqueueRefresh: (region: string, signal?: AbortSignal) =>
    request<RefreshJob>(`/refresh/jobs?region=${encodeURIComponent(region)}`, signal, "POST"),
  refreshJob: (jobId: string, signal?: AbortSignal) =>
    request<RefreshJob>(`/refresh/jobs/${encodeURIComponent(jobId)}`, signal),
  argoFloat: (platform = "5906518", refresh = false, signal?: AbortSignal) =>
    request<ArgoFloatSnapshot>(`/argo/float/${encodeURIComponent(platform)}${refresh ? "?refresh=true" : ""}`, signal),
  argoFloatHistory: (platform: string, dateCount = 7, refresh = false, signal?: AbortSignal) =>
    request<ArgoFloatHistory>(`/argo/float/${encodeURIComponent(platform)}/history?date_count=${dateCount}${refresh ? "&refresh=true" : ""}`, signal),
  argoRegion: (region: string, refresh = false, signal?: AbortSignal) => {
    const query = new URLSearchParams({ region });
    if (refresh) query.set("refresh", "true");
    return request<ArgoRegionSnapshot>(`/argo/region?${query.toString()}`, signal);
  },
  argoNearest: (
    region: string,
    longitude: number,
    latitude: number,
    platform?: string,
    refresh = false,
    signal?: AbortSignal,
    includeContext = true,
  ) => {
    const query = new URLSearchParams({
      region,
      longitude: String(longitude),
      latitude: String(latitude),
    });
    if (platform) query.set("platform", platform);
    if (refresh) query.set("refresh", "true");
    if (!includeContext) query.set("include_context", "false");
    return request<ArgoPointSelection>(`/argo/nearest?${query.toString()}`, signal);
  },
  copernicusWavePoint: (longitude: number, latitude: number, days = 3, signal?: AbortSignal) =>
    request<CopernicusWavePoint>(`/copernicus/waves/point?longitude=${longitude}&latitude=${latitude}&days=${days}`, signal),
  copernicusWindPoint: (longitude: number, latitude: number, days = 3, signal?: AbortSignal) =>
    request<CopernicusWindPoint>(`/copernicus/wind/point?longitude=${longitude}&latitude=${latitude}&days=${days}`, signal),
  copernicusCurrentField: (
    bounds: [[number, number], [number, number]],
    size: { width: number; height: number },
    signal?: AbortSignal,
  ) => {
    const query = new URLSearchParams({
      west: String(bounds[0][0]),
      south: String(bounds[0][1]),
      east: String(bounds[1][0]),
      north: String(bounds[1][1]),
      width: String(size.width),
      height: String(size.height),
    });
    return request<CopernicusCurrentField>(`/copernicus/currents/field?${query.toString()}`, signal);
  },
  copernicusGlobalDailyVolume: (refresh = false, signal?: AbortSignal) =>
    request<CopernicusGlobalDataVolume>(`/copernicus/global/daily-volume${refresh ? "?refresh=true" : ""}`, signal),
  dailyBriefing: (signal?: AbortSignal) => request<DailyBriefingEnvelope>("/daily-briefing", signal),
  dailyBriefingDashboard: (refresh = false, signal?: AbortSignal) => request<DailyBriefingDashboard>(`/daily-briefing/dashboard${refresh ? "?refresh=true" : ""}`, signal),
  copernicusHistoryPoint: (
    longitude: number,
    latitude: number,
    source: "wave" | "wind",
    options: { sync?: boolean; limit?: number; offset?: number } = {},
    signal?: AbortSignal,
  ) => {
    const query = new URLSearchParams({
      longitude: String(longitude),
      latitude: String(latitude),
      source,
      limit: String(options.limit ?? 200),
      offset: String(options.offset ?? 0),
    });
    if (options.sync) query.set("sync", "true");
    return request<CopernicusHistoryPage>(`/copernicus/history/point?${query.toString()}`, signal);
  },
  marineContext: (longitude: number, latitude: number, refresh = false, signal?: AbortSignal) => {
    const query = new URLSearchParams({ longitude: String(longitude), latitude: String(latitude) });
    if (refresh) query.set("refresh", "true");
    return request<MarineContext>(`/marine/context?${query.toString()}`, signal);
  },
  marineBathymetry: (longitude: number, latitude: number, refresh = false, signal?: AbortSignal) => {
    const query = new URLSearchParams({ longitude: String(longitude), latitude: String(latitude) });
    if (refresh) query.set("refresh", "true");
    return request<BathymetryProfile>(`/marine/bathymetry?${query.toString()}`, signal);
  },
  marineKnowledge: (longitude: number, latitude: number, refresh = false, signal?: AbortSignal) => {
    const query = new URLSearchParams({ longitude: String(longitude), latitude: String(latitude) });
    if (refresh) query.set("refresh", "true");
    return request<MarineKnowledge>(`/marine/knowledge?${query.toString()}`, signal);
  },
  eventArgo: (eventId: string, platform?: string, refresh = false, signal?: AbortSignal) => {
    const query = new URLSearchParams();
    if (platform) query.set("platform", platform);
    if (refresh) query.set("refresh", "true");
    const suffix = query.size ? `?${query.toString()}` : "";
    return request<ArgoEventCoverage>(`/events/${encodeURIComponent(eventId)}/argo${suffix}`, signal);
  },
};
