import {
  Activity,
  Archive,
  Bot,
  Brain,
  ChevronRight,
  CircleDot,
  Clock3,
  Code2,
  Database,
  FileSearch,
  Gauge,
  History,
  Link2,
  LoaderCircle,
  MessageSquare,
  Microscope,
  Network,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Waves,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { oceanApi } from "../api";
import { CodexAgentSurface } from "./CodexAgentSurface";
import type {
  AgentCitation,
  AgentContextManifest,
  AgentMemory,
  AgentQueryPlan,
  AgentRuntimeProfile,
  AgentSession,
  AgentStoredMessage,
  OceanRegion,
} from "../types";

interface DataAgentWorkspaceProps {
  open: boolean;
  region: OceanRegion;
  selectedEventId: string | null;
  onClose: () => void;
  onSelectEvent: (eventId: string) => void;
}

type AgentView = "chat" | "history" | "memory";

interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: AgentCitation[];
  provider?: "local_retrieval" | "external_model" | null;
  model?: string | null;
  retrievedRecordCount?: number;
  followUps?: string[];
  notes?: string[];
  queryPlan?: AgentQueryPlan | null;
  runtimeProfile?: AgentRuntimeProfile | null;
}

const STARTERS = [
  { label: "实时扫描", question: "最近 24 小时有哪些新观测？", detail: "按时间与来源核对最新记录" },
  { label: "证据复核", question: "当前异常候选依据是什么？", detail: "区分候选、观测与确认事件" },
  { label: "覆盖审计", question: "叶绿素和营养盐数据有多少？", detail: "检查变量规模、时段与空缺" },
  { label: "管线诊断", question: "各数据源现在是否正常？", detail: "核验更新时间和数据可用性" },
];

const RESEARCH_STAGES = [
  { label: "理解范围", detail: "识别意图、变量与时间" },
  { label: "检索索引", detail: "召回高相关记录" },
  { label: "制定计划", detail: "组织证据核验路径" },
  { label: "模型推理", detail: "比较事实与推断" },
  { label: "科学校验", detail: "检查措辞与证据边界" },
  { label: "生成回复", detail: "结论、证据、边界、下一步" },
];

const MEMORY_LABELS: Record<AgentMemory["kind"], string> = {
  preference: "偏好",
  instruction: "指令",
  focus: "关注点",
};

const RUNTIME_NODE_LABELS: Record<string, string> = {
  scope: "理解范围",
  retrieve: "检索索引",
  plan: "制定计划",
  reason: "模型推理",
  verify: "科学校验",
  respond: "生成回复",
};

const readableAgentNote = (note: string) => {
  if (/外部模型本次未响应|HTTPError\s+HTTP\s+\d+/iu.test(note)) {
    return "外部模型连接暂时不稳定，本轮已由本地证据引擎完成；系统会自动恢复探测。";
  }
  return note;
};

const formatTime = (value: string | null) => {
  if (!value) return "暂无时间";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
};

const historyGroup = (value: string | null) => {
  if (!value) return "较早";
  const date = new Date(value);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (day === start) return "今天";
  if (day === start - 86_400_000) return "昨天";
  if (day >= start - 6 * 86_400_000) return "最近 7 天";
  return "较早";
};

const storedToUi = (message: AgentStoredMessage): UiMessage => ({
  id: message.id,
  role: message.role,
  content: message.content,
  citations: message.citations,
  provider: message.provider,
  model: message.model,
  retrievedRecordCount: message.retrieved_record_count,
  queryPlan: message.query_plan,
  runtimeProfile: message.runtime_profile,
  notes: message.notes,
});

export function DataAgentWorkspace({
  open,
  region,
  selectedEventId,
  onClose,
  onSelectEvent,
}: DataAgentWorkspaceProps) {
  const [surface, setSurface] = useState<"codex" | "science">("codex");
  const [view, setView] = useState<AgentView>("chat");
  const [context, setContext] = useState<AgentContextManifest | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [memories, setMemories] = useState<AgentMemory[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [memoryDraft, setMemoryDraft] = useState("");
  const [analysisMode, setAnalysisMode] = useState<"quick" | "research">("research");
  const [thinkingStep, setThinkingStep] = useState(0);
  const [loadingContext, setLoadingContext] = useState(false);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [sending, setSending] = useState(false);
  const [mutating, setMutating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const contextRequestRef = useRef<AbortController | null>(null);
  const chatRequestRef = useRef<AbortController | null>(null);

  const loadContext = useCallback(async () => {
    const controller = new AbortController();
    contextRequestRef.current?.abort();
    contextRequestRef.current = controller;
    setLoadingContext(true);
    setError(null);
    try {
      setContext(await oceanApi.agentContext(region.id, controller.signal));
    } catch (loadError) {
      if ((loadError as Error).name !== "AbortError") {
        setError(loadError instanceof Error ? loadError.message : "上下文索引读取失败");
      }
    } finally {
      if (!controller.signal.aborted) setLoadingContext(false);
    }
  }, [region.id]);

  const loadLibrary = useCallback(async () => {
    setLoadingLibrary(true);
    try {
      const [nextSessions, nextMemories] = await Promise.all([
        oceanApi.agentSessions(region.id),
        oceanApi.agentMemories(region.id),
      ]);
      setSessions(nextSessions);
      setMemories(nextMemories);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "会话与记忆读取失败");
    } finally {
      setLoadingLibrary(false);
    }
  }, [region.id]);

  useEffect(() => {
    if (!open || surface !== "science") return undefined;
    void loadContext();
    void loadLibrary();
    const timeout = window.setTimeout(() => textareaRef.current?.focus(), 120);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [loadContext, loadLibrary, onClose, open, surface]);

  useEffect(() => {
    setMessages([]);
    setActiveSessionId(null);
    setView("chat");
  }, [region.id]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => {
    if (!sending) {
      setThinkingStep(0);
      return undefined;
    }
    const timer = window.setInterval(() => {
      setThinkingStep((current) => Math.min(RESEARCH_STAGES.length - 1, current + 1));
    }, analysisMode === "research" ? 2200 : 1100);
    return () => window.clearInterval(timer);
  }, [analysisMode, sending]);

  useEffect(() => () => {
    contextRequestRef.current?.abort();
    chatRequestRef.current?.abort();
  }, []);

  const variableRows = useMemo(
    () => Object.entries(context?.variable_counts ?? {}).sort((a, b) => b[1] - a[1]),
    [context],
  );

  const groupedSessions = useMemo(() => {
    const groups = new Map<string, AgentSession[]>();
    sessions.forEach((session) => {
      const group = historyGroup(session.last_message_at ?? session.updated_at);
      groups.set(group, [...(groups.get(group) ?? []), session]);
    });
    return [...groups.entries()];
  }, [sessions]);

  const startNewConversation = useCallback(() => {
    setActiveSessionId(null);
    setMessages([]);
    setDraft("");
    setError(null);
    setView("chat");
    window.setTimeout(() => textareaRef.current?.focus(), 60);
  }, []);

  const openSession = useCallback(async (sessionId: string) => {
    setLoadingLibrary(true);
    setError(null);
    try {
      const detail = await oceanApi.agentSession(sessionId);
      setActiveSessionId(detail.id);
      setMessages(detail.messages.map(storedToUi));
      setView("chat");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "历史会话读取失败");
    } finally {
      setLoadingLibrary(false);
    }
  }, []);

  const sendQuestion = useCallback(async (question: string) => {
    const normalized = question.trim();
    if (!normalized || sending) return;
    const userMessage: UiMessage = { id: `user-${Date.now()}`, role: "user", content: normalized };
    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setSending(true);
    setError(null);
    setView("chat");
    const controller = new AbortController();
    chatRequestRef.current?.abort();
    chatRequestRef.current = controller;
    try {
      const response = await oceanApi.agentChat({
        region_id: region.id,
        question: normalized,
        selected_event_id: selectedEventId,
        session_id: activeSessionId,
        remember: true,
        analysis_mode: analysisMode,
      }, controller.signal);
      setContext(response.context);
      if (response.session) setActiveSessionId(response.session.id);
      setMessages((current) => [...current, {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: response.answer,
        citations: response.citations,
        provider: response.provider,
        model: response.model,
        retrievedRecordCount: response.retrieved_record_count,
        followUps: response.follow_up_questions,
        notes: response.notes,
        queryPlan: response.query_plan,
        runtimeProfile: response.runtime_profile,
      }]);
      await loadLibrary();
    } catch (sendError) {
      if ((sendError as Error).name !== "AbortError") {
        setMessages((current) => current.filter((message) => message.id !== userMessage.id));
        setError(sendError instanceof Error ? sendError.message : "Agent 回答失败");
      }
    } finally {
      if (chatRequestRef.current === controller) setSending(false);
    }
  }, [activeSessionId, analysisMode, loadLibrary, region.id, selectedEventId, sending]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void sendQuestion(draft);
  };

  const archiveSession = useCallback(async (sessionId: string) => {
    setMutating(sessionId);
    try {
      await oceanApi.updateAgentSession(sessionId, { archived: true });
      if (activeSessionId === sessionId) startNewConversation();
      await loadLibrary();
    } finally {
      setMutating(null);
    }
  }, [activeSessionId, loadLibrary, startNewConversation]);

  const deleteSession = useCallback(async (sessionId: string) => {
    setMutating(sessionId);
    try {
      await oceanApi.deleteAgentSession(sessionId);
      if (activeSessionId === sessionId) startNewConversation();
      await loadLibrary();
    } finally {
      setMutating(null);
    }
  }, [activeSessionId, loadLibrary, startNewConversation]);

  const addMemory = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    const content = memoryDraft.trim();
    if (!content) return;
    setMutating("memory-new");
    try {
      await oceanApi.createAgentMemory({ kind: "preference", content, region_id: region.id });
      setMemoryDraft("");
      await loadLibrary();
    } finally {
      setMutating(null);
    }
  }, [loadLibrary, memoryDraft, region.id]);

  const toggleMemory = useCallback(async (memory: AgentMemory) => {
    setMutating(memory.id);
    try {
      await oceanApi.updateAgentMemory(memory.id, { enabled: !memory.enabled });
      await loadLibrary();
    } finally {
      setMutating(null);
    }
  }, [loadLibrary]);

  const deleteMemory = useCallback(async (memoryId: string) => {
    setMutating(memoryId);
    try {
      await oceanApi.deleteAgentMemory(memoryId);
      await loadLibrary();
    } finally {
      setMutating(null);
    }
  }, [loadLibrary]);

  if (!open) return null;

  const modelRuntimeStatus = context?.model_status
    ?? (context?.answer_engine === "external_model" ? "available" : "unconfigured");
  const modelStatusText = loadingContext
    ? "正在同步索引"
    : modelRuntimeStatus === "cooldown"
      ? `模型冷却 ${context?.model_retry_after_seconds ?? 0}s`
      : context
        ? `已索引 ${context.record_count.toLocaleString("zh-CN")} 条`
        : "等待索引";
  const modelLabel = modelRuntimeStatus === "available"
    ? context?.external_model || context?.model || "外部模型"
    : modelRuntimeStatus === "cooldown"
      ? "本地证据 · 自动恢复"
      : "本地数据检索";

  if (surface === "codex") {
    return (
      <CodexAgentSurface
        region={region}
        selectedEventId={selectedEventId}
        onClose={onClose}
        onUseScienceFlow={() => setSurface("science")}
      />
    );
  }

  return (
    <div className="data-agent-layer" role="presentation">
      <section className="data-agent-workspace" role="dialog" aria-modal="true" aria-labelledby="data-agent-title">
        <header className="data-agent-header">
          <div className="data-agent-identity">
            <span className="data-agent-mark"><Bot size={22} /></span>
            <div>
              <span>LANGGRAPH / OPENQI / DURABLE RESEARCH</span>
              <h2 id="data-agent-title">海洋研究 Agent</h2>
            </div>
          </div>
          <nav className="data-agent-nav" aria-label="Agent 工作区视图">
            <button type="button" onClick={() => setSurface("codex")}><Code2 size={15} />Codex</button>
            <button type="button" className={view === "chat" ? "active" : ""} onClick={() => setView("chat")}><MessageSquare size={15} />对话</button>
            <button type="button" className={view === "history" ? "active" : ""} onClick={() => setView("history")}><History size={15} />历史<span>{sessions.length}</span></button>
            <button type="button" className={view === "memory" ? "active" : ""} onClick={() => setView("memory")}><Brain size={15} />记忆<span>{memories.filter((item) => item.enabled).length}</span></button>
          </nav>
          <div className="data-agent-status" aria-label="Agent 上下文状态">
            <i className={loadingContext ? "loading" : modelRuntimeStatus} />
            <span>{modelStatusText}</span>
            {context && <b>{modelLabel}</b>}
          </div>
          <div className="data-agent-actions">
            <button type="button" title="刷新" aria-label="刷新 Agent 数据" onClick={() => { void loadContext(); void loadLibrary(); }} disabled={loadingContext || loadingLibrary}>
              <RefreshCw size={17} className={loadingContext || loadingLibrary ? "spin" : ""} />
            </button>
            <button type="button" title="新对话" aria-label="开始新对话" onClick={startNewConversation}>
              <Plus size={18} />
            </button>
            <button type="button" title="关闭" aria-label="关闭海洋数据 Agent" onClick={onClose}>
              <X size={19} />
            </button>
          </div>
        </header>

        <div className="data-agent-body">
          <aside className="data-agent-index" aria-label="Agent 上下文目录">
            <div className="agent-index-heading">
              <Database size={16} />
              <div><span>上下文目录</span><strong>{context?.region ?? region.name}</strong></div>
            </div>
            <dl className="agent-index-stats">
              <div><dt>全部记录</dt><dd>{context?.record_count.toLocaleString("zh-CN") ?? "—"}</dd></div>
              <div><dt>普通观测</dt><dd>{context?.observation_count.toLocaleString("zh-CN") ?? "—"}</dd></div>
              <div><dt>异常候选</dt><dd>{context?.candidate_count.toLocaleString("zh-CN") ?? "—"}</dd></div>
              <div><dt>数据来源</dt><dd>{context ? `${context.live_source_count}/${context.source_count}` : "—"}</dd></div>
            </dl>
            <div className="agent-index-intelligence">
              <Sparkles size={15} />
              <div><span>当前研究模式</span><strong>{analysisMode === "research" ? "深度研判" : "快速检索"}</strong></div>
              <em>{analysisMode === "research" ? "XHIGH" : "FAST"}</em>
            </div>
            <div className="agent-index-section">
              <span>变量覆盖</span>
              {variableRows.slice(0, 8).map(([variable, count]) => (
                <div className="agent-variable-row" key={variable}>
                  <b>{variable}</b><i style={{ "--coverage": `${Math.max(5, (count / Math.max(1, context?.record_count ?? 1)) * 100)}%` } as CSSProperties} /><em>{count}</em>
                </div>
              ))}
            </div>
            <div className="agent-index-section source-list">
              <span>来源状态</span>
              {context?.sources.map((source) => (
                <div key={source.id}><CircleDot size={11} className={source.status} /><b>{source.name}</b><em>{source.observation_count.toLocaleString("zh-CN")}</em></div>
              ))}
            </div>
            {context && <footer>索引 {context.index_revision}<br />更新 {formatTime(context.indexed_at)}</footer>}
          </aside>

          {view === "chat" && (
            <div className="data-agent-conversation">
              <div className="data-agent-transcript" ref={transcriptRef} aria-live="polite">
                {messages.length === 0 && (
                  <div className="agent-empty-state">
                    <div className="agent-empty-kicker"><Activity size={14} /><span>LIVE RESEARCH DESK</span><i />索引与模型已连接</div>
                    <div className="agent-briefing">
                      <div>
                        <span className="agent-briefing-mark"><Waves size={27} /></span>
                        <h3>从问题出发，沿证据下潜</h3>
                        <p>Agent 会先识别时间、海域和变量，再检索记录、核对来源，最后给出结论与科学边界。</p>
                      </div>
                      <div className="agent-signal-readout" aria-label="研究能力状态">
                        <div>{Array.from({ length: 24 }, (_, index) => <i key={index} />)}</div>
                        <strong>{context?.record_count.toLocaleString("zh-CN") ?? "—"}</strong>
                        <span>条记录在线 · {context?.source_count ?? "—"} 个来源</span>
                      </div>
                    </div>
                    <div className="agent-capability-line">
                      <span><FileSearch size={14} />全索引检索</span>
                      <span><Network size={14} />SQLite 检查点</span>
                      <span><Brain size={14} />四层记忆</span>
                      <span><Microscope size={14} />证据优先回复</span>
                    </div>
                    <div className="agent-starter-heading"><span>开始一次研究</span><em>{sessions.length > 0 ? `${sessions.length} 个历史会话可恢复` : "选择路径或直接提问"}</em></div>
                    <div className="agent-starter-list">
                      {STARTERS.map((starter, index) => (
                        <button type="button" key={starter.question} onClick={() => void sendQuestion(starter.question)}>
                          <span>0{index + 1}</span>
                          <b>{starter.label}<small>{starter.question}</small></b>
                          <em>{starter.detail}</em>
                          <ChevronRight size={15} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.map((message) => (
                  <article className={`agent-message ${message.role}`} key={message.id}>
                    <header>
                      <span>{message.role === "assistant" ? "DATA AGENT" : "YOU"}</span>
                      {message.provider && <em>{message.provider === "external_model" ? message.model : "完整索引检索"}</em>}
                    </header>
                    {message.role === "assistant" && message.queryPlan && (
                      <section className="agent-research-route" aria-label="本次研究路径">
                        <header>
                          <span><Sparkles size={13} />研究路径</span>
                          <b>{message.queryPlan.intent_label}</b>
                          <em>{message.queryPlan.mode === "research" ? "深度研判" : "快速检索"}</em>
                        </header>
                        {message.runtimeProfile && (
                          <>
                            <div className="agent-runtime-profile">
                              <span><Network size={12} />LANGGRAPH {message.runtimeProfile.framework_version}</span>
                              <span>{message.runtimeProfile.checkpoint_backend.toUpperCase()} CHECKPOINT</span>
                              <span>SQLITE STORE · {message.runtimeProfile.memory_layers.length} LAYERS</span>
                              <span>EVIDENCE FIRST</span>
                            </div>
                            <div className="agent-runtime-trace" aria-label="LangGraph 执行轨迹">
                              {message.runtimeProfile.execution_trace.map((node, index) => (
                                <span key={`${node}-${index}`}><i>{String(index + 1).padStart(2, "0")}</i>{RUNTIME_NODE_LABELS[node] ?? node}</span>
                              ))}
                            </div>
                          </>
                        )}
                        <div>
                          {message.queryPlan.steps.map((step, index) => (
                            <article key={step.key}>
                              <span>0{index + 1}</span>
                              <b>{step.label}</b>
                              <small>{step.detail}</small>
                            </article>
                          ))}
                        </div>
                        <footer><span>{message.queryPlan.time_scope}</span><i />
                          <span>{message.queryPlan.variables.length ? message.queryPlan.variables.join(" / ") : "多变量综合"}</span><i />
                          <span>{message.queryPlan.evidence_strategy}</span>
                        </footer>
                      </section>
                    )}
                    <p>{message.content}</p>
                    {message.notes?.map((note) => <small className="agent-message-note" key={note}>{readableAgentNote(note)}</small>)}
                    {message.citations && message.citations.length > 0 && (
                      <div className="agent-citations">
                        <div><Link2 size={13} /><span>本次调用 {message.retrievedRecordCount} 条相关记录</span></div>
                        {message.citations.map((citation, index) => (
                          <button type="button" key={citation.id} onClick={() => citation.event_id && onSelectEvent(citation.event_id)} disabled={!citation.event_id}>
                            <span>{String(index + 1).padStart(2, "0")}</span>
                            <b>{citation.title}</b>
                            <small>{citation.subtitle}</small>
                            {citation.event_id && <ChevronRight size={14} />}
                          </button>
                        ))}
                      </div>
                    )}
                    {message.followUps && message.followUps.length > 0 && (
                      <div className="agent-follow-ups">
                        {message.followUps.map((question) => <button type="button" key={question} onClick={() => void sendQuestion(question)}>{question}</button>)}
                      </div>
                    )}
                  </article>
                ))}
                {sending && (
                  <div className="agent-thinking" role="status">
                    <header><LoaderCircle size={17} className="spin" /><span>OpenQI 正在研究</span><em>{analysisMode === "research" ? "深度研判" : "快速检索"}</em></header>
                    <div className="agent-thinking-track"><i style={{ width: `${((thinkingStep + 1) / RESEARCH_STAGES.length) * 100}%` }} /></div>
                    <ol>
                      {RESEARCH_STAGES.map((stage, index) => (
                        <li className={index < thinkingStep ? "complete" : index === thinkingStep ? "active" : ""} key={stage.label}>
                          <span>0{index + 1}</span><b>{stage.label}</b><small>{stage.detail}</small>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>

              <form className="data-agent-composer" onSubmit={handleSubmit}>
                <div className="agent-composer-toolbar">
                  <span>回答模式</span>
                  <div className="agent-mode-switch" role="group" aria-label="选择回答模式">
                    <button type="button" aria-pressed={analysisMode === "quick"} className={analysisMode === "quick" ? "active" : ""} onClick={() => setAnalysisMode("quick")}><Gauge size={14} />快速检索</button>
                    <button type="button" aria-pressed={analysisMode === "research"} className={analysisMode === "research" ? "active" : ""} onClick={() => setAnalysisMode("research")}><Microscope size={14} />深度研判</button>
                  </div>
                  <em>{analysisMode === "research" ? "扩展召回 · 多来源核验 · 完整边界" : "关键数字优先 · 精简证据"}</em>
                </div>
                {activeSessionId && <div className="agent-selected-context"><span>持久会话</span><b>{activeSessionId.slice(0, 12)}</b></div>}
                {selectedEventId && <div className="agent-selected-context"><span>已关联当前记录</span><b>{selectedEventId}</b></div>}
                {error && <div className="agent-error" role="alert">{error}</div>}
                <div>
                  <textarea
                    ref={textareaRef}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendQuestion(draft);
                      }
                    }}
                    rows={2}
                    placeholder="询问记录、变量、海域、时间、来源或异常候选…"
                    aria-label="向海洋数据 Agent 提问"
                  />
                  <button type="submit" aria-label="发送问题" title="发送" disabled={!draft.trim() || sending}><Send size={18} /></button>
                </div>
                <footer><span>OpenQI · {context?.model ?? "gpt-5.5"}</span><i /><span>检索范围、研究计划与引用自动写入历史</span></footer>
              </form>
            </div>
          )}

          {view === "history" && (
            <section className="agent-library" aria-labelledby="agent-history-title">
              <header className="agent-library-header">
                <div><History size={18} /><span>会话档案</span><h3 id="agent-history-title">历史会话</h3></div>
                <button type="button" onClick={startNewConversation}><Plus size={16} />新对话</button>
              </header>
              {error && <div className="agent-error" role="alert">{error}</div>}
              {loadingLibrary && sessions.length === 0 ? (
                <div className="agent-library-loading"><LoaderCircle className="spin" size={18} />读取会话</div>
              ) : groupedSessions.length === 0 ? (
                <div className="agent-library-empty"><History size={26} /><h4>还没有历史会话</h4></div>
              ) : (
                <div className="agent-session-groups">
                  {groupedSessions.map(([group, items]) => (
                    <section key={group}>
                      <h4>{group}<span>{items.length}</span></h4>
                      {items.map((session) => (
                        <div className={`agent-session-row ${activeSessionId === session.id ? "active" : ""}`} key={session.id}>
                          <button type="button" className="agent-session-open" onClick={() => void openSession(session.id)}>
                            <MessageSquare size={16} />
                            <span><b>{session.title}</b><small>{session.summary || "空会话"}</small></span>
                            <em><Clock3 size={12} />{formatTime(session.last_message_at ?? session.updated_at)}<i>{session.message_count} 条</i></em>
                          </button>
                          <button type="button" title="归档" aria-label={`归档 ${session.title}`} disabled={mutating === session.id} onClick={() => void archiveSession(session.id)}><Archive size={15} /></button>
                          <button type="button" title="删除" aria-label={`删除 ${session.title}`} disabled={mutating === session.id} onClick={() => void deleteSession(session.id)}><Trash2 size={15} /></button>
                        </div>
                      ))}
                    </section>
                  ))}
                </div>
              )}
            </section>
          )}

          {view === "memory" && (
            <section className="agent-library" aria-labelledby="agent-memory-title">
              <header className="agent-library-header">
                <div><Brain size={18} /><span>长期上下文</span><h3 id="agent-memory-title">记忆</h3></div>
                <strong>{memories.filter((item) => item.enabled).length}<small> 条启用</small></strong>
              </header>
              <form className="agent-memory-form" onSubmit={addMemory}>
                <input value={memoryDraft} onChange={(event) => setMemoryDraft(event.target.value)} placeholder="添加一条明确偏好或长期指令" aria-label="新增 Agent 记忆" />
                <button type="submit" disabled={!memoryDraft.trim() || mutating === "memory-new"}><Plus size={16} />添加</button>
              </form>
              <div className="agent-memory-architecture" aria-label="Agent 四层记忆架构">
                <article><span>01</span><b>工作记忆</b><small>当前会话的限长消息窗口</small></article>
                <article><span>02</span><b>情节记忆</b><small>历史会话与 LangGraph 检查点</small></article>
                <article><span>03</span><b>语义记忆</b><small>明确保存的偏好与关注点</small></article>
                <article><span>04</span><b>程序性记忆</b><small>长期回复规则与操作指令</small></article>
              </div>
              {error && <div className="agent-error" role="alert">{error}</div>}
              {memories.length === 0 ? (
                <div className="agent-library-empty"><Brain size={26} /><h4>还没有长期记忆</h4></div>
              ) : (
                <div className="agent-memory-list">
                  {memories.map((memory) => (
                    <article className={memory.enabled ? "enabled" : "disabled"} key={memory.id}>
                      <div className="agent-memory-kind"><span>{MEMORY_LABELS[memory.kind]}</span><em>{Math.round(memory.confidence * 100)}%</em></div>
                      <p>{memory.content}</p>
                      <footer>
                        <span>更新 {formatTime(memory.updated_at)} · 使用 {memory.use_count} 次</span>
                        <div>
                          <button type="button" title={memory.enabled ? "停用" : "启用"} aria-label={memory.enabled ? "停用记忆" : "启用记忆"} disabled={mutating === memory.id} onClick={() => void toggleMemory(memory)}>
                            {memory.enabled ? <ToggleRight size={21} /> : <ToggleLeft size={21} />}
                          </button>
                          <button type="button" title="删除" aria-label="删除记忆" disabled={mutating === memory.id} onClick={() => void deleteMemory(memory.id)}><Trash2 size={15} /></button>
                        </div>
                      </footer>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
