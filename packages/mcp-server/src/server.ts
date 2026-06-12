import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createExponentialClient } from "@namuh-eng/expn-sdk";
import type { ExponentialClient } from "@namuh-eng/expn-sdk";
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

const issuePrioritySchema = z
  .enum(["none", "urgent", "high", "medium", "low"])
  .optional();

const createIssueInputSchema = z
  .object({
    title: z.string().min(1).max(500),
    team_id: z.string().min(1),
    description: z.string().nullable().optional(),
    state_id: z.string().nullable().optional(),
    priority: issuePrioritySchema,
    assignee_id: z.string().nullable().optional(),
    project_id: z.string().nullable().optional(),
    project_milestone_id: z.string().nullable().optional(),
    cycle_id: z.string().nullable().optional(),
    parent_issue_id: z.string().nullable().optional(),
    estimate: z.number().nullable().optional(),
    due_date: z.string().nullable().optional(),
  })
  .strict();

const updateIssueInputSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1).max(500).optional(),
    description: z.string().nullable().optional(),
    state_id: z.string().optional(),
    priority: issuePrioritySchema,
    assignee_id: z.string().nullable().optional(),
    project_id: z.string().nullable().optional(),
    project_milestone_id: z.string().nullable().optional(),
    cycle_id: z.string().nullable().optional(),
    parent_issue_id: z.string().nullable().optional(),
    estimate: z.number().nullable().optional(),
    due_date: z.string().nullable().optional(),
    archive: z.boolean().optional(),
  })
  .strict();

const addCommentInputSchema = z
  .object({
    issueId: z.string().min(1),
    body: z.string().min(1),
  })
  .strict();

const triageIssueInputSchema = z
  .object({
    teamKey: z.string().min(1),
    issueId: z.string().min(1),
    action: z.enum(["accept", "decline"]),
    destinationStateId: z.string().optional(),
    reason: z.string().nullable().optional(),
    priority: z
      .enum(["none", "urgent", "high", "medium", "low"])
      .nullable()
      .optional(),
    assigneeId: z.string().nullable().optional(),
    comment: z.string().nullable().optional(),
  })
  .strict();

export const EXPONENTIAL_MCP_TOOL_NAMES = [
  "search_issues",
  "get_issue",
  "list_my_issues",
  "list_projects",
  "get_project",
  "list_team_cycles",
  "create_issue",
  "update_issue",
  "add_comment",
  "triage_issue",
] as const;

export type ExponentialMcpToolName =
  (typeof EXPONENTIAL_MCP_TOOL_NAMES)[number];

export type ExponentialMcpOptions = {
  token: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

type ToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

type ToolDefinition = {
  name: ExponentialMcpToolName;
  title: string;
  description: string;
  schema: z.ZodType;
  annotations: ToolAnnotations;
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

const READ_ONLY_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const WRITE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const toolDefinitions: ToolDefinition[] = [
  {
    name: "search_issues",
    title: "Search issues",
    description:
      "Read-only search across Exponential issues in the authenticated workspace.",
    schema: searchIssuesInputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
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
    annotations: READ_ONLY_ANNOTATIONS,
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
    annotations: READ_ONLY_ANNOTATIONS,
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
    annotations: READ_ONLY_ANNOTATIONS,
    handler: (client) => client.GET("/projects"),
  },
  {
    name: "get_project",
    title: "Get project",
    description: "Read-only fetch for a single Exponential project by slug.",
    schema: getProjectInputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
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
    annotations: READ_ONLY_ANNOTATIONS,
    handler: (client, input) =>
      client.GET("/teams/{key}/cycles", {
        params: { path: { key: stringField(input, "teamKey") } },
      }),
  },
  {
    name: "create_issue",
    title: "Create issue",
    description:
      "Create a new Exponential issue in the specified team. Requires a team_id and title. Optional fields: description, state_id, priority (none/urgent/high/medium/low), assignee_id, project_id, cycle_id, estimate, due_date. Gated by the PAT's workspace authorization.",
    schema: createIssueInputSchema,
    annotations: WRITE_ANNOTATIONS,
    handler: (client, input) =>
      client.POST("/issues", {
        body: {
          title: stringField(input, "title"),
          team_id: stringField(input, "team_id"),
          description: optionalNullableStringField(input, "description"),
          state_id: optionalNullableStringField(input, "state_id"),
          priority: optionalIssuePriority(input),
          assignee_id: optionalNullableStringField(input, "assignee_id"),
          project_id: optionalNullableStringField(input, "project_id"),
          project_milestone_id: optionalNullableStringField(
            input,
            "project_milestone_id",
          ),
          cycle_id: optionalNullableStringField(input, "cycle_id"),
          parent_issue_id: optionalNullableStringField(
            input,
            "parent_issue_id",
          ),
          estimate: optionalNullableNumberField(input, "estimate"),
          due_date: optionalNullableStringField(input, "due_date"),
        },
      }),
  },
  {
    name: "update_issue",
    title: "Update issue",
    description:
      "Update an existing Exponential issue by id or identifier. Provide only the fields you want to change: title, description, state_id (workflow state UUID), priority (none/urgent/high/medium/low), assignee_id, project_id, cycle_id, estimate, due_date, archive. Gated by the PAT's workspace authorization.",
    schema: updateIssueInputSchema,
    annotations: WRITE_ANNOTATIONS,
    handler: (client, input) =>
      client.PATCH("/issues/{id}", {
        params: { path: { id: stringField(input, "id") } },
        body: {
          title: optionalStringField(input, "title"),
          description: optionalNullableStringField(input, "description"),
          state_id: optionalStringField(input, "state_id"),
          priority: optionalIssuePriority(input),
          assignee_id: optionalNullableStringField(input, "assignee_id"),
          project_id: optionalNullableStringField(input, "project_id"),
          project_milestone_id: optionalNullableStringField(
            input,
            "project_milestone_id",
          ),
          cycle_id: optionalNullableStringField(input, "cycle_id"),
          parent_issue_id: optionalNullableStringField(
            input,
            "parent_issue_id",
          ),
          estimate: optionalNullableNumberField(input, "estimate"),
          due_date: optionalNullableStringField(input, "due_date"),
          archive: optionalBooleanField(input, "archive"),
        },
      }),
  },
  {
    name: "add_comment",
    title: "Add comment",
    description:
      "Add a plain-text comment to an Exponential issue. Provide issueId (issue id or identifier) and body (comment text). Gated by the PAT's workspace authorization.",
    schema: addCommentInputSchema,
    annotations: WRITE_ANNOTATIONS,
    handler: (client, input) =>
      client.POST("/issues/{id}/comments", {
        params: { path: { id: stringField(input, "issueId") } },
        body: { body: stringField(input, "body") },
      }),
  },
  {
    name: "triage_issue",
    title: "Triage issue",
    description:
      "Accept or decline a single issue in a team's triage queue. Provide teamKey (e.g. ENG), issueId (UUID), and action (accept or decline). When accepting, supply destinationStateId (workflow state UUID) to move the issue out of triage. Optional: priority, assigneeId, reason, comment. Gated by the PAT's workspace authorization.",
    schema: triageIssueInputSchema,
    annotations: WRITE_ANNOTATIONS,
    handler: (client, input) =>
      client.PATCH("/teams/{key}/triage/{issueID}", {
        params: {
          path: {
            key: stringField(input, "teamKey"),
            issueID: stringField(input, "issueId"),
          },
        },
        body: {
          action: stringField(input, "action") as "accept" | "decline",
          destinationStateId: optionalStringField(
            input,
            "destinationStateId",
          ),
          reason: optionalNullableStringField(input, "reason"),
          priority: optionalNullableIssuePriority(input),
          assigneeId: optionalNullableStringField(input, "assigneeId"),
          comment: optionalNullableStringField(input, "comment"),
        },
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
        annotations: definition.annotations,
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

function optionalNullableStringField(
  input: unknown,
  field: string,
): string | null | undefined {
  if (!isRecord(input) || !(field in input)) {
    return undefined;
  }
  const value = input[field];
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function optionalNullableNumberField(
  input: unknown,
  field: string,
): number | null | undefined {
  if (!isRecord(input) || !(field in input)) {
    return undefined;
  }
  const value = input[field];
  if (value === null) return null;
  return typeof value === "number" ? value : undefined;
}

function optionalBooleanField(
  input: unknown,
  field: string,
): boolean | undefined {
  if (!isRecord(input) || !(field in input)) {
    return undefined;
  }
  const value = input[field];
  return typeof value === "boolean" ? value : undefined;
}

function optionalIssuePriority(
  input: unknown,
): "none" | "urgent" | "high" | "medium" | "low" | undefined {
  const value = optionalStringField(input, "priority");
  if (
    value === "none" ||
    value === "urgent" ||
    value === "high" ||
    value === "medium" ||
    value === "low"
  ) {
    return value;
  }
  return undefined;
}

function optionalNullableIssuePriority(
  input: unknown,
): "none" | "urgent" | "high" | "medium" | "low" | null | undefined {
  if (!isRecord(input) || !("priority" in input)) {
    return undefined;
  }
  if (input["priority"] === null) {
    return null;
  }
  return optionalIssuePriority(input);
}
