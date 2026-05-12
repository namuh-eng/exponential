import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { team } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response: authResponse } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { key } = await params;

  const teams = await db
    .select({ id: team.id, settings: team.settings })
    .from(team)
    .where(eq(team.key, key))
    .limit(1);

  if (teams.length === 0) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const settings = (teams[0].settings ?? {}) as Record<string, unknown>;
  return NextResponse.json({ displayOptions: settings.displayOptions ?? null });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response: authResponse } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { key } = await params;
  const body = await request.json();

  const teams = await db
    .select({ id: team.id, settings: team.settings })
    .from(team)
    .where(eq(team.key, key))
    .limit(1);

  if (teams.length === 0) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const existingSettings = (teams[0].settings ?? {}) as Record<string, unknown>;
  const updatedSettings = {
    ...existingSettings,
    displayOptions: body.displayOptions,
  };

  await db
    .update(team)
    .set({ settings: updatedSettings })
    .where(eq(team.id, teams[0].id));

  return NextResponse.json({ displayOptions: body.displayOptions });
}
