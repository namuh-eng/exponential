import {
  resolveActiveWorkspaceId,
  resolveRequestWorkspaceId,
} from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  issue,
  project,
  projectLabel,
  projectTeam,
  team,
  user,
} from "@/lib/db/schema";
import { readProjectSettings } from "@/lib/project-detail";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
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

async function resolveProjectsWorkspaceId(userId: string, request?: Request) {
  return request
    ? resolveRequestWorkspaceId(userId, request)
    : resolveActiveWorkspaceId(userId);
}

export async function GET(request?: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const workspaceId = await resolveProjectsWorkspaceId(
    session.user.id,
    request,
  );
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
      settings: project.settings,
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
  const projectLabelsMap: Record<
    string,
    { id: string; name: string; color: string }[]
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

    const selectedProjectLabelIds = [
      ...new Set(
        projects.flatMap((p) => readProjectSettings(p.settings).labelIds),
      ),
    ];
    if (selectedProjectLabelIds.length > 0) {
      const projectLabelRows = await db
        .select({
          id: projectLabel.id,
          name: projectLabel.name,
          color: projectLabel.color,
        })
        .from(projectLabel)
        .where(
          and(
            eq(projectLabel.workspaceId, workspaceId),
            inArray(projectLabel.id, selectedProjectLabelIds),
          ),
        );
      const labelsById = new Map(
        projectLabelRows.map((label) => [label.id, label]),
      );

      for (const p of projects) {
        projectLabelsMap[p.id] = readProjectSettings(p.settings)
          .labelIds.map((labelId) => labelsById.get(labelId))
          .filter(
            (label): label is { id: string; name: string; color: string } =>
              Boolean(label),
          );
      }
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
      labels: projectLabelsMap[p.id] ?? [],
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

  const workspaceId = await resolveRequestWorkspaceId(session.user.id, request);
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

  const requestedTeamKeys = [
    typeof body.teamKey === "string" ? body.teamKey.trim() : null,
    ...(Array.isArray(body.teamKeys)
      ? body.teamKeys.map((value: unknown) =>
          typeof value === "string" ? value.trim() : null,
        )
      : []),
  ].filter((value): value is string => Boolean(value));
  const requestedTeamIds = [
    typeof body.teamId === "string" ? body.teamId.trim() : null,
    ...(Array.isArray(body.teamIds)
      ? body.teamIds.map((value: unknown) =>
          typeof value === "string" ? value.trim() : null,
        )
      : []),
  ].filter((value): value is string => Boolean(value));
  const requestedLabelIds: string[] = Array.isArray(body.labelIds)
    ? Array.from(
        new Set(
          (body.labelIds as unknown[]).filter(
            (value): value is string => typeof value === "string",
          ),
        ),
      )
    : [];

  const linkedTeamsById = new Map<
    string,
    { id: string; key: string; name: string }
  >();

  for (const teamKey of new Set(requestedTeamKeys)) {
    const teamRows = await db
      .select({ id: team.id, key: team.key, name: team.name })
      .from(team)
      .where(and(eq(team.workspaceId, workspaceId), eq(team.key, teamKey)))
      .limit(1);

    const teamRecord = teamRows[0] ?? null;
    if (!teamRecord) {
      return NextResponse.json(
        { error: "Team not found in active workspace" },
        { status: 400 },
      );
    }

    linkedTeamsById.set(teamRecord.id, teamRecord);
  }

  for (const teamId of new Set(requestedTeamIds)) {
    const teamRows = await db
      .select({ id: team.id, key: team.key, name: team.name })
      .from(team)
      .where(and(eq(team.workspaceId, workspaceId), eq(team.id, teamId)))
      .limit(1);

    const teamRecord = teamRows[0] ?? null;
    if (!teamRecord) {
      return NextResponse.json(
        { error: "Team not found in active workspace" },
        { status: 400 },
      );
    }

    linkedTeamsById.set(teamRecord.id, teamRecord);
  }

  const linkedLabelIds = new Set<string>();
  if (requestedLabelIds.length > 0) {
    const labelRows = await db
      .select({ id: projectLabel.id })
      .from(projectLabel)
      .where(
        and(
          eq(projectLabel.workspaceId, workspaceId),
          inArray(projectLabel.id, requestedLabelIds),
        ),
      );

    for (const labelRow of labelRows) {
      linkedLabelIds.add(labelRow.id);
    }

    if (linkedLabelIds.size !== requestedLabelIds.length) {
      return NextResponse.json(
        { error: "Project label not found in active workspace" },
        { status: 400 },
      );
    }
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

  const linkedTeams = Array.from(linkedTeamsById.values());
  const newProject = await db.transaction(async (tx) => {
    const [createdProject] = await tx
      .insert(project)
      .values({
        name,
        description,
        slug: finalSlug,
        workspaceId,
        leadId: session.user.id,
        settings:
          linkedLabelIds.size > 0
            ? { labelIds: Array.from(linkedLabelIds) }
            : undefined,
      })
      .returning();

    if (linkedTeams.length > 0) {
      await tx.insert(projectTeam).values(
        linkedTeams.map((linkedTeam) => ({
          projectId: createdProject.id,
          teamId: linkedTeam.id,
        })),
      );
    }

    return createdProject;
  });

  return NextResponse.json(
    { ...newProject, teams: linkedTeams },
    { status: 201 },
  );
}
