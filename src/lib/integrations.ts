import { db } from "@/lib/db";
import { team, workspace } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export type IntegrationProvider = "github" | "slack" | "zendesk";
export const SUPPORTED_INTEGRATIONS: Array<{
  provider: IntegrationProvider;
  name: string;
  description: string;
}> = [
  {
    provider: "github",
    name: "GitHub",
    description: "Sync pull requests, commits, and issue links with issues.",
  },
  {
    provider: "slack",
    name: "Slack",
    description:
      "Broadcast team updates and create issues from Slack messages.",
  },
  {
    provider: "zendesk",
    name: "Zendesk",
    description:
      "Connect support tickets to product work and customer requests.",
  },
];
export type WorkspaceIntegrationState = {
  provider: IntegrationProvider;
  name: string;
  description: string;
  connected: boolean;
  status: "available" | "connected" | "configuration_required";
  detail: string;
  connectedAt: string | null;
  channels?: string[];
};
type SettingsRecord = Record<string, unknown>;
type StoredIntegration = {
  connected?: boolean;
  connectedAt?: string;
  channels?: string[];
};
function asRecord(value: unknown): SettingsRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as SettingsRecord)
    : {};
}
function integrationSettings(settings: unknown) {
  return asRecord(asRecord(settings).integrations);
}
export function getStoredIntegration(
  settings: unknown,
  provider: IntegrationProvider,
): StoredIntegration {
  return asRecord(integrationSettings(settings)[provider]) as StoredIntegration;
}
export function serializeIntegrations(
  settings: unknown,
): WorkspaceIntegrationState[] {
  return SUPPORTED_INTEGRATIONS.map((item) => {
    const stored = getStoredIntegration(settings, item.provider);
    const connected = stored.connected === true;
    const supported = item.provider === "github" || item.provider === "slack";
    return {
      ...item,
      connected,
      status: connected
        ? "connected"
        : supported
          ? "available"
          : "configuration_required",
      detail: connected
        ? `${item.name} is connected to this workspace.`
        : supported
          ? `${item.name} can be connected in this clone-local workspace.`
          : "This provider needs additional credentials before setup can begin.",
      connectedAt: stored.connectedAt ?? null,
      channels:
        item.provider === "slack"
          ? (stored.channels ?? ["#eng", "#product", "#incidents"])
          : undefined,
    };
  });
}
export async function updateWorkspaceIntegration(
  workspaceId: string,
  provider: IntegrationProvider,
  connected: boolean,
) {
  const [row] = await db
    .select({ settings: workspace.settings })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  const settings = asRecord(row?.settings);
  const integrations = integrationSettings(settings);
  const nextProvider = connected
    ? {
        ...asRecord(integrations[provider]),
        connected: true,
        connectedAt: new Date().toISOString(),
        ...(provider === "slack"
          ? { channels: ["#eng", "#product", "#incidents"] }
          : {}),
      }
    : { ...asRecord(integrations[provider]), connected: false };
  const nextSettings = {
    ...settings,
    integrations: { ...integrations, [provider]: nextProvider },
  };
  await db
    .update(workspace)
    .set({ settings: nextSettings })
    .where(eq(workspace.id, workspaceId));
  return nextSettings;
}
export type TeamSlackSettings = {
  isEnabled: boolean;
  channelName: string | null;
  events: Record<string, boolean>;
};
export const DEFAULT_SLACK_EVENTS: Record<string, boolean> = {
  issueCreated: true,
  issueUpdated: true,
  comments: true,
  statusChanges: true,
};
export function getTeamSlackSettings(settings: unknown): TeamSlackSettings {
  const slack = asRecord(asRecord(settings).slackNotifications);
  return {
    isEnabled: slack.isEnabled === true,
    channelName:
      typeof slack.channelName === "string" ? slack.channelName : null,
    events: { ...DEFAULT_SLACK_EVENTS, ...asRecord(slack.events) } as Record<
      string,
      boolean
    >,
  };
}
export async function saveTeamSlackSettings(
  teamId: string,
  currentSettings: unknown,
  next: TeamSlackSettings,
) {
  const settings = asRecord(currentSettings);
  await db
    .update(team)
    .set({ settings: { ...settings, slackNotifications: next } })
    .where(eq(team.id, teamId));
  return next;
}
