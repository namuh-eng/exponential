"use client";

import { useEffect, useState } from "react";

type SecuritySession = {
  id: string;
  isCurrent: boolean;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

type SignInProvider = {
  id: string;
  providerId: string;
  accountId: string;
  createdAt: string;
  updatedAt: string;
};

type AccountSecurityState = {
  sessions: SecuritySession[];
  providers: SignInProvider[];
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatProviderName(providerId: string) {
  if (providerId === "credential") {
    return "Email and password";
  }

  if (providerId === "magic-link") {
    return "Magic link";
  }

  return providerId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function deviceLabel(session: SecuritySession) {
  if (!session.userAgent) {
    return "Unknown device";
  }

  if (/mobile|android|iphone|ipad/i.test(session.userAgent)) {
    return "Mobile device";
  }

  return "Browser session";
}

export default function AccountSecurityPage() {
  const [securityState, setSecurityState] =
    useState<AccountSecurityState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadSecurityState() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch("/api/account/security", {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Unable to load account security information.");
        }

        const data = (await response.json()) as AccountSecurityState;
        setSecurityState({
          sessions: Array.isArray(data.sessions) ? data.sessions : [],
          providers: Array.isArray(data.providers) ? data.providers : [],
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        setError(
          err instanceof Error
            ? err.message
            : "Unable to load account security information.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadSecurityState();

    return () => controller.abort();
  }, []);

  return (
    <div className="max-w-[720px]">
      <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
        Account security
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Manage your password, two-factor authentication, and active sessions.
      </p>

      {loading ? (
        <div className="mt-8 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-[14px] text-[var(--color-text-tertiary)]">
          Loading account security...
        </div>
      ) : error ? (
        <div
          className="mt-8 rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-[14px] text-red-600"
          role="alert"
        >
          {error}
        </div>
      ) : (
        <>
          <div className="mt-8 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[15px] font-medium text-[var(--color-text-primary)]">
                  Two-factor authentication
                </h2>
                <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
                  Add an extra layer of security to your account by requiring
                  more than just a sign-in link or provider session.
                </p>
              </div>
              <span className="rounded-full bg-[var(--color-surface-hover)] px-2 py-1 text-[11px] text-[var(--color-text-tertiary)]">
                Coming soon
              </span>
            </div>
            <button
              type="button"
              disabled
              className="mt-4 cursor-not-allowed rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-tertiary)] opacity-70"
            >
              Enable 2FA (coming soon)
            </button>
          </div>

          <section className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <h2 className="text-[15px] font-medium text-[var(--color-text-primary)]">
              Active sessions
            </h2>
            <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
              Devices currently signed in to your account.
            </p>

            {securityState?.sessions.length ? (
              <div className="mt-4 divide-y divide-[var(--color-border)]">
                {securityState.sessions.map((session) => (
                  <div key={session.id} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-[14px] font-medium text-[var(--color-text-primary)]">
                            {deviceLabel(session)}
                          </h3>
                          {session.isCurrent ? (
                            <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[11px] text-green-600">
                              Current session
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 break-all text-[12px] text-[var(--color-text-tertiary)]">
                          {session.userAgent ?? "No user agent recorded"}
                        </p>
                      </div>
                      <div className="shrink-0 text-right text-[12px] text-[var(--color-text-tertiary)]">
                        <div>{session.ipAddress ?? "Unknown IP"}</div>
                        <div>Expires {formatDate(session.expiresAt)}</div>
                      </div>
                    </div>
                    <p className="mt-2 text-[12px] text-[var(--color-text-tertiary)]">
                      Created {formatDate(session.createdAt)} · Last updated{" "}
                      {formatDate(session.updatedAt)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-dashed border-[var(--color-border)] p-4 text-[13px] text-[var(--color-text-tertiary)]">
                No active sessions were found for this account.
              </div>
            )}
          </section>

          <section className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <h2 className="text-[15px] font-medium text-[var(--color-text-primary)]">
              Sign-in methods
            </h2>
            <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
              Connected providers that can be used to access your account.
            </p>

            {securityState?.providers.length ? (
              <div className="mt-4 divide-y divide-[var(--color-border)]">
                {securityState.providers.map((provider) => (
                  <div key={provider.id} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-[14px] font-medium text-[var(--color-text-primary)]">
                          {formatProviderName(provider.providerId)}
                        </h3>
                        <p className="mt-1 break-all text-[12px] text-[var(--color-text-tertiary)]">
                          Account ID: {provider.accountId}
                        </p>
                      </div>
                      <div className="shrink-0 text-right text-[12px] text-[var(--color-text-tertiary)]">
                        Connected {formatDate(provider.createdAt)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-dashed border-[var(--color-border)] p-4 text-[13px] text-[var(--color-text-tertiary)]">
                No connected sign-in methods were found.
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
