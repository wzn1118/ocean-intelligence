import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const APP_URL = process.env.OCEAN_APP_URL ?? "http://127.0.0.1:5173/";
const OUTPUT = process.env.OCEAN_QA_OUTPUT ?? path.resolve("..", "artifacts");

test("map reaches meter-scale street detail with precise coordinates", async ({ page }) => {
  test.setTimeout(90_000);
  fs.mkdirSync(OUTPUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    localStorage.setItem("ocean-ui-explorer-guide-seen", JSON.stringify(false));
    localStorage.setItem("ocean-ui-region-v3", JSON.stringify("beijing_street_qa"));
    localStorage.setItem("ocean-ui-visual-theme", JSON.stringify("night"));
  });

  const cityRegion = {
    id: "beijing_street_qa",
    name: "北京街道验证区",
    short_name: "北京",
    description: "米级街道底图端到端验证区域",
    bounds: [[116.34, 39.86], [116.46, 39.96]],
    center: [116.4, 39.91],
    zoom: 12,
  };
  await page.route("**/api/regions", (route) => route.fulfill({ json: [cityRegion] }));
  let targetEvent: { title: string; centroid: [number, number] } | null = null;
  await page.route("**/api/workspace/snapshot?*", async (route) => {
    const upstream = await page.request.get("http://127.0.0.1:8000/api/workspace/snapshot?region=global_ocean");
    expect(upstream.ok()).toBeTruthy();
    const payload = await upstream.json();
    targetEvent = payload.events[1] ?? payload.events[0] ?? null;
    payload.region = cityRegion;
    payload.observations = { ...payload.observations, region_id: cityRegion.id, region: cityRegion.name, bounds: cityRegion.bounds };
    payload.argo_region = { ...payload.argo_region, region_id: cityRegion.id, region: cityRegion.name, bounds: cityRegion.bounds };
    await route.fulfill({ json: payload });
  });

  let successfulStreetTiles = 0;
  page.on("response", (response) => {
    if (response.url().startsWith("https://tile.openstreetmap.org/") && response.ok()) successfulStreetTiles += 1;
  });

  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  const map = page.locator(".map-shell");
  const zoomIn = page.locator(".maplibregl-ctrl-zoom-in");
  await expect(map).toBeVisible({ timeout: 30_000 });
  await expect(zoomIn).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".maplibregl-ctrl-scale")).toHaveCount(1);
  await map.scrollIntoViewIfNeeded();

  for (let step = 0; step < 5; step += 1) {
    await zoomIn.click({ force: true });
    await page.waitForTimeout(420);
  }

  const readout = page.locator(".map-readout");
  await expect(readout).toContainText("街道");
  await expect(readout).toContainText(/(?:\d+(?:\.\d+)?) m\/px/);
  await expect.poll(() => successfulStreetTiles, { timeout: 15_000 }).toBeGreaterThan(0);

  const bounds = await map.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  await page.mouse.move(bounds.x + bounds.width * 0.52, bounds.y + bounds.height * 0.54);
  await expect(readout.locator("strong")).toHaveText(/\d+\.\d{6}° [NS] · \d+\.\d{6}° [EW]/);
  await expect(page.locator(".maplibregl-ctrl-scale")).toContainText(/m/);

  expect(targetEvent).not.toBeNull();
  if (!targetEvent) return;
  const targetRow = page.locator(".event-row").filter({ hasText: targetEvent.title }).first();
  await targetRow.click();
  const [targetLongitude, targetLatitude] = targetEvent.centroid;
  const expectedCoordinate = `${Math.abs(targetLatitude).toFixed(6)}° ${targetLatitude >= 0 ? "N" : "S"} · ${Math.abs(targetLongitude).toFixed(6)}° ${targetLongitude >= 0 ? "E" : "W"}`;
  await expect(readout.locator("strong")).toHaveText(expectedCoordinate, { timeout: 3_000 });

  await map.screenshot({ path: path.join(OUTPUT, "street-map-meter.png") });
});
