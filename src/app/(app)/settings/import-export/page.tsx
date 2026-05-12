"use client";

import { EmptyState } from "@/components/empty-state";
import { useEffect, useState } from "react";

export default function ImportExportPage() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 500);
    return () => clearTimeout(timer);
  }, []);

  if (loading) {
    return (
      <div className="p-8 text-[var(--color-text-tertiary)]">Loading...</div>
    );
  }

  return (
    <div className="max-w-[720px]">
      <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
        Import & export
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Migrate data from other tools or export your workspace data for backup.
      </p>

      <div className="mt-8">
        <EmptyState
          title="Data Management"
          description="Import data from GitHub, Jira, or CSV. You can also export all issues and projects."
          action={{
            label: "Start import",
            onClick: () => console.log("Import"),
          }}
        />
      </div>
    </div>
  );
}
