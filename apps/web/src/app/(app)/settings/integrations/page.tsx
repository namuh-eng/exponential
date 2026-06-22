"use client";

import { EmptyState } from "@/components/empty-state";
import { useCallback, useEffect, useState } from "react";

type IntegrationDetails = {
  // Google Sheets fields
  spreadsheetUrl?: string;
  spreadsheetTitle?: string;
  scopes?: { issues?: boolean; projects?: boolean; initiatives?: boolean };
  includePrivateTeams?: boolean;
  schedule?: string;
  nextRunAt?: string | null;
  rowCounts?: { issues?: number; projects?: number; initiatives?: number };
  // GitHub fields
  installationId?: string;
  accountLogin?: string;
  repositorySelection?: "all" | "selected" | "unknown";
  selectedRepositoryCount?: number;
  selectedRepositories?: { id: string; fullName: string; active: boolean }[];
};

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
  details?: IntegrationDetails | null;
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

type SheetsScopeState = {
  issues: boolean;
  projects: boolean;
  initiatives: boolean;
  includePrivateTeams: boolean;
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
  const details = integration.details ?? {};
  if (details.repositorySelection === "all") {
    return "All repositories enabled";
  }
  if (
    details.repositorySelection === "selected" &&
    typeof details.selectedRepositoryCount === "number"
  ) {
    return `${details.selectedRepositoryCount} selected repositories enabled`;
  }
  if (integration.status === "connected") {
    return "Repository selection pending from GitHub";
  }
  return null;
}

function isConnectableProvider(
  provider: string,
): provider is
  | "github"
  | "slack"
  | "discord"
  | "microsoft_teams"
  | "sentry"
  | "google_sheets"
  | "salesforce"
  | "gong"
  | "intercom" {
  return (
    provider === "github" ||
    provider === "slack" ||
    provider === "discord" ||
    provider === "microsoft_teams" ||
    provider === "sentry" ||
    provider === "google_sheets" ||
    provider === "salesforce" ||
    provider === "gong" ||
    provider === "intercom"
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
    provider:
      | "github"
      | "slack"
      | "discord"
      | "microsoft_teams"
      | "sentry"
      | "google_sheets"
      | "salesforce"
      | "gong"
      | "intercom",
  ) {
    setPendingProvider(provider);
    setNotice(null);
    setError(null);
    let label = "GitHub";
    if (provider === "discord") label = "Discord";
    if (provider === "slack") label = "Slack";
    if (provider === "microsoft_teams") label = "Microsoft Teams";
    if (provider === "sentry") label = "Sentry";
    if (provider === "google_sheets") label = "Google Sheets";
    if (provider === "salesforce") label = "Salesforce";
    if (provider === "gong") label = "Gong";
    if (provider === "intercom") label = "Intercom";
    const endpoint =
      provider === "microsoft_teams"
        ? "/api/integrations/microsoft-teams/connect"
        : provider === "google_sheets"
          ? "/api/integrations/google-sheets/connect"
          : `/api/integrations/${provider}/connect`;
    try {
      const response = await fetch(endpoint, {
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
                  : provider === "google_sheets"
                    ? "/api/integrations/google-sheets/disconnect"
                    : provider === "salesforce"
                      ? "/api/integrations/salesforce/disconnect"
                      : provider === "front"
                        ? "/api/integrations/front/disconnect"
                        : provider === "gong"
                          ? "/api/integrations/gong/disconnect"
                          : provider === "zendesk"
                            ? "/api/integrations/zendesk/disconnect"
                            : provider === "intercom"
                              ? "/api/integrations/intercom/disconnect"
                              : `/api/integrations?provider=${encodeURIComponent(provider)}`;
      const response = await fetch(endpoint, {
        method:
          provider === "slack" ||
          provider === "discord" ||
          provider === "github" ||
          provider === "microsoft_teams" ||
          provider === "sentry" ||
          provider === "google_sheets" ||
          provider === "salesforce" ||
          provider === "front" ||
          provider === "gong" ||
          provider === "zendesk" ||
          provider === "intercom"
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
                    integration.provider !== "gitlab" &&
                    integration.provider !== "jira" &&
                    integration.provider !== "front" &&
                    integration.provider !== "zendesk" ? (
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
          <div className="max-h-[calc(100vh-2rem)] w-full max-w-[560px] overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] p-6 shadow-xl">
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
                      {integration.provider === "google_sheets" &&
                      (integration.actions.canConnect ||
                        integration.actions.canReconnect) ? (
                        <fieldset className="mt-4 grid gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[12px] text-[var(--color-text-secondary)]">
                          <legend className="px-1 text-[12px] text-[var(--color-text-tertiary)]">
                            Export scopes
                          </legend>
                          {(["issues", "projects", "initiatives"] as const).map(
                            (scope) => (
                              <label
                                className="flex items-center gap-2"
                                key={scope}
                              >
                                <input
                                  checked={sheetsScopes[scope]}
                                  onChange={(event) =>
                                    setSheetsScopes((current) => ({
                                      ...current,
                                      [scope]: event.target.checked,
                                    }))
                                  }
                                  type="checkbox"
                                />
                                {scope[0].toUpperCase() + scope.slice(1)}
                              </label>
                            ),
                          )}
                          <label className="flex items-center gap-2">
                            <input
                              checked={sheetsScopes.includePrivateTeams}
                              onChange={(event) =>
                                setSheetsScopes((current) => ({
                                  ...current,
                                  includePrivateTeams: event.target.checked,
                                }))
                              }
                              type="checkbox"
                            />
                            Include private teams
                          </label>
                        </fieldset>
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
                      {integration.provider === "jira" &&
                      (integration.actions.canConnect ||
                        integration.actions.canReconnect) ? (
                        <div className="mt-4 grid gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                          <label className="grid gap-1 text-[12px] text-[var(--color-text-secondary)]">
                            Jira deployment
                            <select
                              className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
                              onChange={(event) =>
                                setJiraDeployment(
                                  event.target.value === "server"
                                    ? "server"
                                    : "cloud",
                                )
                              }
                              value={jiraDeployment}
                            >
                              <option value="cloud">Jira Cloud</option>
                              <option value="server">
                                Jira Server/Data Center
                              </option>
                            </select>
                          </label>
                          <label className="grid gap-1 text-[12px] text-[var(--color-text-secondary)]">
                            Base URL
                            <input
                              className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
                              onChange={(event) =>
                                setJiraBaseUrl(event.target.value)
                              }
                              placeholder="https://acme.atlassian.net"
                              type="url"
                              value={jiraBaseUrl}
                            />
                          </label>
                          {jiraDeployment === "cloud" ? (
                            <label className="grid gap-1 text-[12px] text-[var(--color-text-secondary)]">
                              Atlassian email
                              <input
                                className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
                                onChange={(event) =>
                                  setJiraEmail(event.target.value)
                                }
                                placeholder="admin@example.com"
                                type="email"
                                value={jiraEmail}
                              />
                            </label>
                          ) : null}
                          <label className="grid gap-1 text-[12px] text-[var(--color-text-secondary)]">
                            API token or PAT
                            <input
                              className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
                              onChange={(event) =>
                                setJiraToken(event.target.value)
                              }
                              placeholder={
                                jiraDeployment === "cloud"
                                  ? "Atlassian API token"
                                  : "Jira personal access token"
                              }
                              type="password"
                              value={jiraToken}
                            />
                          </label>
                          <button
                            className="w-fit rounded-md bg-white px-3 py-1.5 text-[13px] font-medium text-black hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={
                              pendingProvider === "jira" ||
                              jiraBaseUrl.trim() === "" ||
                              jiraToken.trim() === "" ||
                              (jiraDeployment === "cloud" &&
                                jiraEmail.trim() === "")
                            }
                            onClick={() => void setupJira()}
                            type="button"
                          >
                            {pendingProvider === "jira"
                              ? "Validating..."
                              : "Connect Jira"}
                          </button>
                        </div>
                      ) : null}
                      {integration.provider === "front" &&
                      (integration.actions.canConnect ||
                        integration.actions.canReconnect) ? (
                        <div className="mt-4 grid gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                          <label className="grid gap-1 text-[12px] text-[var(--color-text-secondary)]">
                            Front company ID
                            <input
                              className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
                              onChange={(event) =>
                                setFrontCompanyId(event.target.value)
                              }
                              placeholder="Optional company identifier"
                              value={frontCompanyId}
                            />
                          </label>
                          <label className="grid gap-1 text-[12px] text-[var(--color-text-secondary)]">
                            Front API base URL
                            <input
                              className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
                              onChange={(event) =>
                                setFrontBaseUrl(event.target.value)
                              }
                              placeholder="https://api2.frontapp.com"
                              type="url"
                              value={frontBaseUrl}
                            />
                          </label>
                          <label className="grid gap-1 text-[12px] text-[var(--color-text-secondary)]">
                            Front API token
                            <input
                              className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
                              onChange={(event) =>
                                setFrontApiToken(event.target.value)
                              }
                              placeholder="Bearer token with conversations/comments permissions"
                              type="password"
                              value={frontApiToken}
                            />
                          </label>
                          <button
                            className="w-fit rounded-md bg-white px-3 py-1.5 text-[13px] font-medium text-black hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={
                              pendingProvider === "front" ||
                              frontApiToken.trim() === ""
                            }
                            onClick={() => void setupFront()}
                            type="button"
                          >
                            {pendingProvider === "front"
                              ? "Validating..."
                              : "Connect Front"}
                          </button>
                        </div>
                      ) : null}
                      {integration.provider === "zendesk" &&
                      (integration.actions.canConnect ||
                        integration.actions.canReconnect) ? (
                        <div className="mt-4 grid gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                          <label className="grid gap-1 text-[12px] text-[var(--color-text-secondary)]">
                            Zendesk subdomain
                            <input
                              className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
                              onChange={(event) =>
                                setZendeskSubdomain(event.target.value)
                              }
                              placeholder="acme"
                              type="text"
                              value={zendeskSubdomain}
                            />
                          </label>
                          <label className="grid gap-1 text-[12px] text-[var(--color-text-secondary)]">
                            Admin email
                            <input
                              className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
                              onChange={(event) =>
                                setZendeskEmail(event.target.value)
                              }
                              placeholder="admin@example.com"
                              type="email"
                              value={zendeskEmail}
                            />
                          </label>
                          <label className="grid gap-1 text-[12px] text-[var(--color-text-secondary)]">
                            API token
                            <input
                              className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
                              onChange={(event) =>
                                setZendeskAPIToken(event.target.value)
                              }
                              placeholder="Zendesk API token"
                              type="password"
                              value={zendeskAPIToken}
                            />
                          </label>
                          <button
                            className="w-fit rounded-md bg-white px-3 py-1.5 text-[13px] font-medium text-black hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={
                              pendingProvider === "zendesk" ||
                              zendeskSubdomain.trim() === "" ||
                              zendeskEmail.trim() === "" ||
                              zendeskAPIToken.trim() === ""
                            }
                            onClick={() => void setupZendesk()}
                            type="button"
                          >
                            {pendingProvider === "zendesk"
                              ? "Validating..."
                              : "Connect Zendesk"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                    {isConnectableProvider(integration.provider) ? (
                      <button
                        className="rounded-md bg-white px-3 py-1.5 text-[13px] font-medium text-black hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={
                          pendingProvider === integration.provider ||
                          (integration.provider === "google_sheets" &&
                            !sheetsScopes.issues &&
                            !sheetsScopes.projects &&
                            !sheetsScopes.initiatives)
                        }
                        onClick={() =>
                          isConnectableProvider(integration.provider)
                            ? void connectIntegration(integration.provider)
                            : undefined
                        }
                        type="button"
                      >
                        {pendingProvider === integration.provider
                          ? "Opening..."
                          : integration.provider === "google_sheets"
                            ? "Create sheet"
                            : "Connect"}
                      </button>
                    ) : integration.provider === "gitlab" ||
                      integration.provider === "jira" ||
                      integration.provider === "zendesk" ? null : (
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
