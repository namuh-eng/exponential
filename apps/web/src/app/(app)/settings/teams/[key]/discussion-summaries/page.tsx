"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

interface TeamDiscussionSummaryData {
  name: string;
  key: string;
  discussionSummariesEnabled: boolean;
  discussionSummaryMinComments: number;
  discussionSummaryRefreshMode: "manual" | "automatic";
}

function Toggle({
  enabled,
  onChange,
  label,
  disabled = false,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-[20px] w-[36px] shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${enabled ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]"}`}
    >
      <span
        className={`inline-block h-[16px] w-[16px] rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-[18px]" : "translate-x-[2px]"}`}
      />
    </button>
  );
}

export default function TeamDiscussionSummariesSettingsPage() {
  const params = useParams();
  const teamKey = params.key as string;
  const workspaceSlug =
    typeof params.workspaceSlug === "string" ? params.workspaceSlug : null;
  const teamSettingsHref = workspaceSlug
    ? `/${encodeURIComponent(workspaceSlug)}/settings/teams/${encodeURIComponent(teamKey)}`
    : `/settings/teams/${encodeURIComponent(teamKey)}`;
  const [team, setTeam] = useState<TeamDiscussionSummaryData | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [minComments, setMinComments] = useState(8);
  const [refreshMode, setRefreshMode] = useState<"manual" | "automatic">(
    "manual",
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/teams/${teamKey}/settings`)
      .then((res) => res.json())
      .then((data) => {
        const nextTeam = data.team ?? null;
        setTeam(nextTeam);
        setEnabled(nextTeam?.discussionSummariesEnabled === true);
        setMinComments(nextTeam?.discussionSummaryMinComments ?? 8);
        setRefreshMode(nextTeam?.discussionSummaryRefreshMode ?? "manual");
      })
      .finally(() => setLoading(false));
  }, [teamKey]);

  async function save(updates: Partial<TeamDiscussionSummaryData>) {
    const body = {
      discussionSummariesEnabled: updates.discussionSummariesEnabled ?? enabled,
      discussionSummaryMinComments:
        updates.discussionSummaryMinComments ?? minComments,
      discussionSummaryRefreshMode:
        updates.discussionSummaryRefreshMode ?? refreshMode,
    };
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch(`/api/teams/${teamKey}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok)
        throw new Error("Failed to save discussion summary settings");
      const data = await res.json();
      setTeam(data.team ?? team);
      setEnabled(data.team?.discussionSummariesEnabled === true);
      setMinComments(
        data.team?.discussionSummaryMinComments ??
          body.discussionSummaryMinComments,
      );
      setRefreshMode(
        data.team?.discussionSummaryRefreshMode ??
          body.discussionSummaryRefreshMode,
      );
      setSaveMessage("Discussion summaries updated");
    } catch {
      setSaveMessage("Failed to update discussion summaries");
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
  if (!team)
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Team not found
      </div>
    );

  return (
    <div className="max-w-[760px]">
      <div className="mb-6">
        <Link
          href={teamSettingsHref}
          className="text-[12px] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          Back to team settings
        </Link>
      </div>
      <h1 className="text-[20px] font-semibold text-[var(--color-text-primary)]">
        Discussion summaries
      </h1>
      <p className="mt-2 text-[13px] text-[var(--color-text-tertiary)]">
        Configure when AI summaries appear on long issue discussions and how
        stale summaries are refreshed.
      </p>

      <div className="mt-8 space-y-5">
        <section className="rounded-lg border border-[var(--color-border)] p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[13px] text-[var(--color-text-primary)]">
                Enable discussion summaries
              </div>
              <div className="mt-0.5 text-[12px] text-[var(--color-text-tertiary)]">
                Issue details show a generated team summary above eligible
                comment threads.
              </div>
            </div>
            <Toggle
              enabled={enabled}
              onChange={(value) => {
                setEnabled(value);
                void save({ discussionSummariesEnabled: value });
              }}
              label="Enable discussion summaries"
              disabled={saving}
            />
          </div>
        </section>
        <section className="rounded-lg border border-[var(--color-border)] p-4">
          <h3 className="text-[14px] font-medium text-[var(--color-text-primary)]">
            Trigger policy
          </h3>
          <label className="mt-4 flex flex-col gap-2 text-[13px] text-[var(--color-text-secondary)]">
            <span>Summarize discussions after at least this many comments</span>
            <input
              aria-label="Minimum comments for summaries"
              type="number"
              min={3}
              max={50}
              value={minComments}
              disabled={saving}
              onChange={(e) => setMinComments(Number(e.target.value))}
              onBlur={() =>
                void save({ discussionSummaryMinComments: minComments })
              }
              className="w-32 rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[var(--color-text-primary)] outline-none"
            />
          </label>
          <label className="mt-4 flex flex-col gap-2 text-[13px] text-[var(--color-text-secondary)]">
            <span>Refresh behavior</span>
            <select
              aria-label="Summary refresh behavior"
              value={refreshMode}
              disabled={saving}
              onChange={(e) => {
                const value = e.target.value as "manual" | "automatic";
                setRefreshMode(value);
                void save({ discussionSummaryRefreshMode: value });
              }}
              className="w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[var(--color-text-primary)] outline-none"
            >
              <option value="manual">
                Manual regeneration when a summary is stale
              </option>
              <option value="automatic">
                Automatically refresh after new discussion activity
              </option>
            </select>
          </label>
        </section>
        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
          <h3 className="text-[14px] font-medium text-[var(--color-text-primary)]">
            Issue detail preview
          </h3>
          <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
            For {team.key}, summaries are {enabled ? "available" : "hidden"}{" "}
            once a thread reaches {minComments} comments. Issue pages expose
            status, stale state, and regeneration controls through the
            discussion summary panel.
          </p>
          <Link
            href={
              workspaceSlug
                ? `/${encodeURIComponent(workspaceSlug)}/issues`
                : "/issues"
            }
            className="mt-3 inline-block text-[12px] text-[var(--color-accent)]"
          >
            Open issue discussions
          </Link>
        </section>
      </div>
      {saveMessage ? (
        <p className="mt-4 text-[12px] text-[var(--color-text-secondary)]">
          {saveMessage}
        </p>
      ) : null}
    </div>
  );
}
