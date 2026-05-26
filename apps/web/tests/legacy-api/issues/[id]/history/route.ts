import { resolveRequestWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issue, issueHistory, team, user } from "@/lib/db/schema";
import {
  createHeadlessIssuesClient,
  headlessIssuesEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

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
    .where(and(eq(issue.identifier, id), eq(team.workspaceId, workspaceId)))
    .limit(1);

  const identifierMatch = byIdentifier[0];
  if (identifierMatch) {
    return identifierMatch;
  }

  if (!isUuidLike(id)) {
    return null;
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
    .where(and(eq(issue.id, id), eq(team.workspaceId, workspaceId)))
    .limit(1);

  return byId[0] ?? null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const workspaceId = await resolveRequestWorkspaceId(
    session.user.id,
    _request,
  );
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace found" }, { status: 400 });
  }

  const { id } = await params;
  if (headlessIssuesEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId,
    });
    const client = createHeadlessIssuesClient(token);
    const { data, error, response } = await client.GET("/issues/{id}/history", {
      params: { path: { id } },
    });
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const currentIssue = await findAccessibleIssue(id, workspaceId);
  if (!currentIssue || currentIssue.workspaceId !== workspaceId) {
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
