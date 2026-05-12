import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { member, team, workspace } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { key } = await params;

  const [context] = await db
    .select({
      workspaceName: workspace.name,
      workspaceId: workspace.id,
      teamId: team.id,
      teamName: team.name,
      teamKey: team.key,
    })
    .from(team)
    .innerJoin(workspace, eq(team.workspaceId, workspace.id))
    .innerJoin(
      member,
      and(
        eq(member.workspaceId, workspace.id),
        eq(member.userId, session.user.id),
      ),
    )
    .where(eq(team.key, key))
    .limit(1);

  if (!context) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const teams = await db
    .select({ id: team.id, name: team.name, key: team.key })
    .from(team)
    .where(eq(team.workspaceId, context.workspaceId));

  return NextResponse.json({
    ...context,
    workspaceInitials: context.workspaceName.substring(0, 2).toUpperCase(),
    teams,
  });
}
