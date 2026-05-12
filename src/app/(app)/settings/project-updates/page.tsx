"use client";

import { EmptyState } from "@/components/empty-state";
import { useEffect, useState } from "react";

export default function ProjectUpdatesPage() {
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
        Project updates
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Manage how project updates are collected, shared, and reported within
        the workspace.
      </p>

      <div className="mt-8">
        <EmptyState
          title="No update configurations"
          description="Configure reminder cadences and reporting formats for your projects."
        />
      </div>
    </div>
  );
}
