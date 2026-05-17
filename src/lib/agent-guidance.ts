import { readAccountPreferencesFromUserSettings } from "@/lib/account-preferences";
import { db } from "@/lib/db";
import { member, team, user, workspace } from "@/lib/db/schema";
import { readTeamSettings } from "@/lib/team-settings";
import { and, eq } from "drizzle-orm";

export type AgentGuidanceSource = "workspace" | "account" | "team";

export interface AgentGuidanceEntry {
  source: AgentGuidanceSource;
  label: string;
  instructions: string;
}

export interface EffectiveAgentGuidance {
  entries: AgentGuidanceEntry[];
  effectiveInstructions: string;
  teamKey: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readWorkspaceAgentGuidance(settings: unknown) {
  const root = asRecord(settings);
  const ai = asRecord(root.ai);
  const agents = asRecord(root.agents);
  const candidate =
    ai.agentGuidance ??
    ai.guidance ??
    agents.agentGuidance ??
    agents.guidance ??
    root.agentGuidance;

  return typeof candidate === "string" ? candidate : "";
}

function normalizeGuidance(value: string) {
  return value.trim();
}

export function buildEffectiveAgentGuidance(input: {
  workspaceGuidance?: string | null;
  accountGuidance?: string | null;
  teamGuidance?: string | null;
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
    teamKey: input.teamKey?.trim().toUpperCase() || null,
  };
}

export async function resolveEffectiveAgentGuidance(input: {
  workspaceId: string;
  userId: string;
  teamKey?: string | null;
}): Promise<EffectiveAgentGuidance> {
  const normalizedTeamKey = input.teamKey?.trim().toUpperCase() || null;
  const [workspaceRow, userRow, teamRow] = await Promise.all([
    db
      .select({ settings: workspace.settings })
      .from(workspace)
      .where(eq(workspace.id, input.workspaceId))
      .limit(1),
    db
      .select({ settings: user.settings })
      .from(user)
      .where(eq(user.id, input.userId))
      .limit(1),
    normalizedTeamKey
      ? db
          .select({ key: team.key, settings: team.settings })
          .from(team)
          .innerJoin(
            member,
            and(
              eq(member.workspaceId, team.workspaceId),
              eq(member.userId, input.userId),
            ),
          )
          .where(
            and(
              eq(team.workspaceId, input.workspaceId),
              eq(team.key, normalizedTeamKey),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
  ]);

  const accountPreferences = readAccountPreferencesFromUserSettings(
    userRow[0]?.settings,
  );
  const teamSettings = teamRow[0]
    ? readTeamSettings(teamRow[0].settings)
    : null;

  return buildEffectiveAgentGuidance({
    workspaceGuidance: readWorkspaceAgentGuidance(workspaceRow[0]?.settings),
    accountGuidance: accountPreferences.agentPersonalization.instructions,
    teamGuidance: teamSettings?.agentGuidance,
    teamKey: teamRow[0]?.key ?? normalizedTeamKey,
  });
}
