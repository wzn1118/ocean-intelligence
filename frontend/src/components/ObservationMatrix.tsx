import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleGauge,
  Clock3,
  Database,
  FlaskConical,
  Layers3,
  Radio,
  Ruler,
  Satellite,
  ScanSearch,
  ShieldCheck,
  Waves,
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
import type { ObservationVariableSummary, RegionalObservationSummary, SourceHealth } from "../types";

interface ObservationMatrixProps {
  summary: RegionalObservationSummary | null;
  sources: SourceHealth[];
  loading: boolean;
  error: string | null;
  noEvent?: boolean;
}

const MODE_LABELS = {
  raw: "原始值",
  adjusted: "调整值",
  mixed: "混合模式",
  analysis: "格点分析",
  unavailable: "未观测",
} as const;

const VARIABLE_COLORS: Record<ObservationVariableSummary["id"], string> = {
  SST: "#ef745b",
  TEMPERATURE: "#f0a56d",
  SALINITY: "#69d2c2",
  CHLA: "#bfd563",
  NITRATE: "#75b8df",
};

const percent = (value: number | null) => value == null ? "--" : `${Math.round(value * 100)}%`;
const valueText = (value: number | null, digits = 2) => value == null ? "--" : value.toFixed(digits);
const formatTime = (value: string | null) => {
  if (!value) return "未知";
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
const coordinate = (value: number, axis: "latitude" | "longitude") => {
  const suffix = axis === "latitude" ? (value >= 0 ? "N" : "S") : (value >= 0 ? "E" : "W");
  return `${Math.abs(value).toFixed(0)}°${suffix}`;
};

const ratioText = (numerator: number, denominator: number) =>
  denominator > 0 ? `${numerator.toLocaleString("zh-CN")} / ${denominator.toLocaleString("zh-CN")}` : "--";

function QualityRow({ label, value, meta, color }: { label: string; value: number | null; meta: string; color: string }) {
  return (
    <div className="observation-quality-row">
      <div><span>{label}</span><b>{percent(value)}</b></div>
      <div className="observation-quality-track"><i style={{ "--quality-width": `${(value ?? 0) * 100}%`, "--quality-color": color } as CSSProperties} /></div>
      <small>{meta}</small>
    </div>
  );
}

export function ObservationMatrix({ summary, sources, loading, error, noEvent = false }: ObservationMatrixProps) {
  const [selectedVariableId, setSelectedVariableId] = useState<ObservationVariableSummary["id"]>("SST");
  useEffect(() => setSelectedVariableId("SST"), [summary?.region_id]);

  const selectedVariable = useMemo(
    () => summary?.variables.find((variable) => variable.id === selectedVariableId) ?? summary?.variables[0] ?? null,
    [selectedVariableId, summary],
  );
  const liveSources = sources.filter((source) => source.category !== "interpretation");

  if (loading && !summary) {
    return (
      <div className="observation-matrix observation-matrix-loading" aria-busy="true">
        <i /><i /><i /><i />
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="observation-matrix observation-matrix-error" role="status">
        <Database size={20} />
        <strong>区域观测摘要未载入</strong>
        <span>{error ?? "等待实时数据包完成"}</span>
      </div>
    );
  }

  const [westSouth, eastNorth] = summary.bounds;
  const fleetBGC = summary.float_count > 0 ? summary.bgc_float_count / summary.float_count : null;

  return (
    <div className="observation-matrix" aria-label="区域多维观测概览">
      <header className="observation-matrix-header">
        <div>
          <span className="observation-kicker"><Activity size={13} /> REGIONAL OBSERVATORY / LIVE</span>
          <h2>区域观测概览</h2>
          <p>{summary.region}</p>
        </div>
        <div className="observation-update"><Clock3 size={13} /><span>最新观测</span><b>{formatTime(summary.latest_observation_at)}</b></div>
      </header>

      <section className="observation-context-band" aria-label="区域观测概况">
        <div><Satellite size={15} /><span>记录总量</span><b>{summary.observation_count.toLocaleString("zh-CN")}</b><small>{summary.source_count} 个实时源</small></div>
        <div><Radio size={15} /><span>活动浮标</span><b>{summary.float_count}</b><small>BGC {summary.bgc_float_count}</small></div>
        <div><Waves size={15} /><span>SST 时间轴</span><b>{summary.sst_daily_steps}</b><small>{summary.sst_lookback_days} 日窗口</small></div>
        <div><Ruler size={15} /><span>空间边界</span><b>{coordinate(westSouth[0], "longitude")}–{coordinate(eastNorth[0], "longitude")}</b><small>{coordinate(westSouth[1], "latitude")}–{coordinate(eastNorth[1], "latitude")}</small></div>
      </section>

      <section className={`observation-conclusion ${summary.conclusion.state}`} data-conclusion-state={summary.conclusion.state}>
        <header>
          <div>
            {summary.conclusion.state === "no_candidate" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <span>多维综合结论</span>
          </div>
          <b>{summary.conclusion.state === "no_candidate" ? "本轮未触发" : `${summary.screening_event_count} 个候选`}</b>
        </header>
        <h3>{summary.conclusion.headline}</h3>
        <p>{summary.conclusion.summary}</p>
        <div className="observation-conclusion-evidence">
          {summary.conclusion.evidence.map((item) => <div key={item}><i /><span>{item}</span></div>)}
        </div>
        <div className="observation-conclusion-constraints">
          <div>
            <span><ScanSearch size={13} /> 判读范围</span>
            <ul>{summary.conclusion.interpretation_scope.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
          <div>
            <span><ShieldCheck size={13} /> 筛查规则</span>
            <ul>{summary.conclusion.screening_rules.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
        </div>
        {noEvent && <small className="observation-queue-note">本轮事件队列为 0；以上为当前观测的实时筛查结果。</small>}
      </section>

      <section className="observation-timeline-section">
        <div className="observation-section-heading">
          <div><Waves size={15} /><span>七日海温带</span></div>
          <small>最小值 / 区域中位数 / 最大值 · °C</small>
        </div>
        <div className="observation-timeline-chart">
          {summary.sst_timeline.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={summary.sst_timeline} margin={{ top: 10, right: 8, bottom: 2, left: -22 }}>
                <CartesianGrid stroke="rgba(215, 229, 219, .10)" strokeDasharray="2 5" vertical={false} />
                <XAxis dataKey="timestamp" tickFormatter={(value: string) => value.slice(5, 10)} tick={{ fill: "#829a91", fontSize: 9 }} tickLine={false} axisLine={false} />
                <YAxis domain={["dataMin - 1", "dataMax + 1"]} tick={{ fill: "#829a91", fontSize: 9 }} tickLine={false} axisLine={false} />
                <Tooltip
                  labelFormatter={(value) => formatTime(String(value))}
                  formatter={(value: number, name: string) => [`${value.toFixed(2)} °C`, name === "median" ? "中位数" : name === "minimum" ? "最小值" : "最大值"]}
                  contentStyle={{ background: "#0d1716", border: "1px solid rgba(118, 207, 191, .28)", borderRadius: 0, color: "#eef3ea", fontSize: 11 }}
                />
                <Line type="monotone" dataKey="maximum" stroke="#9e4f42" strokeWidth={1} dot={false} strokeDasharray="3 3" />
                <Line type="monotone" dataKey="median" stroke="#ef745b" strokeWidth={2.2} dot={{ r: 2.5, fill: "#ef745b", strokeWidth: 0 }} />
                <Line type="monotone" dataKey="minimum" stroke="#4e9c9b" strokeWidth={1} dot={false} strokeDasharray="3 3" />
              </LineChart>
            </ResponsiveContainer>
          ) : <span className="observation-no-series">本轮时间序列点位：{summary.sst_timeline.length}</span>}
        </div>
        <div className="observation-timeline-foot">
          <span>最新网格 {summary.sst_latest_grid_count}</span>
          <span>质量通过 {summary.noaa_quality_valid_count}/{summary.noaa_point_count}</span>
          <span>{summary.quality_fields_complete ? "误差 / 水体 / 海冰字段完整" : "质量字段不完整"}</span>
        </div>
      </section>

      <section className="observation-variable-section">
        <div className="observation-section-heading">
          <div><FlaskConical size={15} /><span>变量剖面</span></div>
          <small>最近有效样本范围</small>
        </div>
        <div className="observation-variable-list" role="listbox" aria-label="选择观测变量">
          {summary.variables.map((variable) => {
            const selected = variable.id === selectedVariable?.id;
            return (
              <button
                type="button"
                role="option"
                aria-selected={selected}
                className={selected ? "selected" : ""}
                onClick={() => setSelectedVariableId(variable.id)}
                key={variable.id}
                style={{ "--variable-color": VARIABLE_COLORS[variable.id] } as CSSProperties}
              >
                <i />
                <span><b>{variable.label}</b><small>{variable.source}</small></span>
                <em>{valueText(variable.median, variable.id === "SALINITY" ? 3 : 2)} <small>{variable.unit}</small></em>
                <span className="observation-availability"><i style={{ width: `${(variable.availability_fraction ?? 0) * 100}%` }} /><small>{variable.available_count}/{variable.total_count}</small></span>
              </button>
            );
          })}
        </div>
        {selectedVariable && (
          <div className="observation-range-readout" style={{ "--variable-color": VARIABLE_COLORS[selectedVariable.id] } as CSSProperties}>
            <div><span>最小</span><b>{valueText(selectedVariable.minimum)}</b></div>
            <div className="median"><span>中位</span><b>{valueText(selectedVariable.median)}</b><small>{selectedVariable.unit}</small></div>
            <div><span>最大</span><b>{valueText(selectedVariable.maximum)}</b></div>
            <em>{MODE_LABELS[selectedVariable.value_mode]}</em>
          </div>
        )}
      </section>

      <section className="observation-quality-section">
        <div className="observation-section-heading">
          <div><CircleGauge size={15} /><span>质量与采样</span></div>
          <small>缺失保持未定义</small>
        </div>
        <QualityRow label="NOAA 质量通过" value={summary.noaa_quality_pass_fraction} meta={`${summary.noaa_quality_valid_count} / ${summary.noaa_point_count} 条`} color="#69d2c2" />
        <QualityRow label="完整剖面请求" value={summary.profile_success_fraction} meta={`${summary.sampled_profile_count} 成功 · ${summary.profile_request_failures} 失败`} color="#ef9f66" />
        <QualityRow label="调整值占比" value={summary.adjusted_surface_fraction} meta="近表层有效温盐/BGC 样本" color="#75b8df" />
        <QualityRow label="BGC 浮标占比" value={fleetBGC} meta={`${summary.bgc_float_count} / ${summary.float_count} 个活动浮标`} color="#bfd563" />
        <div className="observation-depth-band">
          <Layers3 size={16} />
          <div><span>抽样剖面典型深度</span><b>{valueText(summary.median_profile_depth, 0)} <small>dbar</small></b></div>
          <div><span>最深有效层</span><b>{valueText(summary.maximum_profile_depth, 0)} <small>dbar</small></b></div>
        </div>
        <div className="observation-quality-insights" aria-label="质量与采样补充指标">
          <div>
            <span>海温时间覆盖</span>
            <b>{summary.sst_daily_steps} / {summary.sst_lookback_days} 日</b>
            <small>
              {summary.sst_latest_grid_count.toLocaleString("zh-CN")} 个最新格点
              {summary.sst_latitude_step_degrees != null && summary.sst_longitude_step_degrees != null
                ? ` · ${summary.sst_latitude_step_degrees.toFixed(2)}°×${summary.sst_longitude_step_degrees.toFixed(2)}°`
                : ""}
            </small>
          </div>
          <div>
            <span>剖面抽样覆盖</span>
            <b>{ratioText(summary.sampled_profile_count, summary.float_count)}</b>
            <small>抽样完整剖面 / 活动浮标</small>
          </div>
          <div>
            <span>全量剖面目录</span>
            <b>{summary.argo_profile_count.toLocaleString("zh-CN")}</b>
            <small>时间窗内全部 Argo 剖面点位</small>
          </div>
          <div>
            <span>质量字段</span>
            <b className={summary.quality_fields_complete ? "quality-good" : "quality-warn"}>{summary.quality_fields_complete ? "完整" : "待补充"}</b>
            <small>误差 · 水体 · 海冰筛查</small>
          </div>
        </div>
        <div className="observation-variable-coverage" aria-label="各变量可用率">
          <div className="observation-coverage-heading"><span>变量可用率</span><small>可用记录 / 本轮样本</small></div>
          {summary.variables.map((variable) => (
            <div className="observation-coverage-row" key={variable.id} style={{ "--variable-color": VARIABLE_COLORS[variable.id] } as CSSProperties}>
              <span><i />{variable.label}</span>
              <div className="observation-coverage-track"><i style={{ width: `${(variable.availability_fraction ?? 0) * 100}%` }} /></div>
              <b>{percent(variable.availability_fraction)}</b>
              <small>{ratioText(variable.available_count, variable.total_count)} · {MODE_LABELS[variable.value_mode]}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="observation-source-section">
        <div className="observation-section-heading">
          <div><Database size={15} /><span>来源时效</span></div>
          <small>{liveSources.length} 条观测链路</small>
        </div>
        <div className="observation-source-list">
          {liveSources.map((source) => (
            <div key={source.id}>
              <i className={source.status} />
              <span><b>{source.name}</b><small>{formatTime(source.latest_observation_at)}</small></span>
              <em>{source.observation_count.toLocaleString("zh-CN")}</em>
            </div>
          ))}
        </div>
      </section>

      <footer className="observation-method-note">
        <CircleGauge size={14} />
        <span>区域统计来自当前实时包；Argo 范围仅代表抽样完整剖面，NOAA 时间带仅使用通过误差、水体与海冰过滤的格点。</span>
      </footer>
    </div>
  );
}
