import { asRecord } from "@/lib/api-settings";
import { readCollaborationSettings } from "@/lib/collaboration-settings";
import { db } from "@/lib/db";
import {
  comment,
  customView,
  issue,
  project,
  projectTeam,
  team,
  teamMember,
  user,
  workflowState,
  workspace,
} from "@/lib/db/schema";
import { activeTeamFilter } from "@/lib/team-lifecycle";
import { and, asc, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const MAX_LIMIT = 50;
const AUDIT_LOG_LIMIT = 100;

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
};

type JsonRpcResponse =
  | {
      jsonrpc: "2.0";
      id: JsonRpcId;
      result: unknown;
    }
  | {
      jsonrpc: "2.0";
      id: JsonRpcId;
      error: {
        code: number;
        message: string;
        data?: unknown;
      };
    };

export type McpContext = {
  workspaceId: string;
  userId: string;
  userName: string;
  userEmail: string;
  apiKeyId: string;
  memberRole: string;
};

export type McpAuditEntry = {
  id: string;
  toolName: string;
  userId: string;
  apiKeyId: string;
  workspaceId: string;
  success: boolean;
  error: string | null;
  createdAt: string;
};

export type McpRepository = {
  searchIssues(args: Record<string, unknown>): Promise<unknown>;
  getIssue(args: Record<string, unknown>): Promise<unknown>;
  listTeams(args: Record<string, unknown>): Promise<unknown>;
  listProjects(args: Record<string, unknown>): Promise<unknown>;
  listViews(args: Record<string, unknown>): Promise<unknown>;
  listComments(args: Record<string, unknown>): Promise<unknown>;
  listCustomers(args: Record<string, unknown>): Promise<unknown>;
  auditToolCall(entry: McpAuditEntry): Promise<void>;
};

const toolDefinitions = [
  {
    name: "exponential_search_issues",
    description:
      "Search visible workspace issues by title or identifier. Private-team issues are only returned when the API key owner can see that team.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text." },
        limit: { type: "number", minimum: 1, maximum: MAX_LIMIT },
      },
      required: ["query"],
    },
  },
  {
    name: "exponential_get_issue",
    description:
      "Get a visible issue by UUID or identifier, including comments and core planning fields.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Issue UUID or identifier." },
      },
      required: ["id"],
    },
  },
  {
    name: "exponential_list_teams",
    description:
      "List teams visible to the API key owner, excluding private teams they cannot access.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", minimum: 1, maximum: MAX_LIMIT },
      },
    },
  },
  {
    name: "exponential_list_projects",
    description:
      "List workspace projects visible through the API key owner's team access.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", minimum: 1, maximum: MAX_LIMIT },
      },
    },
  },
  {
    name: "exponential_list_views",
    description: "List workspace custom views visible to the API key owner.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", minimum: 1, maximum: MAX_LIMIT },
      },
    },
  },
  {
    name: "exponential_list_comments",
    description: "List comments for a visible issue by UUID or identifier.",
    inputSchema: {
      type: "object",
      properties: {
        issueId: { type: "string", description: "Issue UUID or identifier." },
        limit: { type: "number", minimum: 1, maximum: MAX_LIMIT },
      },
      required: ["issueId"],
    },
  },
  {
    name: "exponential_list_customers",
    description:
      "Return customer request settings for the workspace. This app does not yet persist customer account records.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
] as const;

export const mcpToolNames = toolDefinitions.map((tool) => tool.name);

function isAdminRole(role: string) {
  return role === "owner" || role === "admin";
}

function stringArg(args: Record<string, unknown>, key: string) {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function limitArg(args: Record<string, unknown>) {
  const value = args.limit;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 20;
  }

  return Math.min(Math.max(Math.trunc(value), 1), MAX_LIMIT);
}

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function jsonText(value: unknown) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResponse(id: JsonRpcId, code: number, message: string) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  } satisfies JsonRpcResponse;
}

function resultResponse(id: JsonRpcId, result: unknown) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  } satisfies JsonRpcResponse;
}

function requestId(request: unknown): JsonRpcId {
  const record = asRecord(request);
  const id = record.id;
  return typeof id === "string" || typeof id === "number" || id === null
    ? id
    : null;
}

function parseCallParams(params: unknown) {
  const record = asRecord(params);
  const name = typeof record.name === "string" ? record.name : "";
  const args = asRecord(record.arguments);
  return { name, args };
}

async function executeTool(
  context: McpContext,
  repository: McpRepository,
  name: string,
  args: Record<string, unknown>,
) {
  const startedAt = new Date().toISOString();
  let success = false;
  let error: string | null = null;

  try {
    let payload: unknown;
    switch (name) {
      case "exponential_search_issues":
        payload = await repository.searchIssues(args);
        break;
      case "exponential_get_issue":
        payload = await repository.getIssue(args);
        break;
      case "exponential_list_teams":
        payload = await repository.listTeams(args);
        break;
      case "exponential_list_projects":
        payload = await repository.listProjects(args);
        break;
      case "exponential_list_views":
        payload = await repository.listViews(args);
        break;
      case "exponential_list_comments":
        payload = await repository.listComments(args);
        break;
      case "exponential_list_customers":
        payload = await repository.listCustomers(args);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    success = true;
    return jsonText(payload);
  } catch (caught) {
    error =
      caught instanceof Error
        ? caught.message
        : "Tool call failed unexpectedly";
    return {
      content: [{ type: "text", text: error }],
      isError: true,
    };
  } finally {
    await repository
      .auditToolCall({
        id: `mcp_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        toolName: name,
        userId: context.userId,
        apiKeyId: context.apiKeyId,
        workspaceId: context.workspaceId,
        success,
        error,
        createdAt: startedAt,
      })
      .catch(() => undefined);
  }
}

async function handleSingleJsonRpcRequest(
  request: unknown,
  context: McpContext,
  repository: McpRepository,
): Promise<JsonRpcResponse | null> {
  const id = requestId(request);
  const record = asRecord(request) as Partial<JsonRpcRequest>;

  if (record.jsonrpc !== "2.0" || typeof record.method !== "string") {
    return errorResponse(id, -32600, "Invalid JSON-RPC request");
  }

  if (record.id === undefined) {
    return null;
  }

  switch (record.method) {
    case "initialize":
      return resultResponse(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: {
          name: "exponential",
          version: "0.1.0",
        },
      });
    case "tools/list":
      return resultResponse(id, { tools: toolDefinitions });
    case "tools/call": {
      const { name, args } = parseCallParams(record.params);
      if (!name) {
        return errorResponse(id, -32602, "Tool name is required");
      }

      const result = await executeTool(context, repository, name, args);
      return resultResponse(id, result);
    }
    default:
      return errorResponse(id, -32601, `Method not found: ${record.method}`);
  }
}

export async function handleMcpJsonRpc(
  body: unknown,
  context: McpContext,
  repository: McpRepository,
) {
  if (Array.isArray(body)) {
    if (body.length === 0) {
      return errorResponse(null, -32600, "Batch must not be empty");
    }

    const responses = (
      await Promise.all(
        body.map((entry) =>
          handleSingleJsonRpcRequest(entry, context, repository),
        ),
      )
    ).filter((entry): entry is JsonRpcResponse => Boolean(entry));
    return responses.length > 0 ? responses : null;
  }

  return handleSingleJsonRpcRequest(body, context, repository);
}

export function createProductionMcpRepository(
  context: McpContext,
): McpRepository {
  let visibleTeamsPromise: Promise<
    {
      id: string;
      key: string;
      name: string;
      icon: string | null;
      isPrivate: boolean | null;
      issueCount: number | null;
      createdAt: Date;
    }[]
  > | null = null;

  async function visibleTeams() {
    visibleTeamsPromise ??= (async () => {
      const rows = await db
        .select({
          id: team.id,
          key: team.key,
          name: team.name,
          icon: team.icon,
          isPrivate: team.isPrivate,
          issueCount: team.issueCount,
          createdAt: team.createdAt,
        })
        .from(team)
        .where(and(eq(team.workspaceId, context.workspaceId), activeTeamFilter))
        .orderBy(asc(team.name), asc(team.key));

      if (isAdminRole(context.memberRole) || rows.length === 0) {
        return rows;
      }

      const memberships = await db
        .select({ teamId: teamMember.teamId })
        .from(teamMember)
        .where(
          and(
            eq(teamMember.userId, context.userId),
            inArray(
              teamMember.teamId,
              rows.map((row) => row.id),
            ),
          ),
        );
      const membershipIds = new Set(memberships.map((row) => row.teamId));

      return rows.filter((row) => !row.isPrivate || membershipIds.has(row.id));
    })();

    return visibleTeamsPromise;
  }

  async function visibleTeamIds() {
    return (await visibleTeams()).map((row) => row.id);
  }

  async function findVisibleIssue(id: string) {
    const teamIds = await visibleTeamIds();
    if (teamIds.length === 0) return null;

    const rows = await db
      .select({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description,
        priority: issue.priority,
        estimate: issue.estimate,
        dueDate: issue.dueDate,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        teamId: issue.teamId,
        teamKey: team.key,
        teamName: team.name,
        stateId: workflowState.id,
        stateName: workflowState.name,
        stateCategory: workflowState.category,
        assigneeName: user.name,
        assigneeImage: user.image,
        projectId: project.id,
        projectName: project.name,
        projectSlug: project.slug,
      })
      .from(issue)
      .innerJoin(team, eq(issue.teamId, team.id))
      .innerJoin(workflowState, eq(issue.stateId, workflowState.id))
      .leftJoin(user, eq(issue.assigneeId, user.id))
      .leftJoin(project, eq(issue.projectId, project.id))
      .where(
        and(
          inArray(issue.teamId, teamIds),
          isNull(issue.archivedAt),
          or(eq(issue.id, id), eq(issue.identifier, id)),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  return {
    async searchIssues(args) {
      const query = stringArg(args, "query");
      if (!query) {
        throw new Error("query is required");
      }

      const teamIds = await visibleTeamIds();
      if (teamIds.length === 0) return { issues: [] };

      const rows = await db
        .select({
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          priority: issue.priority,
          createdAt: issue.createdAt,
          updatedAt: issue.updatedAt,
          teamKey: team.key,
          teamName: team.name,
          stateName: workflowState.name,
          stateCategory: workflowState.category,
          assigneeName: user.name,
          projectName: project.name,
        })
        .from(issue)
        .innerJoin(team, eq(issue.teamId, team.id))
        .innerJoin(workflowState, eq(issue.stateId, workflowState.id))
        .leftJoin(user, eq(issue.assigneeId, user.id))
        .leftJoin(project, eq(issue.projectId, project.id))
        .where(
          and(
            inArray(issue.teamId, teamIds),
            isNull(issue.archivedAt),
            or(
              ilike(issue.title, `%${query}%`),
              ilike(issue.identifier, `%${query}%`),
            ),
          ),
        )
        .orderBy(desc(issue.updatedAt), desc(issue.createdAt))
        .limit(limitArg(args));

      return {
        issues: rows.map((row) => ({
          ...row,
          createdAt: iso(row.createdAt),
          updatedAt: iso(row.updatedAt),
        })),
      };
    },
    async getIssue(args) {
      const id = stringArg(args, "id");
      if (!id) {
        throw new Error("id is required");
      }

      const row = await findVisibleIssue(id);
      if (!row) {
        throw new Error("Issue not found");
      }

      const comments = await db
        .select({
          id: comment.id,
          body: comment.body,
          userName: user.name,
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt,
        })
        .from(comment)
        .leftJoin(user, eq(comment.userId, user.id))
        .where(eq(comment.issueId, row.id))
        .orderBy(asc(comment.createdAt))
        .limit(MAX_LIMIT);

      return {
        issue: {
          id: row.id,
          identifier: row.identifier,
          title: row.title,
          description: row.description,
          priority: row.priority,
          estimate: row.estimate,
          dueDate: iso(row.dueDate),
          createdAt: iso(row.createdAt),
          updatedAt: iso(row.updatedAt),
          team: { id: row.teamId, key: row.teamKey, name: row.teamName },
          state: {
            id: row.stateId,
            name: row.stateName,
            category: row.stateCategory,
          },
          assignee: row.assigneeName
            ? { name: row.assigneeName, image: row.assigneeImage }
            : null,
          project: row.projectId
            ? {
                id: row.projectId,
                name: row.projectName,
                slug: row.projectSlug,
              }
            : null,
          comments: comments.map((entry) => ({
            ...entry,
            createdAt: iso(entry.createdAt),
            updatedAt: iso(entry.updatedAt),
          })),
        },
      };
    },
    async listTeams(args) {
      const rows = (await visibleTeams()).slice(0, limitArg(args));
      return {
        teams: rows.map((row) => ({
          ...row,
          createdAt: iso(row.createdAt),
        })),
      };
    },
    async listProjects(args) {
      const teamRows = await visibleTeams();
      const visibleIds = new Set(teamRows.map((row) => row.id));
      const rows = await db
        .select({
          id: project.id,
          name: project.name,
          description: project.description,
          slug: project.slug,
          status: project.status,
          priority: project.priority,
          leadName: user.name,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        })
        .from(project)
        .leftJoin(user, eq(project.leadId, user.id))
        .where(eq(project.workspaceId, context.workspaceId))
        .orderBy(desc(project.updatedAt), desc(project.createdAt))
        .limit(MAX_LIMIT);
      const projectIds = rows.map((row) => row.id);
      const projectTeamRows =
        projectIds.length === 0
          ? []
          : await db
              .select({
                projectId: projectTeam.projectId,
                teamId: team.id,
                teamKey: team.key,
                teamName: team.name,
              })
              .from(projectTeam)
              .innerJoin(team, eq(projectTeam.teamId, team.id))
              .where(inArray(projectTeam.projectId, projectIds));
      const teamsByProject = new Map<
        string,
        { id: string; key: string; name: string }[]
      >();
      for (const row of projectTeamRows) {
        if (!visibleIds.has(row.teamId)) continue;
        const entries = teamsByProject.get(row.projectId) ?? [];
        entries.push({ id: row.teamId, key: row.teamKey, name: row.teamName });
        teamsByProject.set(row.projectId, entries);
      }
      const projectIdsWithHiddenOnlyTeams = new Set(
        projectTeamRows
          .filter((row) => !visibleIds.has(row.teamId))
          .map((row) => row.projectId),
      );

      return {
        projects: rows
          .filter(
            (row) =>
              !projectIdsWithHiddenOnlyTeams.has(row.id) ||
              (teamsByProject.get(row.id)?.length ?? 0) > 0,
          )
          .slice(0, limitArg(args))
          .map((row) => ({
            ...row,
            lead: row.leadName ? { name: row.leadName } : null,
            teams: teamsByProject.get(row.id) ?? [],
            createdAt: iso(row.createdAt),
            updatedAt: iso(row.updatedAt),
          })),
      };
    },
    async listViews(args) {
      const visibleIds = new Set(await visibleTeamIds());
      const rows = await db
        .select({
          id: customView.id,
          name: customView.name,
          layout: customView.layout,
          isPersonal: customView.isPersonal,
          filterState: customView.filterState,
          teamId: customView.teamId,
          teamKey: team.key,
          teamName: team.name,
          createdAt: customView.createdAt,
          updatedAt: customView.updatedAt,
        })
        .from(customView)
        .leftJoin(team, eq(customView.teamId, team.id))
        .where(eq(customView.workspaceId, context.workspaceId))
        .orderBy(asc(customView.name), asc(customView.createdAt))
        .limit(MAX_LIMIT);

      return {
        views: rows
          .filter((row) => !row.teamId || visibleIds.has(row.teamId))
          .slice(0, limitArg(args))
          .map((row) => ({
            ...row,
            isPersonal: row.isPersonal ?? true,
            createdAt: iso(row.createdAt),
            updatedAt: iso(row.updatedAt),
          })),
      };
    },
    async listComments(args) {
      const issueId = stringArg(args, "issueId");
      if (!issueId) {
        throw new Error("issueId is required");
      }

      const found = await findVisibleIssue(issueId);
      if (!found) {
        throw new Error("Issue not found");
      }

      const rows = await db
        .select({
          id: comment.id,
          body: comment.body,
          userName: user.name,
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt,
        })
        .from(comment)
        .leftJoin(user, eq(comment.userId, user.id))
        .where(eq(comment.issueId, found.id))
        .orderBy(asc(comment.createdAt))
        .limit(limitArg(args));

      return {
        comments: rows.map((row) => ({
          ...row,
          createdAt: iso(row.createdAt),
          updatedAt: iso(row.updatedAt),
        })),
      };
    },
    async listCustomers() {
      const [row] = await db
        .select({ settings: workspace.settings })
        .from(workspace)
        .where(eq(workspace.id, context.workspaceId))
        .limit(1);
      const collaboration = readCollaborationSettings(row?.settings);

      return {
        customers: [],
        customerRequests: collaboration.customerRequests,
      };
    },
    async auditToolCall(entry) {
      const [row] = await db
        .select({ settings: workspace.settings })
        .from(workspace)
        .where(eq(workspace.id, context.workspaceId))
        .limit(1);
      const settings = asRecord(row?.settings);
      const api = asRecord(settings.api);
      const existingLog = Array.isArray(api.mcpAuditLog)
        ? api.mcpAuditLog.filter(
            (value): value is McpAuditEntry =>
              typeof asRecord(value).id === "string",
          )
        : [];

      await db
        .update(workspace)
        .set({
          settings: {
            ...settings,
            api: {
              ...api,
              mcpAuditLog: [entry, ...existingLog].slice(0, AUDIT_LOG_LIMIT),
            },
          },
          updatedAt: new Date(),
        })
        .where(eq(workspace.id, context.workspaceId));
    },
  };
}
