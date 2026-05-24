"use client";

import type { CustomerRequestSettings } from "@/lib/collaboration-settings";
import { useEffect, useState } from "react";

const DEFAULT_CUSTOMER_REQUESTS: CustomerRequestSettings = {
  enabled: false,
  intakeEmail: "",
  defaultPriority: "medium",
  autoLinkIssues: true,
  requireCompany: false,
  confirmationMessage:
    "Thanks for the feedback — our product team will review it.",
};

type Permissions = {
  canManage: boolean;
  role?: string;
};

export default function CustomerRequestsSettingsPage() {
  const [settings, setSettings] = useState<CustomerRequestSettings>(
    DEFAULT_CUSTOMER_REQUESTS,
  );
  const [permissions, setPermissions] = useState<Permissions>({
    canManage: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/workspaces/current/collaboration")
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((payload) => {
        if (cancelled) return;
        setSettings({
          ...DEFAULT_CUSTOMER_REQUESTS,
          ...payload.collaboration.customerRequests,
        });
        setPermissions({
          canManage: Boolean(payload.permissions?.canManage),
          role: payload.permissions?.role,
        });
      })
      .catch(() => {
        if (!cancelled) setMessage("Unable to load customer request settings.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(next: CustomerRequestSettings) {
    setSettings(next);
    if (!permissions.canManage) {
      setMessage("Only workspace admins can change customer request settings.");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/workspaces/current/collaboration", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerRequests: next }),
      });
      if (!response.ok) throw new Error("save failed");
      const payload = await response.json();
      setSettings({
        ...DEFAULT_CUSTOMER_REQUESTS,
        ...payload.collaboration.customerRequests,
      });
      setPermissions({
        canManage: Boolean(payload.permissions?.canManage),
        role: payload.permissions?.role,
      });
      setMessage("Customer request settings saved.");
    } catch {
      setMessage("Unable to save customer request settings.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-[var(--color-text-tertiary)]">
        Loading customer request settings...
      </div>
    );
  }

  const controlsDisabled = saving || !permissions.canManage;

  return (
    <div className="max-w-[760px]">
      <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
        Customer requests
      </h1>
      <p className="mt-3 text-[14px] leading-6 text-[var(--color-text-secondary)]">
        Configure the customer feedback intake surface and how incoming requests
        become actionable issues for your workspace.
      </p>

      {!permissions.canManage ? (
        <div className="mt-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-[13px] text-[var(--color-text-secondary)]">
          You can view customer request settings, but only workspace admins and
          owners can edit them.
        </div>
      ) : null}

      <section className="mt-8 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="block text-[15px] font-medium text-[var(--color-text-primary)]">
              Enable customer requests
            </span>
            <span className="mt-1 block text-[13px] leading-5 text-[var(--color-text-secondary)]">
              Accept customer feedback into a managed request inbox for product
              triage.
            </span>
          </span>
          <input
            aria-label="Enable customer requests"
            checked={settings.enabled}
            className="mt-1 h-5 w-5"
            disabled={controlsDisabled}
            type="checkbox"
            onChange={(event) =>
              save({ ...settings, enabled: event.target.checked })
            }
          />
        </label>

        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <label className="block text-[13px] font-medium text-[var(--color-text-secondary)]">
            Intake email
            <input
              className="mt-2 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[14px] text-[var(--color-text-primary)] disabled:opacity-60"
              disabled={controlsDisabled || !settings.enabled}
              placeholder="feedback@company.com"
              value={settings.intakeEmail}
              onChange={(event) =>
                setSettings({ ...settings, intakeEmail: event.target.value })
              }
              onBlur={() => save(settings)}
            />
          </label>

          <label className="block text-[13px] font-medium text-[var(--color-text-secondary)]">
            Default issue priority
            <select
              aria-label="Default issue priority"
              className="mt-2 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[14px] text-[var(--color-text-primary)] disabled:opacity-60"
              disabled={controlsDisabled || !settings.enabled}
              value={settings.defaultPriority}
              onChange={(event) =>
                save({
                  ...settings,
                  defaultPriority: event.target
                    .value as CustomerRequestSettings["defaultPriority"],
                })
              }
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
        </div>

        <label className="mt-5 flex items-center gap-3 text-[14px] text-[var(--color-text-primary)]">
          <input
            checked={settings.autoLinkIssues}
            disabled={controlsDisabled || !settings.enabled}
            type="checkbox"
            onChange={(event) =>
              save({ ...settings, autoLinkIssues: event.target.checked })
            }
          />
          Auto-link duplicate customer requests to existing issues
        </label>

        <label className="mt-4 flex items-center gap-3 text-[14px] text-[var(--color-text-primary)]">
          <input
            checked={settings.requireCompany}
            disabled={controlsDisabled || !settings.enabled}
            type="checkbox"
            onChange={(event) =>
              save({ ...settings, requireCompany: event.target.checked })
            }
          />
          Require company name before submitting feedback
        </label>

        <label className="mt-5 block text-[13px] font-medium text-[var(--color-text-secondary)]">
          Confirmation message
          <textarea
            className="mt-2 min-h-24 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[14px] text-[var(--color-text-primary)] disabled:opacity-60"
            disabled={controlsDisabled || !settings.enabled}
            maxLength={240}
            value={settings.confirmationMessage}
            onChange={(event) =>
              setSettings({
                ...settings,
                confirmationMessage: event.target.value,
              })
            }
            onBlur={() => save(settings)}
          />
        </label>

        <output className="mt-5 block text-[13px] text-[var(--color-text-tertiary)]">
          {saving
            ? "Saving customer request settings..."
            : message ||
              (settings.enabled
                ? "Customer requests are active."
                : "Customer requests are off.")}
        </output>
      </section>

      <section className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">
          Request intake preview
        </h2>
        <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-[14px] font-medium text-[var(--color-text-primary)]">
              {settings.enabled
                ? "Feedback form enabled"
                : "Feedback form disabled"}
            </span>
            <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[12px] text-[var(--color-text-secondary)]">
              Priority: {settings.defaultPriority}
            </span>
          </div>
          <p className="mt-3 text-[13px] leading-5 text-[var(--color-text-secondary)]">
            Requests will be routed to{" "}
            {settings.intakeEmail || "no intake email"}
            {settings.autoLinkIssues
              ? " and linked to matching issues."
              : " without automatic issue linking."}
            {settings.requireCompany
              ? " Company is required."
              : " Company is optional."}
          </p>
          <p className="mt-3 rounded-md bg-[var(--color-surface)] p-3 text-[13px] text-[var(--color-text-primary)]">
            {settings.confirmationMessage}
          </p>
        </div>
      </section>
    </div>
  );
}
