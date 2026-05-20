import { expect, test } from "@playwright/test";

const workspaceDeepLinks = [
  "/foreverbrowsing",
  "/foreverbrowsing/settings/account/security",
  "/foreverbrowsing/team/ENG/all",
  "/foreverbrowsing/projects?view=list",
  "/foreverbrowsing/roadmap?view=list",
];

const publicMarketingRoutes = [
  {
    path: "/homepage",
    text: "The product development system for teams and agents",
  },
  { path: "/pricing", text: "Free" },
  {
    path: "/customers",
    text: "Why OpenAI chose Linear and scaled to 3,000 users",
  },
  { path: "/changelog", text: "Code Intelligence" },
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

  test("public marketing routes render unauthenticated with local navigation", async ({
    page,
  }) => {
    for (const route of publicMarketingRoutes) {
      await page.goto(route.path);
      await expect(page).toHaveURL(new RegExp(`${route.path}$`));
      await expect(page.getByText(route.text).first()).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Log in to Linear" }),
      ).toHaveCount(0);

      await expect(
        page.getByRole("link", { name: "Linear" }).first(),
      ).toHaveAttribute("href", "/homepage");
      await expect(
        page
          .getByRole("navigation", { name: "Public marketing" })
          .getByRole("link", { name: "Pricing" }),
      ).toHaveAttribute("href", "/pricing");
      await expect(
        page
          .getByRole("navigation", { name: "Public marketing" })
          .getByRole("link", { name: "Customers" }),
      ).toHaveAttribute("href", "/customers");
      await expect(
        page
          .getByRole("navigation", { name: "Public marketing" })
          .getByRole("link", { name: "Now" }),
      ).toHaveAttribute("href", "/changelog");
      await expect(
        page.getByRole("link", { name: "Log in", exact: true }),
      ).toHaveAttribute("href", "/login");
      await expect(
        page.getByRole("link", { name: "Sign up", exact: true }),
      ).toHaveAttribute("href", "/signup");
    }
  });

  test("protected app routes still redirect unauthenticated visitors", async ({
    page,
  }) => {
    for (const path of ["/settings/security", "/team/ENG/all"]) {
      await page.goto(path);
      await expect(page).toHaveURL(
        new RegExp(`/login\\?callbackUrl=${encodeURIComponent(path)}$`),
      );
      await expect(
        page.getByRole("heading", { name: "Log in to Linear" }),
      ).toBeVisible();
    }
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

  test("login footer learn more stays clone-local and homepage is public", async ({
    page,
  }) => {
    await page.goto("/login");

    const learnMore = page.getByRole("link", { name: "learn more" });
    await expect(learnMore).toHaveAttribute("href", "/homepage");
    expect(
      await learnMore.evaluate((link) => (link as HTMLAnchorElement).href),
    ).toBe(new URL("/homepage", page.url()).href);

    const footerHrefs = await page
      .locator("p", { hasText: "Don’t have an account?" })
      .locator("a")
      .evaluateAll((links) =>
        links.map((link) => ({
          text: link.textContent?.trim(),
          href: link.getAttribute("href"),
          resolved: (link as HTMLAnchorElement).href,
        })),
      );

    expect(footerHrefs).toEqual([
      {
        text: "Sign up",
        href: "/signup",
        resolved: new URL("/signup", page.url()).href,
      },
      {
        text: "learn more",
        href: "/homepage",
        resolved: new URL("/homepage", page.url()).href,
      },
    ]);
    expect(footerHrefs.map((link) => link.resolved).join(" ")).not.toContain(
      "linear.app",
    );

    await learnMore.click();
    await expect(page).toHaveURL(/\/homepage$/);
    await expect(
      page.getByRole("heading", {
        name: /The product development system for teams and agents/i,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Log in to Linear" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Sign up", exact: true }),
    ).toHaveAttribute("href", "/signup");
    await expect(
      page.getByRole("link", { name: "Log in", exact: true }),
    ).toHaveAttribute("href", "/login");
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

test("workspace-disabled auth methods are hidden on workspace-scoped login", async ({
  page,
}) => {
  await page.route("**/api/auth/provider-capabilities**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        providers: { google: false, email: false, passkey: false },
        workspace: {
          slug: "foreverbrowsing",
          authentication: { google: false, emailPasskey: false },
        },
      }),
    });
  });

  await page.goto(
    "/login?callbackUrl=%2Fforeverbrowsing%2Fsettings%2Fsecurity",
  );

  await expect(
    page.getByRole("heading", { name: "Log in to Linear" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Continue with email" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Log in with passkey" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Continue with SAML SSO" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Google, email, and passkey login are disabled/),
  ).toBeVisible();
});
