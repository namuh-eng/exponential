import { type Page, expect, test } from "@playwright/test";

async function gotoAndExpectPath(page: Page, targetPath: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(targetPath, { waitUntil: "domcontentloaded" });
    } catch (error) {
      if (!String(error).includes("net::ERR_ABORTED") || attempt === 2) {
        throw error;
      }
    }

    try {
      await expect(page).toHaveURL((url) => url.pathname === targetPath);
      return;
    } catch (error) {
      if (attempt === 2) {
        throw error;
      }
    }
  }
}

test.describe("contextual Insights", () => {
  test("opens Insights from issue lists and cycle views without navigation", async ({
    page,
  }, testInfo) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `insights-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Insights ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);
    const workspacePayload = (await workspaceResponse.json()) as {
      team: { id: string; key: string };
    };
    const teamKey = workspacePayload.team.key;

    const issueResponse = await page.request.post("/api/issues", {
      data: {
        title: `Scoped analytics issue ${suffix}`,
        teamId: workspacePayload.team.id,
        priority: "medium",
      },
    });
    expect(issueResponse.status()).toBe(201);

    const cycleResponse = await page.request.post(
      `/api/teams/${teamKey}/cycles`,
      {
        data: {
          name: `Insights Cycle ${suffix}`,
          startDate: "2026-05-18",
          endDate: "2026-05-31",
        },
      },
    );
    expect(cycleResponse.status()).toBe(201);
    const cyclePayload = (await cycleResponse.json()) as { id: string };

    await gotoAndExpectPath(page, `/${workspaceSlug}/team/${teamKey}/all`);
    const issueListUrl = page.url();

    await page
      .getByRole("button", { name: /Open Insights for all issues/ })
      .click();
    await expect(page.getByText("exponential Insights")).toBeVisible();
    await expect(page.getByTestId("insights-panel-shell")).toHaveCSS(
      "background-color",
      "rgb(12, 13, 12)",
    );
    await expect(page.getByLabel("Close Insights overlay")).toHaveCSS(
      "background-color",
      "rgb(12, 13, 12)",
    );
    await expect(page.locator("#team-insights-builder")).toHaveCSS(
      "background-color",
      "rgb(17, 19, 18)",
    );
    await page.screenshot({
      path: testInfo.outputPath("contextual-insights-drawer-opaque.png"),
      fullPage: true,
    });
    await expect(page.getByText("1").first()).toBeVisible();
    await expect(page).toHaveURL(issueListUrl);

    await page.getByLabel("Slice").selectOption("project");
    await expect(
      page.getByRole("heading", { name: /Issue count by Project/ }),
    ).toBeVisible();
    await expect(page).toHaveURL(issueListUrl);

    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Insights panel" }),
    ).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: /Open Insights for all issues/ }),
    ).toBeFocused();

    await gotoAndExpectPath(page, `/${workspaceSlug}/team/${teamKey}/active`);
    const activeUrl = page.url();
    await page
      .getByRole("button", { name: /Open Insights for active issues/ })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Insights panel" }),
    ).toBeVisible();
    await expect(
      page.getByText(/No issues match these analytics filters/),
    ).toBeVisible();
    await expect(page).toHaveURL(activeUrl);
    await page.keyboard.press("Escape");

    await gotoAndExpectPath(
      page,
      `/${workspaceSlug}/team/${teamKey}/cycles/${cyclePayload.id}`,
    );
    const cycleUrl = page.url();
    await page
      .getByRole("button", { name: /Open Insights for Insights Cycle/ })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Insights panel" }),
    ).toBeVisible();
    await expect(page.getByText("exponential Insights")).toBeVisible();
    await expect(page).toHaveURL(cycleUrl);

    await gotoAndExpectPath(
      page,
      `/${workspaceSlug}/team/${teamKey}/analytics`,
    );
    await expect(page.getByText("exponential Insights")).toBeVisible();
    await expect(page.getByTestId("insights-panel-shell")).toHaveCSS(
      "background-color",
      "rgb(12, 13, 12)",
    );
    await expect(page.locator("#team-insights-builder")).toHaveCSS(
      "background-color",
      "rgb(17, 19, 18)",
    );
    await page.screenshot({
      path: testInfo.outputPath("contextual-insights-opaque-shell.png"),
      fullPage: true,
    });
  });
});
