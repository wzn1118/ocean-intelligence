import { expect, test } from "@playwright/test";

const appUrl = process.env.OCEAN_APP_URL ?? "http://127.0.0.1:5173/";
const email = process.env.OCEAN_E2E_EMAIL;
const password = process.env.OCEAN_E2E_PASSWORD;
const marker = process.env.OCEAN_E2E_MARKER ?? "E2E_RECOVERY_MARKER_20260829";

test("restores a dormant Codex conversation and keeps it after a full refresh", async ({ page }) => {
  test.skip(!email || !password, "Set OCEAN_E2E_EMAIL and OCEAN_E2E_PASSWORD for the authenticated recovery test.");
  test.setTimeout(120_000);

  let login = await page.request.post(new URL("api/auth/login", appUrl).toString(), { data: { email, password } });
  for (let attempt = 1; attempt < 3 && !login.ok(); attempt += 1) {
    await page.waitForTimeout(500 * attempt);
    login = await page.request.post(new URL("api/auth/login", appUrl).toString(), { data: { email, password } });
  }
  const loginBody = login.ok() ? "" : await login.text();
  expect(login.ok(), `login failed with ${login.status()}: ${loginBody}`).toBeTruthy();

  const openCodex = async () => {
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "打开海洋数据 Agent" }).click();
    await page.getByRole("button", { name: "Codex", exact: true }).click();
    await expect(page.locator(".codex-thread-rail")).toBeVisible({ timeout: 30_000 });
  };

  await openCodex();
  let row = page.locator(".codex-thread-row", { hasText: marker });
  await expect(row).toHaveCount(1, { timeout: 30_000 });
  await expect(row.locator("em")).toHaveText("待恢复");
  await row.locator(".codex-thread-restore").click();
  await expect(page.locator(".codex-transcript")).toContainText(marker, { timeout: 30_000 });
  await expect(row.locator("em")).toHaveText("已完成", { timeout: 30_000 });
  const restoredStatusBox = await row.locator("em").boundingBox();
  expect(restoredStatusBox).not.toBeNull();
  expect(restoredStatusBox?.width ?? 0).toBeGreaterThan(20);
  expect(restoredStatusBox?.height ?? 100).toBeLessThan(20);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "打开海洋数据 Agent" }).click();
  await page.getByRole("button", { name: "Codex", exact: true }).click();
  row = page.locator(".codex-thread-row", { hasText: marker });
  await expect(row.locator("em")).toHaveText("已完成", { timeout: 30_000 });
  await expect(page.locator(".codex-transcript")).toContainText(marker, { timeout: 30_000 });

  await page.screenshot({ path: "test-results/codex-recovery/after-refresh.png", fullPage: true });
});
