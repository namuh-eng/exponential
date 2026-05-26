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
  projectMilestone,
  projectTeam,
  projectTemplate,
  team,
  user,
  workspace,
} from "@/lib/db/schema";
import {
  createHeadlessProjectsClient,
  headlessProjectsEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import { readProjectSettings } from "@/lib/project-detail";
import {
  findProjectStatusConfig,
  isDefaultProjectStatusKey,
  readProjectStatusSettings,
} from "@/lib/project-status-settings";
import { readProjectTemplateSettings } from "@/lib/project-template-settings";
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

  if (headlessProjectsEnabled()) {
    const workspaceId = await resolveProjectsWorkspaceId(
      session.user.id,
      request,
    );
    if (workspaceId) {
      const token = await mintInternalApiToken({
        userId: session.user.id,
        workspaceId,
      });
      const client = createHeadlessProjectsClient(token);
      const { data, error, response } = await client.GET("/projects");
      if (error) {
        return NextResponse.json(error, {
          status: (response as Response).status,
        });
      }
      return NextResponse.json(data, { status: (response as Response).status });
    }
  }

  const workspaceId = await resolveProjectsWorkspaceId(
    session.user.id,
    request,
  );
  if (!workspaceId) {
    return NextResponse.json({ projects: [] });
  }

  const workspaceRows = await db
    .select({ settings: workspace.settings })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  const workspaceSettings = workspaceRows[0]?.settings ?? {};

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
    const projectSettings = readProjectSettings(p.settings);
    const statusConfig =
      findProjectStatusConfig(
        workspaceSettings,
        projectSettings.projectStatusKey,
      ) ?? findProjectStatusConfig(workspaceSettings, p.status);
    const effectiveStatus = statusConfig?.key ?? p.status;
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
      status: effectiveStatus,
      statusLabel:
        statusConfig?.name ??
        p.status.replace(/^./, (char) => char.toUpperCase()),
      statusColor: statusConfig?.color ?? "#6b6f76",
      statusIcon: statusConfig?.icon ?? "•",
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

  if (headlessProjectsEnabled()) {
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
      const client = createHeadlessProjectsClient(token);
      const { data, error, response } = await client.POST("/projects", {
        body: body as never,
      });
      if (error) {
        return NextResponse.json(error, {
          status: (response as Response).status,
        });
      }
      return NextResponse.json(data, { status: (response as Response).status });
    }
  }

  const workspaceId = await resolveRequestWorkspaceId(session.user.id, request);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  const workspaceRows = await db
    .select({ settings: workspace.settings })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  const workspaceSettings = workspaceRows[0]?.settings ?? {};

  const body = await request.json();
  const templateId =
    typeof body.templateId === "string" && body.templateId.trim()
      ? body.templateId.trim()
      : null;
  const selectedTemplate = templateId
    ? (
        await db
          .select({
            id: projectTemplate.id,
            description: projectTemplate.description,
            settings: projectTemplate.settings,
          })
          .from(projectTemplate)
          .where(
            and(
              eq(projectTemplate.workspaceId, workspaceId),
              eq(projectTemplate.id, templateId),
            ),
          )
          .limit(1)
      )[0]
    : null;

  if (templateId && !selectedTemplate) {
    return NextResponse.json(
      { error: "Project template not found in active workspace" },
      { status: 400 },
    );
  }

  const templateSettings = readProjectTemplateSettings(
    selectedTemplate?.settings,
  );
  const name = `${body.name ?? ""}`.trim();
  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : selectedTemplate?.description || null;
  const requestedStatus =
    typeof body.status === "string" && body.status.trim()
      ? body.status.trim()
      : "planned";
  const configuredStatusKeys = new Set(
    readProjectStatusSettings(workspaceSettings).map((status) => status.key),
  );

  if (!configuredStatusKeys.has(requestedStatus)) {
    return NextResponse.json(
      { error: "Project status is not configured for this workspace" },
      { status: 400 },
    );
  }

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
  const requestedMilestones = [
    ...templateSettings.milestones.map((name) => ({
      name,
      description: null as string | null,
    })),
    ...(Array.isArray(body.projectMilestones)
      ? (body.projectMilestones as unknown[])
          .map((value) => {
            if (typeof value === "string") {
              return { name: value.trim(), description: null };
            }
            if (
              typeof value !== "object" ||
              value === null ||
              Array.isArray(value)
            ) {
              return null;
            }
            const record = value as Record<string, unknown>;
            const milestoneName =
              typeof record.name === "string" ? record.name.trim() : "";
            const milestoneDescription =
              typeof record.description === "string" &&
              record.description.trim()
                ? record.description.trim()
                : typeof record.descriptionData === "string" &&
                    record.descriptionData.trim()
                  ? record.descriptionData.trim()
                  : null;
            return milestoneName
              ? { name: milestoneName, description: milestoneDescription }
              : null;
          })
          .filter(
            (value): value is { name: string; description: string | null } =>
              Boolean(value),
          )
      : []),
  ].filter(
    (milestone, index, milestones) =>
      milestones.findIndex((item) => item.name === milestone.name) === index,
  );

  const requestedLabelIds: string[] = Array.from(
    new Set([
      ...templateSettings.labelIds,
      ...(Array.isArray(body.labelIds)
        ? (body.labelIds as unknown[]).filter(
            (value): value is string => typeof value === "string",
          )
        : []),
    ]),
  );

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
        priority: templateSettings.priority ?? undefined,
        workspaceId,
        leadId: session.user.id,
        status: isDefaultProjectStatusKey(requestedStatus)
          ? requestedStatus
          : "planned",
        settings:
          linkedLabelIds.size > 0 || !isDefaultProjectStatusKey(requestedStatus)
            ? {
                ...(linkedLabelIds.size > 0
                  ? { labelIds: Array.from(linkedLabelIds) }
                  : {}),
                ...(!isDefaultProjectStatusKey(requestedStatus)
                  ? { projectStatusKey: requestedStatus }
                  : {}),
              }
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

    if (requestedMilestones.length > 0) {
      const milestoneValues = requestedMilestones.map((milestone, index) => ({
        projectId: createdProject.id,
        name: milestone.name,
        sortOrder: index,
      }));
      const hasMilestoneDescriptions = requestedMilestones.some(
        (milestone) => milestone.description,
      );

      if (hasMilestoneDescriptions) {
        const insertedMilestones = await tx
          .insert(projectMilestone)
          .values(milestoneValues)
          .returning({ id: projectMilestone.id });

        const milestoneDescriptions = Object.fromEntries(
          insertedMilestones.flatMap((milestone, index) => {
            const description = requestedMilestones[index]?.description;
            return description ? [[milestone.id, description]] : [];
          }),
        );

        await tx
          .update(project)
          .set({
            settings: {
              ...(linkedLabelIds.size > 0
                ? { labelIds: Array.from(linkedLabelIds) }
                : {}),
              milestoneDescriptions,
            },
          })
          .where(eq(project.id, createdProject.id));
      } else {
        await tx.insert(projectMilestone).values(milestoneValues);
      }
    }

    return createdProject;
  });

  return NextResponse.json(
    {
      ...newProject,
      teams: linkedTeams,
      appliedTemplateId: selectedTemplate?.id ?? null,
      appliedMilestones: requestedMilestones.map((milestone) => milestone.name),
    },
    { status: 201 },
  );
}
