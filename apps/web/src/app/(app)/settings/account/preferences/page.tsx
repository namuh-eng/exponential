"use client";

import {
  type AccountPreferences,
  type AccountPreferencesPatch,
  DEFAULT_ACCOUNT_PREFERENCES,
  applyFontSizePreference,
  applyPointerCursorPreference,
  dispatchAccountPreferencesChanged,
  mergeAccountPreferences,
} from "@/lib/account-preferences";
import { type AppTheme, getStoredTheme, setThemePreference } from "@/lib/theme";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-[var(--color-border)] py-4 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
          {label}
        </div>
        {description && (
          <div className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
            {description}
          </div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
  "aria-label"?: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="min-w-[138px] rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-accent)]"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function Toggle({
  checked,
  onChange,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 rounded-full transition-colors ${
        checked ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
          checked ? "translate-x-4" : ""
        }`}
      />
    </button>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h2 className="mt-10 mb-4 text-[13px] font-semibold text-[var(--color-text-primary)]">
      {title}
    </h2>
  );
}

function ThemeCard({
  label,
  active,
  onClick,
  variant,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  variant: AppTheme;
}) {
  const backgroundClass =
    variant === "dark"
      ? "bg-[#111114]"
      : variant === "light"
        ? "bg-[#fcfcfd]"
        : "bg-gradient-to-r from-[#111114] to-[#fcfcfd]";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-[78px] flex-col items-center gap-2 rounded-xl border p-2 transition-colors ${
        active
          ? "border-[var(--color-accent)] bg-[var(--color-surface)]"
          : "border-[var(--color-border)] hover:border-[var(--color-text-tertiary)]"
      }`}
    >
      <div
        className={`flex h-[42px] w-full items-center justify-center rounded-md border border-[var(--color-border)] ${backgroundClass}`}
      >
        <span
          className={`text-[14px] font-medium ${
            variant === "dark" ? "text-white" : "text-[#23252a]"
          }`}
        >
          Aa
        </span>
      </div>
      <span className="text-[11px] text-[var(--color-text-secondary)]">
        {label}
      </span>
    </button>
  );
}

function SidebarCustomizeModal({
  preferences,
  onClose,
  onUpdate,
}: {
  preferences: AccountPreferences;
  onClose: () => void;
  onUpdate: (patch: AccountPreferencesPatch) => void;
}) {
  const visibilityOptions = [
    { label: "Always show", value: "show" },
    { label: "Don't show", value: "hide" },
  ];

  const sidebarItems: Array<{
    key: keyof AccountPreferences["sidebarVisibility"];
    label: string;
    group: "Personal" | "Workspace";
  }> = [
    { key: "inbox", label: "Inbox", group: "Personal" },
    { key: "myIssues", label: "My issues", group: "Personal" },
    { key: "projects", label: "Projects", group: "Workspace" },
    { key: "views", label: "Views", group: "Workspace" },
    { key: "initiatives", label: "Initiatives", group: "Workspace" },
    { key: "cycles", label: "Cycles", group: "Workspace" },
  ];

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <dialog
        open
        aria-label="Customize sidebar"
        className="w-full max-w-[520px] rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
              Customize sidebar
            </h3>
            <p className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
              Control visibility for the main navigation items and how unread
              badges are displayed.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close modal dialog"
            onClick={onClose}
            className="rounded-md p-1 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <SettingRow
            label="Default badge style"
            description="Choose whether inbox badges use a numeric count or a simple dot."
          >
            <Select
              aria-label="Default badge style"
              value={preferences.sidebarBadgeStyle}
              onChange={(value) =>
                onUpdate({
                  sidebarBadgeStyle:
                    value as AccountPreferences["sidebarBadgeStyle"],
                })
              }
              options={[
                { label: "Count", value: "count" },
                { label: "Dot", value: "dot" },
              ]}
            />
          </SettingRow>

          {["Personal", "Workspace"].map((group) => (
            <div key={group}>
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
                {group}
              </div>
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4">
                {sidebarItems
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <SettingRow
                      key={item.key}
                      label={item.label}
                      description={`Control whether ${item.label.toLowerCase()} appears in the sidebar.`}
                    >
                      <Select
                        aria-label={`${item.label} visibility`}
                        value={
                          preferences.sidebarVisibility[item.key]
                            ? "show"
                            : "hide"
                        }
                        onChange={(value) =>
                          onUpdate({
                            sidebarVisibility: {
                              [item.key]: value === "show",
                            } as Partial<
                              AccountPreferences["sidebarVisibility"]
                            >,
                          })
                        }
                        options={visibilityOptions}
                      />
                    </SettingRow>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </dialog>
    </div>
  );
}

export default function PreferencesPage() {
  const [preferences, setPreferences] = useState(DEFAULT_ACCOUNT_PREFERENCES);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [isSidebarModalOpen, setIsSidebarModalOpen] = useState(false);
  const saveRequestId = useRef(0);
  const saveStateTimeout = useRef<number | null>(null);
  const preferencesRef = useRef<AccountPreferences>(
    DEFAULT_ACCOUNT_PREFERENCES,
  );
  const pendingPersistPreferences = useRef<AccountPreferences | null>(null);

  useEffect(() => {
    preferencesRef.current = preferences;
    setThemePreference(preferences.theme);
    applyFontSizePreference(preferences.fontSize);
    applyPointerCursorPreference(preferences.pointerCursors);
    dispatchAccountPreferencesChanged(preferences);

    if (pendingPersistPreferences.current === preferences) {
      pendingPersistPreferences.current = null;
      void persistPreferences(preferences);
    }
  }, [preferences]);

  useEffect(() => {
    const initialTheme = getStoredTheme();
    const initialPreferences = mergeAccountPreferences(preferencesRef.current, {
      theme: initialTheme,
    });
    preferencesRef.current = initialPreferences;
    setPreferences(initialPreferences);
    applyFontSizePreference(DEFAULT_ACCOUNT_PREFERENCES.fontSize);
    applyPointerCursorPreference(DEFAULT_ACCOUNT_PREFERENCES.pointerCursors);

    let cancelled = false;

    void fetch("/api/account/preferences", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Failed to load account preferences");
        }

        return (await response.json()) as {
          accountPreferences?: Partial<AccountPreferences>;
        };
      })
      .then((data) => {
        if (cancelled || !data.accountPreferences) {
          return;
        }

        const nextPreferences = mergeAccountPreferences(
          DEFAULT_ACCOUNT_PREFERENCES,
          data.accountPreferences,
        );
        preferencesRef.current = nextPreferences;
        setPreferences(nextPreferences);
      })
      .catch(() => {
        setThemePreference(initialTheme);
      });

    return () => {
      cancelled = true;
      if (saveStateTimeout.current) {
        window.clearTimeout(saveStateTimeout.current);
      }
    };
  }, []);

  function updateSavedIndicator() {
    if (saveStateTimeout.current) {
      window.clearTimeout(saveStateTimeout.current);
    }

    saveStateTimeout.current = window.setTimeout(() => {
      setSaveState("idle");
      saveStateTimeout.current = null;
    }, 1500);
  }

  async function persistPreferences(nextPreferences: AccountPreferences) {
    const requestId = ++saveRequestId.current;
    setSaveState("saving");

    try {
      const response = await fetch("/api/account/preferences", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ accountPreferences: nextPreferences }),
      });

      if (!response.ok) {
        throw new Error("Failed to save account preferences");
      }

      const data = (await response.json()) as {
        accountPreferences?: Partial<AccountPreferences>;
      };

      if (requestId !== saveRequestId.current || !data.accountPreferences) {
        return;
      }

      const savedPreferences = mergeAccountPreferences(
        DEFAULT_ACCOUNT_PREFERENCES,
        data.accountPreferences,
      );
      preferencesRef.current = savedPreferences;
      setPreferences(savedPreferences);
      setSaveState("saved");
      updateSavedIndicator();
    } catch {
      if (requestId === saveRequestId.current) {
        setSaveState("error");
      }
    }
  }

  function updatePreferences(patch: AccountPreferencesPatch) {
    const nextPreferences = mergeAccountPreferences(
      preferencesRef.current,
      patch,
    );

    preferencesRef.current = nextPreferences;
    pendingPersistPreferences.current = nextPreferences;
    setPreferences(nextPreferences);
  }

  return (
    <>
      <div className="max-w-[820px]">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
              Preferences
            </h1>
          </div>
          <div className="text-[12px] text-[var(--color-text-secondary)]">
            {saveState === "saving" && "Saving…"}
            {saveState === "saved" && "Saved"}
            {saveState === "error" && "Save failed"}
          </div>
        </div>

        <SectionHeader title="General" />
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4">
          <SettingRow
            label="Default home view"
            description="Select which view to display when launching Linear."
          >
            <Select
              aria-label="Default home view"
              value={preferences.defaultHomeView}
              onChange={(value) =>
                updatePreferences({
                  defaultHomeView:
                    value as AccountPreferences["defaultHomeView"],
                })
              }
              options={[
                { label: "My Issues", value: "my-issues" },
                { label: "Inbox", value: "inbox" },
                { label: "Active Issues", value: "active-issues" },
              ]}
            />
          </SettingRow>

          <SettingRow
            label="Display names"
            description="Select how names are displayed in the interface."
          >
            <Select
              aria-label="Display names"
              value={preferences.displayNames}
              onChange={(value) =>
                updatePreferences({
                  displayNames: value as AccountPreferences["displayNames"],
                })
              }
              options={[
                { label: "Full name", value: "full" },
                { label: "First name", value: "first" },
              ]}
            />
          </SettingRow>

          <SettingRow
            label="First day of week"
            description="Used for date pickers."
          >
            <Select
              aria-label="First day of week"
              value={preferences.firstDayOfWeek}
              onChange={(value) =>
                updatePreferences({
                  firstDayOfWeek: value as AccountPreferences["firstDayOfWeek"],
                })
              }
              options={[
                { label: "Sunday", value: "sunday" },
                { label: "Monday", value: "monday" },
              ]}
            />
          </SettingRow>

          <SettingRow
            label="Convert text emoticons into emojis"
            description="Strings like :) will be converted automatically."
          >
            <Toggle
              aria-label="Convert text emoticons into emojis"
              checked={preferences.convertEmoticons}
              onChange={(value) =>
                updatePreferences({ convertEmoticons: value })
              }
            />
          </SettingRow>

          <SettingRow
            label="Send comment on…"
            description="Choose which key press is used to submit a comment."
          >
            <Select
              aria-label="Send comment on"
              value={preferences.sendCommentShortcut}
              onChange={(value) =>
                updatePreferences({
                  sendCommentShortcut:
                    value as AccountPreferences["sendCommentShortcut"],
                })
              }
              options={[
                { label: "⌘ + Enter", value: "cmd-enter" },
                { label: "Enter", value: "enter" },
              ]}
            />
          </SettingRow>
        </div>

        <SectionHeader title="Interface and theme" />
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4">
          <SettingRow
            label="App sidebar"
            description="Customize sidebar item visibility, ordering, and badge style."
          >
            <button
              type="button"
              aria-label="Customize sidebar"
              onClick={() => setIsSidebarModalOpen(true)}
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
            >
              Customize
            </button>
          </SettingRow>

          <SettingRow
            label="Font size"
            description="Adjust the size of text across the app."
          >
            <Select
              aria-label="Font size"
              value={preferences.fontSize}
              onChange={(value) =>
                updatePreferences({
                  fontSize: value as AccountPreferences["fontSize"],
                })
              }
              options={[
                { label: "Default", value: "default" },
                { label: "Small", value: "small" },
                { label: "Large", value: "large" },
              ]}
            />
          </SettingRow>

          <SettingRow
            label="Use pointer cursors"
            description="Change the cursor to a pointer when hovering over interactive elements."
          >
            <Toggle
              aria-label="Use pointer cursors"
              checked={preferences.pointerCursors}
              onChange={(value) => updatePreferences({ pointerCursors: value })}
            />
          </SettingRow>

          <div className="border-b border-[var(--color-border)] py-4">
            <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
              Interface theme
            </div>
            <div className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
              Select or customize your interface color scheme.
            </div>
            <div className="mt-4 flex gap-3">
              <ThemeCard
                label="System preference"
                variant="system"
                active={preferences.theme === "system"}
                onClick={() => updatePreferences({ theme: "system" })}
              />
              <ThemeCard
                label="Light"
                variant="light"
                active={preferences.theme === "light"}
                onClick={() => updatePreferences({ theme: "light" })}
              />
              <ThemeCard
                label="Dark"
                variant="dark"
                active={preferences.theme === "dark"}
                onClick={() => updatePreferences({ theme: "dark" })}
              />
            </div>
          </div>
        </div>

        <SectionHeader title="Automations" />
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4">
          <SettingRow
            label="Auto-assignment"
            description="When you create an unassigned issue, assign it to you before team-level assignment rules run."
          >
            <Select
              aria-label="Auto-assignment"
              value={preferences.automations.autoAssignment}
              onChange={(value) =>
                updatePreferences({
                  automations: {
                    autoAssignment:
                      value as AccountPreferences["automations"]["autoAssignment"],
                  },
                })
              }
              options={[
                { label: "Off", value: "off" },
                { label: "Assign new issues to me", value: "assign-to-me" },
              ]}
            />
          </SettingRow>

          <SettingRow
            label="Git branch format"
            description="Saved for branch copy/generation surfaces. No branch generator is currently available on this page."
          >
            <Select
              aria-label="Git branch format"
              value={preferences.automations.gitBranchFormat}
              onChange={(value) =>
                updatePreferences({
                  automations: {
                    gitBranchFormat:
                      value as AccountPreferences["automations"]["gitBranchFormat"],
                  },
                })
              }
              options={[
                { label: "ENG-123-short-title", value: "team-id-title" },
                {
                  label: "eng-123-short-title",
                  value: "team-id-lowercase-title",
                },
                {
                  label: "owner/ENG-123-short-title",
                  value: "owner/team-id-title",
                },
              ]}
            />
          </SettingRow>

          <SettingRow
            label="Status transitions"
            description="Saved preference for workflow automation. Existing status changes remain manual unless a focused workflow consumes it."
          >
            <Select
              aria-label="Status transitions"
              value={preferences.automations.statusTransitions}
              onChange={(value) =>
                updatePreferences({
                  automations: {
                    statusTransitions:
                      value as AccountPreferences["automations"]["statusTransitions"],
                  },
                })
              }
              options={[
                { label: "Manual", value: "manual" },
                { label: "Move to started", value: "started" },
                {
                  label: "Started and completed from activity",
                  value: "started-and-completed",
                },
              ]}
            />
          </SettingRow>
        </div>

        <SectionHeader title="Desktop application" />
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4">
          <SettingRow
            label="Open in desktop app"
            description="Automatically open links in desktop app when possible."
          >
            <Toggle
              aria-label="Open in desktop app"
              checked={preferences.openInDesktopApp}
              onChange={(value) =>
                updatePreferences({ openInDesktopApp: value })
              }
            />
          </SettingRow>
        </div>

        <SectionHeader title="Coding tools" />
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4">
          <SettingRow
            label="Configure coding tools"
            description="Review the agent personalization settings used by assisted coding flows."
          >
            <Link
              aria-label="Configure coding tools settings"
              href="/settings/account/agents"
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
            >
              Configure coding tools
            </Link>
          </SettingRow>
        </div>
      </div>

      {isSidebarModalOpen && (
        <SidebarCustomizeModal
          preferences={preferences}
          onClose={() => setIsSidebarModalOpen(false)}
          onUpdate={updatePreferences}
        />
      )}
    </>
  );
}
