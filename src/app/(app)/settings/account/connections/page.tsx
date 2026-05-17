"use client";

import { linkSocialAccount, unlinkSocialAccount } from "@/lib/auth-client";
import { useEffect, useMemo, useState } from "react";

type ProviderId = "google" | "github" | "gitlab" | "slack";

type ConnectedProvider = {
  id: string;
  providerId: string;
  accountId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type ProviderCapabilities = {
  providers?: Record<string, boolean | undefined>;
};

type AccountSecurityPayload = {
  providers?: ConnectedProvider[];
};

type ProviderRegistryEntry = {
  id: ProviderId;
  label: string;
  capabilityKey: string;
  unavailableReason: string;
  description: string;
  attributionPurpose: string;
};

type ProviderRow = ProviderRegistryEntry & {
  configured: boolean;
  connectedProvider?: ConnectedProvider;
  status: "connected" | "available" | "unavailable";
};

type Notice = { tone: "success" | "error" | "neutral"; message: string };

const CONNECTIONS_PATH = "/settings/account/connections";

const ACCOUNT_PROVIDER_REGISTRY: ProviderRegistryEntry[] = [
  {
    id: "github",
    label: "GitHub",
    capabilityKey: "github",
    unavailableReason: "GitHub account linking is not configured",
    description:
      "Connect your personal GitHub account for integration attribution.",
    attributionPurpose:
      "Maps synced GitHub activity, comments, and assignees to you.",
  },
  {
    id: "gitlab",
    label: "GitLab",
    capabilityKey: "gitlab",
    unavailableReason: "GitLab account linking is not configured",
    description: "Connect your personal GitLab account when GitLab is enabled.",
    attributionPurpose: "Maps synced GitLab activity to your Linear user.",
  },
  {
    id: "slack",
    label: "Slack",
    capabilityKey: "slack",
    unavailableReason: "Slack account linking is not configured",
    description: "Connect your Slack identity for chat-backed attribution.",
    attributionPurpose: "Maps synced Slack interactions to your Linear user.",
  },
  {
    id: "google",
    label: "Google",
    capabilityKey: "google",
    unavailableReason: "Google account linking is not configured",
    description:
      "Connect Google when this workspace supports Google sign-in linking.",
    attributionPurpose: "Keeps sign-in identities attached to your account.",
  },
];

function providerLabel(providerId: string) {
  const registeredProvider = ACCOUNT_PROVIDER_REGISTRY.find(
    (provider) => provider.id === providerId,
  );
  if (registeredProvider) return registeredProvider.label;
  if (providerId === "credential") return "Email";
  return providerId
    .split(/[-_]/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isLinkableProvider(provider: ConnectedProvider) {
  return provider.providerId !== "credential";
}

function getConnectionsCallbackUrl(params?: URLSearchParams) {
  const base = new URL(window.location.href);
  const pathname = base.pathname.endsWith(CONNECTIONS_PATH)
    ? base.pathname
    : CONNECTIONS_PATH;
  base.pathname = pathname;
  base.search = params?.toString() ? `?${params.toString()}` : "";
  base.hash = "";
  return base.toString();
}

function noticeFromSearch() {
  const params = new URLSearchParams(window.location.search);
  const error = params.get("error") ?? params.get("connection_error");
  if (error) {
    if (["access_denied", "cancelled", "canceled"].includes(error)) {
      return {
        tone: "neutral",
        message: "Account linking was cancelled. No account was connected.",
      } satisfies Notice;
    }
    return {
      tone: "error",
      message: `Account linking failed (${error.replaceAll("_", " ")}). Try again or contact an admin.`,
    } satisfies Notice;
  }

  if (params.get("connection") === "linked") {
    return {
      tone: "success",
      message: "Account connected successfully.",
    } satisfies Notice;
  }

  return null;
}

export default function ConnectedAccountsPage() {
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<ConnectedProvider[]>([]);
  const [capabilities, setCapabilities] = useState<ProviderCapabilities>({});
  const [chooserOpen, setChooserOpen] = useState(false);
  const [linkingProvider, setLinkingProvider] = useState<ProviderId | null>(
    null,
  );
  const [disconnectingProvider, setDisconnectingProvider] =
    useState<ProviderId | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    setNotice(noticeFromSearch());

    const controller = new AbortController();

    async function loadConnections() {
      setLoading(true);
      try {
        const [securityResponse, capabilitiesResponse] = await Promise.all([
          fetch("/api/account/security", {
            signal: controller.signal,
            credentials: "include",
          }),
          fetch("/api/auth/provider-capabilities", {
            signal: controller.signal,
            credentials: "include",
          }),
        ]);

        if (!securityResponse.ok) {
          throw new Error("Unable to load connected accounts.");
        }
        if (!capabilitiesResponse.ok) {
          throw new Error("Unable to load account linking providers.");
        }

        const securityData =
          (await securityResponse.json()) as AccountSecurityPayload;
        const providerCapabilities =
          (await capabilitiesResponse.json()) as ProviderCapabilities;

        setProviders(
          Array.isArray(securityData.providers) ? securityData.providers : [],
        );
        setCapabilities(providerCapabilities);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setNotice({
          tone: "error",
          message:
            "Unable to load connected accounts. Refresh the page or contact an admin.",
        });
        setProviders([]);
        setCapabilities({});
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadConnections();

    return () => controller.abort();
  }, []);

  const connectedAccounts = useMemo(
    () => providers.filter(isLinkableProvider),
    [providers],
  );

  const providerRows = useMemo<ProviderRow[]>(() => {
    return ACCOUNT_PROVIDER_REGISTRY.map((provider) => {
      const connectedProvider = providers.find(
        (accountProvider) => accountProvider.providerId === provider.id,
      );
      const configured =
        capabilities.providers?.[provider.capabilityKey] === true;
      return {
        ...provider,
        configured,
        connectedProvider,
        status: connectedProvider
          ? "connected"
          : configured
            ? "available"
            : "unavailable",
      };
    });
  }, [capabilities.providers, providers]);

  const linkableProviders = providerRows.filter(
    (provider) => provider.status === "available",
  );
  const hasLinkableProvider = linkableProviders.length > 0;

  async function startProviderLink(providerId: ProviderId) {
    const provider = providerRows.find((row) => row.id === providerId);
    if (!provider) return;

    if (provider.status === "connected") {
      setNotice({
        tone: "neutral",
        message: `${provider.label} is already connected.`,
      });
      return;
    }

    if (provider.status === "unavailable") {
      setNotice({
        tone: "error",
        message: `${provider.unavailableReason}. Ask an admin to configure ${provider.label} OAuth.`,
      });
      return;
    }

    setLinkingProvider(provider.id);
    setNotice(null);
    try {
      const successParams = new URLSearchParams({ connection: "linked" });
      const result = await linkSocialAccount({
        provider: provider.id,
        callbackURL: getConnectionsCallbackUrl(successParams),
        errorCallbackURL: getConnectionsCallbackUrl(),
      });

      if (result?.error) {
        const isMissingProvider =
          result.error.status === 404 ||
          result.error.code === "PROVIDER_NOT_FOUND";
        setNotice({
          tone: "error",
          message: isMissingProvider
            ? `${provider.label} account linking is not configured for this workspace. Ask an admin to configure ${provider.label} OAuth.`
            : (result.error.message ??
              `${provider.label} account linking failed. Try again.`),
        });
        setLinkingProvider(null);
        return;
      }

      const redirectUrl = result?.data?.url ?? result?.url;
      if (redirectUrl) {
        window.location.assign(redirectUrl);
        return;
      }

      setNotice({
        tone: "success",
        message: "Account connected successfully.",
      });
      setLinkingProvider(null);
    } catch {
      setNotice({
        tone: "error",
        message: `${provider.label} account linking failed. Try again or contact an admin.`,
      });
      setLinkingProvider(null);
    }
  }

  async function disconnectProvider(row: ProviderRow) {
    if (!row.connectedProvider) return;

    setDisconnectingProvider(row.id);
    setNotice(null);
    try {
      const result = await unlinkSocialAccount({
        providerId: row.id,
        accountId: row.connectedProvider.accountId ?? undefined,
      });

      if (result?.error) {
        setNotice({
          tone: "error",
          message:
            result.error.message ??
            `${row.label} could not be disconnected. Try again.`,
        });
        return;
      }

      setProviders((currentProviders) =>
        currentProviders.filter(
          (currentProvider) => currentProvider.id !== row.connectedProvider?.id,
        ),
      );
      setNotice({
        tone: "success",
        message: `${row.label} disconnected.`,
      });
    } catch {
      setNotice({
        tone: "error",
        message: `${row.label} could not be disconnected. Try again.`,
      });
    } finally {
      setDisconnectingProvider(null);
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-[var(--color-text-tertiary)]">
        Loading connected accounts...
      </div>
    );
  }

  return (
    <div className="max-w-[720px]">
      <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
        Connected accounts
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Connect personal provider accounts so synced integration activity,
        comments, and assignees are attributed to you instead of generic
        integration actors.
      </p>

      {notice && (
        <div
          className={`mt-6 rounded-md border px-3 py-2 text-[13px] ${
            notice.tone === "error"
              ? "border-red-500/30 bg-red-500/10 text-red-200"
              : notice.tone === "success"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                : "border-[#2c2d33] bg-[#18191f] text-[var(--color-text-secondary)]"
          }`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.message}
        </div>
      )}

      <section className="mt-8">
        <h2 className="text-[14px] font-medium text-[var(--color-text-primary)]">
          Connected accounts
        </h2>
        {connectedAccounts.length > 0 ? (
          <div className="mt-3 space-y-3">
            {connectedAccounts.map((provider) => (
              <div
                className="flex items-center justify-between rounded-lg border border-[#2c2d33] bg-[#141519] px-4 py-3"
                key={provider.id}
              >
                <div>
                  <div className="text-[14px] font-medium text-[var(--color-text-primary)]">
                    {providerLabel(provider.providerId)}
                  </div>
                  <div className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
                    {provider.accountId
                      ? `External identity: ${provider.accountId}`
                      : "External identity unavailable"}
                  </div>
                </div>
                <span className="rounded-full border border-emerald-500/30 px-2 py-0.5 text-[12px] text-emerald-200">
                  Connected
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[13px] text-[var(--color-text-tertiary)]">
            No connected accounts yet.
          </p>
        )}
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-medium text-[var(--color-text-primary)]">
              Available providers
            </h2>
            <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
              Connect provider accounts used by workspace integrations for
              attribution and identity mapping.
            </p>
          </div>
          {hasLinkableProvider && (
            <button
              className="rounded-md bg-[#5E6AD2] px-4 py-[8px] text-[13px] font-medium text-white transition-colors hover:bg-[#4F5ABF] disabled:cursor-not-allowed disabled:opacity-60"
              type="button"
              onClick={() => setChooserOpen(true)}
            >
              Connect account
            </button>
          )}
        </div>

        <div className="mt-3 space-y-3">
          {providerRows.map((provider) => (
            <div
              className="flex items-center justify-between gap-4 rounded-lg border border-[#2c2d33] bg-[#141519] px-4 py-3"
              key={provider.id}
            >
              <div>
                <div className="text-[14px] font-medium text-[var(--color-text-primary)]">
                  {provider.label}
                </div>
                <div className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
                  <span>{provider.description}</span>
                  <span className="mt-0.5 block">
                    {provider.status === "connected"
                      ? provider.connectedProvider?.accountId
                        ? `External identity: ${provider.connectedProvider.accountId}`
                        : "This provider is already connected to your account."
                      : provider.status === "available"
                        ? provider.attributionPurpose
                        : provider.unavailableReason}
                  </span>
                </div>
              </div>
              {provider.status === "connected" ? (
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-emerald-500/30 px-2 py-0.5 text-[12px] text-emerald-200">
                    Connected
                  </span>
                  <button
                    className="rounded-md border border-[#2c2d33] px-3 py-2 text-[13px] text-[var(--color-text-primary)] transition-colors hover:bg-[#1b1c22] disabled:cursor-not-allowed disabled:opacity-60"
                    type="button"
                    disabled={disconnectingProvider === provider.id}
                    onClick={() => void disconnectProvider(provider)}
                  >
                    {disconnectingProvider === provider.id
                      ? `Disconnecting ${provider.label}...`
                      : `Disconnect ${provider.label}`}
                  </button>
                </div>
              ) : provider.status === "available" ? (
                <button
                  className="rounded-md border border-[#2c2d33] px-3 py-2 text-[13px] text-[var(--color-text-primary)] transition-colors hover:bg-[#1b1c22] disabled:cursor-not-allowed disabled:opacity-60"
                  type="button"
                  disabled={linkingProvider === provider.id}
                  onClick={() => void startProviderLink(provider.id)}
                >
                  {linkingProvider === provider.id
                    ? `Connecting ${provider.label}...`
                    : `Connect ${provider.label}`}
                </button>
              ) : (
                <span className="rounded-full border border-[#3a3b42] px-2 py-0.5 text-[12px] text-[var(--color-text-tertiary)]">
                  Unavailable
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {chooserOpen && (
        <div className="mt-6 rounded-lg border border-[#2c2d33] bg-[#111217] p-4">
          <div className="text-[14px] font-medium text-[var(--color-text-primary)]">
            Choose an account to connect
          </div>
          <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
            You will be redirected to the provider and returned here when
            linking finishes.
          </p>
          <div className="mt-4 flex gap-2">
            {linkableProviders.map((provider) => (
              <button
                className="rounded-md border border-[#2c2d33] px-3 py-2 text-[13px] text-[var(--color-text-primary)] transition-colors hover:bg-[#1b1c22] disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
                disabled={linkingProvider === provider.id}
                key={provider.id}
                onClick={() => void startProviderLink(provider.id)}
              >
                {linkingProvider === provider.id
                  ? `Connecting ${provider.label}...`
                  : provider.label}
              </button>
            ))}
            <button
              className="rounded-md px-3 py-2 text-[13px] text-[var(--color-text-secondary)] transition-colors hover:bg-[#1b1c22]"
              type="button"
              onClick={() => setChooserOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
