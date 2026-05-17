"use client";

import {
  ACCOUNT_NOTIFICATION_DOMAINS,
  type AccountNotificationChannelKey,
  type AccountNotificationSettings,
  type AccountNotificationSettingsPatch,
  DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS,
  describeNotificationDomainPreferences,
  mergeAccountNotificationSettings,
} from "@/lib/account-notifications";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const DOMAIN_METADATA: Record<
  AccountNotificationChannelKey,
  { name: string; description: string }
> = {
  inbox: {
    name: "Inbox",
    description:
      "Control which workspace notifications appear in your Linear inbox.",
  },
  email: {
    name: "Email",
    description:
      "Manage email delivery, digests, product updates, and invite mail.",
  },
  desktop: {
    name: "Desktop",
    description:
      "Configure browser notification permission, alerts, reminders, and sound.",
  },
  slack: {
    name: "Slack",
    description:
      "Connect Slack destinations and choose which Linear events are forwarded.",
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
      className={`relative h-6 w-10 rounded-full transition-colors ${checked ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${checked ? "translate-x-4" : ""}`}
      />
    </button>
  );
}

function SectionTitle({
  title,
  description,
}: { title: string; description?: string }) {
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

function SaveIndicator({
  saveState,
}: { saveState: "idle" | "saving" | "saved" | "error" }) {
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
        if (!response.ok)
          throw new Error("Failed to load account notifications");
        return (await response.json()) as {
          accountNotifications?: Partial<AccountNotificationSettings>;
        };
      })
      .then((data) => {
        if (!cancelled && data.accountNotifications)
          setSettings(
            mergeAccountNotificationSettings(
              DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS,
              data.accountNotifications,
            ),
          );
      })
      .catch(() => setSaveState("error"));
    return () => {
      cancelled = true;
      if (saveStateTimeout.current)
        window.clearTimeout(saveStateTimeout.current);
    };
  }, []);

  function updateSavedIndicator() {
    if (saveStateTimeout.current) window.clearTimeout(saveStateTimeout.current);
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
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ accountNotifications: nextSettings }),
      });
      if (!response.ok) throw new Error("Failed to save account notifications");
      const data = (await response.json()) as {
        accountNotifications?: Partial<AccountNotificationSettings>;
      };
      if (requestId !== saveRequestId.current || !data.accountNotifications)
        return;
      setSettings(
        mergeAccountNotificationSettings(
          DEFAULT_ACCOUNT_NOTIFICATION_SETTINGS,
          data.accountNotifications,
        ),
      );
      setSaveState("saved");
      updateSavedIndicator();
    } catch {
      if (requestId === saveRequestId.current) setSaveState("error");
    }
  }

  function updateSettings(patch: AccountNotificationSettingsPatch) {
    setSettings((current) => {
      const nextSettings = mergeAccountNotificationSettings(current, patch);
      void persistSettings(nextSettings);
      return nextSettings;
    });
  }
  return { settings, saveState, updateSettings };
}

function patchFor(
  domain: AccountNotificationChannelKey,
  key: string,
  value: boolean,
): AccountNotificationSettingsPatch {
  return { [domain]: { [key]: value } } as AccountNotificationSettingsPatch;
}

export function NotificationsOverviewPage() {
  const { settings, saveState, updateSettings } =
    useAccountNotificationsSettings();

  return (
    <div className="max-w-[820px]">
      <div className="mb-8 flex items-start justify-between gap-4">
        <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
          Notifications
        </h1>
        <SaveIndicator saveState={saveState} />
      </div>

      <section className="mb-12">
        <SectionTitle
          title="Notification preferences"
          description="Configure Linear-specific notification areas instead of a shared channel matrix. Each area has controls for how that destination behaves."
        />
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          {ACCOUNT_NOTIFICATION_DOMAINS.map((domain) => {
            const metadata = DOMAIN_METADATA[domain];
            return (
              <Link
                key={domain}
                href={`/settings/account/notifications/${domain}`}
                aria-label={`${metadata.name} notification settings`}
                className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] px-4 py-4 transition-colors last:border-b-0 hover:bg-[var(--color-surface-hover)]"
              >
                <div className="min-w-0">
                  <div className="text-[14px] font-medium text-[var(--color-text-primary)]">
                    {metadata.name}
                  </div>
                  <div className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
                    {metadata.description}
                  </div>
                  <div className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
                    {describeNotificationDomainPreferences(domain, settings)}
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
              updateSettings({ updatesFromLinear: { showInSidebar: value } })
            }
          />
          <SettingRow
            label="Changelog newsletter"
            description="Receive an email twice a month highlighting new features and improvements."
            checked={settings.updatesFromLinear.changelogNewsletter}
            onChange={(value) =>
              updateSettings({
                updatesFromLinear: { changelogNewsletter: value },
              })
            }
          />
          <SettingRow
            label="Marketing"
            description="Occasional product announcements and tips."
            checked={settings.updatesFromLinear.marketing}
            onChange={(value) =>
              updateSettings({ updatesFromLinear: { marketing: value } })
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
              updateSettings({ other: { inviteAccepted: value } })
            }
          />
          <SettingRow
            label="Privacy and legal updates"
            description="Important privacy and legal notifications."
            checked={settings.other.privacyAndLegalUpdates}
            onChange={(value) =>
              updateSettings({ other: { privacyAndLegalUpdates: value } })
            }
          />
          <SettingRow
            label="DPA"
            description="Data Processing Agreement notifications."
            checked={settings.other.dpa}
            onChange={(value) => updateSettings({ other: { dpa: value } })}
          />
        </div>
      </section>
    </div>
  );
}

export function NotificationChannelPage({
  channel,
}: { channel: AccountNotificationChannelKey | "mobile" }) {
  const { settings, saveState, updateSettings } =
    useAccountNotificationsSettings();
  const activeChannel: AccountNotificationChannelKey =
    channel === "mobile" ? "inbox" : channel;
  const metadata =
    channel === "mobile"
      ? {
          name: "Mobile",
          description:
            "Mobile delivery is represented by Inbox notification preferences.",
        }
      : DOMAIN_METADATA[activeChannel];

  return (
    <div className="max-w-[820px]">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <Link
            href="/settings/account/notifications"
            className="mb-3 inline-flex items-center gap-1 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
          >
            ← Notifications
          </Link>
          <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
            {metadata.name}
          </h1>
          <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
            {metadata.description}
          </p>
          <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
            {describeNotificationDomainPreferences(activeChannel, settings)}
          </p>
        </div>
        <SaveIndicator saveState={saveState} />
      </div>

      {activeChannel === "inbox" ? (
        <section>
          <SectionTitle
            title="Inbox notifications"
            description="Choose which Linear activity creates inbox items."
          />
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4">
            <SettingRow
              label="Assigned to me"
              description="Create inbox notifications when issues are assigned to you."
              checked={settings.inbox.assignedToMe}
              onChange={(value) =>
                updateSettings(patchFor("inbox", "assignedToMe", value))
              }
            />
            <SettingRow
              label="Mentions and replies"
              description="Notify when you are mentioned or someone replies in a thread."
              checked={settings.inbox.mentionsAndReplies}
              onChange={(value) =>
                updateSettings(patchFor("inbox", "mentionsAndReplies", value))
              }
            />
            <SettingRow
              label="Subscribed issues"
              description="Include updates from issues and documents you subscribe to."
              checked={settings.inbox.subscribedIssues}
              onChange={(value) =>
                updateSettings(patchFor("inbox", "subscribedIssues", value))
              }
            />
            <SettingRow
              label="Team updates"
              description="Create inbox items for team announcements and workflow changes."
              checked={settings.inbox.teamUpdates}
              onChange={(value) =>
                updateSettings(patchFor("inbox", "teamUpdates", value))
              }
            />
          </div>
        </section>
      ) : null}

      {activeChannel === "email" ? (
        <div className="space-y-5">
          <section>
            <SectionTitle
              title="Email notifications"
              description="Choose the operational notifications that are sent as email."
            />
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4">
              <SettingRow
                label="Issue activity"
                description="Email important issue activity such as assignments and status changes."
                checked={settings.email.issueActivity}
                onChange={(value) =>
                  updateSettings(patchFor("email", "issueActivity", value))
                }
              />
              <SettingRow
                label="Mentions and replies"
                description="Email direct mentions and replies to conversations you participate in."
                checked={settings.email.mentionsAndReplies}
                onChange={(value) =>
                  updateSettings(patchFor("email", "mentionsAndReplies", value))
                }
              />
              <SettingRow
                label="Workspace invites"
                description="Send invite and membership emails."
                checked={settings.email.workspaceInvites}
                onChange={(value) =>
                  updateSettings(patchFor("email", "workspaceInvites", value))
                }
              />
            </div>
          </section>
          <section>
            <SectionTitle
              title="Digests and product updates"
              description="Separate digest and product update subscriptions from issue email."
            />
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4">
              <SettingRow
                label="Daily digest"
                description="Receive a daily summary of assigned and followed work."
                checked={settings.email.dailyDigest}
                onChange={(value) =>
                  updateSettings(patchFor("email", "dailyDigest", value))
                }
              />
              <SettingRow
                label="Weekly digest"
                description="Receive a weekly summary of workspace activity."
                checked={settings.email.weeklyDigest}
                onChange={(value) =>
                  updateSettings(patchFor("email", "weeklyDigest", value))
                }
              />
              <SettingRow
                label="Product updates"
                description="Receive Linear product announcements and release notes by email."
                checked={settings.email.productUpdates}
                onChange={(value) =>
                  updateSettings(patchFor("email", "productUpdates", value))
                }
              />
            </div>
          </section>
        </div>
      ) : null}

      {activeChannel === "desktop" ? (
        <div className="space-y-5">
          <section>
            <SectionTitle
              title="Browser permission"
              description="Desktop notifications require browser permission before alerts can be shown."
            />
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4">
              <SettingRow
                label="Enable desktop notifications"
                description={`Current browser permission: ${settings.desktop.permission}.`}
                checked={settings.desktop.enabled}
                onChange={(value) =>
                  updateSettings(patchFor("desktop", "enabled", value))
                }
              />
              <SettingRow
                label="Play notification sound"
                description="Play a short sound for desktop notifications."
                checked={settings.desktop.sound}
                onChange={(value) =>
                  updateSettings(patchFor("desktop", "sound", value))
                }
              />
            </div>
          </section>
          <section>
            <SectionTitle
              title="Desktop delivery"
              description="Choose which time-sensitive events can alert on desktop."
            />
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4">
              <SettingRow
                label="Issue activity"
                description="Notify for important issue activity in followed work."
                checked={settings.desktop.issueActivity}
                onChange={(value) =>
                  updateSettings(patchFor("desktop", "issueActivity", value))
                }
              />
              <SettingRow
                label="Mentions and replies"
                description="Notify immediately when someone needs your attention."
                checked={settings.desktop.mentionsAndReplies}
                onChange={(value) =>
                  updateSettings(
                    patchFor("desktop", "mentionsAndReplies", value),
                  )
                }
              />
              <SettingRow
                label="Reminders"
                description="Notify for due dates and scheduled reminders."
                checked={settings.desktop.reminders}
                onChange={(value) =>
                  updateSettings(patchFor("desktop", "reminders", value))
                }
              />
            </div>
          </section>
        </div>
      ) : null}

      {activeChannel === "slack" ? (
        <div className="space-y-5">
          <section>
            <SectionTitle
              title="Slack connection"
              description="Slack delivery depends on the workspace integration and destination."
            />
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4">
              <SettingRow
                label="Enable Slack notifications"
                description={`Destination: ${settings.slack.destination.replaceAll("_", " ")}.`}
                checked={settings.slack.enabled}
                onChange={(value) =>
                  updateSettings(patchFor("slack", "enabled", value))
                }
              />
            </div>
          </section>
          <section>
            <SectionTitle
              title="Slack delivery"
              description="Choose which Linear events are forwarded to Slack."
            />
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4">
              <SettingRow
                label="Mentions and replies"
                description="Forward direct mentions and replies to Slack."
                checked={settings.slack.mentionsAndReplies}
                onChange={(value) =>
                  updateSettings(patchFor("slack", "mentionsAndReplies", value))
                }
              />
              <SettingRow
                label="Assigned to me"
                description="Forward new assignments to Slack."
                checked={settings.slack.assignedToMe}
                onChange={(value) =>
                  updateSettings(patchFor("slack", "assignedToMe", value))
                }
              />
              <SettingRow
                label="Triage activity"
                description="Forward new triage items and intake updates."
                checked={settings.slack.triageActivity}
                onChange={(value) =>
                  updateSettings(patchFor("slack", "triageActivity", value))
                }
              />
              <SettingRow
                label="Project updates"
                description="Forward project health and milestone updates."
                checked={settings.slack.projectUpdates}
                onChange={(value) =>
                  updateSettings(patchFor("slack", "projectUpdates", value))
                }
              />
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
