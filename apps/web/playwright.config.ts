import { defineConfig } from "@playwright/test";

const authFile = "tests/e2e/.auth/user.json";
const port = Number(process.env.PLAYWRIGHT_PORT ?? process.env.PORT ?? "7015");
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;
const workers = Number(process.env.PLAYWRIGHT_WORKERS ?? "1");

process.env.PLAYWRIGHT_TEST ??= "true";
process.env.DB_PORT ??= "15532";
process.env.REDIS_URL ??= "redis://localhost:16379";
process.env.NODE_OPTIONS ??= "--max-old-space-size=4096";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  workers,
  retries: 1,
  use: {
    baseURL,
    extraHTTPHeaders: {
      origin: baseURL,
    },
    headless: true,
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "unauth",
      testMatch: /auth-deeplink\.spec\.ts/,
    },
    {
      name: "chromium",
      dependencies: ["setup"],
      testIgnore: [/auth\.setup\.ts/, /auth-deeplink\.spec\.ts/],
      use: {
        storageState: authFile,
      },
    },
  ],
  webServer: {
    command: `PLAYWRIGHT_TEST=true PORT=${port} pnpm dev`,
    port,
    reuseExistingServer: process.env.CI !== "true",
  },
});
