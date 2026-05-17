import { expect, test } from "@playwright/test";

const workspaceDeepLinks = [
  "/foreverbrowsing",
  "/foreverbrowsing/settings/account/security",
  "/foreverbrowsing/team/ENG/all",
  "/foreverbrowsing/projects?view=list",
];

test.describe("Unauthenticated workspace deep links", () => {
  for (const deepLink of workspaceDeepLinks) {
    test(`renders login in place for ${deepLink}`, async ({ page }) => {
      await page.goto(deepLink);

      await expect(
        page.getByRole("heading", { name: "Log in to Linear" }),
      ).toBeVisible();
      await expect(
        page.getByText(
          "Google sign-in is not configured. Use email or SAML SSO instead.",
        ),
      ).toHaveCount(0);
      const expectedUrl = new URL(deepLink, "http://localhost:3000");
      await expect(page).toHaveURL((url) => {
        return (
          url.pathname === expectedUrl.pathname &&
          url.search === expectedUrl.search
        );
      });
    });
  }

  test("email login from workspace root uses the root as callback URLs", async ({
    page,
  }) => {
    let magicLinkPayload: Record<string, unknown> | undefined;
    let finishMagicLink: (() => void) | undefined;

    await page.route("**/api/auth/**", async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        magicLinkPayload = request.postDataJSON() as Record<string, unknown>;
        await new Promise<void>((resolve) => {
          finishMagicLink = resolve;
        });
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto("/foreverbrowsing");
    await expect(
      page.getByRole("heading", { name: "Log in to Linear" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Google sign-in is not configured. Use email or SAML SSO instead.",
      ),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Continue with email" }).click();
    await page
      .getByPlaceholder("Enter your email address…")
      .fill("test@example.com");
    await page.getByRole("button", { name: "Continue with email" }).click();

    await expect(
      page.getByRole("heading", { name: "Verifying it’s you" }),
    ).toBeVisible();
    await expect(page.getByText("Check your email")).toHaveCount(0);
    await expect(page.getByText("Continue with code")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Back to login" }),
    ).toBeVisible();

    finishMagicLink?.();

    await expect(
      page.getByRole("heading", { name: "Check your email" }),
    ).toBeVisible();
    const expectedCallbackURL = new URL("/foreverbrowsing", page.url()).href;
    expect(magicLinkPayload).toMatchObject({
      email: "test@example.com",
      callbackURL: expectedCallbackURL,
      errorCallbackURL: expectedCallbackURL,
    });
  });

  test("direct /login and /signup still render", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole("heading", { name: "Log in to Linear" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Google sign-in is not configured. Use email or SAML SSO instead.",
      ),
    ).toHaveCount(0);

    await page.goto("/signup");
    await expect(page).toHaveURL(/\/signup$/);
    await expect(
      page.getByRole("heading", { name: "Create your workspace" }),
    ).toBeVisible();
  });

  test("login email empty submit shows Linear inline validation for click and Enter", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    await page.goto("/login");
    await page.getByRole("button", { name: "Continue with email" }).click();

    const emailInput = page.getByPlaceholder("Enter your email address…");
    const submitButton = page.getByRole("button", {
      name: "Continue with email",
    });
    await expect(submitButton).toBeEnabled();

    await submitButton.click();
    await expect(
      page.getByText("Please enter an email address for login."),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "What’s your email address?" }),
    ).toBeVisible();

    await emailInput.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByText("Please enter an email address for login."),
    ).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test("login invalid email uses native validation without inline custom text", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Continue with email" }).click();

    const emailInput = page.getByPlaceholder("Enter your email address…");
    await emailInput.fill("not-an-email");
    await page.getByRole("button", { name: "Continue with email" }).click();

    await expect(
      page.getByRole("heading", { name: "What’s your email address?" }),
    ).toBeVisible();
    await expect(page.getByText("Enter a valid email address.")).toHaveCount(0);
  });

  test("SAML invalid email uses native validation without inline custom text", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Continue with SAML SSO" }).click();

    const emailInput = page.getByPlaceholder("Enter your email address…");
    await emailInput.fill("not-an-email");
    await page.getByRole("button", { name: "Continue with SAML" }).click();

    await expect(
      page.getByRole("heading", { name: "What’s your email address?" }),
    ).toBeVisible();
    await expect(page.getByText("Enter a valid email address.")).toHaveCount(0);
  });
});
