"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

interface ParentTeamOption {
  id: string;
  name: string;
  key: string;
}

interface TeamHierarchyData {
  name: string;
  key: string;
  parentTeamId: string | null;
  eligibleParentTeams: ParentTeamOption[];
  parentTeam?: ParentTeamOption | null;
  childTeams?: ParentTeamOption[];
  hierarchyImpact?: {
    rollupTeamCount: number;
    filters: string[];
    teamScopePath: string;
  };
}

export default function TeamHierarchySettingsPage() {
  const params = useParams();
  const teamKey = params.key as string;
  const workspaceSlug =
    typeof params.workspaceSlug === "string" ? params.workspaceSlug : null;
  const teamSettingsHref = workspaceSlug
    ? `/${encodeURIComponent(workspaceSlug)}/settings/teams/${encodeURIComponent(teamKey)}`
    : `/settings/teams/${encodeURIComponent(teamKey)}`;
  const [team, setTeam] = useState<TeamHierarchyData | null>(null);
  const [parentTeamId, setParentTeamId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/teams/${teamKey}/settings`)
      .then((res) => res.json())
      .then((data) => {
        setTeam(data.team ?? null);
        setParentTeamId(data.team?.parentTeamId ?? "");
      })
      .finally(() => setLoading(false));
  }, [teamKey]);

  async function handleParentChange(nextParentTeamId: string) {
    if (
      nextParentTeamId &&
      !team?.eligibleParentTeams.some(
        (candidate) => candidate.id === nextParentTeamId,
      )
    ) {
      setMessage(
        "Choose an eligible parent team. Self-parenting and child cycles are blocked before saving.",
      );
      return;
    }
    const previousParentTeamId = parentTeamId;
    setParentTeamId(nextParentTeamId);
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/teams/${teamKey}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentTeamId: nextParentTeamId || null }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to update parent team");
      }

      setTeam(data.team ?? team);
      setParentTeamId(data.team?.parentTeamId ?? "");
      setMessage("Parent team updated");
    } catch (error) {
      setParentTeamId(previousParentTeamId);
      setMessage(
        error instanceof Error ? error.message : "Failed to update parent team",
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
        Team hierarchy
      </h1>
      <p className="mt-2 text-[13px] text-[var(--color-text-tertiary)]">
        Set this team as a sub-team of another team to organize team
        hierarchies.
      </p>

      <div className="mt-8 rounded-lg border border-[var(--color-border)] p-4">
        <label className="flex flex-col gap-2 text-[13px] text-[var(--color-text-secondary)]">
          <span>Parent team</span>
          <select
            value={parentTeamId}
            disabled={saving}
            onChange={(event) => void handleParentChange(event.target.value)}
            className="w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none disabled:opacity-50"
          >
            <option value="">No parent team</option>
            {team.eligibleParentTeams.map((parentTeam) => (
              <option key={parentTeam.id} value={parentTeam.id}>
                {parentTeam.name} ({parentTeam.key})
              </option>
            ))}
          </select>
        </label>
        <p className="mt-3 text-[12px] text-[var(--color-text-tertiary)]">
          Team hierarchies allow you to roll up data and filter by parent team
          in views. Self-parenting and cycles are validated before save and
          rejected by the server.
        </p>
      </div>

      <div className="mt-5 rounded-lg border border-[var(--color-border)] p-4">
        <h3 className="text-[14px] font-medium text-[var(--color-text-primary)]">
          Hierarchy context
        </h3>
        <div className="mt-3 space-y-2 text-[13px] text-[var(--color-text-secondary)]">
          <div>
            Current parent:{" "}
            <span className="text-[var(--color-text-primary)]">
              {team.parentTeam
                ? `${team.parentTeam.name} (${team.parentTeam.key})`
                : "No parent team"}
            </span>
          </div>
          <div>Child teams:</div>
          {(team.childTeams?.length ?? 0) > 0 ? (
            <ul className="ml-4 list-disc">
              {team.childTeams?.map((child) => (
                <li key={child.id}>
                  {child.name} ({child.key})
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-md border border-dashed border-[var(--color-border)] p-3 text-[12px]">
              No child teams yet. Teams that choose {team.key} as parent will
              appear here.
            </p>
          )}
        </div>
      </div>

      <div className="mt-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
        <h3 className="text-[14px] font-medium text-[var(--color-text-primary)]">
          Rollup and filter effects
        </h3>
        <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
          This hierarchy scope currently covers{" "}
          {team.hierarchyImpact?.rollupTeamCount ?? 1} team(s). Parent scopes
          roll up issues, cycles, triage, and analytics for visible child teams.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(
            team.hierarchyImpact?.filters ?? [
              "Issues",
              "Cycles",
              "Triage",
              "Analytics",
            ]
          ).map((filter) => (
            <span
              key={filter}
              className="rounded-full border border-[var(--color-border)] px-2 py-1 text-[12px] text-[var(--color-text-secondary)]"
            >
              {filter}
            </span>
          ))}
        </div>
        <Link
          href={team.hierarchyImpact?.teamScopePath ?? `/teams/${team.key}`}
          className="mt-3 inline-block text-[12px] text-[var(--color-accent)]"
        >
          Open affected team scope
        </Link>
      </div>

      {message ? (
        <p className="mt-4 text-[12px] text-[var(--color-text-secondary)]">
          {message}
        </p>
      ) : null}
    </div>
  );
}
