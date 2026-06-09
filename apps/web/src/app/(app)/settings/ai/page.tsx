"use client";

import { useEffect, useMemo, useState } from "react";

interface TeamCompletedStat {
  teamId: string;
  teamName: string;
  completedCount: number;
}

interface TeamActiveStat {
  teamId: string;
  teamName: string;
  activeCount: number;
}

interface WorkspaceAnalytics {
  workspaceId: string;
  completedLast30Days: TeamCompletedStat[];
  activeIssues: TeamActiveStat[];
  period: string;
}

type PermissionLevel = "admins" | "members" | "anyone";

interface WorkspaceAiSettings {
  aiFeaturesEnabled: boolean;
  askLinearEnabled: boolean;
  issueSuggestionsEnabled: boolean;
  summariesEnabled: boolean;
  autoTriageEnabled: boolean;
  workspaceAgentGuidance: string;
  agentUsagePermission: PermissionLevel;
}

interface AiSettingsResponse {
  aiSettings: WorkspaceAiSettings;
  capabilities: {
    canManageAiSettings: boolean;
    canUseAgents: boolean;
  };
  limits: {
    workspaceAgentGuidanceMaxLength: number;
  };
  error?: string;
}

const DEFAULT_GUIDANCE_LIMIT = 4000;

function StatCard({
  title,
  value,
  unit,
}: { title: string; value: number; unit?: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="text-[12px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
        {title}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-[28px] font-semibold text-[var(--color-text-primary)]">
          {value}
        </span>
        {unit && (
          <span className="text-[13px] text-[var(--color-text-secondary)]">
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

function ToggleField({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-content-bg)] p-4">
      <span>
        <span className="block text-[14px] font-medium text-[var(--color-text-primary)]">
          {label}
        </span>
        <span className="mt-1 block text-[13px] leading-5 text-[var(--color-text-secondary)]">
          {description}
        </span>
      </span>
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-text-primary)] disabled:opacity-50"
      />
    </label>
  );
}

export default function AISettingsPage() {
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState<WorkspaceAnalytics | null>(null);
  const [settings, setSettings] = useState<WorkspaceAiSettings | null>(null);
  const [savedSettings, setSavedSettings] =
    useState<WorkspaceAiSettings | null>(null);
  const [canManageAiSettings, setCanManageAiSettings] = useState(false);
  const [guidanceLimit, setGuidanceLimit] = useState(DEFAULT_GUIDANCE_LIMIT);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadPageData() {
      setLoading(true);
      setErrorMessage(null);
      const [settingsResult, analyticsResult] = await Promise.allSettled([
        fetch("/api/workspaces/current/ai-settings", {
          credentials: "include",
        }).then(async (res) => {
          const payload = (await res
            .json()
            .catch(() => null)) as AiSettingsResponse | null;
          if (!res.ok || !payload?.aiSettings) {
            throw new Error(payload?.error ?? "Failed to load AI settings");
          }
          return payload;
        }),
        fetch("/api/analytics/workspace", { credentials: "include" }).then(
          async (res) => {
            if (!res.ok) {
              throw new Error("Failed to load analytics");
            }
            return (await res.json()) as WorkspaceAnalytics;
          },
        ),
      ]);

      if (!active) {
        return;
      }

      if (settingsResult.status === "fulfilled") {
        setSettings(settingsResult.value.aiSettings);
        setSavedSettings(settingsResult.value.aiSettings);
        setCanManageAiSettings(
          settingsResult.value.capabilities.canManageAiSettings,
        );
        setGuidanceLimit(
          settingsResult.value.limits.workspaceAgentGuidanceMaxLength,
        );
      } else {
        setErrorMessage(settingsResult.reason.message);
      }

      if (analyticsResult.status === "fulfilled") {
        setAnalytics(analyticsResult.value);
      } else {
        setErrorMessage((current) =>
          current
            ? `${current} Workspace usage could not be loaded.`
            : "Unable to load workspace analytics.",
        );
      }

      setLoading(false);
    }

    void loadPageData();
    return () => {
      active = false;
    };
  }, []);

  const hasUnsavedChanges = useMemo(
    () => JSON.stringify(settings) !== JSON.stringify(savedSettings),
    [settings, savedSettings],
  );

  if (loading) {
    return (
      <div className="p-8 text-[var(--color-text-tertiary)]">Loading...</div>
    );
  }

  const totalCompleted =
    analytics?.completedLast30Days.reduce(
      (acc, curr) => acc + curr.completedCount,
      0,
    ) ?? 0;
  const totalActive =
    analytics?.activeIssues.reduce((acc, curr) => acc + curr.activeCount, 0) ??
    0;

  function updateSettings(patch: Partial<WorkspaceAiSettings>) {
    setSaveMessage(null);
    setSettings((current) => (current ? { ...current, ...patch } : current));
  }

  async function saveSettings() {
    if (!settings) {
      return;
    }

    setSaving(true);
    setErrorMessage(null);
    setSaveMessage(null);
    try {
      const response = await fetch("/api/workspaces/current/ai-settings", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiSettings: settings }),
      });
      const payload = (await response
        .json()
        .catch(() => null)) as AiSettingsResponse | null;
      if (!response.ok || !payload?.aiSettings) {
        throw new Error(payload?.error ?? "Unable to save AI settings");
      }
      setSettings(payload.aiSettings);
      setSavedSettings(payload.aiSettings);
      setCanManageAiSettings(payload.capabilities.canManageAiSettings);
      setSaveMessage("Workspace AI settings saved.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to save AI settings",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-[860px] pb-10">
      <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
        AI & Agents
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Configure workspace-wide AI features, agent access, and guidance. Usage
        analytics remain below the controls.
      </p>

      {errorMessage && (
        <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-[13px] text-red-700 dark:text-red-300">
          {errorMessage}
        </p>
      )}
      {saveMessage && (
        <p className="mt-4 rounded-md border border-green-500/30 bg-green-500/10 p-3 text-[13px] text-green-700 dark:text-green-300">
          {saveMessage}
        </p>
      )}

      {settings && (
        <section className="mt-8 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-[18px] font-semibold text-[var(--color-text-primary)]">
                Workspace AI controls
              </h2>
              <p className="mt-1 text-[13px] leading-5 text-[var(--color-text-secondary)]">
                These settings apply to the active workspace and are enforced by
                agent run entry points.
              </p>
            </div>
            {!canManageAiSettings && (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[12px] text-amber-700 dark:text-amber-300">
                Admin-only editing
              </span>
            )}
          </div>

          <div className="mt-5 space-y-3">
            <ToggleField
              label="Enable AI and agent features"
              description="Controls whether workspace users can start agent runs or use workspace AI features."
              checked={settings.aiFeaturesEnabled}
              disabled={!canManageAiSettings || saving}
              onChange={(aiFeaturesEnabled) =>
                updateSettings({ aiFeaturesEnabled })
              }
            />
            <ToggleField
              label="Ask exponential assistant"
              description="Allow the assistant surface to use workspace context for answers."
              checked={settings.askLinearEnabled}
              disabled={!canManageAiSettings || saving}
              onChange={(askLinearEnabled) =>
                updateSettings({ askLinearEnabled })
              }
            />
            <ToggleField
              label="Issue suggestions and summaries"
              description="Generate issue suggestions, summaries, and triage hints from workspace data."
              checked={
                settings.issueSuggestionsEnabled && settings.summariesEnabled
              }
              disabled={!canManageAiSettings || saving}
              onChange={(enabled) =>
                updateSettings({
                  issueSuggestionsEnabled: enabled,
                  summariesEnabled: enabled,
                })
              }
            />
            <ToggleField
              label="Auto-triage suggestions"
              description="Let agents prepare triage recommendations for new workspace issues."
              checked={settings.autoTriageEnabled}
              disabled={!canManageAiSettings || saving}
              onChange={(autoTriageEnabled) =>
                updateSettings({ autoTriageEnabled })
              }
            />
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-[240px_1fr]">
            <label className="block text-[13px] font-medium text-[var(--color-text-secondary)]">
              Who can use agents
              <select
                aria-label="Who can use agents"
                value={settings.agentUsagePermission}
                disabled={!canManageAiSettings || saving}
                onChange={(event) =>
                  updateSettings({
                    agentUsagePermission: event.target.value as PermissionLevel,
                  })
                }
                className="mt-2 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none disabled:opacity-60"
              >
                <option value="admins">Admins only</option>
                <option value="members">Workspace members</option>
                <option value="anyone">Anyone except guests</option>
              </select>
            </label>

            <label className="block text-[13px] font-medium text-[var(--color-text-secondary)]">
              Workspace agent guidance
              <textarea
                aria-label="Workspace agent guidance"
                value={settings.workspaceAgentGuidance}
                maxLength={guidanceLimit}
                disabled={!canManageAiSettings || saving}
                onChange={(event) =>
                  updateSettings({ workspaceAgentGuidance: event.target.value })
                }
                className="mt-2 min-h-[132px] w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] leading-5 text-[var(--color-text-primary)] outline-none disabled:opacity-60"
                placeholder="Add workspace-wide policies, data handling rules, or escalation guidance for AI agents."
              />
              <span className="mt-1 block text-[12px] text-[var(--color-text-tertiary)]">
                {settings.workspaceAgentGuidance.length}/{guidanceLimit}{" "}
                characters
              </span>
            </label>
          </div>

          <div className="mt-5 flex items-center justify-between gap-3 border-t border-[var(--color-border)] pt-4">
            <p className="text-[12px] text-[var(--color-text-tertiary)]">
              {canManageAiSettings
                ? "Changes persist to the active workspace."
                : "Only workspace owners and admins can modify these settings."}
            </p>
            <button
              type="button"
              disabled={!canManageAiSettings || saving || !hasUnsavedChanges}
              onClick={() => void saveSettings()}
              className="rounded-md bg-[var(--color-text-primary)] px-4 py-2 text-[13px] font-medium text-[var(--color-content-bg)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-[18px] font-semibold text-[var(--color-text-primary)]">
          Usage
        </h2>
        <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
          Workspace activity is secondary to configuration and remains
          read-only.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StatCard
            title="Issues Completed"
            value={totalCompleted}
            unit="last 30 days"
          />
          <StatCard
            title="Active Issues"
            value={totalActive}
            unit="across all teams"
          />
        </div>
      </section>

      <div className="mt-10">
        <h3 className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
          Team Activity
        </h3>
        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-hover)]">
                <th className="px-5 py-3 font-medium text-[var(--color-text-secondary)]">
                  Team
                </th>
                <th className="px-5 py-3 font-medium text-[var(--color-text-secondary)]">
                  Active
                </th>
                <th className="px-5 py-3 font-medium text-[var(--color-text-secondary)]">
                  Completed (30d)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {analytics?.activeIssues.map((team) => {
                const completed =
                  analytics.completedLast30Days.find(
                    (c) => c.teamId === team.teamId,
                  )?.completedCount ?? 0;
                return (
                  <tr
                    key={team.teamId}
                    className="hover:bg-[var(--color-surface-hover)]"
                  >
                    <td className="px-5 py-3 font-medium text-[var(--color-text-primary)]">
                      {team.teamName}
                    </td>
                    <td className="px-5 py-3 text-[var(--color-text-secondary)]">
                      {team.activeCount}
                    </td>
                    <td className="px-5 py-3 text-[var(--color-text-secondary)]">
                      {completed}
                    </td>
                  </tr>
                );
              })}
              {analytics?.activeIssues.length === 0 && (
                <tr>
                  <td
                    colSpan={3}
                    className="px-5 py-8 text-center text-[var(--color-text-tertiary)]"
                  >
                    No team activity found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
