import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { type ApiSession, requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  member,
  team,
  teamMember,
  workflowState,
  workspace,
} from "@/lib/db/schema";
import { activeTeamFilter } from "@/lib/team-lifecycle";
import {
  generateTeamKey,
  getDefaultWorkflowStates,
} from "@/lib/workspace-creation";
import {
  canPerformWorkspacePermission,
  isWorkspaceAdminRole,
  readWorkspacePermissionSettings,
} from "@/lib/workspace-permissions";
import { and, asc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

const MAX_TEAM_NAME_LENGTH = 255;
const MAX_TEAM_KEY_LENGTH = 10;

type WorkspaceAccess = {
  workspaceId: string;
  role: string;
  settings: unknown;
};

function canCreateTeams(role: string | undefined, settings: unknown) {
  return canPerformWorkspacePermission(
    role,
    readWorkspacePermissionSettings(settings).teamCreationRole,
  );
}

async function getWorkspaceAccess(
  session: ApiSession,
): Promise<WorkspaceAccess | null> {
  const apiWorkspaceId =
    "apiKey" in session ? session.apiKey.workspaceId : null;
  const workspaceId =
    apiWorkspaceId ?? (await resolveActiveWorkspaceId(session.user.id));
  if (!workspaceId) {
    return null;
  }

  const [access] = await db
    .select({ role: member.role, settings: workspace.settings })
    .from(member)
    .innerJoin(workspace, eq(workspace.id, member.workspaceId))
    .where(
      and(
        eq(member.workspaceId, workspaceId),
        eq(member.userId, session.user.id),
      ),
    )
    .limit(1);

  if (access) {
    return { workspaceId, role: access.role, settings: access.settings };
  }

  if ("apiKey" in session && session.apiKey.workspaceId === workspaceId) {
    const [apiWorkspace] = await db
      .select({ settings: workspace.settings })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1);

    return apiWorkspace
      ? {
          workspaceId,
          role: session.apiKey.memberRole,
          settings: apiWorkspace.settings,
        }
      : null;
  }

  return null;
}

function normalizeTeamName(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTeamKey(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toUpperCase();
}

function validateTeamName(name: string) {
  if (!name) return "Team name is required";
  if (name.length > MAX_TEAM_NAME_LENGTH) {
    return `Team name must be ${MAX_TEAM_NAME_LENGTH} characters or fewer`;
  }
  return null;
}

function validateTeamKey(key: string) {
  if (!key) return "Team key is required";
  if (key.length > MAX_TEAM_KEY_LENGTH) {
    return `Team key must be ${MAX_TEAM_KEY_LENGTH} characters or fewer`;
  }
  if (!/^[A-Z][A-Z0-9]*$/.test(key)) {
    return "Team key must start with a letter and only contain letters or numbers";
  }
  return null;
}

async function listTeams(access: WorkspaceAccess, userId: string) {
  const { workspaceId, role } = access;
  const teams = await db
    .select({
      id: team.id,
      name: team.name,
      key: team.key,
      icon: team.icon,
      isPrivate: team.isPrivate,
      issueCount: team.issueCount,
      createdAt: team.createdAt,
      retiredAt: team.retiredAt,
    })
    .from(team)
    .where(and(eq(team.workspaceId, workspaceId), activeTeamFilter))
    .orderBy(asc(team.name), asc(team.key));

  const teamIds = teams.map((entry) => entry.id);
  const memberships =
    teamIds.length === 0
      ? []
      : await db
          .select({ teamId: teamMember.teamId, userId: teamMember.userId })
          .from(teamMember)
          .where(inArray(teamMember.teamId, teamIds));

  const memberCountsByTeamId = new Map<string, number>();
  const currentUserTeamIds = new Set<string>();
  for (const membership of memberships) {
    memberCountsByTeamId.set(
      membership.teamId,
      (memberCountsByTeamId.get(membership.teamId) ?? 0) + 1,
    );
    if (membership.userId === userId) {
      currentUserTeamIds.add(membership.teamId);
    }
  }

  const visibleTeams = teams.filter(
    (entry) =>
      !entry.isPrivate ||
      currentUserTeamIds.has(entry.id) ||
      isWorkspaceAdminRole(role),
  );

  return {
    workspaceId,
    viewerRole: role,
    canManageTeams: canCreateTeams(role, access.settings),
    teams: visibleTeams.map((entry) => ({
      ...entry,
      memberCount: memberCountsByTeamId.get(entry.id) ?? 0,
      currentUserIsMember: currentUserTeamIds.has(entry.id),
      createdAt: entry.createdAt?.toISOString() ?? new Date(0).toISOString(),
      retiredAt: entry.retiredAt?.toISOString() ?? null,
    })),
  };
}

export async function GET() {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const access = await getWorkspaceAccess(session);
  if (!access) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  return NextResponse.json(await listTeams(access, session.user.id));
}

export async function POST(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const access = await getWorkspaceAccess(session);
  if (!access) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  if (!canCreateTeams(access.role, access.settings)) {
    return NextResponse.json(
      { error: "You do not have permission to create teams" },
      { status: 403 },
    );
  }

  let body: {
    name?: unknown;
    key?: unknown;
    isPrivate?: unknown;
    icon?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = normalizeTeamName(body.name);
  const nameError = validateTeamName(name);
  if (nameError) {
    return NextResponse.json({ error: nameError }, { status: 400 });
  }

  const existingTeamKeys = await db
    .select({ key: team.key })
    .from(team)
    .where(eq(team.workspaceId, access.workspaceId));
  const requestedKey = normalizeTeamKey(body.key);
  const key =
    requestedKey ??
    generateTeamKey(
      name,
      existingTeamKeys.map(({ key }) => key),
    );
  const keyError = validateTeamKey(key);
  if (keyError) {
    return NextResponse.json({ error: keyError }, { status: 400 });
  }

  if (existingTeamKeys.some((entry) => entry.key.toUpperCase() === key)) {
    return NextResponse.json(
      { error: "A team with this key already exists" },
      { status: 409 },
    );
  }

  const icon =
    typeof body.icon === "string" ? body.icon.trim().slice(0, 16) : null;
  const isPrivate = body.isPrivate === true;

  const newTeam = await db.transaction(async (tx) => {
    const [createdTeam] = await tx
      .insert(team)
      .values({
        name,
        key,
        workspaceId: access.workspaceId,
        icon: icon || null,
        isPrivate,
      })
      .returning();

    await tx.insert(teamMember).values({
      teamId: createdTeam.id,
      userId: session.user.id,
    });

    await tx
      .insert(workflowState)
      .values(getDefaultWorkflowStates(createdTeam.id));

    return createdTeam;
  });

  return NextResponse.json(
    {
      team: {
        ...newTeam,
        memberCount: 1,
        currentUserIsMember: true,
        createdAt:
          newTeam.createdAt?.toISOString() ?? new Date(0).toISOString(),
      },
    },
    { status: 201 },
  );
}
