"use client";

import { EmptyState } from "@/components/empty-state";
import { useEffect, useState } from "react";

export default function IntegrationsSettingsPage() {
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
        Integrations
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Connect your workspace with GitHub, Slack, and other tools to automate
        your workflow.
      </p>

      <div className="mt-8">
        <EmptyState
          title="No active integrations"
          description="Standardize your workflow by connecting the tools your team uses every day."
          action={{
            label: "Explore integrations",
            onClick: () => console.log("Explore"),
          }}
        />
      </div>
    </div>
  );
}
