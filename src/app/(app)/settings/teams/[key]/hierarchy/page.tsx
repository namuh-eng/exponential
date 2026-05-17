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
}

export default function TeamHierarchySettingsPage() {
  const params = useParams();
  const teamKey = params.key as string;
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
          href={`/settings/teams/${encodeURIComponent(teamKey)}`}
          className="text-[12px] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          Back to team settings
        </Link>
      </div>

      <h1 className="text-[20px] font-semibold text-[var(--color-text-primary)]">
        Parent team
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
          in views. Self-parenting and cycles are rejected by the server.
        </p>
      </div>

      {message ? (
        <p className="mt-4 text-[12px] text-[var(--color-text-secondary)]">
          {message}
        </p>
      ) : null}
    </div>
  );
}
