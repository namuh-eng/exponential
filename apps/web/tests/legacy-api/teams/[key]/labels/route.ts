import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { label } from "@/lib/db/schema";
import {
  createHeadlessLabelsClient,
  headlessLabelsEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import { validateScopedParentLabel } from "@/lib/label-parent-validation";
import { findAccessibleTeam } from "@/lib/teams";
import { and, eq, isNull } from "drizzle-orm";
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
  const teamRecord = await findAccessibleTeam(key, session.user.id);

  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  if (headlessLabelsEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId: teamRecord.workspaceId,
    });
    const client = createHeadlessLabelsClient(token);
    const { data, error, response } = await client.GET("/labels", {
      params: { query: { scope: "team", teamId: teamRecord.id } },
    });
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const labels = await db
    .select({
      id: label.id,
      name: label.name,
      color: label.color,
      description: label.description,
      parentLabelId: label.parentLabelId,
    })
    .from(label)
    .where(and(eq(label.teamId, teamRecord.id), isNull(label.archivedAt)));

  return NextResponse.json({ labels });
}

export async function POST(
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

  if (headlessLabelsEnabled()) {
    const body = await request.json().catch(() => null);
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId: teamRecord.workspaceId,
    });
    const client = createHeadlessLabelsClient(token);
    const { data, error, response } = await client.POST("/labels", {
      body: {
        ...(body as Record<string, unknown> | null),
        teamId: teamRecord.id,
      } as never,
    });
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const body = await request.json();
  const trimmedName = typeof body.name === "string" ? body.name.trim() : "";

  if (!trimmedName) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const parentValidation = await validateScopedParentLabel({
    workspaceId: teamRecord.workspaceId,
    teamId: teamRecord.id,
    parentLabelId: body.parentLabelId,
  });
  if (!parentValidation.ok) {
    return NextResponse.json(
      { error: parentValidation.error },
      { status: parentValidation.status },
    );
  }

  const [newLabel] = await db
    .insert(label)
    .values({
      name: trimmedName,
      color: body.color || "#6b6f76",
      description: body.description || null,
      workspaceId: teamRecord.workspaceId,
      teamId: teamRecord.id,
      parentLabelId: parentValidation.parentLabelId,
    })
    .returning();

  return NextResponse.json({ label: newLabel }, { status: 201 });
}
