import fs from "node:fs";
import path from "node:path";
import playwright from "../frontend/node_modules/playwright/index.js";

const { chromium } = playwright;
const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "artifacts", "full-operation-demo-2026-08-29");
const videoDir = path.join(output, "raw-video");
const segments = JSON.parse(fs.readFileSync(path.join(output, "segments.json"), "utf8"));
const email = process.env.OCEAN_DEMO_EMAIL;
const password = process.env.OCEAN_DEMO_PASSWORD;

if (!email || !password) {
  throw new Error("Set OCEAN_DEMO_EMAIL and OCEAN_DEMO_PASSWORD before recording.");
}

fs.mkdirSync(videoDir, { recursive: true });

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function clickIfVisible(locator, timeout = 2500) {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
    await locator.first().click();
    return true;
  } catch {
    return false;
  }
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  ignoreHTTPSErrors: true,
  recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
page.setDefaultTimeout(8000);

await page.goto("https://ocean.hegelsalon.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(1200);

await page.evaluate(() => {
  const style = document.createElement("style");
  style.id = "demo-overlay-style";
  style.textContent = `
    #demo-caption { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); width: min(1120px, calc(100vw - 44px)); z-index: 2147483646; pointer-events: none; color: #fff; background: linear-gradient(135deg, rgba(5,18,31,.94), rgba(11,50,72,.92)); border: 1px solid rgba(106,214,255,.5); border-radius: 16px; box-shadow: 0 18px 46px rgba(0,0,0,.35); padding: 15px 20px 16px; font-family: "Noto Sans CJK SC", "Microsoft YaHei", sans-serif; }
    #demo-caption .demo-meta { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 7px; color: #74dbff; font-size: 14px; letter-spacing: .08em; font-weight: 700; }
    #demo-caption .demo-text { font-size: 20px; line-height: 1.55; font-weight: 600; text-shadow: 0 2px 5px rgba(0,0,0,.45); }
    #demo-title-card { position: fixed; inset: 0; z-index: 2147483645; display: grid; place-items: center; pointer-events: none; background: radial-gradient(circle at 50% 42%, rgba(20,116,150,.78), rgba(2,13,24,.98) 67%); color: #fff; font-family: "Noto Sans CJK SC", "Microsoft YaHei", sans-serif; }
    #demo-title-card .demo-title-inner { text-align: center; padding: 50px; }
    #demo-title-card .demo-wave { font-size: 58px; margin-bottom: 18px; }
    #demo-title-card h1 { margin: 0; font-size: 48px; letter-spacing: .06em; }
    #demo-title-card p { margin: 18px 0 0; font-size: 22px; color: #aeeaff; }
  `;
  document.head.appendChild(style);
  const caption = document.createElement("div");
  caption.id = "demo-caption";
  caption.innerHTML = '<div class="demo-meta"><span></span><b></b></div><div class="demo-text"></div>';
  document.body.appendChild(caption);
});

async function showCaption(segment, index) {
  await page.evaluate(({ title, text, progress }) => {
    const caption = document.querySelector("#demo-caption");
    if (!caption) return;
    caption.querySelector(".demo-meta span").textContent = title;
    caption.querySelector(".demo-meta b").textContent = progress;
    caption.querySelector(".demo-text").textContent = text;
  }, { title: segment.title, text: segment.text, progress: `${String(index + 1).padStart(2, "0")} / ${segments.length}` });
}

async function showTitleCard(visible, closing = false) {
  await page.evaluate(({ visible: nextVisible, closing: isClosing }) => {
    document.querySelector("#demo-title-card")?.remove();
    if (!nextVisible) return;
    const card = document.createElement("div");
    card.id = "demo-title-card";
    card.innerHTML = `<div class="demo-title-inner"><div class="demo-wave">🌊</div><h1>海洋智能分析平台</h1><p>${isClosing ? "从观测到证据，从证据到可复核研判" : "全量操作演示 · 字幕版"}</p></div>`;
    document.body.appendChild(card);
  }, { visible, closing });
}

async function capture(name) {
  await page.screenshot({ path: path.join(output, `${name}.png`), animations: "allow" });
}

let expectedEnd = Date.now();
async function runSegment(index, action) {
  const segment = segments[index];
  await showCaption(segment, index);
  expectedEnd += Math.round(segment.duration * 1000);
  try {
    await action();
  } catch (error) {
    console.warn(`segment ${segment.id} action warning:`, error instanceof Error ? error.message : error);
  }
  const remaining = expectedEnd - Date.now();
  if (remaining > 0) await sleep(remaining);
}

await runSegment(0, async () => {
  await showTitleCard(true);
  await sleep(10500);
  await capture("01-project-intro");
  await showTitleCard(false);
});

await runSegment(1, async () => {
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await sleep(1800);
  await capture("02-login");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await page.locator(".explorer-home").waitFor({ state: "visible", timeout: 15000 });
});

await runSegment(2, async () => {
  await page.locator(".event-row").first().waitFor({ state: "visible", timeout: 22000 }).catch(() => undefined);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await sleep(2500);
  await capture("03-home-overview");
  await clickIfVisible(page.getByRole("button", { name: "专业模式", exact: true }));
  await sleep(2500);
  await clickIfVisible(page.getByRole("button", { name: "入门模式", exact: true }));
});

await runSegment(3, async () => {
  const regionSelect = page.getByLabel("选择探索海域");
  await regionSelect.selectOption({ label: "南海" });
  await sleep(7500);
  await capture("04-region-south-china-sea");
});

await runSegment(4, async () => {
  await clickIfVisible(page.getByRole("button", { name: "新手教程", exact: true }));
  await sleep(3500);
  await capture("05-beginner-guide");
  await clickIfVisible(page.getByRole("button", { name: "今日简报", exact: true }));
  await sleep(3500);
  await page.locator("#daily-brief-panel").scrollIntoViewIfNeeded().catch(() => undefined);
  await capture("06-daily-briefing");
});

await runSegment(5, async () => {
  await clickIfVisible(page.getByRole("button", { name: "收起今日简报", exact: true }));
  await clickIfVisible(page.getByRole("button", { name: "收起新手教程", exact: true }));
  await clickIfVisible(page.getByRole("button", { name: "专业模式", exact: true }));
  await page.locator(".workspace-grid").scrollIntoViewIfNeeded().catch(() => undefined);
  await sleep(2500);
  await clickIfVisible(page.getByRole("button", { name: "海温", exact: true }));
  await sleep(3500);
  await capture("07-event-queue-filter");
  await clickIfVisible(page.locator(".event-row").first());
});

await runSegment(6, async () => {
  await page.locator(".event-detail").waitFor({ state: "visible", timeout: 8000 }).catch(() => undefined);
  await capture("08-event-overview");
  for (const [label, file] of [["证据", "09-event-evidence"], ["研判报告", "10-event-report"], ["文献依据", "11-event-literature"], ["观测概览", "12-observation-overview"]]) {
    await clickIfVisible(page.getByRole("tab", { name: label, exact: true }));
    await sleep(2800);
    await capture(file);
  }
  await clickIfVisible(page.getByRole("tab", { name: "概览", exact: true }));
});

await runSegment(7, async () => {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await sleep(1800);
  await clickIfVisible(page.getByRole("button", { name: "查看数据来源状态" }));
  await sleep(3200);
  await capture("13-data-source-status");
  await clickIfVisible(page.getByRole("button", { name: "使用长屏模式" }));
  await sleep(1800);
  await clickIfVisible(page.getByRole("button", { name: "隐藏事件队列" }));
  await clickIfVisible(page.getByRole("button", { name: "隐藏事件详情" }));
  await sleep(2200);
  await capture("14-layout-controls");
  await clickIfVisible(page.getByRole("button", { name: "显示事件队列" }));
  await clickIfVisible(page.getByRole("button", { name: "显示事件详情" }));
  await clickIfVisible(page.getByRole("button", { name: "使用并排模式" }));
});

await runSegment(8, async () => {
  await clickIfVisible(page.getByRole("button", { name: "查看数据来源状态" }));
  await page.locator(".map-shell").scrollIntoViewIfNeeded();
  await sleep(2400);
  await clickIfVisible(page.getByRole("button", { name: "恢复当前海域视图" }));
  const map = page.locator(".ocean-map");
  const box = await map.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width * 0.58, box.y + box.height * 0.44);
    await page.locator(".sea-probe-panel").waitFor({ state: "visible", timeout: 9000 }).catch(() => undefined);
  }
  await sleep(5200);
  await capture("15-map-coordinate-probe");
  await clickIfVisible(page.getByRole("button", { name: "收起点位观测" }));
  await sleep(1800);
});

await runSegment(9, async () => {
  await clickIfVisible(page.getByRole("button", { name: "关闭坐标探针" }));
  await clickIfVisible(page.locator(".buoy-fleet-open"));
  await page.getByRole("dialog").waitFor({ state: "visible", timeout: 8000 }).catch(() => undefined);
  await sleep(4200);
  await capture("16-buoy-fleet");
  const search = page.locator(".buoy-fleet-panel input").first();
  if (await search.isVisible().catch(() => false)) await search.fill("590");
  await sleep(2600);
});

await runSegment(10, async () => {
  await clickIfVisible(page.getByRole("button", { name: "关闭浮标总览" }));
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await sleep(1600);
  await clickIfVisible(page.getByRole("button", { name: "打开海洋数据 Agent" }));
  await page.locator("[role='dialog']").last().waitFor({ state: "visible", timeout: 10000 }).catch(() => undefined);
  await sleep(4500);
  await capture("17-data-agent");
  const textarea = page.locator("textarea").last();
  if (await textarea.isVisible().catch(() => false)) {
    await textarea.fill("总结南海当前高置信度异常候选，并说明证据来源和不确定性。");
  }
  await sleep(3200);
  await capture("18-agent-question-example");
});

await runSegment(11, async () => {
  await clickIfVisible(page.getByTitle("关闭").last());
  await sleep(1800);
  await clickIfVisible(page.getByRole("button", { name: "账户与模型 API 设置" }));
  await page.getByRole("dialog").waitFor({ state: "visible", timeout: 8000 }).catch(() => undefined);
  await sleep(4200);
  await capture("19-account-model-settings");
  await clickIfVisible(page.getByRole("button", { name: "DeepSeek", exact: true }));
  await sleep(2500);
  await clickIfVisible(page.getByRole("button", { name: "OpenAI", exact: true }));
});

await runSegment(12, async () => {
  await clickIfVisible(page.getByRole("button", { name: "关闭账户设置" }));
  await showTitleCard(true, true);
  await sleep(12500);
  await capture("20-summary");
});

const video = page.video();
await context.close();
const rawVideoPath = await video.path();
const finalRawPath = path.join(output, "ocean-intelligence-full-operation-raw.webm");
fs.copyFileSync(rawVideoPath, finalRawPath);
await browser.close();
console.log(finalRawPath);
