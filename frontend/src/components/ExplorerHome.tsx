import { Activity, ArrowRight, BookOpen, CircleHelp, Compass, Droplets, ExternalLink, Globe2, GraduationCap, MapPinned, Newspaper, Radio, RefreshCw, Sparkles, Thermometer, Waves, Wind, X } from "lucide-react";
import { memo, useState, type Dispatch, type SetStateAction } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ArgoRegionSnapshot, CopernicusGlobalDataVolume, DailyBriefingDashboard, DailyBriefingEnvelope, EventCounts, EventSummary, Metrics, OceanRegion, RegionalObservationSummary } from "../types";

export type ExperienceMode = "explorer" | "professional";

interface ExplorerHomeProps {
  region: OceanRegion;
  regions: OceanRegion[];
  selectedRegionId: string;
  onRegionChange: (regionId: string) => void;
  loading: boolean;
  events: EventSummary[];
  counts: EventCounts | null;
  metrics: Metrics;
  observations: RegionalObservationSummary | null;
  argoRegion: ArgoRegionSnapshot | null;
  copernicusGlobalVolume: CopernicusGlobalDataVolume | null;
  copernicusGlobalVolumeLoading: boolean;
  scheduledDailyBriefing: DailyBriefingEnvelope | null;
  dailyBriefingDashboard: DailyBriefingDashboard | null;
  onSelectArgoPlatform: (platform: string) => void;
  onChinaAreaSelect: (area: string) => void;
  mode: ExperienceMode;
  onModeChange: Dispatch<SetStateAction<ExperienceMode>>;
  briefOpen: boolean;
  onBriefToggle: () => void;
  tutorialOpen: boolean;
  onTutorialToggle: () => void;
  onExplore: (target: "float" | "temperature" | "heatwave" | "literature") => void;
}

const GUIDE_STEPS = [
  { icon: <Radio size={18} />, title: "先看彩色点", body: "地图上的彩色点代表正在工作的海洋观测浮标。它们会定期上浮，把真实海水数据传回来。" },
  { icon: <MapPinned size={18} />, title: "再点一片海", body: "点击地图上的海面，可以看到经纬度、最近浮标和这个海域可能的生态与渔业资源。" },
  { icon: <Waves size={18} />, title: "最后看剖面", body: "打开浮标详情，拖动深度，就能观察海水温度、盐度和生地化变量怎样随深度变化。" },
];

const KNOWLEDGE_CARDS = [
  {
    title: "海洋热浪不是一次高温",
    body: "它要同时看异常有多大、持续多久、影响了多大范围。一个浮标的高温读数只能说明附近值得继续观察。",
    fact: "先看持续时间，再判断是不是区域性现象。",
  },
  {
    title: "盐度像海水的指纹",
    body: "降雨、蒸发、河流入海和海流混合都会改变盐度。把盐度和温度放在一起，才能更接近水团变化的原因。",
    fact: "温度告诉你冷热，盐度帮助你识别水从哪里来。",
  },
  {
    title: "叶绿素不等于鱼的数量",
    body: "叶绿素 a 常被用来观察浮游植物活动。它能提示生态过程正在变化，但不能直接代表鱼群数量或渔获量。",
    fact: "生态线索需要和营养盐、光照及水体稳定性一起看。",
  },
  {
    title: "Argo 浮标会反复上浮",
    body: "浮标下潜到深层，再返回海面上传数据。每次上浮都会带回一条从海表到深层的温盐剖面。",
    fact: "一次剖面是一个地点的快照，多次观测才能组成变化故事。",
  },
];

const BEIJING_TIME_ZONE = "Asia/Shanghai";

function storyConclusion(observations: RegionalObservationSummary | null, events: EventSummary[]) {
  if (observations?.conclusion.headline) return observations.conclusion.headline;
  const anomalyCount = events.filter((event) => event.event_kind === "anomaly").length;
  if (anomalyCount > 0) return `今天发现 ${anomalyCount} 个值得继续观察的海洋变化。`;
  return "正在汇总最新观测，暂时没有足够证据确认新的区域性异常。";
}

function formatBriefDate(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short", timeZone: BEIJING_TIME_ZONE }).format(value);
}

function formatCalendarDate(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", timeZone: BEIJING_TIME_ZONE }).format(value);
}

function formatBriefTime(value: string | null) {
  if (!value) return "等待最新回传";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间不可用";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(date) + " UTC";
}

function formatBeijingTime(value: string | Date | null) {
  if (!value) return "暂无回传";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "时间不可用";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: BEIJING_TIME_ZONE }).format(date) + " 北京时间";
}

function beijingDateKey(value: string | Date | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: BEIJING_TIME_ZONE }).format(date);
}

function formatCoordinate([longitude, latitude]: [number, number]) {
  const latitudeText = `${Math.abs(latitude).toFixed(1)}°${latitude >= 0 ? "N" : "S"}`;
  const longitudeText = `${Math.abs(longitude).toFixed(1)}°${longitude >= 0 ? "E" : "W"}`;
  return `${latitudeText}, ${longitudeText}`;
}

function eventDirection(event: EventSummary) {
  if (/偏高|升高|增高|变暖/.test(`${event.title}${event.summary}`)) return "偏高";
  if (/偏低|降低|变冷/.test(`${event.title}${event.summary}`)) return "偏低";
  return "变化";
}

function eventDeviation(event: EventSummary) {
  const match = event.summary.match(/(?:附近测点|基线|合成场)(?:高|低|偏高|偏低)?(?:约)?\s*([0-9.]+)\s*°C/i)
    ?? event.summary.match(/(?:高|低)\s*([0-9.]+)\s*°C/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return eventDirection(event) === "偏低" ? -value : value;
}

function eventAction(event: EventSummary) {
  const variables = new Set(event.variables);
  if (variables.has("SST")) return "查看未来 24 小时同一格点是否继续保持同方向，并对照最近 Argo 浮标的近表层温度。";
  if (variables.has("CHLA")) return "核对相邻水色像元、云覆盖和营养盐观测；单个像元变化不能直接判断藻华。";
  if (variables.has("CURRENT")) return "检查邻近流场和连续时次，确认变化是否可能影响漂移路径或物质输运。";
  if (variables.has("SALINITY") || variables.has("NITRATE")) return "对照同一浮标前一周期和邻近剖面，判断变化是局地水团信号还是单点波动。";
  return "继续跟踪下一次数据更新，并用邻近观测交叉验证后再升级判断。";
}

function selectBriefEvents(events: EventSummary[]) {
  const anomalies = events.filter((event) => event.event_kind === "anomaly");
  const source = anomalies.length > 0 ? anomalies : events;
  const ranked = [...source].sort((left, right) => {
    const deviationDifference = Math.abs(eventDeviation(right) ?? 0) - Math.abs(eventDeviation(left) ?? 0);
    return deviationDifference || right.confidence - left.confidence || right.severity - left.severity;
  });
  const selected: EventSummary[] = [];
  const categories = new Set<string>();
  for (const event of ranked) {
    const category = `${event.variables[0] ?? event.type}:${eventDirection(event)}`;
    if (categories.has(category) && selected.length < 3) continue;
    categories.add(category);
    selected.push(event);
    if (selected.length === 4) break;
  }
  return selected;
}

function isWithinTimeWindow(value: string | null, windowStart: Date, windowEnd: Date) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp >= windowStart.getTime() && timestamp <= windowEnd.getTime();
}

function latestArgoSurfaceTemperatures(events: EventSummary[], windowStart: Date, windowEnd: Date) {
  const observations = events
    .filter((event) => event.event_kind === "observation"
      && event.variables.includes("TEMPERATURE")
      && isWithinTimeWindow(event.source_updated_at ?? event.started_at, windowStart, windowEnd))
    .map((event) => {
      const match = event.title.match(/浮标\s+(\S+).*?温度\s+(-?[0-9.]+).*?（([0-9.]+) dbar）/);
      if (!match) return null;
      const temperature = Number(match[2]);
      const pressure = Number(match[3]);
      if (!Number.isFinite(temperature) || !Number.isFinite(pressure) || pressure > 10) return null;
      return {
        id: event.id,
        platform: match[1],
        location: event.region,
        temperature,
        pressure,
        observedAt: event.source_updated_at ?? event.started_at,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => new Date(right.observedAt).getTime() - new Date(left.observedAt).getTime());
  const platforms = new Set<string>();
  return observations.filter((item) => {
    if (platforms.has(item.platform)) return false;
    platforms.add(item.platform);
    return true;
  }).slice(0, 8);
}

function buildDailyBrief(
  region: OceanRegion,
  argoRegion: ArgoRegionSnapshot | null,
  copernicusGlobalVolume: CopernicusGlobalDataVolume | null,
  observations: RegionalObservationSummary | null,
  events: EventSummary[],
) {
  const profiles = argoRegion?.profiles ?? [];
  const newest = profiles[0] ?? null;
  const now = new Date();
  const currentWindowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const currentProfiles = profiles.filter((profile) => isWithinTimeWindow(profile.timestamp, currentWindowStart, now));
  const newestArgoDate = newest ? new Date(newest.timestamp) : null;
  const useLatestArgoWindow = currentProfiles.length === 0
    && newestArgoDate !== null
    && !Number.isNaN(newestArgoDate.getTime())
    && newestArgoDate < currentWindowStart;
  const argoWindowEnd = useLatestArgoWindow ? newestArgoDate as Date : now;
  const argoWindowStart = new Date(argoWindowEnd.getTime() - 24 * 60 * 60 * 1000);
  const recentProfiles = useLatestArgoWindow
    ? profiles.filter((profile) => isWithinTimeWindow(profile.timestamp, argoWindowStart, argoWindowEnd))
    : currentProfiles;
  const recentEvents = events.filter((event) => isWithinTimeWindow(event.source_updated_at ?? event.started_at, currentWindowStart, now));
  const recentFloatCount = new Set(recentProfiles.map((profile) => profile.platform)).size;
  const recentBgcCount = new Set(recentProfiles.filter((profile) => profile.has_bgc).map((profile) => profile.platform)).size;
  const timeline = observations?.sst_timeline ?? [];
  const firstSst = timeline[0] ?? null;
  const latestSst = timeline[timeline.length - 1] ?? null;
  const sstDelta = firstSst && latestSst ? latestSst.median - firstSst.median : null;
  const anomalyEvents = recentEvents.filter((event) => event.event_kind === "anomaly");
  const argoSurface = latestArgoSurfaceTemperatures(events, argoWindowStart, argoWindowEnd);
  const argoTemperatures = argoSurface.map((item) => item.temperature).sort((left, right) => left - right);
  const argoMedian = argoTemperatures.length === 0
    ? null
    : argoTemperatures.length % 2 === 1
      ? argoTemperatures[Math.floor(argoTemperatures.length / 2)]
      : (argoTemperatures[argoTemperatures.length / 2 - 1] + argoTemperatures[argoTemperatures.length / 2]) / 2;
  const argoLatestAt = recentProfiles[0]?.timestamp ?? argoSurface[0]?.observedAt ?? null;
  const eventItems = selectBriefEvents(recentEvents);
  const strongestEvent = eventItems[0] ?? null;
  const latestSstDate = latestSst ? new Date(latestSst.timestamp) : null;
  const sstIsToday = latestSstDate !== null
    && !Number.isNaN(latestSstDate.getTime())
    && latestSstDate.toDateString() === now.toDateString();
  const currentCopernicusDatasets = copernicusGlobalVolume?.datasets.filter((dataset) => dataset.is_current_day) ?? [];
  const copernicusRecordCount = copernicusGlobalVolume?.record_count ?? 0;
  const copernicusLatestAt = copernicusGlobalVolume?.latest_observation_at ?? null;
  const headline = strongestEvent
    ? `${strongestEvent.region.split(" · ")[0]}出现${eventDirection(strongestEvent)}信号，需继续复核`
    : copernicusRecordCount > 0 && recentProfiles.length > 0
      ? `Copernicus 今日场与 ${recentFloatCount} 个 Argo 浮标共同更新`
      : copernicusRecordCount > 0
        ? "Copernicus Marine 今日全球场已更新"
        : recentProfiles.length > 0
          ? `${region.short_name}${useLatestArgoWindow ? "最新可用24小时" : "过去24小时"}有 ${recentFloatCount} 个 Argo 浮标回传`
          : `${region.short_name}过去24小时暂无新的 Argo 回传`;
  const copernicusSituation = copernicusGlobalVolume
    ? `Copernicus Marine ${copernicusGlobalVolume.date} UTC 已汇总 ${currentCopernicusDatasets.length}/${copernicusGlobalVolume.dataset_count} 个当日产品、${copernicusRecordCount.toLocaleString()} 条全球网格时次记录，最新场为 ${formatBriefTime(copernicusLatestAt)}。`
    : "Copernicus Marine 当日全球场正在读取。";
  const argoSituation = recentProfiles.length > 0
    ? `${formatBeijingTime(argoWindowStart)}至 ${formatBeijingTime(argoWindowEnd)}，${region.name}的 Argo 全量目录包含 ${recentProfiles.length} 条剖面记录，来自 ${recentFloatCount} 个浮标，其中 BGC 浮标 ${recentBgcCount} 个。${argoMedian === null ? "" : ` 近表层温度实测中位数为 ${argoMedian.toFixed(1)} °C，范围 ${argoTemperatures[0].toFixed(1)}–${argoTemperatures[argoTemperatures.length - 1].toFixed(1)} °C。`}`
    : `${formatBeijingTime(currentWindowStart)}至 ${formatBeijingTime(now)}，${region.name}的 Argo 区域目录中没有新回传。最新历史回传为 ${formatBeijingTime(argoRegion?.latest_observation_at ?? null)}。`;
  const situation = `${copernicusSituation} ${argoSituation}`;
  const networkText = argoRegion
    ? `背景目录：过去 ${argoRegion.lookback_days} 天共收录 ${argoRegion.profile_count.toLocaleString()} 条 Argo 剖面、${argoRegion.float_count.toLocaleString()} 个活跃浮标；最新历史回传${newest ? `为 ${newest.platform}（${formatCoordinate([newest.longitude, newest.latitude])}，${formatBeijingTime(newest.timestamp)}）` : "尚未定位"}。`
    : "Argo 区域目录正在读取。";
  const hourlyCounts = new Map<number, number>();
  for (const profile of recentProfiles) {
    const hourText = new Intl.DateTimeFormat("en-US", { hour: "2-digit", hourCycle: "h23", timeZone: BEIJING_TIME_ZONE }).format(new Date(profile.timestamp));
    const hour = Number(hourText);
    hourlyCounts.set(hour, (hourlyCounts.get(hour) ?? 0) + 1);
  }
  return {
    headline,
    situation,
    networkText,
    eventItems,
    evidence: [
      copernicusGlobalVolume
        ? `Copernicus Marine 当日有效产品 ${currentCopernicusDatasets.length} 个，覆盖 ${copernicusRecordCount.toLocaleString()} 条网格时次记录、${copernicusGlobalVolume.value_count.toLocaleString()} 个变量值。`
        : "Copernicus Marine 当日全球数据量正在读取。",
      `${useLatestArgoWindow ? "Argo 最新可用24小时" : "过去24小时 Argo"}回传 ${recentProfiles.length} 条，来自 ${recentFloatCount} 个浮标；BGC 浮标 ${recentBgcCount} 个。`,
      recentProfiles.length > 0 ? `Argo 窗口内最新回传时间为 ${formatBeijingTime(argoLatestAt)}。` : `截至 ${formatBeijingTime(now)}，过去24小时暂无新增 Argo 回传。`,
      latestSst ? `NOAA 海温产品最新到 ${formatBriefTime(latestSst.timestamp)}，仅作为历史背景，不纳入过去24小时 Argo 统计。` : "NOAA 海温背景数据暂不可用。",
    ],
    recentProfiles: recentProfiles.slice(0, 8),
    recentProfileCount: recentProfiles.length,
    recentFloatCount,
    recentBgcCount,
    recentAnomalyCount: anomalyEvents.length,
    argoHourly: [...hourlyCounts.entries()].sort(([left], [right]) => left - right).map(([hour, count]) => ({ hour: `${String(hour).padStart(2, "0")}:00`, count })),
    latestSst,
    sstDelta,
    argoSurface,
    argoMedian,
    argoLatestAt,
    argoWindowLabel: useLatestArgoWindow ? "Argo 最新可用24小时" : "过去24小时",
    argoWindowRange: `${formatBeijingTime(argoWindowStart)}至 ${formatBeijingTime(argoWindowEnd)}`,
    copernicusRecordCount,
    copernicusDatasetCount: currentCopernicusDatasets.length,
    dataNotices: [
      useLatestArgoWindow
        ? `Argovis 全球目录最新回传为 ${formatBeijingTime(argoWindowEnd)}，早于当前滚动窗口；系统已自动使用该数据源最新可用的完整24小时窗口，避免把上游发布延迟误判为“全球无数据”。`
        : null,
      latestSstDate && !sstIsToday
        ? `NOAA 格点海温目前最新到 ${formatCalendarDate(latestSstDate)}，仅保留为历史背景，不计入当前24小时结论。`
        : null,
      ...(copernicusGlobalVolume?.errors ?? []),
    ].filter((notice): notice is string => Boolean(notice)),
    qualityText: observations?.noaa_quality_pass_fraction === null || observations?.noaa_quality_pass_fraction === undefined
      ? "—"
      : `${Math.round(observations.noaa_quality_pass_fraction * 100)}%`,
    sstCandidates: anomalyEvents
      .filter((event) => event.variables.includes("SST") && eventDeviation(event) !== null)
      .map((event) => ({
        id: event.id,
        location: event.region.replace(" · ", " "),
        deviation: eventDeviation(event) as number,
        confidence: Math.round(event.confidence * 100),
        observedAt: formatBriefTime(event.source_updated_at ?? event.started_at),
      }))
      .sort((left, right) => Math.abs(right.deviation) - Math.abs(left.deviation))
      .slice(0, 7),
  };
}

function ExplorerGuide({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const current = GUIDE_STEPS[step];
  const isLast = step === GUIDE_STEPS.length - 1;
  return (
    <div className="explorer-guide-backdrop" role="presentation">
      <section className="explorer-guide" role="dialog" aria-modal="true" aria-labelledby="explorer-guide-title">
        <button type="button" className="explorer-guide-close" onClick={onClose} aria-label="跳过引导" title="跳过引导"><X size={16} /></button>
        <span className="explorer-guide-kicker">第一次来到海上</span>
        <h2 id="explorer-guide-title">三步读懂一片海</h2>
        <p className="explorer-guide-intro">不用先记住专业术语，跟着地图走一遍，你就能开始自己的海洋观察。</p>
        <div className="explorer-guide-visual" key={step}>
          <span className="explorer-guide-orbit" />
          <span className="explorer-guide-pulse">{current.icon}</span>
          <span className="explorer-guide-depth-line" />
        </div>
        <div className="explorer-guide-copy">
          <span className="explorer-guide-step">0{step + 1} / 0{GUIDE_STEPS.length}</span>
          <h3>{current.title}</h3>
          <p>{current.body}</p>
        </div>
        <div className="explorer-guide-progress" aria-hidden="true">
          {GUIDE_STEPS.map((item, index) => <i className={index <= step ? "active" : ""} key={item.title} />)}
        </div>
        <footer>
          <button type="button" className="explorer-guide-skip" onClick={onClose}>跳过</button>
          <button type="button" className="explorer-guide-next" onClick={() => (isLast ? onClose() : setStep((value) => value + 1))}>
            {isLast ? "开始探索" : "下一步"}<ArrowRight size={15} />
          </button>
        </footer>
      </section>
    </div>
  );
}

export const ExplorerHome = memo(function ExplorerHome({ region, regions, selectedRegionId, onRegionChange, loading, events, counts, metrics, observations, argoRegion, copernicusGlobalVolume, copernicusGlobalVolumeLoading, scheduledDailyBriefing, dailyBriefingDashboard, onSelectArgoPlatform, onChinaAreaSelect, mode, onModeChange, briefOpen, onBriefToggle, tutorialOpen, onTutorialToggle, onExplore }: ExplorerHomeProps) {
  const [knowledgeIndex, setKnowledgeIndex] = useState(0);
  const conclusion = storyConclusion(observations, events);
  const floatCount = argoRegion?.float_count ?? metrics.observing_assets;
  const sourceCount = metrics.source_count || 0;
  const anomalyCount = counts?.signals ?? events.filter((event) => event.event_kind === "anomaly").length;
  const candidate = observations?.conclusion.state === "candidate_present" || anomalyCount > 0;
  const confidenceText = candidate
    ? "有变化值得继续看，但还需要更多浮标、卫星或持续时间来确认。"
    : "目前没有确认新的区域性异常，现有观测仍在持续更新。";
  const knowledge = KNOWLEDGE_CARDS[knowledgeIndex % KNOWLEDGE_CARDS.length];
  const liveDailyBrief = buildDailyBrief(region, argoRegion, copernicusGlobalVolume, observations, events);
  const persistedBriefing = scheduledDailyBriefing?.briefing ?? null;
  const dailyBrief = persistedBriefing?.status === "published"
    ? {
        ...liveDailyBrief,
        headline: persistedBriefing.headline,
        situation: persistedBriefing.summary,
        evidence: persistedBriefing.evidence,
        copernicusRecordCount: persistedBriefing.copernicus.record_count,
        copernicusDatasetCount: persistedBriefing.copernicus.current_dataset_count,
      }
    : liveDailyBrief;
  const briefLoading = loading && !argoRegion && !copernicusGlobalVolume;
  const scheduleNotice = persistedBriefing?.status === "published"
    ? `本期简报已于 ${formatBeijingTime(persistedBriefing.published_at)} 自动发布。下一期将在北京时间 ${scheduledDailyBriefing?.schedule.generate_time ?? "08:00"} 成稿、${scheduledDailyBriefing?.schedule.publish_time ?? "09:00"} 发布。`
    : persistedBriefing?.status === "generated"
      ? `今日简报已于 ${formatBeijingTime(persistedBriefing.generated_at)} 成稿，将在北京时间 ${scheduledDailyBriefing?.schedule.publish_time ?? "09:00"} 自动发布。`
      : `每日北京时间 ${scheduledDailyBriefing?.schedule.generate_time ?? "08:00"} 自动成稿，${scheduledDailyBriefing?.schedule.publish_time ?? "09:00"} 自动发布。`;

  return (
    <>
      <section className={`explorer-home ${mode === "professional" ? "professional" : ""} ${briefOpen ? "story-open" : "story-closed"}`} aria-labelledby="explorer-home-title">
        <div className="explorer-home-heading">
          <div className="explorer-home-title-wrap">
            <div className="explorer-compact-copy">
              <span className="explorer-eyebrow"><Compass size={14} /> 海洋探索 / {region.short_name}</span>
              <strong>实时海域观测</strong>
              <span><i className={candidate ? "signal-dot warm" : "signal-dot calm"} />{loading ? "正在读取实时观测" : candidate ? `发现 ${anomalyCount} 个异常候选` : "暂未确认区域异常"} · {loading ? "—" : floatCount || "--"} 个浮标在线</span>
            </div>
            <span className="explorer-eyebrow"><Compass size={14} /> 海洋探索首页 / {region.short_name}</span>
            <h1 id="explorer-home-title">今天海上发生了什么？</h1>
            <p className="explorer-conclusion">{conclusion}</p>
            <div className="explorer-context-line">
              <span><i className={candidate ? "signal-dot warm" : "signal-dot calm"} />{loading ? "正在读取实时观测" : candidate ? "发现值得观察的变化" : "暂未确认重大异常"}</span>
              <span><Radio size={13} />{loading ? "—" : floatCount || "—"} 个浮标正在观测</span>
              <span><Sparkles size={13} />{loading ? "—" : sourceCount || "—"} 个数据来源</span>
            </div>
          </div>
          <div className="explorer-home-tools">
            <button type="button" className={tutorialOpen ? "story-toggle active" : "story-toggle"} onClick={onTutorialToggle} aria-expanded={tutorialOpen} aria-controls="explorer-story-panel"><GraduationCap size={15} /><span>{tutorialOpen ? "收起新手教程" : "新手教程"}</span></button>
            <button
              type="button"
              className={briefOpen ? "story-toggle active" : "story-toggle"}
              onClick={onBriefToggle}
              aria-expanded={briefOpen}
              aria-controls="daily-brief-panel"
            >
              {briefOpen ? <X size={15} /> : <Activity size={15} />}
              <span>{briefOpen ? "收起今日简报" : "今日简报"}</span>
            </button>
            <label className="explorer-region-select"><Globe2 size={14} /><select value={selectedRegionId} onChange={(event) => onRegionChange(event.target.value)} aria-label="选择探索海域">
              {regions.map((item) => <option value={item.id} key={item.id}>{item.short_name}</option>)}
            </select></label>
            <div className="experience-switch" role="group" aria-label="选择阅读模式">
              <button type="button" className={mode === "explorer" ? "active" : ""} onClick={() => onModeChange("explorer")}>入门模式</button>
              <button type="button" className={mode === "professional" ? "active" : ""} onClick={() => onModeChange("professional")}>专业模式</button>
            </div>
          </div>
        </div>

        {briefOpen && <section className="daily-brief" id="daily-brief-panel" aria-labelledby="daily-brief-title" tabIndex={0}>
            <div className="daily-brief-heading">
              <div className="daily-brief-kicker"><Activity size={14} /> 每日海洋简报 <span>{formatBriefDate(new Date())}</span></div>
              <div className="daily-brief-source"><i className={briefLoading || copernicusGlobalVolumeLoading ? "signal-dot warm" : "signal-dot calm"} />{briefLoading ? "正在同步实时数据" : `Copernicus ${dailyBrief.copernicusRecordCount.toLocaleString()} 条 · Argo ${dailyBrief.recentProfileCount} 条`}</div>
            </div>
            <div className="daily-brief-schedule"><Activity size={14} /><span>{scheduleNotice}</span></div>
            {dailyBrief.dataNotices.map((notice) => <div className="daily-brief-freshness" key={notice}><Activity size={14} /><span>{notice}</span></div>)}
            <div className="daily-brief-main">
              <div className="daily-brief-lead">
                <strong id="daily-brief-title">{briefLoading ? "正在生成今日简报" : dailyBrief.headline}</strong>
                <p>{dailyBrief.situation}</p>
              </div>
              <div className="daily-brief-facts">
                <div><small>Copernicus 当日记录</small><b>{copernicusGlobalVolumeLoading && !copernicusGlobalVolume ? "读取中" : dailyBrief.copernicusRecordCount.toLocaleString()}</b></div>
                <div><small>Copernicus 当日产品</small><b>{copernicusGlobalVolumeLoading && !copernicusGlobalVolume ? "读取中" : `${dailyBrief.copernicusDatasetCount} 个`}</b></div>
                <div><small>{dailyBrief.argoWindowLabel}回传</small><b>{briefLoading ? "—" : `${dailyBrief.recentProfileCount} 条`}</b></div>
                <div><small>回传浮标 / BGC</small><b>{briefLoading ? "—" : `${dailyBrief.recentFloatCount} / ${dailyBrief.recentBgcCount} 个`}</b></div>
              </div>
            </div>
            {dailyBriefingDashboard && <div className="daily-brief-regional-grid">
              <article className="daily-brief-chart-card daily-brief-regional-card">
                <header><div><span>中国大陆及中华人民共和国台湾岛近海</span><h3><Thermometer size={14} /> NOAA 平均海温</h3></div><em>单位 °C</em></header>
                <div className="daily-brief-chart regional-bars"><ResponsiveContainer width="100%" height="100%"><BarChart data={dailyBriefingDashboard.china_coastal_sst} layout="vertical" margin={{ top: 4, right: 18, bottom: 0, left: 38 }}><CartesianGrid stroke="rgba(139, 224, 204, .08)" horizontal={false} /><XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: "#789e96", fontSize: 8 }} unit="°" /><YAxis type="category" dataKey="name" width={105} axisLine={false} tickLine={false} tick={{ fill: "#b7d1c7", fontSize: 8 }} /><Tooltip contentStyle={{ background: "#102a2b", border: "1px solid rgba(139,224,204,.28)", color: "#edf3e9", fontSize: 10 }} formatter={(value: number, _name: string, item) => [`平均 ${value.toFixed(2)} °C · 最低 ${item.payload.minimum.toFixed(2)} · 最高 ${item.payload.maximum.toFixed(2)}`, `${item.payload.sample_count} 个网格`]} /><Bar dataKey="average" fill="#79cddd" radius={[0, 4, 4, 0]} maxBarSize={14} /></BarChart></ResponsiveContainer></div>
                <footer className="daily-brief-area-links">{dailyBriefingDashboard.china_coastal_sst.map((item) => <button type="button" key={item.name} onClick={() => onChinaAreaSelect(item.name)}>{item.name}</button>)}</footer>
              </article>
              <article className="daily-brief-chart-card daily-brief-regional-card">
                <header><div><span>中国大陆及中华人民共和国台湾岛近海</span><h3><Waves size={14} /> NOAA 平均表层流速</h3></div><em>单位 m/s · 非浪高</em></header>
                <div className="daily-brief-chart regional-bars"><ResponsiveContainer width="100%" height="100%"><BarChart data={dailyBriefingDashboard.china_coastal_sea_state} layout="vertical" margin={{ top: 4, right: 18, bottom: 0, left: 38 }}><CartesianGrid stroke="rgba(139, 224, 204, .08)" horizontal={false} /><XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: "#789e96", fontSize: 8 }} /><YAxis type="category" dataKey="name" width={105} axisLine={false} tickLine={false} tick={{ fill: "#b7d1c7", fontSize: 8 }} /><Tooltip contentStyle={{ background: "#102a2b", border: "1px solid rgba(139,224,204,.28)", color: "#edf3e9", fontSize: 10 }} formatter={(value: number, _name: string, item) => [`平均 ${value.toFixed(3)} m/s · 最低 ${item.payload.minimum.toFixed(3)} · 最高 ${item.payload.maximum.toFixed(3)}`, item.payload.coverage_mode === "nearest_grid" ? "最近有效网格" : `${item.payload.sample_count} 个区内矢量`]} /><Bar dataKey="average" fill="#82d8c6" radius={[0, 4, 4, 0]} maxBarSize={14} /></BarChart></ResponsiveContainer></div>
                <footer><span>{dailyBriefingDashboard.sources.sea_state_definition}</span></footer>
              </article>
              <article className="daily-brief-chart-card daily-brief-regional-card ocean-average-card">
                <header><div><span>全球大洋</span><h3><Globe2 size={14} /> 各大洋平均海温</h3></div><em>NOAA 最新有效格点</em></header>
                <div className="daily-brief-chart regional-bars"><ResponsiveContainer width="100%" height="100%"><BarChart data={dailyBriefingDashboard.ocean_sst} layout="vertical" margin={{ top: 4, right: 18, bottom: 0, left: 8 }}><CartesianGrid stroke="rgba(139, 224, 204, .08)" horizontal={false} /><XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: "#789e96", fontSize: 8 }} unit="°" /><YAxis type="category" dataKey="name" width={65} axisLine={false} tickLine={false} tick={{ fill: "#b7d1c7", fontSize: 8 }} /><Tooltip contentStyle={{ background: "#102a2b", border: "1px solid rgba(139,224,204,.28)", color: "#edf3e9", fontSize: 10 }} formatter={(value: number, _name: string, item) => [`平均 ${value.toFixed(2)} °C · ${item.payload.minimum.toFixed(2)}–${item.payload.maximum.toFixed(2)} °C`, `${item.payload.sample_count} 个网格`]} /><Bar dataKey="average" fill="#f0b266" radius={[0, 4, 4, 0]} maxBarSize={18} /></BarChart></ResponsiveContainer></div>
              </article>
            </div>}
            {dailyBriefingDashboard && <section className="daily-brief-section daily-brief-extremes"><h3>各近海数据最高值与最低值异常点</h3><div>{dailyBriefingDashboard.china_coastal_sst.map((item) => <article key={`sst-${item.name}`}><strong>{item.name} · 海温</strong><span className="maximum">最高 {item.maximum.toFixed(2)} °C（+{(item.maximum_anomaly ?? 0).toFixed(2)}）</span><span className="minimum">最低 {item.minimum.toFixed(2)} °C（{(item.minimum_anomaly ?? 0).toFixed(2)}）</span></article>)}{dailyBriefingDashboard.china_coastal_sea_state.map((item) => <article key={`current-${item.name}`}><strong>{item.name} · 表层流速{item.coverage_mode === "nearest_grid" ? "（最近网格）" : ""}</strong><span className="maximum">最高 {item.maximum.toFixed(3)} m/s（+{(item.maximum_anomaly ?? 0).toFixed(3)}）</span><span className="minimum">最低 {item.minimum.toFixed(3)} m/s（{(item.minimum_anomaly ?? 0).toFixed(3)}）</span></article>)}</div></section>}
            <div className="daily-brief-charts">
              <article className="daily-brief-chart-card">
                <header><div><span>{dailyBrief.argoWindowLabel}</span><h3>Argo 回传时间分布</h3></div><em>北京时间 · 按小时统计</em></header>
                <div className="daily-brief-chart">
                  {dailyBrief.argoHourly.length > 0 ? <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyBrief.argoHourly} margin={{ top: 12, right: 8, bottom: 0, left: -18 }}>
                      <defs>
                        <linearGradient id="dailyBriefHourlyGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#9be6d5" />
                          <stop offset="100%" stopColor="#4faea8" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(139, 224, 204, .10)" vertical={false} />
                      <XAxis dataKey="hour" axisLine={false} tickLine={false} tick={{ fill: "#789e96", fontSize: 8 }} />
                      <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "#789e96", fontSize: 8 }} />
                      <Tooltip contentStyle={{ background: "#102a2b", border: "1px solid rgba(139,224,204,.28)", color: "#edf3e9", fontSize: 10 }} formatter={(value: number) => [`${value} 条`, "Argo 回传"]} />
                      <Bar dataKey="count" fill="url(#dailyBriefHourlyGradient)" radius={[4, 4, 0, 0]} maxBarSize={30} />
                    </BarChart>
                  </ResponsiveContainer> : <span className="daily-brief-chart-empty">当前窗口暂未收到新的 Argo 回传</span>}
                </div>
                <footer><span>统计窗口：{dailyBrief.argoWindowRange}。</span></footer>
              </article>
              <article className="daily-brief-chart-card">
                <header><div><span>24小时现场实测</span><h3>Argo 近表层海温</h3></div><em>滚动24小时 · 0–10 dbar</em></header>
                <div className="daily-brief-chart argo-surface">
                  {dailyBrief.argoSurface.length > 0 ? <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyBrief.argoSurface} layout="vertical" margin={{ top: 6, right: 18, bottom: 0, left: 6 }}>
                      <defs>
                        <linearGradient id="dailyBriefArgoGradient" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#4faea8" />
                          <stop offset="100%" stopColor="#9be6d5" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(139, 224, 204, .08)" horizontal={false} />
                      <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: "#789e96", fontSize: 8 }} unit="°" />
                      <YAxis type="category" dataKey="platform" width={58} axisLine={false} tickLine={false} tick={{ fill: "#b7d1c7", fontSize: 8 }} />
                      <Tooltip contentStyle={{ background: "#102a2b", border: "1px solid rgba(139,224,204,.28)", color: "#edf3e9", fontSize: 10 }} formatter={(value: number, _name: string, item) => [`${value.toFixed(1)} °C · ${item.payload.pressure.toFixed(1)} dbar · ${formatBeijingTime(item.payload.observedAt)}`, item.payload.location]} />
                      <Bar dataKey="temperature" fill="url(#dailyBriefArgoGradient)" radius={[0, 4, 4, 0]} barSize={10} />
                    </BarChart>
                  </ResponsiveContainer> : <span className="daily-brief-chart-empty">过去24小时暂无 0–10 dbar 的 Argo 温度实测</span>}
                </div>
                <footer><span>每根柱代表一个浮标的最新近表层测量，不能直接当作全球平均海温。</span></footer>
              </article>
              {dailyBrief.sstCandidates.length > 0 && <article className="daily-brief-chart-card daily-brief-anomaly-chart">
                <header><div><span>重点位置</span><h3>海温偏差最大的候选</h3></div><em>相对同日邻近测点 · °C</em></header>
                <div className="daily-brief-chart coverage">
                  {dailyBrief.sstCandidates.length > 0 ? <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyBrief.sstCandidates} layout="vertical" margin={{ top: 6, right: 12, bottom: 0, left: 6 }}>
                      <CartesianGrid stroke="rgba(139, 224, 204, .08)" horizontal={false} />
                      <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: "#789e96", fontSize: 8 }} />
                      <YAxis type="category" dataKey="location" width={115} axisLine={false} tickLine={false} tick={{ fill: "#b7d1c7", fontSize: 8 }} />
                      <ReferenceLine x={0} stroke="rgba(237,243,233,.45)" />
                      <Tooltip contentStyle={{ background: "#102a2b", border: "1px solid rgba(139,224,204,.28)", color: "#edf3e9", fontSize: 10 }} formatter={(value: number, _name: string, item) => [`${value >= 0 ? "+" : ""}${value.toFixed(2)} °C · 可信度 ${item.payload.confidence}% · ${item.payload.observedAt}`, "邻近偏差"]} />
                      <Bar dataKey="deviation" radius={4} barSize={10}>
                        {dailyBrief.sstCandidates.map((item) => <Cell key={item.id} fill={item.deviation >= 0 ? "#ef9a69" : "#79cddd"} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer> : <span className="daily-brief-chart-empty">等待变量质量统计</span>}
                </div>
                <footer><span><i className="chart-key maximum" />偏高</span><span><i className="chart-key minimum" />偏低</span><span>优先显示偏差幅度最大的候选</span></footer>
              </article>}
            </div>
            <section className="daily-brief-section daily-brief-today-argo">
              <h3>{dailyBrief.argoWindowLabel} Argo 回传明细</h3>
              {dailyBrief.recentProfiles.length > 0 ? <div className="daily-brief-argo-grid">
                {dailyBrief.recentProfiles.map((profile) => <button type="button" className="daily-brief-argo-card" key={profile.latest_profile_id} onClick={() => onSelectArgoPlatform(profile.platform)} aria-label={`打开 Argo 浮标 ${profile.platform}`}>
                  <div><strong>浮标 {profile.platform}</strong><em>{profile.has_bgc ? "BGC-Argo" : "Core-Argo"}</em></div>
                  <span>{formatBeijingTime(profile.timestamp)}</span>
                  <p><MapPinned size={12} />{formatCoordinate([profile.longitude, profile.latitude])} · 周期 {profile.cycle}</p>
                </button>)}
              </div> : <p className="daily-brief-empty">截至当前北京时间，当前统计窗口没有新的 Argo 回传。</p>}
            </section>
            {dailyBriefingDashboard && <div className="daily-brief-detail-grid"><section className="daily-brief-section daily-weather-anomalies"><h3><Wind size={13} /> 异常风速、风浪与海流候选</h3>{dailyBriefingDashboard.weather_anomalies.length ? <div>{dailyBriefingDashboard.weather_anomalies.map((item) => <article key={item.id}><strong>{item.title}</strong><p>{item.summary}</p><span>{item.region} · 可信度 {Math.round(item.confidence * 100)}%</span></article>)}</div> : <p className="daily-brief-empty">当前没有可列出的风速、风浪或海流异常候选。</p>}</section><section className="daily-brief-section daily-ocean-news"><h3><Newspaper size={13} /> 今日海洋新闻</h3>{dailyBriefingDashboard.news.items.length ? <div>{dailyBriefingDashboard.news.items.map((item) => <a href={item.url} target="_blank" rel="noreferrer" key={item.url || item.title}><strong>{item.title}</strong><span>{item.source} · {formatBeijingTime(item.published_at)}</span><ExternalLink size={12} /></a>)}</div> : <p className="daily-brief-empty">今日白名单媒体暂未检索到海洋相关新闻。</p>}<footer>{dailyBriefingDashboard.news.is_today_complete ? "已取得当天15条" : `当天不足15条，当前展示 ${dailyBriefingDashboard.news.count} 条最新白名单媒体报道`}</footer></section></div>}
            <div className="daily-brief-detail-grid">
              <section className="daily-brief-section">
                <h3>当前24小时发生了什么</h3>
                {dailyBrief.eventItems.length > 0 ? <div className="daily-brief-events">
                  {dailyBrief.eventItems.map((event) => <article key={event.id}>
                    <div><span>{formatBeijingTime(event.source_updated_at ?? event.started_at)}</span><em>{event.validation_state === "observed" ? "实测记录" : "异常候选"}</em></div>
                    <strong>{event.title}</strong>
                    <p>{event.summary}</p>
                    <footer><span><MapPinned size={12} />{event.region || formatCoordinate(event.centroid)}</span><span><Radio size={12} />连续 {Math.max(1, event.consecutive_updates)} 次 · 可信度 {Math.round(event.confidence * 100)}%</span></footer>
                    <div className="daily-brief-action"><b>下一步：</b>{eventAction(event)}</div>
                  </article>)}
                </div> : <p className="daily-brief-empty">当前24小时尚无可列出的新观测事件或异常候选。</p>}
              </section>
              <section className="daily-brief-section daily-brief-evidence">
                <h3>观测证据</h3>
                <ul>{dailyBrief.evidence.slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul>
              </section>
            </div>
            <div className="daily-brief-notes">
              <span><Radio size={13} />{dailyBrief.networkText}</span>
              <span><Activity size={13} />{dailyBrief.argoWindowLabel} BGC 回传浮标 {dailyBrief.recentBgcCount} 个；Copernicus 使用 UTC 当日全量网格，Argo 使用透明标注的最新完整窗口。</span>
            </div>
        </section>}

        {tutorialOpen && <div className="explorer-story-panel" id="explorer-story-panel">
          <header className="explorer-story-panel-header">
            <div><span className="explorer-eyebrow"><GraduationCap size={13} /> 新手教程</span><h2>三步读懂一片海</h2><p>{conclusion}</p></div>
            <div className="explorer-context-line">
              <span><i className={candidate ? "signal-dot warm" : "signal-dot calm"} />{candidate ? "发现值得观察的变化" : "暂未确认重大异常"}</span>
              <span><Radio size={13} />{floatCount || "--"} 个浮标在观测</span>
              <span><BookOpen size={13} />{sourceCount || "--"} 个数据来源</span>
            </div>
          </header>
        <div className="explorer-story-grid">
          <section className="explorer-story-card explorer-story-actions">
            <header><span className="story-index">01</span><div><span className="story-label">从这里开始</span><h2>你想先探索什么？</h2></div></header>
            <div className="explorer-action-grid">
              <button type="button" onClick={() => onExplore("float")}><Radio size={17} /><span><b>看看最近的浮标</b><small>它在哪里？刚测到了什么？</small></span><ArrowRight size={15} /></button>
              <button type="button" onClick={() => onExplore("temperature")}><Droplets size={17} /><span><b>探索海温变化</b><small>海水哪里变暖或变冷？</small></span><ArrowRight size={15} /></button>
              <button type="button" onClick={() => onExplore("heatwave")}><Waves size={17} /><span><b>了解海洋热浪</b><small>一次高温就能叫热浪吗？</small></span><ArrowRight size={15} /></button>
              <button type="button" onClick={() => onExplore("literature")}><BookOpen size={17} /><span><b>查看实时文献</b><small>研究者怎样解释这些变化？</small></span><ArrowRight size={15} /></button>
            </div>
          </section>

          <section className="explorer-story-card explorer-story-map">
            <header><span className="story-index">02</span><div><span className="story-label">地图提示</span><h2>哪里有值得看的变化？</h2></div></header>
            <div className="story-map-legend">
              <div><i className="legend-float" /><span><b>彩色点</b><small>正在观测的浮标</small></span></div>
              <div><i className="legend-event" /><span><b>红色区域</b><small>异常候选或事件范围</small></span></div>
              <div><i className="legend-track" /><span><b>绿色轨迹</b><small>浮标最近移动路线</small></span></div>
            </div>
            <p className="story-tip"><MapPinned size={14} /> 点击任意海面，查看坐标、最近浮标和这个海域的真实名称。</p>
          </section>

          <section className="explorer-story-card explorer-story-evidence">
            <header><span className="story-index">03</span><div><span className="story-label">证据边界</span><h2>这些结论可靠吗？</h2></div></header>
            <div className="evidence-meter"><span style={{ width: `${Math.min(100, Math.max(12, Math.round((sourceCount / Math.max(1, sourceCount + 2)) * 100)))}%` }} /></div>
            <p>{confidenceText}</p>
            <button type="button" onClick={() => onExplore("literature")}><CircleHelp size={14} /> 查看证据与研究依据</button>
          </section>

          <section className="explorer-story-card explorer-story-knowledge">
            <header><span className="story-index">04</span><div><span className="story-label">海洋小课堂</span><h2>{knowledge.title}</h2></div></header>
            <div className="knowledge-card-body"><GraduationCap size={21} /><p>{knowledge.body}</p></div>
            <div className="knowledge-fact"><span>记住这一点</span><b>{knowledge.fact}</b></div>
            <button type="button" onClick={() => setKnowledgeIndex((index) => (index + 1) % KNOWLEDGE_CARDS.length)}><RefreshCw size={13} /> 换一个知识点</button>
          </section>
        </div>
        </div>}
      </section>
    </>
  );
});
