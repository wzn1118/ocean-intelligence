import {
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  Clock3,
  Copy,
  Database,
  FileSearch,
  FileText,
  Filter,
  Layers3,
  LocateFixed,
  Orbit,
  RefreshCw,
} from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import {
  EVENT_LIFECYCLE_LABELS,
  EVENT_STATUS_LABELS,
  EVENT_VALIDATION_LABELS,
  SEVERITY_LABELS,
  formatDateTime,
  sourceLabel,
  variableLabel,
} from "../locale";
import type {
  EventExplanation,
  LiteratureReference,
  LiteratureSearchResponse,
  OceanEvent,
  RegionalObservationSummary,
  ScientificReference,
  ScientificReport,
  SourceHealth,
} from "../types";
import type { ExperienceMode } from "./ExplorerHome";
import { EvidenceChart } from "./EvidenceChart";
import { ArgoLivePanel } from "./ArgoLivePanel";
import { ApiExplanationPanel } from "./ApiExplanationPanel";
import { ObservationMatrix } from "./ObservationMatrix";
import type { ArgoEventCoverage, ArgoFloatSnapshot } from "../types";

export type DetailTab = "overview" | "evidence" | "report" | "literature" | "observations";

interface EventDetailProps {
  event: OceanEvent | null;
  report: ScientificReport | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  tab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  argoSnapshot: ArgoFloatSnapshot | null;
  argoCoverage: ArgoEventCoverage | null;
  argoLoading: boolean;
  argoError: string | null;
  argoDeferred: boolean;
  onSelectArgoPlatform: (platform: string) => void;
  explanation: EventExplanation | null;
  explanationLoading: boolean;
  onRefreshExplanation: () => void;
  literature: LiteratureSearchResponse | null;
  literatureLoading: boolean;
  literatureError: string | null;
  onRefreshLiterature: () => void;
  observationSummary: RegionalObservationSummary | null;
  observationSources: SourceHealth[];
  observationError: string | null;
  experienceMode?: ExperienceMode;
}

const TAB_LABELS: Record<DetailTab, string> = {
  overview: "概览",
  evidence: "证据",
  report: "研判报告",
  literature: "文献依据",
  observations: "观测概览",
};

export const EventDetail = memo(function EventDetail({ event, report, loading, error, onRetry, tab, onTabChange, argoSnapshot, argoCoverage, argoLoading, argoError, argoDeferred, onSelectArgoPlatform, explanation, explanationLoading, onRefreshExplanation, literature, literatureLoading, literatureError, onRefreshLiterature, observationSummary, observationSources, observationError, experienceMode = "explorer" }: EventDetailProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const [activeVariable, setActiveVariable] = useState("all");
  const [focusedReferenceId, setFocusedReferenceId] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const focusTimer = useRef<number | null>(null);

  useEffect(() => {
    setActiveVariable("all");
    setFocusedReferenceId(null);
  }, [event?.id]);

  useEffect(() => () => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    if (focusTimer.current) window.clearTimeout(focusTimer.current);
  }, []);

  if (!event) {
    if (error) {
      return (
        <aside className="detail-panel detail-error-panel" aria-busy="false">
          <AlertTriangle size={22} />
          <strong>数据详情暂未载入</strong>
          <p>{error}</p>
          <button type="button" onClick={onRetry}><RefreshCw size={15} />重新加载</button>
        </aside>
      );
    }
    if (!loading) {
      return (
        <aside className="detail-panel detail-observation-panel" aria-busy="false">
          <ObservationMatrix summary={observationSummary} sources={observationSources} loading={false} error={observationError} noEvent />
        </aside>
      );
    }
    return (
      <aside className="detail-panel loading-panel" aria-busy="true">
        <span className="loader-line" />
        <span className="loader-line short" />
        <span className="loader-block" />
      </aside>
    );
  }

  const isObservation = event.event_kind === "observation";
  const affectedAreaKm2 = event.affected_area_km2;

  const showNotice = (message: string) => {
    setNotice(message);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 1800);
  };

  const copySummary = async () => {
    const summary = isObservation
      ? `${event.title}\n${event.region}\n${event.summary}\n实测数据 · 数据可信度 ${Math.round(event.confidence * 100)}%`
      : `${event.title}\n${event.region}\n${event.summary}\n严重度 ${Math.round(event.severity * 100)}/100 · 置信度 ${Math.round(event.confidence * 100)}%`;
    await navigator.clipboard.writeText(summary);
    showNotice(isObservation ? "观测摘要已复制" : "事件摘要已复制");
  };

  const copyReference = async (reference: ScientificReference | LiteratureReference) => {
    const doi = reference.doi ? ` https://doi.org/${reference.doi}` : "";
    await navigator.clipboard.writeText(`${reference.citation}${doi}`);
    showNotice(`${reference.id} 引文已复制`);
  };

  const openReference = (referenceId: string) => {
    setActiveVariable("all");
    setFocusedReferenceId(referenceId);
    onTabChange("literature");
    window.setTimeout(() => {
      document.getElementById(`reference-${referenceId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    if (focusTimer.current) window.clearTimeout(focusTimer.current);
    focusTimer.current = window.setTimeout(() => setFocusedReferenceId(null), 2400);
  };

  const realtimeReferences = literature?.results ?? [];
  const referenceVariables = Array.from(new Set(realtimeReferences.flatMap((reference) => reference.variables))).sort();
  const filteredReferences = activeVariable === "all"
    ? realtimeReferences
    : realtimeReferences.filter((reference) => reference.variables.includes(activeVariable));

  return (
    <aside className={loading ? "detail-panel detail-updating" : "detail-panel"} aria-busy={loading}>
      {loading && <span className="detail-loading-bar" />}
      {error && (
        <div className="detail-inline-error" role="status">
          <AlertTriangle size={15} />
          <span>{error}</span>
          <button type="button" onClick={onRetry} title={isObservation ? "重新加载观测详情" : "重新加载事件详情"} aria-label={isObservation ? "重新加载观测详情" : "重新加载事件详情"}><RefreshCw size={14} /></button>
        </div>
      )}
      <div className="detail-title-block">
        <div className="detail-quick-actions">
          <button type="button" onClick={() => onTabChange("evidence")} title="查看证据" aria-label="查看证据"><FileSearch size={15} /></button>
          <button type="button" onClick={copySummary} title={isObservation ? "复制观测摘要" : "复制事件摘要"} aria-label={isObservation ? "复制观测摘要" : "复制事件摘要"}><Copy size={15} /></button>
          <button type="button" onClick={() => onTabChange("report")} title="查看研判报告" aria-label="查看研判报告"><FileText size={15} /></button>
        </div>
        <div className="detail-kicker">
          <span className={`status-dot ${event.status}`} />
          {isObservation ? "海洋实测数据" : `${EVENT_STATUS_LABELS[event.status]} / ${SEVERITY_LABELS[event.severity_label] ?? event.severity_label}`}
          <span className={`validation-badge ${event.validation_state}`}>{EVENT_VALIDATION_LABELS[event.validation_state]}</span>
          {!isObservation && event.lifecycle_state ? (
            <span
              className={`lifecycle-badge ${event.lifecycle_state}`}
              title={`首次检出 ${event.first_detected_at ? formatDateTime(event.first_detected_at) : "本轮"}；连续 ${event.consecutive_updates} 轮`}
            >
              {EVENT_LIFECYCLE_LABELS[event.lifecycle_state]} · 第 {event.lifecycle_revision} 版
            </span>
          ) : null}
          <span className="detail-event-id">{isObservation ? formatDateTime(event.started_at) : event.id}</span>
        </div>
        <h1>{event.title}</h1>
        <p>{event.summary}</p>
        <div className="detail-location">
          <LocateFixed size={15} />
          <span>{event.region}</span>
          <span>{event.centroid[1] >= 0 ? "北纬" : "南纬"} {Math.abs(event.centroid[1]).toFixed(1)}°</span>
          <span>{event.centroid[0] >= 0 ? "东经" : "西经"} {Math.abs(event.centroid[0]).toFixed(1)}°</span>
        </div>
        <div className="source-strip" aria-label={isObservation ? "观测数据来源" : "事件数据来源"}>
          {event.sources.map((source) => <span key={source}>{sourceLabel(source)}</span>)}
        </div>
      </div>

      <div className="detail-tabs" role="tablist" aria-label={isObservation ? "观测详情视图" : "事件详情视图"}>
        {(["overview", "evidence", "report", "literature", "observations"] as DetailTab[]).map((item) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === item}
            aria-controls="event-detail-content"
            className={tab === item ? "active" : ""}
            onClick={() => onTabChange(item)}
            key={item}
          >
            {TAB_LABELS[item]}
          </button>
        ))}
      </div>

      <div className="detail-scroll" id="event-detail-content" role="tabpanel">
        {tab === "overview" && (
          <div className="detail-section-stack">
            {experienceMode === "explorer" && (
              <section className="understand-card-grid" aria-label="看懂这件事">
                <article><span>01</span><h3>发生了什么？</h3><p>{event.summary}</p></article>
                <article><span>02</span><h3>为什么值得关注？</h3><p>{event.potential_impacts[0] ?? "它可能反映海水状态正在发生变化，值得结合更多观测继续观察。"}</p></article>
                <article><span>03</span><h3>我们怎么知道？</h3><p>{event.sources.length > 0 ? `${event.sources.map(sourceLabel).join("、")} 提供了观测支持。` : "来自当前事件的观测记录和实时数据源。"}</p></article>
                <article><span>04</span><h3>目前还不能确定什么？</h3><p>{event.uncertainty || "单个点位或短时间变化不能代表整个海域，需要更多数据确认范围和持续时间。"}</p></article>
              </section>
            )}
            <section className="metric-band">
              {isObservation ? (
                <>
                  <div><span>数据类型</span><strong>实测</strong><small>已质检</small></div>
                  <div><span>数据可信度</span><strong>{Math.round(event.confidence * 100)}</strong><small>%</small></div>
                  <div><span>同类记录</span><strong>{event.observation_count.toLocaleString("zh-CN")}</strong><small>条</small></div>
                </>
              ) : (
                <>
                  <div><span>严重度</span><strong>{Math.round(event.severity * 100)}</strong><small>/100</small></div>
                  <div><span>{event.validation_state === "screening" ? "筛查置信度" : "置信度"}</span><strong>{Math.round(event.confidence * 100)}</strong><small>%</small></div>
                  <div><span>影响面积</span>{affectedAreaKm2 == null ? <><strong>筛查中</strong><small>候选范围</small></> : <><strong>{Math.round(affectedAreaKm2 / 1000)}</strong><small>千平方公里</small></>}</div>
                </>
              )}
            </section>

            <ApiExplanationPanel explanation={explanation} loading={explanationLoading} onRefresh={onRefreshExplanation} label={isObservation ? "这条观测怎么读" : "这个事件怎么读"} />

            <ArgoLivePanel
              snapshot={argoSnapshot}
              coverage={argoCoverage}
              loading={argoLoading}
              error={argoError}
              deferred={argoDeferred}
              onSelectPlatform={onSelectArgoPlatform}
              mode={experienceMode}
            />

            <section>
              <div className="section-label"><Orbit size={16} /> {isObservation ? "怎么看这条数据" : "科学推理"}</div>
              <div className="reasoning-chain">
                {event.reasoning_chain.map((step) => (
                  <article className="reasoning-step" key={step.order}>
                    <span className="step-index">0{step.order}</span>
                    <div>
                      <h3>{step.claim}</h3>
                      <p>{step.mechanism}</p>
                      <div className="evidence-links">
                        {step.evidence_ids.map((id) => <span key={id}>{id}</span>)}
                        <b>置信度 {Math.round(step.confidence * 100)}%</b>
                      </div>
                      <div className="reasoning-reference-links" aria-label="支持该推理步骤的文献">
                        <span>文献</span>
                        {step.reference_ids.map((id) => (
                          <button type="button" key={id} onClick={() => openReference(id)} title={`查看 ${id}`}>
                            <BookOpen size={12} />{id}
                          </button>
                        ))}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section>
              <div className="section-label"><Clock3 size={16} /> {isObservation ? "记录时间" : "事件时间线"}</div>
              <div className="timeline">
                {event.timeline.map((item) => (
                  <div className={`timeline-item ${item.state}`} key={`${item.timestamp}-${item.label}`}>
                    <span />
                    <div><strong>{item.label}</strong><small>{formatDateTime(item.timestamp)}</small></div>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="section-label"><AlertTriangle size={16} /> {isObservation ? "可以用来做什么" : "潜在影响"}</div>
              <ul className="impact-list">{event.potential_impacts.map((impact) => <li key={impact}>{impact}</li>)}</ul>
            </section>
          </div>
        )}

        {tab === "evidence" && (
          <div className="detail-section-stack evidence-stack">
            <div className="evidence-summary-line">
              <Database size={17} />
              <span>{event.evidence.length} 条{isObservation ? "原始测量记录" : event.validation_state === "confirmed" ? "已验证信号" : "筛查证据记录"}</span>
              <span>{event.sources.length} 个数据来源</span>
            </div>
            {event.evidence.map((item) => <EvidenceChart evidence={item} key={item.id} />)}
            <section className="uncertainty-block">
              <div className="section-label"><Layers3 size={16} /> {isObservation ? "这条数据代表什么" : "已知不确定性"}</div>
              <p>{event.uncertainty}</p>
            </section>
          </div>
        )}

        {tab === "report" && report && (
          <article className="scientific-report">
            <header>
              <FileText size={19} />
              <div><span>{isObservation ? "观测记录报告" : "事件研判报告"}</span><h2>{report.title}</h2></div>
              <span className="report-confidence">{Math.round(report.confidence * 100)}%</span>
            </header>
            <section><h3>{isObservation ? "这条记录说明什么" : "综合评估"}</h3><p>{report.executive_summary}</p></section>
            <section><h3>{isObservation ? "数据概况" : "事件态势"}</h3><p>{report.situation}</p></section>
            <section><h3>{isObservation ? "数据依据" : "证据评估"}</h3><ol>{report.evidence_assessment.map((item) => <li key={item}>{item}</li>)}</ol></section>
            <section><h3>{isObservation ? "判断方式" : "作用机制"}</h3><ol>{report.mechanism.map((item) => <li key={item}>{item}</li>)}</ol></section>
            <section className="uncertainty-callout"><AlertTriangle size={16} /><div><h3>{isObservation ? "适用范围" : "不确定性"}</h3><p>{report.uncertainty}</p></div></section>
            <section><h3>{isObservation ? "如何持续更新" : "监测建议"}</h3><ul>{report.monitoring_actions.map((item) => <li key={item}><CheckCircle2 size={15} />{item}</li>)}</ul></section>
            <footer>
              <span>生成于 {formatDateTime(report.generated_at)}</span>
              <span>{report.evidence_ids.length} 条证据引用 <ArrowUpRight size={13} /></span>
            </footer>
          </article>
        )}

        {tab === "literature" && (
          <div className="detail-section-stack literature-stack">
            <div className="literature-intro">
              <BookOpen size={18} />
              <div><strong>实时文献检索</strong><p>依据当前海洋信息的海域、事件类型和观测变量动态查询学术元数据。</p></div>
              <span>{literatureLoading ? "检索中" : `${literature?.total ?? 0} 篇结果`}</span>
            </div>
            <div className="literature-live-meta" aria-live="polite">
              <span><Database size={13} /> {literature ? `实时来源 ${literature.provider}` : "正在连接文献 API"}</span>
              {literature && <time dateTime={literature.searched_at}>{formatDateTime(literature.searched_at)}</time>}
              {literature?.cached && <b>短时缓存</b>}
              <button
                type="button"
                onClick={onRefreshLiterature}
                disabled={literatureLoading}
                title="绕过缓存，重新检索文献 API"
                aria-label="重新实时检索文献"
              >
                <RefreshCw size={15} className={literatureLoading ? "spinning" : ""} />
              </button>
            </div>
            {literature?.query && <div className="literature-query"><span>本次检索词</span><code>{literature.query}</code></div>}
            {literatureError && (
              <div className="literature-fetch-error" role="alert">
                <AlertTriangle size={15} />
                <span>{literatureError}</span>
                <button type="button" onClick={onRefreshLiterature}>重试</button>
              </div>
            )}
            {literatureLoading && !literature && (
              <div className="literature-loading" aria-busy="true">
                <RefreshCw size={18} className="spinning" />
                <span>正在根据事件上下文检索 OpenAlex / Crossref...</span>
              </div>
            )}
            {literature && (
              <>
                <div className="literature-toolbar">
                  <span><Filter size={13} /> 变量</span>
                  <div className="literature-filters" role="group" aria-label="按变量筛选实时文献">
                    {(["all", ...referenceVariables]).map((variable) => (
                      <button
                        type="button"
                        className={activeVariable === variable ? "active" : ""}
                        aria-pressed={activeVariable === variable}
                        onClick={() => setActiveVariable(variable)}
                        key={variable}
                      >
                        {variable === "all" ? "全部" : variableLabel(variable)}
                      </button>
                    ))}
                  </div>
                  <small>显示 {filteredReferences.length} 篇</small>
                </div>
                <div className="literature-list">
                  {filteredReferences.map((reference) => (
                    <article
                      className={focusedReferenceId === reference.id ? "literature-item focused" : "literature-item"}
                      id={`reference-${reference.id}`}
                      key={reference.id}
                    >
                      <div className="literature-item-head">
                        <span className="literature-id">{reference.provider} 实时结果</span>
                        <span className="literature-year">{reference.year}</span>
                      </div>
                      <h3>{reference.title}</h3>
                      <p className="literature-citation">{reference.citation}</p>
                      <div className="literature-source-meta">
                        <span>{reference.journal || "未标注期刊"}</span>
                        <span>被引 {reference.cited_by_count} 次</span>
                        {reference.open_access && <b>开放获取</b>}
                      </div>
                      <p>{reference.relevance}</p>
                      <div className="literature-meta">
                        <div className="literature-variables">{reference.variables.map((variable) => <span key={variable}>{variableLabel(variable)}</span>)}</div>
                        <div className="reference-actions">
                          <button type="button" onClick={() => copyReference(reference)} title="复制引文" aria-label={`复制引文 ${reference.title}`}><Copy size={13} /></button>
                          {reference.url || reference.doi ? (
                            <a href={reference.url ?? `https://doi.org/${reference.doi}`} target="_blank" rel="noreferrer" className="doi-link">打开论文 <ArrowUpRight size={13} /></a>
                          ) : <span className="doi-unavailable">暂无链接</span>}
                        </div>
                      </div>
                    </article>
                  ))}
                  {filteredReferences.length === 0 && (
                    <div className="literature-empty"><FileSearch size={18} /><span>本次实时检索未返回可展示的论文。</span></div>
                  )}
                </div>
              </>
            )}
            <div className="literature-note">
              <span>实时性与可追溯性</span>
              <p>内容来自当前事件触发的在线 API 查询，短时缓存仅用于控制外部接口频率；点击刷新图标可绕过缓存重新检索。检索结果是相关研究线索，不等同于对本次观测事件的直接证明。</p>
            </div>
          </div>
        )}

        {tab === "observations" && (
          <ObservationMatrix summary={observationSummary} sources={observationSources} loading={loading} error={observationError} />
        )}
      </div>
      {notice && <div className="copy-confirmation" role="status">{notice}</div>}
    </aside>
  );
});
