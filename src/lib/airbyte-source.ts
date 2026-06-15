import { createApiKeyHash } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  apiKey,
  comment,
  cycle,
  initiative,
  issue,
  member,
  project,
  team,
  user,
  workspace,
} from "@/lib/db/schema";
import {
  evaluateWorkspaceIpAccess,
  workspaceIpRestrictionError,
} from "@/lib/workspace-ip-restrictions";
import { and, asc, eq, gt } from "drizzle-orm";
import { NextResponse } from "next/server";

export const AIRBYTE_TOKEN_PREFIX = "lin_airbyte_";

const AIRBYTE_STREAMS = [
  "issues",
  "projects",
  "comments",
  "cycles",
  "initiatives",
] as const;

export type AirbyteStreamName = (typeof AIRBYTE_STREAMS)[number];

type JsonSchema = {
  type: "object";
  properties: Record<string, { type: string | string[]; format?: string }>;
};

type StreamCatalogEntry = {
  name: AirbyteStreamName;
  cursorField: "updatedAt";
  primaryKey: "id";
  supportedSyncModes: ["full_refresh", "incremental"];
  scopes: string[];
  schema: JsonSchema;
};

export type AirbyteAuth = {
  workspaceId: string;
  workspaceSlug: string;
  tokenId: string;
};

function nullable(type: string, format?: string) {
  return format ? { type: [type, "null"], format } : { type: [type, "null"] };
}

function stringField(format?: string) {
  return format ? { type: "string", format } : { type: "string" };
}

const dateTime = stringField("date-time");

export const AIRBYTE_CATALOG: StreamCatalogEntry[] = [
  {
    name: "issues",
    cursorField: "updatedAt",
    primaryKey: "id",
    supportedSyncModes: ["full_refresh", "incremental"],
    scopes: ["issues:read"],
    schema: {
      type: "object",
      properties: {
        id: stringField(),
        identifier: stringField(),
        number: { type: "number" },
        title: stringField(),
        description: nullable("string"),
        teamId: stringField(),
        stateId: stringField(),
        assigneeId: nullable("string"),
        creatorId: stringField(),
        priority: stringField(),
        projectId: nullable("string"),
        cycleId: nullable("string"),
        createdAt: dateTime,
        updatedAt: dateTime,
        archivedAt: nullable("string", "date-time"),
        completedAt: nullable("string", "date-time"),
        canceledAt: nullable("string", "date-time"),
      },
    },
  },
  {
    name: "projects",
    cursorField: "updatedAt",
    primaryKey: "id",
    supportedSyncModes: ["full_refresh", "incremental"],
    scopes: ["projects:read"],
    schema: {
      type: "object",
      properties: {
        id: stringField(),
        name: stringField(),
        description: nullable("string"),
        slug: stringField(),
        status: stringField(),
        priority: stringField(),
        leadId: nullable("string"),
        workspaceId: stringField(),
        startDate: nullable("string", "date-time"),
        targetDate: nullable("string", "date-time"),
        completedAt: nullable("string", "date-time"),
        canceledAt: nullable("string", "date-time"),
        createdAt: dateTime,
        updatedAt: dateTime,
      },
    },
  },
  {
    name: "comments",
    cursorField: "updatedAt",
    primaryKey: "id",
    supportedSyncModes: ["full_refresh", "incremental"],
    scopes: ["comments:read"],
    schema: {
      type: "object",
      properties: {
        id: stringField(),
        body: stringField(),
        issueId: stringField(),
        userId: stringField(),
        createdAt: dateTime,
        updatedAt: dateTime,
      },
    },
  },
  {
    name: "cycles",
    cursorField: "updatedAt",
    primaryKey: "id",
    supportedSyncModes: ["full_refresh", "incremental"],
    scopes: ["cycles:read"],
    schema: {
      type: "object",
      properties: {
        id: stringField(),
        name: nullable("string"),
        number: { type: "number" },
        teamId: stringField(),
        startDate: dateTime,
        endDate: dateTime,
        autoRollover: { type: ["boolean", "null"] },
        createdAt: dateTime,
        updatedAt: dateTime,
      },
    },
  },
  {
    name: "initiatives",
    cursorField: "updatedAt",
    primaryKey: "id",
    supportedSyncModes: ["full_refresh", "incremental"],
    scopes: ["initiatives:read"],
    schema: {
      type: "object",
      properties: {
        id: stringField(),
        name: stringField(),
        description: nullable("string"),
        status: stringField(),
        ownerId: nullable("string"),
        workspaceId: stringField(),
        startDate: nullable("string", "date-time"),
        targetDate: nullable("string", "date-time"),
        timeframe: nullable("string"),
        health: stringField(),
        parentInitiativeId: nullable("string"),
        createdAt: dateTime,
        updatedAt: dateTime,
      },
    },
  },
];

export const AIRBYTE_PRIVATE_DATA_BEHAVIOR = {
  privateTeams:
    "Airbyte tokens are workspace-scoped and include issues, comments, cycles, and project metadata from private teams.",
};

function readAirbyteToken(headers: Headers) {
  const authorization = headers.get("authorization")?.trim();
  if (authorization) {
    const [scheme, ...tokenParts] = authorization.split(/\s+/);
    const token = tokenParts.join(" ").trim();
    if (scheme?.toLowerCase() === "bearer" && token) {
      return token;
    }
    return null;
  }

  return headers.get("x-airbyte-token")?.trim() || null;
}

function isoDate(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function parseCursor(value: string | null) {
  if (!value) {
    return { ok: true as const, cursor: null };
  }

  const cursor = new Date(value);
  if (Number.isNaN(cursor.getTime())) {
    return { ok: false as const, error: "Cursor must be an ISO timestamp." };
  }

  return { ok: true as const, cursor };
}

export function isAirbyteStreamName(value: string): value is AirbyteStreamName {
  return AIRBYTE_STREAMS.includes(value as AirbyteStreamName);
}

export function readAirbyteLimit(request: Request) {
  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? 100);
  if (!Number.isFinite(rawLimit) || rawLimit <= 0) {
    return 100;
  }

  return Math.min(Math.floor(rawLimit), 1000);
}

export function readAirbyteCursor(request: Request) {
  const url = new URL(request.url);
  return parseCursor(url.searchParams.get("cursor"));
}

export async function authenticateAirbyteRequest(request: Request) {
  const token = readAirbyteToken(request.headers);
  if (!token || !token.startsWith(AIRBYTE_TOKEN_PREFIX)) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      auth: null,
    };
  }

  const [record] = await db
    .select({
      tokenId: apiKey.id,
      workspaceId: apiKey.workspaceId,
      workspaceSlug: workspace.urlSlug,
      settings: workspace.settings,
      userId: user.id,
      memberRole: member.role,
    })
    .from(apiKey)
    .innerJoin(workspace, eq(workspace.id, apiKey.workspaceId))
    .innerJoin(user, eq(user.id, apiKey.userId))
    .innerJoin(
      member,
      and(
        eq(member.userId, apiKey.userId),
        eq(member.workspaceId, apiKey.workspaceId),
      ),
    )
    .where(eq(apiKey.keyHash, createApiKeyHash(token)))
    .limit(1);

  if (!record) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      auth: null,
    };
  }

  const ipAccess = evaluateWorkspaceIpAccess(request.headers, record.settings);
  if (!ipAccess.allowed) {
    return {
      response: NextResponse.json(workspaceIpRestrictionError(ipAccess), {
        status: 403,
      }),
      auth: null,
    };
  }

  await db
    .update(apiKey)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKey.id, record.tokenId));

  return {
    response: null,
    auth: {
      workspaceId: record.workspaceId,
      workspaceSlug: record.workspaceSlug,
      tokenId: record.tokenId,
    },
  };
}

export async function readAirbyteRecords(
  stream: AirbyteStreamName,
  auth: AirbyteAuth,
  cursor: Date | null,
  limit: number,
) {
  if (stream === "issues") {
    const conditions = [eq(team.workspaceId, auth.workspaceId)];
    if (cursor) {
      conditions.push(gt(issue.updatedAt, cursor));
    }

    const rows = await db
      .select({
        id: issue.id,
        identifier: issue.identifier,
        number: issue.number,
        title: issue.title,
        description: issue.description,
        teamId: issue.teamId,
        stateId: issue.stateId,
        assigneeId: issue.assigneeId,
        creatorId: issue.creatorId,
        priority: issue.priority,
        projectId: issue.projectId,
        cycleId: issue.cycleId,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        archivedAt: issue.archivedAt,
        completedAt: issue.completedAt,
        canceledAt: issue.canceledAt,
      })
      .from(issue)
      .innerJoin(team, eq(team.id, issue.teamId))
      .where(and(...conditions))
      .orderBy(asc(issue.updatedAt), asc(issue.id))
      .limit(limit);

    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      archivedAt: isoDate(row.archivedAt),
      completedAt: isoDate(row.completedAt),
      canceledAt: isoDate(row.canceledAt),
    }));
  }

  if (stream === "projects") {
    const conditions = [eq(project.workspaceId, auth.workspaceId)];
    if (cursor) {
      conditions.push(gt(project.updatedAt, cursor));
    }

    const rows = await db
      .select({
        id: project.id,
        name: project.name,
        description: project.description,
        slug: project.slug,
        status: project.status,
        priority: project.priority,
        leadId: project.leadId,
        workspaceId: project.workspaceId,
        startDate: project.startDate,
        targetDate: project.targetDate,
        completedAt: project.completedAt,
        canceledAt: project.canceledAt,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      })
      .from(project)
      .where(and(...conditions))
      .orderBy(asc(project.updatedAt), asc(project.id))
      .limit(limit);

    return rows.map((row) => ({
      ...row,
      startDate: isoDate(row.startDate),
      targetDate: isoDate(row.targetDate),
      completedAt: isoDate(row.completedAt),
      canceledAt: isoDate(row.canceledAt),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  if (stream === "comments") {
    const conditions = [eq(team.workspaceId, auth.workspaceId)];
    if (cursor) {
      conditions.push(gt(comment.updatedAt, cursor));
    }

    const rows = await db
      .select({
        id: comment.id,
        body: comment.body,
        issueId: comment.issueId,
        userId: comment.userId,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
      })
      .from(comment)
      .innerJoin(issue, eq(issue.id, comment.issueId))
      .innerJoin(team, eq(team.id, issue.teamId))
      .where(and(...conditions))
      .orderBy(asc(comment.updatedAt), asc(comment.id))
      .limit(limit);

    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  if (stream === "cycles") {
    const conditions = [eq(team.workspaceId, auth.workspaceId)];
    if (cursor) {
      conditions.push(gt(cycle.updatedAt, cursor));
    }

    const rows = await db
      .select({
        id: cycle.id,
        name: cycle.name,
        number: cycle.number,
        teamId: cycle.teamId,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
        autoRollover: cycle.autoRollover,
        createdAt: cycle.createdAt,
        updatedAt: cycle.updatedAt,
      })
      .from(cycle)
      .innerJoin(team, eq(team.id, cycle.teamId))
      .where(and(...conditions))
      .orderBy(asc(cycle.updatedAt), asc(cycle.id))
      .limit(limit);

    return rows.map((row) => ({
      ...row,
      startDate: row.startDate.toISOString(),
      endDate: row.endDate.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  const conditions = [eq(initiative.workspaceId, auth.workspaceId)];
  if (cursor) {
    conditions.push(gt(initiative.updatedAt, cursor));
  }

  const rows = await db
    .select({
      id: initiative.id,
      name: initiative.name,
      description: initiative.description,
      status: initiative.status,
      ownerId: initiative.ownerId,
      workspaceId: initiative.workspaceId,
      startDate: initiative.startDate,
      targetDate: initiative.targetDate,
      timeframe: initiative.timeframe,
      health: initiative.health,
      parentInitiativeId: initiative.parentInitiativeId,
      createdAt: initiative.createdAt,
      updatedAt: initiative.updatedAt,
    })
    .from(initiative)
    .where(and(...conditions))
    .orderBy(asc(initiative.updatedAt), asc(initiative.id))
    .limit(limit);

  return rows.map((row) => ({
    ...row,
    startDate: isoDate(row.startDate),
    targetDate: isoDate(row.targetDate),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export function buildAirbyteStreamResponse(
  stream: AirbyteStreamName,
  records: Array<{ updatedAt?: string }>,
  limit: number,
  cursor: Date | null,
) {
  const nextCursor =
    records.length > 0 ? records[records.length - 1].updatedAt : null;

  return {
    stream,
    syncMode: cursor ? "incremental" : "full_refresh",
    cursorField: "updatedAt",
    records,
    nextCursor,
    hasMore: records.length === limit,
    privateData: AIRBYTE_PRIVATE_DATA_BEHAVIOR,
  };
}
