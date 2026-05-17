"use client";

import {
  ACCOUNT_NOTIFICATION_CHANNELS,
  ACCOUNT_NOTIFICATION_EVENT_DESCRIPTIONS,
  ACCOUNT_NOTIFICATION_EVENT_GROUPS,
  ACCOUNT_NOTIFICATION_EVENT_LABELS,
  type AccountNotificationChannelKey,
  type AccountNotificationSettings,
  type AccountNotificationSettingsPatch,
  DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS,
  describeNotificationChannelPreferences,
  mergeAccountNotificationSettings,
} from "@/lib/account-notifications";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const CHANNEL_METADATA: Record<
  AccountNotificationChannelKey,
  {
    name: string;
    description: string;
  }
> = {
  desktop: {
    name: "Desktop",
    description: "Configure desktop alerts for activity in your workspace.",
  },
  mobile: {
    name: "Mobile",
    description: "Manage which updates are delivered to your mobile device.",
  },
  email: {
    name: "Email",
    description: "Choose which activity should arrive in your inbox.",
  },
  slack: {
    name: "Slack",
    description: "Decide which Linear events get forwarded to Slack.",
  },
};

function Toggle({
  checked,
  onChange,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={ariaLabel}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-10 rounded-full transition-colors ${
        checked ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
          checked ? "translate-x-4" : ""
        }`}
      />
    </button>
  );
}

function SectionTitle({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-4">
      <h2 className="text-[13px] font-semibold text-[var(--color-text-primary)]">
        {title}
      </h2>
      {description ? (
        <p className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
          {description}
        </p>
      ) : null}
    </div>
  );
}

function SettingRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] py-4 last:border-b-0">
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-[var(--color-text-primary)]">
          {label}
        </div>
        <div className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
          {description}
        </div>
      </div>
      <Toggle checked={checked} onChange={onChange} aria-label={label} />
    </div>
  );
}

function ChannelIcon({ channel }: { channel: AccountNotificationChannelKey }) {
  if (channel === "desktop") {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8" />
        <path d="M12 16v4" />
      </svg>
    );
  }

  if (channel === "mobile") {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
        <path d="M11 18h2" />
      </svg>
    );
  }

  if (channel === "email") {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m4 7 8 6 8-6" />
      </svg>
    );
  }

  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M9.22 13.43a2.16 2.16 0 1 0 0-4.32 2.16 2.16 0 0 0 0 4.32Zm5.56 0a2.16 2.16 0 1 0 0-4.32 2.16 2.16 0 0 0 0 4.32Zm-8.22 5.35a2.16 2.16 0 1 0 0-4.32 2.16 2.16 0 0 0 0 4.32Zm11 0a2.16 2.16 0 1 0 0-4.32 2.16 2.16 0 0 0 0 4.32ZM6.56 8.08a2.16 2.16 0 1 0 0-4.32 2.16 2.16 0 0 0 0 4.32Zm11 0a2.16 2.16 0 1 0 0-4.32 2.16 2.16 0 0 0 0 4.32Z" />
    </svg>
  );
}

function SaveIndicator({
  saveState,
}: {
  saveState: "idle" | "saving" | "saved" | "error";
}) {
  return (
    <div className="text-[12px] text-[var(--color-text-secondary)]">
      {saveState === "saving" && "Saving…"}
      {saveState === "saved" && "Saved"}
      {saveState === "error" && "Save failed"}
    </div>
  );
}

function useAccountNotificationsSettings() {
  const [settings, setSettings] = useState(
    DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS,
  );
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const saveRequestId = useRef(0);
  const saveStateTimeout = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/account/notifications", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Failed to load account notifications");
        }

        return (await response.json()) as {
          accountNotifications?: Partial<AccountNotificationSettings>;
        };
      })
      .then((data) => {
        if (cancelled || !data.accountNotifications) {
          return;
        }

        setSettings(
          mergeAccountNotificationSettings(
            DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS,
            data.accountNotifications,
          ),
        );
      })
      .catch(() => {
        setSaveState("error");
      });

    return () => {
      cancelled = true;
      if (saveStateTimeout.current) {
        window.clearTimeout(saveStateTimeout.current);
      }
    };
  }, []);

  function updateSavedIndicator() {
    if (saveStateTimeout.current) {
      window.clearTimeout(saveStateTimeout.current);
    }

    saveStateTimeout.current = window.setTimeout(() => {
      setSaveState("idle");
      saveStateTimeout.current = null;
    }, 1500);
  }

  async function persistSettings(nextSettings: AccountNotificationSettings) {
    const requestId = ++saveRequestId.current;
    setSaveState("saving");

    try {
      const response = await fetch("/api/account/notifications", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ accountNotifications: nextSettings }),
      });

      if (!response.ok) {
        throw new Error("Failed to save account notifications");
      }

      const data = (await response.json()) as {
        accountNotifications?: Partial<AccountNotificationSettings>;
      };

      if (requestId !== saveRequestId.current || !data.accountNotifications) {
        return;
      }

      setSettings(
        mergeAccountNotificationSettings(
          DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS,
          data.accountNotifications,
        ),
      );
      setSaveState("saved");
      updateSavedIndicator();
    } catch {
      if (requestId === saveRequestId.current) {
        setSaveState("error");
      }
    }
  }

  function updateSettings(patch: AccountNotificationSettingsPatch) {
    setSettings((current) => {
      const nextSettings = mergeAccountNotificationSettings(current, patch);
      void persistSettings(nextSettings);
      return nextSettings;
    });
  }

  return {
    settings,
    saveState,
    updateSettings,
  };
}

export function NotificationsOverviewPage() {
  const { settings, saveState, updateSettings } =
    useAccountNotificationsSettings();

  return (
    <div className="max-w-[820px]">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
            Notifications
          </h1>
        </div>
        <SaveIndicator saveState={saveState} />
      </div>

      <section className="mb-12">
        <SectionTitle
          title="Notification channels"
          description="Choose which channels can deliver workspace activity. Notification delivery follows the event preferences configured for each channel."
        />

        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          {ACCOUNT_NOTIFICATION_CHANNELS.map((channel) => {
            const metadata = CHANNEL_METADATA[channel];

            return (
              <Link
                key={channel}
                href={`/settings/account/notifications/${channel}`}
                aria-label={`${metadata.name} notification settings`}
                className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] px-4 py-4 transition-colors last:border-b-0 hover:bg-[var(--color-surface-hover)]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]">
                    <ChannelIcon channel={channel} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium text-[var(--color-text-primary)]">
                      {metadata.name}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)]">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          describeNotificationChannelPreferences(
                            settings.channels[channel],
                          ) === "Disabled"
                            ? "bg-[var(--color-text-tertiary)]"
                            : "bg-emerald-400"
                        }`}
                      />
                      <span>
                        {describeNotificationChannelPreferences(
                          settings.channels[channel],
                        )}
                      </span>
                    </div>
                  </div>
                </div>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="shrink-0 text-[var(--color-text-tertiary)]"
                  aria-hidden="true"
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="mb-12">
        <SectionTitle
          title="Updates from Linear"
          description="Subscribe to product announcements and important changes from the Linear team."
        />
        <div className="mb-3 text-[12px] text-[var(--color-text-tertiary)]">
          Changelog
        </div>
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4">
          <SettingRow
            label="Show updates in sidebar"
            description="Highlight new features and improvements in the app sidebar."
            checked={settings.updatesFromLinear.showInSidebar}
            onChange={(value) =>
              updateSettings({
                updatesFromLinear: { showInSidebar: value },
              })
            }
          />
          <SettingRow
            label="Changelog newsletter"
            description="Receive an email twice a month highlighting new features and improvements."
            checked={settings.updatesFromLinear.newsletter}
            onChange={(value) =>
              updateSettings({
                updatesFromLinear: { newsletter: value },
              })
            }
          />
          <SettingRow
            label="Marketing"
            description="Occasional product announcements and tips."
            checked={settings.updatesFromLinear.marketing}
            onChange={(value) =>
              updateSettings({
                updatesFromLinear: { marketing: value },
              })
            }
          />
        </div>
      </section>

      <section>
        <SectionTitle title="Other" />
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4">
          <SettingRow
            label="Invite accepted"
            description="Notify when someone accepts your invite."
            checked={settings.other.inviteAccepted}
            onChange={(value) =>
              updateSettings({
                other: { inviteAccepted: value },
              })
            }
          />
          <SettingRow
            label="Privacy and legal updates"
            description="Important privacy and legal notifications."
            checked={settings.other.privacyAndLegalUpdates}
            onChange={(value) =>
              updateSettings({
                other: { privacyAndLegalUpdates: value },
              })
            }
          />
          <SettingRow
            label="DPA"
            description="Data Processing Agreement notifications."
            checked={settings.other.dpa}
            onChange={(value) =>
              updateSettings({
                other: { dpa: value },
              })
            }
          />
        </div>
      </section>
    </div>
  );
}

export function NotificationChannelPage({
  channel,
}: {
  channel: AccountNotificationChannelKey;
}) {
  const { settings, saveState, updateSettings } =
    useAccountNotificationsSettings();
  const channelMetadata = CHANNEL_METADATA[channel];

  return (
    <div className="max-w-[820px]">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <Link
            href="/settings/account/notifications"
            className="mb-3 inline-flex items-center gap-1 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
            Notifications
          </Link>
          <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
            {channelMetadata.name}
          </h1>
          <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
            {channelMetadata.description}
          </p>
          <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
            {describeNotificationChannelPreferences(settings.channels[channel])}
          </p>
          <p className="mt-2 max-w-[620px] text-[12px] text-[var(--color-text-tertiary)]">
            Turning off an event prevents this channel from sending
            notifications for that activity. If all channels are disabled for an
            event, you won't receive notifications for it.
          </p>
        </div>
        <SaveIndicator saveState={saveState} />
      </div>

      <div className="space-y-5">
        {ACCOUNT_NOTIFICATION_EVENT_GROUPS.map((group) => (
          <section key={group.title}>
            <SectionTitle title={group.title} description={group.description} />
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4">
              {group.events.map((eventKey) => (
                <SettingRow
                  key={eventKey}
                  label={ACCOUNT_NOTIFICATION_EVENT_LABELS[eventKey]}
                  description={
                    ACCOUNT_NOTIFICATION_EVENT_DESCRIPTIONS[eventKey]
                  }
                  checked={settings.channels[channel].events[eventKey]}
                  onChange={(value) =>
                    updateSettings({
                      channels: {
                        [channel]: {
                          events: {
                            [eventKey]: value,
                          },
                        },
                      },
                    })
                  }
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
