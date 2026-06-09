export type InitiativeVisibility = "workspace" | "teams";
export type InitiativeRoadmapMode = "all" | "selected";

export type WorkspaceInitiativeSettings = {
  enabled: boolean;
  projectRollups: boolean;
  visibility: InitiativeVisibility;
  roadmapMode: InitiativeRoadmapMode;
};

export const DEFAULT_WORKSPACE_INITIATIVE_SETTINGS: WorkspaceInitiativeSettings =
  {
    enabled: true,
    projectRollups: true,
    visibility: "workspace",
    roadmapMode: "all",
  };

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readWorkspaceInitiativeSettings(
  settings: unknown,
): WorkspaceInitiativeSettings {
  const initiatives = asRecord(
    asRecord(asRecord(settings).features).initiatives,
  );

  return {
    enabled:
      typeof initiatives.enabled === "boolean"
        ? initiatives.enabled
        : DEFAULT_WORKSPACE_INITIATIVE_SETTINGS.enabled,
    projectRollups:
      typeof initiatives.projectRollups === "boolean"
        ? initiatives.projectRollups
        : DEFAULT_WORKSPACE_INITIATIVE_SETTINGS.projectRollups,
    visibility:
      initiatives.visibility === "teams" ||
      initiatives.visibility === "workspace"
        ? initiatives.visibility
        : DEFAULT_WORKSPACE_INITIATIVE_SETTINGS.visibility,
    roadmapMode:
      initiatives.roadmapMode === "selected" ||
      initiatives.roadmapMode === "all"
        ? initiatives.roadmapMode
        : DEFAULT_WORKSPACE_INITIATIVE_SETTINGS.roadmapMode,
  };
}

export function mergeWorkspaceInitiativeSettings(
  settings: unknown,
  initiatives: WorkspaceInitiativeSettings,
) {
  const current = asRecord(settings);
  const features = asRecord(current.features);

  return {
    ...current,
    features: {
      ...features,
      initiatives,
    },
  };
}

export function validateWorkspaceInitiativeSettingsPatch(body: unknown) {
  const patch = asRecord(body);
  const result: Partial<WorkspaceInitiativeSettings> = {};

  if ("enabled" in patch) {
    if (typeof patch.enabled !== "boolean") {
      return { error: "Initiative availability must be a boolean" } as const;
    }
    result.enabled = patch.enabled;
  }

  if ("projectRollups" in patch) {
    if (typeof patch.projectRollups !== "boolean") {
      return { error: "Project rollups must be a boolean" } as const;
    }
    result.projectRollups = patch.projectRollups;
  }

  if ("visibility" in patch) {
    if (patch.visibility !== "workspace" && patch.visibility !== "teams") {
      return { error: "Visibility must be workspace or teams" } as const;
    }
    result.visibility = patch.visibility;
  }

  if ("roadmapMode" in patch) {
    if (patch.roadmapMode !== "all" && patch.roadmapMode !== "selected") {
      return { error: "Roadmap mode must be all or selected" } as const;
    }
    result.roadmapMode = patch.roadmapMode;
  }

  return { settings: result } as const;
}

export function canManageInitiativeSettings(role: string | undefined) {
  return role === "owner" || role === "admin";
}
