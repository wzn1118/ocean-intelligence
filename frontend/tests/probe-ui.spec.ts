import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const APP_URL = process.env.OCEAN_APP_URL ?? "http://127.0.0.1:5173/";
const OUTPUT = path.resolve("test-results", "probe-ui");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ocean-ui-explorer-guide-seen", JSON.stringify(false));
  });
  fs.mkdirSync(OUTPUT, { recursive: true });
});

async function openProbe(page: Page) {
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  const guideClose = page.locator(".explorer-guide-close");
  if (await guideClose.isVisible()) await guideClose.click();
  const probe = page.locator(".sea-probe-panel");
  const openArgo = page.locator('.map-tools button[title^="\u6253\u5f00 Argo"]').first();
  if (!(await openArgo.count())) {
    const matchArgo = page.getByRole("button", { name: "\u5339\u914d\u90bb\u8fd1 Argo \u6d6e\u6807" }).first();
    if (await matchArgo.count()) {
      await matchArgo.click();
      await expect(openArgo).toHaveCount(1, { timeout: 30_000 });
    } else {
      await openArgo.waitFor({ state: "attached", timeout: 30_000 }).catch(() => undefined);
    }
  }
  if (await openArgo.count()) {
    await openArgo.click();
    const drawer = page.locator(".sea-probe-detail-drawer");
    await expect(drawer).toBeVisible({ timeout: 30_000 });
    await drawer.locator(".sea-probe-detail-header button").click();
    await expect(drawer).toHaveCount(0);
    await expect(probe).toBeVisible({ timeout: 30_000 });
    return probe;
  }

  const map = page.locator(".maplibregl-canvas");
  await expect(map).toBeVisible({ timeout: 30_000 });
  await page.addStyleTag({
    content: ".map-tools,.map-readout,.map-layer-card,.map-source-badge{pointer-events:none!important}",
  });
  await map.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  const clickPositions = [
    { x: 0.22, y: 0.34 },
    { x: 0.43, y: 0.72 },
    { x: 0.68, y: 0.31 },
    { x: 0.78, y: 0.74 },
  ];
  for (const position of clickPositions) {
    const bounds = await map.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) break;
    await map.click({ position: { x: bounds.width * position.x, y: bounds.height * position.y } });
    if (await probe.isVisible()) break;
    await page.waitForTimeout(250);
  }
  await expect(probe).toBeVisible({ timeout: 30_000 });
  await expect(probe.locator(".sea-probe-heading strong")).not.toHaveText("", { timeout: 30_000 });
  return probe;
}

test("sea probe is legible, collapsible, and contained on desktop", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const probe = await openProbe(page);
  const bounds = await probe.boundingBox();
  const mapBounds = await page.locator(".map-shell").boundingBox();
  expect(bounds).not.toBeNull();
  expect(mapBounds).not.toBeNull();
  if (bounds && mapBounds) {
    expect(bounds.width).toBeLessThanOrEqual(394);
    expect(bounds.height).toBeLessThanOrEqual(682);
    expect(bounds.x).toBeGreaterThanOrEqual(mapBounds.x - 1);
    expect(bounds.y).toBeGreaterThanOrEqual(mapBounds.y - 1);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(mapBounds.x + mapBounds.width + 1);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(mapBounds.y + mapBounds.height + 1);
  }

  await expect(probe.locator(".sea-probe-coordinates strong")).toHaveCount(2);
  const longitude = await probe.locator(".sea-probe-coordinates strong").nth(0).textContent();
  const latitude = await probe.locator(".sea-probe-coordinates strong").nth(1).textContent();
  await expect(page.locator(".map-readout strong")).toHaveText(
    `${latitude?.trim()} · ${longitude?.trim()}`,
  );
  await expect(probe.locator(".sea-probe-sst-reading strong")).toBeVisible({ timeout: 30_000 });
  const depth = probe.getByTestId("selected-bathymetry");
  await expect(depth).toBeVisible({ timeout: 30_000 });
  await expect(depth.locator("header strong")).toContainText("m");
  await expect(depth.getByTestId("bathymetry-precision")).toBeVisible();
  await expect(depth.locator(".sea-probe-depth-precision-heading")).toContainText("点击坐标格网值");
  await expect(depth.locator(".sea-probe-depth-precision-meta span")).toHaveCount(3);
  await expect(depth.locator(".sea-probe-depth-facts > div")).toHaveCount(3);
  await expect(depth).not.toContainText("25 km");
  await expect(depth.locator("footer")).toContainText("查询半径 0 m");
  await expect(depth.locator("footer a")).toHaveAttribute("href", /^https:\/\//);
  await expect(probe.locator(".sea-probe-nearest")).toBeVisible({ timeout: 30_000 });
  await probe.screenshot({ path: path.join(OUTPUT, "probe-desktop-expanded.png") });

  const detailDrawer = page.locator(".sea-probe-detail-drawer");
  if (await detailDrawer.isVisible()) {
    await detailDrawer.locator(".sea-probe-detail-header button").click();
    await expect(detailDrawer).toHaveCount(0);
  }
  await page.getByRole("button", { name: "\u5207\u6362\u4e3a\u6d45\u84dd\u6d77\u62a5\u4e3b\u89c6\u89c9" }).click();
  await expect(page.locator(".app-shell")).toHaveClass(/visual-light-blue/);
  await probe.screenshot({ path: path.join(OUTPUT, "probe-desktop-light.png") });
  await page.getByRole("button", { name: "\u5207\u6362\u4e3a\u6df1\u8272\u6f6e\u6c50\u4e3b\u89c6\u89c9" }).click();

  await probe.getByRole("button", { name: "\u6536\u8d77\u70b9\u4f4d\u89c2\u6d4b" }).click();
  await expect(probe).toHaveClass(/collapsed/);
  const collapsed = await probe.boundingBox();
  expect(collapsed).not.toBeNull();
  if (collapsed) expect(collapsed.height).toBeLessThanOrEqual(60);
  await probe.screenshot({ path: path.join(OUTPUT, "probe-desktop-collapsed.png") });
});

test("sea probe expands and docks when dragged to the right edge", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const probe = await openProbe(page);
  const heading = probe.locator(".sea-probe-heading");
  const mapBounds = await page.locator(".map-shell").boundingBox();
  const headingBounds = await heading.boundingBox();
  expect(mapBounds).not.toBeNull();
  expect(headingBounds).not.toBeNull();
  if (!mapBounds || !headingBounds) return;

  await page.mouse.move(headingBounds.x + headingBounds.width / 2, headingBounds.y + headingBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(mapBounds.x + mapBounds.width - 4, headingBounds.y + headingBounds.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect(probe).toHaveClass(/docked-right/);
  const dockedBounds = await probe.boundingBox();
  expect(dockedBounds).not.toBeNull();
  if (dockedBounds) {
    expect(dockedBounds.width).toBeGreaterThan(400);
    expect(dockedBounds.height).toBeGreaterThan(mapBounds.height - 24);
    expect(Math.abs(dockedBounds.x + dockedBounds.width - (mapBounds.x + mapBounds.width - 8))).toBeLessThanOrEqual(2);
  }
});

test("land classification suppresses every marine data section", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/api/marine/bathymetry?**", async (route) => {
    const url = new URL(route.request().url());
    const longitude = Number(url.searchParams.get("longitude") ?? 116.4074);
    const latitude = Number(url.searchParams.get("latitude") ?? 39.9042);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        query_point: { longitude, latitude },
        query_radius_m: 0,
        value_basis: "bilinear_grid_interpolation",
        seafloor_elevation_m: 53.4,
        water_depth_m: 0,
        is_ocean: false,
        depth_zone: "land_or_intertidal",
        depth_zone_name: "陆地",
        explanation: "所选坐标的地形格网高程为海平面以上 53.4 m，判定为陆地。",
        sample_radius_km: 0,
        shallowest_depth_m: 0,
        deepest_depth_m: 0,
        local_relief_m: 0,
        sample_count: 1,
        samples: [{
          direction: "center",
          longitude,
          latitude,
          elevation_m: 53.4,
          water_depth_m: 0,
          provider: "GMRT",
        }],
        provider: "GMRT",
        dataset: "Global Multi-Resolution Topography",
        source_url: "https://www.gmrt.org/",
        fallback_source_url: "https://www.gebco.net/",
        precision_mode: "gmrt_100m_grid",
        horizontal_resolution_m: 100,
        interpolation_method: "bilinear",
        high_resolution_coverage: true,
        grid_node_count: 4,
        micro_radius_m: null,
        micro_shallowest_depth_m: null,
        micro_deepest_depth_m: null,
        micro_relief_m: null,
        verification_provider: "GEBCO",
        verification_elevation_m: 51,
        verification_depth_m: 0,
        source_difference_m: 2.4,
        confidence: "high",
        confidence_name: "高",
        confidence_note: "两套地形源均将此点判定为陆地。",
        resolution_note: "约 100 m 地形格网。",
        retrieved_at: new Date().toISOString(),
        errors: [],
        cache: { state: "fresh", age_seconds: 0, ttl_seconds: 86_400 },
      }),
    });
  });

  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  const guideClose = page.locator(".explorer-guide-close");
  if (await guideClose.isVisible()) await guideClose.click();
  const openArgo = page.locator('.map-tools button[title^="打开 Argo"]').first();
  await expect(openArgo).toBeVisible({ timeout: 30_000 });
  await openArgo.click();

  const probe = page.locator(".sea-probe-panel");
  await expect(probe).toBeVisible({ timeout: 10_000 });
  await expect(probe).toHaveClass(/surface-land/);
  await expect(probe.getByTestId("land-classification")).toBeVisible();
  await expect(probe.locator(".sea-probe-heading strong")).toHaveText("陆地点位");
  await expect(probe.getByTestId("selected-bathymetry")).toHaveAttribute("aria-label", "所选点地表高程");
  await expect(probe.getByTestId("selected-bathymetry").locator("header strong")).toContainText("53");
  await expect(probe.locator(".sea-probe-depth-scale")).toHaveCount(0);

  await page.waitForTimeout(1_000);
  await expect(probe.getByTestId("selected-sst-reading")).toHaveCount(0);
  await expect(probe.getByTestId("selected-sst-unavailable")).toHaveCount(0);
  await expect(probe.locator(".sea-probe-nearest")).toHaveCount(0);
  await expect(probe.locator(".marine-context-card")).toHaveCount(0);
  await expect(probe.locator(".marine-knowledge-card")).toHaveCount(0);
  await expect(page.locator(".sea-probe-detail-drawer")).toHaveCount(0);
  await probe.screenshot({ path: path.join(OUTPUT, "probe-land-classified.png") });
});

test("sea probe uses the narrow viewport without horizontal overflow", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 400, height: 900 });
  const probe = await openProbe(page);
  const bounds = await probe.boundingBox();
  const mapBounds = await page.locator(".map-shell").boundingBox();
  expect(bounds).not.toBeNull();
  expect(mapBounds).not.toBeNull();
  if (bounds && mapBounds) {
    expect(bounds.width).toBeLessThanOrEqual(370);
    expect(bounds.x).toBeGreaterThanOrEqual(mapBounds.x - 1);
    expect(bounds.y).toBeGreaterThanOrEqual(mapBounds.y - 1);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(mapBounds.x + mapBounds.width + 1);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(mapBounds.y + mapBounds.height + 1);
  }

  await expect(probe.locator(".sea-probe-drag-handle")).toBeHidden();
  await probe.screenshot({ path: path.join(OUTPUT, "probe-narrow-expanded.png") });
});
