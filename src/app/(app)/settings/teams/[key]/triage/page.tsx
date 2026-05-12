"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

interface TeamTriageData {
  name: string;
  triageEnabled: boolean;
}

function Toggle({
  enabled,
  onChange,
  label,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-[20px] w-[36px] shrink-0 cursor-pointer items-center rounded-full transition-colors ${
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

export default function TeamTriageSettingsPage() {
  const params = useParams();
  const teamKey = params.key as string;
  const [team, setTeam] = useState<TeamTriageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [triageEnabled, setTriageEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/teams/${teamKey}/settings`)
      .then((res) => res.json())
      .then((data) => {
        setTeam(data.team);
        if (data.team) {
          setTriageEnabled(data.team.triageEnabled);
        }
      })
      .finally(() => setLoading(false));
  }, [teamKey]);

  async function handleSave(nextEnabled: boolean) {
    setTriageEnabled(nextEnabled);
    setSaving(true);
    setSaveMessage(null);

    try {
      const res = await fetch(`/api/teams/${teamKey}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triageEnabled: nextEnabled }),
      });

      if (!res.ok) {
        throw new Error("Failed to save triage settings");
      }

      setSaveMessage("Triage settings updated");
    } catch (error) {
      setSaveMessage("Failed to update triage settings");
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
        Triage
      </h1>
      <p className="mt-2 text-[13px] text-[var(--color-text-tertiary)]">
        Enable triage to review and categorize incoming issues before they enter
        the team backlog.
      </p>

      <div className="mt-8 rounded-lg border border-[var(--color-border)] p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] text-[var(--color-text-primary)]">
              Enable triage
            </div>
            <div className="mt-0.5 text-[12px] text-[var(--color-text-tertiary)]">
              Issues created by others will appear in Triage first
            </div>
          </div>
          <Toggle
            enabled={triageEnabled}
            onChange={handleSave}
            label="Enable triage"
          />
        </div>
      </div>

      {saveMessage && (
        <p className="mt-4 text-[12px] text-[var(--color-text-secondary)]">
          {saveMessage}
        </p>
      )}
    </div>
  );
}
