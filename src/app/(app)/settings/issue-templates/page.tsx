"use client";

import { EmptyState } from "@/components/empty-state";
import { useEffect, useState } from "react";

export default function IssueTemplatesPage() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulate loading for now until API is ready
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
        Issue templates
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Create and manage reusable templates for issue descriptions and
        properties.
      </p>

      <div className="mt-8">
        <EmptyState
          title="No templates"
          description="Create your first issue template to standardize new issues."
          action={{
            label: "Create template",
            onClick: () => console.log("Create template"),
          }}
        />
      </div>
    </div>
  );
}
