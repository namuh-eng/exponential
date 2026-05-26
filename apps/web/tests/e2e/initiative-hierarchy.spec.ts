import { expect, test } from "@playwright/test";

type InitiativeResponse = {
  id: string;
  parentInitiativeId: string | null;
};

test.describe("initiative hierarchy management", () => {
  test("adds, removes, reparents, and rejects hierarchy cycles", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `initiative-hierarchy-${suffix}`;

    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Initiative Hierarchy ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);

    async function createInitiative(name: string) {
      const response = await page.request.post("/api/initiatives", {
        headers: {
          referer: `http://localhost:3000/${workspaceSlug}/initiatives`,
        },
        data: { name, status: "planned" },
      });
      expect(response.status()).toBe(201);
      return (await response.json()) as InitiativeResponse;
    }

    const parent = await createInitiative(`Parent ${suffix}`);
    const child = await createInitiative(`Child ${suffix}`);
    const grandchild = await createInitiative(`Grandchild ${suffix}`);

    const addChildResponse = await page.request.patch(
      `/api/initiatives/${parent.id}`,
      { data: { childInitiativeId: child.id } },
    );
    expect(addChildResponse.status()).toBe(200);

    const twoNodeCycleResponse = await page.request.patch(
      `/api/initiatives/${child.id}`,
      { data: { childInitiativeId: parent.id } },
    );
    expect(twoNodeCycleResponse.status()).toBe(400);
    await expect(twoNodeCycleResponse.json()).resolves.toMatchObject({
      error: "Cannot create a circular initiative hierarchy",
    });

    const addGrandchildResponse = await page.request.patch(
      `/api/initiatives/${child.id}`,
      { data: { childInitiativeId: grandchild.id } },
    );
    expect(addGrandchildResponse.status()).toBe(200);

    const deeperCycleResponse = await page.request.patch(
      `/api/initiatives/${grandchild.id}`,
      { data: { childInitiativeId: parent.id } },
    );
    expect(deeperCycleResponse.status()).toBe(400);

    await page.goto(`/${workspaceSlug}/initiatives/${parent.id}`);
    await expect(
      page.getByRole("button", { name: new RegExp(`Child ${suffix}`) }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Remove from initiative" }).click();
    await expect(
      page.getByRole("button", { name: "Remove from initiative" }),
    ).toHaveCount(0);

    let childDetailResponse = await page.request.get(
      `/api/initiatives/${child.id}`,
    );
    let childDetail = (await childDetailResponse.json()) as {
      initiative: InitiativeResponse;
    };
    expect(childDetail.initiative.parentInitiativeId).toBeNull();

    await page.goto(`/${workspaceSlug}/initiatives/${child.id}`);
    await page.getByLabel("Parent initiative").selectOption(parent.id);
    await expect(
      page.getByRole("button", { name: "Clear parent" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Clear parent" }).click();
    await expect(page.getByLabel("Parent initiative")).toHaveValue("");

    childDetailResponse = await page.request.get(
      `/api/initiatives/${child.id}`,
    );
    childDetail = (await childDetailResponse.json()) as {
      initiative: InitiativeResponse;
    };
    expect(childDetail.initiative.parentInitiativeId).toBeNull();
  });
});
