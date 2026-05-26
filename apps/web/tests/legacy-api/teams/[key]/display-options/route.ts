import { resolveRequestWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { team } from "@/lib/db/schema";
import {
  createHeadlessTeamsClient,
  headlessTeamsEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
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

  if (headlessTeamsEnabled()) {
    const workspaceId = await resolveRequestWorkspaceId(
      session.user.id,
      request,
    );
    if (workspaceId) {
      const token = await mintInternalApiToken({
        userId: session.user.id,
        workspaceId,
      });
      const client = createHeadlessTeamsClient(token);
      const { data, error, response } = await client.GET(
        "/teams/{key}/display-options",
        { params: { path: { key } } },
      );
      if (error) {
        return NextResponse.json(error, {
          status: (response as Response).status,
        });
      }
      return NextResponse.json(data, { status: (response as Response).status });
    }
  }

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

  if (headlessTeamsEnabled()) {
    const workspaceId = await resolveRequestWorkspaceId(
      session.user.id,
      request,
    );
    if (workspaceId) {
      const body = await request.json().catch(() => null);
      const token = await mintInternalApiToken({
        userId: session.user.id,
        workspaceId,
      });
      const client = createHeadlessTeamsClient(token);
      const { data, error, response } = await client.PUT(
        "/teams/{key}/display-options",
        {
          params: { path: { key } },
          body: body as never,
        },
      );
      if (error) {
        return NextResponse.json(error, {
          status: (response as Response).status,
        });
      }
      return NextResponse.json(data, { status: (response as Response).status });
    }
  }

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
