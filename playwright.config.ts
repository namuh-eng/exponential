import { defineConfig } from "@playwright/test";

const authFile = "tests/e2e/.auth/user.json";
const port = Number(process.env.PLAYWRIGHT_PORT ?? process.env.PORT ?? "3015");
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  retries: 1,
  use: {
    baseURL,
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
    command: `PLAYWRIGHT_TEST=true PORT=${port} npm run dev`,
    port,
    reuseExistingServer: process.env.CI !== "true",
  },
});
