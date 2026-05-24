"use client";

import type { WorkspaceInitiativeSettings } from "@/lib/initiative-settings";
import { useCallback, useEffect, useState } from "react";

type SettingsResponse = {
  initiativesSettings: WorkspaceInitiativeSettings;
  viewerRole: string;
  canManage: boolean;
};

const defaultSettings: WorkspaceInitiativeSettings = {
  enabled: true,
  projectRollups: true,
  visibility: "workspace",
  roadmapMode: "all",
};

function ToggleRow({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-5 border-b border-[var(--color-border)] px-5 py-4 last:border-b-0">
      <div>
        <h3 className="text-[14px] font-medium text-[var(--color-text-primary)]">
          {title}
        </h3>
        <p className="mt-1 max-w-[560px] text-[13px] leading-5 text-[var(--color-text-secondary)]">
          {description}
        </p>
      </div>
      <label className="inline-flex items-center gap-2 text-[13px] text-[var(--color-text-secondary)]">
        <input
          aria-label={title}
          type="checkbox"
          className="h-4 w-4 accent-[var(--color-accent)]"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        {checked ? "On" : "Off"}
      </label>
    </div>
  );
}

function SelectRow({
  title,
  description,
  value,
  disabled,
  onChange,
  options,
}: {
  title: string;
  description: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-start justify-between gap-5 border-b border-[var(--color-border)] px-5 py-4 last:border-b-0">
      <div>
        <h3 className="text-[14px] font-medium text-[var(--color-text-primary)]">
          {title}
        </h3>
        <p className="mt-1 max-w-[560px] text-[13px] leading-5 text-[var(--color-text-secondary)]">
          {description}
        </p>
      </div>
      <select
        aria-label={title}
        className="min-w-40 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[13px] text-[var(--color-text-primary)] disabled:opacity-60"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function InitiativesSettingsPage() {
  const [settings, setSettings] = useState(defaultSettings);
  const [canManage, setCanManage] = useState(false);
  const [viewerRole, setViewerRole] = useState("member");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      try {
        const response = await fetch(
          "/api/workspaces/current/initiatives-settings",
        );
        if (!response.ok) throw new Error("Unable to load initiative settings");
        const data = (await response.json()) as SettingsResponse;
        if (!cancelled) {
          setSettings(data.initiativesSettings);
          setCanManage(data.canManage);
          setViewerRole(data.viewerRole);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load settings",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateSetting = useCallback(
    async (patch: Partial<WorkspaceInitiativeSettings>) => {
      const previous = settings;
      const next = { ...settings, ...patch };
      setSettings(next);
      setSaving(true);
      setMessage(null);
      setError(null);

      try {
        const response = await fetch(
          "/api/workspaces/current/initiatives-settings",
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          },
        );
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error ?? "Unable to save initiative settings");
        }
        setSettings(data.initiativesSettings);
        setMessage("Initiative settings saved");
      } catch (saveError) {
        setSettings(previous);
        setError(
          saveError instanceof Error
            ? saveError.message
            : "Unable to save settings",
        );
      } finally {
        setSaving(false);
      }
    },
    [settings],
  );

  const disabled = loading || saving || !canManage;

  return (
    <div className="max-w-[720px]">
      <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
        Initiatives
      </h1>
      <p className="mt-3 text-[14px] leading-6 text-[var(--color-text-secondary)]">
        Configure how your workspace uses initiatives to organize projects into
        strategic goals and track progress across teams.
      </p>

      <section className="mt-8 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">
            Feature settings
          </h2>
          <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
            Owners and admins can manage workspace initiative availability,
            roadmap surfacing, and progress rollups.
          </p>
          {!canManage && !loading ? (
            <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
              Your {viewerRole} role can view these settings but cannot change
              them.
            </p>
          ) : null}
        </div>
        <ToggleRow
          title="Workspace initiatives"
          description="Allow members to view and create workspace-level initiatives. Turning this off preserves existing records but disables new initiative creation."
          checked={settings.enabled}
          disabled={disabled}
          onChange={(enabled) => updateSetting({ enabled })}
        />
        <ToggleRow
          title="Project rollups"
          description="Show active project progress and update coverage rollups on initiative list and detail surfaces."
          checked={settings.projectRollups}
          disabled={disabled || !settings.enabled}
          onChange={(projectRollups) => updateSetting({ projectRollups })}
        />
        <SelectRow
          title="Workspace visibility"
          description="Choose whether initiatives are visible across the workspace or limited to their linked teams."
          value={settings.visibility}
          disabled={disabled || !settings.enabled}
          onChange={(visibility) =>
            updateSetting({
              visibility:
                visibility as WorkspaceInitiativeSettings["visibility"],
            })
          }
          options={[
            { value: "workspace", label: "Entire workspace" },
            { value: "teams", label: "Linked teams only" },
          ]}
        />
        <SelectRow
          title="Roadmap inclusion"
          description="Control whether initiatives automatically appear in roadmap planning views."
          value={settings.roadmapMode}
          disabled={disabled || !settings.enabled}
          onChange={(roadmapMode) =>
            updateSetting({
              roadmapMode:
                roadmapMode as WorkspaceInitiativeSettings["roadmapMode"],
            })
          }
          options={[
            { value: "all", label: "All initiatives" },
            { value: "selected", label: "Selected initiatives" },
          ]}
        />
      </section>

      <div aria-live="polite" className="mt-3 text-[13px]">
        {saving ? (
          <span className="text-[var(--color-text-secondary)]">Saving…</span>
        ) : null}
        {message ? <span className="text-green-600">{message}</span> : null}
        {error ? <span className="text-red-600">{error}</span> : null}
      </div>
    </div>
  );
}
