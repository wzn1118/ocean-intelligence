import {
  Activity,
  Bot,
  BrainCircuit,
  ChevronRight,
  CircleStop,
  Code2,
  Database,
  Download,
  Eye,
  ExternalLink,
  FileCode2,
  FileText,
  Globe2,
  History,
  LoaderCircle,
  MessageSquare,
  Network,
  Paperclip,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ServerCog,
  Sparkles,
  Table2,
  TerminalSquare,
  Wind,
  Waves,
  X,
} from "lucide-react";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ApiRequestError, oceanApi } from "../api";
import { codexApi, type CodexArtifact, type CodexArtifactContent, type CodexEvent, type CodexHarnessSnapshot, type CodexReportManifest, type CodexRuntimeStatus, type CodexThread, type CodexThreadItem, type CodexUpload } from "../codexApi";
import type { AgentChatResponse, AgentCitation, AgentSourceContext, OceanRegion } from "../types";

interface CodexAgentSurfaceProps {
  region: OceanRegion;
  selectedEventId: string | null;
  onClose: () => void;
  onUseScienceFlow: () => void;
}

const STARTERS = [
  "生成北部湾深度海洋报告",
  "围绕我输入的任意主题生成内容丰富、视觉精美的深度图文报告",
  "生成当前海域图文综合报告，包含关键指标、趋势图、风险分布和证据说明",
  "列出当前 Codex 技能、插件和 MCP 工具并说明可用能力",
  "读取项目代码并生成一份只读架构审计报告",
  "分析代码问题并在 generated 目录输出补丁建议文件，不应用修改",
  "汇总最近 24 小时的新观测，并按来源和时间列出证据",
  "检查当前异常候选，区分观测事实、筛查结果和科学结论",
  "分析当前海域 Copernicus Marine 总浪、涌浪和风浪",
  "联合分析 Copernicus Marine 海面风场与高浪风险候选",
  "审计 Copernicus Marine 模式有效时间、缓存和证据边界",
  "根据输入文本、选中点位或当前海域生成最近可用 24 小时九区风场深度报告",
  "从 Copernicus Marine 全量目录查找叶绿素、营养盐和溶解氧数据集",
  "审计叶绿素与营养盐覆盖量、质量状态和最新时间",
  "检查所有数据源状态，指出缓存、延迟和缺口",
];

const BEIBU_GULF_REPORT_PROMPT = `请进入报告模式并生成北部湾深度海洋综合报告。研究范围固定为北部湾及邻近海域矩形：105.5–110.65°E、17.0–22.0°N；说明矩形与实际海域边界差异。首先调用九区空间工具定位分析中心点，把范围等经度、等纬度三等分为西北、北、东北、西、中间、东、西南、南、东南九区，并生成中心点与九区索引图；所有可空间化变量都必须按同一九区统计、制图和比较。必须按以下 15 个一级章节逐项生成，章节名不得合并或省略：1. 海表温度；2. 盐度与温盐结构；3. 表层流；4. 风场；5. 总浪、涌浪、风浪；6. 叶绿素与生态指标；7. Argo、浮标、岸基观测；8. 风浪流耦合；9. 异常候选；10. 数据时效、缺口和质量；11. 航运；12. 渔业；13. 生态监测；14. 科研影响边界；15. 新闻页面。前 10 项必须包含九区空间分布、时间变化、区域差异、统计量、来源、时间语义、证据等级和科学解释；温盐结构要有剖面，波浪要拆分总浪/涌浪/风浪，观测章节要列平台、位置、所属九区、变量、最近时间和 QC，耦合章节要做风浪流同一时空框架下的九区合成分析，异常候选要给阈值、持续性、空间连续性和独立验证状态。新闻页面直接复用产品现有“现在早报”模块，只收录中国大陆媒体，并用北部湾、广西、湛江、防城港、钦州、海南、航运、渔业等词筛选；列媒体、标题、Asia/Shanghai 发布时间、链接、北部湾相关性和摘要；新闻不能替代海洋观测证据。航运、渔业、生态监测、科研影响必须引用前面数据分析，写出影响集中区、边界和不确定性。每个章节至少一个真实图表或明确缺口表、一个“观察—比较—解释—限制”段落；至少 20 个独立视觉文件、24 个有效图文视觉位、10 种专业图表类型，且空间图不少于3、时间图不少于3、剖面图不少于2、方向图不少于2、不确定性图不少于2、物理诊断图不少于3。不得把模式/融合场写成现场观测，不得把异常候选写成确认事件或官方预警，不得编造没有返回的数据。`;

const formatLongitude = (value: number) => `${Math.abs(value)}°${value >= 0 ? "E" : "W"}`;
const formatLatitude = (value: number) => `${Math.abs(value)}°${value >= 0 ? "N" : "S"}`;

const reportScopeInstructions = (input: string, region: OceanRegion, hasSelectedPoint: boolean) => `先识别本次研究海域。必须把用户输入原文传给 ocean_resolve_marine_area；如果文本包含经纬度点或范围，也要解析并传入。${hasSelectedPoint ? "当前界面存在选中记录：先调用 ocean_get_event 获取 centroid，再用 ocean_resolve_marine_area 识别点位所属海域。" : "当前没有选中记录。"}识别优先级为：用户明确文本海域/范围 > 选中点位所属海域 > 当前界面海域。文本与点位冲突时使用文本范围并说明点位是否被排除；只有前两者都无法确定时，才回退到当前界面海域“${region.name}”，范围 ${formatLongitude(region.bounds[0][0])}–${formatLongitude(region.bounds[1][0])}、${formatLatitude(region.bounds[0][1])}–${formatLatitude(region.bounds[1][1])}。必须在报告中列出识别输入、selected_by、匹配海域中英文名、geometry_status、范围确定方式和置信边界。用户输入原文：${input.trim() || "（未输入海域名称，按选中点位或当前界面海域识别）"}`;

const buildDynamicOceanReportPrompt = (input: string, region: OceanRegion, hasSelectedPoint: boolean) => `请进入报告模式，生成识别海域的完整九区海洋观测报告。${reportScopeInstructions(input, region, hasSelectedPoint)}识别完成后调用 ocean_region_nine_zone_grid 和 ocean_nine_zone_point_inventory，并严格执行系统注入的全海域15模块报告Spec、异常点位与多源联动Spec、全变量数值加强Spec、专业可视化Spec和物理海洋学高级推理Spec。调用 ocean_anomaly_point_linkage 生成全区前10、正负异常和九区各区前3名，列出附近平台的距离、时间差、深度差、QC、来源独立性及L1-L5联动等级。海表温度、盐度与温盐结构、表层流、总浪/涌浪/风浪、叶绿素与生态指标必须像风场一样给出物理定义、单位、请求/有效覆盖、样本计数、掩膜与权重、九区统计、前窗或基线比较、同期点位验证和结论边界。必须调用 ocean_statistical_diagnostics 计算加权统计、稳健趋势、矢量统计、滞后相关和异常候选；调用 ocean_physics_diagnostics 建立中心点和必要九区的 f、beta、惯性周期、U-L-H-T 尺度与 Rossby 数，输入允许时继续计算地转流、风应力/Ekman及沿岸上升流有利输运、Ekman抽吸、Sverdrup输运、N²、Richardson数、Eady增长率、热风切变、散度/涡度/Okubo-Weiss、Froude/Burger/变形半径、有限水深波流相互作用和混合层热收支。所有派生量都要列输入证据、方程、单位、适用/失效条件、敏感性和可证伪条件，并至少引用3条 Stewart 2008 的章/节/教材页码；教材理论依据不得冒充当前海况证据。`;

const buildDynamicWindReportPrompt = (input: string, region: OceanRegion, hasSelectedPoint: boolean) => `请进入报告模式，生成识别海域最近可用连续24小时九区风场深度报告。${reportScopeInstructions(input, region, hasSelectedPoint)}识别完成后调用 ocean_region_nine_zone_grid 和 ocean_nine_zone_point_inventory。标题严格依据数据有效时间：如果最新有效时间明显早于生成时间，必须写“最近可用24小时”，不得写成截至生成时刻的“过去24小时”。完整报告 requested/effective window、UTC与地方时、24小时跨度、时间戳数和小时区间数；区分有效风矢量数、eastward_wind/northward_wind 分量值数、原始/抽样值数。逐网格逐时次计算 wind_speed，再报告平均标量风速、平均u/v、合成平均矢量风速、气象学来向、方向一致性R。审计海陆掩膜、持续零值、有效覆盖率和面积加权；无法面积加权时明确标为等权网格平均。西北、北、东北、西、中间、东、西南、南、东南九区必须分别给出覆盖、均值、中位数、P95、极值、u/v、主导来向、R、趋势、最大一小时变化、延迟和证据等级。必须与前一个等长24小时窗口比较，并列出九区同期原位风点位数量及独立验证能力。生成九区风矢量图、逐小时风速/方向图、九区对比图、风向分布图、掩膜覆盖图和前窗对比图。不得把融合分析写成现场实测，不得把异常候选写成官方预警。`;

const RICH_REPORT_INSTRUCTIONS = `

这是图文报告任务。请基于实际查询和计算结果，在当前用户的 generated 目录同时生成：
1. 一份出版级、响应式、可离线预览的自包含 HTML 报告；
2. 一份内容一致、结构完整的 Markdown 报告；
3. 按主题自适应生成丰富视觉内容，不设固定张数上限。至少形成 20 个独立视觉资产、24 个有效图文视觉位和 10 种不同专业图表类型；必须覆盖空间、时间、剖面、方向、分布、耦合、不确定性、物理、质量与影响类图表。
每个 HTML figure 必须声明 data-chart-type、data-chart-family、data-source 并含实质性 figcaption；坐标轴、单位、时间、经纬度、样本量 n、QC/缺测和不确定性必须可读。空间图至少3、时间图至少3、剖面图至少2、方向图至少2、不确定性图至少2、物理诊断图至少3。禁止用同一模板换颜色凑数；无数据时画覆盖、缺口、QC或不确定性图，不得伪造曲线。
每个分析figure后必须紧邻section.figure-interpretation，并通过data-figure-id关联。解释块必须包含data-role="observation"、"physical-mechanism"、"operational-meaning"、"uncertainty"、"validation"五段。观测段读取具体数值和结构；机制段给守恒关系、力学过程或候选机制；现实意义采用暴露—脆弱性—后果框架；不确定性段说明产品、分辨率、时效、样本和误差；验证段给出能够支持或削弱解释的下一项数据。风浪报告必须依据E=ρgHs²/16区分波高与波能变化，并对风浪反向变化检查共同时间窗、风向、有效风区、涌浪源区和响应时滞。
报告必须是深度报告而不是短简报：至少 28 个有意义章节、约 18KB 以上 Markdown 正文、约 32KB 以上 HTML，至少 15 条明确分析判断、9 条九区量化比较、15 个证据标记、3 个机制/替代解释段落、1 个风险边界判断，并包含中心点、九区索引、点位数量、完整数据表、证据链、方法、限制、附录和来源。风场必须严格区分时间跨度与时次数、风矢量数与分量值数，并包含风向、方向一致性、掩膜、权重、前窗比较和同期原位验证。海温、温盐剖面、表层流、总浪/涌浪/风浪、叶绿素与生态指标也必须逐项说明物理定义和单位、请求与有效时空深度范围、原始/抽样/有效/缺测/掩膜/零值计数、统计权重、九区分布、前窗或基线、点位验证及不可用降级；耦合必须报告共同覆盖和匹配样本，异常必须报告阈值、基线、持续性与独立验证。必须包含“物理机制诊断”小节，调用 ocean_physics_diagnostics，给出 f/beta/惯性周期、U-L-H-T 与 Ro、主导动量平衡、九区机制分型，并在输入充分时计算地转流、Ekman输运/抽吸、Sverdrup输运、N²、Richardson数、热风、散度/涡度/Okubo-Weiss、Fr/Bu/变形半径、有限水深波浪、波能流和混合层热倾向；派生量必须有方程、单位、适用边界、敏感性、不确定度与可证伪条件。物理小节至少给3条 Stewart 2008 章/节/教材页码引用，并把教材理论依据与本次数据证据分开。视觉风格必须与主题匹配，排版精致、色彩有层次、移动端和打印均可读。禁止用重复装饰图、空泛段落或无信息占位图凑数量。完成后给出主报告和视觉资产路径，便于界面直接预览。`;

const LOCAL_EVIDENCE_STORAGE_KEY = "ocean:codex-local-evidence:v1";
const ACTIVE_THREAD_STORAGE_PREFIX = "ocean:codex-active-thread:v1";

interface LocalEvidenceAnswer {
  id: string;
  threadId: string;
  turnId: string;
  question: string;
  answer: string;
  generatedAt: string;
  model: string;
  citations: AgentCitation[];
  sources: AgentSourceContext[];
  indexedAt: string;
  staleSelectionDropped: boolean;
  sessionId: string | null;
}

interface QuestionContext {
  question: string;
  selectedEventId: string | null;
}

interface PendingReportContract {
  manifest: CodexReportManifest;
  repairCount: number;
}

interface ActiveReportContract {
  threadId: string;
  turnId: string;
  manifest: CodexReportManifest;
}

type ReportLens = "overview" | "anomalies" | "linkage" | "physics" | "impact" | "gaps";

const REPORT_LENS_INSTRUCTIONS: Record<ReportLens, string> = {
  overview: "保持15模块综合视角，同时完整执行异常点位和多源联动分析。",
  anomalies: "重点生成全区前10、正负异常和九区各区前3名，解释评分分量、持续性、空间连续性和边界效应。",
  linkage: "重点调用 ocean_anomaly_point_linkage，列出异常附近平台、距离、时间差、深度差、QC、来源独立性和L1-L5联动等级。",
  physics: "重点开展异常点跨变量共同时间轴、滞后相关、方向夹角、量级比较、替代机制和可证伪物理诊断。",
  impact: "重点采用暴露—脆弱性—后果框架分析航运、渔业、养殖、港口、施工、生态监测和科研采样影响。",
  gaps: "重点绘制独立验证状态、九区证据缺口和补测优先级，指出最可能改变当前判断的新增观测。",
};

type RichPreview =
  | { kind: "web"; title: string; url: string }
  | { kind: "text"; title: string; path: string; content: string; truncated: boolean }
  | { kind: "media"; title: string; path: string; url: string; mediaType: "image" | "pdf" | "page" };

const parseQuestionContext = (text: string): QuestionContext => {
  const match = text.match(/\n{2,}当前界面选中记录：([^\n]+)\s*$/u);
  return {
    question: text.replace(/\n{2,}当前界面选中记录：[^\n]+\s*$/u, "").trim(),
    selectedEventId: match?.[1]?.trim() || null,
  };
};

const latestQuestionContext = (thread: CodexThread): QuestionContext | null => {
  const userItem = thread.turns
    .flatMap((turn) => turn.items)
    .filter((item) => item.type === "userMessage")
    .at(-1);
  if (!userItem) return null;
  const text = (userItem.content ?? []).map((entry) => entry.text).filter(Boolean).join("\n");
  return text ? parseQuestionContext(text) : null;
};

const readLocalEvidence = (): LocalEvidenceAnswer[] => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCAL_EVIDENCE_STORAGE_KEY) || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.slice(-60) as LocalEvidenceAnswer[] : [];
  } catch {
    return [];
  }
};

const eventLabel = (method: string) => {
  if (method === "error") return "模型连接重试";
  if (method === "turn/started") return "分析已开始";
  if (method === "turn/completed") return "分析已结束";
  if (method.startsWith("item/")) return "证据处理中";
  return method;
};

const formatEvidenceTime = (value?: string | null) => {
  if (!value) return "暂无观测时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
};

const evidenceFirstLocalAnswer = (question: string, response: AgentChatResponse) => {
  if (!/(24\s*小时|最近一天|today|last\s+24)/iu.test(question)) return response.answer;
  const generatedAt = new Date(response.generated_at).getTime();
  const cutoff = generatedAt - 24 * 60 * 60 * 1000;
  const recentSources = response.context.sources.filter((source) => {
    if (!source.latest_observation_at) return false;
    const observedAt = new Date(source.latest_observation_at).getTime();
    return Number.isFinite(observedAt) && observedAt >= cutoff && observedAt <= generatedAt;
  });
  const recentCitations = response.citations.filter((citation) => {
    if (!citation.observed_at) return false;
    const observedAt = new Date(citation.observed_at).getTime();
    return Number.isFinite(observedAt) && observedAt >= cutoff && observedAt <= generatedAt;
  });
  if (recentSources.length === 0) {
    return "结论\n当前索引没有可证明落在最近 24 小时内的新观测。下方仍列出各来源的最近观测时间，便于判断数据延迟。";
  }
  const sourceSummary = recentSources
    .map((source) => `${source.name}（最新 ${formatEvidenceTime(source.latest_observation_at)}）`)
    .join("；");
  const recordSummary = recentCitations.length > 0
    ? recentCitations.slice(0, 4).map((citation) => `${citation.title}，${formatEvidenceTime(citation.observed_at)}`).join("；")
    : "当前回复未附带窗口内的逐条记录；以下来源时间仅证明数据源已有更新。";
  return (
    `结论\n最近 24 小时内，当前索引可确认 ${recentSources.length} 个来源有新观测：${sourceSummary}。\n\n`
    + `可复核记录\n${recordSummary}。\n\n`
    + "口径\n来源行的“条数”是该来源当前索引总量，不是 24 小时增量；普通观测不作异常解释。"
  );
};

const formatThreadTime = (seconds?: number | null) => {
  if (!seconds) return "暂无时间";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(seconds * 1000));
};

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const normalizedThreadStatus = (status: CodexThread["status"]) => (
  typeof status === "string" ? status : status?.type ?? "idle"
).replace(/[_\s-]/gu, "").toLowerCase();

const isThreadNotLoadedStatus = (status: CodexThread["status"]) => normalizedThreadStatus(status) === "notloaded";

const meaningfulThreadTurn = (thread: CodexThread | null) => {
  if (!thread?.turns?.length) return null;
  return [...thread.turns].reverse().find((turn) => turn.items?.length > 0) ?? thread.turns.at(-1) ?? null;
};

const threadNeedsContinuation = (thread: CodexThread | null) => {
  const status = meaningfulThreadTurn(thread)?.status?.replace(/[_\s-]/gu, "").toLowerCase() ?? "";
  return ["interrupted", "failed", "error", "cancelled", "canceled"].includes(status);
};

const threadDisplayStatusText = (thread: CodexThread) => {
  if (isThreadNotLoadedStatus(thread.status)) return "待恢复";
  const turnStatus = meaningfulThreadTurn(thread)?.status?.replace(/[_\s-]/gu, "").toLowerCase() ?? "";
  if (["inprogress", "active", "running"].includes(turnStatus)) return "运行中";
  if (["interrupted", "failed", "error", "cancelled", "canceled"].includes(turnStatus)) return "待续跑";
  if (["completed", "complete"].includes(turnStatus)) return "已完成";
  return statusText(thread.status);
};

const statusText = (status: CodexThread["status"]) => {
  const raw = normalizedThreadStatus(status);
  if (raw === "notloaded") return "待恢复";
  if (raw === "saved") return "已保存";
  if (raw === "idle" || raw === "ready") return "就绪";
  if (raw === "active" || raw === "running" || raw === "inprogress") return "运行中";
  if (raw === "completed" || raw === "complete") return "已完成";
  if (raw === "failed" || raw === "error") return "异常";
  if (raw === "interrupted" || raw === "cancelled" || raw === "canceled") return "已停止";
  return "已保存";
};

const activeThreadStorageKey = (regionId: string) => `${ACTIVE_THREAD_STORAGE_PREFIX}:${regionId}`;

const itemTitle = (item: CodexThreadItem) => {
  if (item.type === "mcpToolCall") return `${item.server ?? "MCP"} · ${item.tool ?? "工具"}`;
  if (item.type === "commandExecution") return "终端执行";
  if (item.type === "fileChange") return "文件变更";
  if (item.type === "webSearch") return "网页检索";
  if (item.type === "reasoning") return "推理摘要";
  if (item.type === "plan") return "执行计划";
  return item.type;
};

function ItemIcon({ type }: { type: string }) {
  if (type === "mcpToolCall") return <Database size={15} />;
  if (type === "commandExecution") return <TerminalSquare size={15} />;
  if (type === "fileChange") return <FileCode2 size={15} />;
  if (type === "webSearch") return <Globe2 size={15} />;
  if (type === "reasoning" || type === "plan") return <BrainCircuit size={15} />;
  return <Activity size={15} />;
}

const trimResourceTarget = (value: string) => value.replace(/[),.;!?，。；！？]+$/u, "");
const normalizeWorkspaceResourceTarget = (value: string) => {
  const candidate = trimResourceTarget(value)
    .replace(/^['"`(（]+/u, "")
    .replace(/(?::\d+(?::\d+)?|#L\d+(?:C\d+)?)$/iu, "");
  const generated = candidate.match(/^(?:\/workspace\/)?\.runtime\/codex-users\/[^/]+\/(generated\/.*)$/u);
  if (generated) return generated[1];
  const upload = candidate.match(/^(?:\/workspace\/)?\.runtime\/codex-users\/[^/]+\/\.runtime\/(codex-uploads\/.*)$/u);
  if (upload) return `.runtime/${upload[1]}`;
  return candidate.replace(/^\/workspace\//u, "").replace(/^\.\//u, "");
};

const inlineMarkdown = (text: string, onOpenWeb?: (url: string) => void, onPreviewFile?: (path: string) => void): ReactNode[] =>
  text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((?:(?:https?:\/\/)|(?:\/workspace\/)|(?:generated\/)|(?:\.runtime\/codex-users\/)|(?:\.runtime\/codex-uploads\/))[^)\s]+\)|https?:\/\/[^\s<]+)/gu).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${index}-${part}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={`${index}-${part}`}>{part.slice(1, -1)}</code>;
    }
    const markdownLink = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/u);
    if (markdownLink) {
      return <button type="button" className="codex-inline-link" key={`${index}-${part}`} onClick={() => onOpenWeb?.(markdownLink[2])}>{markdownLink[1]}<ExternalLink size={10} /></button>;
    }
    const fileLink = part.match(/^\[([^\]]+)\]\(((?:\/workspace\/|generated\/|\.runtime\/codex-users\/|\.runtime\/codex-uploads\/)[^)\s]+)\)$/u);
    if (fileLink) {
      const target = normalizeWorkspaceResourceTarget(fileLink[2]);
      return <button type="button" className="codex-inline-link" key={`${index}-${part}`} onClick={() => onPreviewFile?.(target)}>{fileLink[1]}<Eye size={10} /></button>;
    }
    if (/^https?:\/\//u.test(part)) {
      const url = trimResourceTarget(part);
      const trailing = part.slice(url.length);
      return <span key={`${index}-${part}`}><button type="button" className="codex-inline-link" onClick={() => onOpenWeb?.(url)}>{url}<ExternalLink size={10} /></button>{trailing}</span>;
    }
    return part;
  });

interface MessageResource {
  kind: "file" | "web";
  label: string;
  target: string;
}

const tableCells = (line: string) => line.trim().replace(/^\|/u, "").replace(/\|$/u, "").split("|").map((cell) => cell.trim());
const isTableDivider = (line: string) => tableCells(line).length > 1 && tableCells(line).every((cell) => /^:?-{3,}:?$/u.test(cell));

const messageResources = (text: string): MessageResource[] => {
  const resources = new Map<string, MessageResource>();
  for (const match of text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gu)) {
    resources.set(match[2], { kind: "web", label: match[1], target: match[2] });
  }
  for (const match of text.matchAll(/https?:\/\/[^\s<>()]+/gu)) {
    const target = trimResourceTarget(match[0]);
    if (!resources.has(target)) resources.set(target, { kind: "web", label: new URL(target).hostname, target });
  }
  for (const match of text.matchAll(/\[([^\]]+)\]\(((?:\/workspace\/|generated\/|\.runtime\/codex-users\/|\.runtime\/codex-uploads\/)[^)\s]+)\)/gu)) {
    const target = normalizeWorkspaceResourceTarget(match[2]);
    resources.set(`file:${target}`, { kind: "file", label: match[1], target });
  }
  for (const match of text.matchAll(/(?:\/workspace\/)?(?:\.runtime\/codex-users\/[^/]+\/)?(?:generated|\.runtime\/codex-uploads)\/[^\s`"'<>）)]+/gmu)) {
    const rawTarget = match[0].trim().replace(/^`/u, "").replace(/^[(（]/u, "");
    const target = normalizeWorkspaceResourceTarget(rawTarget);
    const label = target.split("/").at(-1) || target;
    resources.set(`file:${target}`, { kind: "file", label, target });
  }
  return [...resources.values()].slice(0, 12);
};

interface MarkdownMessageProps {
  text?: string;
  onOpenWeb?: (url: string) => void;
  onPreviewFile?: (path: string) => void;
}

function MarkdownMessage({ text, onOpenWeb, onPreviewFile }: MarkdownMessageProps) {
  const lines = (text ?? "").split(/\r?\n/u);
  const blocks: ReactNode[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (line.trim().startsWith("```")) {
      const language = line.trim().slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push(<div className="codex-code-block" key={`code-${index}`}><header><span>{language || "CODE"}</span><code>{code.length} LINES</code></header><pre>{code.join("\n")}</pre></div>);
      continue;
    }
    if (index + 1 < lines.length && line.includes("|") && isTableDivider(lines[index + 1])) {
      const headers = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) rows.push(tableCells(lines[index++]));
      blocks.push(
        <div className="codex-table-card" key={`table-${index}`}>
          <header><Table2 size={14} /><span>结构化数据</span><em>{rows.length} 行 · {headers.length} 列</em></header>
          <div><table><thead><tr>{headers.map((cell, cellIndex) => <th key={`${cellIndex}-${cell}`}>{inlineMarkdown(cell, onOpenWeb, onPreviewFile)}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={`row-${rowIndex}`}>{headers.map((_, cellIndex) => <td key={`cell-${rowIndex}-${cellIndex}`}>{inlineMarkdown(row[cellIndex] ?? "", onOpenWeb, onPreviewFile)}</td>)}</tr>)}</tbody></table></div>
        </div>,
      );
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/u);
    if (heading) blocks.push(<h4 key={`${index}-${line}`}>{inlineMarkdown(heading[2], onOpenWeb, onPreviewFile)}</h4>);
    else {
      const bullet = line.match(/^[-*]\s+(.+)$/u);
      const ordered = line.match(/^(\d+)[.)]\s+(.+)$/u);
      const quote = line.match(/^>\s?(.+)$/u);
      if (bullet) blocks.push(<p className="codex-markdown-bullet" key={`${index}-${line}`}>{inlineMarkdown(bullet[1], onOpenWeb, onPreviewFile)}</p>);
      else if (ordered) blocks.push(<p className="codex-markdown-ordered" data-index={ordered[1]} key={`${index}-${line}`}>{inlineMarkdown(ordered[2], onOpenWeb, onPreviewFile)}</p>);
      else if (quote) blocks.push(<blockquote key={`${index}-${line}`}>{inlineMarkdown(quote[1], onOpenWeb, onPreviewFile)}</blockquote>);
      else if (!line.trim()) blocks.push(<span className="codex-markdown-break" aria-hidden="true" key={`break-${index}`} />);
      else blocks.push(<p key={`${index}-${line}`}>{inlineMarkdown(line, onOpenWeb, onPreviewFile)}</p>);
    }
    index += 1;
  }
  const resources = messageResources(text ?? "");
  return (
    <div className="codex-markdown">
      {blocks}
      {resources.length > 0 && <div className="codex-resource-grid">{resources.map((resource) => resource.kind === "web" ? (
        <article key={resource.target} className="web"><span><Globe2 size={16} /></span><div><small>WEB PAGE</small><b>{resource.label}</b><em>{resource.target}</em></div><button type="button" onClick={() => onOpenWeb?.(resource.target)}>预览<ExternalLink size={11} /></button></article>
      ) : (
        <article key={resource.target} className="file"><span><FileText size={16} /></span><div><small>WORKSPACE FILE</small><b>{resource.label}</b><em>{resource.target}</em></div><button type="button" onClick={() => onPreviewFile?.(resource.target)}>打开<Eye size={11} /></button><a href={codexApi.artifactDownloadUrl(resource.target)} download={resource.label} title="下载"><Download size={12} /></a></article>
      ))}</div>}
    </div>
  );
}

function ThreadItemView({ item, onOpenWeb, onPreviewFile }: { item: CodexThreadItem; onOpenWeb: (url: string) => void; onPreviewFile: (path: string) => void }) {
  if (item.type === "userMessage") {
    const text = (item.content ?? []).map((entry) => entry.text).filter(Boolean).join("\n");
    return <article className="codex-message user"><span>你</span><p>{parseQuestionContext(text).question}</p></article>;
  }
  if (item.type === "agentMessage") {
    return <article className="codex-message assistant"><span><Bot size={15} /></span><MarkdownMessage text={item.text} onOpenWeb={onOpenWeb} onPreviewFile={onPreviewFile} /></article>;
  }
  if (item.type === "reasoning") {
    const summary = item.summary?.join("\n") || "正在组织证据与推理路径";
    return <details className="codex-trace-item"><summary><ItemIcon type={item.type} /><b>{itemTitle(item)}</b><em>{item.status ?? "记录"}</em></summary><pre>{summary}</pre></details>;
  }
  if (item.type === "plan") {
    return <details className="codex-trace-item"><summary><ItemIcon type={item.type} /><b>{itemTitle(item)}</b></summary><pre>{item.text}</pre></details>;
  }
  if (["mcpToolCall", "commandExecution", "fileChange", "webSearch"].includes(item.type)) {
    const detail = item.command || item.query || (item.type === "fileChange" ? `${item.changes?.length ?? 0} 项变更` : JSON.stringify(item.result ?? {}, null, 2));
    return (
      <details className={`codex-trace-item ${item.status ?? ""}`}>
        <summary><ItemIcon type={item.type} /><b>{itemTitle(item)}</b><em>{item.status ?? "完成"}</em></summary>
        <pre>{detail}</pre>
        {item.aggregatedOutput && <pre className="output">{item.aggregatedOutput}</pre>}
      </details>
    );
  }
  return null;
}

export function CodexAgentSurface({ region, selectedEventId, onClose, onUseScienceFlow }: CodexAgentSurfaceProps) {
  const [runtime, setRuntime] = useState<CodexRuntimeStatus | null>(null);
  const [harness, setHarness] = useState<CodexHarnessSnapshot | null>(null);
  const [threads, setThreads] = useState<CodexThread[]>([]);
  const [activeThread, setActiveThread] = useState<CodexThread | null>(null);
  const [events, setEvents] = useState<CodexEvent[]>([]);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [effort, setEffort] = useState<"medium" | "high" | "xhigh">("medium");
  const [reportMode, setReportMode] = useState(false);
  const [reportLens, setReportLens] = useState<ReportLens>("overview");
  const [sending, setSending] = useState(false);
  const [restoringThreadId, setRestoringThreadId] = useState<string | null>(null);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<CodexArtifact[]>([]);
  const [uploads, setUploads] = useState<CodexUpload[]>([]);
  const [pendingUploads, setPendingUploads] = useState<CodexUpload[]>([]);
  const [uploading, setUploading] = useState(false);
  const [artifactPreview, setArtifactPreview] = useState<CodexArtifactContent | null>(null);
  const [richPreview, setRichPreview] = useState<RichPreview | null>(null);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportNotice, setReportNotice] = useState<string | null>(null);
  const [activeReport, setActiveReport] = useState<ActiveReportContract | null>(null);
  const [fallbackRunning, setFallbackRunning] = useState(false);
  const [localEvidence, setLocalEvidence] = useState<LocalEvidenceAnswer[]>(readLocalEvidence);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const reloadTimerRef = useRef<number | null>(null);
  const lastThreadReloadAtRef = useRef(0);
  const eventBufferRef = useRef<CodexEvent[]>([]);
  const eventFlushTimerRef = useRef<number | null>(null);
  const autoScrollRef = useRef(true);
  const threadRequestRef = useRef(0);
  const activeThreadIdRef = useRef<string | null>(null);
  const pendingQuestionsRef = useRef(new Map<string, QuestionContext>());
  const retryCountsRef = useRef(new Map<string, number>());
  const handledFallbackTurnsRef = useRef(new Set(localEvidence.map((entry) => entry.turnId)));
  const pendingReportTurnsRef = useRef(new Map<string, PendingReportContract>());
  const recoveryTurnIdsRef = useRef(new Set<string>());
  const artifactReconcileKeyRef = useRef("");

  const loadRuntime = useCallback(async (includeHarness = false) => {
    try {
      const runtimeStatus = await codexApi.status();
      setRuntime(runtimeStatus);
      if (includeHarness) setHarness(await codexApi.harness());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Codex 运行时读取失败");
    }
  }, []);

  const loadThreads = useCallback(async (query = search) => {
    try {
      const payload = await codexApi.threads(query);
      setThreads(payload.data ?? payload.threads ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Codex 历史会话读取失败");
    }
  }, [search]);

  const loadArtifacts = useCallback(async (threadId: string) => {
    try {
      const payload = await codexApi.artifacts(threadId);
      if (activeThreadIdRef.current === threadId) setArtifacts(payload.artifacts);
      return payload.artifacts;
    } catch {
      return null;
    }
  }, []);

  const reconcileArtifacts = useCallback(async (threadId: string) => {
    for (const delay of [0, 600, 1800]) {
      if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
      if (activeThreadIdRef.current !== threadId) return;
      await loadArtifacts(threadId);
    }
  }, [loadArtifacts]);

  const loadUploads = useCallback(async (threadId: string) => {
    try {
      const payload = await codexApi.uploads(threadId);
      setUploads(payload.uploads);
    } catch {
      setUploads([]);
    }
  }, []);

  const openThread = useCallback(async (threadId: string, refreshAssets = true) => {
    activeThreadIdRef.current = threadId;
    const requestId = ++threadRequestRef.current;
    try {
      const payload = await codexApi.thread(threadId);
      if (requestId !== threadRequestRef.current) return;
      setActiveThread(payload.thread);
      setThreads((current) => current.map((thread) => thread.id === payload.thread.id ? { ...thread, ...payload.thread } : thread));
      if (refreshAssets) {
        setArtifacts([]);
        setArtifactPreview(null);
        void reconcileArtifacts(threadId);
        void loadUploads(threadId);
        setPendingUploads([]);
        setActiveReport(null);
        setReportNotice(null);
      }
      setError(null);
    } catch (loadError) {
      if (activeThreadIdRef.current === threadId) activeThreadIdRef.current = null;
      setError(loadError instanceof Error ? loadError.message : "会话读取失败");
    }
  }, [loadUploads, reconcileArtifacts]);

  const refreshActiveThread = useCallback(async (threadId: string) => {
    try {
      const payload = await codexApi.thread(threadId);
      if (activeThreadIdRef.current === threadId) {
        startTransition(() => setActiveThread(payload.thread));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "会话刷新失败");
    }
  }, []);

  const scheduleThreadReload = useCallback((threadId: string, immediate = false) => {
    if (reloadTimerRef.current !== null) {
      if (!immediate) return;
      window.clearTimeout(reloadTimerRef.current);
    }
    const elapsed = performance.now() - lastThreadReloadAtRef.current;
    const delay = immediate ? 0 : Math.max(0, 650 - elapsed);
    reloadTimerRef.current = window.setTimeout(() => {
      reloadTimerRef.current = null;
      if (activeThreadIdRef.current !== threadId) return;
      lastThreadReloadAtRef.current = performance.now();
      void refreshActiveThread(threadId);
    }, delay);
  }, [refreshActiveThread]);

  const continueRecoveredThread = useCallback(async (thread: CodexThread) => {
    setSending(true);
    autoScrollRef.current = true;
    setError(null);
    setReportNotice("历史完整性校验通过。检测到上次任务中断，正在从已有上下文和文件状态继续执行。");
    try {
      const payload = await codexApi.startTurn(
        thread.id,
        "请从上一次被中断的任务继续。先完整读取本会话历史、最近一个有内容但未完成的 turn，以及当前工作目录中已生成的文件；保留已经完成且可复核的结果，不重复无意义步骤。然后继续完成用户原始请求，明确说明恢复后补做了什么，并给出最终可交付结果。",
        "high",
      );
      recoveryTurnIdsRef.current.add(payload.turn.id);
      pendingQuestionsRef.current.set(payload.turn.id, { question: "继续上一次中断的任务", selectedEventId: null });
      setActiveTurnId(payload.turn.id);
      scheduleThreadReload(thread.id);
      return payload.turn.id;
    } catch (continuationError) {
      setSending(false);
      setReportNotice("历史已经恢复，但中断任务尚未续跑。可点击“继续中断任务”重试。");
      throw continuationError;
    }
  }, [scheduleThreadReload]);

  const restoreThread = useCallback(async (threadId: string) => {
    if (restoringThreadId) return;
    setRestoringThreadId(threadId);
    setError(null);
    try {
      const payload = await codexApi.resumeThread(threadId);
      if (payload.thread.id !== threadId || !payload.recovery?.verified) {
        throw new Error("恢复完整性校验未通过，服务器没有返回可验证的原始上下文");
      }
      activeThreadIdRef.current = threadId;
      setActiveThread(payload.thread);
      setThreads((current) => current.map((thread) => thread.id === threadId ? { ...thread, ...payload.thread } : thread));
      setArtifactPreview(null);
      setArtifacts([]);
      void reconcileArtifacts(threadId);
      void loadUploads(threadId);
      setPendingUploads([]);
      setActiveReport(null);
      setReportNotice(`历史恢复校验通过：${payload.recovery.turnCount} 个 turns、${payload.recovery.itemCount} 条内容。`);
      if (payload.recovery.needsContinuation) {
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        await continueRecoveredThread(payload.thread);
      }
      await loadThreads("");
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (restoreError) {
      setError(restoreError instanceof Error ? `对话恢复失败：${restoreError.message}` : "对话恢复失败");
    } finally {
      setRestoringThreadId(null);
    }
  }, [continueRecoveredThread, loadThreads, loadUploads, reconcileArtifacts, restoringThreadId]);

  useEffect(() => {
    void loadRuntime(true);
    void loadThreads("");
    const timer = window.setInterval(() => void loadRuntime(false), 30_000);
    return () => window.clearInterval(timer);
  }, [loadRuntime, loadThreads]);

  useEffect(() => {
    setActiveThread(null);
    activeThreadIdRef.current = null;
    setEvents([]);
    setActiveTurnId(null);
    setSending(false);
    setArtifacts([]);
    setUploads([]);
    setPendingUploads([]);
    setArtifactPreview(null);
    setActiveReport(null);
    setReportNotice(null);
    pendingReportTurnsRef.current.clear();
  }, [region.id]);

  useEffect(() => {
    if (activeThread || activeThreadIdRef.current || threads.length === 0) return;
    const storedThreadId = window.localStorage.getItem(activeThreadStorageKey(region.id));
    const candidate = threads.find((thread) => thread.id === storedThreadId) ?? threads[0];
    if (candidate && !isThreadNotLoadedStatus(candidate.status)) void openThread(candidate.id);
  }, [activeThread, openThread, region.id, threads]);

  useEffect(() => {
    if (!activeThread?.id) return;
    window.localStorage.setItem(activeThreadStorageKey(region.id), activeThread.id);
  }, [activeThread?.id, region.id]);

  const previewArtifact = useCallback(async (artifact: CodexArtifact) => {
    if (!artifact.previewable) return;
    setArtifactLoading(true);
    try {
      setArtifactPreview(await codexApi.artifactContent(artifact.path));
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "文件预览失败");
    } finally {
      setArtifactLoading(false);
    }
  }, []);

  const openWebPreview = useCallback((url: string) => {
    setRichPreview({ kind: "web", title: new URL(url).hostname, url });
  }, []);

  const previewMessageFile = useCallback(async (filePath: string) => {
    const normalizedPath = normalizeWorkspaceResourceTarget(filePath);
    const title = normalizedPath.split("/").at(-1) || normalizedPath;
    const extension = title.split(".").at(-1)?.toLowerCase() || "";
    if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension)) {
      setRichPreview({ kind: "media", title, path: normalizedPath, url: codexApi.artifactViewUrl(normalizedPath), mediaType: "image" });
      return;
    }
    if (extension === "pdf") {
      setRichPreview({ kind: "media", title, path: normalizedPath, url: codexApi.artifactViewUrl(normalizedPath), mediaType: "pdf" });
      return;
    }
    if (["html", "htm"].includes(extension)) {
      setRichPreview({ kind: "media", title, path: normalizedPath, url: codexApi.artifactViewUrl(normalizedPath), mediaType: "page" });
      return;
    }
    try {
      const preview = await codexApi.artifactContent(normalizedPath);
      setRichPreview({ kind: "text", title, path: normalizedPath, content: preview.content, truncated: preview.truncated });
    } catch {
      window.open(codexApi.artifactDownloadUrl(normalizedPath), "_blank", "noopener,noreferrer");
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(LOCAL_EVIDENCE_STORAGE_KEY, JSON.stringify(localEvidence.slice(-60)));
  }, [localEvidence]);

  const runLocalEvidenceFallback = useCallback(async (threadId: string, turnId: string) => {
    if (!threadId || !turnId || handledFallbackTurnsRef.current.has(turnId)) return;
    handledFallbackTurnsRef.current.add(turnId);
    setFallbackRunning(true);
    setSending(true);
    setError(null);

    try {
      let context = pendingQuestionsRef.current.get(turnId) ?? null;
      if (!context) {
        const payload = await codexApi.thread(threadId);
        context = latestQuestionContext(payload.thread);
      }
      if (!context?.question) throw new Error("未找到本轮问题文本");

      await codexApi.interrupt(threadId, turnId).catch(() => undefined);

      let staleSelectionDropped = false;
      let response: AgentChatResponse;
      try {
        response = await oceanApi.agentChat({
          region_id: region.id,
          question: context.question,
          selected_event_id: context.selectedEventId,
          analysis_mode: "research",
          remember: true,
        });
      } catch (requestError) {
        const staleSelection = context.selectedEventId && requestError instanceof ApiRequestError && requestError.status === 404;
        if (!staleSelection) throw requestError;
        staleSelectionDropped = true;
        response = await oceanApi.agentChat({
          region_id: region.id,
          question: context.question,
          selected_event_id: null,
          analysis_mode: "research",
          remember: true,
        });
      }

      const entry: LocalEvidenceAnswer = {
        id: `${threadId}:${turnId}`,
        threadId,
        turnId,
        question: context.question,
        answer: evidenceFirstLocalAnswer(context.question, response),
        generatedAt: response.generated_at,
        model: response.model,
        citations: response.citations,
        sources: response.context.sources,
        indexedAt: response.context.indexed_at,
        staleSelectionDropped,
        sessionId: response.session?.id ?? null,
      };
      setLocalEvidence((current) => [...current.filter((item) => item.turnId !== turnId), entry].slice(-60));
      setError(staleSelectionDropped ? "原选中记录已不在当前索引；本次结果已按当前海域的最新索引重新取证。" : null);
      await Promise.allSettled([openThread(threadId), loadThreads("")]);
    } catch (fallbackError) {
      handledFallbackTurnsRef.current.delete(turnId);
      setError(fallbackError instanceof Error ? `本地证据检索失败：${fallbackError.message}` : "本地证据检索失败");
    } finally {
      pendingQuestionsRef.current.delete(turnId);
      retryCountsRef.current.delete(turnId);
      setFallbackRunning(false);
      setSending(false);
      setActiveTurnId(null);
    }
  }, [loadThreads, openThread, region.id]);

  const ensureReportArtifacts = useCallback(async (threadId: string, turnId: string) => {
    const contract = pendingReportTurnsRef.current.get(turnId);
    if (!contract) return;
    let latestStatus: Awaited<ReturnType<typeof codexApi.reportStatus>> | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => window.setTimeout(resolve, 500));
      try {
        latestStatus = await codexApi.reportStatus(threadId, contract.manifest.id);
      } catch {
        // Retry briefly because file-change notifications can arrive before disk metadata is visible.
      }
      if (latestStatus?.complete && latestStatus.quality && latestStatus.visualCount !== null) {
        pendingReportTurnsRef.current.delete(turnId);
        setActiveReport((current) => current?.turnId === turnId ? null : current);
        setArtifacts((current) => [
          ...latestStatus!.artifacts,
          ...current.filter((artifact) => !latestStatus!.artifacts.some((reportArtifact) => reportArtifact.path === artifact.path)),
        ]);
        setReportNotice(`深度海洋报告已核验：九区 ${latestStatus.quality.zoneCoverage}/9、点位分区 ${latestStatus.quality.pointZoneCoverage}/9、${latestStatus.visualCount} 个视觉资产、${latestStatus.quality.uniqueChartTypes} 种图表、${latestStatus.quality.analyticalClaims} 条分析。`);
        return;
      }
    }

    const missing = latestStatus?.missingPaths ?? [
      ...contract.manifest.requiredPaths,
      `${contract.manifest.visualPrefix}至少 ${contract.manifest.minimumVisuals} 个视觉资产`,
    ];
    pendingReportTurnsRef.current.delete(turnId);
    if (contract.repairCount < 1) {
      setReportNotice(`报告缺少 ${missing.length} 个产物，正在自动补齐。`);
      try {
        const repair = await codexApi.startTurn(
          threadId,
          `上一轮海洋报告未满足质量闸门。请检查已有文件，只补齐或重写缺失内容：\n${missing.map((path) => `- ${path}`).join("\n")}\n视觉数量不设上限，但至少需要 ${contract.manifest.minimumVisuals} 个非重复视觉资产、${contract.manifest.minimumHtmlFigures} 个图文视觉位和 ${contract.manifest.minimumChartTypes} 种专业图表。HTML figure 必须逐个声明 data-chart-type、data-chart-family、data-source 并有实质性 figcaption；空间/时间图各至少3，剖面/方向/不确定性图各至少2，物理诊断图至少3。图中必须可读出坐标或时间、单位、样本量n、QC/缺测与不确定性。每个分析figure后紧邻section.figure-interpretation，并以data-figure-id关联；每块包含observation、physical-mechanism、operational-meaning、uncertainty、validation五种data-role。现实意义采用暴露—脆弱性—后果框架，列明触发指标、适用对象、空间边界、证据等级和解除条件。风浪章节依据E=ρgHs²/16分别计算波高变化和波能变化；风速与波高趋势背离时，统一共同时间窗并检查风向、有效风区、涌浪来源、传播/响应时滞和至少三个可判别候选机制。逐句执行专业编辑：清除“不是…而是”“并非…而是”“不只是”“不仅仅是”等防御性句式，清除“值得注意的是”“总体来看”“综上所述”“可以看出”等AI套话；不得以“看、说、做、找、查、算、画、用、给、让、把、去、搞”等非学术单字动词驱动句子，改用查看、说明、开展、检索、查询、计算、绘制、采用、提供、评估、识别等专业动词。还需满足至少 ${contract.manifest.minimumHeadings} 个章节、Markdown ${Math.round(contract.manifest.minimumMarkdownBytes / 1000)}KB、HTML ${Math.round(contract.manifest.minimumHtmlBytes / 1000)}KB、${contract.manifest.minimumAnalyticalClaims} 条明确分析判断、${contract.manifest.minimumComparisons} 条九区量化比较和 ${contract.manifest.minimumEvidenceMarkers} 个证据标记。必须补齐文本/点位海域识别、selected_by、几何状态、范围来源、中心点、九区索引图、九区点位数量与密度表、原始/有效记录数、独立平台数、QC/时效和未归区记录审计。所有变量均调用 ocean_statistical_diagnostics 支撑加权统计、稳健趋势、矢量统计、滞后关系与异常筛选，并调用 ocean_anomaly_point_linkage 生成全区前10、正负异常、九区各区前3、评分分量、附近平台、距离、时间差、深度差、QC、来源独立性和L1-L5联动等级；必须说明核心/局地/背景半径、共同时间轴、网格分辨率约束、L1数量和补测可证伪路径。风场补齐请求/有效窗口、时次数与24小时跨度、矢量/分量计数、u/v、风速、气象学来向、方向一致性、掩膜、面积权重、九区、前窗和原位验证；海温、温盐、流、波浪和生态指标同样补齐定义、覆盖、计数、权重、九区、基线与点位验证。耦合补共同覆盖/匹配样本/夹角/非因果说明，异常补阈值/基线/持续性/空间连续性/独立验证，质量章补时效/分辨率/缓存/失败/抽样及结论影响。物理机制必须调用 ocean_physics_diagnostics，补齐 f/beta/惯性周期、U-L-H-T/Ro、Fr/Bu/变形半径、沿岸上升流有利输运、Ekman/Sverdrup、Ri/Eady、散度/涡度/Okubo-Weiss、波流相互作用和混合层热收支；每个派生量列输入证据、方程、单位、适用/失效条件、敏感性、不确定度和可证伪条件。至少引用3条 Stewart 2008 章/节/教材页码，明确教材只提供理论依据。先补真实取数和计算，禁止只扩写背景介绍。`,
          "high",
          [],
          "illustrated_report",
          contract.manifest.id,
        );
        if (repair.report) pendingReportTurnsRef.current.set(repair.turn.id, { manifest: repair.report, repairCount: 1 });
        if (repair.report) setActiveReport({ threadId, turnId: repair.turn.id, manifest: repair.report });
        setActiveTurnId(repair.turn.id);
        setSending(true);
        scheduleThreadReload(threadId, true);
        return;
      } catch (repairError) {
        setError(repairError instanceof Error ? `图文报告自动补齐失败：${repairError.message}` : "图文报告自动补齐失败");
      }
    }
    setReportNotice(null);
    setError(`图文报告产物校验失败，仍缺少：${missing.join("、")}`);
  }, [scheduleThreadReload]);

  useEffect(() => {
    if (!activeReport) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const status = await codexApi.reportStatus(activeReport.threadId, activeReport.manifest.id);
        if (cancelled) return;
        if (status.artifacts.length) {
          setArtifacts((current) => [
            ...status.artifacts,
            ...current.filter((artifact) => !status.artifacts.some((reportArtifact) => reportArtifact.path === artifact.path)),
          ]);
        }
        if (status.complete) {
          setReportNotice(`图文报告已生成 ${status.visualCount} 个视觉资产，可立即预览；Codex 正在完成最后说明。`);
          setActiveReport(null);
        }
      } catch {
        // The completion validator remains authoritative if an intermediate status read fails.
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1_500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeReport]);

  useEffect(() => {
    if (!activeThread?.id) return;
    const source = new EventSource(codexApi.eventStreamUrl(activeThread?.id));
    const onEvent = (raw: MessageEvent<string>) => {
      let event: CodexEvent;
      try {
        event = JSON.parse(raw.data) as CodexEvent;
      } catch {
        return;
      }
      eventBufferRef.current.push(event);
      if (eventFlushTimerRef.current === null) {
        eventFlushTimerRef.current = window.setTimeout(() => {
          const batch = eventBufferRef.current.splice(0);
          eventFlushTimerRef.current = null;
          if (batch.length) startTransition(() => setEvents((current) => [...current, ...batch].slice(-80)));
        }, 120);
      }
      const method = event.message.method ?? event.message.request?.method ?? "";
      const params = (event.message.params ?? event.message.request?.params ?? {}) as Record<string, unknown>;
      const eventThreadId = String(params.threadId ?? (params.thread as { id?: string } | undefined)?.id ?? activeThread?.id ?? "");
      if (eventThreadId && activeThreadIdRef.current === eventThreadId && (method.startsWith("item/") || method.startsWith("turn/"))) scheduleThreadReload(eventThreadId, method === "turn/completed");
      if (method === "turn/started") {
        const turn = params.turn as { id?: string } | undefined;
        if (turn?.id) setActiveTurnId(turn.id);
        setSending(true);
      }
      if (method === "error") {
        const turnId = String(params.turnId ?? "");
        const willRetry = params.willRetry === true;
        if (turnId && willRetry) {
          const retryCount = (retryCountsRef.current.get(turnId) ?? 0) + 1;
          retryCountsRef.current.set(turnId, retryCount);
          setActiveTurnId(turnId);
          setSending(true);
          if (retryCount >= 2 && eventThreadId) void runLocalEvidenceFallback(eventThreadId, turnId);
        }
        if (turnId && !willRetry && recoveryTurnIdsRef.current.has(turnId)) {
          recoveryTurnIdsRef.current.delete(turnId);
          setSending(false);
          setActiveTurnId(null);
          setReportNotice("历史已经恢复，但中断任务续跑失败。可点击“继续中断任务”重试。");
        }
      }
      if (method === "turn/completed") {
        setSending(false);
        setActiveTurnId(null);
        const completedTurnId = String(params.turnId ?? (params.turn as { id?: string } | undefined)?.id ?? "");
        if (completedTurnId && recoveryTurnIdsRef.current.delete(completedTurnId)) {
          setReportNotice("中断任务已完成续跑，正在核对最终消息和文件产物。");
        }
        if (eventThreadId) {
          void loadThreads("");
          void reconcileArtifacts(eventThreadId);
          void loadUploads(eventThreadId);
          if (completedTurnId) void ensureReportArtifacts(eventThreadId, completedTurnId);
        }
      }
    };
    source.addEventListener("codex", onEvent as EventListener);
    source.onerror = () => setError((current) => current ?? "Codex 事件流正在重连");
    return () => source.close();
  }, [activeThread?.id, ensureReportArtifacts, loadThreads, loadUploads, reconcileArtifacts, runLocalEvidenceFallback, scheduleThreadReload]);

  useEffect(() => {
    const turn = meaningfulThreadTurn(activeThread);
    const status = turn?.status?.replace(/[_\s-]/gu, "").toLowerCase() ?? "";
    if (!activeThread?.id || !turn?.id || !["completed", "complete"].includes(status)) return;
    const key = `${activeThread.id}:${turn.id}:${status}`;
    if (artifactReconcileKeyRef.current === key) return;
    artifactReconcileKeyRef.current = key;
    void reconcileArtifacts(activeThread.id);
  }, [activeThread, reconcileArtifacts]);

  useEffect(() => {
    if (!autoScrollRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      const transcript = transcriptRef.current;
      if (transcript) transcript.scrollTop = transcript.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeThread, localEvidence, sending]);

  useEffect(() => () => {
    if (reloadTimerRef.current !== null) window.clearTimeout(reloadTimerRef.current);
    if (eventFlushTimerRef.current !== null) window.clearTimeout(eventFlushTimerRef.current);
  }, []);

  const createThread = useCallback(async () => {
    const requestId = ++threadRequestRef.current;
    const payload = await codexApi.startThread(region.id);
    if (requestId !== threadRequestRef.current) return payload.thread;
    activeThreadIdRef.current = payload.thread.id;
    setActiveThread(payload.thread);
    setEvents([]);
    setArtifacts([]);
    setUploads([]);
    setPendingUploads([]);
    setArtifactPreview(null);
    await loadThreads("");
    return payload.thread;
  }, [loadThreads, region.id]);

  const beginNewThread = useCallback(async () => {
    if (reloadTimerRef.current !== null) {
      window.clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = null;
    }
    threadRequestRef.current += 1;
    activeThreadIdRef.current = null;
    setActiveThread(null);
    setEvents([]);
    setActiveTurnId(null);
    setSending(false);
    setArtifacts([]);
    setUploads([]);
    setPendingUploads([]);
    setArtifactPreview(null);
    setActiveReport(null);
    setReportNotice(null);
    pendingReportTurnsRef.current.clear();
    setError(null);
    try {
      await createThread();
      window.setTimeout(() => textareaRef.current?.focus(), 0);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "新会话创建失败");
    }
  }, [createThread]);

  const uploadFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const thread = activeThread ?? await createThread();
      const uploaded: CodexUpload[] = [];
      for (const file of Array.from(files)) {
        const payload = await codexApi.upload(thread.id, file);
        uploaded.push(payload.upload);
      }
      setUploads((current) => [...uploaded, ...current.filter((entry) => !uploaded.some((item) => item.path === entry.path))]);
      setPendingUploads((current) => [...current, ...uploaded]);
      window.setTimeout(() => textareaRef.current?.focus(), 0);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "文件上传失败");
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }, [activeThread, createThread, uploading]);

  const sendQuestion = useCallback(async (question: string, forceReportMode = false) => {
    const text = question.trim() || (pendingUploads.length ? "请读取并分析这些附件。" : "");
    if (!text || sending || uploading) return;
    const shouldGenerateReport = forceReportMode || reportMode;
    setSending(true);
    autoScrollRef.current = true;
    setError(null);
    setReportNotice(shouldGenerateReport ? "正在生成深度报告：海域与九区识别、异常排名、多源联动、物理解释、现实影响及至少20个独立视觉资产。" : null);
    setDraft("");
    try {
      const thread = activeThread ?? await createThread();
      const attachmentContext = pendingUploads.length
        ? `\n\n本轮附件已经保存到当前用户的隔离工作目录，请先按相对路径读取这些文件再回答：\n${pendingUploads.map((file) => `- ${file.path}（${file.name}，${formatFileSize(file.size)}）`).join("\n")}`
        : "";
      const eventContext = selectedEventId ? `\n\n当前界面选中记录：${selectedEventId}` : "";
      const reportContext = shouldGenerateReport ? `${RICH_REPORT_INSTRUCTIONS}\n本轮报告视角：${REPORT_LENS_INSTRUCTIONS[reportLens]}` : "";
      const contextualText = `${text}${attachmentContext}${eventContext}${reportContext}`;
      const payload = await codexApi.startTurn(thread.id, contextualText, shouldGenerateReport ? "high" : effort, pendingUploads, shouldGenerateReport ? "illustrated_report" : "conversation");
      pendingQuestionsRef.current.set(payload.turn.id, { question: text, selectedEventId });
      if (payload.report) pendingReportTurnsRef.current.set(payload.turn.id, { manifest: payload.report, repairCount: 0 });
      if (payload.report) setActiveReport({ threadId: thread.id, turnId: payload.turn.id, manifest: payload.report });
      setActiveTurnId(payload.turn.id);
      setPendingUploads([]);
      scheduleThreadReload(thread.id);
    } catch (sendError) {
      setSending(false);
      setError(sendError instanceof Error ? sendError.message : "发送失败");
    }
  }, [activeThread, createThread, effort, pendingUploads, reportLens, reportMode, scheduleThreadReload, selectedEventId, sending, uploading]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void sendQuestion(draft);
  };

  const interrupt = useCallback(async () => {
    if (!activeThread || !activeTurnId) return;
    await codexApi.interrupt(activeThread.id, activeTurnId);
    setSending(false);
  }, [activeThread, activeTurnId]);

  const retryRecoveredThread = useCallback(async () => {
    if (!activeThread || sending) return;
    try {
      await continueRecoveredThread(activeThread);
    } catch (continuationError) {
      setError(continuationError instanceof Error ? `中断任务续跑失败：${continuationError.message}` : "中断任务续跑失败");
    }
  }, [activeThread, continueRecoveredThread, sending]);

  const items = useMemo(() => activeThread?.turns.flatMap((turn) => turn.items) ?? [], [activeThread]);
  const activeNeedsContinuation = useMemo(() => threadNeedsContinuation(activeThread), [activeThread]);
  const activeTurnCount = activeThread?.turns?.length ?? 0;
  const activeItemCount = items.length;
  const activeLocalEvidence = useMemo(
    () => localEvidence.filter((entry) => entry.threadId === activeThread?.id),
    [activeThread?.id, localEvidence],
  );
  const latestEventLabels = useMemo(() => events.slice(-8).reverse().map((event) => {
    const method = event.message.method ?? event.message.request?.method ?? event.message.type ?? "event";
    return { sequence: event.sequence, method: eventLabel(method) };
  }), [events]);
  const oceanMcpReady = Boolean(runtime?.backend.dynamicMcp?.namespaces?.some((entry) => entry.server === "ocean-intelligence"));
  const harnessCapabilities = Object.entries(harness?.adapter?.capabilities ?? runtime?.backend.adapter?.capabilities ?? {});
  const inventoryCount = (name: string) => harness?.inventory?.[name]?.ok ? harness.inventory[name].count : 0;

  return (
    <div className="data-agent-layer" role="presentation">
      <section className="data-agent-workspace codex-agent-workspace" role="dialog" aria-modal="true" aria-labelledby="codex-agent-title">
        <header className="data-agent-header codex-agent-header">
          <div className="data-agent-identity">
            <span className="data-agent-mark"><Bot size={22} /></span>
            <div><span>CODEX APP-SERVER / OCEAN MCP</span><h2 id="codex-agent-title">海洋数据工作台</h2></div>
          </div>
          <nav className="data-agent-nav" aria-label="Agent 引擎">
            <button type="button" className="active"><Code2 size={15} />Codex</button>
            <button type="button" onClick={onUseScienceFlow}><Network size={15} />科学流程</button>
          </nav>
          <div className="data-agent-status">
            <i className={runtime?.ready ? "ready" : "loading"} />
            <span>{runtime?.ready ? "运行时已连接" : "正在连接运行时"}</span>
            <b>{runtime?.backend.modelProvider.configured ? runtime.backend.modelProvider.model : runtime?.backend.appServerVersion || "Codex"}</b>
          </div>
          <div className="data-agent-actions">
            <button type="button" title="刷新" onClick={() => { void loadRuntime(); void loadThreads(); }}><RefreshCw size={17} /></button>
            <button type="button" title="新会话" onClick={() => void beginNewThread()}><Plus size={18} /></button>
            <button type="button" title="关闭" onClick={onClose}><X size={19} /></button>
          </div>
        </header>

        <div className="codex-agent-body">
          <aside className="codex-thread-rail">
            <header><History size={15} /><span>历史会话</span><button type="button" title="新会话" onClick={() => void beginNewThread()}><Plus size={15} /></button></header>
            <label><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void loadThreads(); }} placeholder="搜索会话" /></label>
            <div>
              {threads.map((thread) => {
                const dormant = isThreadNotLoadedStatus(thread.status);
                const restoring = restoringThreadId === thread.id;
                const displayThread = activeThread?.id === thread.id ? activeThread : thread;
                const needsContinuation = threadNeedsContinuation(displayThread);
                const recoveryRunning = activeThread?.id === thread.id && Boolean(activeTurnId && recoveryTurnIdsRef.current.has(activeTurnId));
                return (
                  <div className={`codex-thread-row${activeThread?.id === thread.id ? " active" : ""}${dormant ? " dormant" : ""}`} key={thread.id}>
                    <button
                      type="button"
                      className="codex-thread-open"
                      disabled={restoring}
                      onClick={() => void (dormant ? restoreThread(thread.id) : openThread(thread.id))}
                    >
                      <MessageSquare size={14} />
                      <span><b>{thread.name || thread.preview || "新会话"}</b><small>{formatThreadTime(thread.recencyAt ?? thread.updatedAt)}</small></span>
                      <em>{restoring ? "校验恢复中" : recoveryRunning ? "续跑中" : needsContinuation ? "待续跑" : threadDisplayStatusText(displayThread)}</em>
                    </button>
                    {dormant && (
                      <button
                        type="button"
                        className="codex-thread-restore"
                        title={restoring ? "正在校验并恢复对话" : "恢复并继续对话"}
                        aria-label={restoring ? "正在校验并恢复对话" : "恢复并继续对话"}
                        disabled={restoring || Boolean(restoringThreadId)}
                        onClick={() => void restoreThread(thread.id)}
                      >
                        {restoring ? <LoaderCircle className="spin" size={14} /> : <RotateCcw size={14} />}
                      </button>
                    )}
                  </div>
                );
              })}
              {threads.length === 0 && <p>本项目还没有 Codex 会话</p>}
            </div>
          </aside>

          <main className="codex-conversation">
            <div className="codex-transcript" ref={transcriptRef} aria-live="polite" onScroll={(event) => {
              const element = event.currentTarget;
              autoScrollRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96;
            }}>
              {items.length === 0 && (
                <section className="codex-welcome">
                  <span><Waves size={28} /></span>
                  <em>OCEAN RESEARCH HARNESS</em>
                  <h3>从全量海洋索引中按需取证</h3>
                  <p>Codex 先读取区域清单，再调用 Ocean MCP 查询有限记录切片。历史会话由 app-server 持久化，普通观测与异常候选保持严格区分。</p>
                  <div>{STARTERS.map((question, index) => <button type="button" key={question} onClick={() => void sendQuestion(index === 0 ? BEIBU_GULF_REPORT_PROMPT : question.includes("九区风场") ? buildDynamicWindReportPrompt(draft, region, Boolean(selectedEventId)) : question, index < 2 || question.includes("九区风场"))}><Sparkles size={14} /><span>{question}</span><ChevronRight size={14} /></button>)}</div>
                </section>
              )}
              {items.map((item) => <ThreadItemView item={item} key={item.id} onOpenWeb={openWebPreview} onPreviewFile={previewMessageFile} />)}
              {activeLocalEvidence.map((entry) => (
                <article className="codex-message assistant codex-local-evidence" key={entry.id}>
                  <span><Database size={15} /></span>
                  <div>
                    <header><b>本地证据引擎接管</b><em>{formatEvidenceTime(entry.generatedAt)}</em></header>
                    {entry.staleSelectionDropped && <aside>原选中记录已失效，本次已按当前海域索引重新检索。</aside>}
                    <MarkdownMessage text={entry.answer} onOpenWeb={openWebPreview} onPreviewFile={previewMessageFile} />
                    <section className="codex-source-evidence">
                      <h4>来源与最新观测时间 <small>索引 {formatEvidenceTime(entry.indexedAt)}</small></h4>
                      {entry.sources.slice().sort((left, right) => String(right.latest_observation_at ?? "").localeCompare(String(left.latest_observation_at ?? ""))).map((source) => (
                        <div key={source.id}><i className={source.status} /><b>{source.name}</b><time>{formatEvidenceTime(source.latest_observation_at)}</time><em>{source.observation_count.toLocaleString("zh-CN")} 条</em></div>
                      ))}
                    </section>
                    {entry.citations.length > 0 && (
                      <section className="codex-record-evidence">
                        <h4>记录证据</h4>
                        {entry.citations.map((citation) => (
                          <div key={citation.id}><b>{citation.title}</b><span>{citation.subtitle}</span><time>{formatEvidenceTime(citation.observed_at)}</time><code>{citation.event_id || citation.source_id || citation.id}</code></div>
                        ))}
                      </section>
                    )}
                    <footer><span>{entry.model}</span>{entry.sessionId && <em>证据会话 {entry.sessionId.slice(0, 8)}</em>}</footer>
                  </div>
                </article>
              ))}
              {sending && <div className="codex-live-state"><LoaderCircle className="spin" size={16} /><span>{fallbackRunning ? "正在读取本地证据索引" : "Codex 正在执行"}</span><em>{fallbackRunning ? "本地证据引擎接管" : latestEventLabels[0]?.method ?? "等待事件"}</em></div>}
            </div>

            <form className="codex-composer" onSubmit={handleSubmit}>
              {selectedEventId && <div className="agent-selected-context"><span>当前记录</span><b>{selectedEventId}</b></div>}
              {error && <div className="agent-error" role="alert">{error}</div>}
              {activeNeedsContinuation && !sending && (
                <div className="codex-recovery-notice" role="status">
                  <div><RotateCcw size={14} /><span><b>历史已恢复，任务未完成</b><small>已核对 {activeTurnCount} 个 turns、{activeItemCount} 条内容；最近的有效任务状态为中断。</small></span></div>
                  <button type="button" onClick={() => void retryRecoveredThread()}><Play size={13} />继续中断任务</button>
                </div>
              )}
              {reportNotice && <div className="codex-report-notice" role="status"><FileText size={13} /><span>{reportNotice}</span></div>}
              {pendingUploads.length > 0 && (
                <div className="codex-pending-uploads" aria-label="待发送附件">
                  {pendingUploads.map((file) => (
                    <span key={file.path}><Paperclip size={11} /><b>{file.name}</b><small>{formatFileSize(file.size)}</small><button type="button" title={`移除 ${file.name}`} onClick={() => setPendingUploads((current) => current.filter((entry) => entry.path !== file.path))}><X size={11} /></button></span>
                  ))}
                </div>
              )}
              <div className="codex-composer-options">
                <span className="codex-mode-label">模式</span>
                <div className="codex-mode-picker" role="group" aria-label="选择助手模式">
                  <button
                    type="button"
                    className={!reportMode ? "active" : ""}
                    aria-pressed={!reportMode}
                    onClick={() => setReportMode(false)}
                    title="普通对话模式"
                  >
                    <MessageSquare size={12} />对话
                  </button>
                  <button
                    type="button"
                    className={reportMode ? "active report-mode" : "report-mode"}
                    aria-pressed={reportMode}
                    onClick={() => setReportMode(true)}
                    title="进入海洋报告模式"
                  >
                    <FileText size={12} />报告
                  </button>
                </div>
                <button
                  type="button"
                  className="ocean-report-button"
                  disabled={sending || uploading}
                  onClick={() => void sendQuestion(buildDynamicOceanReportPrompt(draft, region, Boolean(selectedEventId)), true)}
                  title="识别输入文本、选中点位或当前海域并生成完整报告"
                >
                  <Globe2 size={12} />海域报告
                </button>
                <button
                  type="button"
                  className="wind-report-button"
                  disabled={sending || uploading}
                  onClick={() => void sendQuestion(buildDynamicWindReportPrompt(draft, region, Boolean(selectedEventId)), true)}
                  title="识别输入文本、选中点位或当前海域并生成九区风场报告"
                >
                  <Wind size={12} />九区风场
                </button>
                <span>推理强度</span>
                <button type="button" className={`effort-option ${effort === "medium" ? "active" : ""}`} onClick={() => setEffort("medium")}>均衡</button>
                <button type="button" className={`effort-option ${effort === "high" ? "active" : ""}`} onClick={() => setEffort("high")}>深入</button>
                <button type="button" className={`effort-option ${effort === "xhigh" ? "active" : ""}`} onClick={() => setEffort("xhigh")}>极致</button>
                <em>{activeThread ? `THREAD ${activeThread.id.slice(0, 8)}` : "NEW THREAD"}</em>
              </div>
              {reportMode && (
                <div className="codex-mode-status" role="status">
                  <FileText size={13} />
                  <span><b>海洋报告模式</b>已开启，报告将完成中心点与九区、异常排名、邻域点位联动、跨变量物理诊断和现实影响分析。</span>
                </div>
              )}
              {reportMode && (
                <div className="codex-report-lenses" role="group" aria-label="报告分析视角">
                  <button type="button" className={reportLens === "overview" ? "active" : ""} aria-pressed={reportLens === "overview"} onClick={() => setReportLens("overview")} title="综合报告视角"><Globe2 size={12} />综合</button>
                  <button type="button" className={reportLens === "anomalies" ? "active" : ""} aria-pressed={reportLens === "anomalies"} onClick={() => setReportLens("anomalies")} title="异常点位排名"><Activity size={12} />异常点位</button>
                  <button type="button" className={reportLens === "linkage" ? "active" : ""} aria-pressed={reportLens === "linkage"} onClick={() => setReportLens("linkage")} title="附近平台与多源联动"><Network size={12} />联动观测</button>
                  <button type="button" className={reportLens === "physics" ? "active" : ""} aria-pressed={reportLens === "physics"} onClick={() => setReportLens("physics")} title="跨变量物理机制"><BrainCircuit size={12} />物理机制</button>
                  <button type="button" className={reportLens === "impact" ? "active" : ""} aria-pressed={reportLens === "impact"} onClick={() => setReportLens("impact")} title="业务与生态现实影响"><Waves size={12} />现实影响</button>
                  <button type="button" className={reportLens === "gaps" ? "active" : ""} aria-pressed={reportLens === "gaps"} onClick={() => setReportLens("gaps")} title="独立验证与补测优先级"><Search size={12} />证据缺口</button>
                  {selectedEventId && <button type="button" className="selected-point-report" disabled={sending || uploading} onClick={() => void sendQuestion(`围绕当前选中记录 ${selectedEventId} 生成异常点位专项报告。调用 ocean_get_event 获取坐标和证据，再调用 ocean_anomaly_point_linkage 检索附近平台并完成L1-L5联动、跨变量共同时间轴、物理机制、现实影响和验证缺口分析。`, true)} title="生成当前异常点位专项报告"><FileText size={12} />该点专项报告</button>}
                </div>
              )}
              <div className="codex-composer-input">
                <input ref={uploadInputRef} type="file" multiple hidden onChange={(event) => void uploadFiles(event.target.files)} />
                <textarea ref={textareaRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendQuestion(draft); } }} rows={2} placeholder="询问观测、变量、来源、候选证据，或让 Codex 执行可复核分析…" />
                <button type="button" className="attach" title={uploading ? "正在上传" : "上传附件"} disabled={uploading || sending} onClick={() => uploadInputRef.current?.click()}>{uploading ? <LoaderCircle className="spin" size={17} /> : <Paperclip size={17} />}</button>
                {sending && activeTurnId ? <button type="button" className="stop" title="停止" onClick={() => void interrupt()}><CircleStop size={18} /></button> : <button type="submit" title="发送" disabled={(!draft.trim() && pendingUploads.length === 0) || uploading}><Send size={18} /></button>}
              </div>
            </form>
          </main>

          <aside className="codex-runtime-rail">
            <header><ServerCog size={15} /><span>运行时</span><i className={runtime?.ready ? "ready" : ""} /></header>
            <dl>
              <div><dt>APP-SERVER</dt><dd>{runtime?.backend.appServerVersion || "连接中"}</dd></div>
              <div><dt>MODEL</dt><dd>{runtime?.backend.modelProvider.model || "Codex 配置"}</dd></div>
              <div><dt>OCEAN MCP</dt><dd>{oceanMcpReady ? "已连接" : "未连接"}</dd></div>
              <div><dt>TOOLS</dt><dd>{runtime?.backend.dynamicMcp?.tools ?? "—"}</dd></div>
              <div><dt>HARNESS</dt><dd>{harness?.exposedMethods.length ?? "—"} METHODS</dd></div>
              <div><dt>PROJECT</dt><dd>{harness?.projectSourceAccess === "read-only" ? "SOURCE READ ONLY" : "—"}</dd></div>
            </dl>
            <section className="codex-harness-capabilities">
              <span>CODEX HARNESS 能力</span>
              <b>{harness?.ready ? "只读分析运行时已连接" : "正在读取能力"}</b>
              <div>
                {harnessCapabilities.map(([name, state]) => <em className={state === "unsupported" ? "disabled" : "ready"} key={name}>{name}</em>)}
              </div>
              <small>源码只读 · 仅 `generated` 与会话文件可写</small>
              <small>模型 {inventoryCount("models")} · 技能 {inventoryCount("skills")} · 插件 {inventoryCount("plugins")} · MCP {inventoryCount("mcpServers")}</small>
            </section>
            <section><span>当前海域</span><b>{region.name}</b><small>{region.id}</small></section>
            <section className="codex-artifacts codex-uploads">
              <span>会话文件</span>
              {uploads.map((upload) => (
                <div key={upload.path}>
                  <Paperclip size={13} />
                  <button type="button" disabled={!upload.previewable || artifactLoading} onClick={() => void previewArtifact(upload)} title={upload.previewable ? "预览文件" : "该格式仅支持下载"}>
                    <b>{upload.name}</b>
                    <small>{formatFileSize(upload.size)} · {upload.path}</small>
                  </button>
                  {upload.previewable && <button type="button" onClick={() => void previewArtifact(upload)} title="预览"><Eye size={13} /></button>}
                  <a href={codexApi.artifactDownloadUrl(upload.path)} download={upload.name} title="下载"><Download size={13} /></a>
                </div>
              ))}
              {uploads.length === 0 && <p>当前会话尚未上传文件</p>}
            </section>
            <section className="codex-artifacts">
              <span>文件产物</span>
              {artifacts.map((artifact) => (
                <div key={artifact.path}>
                  <FileCode2 size={13} />
                  <button type="button" disabled={!artifact.previewable || artifactLoading} onClick={() => void previewArtifact(artifact)} title={artifact.previewable ? "预览文件" : "该格式仅支持下载"}>
                    <b>{artifact.name}</b>
                    <small>{formatFileSize(artifact.size)} · {artifact.path}</small>
                  </button>
                  {artifact.previewable && <button type="button" onClick={() => void previewArtifact(artifact)} title="预览"><Eye size={13} /></button>}
                  <a href={codexApi.artifactDownloadUrl(artifact.path)} download={artifact.name} title="下载"><Download size={13} /></a>
                </div>
              ))}
              {artifacts.length === 0 && <p>当前会话尚未生成文件</p>}
              {artifactPreview && (
                <aside>
                  <header><b>{artifactPreview.path}</b><button type="button" onClick={() => setArtifactPreview(null)}>关闭</button></header>
                  <pre>{artifactPreview.content}</pre>
                  {artifactPreview.truncated && <small>预览仅显示前 1 MB</small>}
                </aside>
              )}
            </section>
            <section className="codex-event-log">
              <span>实时事件</span>
              {latestEventLabels.map((event) => <div key={event.sequence}><i /> <b>{event.method}</b><em>{event.sequence}</em></div>)}
              {latestEventLabels.length === 0 && <p>等待 app-server 通知</p>}
            </section>
            <footer><BrainCircuit size={14} /><span>会话历史由 Codex 持久化<br />领域记忆由 Ocean MCP 提供</span></footer>
          </aside>
        </div>
        {richPreview && (
          <div className="codex-rich-preview" role="dialog" aria-modal="true" aria-label={richPreview.title}>
            <header>
              <div>{richPreview.kind === "web" ? <Globe2 size={16} /> : <FileText size={16} />}<span><small>{richPreview.kind === "web" ? "WEB PREVIEW" : "FILE PREVIEW"}</small><b>{richPreview.title}</b></span></div>
              <nav>
                {richPreview.kind === "web" && <a href={richPreview.url} target="_blank" rel="noreferrer">新窗口打开<ExternalLink size={12} /></a>}
                {richPreview.kind !== "web" && <a href={codexApi.artifactDownloadUrl(richPreview.path)} download={richPreview.title}>下载<Download size={12} /></a>}
                <button type="button" title="关闭预览" onClick={() => setRichPreview(null)}><X size={15} /></button>
              </nav>
            </header>
            <main className={richPreview.kind}>
              {richPreview.kind === "text" && <pre>{richPreview.content}</pre>}
              {richPreview.kind === "media" && richPreview.mediaType === "image" && <img src={richPreview.url} alt={richPreview.title} />}
              {richPreview.kind === "media" && richPreview.mediaType !== "image" && <iframe src={richPreview.url} title={richPreview.title} sandbox="allow-scripts allow-forms allow-popups allow-downloads" />}
              {richPreview.kind === "web" && <iframe src={richPreview.url} title={richPreview.title} sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox" />}
            </main>
            {richPreview.kind === "text" && richPreview.truncated && <footer>文件较大，当前仅展示前 1 MB</footer>}
          </div>
        )}
      </section>
    </div>
  );
}
