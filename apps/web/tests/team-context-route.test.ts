import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const findAccessibleTeamMock = vi.fn();
const contextLimitMock = vi.fn();
const teamsWhereMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/lib/teams", () => ({
  findAccessibleTeam: findAccessibleTeamMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn((selection: Record<string, unknown>) => {
      // Workspace lookup
      if (selection && "workspaceName" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(contextLimitMock()),
            }),
          }),
        };
      }

      // Teams list lookup
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(teamsWhereMock()),
        }),
      };
    }),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("team context route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    findAccessibleTeamMock.mockResolvedValue({
      id: "team-1",
      workspaceId: "workspace-1",
      name: "Engineering",
      key: "ENG",
    });
    contextLimitMock.mockReturnValue([
      {
        workspaceName: "Namuh Labs",
        workspaceSlug: "namuh-labs",
        workspaceId: "workspace-1",
      },
    ]);
    teamsWhereMock.mockReturnValue([
      { id: "team-1", name: "Engineering", key: "ENG" },
    ]);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("legacy-api/teams/[key]/context/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "ENG" }),
    });

    expect(response.status).toBe(401);
  });

  it("returns 404 when team is not found", async () => {
    findAccessibleTeamMock.mockResolvedValue(null);
    const { GET } = await import("legacy-api/teams/[key]/context/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "MISSING" }),
    });

    expect(response.status).toBe(404);
  });

  it("returns team context and all teams in workspace", async () => {
    const { GET } = await import("legacy-api/teams/[key]/context/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "ENG" }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.teamKey).toBe("ENG");
    expect(payload.workspaceInitials).toBe("NA");
    expect(payload.teams.length).toBe(1);
  });
});
