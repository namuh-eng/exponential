import { resolveWorkspaceIdBySlug } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issue, member, project, projectMilestone } from "@/lib/db/schema";
import {
  type ProjectActivityEntry,
  readProjectSettings,
} from "@/lib/project-detail";
import { getWorkspaceSlugFromPath } from "@/lib/workspace-paths";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

async function findDefaultWorkspaceId(userId: string) {
  const memberships = await db
    .select({ workspaceId: member.workspaceId })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(desc(member.createdAt))
    .limit(1);
  return memberships[0]?.workspaceId ?? null;
}

async function resolveProjectWorkspaceId(userId: string, request: Request) {
  const workspaceSlug = new URL(request.url).searchParams.get("workspaceSlug");
  if (workspaceSlug) return resolveWorkspaceIdBySlug(userId, workspaceSlug);
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const slug = getWorkspaceSlugFromPath(new URL(referer).pathname);
      if (slug) {
        const workspaceId = await resolveWorkspaceIdBySlug(userId, slug);
        if (workspaceId) return workspaceId;
      }
    } catch {}
  }
  return findDefaultWorkspaceId(userId);
}

async function findProjectInWorkspace(workspaceId: string, slug: string) {
  const projects = await db
    .select()
    .from(project)
    .where(and(eq(project.workspaceId, workspaceId), eq(project.slug, slug)))
    .limit(1);
  return projects[0] ?? null;
}

function makeActivityEntry(
  entry: Omit<ProjectActivityEntry, "id" | "createdAt">,
): ProjectActivityEntry {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...entry,
  };
}

async function findMilestone(projectId: string, milestoneId: string) {
  const rows = await db
    .select({
      id: projectMilestone.id,
      name: projectMilestone.name,
      sortOrder: projectMilestone.sortOrder,
    })
    .from(projectMilestone)
    .where(
      and(
        eq(projectMilestone.id, milestoneId),
        eq(projectMilestone.projectId, projectId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; milestoneId: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const { slug, milestoneId } = await params;
  const workspaceId = await resolveProjectWorkspaceId(session.user.id, request);
  if (!workspaceId)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const proj = await findProjectInWorkspace(workspaceId, slug);
  if (!proj)
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const current = await findMilestone(proj.id, milestoneId);
  if (!current)
    return NextResponse.json({ error: "Milestone not found" }, { status: 404 });

  const body = await request.json();
  const updateData: Partial<typeof projectMilestone.$inferInsert> = {
    updatedAt: new Date(),
  };
  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  if (body.name !== undefined) {
    if (!name)
      return NextResponse.json(
        { error: "Milestone name is required" },
        { status: 400 },
      );
    updateData.name = name;
  }
  if (typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)) {
    updateData.sortOrder = body.sortOrder;
  }
  const description =
    body.description === undefined
      ? undefined
      : typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;

  const settings = readProjectSettings(proj.settings);
  const nextMilestoneDescriptions = { ...settings.milestoneDescriptions };
  if (description !== undefined) {
    if (description) nextMilestoneDescriptions[milestoneId] = description;
    else delete nextMilestoneDescriptions[milestoneId];
  }

  const updated = await db.transaction(async (tx) => {
    const [milestone] = await tx
      .update(projectMilestone)
      .set(updateData)
      .where(eq(projectMilestone.id, milestoneId))
      .returning({
        id: projectMilestone.id,
        name: projectMilestone.name,
        sortOrder: projectMilestone.sortOrder,
      });

    const activity = [
      makeActivityEntry({
        type: "milestone",
        title: `Updated milestone \"${milestone.name}\"`,
        body: description === undefined ? null : description,
        actorName: session.user.name,
        actorImage: session.user.image ?? null,
      }),
      ...settings.activity,
    ].slice(0, 50);
    await tx
      .update(project)
      .set({
        settings: {
          ...settings,
          milestoneDescriptions: nextMilestoneDescriptions,
          activity,
        },
        updatedAt: new Date(),
      })
      .where(eq(project.id, proj.id));
    return milestone;
  });

  return NextResponse.json({
    milestone: {
      ...updated,
      description: nextMilestoneDescriptions[milestoneId] ?? null,
    },
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string; milestoneId: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const { slug, milestoneId } = await params;
  const workspaceId = await resolveProjectWorkspaceId(session.user.id, request);
  if (!workspaceId)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const proj = await findProjectInWorkspace(workspaceId, slug);
  if (!proj)
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const current = await findMilestone(proj.id, milestoneId);
  if (!current)
    return NextResponse.json({ error: "Milestone not found" }, { status: 404 });

  const settings = readProjectSettings(proj.settings);
  await db.transaction(async (tx) => {
    await tx
      .update(issue)
      .set({ projectMilestoneId: null, updatedAt: new Date() })
      .where(eq(issue.projectMilestoneId, milestoneId));
    await tx
      .delete(projectMilestone)
      .where(eq(projectMilestone.id, milestoneId));
    const milestoneDescriptions = { ...settings.milestoneDescriptions };
    delete milestoneDescriptions[milestoneId];
    const activity = [
      makeActivityEntry({
        type: "milestone",
        title: `Deleted milestone \"${current.name}\"`,
        body: "Assigned issues were moved back to no milestone.",
        actorName: session.user.name,
        actorImage: session.user.image ?? null,
      }),
      ...settings.activity,
    ].slice(0, 50);
    await tx
      .update(project)
      .set({
        settings: {
          ...settings,
          milestoneDescriptions,
          activity,
        },
        updatedAt: new Date(),
      })
      .where(eq(project.id, proj.id));
  });

  return NextResponse.json({ success: true });
}
