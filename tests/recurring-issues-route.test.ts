import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiSessionMock = vi.fn();
const findAccessibleTeamMock = vi.fn();
const orderByMock = vi.fn();
const insertReturningMock = vi.fn();
const updateReturningMock = vi.fn();
const deleteWhereMock = vi.fn();

vi.mock("@/lib/api-auth", () => ({
  requireApiSession: requireApiSessionMock,
}));

vi.mock("@/lib/teams", () => ({
  findAccessibleTeam: findAccessibleTeamMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue(orderByMock()),
      limit: vi.fn().mockResolvedValue(orderByMock()),
    })),
    insert: vi.fn(() => ({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(insertReturningMock()),
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue(updateReturningMock()),
    })),
    delete: vi.fn(() => ({
      where: vi.fn().mockImplementation(() => deleteWhereMock()),
    })),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

const recurringRecord = {
  id: "recurring-1",
  title: "Weekly metrics review",
  description: "Review dashboards",
  teamId: "team-1",
  workspaceId: "workspace-1",
  creatorId: "user-1",
  stateId: null,
  assigneeId: null,
  priority: "none",
  labelIds: [],
  projectId: null,
  cycleBehavior: null,
  cadenceConfig: {
    cadence: "weekly",
    interval: 1,
    startDate: "2026-05-21",
    time: "09:00",
  },
  timezone: "UTC",
  nextRunAt: new Date("2026-05-21T09:00:00.000Z"),
  enabled: true,
  lastRunAt: null,
  createdAt: new Date("2026-05-20T12:00:00.000Z"),
  updatedAt: new Date("2026-05-20T12:00:00.000Z"),
};

describe("team recurring issues route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValue({
      response: null,
      session: {
        user: { id: "user-1", name: "Test User", email: "test@example.com" },
      },
    });
    findAccessibleTeamMock.mockResolvedValue({
      id: "team-1",
      workspaceId: "workspace-1",
      name: "Engineering",
      key: "ENG",
    });
    orderByMock.mockReturnValue([recurringRecord]);
    insertReturningMock.mockReturnValue([recurringRecord]);
    updateReturningMock.mockReturnValue([
      { ...recurringRecord, enabled: false },
    ]);
    deleteWhereMock.mockResolvedValue(undefined);
  });

  it("returns 401 without a session", async () => {
    requireApiSessionMock.mockResolvedValue({
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
      session: null,
    });
    const { GET } = await import(
      "@/app/api/teams/[key]/recurring-issues/route"
    );

    const response = await GET(
      new Request("http://localhost/api/teams/ENG/recurring-issues"),
      {
        params: Promise.resolve({ key: "ENG" }),
      },
    );

    expect(response.status).toBe(401);
  });

  it("lists recurring issues for an accessible team", async () => {
    const { GET } = await import(
      "@/app/api/teams/[key]/recurring-issues/route"
    );

    const response = await GET(
      new Request("http://localhost/api/teams/ENG/recurring-issues"),
      {
        params: Promise.resolve({ key: "ENG" }),
      },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.recurringIssues[0]).toMatchObject({
      title: "Weekly metrics review",
      cadenceLabel: "Weekly",
      enabled: true,
    });
  });

  it("validates required fields when creating", async () => {
    const { POST } = await import(
      "@/app/api/teams/[key]/recurring-issues/route"
    );

    const response = await POST(
      new Request("http://localhost/api/teams/ENG/recurring-issues", {
        method: "POST",
        body: JSON.stringify({
          title: "",
          cadence: "weekly",
          startDate: "2026-05-21",
        }),
      }),
      { params: Promise.resolve({ key: "ENG" }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Title is required" });
  });

  it("creates a recurring issue", async () => {
    const { POST } = await import(
      "@/app/api/teams/[key]/recurring-issues/route"
    );

    const response = await POST(
      new Request("http://localhost/api/teams/ENG/recurring-issues", {
        method: "POST",
        body: JSON.stringify({
          title: "Weekly metrics review",
          description: "Review dashboards",
          cadence: "weekly",
          startDate: "2026-05-21",
          time: "09:00",
          timezone: "UTC",
        }),
      }),
      { params: Promise.resolve({ key: "ENG" }) },
    );

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.recurringIssue.title).toBe("Weekly metrics review");
  });

  it("updates and deletes only scoped recurring issues", async () => {
    const { PATCH, DELETE } = await import(
      "@/app/api/teams/[key]/recurring-issues/[id]/route"
    );

    const patchResponse = await PATCH(
      new Request(
        "http://localhost/api/teams/ENG/recurring-issues/recurring-1",
        {
          method: "PATCH",
          body: JSON.stringify({
            title: "Weekly metrics review",
            cadence: "weekly",
            startDate: "2026-05-21",
            time: "09:00",
            timezone: "UTC",
            enabled: false,
          }),
        },
      ),
      { params: Promise.resolve({ key: "ENG", id: "recurring-1" }) },
    );
    expect(patchResponse.status).toBe(200);
    expect((await patchResponse.json()).recurringIssue.enabled).toBe(false);

    const deleteResponse = await DELETE(
      new Request(
        "http://localhost/api/teams/ENG/recurring-issues/recurring-1",
        { method: "DELETE" },
      ),
      { params: Promise.resolve({ key: "ENG", id: "recurring-1" }) },
    );
    expect(deleteResponse.status).toBe(200);
    expect(await deleteResponse.json()).toEqual({ success: true });
  });
});
