import {
  Activity,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Database,
  ExternalLink,
  Fish,
  Layers3,
  LocateFixed,
  Pause,
  Play,
  Radio,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ArgoEventCoverage, ArgoFloatSnapshot, MarineContext, MarineKnowledge } from "../types";

interface ArgoLivePanelProps {
  snapshot: ArgoFloatSnapshot | null;
  coverage: ArgoEventCoverage | null;
  loading: boolean;
  error: string | null;
  deferred?: boolean;
  onSelectPlatform: (platform: string) => void;
  marineContext?: MarineContext | null;
  marineKnowledge?: MarineKnowledge | null;
  marineEnrichmentLoading?: boolean;
  expanded?: boolean;
  mode?: "explorer" | "professional";
}

type VariableKey = "temperature" | "salinity" | "chla" | "nitrate";

const VARIABLE_META: Record<VariableKey, { label: string; unit: string; color: string; precision: number }> = {
  temperature: { label: "\u6e29\u5ea6", unit: "\u00b0C", color: "#ef9f66", precision: 2 },
  salinity: { label: "\u76d0\u5ea6", unit: "PSU", color: "#73c9bd", precision: 3 },
  chla: { label: "\u53f6\u7eff\u7d20 a", unit: "mg m\u207b\u00b3", color: "#c5d36a", precision: 3 },
  nitrate: { label: "\u785d\u9178\u76d0", unit: "\u03bcmol kg\u207b\u00b9", color: "#7fb4e6", precision: 3 },
};

const VALUE_MODE_LABELS = {
  raw: "原始值",
  adjusted: "调整值",
  mixed: "原始/调整混合",
  unavailable: "不可用",
} as const;

const formatTime = (value: string | null | undefined) => {
  if (!value) return "\u6682\u65e0";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const formatValue = (value: number | null | undefined, precision = 2) =>
  value == null || !Number.isFinite(value) ? "--" : value.toFixed(precision);

const longitudeLabel = (value: number) => `${Math.abs(value).toFixed(5)}° ${value >= 0 ? "E" : "W"}`;
const latitudeLabel = (value: number) => `${Math.abs(value).toFixed(5)}° ${value >= 0 ? "N" : "S"}`;

function ArgoSkeleton() {
  return (
    <section className="argo-live-card argo-live-skeleton" aria-busy="true">
      <div className="argo-skeleton-heading" />
      <div className="argo-skeleton-metrics"><i /><i /><i /><i /></div>
      <div className="argo-skeleton-chart" />
    </section>
  );
}

export function ArgoLivePanel({ snapshot, coverage, loading, error, deferred = false, onSelectPlatform, marineContext = null, marineKnowledge = null, marineEnrichmentLoading = false, expanded = false, mode = "professional" }: ArgoLivePanelProps) {
  const [variable, setVariable] = useState<VariableKey>("temperature");
  const [explanationOpen, setExplanationOpen] = useState(false);
  const [dataDetailsOpen, setDataDetailsOpen] = useState(expanded);
  const [fisheryOpen, setFisheryOpen] = useState(expanded);
  const [humanitiesOpen, setHumanitiesOpen] = useState(expanded);
  const [depthIndex, setDepthIndex] = useState(0);
  const [profilePlaying, setProfilePlaying] = useState(false);
  const explorerMode = mode === "explorer";

  useEffect(() => {
    if (explorerMode) setDataDetailsOpen(false);
  }, [explorerMode]);

  const chartData = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.latest.points
      .filter((point) => {
        const quality = point[`${variable}_qc` as keyof typeof point];
        return point[variable] != null && (quality === 1 || quality === 2);
      })
      .map((point) => ({
        pressure: point.pressure,
        value: point[variable],
      }));
  }, [snapshot, variable]);

  const profileRows = useMemo(() => {
    if (!snapshot) return [];
    return [...snapshot.latest.points]
      .sort((left, right) => left.pressure - right.pressure);
  }, [snapshot]);

  useEffect(() => {
    setDepthIndex(0);
    setProfilePlaying(false);
    setFisheryOpen(expanded);
    setHumanitiesOpen(expanded);
  }, [snapshot?.platform, snapshot?.latest.cycle]);

  useEffect(() => {
    if (!profilePlaying || profileRows.length < 2) return;
    const timer = window.setInterval(() => {
      setDepthIndex((current) => {
        if (current >= profileRows.length - 1) {
          setProfilePlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 720);
    return () => window.clearInterval(timer);
  }, [profilePlaying, profileRows.length]);

  if (loading && !snapshot) return <ArgoSkeleton />;

  if (!snapshot) {
    return (
      <section className={`argo-live-card ${deferred ? "argo-live-deferred" : "argo-live-error"}`} role="status">
        <div className="argo-live-error-mark"><Radio size={18} /></div>
        <div>
          <strong>{deferred ? "查看附近浮标剖面" : "Argo 实时链路暂不可用"}</strong>
          <p>{deferred ? "服务器会自动匹配附近浮标，并在下一次数据更新后展示从海面到深水的温度和盐度。" : error ?? "等待服务器自动更新数据"}</p>
        </div>
      </section>
    );
  }

  const latest = snapshot.latest;
  const activeMeta = VARIABLE_META[variable];
  const surface = latest.surface;
  const statusLabel = snapshot.cache.state === "fresh" ? "实时快照" : "缓存快照";
  const statusClass = snapshot.cache.state === "fresh" ? "fresh" : "stale";
  const latestQc = surface[`${variable}_qc`];
  const surfaceMode = latest.surface_modes[variable] ?? "unavailable";
  const profileMode = latest.variable_modes[variable] ?? "unavailable";
  const trackStart = snapshot.track[0];
  const trackEnd = snapshot.track[snapshot.track.length - 1];
  const activePressure = surface[`${variable}_pressure`];
  const shallowestPressures = (Object.keys(VARIABLE_META) as VariableKey[])
    .map((key) => surface[`${key}_pressure`])
    .filter((pressure): pressure is number => typeof pressure === "number" && Number.isFinite(pressure));
  const shallowestPressure = shallowestPressures.length > 0 ? Math.min(...shallowestPressures) : null;
  const trackCycles = snapshot.track.map((point) => point.cycle);
  const hasCycleGaps = trackCycles.some((cycle, index) => index > 0 && cycle - trackCycles[index - 1] !== 1);
  const trackCycleLabel = trackCycles.length <= 6
    ? `源周期 ${trackCycles.join(" / ")}`
    : `源周期 ${trackStart?.cycle ?? "--"} → ${trackEnd?.cycle ?? "--"}`;
  const profileCountLabel = snapshot.profile_scope === "regional_window"
    ? `近 ${snapshot.profile_window_days ?? 35} 天 ${snapshot.profile_count} 个剖面`
    : `累计 ${snapshot.profile_count} 个剖面`;
  const trackScopeLabel = snapshot.profile_scope === "regional_window"
    ? `近 ${snapshot.profile_window_days ?? 35} 天`
    : "全周期";

  const activeProfilePoint = profileRows[depthIndex] ?? profileRows[0] ?? null;
  const depthStory = activeProfilePoint == null
    ? "当前没有可用的深度采样。"
    : activeProfilePoint.pressure <= 30
      ? "这里接近海表，温度和盐度更容易受到天气与日照影响。"
      : activeProfilePoint.pressure <= 200
        ? "这里可能接近浅层水体边界，水温和盐度开始出现明显梯度。"
        : "这里属于更深层水体，变化通常更缓慢，也更能反映水团结构。";

  return (
    <section className="argo-live-card" aria-label="Argo 实时观测工作台">
      <header className="argo-live-header">
        <div className="argo-live-title">
          <span className="argo-live-icon"><Radio size={17} /></span>
          <div>
            <div className="argo-live-kicker"><span className={`argo-live-dot ${statusClass}`} />{statusLabel} · {snapshot.network}</div>
            <h2>浮标 {snapshot.platform} 实时剖面</h2>
          </div>
        </div>
        <div className="argo-live-actions">
          <span className="argo-cycle">Cycle {latest.cycle}</span>
        </div>
      </header>

      <div className="argo-live-meta">
        <span><Clock3 size={13} /> {formatTime(latest.timestamp)} 更新</span>
        <span><Database size={13} /> {profileCountLabel}</span>
        <span>{latest.latitude.toFixed(2)}°N · {latest.longitude.toFixed(2)}°E</span>
      </div>

      {explorerMode && (
        <div className="argo-explorer-identity" aria-label="浮标身份证">
          <div><span>它现在在哪里？</span><strong>{latitudeLabel(latest.latitude)} · {longitudeLabel(latest.longitude)}</strong></div>
          <div><span>最近一次什么时候上浮？</span><strong>{formatTime(latest.timestamp)}</strong></div>
          <div><span>它测到了什么？</span><strong>{surface.temperature != null ? `海水 ${formatValue(surface.temperature, 2)} °C` : "温盐剖面"}</strong></div>
          <div><span>它曾经经过哪里？</span><strong>{snapshot.track.length} 个轨迹位置</strong></div>
        </div>
      )}

      {!explorerMode && (
        <div className="argo-reading-scope" role="note">
          <AlertTriangle size={13} />
          <span>
            {shallowestPressure == null
              ? "当前剖面没有可用的最浅层压力"
              : `最浅有效观测位于 ${formatValue(shallowestPressure, 1)} dbar${shallowestPressure > 10 ? "，不是海表观测" : ""}`}
            ；单剖面仅描述当前垂向结构，不作趋势、水团变化或事件确认。
          </span>
        </div>
      )}

      {!explorerMode && coverage && (
        <div className="argo-coverage-block">
          <div className="argo-coverage-summary">
            <span><Layers3 size={14} /><b>{coverage.regional_float_count}</b> 个区域活跃浮标</span>
            <span><LocateFixed size={14} /><b>{coverage.matched_count}</b> 个进入{coverage.radius_basis === "observation_footprint" ? "观测覆盖范围" : "事件半径"}</span>
            <small>{coverage.match_mode === "within_event" ? `按 ${coverage.event_radius_km.toFixed(0)} km ${coverage.radius_basis === "screening_search" ? "筛查搜索半径" : coverage.radius_basis === "observation_footprint" ? "观测覆盖半径" : "事件半径"}匹配` : `${coverage.radius_basis === "screening_search" ? "筛查搜索" : coverage.radius_basis === "observation_footprint" ? "观测覆盖" : "事件"}半径内暂无浮标，显示最近观测`}</small>
          </div>
          <div className="argo-float-selector" role="listbox" aria-label={coverage.radius_basis === "observation_footprint" ? "切换观测关联 Argo 浮标" : "切换事件关联 Argo 浮标"}>
            {coverage.candidates.map((candidate) => {
              const selected = candidate.platform === coverage.selected_platform;
              return (
                <button
                  type="button"
                  className={selected ? "argo-float-option selected" : "argo-float-option"}
                  onClick={() => onSelectPlatform(candidate.platform)}
                  disabled={selected}
                  aria-selected={selected}
                  role="option"
                  key={candidate.platform}
                  title={`Argo ${candidate.platform}，距${coverage.radius_basis === "observation_footprint" ? "观测位置" : "事件中心"} ${candidate.distance_km?.toFixed(0) ?? "--"} km`}
                >
                  <span><i className={candidate.has_bgc ? "bgc" : "core"} />{candidate.platform}</span>
                  <small>{candidate.distance_km?.toFixed(0) ?? "--"} km · {candidate.has_bgc ? "BGC" : "Core"}</small>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="argo-live-metrics">
        {(Object.keys(VARIABLE_META) as VariableKey[]).map((key) => {
          const meta = VARIABLE_META[key];
          const active = key === variable;
          return (
            <button
              type="button"
              className={active ? "argo-live-metric active" : "argo-live-metric"}
              style={{ "--metric-color": meta.color } as CSSProperties}
              onClick={() => setVariable(key)}
              key={key}
              aria-pressed={active}
            >
              <span>{meta.label}</span>
              <strong>{formatValue(surface[key], meta.precision)}</strong>
              <small>
                {meta.unit}
                {!explorerMode && typeof surface[`${key}_pressure`] === "number" ? ` · @ ${formatValue(surface[`${key}_pressure`], 1)} dbar` : ""}
              </small>
            </button>
          );
        })}
      </div>

      <section className="argo-profile-explorer" aria-label="拖动查看海洋剖面">
        <header>
          <div><span className="section-label"><Layers3 size={15} /> 拖动看海洋剖面</span><small>海表 → {formatValue(latest.max_pressure, 0)} dbar</small></div>
          <button
            type="button"
            className={profilePlaying ? "profile-play-button playing" : "profile-play-button"}
            onClick={() => {
              if (profileRows.length < 2) return;
              if (depthIndex >= profileRows.length - 1) setDepthIndex(0);
              setProfilePlaying((current) => !current);
            }}
            disabled={profileRows.length < 2}
            title={profilePlaying ? "暂停剖面播放" : "播放剖面"}
            aria-label={profilePlaying ? "暂停剖面播放" : "播放剖面"}
          >
            {profilePlaying ? <Pause size={13} /> : <Play size={13} />}
            <span>{profilePlaying ? "播放中" : "播放剖面"}</span>
          </button>
        </header>
        <div className="argo-profile-slider-row">
          <span className="depth-end-label">海表</span>
          <input
            type="range"
            min={0}
            max={Math.max(0, profileRows.length - 1)}
            value={Math.min(depthIndex, Math.max(0, profileRows.length - 1))}
            onChange={(event) => {
              setProfilePlaying(false);
              setDepthIndex(Number(event.target.value));
            }}
            aria-label="选择剖面深度"
          />
          <span className="depth-end-label">深层</span>
        </div>
        <div className="argo-profile-reading">
          <div className="argo-profile-depth"><span>当前深度</span><strong>{activeProfilePoint ? formatValue(activeProfilePoint.pressure, 1) : "--"}</strong><small>dbar</small></div>
          <div><span>温度</span><strong>{formatValue(activeProfilePoint?.temperature, 2)}</strong><small>°C</small></div>
          <div><span>盐度</span><strong>{formatValue(activeProfilePoint?.salinity, 3)}</strong><small>PSU</small></div>
          <div><span>叶绿素</span><strong>{formatValue(activeProfilePoint?.chla, 3)}</strong><small>mg m⁻³</small></div>
          <div><span>硝酸盐</span><strong>{formatValue(activeProfilePoint?.nitrate, 2)}</strong><small>μmol kg⁻¹</small></div>
        </div>
        <p className="argo-profile-story">{depthStory}</p>
      </section>

      <div className="argo-live-chart-block">
        <div className="argo-live-chart-heading">
          <div><span className="section-label"><Activity size={15} /> {explorerMode ? "海水从浅到深怎样变化" : "垂向压力剖面"}</span><small>{activeMeta.label} · {activeMeta.unit}</small></div>
          {explorerMode ? (
            <span className="argo-explorer-chart-hint">拖动上方滑块查看每一层</span>
          ) : (
            <span className="argo-qc-badge">
              <CheckCircle2 size={13} /> 最浅层 QC {latestQc ?? "--"} · {VALUE_MODE_LABELS[surfaceMode]}
              {profileMode !== surfaceMode && profileMode !== "unavailable" ? ` / 剖面${VALUE_MODE_LABELS[profileMode]}` : ""}
            </span>
          )}
        </div>
        <div className="argo-live-chart" style={{ "--chart-color": activeMeta.color } as CSSProperties}>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} layout="vertical" margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                <CartesianGrid stroke="rgba(202, 220, 211, 0.12)" strokeDasharray="2 4" horizontal={false} />
                <XAxis type="number" dataKey="value" tick={{ fill: "#a4b5ae", fontSize: 10 }} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
                <YAxis type="number" dataKey="pressure" domain={[0, "dataMax"]} tick={{ fill: "#a4b5ae", fontSize: 10 }} tickLine={false} axisLine={false} width={38} tickFormatter={(value) => `${value}`} />
                <Tooltip
                  cursor={{ stroke: activeMeta.color, strokeOpacity: 0.26 }}
                  contentStyle={{ background: "#101b1b", border: "1px solid rgba(207, 225, 214, .2)", borderRadius: 0, color: "#f1f1e9" }}
                  labelFormatter={(value) => `${value} dbar`}
                  formatter={(value: number) => [formatValue(value, activeMeta.precision), `${activeMeta.label} (${activeMeta.unit})`]}
                />
                <Line type="linear" dataKey="value" stroke={activeMeta.color} strokeWidth={2.4} dot={false} activeDot={{ r: 4, stroke: "#f1f1e9", strokeWidth: 1.5 }} animationDuration={700} animationEasing="ease-out" />
              </LineChart>
            </ResponsiveContainer>
          ) : <div className="argo-chart-empty">该剖面没有可用的 {activeMeta.label} 测量值</div>}
        </div>
        <div className="argo-chart-axis-note">
          <span>最浅有效 {formatValue(activePressure, 1)} dbar</span>
          <span>压力向下增大 · 最深 {formatValue(latest.max_pressure, 0)} dbar</span>
        </div>
      </div>

      {!explorerMode && <div className="argo-track-strip">
        <div><span className="argo-track-line" /><div><strong>轨迹已同步</strong><small title="周期号来自源文件，仅作标识；轨迹按观测时间排序">{trackScopeLabel} {snapshot.track.length} 个位置 · {trackCycleLabel}{hasCycleGaps ? "（编号非连续）" : ""}</small></div></div>
        <span>{snapshot.source_updated_at ? `源更新 ${formatTime(snapshot.source_updated_at)}` : "源更新时间未知"}</span>
      </div>}

      <section className={dataDetailsOpen ? "argo-data-details open" : "argo-data-details"} aria-label="浮标详细数据">
        <button
          type="button"
          className="argo-data-details-toggle"
          onClick={() => setDataDetailsOpen((current) => !current)}
          aria-expanded={dataDetailsOpen}
        >
          <span><Layers3 size={15} /> {explorerMode ? "查看专业数据" : "完整观测数据"} <small>{latest.sample_count} 个深度点 · {snapshot.track.length} 个轨迹点</small></span>
          <ChevronDown size={15} />
        </button>
        {dataDetailsOpen && (
          <div className="argo-data-details-body">
            <div className="argo-data-meta-grid">
              <div><span>平台网络</span><strong>{snapshot.network}</strong></div>
              <div><span>剖面范围</span><strong>{trackScopeLabel}</strong></div>
              <div><span>垂向采样</span><strong>{latest.vertical_sampling_scheme ?? "未标注"}</strong></div>
              <div><span>观测方向</span><strong>{latest.direction ?? "未标注"}</strong></div>
              <div><span>最大压力</span><strong>{formatValue(latest.max_pressure, 0)} dbar</strong></div>
              <div><span>位置 QC / 时间 QC</span><strong>{latest.position_qc ?? "--"} / {latest.timestamp_qc ?? "--"}</strong></div>
              <div><span>数据抓取</span><strong>{formatTime(snapshot.fetched_at)}</strong></div>
              <div><span>源更新时间</span><strong>{formatTime(snapshot.source_updated_at)}</strong></div>
            </div>

            <div className="argo-variable-coverage">
              <header><strong>变量覆盖与模式</strong><small>近表层 / 全剖面</small></header>
              {(Object.keys(VARIABLE_META) as VariableKey[]).map((key) => (
                <div className="argo-variable-coverage-row" key={key}>
                  <span className="argo-variable-name"><i style={{ background: VARIABLE_META[key].color }} />{VARIABLE_META[key].label}</span>
                  <span>{VALUE_MODE_LABELS[latest.surface_modes[key] ?? "unavailable"]}</span>
                  <span>{VALUE_MODE_LABELS[latest.variable_modes[key] ?? "unavailable"]}</span>
                  <b>QC {surface[`${key}_qc`] ?? "--"}</b>
                </div>
              ))}
            </div>

            <div className="argo-profile-table-wrap">
              <header><strong>深度采样明细</strong><small>全部 {profileRows.length} 个压力层 · 可滚动查看</small></header>
              <table className="argo-profile-table">
                <thead><tr><th>压力 dbar</th><th>温度 °C</th><th>盐度 PSU</th><th>叶绿素</th><th>硝酸盐</th></tr></thead>
                <tbody>
                  {profileRows.map((point) => (
                    <tr key={`${point.pressure}-${point.temperature ?? "x"}-${point.salinity ?? "x"}`}>
                      <td>{formatValue(point.pressure, 1)}</td>
                      <td>{formatValue(point.temperature, 2)}</td>
                      <td>{formatValue(point.salinity, 3)}</td>
                      <td>{formatValue(point.chla, 3)}</td>
                      <td>{formatValue(point.nitrate, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="argo-track-table-wrap">
              <header><strong>最近轨迹点</strong><small>按观测时间排序 · 共 {snapshot.track.length} 个</small></header>
              <div className="argo-track-table">
                {snapshot.track.slice(-8).reverse().map((point) => (
                  <div key={`${point.cycle}-${point.timestamp}`}><b>Cycle {point.cycle}</b><span>{formatTime(point.timestamp)}</span><span>{latitudeLabel(point.latitude)} · {longitudeLabel(point.longitude)}</span></div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {expanded && marineEnrichmentLoading && !marineContext && !marineKnowledge?.encyclopedia && (
        <div className="argo-marine-enrichment-loading" role="status">
          <Radio size={15} />
          <span>正在按浮标最新坐标匹配渔业记录与权威海域百科...</span>
        </div>
      )}

      {expanded && marineContext && (
        <section className={fisheryOpen ? "argo-enrichment-section argo-fishery-section open" : "argo-enrichment-section argo-fishery-section"} aria-label="浮标附近渔业资源">
          <button type="button" className="argo-enrichment-toggle" onClick={() => setFisheryOpen((current) => !current)} aria-expanded={fisheryOpen}>
            <span className="argo-enrichment-heading">
              <Fish size={16} />
              <span>
                <strong>附近渔业资源</strong>
                <small>{marineContext.display_name ?? marineContext.sea_name} · {marineContext.fisheries_species_count} 种交叉校验物种</small>
              </span>
            </span>
            <ChevronDown size={15} />
          </button>
          {fisheryOpen && (
            <div className="argo-enrichment-body">
              <div className="argo-enrichment-evidence-grid">
                <div><span>物种级匹配</span><strong>{marineContext.fisheries_species_count}</strong></div>
                <div><span>合格出现记录</span><strong>{marineContext.fisheries_total_records}</strong></div>
                <div><span>检索半径</span><strong>{marineContext.fisheries_search_radius_km} km</strong></div>
                <div><span>FAO 统计区</span><strong>{marineContext.fao_area.name}（{marineContext.fao_area.code}）</strong></div>
              </div>
              {marineContext.fisheries.length > 0 ? (
                <div className="argo-fishery-list">
                  {marineContext.fisheries.map((resource) => {
                    const displayName = resource.chinese_name ?? resource.common_name ?? resource.scientific_name;
                    const yearRange = resource.first_year && resource.latest_year
                      ? (resource.first_year === resource.latest_year ? `${resource.latest_year}` : `${resource.first_year}-${resource.latest_year}`)
                      : (resource.latest_year ? `${resource.latest_year}` : "年份未标注");
                    return (
                      <article className="argo-fishery-row" key={`${resource.scientific_name}-${resource.minimum_distance_km}`}>
                        <div className="argo-fishery-name">
                          <strong>{displayName}</strong>
                          <i>{resource.scientific_name}</i>
                          <span>{resource.family ?? "科名未收录"}{resource.fao_alpha3_code ? ` · FAO ${resource.fao_alpha3_code}` : ""}</span>
                        </div>
                        <div className="argo-fishery-evidence">
                          <span><b>{resource.evidence_count}</b> 条记录</span>
                          <span><b>{resource.dataset_count}</b> 个数据集</span>
                          <span>最近 <b>{resource.minimum_distance_km.toFixed(1)} km</b></span>
                          <span>{yearRange}</span>
                        </div>
                        <div className="argo-fishery-links">
                          {resource.chinese_name_source_url && <a href={resource.chinese_name_source_url} target="_blank" rel="noreferrer">中文名来源 <ExternalLink size={11} /></a>}
                          <a href={resource.source_url} target="_blank" rel="noreferrer">OBIS 记录 <ExternalLink size={11} /></a>
                          <a href={resource.asfis_source_url} target="_blank" rel="noreferrer">FAO ASFIS <ExternalLink size={11} /></a>
                          {resource.worms_source_url && <a href={resource.worms_source_url} target="_blank" rel="noreferrer">WoRMS 分类 <ExternalLink size={11} /></a>}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : marineContext.fisheries_results_complete ? (
                <p className="argo-enrichment-empty">该浮标坐标 {marineContext.fisheries_search_radius_km} km 内未检出同时通过 OBIS、WoRMS 与 FAO ASFIS 校验的物种级记录。</p>
              ) : (
                <p className="argo-enrichment-empty">本次物种检索未完整返回，当前不展示未经交叉校验的名称。</p>
              )}
              <footer className="argo-enrichment-source">
                <span>{marineContext.fisheries_source} · ASFIS {marineContext.fisheries_asfis_version}</span>
                <a href={marineContext.fisheries_source_url} target="_blank" rel="noreferrer">查看数据源 <ExternalLink size={11} /></a>
              </footer>
            </div>
          )}
        </section>
      )}

      {expanded && marineKnowledge?.encyclopedia && (
        <section className={humanitiesOpen ? "argo-enrichment-section argo-humanities-section open" : "argo-enrichment-section argo-humanities-section"} aria-label="海域百科与海洋人文">
          <button type="button" className="argo-enrichment-toggle" onClick={() => setHumanitiesOpen((current) => !current)} aria-expanded={humanitiesOpen}>
            <span className="argo-enrichment-heading">
              <BookOpen size={16} />
              <span>
                <strong>海域百科与海洋人文</strong>
                <small>{marineKnowledge.display_name} · {marineKnowledge.encyclopedia.source_name}</small>
              </span>
            </span>
            <ChevronDown size={15} />
          </button>
          {humanitiesOpen && (
            <div className="argo-enrichment-body argo-humanities-body">
              <header className="argo-humanities-identity">
                <div>
                  <span>{marineKnowledge.place_type} · 所属海洋 {marineKnowledge.parent_ocean ?? "未标注"}</span>
                  <strong>{marineKnowledge.display_name}</strong>
                  <small>{marineKnowledge.sea_name_en}</small>
                </div>
                <div>
                  <span>百科原条目</span>
                  <strong>{marineKnowledge.encyclopedia.source_title ?? marineKnowledge.encyclopedia.title}</strong>
                  <small>页面修订 #{marineKnowledge.encyclopedia.revision_id.toLocaleString("zh-CN")} · 更新 {formatTime(marineKnowledge.encyclopedia.page_updated_at)}</small>
                </div>
              </header>
              <div className="argo-humanities-copy">
                {marineKnowledge.encyclopedia.paragraphs.map((paragraph, index) => <p key={`${marineKnowledge.encyclopedia?.page_id}-${index}`}>{paragraph}</p>)}
              </div>
              <footer className="argo-enrichment-source">
                <span>{marineKnowledge.encyclopedia.source_name} · {marineKnowledge.encyclopedia.license} · 快照 {formatTime(marineKnowledge.encyclopedia.snapshot_at)}</span>
                <a href={marineKnowledge.encyclopedia.url} target="_blank" rel="noreferrer">查看原始条目 <ExternalLink size={11} /></a>
              </footer>
            </div>
          )}
        </section>
      )}

      <div className={explanationOpen ? "argo-explanation open" : "argo-explanation"}>
        <button type="button" className="argo-explanation-toggle" onClick={() => setExplanationOpen((current) => !current)} aria-expanded={explanationOpen}>
          <span><Sparkles size={15} /> 科学研读与边界</span><ChevronDown size={15} />
        </button>
        {explanationOpen && (
          <div className="argo-explanation-body">
            <strong>{snapshot.explanation.headline}</strong>
            <p>{snapshot.explanation.summary}</p>
            <ul>{snapshot.explanation.findings.slice(1).map((finding) => <li key={finding}>{finding}</li>)}</ul>
            <div className="argo-explanation-boundary">
              <span><AlertTriangle size={12} /> 研读边界</span>
              <ul>{snapshot.explanation.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul>
            </div>
            <small>{snapshot.explanation.method}</small>
          </div>
        )}
      </div>

      <footer className="argo-live-footer">
        <span className="argo-source-credit">数据源：{snapshot.source.name}</span>
        <a href={snapshot.source.gdac_url} target="_blank" rel="noreferrer">查看 GDAC <ExternalLink size={12} /></a>
      </footer>
    </section>
  );
}
