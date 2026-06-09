import { type McpRepository, handleMcpJsonRpc } from "@/lib/mcp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiSessionMock = vi.fn();

vi.mock("@/lib/api-auth", () => ({
  requireApiSession: requireApiSessionMock,
}));

const context = {
  workspaceId: "workspace-1",
  userId: "user-1",
  userName: "Ada Lovelace",
  userEmail: "ada@example.com",
  apiKeyId: "api-key-1",
  memberRole: "member",
};

function buildRepository(
  overrides: Partial<McpRepository> = {},
): McpRepository {
  return {
    searchIssues: vi.fn().mockResolvedValue({
      issues: [{ id: "issue-1", identifier: "ENG-1", title: "Ship MCP" }],
    }),
    getIssue: vi.fn(),
    listTeams: vi.fn(),
    listProjects: vi.fn(),
    listViews: vi.fn(),
    listComments: vi.fn(),
    listCustomers: vi.fn(),
    auditToolCall: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("MCP JSON-RPC handler", () => {
  it("answers initialize and tools/list without auditing", async () => {
    const repository = buildRepository();

    const initialize = await handleMcpJsonRpc(
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      context,
      repository,
    );
    const tools = await handleMcpJsonRpc(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      context,
      repository,
    );

    expect(initialize).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        serverInfo: { name: "exponential" },
        capabilities: { tools: { listChanged: false } },
      },
    });
    expect(tools).toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "exponential_search_issues" }),
        ]),
      },
    });
    expect(repository.auditToolCall).not.toHaveBeenCalled();
  });

  it("calls read tools and writes a successful audit entry", async () => {
    const repository = buildRepository();

    const response = await handleMcpJsonRpc(
      {
        jsonrpc: "2.0",
        id: "call-1",
        method: "tools/call",
        params: {
          name: "exponential_search_issues",
          arguments: { query: "MCP" },
        },
      },
      context,
      repository,
    );

    expect(repository.searchIssues).toHaveBeenCalledWith({ query: "MCP" });
    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: "call-1",
      result: {
        content: [
          {
            type: "text",
            text: expect.stringContaining("ENG-1"),
          },
        ],
      },
    });
    expect(repository.auditToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "exponential_search_issues",
        userId: "user-1",
        apiKeyId: "api-key-1",
        workspaceId: "workspace-1",
        success: true,
        error: null,
      }),
    );
  });

  it("returns tool errors and audits failed calls", async () => {
    const repository = buildRepository({
      searchIssues: vi.fn().mockRejectedValue(new Error("query is required")),
    });

    const response = await handleMcpJsonRpc(
      {
        jsonrpc: "2.0",
        id: "call-2",
        method: "tools/call",
        params: {
          name: "exponential_search_issues",
          arguments: {},
        },
      },
      context,
      repository,
    );

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: "call-2",
      result: {
        isError: true,
        content: [{ type: "text", text: "query is required" }],
      },
    });
    expect(repository.auditToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: "query is required",
      }),
    );
  });
});

describe("MCP route auth", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("rejects browser sessions because remote MCP requires a bearer PAT", async () => {
    requireApiSessionMock.mockResolvedValue({
      response: null,
      session: {
        user: { id: "user-1", name: "Ada", email: "ada@example.com" },
      },
    });
    const { GET } = await import("@/app/api/mcp/route");

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "MCP requires a personal API key bearer token.",
    });
  });

  it("accepts PAT-backed sessions and forwards JSON-RPC to the handler", async () => {
    requireApiSessionMock.mockResolvedValue({
      response: null,
      session: {
        user: {
          id: "user-1",
          name: "Ada",
          email: "ada@example.com",
          image: null,
        },
        apiKey: {
          id: "api-key-1",
          workspaceId: "workspace-1",
          memberRole: "member",
        },
      },
    });
    const { POST } = await import("@/app/api/mcp/route");

    const response = await POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        serverInfo: { name: "exponential" },
        capabilities: { tools: { listChanged: false } },
      },
    });
  });
});
