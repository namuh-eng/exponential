import { createExponentialClient } from "@exponential/sdk";
import type { ExponentialClient } from "@exponential/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const emptyInputSchema = z.object({}).strict();
const searchIssuesInputSchema = z
  .object({
    query: z.string().min(1),
    workspaceId: z.string().min(1).optional(),
  })
  .strict();
const getIssueInputSchema = z.object({ id: z.string().min(1) }).strict();
const listMyIssuesInputSchema = z
  .object({
    tab: z.enum(["assigned", "created", "subscribed", "activity"]).optional(),
  })
  .strict();
const getProjectInputSchema = z.object({ slug: z.string().min(1) }).strict();
const listTeamCyclesInputSchema = z
  .object({ teamKey: z.string().min(1) })
  .strict();

export const EXPONENTIAL_MCP_TOOL_NAMES = [
  "search_issues",
  "get_issue",
  "list_my_issues",
  "list_projects",
  "get_project",
  "list_team_cycles",
] as const;

export type ExponentialMcpToolName =
  (typeof EXPONENTIAL_MCP_TOOL_NAMES)[number];

export type ExponentialMcpOptions = {
  token: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

type ToolDefinition = {
  name: ExponentialMcpToolName;
  title: string;
  description: string;
  schema: z.ZodType;
  handler: (
    client: ExponentialClient,
    input: z.output<z.ZodType>,
  ) => Promise<SdkResult>;
};

type SdkResult = {
  data?: unknown;
  error?: unknown;
  response: Response;
};

const toolDefinitions: ToolDefinition[] = [
  {
    name: "search_issues",
    title: "Search issues",
    description:
      "Read-only search across Exponential issues in the authenticated workspace.",
    schema: searchIssuesInputSchema,
    handler: (client, input) =>
      client.GET("/issues/search", {
        params: {
          query: {
            q: stringField(input, "query"),
            workspaceId: optionalStringField(input, "workspaceId"),
          },
        },
      }),
  },
  {
    name: "get_issue",
    title: "Get issue",
    description:
      "Read-only fetch for a single Exponential issue by id or identifier.",
    schema: getIssueInputSchema,
    handler: (client, input) =>
      client.GET("/issues/{id}", {
        params: { path: { id: stringField(input, "id") } },
      }),
  },
  {
    name: "list_my_issues",
    title: "List my issues",
    description:
      "Read-only list of issues related to the authenticated Exponential user.",
    schema: listMyIssuesInputSchema,
    handler: (client, input) =>
      client.GET("/my-issues", {
        params: { query: { tab: optionalMyIssuesTab(input) } },
      }),
  },
  {
    name: "list_projects",
    title: "List projects",
    description:
      "Read-only list of Exponential projects in the authenticated workspace.",
    schema: emptyInputSchema,
    handler: (client) => client.GET("/projects"),
  },
  {
    name: "get_project",
    title: "Get project",
    description: "Read-only fetch for a single Exponential project by slug.",
    schema: getProjectInputSchema,
    handler: (client, input) =>
      client.GET("/projects/{slug}", {
        params: { path: { slug: stringField(input, "slug") } },
      }),
  },
  {
    name: "list_team_cycles",
    title: "List team cycles",
    description: "Read-only list of cycles for an Exponential team key.",
    schema: listTeamCyclesInputSchema,
    handler: (client, input) =>
      client.GET("/teams/{key}/cycles", {
        params: { path: { key: stringField(input, "teamKey") } },
      }),
  },
];

export function createExponentialMcpServer(options: ExponentialMcpOptions) {
  const client = createMcpClient(options);
  const server = new McpServer({
    name: "exponential-mcp",
    version: "0.1.0",
  });

  for (const definition of toolDefinitions) {
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.schema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (input) =>
        invokeExponentialMcpToolWithClient(client, definition.name, input),
    );
  }

  return server;
}

export async function invokeExponentialMcpTool(
  options: ExponentialMcpOptions,
  name: ExponentialMcpToolName,
  input: unknown,
) {
  const client = createMcpClient(options);
  return invokeExponentialMcpToolWithClient(client, name, input);
}

function createMcpClient(options: ExponentialMcpOptions) {
  if (!options.token) {
    throw new Error("EXPONENTIAL_TOKEN is required for Exponential MCP.");
  }
  return createExponentialClient({
    token: options.token,
    baseUrl: options.baseUrl,
    fetch: options.fetch,
  });
}

async function invokeExponentialMcpToolWithClient(
  client: ExponentialClient,
  name: ExponentialMcpToolName,
  input: unknown,
): Promise<CallToolResult> {
  const definition = toolDefinitions.find(
    (candidate) => candidate.name === name,
  );
  if (!definition) {
    return errorResult(400, `Unknown tool: ${name}`);
  }

  const parsed = definition.schema.safeParse(input ?? {});
  if (!parsed.success) {
    return errorResult(400, z.prettifyError(parsed.error));
  }

  const result = await definition.handler(client, parsed.data);
  if (result.error) {
    return errorResult(result.response.status, problemTitle(result.error), {
      error: sanitizeError(result.error),
    });
  }

  return jsonResult({
    status: result.response.status,
    data: result.data ?? null,
  });
}

function jsonResult(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function errorResult(
  status: number,
  message: string,
  extra?: Record<string, unknown>,
): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ status, message, ...extra }, null, 2),
      },
    ],
  };
}

function sanitizeError(error: unknown): unknown {
  if (!error || typeof error !== "object") {
    return error;
  }
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(error)) {
    if (/token|authorization|cookie|secret/i.test(key)) {
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

function problemTitle(error: unknown) {
  if (error && typeof error === "object" && "title" in error) {
    return String(error.title);
  }
  return "Exponential API request failed";
}

function stringField(input: unknown, field: string) {
  if (isRecord(input) && field in input) {
    const value = input[field];
    if (typeof value === "string") {
      return value;
    }
  }
  throw new Error(`${field} must be a string`);
}

function optionalStringField(input: unknown, field: string) {
  if (isRecord(input) && field in input) {
    const value = input[field];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === "object" && !Array.isArray(input);
}

function optionalMyIssuesTab(input: unknown) {
  const value = optionalStringField(input, "tab");
  if (
    value === "assigned" ||
    value === "created" ||
    value === "subscribed" ||
    value === "activity"
  ) {
    return value;
  }
  return undefined;
}
