import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import {
  EXPONENTIAL_MCP_TOOL_NAMES,
  createExponentialMcpServer,
  invokeExponentialMcpTool,
} from "./index.js";

type CapturedRequest = {
  url: string;
  method: string;
  headers: Headers;
};

describe("exponential MCP server", () => {
  it("registers exactly the expected tool names over MCP", async () => {
    const { client, server } = await connectedClient();
    const tools = await client.listTools();

    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
      [...EXPONENTIAL_MCP_TOOL_NAMES].sort(),
    );
    for (const tool of tools.tools) {
      expect(tool.inputSchema.type).toBe("object");
    }

    await client.close();
    await server.close();
  });

  it("marks read-only tools with readOnlyHint=true and write tools with readOnlyHint=false", async () => {
    const { client, server } = await connectedClient();
    const tools = await client.listTools();

    const readOnlyNames = [
      "search_issues",
      "get_issue",
      "list_my_issues",
      "list_projects",
      "get_project",
      "list_team_cycles",
    ];
    const writeNames = [
      "create_issue",
      "update_issue",
      "add_comment",
      "triage_issue",
    ];

    for (const tool of tools.tools) {
      if (readOnlyNames.includes(tool.name)) {
        expect(
          tool.annotations?.readOnlyHint,
          `${tool.name} should be readOnly`,
        ).toBe(true);
        expect(tool.description).toContain("Read-only");
      }
      if (writeNames.includes(tool.name)) {
        expect(
          tool.annotations?.readOnlyHint,
          `${tool.name} should not be readOnly`,
        ).toBe(false);
      }
    }

    await client.close();
    await server.close();
  });

  it("maps read-only tools to generated SDK API paths", async () => {
    const requests: CapturedRequest[] = [];
    const result = await invokeExponentialMcpTool(
      {
        token: "pat_mcp",
        baseUrl: "https://api.example/v1",
        fetch: fetchFor(requests),
      },
      "search_issues",
      { query: "headless", workspaceId: "workspace-1" },
    );

    expect(result.isError).toBeUndefined();
    expect(textContent(result)).toContain("EXP-1");
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("GET");
    expect(requests[0].url).toContain("/v1/issues/search");
    expect(requests[0].url).toContain("q=headless");
    expect(requests[0].headers.get("authorization")).toBe("Bearer pat_mcp");
  });

  it("rejects bad input before making SDK calls", async () => {
    const requests: CapturedRequest[] = [];
    const result = await invokeExponentialMcpTool(
      {
        token: "pat_mcp",
        baseUrl: "https://api.example/v1",
        fetch: fetchFor(requests),
      },
      "get_issue",
      { id: "EXP-1", extra: "blocked by strict schema" },
    );

    expect(result.isError).toBe(true);
    expect(textContent(result)).toContain("Unrecognized key");
    expect(requests).toHaveLength(0);
  });

  it("requires a token and redacts sensitive API error fields", async () => {
    expect(() =>
      createExponentialMcpServer({
        token: "",
        baseUrl: "https://api.example/v1",
      }),
    ).toThrow("EXPONENTIAL_TOKEN is required");

    const result = await invokeExponentialMcpTool(
      {
        token: "pat_should_not_leak",
        baseUrl: "https://api.example/v1",
        fetch: async () =>
          new Response(
            JSON.stringify({
              title: "Forbidden",
              authorization: "Bearer pat_should_not_leak",
            }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          ),
      },
      "get_issue",
      { id: "EXP-1" },
    );

    expect(result.isError).toBe(true);
    expect(textContent(result)).toContain("Forbidden");
    expect(textContent(result)).not.toContain("pat_should_not_leak");
    expect(textContent(result)).not.toContain("authorization");
  });

  it("create_issue sends POST to /issues with required and optional fields", async () => {
    const requests: CapturedRequest[] = [];
    const result = await invokeExponentialMcpTool(
      {
        token: "pat_mcp",
        baseUrl: "https://api.example/v1",
        fetch: fetchFor(requests),
      },
      "create_issue",
      {
        title: "Agent-filed bug",
        team_id: "team-uuid-1",
        priority: "high",
        description: "Found by the AI agent",
      },
    );

    expect(result.isError).toBeUndefined();
    expect(textContent(result)).toContain("EXP-99");
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("POST");
    expect(requests[0].url).toContain("/v1/issues");
    expect(requests[0].headers.get("authorization")).toBe("Bearer pat_mcp");
  });

  it("update_issue sends PATCH to /issues/{id}", async () => {
    const requests: CapturedRequest[] = [];
    const result = await invokeExponentialMcpTool(
      {
        token: "pat_mcp",
        baseUrl: "https://api.example/v1",
        fetch: fetchFor(requests),
      },
      "update_issue",
      { id: "EXP-1", priority: "urgent", state_id: "state-uuid-1" },
    );

    expect(result.isError).toBeUndefined();
    expect(textContent(result)).toContain("EXP-1");
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("PATCH");
    expect(requests[0].url).toContain("/v1/issues/EXP-1");
  });

  it("add_comment sends POST to /issues/{id}/comments", async () => {
    const requests: CapturedRequest[] = [];
    const result = await invokeExponentialMcpTool(
      {
        token: "pat_mcp",
        baseUrl: "https://api.example/v1",
        fetch: fetchFor(requests),
      },
      "add_comment",
      { issueId: "EXP-1", body: "This is a comment from the AI agent" },
    );

    expect(result.isError).toBeUndefined();
    expect(textContent(result)).toContain("comment-1");
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("POST");
    expect(requests[0].url).toContain("/v1/issues/EXP-1/comments");
  });

  it("triage_issue sends PATCH to /teams/{key}/triage/{issueID}", async () => {
    const requests: CapturedRequest[] = [];
    const result = await invokeExponentialMcpTool(
      {
        token: "pat_mcp",
        baseUrl: "https://api.example/v1",
        fetch: fetchFor(requests),
      },
      "triage_issue",
      {
        teamKey: "ENG",
        issueId: "issue-uuid-1",
        action: "accept",
        destinationStateId: "state-uuid-1",
      },
    );

    expect(result.isError).toBeUndefined();
    expect(textContent(result)).toContain("success");
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("PATCH");
    expect(requests[0].url).toContain("/v1/teams/ENG/triage/issue-uuid-1");
  });

  it("rejects create_issue with missing required field", async () => {
    const requests: CapturedRequest[] = [];
    const result = await invokeExponentialMcpTool(
      {
        token: "pat_mcp",
        baseUrl: "https://api.example/v1",
        fetch: fetchFor(requests),
      },
      "create_issue",
      { title: "Missing team_id" },
    );

    expect(result.isError).toBe(true);
    expect(textContent(result)).toContain("team_id");
    expect(requests).toHaveLength(0);
  });

  it("rejects update_issue with extra fields (strict schema)", async () => {
    const requests: CapturedRequest[] = [];
    const result = await invokeExponentialMcpTool(
      {
        token: "pat_mcp",
        baseUrl: "https://api.example/v1",
        fetch: fetchFor(requests),
      },
      "update_issue",
      { id: "EXP-1", unknownField: "not-allowed" },
    );

    expect(result.isError).toBe(true);
    expect(requests).toHaveLength(0);
  });

  it("keeps package and app boundaries free of write transports and CLI/DB imports", () => {
    const serverSource = readFileSync(
      new URL("./server.ts", import.meta.url),
      "utf8",
    );
    const appSource = readFileSync(
      new URL("../../../apps/mcp/src/index.ts", import.meta.url),
      "utf8",
    );

    expect(serverSource).not.toMatch(
      /apps\/cli|@exponential\/cli|pgx|sqlc|database/i,
    );
    expect(appSource).toContain("StdioServerTransport");
    expect(appSource).not.toMatch(/Streamable|HTTP|listen|OAuth/i);
  });
});

async function connectedClient() {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = createExponentialMcpServer({
    token: "pat_mcp",
    baseUrl: "https://api.example/v1",
    fetch: fetchFor([]),
  });
  const client = new Client({ name: "test-client", version: "0.1.0" });

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  return { client, server };
}

function fetchFor(requests: CapturedRequest[]): typeof fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push({
      url: request.url,
      method: request.method,
      headers: request.headers,
    });

    return responseFor(request);
  };
}

function responseFor(request: Request) {
  const url = new URL(request.url);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  if (url.pathname === "/v1/issues/search") {
    return json({
      issues: [{ id: "issue-1", identifier: "EXP-1", title: "Headless" }],
    });
  }
  if (url.pathname === "/v1/issues" && request.method === "POST") {
    return json(
      { id: "issue-99", identifier: "EXP-99", title: "Agent-filed bug" },
      201,
    );
  }
  if (url.pathname === "/v1/issues/EXP-1" && request.method === "PATCH") {
    return json({ id: "issue-1", identifier: "EXP-1", title: "Headless" });
  }
  if (url.pathname === "/v1/issues/EXP-1") {
    return json({ id: "issue-1", identifier: "EXP-1", title: "Headless" });
  }
  if (url.pathname === "/v1/issues/EXP-1/comments" && request.method === "POST") {
    return json({ id: "comment-1", body: "This is a comment from the AI agent" }, 201);
  }
  if (url.pathname === "/v1/my-issues") {
    return json({ groups: [], filterOptions: {} });
  }
  if (url.pathname === "/v1/projects") {
    return json({ projects: [{ id: "project-1", slug: "headless" }] });
  }
  if (url.pathname === "/v1/projects/headless") {
    return json({ id: "project-1", slug: "headless" });
  }
  if (url.pathname === "/v1/teams/ENG/cycles") {
    return json({ cycles: [] });
  }
  if (
    url.pathname === "/v1/teams/ENG/triage/issue-uuid-1" &&
    request.method === "PATCH"
  ) {
    return json({ success: true, accepted: ["issue-uuid-1"], declined: [] });
  }
  return json({ title: "Not found" }, 404);
}

function textContent(result: { content?: { type: string; text?: string }[] }) {
  return (
    result.content
      ?.map((entry) => (entry.type === "text" ? (entry.text ?? "") : ""))
      .join("\n") ?? ""
  );
}
