"use client";

import type { CustomerRequestsSettings } from "@/lib/collaboration-settings";
import { useEffect, useState } from "react";

const DEFAULT_CUSTOMER_REQUESTS: CustomerRequestsSettings = {
  enabled: false,
  intakeEmail: "",
  defaultTeamKey: "",
  linkMode: "suggested",
  autoCreateIssues: true,
};

export default function CustomerRequestsSettingsPage() {
  const [settings, setSettings] = useState<CustomerRequestsSettings>(
    DEFAULT_CUSTOMER_REQUESTS,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/workspaces/current/collaboration")
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((payload) => {
        if (!cancelled) {
          setSettings(payload.collaboration.customerRequests);
        }
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

  async function save(next: CustomerRequestsSettings) {
    setSettings(next);
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/workspaces/current/collaboration", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerRequests: next }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("save failed");
      setSettings(payload.collaboration.customerRequests);
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

  return (
    <div className="max-w-[760px]">
      <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
        Customer requests
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Configure how customer feedback enters the workspace and becomes linked
        to issues.
      </p>

      <section className="mt-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="block text-[15px] font-medium text-[var(--color-text-primary)]">
              Enable customer requests
            </span>
            <span className="mt-1 block text-[13px] text-[var(--color-text-secondary)]">
              Collect customer feedback from support, email, and API sources.
            </span>
          </span>
          <input
            aria-label="Enable customer requests"
            checked={settings.enabled}
            className="mt-1 h-5 w-5"
            type="checkbox"
            onChange={(event) =>
              save({ ...settings, enabled: event.target.checked })
            }
          />
        </label>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block text-[13px] font-medium text-[var(--color-text-secondary)]">
            Request inbox email
            <input
              className="mt-2 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[14px] text-[var(--color-text-primary)] disabled:opacity-60"
              disabled={!settings.enabled}
              placeholder="feedback@company.com"
              value={settings.intakeEmail}
              onChange={(event) =>
                setSettings({ ...settings, intakeEmail: event.target.value })
              }
              onBlur={() => save(settings)}
            />
          </label>

          <label className="block text-[13px] font-medium text-[var(--color-text-secondary)]">
            Default team key
            <input
              className="mt-2 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[14px] text-[var(--color-text-primary)] disabled:opacity-60"
              disabled={!settings.enabled}
              placeholder="ENG"
              value={settings.defaultTeamKey}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  defaultTeamKey: event.target.value.toUpperCase(),
                })
              }
              onBlur={() => save(settings)}
            />
          </label>
        </div>

        <label className="mt-5 block text-[13px] font-medium text-[var(--color-text-secondary)]">
          Issue linking behavior
          <select
            aria-label="Issue linking behavior"
            className="mt-2 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[14px] text-[var(--color-text-primary)] disabled:opacity-60"
            disabled={!settings.enabled}
            value={settings.linkMode}
            onChange={(event) =>
              save({
                ...settings,
                linkMode: event.target
                  .value as CustomerRequestsSettings["linkMode"],
              })
            }
          >
            <option value="manual">Manual review</option>
            <option value="suggested">Suggest matching issues</option>
            <option value="automatic">Auto-link by customer domain</option>
          </select>
        </label>

        <label className="mt-5 flex items-center gap-3 text-[14px] text-[var(--color-text-primary)]">
          <input
            checked={settings.autoCreateIssues}
            disabled={!settings.enabled}
            type="checkbox"
            onChange={(event) =>
              save({ ...settings, autoCreateIssues: event.target.checked })
            }
          />
          Create triage issues for new customer requests
        </label>

        <div className="mt-5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[13px] text-[var(--color-text-secondary)]">
          {settings.enabled
            ? `Requests will ${
                settings.autoCreateIssues ? "create" : "not create"
              } triage issues and use ${settings.linkMode} linking.`
            : "Customer request intake is off."}
        </div>

        <output className="mt-5 block text-[13px] text-[var(--color-text-tertiary)]">
          {saving
            ? "Saving customer request settings..."
            : message ||
              (settings.enabled
                ? "Customer requests are active."
                : "Customer requests are off.")}
        </output>
      </section>
    </div>
  );
}
