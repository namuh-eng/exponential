"use client";

import { EmptyState } from "@/components/empty-state";
import { useCallback, useEffect, useState } from "react";

type Integration = {
  provider: string;
  name: string;
  description: string;
  status:
    | "configuration_required"
    | "installing"
    | "connected"
    | "degraded"
    | "revoked"
    | "error"
    | "not_connected";
  displayName: string | null;
  connectedAt: string | null;
  setupRequirement: { type: string; message: string } | null;
  actions: {
    canConnect: boolean;
    canManage: boolean;
    canDisconnect: boolean;
    canReconnect: boolean;
  };
  health: {
    lastEventAt: string | null;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    lastFailureMessage: string | null;
    tokenExpiresAt: string | null;
    pendingJobCount: number;
    failedJobCount: number;
    auditEvents: {
      eventType: string;
      severity: "info" | "warning" | "error";
      message: string;
      createdAt: string;
    }[];
  };
  details: {
    installationId?: string;
    accountLogin?: string;
    repositorySelection?: "all" | "selected" | "unknown";
    selectedRepositoryCount?: number;
    selectedRepositories?: { id: string; fullName: string; active: boolean }[];
  };
};

type GitLabSetupDetails = {
  origin: string;
  webhookUrl: string;
  webhookSecret: string;
};

type IntegrationsPayload = {
  integrations?: Integration[];
  canManageIntegrations?: boolean;
  error?: string;
};

function statusLabel(integration: Integration) {
  if (integration.status === "connected") return "Connected";
  if (integration.status === "installing") return "Installing";
  if (integration.status === "degraded") return "Degraded";
  if (integration.status === "revoked") return "Revoked";
  if (integration.status === "error") return "Error";
  if (integration.status === "configuration_required") {
    return "Configuration required";
  }
  return "Not connected";
}

function formatTimestamp(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusClassName(status: Integration["status"]) {
  if (status === "connected") {
    return "border-green-500/30 bg-green-500/10 text-green-300";
  }
  if (status === "degraded" || status === "error") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  }
  if (status === "revoked") {
    return "border-red-500/30 bg-red-500/10 text-red-200";
  }
  return "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-tertiary)]";
}

function integrationDetailSummary(integration: Integration) {
  if (integration.provider !== "github") return null;
  if (integration.details.repositorySelection === "all") {
    return "All repositories enabled";
  }
  if (
    integration.details.repositorySelection === "selected" &&
    typeof integration.details.selectedRepositoryCount === "number"
  ) {
    return `${integration.details.selectedRepositoryCount} selected repositories enabled`;
  }
  if (integration.status === "connected") {
    return "Repository selection pending from GitHub";
  }
  return null;
}

function isConnectableProvider(
  provider: string,
): provider is "github" | "slack" | "discord" | "microsoft_teams" | "sentry" {
  return (
    provider === "github" ||
    provider === "slack" ||
    provider === "discord" ||
    provider === "microsoft_teams" ||
    provider === "sentry"
  );
}

export default function IntegrationsSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);
  const [gitLabOrigin, setGitLabOrigin] = useState("https://gitlab.com");
  const [gitLabToken, setGitLabToken] = useState("");
  const [gitLabSetupDetails, setGitLabSetupDetails] =
    useState<GitLabSetupDetails | null>(null);

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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const githubParam = params.get("github");
    if (githubParam === "connected") {
      setNotice("GitHub connected successfully.");
      const cleanUrl =
        window.location.pathname +
        (params
          .toString()
          .replace(/[&?]?github=[^&]*/g, "")
          .replace(/^&/, "?") || "");
      window.history.replaceState(null, "", cleanUrl);
    } else if (githubParam === "canceled") {
      setError("GitHub installation was canceled.");
      const cleanUrl =
        window.location.pathname +
        (params
          .toString()
          .replace(/[&?]?github=[^&]*/g, "")
          .replace(/^&/, "?") || "");
      window.history.replaceState(null, "", cleanUrl);
    }
  }, []);

  async function connectIntegration(
    provider: "github" | "slack" | "discord" | "microsoft_teams" | "sentry",
  ) {
    setPendingProvider(provider);
    setNotice(null);
    setError(null);
    let label = "GitHub";
    if (provider === "discord") label = "Discord";
    if (provider === "slack") label = "Slack";
    if (provider === "microsoft_teams") label = "Microsoft Teams";
    if (provider === "sentry") label = "Sentry";
    const endpoint =
      provider === "microsoft_teams"
        ? "/api/integrations/microsoft-teams/connect"
        : `/api/integrations/${provider}/connect`;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const data = (await response.json().catch(() => ({}))) as {
        authorizationUrl?: string;
        installationUrl?: string;
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(data.message || data.error || `${label} setup failed.`);
      }
      if (provider === "github" && data.installationUrl) {
        window.location.assign(data.installationUrl);
        return;
      }
      if (data.authorizationUrl) {
        window.location.assign(data.authorizationUrl);
        return;
      }
      setNotice(`${label} setup started.`);
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : `${label} setup failed.`,
      );
    } finally {
      setPendingProvider(null);
    }
  }

  async function setupGitLab() {
    setPendingProvider("gitlab");
    setNotice(null);
    setError(null);
    setGitLabSetupDetails(null);
    try {
      const response = await fetch("/api/integrations/gitlab/setup", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ origin: gitLabOrigin, token: gitLabToken }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        origin?: string;
        webhookUrl?: string;
        webhookSecret?: string;
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(data.message || data.error || "GitLab setup failed.");
      }
      if (data.origin && data.webhookUrl && data.webhookSecret) {
        setGitLabSetupDetails({
          origin: data.origin,
          webhookUrl: data.webhookUrl,
          webhookSecret: data.webhookSecret,
        });
      }
      setGitLabToken("");
      setNotice(
        "GitLab connected. Copy the webhook URL and secret into GitLab.",
      );
      await loadIntegrations();
    } catch (setupError) {
      setError(
        setupError instanceof Error
          ? setupError.message
          : "GitLab setup failed.",
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
          : provider === "discord"
            ? "/api/integrations/discord/disconnect"
            : provider === "github"
              ? "/api/integrations/github/disconnect"
              : provider === "microsoft_teams"
                ? "/api/integrations/microsoft-teams/disconnect"
                : provider === "sentry"
                  ? "/api/integrations/sentry/disconnect"
                  : `/api/integrations?provider=${encodeURIComponent(provider)}`;
      const response = await fetch(endpoint, {
        method:
          provider === "slack" ||
          provider === "discord" ||
          provider === "github" ||
          provider === "microsoft_teams" ||
          provider === "sentry"
            ? "POST"
            : "DELETE",
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

  const installedIntegrations = integrations.filter(
    (integration) =>
      integration.status !== "not_connected" &&
      integration.status !== "configuration_required",
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
      {gitLabSetupDetails ? (
        <div className="mt-6 rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-3 text-[13px] text-[var(--color-text-secondary)]">
          <div className="font-medium text-[var(--color-text-primary)]">
            GitLab webhook details
          </div>
          <div className="mt-3 grid gap-2">
            <div className="grid gap-1">
              <span>Webhook URL</span>
              <code className="overflow-x-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12px] text-[var(--color-text-primary)]">
                {gitLabSetupDetails.webhookUrl}
              </code>
            </div>
            <div className="grid gap-1">
              <span>Secret token</span>
              <code className="overflow-x-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12px] text-[var(--color-text-primary)]">
                {gitLabSetupDetails.webhookSecret}
              </code>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-8">
        {installedIntegrations.length ? (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
            {installedIntegrations.map((integration) => (
              <div
                className="border-b border-[var(--color-border)] p-4 last:border-b-0"
                key={integration.provider}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[15px] font-medium text-[var(--color-text-primary)]">
                        {integration.name}
                      </h2>
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[11px] ${statusClassName(integration.status)}`}
                      >
                        {statusLabel(integration)}
                      </span>
                    </div>
                    <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
                      {integration.status === "revoked"
                        ? "Disconnected locally; historical links are preserved."
                        : `Connected to ${integration.displayName || integration.name}`}
                    </p>
                    {integrationDetailSummary(integration) ? (
                      <span className="mt-1 block text-[12px] text-[var(--color-text-tertiary)]">
                        {integrationDetailSummary(integration)}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {integration.actions.canReconnect &&
                    integration.provider !== "gitlab" ? (
                      <button
                        className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] disabled:opacity-50"
                        disabled={pendingProvider === integration.provider}
                        onClick={() =>
                          isConnectableProvider(integration.provider)
                            ? void connectIntegration(integration.provider)
                            : undefined
                        }
                        type="button"
                      >
                        Reconnect
                      </button>
                    ) : null}
                    {integration.actions.canDisconnect ? (
                      <button
                        className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[13px] text-red-300 disabled:opacity-50"
                        disabled={pendingProvider === integration.provider}
                        onClick={() => void disconnect(integration.provider)}
                        type="button"
                      >
                        Disconnect
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 text-[12px] text-[var(--color-text-tertiary)] sm:grid-cols-3">
                  <div>
                    <span className="block text-[var(--color-text-secondary)]">
                      Last event
                    </span>
                    {formatTimestamp(integration.health.lastEventAt)}
                  </div>
                  <div>
                    <span className="block text-[var(--color-text-secondary)]">
                      Last success
                    </span>
                    {formatTimestamp(integration.health.lastSuccessAt)}
                  </div>
                  <div>
                    <span className="block text-[var(--color-text-secondary)]">
                      Last failure
                    </span>
                    {formatTimestamp(integration.health.lastFailureAt)}
                  </div>
                  <div>
                    <span className="block text-[var(--color-text-secondary)]">
                      Token expiry
                    </span>
                    {formatTimestamp(integration.health.tokenExpiresAt)}
                  </div>
                  <div>
                    <span className="block text-[var(--color-text-secondary)]">
                      Jobs
                    </span>
                    {integration.health.pendingJobCount} pending /{" "}
                    {integration.health.failedJobCount} failed
                  </div>
                  {integration.health.lastFailureMessage ? (
                    <div className="sm:col-span-3">
                      <span className="block text-[var(--color-text-secondary)]">
                        Action needed
                      </span>
                      {integration.health.lastFailureMessage}
                    </div>
                  ) : null}
                </div>
                {integration.health.auditEvents.length ? (
                  <div className="mt-4 border-t border-[var(--color-border)] pt-4">
                    <h3 className="text-[12px] font-medium text-[var(--color-text-secondary)]">
                      Audit trail
                    </h3>
                    <div className="mt-2 flex flex-col gap-2">
                      {integration.health.auditEvents.map((event) => (
                        <div
                          className="grid gap-1 text-[12px] text-[var(--color-text-tertiary)] sm:grid-cols-[120px_80px_1fr]"
                          key={`${event.createdAt}-${event.eventType}-${event.message}`}
                        >
                          <span>{formatTimestamp(event.createdAt)}</span>
                          <span className="capitalize">{event.severity}</span>
                          <span className="text-[var(--color-text-secondary)]">
                            {event.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
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

      {installedIntegrations.length ? (
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
                        {statusLabel(integration)}
                        {integration.displayName
                          ? ` · ${integration.displayName}`
                          : ""}
                      </p>
                      {integrationDetailSummary(integration) ? (
                        <p className="mt-2 text-[12px] text-[var(--color-text-tertiary)]">
                          {integrationDetailSummary(integration)}
                        </p>
                      ) : null}
                      {integration.setupRequirement ? (
                        <p className="mt-2 text-[12px] text-amber-300">
                          {integration.setupRequirement.message}
                        </p>
                      ) : null}
                      {integration.provider === "gitlab" &&
                      (integration.actions.canConnect ||
                        integration.actions.canReconnect) ? (
                        <div className="mt-4 grid gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                          <label className="grid gap-1 text-[12px] text-[var(--color-text-secondary)]">
                            GitLab origin
                            <input
                              className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
                              onChange={(event) =>
                                setGitLabOrigin(event.target.value)
                              }
                              placeholder="https://gitlab.com"
                              type="url"
                              value={gitLabOrigin}
                            />
                          </label>
                          <label className="grid gap-1 text-[12px] text-[var(--color-text-secondary)]">
                            Personal access token
                            <input
                              className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
                              onChange={(event) =>
                                setGitLabToken(event.target.value)
                              }
                              placeholder="glpat-..."
                              type="password"
                              value={gitLabToken}
                            />
                          </label>
                          <button
                            className="w-fit rounded-md bg-white px-3 py-1.5 text-[13px] font-medium text-black hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={
                              pendingProvider === "gitlab" ||
                              gitLabToken.trim() === ""
                            }
                            onClick={() => void setupGitLab()}
                            type="button"
                          >
                            {pendingProvider === "gitlab"
                              ? "Validating..."
                              : "Connect GitLab"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                    {integration.actions.canDisconnect ? (
                      <button
                        className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[13px] text-red-300 disabled:opacity-50"
                        disabled={pendingProvider === integration.provider}
                        onClick={() => void disconnect(integration.provider)}
                        type="button"
                      >
                        Disconnect
                      </button>
                    ) : integration.actions.canReconnect &&
                      integration.provider !== "gitlab" ? (
                      <button
                        className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] disabled:opacity-50"
                        disabled={pendingProvider === integration.provider}
                        onClick={() =>
                          isConnectableProvider(integration.provider)
                            ? void connectIntegration(integration.provider)
                            : undefined
                        }
                        type="button"
                      >
                        Reconnect
                      </button>
                    ) : isConnectableProvider(integration.provider) ? (
                      <button
                        className="rounded-md bg-white px-3 py-1.5 text-[13px] font-medium text-black hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={pendingProvider === integration.provider}
                        onClick={() =>
                          isConnectableProvider(integration.provider)
                            ? void connectIntegration(integration.provider)
                            : undefined
                        }
                        type="button"
                      >
                        {pendingProvider === integration.provider
                          ? "Opening..."
                          : "Connect"}
                      </button>
                    ) : integration.provider === "gitlab" ? null : (
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
              ))}
            </div>
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
