import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { teamNotificationIntegration } from "@/lib/db/schema";
import {
  SLACK_NOTIFICATION_EVENTS,
  canManageIntegrations,
  findSlackWorkspaceIntegration,
  findTeamForSlackSettings,
  findTeamSlackSettings,
  getWorkspaceAccess,
  normalizeSlackEvents,
} from "@/lib/workspace-integrations";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

type Params = { params: Promise<{ key: string }> | { key: string } };

function serializeSettings(
  row:
    | Awaited<ReturnType<typeof findTeamSlackSettings>>
    | {
        channelId: string | null;
        channelName: string | null;
        enabled: boolean;
        events: unknown;
        updatedAt: Date | null;
      },
) {
  return {
    channelId: row?.channelId ?? "",
    channelName: row?.channelName ?? "",
    enabled: row?.enabled ?? false,
    events: normalizeSlackEvents(row?.events),
    updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

export async function GET(request: Request, context: Params) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const access = await getWorkspaceAccess(session, request);
  if (!access) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }
  const { key } = await context.params;
  const team = await findTeamForSlackSettings(key, access.workspaceId);
  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const [workspaceSlack, settings] = await Promise.all([
    findSlackWorkspaceIntegration(access.workspaceId),
    findTeamSlackSettings(team.id),
  ]);

  return NextResponse.json({
    team,
    workspaceSlack: workspaceSlack
      ? {
          id: workspaceSlack.id,
          status: workspaceSlack.status,
          displayName: workspaceSlack.displayName,
          connectedAt: workspaceSlack.connectedAt
            ? new Date(workspaceSlack.connectedAt).toISOString()
            : null,
        }
      : null,
    canManageSlackNotifications: canManageIntegrations(access.role),
    availableEvents: SLACK_NOTIFICATION_EVENTS,
    settings: serializeSettings(settings),
  });
}

export async function PATCH(request: Request, context: Params) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const access = await getWorkspaceAccess(session, request);
  if (!access) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }
  if (!canManageIntegrations(access.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { key } = await context.params;
  const team = await findTeamForSlackSettings(key, access.workspaceId);
  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const workspaceSlack = await findSlackWorkspaceIntegration(
    access.workspaceId,
  );
  if (!workspaceSlack) {
    return NextResponse.json(
      { error: "Connect workspace Slack before saving team notifications." },
      { status: 409 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    channelId?: unknown;
    channelName?: unknown;
    enabled?: unknown;
    events?: unknown;
  } | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const channelName =
    typeof body.channelName === "string" ? body.channelName.trim() : "";
  const channelId =
    typeof body.channelId === "string" && body.channelId.trim()
      ? body.channelId.trim()
      : channelName
        ? channelName
            .toLowerCase()
            .replace(/^#/, "")
            .replaceAll(/[^a-z0-9_-]+/g, "-")
        : "";
  if (!channelName) {
    return NextResponse.json(
      { error: "Slack channel is required." },
      { status: 400 },
    );
  }

  const events = normalizeSlackEvents(body.events);
  const enabled = body.enabled !== false;
  const now = new Date();

  const [saved] = await db
    .insert(teamNotificationIntegration)
    .values({
      teamId: team.id,
      workspaceIntegrationId: workspaceSlack.id,
      provider: "slack",
      channelId,
      channelName: channelName.startsWith("#")
        ? channelName
        : `#${channelName}`,
      enabled,
      events,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        teamNotificationIntegration.teamId,
        teamNotificationIntegration.provider,
      ],
      set: {
        workspaceIntegrationId: workspaceSlack.id,
        channelId,
        channelName: channelName.startsWith("#")
          ? channelName
          : `#${channelName}`,
        enabled,
        events,
        updatedAt: now,
      },
    })
    .returning({
      channelId: teamNotificationIntegration.channelId,
      channelName: teamNotificationIntegration.channelName,
      enabled: teamNotificationIntegration.enabled,
      events: teamNotificationIntegration.events,
      updatedAt: teamNotificationIntegration.updatedAt,
    });

  return NextResponse.json({ settings: serializeSettings(saved) });
}

export async function DELETE(request: Request, context: Params) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const access = await getWorkspaceAccess(session, request);
  if (!access) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }
  if (!canManageIntegrations(access.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { key } = await context.params;
  const team = await findTeamForSlackSettings(key, access.workspaceId);
  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  await db
    .delete(teamNotificationIntegration)
    .where(
      and(
        eq(teamNotificationIntegration.teamId, team.id),
        eq(teamNotificationIntegration.provider, "slack"),
      ),
    );

  return NextResponse.json({ success: true });
}
