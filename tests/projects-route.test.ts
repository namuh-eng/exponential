import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const resolveActiveWorkspaceIdMock = vi.fn();
const projectsOrderByMock = vi.fn();
const issueCountsGroupByMock = vi.fn();
const projectTeamRowsInArrayMock = vi.fn();
const insertReturningMock = vi.fn();
const teamLimitMock = vi.fn();
const projectInsertValuesMock = vi.fn();
const projectTeamInsertValuesMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/lib/active-workspace", () => ({
  resolveActiveWorkspaceId: resolveActiveWorkspaceIdMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn((selection?: Record<string, unknown>) => {
      // projects lookup
      if (selection && "slug" in selection && "leadId" in selection) {
        return {
          from: vi.fn().mockReturnThis(),
          leftJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockResolvedValue(projectsOrderByMock()),
        };
      }

      // issueCounts lookup
      if (selection && "total" in selection && "completed" in selection) {
        return {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          groupBy: vi.fn().mockResolvedValue(issueCountsGroupByMock()),
        };
      }

      // projectTeamRows lookup
      if (selection && "projectId" in selection && "teamId" in selection) {
        return {
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue(projectTeamRowsInArrayMock()),
        };
      }

      // team lookup for POST context validation
      if (
        selection &&
        "id" in selection &&
        "key" in selection &&
        "name" in selection &&
        Object.keys(selection).length === 3
      ) {
        return {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue(teamLimitMock()),
        };
      }

      // used for slug availability check
      if (
        selection &&
        "slug" in selection &&
        Object.keys(selection).length === 1
      ) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        };
      }

      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
    }),
    transaction: vi.fn(async (callback) => {
      let insertCall = 0;
      const tx = {
        insert: vi.fn(() => {
          insertCall += 1;
          if (insertCall === 1) {
            return {
              values: vi.fn((values) => {
                projectInsertValuesMock(values);
                return {
                  returning: vi.fn().mockResolvedValue(insertReturningMock()),
                };
              }),
            };
          }

          return {
            values: vi.fn((values) => {
              projectTeamInsertValuesMock(values);
              return Promise.resolve([]);
            }),
          };
        }),
      };

      return callback(tx);
    }),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("projects collection route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    resolveActiveWorkspaceIdMock.mockResolvedValue("workspace-1");
    projectsOrderByMock.mockReturnValue([
      {
        id: "proj-1",
        name: "Ever",
        slug: "ever",
        status: "started",
        priority: "high",
        leadName: "Ashley",
        leadImage: null,
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
      },
    ]);
    issueCountsGroupByMock.mockReturnValue([
      { projectId: "proj-1", total: 10, completed: 3 },
    ]);
    projectTeamRowsInArrayMock.mockReturnValue([
      {
        projectId: "proj-1",
        teamId: "team-1",
        teamKey: "ENG",
        teamName: "Engineering",
      },
    ]);
    teamLimitMock.mockReturnValue([
      { id: "team-1", key: "ENG", name: "Engineering" },
    ]);
    insertReturningMock.mockReturnValue([{ id: "proj-2", slug: "new-proj" }]);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/projects/route");

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("returns serialized projects with progress and teams", async () => {
    const { GET } = await import("@/app/api/projects/route");

    const response = await GET();

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.projects[0].id).toBe("proj-1");
    expect(payload.projects[0].progress).toBe(30);
    expect(payload.projects[0].teams.length).toBe(1);
  });

  it("creates a workspace project without team links when no team context is supplied", async () => {
    const { POST } = await import("@/app/api/projects/route");

    const response = await POST(
      new Request("http://localhost/api/projects", {
        method: "POST",
        body: JSON.stringify({ name: "New Project" }),
      }),
    );

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.id).toBe("proj-2");
    expect(payload.teams).toEqual([]);
    expect(projectInsertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "New Project",
        workspaceId: "workspace-1",
      }),
    );
    expect(projectTeamInsertValuesMock).not.toHaveBeenCalled();
  });

  it("creates a projectTeam association when teamKey context is supplied", async () => {
    const { POST } = await import("@/app/api/projects/route");

    const response = await POST(
      new Request("http://localhost/api/projects", {
        method: "POST",
        body: JSON.stringify({ name: "New Project", teamKey: "ENG" }),
      }),
    );

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.teams).toEqual([
      { id: "team-1", key: "ENG", name: "Engineering" },
    ]);
    expect(projectTeamInsertValuesMock).toHaveBeenCalledWith([
      { projectId: "proj-2", teamId: "team-1" },
    ]);
  });

  it.each([
    ["teamKey", "OUT"],
    ["teamId", "other-team"],
  ])(
    "rejects %s context outside the active workspace without creating an orphan project",
    async (field, value) => {
      teamLimitMock.mockReturnValue([]);
      const { POST } = await import("@/app/api/projects/route");

      const response = await POST(
        new Request("http://localhost/api/projects", {
          method: "POST",
          body: JSON.stringify({ name: "New Project", [field]: value }),
        }),
      );

      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.error).toBe("Team not found in active workspace");
      expect(projectInsertValuesMock).not.toHaveBeenCalled();
      expect(projectTeamInsertValuesMock).not.toHaveBeenCalled();
    },
  );
});
