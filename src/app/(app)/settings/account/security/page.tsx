"use client";

import { browserSupportsPasskeys, enrollPasskey } from "@/lib/auth-client";
import { useCallback, useEffect, useState } from "react";

type SecuritySession = {
  id: string;
  isCurrent: boolean;
  userAgent: string | null;
  ipAddress: string | null;
  source: string;
  location: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

type PersonalApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  workspaceName: string;
  createdAt: string;
  lastUsedAt: string | null;
};

type AuthorizedApplication = {
  id: string;
  name: string;
  clientId: string;
  scopes: string[];
  createdAt: string;
};

type Passkey = {
  id: string;
  name: string;
  credentialId: string;
  deviceType: string;
  backedUp: boolean;
  transports: string[];
  createdAt: string;
};

type AccountSecurityState = {
  sessions: SecuritySession[];
  passkeys: Passkey[];
  apiKeys: PersonalApiKey[];
  authorizedApplications: AuthorizedApplication[];
  passkeyEnabled: boolean;
  canCreateApiKeys: boolean;
  activeWorkspace: { id: string; name: string } | null;
};

type MutationResponse = AccountSecurityState & {
  createdApiKey?: { label: string; token: string };
};

function formatDate(value: string | null) {
  if (!value) {
    return "Never";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function deviceLabel(session: SecuritySession) {
  const userAgent = session.userAgent ?? "";
  if (/mobile|android|iphone|ipad/i.test(userAgent)) {
    return "Mobile device";
  }
  if (/macintosh|windows|linux|chrome|firefox|safari/i.test(userAgent)) {
    return "Browser session";
  }
  return "Unknown device";
}

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-medium text-[var(--color-text-primary)]">
            {title}
          </h2>
          <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
            {description}
          </p>
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SmallButton({
  children,
  onClick,
  disabled,
  tone = "default",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50 ${
        tone === "danger" ? "text-red-600" : "text-[var(--color-text-primary)]"
      }`}
    >
      {children}
    </button>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--color-border)] p-4 text-[13px] text-[var(--color-text-tertiary)]">
      {children}
    </div>
  );
}

export default function AccountSecurityPage() {
  const [securityState, setSecurityState] =
    useState<AccountSecurityState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(
    null,
  );
  const [apiKeyName, setApiKeyName] = useState("Personal automation");
  const [revealedApiKey, setRevealedApiKey] = useState<{
    label: string;
    token: string;
  } | null>(null);
  const [passkeySupported, setPasskeySupported] = useState(false);

  const loadSecurityState = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/account/security", { signal });
    const data = (await response.json().catch(() => null)) as
      | (Partial<AccountSecurityState> & { error?: string })
      | null;

    if (!response.ok || !data) {
      throw new Error(
        data?.error ?? "Unable to load account security information.",
      );
    }

    setSecurityState({
      sessions: Array.isArray(data.sessions) ? data.sessions : [],
      passkeys: Array.isArray(data.passkeys) ? data.passkeys : [],
      apiKeys: Array.isArray(data.apiKeys) ? data.apiKeys : [],
      authorizedApplications: Array.isArray(data.authorizedApplications)
        ? data.authorizedApplications
        : [],
      passkeyEnabled: data.passkeyEnabled !== false,
      canCreateApiKeys: Boolean(data.canCreateApiKeys),
      activeWorkspace: data.activeWorkspace ?? null,
    });
  }, []);

  useEffect(() => {
    setPasskeySupported(browserSupportsPasskeys());
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    loadSecurityState(controller.signal)
      .catch((err: Error) => {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [loadSecurityState]);

  async function mutate(
    action: Record<string, unknown>,
    successMessage: string,
  ) {
    setSaving(true);
    setError(null);
    setStatus(null);

    try {
      const response = await fetch("/api/account/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      const data = (await response.json().catch(() => null)) as
        | (MutationResponse & { error?: string })
        | null;

      if (!response.ok || !data) {
        setError(data?.error ?? "Unable to update account security.");
        return false;
      }

      setSecurityState({
        sessions: data.sessions,
        passkeys: data.passkeys,
        apiKeys: data.apiKeys,
        authorizedApplications: data.authorizedApplications,
        passkeyEnabled: data.passkeyEnabled,
        canCreateApiKeys: data.canCreateApiKeys,
        activeWorkspace: data.activeWorkspace,
      });
      setRevealedApiKey(data.createdApiKey ?? null);
      setStatus(successMessage);
      return true;
    } finally {
      setSaving(false);
    }
  }

  async function createPasskey() {
    if (!securityState?.passkeyEnabled) {
      setError("Passkey enrollment is not configured for this environment.");
      return;
    }
    if (!passkeySupported) {
      setError(
        "This browser doesn't support passkey enrollment. Use a browser with WebAuthn support.",
      );
      return;
    }

    const defaultName = `Passkey ${securityState?.passkeys.length ? securityState.passkeys.length + 1 : 1}`;
    const name = window.prompt("Name this passkey", defaultName)?.trim();
    if (!name) {
      return;
    }

    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      await enrollPasskey(name);
      await loadSecurityState();
      setStatus("Passkey added.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Passkey enrollment failed. Try again or use another browser.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function createApiKey() {
    const didCreate = await mutate(
      { action: "createApiKey", name: apiKeyName },
      "Personal API key created.",
    );
    if (didCreate) {
      setApiKeyName("Personal automation");
    }
  }

  if (loading) {
    return (
      <div className="max-w-[720px]">
        <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
          Security & access
        </h1>
        <div className="mt-8 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-[14px] text-[var(--color-text-tertiary)]">
          Loading account security...
        </div>
      </div>
    );
  }

  if (!securityState) {
    return (
      <div className="max-w-[720px]">
        <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
          Security & access
        </h1>
        <div
          className="mt-8 rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-[14px] text-red-600"
          role="alert"
        >
          {error ?? "Unable to load account security information."}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[760px]">
      <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
        Security & access
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Manage sessions, passkeys, personal API keys, and application access for
        your account.
      </p>

      {status ? (
        <div className="mt-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-[13px] text-[var(--color-text-primary)]">
          {status}
        </div>
      ) : null}
      {error ? (
        <div
          className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-600"
          role="alert"
        >
          {error}
        </div>
      ) : null}
      {revealedApiKey ? (
        <div className="mt-5 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-4 py-3">
          <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
            {revealedApiKey.label}
          </div>
          <div className="mt-1 break-all font-mono text-[12px] text-[var(--color-text-secondary)]">
            {revealedApiKey.token}
          </div>
          <div className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
            Save this token now. It will not be shown again.
          </div>
        </div>
      ) : null}

      <Section
        title="Sessions"
        description="Review devices currently or recently signed in to your account. Expand a session to inspect its source, IP address, and timestamps."
        action={
          <SmallButton
            tone="danger"
            disabled={saving || securityState.sessions.length <= 1}
            onClick={() =>
              mutate(
                { action: "revokeAllOtherSessions" },
                "Other sessions revoked.",
              )
            }
          >
            Revoke all except current
          </SmallButton>
        }
      >
        {securityState.sessions.length ? (
          <div className="divide-y divide-[var(--color-border)]">
            {securityState.sessions.map((session) => (
              <div key={session.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
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
                      {session.location} · {session.ipAddress ?? "Unknown IP"}
                    </p>
                    <button
                      type="button"
                      className="mt-2 text-[12px] text-[var(--color-accent)] hover:underline"
                      onClick={() =>
                        setExpandedSessionId((current) =>
                          current === session.id ? null : session.id,
                        )
                      }
                    >
                      {expandedSessionId === session.id
                        ? "Hide details"
                        : "Show details"}
                    </button>
                  </div>
                  <SmallButton
                    tone="danger"
                    disabled={saving || session.isCurrent}
                    onClick={() =>
                      mutate(
                        { action: "revokeSession", sessionId: session.id },
                        "Session revoked.",
                      )
                    }
                  >
                    Revoke
                  </SmallButton>
                </div>
                {expandedSessionId === session.id ? (
                  <dl className="mt-3 grid gap-2 rounded-lg bg-[var(--color-surface-hover)] p-3 text-[12px] text-[var(--color-text-secondary)] sm:grid-cols-2">
                    <div>
                      <dt className="text-[var(--color-text-tertiary)]">
                        Source
                      </dt>
                      <dd className="break-all">{session.source}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--color-text-tertiary)]">
                        Original sign-in
                      </dt>
                      <dd>{formatDate(session.createdAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--color-text-tertiary)]">
                        Last seen
                      </dt>
                      <dd>{formatDate(session.updatedAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--color-text-tertiary)]">
                        Expires
                      </dt>
                      <dd>{formatDate(session.expiresAt)}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-[var(--color-text-tertiary)]">
                        User agent
                      </dt>
                      <dd className="break-all">
                        {session.userAgent ?? "No user agent recorded"}
                      </dd>
                    </div>
                  </dl>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>
            No active sessions were found for this account.
          </EmptyState>
        )}
      </Section>

      <Section
        title="Passkeys"
        description="Use passkeys to sign in with your device biometrics or security key."
        action={
          <SmallButton
            disabled={
              saving || !securityState.passkeyEnabled || !passkeySupported
            }
            onClick={createPasskey}
          >
            Add passkey
          </SmallButton>
        }
      >
        {!securityState.passkeyEnabled ? (
          <EmptyState>
            Passkey sign-in is not configured for this environment. Use email or
            Google authentication instead.
          </EmptyState>
        ) : !passkeySupported ? (
          <EmptyState>
            This browser or test context does not support WebAuthn passkeys. Use
            a browser with platform authenticator or security key support to add
            a passkey.
          </EmptyState>
        ) : securityState.passkeys.length ? (
          <div className="divide-y divide-[var(--color-border)]">
            {securityState.passkeys.map((passkey) => (
              <div
                key={passkey.id}
                className="flex items-start justify-between gap-3 py-4 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <h3 className="text-[14px] font-medium text-[var(--color-text-primary)]">
                    {passkey.name}
                  </h3>
                  <p className="mt-1 break-all text-[12px] text-[var(--color-text-secondary)]">
                    {passkey.deviceType} ·{" "}
                    {passkey.backedUp ? "Synced" : "Device-bound"}
                    {passkey.transports.length
                      ? ` · ${passkey.transports.join(", ")}`
                      : ""}
                  </p>
                  <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
                    Added {formatDate(passkey.createdAt)}
                  </p>
                </div>
                <SmallButton
                  tone="danger"
                  disabled={saving}
                  onClick={() =>
                    mutate(
                      { action: "revokePasskey", passkeyId: passkey.id },
                      "Passkey revoked.",
                    )
                  }
                >
                  Revoke
                </SmallButton>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>
            No passkeys have been added yet. Add a passkey to enable passkey
            sign-in for this account.
          </EmptyState>
        )}
      </Section>

      <Section
        title="Personal API keys"
        description={`Create tokens for scripts and integrations that act as you${
          securityState.activeWorkspace
            ? ` in ${securityState.activeWorkspace.name}`
            : ""
        }.`}
      >
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <input
            aria-label="API key name"
            value={apiKeyName}
            onChange={(event) => setApiKeyName(event.target.value)}
            className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
          />
          <SmallButton
            disabled={saving || !securityState.canCreateApiKeys}
            onClick={createApiKey}
          >
            Create API key
          </SmallButton>
        </div>
        {securityState.apiKeys.length ? (
          <div className="divide-y divide-[var(--color-border)]">
            {securityState.apiKeys.map((key) => (
              <div
                key={key.id}
                className="flex items-start justify-between gap-3 py-4 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <h3 className="text-[14px] font-medium text-[var(--color-text-primary)]">
                    {key.name}
                  </h3>
                  <p className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
                    {key.keyPrefix} · {key.workspaceName}
                  </p>
                  <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
                    Created {formatDate(key.createdAt)} · Last used{" "}
                    {formatDate(key.lastUsedAt)}
                  </p>
                </div>
                <SmallButton
                  tone="danger"
                  disabled={saving}
                  onClick={() =>
                    mutate(
                      { action: "revokeApiKey", apiKeyId: key.id },
                      "Personal API key revoked.",
                    )
                  }
                >
                  Revoke
                </SmallButton>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>No personal API keys have been created.</EmptyState>
        )}
      </Section>

      <Section
        title="Authorized applications"
        description="Third-party OAuth applications that can access your account."
      >
        {securityState.authorizedApplications.length ? (
          <div className="divide-y divide-[var(--color-border)]">
            {securityState.authorizedApplications.map((application) => (
              <div
                key={application.id}
                className="flex items-start justify-between gap-3 py-4 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <h3 className="text-[14px] font-medium text-[var(--color-text-primary)]">
                    {application.name}
                  </h3>
                  <p className="mt-1 break-all text-[12px] text-[var(--color-text-secondary)]">
                    Client ID: {application.clientId}
                  </p>
                  <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
                    Permissions: {application.scopes.join(", ")} · Authorized{" "}
                    {formatDate(application.createdAt)}
                  </p>
                </div>
                <SmallButton
                  tone="danger"
                  disabled={saving}
                  onClick={() =>
                    mutate(
                      {
                        action: "revokeAuthorizedApplication",
                        applicationId: application.id,
                      },
                      "Authorized application revoked.",
                    )
                  }
                >
                  Revoke
                </SmallButton>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>
            No authorized applications. OAuth application grants will appear
            here with their permissions and revoke controls.
          </EmptyState>
        )}
      </Section>
    </div>
  );
}
