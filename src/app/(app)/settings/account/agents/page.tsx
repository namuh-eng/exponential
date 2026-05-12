"use client";

import {
  ACCOUNT_PREFERENCES_CHANGE_EVENT,
  type AccountPreferences,
  DEFAULT_ACCOUNT_PREFERENCES,
  mergeAccountPreferences,
} from "@/lib/account-preferences";
import { useEffect, useState } from "react";

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

export default function AgentPersonalizationPage() {
  const [preferences, setPreferences] = useState<AccountPreferences>(
    DEFAULT_ACCOUNT_PREFERENCES,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/account/preferences")
      .then((res) => res.json())
      .then((data) => {
        if (data.accountPreferences) {
          setPreferences(
            mergeAccountPreferences(
              DEFAULT_ACCOUNT_PREFERENCES,
              data.accountPreferences,
            ),
          );
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(
    patch: Partial<AccountPreferences["agentPersonalization"]>,
  ) {
    setSaving(true);
    setSaveMessage(null);

    const nextPreferences = mergeAccountPreferences(preferences, {
      agentPersonalization: patch,
    });

    try {
      const res = await fetch("/api/account/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountPreferences: {
            agentPersonalization: patch,
          },
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to save agent preferences");
      }

      setPreferences(nextPreferences);
      setSaveMessage("Preferences saved");

      window.dispatchEvent(
        new CustomEvent(ACCOUNT_PREFERENCES_CHANGE_EVENT, {
          detail: nextPreferences,
        }),
      );
    } catch (error) {
      setSaveMessage("Failed to update preferences");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Loading...
      </div>
    );
  }

  const { instructions, autoFix } = preferences.agentPersonalization;

  return (
    <div className="max-w-[720px]">
      <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
        Agent personalization
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Configure the coding and agent assistance defaults used throughout the
        workspace.
      </p>

      <div className="mt-8 space-y-6">
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <h2 className="text-[15px] font-medium text-[var(--color-text-primary)]">
            Custom instructions
          </h2>
          <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
            These instructions will be shared with AI agents to guide how they
            interact with you and your code.
          </p>
          <textarea
            value={instructions}
            onChange={(e) =>
              setPreferences((curr) => ({
                ...curr,
                agentPersonalization: {
                  ...curr.agentPersonalization,
                  instructions: e.target.value,
                },
              }))
            }
            onBlur={() => handleSave({ instructions })}
            className="mt-4 h-32 w-full rounded-md border border-[var(--color-border)] bg-transparent p-3 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            placeholder="e.g. Prefer functional programming patterns, always use Tailwind for styling..."
          />
        </div>

        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <h2 className="text-[15px] font-medium text-[var(--color-text-primary)]">
            Assisted workflows
          </h2>
          <div className="mt-4 flex items-center justify-between">
            <div>
              <div className="text-[13px] text-[var(--color-text-primary)]">
                Automatically fix linting and type errors
              </div>
              <div className="text-[12px] text-[var(--color-text-secondary)]">
                Agents will proactively suggest and apply fixes for common
                errors
              </div>
            </div>
            <Toggle
              enabled={autoFix}
              onChange={(v) => handleSave({ autoFix: v })}
              label="Automatically fix linting and type errors"
            />
          </div>
        </div>
      </div>

      {saveMessage && (
        <p className="mt-4 text-[12px] text-[var(--color-text-secondary)]">
          {saveMessage}
        </p>
      )}
    </div>
  );
}
