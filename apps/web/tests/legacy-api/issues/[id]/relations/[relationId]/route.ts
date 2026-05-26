import { resolveRequestWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issue, issueRelation, team } from "@/lib/db/schema";
import {
  createHeadlessIssuesClient,
  headlessIssuesEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import { insertIssueHistoryEvent } from "@/lib/issue-history";
import { and, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";

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
      teamSettings: team.settings,
      workspaceId: team.workspaceId,
    })
    .from(issue)
    .innerJoin(team, eq(issue.teamId, team.id))
    .where(and(or(...filters), eq(team.workspaceId, workspaceId)))
    .limit(1);

  return rows[0] ?? null;
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; relationId: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const workspaceId = await resolveRequestWorkspaceId(session.user.id, request);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace found" }, { status: 400 });
  }

  const { id, relationId } = await params;
  if (headlessIssuesEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId,
    });
    const client = createHeadlessIssuesClient(token);
    const { data, error, response } = await client.DELETE(
      "/issues/{id}/relations/{relationID}",
      {
        params: { path: { id, relationID: relationId } },
      },
    );
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const sourceIssue = await findIssueInWorkspace(id, workspaceId);
  if (!sourceIssue) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  const rows = await db
    .select({
      id: issueRelation.id,
      issueId: issueRelation.issueId,
      relatedIssueId: issueRelation.relatedIssueId,
      type: issueRelation.type,
    })
    .from(issueRelation)
    .where(
      and(
        eq(issueRelation.id, relationId),
        or(
          eq(issueRelation.issueId, sourceIssue.id),
          eq(issueRelation.relatedIssueId, sourceIssue.id),
        ),
      ),
    )
    .limit(1);

  const relation = rows[0];
  if (!relation) {
    return NextResponse.json(
      { error: "Issue relation not found" },
      { status: 404 },
    );
  }

  const otherIssueId =
    relation.issueId === sourceIssue.id
      ? relation.relatedIssueId
      : relation.issueId;
  const otherIssue = await db
    .select({
      id: issue.id,
      identifier: issue.identifier,
      workspaceId: team.workspaceId,
    })
    .from(issue)
    .innerJoin(team, eq(issue.teamId, team.id))
    .where(and(eq(issue.id, otherIssueId), eq(team.workspaceId, workspaceId)))
    .limit(1);

  if (otherIssue.length === 0) {
    return NextResponse.json(
      { error: "Issue relation not found" },
      { status: 404 },
    );
  }

  await db.transaction(async (tx) => {
    await tx.delete(issueRelation).where(eq(issueRelation.id, relation.id));
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
          action: "relation_deleted",
          relationId: relation.id,
          relationType: relation.type,
          targetIssueId: otherIssueId,
          targetIdentifier: otherIssue[0].identifier,
        },
      },
    );
  });

  return NextResponse.json({ success: true });
}
