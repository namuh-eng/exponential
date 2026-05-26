import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const workspaceLimitMock = vi.fn();
const txInsertWorkspaceReturningMock = vi.fn();
const txSelectTeamKeysMock = vi.fn();
const txInsertTeamReturningMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/lib/workspace-creation", () => ({
  validateWorkspaceName: vi.fn((name: string) =>
    !name.trim() ? "Name required" : null,
  ),
  sanitizeWorkspaceSlug: vi.fn((slug: string) => slug.toLowerCase().trim()),
  generateTeamKey: vi.fn(() => "ENG"),
  getDefaultWorkflowStates: vi.fn(() => []),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn((selection: Record<string, unknown>) => {
      // slug availability check
      if (selection && "id" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(workspaceLimitMock()),
            }),
          }),
        };
      }
      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
    }),
    transaction: vi.fn(
      async (
        cb: (tx: { insert: unknown; select: unknown }) => Promise<unknown>,
      ) => {
        const tx = {
          insert: vi.fn((_table: unknown) => ({
            values: vi.fn((values: unknown) => {
              // Determine if this is workspace or team based on fields
              const v = values as { urlSlug?: string };
              const isWorkspace = v && "urlSlug" in v;
              return {
                returning: vi.fn().mockImplementation(async () => {
                  const res = isWorkspace
                    ? txInsertWorkspaceReturningMock()
                    : txInsertTeamReturningMock();
                  return res;
                }),
              };
            }),
          })),
          select: vi.fn((_selection: unknown) => {
            const chain = {
              from: vi.fn().mockReturnThis(),
              // biome-ignore lint/suspicious/noThenProperty: <explanation>
              then: (resolve: (val: unknown) => void) =>
                resolve(txSelectTeamKeysMock()),
            };
            return chain;
          }),
        };
        const result = await cb(tx);
        return result;
      },
    ),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("workspaces collection route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    workspaceLimitMock.mockReturnValue([]);
    txInsertWorkspaceReturningMock.mockReturnValue([
      { id: "ws-1", name: "Namuh", urlSlug: "namuh" },
    ]);
    txSelectTeamKeysMock.mockReturnValue([]);
    txInsertTeamReturningMock.mockReturnValue([{ id: "team-1" }]);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { POST } = await import("legacy-api/workspaces/route");

    const response = await POST(
      new Request("http://localhost", { method: "POST" }),
    );

    expect(response.status).toBe(401);
  });

  it("creates a workspace with default team and owner", async () => {
    const { POST } = await import("legacy-api/workspaces/route");

    const response = await POST(
      new Request("http://localhost/api/workspaces", {
        method: "POST",
        body: JSON.stringify({ name: "Namuh", urlSlug: "namuh" }),
      }),
    );

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.workspace.id).toBe("ws-1");
    expect(response.headers.get("set-cookie")).toContain(
      "activeWorkspaceId=ws-1",
    );
  });

  it("rejects duplicate url slugs", async () => {
    workspaceLimitMock.mockReturnValue([{ id: "ws-existing" }]);
    const { POST } = await import("legacy-api/workspaces/route");

    const response = await POST(
      new Request("http://localhost/api/workspaces", {
        method: "POST",
        body: JSON.stringify({ name: "Namuh", urlSlug: "namuh" }),
      }),
    );

    expect(response.status).toBe(409);
  });
});
