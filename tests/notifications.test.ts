import {
  type AccountNotificationSettings,
  DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS,
} from "@/lib/account-notifications";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import {
  buildNotificationValues,
  extractMentionTokens,
  filterNotificationInputsByAccountSettings,
  resolveMentionedUserIdsFromCandidates,
  shouldDeliverNotificationForSettings,
} from "@/lib/notifications";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DISABLED_USER_ID = "notif-pref-disabled-user";
const ENABLED_USER_ID = "notif-pref-enabled-user";
const ACTOR_USER_ID = "notif-pref-actor-user";

function settingsWithEventEnabled(
  eventKey: keyof AccountNotificationSettings["channels"]["desktop"]["events"],
  enabled: boolean,
): AccountNotificationSettings {
  return {
    ...DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS,
    channels: {
      desktop: {
        events: {
          assignments: false,
          statusChanges: false,
          mentions: false,
          comments: false,
          [eventKey]: enabled,
        },
      },
      mobile: {
        events: {
          assignments: false,
          statusChanges: false,
          mentions: false,
          comments: false,
        },
      },
      email: {
        events: {
          assignments: false,
          statusChanges: false,
          mentions: false,
          comments: false,
        },
      },
      slack: {
        events: {
          assignments: false,
          statusChanges: false,
          mentions: false,
          comments: false,
        },
      },
    },
  };
}

describe("notifications helpers", () => {
  it("extracts unique mention tokens from comment text", () => {
    expect(
      extractMentionTokens("Please review this, @Jaeyun and @jaeyun."),
    ).toEqual(["jaeyun"]);
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
        settingsWithEventEnabled("comments", false),
      ),
    ).toBe(true);
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
    settings.channels.mobile.events.assignments = true;

    expect(shouldDeliverNotificationForSettings("assigned", settings)).toBe(
      true,
    );
  });
});
