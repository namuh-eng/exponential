import { expect, test } from "@playwright/test";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="#f59e0b"/></svg>`;

test("custom emoji settings upload, list, persist, and delete", async ({
  page,
}) => {
  const suffix = Date.now().toString(36);
  const workspaceSlug = `emoji-settings-${suffix}`;
  const workspaceResponse = await page.request.post("/api/workspaces", {
    data: { name: `Emoji Settings ${suffix}`, urlSlug: workspaceSlug },
  });
  expect(workspaceResponse.status()).toBe(201);

  await page.goto(`/${workspaceSlug}/settings/emojis`);
  await expect(
    page.getByRole("heading", { name: "Custom emojis", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("No custom emojis")).toBeVisible();

  await page.getByLabel("Emoji name").fill(`party_${suffix}`);
  await page.getByLabel("Emoji image").setInputFiles({
    name: "party.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(svg),
  });
  await page.getByRole("button", { name: "Upload emoji" }).click();
  await expect(page.getByText(`:party_${suffix}: uploaded.`)).toBeVisible();
  await expect(page.getByText(`:party_${suffix}:`).first()).toBeVisible();

  await page.reload();
  await expect(page.getByText(`:party_${suffix}:`).first()).toBeVisible();

  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes("/api/custom-emojis/") &&
        response.request().method() === "DELETE",
    ),
    page.getByRole("button", { name: "Delete" }).click(),
  ]);
  await expect(page.getByText(`:party_${suffix}: deleted.`)).toBeVisible();
  await expect(page.getByText("No custom emojis")).toBeVisible();
});
