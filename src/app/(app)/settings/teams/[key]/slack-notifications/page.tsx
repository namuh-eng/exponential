"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type SlackEvent = { id: string; label: string; description: string };

type SlackSettings = {
  channelId: string;
  channelName: string;
  enabled: boolean;
  events: string[];
  updatedAt: string | null;
};

type SlackPayload = {
  team?: { id: string; key: string; name: string };
  workspaceSlack?: {
    id: string;
    status: string;
    displayName: string | null;
  } | null;
  canManageSlackNotifications?: boolean;
  availableEvents?: SlackEvent[];
  settings?: SlackSettings;
  error?: string;
};

export default function TeamSlackSettingsPage() {
  const params = useParams();
  const teamKey = params.key as string;
  const [settings, setSettings] = useState<SlackSettings | null>(null);
  const [workspaceSlack, setWorkspaceSlack] =
    useState<SlackPayload["workspaceSlack"]>(null);
  const [availableEvents, setAvailableEvents] = useState<SlackEvent[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/teams/${encodeURIComponent(teamKey)}/slack-notifications`,
        { headers: { Accept: "application/json" } },
      );
      const data = (await response.json().catch(() => ({}))) as SlackPayload;
      if (!response.ok) {
        throw new Error(
          data.error || "Slack notification settings could not be loaded.",
        );
      }
      const nextSettings = data.settings ?? null;
      setSettings(nextSettings);
      setWorkspaceSlack(data.workspaceSlack ?? null);
      setAvailableEvents(
        Array.isArray(data.availableEvents) ? data.availableEvents : [],
      );
      setCanManage(Boolean(data.canManageSlackNotifications));
      setChannelName(nextSettings?.channelName ?? "");
      setEnabled(nextSettings?.enabled ?? true);
      setSelectedEvents(nextSettings?.events ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Slack notification settings could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [teamKey]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  async function connectSlack() {
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch("/api/integrations/slack/connect", {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const data = (await response.json().catch(() => ({}))) as {
        authorizationUrl?: string;
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(data.message || data.error || "Slack setup failed.");
      }
      if (data.authorizationUrl) {
        window.location.assign(data.authorizationUrl);
        return;
      }
      setNotice("Slack setup started.");
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Slack setup failed.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveSettings() {
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(
        `/api/teams/${encodeURIComponent(teamKey)}/slack-notifications`,
        {
          method: "PATCH",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channelName,
            enabled,
            events: selectedEvents,
          }),
        },
      );
      const data = (await response.json().catch(() => ({}))) as SlackPayload;
      if (!response.ok) {
        throw new Error(
          data.error || "Slack notification settings could not be saved.",
        );
      }
      if (data.settings) {
        setSettings(data.settings);
        setChannelName(data.settings.channelName);
        setEnabled(data.settings.enabled);
        setSelectedEvents(data.settings.events);
      }
      setNotice("Slack notification settings saved.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Slack notification settings could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function disconnectTeamSlack() {
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(
        `/api/teams/${encodeURIComponent(teamKey)}/slack-notifications`,
        { method: "DELETE", headers: { Accept: "application/json" } },
      );
      const data = (await response.json().catch(() => ({}))) as SlackPayload;
      if (!response.ok) {
        throw new Error(
          data.error || "Slack notifications could not be disconnected.",
        );
      }
      setSettings({
        channelId: "",
        channelName: "",
        enabled: false,
        events: [],
        updatedAt: null,
      });
      setChannelName("");
      setEnabled(false);
      setSelectedEvents([]);
      setNotice("Team Slack notifications disconnected.");
    } catch (disconnectError) {
      setError(
        disconnectError instanceof Error
          ? disconnectError.message
          : "Slack notifications could not be disconnected.",
      );
    } finally {
      setSaving(false);
    }
  }

  function toggleEvent(eventId: string) {
    setSelectedEvents((current) =>
      current.includes(eventId)
        ? current.filter((id) => id !== eventId)
        : [...current, eventId],
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Loading...
      </div>
    );
  }

  const workspaceSlackConnected = Boolean(workspaceSlack);

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
          className="mt-6 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-200"
        >
          {error}
        </div>
      ) : null}

      {!workspaceSlackConnected ? (
        <div className="mt-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-6 text-center">
          <h3 className="mb-2 text-[15px] font-medium text-[var(--color-text-primary)]">
            Slack is not connected
          </h3>
          <p className="mb-6 text-[13px] text-[var(--color-text-secondary)]">
            Connect your workspace to Slack before selecting a team channel.
          </p>
          <button
            type="button"
            disabled={saving || !canManage}
            onClick={() => void connectSlack()}
            className="rounded-md bg-white px-4 py-2 text-[13px] font-medium text-black hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Connect Slack
          </button>
        </div>
      ) : (
        <div className="mt-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-6">
          <div className="mb-6 rounded-md border border-green-500/20 bg-green-500/10 px-4 py-3 text-[13px] text-green-200">
            Workspace Slack connected
            {workspaceSlack?.displayName
              ? `: ${workspaceSlack.displayName}`
              : ""}
          </div>

          <label
            className="block text-[13px] font-medium text-[var(--color-text-primary)]"
            htmlFor="slack-channel"
          >
            Slack channel
          </label>
          <input
            id="slack-channel"
            value={channelName}
            onChange={(event) => setChannelName(event.target.value)}
            placeholder="#eng"
            disabled={!canManage || saving}
            className="mt-2 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-[14px] text-[var(--color-text-primary)] outline-none focus:border-white/50 disabled:opacity-50"
          />

          <label className="mt-5 flex items-center gap-2 text-[13px] text-[var(--color-text-primary)]">
            <input
              type="checkbox"
              checked={enabled}
              disabled={!canManage || saving}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Enable broadcasts for this team
          </label>

          <fieldset className="mt-6">
            <legend className="text-[13px] font-medium text-[var(--color-text-primary)]">
              Events to broadcast
            </legend>
            <div className="mt-3 space-y-3">
              {availableEvents.map((event) => (
                <label
                  className="flex items-start gap-3 rounded-md border border-[var(--color-border)] p-3 text-[13px]"
                  key={event.id}
                >
                  <input
                    type="checkbox"
                    checked={selectedEvents.includes(event.id)}
                    disabled={!canManage || saving}
                    onChange={() => toggleEvent(event.id)}
                  />
                  <span>
                    <span className="block font-medium text-[var(--color-text-primary)]">
                      {event.label}
                    </span>
                    <span className="text-[var(--color-text-tertiary)]">
                      {event.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-6 flex gap-3">
            <button
              type="button"
              disabled={!canManage || saving}
              onClick={() => void saveSettings()}
              className="rounded-md bg-white px-4 py-2 text-[13px] font-medium text-black hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Save changes
            </button>
            {settings?.channelName ? (
              <button
                type="button"
                disabled={!canManage || saving}
                onClick={() => void disconnectTeamSlack()}
                className="rounded-md border border-[var(--color-border)] px-4 py-2 text-[13px] text-red-300 disabled:opacity-50"
              >
                Disconnect team channel
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
