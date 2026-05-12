"use client";

import { EmptyState } from "@/components/empty-state";
import { useEffect, useState } from "react";

export default function AsksSettingsPage() {
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
        Asks
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Manage internal requests and support tickets within your workspace.
      </p>

      <div className="mt-8">
        <EmptyState
          title="No asks configured"
          description="Enable internal support channels to start capturing requests from your team."
          action={{
            label: "Enable Asks",
            onClick: () => console.log("Enable"),
          }}
        />
      </div>
    </div>
  );
}
