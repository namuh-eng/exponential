import { db } from "@/lib/db";
import {
  member,
  user as userTable,
  workspace,
  workspaceInvitation,
} from "@/lib/db/schema";
import { getWorkspaceSlugFromPath } from "@/lib/workspace-paths";
import { asRecord } from "@/lib/workspace-permissions";
import { and, eq } from "drizzle-orm";

export type WorkspaceAuthenticationSettings = {
  google: boolean;
  emailPasskey: boolean;
};

export type WorkspaceAuthMethod = "google" | "emailPasskey";

export type WorkspaceAuthPolicy = {
  workspaceSlug: string;
  workspaceId: string;
  authentication: WorkspaceAuthenticationSettings;
};

const DEFAULT_AUTHENTICATION_SETTINGS: WorkspaceAuthenticationSettings = {
  google: true,
  emailPasskey: true,
};

const EXEMPT_AUTH_ROLES = new Set(["owner", "admin", "guest"]);

export function readWorkspaceAuthenticationSettings(
  settings: unknown,
): WorkspaceAuthenticationSettings {
  const authentication = asRecord(
    asRecord(asRecord(settings).security).authentication,
  );

  return {
    google:
      typeof authentication.google === "boolean"
        ? authentication.google
        : DEFAULT_AUTHENTICATION_SETTINGS.google,
    emailPasskey:
      typeof authentication.emailPasskey === "boolean"
        ? authentication.emailPasskey
        : DEFAULT_AUTHENTICATION_SETTINGS.emailPasskey,
  };
}

export function getWorkspaceSlugFromCallbackUrl(
  callbackUrl: string | null | undefined,
  baseUrl = "http://localhost",
) {
  if (!callbackUrl) {
    return null;
  }

  try {
    const parsed = new URL(callbackUrl, baseUrl);
    return getWorkspaceSlugFromPath(parsed.pathname);
  } catch {
    return null;
  }
}

export async function getWorkspaceAuthPolicyBySlug(
  workspaceSlug: string | null | undefined,
): Promise<WorkspaceAuthPolicy | null> {
  if (!workspaceSlug) {
    return null;
  }

  const [record] = await db
    .select({
      id: workspace.id,
      urlSlug: workspace.urlSlug,
      settings: workspace.settings,
    })
    .from(workspace)
    .where(eq(workspace.urlSlug, workspaceSlug))
    .limit(1);

  if (!record) {
    return null;
  }

  return {
    workspaceSlug: record.urlSlug,
    workspaceId: record.id,
    authentication: readWorkspaceAuthenticationSettings(record.settings),
  };
}

export async function getWorkspaceAuthPolicyForCallbackUrl(
  callbackUrl: string | null | undefined,
  baseUrl?: string,
) {
  return getWorkspaceAuthPolicyBySlug(
    getWorkspaceSlugFromCallbackUrl(callbackUrl, baseUrl),
  );
}

function isExemptRole(role: string | null | undefined) {
  return EXEMPT_AUTH_ROLES.has(role ?? "");
}

export async function isWorkspaceAuthMethodAllowedForEmail({
  method,
  callbackUrl,
  email,
  baseUrl,
}: {
  method: WorkspaceAuthMethod;
  callbackUrl: string | null | undefined;
  email: string | null | undefined;
  baseUrl?: string;
}) {
  const policy = await getWorkspaceAuthPolicyForCallbackUrl(
    callbackUrl,
    baseUrl,
  );
  if (!policy || policy.authentication[method]) {
    return true;
  }

  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) {
    return false;
  }

  const [membership] = await db
    .select({ role: member.role })
    .from(userTable)
    .innerJoin(member, eq(userTable.id, member.userId))
    .where(
      and(
        eq(userTable.email, normalizedEmail),
        eq(member.workspaceId, policy.workspaceId),
      ),
    )
    .limit(1);

  if (membership) {
    return isExemptRole(membership.role);
  }

  const [invitation] = await db
    .select({ role: workspaceInvitation.role })
    .from(workspaceInvitation)
    .where(
      and(
        eq(workspaceInvitation.workspaceId, policy.workspaceId),
        eq(workspaceInvitation.email, normalizedEmail),
        eq(workspaceInvitation.status, "pending"),
      ),
    )
    .limit(1);

  if (invitation) {
    return isExemptRole(invitation.role);
  }

  return true;
}
