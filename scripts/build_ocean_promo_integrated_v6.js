const fs = require('fs');
const path = require('path');
const pptxgen = require('pptxgenjs');

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'Ocean Intelligence';
pptx.company = 'Ocean Intelligence';
pptx.subject = 'OpenQI 一体化设备场景与真实产品界面宣传演示';
pptx.title = '让海洋的每一次变化都有证据可循';
pptx.lang = 'zh-CN';
pptx.theme = {
  headFontFace: 'DengXian',
  bodyFontFace: 'DengXian',
  lang: 'zh-CN',
};

const W = 13.333;
const H = 7.5;
const C = {
  white: 'FFFFFF',
  ice: 'DDF8F3',
  cyan: '78E5D6',
  coral: 'FF6A55',
  navy: '071A23',
  deep: '0B2731',
  mist: 'A9C7C8',
  darkMuted: '52737A',
};

const root = path.resolve(__dirname, '..');
const first = path.join(root, 'output', 'imagegen', 'image2', 'ocean-promo-ppt');
const second = path.join(root, 'output', 'imagegen', 'image2', 'ocean-promo-fullbleed-v2');
const integrated = path.join(root, 'output', 'imagegen', 'openqi', 'ocean-integrated-scenes-v6');
const outputDir = path.join(root, 'output', 'ppt', 'ocean-intelligence-openqi-v6');
const outputFile = path.join(outputDir, 'Ocean-Intelligence-OpenQI-Integrated-CN.pptx');

const images = {
  cover: path.join(integrated, 'cover', 'cover-with-real-ui.png'),
  signal: path.join(first, 'living-ocean-eddy-01.png'),
  network: path.join(second, 'global-ocean-observatory-01.png'),
  waterColumn: path.join(first, 'argo-water-column-01.png'),
  fusion: path.join(second, 'ocean-data-fusion-01.png'),
  evidence: path.join(second, 'evidence-current-path-01.png'),
  agent: path.join(integrated, 'agent', 'agent-with-real-ui.png'),
  interpretation: path.join(second, 'scientific-interpretation-deck-01.png'),
  operations: path.join(integrated, 'operations', 'operations-with-real-ui.png'),
  horizon: path.join(first, 'ocean-horizon-future-01.png'),
  logo: path.join(root, 'frontend', 'public', 'art', 'brand-offset-mark.png'),
};

for (const [name, file] of Object.entries(images)) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${name}: ${file}`);
}

function background(slide, file) {
  slide.addImage({ path: file, x: 0, y: 0, sizing: { type: 'cover', w: W, h: H } });
}

function backgroundExact(slide, file) {
  slide.addImage({ path: file, x: 0, y: 0, w: W, h: H });
}

function text(slide, value, x, y, w, h, opts = {}) {
  const fontFace = opts.fontFace || 'DengXian';
  const isBold = opts.heading || opts.bold === true;
  slide.addText(value, {
    x, y, w, h,
    fontFace,
    fontSize: opts.fontSize || 18,
    color: opts.color || C.white,
    bold: isBold,
    margin: opts.margin === undefined ? 0 : opts.margin,
    valign: opts.valign || 'mid',
    align: opts.align || 'left',
    fit: 'shrink',
    charSpacing: 0,
    breakLine: false,
    paraSpaceAfterPt: 0,
    lineSpacingMultiple: opts.lineSpacingMultiple || 1,
    ...opts,
    fontFace,
    bold: isBold,
  });
}

function line(slide, x, y, w, color = C.coral, width = 2.4) {
  slide.addShape(pptx.ShapeType.line, { x, y, w, h: 0, line: { color, width } });
}

function meta(slide, page, label, side = 'left', darkText = false) {
  const x = side === 'right' ? 7.18 : 0.72;
  text(slide, `${String(page).padStart(2, '0')}  /  ${label}`, x, 0.47, 4.9, 0.20, {
    fontFace: 'Bahnschrift', fontSize: 8.2, color: darkText ? C.deep : C.cyan,
  });
  text(slide, String(page).padStart(2, '0'), 12.25, 7.08, 0.36, 0.14, {
    fontFace: 'Bahnschrift', fontSize: 7.2,
    color: darkText ? C.darkMuted : '7AA3A7', align: 'right',
  });
}

function wordmark(slide, x, y, darkText = false, align = 'left') {
  slide.addImage({ path: images.logo, x, y: y + 0.01, w: 0.34, h: 0.34 });
  text(slide, 'OCEAN INTELLIGENCE', x + 0.46, y, 3.0, 0.20, {
    fontFace: 'Bahnschrift', fontSize: 8.5,
    color: darkText ? C.deep : C.ice, align,
  });
  text(slide, '海洋智能分析平台', x + 0.46, y + 0.23, 3.0, 0.20, {
    fontSize: 8.4, color: darkText ? C.darkMuted : C.mist, align,
  });
}

function heading(slide, value, x, y, w, h = 0.66, opts = {}) {
  text(slide, value, x, y, w, h, { heading: true, fontSize: opts.fontSize || 30, color: opts.color || C.white, align: opts.align || 'left' });
}

// 01 / Cover: OpenQI integrated laptop + phone, real product UI.
{
  const slide = pptx.addSlide();
  backgroundExact(slide, images.cover);
  wordmark(slide, 0.72, 0.54);
  heading(slide, '让海洋的每一次变化', 0.72, 1.46, 5.55, 0.66, { fontSize: 31.5 });
  heading(slide, '都有证据可循', 0.72, 2.16, 4.90, 0.66, { fontSize: 31.5 });
  line(slide, 0.72, 3.10, 0.80);
  text(slide, '实时观测  ×  科学模型  ×  证据约束 Agent', 0.72, 3.38, 5.20, 0.30, { fontSize: 12.2, color: C.cyan });
  text(slide, '把分散的海洋数据，转化为可复核、可解释、可执行的中文科学研判。', 0.72, 4.02, 5.15, 0.60, { fontSize: 10.9, color: C.ice, valign: 'top', lineSpacingMultiple: 1.12 });
  text(slide, 'OPENQI INTEGRATED EDITION  /  2026', 0.72, 6.78, 3.25, 0.16, { fontFace: 'Bahnschrift', fontSize: 7.2, color: '82A7AA' });
}

// 02 / Signal
{
  const slide = pptx.addSlide();
  background(slide, images.signal);
  meta(slide, 2, 'THE SIGNAL');
  heading(slide, '海洋正在持续发出信号', 0.72, 1.12, 5.35, 0.72, { fontSize: 30.5 });
  line(slide, 0.72, 2.02, 0.72);
  text(slide, '它们往往微弱、分散、跨尺度。真正困难的，是判断哪些变化值得行动。', 0.72, 2.30, 4.75, 0.82, { fontSize: 11.8, color: C.ice, valign: 'top', lineSpacingMultiple: 1.12 });
  text(slide, '热浪  ·  冷异常  ·  中尺度涡  ·  生态与碳循环', 0.72, 5.98, 5.20, 0.28, { fontSize: 10.0, color: C.cyan });
  text(slide, '从“看见变化”到“理解变化”', 0.72, 6.34, 3.65, 0.24, { fontSize: 8.9, color: C.mist });
}

// 03 / Global network
{
  const slide = pptx.addSlide();
  background(slide, images.network);
  meta(slide, 3, 'GLOBAL OBSERVATORY');
  heading(slide, '六大海域', 0.72, 1.14, 4.75, 0.64);
  heading(slide, '一张会呼吸的观测网', 0.72, 1.80, 5.35, 0.64);
  line(slide, 0.72, 2.67, 0.72);
  text(slide, '从西北太平洋到地中海，同一套标准持续读取海面的变化，也下钻到水柱深处。', 0.72, 2.96, 4.70, 0.78, { fontSize: 11.2, color: C.ice, valign: 'top', lineSpacingMultiple: 1.12 });
  text(slide, '西北太平洋  ·  南海  ·  印度洋', 0.72, 5.70, 4.45, 0.28, { fontSize: 9.8, color: C.cyan });
  text(slide, '北大西洋  ·  南太平洋  ·  地中海', 0.72, 6.08, 4.45, 0.28, { fontSize: 9.8, color: C.cyan });
  text(slide, 'LIVE / CACHED / SCENARIO', 0.72, 6.52, 2.85, 0.20, { fontFace: 'Bahnschrift', fontSize: 7.8, color: C.mist });
}

// 04 / Water column
{
  const slide = pptx.addSlide();
  background(slide, images.waterColumn);
  meta(slide, 4, 'WATER COLUMN', 'right');
  heading(slide, '从海面到 2,000 米', 7.18, 1.10, 5.35, 0.66);
  heading(slide, '每一层都在讲述变化', 7.18, 1.78, 5.15, 0.66);
  line(slide, 7.18, 2.65, 0.72);
  text(slide, '一次海面点击，展开最近浮标的完整水柱：位置、Cycle、深度、变量与质量状态全部可见。', 7.18, 2.94, 4.72, 0.92, { fontSize: 11.0, color: C.ice, valign: 'top', lineSpacingMultiple: 1.12 });
  text(slide, '温度  ·  盐度  ·  叶绿素 a  ·  硝酸盐', 7.18, 5.70, 4.65, 0.28, { fontSize: 9.8, color: C.cyan });
  text(slide, '逐点 QC  /  调整值优先  /  原始值回退', 7.18, 6.10, 4.65, 0.24, { fontSize: 7.6, color: C.mist });
}

// 05 / Data fusion
{
  const slide = pptx.addSlide();
  background(slide, images.fusion);
  meta(slide, 5, 'ONE OCEAN · MANY SOURCES', 'right');
  heading(slide, '把卫星、浮标与生地化观测', 7.58, 1.12, 5.05, 0.66, { fontSize: 28.5 });
  heading(slide, '汇成同一片海', 7.58, 1.80, 4.55, 0.66, { fontSize: 28.5 });
  line(slide, 7.58, 2.66, 0.72);
  text(slide, '平台不把数据源摊成表格，而是在同一个时间、位置与证据上下文中解释它们。', 7.58, 2.96, 4.55, 0.84, { fontSize: 11.0, color: C.ice, valign: 'top', lineSpacingMultiple: 1.12 });
  text(slide, 'SATELLITE  /  SEA SURFACE', 7.58, 5.38, 3.55, 0.20, { fontFace: 'Bahnschrift', fontSize: 7.7, color: C.cyan });
  text(slide, 'ARGO  /  WATER COLUMN', 7.58, 5.78, 3.55, 0.20, { fontFace: 'Bahnschrift', fontSize: 7.7, color: C.cyan });
  text(slide, 'BGC  /  LIVING OCEAN', 7.58, 6.18, 3.55, 0.20, { fontFace: 'Bahnschrift', fontSize: 7.7, color: C.cyan });
}

// 06 / Evidence chain
{
  const slide = pptx.addSlide();
  background(slide, images.evidence);
  meta(slide, 6, 'EVIDENCE CHAIN');
  heading(slide, '异常不是结论', 0.72, 1.12, 4.95, 0.66);
  heading(slide, '证据链才是', 0.72, 1.80, 4.40, 0.66);
  line(slide, 0.72, 2.67, 0.72);
  text(slide, '每一步都保留来源、时间、单位、质量与不确定性，让判断可以被复核，而不是只显得“像结论”。', 0.72, 2.96, 4.55, 0.98, { fontSize: 10.9, color: C.ice, valign: 'top', lineSpacingMultiple: 1.12 });
  text(slide, '观测  →  QC  →  检测  →  复核  →  研判', 0.72, 5.78, 4.78, 0.32, { fontSize: 10.0, color: C.cyan });
  text(slide, 'EVIDENCE ID  /  LITERATURE ID  /  PROVENANCE', 0.72, 6.22, 4.95, 0.20, { fontFace: 'Bahnschrift', fontSize: 7.2, color: C.mist });
}

// 07 / Agent: OpenQI integrated laptop + phone, real Agent UI.
{
  const slide = pptx.addSlide();
  backgroundExact(slide, images.agent);
  meta(slide, 7, 'OCEAN DATA AGENT');
  heading(slide, '一个真正懂海洋上下文的', 0.72, 1.08, 5.20, 0.64, { fontSize: 28.5 });
  heading(slide, 'Agent', 0.72, 1.72, 3.35, 0.72, { fontSize: 31, color: C.cyan });
  line(slide, 0.72, 2.68, 0.72);
  text(slide, '它在完整海洋索引里检索证据，答案直接引用具体观测记录，也记得用户明确保存的长期偏好。', 0.72, 2.96, 4.65, 0.92, { fontSize: 10.9, color: C.ice, valign: 'top', lineSpacingMultiple: 1.12 });
  text(slide, '完整索引  ·  会话历史  ·  工作记忆  ·  长期偏好', 0.72, 5.78, 4.85, 0.28, { fontSize: 9.8, color: C.cyan });
  text(slide, 'GROUNDED ANSWER  /  CONTROLLED MEMORY', 0.72, 6.20, 4.30, 0.18, { fontFace: 'Bahnschrift', fontSize: 7.3, color: C.mist });
}

// 08 / Scientific interpretation
{
  const slide = pptx.addSlide();
  background(slide, images.interpretation);
  meta(slide, 8, 'GROUNDED INTERPRETATION', 'right');
  heading(slide, '让每一项判断', 7.40, 1.10, 4.75, 0.64);
  heading(slide, '都回到证据', 7.40, 1.78, 4.55, 0.64);
  line(slide, 7.40, 2.65, 0.72);
  text(slide, '机制判断关联观测证据，文献依据保留 DOI 与原文入口，结论始终带着来源与边界。', 7.40, 2.94, 4.48, 0.92, { fontSize: 11.0, color: C.ice, valign: 'top', lineSpacingMultiple: 1.12 });
  text(slide, '证据绑定', 7.40, 5.30, 1.45, 0.28, { fontSize: 10.0, color: C.cyan });
  text(slide, '文献回链', 8.98, 5.30, 1.45, 0.28, { fontSize: 10.0, color: C.cyan });
  text(slide, '来源透明', 10.56, 5.30, 1.45, 0.28, { fontSize: 10.0, color: C.coral });
  text(slide, '输出不是“AI 观点”，而是一份可复核的中文科学研判。', 7.40, 5.88, 4.70, 0.46, { fontSize: 9.8, color: C.ice });
}

// 09 / Operations: OpenQI integrated laptop + phone, real product UI.
{
  const slide = pptx.addSlide();
  backgroundExact(slide, images.operations);
  meta(slide, 9, 'FROM SIGNAL TO ACTION');
  heading(slide, '从单点观测', 0.72, 1.06, 4.80, 0.66);
  heading(slide, '到区域决策', 0.72, 1.74, 4.50, 0.66);
  line(slide, 0.72, 2.60, 0.72);
  text(slide, '一套连续的证据工作流，连接外海监测、科学研究与近岸治理。', 0.72, 2.90, 5.20, 0.70, { fontSize: 11.2, color: C.ice, valign: 'top', lineSpacingMultiple: 1.12 });
  text(slide, '实时监测  ·  科研分析  ·  业务研判', 0.72, 5.94, 4.40, 0.30, { fontSize: 10.0, color: C.cyan });
}

// 10 / Closing
{
  const slide = pptx.addSlide();
  background(slide, images.horizon);
  heading(slide, '让海洋信号', 3.12, 1.63, 7.10, 0.67, { fontSize: 31, color: C.deep, align: 'center' });
  heading(slide, '更早抵达决策', 3.12, 2.34, 7.10, 0.67, { fontSize: 31, color: C.deep, align: 'center' });
  line(slide, 6.22, 3.24, 0.90);
  text(slide, 'OCEAN INTELLIGENCE', 4.54, 3.48, 4.26, 0.26, { fontFace: 'Bahnschrift', fontSize: 9.2, color: C.deep, align: 'center' });
  text(slide, '海洋智能分析平台', 4.54, 3.82, 4.26, 0.26, { fontSize: 9.4, color: C.darkMuted, align: 'center' });
  text(slide, 'REAL-TIME OBSERVATION  ·  GROUNDED EVIDENCE  ·  ACTIONABLE INSIGHT', 3.12, 6.72, 7.10, 0.18, { fontFace: 'Bahnschrift', fontSize: 6.9, color: C.darkMuted, align: 'center' });
}

fs.mkdirSync(outputDir, { recursive: true });
pptx.writeFile({ fileName: outputFile })
  .then(() => console.log(outputFile))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
