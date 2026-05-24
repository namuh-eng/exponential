import { expect, test } from "@playwright/test";

const workspaceDeepLinks = [
  "/foreverbrowsing",
  "/foreverbrowsing/settings/account/security",
  "/foreverbrowsing/team/ENG/all",
  "/foreverbrowsing/projects?view=list",
  "/foreverbrowsing/roadmap?view=list",
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

  test("Kratos login from workspace root uses the root as return_to URL", async ({
    page,
  }) => {
    let magicLinkPayload: Record<string, unknown> | undefined;
    let flowReturnTo: string | null = null;

    await page.route(
      "**/api/auth/kratos/self-service/login/browser?**",
      async (route) => {
        const requestUrl = new URL(route.request().url());
        flowReturnTo = requestUrl.searchParams.get("return_to");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: "playwright-flow",
            ui: {
              action:
                "http://localhost:4433/self-service/login?flow=playwright-flow",
              nodes: [
                {
                  attributes: {
                    name: "csrf_token",
                    value: "playwright-csrf",
                  },
                },
              ],
            },
          }),
        });
      },
    );

    await page.route(
      "**/api/auth/kratos/self-service/login?**",
      async (route) => {
        if (route.request().method() === "POST") {
          magicLinkPayload = route.request().postDataJSON() as Record<
            string,
            unknown
          >;
        }

        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ redirect_browser_to: flowReturnTo }),
        });
      },
    );

    await page.goto("/foreverbrowsing");
    await expect(
      page.getByRole("heading", { name: "Log in to Linear" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Google sign-in is not configured. Use email or SAML SSO instead.",
      ),
    ).toHaveCount(0);

    const emailInput = page.getByPlaceholder("Email address");
    await emailInput.fill("test@example.com");
    await expect(emailInput).toHaveValue("test@example.com");
    await page
      .getByPlaceholder("Password")
      .fill("correct horse battery staple");
    await page.getByRole("button", { name: "Log in with Kratos" }).click();
    await expect.poll(() => magicLinkPayload).not.toBeUndefined();

    const expectedCallbackURL = new URL("/foreverbrowsing", page.url()).href;
    expect(flowReturnTo).toBe(expectedCallbackURL);
    expect(magicLinkPayload).toMatchObject({
      method: "password",
      identifier: "test@example.com",
      password: "correct horse battery staple",
      csrf_token: "playwright-csrf",
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
      page.getByRole("heading", { name: "Create your account" }),
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
    const publicNav = page.getByLabel("Public");
    await expect(
      publicNav.getByRole("link", { name: "Sign up" }),
    ).toHaveAttribute("href", "/signup");
    await expect(
      publicNav.getByRole("link", { name: "Log in" }),
    ).toHaveAttribute("href", "/login");
  });

  test("login email empty submit uses native validation for click and Enter", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    await page.goto("/login");

    const emailInput = page.getByPlaceholder("Email address");
    const submitButton = page.getByRole("button", {
      name: "Log in with Kratos",
    });
    await expect(submitButton).toBeEnabled();

    await submitButton.click();
    await expect(emailInput).toBeFocused();
    expect(
      await emailInput.evaluate(
        (input) => (input as HTMLInputElement).validity.valueMissing,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("heading", { name: "Log in to Linear" }),
    ).toBeVisible();

    await emailInput.focus();
    await page.keyboard.press("Enter");
    expect(
      await emailInput.evaluate(
        (input) => (input as HTMLInputElement).validity.valueMissing,
      ),
    ).toBe(true);
    expect(consoleErrors).toEqual([]);
  });

  test("login invalid email uses native validation without inline custom text", async ({
    page,
  }) => {
    await page.goto("/login");

    const emailInput = page.getByPlaceholder("Email address");
    await emailInput.fill("not-an-email");
    await page.getByRole("button", { name: "Log in with Kratos" }).click();

    await expect(
      page.getByRole("heading", { name: "Log in to Linear" }),
    ).toBeVisible();
    expect(
      await emailInput.evaluate(
        (input) => (input as HTMLInputElement).validity.typeMismatch,
      ),
    ).toBe(true);
    await expect(page.getByText("Enter a valid email address.")).toHaveCount(0);
  });

  test("Kratos login hides legacy SAML controls", async ({ page }) => {
    await page.goto("/login");
    await expect(
      page.getByText("Authentication is handled by Ory Kratos"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue with SAML SSO" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Log in with Kratos" }),
    ).toBeVisible();
  });
});

test("headless auth hides legacy workspace provider controls", async ({
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
  ).toHaveCount(0);
  await expect(
    page.getByText("Authentication is handled by Ory Kratos"),
  ).toBeVisible();
});

const publicMarketingRoutes = [
  {
    path: "/homepage",
    heading: /The product development system for teams and agents/i,
    text: "Product workspace",
  },
  {
    path: "/pricing",
    heading:
      /Plans that scale from first issue to enterprise product operations/i,
    text: "Enterprise",
  },
  {
    path: "/customers",
    heading: /Built with the teams defining modern product development/i,
    text: "Why OpenAI chose Linear and scaled to 3,000 users",
  },
  {
    path: "/changelog",
    heading: /The latest from Linear product development/i,
    text: "Code Intelligence",
  },
];

test.describe("Public marketing routes", () => {
  for (const route of publicMarketingRoutes) {
    test(`${route.path} renders public content while unauthenticated`, async ({
      page,
    }) => {
      await page.goto(route.path);

      await expect(page).toHaveURL(new RegExp(`${route.path}$`));
      await expect(
        page.getByRole("heading", { name: route.heading }),
      ).toBeVisible();
      await expect(page.getByText(route.text).first()).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Log in to Linear" }),
      ).toHaveCount(0);

      const publicNav = page.getByLabel("Public");
      await expect(
        publicNav.getByRole("link", { name: "Linear" }),
      ).toHaveAttribute("href", "/homepage");
      await expect(
        publicNav.getByRole("link", { name: "Pricing" }),
      ).toHaveAttribute("href", "/pricing");
      await expect(
        publicNav.getByRole("link", { name: "Customers" }),
      ).toHaveAttribute("href", "/customers");
      await expect(
        publicNav.getByRole("link", { name: "Now" }),
      ).toHaveAttribute("href", "/changelog");
      await expect(
        publicNav.getByRole("link", { name: "Log in" }),
      ).toHaveAttribute("href", "/login");
      await expect(
        publicNav.getByRole("link", { name: "Sign up" }),
      ).toHaveAttribute("href", "/signup");
    });
  }

  test("/now serves the public changelog hub", async ({ page }) => {
    await page.goto("/now");

    await expect(page).toHaveURL(/\/now$/);
    await expect(
      page.getByRole("heading", {
        name: /The latest from Linear product development/i,
      }),
    ).toBeVisible();
    await expect(page.getByText("May 14, 2026")).toBeVisible();
    await expect(page.getByText("Code Intelligence")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Log in to Linear" }),
    ).toHaveCount(0);
  });

  test("auth-required app routes still redirect unauthenticated users", async ({
    page,
  }) => {
    await page.goto("/settings/security");
    await expect(page).toHaveURL(
      /\/login\?callbackUrl=%2Fsettings%2Fsecurity$/,
    );
    await expect(
      page.getByRole("heading", { name: "Log in to Linear" }),
    ).toBeVisible();

    await page.goto("/team/ENG/all");
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fteam%2FENG%2Fall$/);
    await expect(
      page.getByRole("heading", { name: "Log in to Linear" }),
    ).toBeVisible();
  });
});
