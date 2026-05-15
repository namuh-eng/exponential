import { resolveRequestWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issue, issueRelation, team } from "@/lib/db/schema";
import { insertIssueHistoryEvent } from "@/lib/issue-history";
import { and, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";

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
      workspaceId: team.workspaceId,
      teamSettings: team.settings,
    })
    .from(issue)
    .innerJoin(team, eq(issue.teamId, team.id))
    .where(and(eq(issue.id, id), eq(team.workspaceId, workspaceId)))
    .limit(1);

  return byId[0] ?? null;
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; relationId: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { id, relationId } = await params;
  const workspaceId = await resolveRequestWorkspaceId(session.user.id, request);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace found" }, { status: 400 });
  }

  const currentIssue = await findIssueRecord(id, workspaceId);
  if (!currentIssue || currentIssue.workspaceId !== workspaceId) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  const rows = await db
    .select({
      id: issueRelation.id,
      type: issueRelation.type,
      issueId: issueRelation.issueId,
      relatedIssueId: issueRelation.relatedIssueId,
    })
    .from(issueRelation)
    .innerJoin(issue, eq(issueRelation.issueId, issue.id))
    .innerJoin(team, eq(issue.teamId, team.id))
    .where(
      and(eq(issueRelation.id, relationId), eq(team.workspaceId, workspaceId)),
    )
    .limit(1);

  const relation = rows[0];
  if (
    !relation ||
    (relation.issueId !== currentIssue.id &&
      relation.relatedIssueId !== currentIssue.id)
  ) {
    return NextResponse.json({ error: "Relation not found" }, { status: 404 });
  }

  await db
    .delete(issueRelation)
    .where(
      and(
        eq(issueRelation.id, relation.id),
        or(
          eq(issueRelation.issueId, currentIssue.id),
          eq(issueRelation.relatedIssueId, currentIssue.id),
        ),
      ),
    );

  await insertIssueHistoryEvent(
    db,
    { settings: currentIssue.teamSettings },
    {
      issueId: currentIssue.id,
      actorId: session.user.id,
      actorName: session.user.name ?? null,
      actorEmail: session.user.email ?? null,
      eventType: "updated",
      metadata: {
        changedFields: ["relations"],
        identifier: currentIssue.identifier,
        removedRelationId: relation.id,
        relationType: relation.type,
      },
    },
  );

  return NextResponse.json({ success: true });
}
