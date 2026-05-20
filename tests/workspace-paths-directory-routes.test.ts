import {
  getWorkspaceSlugFromPath,
  isAppRoutePrefix,
  stripWorkspaceSlug,
  withWorkspaceSlug,
} from "@/lib/workspace-paths";
import { describe, expect, it } from "vitest";

describe("workspace directory path support", () => {
  it("treats members, teams, agent, and roadmap as workspace app routes", () => {
    expect(isAppRoutePrefix("agent")).toBe(true);
    expect(isAppRoutePrefix("members")).toBe(true);
    expect(isAppRoutePrefix("teams")).toBe(true);
    expect(isAppRoutePrefix("roadmap")).toBe(true);
  });

  it("does not strip settings/teams as a fake workspace slug", () => {
    expect(getWorkspaceSlugFromPath("/settings/teams/ENG/general")).toBeNull();
    expect(stripWorkspaceSlug("/settings/teams/ENG/general", "namuh")).toBe(
      "/settings/teams/ENG/general",
    );
  });

  it("supports workspace slug-prefixed agent, members, teams, and roadmap routes", () => {
    expect(withWorkspaceSlug("/agent", "foreverbrowsing")).toBe(
      "/foreverbrowsing/agent",
    );
    expect(withWorkspaceSlug("/members", "foreverbrowsing")).toBe(
      "/foreverbrowsing/members",
    );
    expect(withWorkspaceSlug("/teams", "foreverbrowsing")).toBe(
      "/foreverbrowsing/teams",
    );
    expect(withWorkspaceSlug("/roadmap", "foreverbrowsing")).toBe(
      "/foreverbrowsing/roadmap",
    );
    expect(getWorkspaceSlugFromPath("/foreverbrowsing/members")).toBe(
      "foreverbrowsing",
    );
    expect(
      stripWorkspaceSlug("/foreverbrowsing/agent", "foreverbrowsing"),
    ).toBe("/agent");
    expect(
      stripWorkspaceSlug("/foreverbrowsing/teams", "foreverbrowsing"),
    ).toBe("/teams");
    expect(
      stripWorkspaceSlug("/foreverbrowsing/roadmap", "foreverbrowsing"),
    ).toBe("/roadmap");
  });
});
