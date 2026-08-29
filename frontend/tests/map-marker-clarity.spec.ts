import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const APP_URL = process.env.OCEAN_APP_URL ?? "http://127.0.0.1:5173/";
const OUTPUT = process.env.OCEAN_QA_OUTPUT ?? path.resolve("test-results", "map-marker-clarity");

test("light map uses distinct, uncluttered observation markers", async ({ page }) => {
  test.setTimeout(60_000);
  fs.mkdirSync(OUTPUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  const region = {
    id: "global_ocean",
    name: "全球",
    short_name: "全球海洋",
    description: "地图标点视觉回归夹具",
    bounds: [[-179, -70], [179, 70]],
    center: [10, 0],
    zoom: 1.15,
  };
  const profiles = Array.from({ length: 360 }, (_, index) => {
    const cluster = index % 6;
    const ring = Math.floor(index / 6);
    const centers = [[145, 28], [-35, 38], [72, -18], [-125, -22], [15, 4], [110, 48]];
    const [centerLongitude, centerLatitude] = centers[cluster];
    return {
      platform: `QA-${String(index).padStart(4, "0")}`,
      latest_profile_id: `QA-PROFILE-${index}`,
      cycle: ring + 1,
      timestamp: "2026-08-23T12:00:00Z",
      longitude: centerLongitude + ((ring % 10) - 4.5) * 0.42,
      latitude: centerLatitude + ((Math.floor(ring / 10) % 6) - 2.5) * 0.42,
      profile_count: 1,
      networks: index % 8 === 0 ? ["BGC-Argo"] : ["Core-Argo"],
      has_bgc: index % 8 === 0,
      distance_km: null,
      within_event_radius: false,
    };
  });
  const observations = {
    region_id: region.id,
    region: region.name,
    generated_at: "2026-08-23T12:00:00Z",
    bounds: region.bounds,
    observation_count: profiles.length,
    source_count: 1,
    argo_profile_count: profiles.length,
    float_count: 72,
    bgc_float_count: 9,
    sampled_profile_count: 0,
    profile_request_failures: 0,
    profile_success_fraction: null,
    median_profile_depth: null,
    maximum_profile_depth: null,
    sst_lookback_days: 7,
    sst_daily_steps: 0,
    sst_latest_grid_count: 0,
    sst_latest_points: [],
    sst_native_resolution_degrees: 0.25,
    sst_latitude_step_degrees: null,
    sst_longitude_step_degrees: null,
    noaa_quality_valid_count: 0,
    noaa_point_count: 0,
    noaa_quality_pass_fraction: null,
    quality_fields_complete: false,
    adjusted_surface_fraction: null,
    latest_observation_at: "2026-08-23T12:00:00Z",
    screening_event_count: 0,
    variables: [],
    sst_timeline: [],
    conclusion: { state: "no_candidate", headline: "视觉回归", summary: "", evidence: [], interpretation_scope: [], screening_rules: [] },
  };
  await page.route("**/api/regions", (route) => route.fulfill({ json: [region] }));
  await page.route("**/api/workspace/snapshot?*", (route) => route.fulfill({
    json: {
      snapshot_id: "map-marker-clarity-fixture",
      region,
      events: [],
      metrics: {
        active_events: 0,
        critical_events: 0,
        observing_assets: 72,
        data_freshness_hours: 1,
        coverage_percent: 100,
        last_analysis_at: "2026-08-23T12:00:00Z",
        source_count: 1,
        region_count: 1,
        live_event_count: 0,
        observation_count: profiles.length,
        coverage_basis: "source_availability",
      },
      sources: [],
      observations,
      argo_region: {
        region_id: region.id,
        region: region.name,
        bounds: region.bounds,
        lookback_days: 35,
        fetched_at: "2026-08-23T12:00:00Z",
        profile_count: profiles.length,
        float_count: 72,
        bgc_float_count: 9,
        latest_observation_at: "2026-08-23T12:00:00Z",
        profiles,
        floats: profiles.slice(0, 72),
        source: { name: "QA fixture", url: "", gdac_url: "", source_urls: [], credit: "Visual regression only" },
        cache: { state: "fresh", age_seconds: 0, ttl_seconds: 60 },
      },
      refreshed_at: "2026-08-23T12:00:00Z",
      cache_state: "fresh",
      errors: [],
    },
  }));
  await page.addInitScript(() => {
    localStorage.setItem("ocean-ui-visual-theme", JSON.stringify("light-blue"));
    localStorage.setItem("ocean-ui-explorer-guide-seen", JSON.stringify(false));
    localStorage.setItem("ocean-ui-layer-card-collapsed", JSON.stringify(false));
  });
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });

  await expect(page.locator(".app-shell")).toHaveAttribute("data-visual-theme", "light-blue");
  await expect(page.locator(".map-shell")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".monitoring-point-canvas")).toHaveCount(0);
  await expect(page.getByText("历史剖面（点击展开）", { exact: true })).toBeVisible();
  await expect(page.getByText("当前活动浮标", { exact: true })).toBeVisible();
  await expect(page.getByText("BGC 生地化浮标", { exact: true })).toBeVisible();
  await expect(page.getByText("实时海温格点", { exact: true })).toBeVisible();
  await expect(page.getByText("360", { exact: true }).first()).toBeVisible();
  await expect.poll(async () => page.locator(".argo-cluster-count-label").count(), { timeout: 15_000 }).toBeGreaterThan(0);

  const map = page.locator(".map-shell");
  await map.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1_000);
  await map.screenshot({ path: path.join(OUTPUT, "light-map-marker-clarity.png") });

  const ocean = page.locator(".animated-ocean");
  const initialZoom = Number(await ocean.getAttribute("data-ocean-zoom"));
  const clusterLabel = page.locator(".argo-cluster-count-label").first();
  const clusterBounds = await clusterLabel.boundingBox();
  expect(clusterBounds).not.toBeNull();
  if (!clusterBounds) return;
  await page.mouse.click(clusterBounds.x + clusterBounds.width / 2, clusterBounds.y + clusterBounds.height / 2);
  await expect.poll(async () => Number(await ocean.getAttribute("data-ocean-zoom")), { timeout: 5_000 })
    .toBeGreaterThan(initialZoom + 0.5);
  await expect(page.locator(".sea-probe-panel")).toHaveCount(0);
  await expect(page.locator(".argo-cluster-popup")).toHaveCount(0);
  await map.screenshot({ path: path.join(OUTPUT, "light-map-marker-expanded.png") });
});

test("map pans continuously across the international date line", async ({ page }) => {
  test.setTimeout(45_000);
  fs.mkdirSync(OUTPUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("ocean-ui-visual-theme", JSON.stringify("light-blue"));
    localStorage.setItem("ocean-ui-region-v3", JSON.stringify("global_ocean"));
    localStorage.setItem("ocean-ui-explorer-guide-seen", JSON.stringify(false));
  });
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });

  const map = page.locator(".map-shell");
  const ocean = page.locator(".animated-ocean");
  await expect(map).toBeVisible({ timeout: 30_000 });
  await expect(ocean).toHaveAttribute("data-ocean-ready", "true", { timeout: 15_000 });
  await map.scrollIntoViewIfNeeded();
  const bounds = await map.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;

  const readLongitude = async () => Number((await ocean.getAttribute("data-ocean-center"))?.split(",")[0] ?? 0);
  const longitudes = [await readLongitude()];
  let crossedDateLine = false;
  for (let step = 0; step < 6; step += 1) {
    const previous = longitudes.at(-1) ?? 0;
    await page.mouse.move(bounds.x + bounds.width * 0.62, bounds.y + bounds.height * 0.54);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.46, bounds.y + bounds.height * 0.54, { steps: 12 });
    await page.mouse.up();
    await expect.poll(readLongitude, { timeout: 3_000 }).not.toBeCloseTo(previous, 1);
    const current = await readLongitude();
    longitudes.push(current);
    if (previous > 90 && current < -90) {
      crossedDateLine = true;
      break;
    }
  }
  expect(crossedDateLine).toBeTruthy();
  await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + 18);
  await page.waitForTimeout(250);
  await map.screenshot({ path: path.join(OUTPUT, "light-map-world-wrap.png") });
});
