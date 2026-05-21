import { resolveWorkspaceIdBySlug } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { project, projectMilestone } from "@/lib/db/schema";
import {
  type ProjectActivityEntry,
  readProjectSettings,
} from "@/lib/project-detail";
import { getWorkspaceSlugFromPath } from "@/lib/workspace-paths";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

async function findDefaultWorkspaceId(userId: string) {
  const { member } = await import("@/lib/db/schema");
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const { slug } = await params;
  const workspaceId = await resolveProjectWorkspaceId(session.user.id, request);
  if (!workspaceId)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const proj = await findProjectInWorkspace(workspaceId, slug);
  if (!proj)
    return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const body = await request.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : null;
  if (!name)
    return NextResponse.json(
      { error: "Milestone name is required" },
      { status: 400 },
    );

  const last = await db
    .select({ sortOrder: projectMilestone.sortOrder })
    .from(projectMilestone)
    .where(eq(projectMilestone.projectId, proj.id))
    .orderBy(desc(projectMilestone.sortOrder))
    .limit(1);

  const settings = readProjectSettings(proj.settings);
  const created = await db.transaction(async (tx) => {
    const [milestone] = await tx
      .insert(projectMilestone)
      .values({
        projectId: proj.id,
        name,
        sortOrder: (last[0]?.sortOrder ?? -1) + 1,
      })
      .returning({
        id: projectMilestone.id,
        name: projectMilestone.name,
        sortOrder: projectMilestone.sortOrder,
      });

    const milestoneDescriptions = { ...settings.milestoneDescriptions };
    if (description) milestoneDescriptions[milestone.id] = description;
    const activity = [
      makeActivityEntry({
        type: "milestone",
        title: `Created milestone \"${name}\"`,
        body: description,
        actorName: session.user.name,
        actorImage: session.user.image ?? null,
      }),
      ...settings.activity,
    ].slice(0, 50);

    await tx
      .update(project)
      .set({
        settings: { ...settings, milestoneDescriptions, activity },
        updatedAt: new Date(),
      })
      .where(eq(project.id, proj.id));

    return milestone;
  });

  return NextResponse.json(
    {
      milestone: {
        ...created,
        description,
        issueCount: 0,
        completedCount: 0,
        progress: 0,
      },
    },
    { status: 201 },
  );
}
