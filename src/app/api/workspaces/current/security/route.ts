import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { member, workspace } from "@/lib/db/schema";
import {
  DEFAULT_WORKSPACE_PERMISSION_SETTINGS,
  type PermissionLevel,
  asRecord,
  canPerformWorkspacePermission,
  isWorkspaceAdminRole,
  readPermissionLevel,
} from "@/lib/workspace-permissions";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

type AuthenticationSettings = {
  google: boolean;
  emailPasskey: boolean;
};

type WorkspacePermissionSettings = {
  invitationsRole: PermissionLevel;
  teamCreationRole: PermissionLevel;
  labelManagementRole: PermissionLevel;
  templateManagementRole: PermissionLevel;
  apiKeyCreationRole: PermissionLevel;
  agentGuidanceRole: PermissionLevel;
};

type IpRestriction = {
  range: string;
  description: string;
  enabled: boolean;
  type: "allow";
};

type WorkspaceSecurityState = {
  authentication: AuthenticationSettings;
  permissions: WorkspacePermissionSettings;
  restrictFileUploads: boolean;
  improveAi: boolean;
  webSearch: boolean;
  hipaa: boolean;
  ipRestrictions: IpRestriction[];
};

type CurrentWorkspaceRecord = {
  id: string;
  settings: unknown;
  inviteLinkEnabled: boolean | null;
  inviteLinkToken: string | null;
  approvedEmailDomains: unknown;
  role: string;
};

const DEFAULT_SECURITY_STATE: WorkspaceSecurityState = {
  authentication: {
    google: true,
    emailPasskey: true,
  },
  permissions: {
    ...DEFAULT_WORKSPACE_PERMISSION_SETTINGS,
  },
  restrictFileUploads: false,
  improveAi: true,
  webSearch: true,
  hipaa: false,
  ipRestrictions: [],
};

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^@+/, "");
}

function normalizeDomains(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .filter((domain): domain is string => typeof domain === "string")
        .map(normalizeDomain)
        .filter((domain) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)),
    ),
  );
}

function isValidCidrRange(value: string) {
  const trimmed = value.trim();
  const [address, prefix, extra] = trimmed.split("/");
  if (!address || extra !== undefined) {
    return false;
  }

  const version = isIP(address);
  if (version === 0) {
    return false;
  }

  if (prefix === undefined) {
    return true;
  }

  if (!/^\d+$/.test(prefix)) {
    return false;
  }

  const prefixNumber = Number(prefix);
  return version === 4
    ? prefixNumber >= 0 && prefixNumber <= 32
    : prefixNumber >= 0 && prefixNumber <= 128;
}

function normalizeIpRange(value: string) {
  return value.trim().toLowerCase();
}

function normalizeIpRestrictions(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenRanges = new Set<string>();
  const restrictions: IpRestriction[] = [];

  for (const item of value) {
    const record = asRecord(item);
    const rawRange = typeof record.range === "string" ? record.range : "";
    const range = normalizeIpRange(rawRange);
    if (!range || !isValidCidrRange(range) || seenRanges.has(range)) {
      continue;
    }

    seenRanges.add(range);
    restrictions.push({
      range,
      description:
        typeof record.description === "string"
          ? record.description.trim().slice(0, 120)
          : "",
      enabled: typeof record.enabled === "boolean" ? record.enabled : true,
      type: "allow",
    });
  }

  return restrictions;
}

function validateIpRestrictions(value: unknown) {
  if (!Array.isArray(value)) {
    return "IP restrictions must be a list";
  }

  for (const item of value) {
    if (!isPlainObject(item)) {
      return "IP restrictions must contain valid entries";
    }

    if (typeof item.range !== "string" || !isValidCidrRange(item.range)) {
      return "IP restrictions must use valid IP addresses or CIDR ranges";
    }

    if (item.enabled !== undefined && typeof item.enabled !== "boolean") {
      return "IP restriction status must be a boolean";
    }

    if (
      item.description !== undefined &&
      typeof item.description !== "string"
    ) {
      return "IP restriction descriptions must be strings";
    }
  }

  return null;
}

function readWorkspaceSecurityState(settings: unknown): WorkspaceSecurityState {
  const security = asRecord(asRecord(settings).security);
  const authentication = asRecord(security.authentication);
  const permissions = asRecord(security.permissions);

  return {
    authentication: {
      google:
        typeof authentication.google === "boolean"
          ? authentication.google
          : DEFAULT_SECURITY_STATE.authentication.google,
      emailPasskey:
        typeof authentication.emailPasskey === "boolean"
          ? authentication.emailPasskey
          : DEFAULT_SECURITY_STATE.authentication.emailPasskey,
    },
    permissions: {
      invitationsRole: readPermissionLevel(
        permissions.invitationsRole,
        DEFAULT_SECURITY_STATE.permissions.invitationsRole,
      ),
      teamCreationRole: readPermissionLevel(
        permissions.teamCreationRole,
        DEFAULT_SECURITY_STATE.permissions.teamCreationRole,
      ),
      labelManagementRole: readPermissionLevel(
        permissions.labelManagementRole,
        DEFAULT_SECURITY_STATE.permissions.labelManagementRole,
      ),
      templateManagementRole: readPermissionLevel(
        permissions.templateManagementRole,
        DEFAULT_SECURITY_STATE.permissions.templateManagementRole,
      ),
      apiKeyCreationRole: readPermissionLevel(
        permissions.apiKeyCreationRole,
        DEFAULT_SECURITY_STATE.permissions.apiKeyCreationRole,
      ),
      agentGuidanceRole: readPermissionLevel(
        permissions.agentGuidanceRole,
        DEFAULT_SECURITY_STATE.permissions.agentGuidanceRole,
      ),
    },
    restrictFileUploads:
      typeof security.restrictFileUploads === "boolean"
        ? security.restrictFileUploads
        : DEFAULT_SECURITY_STATE.restrictFileUploads,
    improveAi:
      typeof security.improveAi === "boolean"
        ? security.improveAi
        : DEFAULT_SECURITY_STATE.improveAi,
    webSearch:
      typeof security.webSearch === "boolean"
        ? security.webSearch
        : DEFAULT_SECURITY_STATE.webSearch,
    hipaa:
      typeof security.hipaa === "boolean"
        ? security.hipaa
        : DEFAULT_SECURITY_STATE.hipaa,
    ipRestrictions: normalizeIpRestrictions(security.ipRestrictions),
  };
}

function serializeSecurityState(security: WorkspaceSecurityState) {
  return {
    authentication: security.authentication,
    permissions: security.permissions,
    restrictFileUploads: security.restrictFileUploads,
    improveAi: security.improveAi,
    webSearch: security.webSearch,
    hipaa: security.hipaa,
    ipRestrictions: security.ipRestrictions,
  };
}

async function findCurrentWorkspace(userId: string) {
  const activeWorkspaceId = await resolveActiveWorkspaceId(userId);
  if (!activeWorkspaceId) {
    return null;
  }

  const [currentWorkspace] = await db
    .select({
      id: workspace.id,
      settings: workspace.settings,
      inviteLinkEnabled: workspace.inviteLinkEnabled,
      inviteLinkToken: workspace.inviteLinkToken,
      approvedEmailDomains: workspace.approvedEmailDomains,
      role: member.role,
    })
    .from(workspace)
    .innerJoin(
      member,
      and(
        eq(member.workspaceId, workspace.id),
        eq(member.userId, userId),
        eq(member.workspaceId, activeWorkspaceId),
      ),
    )
    .limit(1);

  return (currentWorkspace as CurrentWorkspaceRecord | undefined) ?? null;
}

function createInviteToken() {
  return randomBytes(24).toString("hex");
}

async function ensureInviteToken(currentWorkspace: CurrentWorkspaceRecord) {
  if (currentWorkspace.inviteLinkToken) {
    return currentWorkspace.inviteLinkToken;
  }

  const inviteLinkToken = createInviteToken();
  await db
    .update(workspace)
    .set({
      inviteLinkToken,
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, currentWorkspace.id));

  return inviteLinkToken;
}

function buildInviteUrl(request: Request, inviteLinkToken: string) {
  const url = new URL(request.url);
  url.pathname = "/accept-invite";
  url.search = `token=${encodeURIComponent(inviteLinkToken)}`;
  return url.toString();
}

function buildResponse(
  request: Request,
  currentWorkspace: CurrentWorkspaceRecord,
  inviteLinkToken: string,
) {
  const securityState = readWorkspaceSecurityState(currentWorkspace.settings);
  const { permissions } = securityState;

  return {
    security: {
      inviteLinkEnabled: currentWorkspace.inviteLinkEnabled ?? true,
      inviteUrl: buildInviteUrl(request, inviteLinkToken),
      approvedEmailDomains: normalizeDomains(
        currentWorkspace.approvedEmailDomains,
      ),
      ...securityState,
      capabilities: {
        canInviteMembers: canPerformWorkspacePermission(
          currentWorkspace.role,
          permissions.invitationsRole,
        ),
        canCreateTeams: canPerformWorkspacePermission(
          currentWorkspace.role,
          permissions.teamCreationRole,
        ),
        canManageWorkspaceLabels: false,
        canManageWorkspaceTemplates: false,
        canCreateApiKeys: canPerformWorkspacePermission(
          currentWorkspace.role,
          permissions.apiKeyCreationRole,
          { includeGuestsForAnyone: false },
        ),
        canModifyAgentGuidance: false,
      },
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function GET(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const currentWorkspace = await findCurrentWorkspace(session.user.id);
  if (!currentWorkspace) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  const inviteLinkToken = await ensureInviteToken(currentWorkspace);
  return NextResponse.json(
    buildResponse(
      request,
      {
        ...currentWorkspace,
        inviteLinkToken,
      },
      inviteLinkToken,
    ),
  );
}

export async function PATCH(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const currentWorkspace = await findCurrentWorkspace(session.user.id);
  if (!currentWorkspace) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  if (!isWorkspaceAdminRole(currentWorkspace.role)) {
    return NextResponse.json(
      { error: "You do not have permission to manage workspace security" },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    inviteLinkEnabled?: unknown;
    approvedEmailDomains?: unknown;
    authentication?: unknown;
    permissions?: unknown;
    restrictFileUploads?: unknown;
    improveAi?: unknown;
    webSearch?: unknown;
    hipaa?: unknown;
    ipRestrictions?: unknown;
  } | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    body.inviteLinkEnabled !== undefined &&
    typeof body.inviteLinkEnabled !== "boolean"
  ) {
    return NextResponse.json(
      { error: "Invite link status must be a boolean" },
      { status: 400 },
    );
  }

  if (
    body.restrictFileUploads !== undefined &&
    typeof body.restrictFileUploads !== "boolean"
  ) {
    return NextResponse.json(
      { error: "Restrict file uploads must be a boolean" },
      { status: 400 },
    );
  }

  if (body.improveAi !== undefined && typeof body.improveAi !== "boolean") {
    return NextResponse.json(
      { error: "Improve AI must be a boolean" },
      { status: 400 },
    );
  }

  if (body.webSearch !== undefined && typeof body.webSearch !== "boolean") {
    return NextResponse.json(
      { error: "Enable web search must be a boolean" },
      { status: 400 },
    );
  }

  if (body.hipaa !== undefined && typeof body.hipaa !== "boolean") {
    return NextResponse.json(
      { error: "HIPAA compliance must be a boolean" },
      { status: 400 },
    );
  }

  if (body.ipRestrictions !== undefined) {
    const ipRestrictionsError = validateIpRestrictions(body.ipRestrictions);
    if (ipRestrictionsError) {
      return NextResponse.json({ error: ipRestrictionsError }, { status: 400 });
    }
  }

  if (
    body.approvedEmailDomains !== undefined &&
    !Array.isArray(body.approvedEmailDomains)
  ) {
    return NextResponse.json(
      { error: "Approved email domains must be a list" },
      { status: 400 },
    );
  }

  if (
    body.authentication !== undefined &&
    !isPlainObject(body.authentication)
  ) {
    return NextResponse.json(
      { error: "Authentication settings are invalid" },
      { status: 400 },
    );
  }

  if (body.permissions !== undefined && !isPlainObject(body.permissions)) {
    return NextResponse.json(
      { error: "Permission settings are invalid" },
      { status: 400 },
    );
  }

  const currentSecurity = readWorkspaceSecurityState(currentWorkspace.settings);
  const nextSecurity: WorkspaceSecurityState = {
    authentication: {
      google:
        typeof body.authentication?.google === "boolean"
          ? body.authentication.google
          : currentSecurity.authentication.google,
      emailPasskey:
        typeof body.authentication?.emailPasskey === "boolean"
          ? body.authentication.emailPasskey
          : currentSecurity.authentication.emailPasskey,
    },
    permissions: {
      invitationsRole: readPermissionLevel(
        body.permissions?.invitationsRole,
        currentSecurity.permissions.invitationsRole,
      ),
      teamCreationRole: readPermissionLevel(
        body.permissions?.teamCreationRole,
        currentSecurity.permissions.teamCreationRole,
      ),
      labelManagementRole: readPermissionLevel(
        body.permissions?.labelManagementRole,
        currentSecurity.permissions.labelManagementRole,
      ),
      templateManagementRole: readPermissionLevel(
        body.permissions?.templateManagementRole,
        currentSecurity.permissions.templateManagementRole,
      ),
      apiKeyCreationRole: readPermissionLevel(
        body.permissions?.apiKeyCreationRole,
        currentSecurity.permissions.apiKeyCreationRole,
      ),
      agentGuidanceRole: readPermissionLevel(
        body.permissions?.agentGuidanceRole,
        currentSecurity.permissions.agentGuidanceRole,
      ),
    },
    restrictFileUploads:
      typeof body.restrictFileUploads === "boolean"
        ? body.restrictFileUploads
        : currentSecurity.restrictFileUploads,
    improveAi:
      typeof body.improveAi === "boolean"
        ? body.improveAi
        : currentSecurity.improveAi,
    webSearch:
      typeof body.webSearch === "boolean"
        ? body.webSearch
        : currentSecurity.webSearch,
    hipaa: typeof body.hipaa === "boolean" ? body.hipaa : currentSecurity.hipaa,
    ipRestrictions:
      body.ipRestrictions === undefined
        ? currentSecurity.ipRestrictions
        : normalizeIpRestrictions(body.ipRestrictions),
  };

  const approvedEmailDomains =
    body.approvedEmailDomains === undefined
      ? normalizeDomains(currentWorkspace.approvedEmailDomains)
      : normalizeDomains(body.approvedEmailDomains);
  const inviteLinkEnabled =
    typeof body.inviteLinkEnabled === "boolean"
      ? body.inviteLinkEnabled
      : (currentWorkspace.inviteLinkEnabled ?? true);
  const inviteLinkToken =
    currentWorkspace.inviteLinkToken ?? createInviteToken();
  const settings = {
    ...asRecord(currentWorkspace.settings),
    security: serializeSecurityState(nextSecurity),
  };

  await db
    .update(workspace)
    .set({
      inviteLinkEnabled,
      inviteLinkToken,
      approvedEmailDomains,
      settings,
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, currentWorkspace.id));

  return NextResponse.json(
    buildResponse(
      request,
      {
        ...currentWorkspace,
        inviteLinkEnabled,
        inviteLinkToken,
        approvedEmailDomains,
        settings,
      },
      inviteLinkToken,
    ),
  );
}
