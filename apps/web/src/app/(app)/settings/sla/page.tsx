"use client";

import { EmptyState } from "@/components/empty-state";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";

type SlaPolicy = {
  id: string;
  name: string;
  description: string | null;
  responseTimeHours: number;
  resolutionTimeHours: number;
  enabled: boolean;
  conditions: { priority?: string; teamKey?: string };
};

type FormState = {
  id?: string;
  name: string;
  description: string;
  responseTimeHours: string;
  resolutionTimeHours: string;
  priority: string;
  teamKey: string;
  enabled: boolean;
};

const blankForm: FormState = {
  name: "",
  description: "",
  responseTimeHours: "4",
  resolutionTimeHours: "24",
  priority: "",
  teamKey: "",
  enabled: true,
};

function policyToForm(policy: SlaPolicy): FormState {
  return {
    id: policy.id,
    name: policy.name,
    description: policy.description ?? "",
    responseTimeHours: String(policy.responseTimeHours),
    resolutionTimeHours: String(policy.resolutionTimeHours),
    priority: policy.conditions.priority ?? "",
    teamKey: policy.conditions.teamKey ?? "",
    enabled: policy.enabled,
  };
}

export default function SLAPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [policies, setPolicies] = useState<SlaPolicy[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm);

  useEffect(() => {
    async function loadPolicies() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/workspaces/current/sla");
        if (!response.ok) throw new Error("Unable to load SLA policies");
        const payload = await response.json();
        setPolicies(payload.sla.policies);
        setCanManage(payload.sla.canManage);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Unable to load SLA policies",
        );
      } finally {
        setLoading(false);
      }
    }

    void loadPolicies();
  }, []);

  const editing = useMemo(() => Boolean(form.id), [form.id]);

  async function savePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      name: form.name,
      description: form.description,
      responseTimeHours: Number(form.responseTimeHours),
      resolutionTimeHours: Number(form.resolutionTimeHours),
      enabled: form.enabled,
      conditions: {
        priority: form.priority || undefined,
        teamKey: form.teamKey || undefined,
      },
    };
    const url = form.id
      ? `/api/workspaces/current/sla/${form.id}`
      : "/api/workspaces/current/sla";
    const response = await fetch(url, {
      method: form.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) {
      setError(payload.error ?? "Unable to save SLA policy");
      return;
    }
    setPolicies((current) =>
      form.id
        ? current.map((policy) =>
            policy.id === form.id ? payload.policy : policy,
          )
        : [payload.policy, ...current],
    );
    setForm(blankForm);
  }

  async function deletePolicy(policy: SlaPolicy) {
    setError(null);
    const response = await fetch(`/api/workspaces/current/sla/${policy.id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.error ?? "Unable to delete SLA policy");
      return;
    }
    setPolicies((current) => current.filter((item) => item.id !== policy.id));
    if (form.id === policy.id) setForm(blankForm);
  }

  if (loading) {
    return (
      <div className="p-8 text-[var(--color-text-tertiary)]">Loading...</div>
    );
  }

  return (
    <div className="max-w-[860px]">
      <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
        SLAs
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Set service level agreements to track and ensure timely response to
        issues.
      </p>

      {error && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-600">
          {error}
        </div>
      )}

      {canManage && (
        <form
          className="mt-6 grid gap-4 rounded-[var(--editorial-radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
          onSubmit={savePolicy}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-[16px] font-medium text-[var(--color-text-primary)]">
              {editing ? "Edit SLA policy" : "Create SLA policy"}
            </h2>
            {editing && (
              <button
                className="text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                type="button"
                onClick={() => setForm(blankForm)}
              >
                Cancel edit
              </button>
            )}
          </div>
          <label className="grid gap-1 text-[13px] text-[var(--color-text-secondary)]">
            Name
            <input
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[14px] text-[var(--color-text-primary)]"
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
              placeholder="Urgent customer issues"
              required
            />
          </label>
          <label className="grid gap-1 text-[13px] text-[var(--color-text-secondary)]">
            Description
            <textarea
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[14px] text-[var(--color-text-primary)]"
              value={form.description}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
              placeholder="When this policy applies"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-[13px] text-[var(--color-text-secondary)]">
              First response hours
              <input
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[14px] text-[var(--color-text-primary)]"
                min="0.25"
                step="0.25"
                type="number"
                value={form.responseTimeHours}
                onChange={(event) =>
                  setForm({ ...form, responseTimeHours: event.target.value })
                }
                required
              />
            </label>
            <label className="grid gap-1 text-[13px] text-[var(--color-text-secondary)]">
              Resolution hours
              <input
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[14px] text-[var(--color-text-primary)]"
                min="0.25"
                step="0.25"
                type="number"
                value={form.resolutionTimeHours}
                onChange={(event) =>
                  setForm({ ...form, resolutionTimeHours: event.target.value })
                }
                required
              />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-[13px] text-[var(--color-text-secondary)]">
              Priority condition
              <select
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[14px] text-[var(--color-text-primary)]"
                value={form.priority}
                onChange={(event) =>
                  setForm({ ...form, priority: event.target.value })
                }
              >
                <option value="">Any priority</option>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
            <label className="grid gap-1 text-[13px] text-[var(--color-text-secondary)]">
              Team key
              <input
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[14px] text-[var(--color-text-primary)]"
                value={form.teamKey}
                onChange={(event) =>
                  setForm({ ...form, teamKey: event.target.value })
                }
                placeholder="ENG"
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-[13px] text-[var(--color-text-secondary)]">
            <input
              checked={form.enabled}
              onChange={(event) =>
                setForm({ ...form, enabled: event.target.checked })
              }
              type="checkbox"
            />
            Policy enabled
          </label>
          <button
            className="w-fit rounded-md bg-[var(--color-accent)] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-60"
            disabled={saving}
            type="submit"
          >
            {saving ? "Saving..." : editing ? "Save SLA policy" : "Create SLA"}
          </button>
        </form>
      )}

      <div className="mt-8">
        {policies.length === 0 ? (
          <EmptyState
            title="No SLAs"
            description="Configure your first SLA to start monitoring response times."
            action={
              canManage
                ? undefined
                : {
                    label: "Create SLA",
                    disabled: true,
                    disabledReason:
                      "Only workspace admins can manage SLA policies.",
                  }
            }
          />
        ) : (
          <div className="divide-y divide-[var(--color-border)] rounded-[var(--editorial-radius-lg)] border border-[var(--color-border)]">
            {policies.map((policy) => (
              <div className="p-4" key={policy.id}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-medium text-[var(--color-text-primary)]">
                      {policy.name}
                    </h3>
                    {policy.description && (
                      <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
                        {policy.description}
                      </p>
                    )}
                    <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
                      Respond in {policy.responseTimeHours}h · Resolve in{" "}
                      {policy.resolutionTimeHours}h
                      {policy.conditions.priority
                        ? ` · ${policy.conditions.priority} priority`
                        : ""}
                      {policy.conditions.teamKey
                        ? ` · Team ${policy.conditions.teamKey}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-[var(--color-border)] px-2 py-1 text-[12px] text-[var(--color-text-secondary)]">
                      {policy.enabled ? "Enabled" : "Disabled"}
                    </span>
                    {canManage && (
                      <>
                        <button
                          className="text-[13px] text-[var(--color-accent)]"
                          type="button"
                          onClick={() => setForm(policyToForm(policy))}
                        >
                          Edit
                        </button>
                        <button
                          className="text-[13px] text-red-600"
                          type="button"
                          onClick={() => void deletePolicy(policy)}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
