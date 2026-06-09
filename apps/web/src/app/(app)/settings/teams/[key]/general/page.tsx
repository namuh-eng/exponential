"use client";

import { type TimezoneOption, buildTimezoneOptions } from "@/lib/timezones";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface TeamGeneralData {
  name: string;
  key: string;
  icon: string;
  timezone: string;
  estimateType: string;
  emailEnabled: boolean;
  inboundEmailAddress?: string;
  detailedHistory: boolean;
  cyclesEnabled: boolean;
  cycleStartDay: number;
  cycleDurationWeeks: number;
}

const EMOJI_OPTIONS = [
  "🔧",
  "🚀",
  "⚡",
  "🧪",
  "📦",
  "🎯",
  "🛰️",
  "🛠️",
  "📱",
  "🌐",
  "🎨",
  "📈",
];

const ESTIMATE_OPTIONS = [
  { value: "none", label: "Not in use" },
  { value: "linear", label: "Linear (1, 2, 3, 4, ...)" },
  { value: "exponential", label: "Exponential (1, 2, 4, 8, ...)" },
  { value: "tshirt", label: "T-shirt (XS, S, M, L, XL)" },
];

const CYCLE_START_DAY_OPTIONS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 7, label: "Sunday" },
];

const CYCLE_DURATION_OPTIONS = [
  { value: 1, label: "1 week" },
  { value: 2, label: "2 weeks" },
  { value: 3, label: "3 weeks" },
  { value: 4, label: "4 weeks" },
  { value: 6, label: "6 weeks" },
  { value: 8, label: "8 weeks" },
];

function Toggle({
  enabled,
  onChange,
  label,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-[20px] w-[36px] shrink-0 cursor-pointer items-center rounded-full transition-colors ${
        enabled ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]"
      }`}
    >
      <span
        className={`inline-block h-[16px] w-[16px] rounded-full bg-white shadow transition-transform ${
          enabled ? "translate-x-[18px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}

function SectionHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-4 mt-8">
      <h2 className="text-[14px] font-semibold text-[var(--color-text-primary)]">
        {title}
      </h2>
      {description && (
        <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
          {description}
        </p>
      )}
    </div>
  );
}

function normalizeIconValue(value: string) {
  const normalized = Array.from(value.trim()).slice(0, 2).join("");
  return normalized || "•";
}

export default function TeamGeneralSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const teamKey = params.key as string;
  const [team, setTeam] = useState<TeamGeneralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("•");
  const [identifier, setIdentifier] = useState("");
  const [timezone, setTimezone] = useState("America/Los_Angeles");
  const [estimateType, setEstimateType] = useState("none");
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [inboundEmailAddress, setInboundEmailAddress] = useState("");
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [detailedHistory, setDetailedHistory] = useState(false);
  const [cyclesEnabled, setCyclesEnabled] = useState(false);
  const [cycleStartDay, setCycleStartDay] = useState(1);
  const [cycleDurationWeeks, setCycleDurationWeeks] = useState(2);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [customIcon, setCustomIcon] = useState("");
  const [timezoneInput, setTimezoneInput] = useState("");
  const [timezoneOptions] = useState<TimezoneOption[]>(() =>
    buildTimezoneOptions(),
  );

  useEffect(() => {
    fetch(`/api/teams/${teamKey}/settings`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error("Failed to load team settings");
        }

        return res.json();
      })
      .then((data) => {
        const t = data.team as TeamGeneralData;
        setTeam(t);
        setName(t.name);
        setIcon(t.icon || "•");
        setCustomIcon(t.icon || "•");
        setIdentifier(t.key);
        setTimezone(t.timezone || "America/Los_Angeles");
        setEstimateType(t.estimateType || "none");
        setEmailEnabled(t.emailEnabled || false);
        setInboundEmailAddress(t.inboundEmailAddress || "");
        setDetailedHistory(t.detailedHistory || false);
        setCyclesEnabled(t.cyclesEnabled || false);
        setCycleStartDay(t.cycleStartDay || 1);
        setCycleDurationWeeks(t.cycleDurationWeeks || 2);
      })
      .catch(() => setTeam(null))
      .finally(() => setLoading(false));
  }, [teamKey]);

  useEffect(() => {
    const currentTimezone =
      timezoneOptions.find(
        (timezoneOption) => timezoneOption.value === timezone,
      ) ?? null;
    setTimezoneInput(
      currentTimezone
        ? `${currentTimezone.label} (${currentTimezone.value})`
        : timezone,
    );
  }, [timezone, timezoneOptions]);

  async function handleSave() {
    setSaving(true);
    setSaveMessage(null);

    try {
      const res = await fetch(`/api/teams/${teamKey}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          icon,
          key: identifier,
          timezone,
          estimateType,
          emailEnabled,
          detailedHistory,
          cyclesEnabled,
          cycleStartDay,
          cycleDurationWeeks,
        }),
      });

      const data = (await res.json().catch(() => null)) as {
        error?: string;
        team?: TeamGeneralData;
      } | null;

      if (!res.ok || !data?.team) {
        throw new Error(data?.error || "Failed to save team settings");
      }

      setTeam(data.team);
      setName(data.team.name);
      setIcon(data.team.icon || "•");
      setCustomIcon(data.team.icon || "•");
      setIdentifier(data.team.key);
      setTimezone(data.team.timezone || "America/Los_Angeles");
      setEstimateType(data.team.estimateType || "none");
      setEmailEnabled(data.team.emailEnabled || false);
      setInboundEmailAddress(data.team.inboundEmailAddress || "");
      setDetailedHistory(data.team.detailedHistory || false);
      setCyclesEnabled(data.team.cyclesEnabled || false);
      setCycleStartDay(data.team.cycleStartDay || 1);
      setCycleDurationWeeks(data.team.cycleDurationWeeks || 2);
      setSaveMessage("Changes saved");

      if (teamKey !== data.team.key) {
        router.replace(
          `/settings/teams/${encodeURIComponent(data.team.key)}/general`,
        );
      }
    } catch (error) {
      setSaveMessage(
        error instanceof Error ? error.message : "Failed to save team settings",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyInboundEmail() {
    if (!inboundEmailAddress) {
      return;
    }

    try {
      await navigator.clipboard?.writeText(inboundEmailAddress);
      setCopyMessage("Copied");
    } catch {
      setCopyMessage("Copy unavailable");
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Loading...
      </div>
    );
  }

  if (!team) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Team not found
      </div>
    );
  }

  const selectedTimezone =
    timezoneOptions.find((tz) => tz.value === timezone) ?? null;

  return (
    <div className="max-w-[720px]">
      <h1 className="mb-6 text-[20px] font-semibold text-[var(--color-text-primary)]">
        General
      </h1>

      {/* ─── Icon & Name ──────────────────────────────────── */}
      <div className="rounded-lg border border-[var(--color-border)] p-4">
        <div className="mb-3 text-[13px] font-medium text-[var(--color-text-secondary)]">
          Icon & Name
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <button
              type="button"
              aria-label="Change team icon"
              aria-expanded={iconPickerOpen}
              aria-haspopup="dialog"
              onClick={() => {
                setCustomIcon(icon);
                setIconPickerOpen((current) => !current);
              }}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--color-border)] text-[20px] hover:bg-[var(--color-surface-hover)]"
            >
              {icon}
            </button>
            {iconPickerOpen && (
              <dialog
                open
                aria-label="Team icon picker"
                className="absolute left-0 top-12 z-20 w-[220px] rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-3 shadow-lg"
              >
                <div className="mb-2 text-[12px] font-medium text-[var(--color-text-secondary)]">
                  Choose an icon
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {EMOJI_OPTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      aria-label={`Choose ${emoji} icon`}
                      onClick={() => {
                        setIcon(emoji);
                        setCustomIcon(emoji);
                        setIconPickerOpen(false);
                      }}
                      className={`flex h-10 items-center justify-center rounded-md border text-[18px] transition-colors ${
                        icon === emoji
                          ? "border-[var(--color-accent)] bg-[var(--color-surface-hover)]"
                          : "border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
                <label className="mt-3 flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
                  <span>Custom icon</span>
                  <div className="flex gap-2">
                    <input
                      aria-label="Custom team icon"
                      type="text"
                      value={customIcon}
                      onChange={(event) =>
                        setCustomIcon(normalizeIconValue(event.target.value))
                      }
                      className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setIcon(normalizeIconValue(customIcon));
                        setIconPickerOpen(false);
                      }}
                      className="rounded-md border border-[var(--color-border)] px-3 py-2 text-[12px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
                    >
                      Apply
                    </button>
                  </div>
                </label>
              </dialog>
            )}
          </div>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
          />
        </div>

        <div className="mt-4">
          <div className="mb-1 text-[13px] font-medium text-[var(--color-text-secondary)]">
            Identifier
          </div>
          <div className="mb-2 text-[12px] text-[var(--color-text-tertiary)]">
            Used in issue IDs
          </div>
          <input
            type="text"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value.toUpperCase())}
            className="w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
          />
        </div>
      </div>

      {/* ─── Timezone ─────────────────────────────────────── */}
      <SectionHeader
        title="Timezone"
        description="The timezone should be set as the location where most of your team members reside. All other times referenced by the team will be relative to this timezone setting. For example, if the team uses cycles, each cycle will start at midnight in the specified timezone."
      />

      <div className="rounded-lg border border-[var(--color-border)] p-4">
        <div className="flex items-center justify-between gap-4">
          <span className="text-[13px] text-[var(--color-text-primary)]">
            Timezone
          </span>
          <input
            list="team-timezone-options"
            aria-label="Timezone"
            value={timezoneInput}
            onChange={(event) => {
              const nextValue = event.target.value;
              setTimezoneInput(nextValue);

              const matchingTimezone = timezoneOptions.find(
                (timezoneOption) =>
                  timezoneOption.value === nextValue ||
                  timezoneOption.label === nextValue ||
                  `${timezoneOption.label} (${timezoneOption.value})` ===
                    nextValue,
              );

              if (matchingTimezone) {
                setTimezone(matchingTimezone.value);
              }
            }}
            onBlur={() => {
              const matchingTimezone = timezoneOptions.find(
                (timezoneOption) =>
                  timezoneOption.value === timezoneInput ||
                  timezoneOption.label === timezoneInput ||
                  `${timezoneOption.label} (${timezoneOption.value})` ===
                    timezoneInput,
              );

              setTimezoneInput(
                matchingTimezone
                  ? `${matchingTimezone.label} (${matchingTimezone.value})`
                  : selectedTimezone
                    ? `${selectedTimezone.label} (${selectedTimezone.value})`
                    : timezone,
              );
            }}
            placeholder="Search by city or timezone"
            className="min-w-[320px] rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] outline-none"
          />
          <datalist id="team-timezone-options">
            {timezoneOptions.map((timezoneOption) => (
              <option
                key={timezoneOption.value}
                value={`${timezoneOption.label} (${timezoneOption.value})`}
              />
            ))}
          </datalist>
        </div>
        {selectedTimezone && (
          <div className="mt-1 text-right text-[11px] text-[var(--color-text-tertiary)]">
            {selectedTimezone.value}
          </div>
        )}
      </div>

      {/* ─── Estimates ────────────────────────────────────── */}
      <SectionHeader
        title="Estimates"
        description="Estimates are a great way of communicating the complexity of each issue or to calculate whether a cycle has more room left. Below you can choose how your team estimates issue complexity."
      />

      <div className="rounded-lg border border-[var(--color-border)] p-4">
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-[var(--color-text-primary)]">
            Issue estimation
          </span>
          <select
            value={estimateType}
            onChange={(e) => setEstimateType(e.target.value)}
            className="rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] outline-none"
          >
            {ESTIMATE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <SectionHeader
        title="Cycles"
        description="Configure the cadence your team uses for iterative planning. These settings determine the default start day and duration for new cycles."
      />

      <div className="rounded-lg border border-[var(--color-border)] p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] text-[var(--color-text-primary)]">
              Enable cycles
            </div>
            <div className="mt-0.5 text-[12px] text-[var(--color-text-tertiary)]">
              Turn on automated cycle planning for this team
            </div>
          </div>
          <Toggle
            enabled={cyclesEnabled}
            onChange={setCyclesEnabled}
            label="Enable cycles"
          />
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
            <span>Starts on</span>
            <select
              aria-label="Cycle start day"
              value={String(cycleStartDay)}
              onChange={(e) => setCycleStartDay(Number(e.target.value))}
              disabled={!cyclesEnabled}
              className="rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {CYCLE_START_DAY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
            <span>Length</span>
            <select
              aria-label="Cycle duration"
              value={String(cycleDurationWeeks)}
              onChange={(e) => setCycleDurationWeeks(Number(e.target.value))}
              disabled={!cyclesEnabled}
              className="rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {CYCLE_DURATION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* ─── Create issues by email ───────────────────────── */}
      <SectionHeader title="Create issues by email" />

      <div className="rounded-lg border border-[var(--color-border)] p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] text-[var(--color-text-primary)]">
              Create issues by email
            </div>
            <div className="mt-0.5 text-[12px] text-[var(--color-text-tertiary)]">
              Allow creating issues by sending emails to a team-specific address
            </div>
          </div>
          <Toggle
            enabled={emailEnabled}
            onChange={setEmailEnabled}
            label="Create issues by email"
          />
        </div>
        {emailEnabled && (
          <div className="mt-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12px] text-[var(--color-text-tertiary)]">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[var(--color-text-secondary)]">
                {inboundEmailAddress ||
                  `${identifier.toLowerCase()}@team.exponential.app`}
              </span>
              <button
                type="button"
                onClick={handleCopyInboundEmail}
                className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
              >
                Copy
              </button>
            </div>
            <div className="mt-2">
              Emails sent to this address create issues in this team while the
              setting is enabled.
              {copyMessage && <span className="ml-2">{copyMessage}</span>}
            </div>
          </div>
        )}
      </div>

      {/* ─── Other ────────────────────────────────────────── */}
      <SectionHeader title="Other" />

      <div className="rounded-lg border border-[var(--color-border)] p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] text-[var(--color-text-primary)]">
              Enable detailed issue history
            </div>
            <div className="mt-0.5 text-[12px] text-[var(--color-text-tertiary)]">
              Track all changes to issues with audit-level detail
            </div>
          </div>
          <Toggle
            enabled={detailedHistory}
            onChange={setDetailedHistory}
            label="Enable detailed issue history"
          />
        </div>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-[var(--color-accent)] px-3 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
        {saveMessage && (
          <span className="text-[12px] text-[var(--color-text-secondary)]">
            {saveMessage}
          </span>
        )}
      </div>
    </div>
  );
}
