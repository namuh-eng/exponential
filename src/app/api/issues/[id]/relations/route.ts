import { resolveRequestWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issue, issueRelation, team } from "@/lib/db/schema";
import { insertIssueHistoryEvent } from "@/lib/issue-history";
import { and, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";

const relationTypes = ["blocks", "blocked_by", "duplicate", "related"] as const;
type RelationType = (typeof relationTypes)[number];

const inverseRelationType: Record<RelationType, RelationType> = {
  blocks: "blocked_by",
  blocked_by: "blocks",
  duplicate: "duplicate",
  related: "related",
};

function isRelationType(value: unknown): value is RelationType {
  return (
    typeof value === "string" && relationTypes.includes(value as RelationType)
  );
}

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

async function findIssueRecord(id: string, workspaceId: string) {
  const byIdentifier = await db
    .select({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      teamId: issue.teamId,
      workspaceId: team.workspaceId,
      teamSettings: team.settings,
    })
    .from(issue)
    .innerJoin(team, eq(issue.teamId, team.id))
    .where(and(eq(issue.identifier, id), eq(team.workspaceId, workspaceId)))
    .limit(1);

  if (byIdentifier.length > 0) {
    return byIdentifier[0];
  }

  if (!isUuidLike(id)) {
    return null;
  }

  const byId = await db
    .select({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      teamId: issue.teamId,
      workspaceId: team.workspaceId,
      teamSettings: team.settings,
    })
    .from(issue)
    .innerJoin(team, eq(issue.teamId, team.id))
    .where(and(eq(issue.id, id), eq(team.workspaceId, workspaceId)))
    .limit(1);

  return byId[0] ?? null;
}

async function findIssueById(id: string, workspaceId: string) {
  if (!isUuidLike(id)) {
    return null;
  }

  const rows = await db
    .select({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      teamId: issue.teamId,
      workspaceId: team.workspaceId,
    })
    .from(issue)
    .innerJoin(team, eq(issue.teamId, team.id))
    .where(and(eq(issue.id, id), eq(team.workspaceId, workspaceId)))
    .limit(1);

  return rows[0] ?? null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { id } = await params;
  const workspaceId = await resolveRequestWorkspaceId(session.user.id, request);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace found" }, { status: 400 });
  }

  const sourceIssue = await findIssueRecord(id, workspaceId);
  if (!sourceIssue || sourceIssue.workspaceId !== workspaceId) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    type?: unknown;
    relatedIssueId?: unknown;
  };

  if (!isRelationType(body.type) || typeof body.relatedIssueId !== "string") {
    return NextResponse.json(
      { error: "type and relatedIssueId are required" },
      { status: 400 },
    );
  }

  if (body.relatedIssueId === sourceIssue.id) {
    return NextResponse.json(
      { error: "Issue cannot relate to itself" },
      { status: 400 },
    );
  }

  const relatedIssue = await findIssueById(body.relatedIssueId, workspaceId);
  if (!relatedIssue || relatedIssue.workspaceId !== workspaceId) {
    return NextResponse.json(
      { error: "Related issue not found" },
      { status: 404 },
    );
  }

  const duplicateRows = await db
    .select({ id: issueRelation.id })
    .from(issueRelation)
    .where(
      or(
        and(
          eq(issueRelation.issueId, sourceIssue.id),
          eq(issueRelation.relatedIssueId, relatedIssue.id),
          eq(issueRelation.type, body.type),
        ),
        and(
          eq(issueRelation.issueId, relatedIssue.id),
          eq(issueRelation.relatedIssueId, sourceIssue.id),
          eq(issueRelation.type, inverseRelationType[body.type]),
        ),
      ),
    )
    .limit(1);

  if (duplicateRows.length > 0) {
    return NextResponse.json(
      { error: "Issue relation already exists" },
      { status: 409 },
    );
  }

  const [createdRelation] = await db
    .insert(issueRelation)
    .values({
      issueId: sourceIssue.id,
      relatedIssueId: relatedIssue.id,
      type: body.type,
    })
    .returning({
      id: issueRelation.id,
      type: issueRelation.type,
      relatedIssueId: issueRelation.relatedIssueId,
    });

  await insertIssueHistoryEvent(
    db,
    { settings: sourceIssue.teamSettings },
    {
      issueId: sourceIssue.id,
      actorId: session.user.id,
      actorName: session.user.name ?? null,
      actorEmail: session.user.email ?? null,
      eventType: "updated",
      metadata: {
        changedFields: ["relations"],
        identifier: sourceIssue.identifier,
        relationId: createdRelation.id,
        relationType: createdRelation.type,
        relatedIssueId: relatedIssue.id,
        relatedIdentifier: relatedIssue.identifier,
      },
    },
  );

  return NextResponse.json(
    {
      id: createdRelation.id,
      type: createdRelation.type,
      issue: {
        id: relatedIssue.id,
        identifier: relatedIssue.identifier,
        title: relatedIssue.title,
      },
    },
    { status: 201 },
  );
}
