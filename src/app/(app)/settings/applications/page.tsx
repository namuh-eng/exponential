"use client";

import { EmptyState } from "@/components/empty-state";
import { useEffect, useState } from "react";

export default function ApplicationsSettingsPage() {
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
        Applications
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Manage third-party applications and OAuth connections for your
        workspace.
      </p>

      <div className="mt-8">
        <EmptyState
          title="No applications"
          description="You haven't authorized any third-party applications yet."
          action={{
            label: "Explore integrations",
            onClick: () => console.log("Explore"),
          }}
        />
      </div>
    </div>
  );
}
