import { resolveRequestWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  initiative,
  initiativeProject,
  initiativeTeam,
  issue,
  member,
  project,
  team,
  user,
  workflowState,
  workspace,
} from "@/lib/db/schema";
import {
  createHeadlessInitiativesClient,
  headlessInitiativesEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import {
  type InitiativeHealth,
  type InitiativeUpdateHealth,
  isInitiativeHealth,
  makeInitiativeActivityEntry,
  makeInitiativeUpdateEntry,
  readInitiativeSettings,
} from "@/lib/initiative-detail";
import {
  type InitiativeHierarchyNode,
  getDescendantInitiativeIds,
  getInitiativeName,
  validateInitiativeParentLink,
} from "@/lib/initiative-hierarchy";
import { readWorkspaceInitiativeSettings } from "@/lib/initiative-settings";
import { and, count, eq, inArray, ne, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

function parseOptionalDate(value: unknown) {
  if (value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed;
}

function formatDateValue(value: Date | string | null | undefined) {
  if (!value) {
    return "";
  }
  return new Date(value).toISOString().slice(0, 10);
}

function describeValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "None";
  }
  return String(value);
}

function addActivity(
  settings: ReturnType<typeof readInitiativeSettings>,
  entry: Parameters<typeof makeInitiativeActivityEntry>[0],
) {
  settings.activity = [
    makeInitiativeActivityEntry(entry),
    ...settings.activity,
  ].slice(0, 50);
}

async function readCurrentWorkspaceInitiativeSettings(workspaceId: string) {
  const [workspaceRecord] = await db
    .select({ settings: workspace.settings })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);

  return readWorkspaceInitiativeSettings(workspaceRecord?.settings);
}

async function readWorkspaceInitiativeHierarchy(
  workspaceId: string,
): Promise<InitiativeHierarchyNode[]> {
  return db
    .select({
      id: initiative.id,
      name: initiative.name,
      parentInitiativeId: initiative.parentInitiativeId,
    })
    .from(initiative)
    .where(eq(initiative.workspaceId, workspaceId));
}

async function buildInitiativeDetailResponse(workspaceId: string, id: string) {
  const initiatives = await db
    .select()
    .from(initiative)
    .where(and(eq(initiative.id, id), eq(initiative.workspaceId, workspaceId)))
    .limit(1);

  if (initiatives.length === 0) {
    return null;
  }

  const init = initiatives[0];
  const settings = readInitiativeSettings(init.settings);

  const [ownerRows, teamRows, childRows, candidateRows, workspaceMembers] =
    await Promise.all([
      init.ownerId
        ? db
            .select({ id: user.id, name: user.name, image: user.image })
            .from(user)
            .where(eq(user.id, init.ownerId))
            .limit(1)
        : Promise.resolve([]),
      db
        .select({
          id: team.id,
          name: team.name,
          key: team.key,
          icon: team.icon,
        })
        .from(initiativeTeam)
        .innerJoin(team, eq(initiativeTeam.teamId, team.id))
        .where(eq(initiativeTeam.initiativeId, id)),
      db
        .select({
          id: initiative.id,
          name: initiative.name,
          status: initiative.status,
        })
        .from(initiative)
        .where(eq(initiative.parentInitiativeId, id)),
      db
        .select({
          id: initiative.id,
          name: initiative.name,
          parentInitiativeId: initiative.parentInitiativeId,
        })
        .from(initiative)
        .where(
          and(eq(initiative.workspaceId, workspaceId), ne(initiative.id, id)),
        ),
      db
        .select({ id: user.id, name: user.name, image: user.image })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(eq(member.workspaceId, workspaceId)),
    ]);

  const parentRows = init.parentInitiativeId
    ? await db
        .select({
          id: initiative.id,
          name: initiative.name,
          status: initiative.status,
        })
        .from(initiative)
        .where(
          and(
            eq(initiative.id, init.parentInitiativeId),
            eq(initiative.workspaceId, workspaceId),
          ),
        )
        .limit(1)
    : [];

  const workspaceTeams = await db
    .select({ id: team.id, name: team.name, key: team.key, icon: team.icon })
    .from(team)
    .where(eq(team.workspaceId, workspaceId));

  const linkedProjects = await db
    .select({
      id: project.id,
      name: project.name,
      status: project.status,
      icon: project.icon,
      slug: project.slug,
    })
    .from(initiativeProject)
    .innerJoin(project, eq(initiativeProject.projectId, project.id))
    .where(eq(initiativeProject.initiativeId, id));

  const linkedProjectIds = linkedProjects.map((proj) => proj.id);
  const totalIssueCounts = new Map<string, number>();
  const completedIssueCounts = new Map<string, number>();

  if (linkedProjectIds.length > 0) {
    const issueCounts = await db
      .select({
        projectId: issue.projectId,
        issueCount: count(),
      })
      .from(issue)
      .where(
        and(
          sql`${issue.projectId} IS NOT NULL`,
          inArray(issue.projectId, linkedProjectIds),
        ),
      )
      .groupBy(issue.projectId);

    for (const row of issueCounts) {
      if (row.projectId) {
        totalIssueCounts.set(row.projectId, Number(row.issueCount));
      }
    }

    const completedStates = await db
      .select({ id: workflowState.id })
      .from(workflowState)
      .where(eq(workflowState.category, "completed"));
    const completedStateIds = completedStates.map((state) => state.id);

    if (completedStateIds.length > 0) {
      const completedCounts = await db
        .select({
          projectId: issue.projectId,
          issueCount: count(),
        })
        .from(issue)
        .where(
          and(
            sql`${issue.projectId} IS NOT NULL`,
            inArray(issue.projectId, linkedProjectIds),
            inArray(issue.stateId, completedStateIds),
          ),
        )
        .groupBy(issue.projectId);

      for (const row of completedCounts) {
        if (row.projectId) {
          completedIssueCounts.set(row.projectId, Number(row.issueCount));
        }
      }
    }
  }

  const projectsWithProgress = linkedProjects.map((linkedProject) => ({
    ...linkedProject,
    issueCount: totalIssueCounts.get(linkedProject.id) ?? 0,
    completedIssueCount: completedIssueCounts.get(linkedProject.id) ?? 0,
  }));

  const availableProjects = (
    await db
      .select({
        id: project.id,
        name: project.name,
        icon: project.icon,
        slug: project.slug,
        status: project.status,
      })
      .from(project)
      .where(eq(project.workspaceId, workspaceId))
      .orderBy(project.createdAt)
  ).filter(
    (workspaceProject) => !linkedProjectIds.includes(workspaceProject.id),
  );

  const childIds = new Set(childRows.map((child) => child.id));
  const descendantIds = getDescendantInitiativeIds(
    [
      ...candidateRows,
      {
        id: init.id,
        name: init.name,
        parentInitiativeId: init.parentInitiativeId,
      },
    ],
    id,
  );

  return {
    initiative: {
      ...init,
      owner: ownerRows[0] ?? null,
      teams: teamRows,
      parentInitiative: parentRows[0] ?? null,
      childInitiatives: childRows,
      projectCount: projectsWithProgress.length,
      completedProjectCount: projectsWithProgress.filter(
        (proj) => proj.status === "completed",
      ).length,
    },
    projects: projectsWithProgress,
    availableProjects,
    workspaceMembers,
    workspaceTeams,
    availableParentInitiatives: candidateRows.filter(
      (candidate) =>
        !childIds.has(candidate.id) && !descendantIds.has(candidate.id),
    ),
    updates: settings.updates,
    activity: settings.activity,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { id } = await params;
  const workspaceId = await resolveRequestWorkspaceId(session.user.id, request);

  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  if (headlessInitiativesEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId,
    });
    const client = createHeadlessInitiativesClient(token);
    const { data, error, response } = await client.GET("/initiatives/{id}", {
      params: { path: { id } },
    });
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const initiativeSettings =
    await readCurrentWorkspaceInitiativeSettings(workspaceId);
  if (!initiativeSettings.enabled) {
    return NextResponse.json(
      { error: "Initiatives are disabled for this workspace" },
      { status: 403 },
    );
  }

  const detail = await buildInitiativeDetailResponse(workspaceId, id);
  if (!detail) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(detail);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { id } = await params;
  const workspaceId = await resolveRequestWorkspaceId(session.user.id, request);
  const body = await request.json();

  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  if (headlessInitiativesEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId,
    });
    const client = createHeadlessInitiativesClient(token);
    const { data, error, response } = await client.PATCH("/initiatives/{id}", {
      params: { path: { id } },
      body,
    });
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const initiativeSettings =
    await readCurrentWorkspaceInitiativeSettings(workspaceId);
  if (!initiativeSettings.enabled) {
    return NextResponse.json(
      { error: "Initiatives are disabled for this workspace" },
      { status: 403 },
    );
  }

  const existing = await db
    .select()
    .from(initiative)
    .where(and(eq(initiative.id, id), eq(initiative.workspaceId, workspaceId)))
    .limit(1);

  if (existing.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const currentInitiative = existing[0];
  const hierarchy = await readWorkspaceInitiativeHierarchy(workspaceId);
  const currentSettings = readInitiativeSettings(currentInitiative.settings);
  const nextSettings = {
    ...currentSettings,
    updates: [...currentSettings.updates],
    activity: [...currentSettings.activity],
  };
  const updateData: Record<string, unknown> = {};
  let settingsChanged = false;

  const actor = {
    actorName: session.user.name,
    actorImage: session.user.image ?? null,
  };

  function recordPropertyChange(label: string, from: unknown, to: unknown) {
    addActivity(nextSettings, {
      type: "property_change",
      message: `${label} changed from ${describeValue(from)} to ${describeValue(to)}`,
      ...actor,
    });
    settingsChanged = true;
  }

  if (body.name !== undefined) {
    const name = `${body.name ?? ""}`.trim();
    if (!name) {
      return NextResponse.json(
        { error: "Initiative name is required" },
        { status: 400 },
      );
    }
    if (name !== currentInitiative.name) {
      updateData.name = name;
      recordPropertyChange("Name", currentInitiative.name, name);
    }
  }

  if (body.description !== undefined) {
    const description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;
    if (description !== currentInitiative.description) {
      updateData.description = description;
      recordPropertyChange(
        "Description",
        currentInitiative.description,
        description,
      );
    }
  }

  if (body.status !== undefined) {
    if (
      body.status !== "active" &&
      body.status !== "planned" &&
      body.status !== "completed"
    ) {
      return NextResponse.json(
        { error: "Invalid initiative status" },
        { status: 400 },
      );
    }
    if (body.status !== currentInitiative.status) {
      updateData.status = body.status;
      recordPropertyChange("Status", currentInitiative.status, body.status);
    }
  }

  if (body.health !== undefined) {
    if (!isInitiativeHealth(body.health)) {
      return NextResponse.json(
        { error: "Invalid initiative health" },
        { status: 400 },
      );
    }
    const health = body.health satisfies InitiativeHealth;
    if (health !== currentInitiative.health) {
      updateData.health = health;
      recordPropertyChange("Health", currentInitiative.health, health);
    }
  }

  if (body.timeframe !== undefined) {
    const timeframe =
      typeof body.timeframe === "string" && body.timeframe.trim()
        ? body.timeframe.trim().slice(0, 120)
        : null;
    if (timeframe !== currentInitiative.timeframe) {
      updateData.timeframe = timeframe;
      recordPropertyChange("Timeframe", currentInitiative.timeframe, timeframe);
    }
  }

  if (body.startDate !== undefined) {
    const startDate = parseOptionalDate(body.startDate);
    if (startDate === undefined) {
      return NextResponse.json(
        { error: "Invalid start date" },
        { status: 400 },
      );
    }
    if (
      formatDateValue(startDate) !==
      formatDateValue(currentInitiative.startDate)
    ) {
      updateData.startDate = startDate;
      recordPropertyChange(
        "Start date",
        formatDateValue(currentInitiative.startDate),
        formatDateValue(startDate),
      );
    }
  }

  if (body.targetDate !== undefined) {
    const targetDate = parseOptionalDate(body.targetDate);
    if (targetDate === undefined) {
      return NextResponse.json(
        { error: "Invalid target date" },
        { status: 400 },
      );
    }
    if (
      formatDateValue(targetDate) !==
      formatDateValue(currentInitiative.targetDate)
    ) {
      updateData.targetDate = targetDate;
      recordPropertyChange(
        "Target date",
        formatDateValue(currentInitiative.targetDate),
        formatDateValue(targetDate),
      );
    }
  }

  if (body.ownerId !== undefined) {
    const ownerId =
      typeof body.ownerId === "string" && body.ownerId.trim()
        ? body.ownerId.trim()
        : null;
    if (ownerId) {
      const owners = await db
        .select({ id: member.id })
        .from(member)
        .where(
          and(eq(member.workspaceId, workspaceId), eq(member.userId, ownerId)),
        )
        .limit(1);
      if (owners.length === 0) {
        return NextResponse.json({ error: "Owner not found" }, { status: 404 });
      }
    }
    if (ownerId !== currentInitiative.ownerId) {
      updateData.ownerId = ownerId;
      recordPropertyChange("Owner", currentInitiative.ownerId, ownerId);
    }
  }

  if (body.parentInitiativeId !== undefined) {
    const parentInitiativeId =
      typeof body.parentInitiativeId === "string" &&
      body.parentInitiativeId.trim()
        ? body.parentInitiativeId.trim()
        : null;
    if (parentInitiativeId) {
      const parent = hierarchy.find(
        (initiative) => initiative.id === parentInitiativeId,
      );
      if (!parent) {
        return NextResponse.json(
          { error: "Parent initiative not found" },
          { status: 404 },
        );
      }
    }
    const hierarchyValidation = validateInitiativeParentLink(
      hierarchy,
      id,
      parentInitiativeId,
    );
    if (!hierarchyValidation.ok) {
      return NextResponse.json(
        { error: hierarchyValidation.error },
        { status: 400 },
      );
    }
    if (parentInitiativeId !== currentInitiative.parentInitiativeId) {
      updateData.parentInitiativeId = parentInitiativeId;
      const previousParentName = getInitiativeName(
        hierarchy,
        currentInitiative.parentInitiativeId,
      );
      const nextParentName = getInitiativeName(hierarchy, parentInitiativeId);
      addActivity(nextSettings, {
        type: "property_change",
        message: parentInitiativeId
          ? `Set parent initiative to ${nextParentName}`
          : `Cleared parent initiative ${previousParentName}`,
        ...actor,
      });
      settingsChanged = true;
    }
  }

  const teamIds = Array.isArray(body.teamIds)
    ? body.teamIds.filter(
        (teamId: unknown): teamId is string => typeof teamId === "string",
      )
    : null;

  if (teamIds) {
    const uniqueTeamIds: string[] = Array.from(new Set(teamIds));
    if (uniqueTeamIds.length > 0) {
      const matchingTeams = await db
        .select({ id: team.id })
        .from(team)
        .where(
          and(
            eq(team.workspaceId, workspaceId),
            inArray(team.id, uniqueTeamIds),
          ),
        );
      if (matchingTeams.length !== uniqueTeamIds.length) {
        return NextResponse.json({ error: "Team not found" }, { status: 404 });
      }
    }
    addActivity(nextSettings, {
      type: "property_change",
      message:
        uniqueTeamIds.length > 0
          ? `Teams updated (${uniqueTeamIds.length} selected)`
          : "Teams cleared",
      ...actor,
    });
    settingsChanged = true;
  }

  const childInitiativeId =
    typeof body.childInitiativeId === "string" && body.childInitiativeId.trim()
      ? body.childInitiativeId.trim()
      : null;
  const removeChildInitiativeId =
    typeof body.removeChildInitiativeId === "string" &&
    body.removeChildInitiativeId.trim()
      ? body.removeChildInitiativeId.trim()
      : null;

  if (childInitiativeId) {
    const child = hierarchy.find(
      (initiative) => initiative.id === childInitiativeId,
    );
    if (!child) {
      return NextResponse.json(
        { error: "Child initiative not found" },
        { status: 404 },
      );
    }
    const hierarchyValidation = validateInitiativeParentLink(
      hierarchy,
      childInitiativeId,
      id,
    );
    if (!hierarchyValidation.ok) {
      return NextResponse.json(
        { error: hierarchyValidation.error },
        { status: 400 },
      );
    }
    addActivity(nextSettings, {
      type: "property_change",
      message: `Added child initiative ${child.name ?? childInitiativeId}`,
      ...actor,
    });
    settingsChanged = true;
  }

  if (removeChildInitiativeId) {
    const child = hierarchy.find(
      (initiative) => initiative.id === removeChildInitiativeId,
    );
    if (!child) {
      return NextResponse.json(
        { error: "Child initiative not found" },
        { status: 404 },
      );
    }
    if (child.parentInitiativeId !== id) {
      return NextResponse.json(
        { error: "Child initiative link not found" },
        { status: 404 },
      );
    }
    addActivity(nextSettings, {
      type: "property_change",
      message: `Removed child initiative ${child.name ?? removeChildInitiativeId}`,
      ...actor,
    });
    settingsChanged = true;
  }

  if (body.initiativeUpdate !== undefined) {
    const initiativeUpdate =
      typeof body.initiativeUpdate === "string"
        ? body.initiativeUpdate.trim()
        : "";
    const updateHealth =
      body.updateHealth === "atRisk" || body.updateHealth === "offTrack"
        ? (body.updateHealth as InitiativeUpdateHealth)
        : "onTrack";

    if (!initiativeUpdate) {
      return NextResponse.json(
        { error: "Initiative update is required" },
        { status: 400 },
      );
    }

    nextSettings.updates = [
      makeInitiativeUpdateEntry({
        health: updateHealth,
        body: initiativeUpdate,
        ...actor,
      }),
      ...nextSettings.updates,
    ].slice(0, 25);
    updateData.health = updateHealth;
    updateData.settings = nextSettings;
    settingsChanged = true;
  }

  const addProjectId =
    typeof body.addProjectId === "string" ? body.addProjectId : null;
  const removeProjectId =
    typeof body.removeProjectId === "string" ? body.removeProjectId : null;
  let projectActivityMessage: string | null = null;
  let projectActivityType: "project_linked" | "project_unlinked" | null = null;

  if (addProjectId) {
    const matchingProjects = await db
      .select({ id: project.id, name: project.name })
      .from(project)
      .where(
        and(eq(project.id, addProjectId), eq(project.workspaceId, workspaceId)),
      )
      .limit(1);

    if (matchingProjects.length === 0) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    projectActivityType = "project_linked";
    projectActivityMessage = `Linked project ${matchingProjects[0].name}`;
  }

  if (removeProjectId) {
    const matchingLinks = await db
      .select({ id: initiativeProject.id, projectName: project.name })
      .from(initiativeProject)
      .innerJoin(project, eq(initiativeProject.projectId, project.id))
      .where(
        and(
          eq(initiativeProject.initiativeId, id),
          eq(initiativeProject.projectId, removeProjectId),
        ),
      )
      .limit(1);

    if (matchingLinks.length === 0) {
      return NextResponse.json(
        { error: "Linked project not found" },
        { status: 404 },
      );
    }
    projectActivityType = "project_unlinked";
    projectActivityMessage = `Unlinked project ${matchingLinks[0].projectName}`;
  }

  if (projectActivityMessage && projectActivityType) {
    addActivity(nextSettings, {
      type: projectActivityType,
      message: projectActivityMessage,
      ...actor,
    });
    settingsChanged = true;
  }

  if (settingsChanged) {
    updateData.settings = nextSettings;
  }

  const shouldUpdateInitiative =
    Object.keys(updateData).length > 0 ||
    Boolean(
      addProjectId ||
        removeProjectId ||
        childInitiativeId ||
        removeChildInitiativeId ||
        teamIds,
    );

  if (!shouldUpdateInitiative) {
    const unchanged = await buildInitiativeDetailResponse(workspaceId, id);
    return NextResponse.json(unchanged);
  }

  await db.transaction(async (tx) => {
    if (addProjectId) {
      const existingLink = await tx
        .select({ id: initiativeProject.id })
        .from(initiativeProject)
        .where(
          and(
            eq(initiativeProject.initiativeId, id),
            eq(initiativeProject.projectId, addProjectId),
          ),
        )
        .limit(1);

      if (existingLink.length === 0) {
        await tx.insert(initiativeProject).values({
          initiativeId: id,
          projectId: addProjectId,
        });
      }
    }

    if (removeProjectId) {
      await tx
        .delete(initiativeProject)
        .where(
          and(
            eq(initiativeProject.initiativeId, id),
            eq(initiativeProject.projectId, removeProjectId),
          ),
        );
    }

    if (teamIds) {
      const uniqueTeamIds: string[] = Array.from(new Set(teamIds));
      await tx
        .delete(initiativeTeam)
        .where(eq(initiativeTeam.initiativeId, id));
      if (uniqueTeamIds.length > 0) {
        await tx
          .insert(initiativeTeam)
          .values(
            uniqueTeamIds.map((teamId) => ({ initiativeId: id, teamId })),
          );
      }
    }

    if (childInitiativeId) {
      await tx
        .update(initiative)
        .set({ parentInitiativeId: id, updatedAt: new Date() })
        .where(
          and(
            eq(initiative.id, childInitiativeId),
            eq(initiative.workspaceId, workspaceId),
          ),
        );
    }

    if (removeChildInitiativeId) {
      await tx
        .update(initiative)
        .set({ parentInitiativeId: null, updatedAt: new Date() })
        .where(
          and(
            eq(initiative.id, removeChildInitiativeId),
            eq(initiative.parentInitiativeId, id),
            eq(initiative.workspaceId, workspaceId),
          ),
        );
    }

    if (Object.keys(updateData).length > 0) {
      await tx
        .update(initiative)
        .set({ ...updateData, updatedAt: new Date() })
        .where(
          and(eq(initiative.id, id), eq(initiative.workspaceId, workspaceId)),
        );
    }
  });

  const updated = await buildInitiativeDetailResponse(workspaceId, id);
  return NextResponse.json(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { id } = await params;
  const workspaceId = await resolveRequestWorkspaceId(session.user.id, request);

  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  if (headlessInitiativesEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId,
    });
    const client = createHeadlessInitiativesClient(token);
    const { data, error, response } = await client.DELETE("/initiatives/{id}", {
      params: { path: { id } },
    });
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const initiativeSettings =
    await readCurrentWorkspaceInitiativeSettings(workspaceId);
  if (!initiativeSettings.enabled) {
    return NextResponse.json(
      { error: "Initiatives are disabled for this workspace" },
      { status: 403 },
    );
  }

  const deleted = await db
    .delete(initiative)
    .where(and(eq(initiative.id, id), eq(initiative.workspaceId, workspaceId)))
    .returning();

  if (deleted.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
