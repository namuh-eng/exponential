import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const findAccessibleTeamMock = vi.fn();
const selectRowsMock = vi.fn();
const insertValuesMock = vi.fn();
const insertReturningMock = vi.fn();
const updateSetMock = vi.fn();
const updateReturningMock = vi.fn();
const deleteWhereMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: getSessionMock } },
}));

vi.mock("@/lib/teams", () => ({
  findAccessibleTeam: findAccessibleTeamMock,
}));

function selectChain(rows = selectRowsMock()) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
}

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => selectChain()),
    insert: vi.fn(() => ({
      values: vi.fn((values) => {
        insertValuesMock(values);
        return { returning: vi.fn().mockResolvedValue(insertReturningMock()) };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values) => {
        updateSetMock(values);
        return {
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue(updateReturningMock()),
          }),
        };
      }),
    })),
    transaction: vi.fn(async (callback) =>
      callback({
        select: vi.fn(() => selectChain([{ id: "label-1" }])),
        delete: vi.fn(() => ({
          where: vi.fn((value) => {
            deleteWhereMock(value);
            return {
              returning: vi.fn().mockResolvedValue([{ id: "label-1" }]),
            };
          }),
        })),
      }),
    ),
  },
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

describe("team labels API routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    findAccessibleTeamMock.mockResolvedValue({
      id: "team-1",
      key: "ENG",
      name: "Engineering",
      workspaceId: "workspace-1",
    });
    selectRowsMock.mockReturnValue([]);
    insertReturningMock.mockReturnValue([{ id: "label-1", name: "Backend" }]);
    updateReturningMock.mockReturnValue([{ id: "label-1", name: "Platform" }]);
  });

  it("creates labels scoped to the selected team", async () => {
    const { POST } = await import("legacy-api/teams/[key]/labels/route");

    const response = await POST(
      new Request("http://localhost/api/teams/ENG/labels", {
        method: "POST",
        body: JSON.stringify({ name: " Backend ", color: "#3b82f6" }),
      }),
      { params: Promise.resolve({ key: "ENG" }) },
    );

    expect(response.status).toBe(201);
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Backend",
        workspaceId: "workspace-1",
        teamId: "team-1",
      }),
    );
  });

  it("rejects editing a label that is not in the selected team", async () => {
    selectRowsMock.mockReturnValue([]);
    const { PATCH } = await import("legacy-api/teams/[key]/labels/[id]/route");

    const response = await PATCH(
      new Request("http://localhost/api/teams/ENG/labels/other-team-label", {
        method: "PATCH",
        body: JSON.stringify({ name: "Platform" }),
      }),
      { params: Promise.resolve({ key: "ENG", id: "other-team-label" }) },
    );

    expect(response.status).toBe(404);
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("updates and deletes labels only through the selected team scope", async () => {
    selectRowsMock.mockReturnValue([{ id: "label-1" }]);
    const route = await import("legacy-api/teams/[key]/labels/[id]/route");

    const patchResponse = await route.PATCH(
      new Request("http://localhost/api/teams/ENG/labels/label-1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Platform", description: "Owning team" }),
      }),
      { params: Promise.resolve({ key: "ENG", id: "label-1" }) },
    );
    expect(patchResponse.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Platform", description: "Owning team" }),
    );

    const deleteResponse = await route.DELETE(
      new Request("http://localhost/api/teams/ENG/labels/label-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ key: "ENG", id: "label-1" }) },
    );
    expect(deleteResponse.status).toBe(200);
    expect(deleteWhereMock).toHaveBeenCalled();
  });
});
