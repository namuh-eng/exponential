export const ACCOUNT_NOTIFICATION_CHANNELS = [
  "desktop",
  "mobile",
  "email",
  "slack",
] as const;

export const ACCOUNT_NOTIFICATION_EVENTS = [
  "assignments",
  "statusChanges",
  "mentions",
  "comments",
  "priorityChanges",
  "dueDates",
  "relations",
  "triage",
  "projectUpdates",
  "cycleUpdates",
  "initiativeUpdates",
  "documentActivity",
  "teamUpdates",
  "workspaceAdmin",
  "customerRequests",
  "productUpdates",
] as const;

export type AccountNotificationChannelKey =
  (typeof ACCOUNT_NOTIFICATION_CHANNELS)[number];
export type AccountNotificationEventKey =
  (typeof ACCOUNT_NOTIFICATION_EVENTS)[number];

export type NotificationEventPreferences = Record<
  AccountNotificationEventKey,
  boolean
>;

export type NotificationChannelPreferences = {
  events: NotificationEventPreferences;
};

export type AccountNotificationSettings = {
  channels: Record<
    AccountNotificationChannelKey,
    NotificationChannelPreferences
  >;
  updatesFromLinear: {
    showInSidebar: boolean;
    newsletter: boolean;
    marketing: boolean;
  };
  other: {
    inviteAccepted: boolean;
    privacyAndLegalUpdates: boolean;
    dpa: boolean;
  };
};

export type NotificationChannelPreferencesPatch = {
  events?: Partial<NotificationEventPreferences>;
};

export type AccountNotificationSettingsPatch = {
  channels?: Partial<
    Record<AccountNotificationChannelKey, NotificationChannelPreferencesPatch>
  >;
  updatesFromLinear?: Partial<AccountNotificationSettings["updatesFromLinear"]>;
  other?: Partial<AccountNotificationSettings["other"]>;
};

export const ACCOUNT_NOTIFICATION_EVENT_LABELS: Record<
  AccountNotificationEventKey,
  string
> = {
  assignments: "Assignments",
  statusChanges: "Status changes",
  mentions: "Mentions",
  comments: "Comments and replies",
  priorityChanges: "Priority changes",
  dueDates: "Due dates and reminders",
  relations: "Relations and blockers",
  triage: "Triage and intake",
  projectUpdates: "Project updates",
  cycleUpdates: "Cycles",
  initiativeUpdates: "Initiatives",
  documentActivity: "Documents",
  teamUpdates: "Team updates",
  workspaceAdmin: "Workspace and admin",
  customerRequests: "Customer requests and SLA",
  productUpdates: "Product updates and digests",
};

export const ACCOUNT_NOTIFICATION_EVENT_DESCRIPTIONS: Record<
  AccountNotificationEventKey,
  string
> = {
  assignments: "When you're assigned to an issue.",
  statusChanges: "When an issue you follow changes status.",
  mentions: "When someone mentions you in a comment or description.",
  comments: "When someone comments on work you're involved in.",
  priorityChanges: "When priority changes on issues you follow.",
  dueDates: "When due dates are added, changed, overdue, or coming up.",
  relations: "When blockers, relations, or duplicates change on followed work.",
  triage: "When intake or triage issues need review or change state.",
  projectUpdates:
    "When projects you follow get updates, milestones, or health changes.",
  cycleUpdates: "When cycle scope, start dates, or completion status changes.",
  initiativeUpdates:
    "When initiatives you follow receive updates or status changes.",
  documentActivity:
    "When documents you own or follow are edited or commented on.",
  teamUpdates: "When team settings, membership, or routing rules change.",
  workspaceAdmin:
    "When workspace-level security, billing, or admin events occur.",
  customerRequests:
    "When customer requests, support links, or SLA risk changes.",
  productUpdates:
    "When product digests, changelog items, or release notes are available.",
};

export const ACCOUNT_NOTIFICATION_EVENT_GROUPS: Array<{
  title: string;
  description: string;
  events: AccountNotificationEventKey[];
}> = [
  {
    title: "Issues",
    description: "Direct issue activity and routing changes.",
    events: [
      "assignments",
      "statusChanges",
      "mentions",
      "comments",
      "priorityChanges",
      "dueDates",
      "relations",
      "triage",
    ],
  },
  {
    title: "Projects, cycles, and initiatives",
    description: "Higher-level planning activity and progress updates.",
    events: ["projectUpdates", "cycleUpdates", "initiativeUpdates"],
  },
  {
    title: "Documents and workspace",
    description: "Collaboration, team, and administrative notifications.",
    events: ["documentActivity", "teamUpdates", "workspaceAdmin"],
  },
  {
    title: "Customer and product",
    description: "Customer-request activity, SLA changes, and digest delivery.",
    events: ["customerRequests", "productUpdates"],
  },
];

function makeEventPreferences(
  enabledEvents: AccountNotificationEventKey[],
): NotificationEventPreferences {
  const enabled = new Set(enabledEvents);
  return Object.fromEntries(
    ACCOUNT_NOTIFICATION_EVENTS.map((eventKey) => [
      eventKey,
      enabled.has(eventKey),
    ]),
  ) as NotificationEventPreferences;
}

export const DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS: AccountNotificationSettings =
  {
    channels: {
      desktop: {
        events: makeEventPreferences([
          "assignments",
          "statusChanges",
          "mentions",
          "comments",
          "priorityChanges",
          "dueDates",
          "relations",
          "triage",
          "projectUpdates",
          "cycleUpdates",
          "initiativeUpdates",
          "documentActivity",
        ]),
      },
      mobile: {
        events: makeEventPreferences([...ACCOUNT_NOTIFICATION_EVENTS]),
      },
      email: {
        events: makeEventPreferences([
          "assignments",
          "mentions",
          "comments",
          "dueDates",
          "projectUpdates",
          "productUpdates",
        ]),
      },
      slack: {
        events: makeEventPreferences([
          "mentions",
          "comments",
          "triage",
          "projectUpdates",
          "customerRequests",
        ]),
      },
    },
    updatesFromLinear: {
      showInSidebar: true,
      newsletter: false,
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

function normalizeEventPreferences(
  value: unknown,
  channel: AccountNotificationChannelKey,
) {
  const parsed = asRecord(value);
  const defaults =
    DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.channels[channel].events;

  return Object.fromEntries(
    ACCOUNT_NOTIFICATION_EVENTS.map((eventKey) => [
      eventKey,
      typeof parsed[eventKey] === "boolean"
        ? parsed[eventKey]
        : defaults[eventKey],
    ]),
  ) as NotificationEventPreferences;
}

export function normalizeAccountNotificationSettings(
  value: unknown,
): AccountNotificationSettings {
  const parsed = asRecord(value);
  const channels = asRecord(parsed.channels);
  const updatesFromLinear = asRecord(parsed.updatesFromLinear);
  const other = asRecord(parsed.other);

  return {
    channels: Object.fromEntries(
      ACCOUNT_NOTIFICATION_CHANNELS.map((channel) => [
        channel,
        {
          events: normalizeEventPreferences(
            asRecord(channels[channel]).events,
            channel,
          ),
        },
      ]),
    ) as AccountNotificationSettings["channels"],
    updatesFromLinear: {
      showInSidebar:
        typeof updatesFromLinear.showInSidebar === "boolean"
          ? updatesFromLinear.showInSidebar
          : DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.updatesFromLinear
              .showInSidebar,
      newsletter:
        typeof updatesFromLinear.newsletter === "boolean"
          ? updatesFromLinear.newsletter
          : DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.updatesFromLinear.newsletter,
      marketing:
        typeof updatesFromLinear.marketing === "boolean"
          ? updatesFromLinear.marketing
          : DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.updatesFromLinear.marketing,
    },
    other: {
      inviteAccepted:
        typeof other.inviteAccepted === "boolean"
          ? other.inviteAccepted
          : DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.other.inviteAccepted,
      privacyAndLegalUpdates:
        typeof other.privacyAndLegalUpdates === "boolean"
          ? other.privacyAndLegalUpdates
          : DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.other.privacyAndLegalUpdates,
      dpa:
        typeof other.dpa === "boolean"
          ? other.dpa
          : DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.other.dpa,
    },
  };
}

export function mergeAccountNotificationSettings(
  current: AccountNotificationSettings,
  patch: AccountNotificationSettingsPatch,
): AccountNotificationSettings {
  const nextChannels = Object.fromEntries(
    ACCOUNT_NOTIFICATION_CHANNELS.map((channel) => [
      channel,
      {
        ...current.channels[channel],
        ...patch.channels?.[channel],
        events: {
          ...current.channels[channel].events,
          ...patch.channels?.[channel]?.events,
        },
      },
    ]),
  ) as AccountNotificationSettings["channels"];

  return normalizeAccountNotificationSettings({
    ...current,
    ...patch,
    channels: nextChannels,
    updatesFromLinear: {
      ...current.updatesFromLinear,
      ...patch.updatesFromLinear,
    },
    other: {
      ...current.other,
      ...patch.other,
    },
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
  const parsed = asRecord(settings);

  return {
    ...parsed,
    accountNotifications,
  };
}

export function isAccountNotificationChannelKey(
  value: string,
): value is AccountNotificationChannelKey {
  return ACCOUNT_NOTIFICATION_CHANNELS.includes(
    value as AccountNotificationChannelKey,
  );
}

export function countEnabledNotificationEvents(
  channelPreferences: NotificationChannelPreferences,
) {
  return ACCOUNT_NOTIFICATION_EVENTS.filter(
    (eventKey) => channelPreferences.events[eventKey],
  ).length;
}

export function describeNotificationChannelPreferences(
  channelPreferences: NotificationChannelPreferences,
) {
  const enabledLabels = ACCOUNT_NOTIFICATION_EVENTS.filter(
    (eventKey) => channelPreferences.events[eventKey],
  ).map((eventKey) =>
    ACCOUNT_NOTIFICATION_EVENT_LABELS[eventKey].toLowerCase(),
  );

  if (enabledLabels.length === 0) {
    return "Disabled";
  }

  if (enabledLabels.length === ACCOUNT_NOTIFICATION_EVENTS.length) {
    return "Enabled for all notifications";
  }

  if (enabledLabels.length === 1) {
    return `Enabled for ${enabledLabels[0]}`;
  }

  if (enabledLabels.length === 2) {
    return `Enabled for ${enabledLabels[0]} and ${enabledLabels[1]}`;
  }

  const remainingCount = enabledLabels.length - 2;
  const remainingLabel = remainingCount === 1 ? "other" : "others";

  return `Enabled for ${enabledLabels[0]}, ${enabledLabels[1]}, and ${remainingCount} ${remainingLabel}`;
}
