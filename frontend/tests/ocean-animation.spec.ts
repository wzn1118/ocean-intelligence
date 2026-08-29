import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUTPUT = process.env.OCEAN_QA_OUTPUT ?? path.join(process.env.TEMP ?? path.resolve("test-results"), "ocean-animation-qa");
const APP_URL = process.env.OCEAN_APP_URL ?? "http://127.0.0.1:5173/";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ocean-ui-explorer-guide-seen", JSON.stringify(false));
  });
});

function captureRawCanvas(canvas: Locator, filename: string) {
  return canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL("image/png"))
    .then((dataUrl) => {
      const buffer = Buffer.from(dataUrl.split(",")[1], "base64");
      fs.mkdirSync(OUTPUT, { recursive: true });
      fs.writeFileSync(path.join(OUTPUT, filename), buffer);
      return buffer;
    });
}

async function measureBluePixelShare(canvas: Locator) {
  return canvas.evaluate(async (element) => {
    const source = element as HTMLCanvasElement;
    const imageElement = new Image();
    imageElement.src = source.toDataURL("image/png");
    await new Promise<void>((resolve) => { imageElement.onload = () => resolve(); });
    const copy = document.createElement("canvas");
    copy.width = source.width;
    copy.height = source.height;
    const context = copy.getContext("2d");
    if (!context) return 0;
    context.drawImage(imageElement, 0, 0);
    const image = context.getImageData(0, 0, copy.width, copy.height).data;
    let blue = 0;
    let considered = 0;
    for (let index = 0; index < image.length; index += 4) {
      const red = image[index];
      const green = image[index + 1];
      const blueChannel = image[index + 2];
      if (blueChannel > red * 1.3 && blueChannel > green * 1.05 && blueChannel > 125) blue += 1;
      considered += 1;
    }
    return blue / Math.max(considered, 1);
  });
}

async function waitForOcean(page: Page) {
  await expect(page.locator(".event-row").first()).toBeVisible({ timeout: 30_000 });
  const ocean = page.locator(".animated-ocean");
  await expect(ocean).toHaveAttribute("data-ocean-ready", "true", { timeout: 15_000 });
  const canvas = page.locator('canvas[data-ocean-canvas="true"]');
  await expect(canvas).toBeVisible();
  const bounds = await canvas.boundingBox();
  expect(bounds?.width ?? 0).toBeGreaterThan(300);
  expect(bounds?.height ?? 0).toBeGreaterThan(300);
  return { ocean, canvas };
}

test("desktop ocean renders, moves, reacts, and pauses", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  const { ocean, canvas } = await waitForOcean(page);

  const initialZoom = Number(await ocean.getAttribute("data-ocean-zoom"));
  const initialOceanScale = Number(await ocean.getAttribute("data-ocean-scale"));
  expect(initialZoom).toBeGreaterThan(0.8);
  expect(initialOceanScale).toBeGreaterThan(0);
  const initialCenter = await ocean.getAttribute("data-ocean-center");
  expect(initialCenter).toMatch(/^-?\d+\.\d+,-?\d+\.\d+$/);

  await page.screenshot({ path: path.join(OUTPUT, "desktop-animated-ocean.png") });
  const frameA = await captureRawCanvas(canvas, "canvas-raw-frame-a.png");
  await page.waitForTimeout(650);
  const frameB = await captureRawCanvas(canvas, "canvas-raw-frame-b.png");
  expect(frameA.equals(frameB)).toBeFalsy();

  for (let frame = 0; frame < 18; frame += 1) {
    await page.waitForTimeout(95);
    await captureRawCanvas(canvas, `motion-frame-${String(frame).padStart(2, "0")}.png`);
  }

  const mapShellForZoom = page.locator(".map-shell");
  await mapShellForZoom.scrollIntoViewIfNeeded();
  const zoomBounds = await mapShellForZoom.boundingBox();
  expect(zoomBounds).not.toBeNull();
  if (!zoomBounds) return;
  await page.mouse.move(zoomBounds.x + zoomBounds.width * 0.54, zoomBounds.y + zoomBounds.height * 0.48);
  await page.mouse.wheel(0, -1200);
  await page.locator(".maplibregl-ctrl-zoom-in").click({ force: true });
  await expect.poll(async () => Number(await ocean.getAttribute("data-ocean-zoom")), { timeout: 3_000 })
    .toBeGreaterThan(initialZoom + 0.3);
  await expect.poll(async () => Number(await ocean.getAttribute("data-ocean-scale")), { timeout: 3_000 })
    .toBeLessThan(initialOceanScale * 0.8);
  const zoomedFrame = await captureRawCanvas(canvas, "canvas-raw-zoomed.png");
  expect(zoomedFrame.equals(frameB)).toBeFalsy();
  const bluePixelShareBeforePulse = await measureBluePixelShare(canvas);

  const mapShell = page.locator(".map-shell");
  const mapBounds = await mapShell.boundingBox();
  expect(mapBounds).not.toBeNull();
  if (!mapBounds) return;
  const interactionX = mapBounds.x + mapBounds.width * 0.54;
  const interactionY = mapBounds.y + mapBounds.height * 0.48;
  await mapShell.dispatchEvent("pointermove", { clientX: interactionX - 120, clientY: interactionY - 60, pointerId: 1, pointerType: "mouse" });
  await mapShell.dispatchEvent("pointermove", { clientX: interactionX, clientY: interactionY, pointerId: 1, pointerType: "mouse" });
  await mapShell.dispatchEvent("pointerdown", { clientX: interactionX, clientY: interactionY, pointerId: 1, pointerType: "mouse" });
  await expect(ocean).toHaveAttribute("data-ocean-pulse", /\d+\.\d+/);
  await page.waitForTimeout(160);
  const pulseFrame = await captureRawCanvas(canvas, "canvas-raw-pointer-ripple.png");
  expect(pulseFrame.equals(frameB)).toBeFalsy();
  const bluePixelShare = await measureBluePixelShare(canvas);
  expect(bluePixelShare).toBeGreaterThan(0.002);
  expect(bluePixelShare).toBeGreaterThan(bluePixelShareBeforePulse + 0.0015);
  await page.screenshot({ path: path.join(OUTPUT, "desktop-pointer-ripple.png") });

  await page.getByRole("button", { name: "暂停海面动效" }).click();
  await expect(page.getByRole("button", { name: "继续海面动效" })).toBeVisible();
  await page.waitForTimeout(180);
  const pausedTimeA = Number(await ocean.getAttribute("data-ocean-time"));
  await page.waitForTimeout(520);
  const pausedTimeB = Number(await ocean.getAttribute("data-ocean-time"));
  expect(Math.abs(pausedTimeB - pausedTimeA)).toBeLessThan(0.02);

  await page.getByRole("button", { name: "继续海面动效" }).click();
  await expect.poll(
    async () => Number(await ocean.getAttribute("data-ocean-time")),
    { timeout: 2_500 },
  ).toBeGreaterThan(pausedTimeB + 0.1);

});

test("mobile ocean remains full-bleed and controls stay inside the map", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  const { canvas } = await waitForOcean(page);
  await expect.poll(async () => page.locator(".map-shell").count()).toBe(1);
  await page.locator(".map-shell").evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(500);

  const mapBounds = await page.locator(".map-shell").boundingBox();
  const canvasBounds = await canvas.boundingBox();
  expect(mapBounds).not.toBeNull();
  expect(canvasBounds).not.toBeNull();
  if (!mapBounds || !canvasBounds) return;
  expect(Math.abs(canvasBounds.x - mapBounds.x)).toBeLessThan(2);
  expect(Math.abs(canvasBounds.y - mapBounds.y)).toBeLessThan(2);
  expect(Math.abs(canvasBounds.width - mapBounds.width)).toBeLessThan(2);
  expect(Math.abs(canvasBounds.height - mapBounds.height)).toBeLessThan(2);

  for (const selector of [".map-readout", ".map-tools", ".map-layer-card"]) {
    const bounds = await page.locator(selector).boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) continue;
    expect(bounds.x).toBeGreaterThanOrEqual(mapBounds.x - 1);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(mapBounds.x + mapBounds.width + 1);
    expect(bounds.y).toBeGreaterThanOrEqual(mapBounds.y - 1);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(mapBounds.y + mapBounds.height + 1);
  }

  await page.screenshot({ path: path.join(OUTPUT, "mobile-animated-ocean.png") });
  await captureRawCanvas(canvas, "mobile-canvas-raw.png");
});
