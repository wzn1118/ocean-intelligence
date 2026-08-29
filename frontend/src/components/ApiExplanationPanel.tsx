import { ExternalLink, MessageSquareText, RefreshCw } from "lucide-react";
import type { EventExplanation } from "../types";

interface ApiExplanationPanelProps {
  explanation: EventExplanation | null;
  loading: boolean;
  onRefresh: () => void;
  label?: string;
}

export function ApiExplanationPanel({ explanation, loading, onRefresh, label = "这条观测怎么读" }: ApiExplanationPanelProps) {
  return (
    <section className={loading ? "api-explanation loading" : "api-explanation"} aria-busy={loading}>
      <header>
        <span className="api-explanation-icon"><MessageSquareText size={17} /></span>
        <div><span>{label}</span><strong>{explanation?.headline ?? "正在整理观测信息"}</strong></div>
        <button type="button" onClick={onRefresh} disabled={loading} title="刷新说明" aria-label="刷新说明">
          <RefreshCw size={15} />
        </button>
      </header>
      {explanation ? (
        <>
          <p>{explanation.summary}</p>
          <ul>{explanation.findings.slice(0, 3).map((finding) => <li key={finding}>{finding}</li>)}</ul>
          <footer>
            <span>{explanation.provider === "external_api" ? "实时数据说明" : "依据实测数据"}</span>
            <span>{explanation.evidence_ids.length} 条原始记录</span>
            {explanation.source_links[0] && <a href={explanation.source_links[0]} target="_blank" rel="noreferrer">查看来源 <ExternalLink size={11} /></a>}
          </footer>
        </>
      ) : <span className="api-explanation-placeholder">正在读取测量值、时间和质量信息...</span>}
    </section>
  );
}
