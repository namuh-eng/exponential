import { type Page, expect } from "@playwright/test";

export async function createIsolatedTestSession(page: Page, prefix: string) {
  const email = `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}@example.com`;

  await page.goto("/login?callbackUrl=%2Finbox");
  await expect
    .poll(async () => {
      return page.evaluate(async (sessionEmail) => {
        const response = await fetch("/api/test/create-session", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: sessionEmail }),
        });
        return response.status;
      }, email);
    })
    .toBe(200);

  return email;
}
