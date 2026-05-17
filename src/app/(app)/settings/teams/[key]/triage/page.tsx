"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

interface TriageDestinationState {
  id: string;
  name: string;
  category: string;
}

interface TeamTriageData {
  name: string;
  triageEnabled: boolean;
  triageAcceptDestinationStateId: string | null;
  triageDeclineDestinationStateId: string | null;
  acceptDestinationStates: TriageDestinationState[];
  declineDestinationStates: TriageDestinationState[];
}

function Toggle({
  enabled,
  onChange,
  label,
  disabled,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-[20px] w-[36px] shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
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

export default function TeamTriageSettingsPage() {
  const params = useParams();
  const teamKey = params.key as string;
  const [team, setTeam] = useState<TeamTriageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [triageEnabled, setTriageEnabled] = useState(true);
  const [acceptDestinationStateId, setAcceptDestinationStateId] = useState("");
  const [declineDestinationStateId, setDeclineDestinationStateId] =
    useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/teams/${teamKey}/settings`)
      .then((res) => res.json())
      .then((data) => {
        setTeam(data.team);
        if (data.team) {
          setTriageEnabled(data.team.triageEnabled);
          setAcceptDestinationStateId(
            data.team.triageAcceptDestinationStateId ??
              data.team.acceptDestinationStates?.[0]?.id ??
              "",
          );
          setDeclineDestinationStateId(
            data.team.triageDeclineDestinationStateId ??
              data.team.declineDestinationStates?.[0]?.id ??
              "",
          );
        }
      })
      .finally(() => setLoading(false));
  }, [teamKey]);

  async function saveTriageSettings(nextSettings: {
    triageEnabled?: boolean;
    triageAcceptDestinationStateId?: string | null;
    triageDeclineDestinationStateId?: string | null;
  }) {
    setSaving(true);
    setSaveMessage(null);

    try {
      const res = await fetch(`/api/teams/${teamKey}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextSettings),
      });

      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.team) {
        throw new Error("Failed to save triage settings");
      }

      setTeam(payload.team);
      setTriageEnabled(payload.team.triageEnabled);
      setAcceptDestinationStateId(
        payload.team.triageAcceptDestinationStateId ??
          payload.team.acceptDestinationStates?.[0]?.id ??
          "",
      );
      setDeclineDestinationStateId(
        payload.team.triageDeclineDestinationStateId ??
          payload.team.declineDestinationStates?.[0]?.id ??
          "",
      );
      setSaveMessage("Triage settings updated");
    } catch (_error) {
      setSaveMessage("Failed to update triage settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleTriageEnabledChange(nextEnabled: boolean) {
    setTriageEnabled(nextEnabled);
    await saveTriageSettings({ triageEnabled: nextEnabled });
  }

  async function handleAcceptDestinationChange(destinationStateId: string) {
    setAcceptDestinationStateId(destinationStateId);
    await saveTriageSettings({
      triageAcceptDestinationStateId: destinationStateId || null,
    });
  }

  async function handleDeclineDestinationChange(destinationStateId: string) {
    setDeclineDestinationStateId(destinationStateId);
    await saveTriageSettings({
      triageDeclineDestinationStateId: destinationStateId || null,
    });
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

  return (
    <div className="max-w-[720px]">
      <div className="mb-6">
        <Link
          href={`/settings/teams/${encodeURIComponent(teamKey)}`}
          className="text-[12px] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          Back to team settings
        </Link>
      </div>

      <h1 className="text-[20px] font-semibold text-[var(--color-text-primary)]">
        Triage
      </h1>
      <p className="mt-2 text-[13px] text-[var(--color-text-tertiary)]">
        Configure intake review and where accepted or declined issues go when
        they leave triage.
      </p>

      <div className="mt-8 rounded-lg border border-[var(--color-border)] p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] text-[var(--color-text-primary)]">
              Enable intake review
            </div>
            <div className="mt-0.5 text-[12px] text-[var(--color-text-tertiary)]">
              Issues created by others will appear in Triage first
            </div>
          </div>
          <Toggle
            enabled={triageEnabled}
            onChange={handleTriageEnabledChange}
            label="Enable triage"
            disabled={saving}
          />
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-[var(--color-border)] p-4">
        <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
          Decision defaults
        </div>
        <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
          These statuses are preselected for triage decisions and used by the
          API when a decision omits an explicit destination.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-[12px] font-medium text-[var(--color-text-secondary)]">
            Default accept destination
            <select
              aria-label="Default accept destination"
              value={acceptDestinationStateId}
              disabled={saving || team.acceptDestinationStates.length === 0}
              onChange={(event) =>
                void handleAcceptDestinationChange(event.target.value)
              }
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-60"
            >
              {team.acceptDestinationStates.length === 0 ? (
                <option value="">No accept destinations available</option>
              ) : null}
              {team.acceptDestinationStates.map((state) => (
                <option key={state.id} value={state.id}>
                  {state.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-[12px] font-medium text-[var(--color-text-secondary)]">
            Default decline destination
            <select
              aria-label="Default decline destination"
              value={declineDestinationStateId}
              disabled={saving || team.declineDestinationStates.length === 0}
              onChange={(event) =>
                void handleDeclineDestinationChange(event.target.value)
              }
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-60"
            >
              {team.declineDestinationStates.length === 0 ? (
                <option value="">No decline destinations available</option>
              ) : null}
              {team.declineDestinationStates.map((state) => (
                <option key={state.id} value={state.id}>
                  {state.name}
                </option>
              ))}
            </select>
          </label>
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
