"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

interface TeamTemplate {
  id: string;
  name: string;
  description: string;
}

interface TemplatesResponse {
  team: { name: string };
  templates: TeamTemplate[];
}

export default function TeamTemplatesSettingsPage() {
  const params = useParams();
  const teamKey = params.key as string;
  const [data, setData] = useState<TemplatesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/teams/${teamKey}/templates`)
      .then((res) => res.json())
      .then((json) => setData(json))
      .finally(() => setLoading(false));
  }, [teamKey]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Loading...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Team not found
      </div>
    );
  }

  return (
    <div className="max-w-[720px]">
      <div className="mb-6">
        <Link
          href={`/settings/teams/${encodeURIComponent(teamKey)}`}
          className="text-[12px] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          Back to team settings
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-semibold text-[var(--color-text-primary)]">
          Templates
        </h1>
        <button
          type="button"
          className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
        >
          New template
        </button>
      </div>
      <p className="mt-2 text-[13px] text-[var(--color-text-tertiary)]">
        Create reusable templates for issues, documents, and projects for the $
        {data.team.name} team.
      </p>

      <div className="mt-8 flex flex-col gap-2">
        {data.templates.length === 0 ? (
          <div className="rounded-lg border border-[var(--color-border)] border-dashed p-12 text-center text-[var(--color-text-tertiary)]">
            No templates have been created for this team.
          </div>
        ) : (
          data.templates.map((template) => (
            <div
              key={template.id}
              className="flex items-center justify-between rounded-lg border border-[var(--color-border)] px-4 py-3"
            >
              <div>
                <div className="text-[14px] font-medium text-[var(--color-text-primary)]">
                  {template.name}
                </div>
                <div className="text-[12px] text-[var(--color-text-tertiary)]">
                  {template.description}
                </div>
              </div>
              <button
                type="button"
                className="text-[12px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
              >
                Edit
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
