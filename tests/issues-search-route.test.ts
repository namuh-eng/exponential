import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const membershipsLimitMock = vi.fn();
const teamsWhereMock = vi.fn();
const issuesLimitMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn((selection?: Record<string, unknown>) => {
      // find memberships
      if (selection && "workspaceId" in selection) {
        const membershipLimit = vi
          .fn()
          .mockResolvedValue(membershipsLimitMock());
        const membershipWhere = vi.fn().mockReturnValue({
          limit: membershipLimit,
        });
        const membershipQuery = {
          innerJoin: vi.fn().mockReturnThis(),
          where: membershipWhere,
        };

        return {
          from: vi.fn().mockReturnValue(membershipQuery),
        };
      }

      // find teams
      if (
        selection &&
        "id" in selection &&
        Object.keys(selection).length === 1
      ) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(teamsWhereMock()),
          }),
        };
      }

      // search issues
      if (selection && "identifier" in selection) {
        const issueQuery = {
          innerJoin: vi.fn().mockReturnThis(),
          leftJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue(issuesLimitMock()),
        };

        return {
          from: vi.fn().mockReturnValue(issueQuery),
        };
      }

      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
    }),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("issues search route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    membershipsLimitMock.mockReturnValue([{ workspaceId: "workspace-1" }]);
    teamsWhereMock.mockReturnValue([{ id: "team-1" }]);
    issuesLimitMock.mockReturnValue([
      {
        id: "issue-1",
        identifier: "ENG-1",
        title: "Search target",
        priority: "high",
        stateName: "In Progress",
        stateCategory: "started",
        stateColor: "#f2c94c",
        assigneeName: "Test User",
        assigneeImage: null,
        createdAt: new Date("2026-05-18T00:00:00.000Z"),
      },
    ]);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/issues/search/route");

    const response = await GET(new Request("http://localhost?q=test"));

    expect(response.status).toBe(401);
  });

  it("returns results for a valid query", async () => {
    const { GET } = await import("@/app/api/issues/search/route");

    const response = await GET(new Request("http://localhost?q=Search"));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({
      identifier: "ENG-1",
      title: "Search target",
      priority: "high",
      stateName: "In Progress",
      stateCategory: "started",
      stateColor: "#f2c94c",
      assigneeName: "Test User",
      assigneeImage: null,
    });
    expect(payload[0].createdAt).toBeTruthy();
  });

  it("returns complete issue row metadata for a workspace slug query", async () => {
    const { GET } = await import("@/app/api/issues/search/route");

    const response = await GET(
      new Request("http://localhost?q=Search&workspaceSlug=foreverbrowsing"),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload[0]).toEqual(
      expect.objectContaining({
        id: "issue-1",
        identifier: "ENG-1",
        title: "Search target",
        priority: "high",
        stateName: "In Progress",
        stateCategory: "started",
        stateColor: "#f2c94c",
        assigneeName: "Test User",
        createdAt: expect.any(String),
      }),
    );
  });

  it("returns empty array for missing query", async () => {
    const { GET } = await import("@/app/api/issues/search/route");

    const response = await GET(new Request("http://localhost"));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual([]);
  });
});
