import { csrfHeadersFor } from "./api";

export interface CodexRuntimeStatus {
  ready: boolean;
  mode: string;
  executablePath: string;
  workspaceRoot: string;
  renderer: { available: boolean; desktop?: unknown };
  backend: {
    running: boolean;
    initialized: boolean;
    pid: number | null;
    appServerVersion: string;
    sequence: number;
    contextMcps: Array<{ configured: boolean; name: string; endpoint: string }>;
    modelProvider: { configured: boolean; name?: string; model?: string; endpoint?: string };
    dynamicMcp?: {
      tools?: number;
      catalogReady?: boolean;
      catalogError?: string;
      namespaces?: Array<{ namespace: string; server: string }>;
    };
    adapter?: {
      capabilities?: Record<string, "supported" | "unsupported" | "unknown">;
      methods?: string[];
      evidence?: string;
    };
  };
  startupError: { code: string; message: string } | null;
}

export interface CodexHarnessSnapshot {
  ready: boolean;
  workspaceRoot: string;
  approvalPolicy: string;
  sandbox: string;
  projectSourceAccess: "read-only";
  writableRoots: string[];
  exposedMethods: string[];
  adapter?: {
    capabilities?: Record<string, "supported" | "unsupported" | "unknown">;
    evidence?: string;
  };
  inventory: Record<string, { ok: boolean; count: number; result?: unknown; error?: { message?: string } }>;
}

export interface CodexThreadItem {
  id: string;
  type: string;
  text?: string;
  content?: Array<{ type: string; text?: string; url?: string; path?: string }>;
  summary?: string[];
  command?: string;
  aggregatedOutput?: string | null;
  cwd?: string;
  exitCode?: number | null;
  status?: string;
  server?: string;
  tool?: string;
  query?: string;
  changes?: Array<{ path?: string; kind?: string }>;
  result?: unknown;
  error?: unknown;
}

export interface CodexTurn {
  id: string;
  status: string;
  items: CodexThreadItem[];
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number | null;
  error?: { message?: string } | null;
}

export interface CodexThread {
  id: string;
  name?: string | null;
  preview: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  recencyAt?: number | null;
  modelProvider: string;
  status: string | { type?: string };
  turns: CodexTurn[];
}

export interface CodexThreadRecovery {
  verified: boolean;
  turnCount: number;
  itemCount: number;
  hasUserContext: boolean;
  meaningfulTurnId: string | null;
  meaningfulTurnStatus: string | null;
  needsContinuation: boolean;
}

export interface CodexEvent {
  sequence: number;
  message: {
    type?: string;
    method?: string;
    params?: Record<string, unknown>;
    request?: { id?: string | number; method?: string; params?: Record<string, unknown> };
  };
}

export interface CodexArtifact {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
  mimeType: string;
  previewable: boolean;
}

export interface CodexArtifactContent {
  path: string;
  content: string;
  truncated: boolean;
  mimeType: string;
}

export type CodexUpload = CodexArtifact;

export interface CodexReportManifest {
  id: string;
  requiredPaths: string[];
  minimumVisuals: number;
  minimumChartTypes: number;
  visualPrefix: string;
  minimumHeadings: number;
  minimumMarkdownBytes: number;
  minimumHtmlBytes: number;
  minimumHtmlFigures: number;
  minimumAnalyticalClaims: number;
  minimumComparisons: number;
  minimumEvidenceMarkers: number;
  requiredZoneCount: number;
  requiresPointInventory: boolean;
  requiresWindAnalysis: boolean;
}

async function runtimeRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/codex-runtime${path}`, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...csrfHeadersFor(init?.method ?? "GET"),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    let message = `Codex 服务返回 ${response.status}`;
    try {
      const payload = await response.json() as { error?: { message?: string } };
      if (payload.error?.message) message = payload.error.message;
    } catch {
      // Status is sufficient when a proxy response has no JSON body.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export const codexApi = {
  status: () => runtimeRequest<CodexRuntimeStatus>("/status"),
  harness: () => runtimeRequest<CodexHarnessSnapshot>("/harness"),
  harnessRequest: <T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 90_000) => runtimeRequest<{ method: string; result: T }>("/harness/request", {
    method: "POST",
    body: JSON.stringify({ method, params, timeoutMs }),
  }),
  probe: () => runtimeRequest<{ ready: boolean; passed: number; total: number }>("/probe", { method: "POST" }),
  threads: (search = "") => runtimeRequest<{ data?: CodexThread[]; threads?: CodexThread[]; nextCursor?: string | null }>(
    `/threads?limit=30${search ? `&search=${encodeURIComponent(search)}` : ""}`,
  ),
  thread: (threadId: string) => runtimeRequest<{ thread: CodexThread }>(`/threads/${encodeURIComponent(threadId)}`),
  startThread: (regionId: string) => runtimeRequest<{ thread: CodexThread }>("/threads", {
    method: "POST",
    body: JSON.stringify({ regionId }),
  }),
  resumeThread: (threadId: string) => runtimeRequest<{ thread: CodexThread; recovery: CodexThreadRecovery }>(`/threads/${encodeURIComponent(threadId)}/resume`, {
    method: "POST",
    body: JSON.stringify({}),
  }),
  startTurn: (
    threadId: string,
    text: string,
    effort: "medium" | "high" | "xhigh",
    attachments: CodexUpload[] = [],
    outputMode: "conversation" | "illustrated_report" = "conversation",
    reportId?: string,
  ) => runtimeRequest<{ turn: CodexTurn; report?: CodexReportManifest }>(
    `/threads/${encodeURIComponent(threadId)}/turns`,
    { method: "POST", body: JSON.stringify({ text, effort, outputMode, reportId, attachments: attachments.map(({ path, mimeType }) => ({ path, mimeType })) }) },
  ),
  interrupt: (threadId: string, turnId: string) => runtimeRequest<unknown>(`/threads/${encodeURIComponent(threadId)}/interrupt`, {
    method: "POST",
    body: JSON.stringify({ turnId }),
  }),
  artifacts: (threadId: string) => runtimeRequest<{ artifacts: CodexArtifact[] }>(`/artifacts?threadId=${encodeURIComponent(threadId)}`),
  reportStatus: (threadId: string, reportId: string) => runtimeRequest<{
    complete: boolean;
    artifacts: CodexArtifact[];
    missingPaths: string[];
    visualCount: number | null;
    qualityInspected: boolean;
    minimumVisuals: number;
    quality: { markdownBytes: number; htmlBytes: number; headingCount: number; figureCount: number; uniqueChartTypes: number; chartMetadataOk: boolean; chartDiversityOk: boolean; scientificChartFamiliesOk: boolean; chartSemanticsOk: boolean; professionalVisualizationOk: boolean; figureInterpretationCount: number; completeFigureInterpretationCount: number; figureInterpretationOk: boolean; waveEnergySemanticsOk: boolean; crossVariableConsistencyOk: boolean; operationalImpactOk: boolean; physicalRealityInterpretationOk: boolean; anomalyRankingOk: boolean; zoneAnomalyCoverageOk: boolean; collocatedPointInventoryOk: boolean; collocationMethodOk: boolean; independentValidationOk: boolean; crossVariableMatrixOk: boolean; lagAnalysisOk: boolean; falsificationPathOk: boolean; anomalyLinkageOk: boolean; editorialStyleOk: boolean; editorialStyleViolationCount: number; defensiveStyleMatches: string[]; cannedTransitionMatches: string[]; colloquialSingleVerbMatches: string[]; analyticalClaims: number; comparisons: number; evidenceMarkers: number; zoneCoverage: number; pointZoneCoverage: number; centerPointOk: boolean; geographyResolutionOk: boolean; pointInventoryOk: boolean; pointAuditOk: boolean; windTimeSemanticsOk: boolean; windVectorSemanticsOk: boolean; windComparisonOk: boolean; windPointValidationOk: boolean; variableSectionsOk: boolean; variableSectionChecks: Record<string, boolean>; physicalRotationOk: boolean; physicalScaleAnalysisOk: boolean; physicalBalanceOk: boolean; physicalProvenanceOk: boolean; physicalZoneRegimeOk: boolean; physicalUncertaintyOk: boolean; textbookReferenceOk: boolean; physicalOceanographyOk: boolean } | null;
  }>(
    `/reports/status?threadId=${encodeURIComponent(threadId)}&reportId=${encodeURIComponent(reportId)}`,
  ),
  uploads: (threadId: string) => runtimeRequest<{ uploads: CodexUpload[] }>(`/uploads?threadId=${encodeURIComponent(threadId)}`),
  upload: (threadId: string, file: File) => runtimeRequest<{ upload: CodexUpload }>(
    `/uploads?threadId=${encodeURIComponent(threadId)}&name=${encodeURIComponent(file.name)}`,
    { method: "POST", body: file, headers: { "Content-Type": "application/octet-stream" } },
  ),
  artifactContent: (path: string) => runtimeRequest<CodexArtifactContent>(`/artifacts/content?path=${encodeURIComponent(path)}`),
  artifactDownloadUrl: (path: string) => `/api/codex-runtime/artifacts/download?path=${encodeURIComponent(path)}`,
  artifactViewUrl: (path: string) => `/api/codex-runtime/artifacts/download?inline=true&path=${encodeURIComponent(path)}`,
  eventStreamUrl: (threadId?: string | null) => `/api/codex-runtime/event-stream${threadId ? `?threadId=${encodeURIComponent(threadId)}` : ""}`,
};
