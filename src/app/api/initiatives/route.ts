import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  initiative,
  initiativeProject,
  member,
  project,
} from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

async function resolveWorkspaceId(userId: string) {
  const cookieStore = await cookies();
  const preferredWorkspaceId = cookieStore.get("activeWorkspaceId")?.value;

  const members = await db
    .select({ workspaceId: member.workspaceId })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(desc(member.createdAt))
    .limit(50);

  if (
    preferredWorkspaceId &&
    members.some(
      (membership) => membership.workspaceId === preferredWorkspaceId,
    )
  ) {
    return preferredWorkspaceId;
  }

  return members[0]?.workspaceId ?? null;
}

export async function GET(_request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const workspaceId = await resolveWorkspaceId(session.user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  const initiatives = await db
    .select()
    .from(initiative)
    .where(eq(initiative.workspaceId, workspaceId));

  // Get project counts per initiative
  const result = await Promise.all(
    initiatives.map(async (init) => {
      const projects = await db
        .select({
          id: project.id,
          name: project.name,
          status: project.status,
          icon: project.icon,
        })
        .from(initiativeProject)
        .innerJoin(project, eq(initiativeProject.projectId, project.id))
        .where(eq(initiativeProject.initiativeId, init.id));

      const completedCount = projects.filter(
        (p) => p.status === "completed",
      ).length;

      return {
        id: init.id,
        name: init.name,
        description: init.description,
        status: init.status,
        projectCount: projects.length,
        completedProjectCount: completedCount,
        createdAt: init.createdAt,
        updatedAt: init.updatedAt,
      };
    }),
  );

  return NextResponse.json({ initiatives: result });
}

export async function POST(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const workspaceId = await resolveWorkspaceId(session.user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  const body = await request.json();
  const name = `${body.name ?? ""}`.trim();
  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : null;

  if (!name) {
    return NextResponse.json(
      { error: "Initiative name is required" },
      { status: 400 },
    );
  }

  const newInitiative = await db
    .insert(initiative)
    .values({
      name,
      description,
      status: body.status ?? "planned",
      workspaceId,
    })
    .returning();

  return NextResponse.json(newInitiative[0], { status: 201 });
}
