import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiSessionMock = vi.fn();
const resolveActiveWorkspaceIdMock = vi.fn();
const projectLabelsRowsMock = vi.fn();
const duplicateRowsMock = vi.fn();
const insertValuesMock = vi.fn();
const insertReturningMock = vi.fn();
const updateValuesMock = vi.fn();
const updateReturningMock = vi.fn();
const deleteReturningMock = vi.fn();
const txUpdateValuesMock = vi.fn();

vi.mock("@/lib/api-auth", () => ({
  requireApiSession: requireApiSessionMock,
}));

vi.mock("@/lib/active-workspace", () => ({
  resolveActiveWorkspaceId: resolveActiveWorkspaceIdMock,
}));

function selectBuilder(selection?: Record<string, unknown>) {
  if (selection && "projectCount" in selection) {
    return {
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue(projectLabelsRowsMock()),
            }),
          }),
        }),
      }),
    };
  }

  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi
      .fn()
      .mockImplementation(() => Promise.resolve(duplicateRowsMock())),
  };
}

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(selectBuilder),
    insert: vi.fn(() => ({
      values: vi.fn((values) => {
        insertValuesMock(values);
        return {
          returning: vi.fn().mockResolvedValue(insertReturningMock()),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values) => {
        updateValuesMock(values);
        return {
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue(updateReturningMock()),
          }),
        };
      }),
    })),
    transaction: vi.fn(async (callback) =>
      callback({
        select: vi.fn((selection?: Record<string, unknown>) => {
          if (selection && "settings" in selection) {
            return {
              from: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([
                  {
                    id: "project-1",
                    settings: { labelIds: ["pl-1", "other-label"] },
                  },
                ]),
              }),
            };
          }

          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(duplicateRowsMock()),
              }),
            }),
          };
        }),
        update: vi.fn(() => ({
          set: vi.fn((values) => {
            txUpdateValuesMock(values);
            return { where: vi.fn().mockResolvedValue(undefined) };
          }),
        })),
        delete: vi.fn(() => ({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue(deleteReturningMock()),
          }),
        })),
      }),
    ),
  },
}));

describe("project labels routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValue({
      response: null,
      session: { user: { id: "user-1" } },
    });
    resolveActiveWorkspaceIdMock.mockResolvedValue("workspace-1");
    duplicateRowsMock.mockReturnValue([]);
    projectLabelsRowsMock.mockReturnValue([
      {
        id: "pl-1",
        name: "Roadmap",
        color: "#3b82f6",
        description: "Planning",
        projectCount: 2,
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        updatedAt: new Date("2026-05-02T00:00:00.000Z"),
      },
    ]);
    insertReturningMock.mockReturnValue([{ id: "pl-2", name: "Customer" }]);
    updateReturningMock.mockReturnValue([{ id: "pl-1", name: "Roadmap 2" }]);
    deleteReturningMock.mockReturnValue([{ id: "pl-1" }]);
  });

  it("returns project labels with project counts", async () => {
    const { GET } = await import("legacy-api/project-labels/route");

    const response = await GET();

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.labels[0]).toMatchObject({
      id: "pl-1",
      name: "Roadmap",
      projectCount: 2,
    });
  });

  it("creates project labels in project-label storage", async () => {
    const { POST } = await import("legacy-api/project-labels/route");

    const response = await POST(
      new Request("http://localhost/api/project-labels", {
        method: "POST",
        body: JSON.stringify({
          name: "Customer",
          color: "#3B82F6",
          description: "Visible roadmap",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Customer",
        color: "#3b82f6",
        description: "Visible roadmap",
        workspaceId: "workspace-1",
      }),
    );
  });

  it("rejects duplicate project label names", async () => {
    duplicateRowsMock.mockReturnValue([{ id: "pl-existing" }]);
    const { POST } = await import("legacy-api/project-labels/route");

    const response = await POST(
      new Request("http://localhost/api/project-labels", {
        method: "POST",
        body: JSON.stringify({ name: "Customer" }),
      }),
    );

    expect(response.status).toBe(409);
  });

  it("updates project labels without touching issue labels", async () => {
    const { PATCH } = await import("legacy-api/project-labels/[id]/route");

    const response = await PATCH(
      new Request("http://localhost/api/project-labels/pl-1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Roadmap 2", description: "Updated" }),
      }),
      { params: Promise.resolve({ id: "pl-1" }) },
    );

    expect(response.status).toBe(200);
    expect(updateValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Roadmap 2", description: "Updated" }),
    );
  });

  it("deletes project labels and removes them from project metadata", async () => {
    duplicateRowsMock.mockReturnValue([{ id: "pl-1" }]);
    const { DELETE } = await import("legacy-api/project-labels/[id]/route");

    const response = await DELETE(
      new Request("http://localhost/api/project-labels/pl-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "pl-1" }) },
    );

    expect(response.status).toBe(200);
    expect(txUpdateValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: { labelIds: ["other-label"] },
      }),
    );
  });
});
