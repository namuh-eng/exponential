import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiSessionMock = vi.fn();
const resolveActiveWorkspaceIdMock = vi.fn();
const updateSetMock = vi.fn();
let accessRows: unknown[] = [];

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    randomBytes: vi.fn((size: number) => ({
      toString: () => "a".repeat(size * 2),
    })),
  };
});

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
      limit: vi.fn(async () => accessRows),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values) => {
        updateSetMock(values);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    })),
  },
}));

function request(body: unknown) {
  return new Request("http://localhost/api/workspaces/current/sla", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("workspace SLA policy routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValue({
      response: null,
      session: { user: { id: "user-1" } },
    });
    resolveActiveWorkspaceIdMock.mockResolvedValue("workspace-1");
    accessRows = [
      {
        workspaceId: "workspace-1",
        settings: { existing: true, sla: { policies: [] } },
        memberRole: "admin",
      },
    ];
  });

  it("lists SLA policies and manage capability", async () => {
    accessRows = [
      {
        workspaceId: "workspace-1",
        memberRole: "member",
        settings: {
          sla: {
            policies: [
              {
                id: "sla-1",
                name: "Urgent",
                responseTimeHours: 2,
                resolutionTimeHours: 8,
                enabled: true,
                conditions: { priority: "urgent" },
                createdAt: "2026-05-01T00:00:00.000Z",
                updatedAt: "2026-05-01T00:00:00.000Z",
              },
            ],
          },
        },
      },
    ];
    const { GET } = await import("legacy-api/workspaces/current/sla/route");

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.sla.canManage).toBe(false);
    expect(payload.sla.policies[0]).toMatchObject({ name: "Urgent" });
  });

  it("creates SLA policy in workspace settings", async () => {
    const { POST } = await import("legacy-api/workspaces/current/sla/route");

    const response = await POST(
      request({
        name: "Urgent customer issues",
        description: "Escalations",
        responseTimeHours: 2,
        resolutionTimeHours: 8,
        conditions: { priority: "urgent", teamKey: "eng" },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.policy).toMatchObject({
      id: expect.stringMatching(/^sla_[a-f0-9]{16}$/),
      name: "Urgent customer issues",
      responseTimeHours: 2,
      resolutionTimeHours: 8,
      conditions: { priority: "urgent", teamKey: "ENG" },
    });
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          existing: true,
          sla: expect.objectContaining({ policies: [payload.policy] }),
        }),
      }),
    );
  });

  it("updates and deletes existing SLA policies", async () => {
    accessRows = [
      {
        workspaceId: "workspace-1",
        memberRole: "owner",
        settings: {
          sla: {
            policies: [
              {
                id: "sla-1",
                name: "Old",
                description: null,
                responseTimeHours: 4,
                resolutionTimeHours: 24,
                enabled: true,
                conditions: {},
                createdAt: "2026-05-01T00:00:00.000Z",
                updatedAt: "2026-05-01T00:00:00.000Z",
              },
            ],
          },
        },
      },
    ];
    const route = await import("legacy-api/workspaces/current/sla/[id]/route");

    const patchResponse = await route.PATCH(
      request({
        name: "Updated",
        responseTimeHours: 1,
        resolutionTimeHours: 2,
      }),
      { params: { id: "sla-1" } },
    );
    expect(patchResponse.status).toBe(200);
    expect(updateSetMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          sla: expect.objectContaining({
            policies: [expect.objectContaining({ name: "Updated" })],
          }),
        }),
      }),
    );

    const deleteResponse = await route.DELETE(
      new Request("http://localhost/api/workspaces/current/sla/sla-1"),
      { params: { id: "sla-1" } },
    );
    expect(deleteResponse.status).toBe(200);
    expect(updateSetMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          sla: expect.objectContaining({ policies: [] }),
        }),
      }),
    );
  });

  it("forbids non-admin management", async () => {
    accessRows = [
      { workspaceId: "workspace-1", settings: {}, memberRole: "member" },
    ];
    const { POST } = await import("legacy-api/workspaces/current/sla/route");

    const response = await POST(request({ name: "Nope" }));

    expect(response.status).toBe(403);
    expect(updateSetMock).not.toHaveBeenCalled();
  });
});
