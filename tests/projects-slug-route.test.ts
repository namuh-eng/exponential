import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const membershipsLimitMock = vi.fn();
const projectsWhereMock = vi.fn();
const leadDataLimitMock = vi.fn();
const milestonesWhereMock = vi.fn();
const teamLinksInnerJoinMock = vi.fn();
const memberLinksInnerJoinMock = vi.fn();
const projectIssuesWhereMock = vi.fn();
const updateSetMock = vi.fn();
const resolveWorkspaceIdBySlugMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/lib/project-detail", () => ({
  readProjectSettings: vi.fn((settings: unknown) => ({
    resources: (settings as { resources?: unknown[] })?.resources ?? [],
    activity: (settings as { activity?: unknown[] })?.activity ?? [],
    labelIds: (settings as { labelIds?: string[] })?.labelIds ?? [],
  })),
  buildMilestoneData: vi.fn(() => ({})),
  haveSameIds: vi.fn(
    (a: string[], b: string[]) => a.sort().join(",") === b.sort().join(","),
  ),
}));

vi.mock("@/lib/active-workspace", () => ({
  resolveWorkspaceIdBySlug: resolveWorkspaceIdBySlugMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn((selection?: Record<string, unknown>) => {
      // findWorkspaceId / memberships
      if (selection && "workspaceId" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: membershipsLimitMock,
              }),
            }),
          }),
        };
      }

      // primary project fetch (findProjectInWorkspace)
      if (!selection || Object.keys(selection).length === 0) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: projectsWhereMock,
            }),
          }),
        };
      }

      // buildProjectResponse - leadData (3 fields: id, name, image)
      if (
        selection &&
        "image" in selection &&
        "name" in selection &&
        Object.keys(selection).length === 3
      ) {
        return {
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValue(memberLinksInnerJoinMock()),
              }),
            }),
            where: vi.fn().mockReturnValue({
              limit: leadDataLimitMock,
            }),
          }),
        };
      }

      // buildProjectResponse - milestones (2 fields: id, name)
      if (
        selection &&
        "name" in selection &&
        Object.keys(selection).length === 2
      ) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue(milestonesWhereMock()),
            }),
          }),
        };
      }

      // buildProjectResponse - teamLinks AND workspaceTeams AND teamLookup (slug gen)
      if (
        selection &&
        "key" in selection &&
        ("teamId" in selection || "name" in selection)
      ) {
        return {
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(teamLinksInnerJoinMock()),
            }),
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue(teamLinksInnerJoinMock()),
              limit: vi.fn().mockResolvedValue(teamLinksInnerJoinMock()),
            }),
          }),
        };
      }

      // buildProjectResponse - projectIssues
      if (selection && "stateId" in selection && "priority" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                leftJoin: vi.fn().mockReturnValue({
                  where: vi.fn().mockReturnValue({
                    orderBy: vi
                      .fn()
                      .mockResolvedValue(projectIssuesWhereMock()),
                  }),
                }),
              }),
            }),
          }),
        };
      }

      const chain = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        // biome-ignore lint/suspicious/noThenProperty: <explanation>
        then: (resolve: (val: unknown) => void) => resolve([]),
      };
      return chain;
    }),
    update: vi.fn(() => ({
      set: (...setArgs: unknown[]) => {
        updateSetMock(...setArgs);
        return {
          where: (...whereArgs: unknown[]) => {
            return {
              returning: vi.fn().mockResolvedValue([{ id: "proj-1" }]),
            };
          },
        };
      },
    })),
    transaction: vi.fn(
      async (
        cb: (tx: {
          select: unknown;
          insert: unknown;
          update: unknown;
          delete: unknown;
        }) => Promise<unknown>,
      ) =>
        cb({
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              innerJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue([]),
                }),
              }),
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
          insert: vi
            .fn()
            .mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ id: "proj-1" }]),
              }),
            }),
          }),
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
    ),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("project detail route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      user: { id: "user-1", name: "Ashley", image: null },
    });
    membershipsLimitMock.mockResolvedValue([{ workspaceId: "workspace-1" }]);
    resolveWorkspaceIdBySlugMock.mockResolvedValue("workspace-from-slug");
    projectsWhereMock.mockResolvedValue([
      {
        id: "proj-1",
        name: "Ever",
        slug: "ever",
        workspaceId: "workspace-1",
        settings: { updates: [], resources: [], activity: [], labelIds: [] },
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
      },
    ]);
    leadDataLimitMock.mockResolvedValue([
      { id: "user-1", name: "Ashley", image: null },
    ]);
    milestonesWhereMock.mockReturnValue([]);
    teamLinksInnerJoinMock.mockReturnValue([
      { teamId: "team-1", teamKey: "ENG", teamName: "Engineering" },
    ]);
    memberLinksInnerJoinMock.mockReturnValue([
      { userId: "user-1", name: "Ashley", image: null },
    ]);
    projectIssuesWhereMock.mockReturnValue([]);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/projects/[slug]/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ slug: "ever" }),
    });

    expect(response.status).toBe(401);
  });

  it("returns full project detail payload", async () => {
    const { GET } = await import("@/app/api/projects/[slug]/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ slug: "ever" }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.project.id).toBe("proj-1");
  });

  it("uses workspaceSlug query param before default workspace fallback", async () => {
    const { GET } = await import("@/app/api/projects/[slug]/route");

    const response = await GET(
      new Request(
        "http://localhost/api/projects/ever?workspaceSlug=foreverbrowsing",
      ),
      {
        params: Promise.resolve({ slug: "ever" }),
      },
    );

    expect(response.status).toBe(200);
    expect(resolveWorkspaceIdBySlugMock).toHaveBeenCalledWith(
      "user-1",
      "foreverbrowsing",
    );
    expect(membershipsLimitMock).not.toHaveBeenCalled();
  });

  it("updates project metadata", async () => {
    const { PATCH } = await import("@/app/api/projects/[slug]/route");

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ name: "Updated Ever", status: "paused" }),
      }),
      { params: Promise.resolve({ slug: "ever" }) },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.project.id).toBe("proj-1");
  });

  it("deletes a project", async () => {
    const { DELETE } = await import("@/app/api/projects/[slug]/route");

    const response = await DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ slug: "ever" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
  });
});
