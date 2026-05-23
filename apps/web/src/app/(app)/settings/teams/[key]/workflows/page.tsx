"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type WorkflowState = { id: string; name: string; category: string };
type StatusTransitionRule = {
  id: string;
  name: string;
  trigger:
    | "branch_created"
    | "pr_opened"
    | "pr_merged"
    | "issue_assigned"
    | "issue_unassigned";
  sourceCategory: "any" | "backlog" | "unstarted" | "started" | "completed";
  targetStatusId: string;
  enabled: boolean;
};

interface TeamWorkflowData {
  name: string;
  detailedHistory: boolean;
  gitBranchFormat: string;
  gitPrAutomationEnabled: boolean;
  gitPrMergeTargetStatusId: string | null;
  gitBranchCreateTargetStatusId: string | null;
  autoAssignment: boolean;
  autoAssignEnabled?: boolean;
  autoAssignMode: "creator" | "team_lead" | "round_robin" | "none";
  statusTransitionRules: StatusTransitionRule[];
  acceptDestinationStates: WorkflowState[];
  declineDestinationStates: WorkflowState[];
}

const triggerLabels: Record<StatusTransitionRule["trigger"], string> = {
  branch_created: "Branch created",
  pr_opened: "Pull request opened",
  pr_merged: "Pull request merged",
  issue_assigned: "Issue assigned",
  issue_unassigned: "Issue unassigned",
};

function Toggle({
  enabled,
  onChange,
  label,
}: { enabled: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-[20px] w-[36px] shrink-0 cursor-pointer items-center rounded-full transition-colors ${enabled ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]"}`}
    >
      <span
        className={`inline-block h-[16px] w-[16px] rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-[18px]" : "translate-x-[2px]"}`}
      />
    </button>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">
      {children}
    </span>
  );
}

export default function TeamWorkflowsSettingsPage() {
  const params = useParams();
  const teamKey = params.key as string;
  const workspaceSlug =
    typeof params.workspaceSlug === "string" ? params.workspaceSlug : null;
  const backHref = workspaceSlug
    ? `/${workspaceSlug}/settings/teams/${encodeURIComponent(teamKey)}`
    : `/settings/teams/${encodeURIComponent(teamKey)}`;
  const [team, setTeam] = useState<TeamWorkflowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/teams/${teamKey}/settings`)
      .then((res) => res.json())
      .then((data) => setTeam(data.team))
      .finally(() => setLoading(false));
  }, [teamKey]);

  const statuses = useMemo(() => {
    if (!team) return [];
    return [...team.acceptDestinationStates, ...team.declineDestinationStates];
  }, [team]);

  async function savePatch(patch: Partial<TeamWorkflowData>) {
    if (!team) return;
    const previous = team;
    const nextTeam = { ...team, ...patch };
    setTeam(nextTeam);
    setSaving(true);
    setSaveMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/teams/${teamKey}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data =
        "json" in res && typeof res.json === "function"
          ? await res.json().catch(() => ({}))
          : {};
      if (!res.ok)
        throw new Error(data.error || "Failed to save workflow settings");
      setTeam(data.team ?? nextTeam);
      setSaveMessage("Workflow settings updated");
    } catch (err) {
      setTeam(previous);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to update workflow settings",
      );
    } finally {
      setSaving(false);
    }
  }

  function updateRule(id: string, patch: Partial<StatusTransitionRule>) {
    if (!team) return;
    savePatch({
      statusTransitionRules: team.statusTransitionRules.map((rule) =>
        rule.id === id ? { ...rule, ...patch } : rule,
      ),
    });
  }

  function addRule() {
    if (!team) return;
    const targetStatusId = statuses[0]?.id;
    if (!targetStatusId) {
      setError(
        "Create at least one workflow status before adding transition rules",
      );
      return;
    }
    savePatch({
      statusTransitionRules: [
        ...team.statusTransitionRules,
        {
          id: `rule-${Date.now()}`,
          name: "Move linked issues",
          trigger: "pr_opened",
          sourceCategory: "any",
          targetStatusId,
          enabled: true,
        },
      ],
    });
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
    <div className="max-w-[760px] pb-12">
      <div className="mb-6">
        <Link
          href={backHref}
          className="text-[12px] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          Back to team settings
        </Link>
      </div>
      <h1 className="text-[20px] font-semibold text-[var(--color-text-primary)]">
        Workflows & automations
      </h1>
      <p className="mt-2 text-[13px] text-[var(--color-text-tertiary)]">
        Manage Git workflows, auto-assignment, status transition rules, and
        audit behaviors for {team.name}.
      </p>

      <section
        className="mt-8 rounded-lg border border-[var(--color-border)] p-4"
        aria-labelledby="git-workflows-heading"
      >
        <h2
          id="git-workflows-heading"
          className="text-[15px] font-semibold text-[var(--color-text-primary)]"
        >
          Git workflows
        </h2>
        <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
          Configure branch naming and linked issue movement from branches and
          pull requests.
        </p>
        <div className="mt-4 grid gap-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] text-[var(--color-text-primary)]">
                Enable branch and PR automation
              </div>
              <div className="text-[12px] text-[var(--color-text-tertiary)]">
                Move issues automatically when branches or pull requests change.
              </div>
            </div>
            <Toggle
              enabled={team.gitPrAutomationEnabled}
              onChange={(v) => savePatch({ gitPrAutomationEnabled: v })}
              label="Enable branch and PR automation"
            />
          </div>
          <div className="grid gap-1">
            <FieldLabel>Branch name format</FieldLabel>
            <input
              aria-label="Branch name format"
              value={team.gitBranchFormat}
              onChange={(e) =>
                setTeam({ ...team, gitBranchFormat: e.target.value })
              }
              onBlur={(e) => savePatch({ gitBranchFormat: e.target.value })}
              className="rounded border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <FieldLabel>When branch is created</FieldLabel>
              <select
                aria-label="Branch created target status"
                value={team.gitBranchCreateTargetStatusId ?? ""}
                onChange={(e) =>
                  savePatch({
                    gitBranchCreateTargetStatusId: e.target.value || null,
                  })
                }
                className="rounded border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px]"
              >
                <option value="">Do not move issue</option>
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <FieldLabel>When PR is merged</FieldLabel>
              <select
                aria-label="PR merged target status"
                value={team.gitPrMergeTargetStatusId ?? ""}
                onChange={(e) =>
                  savePatch({
                    gitPrMergeTargetStatusId: e.target.value || null,
                  })
                }
                className="rounded border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px]"
              >
                <option value="">Do not move issue</option>
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </section>

      <section
        className="mt-4 rounded-lg border border-[var(--color-border)] p-4"
        aria-labelledby="auto-assignment-heading"
      >
        <h2
          id="auto-assignment-heading"
          className="text-[15px] font-semibold text-[var(--color-text-primary)]"
        >
          Auto-assignment
        </h2>
        <div className="mt-4 flex items-center justify-between">
          <div>
            <div className="text-[13px] text-[var(--color-text-primary)]">
              Assign new team issues automatically
            </div>
            <div className="text-[12px] text-[var(--color-text-tertiary)]">
              Choose the default owner rule for new issues in {team.name}.
            </div>
          </div>
          <Toggle
            enabled={team.autoAssignment}
            onChange={(v) =>
              savePatch({ autoAssignEnabled: v, autoAssignment: v })
            }
            label="Assign new team issues automatically"
          />
        </div>
        <div className="mt-4 grid gap-1">
          <FieldLabel>Assignment mode</FieldLabel>
          <select
            aria-label="Assignment mode"
            value={team.autoAssignMode}
            onChange={(e) =>
              savePatch({
                autoAssignMode: e.target
                  .value as TeamWorkflowData["autoAssignMode"],
              })
            }
            className="rounded border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px]"
          >
            <option value="none">No default assignee</option>
            <option value="creator">Issue creator</option>
            <option value="team_lead">Team lead</option>
            <option value="round_robin">Round-robin team members</option>
          </select>
        </div>
      </section>

      <section
        className="mt-4 rounded-lg border border-[var(--color-border)] p-4"
        aria-labelledby="status-transition-rules-heading"
      >
        <div className="flex items-center justify-between">
          <div>
            <h2
              id="status-transition-rules-heading"
              className="text-[15px] font-semibold text-[var(--color-text-primary)]"
            >
              Status transition rules
            </h2>
            <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
              Create rules that move issues to valid workflow statuses.
            </p>
          </div>
          <button
            type="button"
            onClick={addRule}
            className="rounded bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white"
          >
            Add rule
          </button>
        </div>
        <div className="mt-4 grid gap-3">
          {team.statusTransitionRules.length === 0 && (
            <div className="rounded border border-dashed border-[var(--color-border)] p-3 text-[12px] text-[var(--color-text-tertiary)]">
              No transition rules yet.
            </div>
          )}
          {team.statusTransitionRules.map((rule) => (
            <div
              key={rule.id}
              className="grid gap-3 rounded border border-[var(--color-border)] p-3"
            >
              <div className="flex items-center justify-between">
                <input
                  aria-label="Rule name"
                  value={rule.name}
                  onChange={(e) =>
                    setTeam({
                      ...team,
                      statusTransitionRules: team.statusTransitionRules.map(
                        (r) =>
                          r.id === rule.id ? { ...r, name: e.target.value } : r,
                      ),
                    })
                  }
                  onBlur={(e) => updateRule(rule.id, { name: e.target.value })}
                  className="rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-[13px]"
                />
                <Toggle
                  enabled={rule.enabled}
                  onChange={(v) => updateRule(rule.id, { enabled: v })}
                  label={`Enable ${rule.name}`}
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <select
                  aria-label="Rule trigger"
                  value={rule.trigger}
                  onChange={(e) =>
                    updateRule(rule.id, {
                      trigger: e.target
                        .value as StatusTransitionRule["trigger"],
                    })
                  }
                  className="rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-[12px]"
                >
                  {Object.entries(triggerLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Rule source category"
                  value={rule.sourceCategory}
                  onChange={(e) =>
                    updateRule(rule.id, {
                      sourceCategory: e.target
                        .value as StatusTransitionRule["sourceCategory"],
                    })
                  }
                  className="rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-[12px]"
                >
                  <option value="any">Any status</option>
                  <option value="backlog">Backlog</option>
                  <option value="unstarted">Unstarted</option>
                  <option value="started">Started</option>
                  <option value="completed">Completed</option>
                </select>
                <select
                  aria-label="Rule target status"
                  value={rule.targetStatusId}
                  onChange={(e) =>
                    updateRule(rule.id, { targetStatusId: e.target.value })
                  }
                  className="rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-[12px]"
                >
                  {statuses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() =>
                  savePatch({
                    statusTransitionRules: team.statusTransitionRules.filter(
                      (r) => r.id !== rule.id,
                    ),
                  })
                }
                className="justify-self-start text-[12px] text-red-500"
              >
                Delete rule
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-[var(--color-border)] p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] text-[var(--color-text-primary)]">
              Enable detailed issue history
            </div>
            <div className="text-[12px] text-[var(--color-text-tertiary)]">
              Track all changes to issues with audit-level detail.
            </div>
          </div>
          <Toggle
            enabled={team.detailedHistory}
            onChange={(v) => savePatch({ detailedHistory: v })}
            label="Enable detailed issue history"
          />
        </div>
      </section>

      {(saving || saveMessage || error) && (
        <p
          role={error ? "alert" : "status"}
          className="mt-4 text-[12px] text-[var(--color-text-secondary)]"
        >
          {saving ? "Saving workflow settings..." : error || saveMessage}
        </p>
      )}
    </div>
  );
}
