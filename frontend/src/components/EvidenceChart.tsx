import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { unitLabel, variableLabel } from "../locale";
import type { Evidence } from "../types";

interface EvidenceChartProps {
  evidence: Evidence;
}

const VALUE_MODE_LABELS = {
  raw: "原始值",
  adjusted: "调整值",
  analysis: "格点分析值",
  derived: "派生值",
  scenario: "情景值",
} as const;

export function EvidenceChart({ evidence }: EvidenceChartProps) {
  const isObservation = evidence.validation_state === "observed";
  const values = evidence.series.flatMap((item) => [item.value, item.baseline]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max((max - min) * 0.18, Math.abs(max) * 0.01, 0.1);

  return (
    <article className="evidence-item">
      <div className="evidence-item-head">
        <div>
          <span className="evidence-id">{evidence.id}</span>
          <h4 title={evidence.variable}>{variableLabel(evidence.variable)}</h4>
        </div>
        <span className="confidence-tag">{Math.round(evidence.confidence * 100)}%</span>
      </div>
      <div className="evidence-reading">
        <strong>
          {evidence.observed} <small>{unitLabel(evidence.unit)}</small>
        </strong>
        <span className={isObservation ? "anomaly observation" : evidence.anomaly >= 0 ? "anomaly positive" : "anomaly negative"}>
          {isObservation ? "本轮代表值" : `较基线 ${evidence.anomaly >= 0 ? "+" : ""}${evidence.anomaly}`}
        </span>
      </div>
      <div className="sparkline">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={evidence.series} margin={{ top: 6, right: 2, bottom: 2, left: 2 }}>
            <YAxis domain={[min - padding, max + padding]} hide />
            <Tooltip
              contentStyle={{ background: "#171b1d", border: 0, borderRadius: 2, color: "white", fontSize: 12 }}
              labelFormatter={() => ""}
              formatter={(value: number, name: string) => [value.toFixed(2), name === "value" ? "观测值" : "基线"]}
            />
            <Line type="monotone" dataKey="baseline" stroke="#9a9d9a" strokeDasharray="4 4" dot={false} strokeWidth={1.3} />
            <Line type="monotone" dataKey="value" stroke="#d94d37" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="evidence-source">
        <span>{evidence.source}</span>
        <span>{evidence.method}</span>
        <span>
          样本 {evidence.sample_count}
          {evidence.spatial_peer_count != null ? ` · 空间邻居 ${evidence.spatial_peer_count}` : ""}
          {evidence.temporal_span_hours > 0 ? ` · 跨度 ${evidence.temporal_span_hours.toFixed(0)} 小时` : isObservation ? " · 区域抽样" : " · 单时次筛查"}
          {evidence.measurement_uncertainty != null ? ` · 分析误差 σ ${evidence.measurement_uncertainty.toFixed(2)} ${unitLabel(evidence.unit)}` : ""}
          {evidence.comparison_uncertainty != null ? ` · 差值合成 σ ${evidence.comparison_uncertainty.toFixed(2)} ${unitLabel(evidence.unit)}` : ""}
          {evidence.value_mode ? ` · ${VALUE_MODE_LABELS[evidence.value_mode]}` : ""}
        </span>
      </div>
    </article>
  );
}
