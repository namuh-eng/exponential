"use client";

import { EmptyState } from "@/components/empty-state";
import { useEffect, useState } from "react";

export default function ProjectTemplatesPage() {
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
        Project templates
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Standardize project structures, milestones, and initial issues with
        templates.
      </p>

      <div className="mt-8">
        <EmptyState
          title="No project templates"
          description="Create your first project template to streamline project setup."
          action={{
            label: "Create project template",
            onClick: () => console.log("Create project template"),
          }}
        />
      </div>
    </div>
  );
}
