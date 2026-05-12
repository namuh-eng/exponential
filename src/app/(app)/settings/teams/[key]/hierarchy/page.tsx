"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

export default function TeamHierarchySettingsPage() {
  const params = useParams();
  const teamKey = params.key as string;
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Loading...
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
            disabled
            className="w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none disabled:opacity-50"
          >
            <option>No parent team</option>
          </select>
        </label>
        <p className="mt-3 text-[12px] text-[var(--color-text-tertiary)]">
          Team hierarchies allow you to roll up data and filter by parent team
          in views.
        </p>
      </div>
    </div>
  );
}
