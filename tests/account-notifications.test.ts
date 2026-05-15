import {
  ACCOUNT_NOTIFICATION_EVENTS,
  DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS,
  describeNotificationChannelPreferences,
  mergeAccountNotificationSettings,
  normalizeAccountNotificationSettings,
} from "@/lib/account-notifications";
import { describe, expect, it } from "vitest";

describe("account notification settings", () => {
  it("migrates existing four-key channel preferences and defaults new granular events", () => {
    const settings = normalizeAccountNotificationSettings({
      channels: {
        desktop: {
          events: {
            assignments: false,
            statusChanges: true,
            mentions: false,
            comments: true,
          },
        },
      },
    });

    expect(settings.channels.desktop.events.assignments).toBe(false);
    expect(settings.channels.desktop.events.statusChanges).toBe(true);
    expect(settings.channels.desktop.events.mentions).toBe(false);
    expect(settings.channels.desktop.events.comments).toBe(true);
    expect(settings.channels.desktop.events.dueDates).toBe(
      DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.channels.desktop.events.dueDates,
    );
    expect(Object.keys(settings.channels.desktop.events).sort()).toEqual(
      [...ACCOUNT_NOTIFICATION_EVENTS].sort(),
    );
  });

  it("merges granular patches without losing existing event preferences", () => {
    const current = normalizeAccountNotificationSettings({
      channels: {
        desktop: { events: { assignments: false, dueDates: true } },
      },
    });

    const next = mergeAccountNotificationSettings(current, {
      channels: {
        desktop: { events: { projectUpdates: false } },
      },
    });

    expect(next.channels.desktop.events.assignments).toBe(false);
    expect(next.channels.desktop.events.dueDates).toBe(true);
    expect(next.channels.desktop.events.projectUpdates).toBe(false);
  });

  it("summarizes all enabled categories accurately", () => {
    expect(
      describeNotificationChannelPreferences(
        DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.channels.mobile,
      ),
    ).toBe("Enabled for all notifications");

    expect(
      describeNotificationChannelPreferences({
        events: Object.fromEntries(
          ACCOUNT_NOTIFICATION_EVENTS.map((eventKey) => [eventKey, false]),
        ) as typeof DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.channels.desktop.events,
      }),
    ).toBe("Disabled");

    expect(
      describeNotificationChannelPreferences(
        DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.channels.desktop,
      ),
    ).toBe("Enabled for assignments, status changes, and 10 others");
  });
});
