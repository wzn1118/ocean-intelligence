const fs = require('fs');
const path = require('path');
const pptxgen = require('pptxgenjs');

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'Ocean Intelligence';
pptx.company = 'Ocean Intelligence';
pptx.subject = '海洋智能分析平台产品展示';
pptx.title = 'Ocean Intelligence - 从实时观测到证据研判';
pptx.lang = 'zh-CN';
pptx.theme = {
  headFontFace: 'Noto Sans SC',
  bodyFontFace: 'Noto Sans SC',
  lang: 'zh-CN',
};
pptx.defineSlideMaster({
  title: 'DARK',
  background: { color: '071A23' },
  objects: [],
  slideNumber: { x: 12.35, y: 7.12, w: 0.35, h: 0.15, color: '6F949A', fontFace: 'Bahnschrift', fontSize: 8, align: 'right', margin: 0 },
});
pptx.defineSlideMaster({
  title: 'LIGHT',
  background: { color: 'F3F8F7' },
  objects: [],
  slideNumber: { x: 12.35, y: 7.12, w: 0.35, h: 0.15, color: '6A8A90', fontFace: 'Bahnschrift', fontSize: 8, align: 'right', margin: 0 },
});

const W = 13.333;
const H = 7.5;
const C = {
  navy: '081719',
  deep: '102426',
  ink: '142E31',
  teal: '1EA899',
  cyan: '72D8CD',
  mint: 'C4EFE7',
  coral: 'F16C5C',
  amber: 'DDB45B',
  paper: 'F5F7F6',
  white: 'FFFFFF',
  mist: 'D7E8E7',
  pale: 'E9F3F2',
  muted: '7FA1A7',
  line: '2C5159',
};

const root = path.resolve(__dirname, '..');
const imgRoot = path.join(root, 'output', 'imagegen', 'image2', 'ocean-promo-ppt');
const paths = {
  cover: path.join(imgRoot, 'ocean-cover-intelligence-01.png'),
  argo: path.join(imgRoot, 'argo-water-column-01.png'),
  eddy: path.join(imgRoot, 'living-ocean-eddy-01.png'),
  horizon: path.join(imgRoot, 'ocean-horizon-future-01.png'),
  poster: path.join(root, 'output', 'imagegen', 'ocean-poster-lightblue-image2.png'),
  logo: path.join(root, 'frontend', 'public', 'art', 'brand-offset-mark.png'),
  overview: path.join(root, 'frontend', 'output', 'playwright', 'latest-argo-auto-update.png'),
  seaProbe: path.join(root, 'frontend', 'output', 'playwright', 'sea-probe-after.png'),
  globalMap: path.join(root, 'output', 'playwright', 'world-map-all-countries-final.png'),
  event: path.join(root, 'frontend', 'output', 'playwright', 'event-detail-target-recovered.png'),
  agent: path.join(root, 'output', 'playwright', 'agent-answer-desktop.png'),
  agentArchitecture: path.join(root, 'output', 'playwright', 'agent-top-architecture-desktop.png'),
  agentMemory: path.join(root, 'output', 'playwright', 'agent-four-layer-memory.png'),
  queue: path.join(root, 'frontend', 'output', 'playwright', 'event-queue-unified', 'event-queue-night-unified.png'),
};

for (const [name, file] of Object.entries(paths)) {
  if (!fs.existsSync(file)) throw new Error(`Missing required image ${name}: ${file}`);
}

function addImage(slide, file, x, y, w, h, type = 'cover', extra = {}) {
  slide.addImage({ path: file, x, y, sizing: { type, w, h }, ...extra });
}

function addRect(slide, x, y, w, h, fill, transparency = 0, line = { color: fill, transparency: 100 }) {
  slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: fill, transparency }, line });
}

function addLine(slide, x, y, w, h, color = C.line, width = 1, transparency = 0, dash = 'solid') {
  slide.addShape(pptx.ShapeType.line, { x, y, w, h, line: { color, width, transparency, dashType: dash } });
}

function addText(slide, text, x, y, w, h, opts = {}) {
  const fontFace = opts.fontFace === 'Arial'
    ? 'Bahnschrift'
    : (opts.fontFace || 'Noto Sans SC');
  slide.addText(text, {
    x, y, w, h,
    ...opts,
    fontFace,
    fontSize: opts.fontSize || 18,
    color: opts.color || C.ink,
    bold: opts.bold || false,
    margin: opts.margin === undefined ? 0 : opts.margin,
    valign: opts.valign || 'mid',
    align: opts.align || 'left',
    breakLine: false,
    fit: opts.fit || 'shrink',
    isTextBox: true,
    paraSpaceAfterPt: opts.paraSpaceAfterPt || 0,
    lineSpacingMultiple: opts.lineSpacingMultiple || 1.0,
    transparency: opts.transparency || 0,
    charSpacing: 0,
  });
}

function addBrand(slide, dark = false, x = 0.62, y = 0.38) {
  addImage(slide, paths.logo, x, y, 0.32, 0.32, 'contain');
  addText(slide, 'OCEAN INTELLIGENCE', x + 0.43, y + 0.01, 2.55, 0.16, {
    fontFace: 'Arial', fontSize: 8, bold: true, color: dark ? C.mint : C.ink,
  });
  addText(slide, '海洋智能分析平台', x + 0.43, y + 0.16, 2.55, 0.14, {
    fontSize: 8, color: dark ? C.muted : '53757B',
  });
}

function addHeader(slide, num, kicker, title, subtitle, dark = false) {
  const primary = dark ? C.white : C.ink;
  const secondary = dark ? '96B7BA' : '5F7E84';
  addText(slide, String(num).padStart(2, '0'), 0.62, 0.36, 0.45, 0.22, {
    fontFace: 'Arial', fontSize: 10, bold: true, color: C.coral,
  });
  addLine(slide, 1.18, 0.48, 0.38, 0, C.coral, 2);
  addText(slide, kicker.toUpperCase(), 1.67, 0.36, 3.8, 0.22, {
    fontFace: 'Arial', fontSize: 8.5, bold: true, color: dark ? C.cyan : '298A84',
  });
  addText(slide, title, 0.62, 0.84, 11.9, 0.62, {
    fontSize: 25.5, bold: true, color: primary,
  });
  if (subtitle) addText(slide, subtitle, 0.64, 1.48, 11.7, 0.34, { fontSize: 11, color: secondary });
}

function addFooter(slide, page, dark = false, note = '') {
  addLine(slide, 0.62, 7.04, 12.08, 0, dark ? '31515A' : 'BDD0D0', 0.6);
  addText(slide, note || 'OCEAN INTELLIGENCE · 海洋智能分析平台', 0.62, 7.10, 6.8, 0.16, {
    fontFace: 'Arial', fontSize: 7.2, color: dark ? '6F9298' : '66858A',
  });
  addText(slide, String(page).padStart(2, '0'), 12.23, 7.10, 0.47, 0.16, {
    fontFace: 'Arial', fontSize: 7.2, bold: true, color: dark ? '6F9298' : '66858A', align: 'right',
  });
}

function addMetric(slide, value, label, x, y, w, dark = false, accent = C.cyan) {
  addText(slide, value, x, y, w, 0.42, { fontFace: 'Arial', fontSize: 23, bold: true, color: dark ? C.white : C.ink });
  addLine(slide, x, y + 0.48, Math.min(w, 1.05), 0, accent, 2.2);
  addText(slide, label, x, y + 0.59, w, 0.42, { fontSize: 9.5, color: dark ? '8FB1B5' : '58777D', valign: 'top' });
}

function addPill(slide, label, x, y, w, dark = false, accent = C.teal) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h: 0.34,
    rectRadius: 0.08,
    fill: { color: dark ? C.deep : C.white, transparency: dark ? 8 : 0 },
    line: { color: accent, transparency: dark ? 30 : 48, width: 0.8 },
  });
  addText(slide, label, x + 0.08, y + 0.01, w - 0.16, 0.30, {
    fontSize: 8.3, bold: true, color: dark ? C.mint : C.ink, align: 'center',
  });
}

function addSourceDot(slide, label, x, y, color) {
  slide.addShape(pptx.ShapeType.ellipse, { x, y: y + 0.08, w: 0.10, h: 0.10, fill: { color }, line: { color, transparency: 100 } });
  addText(slide, label, x + 0.17, y, 1.6, 0.26, { fontSize: 8.2, color: C.mist });
}

// 01 Cover
{
  const slide = pptx.addSlide('DARK');
  addRect(slide, 0, 0, W, H, C.navy, 0);
  addRect(slide, 5.04, 0.36, 8.10, 6.78, C.deep, 0, { color: '37595D', transparency: 15, width: 0.8 });
  addImage(slide, paths.overview, 5.10, 0.42, 7.98, 6.66, 'cover');
  addRect(slide, 5.10, 0.42, 1.15, 6.66, C.navy, 34);
  addRect(slide, 0, 0, W, 0.06, C.coral, 0);
  addBrand(slide, true, 0.72, 0.56);
  addText(slide, '从实时观测', 0.72, 1.60, 4.25, 0.62, { fontSize: 29, bold: true, color: C.white });
  addText(slide, '到证据研判', 0.72, 2.25, 4.25, 0.62, { fontSize: 29, bold: true, color: C.white });
  addLine(slide, 0.74, 3.18, 0.92, 0, C.coral, 2.6);
  addText(slide, '海洋数据不再是散落的记录，而是一条能回到来源的决策链。', 0.72, 3.52, 3.92, 0.82, {
    fontSize: 12.1, color: 'D3E6E4', valign: 'top', lineSpacingMultiple: 1.12,
  });
  addText(slide, 'REAL PRODUCT UI  /  LIVE OCEAN DATA', 0.72, 5.46, 3.52, 0.20, { fontFace: 'Arial', fontSize: 8.1, bold: true, color: C.cyan });
  addText(slide, 'PRODUCT SHOWCASE  /  2026', 0.72, 6.74, 2.8, 0.18, { fontFace: 'Arial', fontSize: 7.5, bold: true, color: '7FA5A8' });
}

// 02 Signals
{
  const slide = pptx.addSlide('LIGHT');
  addImage(slide, paths.eddy, 6.20, 0, 7.13, H);
  addHeader(slide, 2, 'THE SIGNAL', '海洋正在持续发出信号', '难点不是缺少数据，而是把跨源观测变成可执行判断。', false);
  addText(slide, '海洋变化往往先以微弱、分散、跨尺度的方式出现', 0.64, 2.12, 5.20, 0.58, { fontSize: 16, bold: true, color: C.ink, valign: 'top' });
  const items = [
    ['01', '热浪与冷异常', '温度变化需要时间连续性、误差与历史背景共同解释。'],
    ['02', '中尺度涡与海流变化', '空间结构、持续性与局地背景决定信号是否值得关注。'],
    ['03', '生态与碳循环', '叶绿素、营养盐与 pCO₂ 必须回到深度剖面和来源证据。'],
  ];
  items.forEach((item, i) => {
    const y = 3.05 + i * 1.06;
    addText(slide, item[0], 0.64, y, 0.45, 0.24, { fontFace: 'Arial', fontSize: 9, bold: true, color: C.coral });
    addText(slide, item[1], 1.26, y - 0.04, 2.2, 0.31, { fontSize: 13, bold: true, color: C.ink });
    addText(slide, item[2], 1.26, y + 0.32, 4.10, 0.44, { fontSize: 9.4, color: '58767C', valign: 'top' });
    addLine(slide, 0.64, y + 0.86, 4.72, 0, 'C8D9D8', 0.6);
  });
  addFooter(slide, 2, false, '海洋信号 · 从观测到判断');
}

// 03 Workspace
{
  const slide = pptx.addSlide('LIGHT');
  addHeader(slide, 3, 'ONE WORKSPACE', '一张工作台，连接观测、证据与行动', '把地图、事件、剖面、文献和研判放回同一个业务上下文。', false);
  addText(slide, '实时观测', 0.68, 2.16, 2.4, 0.34, { fontSize: 14, bold: true, color: C.ink });
  addText(slide, '多海域活跃 Argo 网、NOAA 海温与 BGC 变量按来源状态独立展示。', 0.68, 2.58, 2.85, 0.74, { fontSize: 10, color: '5B787E', valign: 'top' });
  addText(slide, '事件研判', 0.68, 3.58, 2.4, 0.34, { fontSize: 14, bold: true, color: C.ink });
  addText(slide, '候选、复核、确认与情景样本明确分层，不把筛查结果包装成结论。', 0.68, 4.00, 2.85, 0.74, { fontSize: 10, color: '5B787E', valign: 'top' });
  addText(slide, '证据追溯', 0.68, 5.00, 2.4, 0.34, { fontSize: 14, bold: true, color: C.ink });
  addText(slide, '每一项判断都能返回观测、质量状态、来源与文献入口。', 0.68, 5.42, 2.85, 0.64, { fontSize: 10, color: '5B787E', valign: 'top' });
  addLine(slide, 3.70, 2.06, 0, 4.55, 'BFD3D2', 0.8);
  addRect(slide, 3.98, 2.04, 8.73, 4.82, C.deep, 0, { color: 'A7C6C5', transparency: 55, width: 0.8 });
  addImage(slide, paths.overview, 4.05, 2.11, 8.59, 4.68, 'cover');
  addPill(slide, '地图即上下文', 4.30, 6.25, 1.35, true, C.cyan);
  addPill(slide, '事件即证据链', 5.82, 6.25, 1.55, true, C.coral);
  addPill(slide, '剖面即现场', 7.55, 6.25, 1.35, true, C.teal);
  addFooter(slide, 3, false, '当前产品界面实拍 · 数据随实时快照变化');
}

// 04 Argo
{
  const slide = pptx.addSlide('DARK');
  addImage(slide, paths.argo, 0, 0, 5.55, H);
  addRect(slide, 0, 0, 5.58, 1.88, C.navy, 32);
  addRect(slide, 4.55, 0, 1.35, H, C.navy, 30);
  addHeader(slide, 4, 'WATER COLUMN', '从海面点下去，直到 2,000 米', '真实 Argo 详情界面把位置、Cycle、变量与质量状态放在同一个现场。', true);
  addMetric(slide, '35 DAYS', '活跃浮标滚动目录', 6.15, 2.02, 1.62, true, C.cyan);
  addMetric(slide, '6 DIGITS', '坐标请求精度', 8.15, 2.02, 1.52, true, C.teal);
  addMetric(slide, 'QC', '调整值优先，原始值回退', 10.12, 2.02, 2.35, true, C.coral);
  addRect(slide, 6.09, 3.22, 4.47, 3.01, C.deep, 0, { color: '45686C', transparency: 10, width: 0.8 });
  addImage(slide, paths.seaProbe, 6.15, 3.28, 4.35, 2.89, 'cover');
  const checks = [
    ['01', '最近浮标', '按球面距离自动匹配'],
    ['02', '变量现状', '温度、盐度与生地化变量'],
    ['03', '可复核状态', '时间、Cycle、缓存与 QC'],
  ];
  checks.forEach((item, i) => {
    const y = 3.35 + i * 0.88;
    addText(slide, item[0], 10.90, y, 0.34, 0.20, { fontFace: 'Arial', fontSize: 7.5, bold: true, color: i === 1 ? C.coral : C.cyan });
    addText(slide, item[1], 11.34, y - 0.05, 1.32, 0.30, { fontSize: 10.8, bold: true, color: C.white });
    addText(slide, item[2], 11.34, y + 0.28, 1.32, 0.40, { fontSize: 7.8, color: '93B3B7', valign: 'top' });
  });
  addFooter(slide, 4, true, '产品界面实拍 · ARGO / BGC-ARGO 水柱详情');
}

// 05 Regions
{
  const slide = pptx.addSlide('LIGHT');
  addHeader(slide, 5, 'GLOBAL VIEW', '六大海域，一套统一的实时工作流', '同一套观测、筛查与证据标准，可在不同海域之间快速切换。', false);
  addRect(slide, 0.60, 2.03, 12.10, 4.10, C.white, 0, { color: 'B9CDCC', transparency: 45, width: 0.8 });
  addImage(slide, paths.globalMap, 0.67, 2.10, 11.96, 3.96, 'cover');
  addRect(slide, 0.67, 5.46, 11.96, 0.60, C.navy, 8);
  const regions = ['西北太平洋', '南海', '印度洋', '北大西洋', '南太平洋', '地中海'];
  regions.forEach((r, i) => {
    const x = 0.89 + i * 1.92;
    addText(slide, String(i + 1).padStart(2, '0'), x, 5.62, 0.28, 0.16, { fontFace: 'Arial', fontSize: 6.8, bold: true, color: C.coral });
    addText(slide, r, x + 0.34, 5.55, 1.45, 0.28, { fontSize: 9.2, bold: true, color: C.white });
  });
  addText(slide, '每个海域独立区分 LIVE / CACHED / SCENARIO 状态', 0.68, 6.34, 4.6, 0.30, { fontFace: 'Arial', fontSize: 9.2, bold: true, color: '3A7773' });
  addText(slide, '来源健康、观测数量与最新时间同步展示', 8.36, 6.34, 4.22, 0.30, { fontSize: 9.2, color: '58767C', align: 'right' });
  addFooter(slide, 5, false, '全球视图 · 六海域实时切换');
}

// 06 Evidence flow
{
  const slide = pptx.addSlide('DARK');
  addHeader(slide, 6, 'CANDIDATE QUEUE', '异常先进候选队列，再进入证据复核', '真实界面明确分开实时观测、异常候选与已确认事件。', true);
  addRect(slide, 0.62, 2.03, 9.28, 3.66, C.deep, 0, { color: '3E6064', transparency: 10, width: 0.8 });
  addImage(slide, paths.queue, 0.68, 2.09, 9.16, 3.52, 'contain');
  const stages = [
    ['01', '观测入列', '记录来源、时间与变量'],
    ['02', '稳健筛查', '不把单点波动当成事件'],
    ['03', '证据复核', '跨源、QC 与历史背景'],
    ['04', '人工确认', '保留不确定性和审核轨迹'],
  ];
  stages.forEach((item, i) => {
    const y = 2.10 + i * 0.94;
    addText(slide, item[0], 10.24, y, 0.34, 0.20, { fontFace: 'Arial', fontSize: 7.4, bold: true, color: i === 3 ? C.coral : C.cyan });
    addText(slide, item[1], 10.72, y - 0.05, 1.70, 0.30, { fontSize: 10.8, bold: true, color: C.white });
    addText(slide, item[2], 10.72, y + 0.28, 1.82, 0.38, { fontSize: 8.0, color: '91B0B4', valign: 'top' });
    if (i < stages.length - 1) addLine(slide, 10.24, y + 0.70, 2.25, 0, '31525A', 0.7);
  });
  addFooter(slide, 6, true, '产品界面实拍 · 候选、复核与确认分层');
}

// 07 Event evidence
{
  const slide = pptx.addSlide('LIGHT');
  addHeader(slide, 7, 'TRACEABLE EVENT', '让每一个候选，都带着来处', '事件页面把观测概览、证据、报告与文献依据放进同一条叙事。', false);
  addRect(slide, 0.62, 2.03, 8.20, 4.75, C.deep, 0, { color: 'A8C2C0', transparency: 48, width: 0.8 });
  addImage(slide, paths.event, 0.69, 2.10, 8.06, 4.61, 'cover');
  const questions = [
    ['01', '发生了什么？', '先描述观测，不抢先给结论。'],
    ['02', '我们怎么知道？', '回到数值、QC、时间与来源。'],
    ['03', '还不确定什么？', '明确证据边界与缺失信息。'],
    ['04', '可以用来做什么？', '把判断转化为下一步行动。'],
  ];
  questions.forEach((q, i) => {
    const y = 2.12 + i * 1.08;
    addText(slide, q[0], 9.20, y, 0.40, 0.22, { fontFace: 'Arial', fontSize: 8, bold: true, color: C.coral });
    addText(slide, q[1], 9.74, y - 0.05, 2.65, 0.30, { fontSize: 12, bold: true, color: C.ink });
    addText(slide, q[2], 9.74, y + 0.33, 2.65, 0.36, { fontSize: 8.8, color: '5D797F', valign: 'top' });
    addLine(slide, 9.20, y + 0.81, 3.15, 0, 'C9D9D8', 0.6);
  });
  addPill(slide, '观测', 9.20, 6.30, 0.72, false, C.teal);
  addPill(slide, '证据', 10.03, 6.30, 0.72, false, C.coral);
  addPill(slide, '研判报告', 10.86, 6.30, 1.02, false, C.amber);
  addPill(slide, '文献依据', 11.99, 6.30, 1.02, false, C.teal);
  addFooter(slide, 7, false, '事件页实拍 · 数据来源与不确定性均可追溯');
}

// 08 Agent
{
  const slide = pptx.addSlide('DARK');
  addHeader(slide, 8, 'OCEAN DATA AGENT', '不只回答，还能检索与记忆', '海洋数据 Agent 在完整索引中检索证据，并保留可控的会话上下文。', true);
  addRect(slide, 0.62, 2.05, 7.25, 4.62, C.deep, 0, { color: '35545B', transparency: 15, width: 0.8 });
  addImage(slide, paths.agent, 0.69, 2.12, 7.11, 4.48, 'cover');
  addText(slide, '四层上下文', 8.32, 2.08, 3.65, 0.36, { fontSize: 15, bold: true, color: C.white });
  const memory = [
    ['01', '完整海洋数据索引', '面向变量、海域、时间、来源和异常候选检索。'],
    ['02', '完整会话历史', 'SQLite 保存消息与证据关联，支持回溯。'],
    ['03', '当前会话摘要', '把长对话压缩为可用工作记忆。'],
    ['04', '长期偏好与指令', '只保存用户明确指定的跨会话记忆。'],
  ];
  memory.forEach((m, i) => {
    const y = 2.64 + i * 0.88;
    addText(slide, m[0], 8.34, y, 0.38, 0.22, { fontFace: 'Arial', fontSize: 8, bold: true, color: i === 3 ? C.coral : C.cyan });
    addText(slide, m[1], 8.88, y - 0.05, 3.72, 0.30, { fontSize: 11.2, bold: true, color: C.mint });
    addText(slide, m[2], 8.88, y + 0.30, 3.72, 0.36, { fontSize: 8.4, color: '8EADB1', valign: 'top' });
  });
  addLine(slide, 8.34, 6.17, 4.10, 0, '31525A', 0.8);
  addText(slide, '答案引用具体记录，而不是只给“看起来合理”的总结。', 8.34, 6.31, 4.05, 0.42, { fontSize: 10.2, bold: true, color: C.white });
  addFooter(slide, 8, true, '海洋数据 Agent · 检索、上下文与长期记忆');
}

// 09 Report and literature
{
  const slide = pptx.addSlide('LIGHT');
  addHeader(slide, 9, 'CONTROLLED MEMORY', '会话、历史与长期偏好，分层而不混用', '真实 Agent 记忆界面：只有用户明确要求保存的内容，才会进入长期记忆。', false);
  addRect(slide, 0.62, 2.05, 7.17, 4.70, C.deep, 0, { color: 'B3CAC8', transparency: 35, width: 0.8 });
  addImage(slide, paths.agentMemory, 0.68, 2.11, 7.05, 4.58, 'contain');
  addText(slide, '四层上下文', 8.20, 2.08, 3.6, 0.36, { fontSize: 14.5, bold: true, color: C.ink });
  const memoryLayers = [
    ['01', '工作记忆', '当前任务、工具结果与待续进状态', C.teal],
    ['02', '待存记忆', '历史会话的 LangGraph 检查点', C.amber],
    ['03', '跨轮记忆', '明确保存的用户关注点与约束', C.teal],
    ['04', '程序性记忆', '长期固化的工作方式与指令', C.coral],
  ];
  memoryLayers.forEach((item, i) => {
    const y = 2.72 + i * 0.88;
    addText(slide, item[0], 8.22, y, 0.34, 0.20, { fontFace: 'Arial', fontSize: 7.2, bold: true, color: item[3] });
    addText(slide, item[1], 8.70, y - 0.05, 1.55, 0.30, { fontSize: 11.2, bold: true, color: C.ink });
    addText(slide, item[2], 10.24, y - 0.03, 2.15, 0.46, { fontSize: 8.1, color: '5B787E', valign: 'top' });
    addLine(slide, 8.22, y + 0.64, 4.15, 0, 'C6D8D7', 0.6);
  });
  addText(slide, '记忆可查看、可管理，也可以保持为空。', 8.22, 6.29, 4.12, 0.34, { fontSize: 9.6, bold: true, color: C.coral });
  addFooter(slide, 9, false, '产品界面实拍 · Agent 会话、历史与长期记忆');
}

// 10 Architecture
{
  const slide = pptx.addSlide('DARK');
  addHeader(slide, 10, 'OPERATION READY', '为真实运行而设计', '从外部数据不稳定，到前端切换海域，系统都保留清晰的失败边界。', true);
  const cols = [
    {
      x: 0.72, label: 'DATA', title: '观测与知识源', color: C.cyan,
      items: ['Argo / BGC-Argo', 'NOAA CoastWatch', 'OpenAlex / Crossref'],
    },
    {
      x: 4.60, label: 'ENGINE', title: '证据计算层', color: C.coral,
      items: ['BFF 实时快照', 'QC 与稳健异常检测', 'Agent 与结构化报告'],
    },
    {
      x: 8.49, label: 'EXPERIENCE', title: '业务工作台', color: C.teal,
      items: ['多海域交互地图', '事件、证据与剖面', '中文研判与文献回链'],
    },
  ];
  cols.forEach((col, i) => {
    addText(slide, col.label, col.x, 2.12, 1.5, 0.20, { fontFace: 'Arial', fontSize: 7.5, bold: true, color: col.color });
    addText(slide, col.title, col.x, 2.44, 3.22, 0.42, { fontSize: 16, bold: true, color: C.white });
    addLine(slide, col.x, 3.01, 3.18, 0, col.color, 2.1);
    col.items.forEach((item, j) => {
      const y = 3.38 + j * 0.63;
      slide.addShape(pptx.ShapeType.ellipse, { x: col.x, y: y + 0.08, w: 0.11, h: 0.11, fill: { color: col.color }, line: { color: col.color, transparency: 100 } });
      addText(slide, item, col.x + 0.24, y, 2.82, 0.28, { fontSize: 10.1, color: C.mist });
    });
    if (i < 2) {
      addLine(slide, col.x + 3.30, 3.01, 0, 2.26, '31535A', 0.8);
      addText(slide, '→', col.x + 3.42, 4.00, 0.28, 0.28, { fontFace: 'Arial', fontSize: 14, color: '668D91', align: 'center' });
    }
  });
  addRect(slide, 0.72, 5.73, 11.85, 0.78, C.deep, 5, { color: '31525A', transparency: 15, width: 0.7 });
  addText(slide, 'SINGLE-FLIGHT', 0.98, 5.88, 1.44, 0.18, { fontFace: 'Arial', fontSize: 7.2, bold: true, color: C.cyan });
  addText(slide, '合并同区域并发读取', 0.98, 6.13, 1.80, 0.20, { fontSize: 8.6, color: C.mist });
  addText(slide, 'STALE-WHILE-REVALIDATE', 3.55, 5.88, 2.02, 0.18, { fontFace: 'Arial', fontSize: 7.2, bold: true, color: C.teal });
  addText(slide, '先返回可信快照，再后台刷新', 3.55, 6.13, 2.28, 0.20, { fontSize: 8.6, color: C.mist });
  addText(slide, 'REQUEST TRACE', 6.76, 5.88, 1.45, 0.18, { fontFace: 'Arial', fontSize: 7.2, bold: true, color: C.coral });
  addText(slide, 'X-Request-ID 与耗时可追踪', 6.76, 6.13, 2.20, 0.20, { fontSize: 8.6, color: C.mist });
  addText(slide, 'ONE DOMAIN', 10.02, 5.88, 1.25, 0.18, { fontFace: 'Arial', fontSize: 7.2, bold: true, color: C.amber });
  addText(slide, '前端、API 与静态资源同源部署', 10.02, 6.13, 2.15, 0.20, { fontSize: 8.6, color: C.mist });
  addFooter(slide, 10, true, '实时数据的不确定性，被工程边界显式管理');
}

// 11 Scenarios
{
  const slide = pptx.addSlide('DARK');
  addImage(slide, paths.eddy, 0, 0, W, H);
  addRect(slide, 0, 0, W, H, C.navy, 30);
  addHeader(slide, 11, 'FROM SIGNAL TO ACTION', '从单点观测，到区域决策', '同一套证据工作流，服务监测、科研与业务研判。', true);
  const scenes = [
    ['01', '实时监测', '快速发现值得关注的海温、海流与生态信号。', '监测机构 / 运行值班'],
    ['02', '科研分析', '从区域异常下钻到现场剖面、变量与文献。', '科研团队 / 高校实验室'],
    ['03', '业务研判', '把跨源证据转化为中文报告与下一步行动。', '沿海治理 / 生态管理'],
  ];
  scenes.forEach((s, i) => {
    const x = 0.72 + i * 4.12;
    addRect(slide, x, 2.42, 3.66, 3.56, C.navy, 20, { color: i === 1 ? C.teal : '89B0B2', transparency: 58, width: 0.9 });
    addText(slide, s[0], x + 0.28, 2.70, 0.46, 0.24, { fontFace: 'Arial', fontSize: 9, bold: true, color: i === 1 ? C.coral : C.cyan });
    addText(slide, s[1], x + 0.28, 3.15, 2.98, 0.42, { fontSize: 18, bold: true, color: C.white });
    addLine(slide, x + 0.28, 3.77, 0.72, 0, i === 1 ? C.coral : C.teal, 2.2);
    addText(slide, s[2], x + 0.28, 4.05, 2.95, 0.82, { fontSize: 10.4, color: C.mist, valign: 'top', lineSpacingMultiple: 1.12 });
    addText(slide, s[3], x + 0.28, 5.38, 2.96, 0.24, { fontSize: 8.2, bold: true, color: '90B5B8' });
  });
  addFooter(slide, 11, true, '面向监测、科研与沿海业务的可执行海洋研判');
}

// 12 Closing
{
  const slide = pptx.addSlide('DARK');
  addImage(slide, paths.horizon, 0, 0, W, H);
  addRect(slide, 0, 0, W, H, C.navy, 32);
  addImage(slide, paths.logo, 6.24, 1.12, 0.84, 0.84, 'contain');
  addText(slide, '让海洋信号', 2.25, 2.36, 8.83, 0.68, { fontSize: 29, bold: true, color: C.white, align: 'center' });
  addText(slide, '更早抵达决策', 2.25, 3.05, 8.83, 0.68, { fontSize: 29, bold: true, color: C.white, align: 'center' });
  addLine(slide, 5.90, 4.04, 1.54, 0, C.coral, 3.0);
  addText(slide, 'OCEAN INTELLIGENCE', 4.12, 4.39, 5.10, 0.30, { fontFace: 'Arial', fontSize: 11, bold: true, color: C.mint, align: 'center' });
  addText(slide, '海洋智能分析平台', 4.12, 4.75, 5.10, 0.30, { fontSize: 11.5, color: C.white, align: 'center' });
  addText(slide, 'REAL-TIME OBSERVATION · GROUNDED EVIDENCE · ACTIONABLE INSIGHT', 2.80, 6.63, 7.73, 0.20, {
    fontFace: 'Arial', fontSize: 7.2, bold: true, color: '8EB1B4', align: 'center',
  });
}

const outDir = path.join(root, 'output', 'ppt', 'ocean-intelligence-product-v3');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'Ocean-Intelligence-Product-Showcase-CN.pptx');

pptx.writeFile({ fileName: outFile, compression: true })
  .then(() => console.log(outFile))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
