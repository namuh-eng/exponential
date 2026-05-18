"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type Settings = {
  channelName: string | null;
  isEnabled: boolean;
  events: Record<string, boolean>;
};
type Payload = {
  slackConnected?: boolean;
  availableChannels?: string[];
  settings?: Settings;
  error?: string;
};
const eventLabels: Record<string, string> = {
  issueCreated: "New issues",
  issueUpdated: "Issue updates",
  comments: "Comments",
  statusChanges: "Status changes",
};

export default function TeamSlackSettingsPage() {
  const params = useParams();
  const teamKey = params.key as string;
  const [settings, setSettings] = useState<Settings | null>(null);
  const [channels, setChannels] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/teams/${encodeURIComponent(teamKey)}/slack-notifications`,
        { headers: { Accept: "application/json" } },
      );
      const data = (await response.json().catch(() => ({}))) as Payload;
      if (!response.ok)
        throw new Error(data.error || "Slack settings could not be loaded.");
      setConnected(Boolean(data.slackConnected));
      setChannels(data.availableChannels ?? []);
      setSettings(data.settings ?? null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Slack settings could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [teamKey]);

  useEffect(() => {
    void load();
  }, [load]);

  async function connectSlack() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/integrations/slack", {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const data = (await response.json().catch(() => ({}))) as Payload;
      if (!response.ok)
        throw new Error(data.error || "Slack could not be connected.");
      setNotice("Slack connected. Choose a channel for this team.");
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Slack could not be connected.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/teams/${encodeURIComponent(teamKey)}/slack-notifications`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(settings),
        },
      );
      const data = (await response.json().catch(() => ({}))) as Payload;
      if (!response.ok)
        throw new Error(data.error || "Slack settings could not be saved.");
      setSettings(data.settings ?? settings);
      setNotice("Slack notification settings saved.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Slack settings could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading)
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Loading...
      </div>
    );

  return (
    <div className="max-w-[720px]">
      <div className="mb-6">
        <Link
          href={`/settings/teams/${encodeURIComponent(teamKey)}`}
          className="text-[12px] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          Back to team settings
        </Link>
      </div>
      <h1 className="text-[20px] font-semibold text-[var(--color-text-primary)]">
        Slack notifications
      </h1>
      <p className="mt-2 text-[13px] text-[var(--color-text-tertiary)]">
        Connect a Slack channel to receive updates about team activity.
      </p>
      {notice ? (
        <output className="mt-6 block rounded-md border border-green-500/30 bg-green-500/10 px-4 py-3 text-[13px] text-green-300">
          {notice}
        </output>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="mt-6 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-300"
        >
          {error}
        </div>
      ) : null}
      {!connected ? (
        <div className="mt-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-6 text-center">
          <h3 className="mb-2 text-[15px] font-medium text-[var(--color-text-primary)]">
            Slack is not connected
          </h3>
          <p className="mb-6 text-[13px] text-[var(--color-text-secondary)]">
            Connect your workspace to Slack to start broadcasting team events.
          </p>
          <button
            type="button"
            onClick={() => void connectSlack()}
            disabled={saving}
            className="rounded-md bg-white px-4 py-2 text-[13px] font-medium text-black hover:bg-white/90 disabled:opacity-50"
          >
            Connect Slack
          </button>
        </div>
      ) : null}
      {connected && settings ? (
        <section className="mt-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-5">
          <label className="block text-[13px] font-medium text-[var(--color-text-primary)]">
            Slack channel
            <select
              className="mt-2 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-2 text-[13px]"
              value={settings.channelName ?? ""}
              onChange={(event) =>
                setSettings({ ...settings, channelName: event.target.value })
              }
            >
              <option value="">Choose a channel</option>
              {channels.map((channel) => (
                <option key={channel} value={channel}>
                  {channel}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-5 space-y-3">
            {Object.entries(settings.events).map(([key, enabled]) => (
              <label
                key={key}
                className="flex items-center justify-between rounded-md border border-[var(--color-border)] p-3 text-[13px]"
              >
                <span>{eventLabels[key] ?? key}</span>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      events: {
                        ...settings.events,
                        [key]: event.target.checked,
                      },
                    })
                  }
                />
              </label>
            ))}
          </div>
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !settings.channelName}
              className="rounded-md bg-white px-4 py-2 text-[13px] font-medium text-black disabled:opacity-50"
            >
              Save changes
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
