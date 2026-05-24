import {
  DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS,
  describeNotificationDomainPreferences,
  mergeAccountNotificationSettings,
  normalizeAccountNotificationSettings,
} from "@/lib/account-notifications";
import { describe, expect, it } from "vitest";

describe("account notification settings", () => {
  it("migrates legacy channel matrix into Linear-specific domains", () => {
    const settings = normalizeAccountNotificationSettings({
      channels: { desktop: { events: { assignments: false, mentions: true } } },
    });

    expect(settings.inbox.assignedToMe).toBe(false);
    expect(settings.desktop.mentionsAndReplies).toBe(true);
    expect(settings.email.weeklyDigest).toBe(
      DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS.email.weeklyDigest,
    );
  });

  it("merges domain-specific patches without losing existing preferences", () => {
    const current = normalizeAccountNotificationSettings({
      email: { dailyDigest: true, productUpdates: false },
    });

    const next = mergeAccountNotificationSettings(current, {
      email: { productUpdates: true },
    });

    expect(next.email.dailyDigest).toBe(true);
    expect(next.email.productUpdates).toBe(true);
  });

  it("summarizes domain states accurately", () => {
    expect(
      describeNotificationDomainPreferences(
        "slack",
        DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS,
      ),
    ).toBe("Connect Slack to deliver notifications");
    expect(
      describeNotificationDomainPreferences(
        "desktop",
        DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS,
      ),
    ).toBe("Requires browser permission");
  });
});
