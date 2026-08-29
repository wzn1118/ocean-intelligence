import { expect, test } from "@playwright/test";


const APP_URL = process.env.OCEAN_APP_URL ?? "http://127.0.0.1:5173/";


test("first screen uses one workspace snapshot instead of legacy fan-out", async ({ page }) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) apiRequests.push(request.url());
  });

  const snapshotResponse = page.waitForResponse(
    (response) => response.url().includes("/api/workspace/snapshot") && response.status() === 200,
    { timeout: 30_000 },
  );
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await snapshotResponse;
  await expect(page.locator(".workspace-grid")).toBeVisible();

  expect(apiRequests.some((url) => url.includes("/api/workspace/snapshot"))).toBeTruthy();
  expect(apiRequests.some((url) => url.includes("compact=true"))).toBeTruthy();
  expect(apiRequests.some((url) => url.includes("/api/events?"))).toBeFalsy();
  expect(apiRequests.some((url) => url.includes("/api/metrics?"))).toBeFalsy();
  expect(apiRequests.some((url) => url.includes("/api/sources?"))).toBeFalsy();
  expect(apiRequests.some((url) => url.includes("/api/observations/summary"))).toBeFalsy();
});


test("partial upstream degradation keeps the available workspace interactive", async ({ page }) => {
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".workspace-grid")).toBeVisible();
  await expect(page.locator(".api-error")).toHaveCount(0);
  await expect(page.locator(".map-shell")).toBeVisible();
  await expect(page.locator(".event-row").first()).toBeVisible();
  await expect(page.locator(".detail-panel")).toBeVisible();
});


test("narrow first screen does not stall before map sources are ready", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  await page.setViewportSize({ width: 543, height: 1165 });

  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".workspace-grid")).toBeVisible();
  await expect(page.locator(".map-shell")).toBeVisible();
  await expect(page.locator(".event-row").first()).toBeVisible();
  await page.waitForTimeout(1_000);

  expect(runtimeErrors).toEqual([]);
});
