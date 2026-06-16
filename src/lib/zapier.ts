import { createHmac, randomBytes } from "node:crypto";
import { resolveRequestWorkspaceId } from "@/lib/active-workspace";
import { type ApiSession, requireApiSession } from "@/lib/api-auth";
import { OAUTH_SCOPE_OPTIONS } from "@/lib/api-settings";
import { db } from "@/lib/db";
import {
  comment,
  commentAttachment,
  issue,
  issueHistory,
  member,
  project,
  projectTeam,
  team,
  user,
  webhook,
  workflowState,
} from "@/lib/db/schema";
import { normalizeIssueDescriptionHtml } from "@/lib/issue-description";
import { insertIssueHistoryEvent } from "@/lib/issue-history";
import { buildKey, getUploadUrl } from "@/lib/s3";
import { activeTeamFilter, isTeamRetired } from "@/lib/team-lifecycle";
import { and, desc, eq, gt, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export const ZAPIER_TRIGGER_KEYS = [
  "new_issue",
  "updated_issue",
  "new_comment",
  "new_project",
  "status_change",
] as const;

export const ZAPIER_ACTION_KEYS = [
  "create_issue",
  "update_issue",
  "create_comment",
  "create_attachment",
  "create_project",
] as const;

export type ZapierTriggerKey = (typeof ZAPIER_TRIGGER_KEYS)[number];
export type ZapierActionKey = (typeof ZAPIER_ACTION_KEYS)[number];
type ZapierWebhookEvent = ZapierTriggerKey | "created" | "updated";
type IssuePriority = "none" | "urgent" | "high" | "medium" | "low";
type ProjectStatus =
  | "planned"
  | "started"
  | "paused"
  | "completed"
  | "canceled";

type ZapierContext = {
  user: ApiSession["user"];
  workspaceId: string;
  session: ApiSession;
};

type ZapierAuthResult =
  | { context: ZapierContext; response: null }
  | { context: null; response: NextResponse };

export class ZapierActionError extends Error {
  status: number;
  code: string;
  field?: string;

  constructor(
    message: string,
    options: { status?: number; code?: string; field?: string } = {},
  ) {
    super(message);
    this.name = "ZapierActionError";
    this.status = options.status ?? 400;
    this.code = options.code ?? "invalid_request";
    this.field = options.field;
  }
}

export function zapierSessionHasScope(session: ApiSession, scope: string) {
  if (!("oauthToken" in session)) {
    return true;
  }

  const scopes = session.oauthToken.scopes;
  if (scopes.includes(scope)) {
    return true;
  }

  if (scope.endsWith(":read") && scopes.includes("read")) {
    return true;
  }

  if (scope.endsWith(":write") && scopes.includes("write")) {
    return true;
  }

  return (
    scope === "read" &&
    (scopes.includes("write") || scopes.some((item) => item.endsWith(":read")))
  );
}

function requiredScopeForAction(action: ZapierActionKey) {
  if (action === "create_comment" || action === "create_attachment") {
    return "comments:write";
  }

  if (action === "create_project") {
    return "projects:write";
  }

  return "issues:write";
}

function requiredScopeForTrigger(trigger: ZapierTriggerKey) {
  if (trigger === "new_comment") {
    return "comments:read";
  }

  if (trigger === "new_project") {
    return "projects:read";
  }

  return "issues:read";
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalString(value: unknown) {
  const nextValue = readString(value);
  return nextValue || null;
}

const ZAPIER_ATTACHMENT_UPLOAD_EXPIRES_SECONDS = 3600;
const ZAPIER_MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

function sanitizeAttachmentFilename(value: string) {
  const sanitized = value.replaceAll(/[^a-zA-Z0-9._-]/g, "-").slice(0, 500);
  return /[a-zA-Z0-9]/.test(sanitized) ? sanitized : "";
}

function readAttachmentSize(value: unknown) {
  const size = Number(value);
  if (!Number.isInteger(size) || size <= 0) {
    throw new ZapierActionError("Attachment size is required.", {
      field: "size",
    });
  }

  if (size > ZAPIER_MAX_ATTACHMENT_SIZE) {
    throw new ZapierActionError("Attachment exceeds the 10 MB limit.", {
      code: "attachment_too_large",
      field: "size",
    });
  }

  return size;
}

function readAttachmentContentType(value: unknown) {
  const contentType = readString(value) || "application/octet-stream";
  if (contentType.length > 255) {
    throw new ZapierActionError("Attachment content type is too long.", {
      field: "contentType",
    });
  }

  return contentType;
}

function readLimit(request: Request) {
  const value = Number(new URL(request.url).searchParams.get("limit") ?? 20);
  return Number.isFinite(value) ? Math.max(1, Math.min(100, value)) : 20;
}

function readSince(request: Request) {
  const raw = new URL(request.url).searchParams.get("since");
  if (!raw) {
    return null;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new ZapierActionError("since must be an ISO timestamp.", {
      code: "invalid_cursor",
      field: "since",
    });
  }

  return parsed;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 255)
    .replace(/-+$/g, "");
}

function parsePriority(value: unknown): IssuePriority {
  const priority = readString(value);
  if (!priority) {
    return "none";
  }
  if (
    (["none", "urgent", "high", "medium", "low"] as const).includes(
      priority as IssuePriority,
    )
  ) {
    return priority as IssuePriority;
  }

  throw new ZapierActionError("Priority is invalid.", {
    code: "invalid_priority",
    field: "priority",
  });
}

function parseProjectStatus(value: unknown): ProjectStatus {
  const status = readString(value);
  if (!status) {
    return "planned";
  }
  if (
    (
      ["planned", "started", "paused", "completed", "canceled"] as const
    ).includes(status as ProjectStatus)
  ) {
    return status as ProjectStatus;
  }

  throw new ZapierActionError("Project status is invalid.", {
    code: "invalid_project_status",
    field: "status",
  });
}

function normalizeDate(value: unknown, field: string) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed =
    typeof value === "string"
      ? new Date(`${value.trim().slice(0, 10)}T00:00:00.000Z`)
      : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new ZapierActionError(`${field} is invalid.`, {
      field,
      code: "invalid_date",
    });
  }

  return parsed;
}

function zapierErrorPayload(error: ZapierActionError) {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.field ? { field: error.field } : {}),
    },
  };
}

export function zapierErrorResponse(error: unknown) {
  if (error instanceof ZapierActionError) {
    return NextResponse.json(zapierErrorPayload(error), {
      status: error.status,
    });
  }

  return NextResponse.json(
    {
      error: {
        code: "internal_error",
        message:
          error instanceof Error ? error.message : "Zapier request failed.",
      },
    },
    { status: 500 },
  );
}

export async function getZapierContext(
  request: Request,
  requiredScope?: string,
): Promise<ZapierAuthResult> {
  const { response, session } = await requireApiSession();
  if (response || !session) {
    return { context: null, response };
  }

  if (requiredScope && !zapierSessionHasScope(session, requiredScope)) {
    return {
      context: null,
      response: NextResponse.json(
        {
          error: {
            code: "insufficient_scope",
            message: `Zapier requires the ${requiredScope} scope for this request.`,
          },
        },
        { status: 403 },
      ),
    };
  }

  const workspaceId =
    "apiKey" in session
      ? session.apiKey.workspaceId
      : "oauthToken" in session
        ? session.oauthToken.workspaceId
        : await resolveRequestWorkspaceId(session.user.id, request);
  if (!workspaceId) {
    return {
      context: null,
      response: NextResponse.json(
        {
          error: {
            code: "workspace_not_found",
            message: "No workspace is available for this Zapier request.",
          },
        },
        { status: 404 },
      ),
    };
  }

  return {
    context: { user: session.user, workspaceId, session },
    response: null,
  };
}

export function createZapierWebhookSignature(
  secret: string,
  payload: string,
  timestamp: string,
) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
}

export function getZapierManifest(request: Request) {
  const baseUrl = new URL(request.url).origin;
  return {
    app: {
      name: "Exponential",
      authentication: {
        type: "oauth2_or_api_key",
        oauthAuthorizeUrl: `${baseUrl}/api/oauth/authorize`,
        oauthTokenUrl: `${baseUrl}/api/oauth/token`,
        apiKeyHeader: "Authorization: Bearer <lin_api_...>",
        testUrl: `${baseUrl}/api/zapier/auth/test`,
        scopes: OAUTH_SCOPE_OPTIONS,
      },
    },
    triggers: ZAPIER_TRIGGER_KEYS.map((key) => ({
      key,
      pollingUrl: `${baseUrl}/api/zapier/triggers/${key}`,
      webhookSubscribeUrl: `${baseUrl}/api/zapier/hooks/subscribe`,
      webhookUnsubscribeUrl: `${baseUrl}/api/zapier/hooks/unsubscribe`,
      webhookEvents: zapierWebhookEventsForTrigger(key),
      sample: sampleForTrigger(key),
    })),
    actions: ZAPIER_ACTION_KEYS.map((key) => ({
      key,
      url: `${baseUrl}/api/zapier/actions/${key}`,
    })),
  };
}

export function zapierWebhookEventsForTrigger(
  trigger: ZapierTriggerKey,
): ZapierWebhookEvent[] {
  if (trigger === "new_issue") {
    return ["new_issue", "created"];
  }

  if (trigger === "updated_issue" || trigger === "status_change") {
    return [trigger, "updated"];
  }

  return [trigger];
}

export function sampleForTrigger(trigger: ZapierTriggerKey) {
  const now = "2026-06-09T12:00:00.000Z";
  if (trigger === "new_comment") {
    return {
      id: "comment_123",
      issueId: "issue_123",
      issueIdentifier: "ENG-123",
      body: "Customer asked for an export.",
      authorName: "Avery Nguyen",
      createdAt: now,
    };
  }
  if (trigger === "new_project") {
    return {
      id: "project_123",
      name: "Zapier launch",
      slug: "zapier-launch",
      status: "planned",
      createdAt: now,
    };
  }
  return {
    id: "issue_123",
    identifier: "ENG-123",
    title: "Follow up from Zapier",
    priority: "medium",
    teamKey: "ENG",
    stateName: trigger === "status_change" ? "In Progress" : "Backlog",
    createdAt: now,
    updatedAt: now,
  };
}

async function findTeamForZapier(
  workspaceId: string,
  input: { teamId?: unknown; teamKey?: unknown },
) {
  const teamId = readString(input.teamId);
  const teamKey = readString(input.teamKey);
  if (!teamId && !teamKey) {
    throw new ZapierActionError("teamId or teamKey is required.", {
      field: "teamId",
    });
  }

  const rows = await db
    .select({
      id: team.id,
      key: team.key,
      name: team.name,
      settings: team.settings,
      retiredAt: team.retiredAt,
      deletedAt: team.deletedAt,
    })
    .from(team)
    .where(
      and(
        eq(team.workspaceId, workspaceId),
        activeTeamFilter,
        teamId ? eq(team.id, teamId) : eq(team.key, teamKey),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new ZapierActionError("Team was not found in this workspace.", {
      status: 404,
      code: "team_not_found",
      field: teamId ? "teamId" : "teamKey",
    });
  }
  if (isTeamRetired(rows[0])) {
    throw new ZapierActionError("Retired teams cannot accept Zapier actions.", {
      status: 409,
      code: "team_retired",
      field: teamId ? "teamId" : "teamKey",
    });
  }

  return rows[0];
}

async function findIssueForZapier(workspaceId: string, id: unknown) {
  const issueId = readString(id);
  if (!issueId) {
    throw new ZapierActionError("issueId is required.", { field: "issueId" });
  }

  const rows = await db
    .select({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      priority: issue.priority,
      stateId: issue.stateId,
      teamId: issue.teamId,
      teamKey: team.key,
      teamSettings: team.settings,
      creatorId: issue.creatorId,
      assigneeId: issue.assigneeId,
      projectId: issue.projectId,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    })
    .from(issue)
    .innerJoin(team, eq(issue.teamId, team.id))
    .where(
      and(
        eq(team.workspaceId, workspaceId),
        or(eq(issue.id, issueId), eq(issue.identifier, issueId)),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new ZapierActionError("Issue was not found in this workspace.", {
      status: 404,
      code: "issue_not_found",
      field: "issueId",
    });
  }

  return rows[0];
}

async function defaultWorkflowStateId(
  teamId: string,
  providedStateId: unknown,
) {
  const requestedStateId = readString(providedStateId);
  if (requestedStateId) {
    const rows = await db
      .select({ id: workflowState.id })
      .from(workflowState)
      .where(
        and(
          eq(workflowState.id, requestedStateId),
          eq(workflowState.teamId, teamId),
        ),
      )
      .limit(1);
    if (!rows[0]) {
      throw new ZapierActionError(
        "Workflow state was not found for the team.",
        {
          code: "state_not_found",
          field: "stateId",
        },
      );
    }

    return rows[0].id;
  }

  const states = await db
    .select({
      id: workflowState.id,
      isDefault: workflowState.isDefault,
      position: workflowState.position,
    })
    .from(workflowState)
    .where(
      and(
        eq(workflowState.teamId, teamId),
        eq(workflowState.category, "backlog"),
      ),
    )
    .limit(1000);
  const selected = states.sort(
    (a, b) =>
      Number(b.isDefault === true) - Number(a.isDefault === true) ||
      Number(a.position) - Number(b.position),
  )[0];
  if (!selected) {
    throw new ZapierActionError(
      "No default backlog state exists for the team.",
      {
        code: "state_not_found",
        field: "stateId",
      },
    );
  }

  return selected.id;
}

async function validateZapierAssignee(workspaceId: string, id: unknown) {
  const assigneeId = readOptionalString(id);
  if (!assigneeId) {
    return null;
  }

  const rows = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(eq(member.workspaceId, workspaceId), eq(member.userId, assigneeId)),
    )
    .limit(1);
  if (!rows[0]) {
    throw new ZapierActionError("Assignee is not a workspace member.", {
      code: "assignee_not_found",
      field: "assigneeId",
    });
  }

  return assigneeId;
}

async function validateZapierProject(workspaceId: string, id: unknown) {
  const projectId = readOptionalString(id);
  if (!projectId) {
    return null;
  }

  const rows = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.workspaceId, workspaceId)))
    .limit(1);
  if (!rows[0]) {
    throw new ZapierActionError("Project was not found in this workspace.", {
      code: "project_not_found",
      field: "projectId",
    });
  }

  return projectId;
}

function issuePayload(row: {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  priority: string;
  teamKey?: string | null;
  stateName?: string | null;
  stateId?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}) {
  return {
    id: row.id,
    identifier: row.identifier,
    title: row.title,
    description: row.description ?? null,
    priority: row.priority,
    teamKey: row.teamKey ?? null,
    stateId: row.stateId ?? null,
    stateName: row.stateName ?? null,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : row.createdAt,
    updatedAt:
      row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : row.updatedAt,
  };
}

export async function runZapierAction(
  action: ZapierActionKey,
  context: ZapierContext,
  body: Record<string, unknown>,
) {
  if (!zapierSessionHasScope(context.session, requiredScopeForAction(action))) {
    throw new ZapierActionError(
      `Zapier requires the ${requiredScopeForAction(action)} scope for ${action}.`,
      { status: 403, code: "insufficient_scope" },
    );
  }

  if (action === "create_issue") {
    const title = readString(body.title);
    if (!title) {
      throw new ZapierActionError("Title is required.", { field: "title" });
    }

    const teamRecord = await findTeamForZapier(context.workspaceId, body);
    const stateId = await defaultWorkflowStateId(teamRecord.id, body.stateId);
    const maxResult = await db
      .select({ maxNum: sql<number>`COALESCE(MAX(${issue.number}), 0)` })
      .from(issue)
      .where(eq(issue.teamId, teamRecord.id));
    const nextNumber = (maxResult[0]?.maxNum ?? 0) + 1;
    const identifier = `${teamRecord.key}-${nextNumber}`;
    const [created] = await db
      .insert(issue)
      .values({
        number: nextNumber,
        identifier,
        title,
        description: normalizeIssueDescriptionHtml(
          readOptionalString(body.description),
        ),
        teamId: teamRecord.id,
        stateId,
        creatorId: context.user.id,
        priority: parsePriority(body.priority),
        assigneeId: await validateZapierAssignee(
          context.workspaceId,
          body.assigneeId,
        ),
        projectId: await validateZapierProject(
          context.workspaceId,
          body.projectId,
        ),
        dueDate: normalizeDate(body.dueDate, "dueDate"),
      })
      .returning();

    await insertIssueHistoryEvent(
      db,
      { settings: teamRecord.settings },
      {
        issueId: created.id,
        actorId: context.user.id,
        actorName: context.user.name ?? null,
        actorEmail: context.user.email ?? null,
        eventType: "created",
        metadata: { identifier, source: "zapier" },
      },
    );

    return issuePayload({ ...created, teamKey: teamRecord.key, stateId });
  }

  if (action === "update_issue") {
    const existingIssue = await findIssueForZapier(
      context.workspaceId,
      body.issueId,
    );
    const updateData: Partial<typeof issue.$inferInsert> = {
      updatedAt: new Date(),
    };
    const changedFields: string[] = [];

    if (body.title !== undefined) {
      const title = readString(body.title);
      if (!title) {
        throw new ZapierActionError("Title cannot be empty.", {
          field: "title",
        });
      }
      updateData.title = title;
      if (title !== existingIssue.title) {
        changedFields.push("title");
      }
    }
    if (body.description !== undefined) {
      const description = normalizeIssueDescriptionHtml(
        readOptionalString(body.description),
      );
      updateData.description = description;
      if (description !== existingIssue.description) {
        changedFields.push("description");
      }
    }
    if (body.priority !== undefined) {
      const priority = parsePriority(body.priority);
      updateData.priority = priority;
      if (priority !== existingIssue.priority) {
        changedFields.push("priority");
      }
    }
    if (body.stateId !== undefined) {
      const stateId = await defaultWorkflowStateId(
        existingIssue.teamId,
        body.stateId,
      );
      updateData.stateId = stateId;
      if (stateId !== existingIssue.stateId) {
        changedFields.push("stateId");
      }
    }
    if (body.assigneeId !== undefined) {
      const assigneeId = await validateZapierAssignee(
        context.workspaceId,
        body.assigneeId,
      );
      updateData.assigneeId = assigneeId;
      if (assigneeId !== existingIssue.assigneeId) {
        changedFields.push("assigneeId");
      }
    }
    if (body.projectId !== undefined) {
      const projectId = await validateZapierProject(
        context.workspaceId,
        body.projectId,
      );
      updateData.projectId = projectId;
      if (projectId !== existingIssue.projectId) {
        changedFields.push("projectId");
      }
    }
    if (body.dueDate !== undefined) {
      updateData.dueDate = normalizeDate(body.dueDate, "dueDate");
      changedFields.push("dueDate");
    }

    if (changedFields.length === 0) {
      throw new ZapierActionError(
        "At least one issue field must be provided.",
        {
          code: "empty_update",
        },
      );
    }

    const [updated] = await db
      .update(issue)
      .set(updateData)
      .where(eq(issue.id, existingIssue.id))
      .returning();

    await insertIssueHistoryEvent(
      db,
      { settings: existingIssue.teamSettings },
      {
        issueId: existingIssue.id,
        actorId: context.user.id,
        actorName: context.user.name ?? null,
        actorEmail: context.user.email ?? null,
        eventType: "updated",
        metadata: {
          changedFields,
          identifier: existingIssue.identifier,
          source: "zapier",
        },
      },
    );

    return issuePayload({ ...updated, teamKey: existingIssue.teamKey });
  }

  if (action === "create_comment") {
    const existingIssue = await findIssueForZapier(
      context.workspaceId,
      body.issueId,
    );
    const bodyText = readString(body.body);
    if (!bodyText) {
      throw new ZapierActionError("Comment body is required.", {
        field: "body",
      });
    }

    const [created] = await db
      .insert(comment)
      .values({
        issueId: existingIssue.id,
        userId: context.user.id,
        body: bodyText,
      })
      .returning({
        id: comment.id,
        body: comment.body,
        createdAt: comment.createdAt,
      });

    await insertIssueHistoryEvent(
      db,
      { settings: existingIssue.teamSettings },
      {
        issueId: existingIssue.id,
        actorId: context.user.id,
        actorName: context.user.name ?? null,
        actorEmail: context.user.email ?? null,
        eventType: "comment_created",
        metadata: { commentId: created.id, source: "zapier" },
      },
    );

    return {
      id: created.id,
      issueId: existingIssue.id,
      issueIdentifier: existingIssue.identifier,
      body: created.body,
      createdAt: created.createdAt.toISOString(),
    };
  }

  if (action === "create_attachment") {
    const existingIssue = await findIssueForZapier(
      context.workspaceId,
      body.issueId,
    );
    const fileName =
      readString(body.fileName) ||
      readString(body.filename) ||
      readString(body.name);

    if (!fileName) {
      const bodyText = buildAttachmentCommentBody(body);
      if (!bodyText) {
        throw new ZapierActionError("Attachment file name is required.", {
          field: "fileName",
        });
      }

      const [created] = await db
        .insert(comment)
        .values({
          issueId: existingIssue.id,
          userId: context.user.id,
          body: bodyText,
        })
        .returning({
          id: comment.id,
          body: comment.body,
          createdAt: comment.createdAt,
        });

      await insertIssueHistoryEvent(
        db,
        { settings: existingIssue.teamSettings },
        {
          issueId: existingIssue.id,
          actorId: context.user.id,
          actorName: context.user.name ?? null,
          actorEmail: context.user.email ?? null,
          eventType: "comment_created",
          metadata: { commentId: created.id, source: "zapier" },
        },
      );

      return {
        id: created.id,
        issueId: existingIssue.id,
        issueIdentifier: existingIssue.identifier,
        body: created.body,
        createdAt: created.createdAt.toISOString(),
        attachmentType: "link",
      };
    }

    const sanitizedFileName = sanitizeAttachmentFilename(fileName);
    if (!sanitizedFileName) {
      throw new ZapierActionError(
        "Attachment file name must include letters or numbers.",
        { field: "fileName" },
      );
    }

    const contentType = readAttachmentContentType(body.contentType);
    const size = readAttachmentSize(body.size);
    const storageKey = buildKey(
      "attachment",
      context.workspaceId,
      sanitizedFileName,
    );
    const uploadUrl = await getUploadUrl(
      storageKey,
      contentType,
      ZAPIER_ATTACHMENT_UPLOAD_EXPIRES_SECONDS,
    );
    const commentId = crypto.randomUUID();
    const attachmentId = crypto.randomUUID();
    const commentBody =
      readOptionalString(body.body) ??
      readOptionalString(body.note) ??
      `Zapier attachment: ${fileName}`;

    await db.transaction(async (tx) => {
      await tx.insert(comment).values({
        id: commentId,
        issueId: existingIssue.id,
        userId: context.user.id,
        body: commentBody,
      });
      await tx.insert(commentAttachment).values({
        id: attachmentId,
        commentId,
        fileName,
        storageKey,
        contentType,
        size,
      });
      await insertIssueHistoryEvent(
        tx,
        { settings: existingIssue.teamSettings },
        {
          issueId: existingIssue.id,
          actorId: context.user.id,
          actorName: context.user.name ?? null,
          actorEmail: context.user.email ?? null,
          eventType: "comment_created",
          metadata: {
            commentId,
            attachmentId,
            attachmentCount: 1,
            source: "zapier",
          },
        },
      );
    });

    return {
      id: attachmentId,
      commentId,
      issueId: existingIssue.id,
      issueIdentifier: existingIssue.identifier,
      fileName,
      contentType,
      size,
      uploadUrl,
      uploadMethod: "PUT",
      uploadHeaders: { "Content-Type": contentType },
      uploadExpiresInSeconds: ZAPIER_ATTACHMENT_UPLOAD_EXPIRES_SECONDS,
    };
  }

  const name = readString(body.name);
  if (!name) {
    throw new ZapierActionError("Project name is required.", { field: "name" });
  }

  const slugBase = slugify(readString(body.slug) || name);
  if (!slugBase) {
    throw new ZapierActionError(
      "Project name must include letters or numbers.",
      {
        field: "name",
      },
    );
  }
  const takenSlugs = new Set(
    (
      await db
        .select({ slug: project.slug })
        .from(project)
        .where(eq(project.workspaceId, context.workspaceId))
    ).map((row) => row.slug),
  );
  let slug = slugBase;
  let suffix = 2;
  while (takenSlugs.has(slug)) {
    slug = `${slugBase}-${suffix}`;
    suffix += 1;
  }

  const [created] = await db
    .insert(project)
    .values({
      name,
      slug,
      description: readOptionalString(body.description),
      workspaceId: context.workspaceId,
      leadId: context.user.id,
      status: parseProjectStatus(body.status),
    })
    .returning();

  const teamRecord =
    readString(body.teamId) || readString(body.teamKey)
      ? await findTeamForZapier(context.workspaceId, body)
      : null;
  if (teamRecord) {
    await db.insert(projectTeam).values({
      projectId: created.id,
      teamId: teamRecord.id,
    });
  }

  return {
    id: created.id,
    name: created.name,
    slug: created.slug,
    description: created.description,
    status: created.status,
    createdAt: created.createdAt.toISOString(),
  };
}

function buildAttachmentCommentBody(body: Record<string, unknown>) {
  const url = readString(body.url);
  if (!url) {
    return "";
  }
  try {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol)) {
      return "";
    }
  } catch {
    return "";
  }

  const title = readString(body.title) || "Zapier attachment";
  const note = readOptionalString(body.note);
  return [title, url, note].filter(Boolean).join("\n");
}

export async function pollZapierTrigger(
  trigger: ZapierTriggerKey,
  context: ZapierContext,
  request: Request,
) {
  const requiredScope = requiredScopeForTrigger(trigger);
  if (!zapierSessionHasScope(context.session, requiredScope)) {
    throw new ZapierActionError(`Zapier requires the ${requiredScope} scope.`, {
      status: 403,
      code: "insufficient_scope",
    });
  }

  const limit = readLimit(request);
  const since = readSince(request);

  if (trigger === "new_project") {
    const rows = await db
      .select({
        id: project.id,
        name: project.name,
        slug: project.slug,
        description: project.description,
        status: project.status,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      })
      .from(project)
      .where(
        since
          ? and(
              eq(project.workspaceId, context.workspaceId),
              gt(project.createdAt, since),
            )
          : eq(project.workspaceId, context.workspaceId),
      )
      .orderBy(desc(project.createdAt))
      .limit(limit);

    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  if (trigger === "new_comment") {
    const rows = await db
      .select({
        id: comment.id,
        issueId: issue.id,
        issueIdentifier: issue.identifier,
        body: comment.body,
        authorName: user.name,
        createdAt: comment.createdAt,
      })
      .from(comment)
      .innerJoin(issue, eq(comment.issueId, issue.id))
      .innerJoin(team, eq(issue.teamId, team.id))
      .innerJoin(user, eq(comment.userId, user.id))
      .where(
        since
          ? and(
              eq(team.workspaceId, context.workspaceId),
              gt(comment.createdAt, since),
            )
          : eq(team.workspaceId, context.workspaceId),
      )
      .orderBy(desc(comment.createdAt))
      .limit(limit);

    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  if (trigger === "status_change") {
    const rows = await db
      .select({
        id: issueHistory.id,
        issueId: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        metadata: issueHistory.metadata,
        createdAt: issueHistory.createdAt,
      })
      .from(issueHistory)
      .innerJoin(issue, eq(issueHistory.issueId, issue.id))
      .innerJoin(team, eq(issue.teamId, team.id))
      .where(
        since
          ? and(
              eq(team.workspaceId, context.workspaceId),
              eq(issueHistory.eventType, "updated"),
              gt(issueHistory.createdAt, since),
            )
          : and(
              eq(team.workspaceId, context.workspaceId),
              eq(issueHistory.eventType, "updated"),
            ),
      )
      .orderBy(desc(issueHistory.createdAt))
      .limit(limit * 3);

    return rows
      .filter((row) => {
        const metadata = row.metadata as Record<string, unknown>;
        return (
          Array.isArray(metadata.changedFields) &&
          metadata.changedFields.includes("stateId")
        );
      })
      .slice(0, limit)
      .map((row) => ({
        id: row.id,
        issueId: row.issueId,
        identifier: row.identifier,
        title: row.title,
        changedAt: row.createdAt.toISOString(),
      }));
  }

  const timestampColumn =
    trigger === "new_issue" ? issue.createdAt : issue.updatedAt;
  const rows = await db
    .select({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      priority: issue.priority,
      teamKey: team.key,
      stateId: workflowState.id,
      stateName: workflowState.name,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    })
    .from(issue)
    .innerJoin(team, eq(issue.teamId, team.id))
    .innerJoin(workflowState, eq(issue.stateId, workflowState.id))
    .where(
      since
        ? and(
            eq(team.workspaceId, context.workspaceId),
            gt(timestampColumn, since),
          )
        : eq(team.workspaceId, context.workspaceId),
    )
    .orderBy(desc(timestampColumn))
    .limit(limit);

  return rows.map(issuePayload);
}

export async function subscribeZapierHook(
  context: ZapierContext,
  body: Record<string, unknown>,
) {
  if (!zapierSessionHasScope(context.session, "webhooks:write")) {
    throw new ZapierActionError("Zapier requires the webhooks:write scope.", {
      status: 403,
      code: "insufficient_scope",
    });
  }

  const targetUrl = readString(body.targetUrl);
  const trigger = readString(body.trigger);
  if (!ZAPIER_TRIGGER_KEYS.includes(trigger as ZapierTriggerKey)) {
    throw new ZapierActionError("A supported Zapier trigger is required.", {
      field: "trigger",
    });
  }
  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    throw new ZapierActionError("targetUrl must be a valid URL.", {
      field: "targetUrl",
    });
  }
  if (url.protocol !== "https:") {
    throw new ZapierActionError("targetUrl must use HTTPS.", {
      field: "targetUrl",
    });
  }

  const secret = `zapwhsec_${randomBytes(24).toString("hex")}`;
  const [created] = await db
    .insert(webhook)
    .values({
      url: url.toString(),
      label: readOptionalString(body.label) ?? `Zapier ${trigger}`,
      workspaceId: context.workspaceId,
      secret,
      enabled: true,
      events: zapierWebhookEventsForTrigger(trigger as ZapierTriggerKey),
    })
    .returning({
      id: webhook.id,
      url: webhook.url,
      label: webhook.label,
      events: webhook.events,
      createdAt: webhook.createdAt,
    });

  const timestamp = new Date().toISOString();
  const samplePayload = JSON.stringify(
    sampleForTrigger(trigger as ZapierTriggerKey),
  );
  return {
    id: created.id,
    targetUrl: created.url,
    trigger,
    events: created.events,
    secret,
    signatureHeaders: {
      "x-exponential-webhook-timestamp": timestamp,
      "x-exponential-webhook-signature": createZapierWebhookSignature(
        secret,
        samplePayload,
        timestamp,
      ),
    },
    samplePayload: JSON.parse(samplePayload) as unknown,
  };
}

export async function unsubscribeZapierHook(
  context: ZapierContext,
  body: Record<string, unknown>,
) {
  if (!zapierSessionHasScope(context.session, "webhooks:write")) {
    throw new ZapierActionError("Zapier requires the webhooks:write scope.", {
      status: 403,
      code: "insufficient_scope",
    });
  }

  const id =
    readString(body.id) ||
    readString(body.hookId) ||
    readString(body.subscriptionId);
  if (!id) {
    throw new ZapierActionError("Webhook subscription id is required.", {
      field: "id",
    });
  }

  const [deleted] = await db
    .delete(webhook)
    .where(
      and(eq(webhook.id, id), eq(webhook.workspaceId, context.workspaceId)),
    )
    .returning({ id: webhook.id });

  if (!deleted) {
    throw new ZapierActionError(
      "Webhook subscription was not found in this workspace.",
      {
        status: 404,
        code: "webhook_not_found",
        field: "id",
      },
    );
  }

  return { id: deleted.id, unsubscribed: true };
}
