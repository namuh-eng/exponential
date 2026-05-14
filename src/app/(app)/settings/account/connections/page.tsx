"use client";

import { EmptyState } from "@/components/empty-state";
import { linkSocialAccount } from "@/lib/auth-client";
import { useEffect, useMemo, useState } from "react";

type ProviderId = "google";

type ConnectedProvider = {
  id: string;
  providerId: string;
  accountId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type ProviderCapabilities = {
  providers?: {
    google?: boolean;
  };
};

type AccountSecurityPayload = {
  providers?: ConnectedProvider[];
};

type Notice = { tone: "success" | "error" | "neutral"; message: string };

const CONNECTIONS_PATH = "/settings/account/connections";

function providerLabel(providerId: string) {
  if (providerId === "google") return "Google";
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
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [linkingProvider, setLinkingProvider] = useState<ProviderId | null>(
    null,
  );
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
        const capabilities =
          (await capabilitiesResponse.json()) as ProviderCapabilities;

        setProviders(
          Array.isArray(securityData.providers) ? securityData.providers : [],
        );
        setGoogleConfigured(capabilities.providers?.google === true);
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
        setGoogleConfigured(false);
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
  const googleAlreadyConnected = providers.some(
    (provider) => provider.providerId === "google",
  );
  const linkableProviders =
    googleConfigured && !googleAlreadyConnected ? ["google" as const] : [];
  const hasLinkableProvider = linkableProviders.length > 0;

  async function startGoogleLink() {
    if (!googleConfigured) {
      setNotice({
        tone: "error",
        message:
          "Account linking is not configured for this workspace. Ask an admin to configure a social login provider.",
      });
      return;
    }

    setLinkingProvider("google");
    setNotice(null);
    try {
      const successParams = new URLSearchParams({ connection: "linked" });
      const result = await linkSocialAccount({
        provider: "google",
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
            ? "Google account linking is not configured for this workspace. Ask an admin to configure Google OAuth."
            : (result.error.message ??
              "Google account linking failed. Try again."),
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
        message:
          "Google account linking failed. Try again or contact an admin.",
      });
      setLinkingProvider(null);
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
        Manage your social logins and third-party account connections.
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

      <div className="mt-8">
        {connectedAccounts.length > 0 ? (
          <div className="space-y-3">
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
                    Connected account ending in{" "}
                    {provider.accountId?.slice(-6) ?? "unknown"}
                  </div>
                </div>
                <span className="rounded-full border border-emerald-500/30 px-2 py-0.5 text-[12px] text-emerald-200">
                  Connected
                </span>
              </div>
            ))}

            {hasLinkableProvider ? (
              <button
                className="rounded-md bg-[#5E6AD2] px-4 py-[8px] text-[13px] font-medium text-white transition-colors hover:bg-[#4F5ABF] disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
                onClick={() => setChooserOpen(true)}
              >
                Connect account
              </button>
            ) : (
              <p className="text-[13px] text-[var(--color-text-tertiary)]">
                No additional account providers are available to connect.
              </p>
            )}
          </div>
        ) : (
          <EmptyState
            title="No connected accounts"
            description={
              hasLinkableProvider
                ? "You are currently signed in via email. Link other accounts for easier access."
                : "Account linking is unavailable because no social login providers are configured for this workspace."
            }
            action={{
              label: "Connect account",
              disabled: !hasLinkableProvider,
              disabledReason:
                "Ask an admin to configure Google OAuth before connecting accounts.",
              onClick: () => setChooserOpen(true),
            }}
          />
        )}
      </div>

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
            {linkableProviders.includes("google") && (
              <button
                className="rounded-md border border-[#2c2d33] px-3 py-2 text-[13px] text-[var(--color-text-primary)] transition-colors hover:bg-[#1b1c22] disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
                disabled={linkingProvider === "google"}
                onClick={startGoogleLink}
              >
                {linkingProvider === "google"
                  ? "Connecting Google..."
                  : "Google"}
              </button>
            )}
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
