"use client";

import { EmptyState } from "@/components/empty-state";
import { useEffect, useState } from "react";

const integrationCatalog = [
  {
    name: "GitHub",
    description: "Sync pull requests, commits, and issue links with Linear.",
  },
  {
    name: "Slack",
    description: "Send issue updates and create issues from Slack messages.",
  },
  {
    name: "Zendesk",
    description:
      "Connect support tickets to product work and customer requests.",
  },
];

export default function IntegrationsSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [catalogOpen, setCatalogOpen] = useState(false);

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
            onClick: () => setCatalogOpen(true),
          }}
        />
      </div>

      {catalogOpen ? (
        <dialog
          aria-labelledby="integration-catalog-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex h-full max-h-none w-full max-w-none items-center justify-center bg-black/60 p-4"
          open
        >
          <div className="w-full max-w-[520px] rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  className="text-[18px] font-semibold text-[var(--color-text-primary)]"
                  id="integration-catalog-title"
                >
                  Explore integrations
                </h2>
                <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
                  Review available integration types. Connection setup is not
                  enabled in this workspace clone yet.
                </p>
              </div>
              <button
                aria-label="Close integrations catalog"
                className="rounded-md px-2 py-1 text-[20px] leading-none text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                onClick={() => setCatalogOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="mt-5 flex flex-col gap-3">
              {integrationCatalog.map((integration) => (
                <div
                  className="rounded-lg border border-[var(--color-border)] p-4"
                  key={integration.name}
                >
                  <h3 className="text-[14px] font-medium text-[var(--color-text-primary)]">
                    {integration.name}
                  </h3>
                  <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
                    {integration.description}
                  </p>
                  <p className="mt-2 text-[12px] text-[var(--color-text-tertiary)]">
                    Setup unavailable in this workspace.
                  </p>
                </div>
              ))}
            </div>
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
