"use client";

import { EmptyState } from "@/components/empty-state";
import { useEffect, useState } from "react";

interface ProjectLabel {
  id: string;
  name: string;
  color: string;
  description: string | null;
  issueCount: number;
}

export default function ProjectLabelsPage() {
  const [loading, setLoading] = useState(true);
  const [labels, setLabels] = useState<ProjectLabel[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/labels")
      .then(async (res) => {
        if (!res.ok) {
          throw new Error("Failed to load labels");
        }
        const data = await res.json();
        return data.labels as ProjectLabel[];
      })
      .then((data) => {
        setLabels(data);
      })
      .catch(() => {
        setErrorMessage("Unable to load project labels.");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-8 text-[var(--color-text-tertiary)]">Loading...</div>
    );
  }

  return (
    <div className="max-w-[720px]">
      <div className="flex items-center justify-between">
        <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
          Project labels
        </h1>
        <button
          type="button"
          className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
        >
          Create label
        </button>
      </div>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Create and manage labels specifically for projects to help with
        categorization and reporting.
      </p>

      {errorMessage && (
        <p className="mt-4 text-[13px] text-red-400">{errorMessage}</p>
      )}

      <div className="mt-8">
        {labels.length === 0 ? (
          <EmptyState
            title="No project labels"
            description="Create your first project label to start categorizing your roadmap."
            action={{
              label: "Create project label",
              onClick: () => console.log("Create project label"),
            }}
          />
        ) : (
          <div className="flex flex-col gap-1">
            {labels.map((label) => (
              <div
                key={label.id}
                className="flex items-center justify-between rounded-lg border border-[var(--color-border)] px-4 py-3 hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: label.color }}
                  />
                  <div>
                    <div className="text-[14px] font-medium text-[var(--color-text-primary)]">
                      {label.name}
                    </div>
                    {label.description && (
                      <div className="text-[12px] text-[var(--color-text-tertiary)]">
                        {label.description}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-[12px] text-[var(--color-text-tertiary)]">
                    {label.issueCount}{" "}
                    {label.issueCount === 1 ? "issue" : "issues"}
                  </span>
                  <button
                    type="button"
                    className="text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                  >
                    Edit
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
