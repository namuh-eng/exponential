import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiSessionMock = vi.fn();
const resolveActiveWorkspaceIdMock = vi.fn();
const workspaceAccessMock = vi.fn();
const updateValuesMock = vi.fn();

vi.mock("@/lib/api-auth", () => ({
  requireApiSession: requireApiSessionMock,
}));

vi.mock("@/lib/active-workspace", () => ({
  resolveActiveWorkspaceId: resolveActiveWorkspaceIdMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(workspaceAccessMock()),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values) => {
        updateValuesMock(values);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    })),
  },
}));

const savedConfiguration = {
  id: "updates-1",
  name: "Weekly report",
  enabled: true,
  cadence: "weekly",
  dayOfWeek: 5,
  timeOfDay: "09:00",
  timezone: "UTC",
  projectScope: "active",
  statusScope: ["started"],
  shareTargets: ["workspace"],
  slackChannel: null,
  createdAt: "2026-05-20T00:00:00.000Z",
  updatedAt: "2026-05-20T00:00:00.000Z",
};

function jsonRequest(
  body: unknown,
  url = "http://localhost/api/project-update-configurations",
) {
  return new Request(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("project update configurations routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValue({
      response: null,
      session: { user: { id: "user-1" } },
    });
    resolveActiveWorkspaceIdMock.mockResolvedValue("workspace-1");
    workspaceAccessMock.mockReturnValue([
      { workspaceId: "workspace-1", role: "admin", settings: {} },
    ]);
  });

  it("returns configurations scoped to the active workspace", async () => {
    workspaceAccessMock.mockReturnValue([
      {
        workspaceId: "workspace-1",
        role: "owner",
        settings: { projectUpdateConfigurations: [savedConfiguration] },
      },
    ]);
    const { GET } = await import(
      "legacy-api/project-update-configurations/route"
    );

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      canManage: true,
      configurations: [expect.objectContaining({ name: "Weekly report" })],
    });
    expect(resolveActiveWorkspaceIdMock).toHaveBeenCalledWith("user-1");
  });

  it("creates a valid configuration in workspace settings", async () => {
    const { POST } = await import(
      "legacy-api/project-update-configurations/route"
    );

    const response = await POST(
      jsonRequest({
        name: "Weekly report",
        enabled: true,
        cadence: "weekly",
        dayOfWeek: 5,
        timeOfDay: "09:00",
        timezone: "UTC",
        projectScope: "active",
        statusScope: ["started"],
        shareTargets: ["workspace", "slack"],
        slackChannel: "#project-updates",
      }),
    );

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.configuration).toMatchObject({
      name: "Weekly report",
      cadence: "weekly",
      slackChannel: "#project-updates",
    });
    expect(updateValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          projectUpdateConfigurations: [
            expect.objectContaining({ name: "Weekly report" }),
          ],
        }),
      }),
    );
  });

  it("rejects invalid scope without losing form-state-safe API errors", async () => {
    const { POST } = await import(
      "legacy-api/project-update-configurations/route"
    );

    const response = await POST(
      jsonRequest({
        name: "Weekly report",
        cadence: "daily",
        dayOfWeek: 5,
        timeOfDay: "09:00",
        projectScope: "statuses",
        statusScope: [],
        shareTargets: ["workspace"],
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Choose a valid reminder cadence",
    });
  });

  it("blocks non-admin mutation", async () => {
    workspaceAccessMock.mockReturnValue([
      { workspaceId: "workspace-1", role: "member", settings: {} },
    ]);
    const { POST } = await import(
      "legacy-api/project-update-configurations/route"
    );

    const response = await POST(jsonRequest({ name: "Nope" }));

    expect(response.status).toBe(403);
  });

  it("updates and deletes existing configurations", async () => {
    workspaceAccessMock.mockReturnValue([
      {
        workspaceId: "workspace-1",
        role: "admin",
        settings: { projectUpdateConfigurations: [savedConfiguration] },
      },
    ]);
    const route = await import(
      "legacy-api/project-update-configurations/[id]/route"
    );

    const patchResponse = await route.PATCH(
      jsonRequest(
        {
          ...savedConfiguration,
          name: "Monthly report",
          enabled: false,
          cadence: "monthly",
        },
        "http://localhost/api/project-update-configurations/updates-1",
      ),
      { params: Promise.resolve({ id: "updates-1" }) },
    );
    expect(patchResponse.status).toBe(200);
    expect(await patchResponse.json()).toMatchObject({
      configuration: { name: "Monthly report", enabled: false },
    });

    const deleteResponse = await route.DELETE(
      new Request(
        "http://localhost/api/project-update-configurations/updates-1",
      ),
      { params: Promise.resolve({ id: "updates-1" }) },
    );
    expect(deleteResponse.status).toBe(200);
    expect(updateValuesMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({ projectUpdateConfigurations: [] }),
      }),
    );
  });
});
