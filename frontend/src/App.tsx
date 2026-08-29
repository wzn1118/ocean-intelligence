import {
  Activity,
  ArrowUpRight,
  Bell,
  Bot,
  BookOpen,
  CalendarRange,
  Columns3,
  Database,
  Eye,
  FileSearch,
  Globe2,
  GripVertical,
  Layers3,
  List,
  ListFilter,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Radio,
  RefreshCw,
  Rows3,
  Search,
  Sun,
  UserRound,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { ApiRequestError, authApi, oceanApi } from "./api";
import { AccountSettings, AuthBootScreen, AuthGate } from "./components/AuthExperience";
import { CommandPalette, type WorkspaceCommand } from "./components/CommandPalette";
import { DataAgentWorkspace } from "./components/DataAgentWorkspace";
import { EventDetail, type DetailTab } from "./components/EventDetail";
import { EventQueue, type EventViewMode } from "./components/EventQueue";
import { ExplorerHome, type ExperienceMode } from "./components/ExplorerHome";
import { OceanMap } from "./components/OceanMap";
import { BuoyFleetPanel } from "./components/BuoyFleetPanel";
import { usePersistentState } from "./hooks/usePersistentState";
import type {
  ArgoEventCoverage,
  ArgoFloatSnapshot,
  ArgoRegionSnapshot,
  AuthenticatedSession,
  CopernicusGlobalDataVolume,
  DailyBriefingEnvelope,
  DailyBriefingDashboard,
  CoverageStatus,
  EventCounts,
  EventSummary,
  EventExplanation,
  LiteratureSearchResponse,
  Metrics,
  OceanRegion,
  OceanEvent,
  RegionalObservationSummary,
  ScientificReport,
  SourceHealth,
} from "./types";

const EMPTY_METRICS: Metrics = {
  active_events: 0,
  critical_events: 0,
  observing_assets: 0,
  observation_count: 0,
  data_freshness_hours: null,
  coverage_percent: null,
  coverage_basis: "undefined",
  last_analysis_at: new Date().toISOString(),
  source_count: 0,
  region_count: 0,
  live_event_count: 0,
};

const DEFAULT_REGION: OceanRegion = {
  id: "global_ocean",
  name: "全球",
  short_name: "全球海洋",
  description: "覆盖南北纬 70 度之间的全球主要海洋。",
  bounds: [[-179, -70], [179, 70]],
  center: [10, 0],
  zoom: 1.15,
};

const OBSERVATION_FILTER_VARIABLES: Record<string, string[]> = {
  carbon_anomaly: ["PCO2", "DIC"],
  current_anomaly: ["CURRENT"],
  salinity_anomaly: ["SALINITY"],
  nutrient_anomaly: ["NITRATE"],
  chlorophyll_anomaly: ["CHLA"],
  surface_temperature_anomaly: ["SST", "TEMPERATURE"],
  wave_anomaly: ["WAVE_HEIGHT", "SWELL_HEIGHT", "WIND_WAVE_HEIGHT"],
  wind_anomaly: ["WIND_SPEED", "WIND_DIRECTION"],
  typhoon_warning: ["TYPHOON"],
};

const ARGO_AUTO_EVENT_TYPES = new Set<EventSummary["type"]>([
  "hydrographic_observation",
  "biogeochemical_observation",
  "salinity_anomaly",
  "nutrient_anomaly",
  "chlorophyll_anomaly",
]);
const OVERVIEW_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const STALE_REVALIDATION_POLL_MS = 30 * 1000;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "未知数据服务错误";

const compactCount = new Intl.NumberFormat("zh-CN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function mergeCountMaps(base: Record<string, number>, added: Record<string, number>) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(added)) merged[key] = (merged[key] ?? 0) + value;
  return merged;
}

function mergeEventCounts(base: EventCounts, added: EventCounts): EventCounts {
  return {
    total: base.total + added.total,
    observations: base.observations + added.observations,
    signals: base.signals + added.signals,
    events: base.events + added.events,
    by_variable: mergeCountMaps(base.by_variable, added.by_variable),
    by_type: mergeCountMaps(base.by_type, added.by_type),
    by_kind: mergeCountMaps(base.by_kind, added.by_kind),
    by_lifecycle: mergeCountMaps(base.by_lifecycle, added.by_lifecycle),
    by_filter: mergeCountMaps(base.by_filter, added.by_filter),
  };
}

type WorkspaceLayout = "flow" | "dock";
type VisualTheme = "night" | "light-blue";

interface OceanWorkspaceProps {
  session: AuthenticatedSession;
  onSignedOut: () => void;
}

function OceanWorkspace({ session, onSignedOut }: OceanWorkspaceProps) {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [copernicusGlobalVolume, setCopernicusGlobalVolume] = useState<CopernicusGlobalDataVolume | null>(null);
  const [copernicusGlobalVolumeLoading, setCopernicusGlobalVolumeLoading] = useState(true);
  const [dailyBriefing, setDailyBriefing] = useState<DailyBriefingEnvelope | null>(null);
  const [dailyBriefingDashboard, setDailyBriefingDashboard] = useState<DailyBriefingDashboard | null>(null);
  const [copernicusPageCursor, setCopernicusPageCursor] = useState(0);
  const [copernicusHasMore, setCopernicusHasMore] = useState(true);
  const [copernicusLoadingMore, setCopernicusLoadingMore] = useState(false);
  const [eventCounts, setEventCounts] = useState<EventCounts | null>(null);
  const [metrics, setMetrics] = useState<Metrics>(EMPTY_METRICS);
  const [selectedEvent, setSelectedEvent] = useState<OceanEvent | null>(null);
  const [report, setReport] = useState<ScientificReport | null>(null);
  const [explanation, setExplanation] = useState<EventExplanation | null>(null);
  const [explanationLoading, setExplanationLoading] = useState(false);
  const [literature, setLiterature] = useState<LiteratureSearchResponse | null>(null);
  const [literatureLoading, setLiteratureLoading] = useState(false);
  const [literatureError, setLiteratureError] = useState<string | null>(null);
  const [regions, setRegions] = useState<OceanRegion[]>([DEFAULT_REGION]);
  const [sourceHealth, setSourceHealth] = useState<SourceHealth[]>([]);
  const [observationSummary, setObservationSummary] = useState<RegionalObservationSummary | null>(null);
  const [coverageStatus, setCoverageStatus] = useState<CoverageStatus | null>(null);
  const [observationError, setObservationError] = useState<string | null>(null);
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [regionError, setRegionError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailReloadToken, setDetailReloadToken] = useState(0);
  const [argoSnapshot, setArgoSnapshot] = useState<ArgoFloatSnapshot | null>(null);
  const [argoRegion, setArgoRegion] = useState<ArgoRegionSnapshot | null>(null);
  const [buoyPanelOpen, setBuoyPanelOpen] = useState(false);
  const [buoyLauncherHidden, setBuoyLauncherHidden] = useState(false);
  const [buoyLauncherDragging, setBuoyLauncherDragging] = useState(false);
  const [buoyLauncherPosition, setBuoyLauncherPosition] = usePersistentState<{ x: number; y: number } | null>("ocean-ui-buoy-launcher-position", null);
  const [buoyMonitoredOnly, setBuoyMonitoredOnly] = useState(false);
  const [focusArgoPlatform, setFocusArgoPlatform] = useState<string | null>(null);
  const [monitoredPlatforms, setMonitoredPlatforms] = useState<Set<string>>(() => new Set());
  const [argoCoverage, setArgoCoverage] = useState<ArgoEventCoverage | null>(null);
  const [argoLoading, setArgoLoading] = useState(true);
  const [argoError, setArgoError] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [compactLayout, setCompactLayout] = useState(() => window.matchMedia("(max-width: 980px)").matches);
  const [query, setQuery] = usePersistentState("ocean-ui-query", "");
  const [typeFilter, setTypeFilter] = usePersistentState("ocean-ui-filter-v2", "all");
  const [eventViewMode, setEventViewMode] = usePersistentState<EventViewMode>("ocean-ui-event-view-v4", "all");
  const [selectedRegionId, setSelectedRegionId] = usePersistentState("ocean-ui-region-v3", DEFAULT_REGION.id);
  const [selectedId, setSelectedId] = usePersistentState<string | null>("ocean-ui-selected-event", null);
  const [detailTab, setDetailTab] = usePersistentState<DetailTab>("ocean-ui-detail-tab", "overview");
  const [queueCollapsed, setQueueCollapsed] = usePersistentState("ocean-ui-queue-collapsed", false);
  const [detailCollapsed, setDetailCollapsed] = usePersistentState("ocean-ui-detail-collapsed", false);
  const [experienceMode, setExperienceMode] = usePersistentState<ExperienceMode>("ocean-ui-experience-mode", "explorer");
  const [briefOpen, setBriefOpen] = useState(false);
  const [workspaceLayout, setWorkspaceLayout] = usePersistentState<WorkspaceLayout>("ocean-ui-workspace-layout", "flow");
  const [visualTheme, setVisualTheme] = usePersistentState<VisualTheme>("ocean-ui-visual-theme", "night");
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [queueWidth, setQueueWidth] = usePersistentState("ocean-ui-queue-width", 324);
  const [detailWidth, setDetailWidth] = usePersistentState("ocean-ui-detail-width", 430);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const buoyLauncherRef = useRef<HTMLDivElement>(null);
  const overviewRequestRef = useRef(0);
  const workspaceEventCountsRef = useRef<EventCounts | null>(null);
  const argoRequestRef = useRef(0);
  const overviewAbortRef = useRef<AbortController | null>(null);
  const copernicusVolumeAbortRef = useRef<AbortController | null>(null);
  const overviewInFlightRef = useRef<{
    key: string;
    controller: AbortController;
    promise: ReturnType<typeof oceanApi.workspaceSnapshot>;
  } | null>(null);
  const regionsAbortRef = useRef<AbortController | null>(null);
  const selectedRegion = regions.find((region) => region.id === selectedRegionId) ?? DEFAULT_REGION;
  const selectedSummary = useMemo(() => events.find((event) => event.id === selectedId), [events, selectedId]);
  const lightTheme = visualTheme === "light-blue";
  const selectedSummaryIsArgo = Boolean(selectedSummary?.id.toUpperCase().includes("-ARGO-"));
  const argoDeferred = Boolean(
    selectedSummary
    && !selectedSummaryIsArgo
    && !ARGO_AUTO_EVENT_TYPES.has(selectedSummary.type),
  );
  const apiError = [overviewError, regionError].filter(Boolean).join("；") || null;
  const overviewPending = eventCounts === null;
  const copernicusVolumeLabel = copernicusGlobalVolumeLoading
    ? "读取中"
    : copernicusGlobalVolume
      ? compactCount.format(copernicusGlobalVolume.record_count)
      : "暂不可用";
  const copernicusVolumeTitle = copernicusGlobalVolume
    ? `${copernicusGlobalVolume.date} UTC 全球 ${copernicusGlobalVolume.datasets.filter((dataset) => dataset.is_current_day).length}/${copernicusGlobalVolume.dataset_count} 个 Copernicus Marine 产品已更新到当天，共 ${copernicusGlobalVolume.record_count.toLocaleString("zh-CN")} 条网格时次记录、${copernicusGlobalVolume.value_count.toLocaleString("zh-CN")} 个变量值；最新时次 ${copernicusGlobalVolume.latest_observation_at ?? "未知"}${copernicusGlobalVolume.errors.length ? `；${copernicusGlobalVolume.errors.join("；")}` : ""}`
    : "正在读取当天全球 Copernicus Marine 完整网格数据量";

  const loadCopernicusGlobalVolume = useCallback(async (forceRefresh = false) => {
    copernicusVolumeAbortRef.current?.abort();
    const controller = new AbortController();
    copernicusVolumeAbortRef.current = controller;
    try {
      const volume = await oceanApi.copernicusGlobalDailyVolume(forceRefresh, controller.signal);
      setCopernicusGlobalVolume(volume);
    } catch (error) {
      if (controller.signal.aborted || (error as Error).name === "AbortError") return;
    } finally {
      if (copernicusVolumeAbortRef.current === controller) {
        copernicusVolumeAbortRef.current = null;
        setCopernicusGlobalVolumeLoading(false);
      }
    }
  }, []);

  const loadOverview = useCallback(async (showActivity = true, forceRefresh = false) => {
    const requestId = ++overviewRequestRef.current;
    const requestKey = `${selectedRegionId}:${forceRefresh}`;
    let activeRequest = overviewInFlightRef.current;
    if (!activeRequest || activeRequest.key !== requestKey || activeRequest.controller.signal.aborted) {
      overviewAbortRef.current?.abort();
      const controller = new AbortController();
      activeRequest = {
        key: requestKey,
        controller,
        promise: oceanApi.workspaceSnapshot(selectedRegionId, forceRefresh, controller.signal),
      };
      overviewAbortRef.current = controller;
      overviewInFlightRef.current = activeRequest;
    }
    const { controller, promise } = activeRequest;
    if (showActivity) setRefreshing(true);
    try {
      const snapshot = await promise;
      if (requestId !== overviewRequestRef.current) return;
      setEvents(snapshot.events);
      setCopernicusPageCursor(0);
      setCopernicusHasMore(false);
      workspaceEventCountsRef.current = snapshot.event_counts;
      setEventCounts(snapshot.event_counts);
      setMetrics(snapshot.metrics);
      setSourceHealth(snapshot.sources);
      setObservationSummary(snapshot.observations);
      setCoverageStatus(snapshot.coverage);
      setObservationError(null);
      setArgoRegion(snapshot.argo_region);
      setArgoError(snapshot.argo_region ? null : "当前区域暂无可用 Argo 区域快照");
      setLastRefreshAt(snapshot.refreshed_at);
      setSelectedId((current) =>
        current && snapshot.events.some((event) => event.id === current)
          ? current
          : snapshot.events[0]?.id ?? null,
      );
      if (snapshot.errors.length > 0) {
        const degradedMessage = `部分数据源暂时降级：${snapshot.errors.join("；")}`;
        setObservationError(degradedMessage);
        setOverviewError(snapshot.events.length === 0 && !snapshot.argo_region ? degradedMessage : null);
      } else {
        setOverviewError(null);
      }
      return snapshot.cache_state;
    } catch (error) {
      if (controller.signal.aborted || (error as Error).name === "AbortError") return;
      if (requestId !== overviewRequestRef.current) return;
      setOverviewError(errorMessage(error));
      setObservationError(errorMessage(error));
    } finally {
      if (overviewInFlightRef.current?.promise === promise) overviewInFlightRef.current = null;
      if (requestId !== overviewRequestRef.current) return;
      setLoading(false);
      if (showActivity) setRefreshing(false);
    }
  }, [selectedRegionId, setSelectedId]);

  const loadMoreCopernicusEvents = useCallback(async () => {
    if (selectedRegionId !== "global_ocean" || copernicusLoadingMore || !copernicusHasMore) return;
    setCopernicusLoadingMore(true);
    try {
      const page = await oceanApi.copernicusEventPage(copernicusPageCursor);
      setEvents((current) => {
        const knownIds = new Set(current.map((event) => event.id));
        const addedEvents = page.events.filter((event) => !knownIds.has(event.id));
        return copernicusPageCursor === 0 ? [...addedEvents, ...current] : [...current, ...addedEvents];
      });
      if (copernicusPageCursor === 0 && workspaceEventCountsRef.current) {
        setEventCounts(mergeEventCounts(workspaceEventCountsRef.current, page.event_counts));
      }
      setCopernicusPageCursor(page.next_cursor ?? copernicusPageCursor);
      setCopernicusHasMore(page.has_more);
    } catch (error) {
      setOverviewError(errorMessage(error));
    } finally {
      setCopernicusLoadingMore(false);
    }
  }, [copernicusHasMore, copernicusLoadingMore, copernicusPageCursor, selectedRegionId]);

  useEffect(() => {
    if (
      selectedRegionId === "global_ocean"
      && eventCounts !== null
      && copernicusPageCursor === 0
      && copernicusHasMore
      && !copernicusLoadingMore
    ) {
      void loadMoreCopernicusEvents();
    }
  }, [
    copernicusHasMore,
    copernicusLoadingMore,
    copernicusPageCursor,
    eventCounts,
    loadMoreCopernicusEvents,
    selectedRegionId,
  ]);

  const loadEventArgo = useCallback((eventId: string, platform?: string, forceRefresh = false) => {
    const requestId = ++argoRequestRef.current;
    setArgoLoading(true);
    oceanApi.eventArgo(eventId, platform, forceRefresh)
      .then((coverage) => {
        if (requestId !== argoRequestRef.current) return;
        setArgoCoverage(coverage);
        setArgoSnapshot(coverage.snapshot);
        setArgoError(null);
      })
      .catch((error: Error) => {
        if (requestId !== argoRequestRef.current) return;
        setArgoError(error.message);
      })
      .finally(() => {
        if (requestId !== argoRequestRef.current) return;
        setArgoLoading(false);
      });
  }, []);

  const loadRegions = useCallback(() => {
    regionsAbortRef.current?.abort();
    const controller = new AbortController();
    regionsAbortRef.current = controller;
    return oceanApi.regions(controller.signal)
      .then((data) => {
        setRegions(data);
        if (!data.some((region) => region.id === selectedRegionId)) setSelectedRegionId(DEFAULT_REGION.id);
        setRegionError(null);
      })
      .catch((error: Error) => {
        if (controller.signal.aborted || error.name === "AbortError") return;
        setRegionError(error.message);
      });
  }, [selectedRegionId, setSelectedRegionId]);

  useEffect(() => {
    void loadRegions();
  }, [loadRegions]);

  useEffect(() => {
    const synchronize = () => {
      if (document.visibilityState !== "hidden") void loadCopernicusGlobalVolume(false);
    };
    synchronize();
    const refreshTimer = window.setInterval(synchronize, OVERVIEW_REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", synchronize);
    return () => {
      window.clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", synchronize);
      copernicusVolumeAbortRef.current?.abort();
    };
  }, [loadCopernicusGlobalVolume]);

  useEffect(() => {
    let controller: AbortController | null = null;
    const synchronize = () => {
      if (document.visibilityState === "hidden") return;
      controller?.abort();
      controller = new AbortController();
      Promise.allSettled([
        oceanApi.dailyBriefing(controller.signal).then(setDailyBriefing),
        oceanApi.dailyBriefingDashboard(false, controller.signal).then(setDailyBriefingDashboard),
      ]).catch(() => undefined);
    };
    synchronize();
    const refreshTimer = window.setInterval(synchronize, 60_000);
    document.addEventListener("visibilitychange", synchronize);
    return () => {
      controller?.abort();
      window.clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", synchronize);
    };
  }, []);

  const recoverPipeline = useCallback(async () => {
    await Promise.allSettled([loadRegions(), loadOverview(false)]);
  }, [loadOverview, loadRegions]);

  useEffect(() => {
    if (!apiError) return;
    let recovering = false;
    const recover = () => {
      if (recovering) return;
      recovering = true;
      void recoverPipeline().finally(() => { recovering = false; });
    };
    const firstRetry = window.setTimeout(recover, 2_500);
    const retryTimer = window.setInterval(recover, 8_000);
    window.addEventListener("online", recover);
    return () => {
      window.clearTimeout(firstRetry);
      window.clearInterval(retryTimer);
      window.removeEventListener("online", recover);
    };
  }, [apiError, recoverPipeline]);

  useEffect(() => {
    // Keep the last successful snapshot visible while the next region snapshot
    // is loading. Clearing it here made a slow upstream refresh look like an
    // empty data pipeline and briefly reset every map-layer count to zero.
    setObservationError(null);
    setSelectedEvent(null);
    setReport(null);
    setExplanation(null);
    setLiterature(null);
    setLiteratureError(null);
    setLoading(true);
    void loadOverview(true);
  }, [loadOverview, selectedRegionId, setSelectedId]);

  useEffect(() => {
    let disposed = false;
    let syncInFlight = false;
    let revalidationTimer: number | null = null;

    const synchronize = async () => {
      if (disposed || syncInFlight || document.visibilityState === "hidden") return;
      syncInFlight = true;
      const cacheState = await loadOverview(false);
      syncInFlight = false;
      if (!disposed && cacheState === "stale") {
        if (revalidationTimer !== null) window.clearTimeout(revalidationTimer);
        revalidationTimer = window.setTimeout(() => void synchronize(), STALE_REVALIDATION_POLL_MS);
      }
    };

    const refreshTimer = window.setInterval(() => void synchronize(), OVERVIEW_REFRESH_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void synchronize();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      disposed = true;
      window.clearInterval(refreshTimer);
      if (revalidationTimer !== null) window.clearTimeout(revalidationTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadOverview]);

  useEffect(() => {
    // Invalidate any earlier float request before clearing or loading the next
    // event so a late response cannot replace the current event's profile.
    argoRequestRef.current += 1;
    setArgoCoverage(null);
    setArgoSnapshot(null);
    if (!selectedId) {
      setArgoLoading(false);
      setArgoError(null);
      return;
    }
    if (argoDeferred) {
      setArgoLoading(false);
      setArgoError(null);
      return;
    }
    loadEventArgo(selectedId);
  }, [argoDeferred, loadEventArgo, selectedId]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 980px)");
    const updateLayout = () => setCompactLayout(media.matches);
    media.addEventListener("change", updateLayout);
    return () => media.removeEventListener("change", updateLayout);
  }, []);

  const flowLayout = compactLayout || workspaceLayout === "flow";

  useEffect(() => {
    document.body.classList.toggle("workspace-flow", flowLayout);
    return () => document.body.classList.remove("workspace-flow");
  }, [flowLayout]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setLoading(true);
    setExplanationLoading(true);
    setDetailError(null);
    setReport(null);
    setExplanation(null);
    oceanApi.event(selectedId)
      .then((detail) => {
        if (!cancelled) setSelectedEvent(detail);
      })
      .catch((error: Error) => {
        if (!cancelled) setDetailError(error.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    oceanApi.report(selectedId)
      .then((reportData) => {
        if (!cancelled) setReport(reportData);
      })
      .catch(() => undefined);
    oceanApi.explanation(selectedId)
      .then((explanationData) => {
        if (!cancelled) setExplanation(explanationData);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setExplanationLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detailReloadToken, selectedId]);

  useEffect(() => {
    if (!selectedId || detailTab !== "literature") return;
    const controller = new AbortController();
    let cancelled = false;
    setLiterature(null);
    setLiteratureLoading(true);
    setLiteratureError(null);
    oceanApi.literature(selectedId, true, controller.signal)
      .then((result) => {
        if (!cancelled) setLiterature(result);
      })
      .catch((error: Error) => {
        if (!cancelled) setLiteratureError(error.message);
      })
      .finally(() => {
        if (!cancelled) setLiteratureLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [detailTab, selectedId]);

  const refreshExplanation = useCallback(() => {
    if (!selectedId) return;
    setExplanationLoading(true);
    oceanApi.explanation(selectedId, true)
      .then(setExplanation)
      .catch((error: Error) => setDetailError(error.message))
      .finally(() => setExplanationLoading(false));
  }, [selectedId]);

  const refreshLiterature = useCallback(() => {
    if (!selectedId) return;
    setLiteratureLoading(true);
    setLiteratureError(null);
    oceanApi.literature(selectedId, true)
      .then(setLiterature)
      .catch((error: Error) => setLiteratureError(error.message))
      .finally(() => setLiteratureLoading(false));
  }, [selectedId]);

  const filteredEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return events.filter((event) => {
      const observationVariables = OBSERVATION_FILTER_VARIABLES[typeFilter] ?? [];
      const modeMatches = eventViewMode === "all"
        || (eventViewMode === "observations" && event.event_kind === "observation")
        || (eventViewMode === "signals" && event.event_kind === "anomaly")
        || (eventViewMode === "events" && event.event_kind === "anomaly" && ["corroborated", "confirmed"].includes(event.validation_state));
      const observationTypeMatches = event.event_kind === "observation"
        && event.variables.some((variable) => observationVariables.includes(variable));
      const typeMatches = typeFilter === "all"
        || event.type === typeFilter
        || observationTypeMatches;
      const queryMatches =
        normalizedQuery.length === 0 ||
        `${event.title} ${event.region} ${event.variables.join(" ")}`.toLowerCase().includes(normalizedQuery);
      return modeMatches && typeMatches && queryMatches;
    });
  }, [events, eventViewMode, query, typeFilter]);

  const mapEvents = useMemo(() => {
    const visible = filteredEvents.slice(0, 100);
    const selected = selectedId ? filteredEvents.find((event) => event.id === selectedId) : undefined;
    return selected && !visible.some((event) => event.id === selected.id) ? [...visible, selected] : visible;
  }, [filteredEvents, selectedId]);

  useEffect(() => {
    if (filteredEvents.length === 0) return;
    if (!selectedId || !filteredEvents.some((event) => event.id === selectedId)) {
      setSelectedId(filteredEvents[0].id);
    }
  }, [filteredEvents, selectedId, setSelectedId]);

  const focusSearch = useCallback(() => {
    setQueueCollapsed(false);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [setQueueCollapsed]);

  const exploreFromStory = useCallback((target: "float" | "temperature" | "heatwave" | "literature") => {
    const preferredTypes: Record<Exclude<typeof target, "float" | "literature">, EventSummary["type"][]> = {
      temperature: ["surface_temperature_anomaly", "marine_heatwave", "cold_anomaly", "hydrographic_observation"],
      heatwave: ["marine_heatwave", "surface_temperature_anomaly"],
    };
    const nextEvent = target === "float" || target === "literature"
      ? events[0]
      : events.find((event) => event.event_kind === "anomaly" && preferredTypes[target].includes(event.type))
        ?? events.find((event) => target === "temperature" && event.variables.some((variable) => ["SST", "TEMPERATURE"].includes(variable)))
        ?? events[0];
    if (nextEvent) setSelectedId(nextEvent.id);
    setQueueCollapsed(false);
    setDetailCollapsed(false);
    setDetailTab(target === "literature" ? "literature" : "overview");
    window.setTimeout(() => document.querySelector(".workspace-grid")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }, [events, setDetailCollapsed, setDetailTab, setQueueCollapsed, setSelectedId]);

  const selectRelativeEvent = useCallback((offset: number) => {
    if (filteredEvents.length === 0) return;
    const currentIndex = filteredEvents.findIndex((event) => event.id === selectedId);
    const safeIndex = currentIndex < 0 ? 0 : currentIndex;
    const nextIndex = (safeIndex + offset + filteredEvents.length) % filteredEvents.length;
    setSelectedId(filteredEvents[nextIndex].id);
  }, [filteredEvents, selectedId, setSelectedId]);

  const handleDetailRetry = useCallback(() => setDetailReloadToken((token) => token + 1), []);
  const handleSelectArgoPlatform = useCallback((platform: string) => {
    setFocusArgoPlatform(platform);
    if (selectedId) {
      loadEventArgo(selectedId, platform);
      return;
    }
    setArgoLoading(true);
    setArgoError(null);
    oceanApi.argoFloat(platform)
      .then((snapshot) => {
        setArgoSnapshot(snapshot);
        setArgoCoverage(null);
      })
      .catch((error: Error) => setArgoError(error.message))
      .finally(() => setArgoLoading(false));
  }, [loadEventArgo, selectedId]);
  useEffect(() => {
    let cancelled = false;
    authApi.monitoredBuoys()
      .then((items) => { if (!cancelled) setMonitoredPlatforms(new Set(items.map((item) => item.platform))); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  const handleToggleMonitoredBuoy = useCallback((platform: string) => {
    const enabled = !monitoredPlatforms.has(platform);
    setMonitoredPlatforms((current) => {
      const next = new Set(current);
      if (enabled) next.add(platform); else next.delete(platform);
      return next;
    });
    void authApi.setMonitoredBuoy(platform, enabled).catch(() => {
      setMonitoredPlatforms((current) => {
        const next = new Set(current);
        if (enabled) next.delete(platform); else next.add(platform);
        return next;
      });
    });
  }, [monitoredPlatforms]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((current) => !current);
        return;
      }
      if (paletteOpen) return;

      const target = event.target as HTMLElement | null;
      const isEditing = target?.matches("input, textarea, select, [contenteditable='true']");
      if (isEditing) {
        if (event.key === "Escape") target?.blur();
        return;
      }

      if (event.key === "/") {
        event.preventDefault();
        focusSearch();
      } else if (event.key === "[") {
        setQueueCollapsed((current) => !current);
      } else if (event.key === "]") {
        setDetailCollapsed((current) => !current);
      } else if (event.key === "1") {
        setDetailCollapsed(false);
        setDetailTab("overview");
      } else if (event.key === "2") {
        setDetailCollapsed(false);
        setDetailTab("evidence");
      } else if (event.key === "3") {
        setDetailCollapsed(false);
        setDetailTab("report");
      } else if (event.key === "4") {
        setDetailCollapsed(false);
        setDetailTab("literature");
      } else if (event.key === "5") {
        setDetailCollapsed(false);
        setDetailTab("observations");
      } else if (event.key.toLowerCase() === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        selectRelativeEvent(1);
      } else if (event.key.toLowerCase() === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        selectRelativeEvent(-1);
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [
    focusSearch,
    paletteOpen,
    selectRelativeEvent,
    setDetailCollapsed,
    setDetailTab,
    setQueueCollapsed,
  ]);

  const startResize = (side: "queue" | "detail", event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === "queue" ? queueWidth : detailWidth;
    document.body.classList.add("workspace-resizing");

    const handleMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      if (side === "queue") setQueueWidth(clamp(startWidth + delta, 270, 440));
      else setDetailWidth(clamp(startWidth - delta, 360, 590));
    };
    const handleUp = () => {
      document.body.classList.remove("workspace-resizing");
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  };

  const startBuoyLauncherDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !buoyLauncherRef.current) return;
    event.preventDefault();
    const bounds = buoyLauncherRef.current.getBoundingClientRect();
    const offsetX = event.clientX - bounds.left;
    const offsetY = event.clientY - bounds.top;
    setBuoyLauncherDragging(true);

    const handleMove = (moveEvent: PointerEvent) => {
      const launcher = buoyLauncherRef.current;
      if (!launcher) return;
      setBuoyLauncherPosition({
        x: clamp(moveEvent.clientX - offsetX, 8, Math.max(8, window.innerWidth - launcher.offsetWidth - 8)),
        y: clamp(moveEvent.clientY - offsetY, 8, Math.max(8, window.innerHeight - launcher.offsetHeight - 8)),
      });
    };
    const handleUp = () => {
      setBuoyLauncherDragging(false);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
    window.addEventListener("pointercancel", handleUp, { once: true });
  };

  useEffect(() => {
    if (!buoyLauncherPosition) return undefined;
    const keepLauncherInViewport = () => {
      const launcher = buoyLauncherRef.current;
      if (!launcher) return;
      setBuoyLauncherPosition((current) => current ? {
        x: clamp(current.x, 8, Math.max(8, window.innerWidth - launcher.offsetWidth - 8)),
        y: clamp(current.y, 8, Math.max(8, window.innerHeight - launcher.offsetHeight - 8)),
      } : null);
    };
    window.addEventListener("resize", keepLauncherInViewport);
    return () => window.removeEventListener("resize", keepLauncherInViewport);
  }, [buoyLauncherPosition, setBuoyLauncherPosition]);

  const commands = useMemo<WorkspaceCommand[]>(() => [
    { id: "search", label: "查找海洋信息", group: "导航", icon: <Search size={17} />, run: focusSearch },
    {
      id: "highest",
      label: "打开最高优先级事件",
      group: "导航",
      icon: <ArrowUpRight size={17} />,
      run: () => setSelectedId(events[0]?.id ?? null),
    },
    {
      id: "all-events",
      label: "显示全部事件类型",
      group: "筛选",
      icon: <ListFilter size={17} />,
      run: () => {
        setQuery("");
        setTypeFilter("all");
        setQueueCollapsed(false);
      },
    },
    {
      id: "account",
      label: "打开账户与模型 API 设置",
      group: "账户",
      icon: <UserRound size={17} />,
      run: () => setAccountOpen(true),
    },
    {
      id: "toggle-visual-theme",
      label: lightTheme ? "切换为深色潮汐主视觉" : "切换为浅蓝海报主视觉",
      group: "外观",
      icon: lightTheme ? <Moon size={17} /> : <Sun size={17} />,
      run: () => setVisualTheme(lightTheme ? "night" : "light-blue"),
    },
    {
      id: "observations",
      label: "打开区域观测概览",
      group: "数据",
      icon: <Layers3 size={17} />,
      run: () => {
        setDetailCollapsed(false);
        setDetailTab("observations");
      },
    },
    {
      id: "toggle-queue",
      label: queueCollapsed ? "显示事件队列" : "隐藏事件队列",
      group: "工作台",
      icon: queueCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />,
      run: () => setQueueCollapsed((current) => !current),
    },
    {
      id: "toggle-detail",
      label: detailCollapsed ? "显示事件详情" : "隐藏事件详情",
      group: "工作台",
      icon: detailCollapsed ? <PanelRightOpen size={17} /> : <PanelRightClose size={17} />,
      run: () => setDetailCollapsed((current) => !current),
    },
    {
      id: "evidence",
      label: "打开证据视图",
      group: "事件详情",
      icon: <FileSearch size={17} />,
      run: () => {
        setDetailCollapsed(false);
        setDetailTab("evidence");
      },
    },
    {
      id: "literature",
      label: "打开文献依据",
      group: "事件详情",
      icon: <BookOpen size={17} />,
      run: () => {
        setDetailCollapsed(false);
        setDetailTab("literature");
      },
    },
  ], [
    detailCollapsed,
    events,
    focusSearch,
    lightTheme,
    queueCollapsed,
    setDetailCollapsed,
    setDetailTab,
    setQuery,
    setQueueCollapsed,
    selectedId,
    setSelectedId,
    setTypeFilter,
    setVisualTheme,
  ]);

  const queueHidden = queueCollapsed && !flowLayout;
  const detailHidden = detailCollapsed && !flowLayout;
  const workspaceClass = [
    "workspace-grid",
    flowLayout ? "flow-layout" : "dock-layout",
    queueHidden ? "queue-collapsed" : "",
    detailHidden ? "detail-collapsed" : "",
  ].filter(Boolean).join(" ");
  const workspaceStyle = {
    "--queue-width": `${queueWidth}px`,
    "--detail-width": `${detailWidth}px`,
  } as CSSProperties;

  return (
    <main
      className={`app-shell layout-${flowLayout ? "flow" : "dock"}${lightTheme ? " visual-light-blue" : ""}`}
      data-visual-theme={visualTheme}
      data-workspace-layout={flowLayout ? "flow" : "dock"}
    >
      <header className="command-bar">
        <div className="brand-lockup">
          <span className="brand-mark"><img src="/art/brand-offset-mark.png" alt="" aria-hidden="true" /></span>
           <div><strong>海洋智能分析</strong><span>{experienceMode === "explorer" ? `${selectedRegion.short_name} / 刚刚开始探索海洋` : `${selectedRegion.short_name} / 实时多源监测`}</span></div>
        </div>

         <div className={experienceMode === "explorer" ? "command-metrics explorer-command-metrics" : "command-metrics"} aria-label="系统指标">
          <div><Activity size={15} /><span><b>{events.filter((event) => event.event_kind === "anomaly").length}</b> 个异常候选</span></div>
          <div title={copernicusVolumeTitle}><Database size={15} /><span><b>{copernicusVolumeLabel}</b> 条 Copernicus 今日记录</span></div>
          <div><Radio size={15} /><span><b>{metrics.data_freshness_hours == null ? "未知" : `${metrics.data_freshness_hours.toFixed(1)} 小时`}</b> 延迟</span></div>
        </div>

        <div className="command-actions">
          <span className="live-state"><i /> {sourceHealth.filter((source) => source.status === "live").length} 个实时源</span>
          <div className="command-tool-group buoy-tool-group" role="group" aria-label="浮标工具">
            <button
              type="button"
              className="buoy-command-button"
              onClick={() => { setBuoyLauncherHidden(false); setBuoyPanelOpen(true); }}
              aria-expanded={buoyPanelOpen}
              title="查看所有活跃浮标"
            >
              <List size={15} /> 浮标列表 <b>{argoRegion?.float_count ?? "--"}</b>
            </button>
            <button type="button" className="buoy-command-button monitored" onClick={() => { setBuoyLauncherHidden(false); setBuoyMonitoredOnly(true); setBuoyPanelOpen(true); }} title="查看我的监控浮标">
              <Eye size={15} /> 我的监控 <b>{monitoredPlatforms.size}</b>
            </button>
          </div>
          <div className="command-tool-group preferences-tool-group" role="group" aria-label="账户与显示工具">
            <button
              type="button"
              className="icon-button account-launch-button"
              title="账户与模型 API 设置"
              aria-label="账户与模型 API 设置"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen(true)}
            >
              <UserRound size={18} />
            </button>
            <button
              type="button"
              className="icon-button visual-theme-toggle"
              title={lightTheme ? "切换为深色潮汐主视觉" : "切换为浅蓝海报主视觉"}
              aria-label={lightTheme ? "切换为深色潮汐主视觉" : "切换为浅蓝海报主视觉"}
              aria-pressed={lightTheme}
              onClick={() => setVisualTheme(lightTheme ? "night" : "light-blue")}
            >
              {lightTheme ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <div className="workspace-layout-switch" role="group" aria-label="工作区布局">
              <button
                type="button"
                className={workspaceLayout === "flow" ? "active" : ""}
                title="长屏模式：页面纵向连续滚动"
                aria-label="使用长屏模式"
                aria-pressed={workspaceLayout === "flow"}
                onClick={() => setWorkspaceLayout("flow")}
              >
                <Rows3 size={16} />
              </button>
              <button
                type="button"
                className={workspaceLayout === "dock" ? "active" : ""}
                title="并排模式：事件、地图和详情固定分栏"
                aria-label="使用并排模式"
                aria-pressed={workspaceLayout === "dock"}
                onClick={() => setWorkspaceLayout("dock")}
              >
                <Columns3 size={16} />
              </button>
            </div>
          </div>
          <div className="command-tool-group workspace-tool-group" role="group" aria-label="工作区工具">
            <button
              type="button"
              className="icon-button agent-launch-button"
              title="打开海洋数据 Agent"
              aria-label="打开海洋数据 Agent"
              aria-expanded={agentOpen}
              onClick={() => setAgentOpen(true)}
            >
              <Bot size={18} />
            </button>
            <button type="button" className="icon-button" title="打开命令面板" aria-label="打开命令面板" onClick={() => setPaletteOpen(true)}><Search size={17} /></button>
          </div>
          <div className="command-tool-group status-tool-group" role="group" aria-label="面板与状态工具">
            <button type="button" className="icon-button panel-toggle" title={queueCollapsed ? "显示事件队列" : "隐藏事件队列"} aria-label={queueCollapsed ? "显示事件队列" : "隐藏事件队列"} onClick={() => setQueueCollapsed((current) => !current)}>
              {queueCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            </button>
            <button type="button" className="icon-button panel-toggle" title={detailCollapsed ? "显示事件详情" : "隐藏事件详情"} aria-label={detailCollapsed ? "显示事件详情" : "隐藏事件详情"} onClick={() => setDetailCollapsed((current) => !current)}>
              {detailCollapsed ? <PanelRightOpen size={17} /> : <PanelRightClose size={17} />}
            </button>
            <button type="button" className="icon-button data-source-button" title="查看数据来源状态" aria-label="查看数据来源状态" aria-expanded={sourcePanelOpen} onClick={() => setSourcePanelOpen((open) => !open)}><Database size={18} /></button>
            <button type="button" className="icon-button alert-button" title="事件告警" aria-label={overviewPending ? "事件告警正在读取" : `${metrics.critical_events} 条事件告警`}><Bell size={18} /><span>{overviewPending ? "—" : metrics.critical_events}</span></button>
          </div>
          {sourcePanelOpen && (
            <div className="source-health-popover">
              <header><strong>数据来源</strong><span>{lastRefreshAt ? `自动更新 · ${new Date(lastRefreshAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : "自动更新中"}</span></header>
              {sourceHealth.map((source) => (
                <div className="source-health-row" key={source.id}>
                  <i className={source.status} />
                  <span><b>{source.name}</b><small>{source.detail}</small></span>
                  <em>{source.observation_count}</em>
                </div>
              ))}
            </div>
          )}
        </div>
      </header>

      {experienceMode === "professional" && briefOpen && <section className="mission-strip">
        <div className="mission-context">
          <div className="mission-mark"><img src="/art/event-stamps/event-stamp-05.png" alt="" aria-hidden="true" /></div>
          <div><span className="eyebrow">海洋监测值守 / {new Date().toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}</span><h2>{selectedRegion.name}海洋信息监测</h2></div>
        </div>
        <label className="region-switcher">
          <Globe2 size={16} />
          <span>监测海域</span>
          <select value={selectedRegionId} onChange={(event) => setSelectedRegionId(event.target.value)} aria-label="切换监测海域">
            {regions.map((region) => <option value={region.id} key={region.id}>{region.short_name}</option>)}
          </select>
        </label>
        <div className="mission-facts" aria-label="观测窗口摘要">
          <div><CalendarRange size={14} /><span>时间窗</span><b>最近 24 小时</b></div>
          <div><span className="fact-pulse" /><span>实时信息</span><b>{overviewPending ? "读取中" : `记录 ${metrics.live_event_count} 条`}</b></div>
          <div><span className="fact-ring" /><span>数据体量</span><b>{overviewPending ? "读取中" : `${metrics.observation_count.toLocaleString("zh-CN")} 条记录`}</b></div>
        </div>
        <button type="button" className="brief-button" onClick={() => setSelectedId(events[0]?.id ?? null)} disabled={events.length === 0}>
          {events.length > 0 ? "打开最高优先级信息" : "等待实时信息"} <ArrowUpRight size={14} />
        </button>
      </section>}

      <ExplorerHome
        region={selectedRegion}
        regions={regions}
        selectedRegionId={selectedRegionId}
        onRegionChange={setSelectedRegionId}
        loading={overviewPending}
        events={events}
        counts={eventCounts}
        metrics={metrics}
        observations={observationSummary}
        argoRegion={argoRegion}
        copernicusGlobalVolume={copernicusGlobalVolume}
        copernicusGlobalVolumeLoading={copernicusGlobalVolumeLoading}
        scheduledDailyBriefing={dailyBriefing}
        dailyBriefingDashboard={dailyBriefingDashboard}
        onSelectArgoPlatform={(platform) => { setBuoyPanelOpen(true); handleSelectArgoPlatform(platform); }}
        onChinaAreaSelect={(area) => {
          setSelectedRegionId(/南海|台湾|海南|北部湾|粤|珠江/.test(area) ? "south_china_sea" : "northwest_pacific");
          window.setTimeout(() => document.querySelector(".workspace-grid")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
        }}
        mode={experienceMode}
        onModeChange={setExperienceMode}
        briefOpen={briefOpen}
        onBriefToggle={() => setBriefOpen((open) => !open)}
        tutorialOpen={tutorialOpen}
        onTutorialToggle={() => setTutorialOpen((open) => !open)}
        onExplore={exploreFromStory}
      />

      {apiError && (
        <div className="api-error" role="alert">
          <span>数据管线连接异常：{apiError}。正在自动重连。</span>
          <button type="button" onClick={() => void recoverPipeline()} title="立即重新连接" aria-label="立即重新连接">
            <RefreshCw size={15} />
          </button>
        </div>
      )}
      <span className="sr-only" aria-live="polite">{selectedEvent ? `已选择 ${selectedEvent.title}` : ""}</span>

      <div className={workspaceClass} style={workspaceStyle}>
        <EventQueue
          key={selectedRegionId}
          events={filteredEvents}
          allEvents={events}
          loading={overviewPending}
          loadingMore={copernicusLoadingMore}
          hasMore={selectedRegionId === "global_ocean" && copernicusHasMore}
          selectedId={selectedId}
          query={query}
          typeFilter={typeFilter}
          viewMode={eventViewMode}
          coverage={coverageStatus}
          counts={eventCounts}
          searchInputRef={searchInputRef}
          onQueryChange={setQuery}
          onFilterChange={setTypeFilter}
          onViewModeChange={setEventViewMode}
          onSelect={setSelectedId}
          onLoadMore={loadMoreCopernicusEvents}
        />
        <div
          className="pane-resizer queue-resizer"
          role="separator"
          aria-label="调整事件队列宽度"
          aria-orientation="vertical"
          tabIndex={0}
          onPointerDown={(event) => startResize("queue", event)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") setQueueWidth((width) => clamp(width - 16, 270, 440));
            if (event.key === "ArrowRight") setQueueWidth((width) => clamp(width + 16, 270, 440));
          }}
        />
        <OceanMap events={mapEvents} selectedId={selectedId} onSelect={setSelectedId} onSelectArgoPlatform={handleSelectArgoPlatform} focusArgoPlatform={focusArgoPlatform} argo={argoSnapshot} argoRegion={argoRegion} argoCoverage={argoCoverage} observations={observationSummary} region={selectedRegion} mode={experienceMode} lightOcean={lightTheme} loading={loading} />
        <div
          className="pane-resizer detail-resizer"
          role="separator"
          aria-label="调整事件详情宽度"
          aria-orientation="vertical"
          tabIndex={0}
          onPointerDown={(event) => startResize("detail", event)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") setDetailWidth((width) => clamp(width + 16, 360, 590));
            if (event.key === "ArrowRight") setDetailWidth((width) => clamp(width - 16, 360, 590));
          }}
        />
         {!detailHidden && selectedEvent && <EventDetail key={selectedId} event={selectedEvent} report={report} loading={loading} error={detailError} onRetry={handleDetailRetry} tab={detailTab} onTabChange={setDetailTab} argoSnapshot={argoSnapshot} argoCoverage={argoCoverage} argoLoading={argoLoading} argoError={argoError} argoDeferred={argoDeferred} onSelectArgoPlatform={handleSelectArgoPlatform} explanation={explanation} explanationLoading={explanationLoading} onRefreshExplanation={refreshExplanation} literature={literature} literatureLoading={literatureLoading} literatureError={literatureError} onRefreshLiterature={refreshLiterature} observationSummary={observationSummary} observationSources={sourceHealth} observationError={observationError} experienceMode={experienceMode} />}
      </div>

      {!buoyPanelOpen && !buoyLauncherHidden && (
        <div
          ref={buoyLauncherRef}
          className={`buoy-fleet-launcher${buoyLauncherDragging ? " dragging" : ""}`}
          style={buoyLauncherPosition ? { left: buoyLauncherPosition.x, top: buoyLauncherPosition.y } : undefined}
        >
          <button type="button" className="buoy-fleet-drag-handle" onPointerDown={startBuoyLauncherDrag} aria-label="拖动浮标总览入口" title="拖动浮标总览入口"><GripVertical size={15} /></button>
          <button type="button" className="buoy-fleet-open" onClick={() => { setBuoyMonitoredOnly(false); setBuoyPanelOpen(true); }}><List size={16} /> 浮标总览 <span>{argoRegion?.float_count ?? 0}</span></button>
          <button type="button" className="buoy-fleet-hide" onClick={() => setBuoyLauncherHidden(true)} aria-label="隐藏浮标总览入口" title="隐藏浮标总览入口"><X size={14} /></button>
        </div>
      )}
      {buoyPanelOpen && <BuoyFleetPanel snapshot={argoRegion} loading={loading} selectedPlatform={focusArgoPlatform} monitoredPlatforms={monitoredPlatforms} monitoredOnly={buoyMonitoredOnly} onViewChange={setBuoyMonitoredOnly} onToggleMonitor={handleToggleMonitoredBuoy} onSelect={handleSelectArgoPlatform} onClose={() => setBuoyPanelOpen(false)} />}

      <CommandPalette commands={commands} open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <AccountSettings
        open={accountOpen}
        user={session.user}
        onClose={() => setAccountOpen(false)}
        onSignedOut={onSignedOut}
      />
      <DataAgentWorkspace
        open={agentOpen}
        region={selectedRegion}
        selectedEventId={selectedId}
        onClose={() => setAgentOpen(false)}
        onSelectEvent={(eventId) => {
          setSelectedId(eventId);
          setAgentOpen(false);
        }}
      />
    </main>
  );
}

interface AppProps {
  initialSession?: AuthenticatedSession;
}

function App({ initialSession }: AppProps) {
  const [session, setSession] = useState<AuthenticatedSession | null>(initialSession ?? null);
  const [checkingSession, setCheckingSession] = useState(!initialSession);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const checkSession = useCallback(async (signal?: AbortSignal) => {
    setCheckingSession(true);
    setSessionError(null);
    try {
      const current = await authApi.session(signal);
      if (current.user && current.csrf_token) {
        setSession(current as AuthenticatedSession);
      } else {
        setSession(null);
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      setSession(null);
      setSessionError(
        error instanceof ApiRequestError && error.status === 401
          ? null
          : errorMessage(error),
      );
    } finally {
      if (!signal?.aborted) setCheckingSession(false);
    }
  }, []);

  useEffect(() => {
    if (initialSession) return;
    const controller = new AbortController();
    void checkSession(controller.signal);
    return () => controller.abort();
  }, [checkSession, initialSession]);

  if (checkingSession) return <AuthBootScreen />;
  if (!session) {
    return (
      <AuthGate
        connectionError={sessionError}
        onRetryConnection={() => void checkSession()}
        onAuthenticated={(authenticatedSession) => {
          setSessionError(null);
          setSession(authenticatedSession);
        }}
      />
    );
  }

  return <OceanWorkspace session={session} onSignedOut={() => setSession(null)} />;
}

export default App;
