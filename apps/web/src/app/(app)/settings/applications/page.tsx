"use client";

import { useAppShellContext } from "@/app/(app)/app-shell";
import { EmptyState } from "@/components/empty-state";
import { withWorkspaceSlug } from "@/lib/workspace-paths";
import { useCallback, useEffect, useMemo, useState } from "react";

type WorkspaceApplication = {
  id: string;
  appId: string;
  clientId: string;
  name: string;
  imageUrl: string | null;
  scopes: string[];
  permissionGroups: { label: string; descriptions: string[] }[];
  webhooksEnabled: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  lastUsedAt: string | null;
  owner: { name: string | null; email: string | null; image: string | null };
};

type ApplicationsPayload = {
  applications?: WorkspaceApplication[];
  canManageApplications?: boolean;
  error?: string;
};

function formatDate(value: string | null) {
  if (!value) return "Unavailable";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function summarizePermissions(application: WorkspaceApplication) {
  if (!application.permissionGroups.length) return "No permissions requested";
  return application.permissionGroups
    .map((group) => `${group.label}: ${group.descriptions.join(", ")}`)
    .join(" · ");
}

export default function ApplicationsSettingsPage() {
  const workspaceSlug = useAppShellContext()?.workspaceSlug;
  const [applications, setApplications] = useState<WorkspaceApplication[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<WorkspaceApplication | null>(
    null,
  );

  const integrationsHref = useMemo(
    () => withWorkspaceSlug("/settings/integrations", workspaceSlug),
    [workspaceSlug],
  );

  const loadApplications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/workspaces/current/applications", {
        headers: { Accept: "application/json" },
      });
      const data = (await response
        .json()
        .catch(() => ({}))) as ApplicationsPayload;
      if (!response.ok) {
        throw new Error(data.error || "Applications could not be loaded.");
      }
      setApplications(
        Array.isArray(data.applications) ? data.applications : [],
      );
      setCanManage(Boolean(data.canManageApplications));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Applications could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadApplications();
  }, [loadApplications]);

  async function revokeApplication(application: WorkspaceApplication) {
    setRevokingId(application.id);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/current/applications/${encodeURIComponent(application.id)}`,
        { method: "DELETE", headers: { Accept: "application/json" } },
      );
      const data = (await response
        .json()
        .catch(() => ({}))) as ApplicationsPayload;
      if (!response.ok)
        throw new Error(data.error || "Application could not be revoked.");
      setApplications((items) =>
        items.filter((item) => item.id !== application.id),
      );
      setNotice("Application access revoked.");
      setConfirming(null);
    } catch (revokeError) {
      setError(
        revokeError instanceof Error
          ? revokeError.message
          : "Application could not be revoked.",
      );
    } finally {
      setRevokingId(null);
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-[var(--color-text-tertiary)]">
        Loading applications...
      </div>
    );
  }

  return (
    <div className="max-w-[760px]">
      <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
        Applications
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Manage third-party applications and OAuth connections for your
        workspace.
      </p>

      {notice ? (
        <output className="mt-6 block rounded-md border border-green-500/30 bg-green-500/10 px-4 py-3 text-[13px] text-green-300">
          {notice}
        </output>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="mt-6 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-300"
        >
          {error}
        </div>
      ) : null}

      <section aria-label="Connected applications" className="mt-8">
        {applications.length ? (
          <div className="overflow-hidden rounded-lg border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)]">
            {applications.map((application) => (
              <article
                key={application.id}
                className="border-b border-[var(--color-border-primary)] p-5 last:border-b-0"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      {application.imageUrl ? (
                        <img
                          src={application.imageUrl}
                          alt=""
                          className="h-9 w-9 rounded-md"
                        />
                      ) : (
                        <div
                          aria-hidden
                          className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--color-bg-tertiary)] text-[13px] font-semibold text-[var(--color-text-secondary)]"
                        >
                          {application.name.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <h2 className="text-[15px] font-medium text-[var(--color-text-primary)]">
                          {application.name}
                        </h2>
                        <p className="text-[12px] text-[var(--color-text-tertiary)]">
                          Authorized by{" "}
                          {application.owner.name ||
                            application.owner.email ||
                            "Unknown member"}
                        </p>
                      </div>
                    </div>
                    <dl className="mt-4 grid gap-2 text-[13px] text-[var(--color-text-secondary)] sm:grid-cols-2">
                      <div>
                        <dt className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
                          Permissions
                        </dt>
                        <dd>{summarizePermissions(application)}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
                          Client ID
                        </dt>
                        <dd className="font-mono text-[12px]">
                          {application.clientId}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
                          Authorized
                        </dt>
                        <dd>{formatDate(application.createdAt)}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
                          Last used
                        </dt>
                        <dd>{formatDate(application.lastUsedAt)}</dd>
                      </div>
                    </dl>
                    {application.webhooksEnabled ? (
                      <p className="mt-3 text-[12px] text-[var(--color-text-tertiary)]">
                        Webhook access enabled
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={!canManage || revokingId === application.id}
                    onClick={() => setConfirming(application)}
                    className="rounded-md border border-[var(--color-border-primary)] px-3 py-1.5 text-[13px] text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Revoke
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No applications"
            description="You haven't authorized any third-party applications yet."
            action={{ label: "Explore integrations", href: integrationsHref }}
          />
        )}
      </section>

      {confirming ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="revoke-application-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-md rounded-lg border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] p-5 shadow-xl">
            <h2
              id="revoke-application-title"
              className="text-[16px] font-semibold text-[var(--color-text-primary)]"
            >
              Confirm revoking {confirming.name}
            </h2>
            <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
              This will remove the application's access for this workspace
              member. The application will need to be authorized again to regain
              access.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="rounded-md border border-[var(--color-border-primary)] px-3 py-1.5 text-[13px]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void revokeApplication(confirming)}
                disabled={revokingId === confirming.id}
                className="rounded-md bg-red-600 px-3 py-1.5 text-[13px] text-white disabled:opacity-50"
              >
                Confirm revoke
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
