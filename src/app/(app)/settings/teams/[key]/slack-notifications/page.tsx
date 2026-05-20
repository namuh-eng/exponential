"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type SlackChannel = { id: string; name: string };
type TeamSlackPayload = {
  team?: { name: string; key: string };
  canManage?: boolean;
  workspaceSlack?: {
    status: "not_connected" | "connected" | "configuration_required";
    workspaceName: string | null;
    availableChannels: SlackChannel[];
    configurationError?: string | null;
  };
  settings?: {
    enabled: boolean;
    channelId: string | null;
    channelName: string | null;
    events: Record<string, boolean>;
  };
  notice?: string;
  error?: string;
};

const EVENT_OPTIONS = [
  {
    id: "issueCreated",
    label: "New issues",
    description: "Broadcast when an issue is created in this team.",
  },
  {
    id: "issueCompleted",
    label: "Completed issues",
    description: "Broadcast when an issue moves to a completed workflow state.",
  },
  {
    id: "comments",
    label: "New comments",
    description: "Broadcast discussion activity on team issues.",
  },
  {
    id: "projectUpdates",
    label: "Project updates",
    description: "Broadcast project milestones and status changes.",
  },
] as const;

export default function TeamSlackSettingsPage() {
  const params = useParams();
  const teamKey = params.key as string;
  const [payload, setPayload] = useState<TeamSlackPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [channelId, setChannelId] = useState("");
  const [events, setEvents] = useState<Record<string, boolean>>({});

  const encodedTeamKey = useMemo(() => encodeURIComponent(teamKey), [teamKey]);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/teams/${encodedTeamKey}/slack-notifications`,
        { headers: { Accept: "application/json" } },
      );
      const data = (await response
        .json()
        .catch(() => ({}))) as TeamSlackPayload;
      if (!response.ok) {
        throw new Error(
          data.error || "Slack notification settings could not be loaded.",
        );
      }
      setPayload(data);
      setEnabled(Boolean(data.settings?.enabled));
      setChannelId(
        data.settings?.channelId ??
          data.workspaceSlack?.availableChannels?.[0]?.id ??
          "",
      );
      setEvents(data.settings?.events ?? {});
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Slack notification settings could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [encodedTeamKey]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  async function saveSettings() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/teams/${encodedTeamKey}/slack-notifications`,
        {
          method: "PATCH",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ enabled, channelId, events }),
        },
      );
      const data = (await response
        .json()
        .catch(() => ({}))) as TeamSlackPayload;
      if (!response.ok) {
        throw new Error(
          data.error || "Slack notification settings could not be saved.",
        );
      }
      setPayload(data);
      setEnabled(Boolean(data.settings?.enabled));
      setChannelId(data.settings?.channelId ?? "");
      setEvents(data.settings?.events ?? {});
      setNotice(data.notice ?? "Slack notification settings saved.");
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

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Loading...
      </div>
    );
  }

  const workspaceSlack = payload?.workspaceSlack;
  const channels = workspaceSlack?.availableChannels ?? [];
  const connected = workspaceSlack?.status === "connected";

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
          <div className="mb-4 flex justify-center">
            <svg
              aria-label="Slack"
              className="h-12 w-12 text-[var(--color-text-tertiary)]"
              viewBox="0 0 24 24"
              fill="currentColor"
              role="img"
            >
              <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.958 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.52 2.521h-2.522V8.834zM17.687 8.834a2.528 2.528 0 0 1-2.521 2.521 2.527 2.527 0 0 1-2.521-2.521V2.522A2.527 2.527 0 0 1 15.166 0a2.528 2.528 0 0 1 2.521 2.522v6.312zM15.166 18.958a2.528 2.528 0 0 1 2.521 2.522A2.528 2.528 0 0 1 15.166 24a2.527 2.527 0 0 1-2.521-2.522v-2.52h2.521zM15.166 17.687a2.527 2.527 0 0 1-2.521-2.521 2.527 2.527 0 0 1 2.521-2.521h6.312A2.527 2.527 0 0 1 24 15.166a2.528 2.528 0 0 1-2.522 2.521h-6.312z" />
            </svg>
          </div>
          <h3 className="mb-2 text-[15px] font-medium text-[var(--color-text-primary)]">
            Slack is not connected
          </h3>
          <p className="mb-6 text-[13px] text-[var(--color-text-secondary)]">
            Connect workspace Slack from integrations before selecting team
            channels and event broadcasts.
          </p>
          <Link
            href="/settings/integrations"
            className="inline-flex rounded-md bg-white px-4 py-2 text-[13px] font-medium text-black hover:bg-white/90"
          >
            Connect Slack in integrations
          </Link>
          {workspaceSlack?.configurationError ? (
            <p className="mt-4 text-[12px] text-[var(--color-text-tertiary)]">
              {workspaceSlack.configurationError}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[15px] font-medium text-[var(--color-text-primary)]">
                Workspace Slack connected
              </h2>
              <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
                {workspaceSlack.workspaceName ?? "Slack workspace"} is available
                for {payload?.team?.name ?? teamKey} notifications.
              </p>
            </div>
            <label className="flex items-center gap-2 text-[13px] text-[var(--color-text-primary)]">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                disabled={!payload?.canManage}
              />
              Enabled
            </label>
          </div>

          <label className="mt-6 block text-[13px] font-medium text-[var(--color-text-primary)]">
            Slack channel
            <select
              className="mt-2 block w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
              value={channelId}
              onChange={(event) => setChannelId(event.target.value)}
              disabled={!payload?.canManage}
            >
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="mt-6 space-y-3">
            <legend className="text-[13px] font-medium text-[var(--color-text-primary)]">
              Broadcast events
            </legend>
            {EVENT_OPTIONS.map((option) => (
              <label
                key={option.id}
                className="flex items-start gap-3 rounded-md border border-[var(--color-border)] p-3 text-[13px]"
              >
                <input
                  type="checkbox"
                  checked={Boolean(events[option.id])}
                  onChange={(event) =>
                    setEvents((current) => ({
                      ...current,
                      [option.id]: event.target.checked,
                    }))
                  }
                  disabled={!payload?.canManage}
                />
                <span>
                  <span className="block font-medium text-[var(--color-text-primary)]">
                    {option.label}
                  </span>
                  <span className="block text-[var(--color-text-tertiary)]">
                    {option.description}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={() => void saveSettings()}
              disabled={saving || !payload?.canManage}
              className="rounded-md bg-white px-4 py-2 text-[13px] font-medium text-black disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
