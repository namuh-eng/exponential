import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { workspace } from "@/lib/db/schema";
import {
  DEFAULT_SLACK_EVENTS,
  getStoredIntegration,
  getTeamSlackSettings,
  saveTeamSlackSettings,
} from "@/lib/integrations";
import { findAccessibleTeam } from "@/lib/teams";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

async function payload(
  teamRecord: NonNullable<Awaited<ReturnType<typeof findAccessibleTeam>>>,
) {
  const [ws] = await db
    .select({ settings: workspace.settings })
    .from(workspace)
    .where(eq(workspace.id, teamRecord.workspaceId))
    .limit(1);
  const slack = getStoredIntegration(ws?.settings, "slack");
  return {
    slackConnected: slack.connected === true,
    availableChannels: slack.channels ?? ["#eng", "#product", "#incidents"],
    settings: getTeamSlackSettings(teamRecord.settings),
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;
  const { key } = await params;
  const teamRecord = await findAccessibleTeam(key, session.user.id);
  if (!teamRecord)
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  return NextResponse.json(await payload(teamRecord));
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;
  const { key } = await params;
  const teamRecord = await findAccessibleTeam(key, session.user.id);
  if (!teamRecord)
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  const current = await payload(teamRecord);
  if (!current.slackConnected)
    return NextResponse.json(
      { error: "Connect Slack before saving team notification settings." },
      { status: 409 },
    );
  const body = (await request.json().catch(() => null)) as {
    channelName?: string;
    isEnabled?: boolean;
    events?: Record<string, boolean>;
  } | null;
  const channelName =
    typeof body?.channelName === "string" ? body.channelName.trim() : "";
  if (!channelName || !current.availableChannels.includes(channelName))
    return NextResponse.json(
      { error: "Choose an available Slack channel." },
      { status: 400 },
    );
  const events = { ...DEFAULT_SLACK_EVENTS };
  for (const key of Object.keys(events))
    events[key] = body?.events?.[key] !== false;
  const settings = await saveTeamSlackSettings(
    teamRecord.id,
    teamRecord.settings,
    { isEnabled: body?.isEnabled !== false, channelName, events },
  );
  return NextResponse.json({ ...current, settings });
}
