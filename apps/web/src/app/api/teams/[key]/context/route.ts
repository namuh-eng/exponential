import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { team, workspace } from "@/lib/db/schema";
import { activeTeamFilter } from "@/lib/team-lifecycle";
import { findAccessibleTeam } from "@/lib/teams";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { key } = await params;

  const teamRecord = await findAccessibleTeam(key, session.user.id, {
    request,
  });
  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const [workspaceRecord] = await db
    .select({
      workspaceName: workspace.name,
      workspaceSlug: workspace.urlSlug,
      workspaceId: workspace.id,
    })
    .from(workspace)
    .where(eq(workspace.id, teamRecord.workspaceId))
    .limit(1);

  if (!workspaceRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const context = {
    ...workspaceRecord,
    teamId: teamRecord.id,
    teamName: teamRecord.name,
    teamKey: teamRecord.key,
  };

  const teams = await db
    .select({
      id: team.id,
      name: team.name,
      key: team.key,
      parentTeamId: team.parentTeamId,
      retiredAt: team.retiredAt,
    })
    .from(team)
    .where(and(eq(team.workspaceId, context.workspaceId), activeTeamFilter));

  return NextResponse.json({
    ...context,
    workspaceInitials: context.workspaceName.substring(0, 2).toUpperCase(),
    teams,
  });
}
