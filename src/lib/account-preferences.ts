import { type AppTheme, isAppTheme } from "@/lib/theme";

export const ACCOUNT_PREFERENCES_CHANGE_EVENT =
  "exponential:account-preferences-change";

export type DefaultHomeView = "my-issues" | "inbox" | "active-issues";
export type DisplayNamesPreference = "full" | "first";
export type FirstDayOfWeekPreference = "sunday" | "monday";
export type SendCommentShortcutPreference = "cmd-enter" | "enter";
export type FontSizePreference = "default" | "small" | "large";
export type SidebarBadgeStyle = "count" | "dot";
export type AutoAssignmentPreference = "off" | "assign-to-me";
export type GitBranchFormatPreference =
  | "team-id-title"
  | "team-id-lowercase-title"
  | "owner/team-id-title";
export type StatusTransitionPreference =
  | "manual"
  | "started"
  | "started-and-completed";

export type InboxDisplayPreferences = {
  showReadItems: boolean;
  showUnreadItemsFirst: boolean;
  showSnoozedItems: boolean;
};

export type SidebarVisibilitySettings = {
  inbox: boolean;
  myIssues: boolean;
  projects: boolean;
  views: boolean;
  initiatives: boolean;
  cycles: boolean;
};

export type AccountPreferences = {
  defaultHomeView: DefaultHomeView;
  displayNames: DisplayNamesPreference;
  firstDayOfWeek: FirstDayOfWeekPreference;
  convertEmoticons: boolean;
  sendCommentShortcut: SendCommentShortcutPreference;
  theme: AppTheme;
  fontSize: FontSizePreference;
  pointerCursors: boolean;
  openInDesktopApp: boolean;
  sidebarBadgeStyle: SidebarBadgeStyle;
  sidebarVisibility: SidebarVisibilitySettings;
  inboxDisplay: InboxDisplayPreferences;
  agentPersonalization: {
    instructions: string;
    autoFix: boolean;
  };
  automations: {
    autoAssignment: AutoAssignmentPreference;
    gitBranchFormat: GitBranchFormatPreference;
    statusTransitions: StatusTransitionPreference;
  };
};

export type AccountPreferencesPatch = Omit<
  Partial<AccountPreferences>,
  "sidebarVisibility" | "inboxDisplay" | "agentPersonalization" | "automations"
> & {
  sidebarVisibility?: Partial<SidebarVisibilitySettings>;
  inboxDisplay?: Partial<InboxDisplayPreferences>;
  agentPersonalization?: Partial<AccountPreferences["agentPersonalization"]>;
  automations?: Partial<AccountPreferences["automations"]>;
};

export const DEFAULT_ACCOUNT_PREFERENCES: AccountPreferences = {
  defaultHomeView: "my-issues",
  displayNames: "full",
  firstDayOfWeek: "sunday",
  convertEmoticons: true,
  sendCommentShortcut: "cmd-enter",
  theme: "system",
  fontSize: "default",
  pointerCursors: false,
  openInDesktopApp: false,
  sidebarBadgeStyle: "count",
  sidebarVisibility: {
    inbox: true,
    myIssues: true,
    projects: true,
    views: true,
    initiatives: true,
    cycles: true,
  },
  inboxDisplay: {
    showReadItems: true,
    showUnreadItemsFirst: false,
    showSnoozedItems: false,
  },
  agentPersonalization: {
    instructions: "",
    autoFix: false,
  },
  automations: {
    autoAssignment: "off",
    gitBranchFormat: "team-id-title",
    statusTransitions: "manual",
  },
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function isDefaultHomeView(value: unknown): value is DefaultHomeView {
  return (
    value === "my-issues" || value === "inbox" || value === "active-issues"
  );
}

function isDisplayNamesPreference(
  value: unknown,
): value is DisplayNamesPreference {
  return value === "full" || value === "first";
}

function isFirstDayOfWeekPreference(
  value: unknown,
): value is FirstDayOfWeekPreference {
  return value === "sunday" || value === "monday";
}

function isSendCommentShortcutPreference(
  value: unknown,
): value is SendCommentShortcutPreference {
  return value === "cmd-enter" || value === "enter";
}

function isFontSizePreference(value: unknown): value is FontSizePreference {
  return value === "default" || value === "small" || value === "large";
}

function isSidebarBadgeStyle(value: unknown): value is SidebarBadgeStyle {
  return value === "count" || value === "dot";
}

function isAutoAssignmentPreference(
  value: unknown,
): value is AutoAssignmentPreference {
  return value === "off" || value === "assign-to-me";
}

function isGitBranchFormatPreference(
  value: unknown,
): value is GitBranchFormatPreference {
  return (
    value === "team-id-title" ||
    value === "team-id-lowercase-title" ||
    value === "owner/team-id-title"
  );
}

function isStatusTransitionPreference(
  value: unknown,
): value is StatusTransitionPreference {
  return (
    value === "manual" ||
    value === "started" ||
    value === "started-and-completed"
  );
}

export function normalizeAccountPreferences(
  value: unknown,
): AccountPreferences {
  const parsed = asRecord(value);
  const sidebarVisibility = asRecord(parsed.sidebarVisibility);
  const agentPersonalization = asRecord(parsed.agentPersonalization);
  const inboxDisplay = asRecord(parsed.inboxDisplay);
  const automations = asRecord(parsed.automations);

  return {
    defaultHomeView: isDefaultHomeView(parsed.defaultHomeView)
      ? parsed.defaultHomeView
      : DEFAULT_ACCOUNT_PREFERENCES.defaultHomeView,
    displayNames: isDisplayNamesPreference(parsed.displayNames)
      ? parsed.displayNames
      : DEFAULT_ACCOUNT_PREFERENCES.displayNames,
    firstDayOfWeek: isFirstDayOfWeekPreference(parsed.firstDayOfWeek)
      ? parsed.firstDayOfWeek
      : DEFAULT_ACCOUNT_PREFERENCES.firstDayOfWeek,
    convertEmoticons:
      typeof parsed.convertEmoticons === "boolean"
        ? parsed.convertEmoticons
        : DEFAULT_ACCOUNT_PREFERENCES.convertEmoticons,
    sendCommentShortcut: isSendCommentShortcutPreference(
      parsed.sendCommentShortcut,
    )
      ? parsed.sendCommentShortcut
      : DEFAULT_ACCOUNT_PREFERENCES.sendCommentShortcut,
    theme: isAppTheme(parsed.theme)
      ? parsed.theme
      : DEFAULT_ACCOUNT_PREFERENCES.theme,
    fontSize: isFontSizePreference(parsed.fontSize)
      ? parsed.fontSize
      : DEFAULT_ACCOUNT_PREFERENCES.fontSize,
    pointerCursors:
      typeof parsed.pointerCursors === "boolean"
        ? parsed.pointerCursors
        : DEFAULT_ACCOUNT_PREFERENCES.pointerCursors,
    openInDesktopApp:
      typeof parsed.openInDesktopApp === "boolean"
        ? parsed.openInDesktopApp
        : DEFAULT_ACCOUNT_PREFERENCES.openInDesktopApp,
    sidebarBadgeStyle: isSidebarBadgeStyle(parsed.sidebarBadgeStyle)
      ? parsed.sidebarBadgeStyle
      : DEFAULT_ACCOUNT_PREFERENCES.sidebarBadgeStyle,
    sidebarVisibility: {
      inbox:
        typeof sidebarVisibility.inbox === "boolean"
          ? sidebarVisibility.inbox
          : DEFAULT_ACCOUNT_PREFERENCES.sidebarVisibility.inbox,
      myIssues:
        typeof sidebarVisibility.myIssues === "boolean"
          ? sidebarVisibility.myIssues
          : DEFAULT_ACCOUNT_PREFERENCES.sidebarVisibility.myIssues,
      projects:
        typeof sidebarVisibility.projects === "boolean"
          ? sidebarVisibility.projects
          : DEFAULT_ACCOUNT_PREFERENCES.sidebarVisibility.projects,
      views:
        typeof sidebarVisibility.views === "boolean"
          ? sidebarVisibility.views
          : DEFAULT_ACCOUNT_PREFERENCES.sidebarVisibility.views,
      initiatives:
        typeof sidebarVisibility.initiatives === "boolean"
          ? sidebarVisibility.initiatives
          : DEFAULT_ACCOUNT_PREFERENCES.sidebarVisibility.initiatives,
      cycles:
        typeof sidebarVisibility.cycles === "boolean"
          ? sidebarVisibility.cycles
          : DEFAULT_ACCOUNT_PREFERENCES.sidebarVisibility.cycles,
    },
    inboxDisplay: {
      showReadItems:
        typeof inboxDisplay.showReadItems === "boolean"
          ? inboxDisplay.showReadItems
          : DEFAULT_ACCOUNT_PREFERENCES.inboxDisplay.showReadItems,
      showUnreadItemsFirst:
        typeof inboxDisplay.showUnreadItemsFirst === "boolean"
          ? inboxDisplay.showUnreadItemsFirst
          : DEFAULT_ACCOUNT_PREFERENCES.inboxDisplay.showUnreadItemsFirst,
      showSnoozedItems:
        typeof inboxDisplay.showSnoozedItems === "boolean"
          ? inboxDisplay.showSnoozedItems
          : DEFAULT_ACCOUNT_PREFERENCES.inboxDisplay.showSnoozedItems,
    },
    agentPersonalization: {
      instructions:
        typeof agentPersonalization.instructions === "string"
          ? agentPersonalization.instructions
          : DEFAULT_ACCOUNT_PREFERENCES.agentPersonalization.instructions,
      autoFix:
        typeof agentPersonalization.autoFix === "boolean"
          ? agentPersonalization.autoFix
          : DEFAULT_ACCOUNT_PREFERENCES.agentPersonalization.autoFix,
    },
    automations: {
      autoAssignment: isAutoAssignmentPreference(automations.autoAssignment)
        ? automations.autoAssignment
        : DEFAULT_ACCOUNT_PREFERENCES.automations.autoAssignment,
      gitBranchFormat: isGitBranchFormatPreference(automations.gitBranchFormat)
        ? automations.gitBranchFormat
        : DEFAULT_ACCOUNT_PREFERENCES.automations.gitBranchFormat,
      statusTransitions: isStatusTransitionPreference(
        automations.statusTransitions,
      )
        ? automations.statusTransitions
        : DEFAULT_ACCOUNT_PREFERENCES.automations.statusTransitions,
    },
  };
}

export function mergeAccountPreferences(
  current: AccountPreferences,
  patch: AccountPreferencesPatch,
): AccountPreferences {
  return normalizeAccountPreferences({
    ...current,
    ...patch,
    sidebarVisibility: {
      ...current.sidebarVisibility,
      ...patch.sidebarVisibility,
    },
    inboxDisplay: {
      ...current.inboxDisplay,
      ...patch.inboxDisplay,
    },
    agentPersonalization: {
      ...current.agentPersonalization,
      ...patch.agentPersonalization,
    },
    automations: {
      ...current.automations,
      ...patch.automations,
    },
  });
}

export function readAccountPreferencesFromUserSettings(settings: unknown) {
  return normalizeAccountPreferences(asRecord(settings).accountPreferences);
}

export function writeAccountPreferencesToUserSettings(
  settings: unknown,
  accountPreferences: AccountPreferences,
) {
  const parsed = asRecord(settings);

  return {
    ...parsed,
    accountPreferences,
  };
}

export function applyFontSizePreference(fontSize: FontSizePreference) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.fontSize = fontSize;
}

export function applyPointerCursorPreference(pointerCursors: boolean) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.pointerCursors = pointerCursors
    ? "true"
    : "false";
}

export function dispatchAccountPreferencesChanged(
  accountPreferences: AccountPreferences,
) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(ACCOUNT_PREFERENCES_CHANGE_EVENT, {
      detail: accountPreferences,
    }),
  );
}
