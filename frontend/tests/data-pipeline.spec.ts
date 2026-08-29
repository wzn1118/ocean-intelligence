import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const APP_URL = process.env.OCEAN_APP_URL ?? "http://127.0.0.1:5173/";
const QA_OUTPUT = process.env.OCEAN_QA_OUTPUT ?? path.join(process.env.TEMP ?? path.resolve("test-results"), "ocean-observation-qa");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ocean-ui-explorer-guide-seen", JSON.stringify(false));
  });
});

test("core workspace snapshot loads through the same-origin API proxy", async ({ page }) => {
  const apiResponses: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/")) apiResponses.push(response.url());
  });

  const snapshotResponse = page.waitForResponse(
    (response) => response.url().includes("/api/workspace/snapshot?") && response.request().method() === "GET",
    { timeout: 30_000 },
  );
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await snapshotResponse;
  await expect.poll(async () => page.locator(".event-row, .event-list .empty-state").count(), { timeout: 15_000 }).toBeGreaterThan(0);
  expect(apiResponses.some((url) => url.includes("127.0.0.1:5173/api/workspace/snapshot"))).toBeTruthy();
  expect(apiResponses.some((url) => url.includes("127.0.0.1:8000"))).toBeFalsy();
});

test("an absent optional source list does not take down the workspace", async ({ page }) => {
  const response = await page.request.get(`${APP_URL}api/workspace/snapshot?region=northwest_pacific`);
  expect(response.ok()).toBeTruthy();
  const snapshot = await response.json();
  snapshot.sources = [];
  snapshot.errors = [];
  await page.route("**/api/workspace/snapshot?**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot) });
  });

  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await expect.poll(async () => page.locator(".event-row, .event-list .empty-state").count(), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(page.locator(".api-error")).toHaveCount(0);
});

test("filtered queue count uses generated records instead of source grid size", async ({ page }) => {
  const response = await page.request.get(`${APP_URL}api/workspace/snapshot?region=global_ocean`);
  expect(response.ok()).toBeTruthy();
  const snapshot = await response.json();
  snapshot.event_counts.by_filter.wind_anomaly = 102_792;
  snapshot.errors = [];
  const expectedCount = snapshot.events.filter((event: { event_kind: string; type: string; variables: string[] }) =>
    event.type === "wind_anomaly"
    || (event.event_kind === "observation" && event.variables.some((variable) => ["WIND_SPEED", "WIND_DIRECTION"].includes(variable))),
  ).length;
  await page.route("**/api/workspace/snapshot?**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot) });
  });

  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  const skipGuide = page.getByRole("button", { name: "跳过引导" });
  if (await skipGuide.isVisible()) await skipGuide.click();
  const professionalMode = page.getByRole("button", { name: "专业模式" });
  if (await professionalMode.isVisible()) await professionalMode.click();
  await page.getByRole("button", { name: "风场" }).click();

  await expect(page.locator(".event-count")).toHaveText(String(expectedCount));
  await expect(page.locator(".event-count")).not.toHaveText("102792");
});

test("the pipeline reconnects after a temporary workspace snapshot 404", async ({ page }) => {
  const response = await page.request.get(`${APP_URL}api/workspace/snapshot?region=northwest_pacific`);
  expect(response.ok()).toBeTruthy();
  const snapshot = await response.json();
  snapshot.errors = [];
  let snapshotUnavailable = true;
  await page.route("**/api/workspace/snapshot?**", async (route) => {
    if (snapshotUnavailable) {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ detail: "temporary route mismatch" }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot) });
  });

  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  const alert = page.locator(".api-error");
  await expect(alert).toBeVisible({ timeout: 10_000 });
  await expect(alert).toContainText("GET /workspace/snapshot");

  snapshotUnavailable = false;
  await page.getByRole("button", { name: "立即重新连接" }).click();
  await expect(alert).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(async () => page.locator(".event-row, .event-list .empty-state").count(), { timeout: 15_000 }).toBeGreaterThan(0);
});

test("Argo profiles load before optional marine context and keep interpretation limits", async ({ page }) => {
  test.setTimeout(60_000);
  const [workspaceResponse, scenariosResponse, floatResponse] = await Promise.all([
    page.request.get(`${APP_URL}api/workspace/snapshot?region=northwest_pacific`),
    page.request.get(`${APP_URL}api/events?mode=scenario`),
    page.request.get(`${APP_URL}api/argo/float/7902333`),
  ]);
  expect(workspaceResponse.ok()).toBeTruthy();
  expect(scenariosResponse.ok()).toBeTruthy();
  expect(floatResponse.ok()).toBeTruthy();
  const workspace = await workspaceResponse.json();
  const scenarios = await scenariosResponse.json();
  const snapshot = await floatResponse.json();
  const selectedEvent = scenarios[0];
  const recentTrack = snapshot.track.filter((point: { timestamp: string }) =>
    Date.parse(point.timestamp) >= Date.parse(snapshot.latest.timestamp) - 35 * 24 * 60 * 60 * 1_000,
  );
  snapshot.track = recentTrack;
  snapshot.profile_count = recentTrack.length;
  snapshot.profile_scope = "regional_window";
  snapshot.profile_window_days = 35;
  const unverifiedSalinitySnapshot = JSON.parse(JSON.stringify(snapshot));
  unverifiedSalinitySnapshot.latest.surface.salinity_qc = null;
  unverifiedSalinitySnapshot.latest.surface.salinity_pressure = null;
  unverifiedSalinitySnapshot.latest.surface_modes.salinity = "unavailable";
  unverifiedSalinitySnapshot.latest.variable_modes.salinity = "raw";
  unverifiedSalinitySnapshot.latest.points = unverifiedSalinitySnapshot.latest.points.map((point: Record<string, unknown>) => ({
    ...point,
    salinity_qc: null,
    salinity_mode: "raw",
  }));
  workspace.events = [selectedEvent];
  workspace.errors = [];
  let releaseMarineContext: () => void = () => {};
  const marineContextGate = new Promise<void>((resolve) => {
    releaseMarineContext = resolve;
  });

  await page.route("**/api/workspace/snapshot?**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(workspace) });
  });
  await page.route("**/api/events/*/argo*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        event_id: selectedEvent.id,
        event_title: selectedEvent.title,
        event_center: selectedEvent.centroid,
        event_radius_km: selectedEvent.radius_km,
        radius_basis: selectedEvent.radius_basis,
        regional_float_count: workspace.argo_region?.float_count ?? 0,
        matched_count: 0,
        match_mode: "nearest",
        candidates: [{
          platform: snapshot.platform,
          latest_profile_id: `${snapshot.platform}_${String(snapshot.latest.cycle).padStart(3, "0")}`,
          cycle: snapshot.latest.cycle,
          timestamp: snapshot.latest.timestamp,
          longitude: snapshot.latest.longitude,
          latitude: snapshot.latest.latitude,
          profile_count: recentTrack.length,
          networks: ["argo_core"],
          has_bgc: false,
          distance_km: 0,
          within_event_radius: false,
        }],
        selected_platform: snapshot.platform,
        snapshot: unverifiedSalinitySnapshot,
        fetched_at: new Date().toISOString(),
      }),
    });
  });
  await page.route("**/api/argo/nearest?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        query_point: [snapshot.latest.longitude, snapshot.latest.latitude],
        region_id: "northwest_pacific",
        region: workspace.region.name,
        regional_float_count: workspace.argo_region?.float_count ?? 0,
        candidates: [{
          platform: snapshot.platform,
          latest_profile_id: `${snapshot.platform}_${String(snapshot.latest.cycle).padStart(3, "0")}`,
          cycle: snapshot.latest.cycle,
          timestamp: snapshot.latest.timestamp,
          longitude: snapshot.latest.longitude,
          latitude: snapshot.latest.latitude,
          profile_count: recentTrack.length,
          networks: ["argo_core"],
          has_bgc: false,
          distance_km: 0,
          within_event_radius: false,
        }],
        nearest_platform: snapshot.platform,
        nearest_distance_km: 0,
        selected_platform: snapshot.platform,
        selected_distance_km: 0,
        snapshot: unverifiedSalinitySnapshot,
        fetched_at: new Date().toISOString(),
      }),
    });
  });
  await page.route("**/api/marine/context?**", async (route) => {
    await marineContextGate;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "delayed optional context" }),
    });
  });
  await page.route("**/api/events/*/literature*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        event_id: selectedEvent.id,
        query: "Northwest Pacific phytoplankton bloom chlorophyll",
        provider: "OpenAlex",
        searched_at: new Date().toISOString(),
        total: 1,
        cached: false,
        fallback_error: null,
        results: [{
          id: "OPENALEX-WREALTIME",
          title: "Realtime scholarly result",
          citation: "Researcher. Realtime scholarly result. Ocean Journal.",
          year: 2026,
          doi: "10.1234/realtime",
          relevance: "OpenAlex 实时检索匹配。",
          variables: ["CHLA"],
          provider: "OpenAlex",
          url: "https://doi.org/10.1234/realtime",
          authors: "Researcher",
          journal: "Ocean Journal",
          cited_by_count: 12,
          open_access: true,
        }],
      }),
    });
  });
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  const skipGuide = page.getByRole("button", { name: "跳过引导" });
  if (await skipGuide.isVisible()) await skipGuide.click();
  await page.getByRole("button", { name: "专业模式" }).click();
  await page.getByRole("button", { name: "匹配邻近 Argo 浮标" }).click();
  await expect(page.locator(".argo-live-card:not(.argo-live-skeleton) .argo-live-meta")).toContainText("近 35 天", { timeout: 30_000 });
  await expect(page.locator(".argo-live-title")).toContainText("浮标 7902333");
  await expect(page.locator(".argo-qc-badge")).toContainText(/最浅层 QC [12] · (原始值|调整值)/);
  await expect(page.locator(".argo-reading-scope")).toContainText("最浅有效观测位于 81.1 dbar，不是海表观测");
  await expect(page.locator(".argo-reading-scope")).toContainText("不作趋势、水团变化或事件确认");
  await expect(page.locator(".argo-live-chart-heading")).toContainText("垂向压力剖面");
  await expect(page.locator(".argo-chart-axis-note")).toContainText("最浅有效 81.1 dbar");
  await expect(page.locator(".argo-track-strip")).toContainText("源周期 115 / 118 / 151 / 166（编号非连续）");

  const openDetail = page.getByRole("button", { name: "\u6253\u5f00 Argo 7902333 \u8be6\u7ec6\u6570\u636e" }).first();
  await expect(openDetail).toBeVisible({ timeout: 30_000 });
  await openDetail.click();
  const detailDrawer = page.locator(".sea-probe-detail-drawer");
  await expect(detailDrawer).toBeVisible({ timeout: 3_000 });
  releaseMarineContext();
  await expect(detailDrawer.locator(".argo-data-details")).toHaveClass(/open/);
  await expect(detailDrawer.locator(".argo-data-meta-grid")).toBeVisible();
  await expect(detailDrawer.locator(".argo-variable-coverage-row")).toHaveCount(4);
  await expect(detailDrawer.locator(".argo-profile-table tbody tr")).toHaveCount(snapshot.latest.points.length);
  await expect(detailDrawer.locator(".argo-track-table > div")).not.toHaveCount(0);
  await detailDrawer.getByRole("button", { name: /盐度/ }).click();
  await expect(detailDrawer.locator(".argo-qc-badge.unverified")).toContainText("QC 未提供 · 原始值仅供查看");
  await expect(detailDrawer.locator(".argo-chart-empty")).toHaveCount(0);
  await expect(detailDrawer.locator(".argo-live-chart .recharts-line-curve")).toBeVisible();
  await expect(detailDrawer.locator(".argo-live-chart .recharts-line-curve")).toHaveAttribute("stroke-dasharray", "6 5");
  await expect(detailDrawer.locator(".argo-chart-axis-note")).toContainText("最浅原始");
  await expect(detailDrawer.locator(".argo-profile-reading > div.unverified")).not.toHaveCount(0);
  await expect(detailDrawer.locator(".argo-profile-story")).toContainText("不据此判断水层边界或异常");
  fs.mkdirSync(QA_OUTPUT, { recursive: true });
  await detailDrawer.screenshot({ path: path.join(QA_OUTPUT, "argo-unverified-salinity-profile.png") });
  await detailDrawer.getByRole("button", { name: "\u5173\u95ed\u6d6e\u6807\u8be6\u60c5" }).click();
  await expect(detailDrawer).toHaveCount(0);

  const mapShell = page.locator(".map-shell");
  const compactProbe = page.locator(".sea-probe-panel");
  await expect(compactProbe).toBeVisible();
  const mapBounds = await mapShell.boundingBox();
  const probeBounds = await compactProbe.boundingBox();
  expect(mapBounds).not.toBeNull();
  expect(probeBounds).not.toBeNull();
  if (mapBounds && probeBounds) {
    expect(probeBounds.width).toBeLessThanOrEqual(394);
    expect(probeBounds.height).toBeLessThanOrEqual(682);
    expect(probeBounds.x).toBeGreaterThanOrEqual(mapBounds.x - 1);
    expect(probeBounds.y).toBeGreaterThanOrEqual(mapBounds.y - 1);
    expect(probeBounds.x + probeBounds.width).toBeLessThanOrEqual(mapBounds.x + mapBounds.width + 1);
    expect(probeBounds.y + probeBounds.height).toBeLessThanOrEqual(mapBounds.y + mapBounds.height + 1);

    const headingBounds = await compactProbe.locator(".sea-probe-heading").boundingBox();
    expect(headingBounds).not.toBeNull();
    if (headingBounds) {
      await page.mouse.move(headingBounds.x + 58, headingBounds.y + headingBounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(headingBounds.x + 128, headingBounds.y + headingBounds.height / 2 + 48, { steps: 6 });
      await page.mouse.up();
      const movedBounds = await compactProbe.boundingBox();
      expect(movedBounds).not.toBeNull();
      if (movedBounds) {
        expect(Math.abs(movedBounds.x - probeBounds.x) + Math.abs(movedBounds.y - probeBounds.y)).toBeGreaterThan(45);
        expect(movedBounds.x).toBeGreaterThanOrEqual(mapBounds.x - 1);
        expect(movedBounds.y).toBeGreaterThanOrEqual(mapBounds.y - 1);
        expect(movedBounds.x + movedBounds.width).toBeLessThanOrEqual(mapBounds.x + mapBounds.width + 1);
        expect(movedBounds.y + movedBounds.height).toBeLessThanOrEqual(mapBounds.y + mapBounds.height + 1);
      }
    }
  }
  await mapShell.screenshot({ path: path.join(QA_OUTPUT, "probe-compact-draggable.png") });

  await compactProbe.getByRole("button", { name: "\u6536\u8d77\u70b9\u4f4d\u89c2\u6d4b" }).click();
  await expect(compactProbe).toHaveClass(/collapsed/);
  const collapsedBounds = await compactProbe.boundingBox();
  expect(collapsedBounds).not.toBeNull();
  if (collapsedBounds) expect(collapsedBounds.height).toBeLessThanOrEqual(60);
  await compactProbe.getByRole("button", { name: "\u5c55\u5f00\u70b9\u4f4d\u89c2\u6d4b" }).click();
  await expect(compactProbe).not.toHaveClass(/collapsed/);

  const ticks = await page
    .locator(".argo-live-chart .recharts-yAxis .recharts-cartesian-axis-tick")
    .evaluateAll((nodes) => nodes.map((node) => {
      const label = node.textContent?.trim() ?? "";
      const text = node.querySelector("text");
      return { value: Number(label), y: Number(text?.getAttribute("y")) };
    }).filter((tick) => Number.isFinite(tick.value) && Number.isFinite(tick.y)));

  expect(ticks.length).toBeGreaterThan(1);
  const shallowest = ticks.reduce((left, right) => left.value < right.value ? left : right);
  const deepest = ticks.reduce((left, right) => left.value > right.value ? left : right);
  expect(shallowest.y).toBeLessThan(deepest.y);

  fs.mkdirSync(QA_OUTPUT, { recursive: true });
  await page.locator(".argo-live-card:not(.argo-live-skeleton)").screenshot({
    path: path.join(QA_OUTPUT, "argo-7902333-profile-panel.png"),
  });
  await page.getByRole("button", { name: "科学研读与边界" }).click();
  await expect(page.locator(".argo-explanation-boundary")).toContainText("研读边界");
  await expect(page.locator(".argo-explanation-body")).toContainText("不能据此确认水团变化");
  await page.locator(".argo-explanation").screenshot({
    path: path.join(QA_OUTPUT, "argo-7902333-scientific-reading.png"),
  });

  const literatureRequest = page.waitForRequest(
    (request) => request.url().includes(`/api/events/${selectedEvent.id}/literature`) && request.url().includes("refresh=true"),
    { timeout: 15_000 },
  );
  await page.getByRole("tab", { name: "文献依据" }).click();
  await literatureRequest;
  await expect(page.locator(".literature-live-meta")).toContainText("实时来源 OpenAlex");
  await expect(page.locator(".literature-item")).toContainText("Realtime scholarly result");

  await page.getByRole("tab", { name: "观测概览" }).click();
  await expect(page.locator(".observation-matrix")).toBeVisible();
  await expect(page.locator(".observation-variable-list [role='option']")).toHaveCount(5);
});

test("the information queue keeps observations neutral and marks only anomaly candidates", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  const queue = page.locator(".event-rail");
  const rows = queue.locator(".event-row");
  const observationRows = queue.locator(".event-row.observation");
  const anomalyRows = queue.locator(".event-row.anomaly");
  await expect(queue.getByRole("heading", { name: "海洋动态" })).toBeVisible();
  await expect.poll(async () => rows.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(100);
  await expect(queue.locator(".event-kind-badge")).toHaveCount(await rows.count());
  await expect(queue.locator(".queue-status")).toContainText(/事件 \d+ · 候选 \d+ · 观测 \d+/);
  const filters = queue.getByRole("group", { name: "变量或事件类型筛选" });
  await expect(filters.getByRole("button", { name: /^(热浪|藻华候选|涡旋|低温)$/ })).toHaveCount(0);

  await queue.getByRole("tab", { name: /实时观测/ }).click();
  await expect.poll(async () => observationRows.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(100);
  await expect(anomalyRows).toHaveCount(0);
  await expect(queue.locator(".event-kind-badge.observation")).toHaveCount(await observationRows.count());
  const observationClassifications = await observationRows.locator(".event-row-classification > span").allTextContents();
  const observationTitles = await observationRows.locator(".event-row-main > strong").allTextContents();
  expect(observationClassifications.filter((text) => /异常|热浪|暴发|涡旋|低温/.test(text))).toEqual([]);
  expect(observationTitles.filter((text) => /异常|热浪|暴发|涡旋|低温/.test(text))).toEqual([]);

  await queue.getByRole("tab", { name: /异常候选/ }).click();
  await expect.poll(async () => anomalyRows.count(), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(observationRows).toHaveCount(0);
  await expect(queue.locator(".event-kind-badge.anomaly")).toHaveCount(await anomalyRows.count());
  expect(await queue.locator(".event-kind-badge.anomaly").allTextContents()).toEqual(
    Array(await anomalyRows.count()).fill("候选"),
  );

  await queue.getByRole("tab", { name: /实时观测/ }).click();
  fs.mkdirSync(QA_OUTPUT, { recursive: true });
  await queue.screenshot({ path: path.join(QA_OUTPUT, "ocean-information-queue.png") });

  const initialVisibleCount = await rows.count();
  const loadMore = queue.getByRole("button", { name: /再加载 \d+ 条/ });
  await expect(loadMore).toBeVisible();
  await loadMore.click();
  await expect.poll(async () => rows.count()).toBeGreaterThan(initialVisibleCount);

  await expect(observationRows.first()).toBeVisible();
  const selectedObservationTitle = (await observationRows.first().locator(".event-row-main > strong").textContent())?.trim();
  expect(selectedObservationTitle).toBeTruthy();
  await observationRows.first().click();
  await expect(page.locator(".detail-title-block h1")).toHaveText(selectedObservationTitle!, { timeout: 30_000 });
  await expect(page.locator(".detail-kicker")).toContainText("海洋实测数据");
  await expect(page.locator(".metric-band")).toContainText("数据可信度");
  await expect(page.locator(".api-explanation")).toContainText("这条观测怎么读");
  await expect(page.locator(".detail-panel")).not.toContainText(/API 自动解读|常态观测事件|观测锚点|该条目|系统将其记录/);
  await page.locator(".detail-panel").screenshot({ path: path.join(QA_OUTPUT, "routine-observation-detail.png") });

  await page.getByRole("tab", { name: "观测概览" }).click();
  const matrix = page.locator(".observation-matrix");
  await expect(matrix).toBeVisible({ timeout: 15_000 });
  await expect(matrix.getByRole("heading", { name: "区域观测概览" })).toBeVisible();
  await expect(matrix.locator(".observation-variable-list [role='option']")).toHaveCount(5);
  await expect(matrix.locator(".observation-timeline-chart")).toBeVisible();
  await expect(matrix.locator(".observation-quality-row")).toHaveCount(4);
  await expect(matrix.locator(".observation-quality-insights > div")).toHaveCount(4);
  await expect(matrix.locator(".observation-coverage-row")).toHaveCount(5);
  await expect(matrix.locator(".observation-source-list > div")).not.toHaveCount(0);
  await expect(matrix).toContainText("多维综合结论");
  await expect(matrix.locator(".observation-conclusion")).toHaveAttribute("data-conclusion-state", /^(no_candidate|candidate_present)$/);
  await expect(matrix.locator(".observation-conclusion")).toContainText("判读范围");
  await expect(matrix.locator(".observation-conclusion")).toContainText("筛查规则");
  await expect(matrix.locator(".observation-conclusion")).not.toContainText(/数据受限|覆盖不足|待补充|暂不形成|后续监测|结论边界/);
  await expect(matrix.locator(".observation-conclusion-evidence > div")).not.toHaveCount(0);
  await expect(matrix.locator(".observation-conclusion-constraints > div")).toHaveCount(2);
  const salinity = matrix.getByRole("option", { name: /盐度/ });
  await salinity.click();
  await expect(salinity).toHaveAttribute("aria-selected", "true");
  await expect(matrix.locator(".observation-range-readout")).toContainText("PSU");
  await expect(page.locator(".api-error")).toHaveCount(0);
  await matrix.locator(".observation-conclusion").screenshot({
    path: path.join(QA_OUTPUT, "observation-conclusion-direct.png"),
  });
  await matrix.locator(".observation-quality-section").screenshot({
    path: path.join(QA_OUTPUT, "observation-quality-expanded.png"),
  });
  await page.screenshot({ path: path.join(QA_OUTPUT, "observation-matrix-desktop.png") });
});

test("the regional observation matrix remains contained on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await expect.poll(async () => page.locator(".event-row").count(), { timeout: 30_000 }).toBeGreaterThan(0);
  await page.locator(".event-row").first().click();
  await page.getByRole("tab", { name: "观测概览" }).click();
  const matrix = page.locator(".observation-matrix");
  await expect(matrix).toBeVisible({ timeout: 15_000 });
  await matrix.scrollIntoViewIfNeeded();
  const overflow = await matrix.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(matrix.locator(".observation-context-band > div")).toHaveCount(4);
  await expect(matrix.locator(".observation-variable-list [role='option']")).toHaveCount(5);
  await expect(matrix.locator(".observation-quality-row")).toHaveCount(4);
  await expect(matrix.locator(".observation-quality-insights > div")).toHaveCount(4);
  await expect(matrix.locator(".observation-coverage-row")).toHaveCount(5);
  await expect(matrix.locator(".observation-variable-coverage")).toContainText("变量可用率");
  fs.mkdirSync(QA_OUTPUT, { recursive: true });
  await page.screenshot({ path: path.join(QA_OUTPUT, "observation-matrix-mobile.png") });
});
