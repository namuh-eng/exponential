"use client";

import { EmptyState } from "@/components/empty-state";
import { useCallback, useEffect, useState } from "react";

type IntegrationHealth = {
  lifecycleState: string;
  lastEventAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureMessage: string | null;
  healthSummary: string | null;
};

type Integration = {
  provider: string;
  name: string;
  description: string;
  status:
    | "connected"
    | "not_connected"
    | "configuration_required"
    | "degraded"
    | "revoked"
    | "error"
    | "installing"
    | string;
  displayName: string | null;
  connectedAt: string | null;
  setupRequirement: { type: string; message: string } | null;
  actions: {
    canConnect: boolean;
    canManage: boolean;
    canDisconnect: boolean;
  };
  health: IntegrationHealth | null;
};

type IntegrationsPayload = {
  integrations?: Integration[];
  canManageIntegrations?: boolean;
  error?: string;
};

function lifecycleLabel(status: Integration["status"]): {
  text: string;
  className: string;
} {
  switch (status) {
    case "connected":
      return {
        text: "Connected",
        className: "text-green-400",
      };
    case "degraded":
      return {
        text: "Degraded",
        className: "text-amber-400",
      };
    case "error":
      return {
        text: "Error",
        className: "text-red-400",
      };
    case "installing":
      return {
        text: "Installing…",
        className: "text-[var(--color-text-secondary)]",
      };
    case "revoked":
      return {
        text: "Disconnected",
        className: "text-[var(--color-text-tertiary)]",
      };
    case "configuration_required":
      return {
        text: "Configuration required",
        className: "text-amber-300",
      };
    default:
      return {
        text: "Not connected",
        className: "text-[var(--color-text-tertiary)]",
      };
  }
}

function formatRelativeDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diffMs = now - d.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return null;
  }
}

function HealthDetail({ health }: { health: IntegrationHealth }) {
  const lastSuccess = formatRelativeDate(health.lastSuccessAt);
  const lastFailure = formatRelativeDate(health.lastFailureAt);
  const lastEvent = formatRelativeDate(health.lastEventAt);

  return (
    <div className="mt-2 space-y-0.5 text-[12px]">
      {health.healthSummary ? (
        <p className="text-[var(--color-text-tertiary)]">
          {health.healthSummary}
        </p>
      ) : null}
      {lastEvent ? (
        <p className="text-[var(--color-text-tertiary)]">
          Last event: {lastEvent}
        </p>
      ) : null}
      {lastSuccess ? (
        <p className="text-green-500/70">Last success: {lastSuccess}</p>
      ) : null}
      {lastFailure ? (
        <p className="text-red-400/70">
          Last failure: {lastFailure}
          {health.lastFailureMessage
            ? ` — ${health.lastFailureMessage}`
            : null}
        </p>
      ) : null}
    </div>
  );
}

export default function IntegrationsSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);

  const loadIntegrations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/integrations", {
        headers: { Accept: "application/json" },
      });
      const data = (await response
        .json()
        .catch(() => ({}))) as IntegrationsPayload;
      if (!response.ok) {
        throw new Error(data.error || "Integrations could not be loaded.");
      }
      setIntegrations(
        Array.isArray(data.integrations) ? data.integrations : [],
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Integrations could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadIntegrations();
  }, [loadIntegrations]);

  async function connectSlack() {
    setPendingProvider("slack");
    setNotice(null);
    setError(null);
    try {
      const response = await fetch("/api/integrations/slack/connect", {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const data = (await response.json().catch(() => ({}))) as {
        authorizationUrl?: string;
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(data.message || data.error || "Slack setup failed.");
      }
      if (data.authorizationUrl) {
        window.location.assign(data.authorizationUrl);
        return;
      }
      setNotice("Slack setup started.");
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Slack setup failed.",
      );
    } finally {
      setPendingProvider(null);
    }
  }

  async function disconnect(provider: string) {
    setPendingProvider(provider);
    setNotice(null);
    setError(null);
    try {
      const endpoint =
        provider === "slack"
          ? "/api/integrations/slack/disconnect"
          : `/api/integrations?provider=${encodeURIComponent(provider)}`;
      const response = await fetch(endpoint, {
        method: provider === "slack" ? "POST" : "DELETE",
        headers: { Accept: "application/json" },
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "Integration could not be disconnected.");
      }
      setNotice("Integration disconnected.");
      await loadIntegrations();
    } catch (disconnectError) {
      setError(
        disconnectError instanceof Error
          ? disconnectError.message
          : "Integration could not be disconnected.",
      );
    } finally {
      setPendingProvider(null);
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-[var(--color-text-tertiary)]">Loading...</div>
    );
  }

  const activeIntegrations = integrations.filter(
    (i) => i.status !== "not_connected" && i.status !== "revoked",
  );
  const connectedIntegrations = integrations.filter(
    (i) => i.status === "connected",
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
          className="mt-6 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-200"
        >
          {error}
        </div>
      ) : null}

      <div className="mt-8">
        {activeIntegrations.length ? (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
            {activeIntegrations.map((integration) => {
              const label = lifecycleLabel(integration.status);
              return (
                <div
                  className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] p-4 last:border-b-0"
                  key={integration.provider}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-[15px] font-medium text-[var(--color-text-primary)]">
                        {integration.name}
                      </h2>
                      <span
                        className={`text-[11px] font-medium uppercase tracking-wide ${label.className}`}
                      >
                        {label.text}
                      </span>
                    </div>
                    {integration.displayName ? (
                      <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
                        Connected to {integration.displayName}
                      </p>
                    ) : null}
                    {integration.health ? (
                      <HealthDetail health={integration.health} />
                    ) : null}
                    {integration.setupRequirement ? (
                      <p className="mt-2 text-[12px] text-amber-300">
                        {integration.setupRequirement.message}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {integration.actions.canConnect &&
                    integration.provider === "slack" ? (
                      <button
                        className="rounded-md bg-white px-3 py-1.5 text-[13px] font-medium text-black hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={pendingProvider === "slack"}
                        onClick={() => void connectSlack()}
                        type="button"
                      >
                        {pendingProvider === "slack" ? "Opening…" : "Connect"}
                      </button>
                    ) : null}
                    {integration.actions.canDisconnect ? (
                      <button
                        className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[13px] text-red-300 disabled:opacity-50"
                        disabled={pendingProvider === integration.provider}
                        onClick={() => void disconnect(integration.provider)}
                        type="button"
                      >
                        {pendingProvider === integration.provider
                          ? "Disconnecting…"
                          : "Disconnect"}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="No active integrations"
            description="Standardize your workflow by connecting the tools your team uses every day."
            action={{
              label: "Explore integrations",
              onClick: () => setCatalogOpen(true),
            }}
          />
        )}
      </div>

      {connectedIntegrations.length ? (
        <button
          className="mt-4 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
          onClick={() => setCatalogOpen(true)}
          type="button"
        >
          Explore integrations
        </button>
      ) : null}

      {catalogOpen ? (
        <dialog
          aria-labelledby="integration-catalog-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex h-full max-h-none w-full max-w-none items-center justify-center bg-black/60 p-4"
          open
        >
          <div className="w-full max-w-[560px] rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  className="text-[18px] font-semibold text-[var(--color-text-primary)]"
                  id="integration-catalog-title"
                >
                  Explore integrations
                </h2>
                <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
                  Connect supported providers or review the setup requirement
                  for providers that need environment configuration.
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
              {integrations.map((integration) => {
                const label = lifecycleLabel(integration.status);
                return (
                  <div
                    className="rounded-lg border border-[var(--color-border)] p-4"
                    key={integration.provider}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-[14px] font-medium text-[var(--color-text-primary)]">
                          {integration.name}
                        </h3>
                        <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
                          {integration.description}
                        </p>
                        <p className={`mt-2 text-[12px] ${label.className}`}>
                          {label.text}
                          {integration.displayName
                            ? ` · ${integration.displayName}`
                            : ""}
                        </p>
                        {integration.health ? (
                          <HealthDetail health={integration.health} />
                        ) : null}
                        {integration.setupRequirement ? (
                          <p className="mt-2 text-[12px] text-amber-300">
                            {integration.setupRequirement.message}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        {integration.actions.canDisconnect ? (
                          <button
                            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[13px] text-red-300 disabled:opacity-50"
                            disabled={
                              pendingProvider === integration.provider
                            }
                            onClick={() =>
                              void disconnect(integration.provider)
                            }
                            type="button"
                          >
                            {pendingProvider === integration.provider
                              ? "Disconnecting…"
                              : "Disconnect"}
                          </button>
                        ) : integration.provider === "slack" &&
                          integration.actions.canConnect ? (
                          <button
                            className="rounded-md bg-white px-3 py-1.5 text-[13px] font-medium text-black hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={pendingProvider === "slack"}
                            onClick={() => void connectSlack()}
                            type="button"
                          >
                            {pendingProvider === "slack"
                              ? "Opening…"
                              : "Connect"}
                          </button>
                        ) : (
                          <button
                            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[13px] text-[var(--color-text-tertiary)]"
                            disabled
                            type="button"
                          >
                            Configure
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
