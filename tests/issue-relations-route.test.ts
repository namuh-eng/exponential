import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiSessionMock = vi.fn();
const resolveRequestWorkspaceIdMock = vi.fn();
const selectResults: unknown[][] = [];
const insertValuesMock = vi.fn();
const insertReturningMock = vi.fn();
const deleteWhereMock = vi.fn();
const historyValuesMock = vi.fn();

vi.mock("@/lib/api-auth", () => ({
  requireApiSession: requireApiSessionMock,
}));

vi.mock("@/lib/active-workspace", () => ({
  resolveRequestWorkspaceId: resolveRequestWorkspaceIdMock,
}));

function makeSelectChain(result: unknown[]) {
  const limit = vi.fn().mockResolvedValue(result);
  const where = vi.fn().mockReturnValue({ limit });
  const chain = {
    innerJoin: vi.fn(() => chain),
    where,
  };

  return {
    from: vi.fn(() => chain),
  };
}

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => makeSelectChain(selectResults.shift() ?? [])),
    insert: vi.fn(() => ({
      values: (values: unknown) => {
        insertValuesMock(values);
        if (
          values &&
          typeof values === "object" &&
          "relatedIssueId" in values
        ) {
          return { returning: insertReturningMock };
        }

        historyValuesMock(values);
        return Promise.resolve();
      },
    })),
    delete: vi.fn(() => ({
      where: deleteWhereMock,
    })),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

const sourceIssue = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  identifier: "ENG-1",
  title: "Source issue",
  teamId: "team-1",
  workspaceId: "workspace-1",
  teamSettings: {},
};

const relatedIssue = {
  id: "550e8400-e29b-41d4-a716-446655440002",
  identifier: "ENG-2",
  title: "Related issue",
  teamId: "team-1",
  workspaceId: "workspace-1",
};

const createdRelation = {
  id: "550e8400-e29b-41d4-a716-446655440003",
  type: "blocks",
  relatedIssueId: relatedIssue.id,
};

describe("issue relation mutation routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    selectResults.length = 0;
    requireApiSessionMock.mockResolvedValue({
      session: {
        user: {
          id: "user-1",
          name: "Ashley",
          email: "ashley@example.com",
        },
      },
      response: null,
    });
    resolveRequestWorkspaceIdMock.mockResolvedValue("workspace-1");
    insertReturningMock.mockResolvedValue([createdRelation]);
    deleteWhereMock.mockResolvedValue(undefined);
  });

  it("creates a workspace-scoped relation and records history", async () => {
    selectResults.push([sourceIssue], [relatedIssue], []);
    const { POST } = await import("@/app/api/issues/[id]/relations/route");

    const response = await POST(
      new Request("http://localhost/api/issues/ENG-1/relations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "blocks",
          relatedIssueId: relatedIssue.id,
        }),
      }),
      { params: Promise.resolve({ id: "ENG-1" }) },
    );

    expect(response.status).toBe(201);
    expect(insertValuesMock).toHaveBeenCalledWith({
      issueId: sourceIssue.id,
      relatedIssueId: relatedIssue.id,
      type: "blocks",
    });
    expect(historyValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: sourceIssue.id,
        eventType: "updated",
        metadata: expect.objectContaining({
          changedFields: ["relations"],
          relationType: "blocks",
          relatedIdentifier: "ENG-2",
        }),
      }),
    );
    await expect(response.json()).resolves.toEqual({
      id: createdRelation.id,
      type: "blocks",
      issue: {
        id: relatedIssue.id,
        identifier: "ENG-2",
        title: "Related issue",
      },
    });
  });

  it("rejects self-relations", async () => {
    selectResults.push([sourceIssue]);
    const { POST } = await import("@/app/api/issues/[id]/relations/route");

    const response = await POST(
      new Request("http://localhost/api/issues/ENG-1/relations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "related",
          relatedIssueId: sourceIssue.id,
        }),
      }),
      { params: Promise.resolve({ id: "ENG-1" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Issue cannot relate to itself",
    });
  });

  it("rejects duplicate inverse relations", async () => {
    selectResults.push([sourceIssue], [relatedIssue], [{ id: "rel-existing" }]);
    const { POST } = await import("@/app/api/issues/[id]/relations/route");

    const response = await POST(
      new Request("http://localhost/api/issues/ENG-1/relations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "blocked_by",
          relatedIssueId: relatedIssue.id,
        }),
      }),
      { params: Promise.resolve({ id: "ENG-1" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Issue relation already exists",
    });
  });

  it("rejects cross-workspace related issues", async () => {
    selectResults.push([sourceIssue], []);
    const { POST } = await import("@/app/api/issues/[id]/relations/route");

    const response = await POST(
      new Request("http://localhost/api/issues/ENG-1/relations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "related",
          relatedIssueId: relatedIssue.id,
        }),
      }),
      { params: Promise.resolve({ id: "ENG-1" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Related issue not found",
    });
  });

  it("deletes a relation visible from the inverse issue view", async () => {
    selectResults.push([
      {
        ...relatedIssue,
        teamSettings: {},
      },
    ]);
    selectResults.push([
      {
        id: createdRelation.id,
        type: "blocks",
        issueId: sourceIssue.id,
        relatedIssueId: relatedIssue.id,
      },
    ]);
    const { DELETE } = await import(
      "@/app/api/issues/[id]/relations/[relationId]/route"
    );

    const response = await DELETE(
      new Request(
        `http://localhost/api/issues/${relatedIssue.id}/relations/${createdRelation.id}`,
        { method: "DELETE" },
      ),
      {
        params: Promise.resolve({
          id: relatedIssue.id,
          relationId: createdRelation.id,
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(deleteWhereMock).toHaveBeenCalled();
    expect(historyValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: relatedIssue.id,
        eventType: "updated",
        metadata: expect.objectContaining({
          removedRelationId: createdRelation.id,
        }),
      }),
    );
    await expect(response.json()).resolves.toEqual({ success: true });
  });
});
