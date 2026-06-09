"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

interface TeamAgentsData {
  name: string;
  agentGuidance: string;
  autoAssignment: boolean;
  canModifyAgentGuidance?: boolean;
  agentGuidancePermissionLabel?: string;
  guidanceEntries?: { source: string; label: string; instructions: string }[];
  effectiveAgentPromptPreview?: string;
  agentGuidanceLastSavedAt?: string | null;
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
  const workspaceSlug =
    typeof params.workspaceSlug === "string" ? params.workspaceSlug : null;
  const teamSettingsHref = workspaceSlug
    ? `/${encodeURIComponent(workspaceSlug)}/settings/teams/${encodeURIComponent(teamKey)}`
    : `/settings/teams/${encodeURIComponent(teamKey)}`;
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
        const payload =
          typeof res.json === "function"
            ? ((await res.json().catch(() => null)) as {
                error?: string;
              } | null)
            : null;
        throw new Error(payload?.error ?? "Failed to update agent settings");
      }

      const payload =
        typeof res.json === "function"
          ? ((await res.json().catch(() => null)) as {
              team?: TeamAgentsData;
            } | null)
          : null;
      if (payload?.team) {
        setTeam(payload.team);
      }
      setSaveMessage("Agent settings updated");
    } catch (error) {
      setSaveMessage(
        error instanceof Error
          ? error.message
          : "Failed to update agent settings",
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
          href={teamSettingsHref}
          className="text-[12px] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          Back to team settings
        </Link>
      </div>

      <h1 className="text-[20px] font-semibold text-[var(--color-text-primary)]">
        Agents
      </h1>
      <p className="mt-2 text-[13px] text-[var(--color-text-tertiary)]">
        Manage team instructions and assignment automation behavior.
      </p>

      <div className="mt-8 space-y-6">
        <div className="rounded-lg border border-[var(--color-border)] p-4">
          <div className="mb-4 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-[12px] text-[var(--color-text-secondary)]">
            <div className="font-medium text-[var(--color-text-primary)]">
              Permission state
            </div>
            <div>
              {team.agentGuidancePermissionLabel ?? "Workspace policy loaded."}
            </div>
            <div className="mt-1">
              Last saved:{" "}
              {team.agentGuidanceLastSavedAt
                ? new Date(team.agentGuidanceLastSavedAt).toLocaleString()
                : "Not saved yet"}
            </div>
          </div>
          <h3 className="mb-2 text-[14px] font-medium text-[var(--color-text-primary)]">
            Team agent guidance
          </h3>
          <p className="mb-4 text-[13px] text-[var(--color-text-secondary)]">
            Team-specific instructions are included in agent run prompt
            configuration when this team is selected.
          </p>
          <textarea
            value={agentGuidance}
            onChange={(e) => setAgentGuidance(e.target.value)}
            onBlur={() => handleSave({ agentGuidance })}
            disabled={saving || team.canModifyAgentGuidance === false}
            aria-label="Agent guidance"
            className="h-32 w-full rounded-md border border-[var(--color-border)] bg-transparent p-3 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            placeholder="e.g. Always include a testing plan for frontend changes..."
          />
          {team.canModifyAgentGuidance === false && (
            <p className="mt-2 text-[12px] text-[var(--color-text-tertiary)]">
              You do not have permission to modify agent guidance in this
              workspace.
            </p>
          )}
        </div>

        <div className="rounded-lg border border-[var(--color-border)] p-4">
          <h3 className="mb-3 text-[14px] font-medium text-[var(--color-text-primary)]">
            Effective guidance stack
          </h3>
          <div className="space-y-3">
            {(team.guidanceEntries?.length ?? 0) > 0 ? (
              team.guidanceEntries?.map((entry) => (
                <div
                  key={entry.source}
                  className="rounded-md border border-[var(--color-border)] p-3"
                >
                  <div className="text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-tertiary)]">
                    {entry.label}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-[13px] text-[var(--color-text-primary)]">
                    {entry.instructions}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-[13px] text-[var(--color-text-secondary)]">
                No workspace, account, or team guidance is configured yet.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
          <h3 className="mb-2 text-[14px] font-medium text-[var(--color-text-primary)]">
            Prompt and behavior preview
          </h3>
          <p className="mb-3 text-[13px] text-[var(--color-text-secondary)]">
            This is the effective configuration sent to agent runs for team{" "}
            {teamKey}. Saving this page updates the agent run API prompt
            context.
          </p>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--color-border)] p-3 text-[12px] text-[var(--color-text-primary)]">
            {team.effectiveAgentPromptPreview}
          </pre>
        </div>

        <div className="rounded-lg border border-[var(--color-border)] p-4">
          <h3 className="mb-2 text-[14px] font-medium text-[var(--color-text-primary)]">
            Auto-assignment workflow
          </h3>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            When enabled, newly created unassigned issues are assigned to the
            team member with the lightest current issue load. This controls the
            downstream issue assignment workflow, not the prompt guidance above.
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
