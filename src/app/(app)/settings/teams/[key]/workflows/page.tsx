"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

interface TeamWorkflowData {
  name: string;
  detailedHistory: boolean;
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

export default function TeamWorkflowsSettingsPage() {
  const params = useParams();
  const teamKey = params.key as string;
  const [team, setTeam] = useState<TeamWorkflowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailedHistory, setDetailedHistory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/teams/${teamKey}/settings`)
      .then((res) => res.json())
      .then((data) => {
        setTeam(data.team);
        if (data.team) {
          setDetailedHistory(data.team.detailedHistory);
        }
      })
      .finally(() => setLoading(false));
  }, [teamKey]);

  async function handleSave(nextEnabled: boolean) {
    setDetailedHistory(nextEnabled);
    setSaving(true);
    setSaveMessage(null);

    try {
      const res = await fetch(`/api/teams/${teamKey}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ detailedHistory: nextEnabled }),
      });

      if (!res.ok) {
        throw new Error("Failed to save workflow settings");
      }

      setSaveMessage("Workflow settings updated");
    } catch (error) {
      setSaveMessage("Failed to update workflow settings");
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
        Workflows & automations
      </h1>
      <p className="mt-2 text-[13px] text-[var(--color-text-tertiary)]">
        Manage how work flows through your team and configure automated
        behaviors.
      </p>

      <div className="mt-8 rounded-lg border border-[var(--color-border)] p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] text-[var(--color-text-primary)]">
              Enable detailed issue history
            </div>
            <div className="mt-0.5 text-[12px] text-[var(--color-text-tertiary)]">
              Track all changes to issues with audit-level detail
            </div>
          </div>
          <Toggle
            enabled={detailedHistory}
            onChange={handleSave}
            label="Enable detailed issue history"
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
