import { readAccountProfileFromUserSettings } from "@/lib/account-profile";
import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiData } from "@/lib/api-response";
import { createServerApiClient } from "@/lib/server-api-client";

export interface WorkspaceDirectoryMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
  joinedAt: string;
  pronouns: string;
  title: string;
  location: string;
  timezone: string;
  showLocalTime: boolean;
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

  const client = await createServerApiClient();
  const memberships = requireApiData(
    await client.GET("/workspaces"),
    "List workspaces",
  );
  const workspaceMembership = memberships.find(
    (membership) => membership.workspaceId === workspaceId,
  );

  return workspaceMembership
    ? {
        workspaceId,
        role: workspaceMembership.role,
      }
    : null;
}

async function getAccessibleWorkspaceId(userId: string) {
  return (await getAccessibleWorkspace(userId))?.workspaceId ?? null;
}

export async function getWorkspaceMembersDirectory(userId: string) {
  const workspaceId = await getAccessibleWorkspaceId(userId);
  if (!workspaceId) {
    return null;
  }

  const client = await createServerApiClient();
  const directory = requireApiData(
    await client.GET("/workspaces/members", {
      headers: { "x-workspace-id": workspaceId },
    }),
    "List workspace members",
  );

  return {
    workspaceId,
    members: directory.members.flatMap((entry) => {
      if (entry.kind !== "member" || !entry.userId) {
        return [];
      }
      const profile = readAccountProfileFromUserSettings({});
      return {
        id: entry.id,
        userId: entry.userId,
        name: entry.name,
        email: entry.email,
        image: entry.image ?? null,
        role: entry.role,
        joinedAt: entry.joinedAt,
        pronouns: entry.pronouns ?? profile.pronouns,
        title: entry.title ?? profile.title,
        location: entry.location ?? profile.location,
        timezone: entry.timezone ?? profile.timezone,
        showLocalTime: entry.showLocalTime ?? profile.showLocalTime,
        teams: entry.teams,
      };
    }),
  };
}

export async function getWorkspaceTeamsDirectory(userId: string) {
  const access = await getAccessibleWorkspace(userId);
  if (!access) {
    return null;
  }
  const { workspaceId } = access;

  const client = await createServerApiClient();
  const directory = requireApiData(
    await client.GET("/teams", {
      headers: { "x-workspace-id": workspaceId },
    }),
    "List workspace teams",
  );

  return {
    workspaceId,
    viewerRole: access.role,
    canManageTeams: directory.canManageTeams,
    teams: directory.teams.map((entry) => ({
      ...entry,
      icon: entry.icon ?? null,
      parentTeamId: null,
      retiredAt: entry.retiredAt ?? null,
    })),
  };
}
