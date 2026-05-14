"use client";

import { Avatar } from "@/components/avatar";
import type {
  ApiSettingsPayload,
  OAuthApplicationRecord,
  PermissionLevel,
  WebhookEventType,
  WorkspaceApiKeyRecord,
  WorkspaceWebhookRecord,
} from "@/lib/api-settings";
import { validateOAuthRedirectUrl } from "@/lib/api-settings";
import { useEffect, useState } from "react";

type CreateResponse = {
  api: ApiSettingsPayload;
  createdCredential?: {
    kind: "oauthApplication" | "apiKey";
    label: string;
    secret: string;
  };
};

type OAuthFormState = {
  name: string;
  redirectUrl: string;
};

type WebhookFormState = {
  label: string;
  url: string;
  events: WebhookEventType[];
};

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 mt-10 text-[16px] font-semibold text-[var(--color-text-primary)]">
      {children}
    </h2>
  );
}

function DocsLink({
  href,
  label = "Docs ↗",
}: {
  href: string;
  label?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-[13px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
    >
      {label}
    </a>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      <svg
        className="h-3 w-3"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
      {label}
    </button>
  );
}

function EmptyActionRow({
  text,
  actionLabel,
  onAction,
  disabled,
}: {
  text: string;
  actionLabel?: string;
  onAction?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex min-h-[68px] items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-4">
      <span className="text-[13px] text-[var(--color-text-tertiary)]">
        {text}
      </span>
      {actionLabel ? (
        <ActionButton
          label={actionLabel}
          onClick={onAction}
          disabled={disabled}
        />
      ) : null}
    </div>
  );
}

function SurfaceRow({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-4 ${className}`}
    >
      {children}
    </div>
  );
}

function Modal({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <dialog
        open
        aria-label={title}
        className="m-0 w-full max-w-[480px] rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 text-[var(--color-text-primary)] shadow-2xl"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
              {title}
            </h3>
            <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
              {description}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[13px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          >
            Close
          </button>
        </div>
        {children}
      </dialog>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-[var(--color-text-secondary)]">
        {label}
      </span>
      {children}
    </div>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-accent)]"
    />
  );
}

function formatDate(value: string | null) {
  if (!value) {
    return "Never";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function OAuthApplicationsList({
  items,
  canManage,
  onCreate,
}: {
  items: OAuthApplicationRecord[];
  canManage: boolean;
  onCreate: () => void;
}) {
  if (items.length === 0) {
    return (
      <EmptyActionRow
        text="No OAuth applications"
        actionLabel="New OAuth application"
        onAction={onCreate}
        disabled={!canManage}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <ActionButton
          label="New OAuth application"
          onClick={onCreate}
          disabled={!canManage}
        />
      </div>
      {items.map((item) => (
        <SurfaceRow key={item.id}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
                {item.name}
              </div>
              <div className="mt-1 break-all text-[12px] text-[var(--color-text-secondary)]">
                Client ID: {item.clientId}
              </div>
              <div className="mt-1 break-all text-[12px] text-[var(--color-text-tertiary)]">
                Redirect URL: {item.redirectUrl}
              </div>
            </div>
            <div className="shrink-0 text-right text-[12px] text-[var(--color-text-tertiary)]">
              Created {formatDate(item.createdAt)}
            </div>
          </div>
        </SurfaceRow>
      ))}
    </div>
  );
}

function WebhooksList({
  items,
  canManage,
  onCreate,
}: {
  items: WorkspaceWebhookRecord[];
  canManage: boolean;
  onCreate: () => void;
}) {
  if (items.length === 0) {
    return (
      <EmptyActionRow
        text="No webhooks"
        actionLabel="New webhook"
        onAction={onCreate}
        disabled={!canManage}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <ActionButton
          label="New webhook"
          onClick={onCreate}
          disabled={!canManage}
        />
      </div>
      {items.map((item) => (
        <SurfaceRow key={item.id}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
                {item.label?.trim() || item.url}
              </div>
              <div className="mt-1 break-all text-[12px] text-[var(--color-text-secondary)]">
                {item.url}
              </div>
              <div className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
                Events: {item.events.join(", ")}
              </div>
            </div>
            <div className="shrink-0 text-right text-[12px] text-[var(--color-text-tertiary)]">
              <div>{item.enabled ? "Enabled" : "Disabled"}</div>
              <div className="mt-1">Created {formatDate(item.createdAt)}</div>
            </div>
          </div>
        </SurfaceRow>
      ))}
    </div>
  );
}

function ApiKeysList({
  items,
  canCreate,
  onCreate,
}: {
  items: WorkspaceApiKeyRecord[];
  canCreate: boolean;
  onCreate: () => void;
}) {
  if (items.length === 0) {
    return (
      <EmptyActionRow
        text="No API keys"
        actionLabel="Create API key"
        onAction={onCreate}
        disabled={!canCreate}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <ActionButton
          label="Create API key"
          onClick={onCreate}
          disabled={!canCreate}
        />
      </div>
      {items.map((item) => (
        <SurfaceRow key={item.id}>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
                {item.name}
              </div>
              <div className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
                {item.keyPrefix} • {item.accessLevel}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Avatar
                name={item.creator.name || item.creator.email}
                src={item.creator.image ?? undefined}
                size="md"
              />
              <div className="text-[12px] text-[var(--color-text-tertiary)]">
                <div>Created by {item.creator.name}</div>
                <div>Created {formatDate(item.createdAt)}</div>
                <div>Last used {formatDate(item.lastUsedAt)}</div>
              </div>
            </div>
          </div>
        </SurfaceRow>
      ))}
    </div>
  );
}

function buildDefaultOauthForm(): OAuthFormState {
  return {
    name: "",
    redirectUrl: "",
  };
}

function buildDefaultWebhookForm(): WebhookFormState {
  return {
    label: "",
    url: "https://example.com/hooks/linear",
    events: ["created", "updated"],
  };
}

export default function ApiSettingsPage() {
  const [data, setData] = useState<ApiSettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [oauthModalOpen, setOauthModalOpen] = useState(false);
  const [webhookModalOpen, setWebhookModalOpen] = useState(false);
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [oauthForm, setOauthForm] = useState<OAuthFormState>(
    buildDefaultOauthForm(),
  );
  const [webhookForm, setWebhookForm] = useState<WebhookFormState>(
    buildDefaultWebhookForm(),
  );
  const [apiKeyName, setApiKeyName] = useState("Workspace automation");
  const [revealedCredential, setRevealedCredential] = useState<{
    label: string;
    secret: string;
  } | null>(null);

  useEffect(() => {
    fetch("/api/workspaces/current/api")
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
          api?: ApiSettingsPayload;
        } | null;

        if (!response.ok || !payload?.api) {
          throw new Error(payload?.error ?? "Unable to load API settings.");
        }

        setData(payload.api);
      })
      .catch((error: Error) => {
        setErrorMessage(error.message);
      })
      .finally(() => setLoading(false));
  }, []);

  async function mutate(
    path: string,
    init: RequestInit,
    successMessage: string,
  ) {
    setSaving(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const response = await fetch(path, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        api?: ApiSettingsPayload;
        createdCredential?: {
          label: string;
          secret: string;
        };
      } | null;

      if (!response.ok || !payload?.api) {
        setErrorMessage(payload?.error ?? "Unable to update API settings.");
        return false;
      }

      setData(payload.api);
      setStatusMessage(successMessage);
      setRevealedCredential(payload.createdCredential ?? null);
      return true;
    } finally {
      setSaving(false);
    }
  }

  async function updatePermissionLevel(nextPermissionLevel: PermissionLevel) {
    if (!data) {
      return;
    }

    const previousData = data;
    setData({ ...data, permissionLevel: nextPermissionLevel });
    const didPersist = await mutate(
      "/api/workspaces/current/api",
      {
        method: "PATCH",
        body: JSON.stringify({ permissionLevel: nextPermissionLevel }),
      },
      "API key creation permission updated.",
    );

    if (!didPersist) {
      setData(previousData);
    }
  }

  async function submitOAuthApplication() {
    const name = oauthForm.name.trim();
    if (!name) {
      setStatusMessage(null);
      setRevealedCredential(null);
      setErrorMessage("Application name is required.");
      return;
    }

    const redirectUrlValidation = validateOAuthRedirectUrl(
      oauthForm.redirectUrl,
    );
    if (!redirectUrlValidation.ok) {
      setStatusMessage(null);
      setRevealedCredential(null);
      setErrorMessage(redirectUrlValidation.error);
      return;
    }

    const didPersist = await mutate(
      "/api/workspaces/current/api",
      {
        method: "POST",
        body: JSON.stringify({
          action: "createOAuthApplication",
          name,
          redirectUrl: redirectUrlValidation.url,
        }),
      },
      "OAuth application created.",
    );

    if (didPersist) {
      setOauthModalOpen(false);
      setOauthForm(buildDefaultOauthForm());
    }
  }

  async function submitWebhook() {
    const didPersist = await mutate(
      "/api/workspaces/current/api",
      {
        method: "POST",
        body: JSON.stringify({
          action: "createWebhook",
          label: webhookForm.label,
          url: webhookForm.url,
          events: webhookForm.events,
        }),
      },
      "Webhook created.",
    );

    if (didPersist) {
      setWebhookModalOpen(false);
      setWebhookForm(buildDefaultWebhookForm());
    }
  }

  async function submitApiKey() {
    const didPersist = await mutate(
      "/api/workspaces/current/api",
      {
        method: "POST",
        body: JSON.stringify({
          action: "createApiKey",
          name: apiKeyName,
        }),
      },
      "API key created.",
    );

    if (didPersist) {
      setApiKeyModalOpen(false);
      setApiKeyName("Workspace automation");
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-[var(--color-text-secondary)]">
        Loading API settings...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="max-w-[720px]">
        <h1 className="mb-4 text-[20px] font-semibold text-[var(--color-text-primary)]">
          API
        </h1>
        <p className="rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-3 text-[13px] text-[var(--color-text-primary)]">
          {errorMessage ?? "Unable to load API settings."}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="max-w-[760px]">
        <h1 className="mb-4 text-[20px] font-semibold text-[var(--color-text-primary)]">
          API
        </h1>

        {statusMessage ? (
          <div className="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-[13px] text-[var(--color-text-primary)]">
            {statusMessage}
          </div>
        ) : null}

        {errorMessage ? (
          <div className="mb-4 rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-3 text-[13px] text-[var(--color-text-primary)]">
            {errorMessage}
          </div>
        ) : null}

        {revealedCredential ? (
          <div className="mb-6 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-4 py-3">
            <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
              {revealedCredential.label}
            </div>
            <div className="mt-1 break-all font-mono text-[12px] text-[var(--color-text-secondary)]">
              {revealedCredential.secret}
            </div>
            <div className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
              Save this secret now. It will not be shown again.
            </div>
          </div>
        ) : null}

        <p className="mb-2 text-[13px] leading-6 text-[var(--color-text-secondary)]">
          Linear&apos;s GraphQL API provides a programmable interface to your
          data. Use our API to build public or private apps, workflows, and
          integrations for Linear.{" "}
          <span className="text-[var(--color-accent)]">Join our Slack</span> for
          help and questions.
        </p>
        <div className="mb-6">
          <DocsLink href={data.docs.graphql} />
        </div>

        <SectionHeader>OAuth Applications</SectionHeader>
        <p className="mb-4 text-[13px] text-[var(--color-text-tertiary)]">
          Manage your organization&apos;s OAuth applications.{" "}
          <DocsLink href={data.docs.oauthApplications} />
        </p>
        <OAuthApplicationsList
          items={data.oauthApplications}
          canManage={data.canManageWorkspaceApi}
          onCreate={() => setOauthModalOpen(true)}
        />

        <SectionHeader>Webhooks</SectionHeader>
        <p className="mb-1 text-[13px] text-[var(--color-text-tertiary)]">
          Webhooks allow you to receive HTTP requests when an entity is created,
          updated, or deleted.
        </p>
        <div className="mb-4">
          <DocsLink href={data.docs.webhooks} />
        </div>
        <WebhooksList
          items={data.webhooks}
          canManage={data.canManageWorkspaceApi}
          onCreate={() => setWebhookModalOpen(true)}
        />

        <SectionHeader>Member API keys</SectionHeader>
        <p className="mb-4 text-[13px] text-[var(--color-text-tertiary)]">
          Members of your workspace can create API keys to interact with the
          Linear API on their behalf. View your personal API keys from your{" "}
          <span className="font-medium text-[var(--color-accent)]">
            security & access settings
          </span>
          .
        </p>

        <SurfaceRow className="mb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[13px] text-[var(--color-text-primary)]">
                API key creation
              </div>
              <div className="mt-0.5 text-[12px] text-[var(--color-text-tertiary)]">
                Who can create API keys to interact with the Linear API on their
                behalf
              </div>
            </div>
            <select
              aria-label="API key creation permission"
              value={data.permissionLevel}
              onChange={(event) =>
                updatePermissionLevel(event.target.value as PermissionLevel)
              }
              disabled={!data.canManageWorkspaceApi || saving}
              className="rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="admins">Only admins</option>
              <option value="members">All members</option>
              <option value="anyone">Anyone</option>
            </select>
          </div>
        </SurfaceRow>

        <ApiKeysList
          items={data.apiKeys}
          canCreate={data.canCreateApiKeys}
          onCreate={() => setApiKeyModalOpen(true)}
        />
      </div>

      {oauthModalOpen ? (
        <Modal
          title="New OAuth application"
          description="Create an OAuth application with a redirect callback URL."
          onClose={() => setOauthModalOpen(false)}
        >
          <div className="space-y-4">
            <Field label="Application name">
              <TextInput
                aria-label="Application name"
                value={oauthForm.name}
                onChange={(event) =>
                  setOauthForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Partner portal"
              />
            </Field>

            <Field label="Redirect URL">
              <TextInput
                aria-label="Redirect URL"
                value={oauthForm.redirectUrl}
                onChange={(event) =>
                  setOauthForm((current) => ({
                    ...current,
                    redirectUrl: event.target.value,
                  }))
                }
                placeholder="https://example.com/oauth/callback"
              />
              <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
                Use a public HTTPS callback URL. Localhost, private network
                URLs, and URL fragments are not accepted.
              </p>
            </Field>

            <div className="flex justify-end gap-3">
              <ActionButton
                label="Create OAuth application"
                onClick={submitOAuthApplication}
                disabled={saving}
              />
            </div>
          </div>
        </Modal>
      ) : null}

      {webhookModalOpen ? (
        <Modal
          title="New webhook"
          description="Configure an HTTPS endpoint that receives create, update, and delete events."
          onClose={() => setWebhookModalOpen(false)}
        >
          <div className="space-y-4">
            <Field label="Webhook name">
              <TextInput
                aria-label="Webhook name"
                value={webhookForm.label}
                onChange={(event) =>
                  setWebhookForm((current) => ({
                    ...current,
                    label: event.target.value,
                  }))
                }
                placeholder="Issue sync"
              />
            </Field>

            <Field label="Endpoint URL">
              <TextInput
                aria-label="Endpoint URL"
                value={webhookForm.url}
                onChange={(event) =>
                  setWebhookForm((current) => ({
                    ...current,
                    url: event.target.value,
                  }))
                }
                placeholder="https://example.com/hooks/linear"
              />
            </Field>

            <fieldset>
              <legend className="mb-1.5 text-[12px] font-medium text-[var(--color-text-secondary)]">
                Events
              </legend>
              <div className="space-y-2">
                {(["created", "updated", "deleted"] as WebhookEventType[]).map(
                  (eventName) => {
                    const checked = webhookForm.events.includes(eventName);
                    return (
                      <label
                        key={eventName}
                        className="flex items-center gap-2 text-[13px] text-[var(--color-text-primary)]"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) =>
                            setWebhookForm((current) => ({
                              ...current,
                              events: event.target.checked
                                ? [...current.events, eventName]
                                : current.events.filter(
                                    (currentEvent) =>
                                      currentEvent !== eventName,
                                  ),
                            }))
                          }
                        />
                        Entity {eventName}
                      </label>
                    );
                  },
                )}
              </div>
            </fieldset>

            <div className="flex justify-end gap-3">
              <ActionButton
                label="Create webhook"
                onClick={submitWebhook}
                disabled={saving}
              />
            </div>
          </div>
        </Modal>
      ) : null}

      {apiKeyModalOpen ? (
        <Modal
          title="Create API key"
          description="Create a member API key for scripts and local automation."
          onClose={() => setApiKeyModalOpen(false)}
        >
          <div className="space-y-4">
            <Field label="Key name">
              <TextInput
                aria-label="Key name"
                value={apiKeyName}
                onChange={(event) => setApiKeyName(event.target.value)}
                placeholder="CI automation"
              />
            </Field>
            <div className="flex justify-end gap-3">
              <ActionButton
                label="Create API key"
                onClick={submitApiKey}
                disabled={saving}
              />
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
