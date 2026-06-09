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
  it("registers exactly the read-only v0 tools over MCP", async () => {
    const { client, server } = await connectedClient();
    const tools = await client.listTools();

    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
      [...EXPONENTIAL_MCP_TOOL_NAMES].sort(),
    );
    expect(
      tools.tools.some((tool) => /^(create|update|delete)_/.test(tool.name)),
    ).toBe(false);
    for (const tool of tools.tools) {
      expect(tool.description).toContain("Read-only");
      expect(tool.inputSchema.type).toBe("object");
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
  if (url.pathname === "/v1/issues/EXP-1") {
    return json({ id: "issue-1", identifier: "EXP-1", title: "Headless" });
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
  return json({ title: "Not found" }, 404);
}

function textContent(result: { content?: { type: string; text?: string }[] }) {
  return (
    result.content
      ?.map((entry) => (entry.type === "text" ? (entry.text ?? "") : ""))
      .join("\n") ?? ""
  );
}
