import {
  getWorkspaceSlugFromPath,
  isAppRoutePrefix,
  stripWorkspaceSlug,
  withWorkspaceSlug,
} from "@/lib/workspace-paths";
import { describe, expect, it } from "vitest";

describe("workspace directory path support", () => {
  it("treats members and teams as workspace app routes", () => {
    expect(isAppRoutePrefix("members")).toBe(true);
    expect(isAppRoutePrefix("teams")).toBe(true);
  });

  it("does not strip settings/teams as a fake workspace slug", () => {
    expect(getWorkspaceSlugFromPath("/settings/teams/ENG/general")).toBeNull();
    expect(stripWorkspaceSlug("/settings/teams/ENG/general", "namuh")).toBe(
      "/settings/teams/ENG/general",
    );
  });

  it("supports workspace slug-prefixed members and teams routes", () => {
    expect(withWorkspaceSlug("/members", "foreverbrowsing")).toBe(
      "/foreverbrowsing/members",
    );
    expect(withWorkspaceSlug("/teams", "foreverbrowsing")).toBe(
      "/foreverbrowsing/teams",
    );
    expect(getWorkspaceSlugFromPath("/foreverbrowsing/members")).toBe(
      "foreverbrowsing",
    );
    expect(
      stripWorkspaceSlug("/foreverbrowsing/teams", "foreverbrowsing"),
    ).toBe("/teams");
  });
});
