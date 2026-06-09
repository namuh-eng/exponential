"use client";

import type { AsksSettings } from "@/lib/collaboration-settings";
import { useEffect, useState } from "react";

const DEFAULT_ASKS: AsksSettings = {
  enabled: false,
  intakeEmail: "",
  defaultPriority: "medium",
  autoAssign: true,
};

export default function AsksSettingsPage() {
  const [settings, setSettings] = useState<AsksSettings>(DEFAULT_ASKS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/workspaces/current/collaboration")
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((payload) => {
        if (!cancelled) setSettings(payload.collaboration.asks);
      })
      .catch(() => {
        if (!cancelled) setMessage("Unable to load Asks settings.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(next: AsksSettings) {
    setSettings(next);
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/workspaces/current/collaboration", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asks: next }),
      });
      if (!response.ok) throw new Error("save failed");
      const payload = await response.json();
      setSettings(payload.collaboration.asks);
      setMessage("Asks settings saved.");
    } catch {
      setMessage("Unable to save Asks settings.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-[var(--color-text-tertiary)]">
        Loading Asks settings...
      </div>
    );
  }

  return (
    <div className="max-w-[720px]">
      <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
        Asks
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Manage internal requests and support tickets within your workspace.
      </p>

      <section className="mt-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="block text-[15px] font-medium text-[var(--color-text-primary)]">
              Enable Asks
            </span>
            <span className="mt-1 block text-[13px] text-[var(--color-text-secondary)]">
              Collect internal help requests from teammates.
            </span>
          </span>
          <input
            aria-label="Enable Asks"
            checked={settings.enabled}
            className="mt-1 h-5 w-5"
            type="checkbox"
            onChange={(event) =>
              save({ ...settings, enabled: event.target.checked })
            }
          />
        </label>

        <label className="mt-5 block text-[13px] font-medium text-[var(--color-text-secondary)]">
          Intake email
          <input
            className="mt-2 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[14px] text-[var(--color-text-primary)]"
            disabled={!settings.enabled}
            placeholder="support@company.com"
            value={settings.intakeEmail}
            onChange={(event) =>
              setSettings({ ...settings, intakeEmail: event.target.value })
            }
            onBlur={() => save(settings)}
          />
        </label>

        <label className="mt-5 block text-[13px] font-medium text-[var(--color-text-secondary)]">
          Default priority
          <select
            aria-label="Default priority"
            className="mt-2 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[14px] text-[var(--color-text-primary)]"
            disabled={!settings.enabled}
            value={settings.defaultPriority}
            onChange={(event) =>
              save({
                ...settings,
                defaultPriority: event.target
                  .value as AsksSettings["defaultPriority"],
              })
            }
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>

        <label className="mt-5 flex items-center gap-3 text-[14px] text-[var(--color-text-primary)]">
          <input
            checked={settings.autoAssign}
            disabled={!settings.enabled}
            type="checkbox"
            onChange={(event) =>
              save({ ...settings, autoAssign: event.target.checked })
            }
          />
          Auto-assign new asks to triage owners
        </label>

        <output className="mt-5 block text-[13px] text-[var(--color-text-tertiary)]">
          {saving
            ? "Saving Asks settings..."
            : message ||
              (settings.enabled ? "Asks is active." : "Asks is off.")}
        </output>
      </section>
    </div>
  );
}
