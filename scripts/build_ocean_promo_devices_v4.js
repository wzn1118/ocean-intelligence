const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pptxgen = require('pptxgenjs');

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'Ocean Intelligence';
pptx.company = 'Ocean Intelligence';
pptx.subject = '海洋智能平台沉浸式产品展示';
pptx.title = 'Ocean Intelligence - Device Showcase';
pptx.lang = 'zh-CN';
pptx.theme = {
  headFontFace: 'Noto Sans SC',
  bodyFontFace: 'Noto Sans SC',
  lang: 'zh-CN',
};

const W = 13.333;
const H = 7.5;
const C = {
  white: 'FFFFFF',
  ice: 'DCEBEA',
  mist: '91AAAC',
  cyan: '72D8CD',
  teal: '1EA899',
  coral: 'F16C5C',
  amber: 'DDB45B',
  navy: '071719',
  deep: '0D2225',
  ink: '0B1112',
  steel: '30474A',
  silver: '85989A',
};

const root = path.resolve(__dirname, '..');
const first = path.join(root, 'output', 'imagegen', 'image2', 'ocean-promo-ppt');
const second = path.join(root, 'output', 'imagegen', 'image2', 'ocean-promo-fullbleed-v2');
const outputDir = path.join(root, 'output', 'ppt', 'ocean-intelligence-devices-v4');
const derivedDir = path.join(outputDir, 'assets');

const images = {
  cover: path.join(first, 'ocean-cover-intelligence-01.png'),
  eddy: path.join(first, 'living-ocean-eddy-01.png'),
  network: path.join(second, 'global-ocean-observatory-01.png'),
  waterColumn: path.join(first, 'argo-water-column-01.png'),
  fusion: path.join(second, 'ocean-data-fusion-01.png'),
  evidence: path.join(second, 'evidence-current-path-01.png'),
  agentBg: path.join(second, 'ocean-agent-memory-01.png'),
  interpretation: path.join(second, 'scientific-interpretation-deck-01.png'),
  operations: path.join(second, 'ocean-operations-panorama-01.png'),
  horizon: path.join(first, 'ocean-horizon-future-01.png'),
  logo: path.join(root, 'frontend', 'public', 'art', 'brand-offset-mark.png'),
  generatedIcon: path.join(root, 'output', 'imagegen', 'transparent-icons', 'ocean-device-v4', 'ocean-device-frame-01.png'),
  overview: path.join(root, 'frontend', 'output', 'playwright', 'latest-argo-auto-update.png'),
  globalMap: path.join(root, 'output', 'playwright', 'world-map-all-countries-final.png'),
  seaProbe: path.join(root, 'frontend', 'output', 'playwright', 'sea-probe-after.png'),
  queue: path.join(root, 'frontend', 'output', 'playwright', 'event-queue-unified', 'event-queue-night-unified.png'),
  event: path.join(root, 'frontend', 'output', 'playwright', 'event-detail-target-recovered.png'),
  agentDesktop: path.join(root, 'output', 'playwright', 'agent-answer-desktop.png'),
  agentMobile: path.join(root, 'output', 'playwright', 'agent-dark-mobile.png'),
  dataAgentMobile: path.join(root, 'output', 'playwright', 'data-agent-mobile.png'),
  memoryDesktop: path.join(root, 'output', 'playwright', 'agent-four-layer-memory.png'),
  memoryMobile: path.join(root, 'output', 'playwright', 'agent-memory-mobile.png'),
  eventCrop: path.join(derivedDir, 'event-detail-monitor-crop.png'),
};

for (const [name, file] of Object.entries(images)) {
  if (name !== 'eventCrop' && !fs.existsSync(file)) throw new Error(`Missing ${name}: ${file}`);
}

function addText(slide, value, x, y, w, h, opts = {}) {
  const fontFace = opts.fontFace === 'latin' ? 'Bahnschrift' : (opts.fontFace || 'Noto Sans SC');
  slide.addText(value, {
    x, y, w, h,
    fontFace,
    fontSize: opts.fontSize || 16,
    color: opts.color || C.white,
    bold: opts.bold || false,
    margin: opts.margin === undefined ? 0 : opts.margin,
    valign: opts.valign || 'mid',
    align: opts.align || 'left',
    fit: 'shrink',
    breakLine: false,
    paraSpaceAfterPt: 0,
    lineSpacingMultiple: opts.lineSpacingMultiple || 1,
    charSpacing: 0,
    ...opts,
    fontFace,
  });
}

function addRect(slide, x, y, w, h, color, transparency = 0, line = null, radius = false, shadow = null) {
  slide.addShape(radius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
    x, y, w, h,
    fill: { color, transparency },
    line: line || { color, transparency: 100 },
    ...(shadow ? { shadow } : {}),
  });
}

function addLine(slide, x, y, w, h, color = C.steel, width = 1, transparency = 0) {
  slide.addShape(pptx.ShapeType.line, { x, y, w, h, line: { color, width, transparency } });
}

function addBackground(slide, file, darkness = 32) {
  slide.addImage({ path: file, x: 0, y: 0, sizing: { type: 'cover', w: W, h: H } });
  addRect(slide, 0, 0, W, H, C.navy, darkness);
}

function addBrand(slide, x = 0.72, y = 0.48) {
  slide.addImage({ path: images.logo, x, y, w: 0.34, h: 0.34 });
  addText(slide, 'OCEAN INTELLIGENCE', x + 0.46, y + 0.01, 2.6, 0.17, {
    fontFace: 'latin', fontSize: 8.3, bold: true, color: C.ice,
  });
  addText(slide, '海洋智能分析平台', x + 0.46, y + 0.19, 2.6, 0.15, {
    fontSize: 7.7, color: C.mist,
  });
}

function addMeta(slide, page, kicker) {
  addText(slide, `${String(page).padStart(2, '0')}  /  ${kicker}`, 0.72, 0.48, 4.2, 0.18, {
    fontFace: 'latin', fontSize: 8, bold: true, color: C.cyan,
  });
  addText(slide, String(page).padStart(2, '0'), 12.28, 7.08, 0.35, 0.14, {
    fontFace: 'latin', fontSize: 7, bold: true, color: C.mist, align: 'right',
  });
}

function addTitle(slide, title, body, x = 0.72, y = 1.12, w = 3.65) {
  addText(slide, title, x, y, w, 1.15, {
    fontSize: 27, bold: true, color: C.white, valign: 'top', lineSpacingMultiple: 0.98,
  });
  addLine(slide, x, y + 1.27, 0.78, 0, C.coral, 2.6);
  addText(slide, body, x, y + 1.48, w, 0.82, {
    fontSize: 10.8, color: C.ice, valign: 'top', lineSpacingMultiple: 1.12,
  });
}

function createDeviceShadow() {
  return { type: 'outer', color: '000000', opacity: 0.34, blur: 2, angle: 45, distance: 3 };
}

function addMonitor(slide, file, x, y, w, aspect, label = 'REAL PRODUCT UI') {
  const bezel = 0.10;
  const screenW = w - bezel * 2;
  const screenH = screenW / aspect;
  const frameH = screenH + 0.28;
  addRect(slide, x, y, w, frameH, '11191A', 0, { color: '6D8082', transparency: 25, width: 0.9 }, true, createDeviceShadow());
  slide.addImage({ path: file, x: x + bezel, y: y + bezel, w: screenW, h: screenH });
  slide.addShape(pptx.ShapeType.ellipse, {
    x: x + w / 2 - 0.025, y: y + 0.035, w: 0.05, h: 0.05,
    fill: { color: '91A3A5' }, line: { color: '91A3A5', transparency: 100 },
  });
  addText(slide, label, x + 0.24, y + screenH + 0.12, w - 0.48, 0.10, {
    fontFace: 'latin', fontSize: 4.8, bold: true, color: '708487', align: 'center',
  });
  addRect(slide, x + w * 0.455, y + frameH, w * 0.09, 0.30, '263234', 0, { color: '516163', transparency: 35, width: 0.6 });
  addRect(slide, x + w * 0.35, y + frameH + 0.28, w * 0.30, 0.11, '263234', 0, { color: '6D8082', transparency: 45, width: 0.6 }, true);
  return frameH + 0.39;
}

function addPhone(slide, file, x, y, w, screenAspect = 390 / 844) {
  const innerW = w - 0.20;
  const innerH = innerW / screenAspect;
  const phoneH = innerH + 0.30;
  addRect(slide, x, y, w, phoneH, '0A1011', 0, { color: '879496', transparency: 18, width: 0.9 }, true, createDeviceShadow());
  slide.addImage({ path: file, x: x + 0.10, y: y + 0.15, w: innerW, h: innerH });
  addRect(slide, x + w * 0.34, y + 0.05, w * 0.32, 0.09, '050909', 0, { color: '050909', transparency: 100 }, true);
  addRect(slide, x + w * 0.36, y + phoneH - 0.09, w * 0.28, 0.025, '9BA7A8', 20, { color: '9BA7A8', transparency: 100 }, true);
  return phoneH;
}

function addTag(slide, label, x, y, w, accent = C.cyan) {
  addRect(slide, x, y, w, 0.34, C.deep, 18, { color: accent, transparency: 40, width: 0.7 }, true);
  addText(slide, label, x + 0.12, y + 0.03, w - 0.24, 0.26, {
    fontSize: 8.2, bold: true, color: C.white, align: 'center',
  });
}

function addFooter(slide, note) {
  addLine(slide, 0.72, 6.96, 11.90, 0, '698184', 0.55, 45);
  addText(slide, note, 0.72, 7.06, 7.4, 0.14, {
    fontSize: 6.8, color: C.mist,
  });
}

function buildSlides() {
  // 01 Cover
  {
    const slide = pptx.addSlide();
    addBackground(slide, images.cover, 34);
    addRect(slide, 0, 0, 5.25, H, C.navy, 8);
    addRect(slide, 0, 0, W, 0.06, C.coral, 0);
    addBrand(slide, 0.72, 0.52);
    addText(slide, '让海洋信号', 0.72, 1.58, 4.05, 0.62, { fontSize: 29, bold: true });
    addText(slide, '进入真实决策', 0.72, 2.24, 4.25, 0.62, { fontSize: 29, bold: true });
    addLine(slide, 0.72, 3.15, 0.86, 0, C.coral, 2.8);
    addText(slide, '实时观测、证据复核与 Ocean Data Agent，在同一张工作台上连成闭环。', 0.72, 3.48, 3.75, 0.84, {
      fontSize: 11.1, color: C.ice, valign: 'top', lineSpacingMultiple: 1.12,
    });
    addText(slide, 'IMMERSIVE PRODUCT SHOWCASE  /  2026', 0.72, 6.61, 3.4, 0.18, {
      fontFace: 'latin', fontSize: 7.2, bold: true, color: C.mist,
    });
    addMonitor(slide, images.overview, 5.10, 0.82, 7.70, 1.6, 'GLOBAL OCEAN WORKSPACE');
    addPhone(slide, images.agentMobile, 4.48, 2.18, 1.52);
    slide.addImage({ path: images.generatedIcon, x: 4.28, y: 5.70, w: 0.75, h: 0.91 });
  }

  // 02 Workspace
  {
    const slide = pptx.addSlide();
    addBackground(slide, images.eddy, 48);
    addRect(slide, 0, 0, 3.95, H, C.navy, 18);
    addMeta(slide, 2, 'ONE WORKSPACE');
    addTitle(slide, '一张工作台\n看见整片海', '地图、候选、事件、水柱与文献，不再分散在不同页面。');
    addTag(slide, '地图即上下文', 0.72, 4.40, 1.72, C.cyan);
    addTag(slide, '事件即证据链', 0.72, 4.86, 1.72, C.coral);
    addTag(slide, '剖面即现场', 0.72, 5.32, 1.72, C.teal);
    addMonitor(slide, images.overview, 4.10, 1.12, 8.35, 1.6, 'REAL-TIME OCEAN WORKSPACE');
    addPhone(slide, images.dataAgentMobile, 3.42, 2.10, 1.46);
    addFooter(slide, '真实产品界面 · 数据随实时快照变化');
  }

  // 03 Global view
  {
    const slide = pptx.addSlide();
    addBackground(slide, images.network, 42);
    addRect(slide, 0, 0, 4.10, H, C.navy, 12);
    addMeta(slide, 3, 'GLOBAL OBSERVATORY');
    addTitle(slide, '六大海域\n一套实时工作流', '从西北太平洋到地中海，记录保留来源状态和最新时间。');
    addText(slide, '06', 0.72, 4.44, 1.0, 0.44, { fontFace: 'latin', fontSize: 23, bold: true, color: C.cyan });
    addText(slide, '独立海域', 1.60, 4.50, 1.4, 0.28, { fontSize: 10, bold: true });
    addText(slide, 'LIVE / CACHED / SCENARIO', 0.72, 5.08, 2.8, 0.22, { fontFace: 'latin', fontSize: 8, bold: true, color: C.coral });
    addMonitor(slide, images.globalMap, 4.45, 1.12, 8.05, 1.6, 'GLOBAL OCEAN VIEW');
    addFooter(slide, '全球视图 · 六海域状态与观测数量同步展示');
  }

  // 04 Water column + mobile question
  {
    const slide = pptx.addSlide();
    addBackground(slide, images.waterColumn, 38);
    addRect(slide, 0, 0, 4.38, H, C.navy, 18);
    addMeta(slide, 4, 'WATER COLUMN');
    addTitle(slide, '从海面下钻\n也能随手追问', '桌面端展开 Argo 浮标详情，移动端 Agent 继续追问变量和来源。');
    addText(slide, 'POSITION  /  CYCLE  /  QC', 0.72, 4.62, 2.7, 0.20, { fontFace: 'latin', fontSize: 8, bold: true, color: C.cyan });
    addText(slide, '温度  ·  盐度  ·  叶绿素 a  ·  硝酸盐', 0.72, 5.02, 3.2, 0.28, { fontSize: 9.4, bold: true, color: C.ice });
    addMonitor(slide, images.seaProbe, 5.20, 1.32, 6.70, 650 / 432, 'ARGO FLOAT DETAIL');
    addPhone(slide, images.dataAgentMobile, 4.34, 1.88, 1.50);
    addFooter(slide, '真实产品界面 · Argo 浮标详情与移动端问答');
  }

  // 05 Candidate queue
  {
    const slide = pptx.addSlide();
    addBackground(slide, images.fusion, 52);
    addRect(slide, 0, 0, 4.18, H, C.navy, 16);
    addMeta(slide, 5, 'CANDIDATE QUEUE');
    addTitle(slide, '异常先入队\n再进入证据复核', '筛查结果不被包装成结论；它们先进入候选队列，等待跨源和人工复核。');
    addTag(slide, '观测入列', 0.72, 4.48, 1.30, C.cyan);
    addTag(slide, '稳健筛查', 2.16, 4.48, 1.30, C.teal);
    addTag(slide, '人工确认', 0.72, 4.94, 1.30, C.coral);
    addMonitor(slide, images.queue, 4.35, 1.58, 8.20, 1295 / 496, 'ANOMALY CANDIDATE QUEUE');
    addFooter(slide, '真实产品界面 · 实时观测、异常候选与事件明确分层');
  }

  // 06 Traceable event
  {
    const slide = pptx.addSlide();
    addBackground(slide, images.evidence, 48);
    addRect(slide, 0, 0, 4.22, H, C.navy, 12);
    addMeta(slide, 6, 'TRACEABLE EVENT');
    addTitle(slide, '每一个候选\n都带着来处', '观测概览、证据、研判报告与文献依据，在同一个事件页面里闭环。');
    addText(slide, '发生了什么？', 0.72, 4.45, 2.0, 0.27, { fontSize: 10.2, bold: true, color: C.cyan });
    addText(slide, '我们怎么知道？', 0.72, 4.88, 2.2, 0.27, { fontSize: 10.2, bold: true, color: C.white });
    addText(slide, '还不确定什么？', 0.72, 5.31, 2.2, 0.27, { fontSize: 10.2, bold: true, color: C.coral });
    addMonitor(slide, images.eventCrop, 4.45, 1.05, 8.05, 1.6, 'TRACEABLE EVENT EVIDENCE');
    slide.addImage({ path: images.generatedIcon, x: 3.35, y: 5.70, w: 0.62, h: 0.75 });
    addFooter(slide, '真实产品界面 · 来源、QC、不确定性与文献入口可追溯');
  }

  // 07 Agent
  {
    const slide = pptx.addSlide();
    addBackground(slide, images.agentBg, 54);
    addRect(slide, 0, 0, 4.18, H, C.navy, 12);
    addMeta(slide, 7, 'OCEAN DATA AGENT');
    addTitle(slide, 'Agent 不只回答\n还展示依据', '完整索引检索变量、海域、时间和来源，答案直接引用具体观测记录。');
    addText(slide, '2,825', 0.72, 4.44, 1.2, 0.40, { fontFace: 'latin', fontSize: 21, bold: true, color: C.amber });
    addText(slide, '完整海洋索引', 1.78, 4.50, 1.8, 0.25, { fontSize: 9.4, bold: true });
    addText(slide, 'FULL INDEX  /  GROUNDED ANSWER', 0.72, 5.10, 2.9, 0.20, { fontFace: 'latin', fontSize: 7.7, bold: true, color: C.cyan });
    addMonitor(slide, images.agentDesktop, 4.38, 1.05, 8.05, 1.5, 'OCEAN DATA AGENT');
    addPhone(slide, images.agentMobile, 3.52, 1.82, 1.48);
    addFooter(slide, '真实产品界面 · 桌面与移动端 Agent');
  }

  // 08 Controlled memory
  {
    const slide = pptx.addSlide();
    addBackground(slide, images.interpretation, 56);
    addRect(slide, 0, 0, 4.20, H, C.navy, 12);
    addMeta(slide, 8, 'CONTROLLED MEMORY');
    addTitle(slide, '记忆分层\n可见、可控', '工作记忆、历史会话、跨轮记忆与程序性指令互不混用。');
    addTag(slide, '工作记忆', 0.72, 4.42, 1.30, C.cyan);
    addTag(slide, '会话历史', 2.16, 4.42, 1.30, C.teal);
    addTag(slide, '长期偏好', 0.72, 4.88, 1.30, C.coral);
    addMonitor(slide, images.memoryDesktop, 4.42, 1.05, 7.98, 1.5, 'CONTROLLED AGENT MEMORY');
    addPhone(slide, images.memoryMobile, 3.55, 1.82, 1.46);
    addFooter(slide, '真实产品界面 · 只保存用户明确指定的跨会话记忆');
  }

  // 09 Desktop + mobile workflow
  {
    const slide = pptx.addSlide();
    addBackground(slide, images.operations, 44);
    addRect(slide, 0, 0, W, 1.32, C.navy, 22);
    addMeta(slide, 9, 'DESKTOP + MOBILE');
    addText(slide, '同一套能力，适配桌面与移动端', 0.72, 0.82, 8.2, 0.48, { fontSize: 24.5, bold: true });
    addMonitor(slide, images.overview, 2.75, 1.42, 8.30, 1.6, 'DESKTOP OPERATIONS');
    addPhone(slide, images.dataAgentMobile, 10.35, 1.82, 1.54);
    addPhone(slide, images.agentMobile, 1.65, 2.05, 1.42);
    addTag(slide, '实时监测', 4.13, 6.28, 1.34, C.cyan);
    addTag(slide, '科研分析', 5.72, 6.28, 1.34, C.teal);
    addTag(slide, '业务研判', 7.31, 6.28, 1.34, C.coral);
    addFooter(slide, '外海监测、科研分析与近岸治理共用同一条证据工作流');
  }

  // 10 Closing
  {
    const slide = pptx.addSlide();
    addBackground(slide, images.horizon, 28);
    addRect(slide, 0, 0, W, H, C.navy, 26);
    slide.addImage({ path: images.generatedIcon, x: 6.04, y: 0.82, w: 1.18, h: 1.43 });
    addText(slide, '让海洋信号', 2.45, 2.40, 8.43, 0.60, { fontSize: 29, bold: true, align: 'center' });
    addText(slide, '更早抵达决策', 2.45, 3.08, 8.43, 0.60, { fontSize: 29, bold: true, align: 'center' });
    addLine(slide, 5.92, 4.02, 1.50, 0, C.coral, 2.8);
    addText(slide, 'OCEAN INTELLIGENCE', 4.20, 4.34, 4.93, 0.26, { fontFace: 'latin', fontSize: 10, bold: true, color: C.cyan, align: 'center' });
    addText(slide, '海洋智能分析平台', 4.20, 4.67, 4.93, 0.24, { fontSize: 10.2, color: C.ice, align: 'center' });
    addText(slide, 'REAL-TIME OBSERVATION  /  GROUNDED EVIDENCE  /  ACTIONABLE INSIGHT', 3.10, 6.66, 7.15, 0.16, {
      fontFace: 'latin', fontSize: 6.8, bold: true, color: C.mist, align: 'center',
    });
  }
}

async function main() {
  fs.mkdirSync(derivedDir, { recursive: true });
  await sharp(images.event)
    .extract({ left: 0, top: 0, width: 1440, height: 900 })
    .png()
    .toFile(images.eventCrop);
  buildSlides();
  const outFile = path.join(outputDir, 'Ocean-Intelligence-Immersive-Devices-CN.pptx');
  await pptx.writeFile({ fileName: outFile, compression: true });
  console.log(outFile);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
