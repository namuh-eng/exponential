import { expect, test } from "@playwright/test";

test("favorites a project into the workspace sidebar and supports manage removal", async ({
  page,
}) => {
  const suffix = Date.now().toString(36);
  const projectName = `Favorite sidebar ${suffix}`;
  const projectResponse = await page.request.post("/api/projects", {
    data: {
      name: projectName,
      description: "Sidebar favorite coverage",
      teamKey: "ENG",
    },
  });
  expect(projectResponse.ok()).toBeTruthy();
  const project = (await projectResponse.json()) as {
    id: string;
    slug: string;
  };

  await page.goto(`/foreverbrowsing/project/${project.slug}/overview`);
  await page
    .getByRole("button", { name: `Add to favorites: ${projectName}` })
    .click();

  await expect(
    page.getByRole("button", { name: "Favorites", exact: true }),
  ).toBeVisible();
  const favoriteLink = page.getByRole("link", {
    name: new RegExp(projectName),
  });
  await expect(favoriteLink).toHaveAttribute(
    "href",
    `/foreverbrowsing/project/${project.slug}`,
  );

  const apiResponse = await page.request.get("/api/sidebar/favorites", {
    headers: { referer: "http://localhost:3000/foreverbrowsing/projects" },
  });
  expect(apiResponse.ok()).toBeTruthy();
  const favoritesPayload = (await apiResponse.json()) as {
    favorites: Array<{ objectType: string; objectId: string; label: string }>;
  };
  expect(favoritesPayload.favorites).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        objectType: "project",
        objectId: project.id,
        label: projectName,
      }),
    ]),
  );

  await page.getByRole("button", { name: "Manage favorites" }).click();
  await page
    .getByRole("button", { name: `Remove ${projectName} from favorites` })
    .click();
  await expect(favoriteLink).toHaveCount(0);
});
