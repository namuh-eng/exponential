import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const resolveRequestWorkspaceIdMock = vi.fn();
const selectQueue: unknown[][] = [];
const updateSetMock = vi.fn();
const insertIssueValuesMock = vi.fn();
const insertHistoryValuesMock = vi.fn();
let txInsertCount = 0;

function queueSelect(...results: unknown[][]) {
  selectQueue.push(...results);
}

function makeQuery(result: unknown[]) {
  const query = {
    from: vi.fn(() => query),
    innerJoin: vi.fn(() => query),
    where: vi.fn(() => Promise.resolve(result)),
    orderBy: vi.fn(() => query),
    groupBy: vi.fn(() => Promise.resolve(result)),
    limit: vi.fn(() => Promise.resolve(result)),
  };
  return query;
}

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: getSessionMock } },
}));

vi.mock("@/lib/active-workspace", () => ({
  resolveRequestWorkspaceId: resolveRequestWorkspaceIdMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => makeQuery((selectQueue.shift() ?? []) as unknown[])),
    update: vi.fn(() => ({
      set: (...args: unknown[]) => {
        updateSetMock(...args);
        return { where: vi.fn(() => Promise.resolve()) };
      },
    })),
    transaction: vi.fn(async (callback) => {
      const tx = {
        insert: (table: { __name?: string }) => ({
          values: (...args: unknown[]) => {
            txInsertCount += 1;
            if (
              txInsertCount > 1 ||
              table.__name === "issueHistory" ||
              table.__name === "issue_history"
            ) {
              insertHistoryValuesMock(...args);
              return Promise.resolve();
            }
            insertIssueValuesMock(...args);
            return {
              returning: vi.fn().mockResolvedValue([
                {
                  id: "issue-imported",
                  number: 3,
                  identifier: "ENG-3",
                  title: "Imported issue",
                },
              ]),
            };
          },
        }),
      };
      return callback(tx);
    }),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("workspace import/export API", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    selectQueue.length = 0;
    txInsertCount = 0;
    getSessionMock.mockResolvedValue({
      user: { id: "user-1", name: "Admin", email: "admin@example.com" },
    });
    resolveRequestWorkspaceIdMock.mockResolvedValue("workspace-1");
  });

  it("denies import/export actions to non-admin workspace members", async () => {
    queueSelect([
      {
        id: "workspace-1",
        name: "Workspace",
        urlSlug: "workspace",
        settings: {},
        role: "member",
      },
    ]);
    const { POST } = await import(
      "legacy-api/workspaces/current/import-export/route"
    );

    const response = await POST(
      new Request("http://localhost/api/workspaces/current/import-export", {
        method: "POST",
        body: JSON.stringify({ action: "request_export" }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Only workspace admins can import or export workspace data",
    });
  });

  it("previews CSV imports with row-level validation", async () => {
    queueSelect([
      {
        id: "workspace-1",
        name: "Workspace",
        urlSlug: "workspace",
        settings: {},
        role: "admin",
      },
    ]);
    const { POST } = await import(
      "legacy-api/workspaces/current/import-export/route"
    );

    const response = await POST(
      new Request("http://localhost/api/workspaces/current/import-export", {
        method: "POST",
        body: JSON.stringify({
          action: "preview_csv",
          csv: "title,priority\n,critical\nImported issue,high",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.preview).toMatchObject({
      rowCount: 2,
      validCount: 1,
      errorCount: 1,
    });
    expect(body.preview.rows[0].errors).toContain("Title is required");
  });

  it("creates a completed export job with a persisted download URL", async () => {
    queueSelect(
      [
        {
          id: "workspace-1",
          name: "Workspace",
          urlSlug: "workspace",
          settings: {},
          role: "owner",
        },
      ],
      [{ id: "team-1", key: "ENG", name: "Engineering" }],
      [
        {
          id: "state-1",
          teamId: "team-1",
          name: "Backlog",
          category: "backlog",
          color: "#000000",
        },
      ],
      [],
      [],
      [
        {
          id: "member-1",
          role: "owner",
          userId: "user-1",
          name: "Admin",
          email: "admin@example.com",
        },
      ],
      [
        {
          id: "issue-1",
          number: 1,
          identifier: "ENG-1",
          title: "Existing",
          teamId: "team-1",
        },
      ],
      [],
    );
    const { POST } = await import(
      "legacy-api/workspaces/current/import-export/route"
    );

    const response = await POST(
      new Request("http://localhost/api/workspaces/current/import-export", {
        method: "POST",
        body: JSON.stringify({ action: "request_export" }),
      }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.export).toMatchObject({
      type: "export",
      status: "completed",
      rowCount: 1,
    });
    expect(body.export.downloadUrl).toMatch(
      /\/api\/workspaces\/current\/import-export\/exports\/.+\/download/,
    );
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({ importExport: expect.any(Object) }),
      }),
    );
  });

  it("starts a CSV import job and inserts issues from valid rows", async () => {
    queueSelect(
      [
        {
          id: "workspace-1",
          name: "Workspace",
          urlSlug: "workspace",
          settings: {},
          role: "admin",
        },
      ],
      [{ id: "team-1", key: "ENG", name: "Engineering", settings: {} }],
      [
        {
          id: "state-1",
          teamId: "team-1",
          name: "Backlog",
          category: "backlog",
        },
      ],
      [{ maxNum: 2 }],
    );
    const { POST } = await import(
      "legacy-api/workspaces/current/import-export/route"
    );

    const response = await POST(
      new Request("http://localhost/api/workspaces/current/import-export", {
        method: "POST",
        body: JSON.stringify({
          action: "start_csv_import",
          csv: "title,description,priority,team\nImported issue,Body,high,ENG",
          fileName: "issues.csv",
        }),
      }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.import).toMatchObject({
      type: "import",
      provider: "csv",
      status: "completed",
      importedCount: 1,
    });
    expect(insertIssueValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: "ENG-3",
        title: "Imported issue",
        priority: "high",
      }),
    );
    expect(insertHistoryValuesMock).toHaveBeenCalled();
  });
});
