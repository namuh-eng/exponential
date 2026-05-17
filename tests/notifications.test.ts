import {
  ACCOUNT_NOTIFICATION_EVENTS,
  type AccountNotificationSettings,
  DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS,
} from "@/lib/account-notifications";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import {
  buildNotificationValues,
  extractCanonicalMentionUserIds,
  extractMentionTokens,
  filterNotificationInputsByAccountSettings,
  resolveMentionedUserIdsFromCandidates,
  shouldDeliverAccountNotificationEventForSettings,
  shouldDeliverNotificationForSettings,
} from "@/lib/notifications";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DISABLED_USER_ID = "notif-pref-disabled-user";
const ENABLED_USER_ID = "notif-pref-enabled-user";
const ACTOR_USER_ID = "notif-pref-actor-user";

function settingsWithEventEnabled(
  eventKey: string,
  enabled: boolean,
): AccountNotificationSettings {
  const settings: AccountNotificationSettings = {
    ...DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS,
    inbox: {
      ...DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.inbox,
      assignedToMe: false,
      mentionsAndReplies: false,
      subscribedIssues: false,
      teamUpdates: false,
    },
    email: {
      ...DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.email,
      issueActivity: false,
      mentionsAndReplies: false,
      dailyDigest: false,
      weeklyDigest: false,
      productUpdates: false,
      workspaceInvites: false,
    },
    desktop: {
      ...DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.desktop,
      issueActivity: false,
      mentionsAndReplies: false,
      reminders: false,
    },
    slack: {
      ...DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.slack,
      mentionsAndReplies: false,
      assignedToMe: false,
      triageActivity: false,
      projectUpdates: false,
    },
  };

  if (eventKey === "assignments") settings.inbox.assignedToMe = enabled;
  if (eventKey === "mentions" || eventKey === "comments")
    settings.inbox.mentionsAndReplies = enabled;
  if (eventKey === "dueDates") settings.desktop.reminders = enabled;
  if (eventKey === "projectUpdates") settings.email.weeklyDigest = enabled;
  if (eventKey === "teamUpdates") settings.inbox.teamUpdates = enabled;
  if (eventKey === "workspaceAdmin") settings.email.workspaceInvites = enabled;
  if (eventKey === "statusChanges" || eventKey === "relations")
    settings.inbox.subscribedIssues = enabled;

  return settings;
}

describe("notifications helpers", () => {
  it("extracts unique mention tokens from comment text", () => {
    expect(
      extractMentionTokens("Please review this, @Jaeyun and @jaeyun."),
    ).toEqual(["jaeyun"]);
  });

  it("extracts canonical mention user ids from serialized mention tokens", () => {
    expect(
      extractCanonicalMentionUserIds(
        "Please review @[Ashley](user:user-2) and @[Ashley](user:user-3)",
      ),
    ).toEqual(["user-2", "user-3"]);
  });

  it("resolves mentioned users from workspace member candidates", () => {
    const mentionedUserIds = resolveMentionedUserIdsFromCandidates(
      "Looping in @test and @ashley",
      [
        {
          userId: "user-1",
          email: "test@example.com",
          name: "Test User",
        },
        {
          userId: "user-2",
          email: "ashley@example.com",
          name: "Ashley Ha",
        },
      ],
    );

    expect(mentionedUserIds).toEqual(["user-1", "user-2"]);
  });

  it("prefers canonical user ids over duplicate display-name guessing", () => {
    const mentionedUserIds = resolveMentionedUserIdsFromCandidates(
      "Looping in @[Sam Lee](user:user-2)",
      [
        {
          userId: "user-1",
          email: "sam.one@example.com",
          name: "Sam Lee",
        },
        {
          userId: "user-2",
          email: "sam.two@example.com",
          name: "Sam Lee",
        },
      ],
    );

    expect(mentionedUserIds).toEqual(["user-2"]);
  });

  it("deduplicates recipient ids and skips actor self-notifications when building notification rows", () => {
    expect(
      buildNotificationValues({
        type: "comment",
        actorId: "actor-1",
        issueId: "issue-1",
        userIds: ["actor-1", "user-1", "user-1", null, "user-2"],
      }),
    ).toEqual([
      {
        type: "comment",
        actorId: "actor-1",
        issueId: "issue-1",
        userId: "user-1",
      },
      {
        type: "comment",
        actorId: "actor-1",
        issueId: "issue-1",
        userId: "user-2",
      },
    ]);
  });
});

describe("notification preference enforcement", () => {
  beforeAll(async () => {
    await db
      .delete(user)
      .where(
        inArray(user.id, [DISABLED_USER_ID, ENABLED_USER_ID, ACTOR_USER_ID]),
      );

    await db.insert(user).values([
      {
        id: DISABLED_USER_ID,
        name: "Disabled Preferences",
        email: "notif-pref-disabled@example.com",
        settings: {
          accountNotifications: settingsWithEventEnabled("assignments", false),
        },
      },
      {
        id: ENABLED_USER_ID,
        name: "Enabled Preferences",
        email: "notif-pref-enabled@example.com",
        settings: {
          accountNotifications: settingsWithEventEnabled("assignments", true),
        },
      },
      {
        id: ACTOR_USER_ID,
        name: "Actor",
        email: "notif-pref-actor@example.com",
        settings: {},
      },
    ]);
  });

  afterAll(async () => {
    await db
      .delete(user)
      .where(
        inArray(user.id, [DISABLED_USER_ID, ENABLED_USER_ID, ACTOR_USER_ID]),
      );
  });

  it("maps notification types to saved event preferences", () => {
    expect(
      shouldDeliverNotificationForSettings(
        "assigned",
        settingsWithEventEnabled("assignments", false),
      ),
    ).toBe(false);
    expect(
      shouldDeliverNotificationForSettings(
        "assigned",
        settingsWithEventEnabled("assignments", true),
      ),
    ).toBe(true);
    expect(
      shouldDeliverNotificationForSettings(
        "status_change",
        settingsWithEventEnabled("statusChanges", false),
      ),
    ).toBe(false);
    expect(
      shouldDeliverNotificationForSettings(
        "mentioned",
        settingsWithEventEnabled("mentions", false),
      ),
    ).toBe(false);
    expect(
      shouldDeliverNotificationForSettings(
        "comment",
        settingsWithEventEnabled("comments", false),
      ),
    ).toBe(false);
    expect(
      shouldDeliverNotificationForSettings(
        "duplicate",
        settingsWithEventEnabled("relations", false),
      ),
    ).toBe(false);
    expect(
      shouldDeliverNotificationForSettings(
        "duplicate",
        settingsWithEventEnabled("relations", true),
      ),
    ).toBe(true);
  });

  it("checks expanded account event keys used by issue, project, and admin producers", () => {
    for (const eventKey of [
      "statusChanges",
      "assignments",
      "mentions",
      "comments",
      "dueDates",
      "projectUpdates",
      "teamUpdates",
      "workspaceAdmin",
    ] as const) {
      expect(
        shouldDeliverAccountNotificationEventForSettings(
          eventKey,
          settingsWithEventEnabled(eventKey, false),
        ),
      ).toBe(false);
      expect(
        shouldDeliverAccountNotificationEventForSettings(
          eventKey,
          settingsWithEventEnabled(eventKey, true),
        ),
      ).toBe(true);
    }
  });

  it("filters persisted notification delivery by recipient account settings", async () => {
    await expect(
      filterNotificationInputsByAccountSettings([
        {
          actorId: ACTOR_USER_ID,
          issueId: "00000000-0000-0000-0000-000000000297",
          type: "assigned",
          userId: DISABLED_USER_ID,
        },
        {
          actorId: ACTOR_USER_ID,
          issueId: "00000000-0000-0000-0000-000000000297",
          type: "assigned",
          userId: ENABLED_USER_ID,
        },
        {
          actorId: ACTOR_USER_ID,
          issueId: "00000000-0000-0000-0000-000000000297",
          type: "assigned",
          userId: ACTOR_USER_ID,
        },
      ]),
    ).resolves.toEqual([
      {
        actorId: ACTOR_USER_ID,
        issueId: "00000000-0000-0000-0000-000000000297",
        type: "assigned",
        userId: ENABLED_USER_ID,
      },
    ]);
  });

  it("keeps delivery enabled when a different channel still allows the event", () => {
    const settings = settingsWithEventEnabled("assignments", false);
    settings.email.issueActivity = true;

    expect(shouldDeliverNotificationForSettings("assigned", settings)).toBe(
      true,
    );
  });
});
