import {
  type PermissionLevel,
  asRecord,
  canPerformWorkspacePermission,
  readPermissionLevel,
} from "@/lib/workspace-permissions";

export type WorkspaceAiSettings = {
  aiFeaturesEnabled: boolean;
  askLinearEnabled: boolean;
  issueSuggestionsEnabled: boolean;
  summariesEnabled: boolean;
  autoTriageEnabled: boolean;
  workspaceAgentGuidance: string;
  agentUsagePermission: PermissionLevel;
};

export const WORKSPACE_AGENT_GUIDANCE_MAX_LENGTH = 4000;

export const DEFAULT_WORKSPACE_AI_SETTINGS: WorkspaceAiSettings = {
  aiFeaturesEnabled: true,
  askLinearEnabled: true,
  issueSuggestionsEnabled: true,
  summariesEnabled: true,
  autoTriageEnabled: false,
  workspaceAgentGuidance: "",
  agentUsagePermission: "members",
};

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeGuidance(value: unknown) {
  return typeof value === "string"
    ? value.trim().slice(0, WORKSPACE_AGENT_GUIDANCE_MAX_LENGTH)
    : "";
}

export function readWorkspaceAiSettings(
  settings: unknown,
): WorkspaceAiSettings {
  const root = asRecord(settings);
  const ai = asRecord(root.ai);
  const legacyAgents = asRecord(root.agents);

  return {
    aiFeaturesEnabled: readBoolean(
      ai.aiFeaturesEnabled,
      readBoolean(ai.enabled, DEFAULT_WORKSPACE_AI_SETTINGS.aiFeaturesEnabled),
    ),
    askLinearEnabled: readBoolean(
      ai.askLinearEnabled,
      DEFAULT_WORKSPACE_AI_SETTINGS.askLinearEnabled,
    ),
    issueSuggestionsEnabled: readBoolean(
      ai.issueSuggestionsEnabled,
      DEFAULT_WORKSPACE_AI_SETTINGS.issueSuggestionsEnabled,
    ),
    summariesEnabled: readBoolean(
      ai.summariesEnabled,
      DEFAULT_WORKSPACE_AI_SETTINGS.summariesEnabled,
    ),
    autoTriageEnabled: readBoolean(
      ai.autoTriageEnabled,
      DEFAULT_WORKSPACE_AI_SETTINGS.autoTriageEnabled,
    ),
    workspaceAgentGuidance: normalizeGuidance(
      ai.workspaceAgentGuidance ??
        ai.agentGuidance ??
        ai.guidance ??
        legacyAgents.agentGuidance ??
        legacyAgents.guidance ??
        root.agentGuidance,
    ),
    agentUsagePermission: readPermissionLevel(
      ai.agentUsagePermission,
      DEFAULT_WORKSPACE_AI_SETTINGS.agentUsagePermission,
    ),
  };
}

export function serializeWorkspaceAiSettings(settings: WorkspaceAiSettings) {
  return {
    aiFeaturesEnabled: settings.aiFeaturesEnabled,
    askLinearEnabled: settings.askLinearEnabled,
    issueSuggestionsEnabled: settings.issueSuggestionsEnabled,
    summariesEnabled: settings.summariesEnabled,
    autoTriageEnabled: settings.autoTriageEnabled,
    workspaceAgentGuidance: settings.workspaceAgentGuidance,
    agentGuidance: settings.workspaceAgentGuidance,
    agentUsagePermission: settings.agentUsagePermission,
  };
}

export function buildWorkspaceAiSettingsPatch(
  current: WorkspaceAiSettings,
  patch: Partial<Record<keyof WorkspaceAiSettings, unknown>>,
): WorkspaceAiSettings {
  return {
    aiFeaturesEnabled: readBoolean(
      patch.aiFeaturesEnabled,
      current.aiFeaturesEnabled,
    ),
    askLinearEnabled: readBoolean(
      patch.askLinearEnabled,
      current.askLinearEnabled,
    ),
    issueSuggestionsEnabled: readBoolean(
      patch.issueSuggestionsEnabled,
      current.issueSuggestionsEnabled,
    ),
    summariesEnabled: readBoolean(
      patch.summariesEnabled,
      current.summariesEnabled,
    ),
    autoTriageEnabled: readBoolean(
      patch.autoTriageEnabled,
      current.autoTriageEnabled,
    ),
    workspaceAgentGuidance:
      patch.workspaceAgentGuidance === undefined
        ? current.workspaceAgentGuidance
        : normalizeGuidance(patch.workspaceAgentGuidance),
    agentUsagePermission: readPermissionLevel(
      patch.agentUsagePermission,
      current.agentUsagePermission,
    ),
  };
}

export function canUseWorkspaceAgents(
  role: string | undefined,
  settings: WorkspaceAiSettings,
) {
  return (
    settings.aiFeaturesEnabled &&
    canPerformWorkspacePermission(role, settings.agentUsagePermission, {
      includeGuestsForAnyone: false,
    })
  );
}
