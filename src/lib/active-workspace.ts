import { db } from "@/lib/db";
import { member, workspace } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { CANONICAL_WORKSPACE_SLUG } from "./canonical-routes";
import { getWorkspaceSlugFromPath } from "./workspace-paths";

export interface WorkspaceMembershipChoice {
  workspaceId: string;
  workspaceSlug: string;
}

function isGeneratedRootRedirectWorkspaceSlug(slug: string | null | undefined) {
  return slug?.startsWith("root-redirect-") ?? false;
}

export function chooseActiveWorkspace<T extends WorkspaceMembershipChoice>(
  memberships: T[],
  preferences: {
    requestedWorkspaceSlug?: string | null;
    preferredWorkspaceSlug?: string | null;
    preferredWorkspaceId?: string | null;
    canonicalWorkspaceSlug?: string | null;
    ignoreGeneratedRootRedirectPreference?: boolean;
  } = {},
) {
  const {
    requestedWorkspaceSlug,
    preferredWorkspaceSlug,
    preferredWorkspaceId,
    canonicalWorkspaceSlug = CANONICAL_WORKSPACE_SLUG,
    ignoreGeneratedRootRedirectPreference = false,
  } = preferences;

  if (memberships.length === 0) {
    return null;
  }

  if (requestedWorkspaceSlug) {
    return (
      memberships.find(
        (membership) => membership.workspaceSlug === requestedWorkspaceSlug,
      ) ?? null
    );
  }

  const canonicalWorkspace = memberships.find(
    (membership) => membership.workspaceSlug === canonicalWorkspaceSlug,
  );
  const isUsablePreference = (membership: T | undefined) =>
    membership &&
    (!canonicalWorkspace ||
      !ignoreGeneratedRootRedirectPreference ||
      !isGeneratedRootRedirectWorkspaceSlug(membership.workspaceSlug));

  const slugPreferredWorkspace = memberships.find(
    (membership) => membership.workspaceSlug === preferredWorkspaceSlug,
  );
  const idPreferredWorkspace = memberships.find(
    (membership) => membership.workspaceId === preferredWorkspaceId,
  );

  return (
    (isUsablePreference(slugPreferredWorkspace)
      ? slugPreferredWorkspace
      : null) ??
    (isUsablePreference(idPreferredWorkspace) ? idPreferredWorkspace : null) ??
    canonicalWorkspace ??
    memberships[0]
  );
}

export async function resolveActiveWorkspaceId(userId: string) {
  const cookieStore = await cookies();
  const preferredWorkspaceId = cookieStore.get("activeWorkspaceId")?.value;
  const preferredWorkspaceSlug = cookieStore.get("activeWorkspaceSlug")?.value;

  const memberships = await db
    .select({
      workspaceId: member.workspaceId,
      workspaceSlug: workspace.urlSlug,
    })
    .from(member)
    .innerJoin(workspace, eq(member.workspaceId, workspace.id))
    .where(eq(member.userId, userId))
    .orderBy(desc(member.createdAt))
    .limit(50);

  if (
    !memberships.some(
      (membership) => membership.workspaceSlug === CANONICAL_WORKSPACE_SLUG,
    )
  ) {
    const [canonicalMembership] = await db
      .select({
        workspaceId: member.workspaceId,
        workspaceSlug: workspace.urlSlug,
      })
      .from(member)
      .innerJoin(workspace, eq(member.workspaceId, workspace.id))
      .where(
        and(
          eq(member.userId, userId),
          eq(workspace.urlSlug, CANONICAL_WORKSPACE_SLUG),
        ),
      )
      .limit(1);

    if (canonicalMembership) {
      memberships.push(canonicalMembership);
    }
  }

  if (memberships.length === 0) {
    return null;
  }

  return chooseActiveWorkspace(memberships, {
    preferredWorkspaceSlug,
    preferredWorkspaceId,
  })?.workspaceId;
}

export async function resolveWorkspaceIdBySlug(userId: string, slug: string) {
  const [membership] = await db
    .select({ workspaceId: member.workspaceId })
    .from(member)
    .innerJoin(workspace, eq(member.workspaceId, workspace.id))
    .where(and(eq(member.userId, userId), eq(workspace.urlSlug, slug)))
    .limit(1);

  return membership?.workspaceId ?? null;
}

export async function resolveRequestWorkspaceId(
  userId: string,
  request: Request,
) {
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      const slug = getWorkspaceSlugFromPath(refererUrl.pathname);
      if (slug) {
        const workspaceId = await resolveWorkspaceIdBySlug(userId, slug);
        if (workspaceId) {
          return workspaceId;
        }
      }
    } catch {
      // Ignore malformed or non-URL referers and fall back to cookies.
    }
  }

  return resolveActiveWorkspaceId(userId);
}
