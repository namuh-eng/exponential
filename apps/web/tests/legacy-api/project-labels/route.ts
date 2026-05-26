import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { project, projectLabel } from "@/lib/db/schema";
import {
  createHeadlessProjectLabelsClient,
  headlessProjectLabelsEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

function normalizeHexColor(value: unknown) {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    return "#6b6f76";
  }

  return value.toLowerCase();
}

function normalizeDescription(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function GET() {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const workspaceId = await resolveActiveWorkspaceId(session.user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  if (headlessProjectLabelsEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId,
    });
    const client = createHeadlessProjectLabelsClient(token);
    const { data, error, response } = await client.GET("/project-labels");
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const labels = await db
    .select({
      id: projectLabel.id,
      name: projectLabel.name,
      color: projectLabel.color,
      description: projectLabel.description,
      createdAt: projectLabel.createdAt,
      updatedAt: projectLabel.updatedAt,
      projectCount: sql<number>`count(${project.id})::int`,
    })
    .from(projectLabel)
    .leftJoin(
      project,
      and(
        eq(project.workspaceId, workspaceId),
        sql`(${project.settings}->'labelIds') ? ${projectLabel.id}::text`,
      ),
    )
    .where(eq(projectLabel.workspaceId, workspaceId))
    .groupBy(projectLabel.id)
    .orderBy(projectLabel.name);

  return NextResponse.json({
    labels: labels.map((label) => ({
      id: label.id,
      name: label.name,
      color: label.color,
      description: label.description,
      projectCount: Number(label.projectCount),
      createdAt: label.createdAt.toISOString(),
      updatedAt: label.updatedAt.toISOString(),
    })),
  });
}

export async function POST(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const workspaceId = await resolveActiveWorkspaceId(session.user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  const body = await request.json();

  if (headlessProjectLabelsEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId,
    });
    const client = createHeadlessProjectLabelsClient(token);
    const { data, error, response } = await client.POST("/project-labels", {
      body: body as never,
    });
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const existing = await db
    .select({ id: projectLabel.id })
    .from(projectLabel)
    .where(
      and(
        eq(projectLabel.workspaceId, workspaceId),
        eq(projectLabel.name, name),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json(
      { error: "A project label with this name already exists" },
      { status: 409 },
    );
  }

  const [newLabel] = await db
    .insert(projectLabel)
    .values({
      name,
      color: normalizeHexColor(body.color),
      description: normalizeDescription(body.description),
      workspaceId,
    })
    .returning();

  return NextResponse.json({ label: newLabel }, { status: 201 });
}
