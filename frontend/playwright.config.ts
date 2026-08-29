import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  webServer: {
    command: "npm run dev -- --port 5173",
    url: "http://127.0.0.1:5173/",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
