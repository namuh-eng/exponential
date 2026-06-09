import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { expect, test as setup } from "@playwright/test";

const authFile = "tests/e2e/.auth/user.json";

function readDotEnvValue(name: string) {
  if (!existsSync(".env")) {
    return undefined;
  }

  const envContent = readFileSync(".env", "utf-8");
  const match = envContent.match(new RegExp(`^${name}=(.+)$`, "m"));
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, "");
}

setup("authenticate playwright browser", async ({ page }) => {
  const email =
    process.env.TEST_ACCOUNT_EMAIL ??
    readDotEnvValue("TEST_ACCOUNT_EMAIL") ??
    "test@example.com";
  expect(email).toBeTruthy();

  await page.goto("/login?callbackUrl=%2Finbox");
  await expect
    .poll(async () => {
      return page.evaluate(async (sessionEmail) => {
        const response = await fetch("/api/test/create-session", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: sessionEmail,
          }),
        });

        return response.status;
      }, email);
    })
    .toBe(200);

  await expect
    .poll(async () => {
      return page.evaluate(async () => {
        const sessionResponse = await fetch("/api/auth/get-session", {
          credentials: "include",
        });

        if (!sessionResponse.ok) {
          return null;
        }

        const data = (await sessionResponse.json()) as {
          user?: { email?: string | null };
        } | null;

        return data?.user?.email ?? null;
      });
    })
    .toBe(email);

  await page.goto("/inbox");
  mkdirSync("tests/e2e/.auth", { recursive: true });
  await page.context().storageState({ path: authFile });
});
