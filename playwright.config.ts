import { defineConfig } from "@playwright/test";

const authFile = "tests/e2e/.auth/user.json";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: "http://localhost:3000",
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
    command: "PLAYWRIGHT_TEST=true npm run dev",
    port: 3000,
    reuseExistingServer: false,
  },
});
