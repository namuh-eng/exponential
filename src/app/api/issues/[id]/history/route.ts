import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issue, issueHistory, team, user } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

async function findAccessibleIssue(id: string, workspaceId: string) {
  const byIdentifier = await db
    .select({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      creatorId: issue.creatorId,
      createdAt: issue.createdAt,
      workspaceId: team.workspaceId,
    })
    .from(issue)
    .innerJoin(team, eq(issue.teamId, team.id))
    .where(eq(issue.identifier, id))
    .limit(1);

  const identifierMatch = byIdentifier[0];
  if (identifierMatch) {
    return identifierMatch.workspaceId === workspaceId ? identifierMatch : null;
  }

  const byId = await db
    .select({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      creatorId: issue.creatorId,
      createdAt: issue.createdAt,
      workspaceId: team.workspaceId,
    })
    .from(issue)
    .innerJoin(team, eq(issue.teamId, team.id))
    .where(eq(issue.id, id))
    .limit(1);

  const idMatch = byId[0];
  if (!idMatch || idMatch.workspaceId !== workspaceId) {
    return null;
  }

  return idMatch;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const workspaceId = await resolveActiveWorkspaceId(session.user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace found" }, { status: 400 });
  }

  const { id } = await params;
  const currentIssue = await findAccessibleIssue(id, workspaceId);
  if (!currentIssue) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  const events = await db
    .select({
      id: issueHistory.id,
      type: issueHistory.eventType,
      metadata: issueHistory.metadata,
      actorId: issueHistory.actorId,
      actorName: issueHistory.actorName,
      actorEmail: issueHistory.actorEmail,
      currentActorName: user.name,
      currentActorEmail: user.email,
      createdAt: issueHistory.createdAt,
    })
    .from(issueHistory)
    .leftJoin(user, eq(issueHistory.actorId, user.id))
    .where(eq(issueHistory.issueId, currentIssue.id))
    .orderBy(asc(issueHistory.createdAt));

  if (events.length === 0) {
    return NextResponse.json({
      history: [
        {
          id: `legacy-created-${currentIssue.id}`,
          type: "created",
          metadata: {
            identifier: currentIssue.identifier,
            title: currentIssue.title,
            migrationFallback: true,
          },
          actor: currentIssue.creatorId
            ? { id: currentIssue.creatorId, name: null, email: null }
            : null,
          createdAt: currentIssue.createdAt,
        },
      ],
    });
  }

  return NextResponse.json({
    history: events.map((event) => ({
      id: event.id,
      type: event.type,
      metadata: event.metadata,
      actor: event.actorId
        ? {
            id: event.actorId,
            name: event.currentActorName ?? event.actorName,
            email: event.currentActorEmail ?? event.actorEmail,
          }
        : null,
      createdAt: event.createdAt,
    })),
  });
}
