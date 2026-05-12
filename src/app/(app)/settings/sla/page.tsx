"use client";

import { EmptyState } from "@/components/empty-state";
import { useEffect, useState } from "react";

export default function SLAPage() {
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
        SLAs
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Set service level agreements to track and ensure timely response to
        issues.
      </p>

      <div className="mt-8">
        <EmptyState
          title="No SLAs"
          description="Configure your first SLA to start monitoring response times."
          action={{
            label: "Create SLA",
            onClick: () => console.log("Create SLA"),
          }}
        />
      </div>
    </div>
  );
}
