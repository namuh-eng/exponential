import { db } from "@/lib/db";
import { member, workspace } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { getWorkspaceSlugFromPath } from "./workspace-paths";

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

  if (memberships.length === 0) {
    return null;
  }

  return (
    memberships.find(
      (membership) => membership.workspaceSlug === preferredWorkspaceSlug,
    )?.workspaceId ??
    memberships.find(
      (membership) => membership.workspaceId === preferredWorkspaceId,
    )?.workspaceId ??
    memberships[0].workspaceId
  );
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
