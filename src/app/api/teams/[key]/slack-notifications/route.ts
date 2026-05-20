import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { member, team, workspace } from "@/lib/db/schema";
import {
  readTeamSlackNotifications,
  readWorkspaceIntegrations,
  withTeamSlackNotifications,
} from "@/lib/integration-settings";
import { findAccessibleTeam } from "@/lib/teams";
import { isWorkspaceAdminRole } from "@/lib/workspace-permissions";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

type Params = { params: Promise<{ key: string }> };
type SlackEventKey =
  | "issueCreated"
  | "issueCompleted"
  | "comments"
  | "projectUpdates";

type AccessibleTeam = NonNullable<
  Awaited<ReturnType<typeof findAccessibleTeam>>
>;

async function getWorkspaceContext(workspaceId: string, userId: string) {
  const [row] = await db
    .select({ settings: workspace.settings, role: member.role })
    .from(workspace)
    .innerJoin(
      member,
      and(eq(member.workspaceId, workspace.id), eq(member.userId, userId)),
    )
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  return row ?? null;
}

function serialize(
  teamRecord: AccessibleTeam,
  workspaceSettings: unknown,
  role: string,
) {
  const workspaceIntegrations = readWorkspaceIntegrations(workspaceSettings);
  const settings = readTeamSlackNotifications(teamRecord.settings);
  return {
    team: { id: teamRecord.id, name: teamRecord.name, key: teamRecord.key },
    canManage: isWorkspaceAdminRole(role),
    workspaceSlack: workspaceIntegrations.slack,
    settings,
  };
}

export async function GET(request: Request, { params }: Params) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const { key } = await params;
  const teamRecord = await findAccessibleTeam(key, session.user.id, {
    request,
  });
  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
  const workspaceContext = await getWorkspaceContext(
    teamRecord.workspaceId,
    session.user.id,
  );
  if (!workspaceContext) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  return NextResponse.json(
    serialize(teamRecord, workspaceContext.settings, workspaceContext.role),
  );
}

export async function PATCH(request: Request, { params }: Params) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const { key } = await params;
  const teamRecord = await findAccessibleTeam(key, session.user.id, {
    request,
  });
  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
  const workspaceContext = await getWorkspaceContext(
    teamRecord.workspaceId,
    session.user.id,
  );
  if (!workspaceContext) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
  if (!isWorkspaceAdminRole(workspaceContext.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const workspaceIntegrations = readWorkspaceIntegrations(
    workspaceContext.settings,
  );
  if (workspaceIntegrations.slack.status !== "connected") {
    return NextResponse.json(
      {
        error:
          "Connect the workspace Slack integration before configuring team notifications.",
      },
      { status: 409 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    enabled?: boolean;
    channelId?: string | null;
    events?: Partial<Record<SlackEventKey, boolean>>;
  };
  const channels = workspaceIntegrations.slack.availableChannels;
  const channel =
    channels.find((item) => item.id === body.channelId) ?? channels[0];
  if (!channel) {
    return NextResponse.json(
      { error: "Slack channel is required." },
      { status: 400 },
    );
  }

  const current = readTeamSlackNotifications(teamRecord.settings);
  const nextSettings = {
    enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
    channelId: channel.id,
    channelName: channel.name,
    events: {
      ...current.events,
      ...Object.fromEntries(
        Object.entries(body.events ?? {}).filter(
          ([, value]) => typeof value === "boolean",
        ),
      ),
    },
    updatedAt: new Date().toISOString(),
  };

  const [updatedTeam] = await db
    .update(team)
    .set({
      settings: withTeamSlackNotifications(teamRecord.settings, nextSettings),
      updatedAt: new Date(),
    })
    .where(eq(team.id, teamRecord.id))
    .returning({ settings: team.settings });

  return NextResponse.json({
    ...serialize(
      { ...teamRecord, settings: updatedTeam?.settings ?? teamRecord.settings },
      workspaceContext.settings,
      workspaceContext.role,
    ),
    notice: "Slack notification settings saved.",
  });
}
