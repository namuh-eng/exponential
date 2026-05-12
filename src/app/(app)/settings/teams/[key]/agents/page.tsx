"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

interface TeamAgentsData {
  name: string;
  agentGuidance: string;
  autoAssignment: boolean;
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

export default function TeamAgentsSettingsPage() {
  const params = useParams();
  const teamKey = params.key as string;
  const [team, setTeam] = useState<TeamAgentsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [agentGuidance, setAgentGuidance] = useState("");
  const [autoAssignment, setAutoAssignment] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/teams/${teamKey}/settings`)
      .then((res) => res.json())
      .then((data) => {
        setTeam(data.team);
        if (data.team) {
          setAgentGuidance(data.team.agentGuidance || "");
          setAutoAssignment(data.team.autoAssignment || false);
        }
      })
      .finally(() => setLoading(false));
  }, [teamKey]);

  async function handleSave(updates: Partial<TeamAgentsData>) {
    setSaving(true);
    setSaveMessage(null);

    const nextGuidance = updates.agentGuidance ?? agentGuidance;
    const nextAutoAssignment = updates.autoAssignment ?? autoAssignment;

    try {
      const res = await fetch(`/api/teams/${teamKey}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: team?.name, // Required by API
          key: teamKey, // Required by API
          agentGuidance: nextGuidance,
          autoAssignment: nextAutoAssignment,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to save agent settings");
      }

      setSaveMessage("Agent settings updated");
    } catch (error) {
      setSaveMessage("Failed to update agent settings");
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
        Agents
      </h1>
      <p className="mt-2 text-[13px] text-[var(--color-text-tertiary)]">
        Manage AI agent guidance and team-specific automation behavior.
      </p>

      <div className="mt-8 space-y-6">
        <div className="rounded-lg border border-[var(--color-border)] p-4">
          <h3 className="mb-2 text-[14px] font-medium text-[var(--color-text-primary)]">
            Agent guidance
          </h3>
          <p className="mb-4 text-[13px] text-[var(--color-text-secondary)]">
            Custom instructions for AI agents when they are working on issues
            for this team.
          </p>
          <textarea
            value={agentGuidance}
            onChange={(e) => setAgentGuidance(e.target.value)}
            onBlur={() => handleSave({ agentGuidance })}
            className="h-32 w-full rounded-md border border-[var(--color-border)] bg-transparent p-3 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            placeholder="e.g. Always include a testing plan for frontend changes..."
          />
        </div>

        <div className="rounded-lg border border-[var(--color-border)] p-4">
          <h3 className="mb-2 text-[14px] font-medium text-[var(--color-text-primary)]">
            Auto-assignment
          </h3>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            AI agents can automatically assign issues to team members based on
            their expertise and current load.
          </p>
          <div className="mt-4 flex items-center justify-between">
            <span className="text-[13px] text-[var(--color-text-primary)]">
              Enable auto-assignment
            </span>
            <Toggle
              enabled={autoAssignment}
              onChange={(v) => {
                setAutoAssignment(v);
                handleSave({ autoAssignment: v });
              }}
              label="Enable auto-assignment"
            />
          </div>
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
