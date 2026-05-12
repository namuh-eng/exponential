"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

interface TeamMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
}

export default function TeamMembersSettingsPage() {
  const params = useParams();
  const teamKey = params.key as string;
  const [team, setTeam] = useState<{ name: string } | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`/api/teams/${teamKey}/settings`).then((res) => res.json()),
      fetch(`/api/teams/${teamKey}/members`).then((res) => res.json()),
    ])
      .then(([teamData, memberData]) => {
        setTeam(teamData.team);
        setMembers(memberData.members);
      })
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
    <div className="max-w-[720px]">
      <div className="mb-6">
        <Link
          href={`/settings/teams/${encodeURIComponent(teamKey)}`}
          className="text-[12px] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          Back to team settings
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-semibold text-[var(--color-text-primary)]">
          Members
        </h1>
        <button
          type="button"
          className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
        >
          Add members
        </button>
      </div>
      <p className="mt-2 text-[13px] text-[var(--color-text-tertiary)]">
        Manage who has access to the {team.name} team.
      </p>

      <div className="mt-8 overflow-hidden rounded-lg border border-[var(--color-border)]">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-bottom border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-tertiary)]">
              <th className="px-4 py-2 font-medium">User</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr
                key={member.id}
                className="border-t border-[var(--color-border)] text-[var(--color-text-primary)]"
              >
                <td className="px-4 py-3">
                  <div className="font-medium">{member.name}</div>
                  <div className="text-[12px] text-[var(--color-text-tertiary)]">
                    {member.email}
                  </div>
                </td>
                <td className="px-4 py-3 text-[var(--color-text-secondary)] capitalize">
                  {member.role}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    className="text-[var(--color-text-tertiary)] hover:text-red-400"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
