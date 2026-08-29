import { CircleCheckBig, Radio, Search, TriangleAlert, Waves, X, type LucideIcon } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { EVENT_LIFECYCLE_LABELS, EVENT_VALIDATION_LABELS, eventTypeLabel, formatShortDate } from "../locale";
import type { CoverageStatus, EventCounts, EventSummary, EventType } from "../types";

export type EventViewMode = "all" | "events" | "signals" | "observations";

interface EventQueueProps {
  events: EventSummary[];
  allEvents: EventSummary[];
  selectedId: string | null;
  query: string;
  typeFilter: string;
  viewMode: EventViewMode;
  coverage?: CoverageStatus | null;
  counts?: EventCounts | null;
  loading?: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (value: string) => void;
  onFilterChange: (value: string) => void;
  onViewModeChange: (value: EventViewMode) => void;
  onSelect: (eventId: string) => void;
  onLoadMore?: () => void;
}

const VIEW_MODES: { value: EventViewMode; label: string; icon: LucideIcon }[] = [
  { value: "all", label: "海洋动态", icon: Waves },
  { value: "events", label: "海洋事件", icon: CircleCheckBig },
  { value: "signals", label: "异常候选", icon: TriangleAlert },
  { value: "observations", label: "实时观测", icon: Radio },
];

const FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "current_anomaly", label: "海流" },
  { value: "salinity_anomaly", label: "盐度" },
  { value: "nutrient_anomaly", label: "营养盐" },
  { value: "chlorophyll_anomaly", label: "叶绿素 a" },
  { value: "ph_observation", label: "pH" },
  { value: "oxygen_observation", label: "溶解氧" },
  { value: "particle_observation", label: "颗粒物" },
  { value: "surface_temperature_anomaly", label: "海温" },
  { value: "wave_anomaly", label: "海况" },
  { value: "wind_anomaly", label: "风场" },
  { value: "typhoon_warning", label: "台风" },
];

const TYPE_STAMP: Record<EventType, string> = {
  surface_observation: "event-stamp-01.png",
  hydrographic_observation: "event-stamp-05.png",
  biogeochemical_observation: "event-stamp-02.png",
  marine_heatwave: "event-stamp-01.png",
  phytoplankton_bloom: "event-stamp-02.png",
  carbon_anomaly: "event-stamp-03.png",
  eddy: "event-stamp-04.png",
  current_anomaly: "event-stamp-05.png",
  cold_anomaly: "event-stamp-06.png",
  salinity_anomaly: "event-stamp-05.png",
  nutrient_anomaly: "event-stamp-02.png",
  chlorophyll_anomaly: "event-stamp-02.png",
  surface_temperature_anomaly: "event-stamp-01.png",
  wave_anomaly: "event-stamp-04.png",
  wind_anomaly: "event-stamp-06.png",
  typhoon_warning: "event-stamp-03.png",
};

const INITIAL_VISIBLE_COUNT = 100;
const VISIBLE_COUNT_STEP = 100;

export const EventQueue = memo(function EventQueue({
  events,
  allEvents,
  selectedId,
  query,
  typeFilter,
  viewMode,
  coverage,
  counts,
  loading = false,
  loadingMore = false,
  hasMore = false,
  searchInputRef,
  onQueryChange,
  onFilterChange,
  onViewModeChange,
  onSelect,
  onLoadMore,
}: EventQueueProps) {
  const selectedRowRef = useRef<HTMLButtonElement>(null);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_COUNT);
  }, [query, typeFilter, viewMode]);

  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedId]);

  const derivedCounts = useMemo(() => allEvents.reduce(
    (counts, event) => {
      if (event.event_kind === "observation") counts.observationCount += 1;
      if (event.event_kind === "anomaly") counts.signalCount += 1;
      if (event.event_kind === "anomaly" && ["corroborated", "confirmed"].includes(event.validation_state)) {
        counts.eventCount += 1;
      }
      return counts;
    },
    { observationCount: 0, signalCount: 0, eventCount: 0 },
  ), [allEvents]);
  const observationCount = counts?.observations ?? derivedCounts.observationCount;
  const signalCount = counts?.signals ?? derivedCounts.signalCount;
  const eventCount = counts?.events ?? derivedCounts.eventCount;
  const totalCount = counts?.total ?? allEvents.length;
  const countLabel = (count: number) => loading ? "—" : count;
  const currentViewCount = query || typeFilter !== "all"
    ? events.length
    : viewMode === "events"
      ? eventCount
      : viewMode === "signals"
        ? signalCount
        : viewMode === "observations"
          ? observationCount
          : totalCount;
  const visibleEvents = useMemo(() => events.slice(0, visibleCount), [events, visibleCount]);
  const coverageWarning = viewMode === "observations" && coverage?.state !== "complete";

  return (
    <aside className="event-rail">
      <div className="rail-heading">
        <div>
          <span className="eyebrow">实时观测、候选与事件</span>
          <h2>{viewMode === "events" ? "海洋事件" : viewMode === "signals" ? "异常候选" : viewMode === "observations" ? "实时观测" : "海洋动态"}</h2>
        </div>
        <span className="event-count">{countLabel(currentViewCount)}</span>
      </div>

      <div className="event-view-tabs" role="tablist" aria-label="信息层级">
        {VIEW_MODES.map((mode) => {
          const count = mode.value === "events" ? eventCount : mode.value === "signals" ? signalCount : mode.value === "observations" ? observationCount : totalCount;
          const ModeIcon = mode.icon;
          return (
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === mode.value}
              className={viewMode === mode.value ? "event-view-tab active" : "event-view-tab"}
              onClick={() => onViewModeChange(mode.value)}
              key={mode.value}
            >
              <span className="event-view-tab-icon" aria-hidden="true">
                <ModeIcon size={16} strokeWidth={1.8} />
              </span>
              <span className="event-view-tab-copy">
                <span>{mode.label}</span>
                <b>{countLabel(count)}</b>
              </span>
            </button>
          );
        })}
      </div>

      <div className="search-field">
        <Search size={16} aria-hidden="true" />
        <input
          ref={searchInputRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索海域、事件或变量"
          aria-label="搜索海洋动态"
        />
        {query && (
          <button type="button" className="search-clear" onClick={() => onQueryChange("")} title="清空搜索" aria-label="清空搜索">
            <X size={14} />
          </button>
        )}
      </div>

      <div className="filter-strip" role="group" aria-label="变量或事件类型筛选">
        {FILTERS.map((filter) => (
          <button
            type="button"
            className={typeFilter === filter.value ? "filter-chip active" : "filter-chip"}
            onClick={() => onFilterChange(filter.value)}
            aria-pressed={typeFilter === filter.value}
            key={filter.value}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="queue-status">
        <span><i /> {viewMode === "observations" ? "质检通过的观测与背景记录" : viewMode === "signals" ? "等待持续性与多源印证" : "按证据状态排序"}</span>
        <span>事件 {countLabel(eventCount)} · 候选 {countLabel(signalCount)} · 观测 {countLabel(observationCount)}</span>
      </div>

      {coverageWarning && coverage?.notes.length ? (
        <div className="coverage-notice" role="status">
          <strong>数据覆盖提示</strong>
          <span>{coverage.notes[0]}</span>
        </div>
      ) : null}

      <div className="event-list">
        {visibleEvents.map((event) => (
          <button
            type="button"
            className={`event-row ${event.event_kind}${selectedId === event.id ? " selected" : ""}`}
            onClick={() => onSelect(event.id)}
            ref={selectedId === event.id ? selectedRowRef : undefined}
            aria-current={selectedId === event.id ? "true" : undefined}
            key={event.id}
          >
            <span className={`event-type-mark ${event.type}`}>
              <img src={`/art/event-stamps/${TYPE_STAMP[event.type]}`} alt="" aria-hidden="true" />
            </span>
            <span className="event-row-main">
              <span className="event-row-meta">
                <span className="event-row-classification">
                  <span>{eventTypeLabel(event.type, event.event_kind, event.variables)}</span>
                  <b className={`event-kind-badge ${event.event_kind}`}>
                    {event.event_kind === "anomaly" ? (event.validation_state === "confirmed" ? "事件" : "候选") : "观测"}
                  </b>
                </span>
                <span className={`data-mode ${event.data_mode}`}>{event.data_mode === "live" ? "实时" : event.data_mode === "cached" ? "缓存" : "情景"}</span>
                <span>{formatShortDate(event.started_at)}</span>
              </span>
              <strong>{event.title}</strong>
              <span className="event-region">{event.region}</span>
              <span className="event-evidence-state">
                <span>{EVENT_VALIDATION_LABELS[event.validation_state] ?? event.validation_state}</span>
                {event.event_kind === "anomaly" && event.lifecycle_state ? (
                  <span
                    className={`lifecycle-badge ${event.lifecycle_state}`}
                    title={`已跨 ${event.consecutive_updates} 次连续刷新跟踪；生命周期版本 ${event.lifecycle_revision}`}
                  >
                    {EVENT_LIFECYCLE_LABELS[event.lifecycle_state]}
                    {event.consecutive_updates > 1 ? ` · ${event.consecutive_updates}轮` : ""}
                  </span>
                ) : null}
              </span>
              <span className="event-signal">{event.primary_reading}</span>
            </span>
            <span className="severity-meter" title={`${event.event_kind === "anomaly" ? "候选强度" : "记录优先级"} ${Math.round(event.severity * 100)}%`}>
              <span style={{ height: `${Math.max(event.severity * 100, 16)}%` }} />
            </span>
          </button>
        ))}
        {(visibleCount < events.length || hasMore) && (
          <button type="button" className="queue-load-more" disabled={loadingMore} onClick={() => {
            if (visibleCount < events.length) setVisibleCount((current) => Math.min(current + VISIBLE_COUNT_STEP, events.length));
            else onLoadMore?.();
          }}>
            {loadingMore ? "正在加载下一页事件…" : visibleCount < events.length ? `再加载 ${Math.min(VISIBLE_COUNT_STEP, events.length - visibleCount)} 条` : "加载下一页事件"}
          </button>
        )}
        {events.length === 0 && loading && (
          <div className="empty-state">正在加载实时 Argo、卫星与海洋观测数据…</div>
        )}
        {events.length === 0 && !loading && (
          <div className="empty-state">
            {viewMode === "events" ? "当前没有达到确认状态的海洋事件。可以切换到“异常候选”查看正在核实的信号。" : viewMode === "observations" && coverage?.state !== "complete" ? "当前变量覆盖不足，不能据此判断没有观测或事件。" : "当前筛选条件下没有匹配记录。"}
          </div>
        )}
      </div>
    </aside>
  );
});
