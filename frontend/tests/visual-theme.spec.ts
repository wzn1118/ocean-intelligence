import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const APP_URL = process.env.OCEAN_APP_URL ?? "http://127.0.0.1:5174/";
const OUTPUT = process.env.OCEAN_QA_OUTPUT ?? path.resolve("test-results", "visual-theme");

const prepareOutput = () => fs.mkdirSync(OUTPUT, { recursive: true });

async function sampleOceanCanvas(page: Page) {
  return page.locator('canvas[data-ocean-canvas="true"]').evaluate((element) => {
    const source = element as HTMLCanvasElement;
    const copy = document.createElement("canvas");
    copy.width = 64;
    copy.height = 64;
    const context = copy.getContext("2d", { willReadFrequently: true });
    if (!context) return { luminance: 0, blueLead: 0 };
    context.drawImage(source, 0, 0, copy.width, copy.height);
    const pixels = context.getImageData(0, 0, copy.width, copy.height).data;
    let luminance = 0;
    let blueLead = 0;
    const count = pixels.length / 4;
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      luminance += red * 0.2126 + green * 0.7152 + blue * 0.0722;
      blueLead += blue - red;
    }
    return { luminance: luminance / count, blueLead: blueLead / count };
  });
}

test("the light-blue image2 theme toggles and persists", async ({ page }) => {
  prepareOutput();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("visual-theme-test-initialized")) {
      localStorage.removeItem("ocean-ui-visual-theme");
      sessionStorage.setItem("visual-theme-test-initialized", "true");
    }
    localStorage.setItem("ocean-ui-explorer-guide-seen", JSON.stringify(false));
  });
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });

  const shell = page.locator(".app-shell");
  const ocean = page.locator(".animated-ocean");
  await expect(shell).toHaveAttribute("data-visual-theme", "night");
  await expect(ocean).toHaveAttribute("data-ocean-ready", "true", { timeout: 15_000 });
  const nightOcean = await sampleOceanCanvas(page);
  await page.getByRole("button", { name: "切换为浅蓝海报主视觉" }).click();
  await expect(shell).toHaveAttribute("data-visual-theme", "light-blue");
  await expect(ocean).toHaveAttribute("data-ocean-theme", "light-blue");
  await expect.poll(async () => (await sampleOceanCanvas(page)).luminance, { timeout: 4_000 })
    .toBeGreaterThan(nightOcean.luminance + 40);
  const lightOcean = await sampleOceanCanvas(page);
  expect(lightOcean.blueLead).toBeGreaterThan(30);
  await expect(page.getByRole("button", { name: "切换为深色潮汐主视觉" })).toBeVisible();

  const posterReference = await shell.evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(posterReference).toContain("ocean-poster-lightblue-2048x1152.png");
  const posterResponse = await page.request.get(`${APP_URL}art/ocean-poster-lightblue-2048x1152.png`);
  expect(posterResponse.ok()).toBeTruthy();
  expect((await posterResponse.body()).byteLength).toBeGreaterThan(1_000_000);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(shell).toHaveAttribute("data-visual-theme", "light-blue");
  await expect(page.locator(".event-row").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".loading-panel")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator(".understand-card-grid article").first()).toBeVisible({ timeout: 30_000 });
  const posterSurfaces = await page.locator(
    ".event-rail, .detail-panel, .understand-card-grid article, .metric-band, .api-explanation",
  ).evaluateAll((elements) => elements.map((element) => ({
    backgroundColor: getComputedStyle(element).backgroundColor,
    backgroundImage: getComputedStyle(element).backgroundImage,
  })));
  expect(posterSurfaces.every((surface) => surface.backgroundColor === "rgba(0, 0, 0, 0)")).toBeTruthy();
  expect(posterSurfaces.every((surface) => surface.backgroundImage === "none")).toBeTruthy();
  const readingVeils = await page.locator(".event-rail, .detail-panel").evaluateAll((elements) => elements.map((element) => {
    const style = getComputedStyle(element, "::before");
    return { backgroundImage: style.backgroundImage, backdropFilter: style.backdropFilter };
  }));
  expect(readingVeils.every((surface) => surface.backgroundImage.includes("linear-gradient"))).toBeTruthy();
  expect(readingVeils.every((surface) => surface.backdropFilter.includes("blur"))).toBeTruthy();
  await page.getByRole("tab", { name: "观测概览" }).click();
  const observationMatrix = page.locator(".observation-matrix");
  await expect(observationMatrix).toBeVisible({ timeout: 15_000 });
  const matrixTheme = await observationMatrix.evaluate((element) => {
    const header = element.querySelector(".observation-matrix-header");
    const conclusion = element.querySelector(".observation-conclusion");
    const heading = element.querySelector(".observation-matrix-header h2");
    return {
      headerBackground: header ? getComputedStyle(header).backgroundImage : "",
      conclusionBackground: conclusion ? getComputedStyle(conclusion).backgroundColor : "",
      headingColor: heading ? getComputedStyle(heading).color : "",
    };
  });
  expect(matrixTheme.headerBackground).toContain("ocean-poster-lightblue-2048x1152.png");
  expect(matrixTheme.conclusionBackground).toBe("rgba(228, 246, 248, 0.38)");
  expect(matrixTheme.headingColor).toBe("rgb(16, 59, 70)");
  const darkMatrixSurfaces = await observationMatrix.evaluate((element) => Array.from(element.querySelectorAll<HTMLElement>("*"))
    .map((node) => {
      const style = getComputedStyle(node);
      const match = style.backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return null;
      const [, red, green, blue, alpha = "1"] = match;
      const luminance = Number(red) * 0.2126 + Number(green) * 0.7152 + Number(blue) * 0.0722;
      const bounds = node.getBoundingClientRect();
      return Number(alpha) >= 0.25 && bounds.width * bounds.height > 6_000 && luminance < 105
        ? { className: node.className, backgroundColor: style.backgroundColor, luminance }
        : null;
    })
    .filter(Boolean));
  expect(darkMatrixSurfaces).toEqual([]);
  await observationMatrix.screenshot({ path: path.join(OUTPUT, "observation-matrix-light-theme.png") });
  await page.screenshot({ path: path.join(OUTPUT, "ocean-light-blue-theme-desktop.png"), fullPage: true });
});

test("the light-blue theme fits a mobile viewport", async ({ page }) => {
  prepareOutput();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem("ocean-ui-visual-theme", JSON.stringify("light-blue"));
    localStorage.setItem("ocean-ui-explorer-guide-seen", JSON.stringify(false));
  });
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });

  await expect(page.locator(".app-shell")).toHaveAttribute("data-visual-theme", "light-blue");
  await expect(page.getByRole("button", { name: "切换为深色潮汐主视觉" })).toBeVisible();
  await expect(page.locator(".buoy-command-button")).toBeHidden();
  const headerLayout = await page.locator(".command-bar").evaluate((header) => {
    const headerBounds = header.getBoundingClientRect();
    const brandBounds = header.querySelector(".brand-lockup")?.getBoundingClientRect();
    const actionsBounds = header.querySelector(".command-actions")?.getBoundingClientRect();
    return {
      header: { left: headerBounds.left, right: headerBounds.right },
      brand: brandBounds ? { left: brandBounds.left, right: brandBounds.right } : null,
      actions: actionsBounds ? { left: actionsBounds.left, right: actionsBounds.right } : null,
    };
  });
  expect(headerLayout.brand).not.toBeNull();
  expect(headerLayout.actions).not.toBeNull();
  if (headerLayout.brand && headerLayout.actions) {
    expect(headerLayout.brand.left).toBeGreaterThanOrEqual(headerLayout.header.left - 1);
    expect(headerLayout.actions.right).toBeLessThanOrEqual(headerLayout.header.right + 1);
    expect(headerLayout.brand.right).toBeLessThanOrEqual(headerLayout.actions.left + 1);
  }
  const queueTabs = await page.locator(".event-view-tab").evaluateAll((tabs) => tabs.map((tab) => {
    const tabBounds = tab.getBoundingClientRect();
    const copyBounds = tab.querySelector(".event-view-tab-copy")?.getBoundingClientRect();
    return {
      height: tabBounds.height,
      copyContained: copyBounds
        ? copyBounds.top >= tabBounds.top && copyBounds.bottom <= tabBounds.bottom
        : false,
    };
  }));
  expect(queueTabs).toHaveLength(4);
  expect(queueTabs.every((tab) => tab.height >= 58 && tab.copyContained)).toBeTruthy();
  await expect(page.locator(".event-row").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".loading-panel")).toHaveCount(0, { timeout: 30_000 });
  await page.locator(".event-row").first().click();
  await page.getByRole("tab", { name: "观测概览" }).click();
  const observationMatrix = page.locator(".observation-matrix");
  await expect(observationMatrix).toBeVisible({ timeout: 15_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const matrixOverflow = await observationMatrix.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(matrixOverflow).toBeLessThanOrEqual(1);
  await observationMatrix.screenshot({ path: path.join(OUTPUT, "observation-matrix-light-mobile.png") });
  await page.screenshot({ path: path.join(OUTPUT, "ocean-light-blue-theme-mobile.png"), fullPage: true });
});

test("event queue controls keep one visual structure across both themes", async ({ page }) => {
  prepareOutput();
  await page.setViewportSize({ width: 1295, height: 760 });
  await page.addInitScript(() => {
    localStorage.setItem("ocean-ui-visual-theme", JSON.stringify("night"));
    localStorage.setItem("ocean-ui-explorer-guide-seen", JSON.stringify(false));
    localStorage.setItem("ocean-ui-workspace-layout", JSON.stringify("flow"));
  });
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });

  const rail = page.locator(".event-rail");
  const tabs = rail.locator(".event-view-tab");
  await expect(rail).toBeVisible({ timeout: 30_000 });
  await expect(tabs).toHaveCount(4);

  const inspectQueue = () => rail.evaluate((element) => {
    const tabNodes = Array.from(element.querySelectorAll<HTMLElement>(".event-view-tab"));
    const filterNodes = Array.from(element.querySelectorAll<HTMLElement>(".filter-chip"));
    return {
      overflow: element.scrollWidth - element.clientWidth,
      tabWidths: tabNodes.map((node) => Math.round(node.getBoundingClientRect().width)),
      tabHeights: tabNodes.map((node) => Math.round(node.getBoundingClientRect().height)),
      tabAppearances: tabNodes.map((node) => getComputedStyle(node).appearance),
      tabBackgrounds: tabNodes.map((node) => getComputedStyle(node).backgroundColor),
      filterRows: new Set(filterNodes.map((node) => Math.round(node.getBoundingClientRect().top))).size,
      clippedLabels: tabNodes.some((node) => Array.from(node.children).some((child) => child.scrollWidth > child.clientWidth + 1)),
    };
  });

  const night = await inspectQueue();
  expect(night.overflow).toBeLessThanOrEqual(1);
  expect(Math.max(...night.tabWidths) - Math.min(...night.tabWidths)).toBeLessThanOrEqual(1);
  expect(new Set(night.tabHeights).size).toBe(1);
  expect(night.tabAppearances).toEqual(["none", "none", "none", "none"]);
  expect(night.tabBackgrounds).not.toContain("rgb(239, 239, 239)");
  expect(night.filterRows).toBe(3);
  expect(night.clippedLabels).toBeFalsy();
  await rail.screenshot({ path: path.join(OUTPUT, "event-queue-night-unified.png") });

  await page.getByRole("button", { name: "切换为浅蓝海报主视觉" }).click();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-visual-theme", "light-blue");
  const light = await inspectQueue();
  expect(light.overflow).toBeLessThanOrEqual(1);
  expect(light.tabWidths).toEqual(night.tabWidths);
  expect(light.tabHeights).toEqual(night.tabHeights);
  expect(light.tabAppearances).toEqual(night.tabAppearances);
  expect(light.filterRows).toBe(night.filterRows);
  expect(light.clippedLabels).toBeFalsy();
  expect(light.tabBackgrounds).not.toEqual(night.tabBackgrounds);
  await rail.screenshot({ path: path.join(OUTPUT, "event-queue-light-unified.png") });
});
