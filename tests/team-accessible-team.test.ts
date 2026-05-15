import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveActiveWorkspaceIdMock = vi.fn();
const selectResults: unknown[][] = [];
const selectedShapes: Record<string, unknown>[] = [];

vi.mock("@/lib/active-workspace", () => ({
  resolveActiveWorkspaceId: resolveActiveWorkspaceIdMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn((shape: Record<string, unknown>) => {
      selectedShapes.push(shape);
      return {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(selectResults.shift() ?? []),
        // biome-ignore lint/suspicious/noThenProperty: mock Drizzle query awaitable
        then: (resolve: (val: unknown[]) => void) =>
          resolve(selectResults.shift() ?? []),
      };
    }),
  },
}));

describe("findAccessibleTeam", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    selectResults.length = 0;
    selectedShapes.length = 0;
  });

  it("returns 404-equivalent null for a guessed key outside the requested workspace", async () => {
    selectResults.push(
      [{ workspaceId: "workspace-a" }],
      [{ id: "member-a" }],
      [],
    );
    const { findAccessibleTeam } = await import("@/lib/teams");

    const team = await findAccessibleTeam("ENG", "user-1", {
      request: new Request("http://localhost/api/teams/ENG/issues", {
        headers: {
          referer: "http://localhost/foreverbrowsing-qa/team/ENG/board",
        },
      }),
    });

    expect(team).toBeNull();
    expect(resolveActiveWorkspaceIdMock).not.toHaveBeenCalled();
    expect(selectedShapes).toHaveLength(3);
  });

  it("resolves duplicate team keys inside the active workspace", async () => {
    resolveActiveWorkspaceIdMock.mockResolvedValue("workspace-b");
    selectResults.push(
      [{ id: "member-b" }],
      [
        {
          id: "team-b-eng",
          workspaceId: "workspace-b",
          name: "Workspace B Engineering",
          key: "ENG",
          icon: null,
          timezone: null,
          estimateType: "not_in_use",
          triageEnabled: true,
          cyclesEnabled: false,
          cycleStartDay: null,
          cycleDurationWeeks: null,
          settings: {},
        },
      ],
      [],
    );
    const { findAccessibleTeam } = await import("@/lib/teams");

    const team = await findAccessibleTeam("ENG", "user-1");

    expect(team?.id).toBe("team-b-eng");
    expect(team?.workspaceId).toBe("workspace-b");
    expect(resolveActiveWorkspaceIdMock).toHaveBeenCalledWith("user-1");
  });

  it("returns hierarchy scope ids for child teams", async () => {
    resolveActiveWorkspaceIdMock.mockResolvedValue("workspace-b");
    selectResults.push(
      [{ id: "member-b" }],
      [
        {
          id: "team-parent",
          workspaceId: "workspace-b",
          name: "Engineering",
          key: "ENG",
          icon: null,
          timezone: null,
          estimateType: "not_in_use",
          triageEnabled: true,
          cyclesEnabled: false,
          cycleStartDay: null,
          cycleDurationWeeks: null,
          parentTeamId: null,
          settings: {},
        },
      ],
      [{ id: "team-child" }],
      [{ id: "team-child" }],
      [],
    );
    const { findAccessibleTeam } = await import("@/lib/teams");

    const team = await findAccessibleTeam("ENG", "user-1");

    expect(team?.hierarchyTeamIds).toEqual(["team-parent", "team-child"]);
    expect(team?.childTeamIds).toEqual(["team-child"]);
  });
});
