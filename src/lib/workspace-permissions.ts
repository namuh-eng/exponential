export type PermissionLevel = "admins" | "members" | "anyone";
export type WorkspaceMemberRole = "owner" | "admin" | "member" | "guest";

export type WorkspacePermissionSettings = {
  invitationsRole: PermissionLevel;
  teamCreationRole: PermissionLevel;
  labelManagementRole: PermissionLevel;
  templateManagementRole: PermissionLevel;
  apiKeyCreationRole: PermissionLevel;
  agentGuidanceRole: PermissionLevel;
};

const PERMISSION_LEVELS = new Set<PermissionLevel>([
  "admins",
  "members",
  "anyone",
]);

export const DEFAULT_WORKSPACE_PERMISSION_SETTINGS: WorkspacePermissionSettings =
  {
    invitationsRole: "members",
    teamCreationRole: "members",
    labelManagementRole: "members",
    templateManagementRole: "members",
    apiKeyCreationRole: "admins",
    agentGuidanceRole: "admins",
  };

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function isPermissionLevel(value: unknown): value is PermissionLevel {
  return (
    typeof value === "string" && PERMISSION_LEVELS.has(value as PermissionLevel)
  );
}

export function readPermissionLevel(
  value: unknown,
  fallback: PermissionLevel,
): PermissionLevel {
  return isPermissionLevel(value) ? value : fallback;
}

export function readWorkspacePermissionSettings(
  settings: unknown,
): WorkspacePermissionSettings {
  const permissions = asRecord(
    asRecord(asRecord(settings).security).permissions,
  );

  return {
    invitationsRole: readPermissionLevel(
      permissions.invitationsRole,
      DEFAULT_WORKSPACE_PERMISSION_SETTINGS.invitationsRole,
    ),
    teamCreationRole: readPermissionLevel(
      permissions.teamCreationRole,
      DEFAULT_WORKSPACE_PERMISSION_SETTINGS.teamCreationRole,
    ),
    labelManagementRole: readPermissionLevel(
      permissions.labelManagementRole,
      DEFAULT_WORKSPACE_PERMISSION_SETTINGS.labelManagementRole,
    ),
    templateManagementRole: readPermissionLevel(
      permissions.templateManagementRole,
      DEFAULT_WORKSPACE_PERMISSION_SETTINGS.templateManagementRole,
    ),
    apiKeyCreationRole: readPermissionLevel(
      permissions.apiKeyCreationRole,
      DEFAULT_WORKSPACE_PERMISSION_SETTINGS.apiKeyCreationRole,
    ),
    agentGuidanceRole: readPermissionLevel(
      permissions.agentGuidanceRole,
      DEFAULT_WORKSPACE_PERMISSION_SETTINGS.agentGuidanceRole,
    ),
  };
}

export function isWorkspaceAdminRole(role: string | undefined) {
  return role === "owner" || role === "admin";
}

export function canPerformWorkspacePermission(
  role: string | undefined,
  permissionLevel: PermissionLevel,
  options: { includeGuestsForAnyone?: boolean } = {},
) {
  if (!role) {
    return false;
  }

  if (permissionLevel === "admins") {
    return isWorkspaceAdminRole(role);
  }

  if (permissionLevel === "members") {
    return role === "owner" || role === "admin" || role === "member";
  }

  return options.includeGuestsForAnyone === false
    ? role === "owner" || role === "admin" || role === "member"
    : role === "owner" ||
        role === "admin" ||
        role === "member" ||
        role === "guest";
}
