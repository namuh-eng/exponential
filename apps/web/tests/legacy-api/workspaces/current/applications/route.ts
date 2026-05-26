import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  authorizedApplicationGrant,
  member,
  user,
  workspace,
} from "@/lib/db/schema";
import {
  createHeadlessWorkspacesClient,
  headlessWorkspacesEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

type WorkspaceMemberRole = "owner" | "admin" | "member" | "guest";

type WorkspaceAccess = {
  workspaceId: string;
  memberRole: WorkspaceMemberRole;
};

function canManageApplications(role: WorkspaceMemberRole) {
  return role === "owner" || role === "admin";
}

function serializeDate(value: Date | string | null) {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function normalizeScopes(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter(
      (scope): scope is string =>
        typeof scope === "string" && scope.trim() !== "",
    );
  }
  if (typeof value === "string") {
    return value
      .split(/[\s,]+/)
      .map((scope) => scope.trim())
      .filter(Boolean);
  }
  return [];
}

function humanizeScope(scope: string) {
  return scope
    .split(/[:_.-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

const SCOPE_PRESENTATION: Record<
  string,
  { group: string; description: string }
> = {
  read: {
    group: "Workspace data",
    description: "View workspace and account information",
  },
  write: {
    group: "Workspace data",
    description: "Create and update workspace data",
  },
  "issues:read": {
    group: "Issues",
    description: "View issues and related metadata",
  },
  "issues:write": { group: "Issues", description: "Create and update issues" },
  "comments:read": { group: "Comments", description: "View comments" },
  "comments:write": {
    group: "Comments",
    description: "Create and update comments",
  },
  "webhooks:read": {
    group: "Webhooks",
    description: "View webhook subscriptions",
  },
  "webhooks:write": {
    group: "Webhooks",
    description: "Manage webhook subscriptions",
  },
};

function buildPermissionGroups(scopes: string[]) {
  const groups = new Map<string, string[]>();
  for (const scope of scopes) {
    const known = SCOPE_PRESENTATION[scope];
    const group = known?.group ?? "Additional access";
    const description = known?.description ?? humanizeScope(scope);
    groups.set(group, [...(groups.get(group) ?? []), description]);
  }
  return Array.from(groups, ([label, descriptions]) => ({
    label,
    descriptions,
  }));
}

async function getWorkspaceAccess(
  userId: string,
  workspaceIdOverride?: string,
): Promise<WorkspaceAccess | null> {
  const workspaceId =
    workspaceIdOverride ?? (await resolveActiveWorkspaceId(userId));
  if (!workspaceId) return null;

  const [access] = await db
    .select({ workspaceId: workspace.id, memberRole: member.role })
    .from(workspace)
    .innerJoin(
      member,
      and(
        eq(member.workspaceId, workspace.id),
        eq(member.workspaceId, workspaceId),
        eq(member.userId, userId),
      ),
    )
    .limit(1);

  return access
    ? { workspaceId: access.workspaceId, memberRole: access.memberRole }
    : null;
}

export async function GET() {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  if (headlessWorkspacesEnabled()) {
    const workspaceId =
      "apiKey" in session
        ? session.apiKey.workspaceId
        : await resolveActiveWorkspaceId(session.user.id);
    if (workspaceId) {
      const token = await mintInternalApiToken({
        userId: session.user.id,
        workspaceId,
      });
      const client = createHeadlessWorkspacesClient(token);
      const { data, error, response } = await client.GET(
        "/workspaces/current/applications",
      );
      if (error) {
        return NextResponse.json(error, {
          status: (response as Response).status,
        });
      }
      return NextResponse.json(data, { status: (response as Response).status });
    }
  }

  const access = await getWorkspaceAccess(
    session.user.id,
    "apiKey" in session ? session.apiKey.workspaceId : undefined,
  );
  if (!access) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }
  if (!canManageApplications(access.memberRole)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await db
    .select({
      id: authorizedApplicationGrant.id,
      appId: authorizedApplicationGrant.appId,
      clientId: authorizedApplicationGrant.clientId,
      name: authorizedApplicationGrant.name,
      imageUrl: authorizedApplicationGrant.imageUrl,
      scopes: authorizedApplicationGrant.scopes,
      webhooksEnabled: authorizedApplicationGrant.webhooksEnabled,
      createdAt: authorizedApplicationGrant.createdAt,
      updatedAt: authorizedApplicationGrant.updatedAt,
      ownerName: user.name,
      ownerEmail: user.email,
      ownerImage: user.image,
    })
    .from(authorizedApplicationGrant)
    .innerJoin(
      member,
      and(
        eq(member.userId, authorizedApplicationGrant.userId),
        eq(member.workspaceId, authorizedApplicationGrant.workspaceId),
      ),
    )
    .innerJoin(user, eq(user.id, authorizedApplicationGrant.userId))
    .where(eq(authorizedApplicationGrant.workspaceId, access.workspaceId))
    .orderBy(desc(authorizedApplicationGrant.updatedAt));

  return NextResponse.json({
    applications: rows.map((item) => {
      const scopes = normalizeScopes(item.scopes);
      return {
        id: item.id,
        appId: item.appId,
        clientId: item.clientId,
        name: item.name,
        imageUrl: item.imageUrl,
        scopes,
        permissionGroups: buildPermissionGroups(scopes),
        webhooksEnabled: item.webhooksEnabled,
        createdAt: serializeDate(item.createdAt),
        updatedAt: serializeDate(item.updatedAt),
        lastUsedAt: null,
        owner: {
          name: item.ownerName,
          email: item.ownerEmail,
          image: item.ownerImage,
        },
      };
    }),
    canManageApplications: canManageApplications(access.memberRole),
  });
}
