"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type PermissionLevel = "admins" | "members" | "anyone";

type IpRestriction = {
  range: string;
  description: string;
  enabled: boolean;
  type: "allow";
};

type SecuritySettings = {
  inviteLinkEnabled: boolean;
  inviteUrl: string;
  approvedEmailDomains: string[];
  authentication: {
    google: boolean;
    emailPasskey: boolean;
  };
  permissions: {
    invitationsRole: PermissionLevel;
    teamCreationRole: PermissionLevel;
    labelManagementRole: PermissionLevel;
    templateManagementRole: PermissionLevel;
    apiKeyCreationRole: PermissionLevel;
    agentGuidanceRole: PermissionLevel;
  };
  restrictFileUploads: boolean;
  improveAi: boolean;
  webSearch: boolean;
  hipaa: boolean;
  ipRestrictions: IpRestriction[];
};

const INVITE_DOCS_URL = "https://linear.app/docs/invite-members";
const SAML_SCIM_URL = "https://linear.app/docs/saml-and-access-control";

function Toggle({
  enabled,
  onChange,
  label,
  disabled,
}: {
  enabled: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-[20px] w-[36px] shrink-0 items-center rounded-full transition-colors ${
        enabled ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]"
      } ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
    >
      <span
        className={`inline-block h-[16px] w-[16px] rounded-full bg-white shadow transition-transform ${
          enabled ? "translate-x-[18px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}

function PermissionSelect({
  value,
  onChange,
  disabled,
  label,
}: {
  value: PermissionLevel;
  onChange: (value: PermissionLevel) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as PermissionLevel)}
      className="rounded-md border border-[var(--color-border)] bg-transparent px-2 py-1 text-[12px] text-[var(--color-text-secondary)] outline-none disabled:cursor-not-allowed disabled:opacity-60"
    >
      <option value="admins">Only admins</option>
      <option value="members">All members</option>
      <option value="anyone">Anyone</option>
    </select>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-4 mt-8 text-[14px] font-semibold text-[var(--color-text-primary)]">
      {children}
    </h2>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-[var(--color-border)] py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-[var(--color-text-primary)]">
          {title}
        </div>
        {description ? (
          <div className="mt-0.5 text-[12px] text-[var(--color-text-tertiary)]">
            {description}
          </div>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^@+/, "");
}

function normalizeIpRange(value: string) {
  return value.trim().toLowerCase();
}

function isValidIpRange(value: string) {
  const trimmed = normalizeIpRange(value);
  const ipv4Octet = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
  const ipv4 = new RegExp(
    `^${ipv4Octet}\\.${ipv4Octet}\\.${ipv4Octet}\\.${ipv4Octet}(?:/(?:[0-9]|[12]\\d|3[0-2]))?$`,
  );
  const ipv6 = /^[0-9a-f:]+(?:\/[0-9]{1,3})?$/i;

  if (ipv4.test(trimmed)) {
    return true;
  }

  if (!trimmed.includes(":")) {
    return false;
  }

  const [address, prefix, extra] = trimmed.split("/");
  if (!address.includes(":") || extra !== undefined || !ipv6.test(trimmed)) {
    return false;
  }

  if (prefix === undefined) {
    return true;
  }

  const prefixNumber = Number(prefix);
  return (
    Number.isInteger(prefixNumber) && prefixNumber >= 0 && prefixNumber <= 128
  );
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function buildPayload(security: SecuritySettings) {
  return {
    inviteLinkEnabled: security.inviteLinkEnabled,
    approvedEmailDomains: security.approvedEmailDomains,
    authentication: security.authentication,
    permissions: security.permissions,
    restrictFileUploads: security.restrictFileUploads,
    improveAi: security.improveAi,
    webSearch: security.webSearch,
    hipaa: security.hipaa,
    ipRestrictions: security.ipRestrictions,
  };
}

const PERMISSION_ROWS: Array<{
  key: keyof SecuritySettings["permissions"];
  title: string;
}> = [
  { key: "invitationsRole", title: "New user invitations" },
  { key: "teamCreationRole", title: "Team creation" },
  { key: "labelManagementRole", title: "Manage workspace labels" },
  { key: "templateManagementRole", title: "Manage workspace templates" },
  { key: "apiKeyCreationRole", title: "API key creation" },
  { key: "agentGuidanceRole", title: "Modify agent guidance" },
];

export default function SecurityPage() {
  const [security, setSecurity] = useState<SecuritySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [domainDialogOpen, setDomainDialogOpen] = useState(false);
  const [domainDraft, setDomainDraft] = useState("");
  const [ipDialogOpen, setIpDialogOpen] = useState(false);
  const [ipRangeDraft, setIpRangeDraft] = useState("");
  const [ipDescriptionDraft, setIpDescriptionDraft] = useState("");

  useEffect(() => {
    fetch("/api/workspaces/current/security")
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
          security?: SecuritySettings;
        } | null;

        if (!response.ok || !data?.security) {
          throw new Error(data?.error ?? "Unable to load security settings.");
        }

        setSecurity({
          ...data.security,
          ipRestrictions: data.security.ipRestrictions ?? [],
        });
      })
      .catch((error: Error) => {
        setErrorMessage(error.message);
      })
      .finally(() => setLoading(false));
  }, []);

  const persistSecurity = useCallback(
    async (
      nextSecurity: SecuritySettings,
      options?: {
        successMessage?: string;
      },
    ) => {
      if (!security) {
        return false;
      }

      const previousSecurity = security;
      setSecurity(nextSecurity);
      setSaving(true);
      setStatusMessage(null);
      setErrorMessage(null);

      try {
        const response = await fetch("/api/workspaces/current/security", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildPayload(nextSecurity)),
        });

        const data = (await response.json().catch(() => null)) as {
          error?: string;
          security?: SecuritySettings;
        } | null;

        if (!response.ok || !data?.security) {
          setSecurity(previousSecurity);
          setErrorMessage(data?.error ?? "Unable to update security settings.");
          return false;
        }

        setSecurity({
          ...data.security,
          ipRestrictions: data.security.ipRestrictions ?? [],
        });
        setStatusMessage(
          options?.successMessage ?? "Security settings updated.",
        );
        return true;
      } finally {
        setSaving(false);
      }
    },
    [security],
  );

  const domainList = useMemo(
    () => security?.approvedEmailDomains ?? [],
    [security?.approvedEmailDomains],
  );

  const handleCopy = useCallback(async () => {
    if (!security?.inviteUrl) {
      return;
    }

    setErrorMessage(null);

    try {
      await copyText(security.inviteUrl);
      setCopied(true);
      setStatusMessage("Invite link copied.");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setErrorMessage("Unable to copy the invite link.");
    }
  }, [security?.inviteUrl]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Loading security settings...
      </div>
    );
  }

  if (!security) {
    return (
      <div className="max-w-[720px]">
        <h1 className="mb-4 text-[20px] font-semibold text-[var(--color-text-primary)]">
          Security
        </h1>
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          {errorMessage ?? "Unable to load security settings."}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="max-w-[720px]">
        <h1 className="mb-6 text-[20px] font-semibold text-[var(--color-text-primary)]">
          Security
        </h1>

        {statusMessage ? (
          <div className="mb-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12px] text-[var(--color-text-secondary)]">
            {statusMessage}
          </div>
        ) : null}

        {errorMessage ? (
          <div className="mb-4 rounded-md border border-[#4f1d1d] bg-[#2a1214] px-3 py-2 text-[12px] text-[#f1a3a8]">
            {errorMessage}
          </div>
        ) : null}

        <SectionHeader>Workspace access</SectionHeader>

        <div className="mb-6 rounded-lg border border-[var(--color-border)] p-4">
          <div className="mb-1 text-[13px] font-medium text-[var(--color-text-primary)]">
            Invite links
          </div>
          <p className="mb-4 text-[12px] text-[var(--color-text-tertiary)]">
            A uniquely generated invite link allows anyone with the link to join
            your workspace.
          </p>

          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-[13px] text-[var(--color-text-primary)]">
              Enable invite links
            </span>
            <Toggle
              enabled={security.inviteLinkEnabled}
              disabled={saving}
              onChange={(value) =>
                void persistSecurity(
                  { ...security, inviteLinkEnabled: value },
                  {
                    successMessage: value
                      ? "Invite links enabled."
                      : "Invite links disabled.",
                  },
                )
              }
              label="Enable invite links"
            />
          </div>

          {security.inviteLinkEnabled ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="flex-1 truncate rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12px] text-[var(--color-text-tertiary)]">
                {security.inviteUrl}
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleCopy()}
                className="flex items-center justify-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-2 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                </svg>
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          ) : null}
        </div>

        <div className="mb-6">
          <div className="mb-1 text-[13px] font-medium text-[var(--color-text-primary)]">
            Workspace login and restrictions
          </div>
          <p className="mb-3 text-[12px] text-[var(--color-text-tertiary)]">
            Anyone with an email address at these domains is allowed to sign up
            for this workspace.{" "}
            <a
              href={INVITE_DOCS_URL}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--color-accent)] hover:underline"
            >
              Docs ↗
            </a>
          </p>
          <div className="rounded-lg border border-[var(--color-border)] px-4 py-3">
            {domainList.length > 0 ? (
              <div className="mb-3 flex flex-wrap gap-2">
                {domainList.map((domain) => (
                  <div
                    key={domain}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[12px] text-[var(--color-text-secondary)]"
                  >
                    {domain}
                    <button
                      type="button"
                      aria-label={`Remove ${domain}`}
                      disabled={saving}
                      onClick={() =>
                        void persistSecurity(
                          {
                            ...security,
                            approvedEmailDomains:
                              security.approvedEmailDomains.filter(
                                (value) => value !== domain,
                              ),
                          },
                          { successMessage: "Approved domain removed." },
                        )
                      }
                      className="text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mb-3 text-[13px] text-[var(--color-text-tertiary)]">
                No approved email domains
              </div>
            )}

            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setDomainDraft("");
                setDomainDialogOpen(true);
                setErrorMessage(null);
              }}
              className="flex items-center gap-1.5 text-[12px] text-[var(--color-accent)] hover:underline disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Add approved email domain"
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
              Add domain
            </button>
          </div>
        </div>

        <div className="mb-6">
          <div className="mb-1 text-[13px] font-medium text-[var(--color-text-primary)]">
            IP restrictions
          </div>
          <p className="mb-3 text-[12px] text-[var(--color-text-tertiary)]">
            Restrict direct web, desktop, mobile, and API access to configured
            IP addresses or CIDR ranges. Available on Enterprise plans.
          </p>
          <div className="rounded-lg border border-[var(--color-border)] px-4 py-3">
            {security.ipRestrictions.length > 0 ? (
              <div className="mb-3 space-y-2">
                {security.ipRestrictions.map((restriction) => (
                  <div
                    key={restriction.range}
                    className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
                        {restriction.range}
                      </div>
                      <div className="text-[12px] text-[var(--color-text-tertiary)]">
                        {restriction.description || "Allowed IP range"}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Toggle
                        enabled={restriction.enabled}
                        disabled={saving}
                        onChange={(value) =>
                          void persistSecurity(
                            {
                              ...security,
                              ipRestrictions: security.ipRestrictions.map(
                                (entry) =>
                                  entry.range === restriction.range
                                    ? { ...entry, enabled: value }
                                    : entry,
                              ),
                            },
                            {
                              successMessage: value
                                ? "IP restriction enabled."
                                : "IP restriction disabled.",
                            },
                          )
                        }
                        label={`Enable ${restriction.range}`}
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${restriction.range}`}
                        disabled={saving}
                        onClick={() =>
                          void persistSecurity(
                            {
                              ...security,
                              ipRestrictions: security.ipRestrictions.filter(
                                (entry) => entry.range !== restriction.range,
                              ),
                            },
                            { successMessage: "IP restriction removed." },
                          )
                        }
                        className="text-[12px] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mb-3 text-[13px] text-[var(--color-text-tertiary)]">
                No IP restrictions
              </div>
            )}

            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setIpRangeDraft("");
                setIpDescriptionDraft("");
                setIpDialogOpen(true);
                setErrorMessage(null);
              }}
              className="flex items-center gap-1.5 text-[12px] text-[var(--color-accent)] hover:underline disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Add IP restriction"
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
              Add IP restriction
            </button>
          </div>
        </div>

        <SectionHeader>Authentication methods</SectionHeader>

        <p className="mb-4 text-[12px] text-[var(--color-text-tertiary)]">
          Admins and guests can always authenticate via Google and
          email/passkeys-even when disabled for members.
        </p>

        <SettingRow
          title="Google authentication"
          description="When enabled, this is available to all workspace members and guests"
        >
          <Toggle
            enabled={security.authentication.google}
            disabled={saving}
            onChange={(value) =>
              void persistSecurity(
                {
                  ...security,
                  authentication: {
                    ...security.authentication,
                    google: value,
                  },
                },
                {
                  successMessage: value
                    ? "Google authentication enabled."
                    : "Google authentication disabled for members.",
                },
              )
            }
            label="Google authentication"
          />
        </SettingRow>

        <SettingRow
          title="Email & passkey authentication"
          description="When enabled, this is available to all workspace members and guests"
        >
          <Toggle
            enabled={security.authentication.emailPasskey}
            disabled={saving}
            onChange={(value) =>
              void persistSecurity(
                {
                  ...security,
                  authentication: {
                    ...security.authentication,
                    emailPasskey: value,
                  },
                },
                {
                  successMessage: value
                    ? "Email and passkey authentication enabled."
                    : "Email and passkey authentication disabled for members.",
                },
              )
            }
            label="Email & passkey authentication"
          />
        </SettingRow>

        <div className="border-b border-[var(--color-border)] py-3">
          <a
            href={SAML_SCIM_URL}
            target="_blank"
            rel="noreferrer"
            className="text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            SAML & SCIM ↗
          </a>
        </div>

        <SectionHeader>Workspace management</SectionHeader>

        {PERMISSION_ROWS.map((row) => (
          <SettingRow key={row.key} title={row.title}>
            <PermissionSelect
              label={row.title}
              disabled={saving}
              value={security.permissions[row.key]}
              onChange={(value) =>
                void persistSecurity(
                  {
                    ...security,
                    permissions: {
                      ...security.permissions,
                      [row.key]: value,
                    },
                  },
                  { successMessage: `${row.title} updated.` },
                )
              }
            />
          </SettingRow>
        ))}

        <SettingRow
          title="Restrict file uploads"
          description="When enabled, only admins can upload files"
        >
          <Toggle
            enabled={security.restrictFileUploads}
            disabled={saving}
            onChange={(value) =>
              void persistSecurity(
                { ...security, restrictFileUploads: value },
                {
                  successMessage: value
                    ? "File uploads restricted to admins."
                    : "File uploads available to members again.",
                },
              )
            }
            label="Restrict file uploads"
          />
        </SettingRow>

        <SectionHeader>AI</SectionHeader>

        <SettingRow
          title="Improve AI"
          description="Allow Linear to use workspace data to improve AI features"
        >
          <Toggle
            enabled={security.improveAi}
            disabled={saving}
            onChange={(value) =>
              void persistSecurity(
                { ...security, improveAi: value },
                {
                  successMessage: value
                    ? "Improve AI enabled."
                    : "Improve AI disabled.",
                },
              )
            }
            label="Improve AI"
          />
        </SettingRow>

        <SettingRow
          title="Enable web search"
          description="Allow AI to search the web for additional context"
        >
          <Toggle
            enabled={security.webSearch}
            disabled={saving}
            onChange={(value) =>
              void persistSecurity(
                { ...security, webSearch: value },
                {
                  successMessage: value
                    ? "Web search enabled."
                    : "Web search disabled.",
                },
              )
            }
            label="Enable web search"
          />
        </SettingRow>

        <SectionHeader>Compliance</SectionHeader>

        <SettingRow
          title="HIPAA compliance"
          description="Enable HIPAA-compliant mode for protected health information"
        >
          <Toggle
            enabled={security.hipaa}
            disabled={saving}
            onChange={(value) =>
              void persistSecurity(
                { ...security, hipaa: value },
                {
                  successMessage: value
                    ? "HIPAA compliance enabled."
                    : "HIPAA compliance disabled.",
                },
              )
            }
            label="HIPAA compliance"
          />
        </SettingRow>
      </div>

      {domainDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-[420px] rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] p-5 shadow-2xl">
            <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
              Add approved domain
            </h2>
            <p className="mt-2 text-[12px] text-[var(--color-text-tertiary)]">
              Anyone with this email domain can join the workspace without a
              manual invite.
            </p>

            <form
              className="mt-4 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                const normalizedDomain = normalizeDomain(domainDraft);

                if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalizedDomain)) {
                  setErrorMessage("Enter a valid email domain.");
                  return;
                }

                if (security.approvedEmailDomains.includes(normalizedDomain)) {
                  setErrorMessage("That domain is already approved.");
                  return;
                }

                void persistSecurity(
                  {
                    ...security,
                    approvedEmailDomains: [
                      ...security.approvedEmailDomains,
                      normalizedDomain,
                    ],
                  },
                  { successMessage: "Approved domain added." },
                ).then((didSave) => {
                  if (didSave) {
                    setDomainDialogOpen(false);
                    setDomainDraft("");
                  }
                });
              }}
            >
              <label className="block text-[12px] text-[var(--color-text-secondary)]">
                Domain
                <input
                  value={domainDraft}
                  onChange={(event) => setDomainDraft(event.target.value)}
                  placeholder="example.com"
                  className="mt-1.5 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDomainDialogOpen(false);
                    setDomainDraft("");
                    setErrorMessage(null);
                  }}
                  className="rounded-md border border-[var(--color-border)] px-3 py-2 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-md bg-[var(--color-accent)] px-3 py-2 text-[12px] font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Add domain
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {ipDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-[420px] rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] p-5 shadow-2xl">
            <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
              Add IP restriction
            </h2>
            <p className="mt-2 text-[12px] text-[var(--color-text-tertiary)]">
              Allow access from a single IP address or a CIDR range, such as
              203.0.113.0/24.
            </p>

            <form
              className="mt-4 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                const range = normalizeIpRange(ipRangeDraft);

                if (!isValidIpRange(range)) {
                  setErrorMessage("Enter a valid IP address or CIDR range.");
                  return;
                }

                if (
                  security.ipRestrictions.some((entry) => entry.range === range)
                ) {
                  setErrorMessage("That IP restriction already exists.");
                  return;
                }

                void persistSecurity(
                  {
                    ...security,
                    ipRestrictions: [
                      ...security.ipRestrictions,
                      {
                        range,
                        description: ipDescriptionDraft.trim(),
                        enabled: true,
                        type: "allow",
                      },
                    ],
                  },
                  { successMessage: "IP restriction added." },
                ).then((didSave) => {
                  if (didSave) {
                    setIpDialogOpen(false);
                    setIpRangeDraft("");
                    setIpDescriptionDraft("");
                  }
                });
              }}
            >
              <label className="block text-[12px] text-[var(--color-text-secondary)]">
                IP address or CIDR range
                <input
                  value={ipRangeDraft}
                  onChange={(event) => setIpRangeDraft(event.target.value)}
                  placeholder="203.0.113.0/24"
                  className="mt-1.5 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <label className="block text-[12px] text-[var(--color-text-secondary)]">
                Description (optional)
                <input
                  value={ipDescriptionDraft}
                  onChange={(event) =>
                    setIpDescriptionDraft(event.target.value)
                  }
                  placeholder="Office network"
                  className="mt-1.5 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIpDialogOpen(false);
                    setIpRangeDraft("");
                    setIpDescriptionDraft("");
                    setErrorMessage(null);
                  }}
                  className="rounded-md border border-[var(--color-border)] px-3 py-2 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-md bg-[var(--color-accent)] px-3 py-2 text-[12px] font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Add restriction
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
