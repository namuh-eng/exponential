import { expect, test } from "@playwright/test";

test.describe("Team label settings", () => {
  test("creates edits deletes and exposes team labels in team options", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `team-labels-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: { name: `Team Labels ${suffix}`, urlSlug: workspaceSlug },
    });
    expect(workspaceResponse.status()).toBe(201);

    const teamKey = `TL${suffix.slice(-4).toUpperCase()}`;
    const teamResponse = await page.request.post("/api/teams", {
      data: { name: `Team Label ${suffix}`, key: teamKey },
    });
    expect(teamResponse.status()).toBe(201);

    await page.goto(`/${workspaceSlug}/settings/teams/${teamKey}/labels`);
    await expect(
      page.getByRole("heading", { name: "Issue labels" }),
    ).toBeVisible();

    const labelName = `Backend ${suffix}`;
    await page.getByRole("button", { name: "Create label" }).click();
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill(labelName);
    await page
      .getByRole("textbox", { name: "Description", exact: true })
      .fill("Team-owned label");
    await page.getByRole("button", { name: "Color #3b82f6" }).click();
    await page.getByRole("button", { name: "Create label" }).last().click();
    await expect(page.getByText(labelName)).toBeVisible();

    const teamLabelsResponse = await page.request.get(
      `/api/teams/${teamKey}/labels`,
    );
    expect(teamLabelsResponse.status()).toBe(200);
    const teamLabelsPayload = await teamLabelsResponse.json();
    const created = teamLabelsPayload.labels.find(
      (item: { name: string }) => item.name === labelName,
    );
    expect(created).toBeTruthy();

    const editedName = `Platform ${suffix}`;
    await page.getByRole("button", { name: `Edit ${labelName}` }).click();
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill(editedName);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(editedName)).toBeVisible();

    await page.reload();
    await expect(page.getByText(editedName)).toBeVisible();

    const optionsResponse = await page.request.get(
      `/api/teams/${teamKey}/create-issue-options`,
    );
    expect(optionsResponse.status()).toBe(200);
    const optionsPayload = await optionsResponse.json();
    expect(
      optionsPayload.labels.some(
        (item: { id: string; name: string }) =>
          item.id === created.id || item.name === editedName,
      ),
    ).toBe(true);

    page.on("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: `Delete ${editedName}` }).click();
    await expect(page.getByText(editedName)).toHaveCount(0);
  });
});
