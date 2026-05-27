import { requireApiData } from "@/lib/api-response";
import { createServerApiClient } from "@/lib/server-api-client";
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
  const memberships = await listWorkspaceMembershipChoices();

  if (memberships.length === 0) {
    return null;
  }

  return chooseActiveWorkspace(memberships, {
    preferredWorkspaceSlug,
    preferredWorkspaceId,
  })?.workspaceId;
}

export async function resolveWorkspaceIdBySlug(userId: string, slug: string) {
  const membership = (await listWorkspaceMembershipChoices()).find(
    (entry) => entry.workspaceSlug === slug,
  );
  return membership?.workspaceId ?? null;
}

export async function resolveRequestWorkspaceId(
  userId: string,
  request: Request,
) {
  const requestedWorkspaceSlug = request.headers.get("x-workspace-slug");
  if (requestedWorkspaceSlug) {
    const workspaceId = await resolveWorkspaceIdBySlug(
      userId,
      requestedWorkspaceSlug,
    );
    if (workspaceId) {
      return workspaceId;
    }
  }

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

async function listWorkspaceMembershipChoices() {
  const client = await createServerApiClient();
  const memberships = requireApiData(
    await client.GET("/workspaces"),
    "List workspaces",
  );
  return memberships.map((membership) => ({
    workspaceId: membership.workspaceId,
    workspaceSlug: membership.workspaceSlug,
  }));
}
