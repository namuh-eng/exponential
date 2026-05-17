import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { team } from "@/lib/db/schema";
import { findAccessibleTeam } from "@/lib/teams";
import { eq } from "drizzle-orm";
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

  const settings = (teamRecord.settings ?? {}) as Record<string, unknown>;
  return NextResponse.json({ displayOptions: settings.displayOptions ?? null });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { key } = await params;
  const body = await request.json();

  const teamRecord = await findAccessibleTeam(key, session.user.id, {
    request,
  });
  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const existingSettings = (teamRecord.settings ?? {}) as Record<
    string,
    unknown
  >;
  const updatedSettings = {
    ...existingSettings,
    displayOptions: body.displayOptions,
  };

  await db
    .update(team)
    .set({ settings: updatedSettings })
    .where(eq(team.id, teamRecord.id));

  return NextResponse.json({ displayOptions: body.displayOptions });
}
