import { readAccountPreferencesFromUserSettings } from "@/lib/account-preferences";
import { readTeamSettings } from "@/lib/team-settings";
import { readWorkspaceAiSettings } from "@/lib/workspace-ai-settings";

export type AgentGuidanceSource = "workspace" | "account" | "team";

export interface AgentGuidanceEntry {
  source: AgentGuidanceSource;
  label: string;
  instructions: string;
}

export interface EffectiveAgentGuidance {
  entries: AgentGuidanceEntry[];
  effectiveInstructions: string;
  autoFixEnabled: boolean;
  teamKey: string | null;
}

export function readWorkspaceAgentGuidance(settings: unknown) {
  return readWorkspaceAiSettings(settings).workspaceAgentGuidance;
}

function normalizeGuidance(value: string) {
  return value.trim();
}

export function buildEffectiveAgentGuidance(input: {
  workspaceGuidance?: string | null;
  accountGuidance?: string | null;
  teamGuidance?: string | null;
  autoFixEnabled?: boolean | null;
  teamKey?: string | null;
}): EffectiveAgentGuidance {
  const entries: AgentGuidanceEntry[] = [];
  const workspaceGuidance = normalizeGuidance(input.workspaceGuidance ?? "");
  const accountGuidance = normalizeGuidance(input.accountGuidance ?? "");
  const teamGuidance = normalizeGuidance(input.teamGuidance ?? "");

  if (workspaceGuidance) {
    entries.push({
      source: "workspace",
      label: "Workspace guidance",
      instructions: workspaceGuidance,
    });
  }

  if (accountGuidance) {
    entries.push({
      source: "account",
      label: "Account personalization",
      instructions: accountGuidance,
    });
  }

  if (teamGuidance) {
    entries.push({
      source: "team",
      label: input.teamKey
        ? `Team ${input.teamKey.toUpperCase()} guidance`
        : "Team guidance",
      instructions: teamGuidance,
    });
  }

  return {
    entries,
    effectiveInstructions: entries
      .map((entry) => `${entry.label}:\n${entry.instructions}`)
      .join("\n\n"),
    autoFixEnabled: input.autoFixEnabled === true,
    teamKey: input.teamKey?.trim().toUpperCase() || null,
  };
}

export function resolveEffectiveAgentGuidanceFromSettings(input: {
  workspaceSettings?: unknown;
  accountSettings?: unknown;
  teamSettings?: unknown;
  teamKey?: string | null;
}): EffectiveAgentGuidance {
  const accountPreferences = readAccountPreferencesFromUserSettings(
    input.accountSettings,
  );
  const teamSettings = input.teamSettings
    ? readTeamSettings(input.teamSettings)
    : null;

  return buildEffectiveAgentGuidance({
    workspaceGuidance: readWorkspaceAgentGuidance(input.workspaceSettings),
    accountGuidance: accountPreferences.agentPersonalization.instructions,
    teamGuidance: teamSettings?.agentGuidance,
    autoFixEnabled: accountPreferences.agentPersonalization.autoFix,
    teamKey: input.teamKey,
  });
}
