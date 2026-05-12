import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  initiative,
  initiativeProject,
  issue,
  member,
  project,
  workflowState,
} from "@/lib/db/schema";
import {
  type InitiativeUpdateHealth,
  makeInitiativeUpdateEntry,
  readInitiativeSettings,
} from "@/lib/initiative-detail";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
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

  return {
    initiative: {
      ...init,
      projectCount: projectsWithProgress.length,
      completedProjectCount: projectsWithProgress.filter(
        (proj) => proj.status === "completed",
      ).length,
    },
    projects: projectsWithProgress,
    availableProjects,
    updates: settings.updates,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { id } = await params;
  const workspaceId = await resolveWorkspaceId(session.user.id);

  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
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
  const workspaceId = await resolveWorkspaceId(session.user.id);
  const body = await request.json();

  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
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
  const currentSettings = readInitiativeSettings(currentInitiative.settings);
  const nextSettings = {
    ...currentSettings,
    updates: [...currentSettings.updates],
  };
  const updateData: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = `${body.name ?? ""}`.trim();
    if (!name) {
      return NextResponse.json(
        { error: "Initiative name is required" },
        { status: 400 },
      );
    }
    updateData.name = name;
  }

  if (body.description !== undefined) {
    updateData.description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;
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
    updateData.status = body.status;
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
        actorName: session.user.name,
        actorImage: session.user.image ?? null,
      }),
      ...nextSettings.updates,
    ].slice(0, 25);
    updateData.settings = nextSettings;
  }

  const addProjectId =
    typeof body.addProjectId === "string" ? body.addProjectId : null;
  const removeProjectId =
    typeof body.removeProjectId === "string" ? body.removeProjectId : null;

  if (addProjectId) {
    const matchingProjects = await db
      .select({ id: project.id })
      .from(project)
      .where(
        and(eq(project.id, addProjectId), eq(project.workspaceId, workspaceId)),
      )
      .limit(1);

    if (matchingProjects.length === 0) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
  }

  if (removeProjectId) {
    const matchingLinks = await db
      .select({ id: initiativeProject.id })
      .from(initiativeProject)
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
  }

  const shouldUpdateInitiative =
    Object.keys(updateData).length > 0 ||
    Boolean(addProjectId || removeProjectId);

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
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { id } = await params;
  const workspaceId = await resolveWorkspaceId(session.user.id);

  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
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
