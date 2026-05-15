import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { db } from "@/lib/db";
import { member, team, workspace } from "@/lib/db/schema";
import { getWorkspaceSlugFromPath } from "@/lib/workspace-paths";
import { and, eq, inArray } from "drizzle-orm";

/**
 * @deprecated This resolves team keys globally. Do not use for authenticated
 * team pages or APIs; use findAccessibleTeam instead.
 */
export async function getTeamByKey(
  key: string,
): Promise<{ id: string; name: string; key: string } | null> {
  const teams = await db
    .select({ id: team.id, name: team.name, key: team.key })
    .from(team)
    .where(eq(team.key, key))
    .limit(1);
  return teams[0] ?? null;
}

/**
 * @deprecated This resolves team keys globally. Do not use for authenticated
 * team pages or APIs; use findAccessibleTeam instead.
 */
export async function getTeamIdByKey(key: string): Promise<string | null> {
  const t = await getTeamByKey(key);
  return t?.id ?? null;
}

export async function getWorkspaceMember(
  workspaceId: string,
  userId: string,
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.workspaceId, workspaceId), eq(member.userId, userId)))
    .limit(1);
  return row ?? null;
}

function getRequestedWorkspaceSlug(request?: Request) {
  const explicitSlug = request?.headers.get("x-workspace-slug");
  if (explicitSlug) return explicitSlug;

  const sourcePath = request?.headers.get("x-workspace-source-path");
  const slugFromSourcePath = sourcePath
    ? getWorkspaceSlugFromPath(sourcePath)
    : null;
  if (slugFromSourcePath) return slugFromSourcePath;

  const referer = request?.headers.get("referer");
  if (!referer) return null;

  try {
    return getWorkspaceSlugFromPath(new URL(referer).pathname);
  } catch {
    return null;
  }
}

async function resolveAccessibleWorkspaceId(userId: string, request?: Request) {
  const requestedWorkspaceSlug = getRequestedWorkspaceSlug(request);

  if (requestedWorkspaceSlug) {
    const [requestedWorkspace] = await db
      .select({ workspaceId: workspace.id })
      .from(workspace)
      .innerJoin(
        member,
        and(eq(member.workspaceId, workspace.id), eq(member.userId, userId)),
      )
      .where(eq(workspace.urlSlug, requestedWorkspaceSlug))
      .limit(1);

    return requestedWorkspace?.workspaceId ?? null;
  }

  return resolveActiveWorkspaceId(userId);
}

async function getDescendantTeamIds(rootTeamId: string, workspaceId: string) {
  const descendantIds: string[] = [];
  let frontier = [rootTeamId];
  const seen = new Set(frontier);

  while (frontier.length > 0) {
    const children = await db
      .select({ id: team.id })
      .from(team)
      .where(
        and(
          eq(team.workspaceId, workspaceId),
          inArray(team.parentTeamId, frontier),
        ),
      );

    frontier = children
      .map((child) => child.id)
      .filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        descendantIds.push(id);
        return true;
      });
  }

  return descendantIds;
}

export async function findAccessibleTeam(
  key: string,
  userId: string,
  options: { request?: Request } = {},
) {
  const workspaceId = await resolveAccessibleWorkspaceId(
    userId,
    options.request,
  );
  if (!workspaceId) return null;

  const wsMember = await getWorkspaceMember(workspaceId, userId);
  if (!wsMember) return null;

  const [teamRecord] = await db
    .select({
      id: team.id,
      workspaceId: team.workspaceId,
      name: team.name,
      key: team.key,
      icon: team.icon,
      timezone: team.timezone,
      estimateType: team.estimateType,
      triageEnabled: team.triageEnabled,
      cyclesEnabled: team.cyclesEnabled,
      cycleStartDay: team.cycleStartDay,
      cycleDurationWeeks: team.cycleDurationWeeks,
      parentTeamId: team.parentTeamId,
      settings: team.settings,
    })
    .from(team)
    .where(and(eq(team.key, key), eq(team.workspaceId, workspaceId)))
    .limit(1);

  if (!teamRecord) return null;

  const descendantTeamIds = await getDescendantTeamIds(
    teamRecord.id,
    teamRecord.workspaceId,
  );

  return {
    ...teamRecord,
    childTeamIds: descendantTeamIds,
    hierarchyTeamIds: [teamRecord.id, ...descendantTeamIds],
  };
}
