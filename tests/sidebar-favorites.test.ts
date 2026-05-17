import {
  favoriteExists,
  getSidebarFavoriteId,
  readSidebarFavoritesFromUserSettings,
  writeSidebarFavoritesToUserSettings,
} from "@/lib/sidebar-favorites";
import { describe, expect, it } from "vitest";

describe("sidebar favorites settings persistence", () => {
  it("stores favorites per workspace and normalizes duplicates", () => {
    const updated = writeSidebarFavoritesToUserSettings({}, "workspace-1", [
      {
        objectType: "project",
        objectId: "project-1",
        createdAt: "2026-05-15T00:00:00.000Z",
      },
      {
        objectType: "issue",
        objectId: "issue-1",
        createdAt: "2026-05-15T00:01:00.000Z",
      },
    ]);

    const withOtherWorkspace = writeSidebarFavoritesToUserSettings(
      updated,
      "workspace-2",
      [
        {
          objectType: "view",
          objectId: "view-1",
          createdAt: "2026-05-15T00:02:00.000Z",
        },
      ],
    );

    expect(
      readSidebarFavoritesFromUserSettings(withOtherWorkspace, "workspace-1"),
    ).toEqual([
      {
        objectType: "project",
        objectId: "project-1",
        createdAt: "2026-05-15T00:00:00.000Z",
      },
      {
        objectType: "issue",
        objectId: "issue-1",
        createdAt: "2026-05-15T00:01:00.000Z",
      },
    ]);
    expect(
      readSidebarFavoritesFromUserSettings(withOtherWorkspace, "workspace-2"),
    ).toHaveLength(1);
  });

  it("ignores malformed values and keeps first favorite order", () => {
    const settings = {
      sidebarFavoritesByWorkspace: {
        "workspace-1": [
          { objectType: "project", objectId: "project-1" },
          { objectType: "project", objectId: "project-1" },
          { objectType: "unknown", objectId: "object-1" },
          { objectType: "issue", objectId: "issue-1" },
        ],
      },
    };

    const favorites = readSidebarFavoritesFromUserSettings(
      settings,
      "workspace-1",
    );

    expect(favorites.map((favorite) => favorite.objectId)).toEqual([
      "project-1",
      "issue-1",
    ]);
    expect(favoriteExists(favorites, "project", "project-1")).toBe(true);
    expect(getSidebarFavoriteId("issue", "issue-1")).toBe("issue:issue-1");
  });
});
