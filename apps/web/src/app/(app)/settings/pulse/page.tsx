"use client";

import type { PulseSettings } from "@/lib/collaboration-settings";
import { useEffect, useState } from "react";

const DEFAULT_PULSE: PulseSettings = {
  enabled: true,
  digestFrequency: "weekly",
  burnoutAlerts: true,
  velocityTarget: 40,
};

export default function PulseSettingsPage() {
  const [settings, setSettings] = useState<PulseSettings>(DEFAULT_PULSE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/workspaces/current/collaboration")
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((payload) => {
        if (!cancelled) setSettings(payload.collaboration.pulse);
      })
      .catch(() => {
        if (!cancelled) setMessage("Unable to load Pulse settings.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(next: PulseSettings) {
    setSettings(next);
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/workspaces/current/collaboration", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pulse: next }),
      });
      if (!response.ok) throw new Error("save failed");
      const payload = await response.json();
      setSettings(payload.collaboration.pulse);
      setMessage("Pulse settings saved.");
    } catch {
      setMessage("Unable to save Pulse settings.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-[var(--color-text-tertiary)]">
        Loading Pulse settings...
      </div>
    );
  }

  return (
    <div className="max-w-[720px]">
      <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
        Pulse
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Visualize team activity, velocity, and health over time.
      </p>

      <section className="mt-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="block text-[15px] font-medium text-[var(--color-text-primary)]">
              Enable Pulse insights
            </span>
            <span className="mt-1 block text-[13px] text-[var(--color-text-secondary)]">
              Track workspace throughput and team health signals.
            </span>
          </span>
          <input
            aria-label="Enable Pulse insights"
            checked={settings.enabled}
            className="mt-1 h-5 w-5"
            type="checkbox"
            onChange={(event) =>
              save({ ...settings, enabled: event.target.checked })
            }
          />
        </label>

        <label className="mt-5 block text-[13px] font-medium text-[var(--color-text-secondary)]">
          Digest frequency
          <select
            aria-label="Digest frequency"
            className="mt-2 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[14px] text-[var(--color-text-primary)]"
            disabled={!settings.enabled}
            value={settings.digestFrequency}
            onChange={(event) =>
              save({
                ...settings,
                digestFrequency: event.target
                  .value as PulseSettings["digestFrequency"],
              })
            }
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="off">Off</option>
          </select>
        </label>

        <label className="mt-5 block text-[13px] font-medium text-[var(--color-text-secondary)]">
          Velocity target
          <input
            aria-label="Velocity target"
            className="mt-2 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[14px] text-[var(--color-text-primary)]"
            disabled={!settings.enabled}
            min={1}
            max={500}
            type="number"
            value={settings.velocityTarget}
            onChange={(event) =>
              setSettings({
                ...settings,
                velocityTarget: Number(event.target.value),
              })
            }
            onBlur={() => save(settings)}
          />
        </label>

        <label className="mt-5 flex items-center gap-3 text-[14px] text-[var(--color-text-primary)]">
          <input
            checked={settings.burnoutAlerts}
            disabled={!settings.enabled}
            type="checkbox"
            onChange={(event) =>
              save({ ...settings, burnoutAlerts: event.target.checked })
            }
          />
          Send burnout risk alerts
        </label>

        <output className="mt-5 block text-[13px] text-[var(--color-text-tertiary)]">
          {saving
            ? "Saving Pulse settings..."
            : message ||
              (settings.enabled
                ? "Pulse insights are active."
                : "Pulse insights are off.")}
        </output>
      </section>
    </div>
  );
}
