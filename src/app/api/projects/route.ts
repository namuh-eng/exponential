import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issue, project, projectTeam, team, user } from "@/lib/db/schema";
import { count, desc, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

function sanitizeProjectSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 255)
    .replace(/-+$/g, "");
}

export async function GET() {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const workspaceId = await resolveActiveWorkspaceId(session.user.id);
  if (!workspaceId) {
    return NextResponse.json({ projects: [] });
  }

  // Get all projects for this workspace with lead info
  const projects = await db
    .select({
      id: project.id,
      name: project.name,
      description: project.description,
      icon: project.icon,
      slug: project.slug,
      status: project.status,
      priority: project.priority,
      leadId: project.leadId,
      leadName: user.name,
      leadImage: user.image,
      startDate: project.startDate,
      targetDate: project.targetDate,
      createdAt: project.createdAt,
    })
    .from(project)
    .leftJoin(user, eq(project.leadId, user.id))
    .where(eq(project.workspaceId, workspaceId))
    .orderBy(project.createdAt);

  // Get issue counts per project for progress calculation
  const projectIds = projects.map((p) => p.id);
  const progressMap: Record<string, { total: number; completed: number }> = {};
  const projectTeamsMap: Record<
    string,
    { id: string; key: string; name: string }[]
  > = {};

  if (projectIds.length > 0) {
    const issueCounts = await db
      .select({
        projectId: issue.projectId,
        total: count(),
        completed: count(issue.completedAt),
      })
      .from(issue)
      .where(sql`${issue.projectId} IS NOT NULL`)
      .groupBy(issue.projectId);

    for (const row of issueCounts) {
      if (row.projectId) {
        progressMap[row.projectId] = {
          total: Number(row.total),
          completed: Number(row.completed),
        };
      }
    }

    const projectTeamRows = await db
      .select({
        projectId: projectTeam.projectId,
        teamId: team.id,
        teamKey: team.key,
        teamName: team.name,
      })
      .from(projectTeam)
      .innerJoin(team, eq(projectTeam.teamId, team.id))
      .where(inArray(projectTeam.projectId, projectIds));

    for (const row of projectTeamRows) {
      if (!projectTeamsMap[row.projectId]) {
        projectTeamsMap[row.projectId] = [];
      }

      projectTeamsMap[row.projectId].push({
        id: row.teamId,
        key: row.teamKey,
        name: row.teamName,
      });
    }
  }

  const result = projects.map((p) => {
    const prog = progressMap[p.id];
    const progress =
      prog && prog.total > 0
        ? Math.round((prog.completed / prog.total) * 100)
        : 0;

    return {
      id: p.id,
      name: p.name,
      description: p.description,
      icon: p.icon,
      slug: p.slug,
      status: p.status,
      priority: p.priority,
      health: "No updates",
      lead: p.leadName ? { name: p.leadName, image: p.leadImage } : null,
      teams: projectTeamsMap[p.id] ?? [],
      startDate: p.startDate,
      targetDate: p.targetDate,
      progress,
      createdAt: p.createdAt,
    };
  });

  return NextResponse.json({ projects: result });
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
  const name = `${body.name ?? ""}`.trim();
  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : null;

  if (!name) {
    return NextResponse.json(
      { error: "Project name is required" },
      { status: 400 },
    );
  }

  const slug = sanitizeProjectSlug(body.slug ?? name);

  if (!slug) {
    return NextResponse.json(
      { error: "Project name must include letters or numbers" },
      { status: 400 },
    );
  }

  let finalSlug = slug;
  let suffix = 2;
  const takenSlugs = new Set(
    (
      await db
        .select({ slug: project.slug })
        .from(project)
        .where(eq(project.workspaceId, workspaceId))
    ).map((row) => row.slug),
  );

  while (takenSlugs.has(finalSlug)) {
    finalSlug = `${slug}-${suffix}`;
    suffix += 1;
  }

  const [newProject] = await db
    .insert(project)
    .values({
      name,
      description,
      slug: finalSlug,
      workspaceId,
      leadId: session.user.id,
    })
    .returning();

  return NextResponse.json(newProject, { status: 201 });
}
