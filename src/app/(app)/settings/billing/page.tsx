"use client";

import { EmptyState } from "@/components/empty-state";
import { useEffect, useState } from "react";

interface WorkspaceBillingData {
  id: string;
  name: string;
  plan: "free" | "standard" | "plus" | "enterprise";
}

export default function BillingSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [billing, setBilling] = useState<WorkspaceBillingData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/workspaces/current")
      .then(async (res) => {
        if (!res.ok) {
          throw new Error("Failed to load workspace data");
        }
        const data = await res.json();
        return data.workspace as WorkspaceBillingData;
      })
      .then((data) => {
        setBilling(data);
      })
      .catch(() => {
        setErrorMessage("Unable to load billing information.");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-8 text-[var(--color-text-tertiary)]">Loading...</div>
    );
  }

  const planLabels: Record<string, string> = {
    free: "Free Plan",
    standard: "Standard Plan",
    plus: "Plus Plan",
    enterprise: "Enterprise Plan",
  };

  const planDescription: Record<string, string> = {
    free: "You are currently on the free plan. Upgrade for more features and team members.",
    standard: "Advanced features for small teams.",
    plus: "Security and scale for growing organizations.",
    enterprise: "Full control and support for large companies.",
  };

  return (
    <div className="max-w-[720px]">
      <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
        Billing
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Manage your plan, payment methods, and invoices for{" "}
        <strong>{billing?.name}</strong>.
      </p>

      {errorMessage && (
        <p className="mt-4 text-[13px] text-red-400">{errorMessage}</p>
      )}

      <div className="mt-8">
        <EmptyState
          title={planLabels[billing?.plan ?? "free"]}
          description={planDescription[billing?.plan ?? "free"]}
          action={{
            label: "View plans and upgrade",
            onClick: () => console.log("View plans"),
          }}
        />
      </div>

      <div className="mt-10 border-t border-[var(--color-border)] pt-8">
        <h3 className="text-[14px] font-semibold text-[var(--color-text-primary)]">
          Payment methods
        </h3>
        <p className="mt-1 text-[13px] text-[var(--color-text-tertiary)]">
          No payment methods on file.
        </p>
      </div>

      <div className="mt-10 border-t border-[var(--color-border)] pt-8">
        <h3 className="text-[14px] font-semibold text-[var(--color-text-primary)]">
          Invoices
        </h3>
        <p className="mt-1 text-[13px] text-[var(--color-text-tertiary)]">
          No invoices yet.
        </p>
      </div>
    </div>
  );
}
