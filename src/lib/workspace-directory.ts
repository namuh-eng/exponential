import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { db } from "@/lib/db";
import { member, team, teamMember, user, workspace } from "@/lib/db/schema";
import { activeTeamFilter } from "@/lib/team-lifecycle";
import {
  canPerformWorkspacePermission,
  readWorkspacePermissionSettings,
} from "@/lib/workspace-permissions";
import { and, asc, eq, inArray } from "drizzle-orm";

export interface WorkspaceDirectoryMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
  joinedAt: string;
  teams: { id: string; name: string; key: string }[];
}

export interface WorkspaceDirectoryTeam {
  id: string;
  name: string;
  key: string;
  icon: string | null;
  isPrivate: boolean | null;
  issueCount: number | null;
  memberCount: number;
  currentUserIsMember: boolean;
  createdAt: string;
  parentTeamId: string | null;
  retiredAt: string | null;
}

async function getAccessibleWorkspace(userId: string) {
  const workspaceId = await resolveActiveWorkspaceId(userId);
  if (!workspaceId) {
    return null;
  }

  const [workspaceMembership] = await db
    .select({ id: member.id, role: member.role, settings: workspace.settings })
    .from(member)
    .innerJoin(workspace, eq(workspace.id, member.workspaceId))
    .where(and(eq(member.workspaceId, workspaceId), eq(member.userId, userId)))
    .limit(1);

  return workspaceMembership
    ? {
        workspaceId,
        role: workspaceMembership.role,
        settings: workspaceMembership.settings,
      }
    : null;
}

function canCreateTeams(role: string, settings: unknown) {
  return canPerformWorkspacePermission(
    role,
    readWorkspacePermissionSettings(settings).teamCreationRole,
  );
}

async function getAccessibleWorkspaceId(userId: string) {
  return (await getAccessibleWorkspace(userId))?.workspaceId ?? null;
}

export async function getWorkspaceMembersDirectory(userId: string) {
  const workspaceId = await getAccessibleWorkspaceId(userId);
  if (!workspaceId) {
    return null;
  }

  const workspaceMembers = await db
    .select({
      id: member.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: member.role,
      joinedAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.workspaceId, workspaceId))
    .orderBy(asc(user.name), asc(user.email));

  const userIds = workspaceMembers.map((entry) => entry.userId);
  const memberships =
    userIds.length === 0
      ? []
      : await db
          .select({
            userId: teamMember.userId,
            teamId: team.id,
            teamName: team.name,
            teamKey: team.key,
          })
          .from(teamMember)
          .innerJoin(team, eq(teamMember.teamId, team.id))
          .where(
            and(
              eq(team.workspaceId, workspaceId),
              activeTeamFilter,
              inArray(teamMember.userId, userIds),
            ),
          )
          .orderBy(asc(team.name));

  const teamsByUserId = new Map<string, WorkspaceDirectoryMember["teams"]>();
  for (const membership of memberships) {
    teamsByUserId.set(membership.userId, [
      ...(teamsByUserId.get(membership.userId) ?? []),
      {
        id: membership.teamId,
        name: membership.teamName,
        key: membership.teamKey,
      },
    ]);
  }

  return {
    workspaceId,
    members: workspaceMembers.map((entry) => ({
      ...entry,
      joinedAt: entry.joinedAt?.toISOString() ?? new Date(0).toISOString(),
      teams: teamsByUserId.get(entry.userId) ?? [],
    })),
  };
}

export async function getWorkspaceTeamsDirectory(userId: string) {
  const access = await getAccessibleWorkspace(userId);
  if (!access) {
    return null;
  }
  const { workspaceId } = access;

  const teams = await db
    .select({
      id: team.id,
      name: team.name,
      key: team.key,
      icon: team.icon,
      isPrivate: team.isPrivate,
      issueCount: team.issueCount,
      createdAt: team.createdAt,
      parentTeamId: team.parentTeamId,
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
          .select({
            teamId: teamMember.teamId,
            userId: teamMember.userId,
          })
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

  return {
    workspaceId,
    viewerRole: access.role,
    canManageTeams: canCreateTeams(access.role, access.settings),
    teams: teams.map((entry) => ({
      ...entry,
      memberCount: memberCountsByTeamId.get(entry.id) ?? 0,
      currentUserIsMember: currentUserTeamIds.has(entry.id),
      createdAt: entry.createdAt?.toISOString() ?? new Date(0).toISOString(),
      retiredAt: entry.retiredAt?.toISOString() ?? null,
    })),
  };
}
