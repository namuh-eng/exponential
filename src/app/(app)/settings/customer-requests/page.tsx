"use client";

import { EmptyState } from "@/components/empty-state";
import { useEffect, useState } from "react";

export default function CustomerRequestsSettingsPage() {
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
        Customer requests
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Manage how customer feedback and requests are captured and linked to
        issues.
      </p>

      <div className="mt-8">
        <EmptyState
          title="No requests configured"
          description="Connect external tools to start surfacing customer requests in your workspace."
        />
      </div>
    </div>
  );
}
