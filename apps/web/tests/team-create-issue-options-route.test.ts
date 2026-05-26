import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const findAccessibleTeamMock = vi.fn();
const statusesWhereMock = vi.fn();
const assigneesWhereMock = vi.fn();
const labelsWhereMock = vi.fn();
const projectsWhereMock = vi.fn();

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
      // options parallel list: statuses
      if (selection && "category" in selection) {
        const chain = {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          // biome-ignore lint/suspicious/noThenProperty: <explanation>
          then: (resolve: (val: unknown) => void) =>
            resolve(statusesWhereMock()),
        };
        return chain;
      }

      // options parallel list: assignees
      if (selection && "image" in selection) {
        const chain = {
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          // biome-ignore lint/suspicious/noThenProperty: <explanation>
          then: (resolve: (val: unknown) => void) =>
            resolve(assigneesWhereMock()),
        };
        return chain;
      }

      // options parallel list: labels
      if (selection && "color" in selection) {
        const chain = {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          // biome-ignore lint/suspicious/noThenProperty: <explanation>
          then: (resolve: (val: unknown) => void) => resolve(labelsWhereMock()),
        };
        return chain;
      }

      // options parallel list: projects
      if (selection && "icon" in selection) {
        const chain = {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          // biome-ignore lint/suspicious/noThenProperty: <explanation>
          then: (resolve: (val: unknown) => void) =>
            resolve(projectsWhereMock()),
        };
        return chain;
      }

      const chain = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        // biome-ignore lint/suspicious/noThenProperty: <explanation>
        then: (resolve: (val: unknown) => void) => resolve([]),
      };
      return chain;
    }),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("team create issue options route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    findAccessibleTeamMock.mockResolvedValue({
      id: "team-1",
      name: "Engineering",
      key: "ENG",
      workspaceId: "workspace-1",
    });
    statusesWhereMock.mockReturnValue([{ id: "state-1", name: "Backlog" }]);
    assigneesWhereMock.mockReturnValue([
      { id: "user-1", name: "Ashley", image: null },
    ]);
    labelsWhereMock.mockReturnValue([{ id: "label-1", name: "Bug" }]);
    projectsWhereMock.mockReturnValue([{ id: "project-1", name: "Ever" }]);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import(
      "legacy-api/teams/[key]/create-issue-options/route"
    );

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "ENG" }),
    });

    expect(response.status).toBe(401);
  });

  it("returns 404 when team is missing", async () => {
    findAccessibleTeamMock.mockResolvedValue(null);
    const { GET } = await import(
      "legacy-api/teams/[key]/create-issue-options/route"
    );

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "MISSING" }),
    });

    expect(response.status).toBe(404);
  });

  it("returns full issue creation options payload", async () => {
    const { GET } = await import(
      "legacy-api/teams/[key]/create-issue-options/route"
    );

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "ENG" }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.statuses.length).toBe(1);
    expect(payload.assignees.length).toBe(1);
    expect(payload.labels.length).toBe(1);
    expect(payload.projects.length).toBe(1);
  });
});
