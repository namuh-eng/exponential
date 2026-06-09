import { beforeEach, describe, expect, it, vi } from "vitest";

const selectQueue: unknown[][] = [];
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();

function queueSelect(...results: unknown[][]) {
  selectQueue.push(...results);
}

function makeQuery(result: unknown[]) {
  const query = {
    from: vi.fn(() => query),
    innerJoin: vi.fn(() => query),
    where: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    limit: vi.fn(() => Promise.resolve(result)),
  };
  return query;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => makeQuery((selectQueue.shift() ?? []) as unknown[])),
    update: vi.fn(() => ({
      set: (...setArgs: unknown[]) => {
        updateSetMock(...setArgs);
        return {
          where: (...whereArgs: unknown[]) => {
            updateWhereMock(...whereArgs);
            return Promise.resolve();
          },
        };
      },
    })),
  },
}));

describe("Airbyte source routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    selectQueue.length = 0;
  });

  it("rejects catalog reads without an Airbyte bearer token", async () => {
    const { GET } = await import("@/app/api/airbyte/catalog/route");

    const response = await GET(
      new Request("http://localhost/api/airbyte/catalog"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  }, 10_000);

  it("returns catalog schema metadata and explicit private data behavior", async () => {
    queueSelect([
      {
        tokenId: "token-1",
        workspaceId: "workspace-1",
        workspaceSlug: "foreverbrowsing",
        settings: {},
        userId: "user-1",
        memberRole: "admin",
      },
    ]);
    const { GET } = await import("@/app/api/airbyte/catalog/route");

    const response = await GET(
      new Request("http://localhost/api/airbyte/catalog", {
        headers: { authorization: "Bearer lin_airbyte_secret" },
      }),
    );

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith({
      lastUsedAt: expect.any(Date),
    });
    await expect(response.json()).resolves.toMatchObject({
      connector: {
        name: "Exponential Airbyte source",
        workspaceSlug: "foreverbrowsing",
        supportedSyncModes: ["full_refresh", "incremental"],
      },
      streams: expect.arrayContaining([
        expect.objectContaining({
          name: "issues",
          cursorField: "updatedAt",
          supportedSyncModes: ["full_refresh", "incremental"],
        }),
        expect.objectContaining({
          name: "customers",
          cursorField: "updatedAt",
        }),
      ]),
      privateData: {
        privateTeams: expect.stringContaining("private teams"),
      },
    });
  });

  it("performs incremental issue sync with cursor metadata", async () => {
    queueSelect(
      [
        {
          tokenId: "token-1",
          workspaceId: "workspace-1",
          workspaceSlug: "foreverbrowsing",
          settings: {},
          userId: "user-1",
          memberRole: "admin",
        },
      ],
      [
        {
          id: "issue-1",
          identifier: "ENG-1",
          number: 1,
          title: "Sync issue",
          description: null,
          teamId: "team-1",
          stateId: "state-1",
          assigneeId: null,
          creatorId: "user-1",
          priority: "high",
          projectId: null,
          cycleId: null,
          createdAt: new Date("2026-04-08T10:00:00.000Z"),
          updatedAt: new Date("2026-04-08T11:00:00.000Z"),
          archivedAt: null,
          completedAt: null,
          canceledAt: null,
        },
      ],
    );
    const { GET } = await import("@/app/api/airbyte/streams/[stream]/route");

    const response = await GET(
      new Request(
        "http://localhost/api/airbyte/streams/issues?cursor=2026-04-08T09:00:00.000Z&limit=1",
        {
          headers: { authorization: "Bearer lin_airbyte_secret" },
        },
      ),
      { params: { stream: "issues" } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      stream: "issues",
      syncMode: "incremental",
      cursorField: "updatedAt",
      records: [
        {
          id: "issue-1",
          identifier: "ENG-1",
          updatedAt: "2026-04-08T11:00:00.000Z",
        },
      ],
      nextCursor: "2026-04-08T11:00:00.000Z",
      hasMore: true,
    });
  });

  it("rejects unsupported streams and malformed cursors", async () => {
    const { GET } = await import("@/app/api/airbyte/streams/[stream]/route");

    const unauthenticatedUnsupported = await GET(
      new Request("http://localhost/api/airbyte/streams/users"),
      { params: { stream: "users" } },
    );
    expect(unauthenticatedUnsupported.status).toBe(401);

    const unauthenticatedMalformedCursor = await GET(
      new Request("http://localhost/api/airbyte/streams/issues?cursor=nope"),
      { params: { stream: "issues" } },
    );
    expect(unauthenticatedMalformedCursor.status).toBe(401);

    queueSelect(
      [
        {
          tokenId: "token-1",
          workspaceId: "workspace-1",
          workspaceSlug: "foreverbrowsing",
          settings: {},
          userId: "user-1",
          memberRole: "admin",
        },
      ],
      [
        {
          tokenId: "token-1",
          workspaceId: "workspace-1",
          workspaceSlug: "foreverbrowsing",
          settings: {},
          userId: "user-1",
          memberRole: "admin",
        },
      ],
    );

    const unsupported = await GET(
      new Request("http://localhost/api/airbyte/streams/users", {
        headers: { authorization: "Bearer lin_airbyte_secret" },
      }),
      { params: { stream: "users" } },
    );
    expect(unsupported.status).toBe(404);

    const malformedCursor = await GET(
      new Request("http://localhost/api/airbyte/streams/issues?cursor=nope", {
        headers: { authorization: "Bearer lin_airbyte_secret" },
      }),
      { params: { stream: "issues" } },
    );
    expect(malformedCursor.status).toBe(400);
    await expect(malformedCursor.json()).resolves.toEqual({
      error: "Cursor must be an ISO timestamp.",
    });
  });
});
