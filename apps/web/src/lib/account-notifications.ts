export const ACCOUNT_NOTIFICATION_DOMAINS = [
  "inbox",
  "email",
  "desktop",
  "slack",
] as const;
export const LEGACY_ACCOUNT_NOTIFICATION_CHANNELS = [
  "desktop",
  "mobile",
  "email",
  "slack",
] as const;

export type AccountNotificationDomainKey =
  (typeof ACCOUNT_NOTIFICATION_DOMAINS)[number];
export type AccountNotificationChannelKey = AccountNotificationDomainKey;

export const ACCOUNT_NOTIFICATION_CHANNELS =
  LEGACY_ACCOUNT_NOTIFICATION_CHANNELS;
export const ACCOUNT_NOTIFICATION_EVENTS = [
  "assignments",
  "statusChanges",
  "mentions",
  "comments",
  "dueDates",
  "relations",
  "triage",
  "projectUpdates",
  "teamUpdates",
  "productUpdates",
  "workspaceAdmin",
] as const;
export type AccountNotificationEventKey =
  (typeof ACCOUNT_NOTIFICATION_EVENTS)[number];

export type InboxNotificationPreferences = {
  assignedToMe: boolean;
  mentionsAndReplies: boolean;
  subscribedIssues: boolean;
  teamUpdates: boolean;
};

export type EmailNotificationPreferences = {
  issueActivity: boolean;
  mentionsAndReplies: boolean;
  dailyDigest: boolean;
  weeklyDigest: boolean;
  productUpdates: boolean;
  workspaceInvites: boolean;
};

export type DesktopNotificationPreferences = {
  enabled: boolean;
  permission: "default" | "granted" | "denied";
  issueActivity: boolean;
  mentionsAndReplies: boolean;
  reminders: boolean;
  sound: boolean;
};

export type SlackNotificationPreferences = {
  enabled: boolean;
  destination:
    | "not_connected"
    | "workspace"
    | "team_channel"
    | "direct_message";
  mentionsAndReplies: boolean;
  assignedToMe: boolean;
  triageActivity: boolean;
  projectUpdates: boolean;
};

export type LegacyNotificationEventPreferences = Record<
  AccountNotificationEventKey,
  boolean
>;
export type LegacyNotificationChannels = Record<
  (typeof LEGACY_ACCOUNT_NOTIFICATION_CHANNELS)[number],
  { events: LegacyNotificationEventPreferences }
>;

export type AccountNotificationSettings = {
  channels: LegacyNotificationChannels;
  inbox: InboxNotificationPreferences;
  email: EmailNotificationPreferences;
  desktop: DesktopNotificationPreferences;
  slack: SlackNotificationPreferences;
  updatesFromLinear: {
    showInSidebar: boolean;
    changelogNewsletter: boolean;
    marketing: boolean;
  };
  other: {
    inviteAccepted: boolean;
    privacyAndLegalUpdates: boolean;
    dpa: boolean;
  };
};

export type AccountNotificationSettingsPatch = Partial<{
  inbox: Partial<InboxNotificationPreferences>;
  email: Partial<EmailNotificationPreferences>;
  desktop: Partial<DesktopNotificationPreferences>;
  slack: Partial<SlackNotificationPreferences>;
  updatesFromLinear: Partial<
    AccountNotificationSettings["updatesFromLinear"]
  > & {
    newsletter?: boolean;
  };
  other: Partial<AccountNotificationSettings["other"]>;
  channels: Partial<Record<string, { events?: Record<string, boolean> }>>;
}>;

const DEFAULT_LEGACY_EVENTS: LegacyNotificationEventPreferences =
  Object.fromEntries(
    ACCOUNT_NOTIFICATION_EVENTS.map((eventKey) => [eventKey, true]),
  ) as LegacyNotificationEventPreferences;

function makeLegacyChannels(
  overrides: Partial<
    Record<
      keyof LegacyNotificationChannels,
      Partial<LegacyNotificationEventPreferences>
    >
  > = {},
): LegacyNotificationChannels {
  return Object.fromEntries(
    LEGACY_ACCOUNT_NOTIFICATION_CHANNELS.map((channel) => [
      channel,
      { events: { ...DEFAULT_LEGACY_EVENTS, ...overrides[channel] } },
    ]),
  ) as LegacyNotificationChannels;
}

export const DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS: AccountNotificationSettings =
  {
    channels: makeLegacyChannels({ slack: { assignments: false } }),
    inbox: {
      assignedToMe: true,
      mentionsAndReplies: true,
      subscribedIssues: true,
      teamUpdates: true,
    },
    email: {
      issueActivity: true,
      mentionsAndReplies: true,
      dailyDigest: false,
      weeklyDigest: true,
      productUpdates: false,
      workspaceInvites: true,
    },
    desktop: {
      enabled: true,
      permission: "default",
      issueActivity: true,
      mentionsAndReplies: true,
      reminders: true,
      sound: false,
    },
    slack: {
      enabled: false,
      destination: "not_connected",
      mentionsAndReplies: true,
      assignedToMe: false,
      triageActivity: false,
      projectUpdates: false,
    },
    updatesFromLinear: {
      showInSidebar: true,
      changelogNewsletter: false,
      marketing: false,
    },
    other: {
      inviteAccepted: true,
      privacyAndLegalUpdates: true,
      dpa: false,
    },
  };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function destination(
  value: unknown,
): SlackNotificationPreferences["destination"] {
  return value === "workspace" ||
    value === "team_channel" ||
    value === "direct_message" ||
    value === "not_connected"
    ? value
    : DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.slack.destination;
}

function permission(
  value: unknown,
): DesktopNotificationPreferences["permission"] {
  return value === "granted" || value === "denied" || value === "default"
    ? value
    : DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.desktop.permission;
}

function migrateLegacyChannelEvents(parsed: Record<string, unknown>) {
  const channels = asRecord(parsed.channels);
  const desktopEvents = asRecord(asRecord(channels.desktop).events);
  const emailEvents = asRecord(asRecord(channels.email).events);
  const slackEvents = asRecord(asRecord(channels.slack).events);
  const mobileEvents = asRecord(asRecord(channels.mobile).events);

  return {
    inbox: {
      assignedToMe: desktopEvents.assignments,
      mentionsAndReplies: desktopEvents.mentions ?? mobileEvents.mentions,
      subscribedIssues: desktopEvents.comments,
      teamUpdates: desktopEvents.teamUpdates,
    },
    email: {
      issueActivity: emailEvents.assignments,
      mentionsAndReplies: emailEvents.mentions,
      dailyDigest: emailEvents.productUpdates,
      productUpdates: emailEvents.productUpdates,
    },
    desktop: {
      issueActivity: desktopEvents.assignments,
      mentionsAndReplies: desktopEvents.mentions,
      reminders: desktopEvents.dueDates,
    },
    slack: {
      mentionsAndReplies: slackEvents.mentions,
      assignedToMe: slackEvents.assignments,
      triageActivity: slackEvents.triage,
      projectUpdates: slackEvents.projectUpdates,
    },
  };
}

export function normalizeAccountNotificationSettings(
  value: unknown,
): AccountNotificationSettings {
  const parsed = asRecord(value);
  const legacy = migrateLegacyChannelEvents(parsed);
  const inbox: Record<string, unknown> = {
    ...legacy.inbox,
    ...asRecord(parsed.inbox),
  };
  const email: Record<string, unknown> = {
    ...legacy.email,
    ...asRecord(parsed.email),
  };
  const desktop: Record<string, unknown> = {
    ...legacy.desktop,
    ...asRecord(parsed.desktop),
  };
  const slack: Record<string, unknown> = {
    ...legacy.slack,
    ...asRecord(parsed.slack),
  };
  const updatesFromLinear = asRecord(parsed.updatesFromLinear);
  const other = asRecord(parsed.other);

  const normalized = {
    channels: makeLegacyChannels({
      desktop: {
        assignments: bool(
          desktop.issueActivity,
          DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.desktop.issueActivity,
        ),
        mentions: bool(
          desktop.mentionsAndReplies,
          DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.desktop.mentionsAndReplies,
        ),
        comments: bool(
          desktop.mentionsAndReplies,
          DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.desktop.mentionsAndReplies,
        ),
        dueDates: bool(
          desktop.reminders,
          DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.desktop.reminders,
        ),
      },
      email: {
        assignments: bool(
          email.issueActivity,
          DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.email.issueActivity,
        ),
        mentions: bool(
          email.mentionsAndReplies,
          DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.email.mentionsAndReplies,
        ),
        comments: bool(
          email.mentionsAndReplies,
          DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.email.mentionsAndReplies,
        ),
        productUpdates: bool(
          email.productUpdates,
          DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.email.productUpdates,
        ),
      },
      slack: {
        assignments: bool(
          slack.assignedToMe,
          DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.slack.assignedToMe,
        ),
        mentions: bool(
          slack.mentionsAndReplies,
          DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.slack.mentionsAndReplies,
        ),
        comments: bool(
          slack.mentionsAndReplies,
          DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.slack.mentionsAndReplies,
        ),
        triage: bool(
          slack.triageActivity,
          DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.slack.triageActivity,
        ),
        projectUpdates: bool(
          slack.projectUpdates,
          DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.slack.projectUpdates,
        ),
      },
    }),
    inbox: {
      assignedToMe: bool(
        inbox.assignedToMe,
        DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.inbox.assignedToMe,
      ),
      mentionsAndReplies: bool(
        inbox.mentionsAndReplies,
        DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.inbox.mentionsAndReplies,
      ),
      subscribedIssues: bool(
        inbox.subscribedIssues,
        DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.inbox.subscribedIssues,
      ),
      teamUpdates: bool(
        inbox.teamUpdates,
        DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.inbox.teamUpdates,
      ),
    },
    email: {
      issueActivity: bool(
        email.issueActivity,
        DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.email.issueActivity,
      ),
      mentionsAndReplies: bool(
        email.mentionsAndReplies,
        DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.email.mentionsAndReplies,
      ),
      dailyDigest: bool(
        email.dailyDigest,
        DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.email.dailyDigest,
      ),
      weeklyDigest: bool(
        email.weeklyDigest,
        DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.email.weeklyDigest,
      ),
      productUpdates: bool(
        email.productUpdates,
        DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.email.productUpdates,
      ),
      workspaceInvites: bool(
        email.workspaceInvites,
        DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.email.workspaceInvites,
      ),
    },
    desktop: {
      enabled: bool(
        desktop.enabled,
        DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.desktop.enabled,
      ),
      permission: permission(desktop.permission),
      issueActivity: bool(
        desktop.issueActivity,
        DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.desktop.issueActivity,
      ),
      mentionsAndReplies: bool(
        desktop.mentionsAndReplies,
        DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.desktop.mentionsAndReplies,
      ),
      reminders: bool(
        desktop.reminders,
        DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.desktop.reminders,
      ),
      sound: bool(
        desktop.sound,
        DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.desktop.sound,
      ),
    },
    slack: {
      enabled: bool(
        slack.enabled,
        DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.slack.enabled,
      ),
      destination: destination(slack.destination),
      mentionsAndReplies: bool(
        slack.mentionsAndReplies,
        DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.slack.mentionsAndReplies,
      ),
      assignedToMe: bool(
        slack.assignedToMe,
        DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.slack.assignedToMe,
      ),
      triageActivity: bool(
        slack.triageActivity,
        DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.slack.triageActivity,
      ),
      projectUpdates: bool(
        slack.projectUpdates,
        DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.slack.projectUpdates,
      ),
    },
    updatesFromLinear: {
      showInSidebar: bool(
        updatesFromLinear.showInSidebar,
        DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.updatesFromLinear.showInSidebar,
      ),
      changelogNewsletter: bool(
        updatesFromLinear.changelogNewsletter ?? updatesFromLinear.newsletter,
        DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.updatesFromLinear
          .changelogNewsletter,
      ),
      marketing: bool(
        updatesFromLinear.marketing,
        DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.updatesFromLinear.marketing,
      ),
    },
    other: {
      inviteAccepted: bool(
        other.inviteAccepted,
        DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.other.inviteAccepted,
      ),
      privacyAndLegalUpdates: bool(
        other.privacyAndLegalUpdates,
        DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.other.privacyAndLegalUpdates,
      ),
      dpa: bool(other.dpa, DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.other.dpa),
    },
  };

  return normalized;
}

export function mergeAccountNotificationSettings(
  current: AccountNotificationSettings,
  patch: AccountNotificationSettingsPatch,
): AccountNotificationSettings {
  return normalizeAccountNotificationSettings({
    ...current,
    ...patch,
    inbox: { ...current.inbox, ...patch.inbox },
    email: { ...current.email, ...patch.email },
    desktop: { ...current.desktop, ...patch.desktop },
    slack: { ...current.slack, ...patch.slack },
    updatesFromLinear: {
      ...current.updatesFromLinear,
      ...patch.updatesFromLinear,
    },
    other: { ...current.other, ...patch.other },
    channels: patch.channels,
  });
}

export function readAccountNotificationsFromUserSettings(settings: unknown) {
  return normalizeAccountNotificationSettings(
    asRecord(settings).accountNotifications,
  );
}

export function writeAccountNotificationsToUserSettings(
  settings: unknown,
  accountNotifications: AccountNotificationSettings,
) {
  return { ...asRecord(settings), accountNotifications };
}

export function isAccountNotificationChannelKey(
  value: string,
): value is AccountNotificationDomainKey {
  return ACCOUNT_NOTIFICATION_DOMAINS.includes(
    value as AccountNotificationDomainKey,
  );
}

export function describeNotificationDomainPreferences(
  domain: AccountNotificationDomainKey,
  settings: AccountNotificationSettings,
) {
  if (domain === "desktop") {
    if (!settings.desktop.enabled) return "Desktop notifications are off";
    return settings.desktop.permission === "granted"
      ? "Enabled when browser permission is allowed"
      : "Requires browser permission";
  }
  if (domain === "slack") {
    if (!settings.slack.enabled)
      return "Connect Slack to deliver notifications";
    return settings.slack.destination === "direct_message"
      ? "Delivering as Slack direct messages"
      : "Delivering to Slack workspace destinations";
  }
  const prefs = settings[domain];
  const enabled = Object.values(prefs).filter(Boolean).length;
  return enabled === 0 ? "Disabled" : `${enabled} preferences enabled`;
}

export function describeNotificationChannelPreferences(channelPreferences: {
  events: Record<string, boolean>;
}) {
  const enabled = Object.values(channelPreferences.events).filter(
    Boolean,
  ).length;
  if (enabled === 0) return "Disabled";
  if (enabled === Object.keys(channelPreferences.events).length)
    return "Enabled for all notifications";
  return `${enabled} preferences enabled`;
}
