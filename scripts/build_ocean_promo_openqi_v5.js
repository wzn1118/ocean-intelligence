const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pptxgen = require('pptxgenjs');

const root = path.resolve(__dirname, '..');
const first = path.join(root, 'output', 'imagegen', 'image2', 'ocean-promo-ppt');
const second = path.join(root, 'output', 'imagegen', 'image2', 'ocean-promo-fullbleed-v2');
const outputDir = path.join(root, 'output', 'ppt', 'ocean-intelligence-openqi-v5');
const assetsDir = path.join(outputDir, 'assets');
const pptxPath = path.join(outputDir, 'Ocean-Intelligence-OpenQI-Devices-CN.pptx');

const images = {
  cover: path.join(first, 'ocean-cover-intelligence-01.png'),
  signal: path.join(first, 'living-ocean-eddy-01.png'),
  network: path.join(second, 'global-ocean-observatory-01.png'),
  waterColumn: path.join(first, 'argo-water-column-01.png'),
  fusion: path.join(second, 'ocean-data-fusion-01.png'),
  evidence: path.join(second, 'evidence-current-path-01.png'),
  agent: path.join(second, 'ocean-agent-memory-01.png'),
  interpretation: path.join(second, 'scientific-interpretation-deck-01.png'),
  operations: path.join(second, 'ocean-operations-panorama-01.png'),
  horizon: path.join(first, 'ocean-horizon-future-01.png'),
  logo: path.join(root, 'frontend', 'public', 'art', 'brand-offset-mark.png'),
  monitorFrame: path.join(root, 'output', 'imagegen', 'openqi', 'ocean-device-v5', 'monitor', 'openqi-image-20260827-020040-460520200-1.png'),
  phoneFrame: path.join(root, 'output', 'imagegen', 'openqi', 'ocean-device-v5', 'phone', 'openqi-image-20260827-020044-074378800-1.png'),
};

const screenshots = {
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
};

for (const [name, file] of Object.entries({ ...images, ...screenshots })) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${name}: ${file}`);
}

const deviceImages = {
  overview: path.join(assetsDir, 'monitor-overview.png'),
  globalMap: path.join(assetsDir, 'monitor-global-map.png'),
  seaProbe: path.join(assetsDir, 'monitor-sea-probe.png'),
  queue: path.join(assetsDir, 'monitor-queue.png'),
  event: path.join(assetsDir, 'monitor-event.png'),
  agentDesktop: path.join(assetsDir, 'monitor-agent.png'),
  memoryDesktop: path.join(assetsDir, 'monitor-memory.png'),
  agentMobile: path.join(assetsDir, 'phone-agent.png'),
  dataAgentMobile: path.join(assetsDir, 'phone-data-agent.png'),
  memoryMobile: path.join(assetsDir, 'phone-memory.png'),
};

async function replaceGreenScreen(framePath, screenshotPath, outputPath) {
  const { data: frame, info } = await sharp(framePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const strengths = new Uint8Array(info.width * info.height);
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const pixel = y * info.width + x;
      const offset = pixel * 4;
      const r = frame[offset];
      const g = frame[offset + 1];
      const b = frame[offset + 2];
      const a = frame[offset + 3];
      const delta = g - Math.max(r, b);
      const strength = a > 12 && g > 80 && delta > 24
        ? Math.max(0, Math.min(255, Math.round((delta - 24) * 3.2)))
        : 0;
      strengths[pixel] = strength;
      if (strength > 150) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX <= minX || maxY <= minY) throw new Error(`No green screen found in ${framePath}`);
  const screenW = maxX - minX + 1;
  const screenH = maxY - minY + 1;

  const blurred = await sharp(screenshotPath)
    .resize(screenW, screenH, { fit: 'cover', position: 'north' })
    .blur(18)
    .modulate({ brightness: 0.48, saturation: 0.82 })
    .png()
    .toBuffer();
  const contained = await sharp(screenshotPath)
    .resize(screenW, screenH, {
      fit: 'contain',
      position: 'centre',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  const screen = await sharp(blurred)
    .composite([{ input: contained }])
    .ensureAlpha()
    .raw()
    .toBuffer();
  const output = Buffer.from(frame);

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const pixel = y * info.width + x;
      const strength = strengths[pixel] / 255;
      if (strength <= 0) continue;
      const frameOffset = pixel * 4;
      const screenOffset = ((y - minY) * screenW + (x - minX)) * 4;
      output[frameOffset] = Math.round(frame[frameOffset] * (1 - strength) + screen[screenOffset] * strength);
      output[frameOffset + 1] = Math.round(frame[frameOffset + 1] * (1 - strength) + screen[screenOffset + 1] * strength);
      output[frameOffset + 2] = Math.round(frame[frameOffset + 2] * (1 - strength) + screen[screenOffset + 2] * strength);
    }
  }

  await sharp(output, { raw: info }).png().toFile(outputPath);
}

async function prepareAssets() {
  fs.mkdirSync(assetsDir, { recursive: true });
  const eventMeta = await sharp(screenshots.event).metadata();
  const eventCrop = path.join(assetsDir, 'event-detail-crop.png');
  await sharp(screenshots.event)
    .extract({ left: 0, top: 0, width: eventMeta.width, height: Math.min(eventMeta.height, Math.round(eventMeta.width / 1.6)) })
    .png()
    .toFile(eventCrop);

  const jobs = [
    [images.monitorFrame, screenshots.overview, deviceImages.overview],
    [images.monitorFrame, screenshots.globalMap, deviceImages.globalMap],
    [images.monitorFrame, screenshots.seaProbe, deviceImages.seaProbe],
    [images.monitorFrame, screenshots.queue, deviceImages.queue],
    [images.monitorFrame, eventCrop, deviceImages.event],
    [images.monitorFrame, screenshots.agentDesktop, deviceImages.agentDesktop],
    [images.monitorFrame, screenshots.memoryDesktop, deviceImages.memoryDesktop],
    [images.phoneFrame, screenshots.agentMobile, deviceImages.agentMobile],
    [images.phoneFrame, screenshots.dataAgentMobile, deviceImages.dataAgentMobile],
    [images.phoneFrame, screenshots.memoryMobile, deviceImages.memoryMobile],
  ];
  for (const job of jobs) await replaceGreenScreen(...job);
}

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'Ocean Intelligence';
pptx.company = 'Ocean Intelligence';
pptx.subject = 'OpenQI 生成设备与真实产品界面宣传演示';
pptx.title = 'Ocean Intelligence - OpenQI Device Showcase';
pptx.lang = 'zh-CN';
pptx.theme = {
  headFontFace: 'Noto Sans SC Bold',
  bodyFontFace: 'Noto Sans SC Medium',
  lang: 'zh-CN',
};

const W = 13.333;
const H = 7.5;
const C = {
  white: 'FFFFFF', ice: 'DDF8F3', cyan: '78E5D6', teal: '2BC4B2',
  coral: 'FF6A55', navy: '071A23', deep: '0B2731', mist: 'A9C7C8',
};

function rect(slide, x, y, w, h, color, transparency = 0) {
  slide.addShape(pptx.ShapeType.rect, {
    x, y, w, h,
    fill: { color, transparency },
    line: { color, transparency: 100 },
  });
}

function background(slide, file, darkness = 0) {
  slide.addImage({ path: file, x: 0, y: 0, sizing: { type: 'cover', w: W, h: H } });
  if (darkness > 0) rect(slide, 0, 0, W, H, C.navy, 100 - darkness);
}

function text(slide, value, x, y, w, h, opts = {}) {
  const face = opts.fontFace || (opts.heading ? 'Noto Sans SC Bold' : 'Noto Sans SC Medium');
  slide.addText(value, {
    x, y, w, h,
    fontFace: face,
    fontSize: opts.fontSize || 16,
    color: opts.color || C.white,
    bold: false,
    margin: opts.margin === undefined ? 0 : opts.margin,
    valign: opts.valign || 'mid',
    align: opts.align || 'left',
    fit: 'shrink',
    charSpacing: 0,
    breakLine: false,
    paraSpaceAfterPt: 0,
    lineSpacingMultiple: opts.lineSpacingMultiple || 1,
    ...opts,
    fontFace: face,
    bold: false,
  });
}

function meta(slide, page, label, side = 'left', dark = false) {
  const x = side === 'right' ? 7.28 : 0.72;
  text(slide, `${String(page).padStart(2, '0')}  /  ${label}`, x, 0.47, 4.6, 0.20, {
    fontFace: 'Bahnschrift', fontSize: 8.2, color: dark ? C.deep : C.cyan,
  });
  text(slide, String(page).padStart(2, '0'), 12.25, 7.08, 0.36, 0.14, {
    fontFace: 'Bahnschrift', fontSize: 7.2, color: dark ? '52737A' : '7AA3A7', align: 'right',
  });
}

function wordmark(slide, x = 0.72, y = 0.50, dark = false) {
  slide.addImage({ path: images.logo, x, y: y + 0.02, w: 0.34, h: 0.34 });
  text(slide, 'OCEAN INTELLIGENCE', x + 0.46, y, 2.80, 0.18, {
    fontFace: 'Bahnschrift', fontSize: 8.4, color: dark ? C.deep : C.ice,
  });
  text(slide, '海洋智能分析平台', x + 0.46, y + 0.21, 2.80, 0.18, {
    fontSize: 8.0, color: dark ? '52737A' : C.mist,
  });
}

function heading(slide, line1, line2, x, y, w, dark = false) {
  const color = dark ? C.deep : C.white;
  text(slide, line1, x, y, w, 0.64, { heading: true, fontSize: 29.5, color });
  if (line2) text(slide, line2, x, y + 0.67, w, 0.64, { heading: true, fontSize: 29.5, color });
  rect(slide, x, y + (line2 ? 1.56 : 0.89), 0.78, 0.035, C.coral, 0);
}

function body(slide, value, x, y, w, h, dark = false) {
  text(slide, value, x, y, w, h, {
    fontSize: 11.1, color: dark ? C.deep : C.ice, valign: 'top', lineSpacingMultiple: 1.12,
  });
}

function monitor(slide, file, x, y, size) {
  slide.addImage({ path: file, x, y, w: size, h: size });
}

function phone(slide, file, x, y, size) {
  slide.addImage({ path: file, x, y, w: size, h: size });
}

function buildSlides() {
  // 01 / Cover
  {
    const slide = pptx.addSlide();
    background(slide, images.cover, 5);
    rect(slide, 0, 0, 5.85, H, C.navy, 30);
    wordmark(slide);
    heading(slide, '让海洋的每一次变化', '都有证据可循', 0.72, 1.48, 5.15);
    text(slide, '实时观测  ×  科学模型  ×  证据约束 Agent', 0.72, 3.22, 4.90, 0.28, { fontSize: 11.3, color: C.cyan });
    body(slide, '把分散的海洋数据，转化为可复核、可解释、可执行的中文科学研判。', 0.72, 3.82, 4.75, 0.60);
    text(slide, 'OPENQI DEVICE EDITION  /  2026', 0.72, 6.78, 3.2, 0.16, { fontFace: 'Bahnschrift', fontSize: 7.2, color: '82A7AA' });
    monitor(slide, deviceImages.overview, 5.10, 0.14, 7.85);
    phone(slide, deviceImages.agentMobile, 4.57, 2.95, 3.04);
  }

  // 02 / Signal to workspace
  {
    const slide = pptx.addSlide();
    background(slide, images.signal, 8);
    rect(slide, 0, 0, 5.55, H, C.navy, 38);
    meta(slide, 2, 'THE SIGNAL');
    heading(slide, '海洋持续发出信号', '工作台实时接住', 0.72, 1.10, 4.80);
    body(slide, '地图、候选、事件与水柱不再分散；同一张工作台保留实时状态与证据上下文。', 0.72, 2.98, 4.40, 0.80);
    text(slide, '热浪  ·  冷异常  ·  中尺度涡  ·  生态与碳循环', 0.72, 5.98, 4.75, 0.24, { fontSize: 9.6, color: C.cyan });
    monitor(slide, deviceImages.overview, 5.20, 0.20, 7.85);
  }

  // 03 / Global observatory
  {
    const slide = pptx.addSlide();
    background(slide, images.network, 8);
    rect(slide, 0, 0, 5.20, H, C.navy, 35);
    meta(slide, 3, 'GLOBAL OBSERVATORY');
    heading(slide, '六大海域', '一张会呼吸的观测网', 0.72, 1.10, 4.58);
    body(slide, '从西北太平洋到地中海，同一套标准持续读取海面变化，也下钻到水柱深处。', 0.72, 2.98, 4.15, 0.76);
    text(slide, 'LIVE  /  CACHED  /  SCENARIO', 0.72, 6.20, 3.0, 0.18, { fontFace: 'Bahnschrift', fontSize: 7.8, color: C.cyan });
    monitor(slide, deviceImages.globalMap, 5.00, 0.22, 7.95);
  }

  // 04 / Water column
  {
    const slide = pptx.addSlide();
    background(slide, images.waterColumn, 5);
    rect(slide, 6.65, 0, 6.68, H, C.navy, 36);
    meta(slide, 4, 'WATER COLUMN', 'right');
    heading(slide, '从海面到 2,000 米', '每一层都在讲述变化', 7.28, 1.10, 5.15);
    body(slide, '一次海面点击，展开最近浮标的完整水柱：位置、Cycle、变量与质量状态全部可见。', 7.28, 2.98, 4.70, 0.82);
    text(slide, '温度  ·  盐度  ·  叶绿素 a  ·  硝酸盐', 7.28, 5.88, 4.60, 0.24, { fontSize: 9.7, color: C.cyan });
    monitor(slide, deviceImages.seaProbe, -0.62, 0.28, 7.75);
    phone(slide, deviceImages.dataAgentMobile, 4.48, 3.16, 2.72);
  }

  // 05 / Candidate queue
  {
    const slide = pptx.addSlide();
    background(slide, images.fusion, 8);
    rect(slide, 6.85, 0, 6.48, H, C.navy, 35);
    meta(slide, 5, 'CANDIDATE QUEUE', 'right');
    heading(slide, '异常先入队', '再进入证据复核', 7.48, 1.12, 4.95);
    body(slide, '筛查结果不会被包装成结论；它们先进入候选队列，等待跨源数据与人工复核。', 7.48, 3.02, 4.45, 0.82);
    text(slide, '观测入列  →  稳健筛查  →  人工确认', 7.48, 5.94, 4.50, 0.24, { fontSize: 9.8, color: C.cyan });
    monitor(slide, deviceImages.queue, -0.30, 0.22, 8.05);
  }

  // 06 / Evidence chain
  {
    const slide = pptx.addSlide();
    background(slide, images.evidence, 7);
    rect(slide, 0, 0, 5.35, H, C.navy, 36);
    meta(slide, 6, 'EVIDENCE CHAIN');
    heading(slide, '异常不是结论', '证据链才是', 0.72, 1.12, 4.65);
    body(slide, '来源、时间、单位、质量与不确定性全部保留，让判断可以被复核，而不是只显得“像结论”。', 0.72, 3.02, 4.20, 0.88);
    text(slide, 'OBSERVATION  →  QC  →  REVIEW  →  DECISION', 0.72, 6.05, 4.30, 0.18, { fontFace: 'Bahnschrift', fontSize: 7.4, color: C.cyan });
    monitor(slide, deviceImages.event, 5.10, 0.18, 7.95);
  }

  // 07 / Agent
  {
    const slide = pptx.addSlide();
    background(slide, images.agent, 8);
    rect(slide, 0, 0, 5.45, H, C.navy, 36);
    meta(slide, 7, 'OCEAN DATA AGENT');
    heading(slide, '一个真正懂海洋上下文的', 'Agent', 0.72, 1.08, 4.72);
    body(slide, '它在完整海洋索引里检索证据，回答直接引用具体观测记录，而不是只给“合理的总结”。', 0.72, 2.98, 4.12, 0.88);
    text(slide, '完整索引  ·  会话历史  ·  工作记忆  ·  长期偏好', 0.72, 5.96, 4.50, 0.26, { fontSize: 9.2, color: C.cyan });
    monitor(slide, deviceImages.agentDesktop, 5.12, 0.20, 7.92);
    phone(slide, deviceImages.agentMobile, 4.58, 3.06, 2.95);
  }

  // 08 / Controlled memory
  {
    const slide = pptx.addSlide();
    background(slide, images.interpretation, 7);
    rect(slide, 6.80, 0, 6.53, H, C.navy, 36);
    meta(slide, 8, 'CONTROLLED MEMORY', 'right');
    heading(slide, '记忆分层', '可见、可控', 7.40, 1.10, 4.85);
    body(slide, '工作记忆、历史会话、跨轮记忆与程序性指令互不混用；只保存用户明确指定的长期偏好。', 7.40, 3.00, 4.46, 0.88);
    text(slide, 'WORKING  /  SESSION  /  LONG-TERM  /  PROCEDURAL', 7.40, 5.98, 4.65, 0.18, { fontFace: 'Bahnschrift', fontSize: 7.3, color: C.cyan });
    monitor(slide, deviceImages.memoryDesktop, -0.60, 0.28, 7.74);
    phone(slide, deviceImages.memoryMobile, 4.48, 3.14, 2.74);
  }

  // 09 / Desktop + mobile
  {
    const slide = pptx.addSlide();
    background(slide, images.operations, 7);
    rect(slide, 0, 0, 5.38, H, C.navy, 36);
    meta(slide, 9, 'DESKTOP + MOBILE');
    heading(slide, '同一套能力', '适配桌面与移动端', 0.72, 1.08, 4.75);
    body(slide, '一套连续的证据工作流，连接外海监测、科学研究与近岸治理。', 0.72, 2.98, 4.15, 0.72);
    text(slide, '实时监测  ·  科研分析  ·  业务研判', 0.72, 5.98, 4.15, 0.24, { fontSize: 9.7, color: C.cyan });
    monitor(slide, deviceImages.overview, 5.12, 0.18, 7.90);
    phone(slide, deviceImages.agentMobile, 4.48, 3.03, 2.94);
    phone(slide, deviceImages.dataAgentMobile, 10.03, 3.06, 2.94);
  }

  // 10 / Closing
  {
    const slide = pptx.addSlide();
    background(slide, images.horizon, 2);
    text(slide, '让海洋信号', 3.10, 1.62, 7.14, 0.66, { heading: true, fontSize: 31, color: C.deep, align: 'center' });
    text(slide, '更早抵达决策', 3.10, 2.34, 7.14, 0.66, { heading: true, fontSize: 31, color: C.deep, align: 'center' });
    rect(slide, 6.22, 3.32, 0.90, 0.035, C.coral, 0);
    text(slide, 'OCEAN INTELLIGENCE', 4.40, 3.58, 4.54, 0.25, { fontFace: 'Bahnschrift', fontSize: 9.3, color: C.deep, align: 'center' });
    text(slide, '海洋智能分析平台', 4.40, 3.91, 4.54, 0.24, { fontSize: 9.5, color: '47666C', align: 'center' });
    text(slide, 'REAL-TIME OBSERVATION  ·  GROUNDED EVIDENCE  ·  ACTIONABLE INSIGHT', 3.10, 6.72, 7.14, 0.18, { fontFace: 'Bahnschrift', fontSize: 6.9, color: '52737A', align: 'center' });
  }
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  await prepareAssets();
  buildSlides();
  await pptx.writeFile({ fileName: pptxPath });
  console.log(pptxPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
