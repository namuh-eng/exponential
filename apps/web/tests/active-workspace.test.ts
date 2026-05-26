import { chooseActiveWorkspace } from "@/lib/active-workspace";
import { describe, expect, it } from "vitest";

const memberships = [
  { workspaceId: "workspace-stale", workspaceSlug: "root-redirect-mp4mt4pt" },
  {
    workspaceId: "workspace-foreverbrowsing",
    workspaceSlug: "foreverbrowsing",
  },
  { workspaceId: "workspace-other", workspaceSlug: "other-workspace" },
];

describe("chooseActiveWorkspace", () => {
  it("prefers a requested workspace slug for scoped app routes", () => {
    expect(
      chooseActiveWorkspace(memberships, {
        requestedWorkspaceSlug: "other-workspace",
        preferredWorkspaceSlug: "foreverbrowsing",
        preferredWorkspaceId: "workspace-foreverbrowsing",
      })?.workspaceId,
    ).toBe("workspace-other");
  });

  it("does not silently fall back when a requested workspace slug is invalid", () => {
    expect(
      chooseActiveWorkspace(memberships, {
        requestedWorkspaceSlug: "missing-workspace",
        preferredWorkspaceSlug: "foreverbrowsing",
        preferredWorkspaceId: "workspace-foreverbrowsing",
      }),
    ).toBeNull();
  });

  it("uses active workspace slug before stale active workspace id", () => {
    expect(
      chooseActiveWorkspace(memberships, {
        preferredWorkspaceSlug: "foreverbrowsing",
        preferredWorkspaceId: "workspace-stale",
      })?.workspaceSlug,
    ).toBe("foreverbrowsing");
  });

  it("uses active workspace id before canonical seeded fallback", () => {
    expect(
      chooseActiveWorkspace(memberships, {
        preferredWorkspaceId: "workspace-other",
      })?.workspaceSlug,
    ).toBe("other-workspace");
  });

  it("uses active generated root redirect workspace preferences by default", () => {
    expect(
      chooseActiveWorkspace(memberships, {
        preferredWorkspaceSlug: "root-redirect-mp4mt4pt",
        preferredWorkspaceId: "workspace-stale",
      })?.workspaceSlug,
    ).toBe("root-redirect-mp4mt4pt");
  });

  it("can skip generated root redirect workspace preferences when canonical seeded workspace is available", () => {
    expect(
      chooseActiveWorkspace(memberships, {
        preferredWorkspaceSlug: "root-redirect-mp4mt4pt",
        preferredWorkspaceId: "workspace-stale",
        ignoreGeneratedRootRedirectPreference: true,
      })?.workspaceSlug,
    ).toBe("foreverbrowsing");
  });

  it("uses deterministic canonical seeded fallback before newest membership", () => {
    expect(chooseActiveWorkspace(memberships)?.workspaceSlug).toBe(
      "foreverbrowsing",
    );
  });
});
