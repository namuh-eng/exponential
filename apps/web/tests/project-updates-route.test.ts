import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiSessionMock = vi.fn();
const resolveRequestWorkspaceIdMock = vi.fn();
const settingsRowMock = vi.fn();
const updateSetMock = vi.fn();

vi.mock("@/lib/api-auth", () => ({
  requireApiSession: requireApiSessionMock,
}));

vi.mock("@/lib/active-workspace", () => ({
  resolveRequestWorkspaceId: resolveRequestWorkspaceIdMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockImplementation(() => Promise.resolve(settingsRowMock())),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values) => {
        updateSetMock(values);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    })),
  },
}));

function request(body?: unknown) {
  return new Request("http://localhost/api/project-updates", {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const storedConfiguration = {
  id: "update-1",
  name: "Weekly roadmap reminder",
  enabled: true,
  cadence: "weekly",
  dueDay: "friday",
  dueTime: "09:00",
  timezone: "UTC",
  scope: "active_projects",
  projectIds: [],
  reportingTarget: "workspace",
  shareTarget: "",
  createdAt: "2026-05-18T00:00:00.000Z",
  updatedAt: "2026-05-18T00:00:00.000Z",
};

describe("project update settings routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValue({
      response: null,
      session: { user: { id: "user-1" } },
    });
    resolveRequestWorkspaceIdMock.mockResolvedValue("workspace-1");
    settingsRowMock.mockReturnValue([{ settings: {} }]);
  });

  it("returns stored workspace-scoped project update configurations", async () => {
    settingsRowMock.mockReturnValue([
      { settings: { projectUpdateConfigurations: [storedConfiguration] } },
    ]);
    const { GET } = await import("@/app/api/project-updates/route");

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      configurations: [storedConfiguration],
    });
    expect(resolveRequestWorkspaceIdMock).toHaveBeenCalledWith(
      "user-1",
      expect.any(Request),
    );
  });

  it("uses API key workspace scoping when present", async () => {
    requireApiSessionMock.mockResolvedValue({
      response: null,
      session: {
        user: { id: "user-1" },
        apiKey: { workspaceId: "api-workspace-1" },
      },
    });
    const { GET } = await import("@/app/api/project-updates/route");

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(resolveRequestWorkspaceIdMock).not.toHaveBeenCalled();
  });

  it("creates validated configurations in workspace settings", async () => {
    const { POST } = await import("@/app/api/project-updates/route");

    const response = await POST(
      request({
        name: "Weekly reports",
        enabled: true,
        cadence: "weekly",
        dueDay: "monday",
        dueTime: "10:30",
        timezone: "America/Los_Angeles",
        scope: "active_projects",
        reportingTarget: "slack",
        shareTarget: "#project-updates",
      }),
    );

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.configuration).toMatchObject({
      name: "Weekly reports",
      dueTime: "10:30",
      reportingTarget: "slack",
    });
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          projectUpdateConfigurations: [
            expect.objectContaining({ name: "Weekly reports" }),
          ],
        }),
      }),
    );
  });

  it("rejects invalid due time", async () => {
    const { POST } = await import("@/app/api/project-updates/route");

    const response = await POST(
      request({
        name: "Bad reminder",
        cadence: "weekly",
        dueDay: "friday",
        dueTime: "25:99",
        timezone: "UTC",
        scope: "active_projects",
        reportingTarget: "workspace",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Due time must use 24-hour HH:MM format",
      field: "dueTime",
    });
  });

  it("updates a configuration without crossing workspace settings", async () => {
    settingsRowMock.mockReturnValue([
      { settings: { projectUpdateConfigurations: [storedConfiguration] } },
    ]);
    const { PATCH } = await import("@/app/api/project-updates/[id]/route");

    const response = await PATCH(
      new Request("http://localhost/api/project-updates/update-1", {
        method: "PATCH",
        body: JSON.stringify({ enabled: false, cadence: "biweekly" }),
      }),
      { params: Promise.resolve({ id: "update-1" }) },
    );

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          projectUpdateConfigurations: [
            expect.objectContaining({ id: "update-1", enabled: false }),
          ],
        }),
      }),
    );
  });

  it("deletes a configuration from workspace settings", async () => {
    settingsRowMock.mockReturnValue([
      { settings: { projectUpdateConfigurations: [storedConfiguration] } },
    ]);
    const { DELETE } = await import("@/app/api/project-updates/[id]/route");

    const response = await DELETE(
      new Request("http://localhost/api/project-updates/update-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "update-1" }) },
    );

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({ projectUpdateConfigurations: [] }),
      }),
    );
  });
});
