"use client";

import { IssueLabelsSettingsView } from "@/components/issue-labels-settings-view";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

interface TeamData {
  id: string;
  name: string;
}

export default function TeamLabelsSettingsPage() {
  const params = useParams();
  const teamKey = params.key as string;
  const [team, setTeam] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/teams/${teamKey}/settings`)
      .then((res) => res.json())
      .then((teamData) => {
        setTeam(teamData.team ?? null);
      })
      .catch(() => setTeam(null))
      .finally(() => setLoading(false));
  }, [teamKey]);

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
    <div className="max-w-[960px]">
      <div className="mb-6">
        <Link
          href={`/settings/teams/${encodeURIComponent(teamKey)}`}
          className="text-[12px] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          Back to team settings
        </Link>
      </div>
      <IssueLabelsSettingsView
        initialScope="team"
        initialTeamId={team.id}
        showScopePicker={false}
        description={`Manage labels available for ${team.name} issues.`}
        createLabelButtonText="Create label"
      />
    </div>
  );
}
