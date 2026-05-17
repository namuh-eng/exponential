"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

interface TeamDiscussionSummaryData {
  name: string;
  key: string;
  discussionSummariesEnabled: boolean;
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
      className={`relative inline-flex h-[20px] w-[36px] shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        enabled ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]"
      }`}
    >
      <span
        className={`inline-block h-[16px] w-[16px] rounded-full bg-white shadow transition-transform ${
          enabled ? "translate-x-[18px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}

export default function TeamDiscussionSummariesSettingsPage() {
  const params = useParams();
  const teamKey = params.key as string;
  const [team, setTeam] = useState<TeamDiscussionSummaryData | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/teams/${teamKey}/settings`)
      .then((res) => res.json())
      .then((data) => {
        setTeam(data.team ?? null);
        setEnabled(data.team?.discussionSummariesEnabled === true);
      })
      .finally(() => setLoading(false));
  }, [teamKey]);

  async function handleToggle(nextEnabled: boolean) {
    setEnabled(nextEnabled);
    setSaving(true);
    setSaveMessage(null);

    try {
      const res = await fetch(`/api/teams/${teamKey}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discussionSummariesEnabled: nextEnabled }),
      });

      if (!res.ok) {
        throw new Error("Failed to save discussion summary settings");
      }

      const data = await res.json();
      setTeam(data.team ?? team);
      setEnabled(data.team?.discussionSummariesEnabled === true);
      setSaveMessage("Discussion summaries updated");
    } catch {
      setEnabled(!nextEnabled);
      setSaveMessage("Failed to update discussion summaries");
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

  if (!team) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Team not found
      </div>
    );
  }

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
        Discussion summaries
      </h1>
      <p className="mt-2 text-[13px] text-[var(--color-text-tertiary)]">
        Auto-generate summaries for long comment threads to help team members
        get up to speed quickly.
      </p>

      <div className="mt-8 rounded-lg border border-[var(--color-border)] p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[13px] text-[var(--color-text-primary)]">
              Enable discussion summaries
            </div>
            <div className="mt-0.5 text-[12px] text-[var(--color-text-tertiary)]">
              When enabled, issue discussions show a generated team summary
              above the comment thread.
            </div>
          </div>
          <Toggle
            enabled={enabled}
            onChange={(value) => void handleToggle(value)}
            label="Enable discussion summaries"
            disabled={saving}
          />
        </div>
      </div>

      {saveMessage ? (
        <p className="mt-4 text-[12px] text-[var(--color-text-secondary)]">
          {saveMessage}
        </p>
      ) : null}
    </div>
  );
}
