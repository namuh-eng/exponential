"use client";

import { EmptyState } from "@/components/empty-state";
import { useCallback, useEffect, useState } from "react";

type Integration = {
  provider: string;
  name: string;
  description: string;
  connected: boolean;
  status: string;
  detail: string;
  connectedAt: string | null;
};

type Payload = {
  integrations?: Integration[];
  canManageIntegrations?: boolean;
  error?: string;
};

export default function IntegrationsSettingsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/integrations", {
        headers: { Accept: "application/json" },
      });
      const data = (await response.json().catch(() => ({}))) as Payload;
      if (!response.ok)
        throw new Error(data.error || "Integrations could not be loaded.");
      setIntegrations(data.integrations ?? []);
      setCanManage(Boolean(data.canManageIntegrations));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Integrations could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutate(provider: string, method: "POST" | "DELETE") {
    setBusy(provider);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/integrations/${encodeURIComponent(provider)}`,
        { method, headers: { Accept: "application/json" } },
      );
      const data = (await response.json().catch(() => ({}))) as Payload;
      if (!response.ok)
        throw new Error(data.error || "Integration could not be updated.");
      setIntegrations(data.integrations ?? []);
      setNotice(
        method === "POST"
          ? "Integration connected."
          : "Integration disconnected.",
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Integration could not be updated.",
      );
    } finally {
      setBusy(null);
    }
  }

  if (loading)
    return (
      <div className="p-8 text-[var(--color-text-tertiary)]">
        Loading integrations...
      </div>
    );

  return (
    <div className="max-w-[760px]">
      <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
        Integrations
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Connect your workspace with GitHub, Slack, and other tools to automate
        your workflow.
      </p>
      {notice ? (
        <output className="mt-6 block rounded-md border border-green-500/30 bg-green-500/10 px-4 py-3 text-[13px] text-green-300">
          {notice}
        </output>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="mt-6 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-300"
        >
          {error}
        </div>
      ) : null}
      <section aria-label="Integration catalog" className="mt-8">
        {integrations.length ? (
          <div className="grid gap-3">
            {integrations.map((integration) => (
              <article
                key={integration.provider}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-[15px] font-medium text-[var(--color-text-primary)]">
                      {integration.name}
                    </h2>
                    <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
                      {integration.description}
                    </p>
                    <p className="mt-2 text-[12px] text-[var(--color-text-tertiary)]">
                      {integration.detail}
                    </p>
                  </div>
                  {integration.connected ? (
                    <button
                      type="button"
                      disabled={!canManage || busy === integration.provider}
                      onClick={() =>
                        void mutate(integration.provider, "DELETE")
                      }
                      className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[13px] text-red-300 disabled:opacity-50"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={
                        !canManage ||
                        busy === integration.provider ||
                        integration.status === "configuration_required"
                      }
                      onClick={() => void mutate(integration.provider, "POST")}
                      className="rounded-md bg-white px-3 py-1.5 text-[13px] font-medium text-black disabled:opacity-50"
                    >
                      Connect
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No integrations available"
            description="No integration providers could be loaded."
          />
        )}
      </section>
    </div>
  );
}
