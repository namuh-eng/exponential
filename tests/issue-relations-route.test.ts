import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiSessionMock = vi.fn();
const resolveRequestWorkspaceIdMock = vi.fn();
const findIssueLimitMock = vi.fn();
const duplicateLimitMock = vi.fn();
const insertReturningMock = vi.fn();
const historyValuesMock = vi.fn();
const buildNotificationValuesMock = vi.fn();
const insertNotificationsMock = vi.fn();
const deleteWhereMock = vi.fn();
const relationLimitMock = vi.fn();
const otherIssueLimitMock = vi.fn();
let selectCallCount = 0;

vi.mock("@/lib/api-auth", () => ({
  requireApiSession: requireApiSessionMock,
}));

vi.mock("@/lib/active-workspace", () => ({
  resolveRequestWorkspaceId: resolveRequestWorkspaceIdMock,
}));

vi.mock("@/lib/notifications", () => ({
  buildNotificationValues: buildNotificationValuesMock,
  insertNotifications: insertNotificationsMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn((selection?: Record<string, unknown>) => {
      selectCallCount += 1;
      if (selection && "teamSettings" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({ limit: findIssueLimitMock }),
            }),
          }),
        };
      }
      if (selection && "workspaceId" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({ limit: otherIssueLimitMock }),
            }),
          }),
        };
      }
      if (selection && "relatedIssueId" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({ limit: relationLimitMock }),
          }),
        };
      }
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit: duplicateLimitMock }),
        }),
      };
    }),
    transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({
        insert: vi.fn((table: unknown) => {
          if (selectCallCount >= 0 && table) {
            return {
              values: vi.fn((values: unknown) => {
                if (
                  Array.isArray(values) ||
                  (values as { issueId?: string }).issueId
                ) {
                  return { returning: insertReturningMock };
                }
                historyValuesMock(values);
                return Promise.resolve();
              }),
            };
          }
          return { values: historyValuesMock };
        }),
        delete: vi.fn(() => ({ where: deleteWhereMock })),
      }),
    ),
  },
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const sourceIssue = {
  id: "11111111-1111-4111-8111-111111111111",
  identifier: "ENG-1",
  title: "Source",
  assigneeId: "user-2",
  creatorId: "user-3",
  teamSettings: {},
  workspaceId: "workspace-1",
};
const targetIssue = {
  id: "22222222-2222-4222-8222-222222222222",
  identifier: "ENG-2",
  title: "Target",
  assigneeId: "user-4",
  creatorId: "user-5",
  teamSettings: {},
  workspaceId: "workspace-1",
};

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/issues/ENG-1/relations", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("issue relations routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    selectCallCount = 0;
    requireApiSessionMock.mockResolvedValue({
      response: null,
      session: {
        user: { id: "user-1", name: "Ashley", email: "ashley@example.com" },
      },
    });
    resolveRequestWorkspaceIdMock.mockResolvedValue("workspace-1");
    findIssueLimitMock
      .mockResolvedValueOnce([sourceIssue])
      .mockResolvedValueOnce([targetIssue]);
    duplicateLimitMock.mockResolvedValue([]);
    insertReturningMock.mockResolvedValue([
      {
        id: "rel-1",
        issueId: targetIssue.id,
        relatedIssueId: sourceIssue.id,
        type: "blocks",
      },
    ]);
    buildNotificationValuesMock.mockReturnValue([{ userId: "user-4" }]);
    insertNotificationsMock.mockResolvedValue(undefined);
    deleteWhereMock.mockResolvedValue(undefined);
    relationLimitMock.mockResolvedValue([
      {
        id: "rel-1",
        issueId: sourceIssue.id,
        relatedIssueId: targetIssue.id,
        type: "related",
      },
    ]);
    otherIssueLimitMock.mockResolvedValue([
      {
        id: targetIssue.id,
        identifier: targetIssue.identifier,
        workspaceId: "workspace-1",
      },
    ]);
  });

  it("creates blocked_by as normalized inverse blocks relation", async () => {
    const { POST } = await import("@/app/api/issues/[id]/relations/route");

    const response = await POST(
      jsonRequest({ type: "blocked_by", targetIssueId: targetIssue.id }),
      {
        params: Promise.resolve({ id: "ENG-1" }),
      },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      id: "rel-1",
      type: "blocked_by",
      issue: { id: targetIssue.id, identifier: "ENG-2", title: "Target" },
    });
    expect(insertReturningMock).toHaveBeenCalled();
  });

  it("rejects unsupported, self, duplicate, and missing target relations", async () => {
    const { POST } = await import("@/app/api/issues/[id]/relations/route");

    const unsupported = await POST(
      jsonRequest({ type: "depends_on", targetIssueId: targetIssue.id }),
      {
        params: Promise.resolve({ id: "ENG-1" }),
      },
    );
    expect(unsupported.status).toBe(400);

    findIssueLimitMock.mockReset();
    findIssueLimitMock
      .mockResolvedValueOnce([sourceIssue])
      .mockResolvedValueOnce([sourceIssue]);
    const self = await POST(
      jsonRequest({ type: "related", targetIssueId: sourceIssue.id }),
      {
        params: Promise.resolve({ id: "ENG-1" }),
      },
    );
    expect(self.status).toBe(400);

    findIssueLimitMock.mockReset();
    findIssueLimitMock
      .mockResolvedValueOnce([sourceIssue])
      .mockResolvedValueOnce([targetIssue]);
    duplicateLimitMock.mockResolvedValueOnce([{ id: "rel-existing" }]);
    const duplicate = await POST(
      jsonRequest({ type: "related", targetIssueId: targetIssue.id }),
      {
        params: Promise.resolve({ id: "ENG-1" }),
      },
    );
    expect(duplicate.status).toBe(409);

    findIssueLimitMock.mockReset();
    findIssueLimitMock
      .mockResolvedValueOnce([sourceIssue])
      .mockResolvedValueOnce([]);
    const missingTarget = await POST(
      jsonRequest({ type: "related", targetIssueId: targetIssue.id }),
      {
        params: Promise.resolve({ id: "ENG-1" }),
      },
    );
    expect(missingTarget.status).toBe(404);
  });

  it("deletes only relations attached to an issue in the authenticated workspace", async () => {
    const { DELETE } = await import(
      "@/app/api/issues/[id]/relations/[relationId]/route"
    );
    findIssueLimitMock.mockReset();
    findIssueLimitMock.mockResolvedValueOnce([sourceIssue]);

    const response = await DELETE(
      new Request("http://localhost/api/issues/ENG-1/relations/rel-1", {
        method: "DELETE",
      }),
      {
        params: Promise.resolve({ id: "ENG-1", relationId: "rel-1" }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(deleteWhereMock).toHaveBeenCalled();
  });
});
