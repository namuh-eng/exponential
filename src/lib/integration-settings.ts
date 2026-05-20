import { randomBytes } from "node:crypto";

export type IntegrationProvider = "github" | "slack" | "zendesk";
export type IntegrationStatus =
  | "not_connected"
  | "connected"
  | "configuration_required";

export type SlackChannel = {
  id: string;
  name: string;
};

export type SlackWorkspaceIntegration = {
  status: IntegrationStatus;
  workspaceName: string | null;
  teamName: string | null;
  botUserId: string | null;
  installedAt: string | null;
  availableChannels: SlackChannel[];
  configurationError?: string | null;
};

export type WorkspaceIntegrationSettings = {
  slack: SlackWorkspaceIntegration;
  github: { status: IntegrationStatus; configurationError?: string | null };
  zendesk: { status: IntegrationStatus; configurationError?: string | null };
};

export type TeamSlackNotificationSettings = {
  enabled: boolean;
  channelId: string | null;
  channelName: string | null;
  events: {
    issueCreated: boolean;
    issueCompleted: boolean;
    comments: boolean;
    projectUpdates: boolean;
  };
  updatedAt: string | null;
};

const DEFAULT_SLACK_CHANNELS: SlackChannel[] = [
  { id: "CENG", name: "#eng" },
  { id: "CTRIAGE", name: "#eng-triage" },
  { id: "CRELEASES", name: "#releases" },
];

export const DEFAULT_TEAM_SLACK_EVENTS = {
  issueCreated: true,
  issueCompleted: true,
  comments: false,
  projectUpdates: true,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeChannels(value: unknown): SlackChannel[] {
  if (!Array.isArray(value)) return DEFAULT_SLACK_CHANNELS;
  const channels = value
    .map((entry) => {
      const record = asRecord(entry);
      const id = asString(record.id);
      const name = asString(record.name);
      return id && name ? { id, name } : null;
    })
    .filter((entry): entry is SlackChannel => Boolean(entry));
  return channels.length ? channels : DEFAULT_SLACK_CHANNELS;
}

export function isSlackOAuthConfigured() {
  return Boolean(
    process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET,
  );
}

export function allowLocalSlackInstall() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.PLAYWRIGHT_TEST === "true"
  );
}

export function readWorkspaceIntegrations(
  settings: unknown,
): WorkspaceIntegrationSettings {
  const integrations = asRecord(asRecord(settings).integrations);
  const slack = asRecord(integrations.slack);
  const github = asRecord(integrations.github);
  const zendesk = asRecord(integrations.zendesk);
  const slackStatus = asString(slack.status) as IntegrationStatus | null;

  return {
    slack: {
      status:
        slackStatus === "connected"
          ? "connected"
          : isSlackOAuthConfigured()
            ? "not_connected"
            : "configuration_required",
      workspaceName: asString(slack.workspaceName),
      teamName: asString(slack.teamName),
      botUserId: asString(slack.botUserId),
      installedAt: asString(slack.installedAt),
      availableChannels: normalizeChannels(slack.availableChannels),
      configurationError: asString(slack.configurationError),
    },
    github: {
      status:
        asString(github.status) === "connected"
          ? "connected"
          : "configuration_required",
      configurationError:
        asString(github.configurationError) ??
        "GitHub OAuth credentials are not configured for this environment.",
    },
    zendesk: {
      status:
        asString(zendesk.status) === "connected"
          ? "connected"
          : "configuration_required",
      configurationError:
        asString(zendesk.configurationError) ??
        "Zendesk app credentials are not configured for this environment.",
    },
  };
}

export function withWorkspaceIntegrationSettings(
  settings: unknown,
  integrations: WorkspaceIntegrationSettings,
) {
  return {
    ...asRecord(settings),
    integrations: {
      ...asRecord(asRecord(settings).integrations),
      ...integrations,
    },
  };
}

export function createLocalSlackIntegration(
  current: WorkspaceIntegrationSettings,
): WorkspaceIntegrationSettings {
  return {
    ...current,
    slack: {
      status: "connected",
      workspaceName: "Local Slack workspace",
      teamName: "Engineering",
      botUserId: `U${randomBytes(4).toString("hex").toUpperCase()}`,
      installedAt: new Date().toISOString(),
      availableChannels: DEFAULT_SLACK_CHANNELS,
      configurationError: null,
    },
  };
}

export function disconnectedSlackIntegration(
  current: WorkspaceIntegrationSettings,
): WorkspaceIntegrationSettings {
  return {
    ...current,
    slack: {
      status: isSlackOAuthConfigured()
        ? "not_connected"
        : "configuration_required",
      workspaceName: null,
      teamName: null,
      botUserId: null,
      installedAt: null,
      availableChannels: DEFAULT_SLACK_CHANNELS,
      configurationError: isSlackOAuthConfigured()
        ? null
        : "Slack OAuth credentials are not configured for this environment.",
    },
  };
}

export function readTeamSlackNotifications(
  settings: unknown,
): TeamSlackNotificationSettings {
  const slack = asRecord(asRecord(settings).slackNotifications);
  const events = asRecord(slack.events);
  return {
    enabled: asBoolean(slack.enabled, false),
    channelId: asString(slack.channelId),
    channelName: asString(slack.channelName),
    events: {
      issueCreated: asBoolean(
        events.issueCreated,
        DEFAULT_TEAM_SLACK_EVENTS.issueCreated,
      ),
      issueCompleted: asBoolean(
        events.issueCompleted,
        DEFAULT_TEAM_SLACK_EVENTS.issueCompleted,
      ),
      comments: asBoolean(events.comments, DEFAULT_TEAM_SLACK_EVENTS.comments),
      projectUpdates: asBoolean(
        events.projectUpdates,
        DEFAULT_TEAM_SLACK_EVENTS.projectUpdates,
      ),
    },
    updatedAt: asString(slack.updatedAt),
  };
}

export function withTeamSlackNotifications(
  settings: unknown,
  slackNotifications: TeamSlackNotificationSettings,
) {
  return {
    ...asRecord(settings),
    slackNotifications,
  };
}
