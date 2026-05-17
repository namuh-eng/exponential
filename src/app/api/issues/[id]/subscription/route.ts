import { resolveRequestWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issue, team } from "@/lib/db/schema";
import {
  getIssueSubscriptionSummary,
  setIssueSubscription,
} from "@/lib/issue-subscriptions";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(
    value,
  );
}

async function findAccessibleIssue(id: string, workspaceId: string) {
  const byIdentifier = await db
    .select({ id: issue.id, workspaceId: team.workspaceId })
    .from(issue)
    .innerJoin(team, eq(issue.teamId, team.id))
    .where(and(eq(issue.identifier, id), eq(team.workspaceId, workspaceId)))
    .limit(1);

  if (byIdentifier[0]) {
    return byIdentifier[0];
  }

  if (!isUuidLike(id)) {
    return null;
  }

  const byId = await db
    .select({ id: issue.id, workspaceId: team.workspaceId })
    .from(issue)
    .innerJoin(team, eq(issue.teamId, team.id))
    .where(eq(issue.id, id))
    .limit(1);

  const idMatch = byId[0];
  return idMatch?.workspaceId === workspaceId ? idMatch : null;
}

async function resolveAccessibleIssue(
  request: Request,
  id: string,
  userId: string,
) {
  const workspaceId = await resolveRequestWorkspaceId(userId, request);
  if (!workspaceId) {
    return {
      response: NextResponse.json(
        { error: "No workspace found" },
        { status: 400 },
      ),
    };
  }

  const currentIssue = await findAccessibleIssue(id, workspaceId);
  if (!currentIssue || currentIssue.workspaceId !== workspaceId) {
    return {
      response: NextResponse.json(
        { error: "Issue not found" },
        { status: 404 },
      ),
    };
  }

  return { issueId: currentIssue.id };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { id } = await params;
  const resolved = await resolveAccessibleIssue(request, id, session.user.id);
  if (resolved.response) {
    return resolved.response;
  }

  return NextResponse.json(
    await getIssueSubscriptionSummary({
      issueId: resolved.issueId,
      userId: session.user.id,
    }),
  );
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
  const resolved = await resolveAccessibleIssue(request, id, session.user.id);
  if (resolved.response) {
    return resolved.response;
  }

  return NextResponse.json(
    await setIssueSubscription({
      issueId: resolved.issueId,
      userId: session.user.id,
      subscribed: true,
    }),
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { id } = await params;
  const resolved = await resolveAccessibleIssue(request, id, session.user.id);
  if (resolved.response) {
    return resolved.response;
  }

  return NextResponse.json(
    await setIssueSubscription({
      issueId: resolved.issueId,
      userId: session.user.id,
      subscribed: false,
    }),
  );
}
