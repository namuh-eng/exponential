"use client";

import { EmptyState } from "@/components/empty-state";
import { useCallback, useEffect, useState } from "react";

type IntegrationStatus =
  | "configuration_required"
  | "installing"
  | "connected"
  | "degraded"
  | "revoked"
  | "error"
  | "not_connected";

type Integration = {
  provider: string;
  name: string;
  description: string;
  status: IntegrationStatus;
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
  details?: {
    installationId?: string;
    accountLogin?: string;
    repositorySelection?: "all" | "selected" | "unknown";
    selectedRepositoryCount?: number;
    selectedRepositories?: { id: string; fullName: string; active: boolean }[];
    spreadsheetUrl?: string;
    nextRunAt?: string | null;
    schedule?: string;
    rowCounts?: {
      issues?: number;
      projects?: number;
      initiatives?: number;
    };
  } | null;
};

type GitLabSetupDetails = {
  origin: string;
  webhookUrl: string;
  webhookSecret: string;
};

type JiraSetupDetails = {
  integrationId: string;
  displayName: string;
  projectCount: number;
};

type ZendeskSetupDetails = {
  accountUrl: string;
  actionBaseUrl: string;
  actionSecret: string;
};

type IntegrationsPayload = {
  integrations?: Integration[];
  canManageIntegrations?: boolean;
  error?: string;
};

type SheetsScopeState = {
  issues: boolean;
  projects: boolean;
  initiatives: boolean;
  includePrivateTeams: boolean;
};

type ConnectableProvider =
  | "github"
  | "slack"
  | "discord"
  | "microsoft_teams"
  | "sentry"
  | "salesforce"
  | "gong"
  | "intercom"
  | "google_sheets";

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

function statusClassName(status: IntegrationStatus) {
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
  if (integration.details?.repositorySelection === "all") {
    return "All repositories enabled";
  }
  if (
    integration.details?.repositorySelection === "selected" &&
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
): provider is ConnectableProvider {
  return [
    "github",
    "slack",
    "discord",
    "microsoft_teams",
    "sentry",
    "salesforce",
    "gong",
    "intercom",
    "google_sheets",
  ].includes(provider);
}

function connectEndpoint(provider: ConnectableProvider) {
  if (provider === "microsoft_teams") {
    return "/api/integrations/microsoft-teams/connect";
  }
  if (provider === "google_sheets") {
    return "/api/integrations/google-sheets/connect";
  }
  return `/api/integrations/${provider}/connect`;
}

function disconnectEndpoint(provider: string) {
  if (provider === "microsoft_teams") {
    return "/api/integrations/microsoft-teams/disconnect";
  }
  if (
    [
      "github",
      "slack",
      "discord",
      "sentry",
      "salesforce",
      "front",
      "gong",
      "zendesk",
      "intercom",
    ].includes(provider)
  ) {
    return `/api/integrations/${provider}/disconnect`;
  }
  return `/api/integrations?provider=${encodeURIComponent(provider)}`;
}

function disconnectMethod(provider: string) {
  return [
    "github",
    "slack",
    "discord",
    "microsoft_teams",
    "sentry",
    "salesforce",
    "front",
    "gong",
    "zendesk",
    "intercom",
  ].includes(provider)
    ? "POST"
    : "DELETE";
}

function providerLabel(provider: string) {
  if (provider === "microsoft_teams") return "Microsoft Teams";
  return provider
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
  const [sheetsScopes, setSheetsScopes] = useState<SheetsScopeState>({
    issues: true,
    projects: true,
    initiatives: true,
    includePrivateTeams: false,
  });
  const [jiraDeployment, setJiraDeployment] = useState<"cloud" | "server">(
    "cloud",
  );
  const [jiraBaseUrl, setJiraBaseUrl] = useState("https://acme.atlassian.net");
  const [jiraEmail, setJiraEmail] = useState("");
  const [jiraToken, setJiraToken] = useState("");
  const [jiraSetupDetails, setJiraSetupDetails] =
    useState<JiraSetupDetails | null>(null);
  const [frontCompanyId, setFrontCompanyId] = useState("");
  const [frontApiToken, setFrontApiToken] = useState("");
  const [frontBaseUrl, setFrontBaseUrl] = useState("https://api2.frontapp.com");
  const [zendeskSubdomain, setZendeskSubdomain] = useState("");
  const [zendeskEmail, setZendeskEmail] = useState("");
  const [zendeskAPIToken, setZendeskAPIToken] = useState("");
  const [zendeskSetupDetails, setZendeskSetupDetails] =
    useState<ZendeskSetupDetails | null>(null);

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
    } else if (githubParam === "canceled") {
      setError("GitHub installation was canceled.");
    } else {
      return;
    }
    params.delete("github");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );
  }, []);

  async function connectIntegration(provider: ConnectableProvider) {
    setPendingProvider(provider);
    setNotice(null);
    setError(null);
    const label = providerLabel(provider);
    try {
      const response = await fetch(connectEndpoint(provider), {
        method: "POST",
        headers: {
          Accept: "application/json",
          ...(provider === "google_sheets"
            ? { "Content-Type": "application/json" }
            : {}),
        },
        ...(provider === "google_sheets"
          ? {
              body: JSON.stringify({
                scopes: {
                  issues: sheetsScopes.issues,
                  projects: sheetsScopes.projects,
                  initiatives: sheetsScopes.initiatives,
                },
                includePrivateTeams: sheetsScopes.includePrivateTeams,
              }),
            }
          : {}),
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

  async function refreshGoogleSheets() {
    setPendingProvider("google_sheets");
    setNotice(null);
    setError(null);
    try {
      const response = await fetch("/api/integrations/google-sheets/refresh", {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(
          data.message || data.error || "Google Sheets refresh failed.",
        );
      }
      setNotice("Google Sheets analytics sync refreshed.");
      await loadIntegrations();
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Google Sheets refresh failed.",
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

  async function setupJira() {
    setPendingProvider("jira");
    setNotice(null);
    setError(null);
    setJiraSetupDetails(null);
    try {
      const response = await fetch("/api/workspaces/current/import-export", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "configure_jira",
          deployment: jiraDeployment,
          baseUrl: jiraBaseUrl,
          email: jiraDeployment === "cloud" ? jiraEmail : undefined,
          token: jiraToken,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        integrationId?: string;
        displayName?: string;
        projects?: { id: string; key: string; name: string }[];
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(data.message || data.error || "Jira setup failed.");
      }
      setJiraSetupDetails({
        integrationId: data.integrationId ?? "",
        displayName: data.displayName ?? "Jira",
        projectCount: data.projects?.length ?? 0,
      });
      setJiraToken("");
      setNotice(
        "Jira connected. Use Import & export to preview projects and mappings.",
      );
      await loadIntegrations();
    } catch (setupError) {
      setError(
        setupError instanceof Error ? setupError.message : "Jira setup failed.",
      );
    } finally {
      setPendingProvider(null);
    }
  }

  async function setupFront() {
    setPendingProvider("front");
    setNotice(null);
    setError(null);
    try {
      const response = await fetch("/api/integrations/front/setup", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          apiToken: frontApiToken,
          companyId: frontCompanyId,
          baseUrl: frontBaseUrl,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(data.message || data.error || "Front setup failed.");
      }
      setFrontApiToken("");
      setNotice(
        "Front connected. Add the Front sidebar plugin URL from this app to Front.",
      );
      await loadIntegrations();
    } catch (setupError) {
      setError(
        setupError instanceof Error
          ? setupError.message
          : "Front setup failed.",
      );
    } finally {
      setPendingProvider(null);
    }
  }

  async function setupZendesk() {
    setPendingProvider("zendesk");
    setNotice(null);
    setError(null);
    setZendeskSetupDetails(null);
    try {
      const response = await fetch("/api/integrations/zendesk/setup", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subdomain: zendeskSubdomain,
          email: zendeskEmail,
          apiToken: zendeskAPIToken,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        accountUrl?: string;
        actionBaseUrl?: string;
        actionSecret?: string;
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(data.message || data.error || "Zendesk setup failed.");
      }
      if (data.accountUrl && data.actionBaseUrl && data.actionSecret) {
        setZendeskSetupDetails({
          accountUrl: data.accountUrl,
          actionBaseUrl: data.actionBaseUrl,
          actionSecret: data.actionSecret,
        });
      }
      setZendeskAPIToken("");
      setNotice(
        "Zendesk connected. Copy the action URL and secret into the Zendesk app.",
      );
      await loadIntegrations();
    } catch (setupError) {
      setError(
        setupError instanceof Error
          ? setupError.message
          : "Zendesk setup failed.",
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
      const response = await fetch(disconnectEndpoint(provider), {
        method: disconnectMethod(provider),
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

      {jiraSetupDetails ? (
        <div className="mt-6 rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-3 text-[13px] text-[var(--color-text-secondary)]">
          <div className="font-medium text-[var(--color-text-primary)]">
            Jira connection ready
          </div>
          <p className="mt-2">
            {jiraSetupDetails.displayName} returned{" "}
            {jiraSetupDetails.projectCount} projects for guided import.
          </p>
        </div>
      ) : null}

      {zendeskSetupDetails ? (
        <div className="mt-6 rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-3 text-[13px] text-[var(--color-text-secondary)]">
          <div className="font-medium text-[var(--color-text-primary)]">
            Zendesk app details
          </div>
          <div className="mt-3 grid gap-2">
            <div className="grid gap-1">
              <span>Action base URL</span>
              <code className="overflow-x-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12px] text-[var(--color-text-primary)]">
                {zendeskSetupDetails.actionBaseUrl}
              </code>
            </div>
            <div className="grid gap-1">
              <span>Signing secret</span>
              <code className="overflow-x-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12px] text-[var(--color-text-primary)]">
                {zendeskSetupDetails.actionSecret}
              </code>
            </div>
            <div>Connected account: {zendeskSetupDetails.accountUrl}</div>
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
                    {integration.provider === "google_sheets" &&
                    integration.details ? (
                      <div className="mt-2 space-y-1 text-[12px] text-[var(--color-text-tertiary)]">
                        {integration.details.spreadsheetUrl ? (
                          <a
                            className="text-blue-300 hover:text-blue-200"
                            href={integration.details.spreadsheetUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Open analytics sheet
                          </a>
                        ) : null}
                        <p>
                          Next run{" "}
                          {formatTimestamp(
                            integration.details.nextRunAt ?? null,
                          )}{" "}
                          · {integration.details.schedule ?? "hourly"}
                        </p>
                        <p>
                          Rows: issues{" "}
                          {integration.details.rowCounts?.issues ?? 0}, projects{" "}
                          {integration.details.rowCounts?.projects ?? 0},
                          initiatives{" "}
                          {integration.details.rowCounts?.initiatives ?? 0}
                        </p>
                      </div>
                    ) : integrationDetailSummary(integration) ? (
                      <span className="mt-1 block text-[12px] text-[var(--color-text-tertiary)]">
                        {integrationDetailSummary(integration)}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {integration.provider === "google_sheets" &&
                    integration.actions.canManage ? (
                      <button
                        className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] disabled:opacity-50"
                        disabled={pendingProvider === integration.provider}
                        onClick={() => void refreshGoogleSheets()}
                        type="button"
                      >
                        Refresh now
                      </button>
                    ) : null}
                    {integration.actions.canReconnect &&
                    isConnectableProvider(integration.provider) ? (
                      <button
                        className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] disabled:opacity-50"
                        disabled={pendingProvider === integration.provider}
                        onClick={() => {
                          if (isConnectableProvider(integration.provider)) {
                            void connectIntegration(integration.provider);
                          }
                        }}
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
            <div className="mt-5 flex max-h-[70vh] flex-col gap-3 overflow-y-auto">
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
                      <IntegrationSetupForm
                        integration={integration}
                        pendingProvider={pendingProvider}
                        gitLabOrigin={gitLabOrigin}
                        gitLabToken={gitLabToken}
                        jiraDeployment={jiraDeployment}
                        jiraBaseUrl={jiraBaseUrl}
                        jiraEmail={jiraEmail}
                        jiraToken={jiraToken}
                        frontCompanyId={frontCompanyId}
                        frontApiToken={frontApiToken}
                        frontBaseUrl={frontBaseUrl}
                        zendeskSubdomain={zendeskSubdomain}
                        zendeskEmail={zendeskEmail}
                        zendeskAPIToken={zendeskAPIToken}
                        sheetsScopes={sheetsScopes}
                        onGitLabOriginChange={setGitLabOrigin}
                        onGitLabTokenChange={setGitLabToken}
                        onJiraDeploymentChange={setJiraDeployment}
                        onJiraBaseUrlChange={setJiraBaseUrl}
                        onJiraEmailChange={setJiraEmail}
                        onJiraTokenChange={setJiraToken}
                        onFrontCompanyIdChange={setFrontCompanyId}
                        onFrontApiTokenChange={setFrontApiToken}
                        onFrontBaseUrlChange={setFrontBaseUrl}
                        onZendeskSubdomainChange={setZendeskSubdomain}
                        onZendeskEmailChange={setZendeskEmail}
                        onZendeskAPITokenChange={setZendeskAPIToken}
                        onSheetsScopeChange={(key, value) =>
                          setSheetsScopes((current) => ({
                            ...current,
                            [key]: value,
                          }))
                        }
                        onSetupGitLab={() => void setupGitLab()}
                        onSetupJira={() => void setupJira()}
                        onSetupFront={() => void setupFront()}
                        onSetupZendesk={() => void setupZendesk()}
                        onConnect={(provider) =>
                          void connectIntegration(provider)
                        }
                      />
                    </div>
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

type IntegrationSetupFormProps = {
  integration: Integration;
  pendingProvider: string | null;
  gitLabOrigin: string;
  gitLabToken: string;
  jiraDeployment: "cloud" | "server";
  jiraBaseUrl: string;
  jiraEmail: string;
  jiraToken: string;
  frontCompanyId: string;
  frontApiToken: string;
  frontBaseUrl: string;
  zendeskSubdomain: string;
  zendeskEmail: string;
  zendeskAPIToken: string;
  sheetsScopes: SheetsScopeState;
  onGitLabOriginChange: (value: string) => void;
  onGitLabTokenChange: (value: string) => void;
  onJiraDeploymentChange: (value: "cloud" | "server") => void;
  onJiraBaseUrlChange: (value: string) => void;
  onJiraEmailChange: (value: string) => void;
  onJiraTokenChange: (value: string) => void;
  onFrontCompanyIdChange: (value: string) => void;
  onFrontApiTokenChange: (value: string) => void;
  onFrontBaseUrlChange: (value: string) => void;
  onZendeskSubdomainChange: (value: string) => void;
  onZendeskEmailChange: (value: string) => void;
  onZendeskAPITokenChange: (value: string) => void;
  onSheetsScopeChange: (key: keyof SheetsScopeState, value: boolean) => void;
  onSetupGitLab: () => void;
  onSetupJira: () => void;
  onSetupFront: () => void;
  onSetupZendesk: () => void;
  onConnect: (provider: ConnectableProvider) => void;
};

function IntegrationSetupForm(props: IntegrationSetupFormProps) {
  const canAct =
    props.integration.actions.canConnect ||
    props.integration.actions.canReconnect ||
    props.integration.status === "configuration_required" ||
    props.integration.status === "not_connected";

  if (!canAct) return null;

  if (props.integration.provider === "google_sheets") {
    return (
      <div className="mt-4 grid gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <div className="text-[12px] font-medium text-[var(--color-text-primary)]">
          Export scopes
        </div>
        <CheckboxInput
          checked={props.sheetsScopes.issues}
          label="Include issues"
          onChange={(value) => props.onSheetsScopeChange("issues", value)}
        />
        <CheckboxInput
          checked={props.sheetsScopes.projects}
          label="Include projects"
          onChange={(value) => props.onSheetsScopeChange("projects", value)}
        />
        <CheckboxInput
          checked={props.sheetsScopes.initiatives}
          label="Include initiatives"
          onChange={(value) => props.onSheetsScopeChange("initiatives", value)}
        />
        <CheckboxInput
          checked={props.sheetsScopes.includePrivateTeams}
          label="Include private teams"
          onChange={(value) =>
            props.onSheetsScopeChange("includePrivateTeams", value)
          }
        />
        <SetupButton
          disabled={props.pendingProvider === "google_sheets"}
          label="Create sheet"
          loading={props.pendingProvider === "google_sheets"}
          onClick={() => props.onConnect("google_sheets")}
        />
      </div>
    );
  }

  if (props.integration.provider === "gitlab") {
    return (
      <div className="mt-4 grid gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <TextInput
          label="GitLab origin"
          onChange={props.onGitLabOriginChange}
          placeholder="https://gitlab.com"
          type="url"
          value={props.gitLabOrigin}
        />
        <TextInput
          label="Personal access token"
          onChange={props.onGitLabTokenChange}
          placeholder="glpat-..."
          type="password"
          value={props.gitLabToken}
        />
        <SetupButton
          disabled={
            props.pendingProvider === "gitlab" ||
            props.gitLabToken.trim() === ""
          }
          label="Connect GitLab"
          loading={props.pendingProvider === "gitlab"}
          onClick={props.onSetupGitLab}
        />
      </div>
    );
  }

  if (props.integration.provider === "jira") {
    return (
      <div className="mt-4 grid gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <label className="grid gap-1 text-[12px] text-[var(--color-text-secondary)]">
          Jira deployment
          <select
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
            onChange={(event) =>
              props.onJiraDeploymentChange(
                event.target.value === "server" ? "server" : "cloud",
              )
            }
            value={props.jiraDeployment}
          >
            <option value="cloud">Jira Cloud</option>
            <option value="server">Jira Server/Data Center</option>
          </select>
        </label>
        <TextInput
          label="Base URL"
          onChange={props.onJiraBaseUrlChange}
          placeholder="https://acme.atlassian.net"
          type="url"
          value={props.jiraBaseUrl}
        />
        {props.jiraDeployment === "cloud" ? (
          <TextInput
            label="Atlassian email"
            onChange={props.onJiraEmailChange}
            placeholder="admin@example.com"
            type="email"
            value={props.jiraEmail}
          />
        ) : null}
        <TextInput
          label="API token or PAT"
          onChange={props.onJiraTokenChange}
          placeholder={
            props.jiraDeployment === "cloud"
              ? "Atlassian API token"
              : "Jira personal access token"
          }
          type="password"
          value={props.jiraToken}
        />
        <SetupButton
          disabled={
            props.pendingProvider === "jira" ||
            props.jiraBaseUrl.trim() === "" ||
            props.jiraToken.trim() === "" ||
            (props.jiraDeployment === "cloud" && props.jiraEmail.trim() === "")
          }
          label="Connect Jira"
          loading={props.pendingProvider === "jira"}
          onClick={props.onSetupJira}
        />
      </div>
    );
  }

  if (props.integration.provider === "front") {
    return (
      <div className="mt-4 grid gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <TextInput
          label="Front company ID"
          onChange={props.onFrontCompanyIdChange}
          placeholder="Optional company identifier"
          value={props.frontCompanyId}
        />
        <TextInput
          label="Front API base URL"
          onChange={props.onFrontBaseUrlChange}
          placeholder="https://api2.frontapp.com"
          type="url"
          value={props.frontBaseUrl}
        />
        <TextInput
          label="Front API token"
          onChange={props.onFrontApiTokenChange}
          placeholder="Bearer token with conversations/comments permissions"
          type="password"
          value={props.frontApiToken}
        />
        <SetupButton
          disabled={
            props.pendingProvider === "front" ||
            props.frontApiToken.trim() === ""
          }
          label="Connect Front"
          loading={props.pendingProvider === "front"}
          onClick={props.onSetupFront}
        />
      </div>
    );
  }

  if (props.integration.provider === "zendesk") {
    return (
      <div className="mt-4 grid gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <TextInput
          label="Zendesk subdomain"
          onChange={props.onZendeskSubdomainChange}
          placeholder="acme"
          value={props.zendeskSubdomain}
        />
        <TextInput
          label="Admin email"
          onChange={props.onZendeskEmailChange}
          placeholder="admin@example.com"
          type="email"
          value={props.zendeskEmail}
        />
        <TextInput
          label="API token"
          onChange={props.onZendeskAPITokenChange}
          placeholder="Zendesk API token"
          type="password"
          value={props.zendeskAPIToken}
        />
        <SetupButton
          disabled={
            props.pendingProvider === "zendesk" ||
            props.zendeskSubdomain.trim() === "" ||
            props.zendeskEmail.trim() === "" ||
            props.zendeskAPIToken.trim() === ""
          }
          label="Connect Zendesk"
          loading={props.pendingProvider === "zendesk"}
          onClick={props.onSetupZendesk}
        />
      </div>
    );
  }

  if (!isConnectableProvider(props.integration.provider)) return null;
  if (
    props.integration.provider === "github" &&
    !props.integration.actions.canConnect
  ) {
    return null;
  }

  return (
    <button
      className="mt-3 rounded-md bg-white px-3 py-1.5 text-[13px] font-medium text-black hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={props.pendingProvider === props.integration.provider}
      onClick={() =>
        props.onConnect(props.integration.provider as ConnectableProvider)
      }
      type="button"
    >
      Connect
    </button>
  );
}

type TextInputProps = {
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  value: string;
};

function TextInput({
  label,
  onChange,
  placeholder,
  type = "text",
  value,
}: TextInputProps) {
  return (
    <label className="grid gap-1 text-[12px] text-[var(--color-text-secondary)]">
      {label}
      <input
        aria-label={label}
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
    </label>
  );
}

type CheckboxInputProps = {
  checked: boolean;
  label: string;
  onChange: (value: boolean) => void;
};

function CheckboxInput({ checked, label, onChange }: CheckboxInputProps) {
  return (
    <label className="flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)]">
      <input
        aria-label={label}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      {label}
    </label>
  );
}

type SetupButtonProps = {
  disabled: boolean;
  label: string;
  loading: boolean;
  onClick: () => void;
};

function SetupButton({ disabled, label, loading, onClick }: SetupButtonProps) {
  return (
    <button
      className="w-fit rounded-md bg-white px-3 py-1.5 text-[13px] font-medium text-black hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {loading ? "Validating..." : label}
    </button>
  );
}
