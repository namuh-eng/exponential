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
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(membershipsLimitMock()),
            }),
          }),
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
        return {
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue(issuesLimitMock()),
                }),
              }),
            }),
          }),
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
        teamKey: "ENG",
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
    expect(payload.length).toBe(1);
    expect(payload[0].identifier).toBe("ENG-1");
    expect(payload[0].teamKey).toBe("ENG");
    expect(payload[0].path).toBe("/team/ENG/issue/ENG-1");
  });

  it("returns empty array for missing query", async () => {
    const { GET } = await import("@/app/api/issues/search/route");

    const response = await GET(new Request("http://localhost"));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual([]);
  });
});
