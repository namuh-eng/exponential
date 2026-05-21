import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const resolveActiveWorkspaceIdMock = vi.fn();
const workspaceLimitMock = vi.fn();
const updateSetMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: getSessionMock } },
}));

vi.mock("@/lib/active-workspace", () => ({
  resolveActiveWorkspaceId: resolveActiveWorkspaceIdMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({ limit: workspaceLimitMock }),
      }),
    })),
    update: vi.fn(() => ({
      set: (...args: unknown[]) => {
        updateSetMock(...args);
        return { where: vi.fn().mockResolvedValue(undefined) };
      },
    })),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("workspace collaboration settings route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    resolveActiveWorkspaceIdMock.mockResolvedValue("workspace-1");
    workspaceLimitMock.mockResolvedValue([
      {
        id: "workspace-1",
        role: "owner",
        settings: {
          collaboration: {
            asks: { enabled: true, intakeEmail: "help@example.com" },
            pulse: { digestFrequency: "daily", velocityTarget: 20 },
            customerRequests: {
              enabled: true,
              intakeEmail: "feedback@example.com",
              defaultTeamKey: "SUP",
              linkMode: "automatic",
            },
          },
        },
      },
    ]);
  });

  it("returns normalized asks and pulse settings", async () => {
    const { GET } = await import(
      "@/app/api/workspaces/current/collaboration/route"
    );

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      collaboration: {
        asks: {
          enabled: true,
          intakeEmail: "help@example.com",
          defaultPriority: "medium",
          autoAssign: true,
        },
        pulse: {
          enabled: true,
          digestFrequency: "daily",
          burnoutAlerts: true,
          velocityTarget: 20,
        },
        customerRequests: {
          enabled: true,
          intakeEmail: "feedback@example.com",
          defaultTeamKey: "SUP",
          linkMode: "automatic",
          autoCreateIssues: true,
        },
      },
    });
  });

  it("merges valid updates into workspace settings", async () => {
    const { PATCH } = await import(
      "@/app/api/workspaces/current/collaboration/route"
    );

    const response = await PATCH(
      new Request("http://localhost/api/workspaces/current/collaboration", {
        method: "PATCH",
        body: JSON.stringify({
          asks: { enabled: false, defaultPriority: "urgent" },
          pulse: { velocityTarget: 55 },
          customerRequests: {
            defaultTeamKey: " eng! ",
            linkMode: "manual",
            autoCreateIssues: false,
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          collaboration: {
            asks: {
              enabled: false,
              intakeEmail: "help@example.com",
              defaultPriority: "urgent",
              autoAssign: true,
            },
            pulse: {
              enabled: true,
              digestFrequency: "daily",
              burnoutAlerts: true,
              velocityTarget: 55,
            },
            customerRequests: {
              enabled: true,
              intakeEmail: "feedback@example.com",
              defaultTeamKey: "ENG",
              linkMode: "manual",
              autoCreateIssues: false,
            },
          },
        }),
      }),
    );
  });

  it("blocks non-admin mutations", async () => {
    workspaceLimitMock.mockResolvedValueOnce([
      { id: "workspace-1", role: "member", settings: {} },
    ]);
    const { PATCH } = await import(
      "@/app/api/workspaces/current/collaboration/route"
    );

    const response = await PATCH(
      new Request("http://localhost/api/workspaces/current/collaboration", {
        method: "PATCH",
        body: JSON.stringify({ asks: { enabled: true } }),
      }),
    );

    expect(response.status).toBe(403);
  });
});
