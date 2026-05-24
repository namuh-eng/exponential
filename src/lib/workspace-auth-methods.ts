import { db } from "@/lib/db";
import { member, user, workspace } from "@/lib/db/schema";
import { getWorkspaceSlugFromPath } from "@/lib/workspace-paths";
import { and, eq } from "drizzle-orm";

export type WorkspaceAuthMethod = "google" | "emailPasskey";

type WorkspaceAuthSettings = {
  google: boolean;
  emailPasskey: boolean;
};

type WorkspaceAuthPolicy = {
  workspaceSlug: string;
  authentication: WorkspaceAuthSettings;
  role: string | null;
};

const DEFAULT_AUTH_SETTINGS: WorkspaceAuthSettings = {
  google: true,
  emailPasskey: true,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readWorkspaceAuthSettings(settings: unknown) {
  const authentication = asRecord(
    asRecord(asRecord(settings).security).authentication,
  );

  return {
    google:
      typeof authentication.google === "boolean"
        ? authentication.google
        : DEFAULT_AUTH_SETTINGS.google,
    emailPasskey:
      typeof authentication.emailPasskey === "boolean"
        ? authentication.emailPasskey
        : DEFAULT_AUTH_SETTINGS.emailPasskey,
  };
}

export function getWorkspaceSlugFromCallbackUrl(
  callbackUrl: string | null | undefined,
  baseUrl: string,
) {
  if (!callbackUrl) {
    return null;
  }

  try {
    const url = new URL(callbackUrl, baseUrl);
    if (url.origin !== new URL(baseUrl).origin) {
      return null;
    }
    return getWorkspaceSlugFromPath(url.pathname);
  } catch {
    return null;
  }
}

export async function resolveWorkspaceAuthPolicy({
  callbackUrl,
  baseUrl,
  email,
}: {
  callbackUrl: string | null | undefined;
  baseUrl: string;
  email?: string | null;
}): Promise<WorkspaceAuthPolicy | null> {
  const workspaceSlug = getWorkspaceSlugFromCallbackUrl(callbackUrl, baseUrl);
  if (!workspaceSlug) {
    return null;
  }

  const [workspaceRow] = await db
    .select({
      id: workspace.id,
      settings: workspace.settings,
    })
    .from(workspace)
    .where(eq(workspace.urlSlug, workspaceSlug))
    .limit(1);

  if (!workspaceRow) {
    return null;
  }

  let role: string | null = null;
  const normalizedEmail = email?.trim().toLowerCase();
  if (normalizedEmail) {
    const [membershipRow] = await db
      .select({ role: member.role })
      .from(user)
      .innerJoin(member, eq(member.userId, user.id))
      .where(
        and(
          eq(user.email, normalizedEmail),
          eq(member.workspaceId, workspaceRow.id),
        ),
      )
      .limit(1);
    role = membershipRow?.role ?? null;
  }

  return {
    workspaceSlug,
    authentication: readWorkspaceAuthSettings(workspaceRow.settings),
    role,
  };
}

export function isWorkspaceAuthMethodAllowed(
  policy: WorkspaceAuthPolicy | null,
  method: WorkspaceAuthMethod,
) {
  if (!policy) {
    return true;
  }

  // Anonymous OAuth initiation cannot safely distinguish admin/member/guest.
  // Enforce disabled workspace login methods for every workspace-scoped login
  // callback rather than silently allowing an admin-shaped bypass.
  return policy.authentication[method];
}
