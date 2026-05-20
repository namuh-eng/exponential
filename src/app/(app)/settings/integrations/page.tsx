"use client";

import { EmptyState } from "@/components/empty-state";
import { useCallback, useEffect, useState } from "react";

type IntegrationStatus =
  | "not_connected"
  | "connected"
  | "configuration_required";

type IntegrationCard = {
  provider: "github" | "slack" | "zendesk";
  name: string;
  description: string;
  state: {
    status: IntegrationStatus;
    workspaceName?: string | null;
    installedAt?: string | null;
    configurationError?: string | null;
  };
};

type IntegrationsPayload = {
  integrations?: IntegrationCard[];
  canManageIntegrations?: boolean;
  allowLocalSlackInstall?: boolean;
  error?: string;
};

function statusLabel(status: IntegrationStatus) {
  if (status === "connected") return "Connected";
  if (status === "configuration_required") return "Configuration required";
  return "Not connected";
}

export default function IntegrationsSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [integrations, setIntegrations] = useState<IntegrationCard[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [allowLocalSlackInstall, setAllowLocalSlackInstall] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);

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
      setCanManage(Boolean(data.canManageIntegrations));
      setAllowLocalSlackInstall(Boolean(data.allowLocalSlackInstall));
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

  async function connectSlack(localInstall = false) {
    setBusyProvider("slack");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/integrations/slack", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ localInstall }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        authorizationUrl?: string;
        error?: string;
        allowLocalSlackInstall?: boolean;
      };
      if (!response.ok) {
        setAllowLocalSlackInstall(Boolean(data.allowLocalSlackInstall));
        throw new Error(data.error || "Slack could not be connected.");
      }
      if (data.authorizationUrl) {
        window.location.assign(data.authorizationUrl);
        return;
      }
      setNotice("Slack integration connected for this workspace.");
      await loadIntegrations();
      setCatalogOpen(true);
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Slack could not be connected.",
      );
    } finally {
      setBusyProvider(null);
    }
  }

  async function disconnectSlack() {
    setBusyProvider("slack");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/integrations/slack", {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "Slack could not be disconnected.");
      }
      setNotice("Slack integration disconnected.");
      await loadIntegrations();
      setCatalogOpen(true);
    } catch (disconnectError) {
      setError(
        disconnectError instanceof Error
          ? disconnectError.message
          : "Slack could not be disconnected.",
      );
    } finally {
      setBusyProvider(null);
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-[var(--color-text-tertiary)]">Loading...</div>
    );
  }

  const activeIntegrations = integrations.filter(
    (integration) => integration.state.status === "connected",
  );
  const slackIntegration = integrations.find(
    (integration) => integration.provider === "slack",
  );

  return (
    <div className="max-w-[720px]">
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
          {allowLocalSlackInstall && slackIntegration ? (
            <button
              type="button"
              className="ml-3 rounded border border-red-300/40 px-2 py-1 text-[12px] text-red-100"
              onClick={() => void connectSlack(true)}
              disabled={busyProvider === "slack"}
            >
              Create local Slack connection
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-8">
        {activeIntegrations.length ? (
          <div className="space-y-3">
            {activeIntegrations.map((integration) => (
              <article
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4"
                key={integration.provider}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-[15px] font-medium text-[var(--color-text-primary)]">
                      {integration.name}
                    </h2>
                    <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
                      {integration.state.workspaceName
                        ? `Connected to ${integration.state.workspaceName}`
                        : integration.description}
                    </p>
                  </div>
                  {integration.provider === "slack" ? (
                    <button
                      type="button"
                      disabled={!canManage || busyProvider === "slack"}
                      onClick={() => void disconnectSlack()}
                      className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[13px] text-red-300 disabled:opacity-50"
                    >
                      Disconnect
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
            <button
              type="button"
              onClick={() => setCatalogOpen(true)}
              className="rounded-md border border-[var(--color-border)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
            >
              Explore integrations
            </button>
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
                  Connect and manage supported workspace integrations.
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
              {integrations.map((integration) => (
                <div
                  className="rounded-lg border border-[var(--color-border)] p-4"
                  key={integration.provider}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-[14px] font-medium text-[var(--color-text-primary)]">
                        {integration.name}
                      </h3>
                      <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
                        {integration.description}
                      </p>
                      <p className="mt-2 text-[12px] text-[var(--color-text-tertiary)]">
                        {statusLabel(integration.state.status)}
                        {integration.state.configurationError
                          ? ` — ${integration.state.configurationError}`
                          : ""}
                      </p>
                    </div>
                    {integration.provider === "slack" ? (
                      integration.state.status === "connected" ? (
                        <button
                          type="button"
                          disabled={!canManage || busyProvider === "slack"}
                          onClick={() => void disconnectSlack()}
                          className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[13px] text-red-300 disabled:opacity-50"
                        >
                          Disconnect
                        </button>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <button
                            type="button"
                            disabled={!canManage || busyProvider === "slack"}
                            onClick={() => void connectSlack(false)}
                            className="rounded-md bg-white px-3 py-1.5 text-[13px] font-medium text-black disabled:opacity-50"
                          >
                            Connect
                          </button>
                          {allowLocalSlackInstall ? (
                            <button
                              type="button"
                              disabled={!canManage || busyProvider === "slack"}
                              onClick={() => void connectSlack(true)}
                              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] disabled:opacity-50"
                            >
                              Create local Slack connection
                            </button>
                          ) : null}
                        </div>
                      )
                    ) : (
                      <button
                        type="button"
                        disabled
                        title={
                          integration.state.configurationError ?? undefined
                        }
                        className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[13px] text-[var(--color-text-tertiary)] opacity-70"
                      >
                        Configure
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
