import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const findAccessibleTeamMock = vi.fn();
const statesLimitMock = vi.fn();
const updateReturningMock = vi.fn();

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
    select: vi.fn(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(statesLimitMock()),
          }),
        }),
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(updateReturningMock()),
        }),
      }),
    })),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("team triage issue actions route", () => {
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
    statesLimitMock.mockReturnValue([{ id: "state-target" }]);
    updateReturningMock.mockReturnValue([
      { id: "issue-1", stateId: "state-target" },
    ]);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { PATCH } = await import(
      "@/app/api/teams/[key]/triage/[issueId]/route"
    );

    const response = await PATCH(
      new Request("http://localhost", { method: "PATCH", body: "{}" }),
      {
        params: Promise.resolve({ key: "ENG", issueId: "issue-1" }),
      },
    );

    expect(response.status).toBe(401);
  });

  it("returns 404 when team is missing", async () => {
    findAccessibleTeamMock.mockResolvedValue(null);
    const { PATCH } = await import(
      "@/app/api/teams/[key]/triage/[issueId]/route"
    );

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ action: "accept" }),
      }),
      {
        params: Promise.resolve({ key: "MISSING", issueId: "issue-1" }),
      },
    );

    expect(response.status).toBe(404);
  });

  it("accepts a triage issue", async () => {
    const { PATCH } = await import(
      "@/app/api/teams/[key]/triage/[issueId]/route"
    );

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ action: "accept" }),
      }),
      {
        params: Promise.resolve({ key: "ENG", issueId: "issue-1" }),
      },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.stateId).toBe("state-target");
  });

  it("declines a triage issue", async () => {
    const { PATCH } = await import(
      "@/app/api/teams/[key]/triage/[issueId]/route"
    );

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ action: "decline" }),
      }),
      {
        params: Promise.resolve({ key: "ENG", issueId: "issue-1" }),
      },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.stateId).toBe("state-target");
  });
});
