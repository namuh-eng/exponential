import { expect, test } from "@playwright/test";

test.describe("Workspace initiative routes", () => {
  test("emits workspace-prefixed row links and renders direct detail/not-found routes", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `initiative-routes-${suffix}`;
    const initiativeName = `Workspace initiative ${suffix}`;

    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Initiative Routes ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);

    const initiativeResponse = await page.request.post("/api/initiatives", {
      headers: {
        referer: `http://localhost:3000/${workspaceSlug}/initiatives`,
      },
      data: {
        name: initiativeName,
        description: "Workspace-scoped initiative detail target",
        status: "active",
      },
    });
    expect(initiativeResponse.status()).toBe(201);
    const initiative = (await initiativeResponse.json()) as { id: string };

    await page.goto(`/${workspaceSlug}/initiatives`);
    await expect(page).toHaveURL(new RegExp(`/${workspaceSlug}/initiatives$`));
    const row = page.getByRole("link", { name: new RegExp(initiativeName) });
    await expect(row).toHaveAttribute(
      "href",
      `/${workspaceSlug}/initiatives/${initiative.id}`,
    );

    await page.goto(`/${workspaceSlug}/initiatives/${initiative.id}`);
    await expect(page).toHaveURL(
      new RegExp(`/${workspaceSlug}/initiatives/${initiative.id}$`),
    );
    await expect(
      page.getByRole("heading", { name: initiativeName }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText("Workspace-scoped initiative detail target"),
    ).toBeVisible();
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();

    await page.goto(
      `/${workspaceSlug}/initiatives/00000000-0000-4000-8000-000000000000`,
    );
    await expect(page.getByText("Initiative not found")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();
  });
});

test("workspace roadmap route aliases the initiatives experience without login redirect", async ({
  page,
}) => {
  const suffix = Date.now().toString(36);
  const workspaceSlug = `roadmap-route-${suffix}`;
  const initiativeName = `Roadmap route initiative ${suffix}`;

  const workspaceResponse = await page.request.post("/api/workspaces", {
    data: {
      name: `Roadmap Route ${suffix}`,
      urlSlug: workspaceSlug,
    },
  });
  expect(workspaceResponse.status()).toBe(201);

  const initiativeResponse = await page.request.post("/api/initiatives", {
    headers: {
      referer: `http://localhost:3000/${workspaceSlug}/roadmap`,
    },
    data: {
      name: initiativeName,
      description: "Direct workspace roadmap route regression target",
      status: "active",
    },
  });
  expect(initiativeResponse.status()).toBe(201);

  await page.goto(`/${workspaceSlug}/roadmap`);
  await expect(page).toHaveURL(new RegExp(`/${workspaceSlug}/roadmap$`));
  await expect(page.getByRole("heading", { name: "Initiatives" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByLabel("Initiatives list controls")).toBeVisible();
  await expect(
    page.getByTestId("initiative-row").filter({ hasText: initiativeName }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Log in to exponential" }),
  ).toHaveCount(0);

  await page.goto(`/${workspaceSlug}/initiatives`);
  await expect(page).toHaveURL(new RegExp(`/${workspaceSlug}/initiatives$`));
  await expect(
    page.getByTestId("initiative-row").filter({ hasText: initiativeName }),
  ).toBeVisible();
});
