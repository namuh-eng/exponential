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

type PermissionGroup = {
  label: string;
  descriptions: string[];
};

type AuthorizedApplication = {
  id: string;
  appId?: string;
  name: string;
  clientId?: string;
  imageUrl: string | null;
  publisher: string | null;
  scopes: string[];
  permissionGroups?: PermissionGroup[];
  webhooksEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
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

type PersonalApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  workspaceName: string;
  accessLevel: "Member";
  createdAt: string;
  lastUsedAt: string | null;
};

type AccountSecurityState = {
  sessions: SecuritySession[];
  passkeys: Passkey[];
  authorizedApplications: AuthorizedApplication[];
  apiKeys: PersonalApiKey[];
  canCreateApiKeys: boolean;
  passkeyEnabled: boolean;
};

type CreatedCredential = {
  kind: "apiKey";
  label: string;
  secret: string;
};

type MutationResponse = AccountSecurityState & {
  createdCredential?: CreatedCredential;
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

const SCOPE_LABELS: Record<string, { group: string; description: string }> = {
  read: {
    group: "Workspace data",
    description: "View workspace and account information",
  },
  write: {
    group: "Workspace data",
    description: "Create and update workspace data",
  },
  "issues:read": {
    group: "Issues",
    description: "View issues and related metadata",
  },
  "issues:write": {
    group: "Issues",
    description: "Create and update issues",
  },
  "comments:read": {
    group: "Comments",
    description: "View comments",
  },
  "comments:write": {
    group: "Comments",
    description: "Create and update comments",
  },
  "webhooks:read": {
    group: "Webhooks",
    description: "View webhook subscriptions",
  },
  "webhooks:write": {
    group: "Webhooks",
    description: "Manage webhook subscriptions",
  },
};

function humanizeScope(scope: string) {
  const normalized = scope.trim();
  if (!normalized) {
    return "Access granted by this application";
  }

  return normalized
    .split(/[:_.-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function permissionGroupsFor(application: AuthorizedApplication) {
  if (application.permissionGroups?.length) {
    return application.permissionGroups;
  }

  const groups = new Map<string, string[]>();
  for (const scope of application.scopes) {
    const known = SCOPE_LABELS[scope];
    const group = known?.group ?? "Additional access";
    const description = known?.description ?? humanizeScope(scope);
    groups.set(group, [...(groups.get(group) ?? []), description]);
  }

  return [...groups].map(([label, descriptions]) => ({ label, descriptions }));
}

function permissionSummary(application: AuthorizedApplication) {
  const descriptions = permissionGroupsFor(application).flatMap(
    (group) => group.descriptions,
  );

  if (!descriptions.length) {
    return "No account permissions recorded";
  }

  return descriptions.join(", ");
}

function deviceLabel(session: SecuritySession) {
  const userAgent = session.userAgent ?? "";
  if (/mobile|android|iphone|ipad/i.test(userAgent)) {
    return "Mobile device";
  }
  if (/macintosh|windows|linux|chrome|firefox|safari/i.test(userAgent)) {
    return "Browser session";
  }

  return session.source || "Browser session";
}

function Section({
  id,
  title,
  description,
  action,
  children,
}: {
  id?: string;
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-label={title}
      className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
    >
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
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [passkeyDialogOpen, setPasskeyDialogOpen] = useState(false);
  const [passkeyName, setPasskeyName] = useState("Passkey 1");
  const [passkeyNameError, setPasskeyNameError] = useState<string | null>(null);
  const [apiKeyFormOpen, setApiKeyFormOpen] = useState(false);
  const [apiKeyName, setApiKeyName] = useState("Personal API key");
  const [createdCredential, setCreatedCredential] =
    useState<CreatedCredential | null>(null);
  const [confirmingApplicationId, setConfirmingApplicationId] = useState<
    string | null
  >(null);
  const [expandedApplicationId, setExpandedApplicationId] = useState<
    string | null
  >(null);

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
      authorizedApplications: Array.isArray(data.authorizedApplications)
        ? data.authorizedApplications
        : [],
      apiKeys: Array.isArray(data.apiKeys) ? data.apiKeys : [],
      canCreateApiKeys: data.canCreateApiKeys === true,
      passkeyEnabled: data.passkeyEnabled !== false,
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
        authorizedApplications: data.authorizedApplications,
        apiKeys: data.apiKeys,
        canCreateApiKeys: data.canCreateApiKeys,
        passkeyEnabled: data.passkeyEnabled,
      });
      setCreatedCredential(data.createdCredential ?? null);
      setStatus(successMessage);
      return true;
    } finally {
      setSaving(false);
    }
  }

  function createPasskey() {
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

    setError(null);
    setStatus(null);
    setPasskeyNameError(null);
    setPasskeyName(`Passkey ${securityState.passkeys.length + 1}`);
    setPasskeyDialogOpen(true);
  }

  async function submitPasskeyEnrollment(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    const name = passkeyName.trim();
    if (!name) {
      setPasskeyNameError("Passkey name is required.");
      return;
    }

    setSaving(true);
    setError(null);
    setPasskeyNameError(null);
    setStatus("Starting passkey enrollment…");
    try {
      await enrollPasskey(name);
      await loadSecurityState();
      setPasskeyDialogOpen(false);
      setStatus("Passkey added.");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Passkey enrollment failed. Try again or use another browser.";
      setStatus(null);
      setError(message);
      setPasskeyNameError(message);
    } finally {
      setSaving(false);
    }
  }

  async function createApiKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = apiKeyName.trim();
    if (!name) {
      setError("API key name is required.");
      return;
    }

    const created = await mutate(
      { action: "createApiKey", name },
      "API key created. Copy it now; it cannot be shown again.",
    );
    if (created) {
      setApiKeyFormOpen(false);
      setApiKeyName("Personal API key");
    }
  }

  async function copyCreatedSecret() {
    if (!createdCredential) {
      return;
    }

    try {
      await navigator.clipboard.writeText(createdCredential.secret);
      setStatus("API key copied to clipboard.");
    } catch {
      setError("Unable to copy API key. Select and copy it manually.");
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
      {error && !passkeyDialogOpen ? (
        <div
          className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-600"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {passkeyDialogOpen ? (
        <dialog
          open
          className="fixed inset-0 z-50 flex h-full w-full max-w-none items-center justify-center bg-black/30 px-4"
          aria-labelledby="passkey-dialog-title"
        >
          <form
            className="w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xl"
            onSubmit={submitPasskeyEnrollment}
          >
            <h2
              id="passkey-dialog-title"
              className="text-[16px] font-semibold text-[var(--color-text-primary)]"
            >
              Add passkey
            </h2>
            <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
              Name this passkey so you can recognize and revoke it later. Your
              browser will ask you to confirm enrollment after you continue.
            </p>
            <label
              htmlFor="passkey-name"
              className="mt-4 block text-[12px] font-medium text-[var(--color-text-secondary)]"
            >
              Passkey name
            </label>
            <input
              id="passkey-name"
              type="text"
              value={passkeyName}
              onChange={(event) => setPasskeyName(event.target.value)}
              maxLength={255}
              className="mt-2 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
              placeholder="Work laptop"
            />
            {passkeyNameError ? (
              <p className="mt-2 text-[12px] text-red-600" role="alert">
                {passkeyNameError}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <SmallButton
                disabled={saving}
                onClick={() => {
                  setPasskeyDialogOpen(false);
                  setPasskeyNameError(null);
                  setStatus("Passkey enrollment cancelled.");
                }}
              >
                Cancel
              </SmallButton>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "Starting…" : "Continue"}
              </button>
            </div>
          </form>
        </dialog>
      ) : null}

      {createdCredential ? (
        <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[13px] text-[var(--color-text-primary)]">
          <div className="font-medium">
            Copy your new API key now. You won't be able to see it again.
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12px]">
              {createdCredential.secret}
            </code>
            <SmallButton onClick={copyCreatedSecret}>Copy API key</SmallButton>
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
                    <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
                      Seen {formatDate(session.updatedAt)}
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
        id="personal-api-keys"
        title="Personal API keys"
        description="Create API keys that authenticate as your user for developer tools and scripts. Secrets are shown once after creation."
        action={
          <SmallButton
            disabled={saving || !securityState.canCreateApiKeys}
            onClick={() => setApiKeyFormOpen((current) => !current)}
          >
            Create API key
          </SmallButton>
        }
      >
        {!securityState.canCreateApiKeys ? (
          <EmptyState>
            Your workspace permissions don't allow creating API keys. Ask a
            workspace admin to change API key creation access.
          </EmptyState>
        ) : null}
        {apiKeyFormOpen ? (
          <form
            className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-hover)] p-4"
            onSubmit={createApiKey}
          >
            <label
              htmlFor="personal-api-key-name"
              className="text-[12px] font-medium text-[var(--color-text-secondary)]"
            >
              API key name
            </label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                id="personal-api-key-name"
                type="text"
                value={apiKeyName}
                onChange={(event) => setApiKeyName(event.target.value)}
                maxLength={255}
                className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                placeholder="Personal API key"
              />
              <button
                type="submit"
                disabled={saving}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Create API key
              </button>
            </div>
          </form>
        ) : null}
        {securityState.apiKeys.length ? (
          <div className="divide-y divide-[var(--color-border)]">
            {securityState.apiKeys.map((apiKey) => (
              <div
                key={apiKey.id}
                className="flex items-start justify-between gap-3 py-4 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <h3 className="text-[14px] font-medium text-[var(--color-text-primary)]">
                    {apiKey.name}
                  </h3>
                  <p className="mt-1 break-all text-[12px] text-[var(--color-text-secondary)]">
                    {apiKey.keyPrefix} · {apiKey.accessLevel} access ·{" "}
                    {apiKey.workspaceName}
                  </p>
                  <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
                    Created {formatDate(apiKey.createdAt)} · Last used{" "}
                    {formatDate(apiKey.lastUsedAt)}
                  </p>
                </div>
                <SmallButton
                  tone="danger"
                  disabled={saving}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Revoke the "${apiKey.name}" personal API key?`,
                      )
                    ) {
                      void mutate(
                        { action: "revokeApiKey", apiKeyId: apiKey.id },
                        "API key revoked.",
                      );
                    }
                  }}
                >
                  Revoke
                </SmallButton>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>
            No personal API keys have been created yet. Create one to use the
            API from scripts, CLIs, or local integrations.
          </EmptyState>
        )}
      </Section>

      <Section
        title="Authorized applications"
        description="Third-party OAuth applications that can access your account."
      >
        {securityState.authorizedApplications.length ? (
          <div className="divide-y divide-[var(--color-border)]">
            {securityState.authorizedApplications.map((application) => (
              <div key={application.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    {application.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={application.imageUrl}
                        alt=""
                        className="h-9 w-9 rounded-lg border border-[var(--color-border)] object-cover"
                      />
                    ) : (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-hover)] text-[13px] font-medium text-[var(--color-text-secondary)]">
                        {application.name.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <h3 className="text-[14px] font-medium text-[var(--color-text-primary)]">
                        {application.name}
                      </h3>
                      <p className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
                        {application.publisher ?? "Connected application"}
                      </p>
                      <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
                        Permissions: {permissionSummary(application)}
                        {application.webhooksEnabled ? " · Webhook access" : ""}
                      </p>
                      <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
                        Authorized {formatDate(application.createdAt)} · Last
                        used{" "}
                        {application.lastUsedAt
                          ? formatDate(application.lastUsedAt)
                          : "Unavailable"}
                      </p>
                      <button
                        type="button"
                        className="mt-2 text-[12px] text-[var(--color-accent)] hover:underline"
                        onClick={() =>
                          setExpandedApplicationId((current) =>
                            current === application.id ? null : application.id,
                          )
                        }
                      >
                        {expandedApplicationId === application.id
                          ? "Hide developer details"
                          : "Show developer details"}
                      </button>
                      {expandedApplicationId === application.id ? (
                        <p className="mt-1 break-all text-[12px] text-[var(--color-text-tertiary)]">
                          App ID: {application.appId ?? "Unavailable"} · Client
                          ID: {application.clientId ?? "Unavailable"}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <SmallButton
                    tone="danger"
                    disabled={saving}
                    onClick={() => setConfirmingApplicationId(application.id)}
                  >
                    Revoke
                  </SmallButton>
                </div>
                {confirmingApplicationId === application.id ? (
                  <div
                    className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-[var(--color-text-primary)]"
                    role="alertdialog"
                    aria-label={`Confirm revoking ${application.name}`}
                  >
                    <p className="font-medium">
                      Revoke access for {application.name}?
                    </p>
                    <p className="mt-1 text-[var(--color-text-secondary)]">
                      This application will lose access to your account and the
                      following permissions will be removed:{" "}
                      {permissionSummary(application)}.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <SmallButton
                        tone="danger"
                        disabled={saving}
                        onClick={async () => {
                          const revoked = await mutate(
                            {
                              action: "revokeAuthorizedApplication",
                              applicationId: application.id,
                            },
                            "Authorized application revoked.",
                          );
                          if (revoked) {
                            setConfirmingApplicationId(null);
                          }
                        }}
                      >
                        Confirm revoke
                      </SmallButton>
                      <SmallButton
                        disabled={saving}
                        onClick={() => setConfirmingApplicationId(null)}
                      >
                        Cancel
                      </SmallButton>
                    </div>
                  </div>
                ) : null}
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
