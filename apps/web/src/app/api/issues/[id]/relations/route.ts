import { resolveRequestWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issue, issueRelation, team } from "@/lib/db/schema";
import { insertIssueHistoryEvent } from "@/lib/issue-history";
import {
  buildNotificationValues,
  insertNotifications,
} from "@/lib/notifications";
import { and, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";

const RELATION_TYPES = [
  "blocks",
  "blocked_by",
  "duplicate",
  "related",
] as const;
type RelationType = (typeof RELATION_TYPES)[number];
type StoredRelationType = "blocks" | "duplicate" | "related";

function isRelationType(value: unknown): value is RelationType {
  return (
    typeof value === "string" && RELATION_TYPES.includes(value as RelationType)
  );
}

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(
    value,
  );
}

async function findIssueInWorkspace(id: string, workspaceId: string) {
  const filters = [eq(issue.identifier, id)];
  if (isUuidLike(id)) {
    filters.push(eq(issue.id, id));
  }

  const rows = await db
    .select({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      assigneeId: issue.assigneeId,
      creatorId: issue.creatorId,
      teamSettings: team.settings,
      workspaceId: team.workspaceId,
    })
    .from(issue)
    .innerJoin(team, eq(issue.teamId, team.id))
    .where(and(or(...filters), eq(team.workspaceId, workspaceId)))
    .limit(1);

  return rows[0] ?? null;
}

function normalizeRelation(input: {
  sourceIssueId: string;
  targetIssueId: string;
  type: RelationType;
}) {
  if (input.type === "blocked_by") {
    return {
      issueId: input.targetIssueId,
      relatedIssueId: input.sourceIssueId,
      storedType: "blocks" as StoredRelationType,
      displayType: "blocked_by" as RelationType,
    };
  }

  if (input.type === "duplicate" || input.type === "related") {
    const [issueId, relatedIssueId] = [
      input.sourceIssueId,
      input.targetIssueId,
    ].sort();
    return {
      issueId,
      relatedIssueId,
      storedType: input.type as StoredRelationType,
      displayType: input.type,
    };
  }

  return {
    issueId: input.sourceIssueId,
    relatedIssueId: input.targetIssueId,
    storedType: "blocks" as StoredRelationType,
    displayType: "blocks" as RelationType,
  };
}

function displayRelationType(input: {
  currentIssueId: string;
  storedIssueId: string;
  storedRelatedIssueId: string;
  storedType: RelationType;
}) {
  if (input.storedType === "duplicate" || input.storedType === "related") {
    return input.storedType;
  }

  return input.currentIssueId === input.storedIssueId ? "blocks" : "blocked_by";
}

function relationResponse(input: {
  relation: {
    id: string;
    issueId: string;
    relatedIssueId: string;
    type: RelationType;
  };
  currentIssueId: string;
  otherIssue: { id: string; identifier: string; title: string };
}) {
  return {
    id: input.relation.id,
    type: displayRelationType({
      currentIssueId: input.currentIssueId,
      storedIssueId: input.relation.issueId,
      storedRelatedIssueId: input.relation.relatedIssueId,
      storedType: input.relation.type,
    }),
    issue: input.otherIssue,
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const workspaceId = await resolveRequestWorkspaceId(session.user.id, request);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace found" }, { status: 400 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    targetIssueId?: unknown;
    relatedIssueId?: unknown;
    type?: unknown;
  } | null;
  const relationType = body?.type;
  const targetIssueId = body?.targetIssueId ?? body?.relatedIssueId;

  if (!isRelationType(relationType) || typeof targetIssueId !== "string") {
    return NextResponse.json(
      { error: "A supported relation type and targetIssueId are required" },
      { status: 400 },
    );
  }

  const sourceIssue = await findIssueInWorkspace(id, workspaceId);
  if (!sourceIssue) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  const targetIssue = await findIssueInWorkspace(targetIssueId, workspaceId);
  if (!targetIssue) {
    return NextResponse.json(
      { error: "Target issue not found" },
      { status: 404 },
    );
  }

  if (sourceIssue.id === targetIssue.id) {
    return NextResponse.json(
      { error: "An issue cannot relate to itself" },
      { status: 400 },
    );
  }

  const normalized = normalizeRelation({
    sourceIssueId: sourceIssue.id,
    targetIssueId: targetIssue.id,
    type: relationType,
  });

  const equivalentTypes =
    relationType === "blocks" || relationType === "blocked_by"
      ? (["blocks", "blocked_by"] as const)
      : ([normalized.storedType] as const);
  const existing = await db
    .select({ id: issueRelation.id })
    .from(issueRelation)
    .where(
      and(
        or(...equivalentTypes.map((type) => eq(issueRelation.type, type))),
        or(
          and(
            eq(issueRelation.issueId, normalized.issueId),
            eq(issueRelation.relatedIssueId, normalized.relatedIssueId),
          ),
          and(
            eq(issueRelation.issueId, normalized.relatedIssueId),
            eq(issueRelation.relatedIssueId, normalized.issueId),
          ),
        ),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json(
      { error: "Issue relation already exists" },
      { status: 409 },
    );
  }

  const [created] = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(issueRelation)
      .values({
        issueId: normalized.issueId,
        relatedIssueId: normalized.relatedIssueId,
        type: normalized.storedType,
      })
      .returning({
        id: issueRelation.id,
        issueId: issueRelation.issueId,
        relatedIssueId: issueRelation.relatedIssueId,
        type: issueRelation.type,
      });

    await insertIssueHistoryEvent(
      tx,
      { settings: sourceIssue.teamSettings },
      {
        issueId: sourceIssue.id,
        actorId: session.user.id,
        actorName: session.user.name ?? null,
        actorEmail: session.user.email ?? null,
        eventType: "updated",
        metadata: {
          changedFields: ["relations"],
          action: "relation_created",
          relationId: inserted[0].id,
          relationType,
          targetIssueId: targetIssue.id,
          targetIdentifier: targetIssue.identifier,
        },
      },
    );

    return inserted;
  });

  if (relationType === "duplicate") {
    await insertNotifications(
      buildNotificationValues({
        type: "duplicate",
        actorId: session.user.id,
        issueId: sourceIssue.id,
        userIds: [
          sourceIssue.assigneeId,
          sourceIssue.creatorId,
          targetIssue.assigneeId,
          targetIssue.creatorId,
        ],
      }),
    );
  }

  return NextResponse.json(
    relationResponse({
      relation: created,
      currentIssueId: sourceIssue.id,
      otherIssue: targetIssue,
    }),
    { status: 201 },
  );
}
