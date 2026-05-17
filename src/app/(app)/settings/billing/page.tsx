"use client";

import { useEffect, useState } from "react";

type BillingPlanId = "free" | "basic" | "business" | "enterprise";

interface BillingPlan {
  id: BillingPlanId;
  name: string;
  price: string;
  description: string;
  features: string[];
}

interface PaymentMethod {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault?: boolean;
}

interface Invoice {
  id: string;
  number: string;
  date: string;
  amount: string;
  status: string;
}

interface WorkspaceBillingData {
  workspace: {
    id: string;
    name: string;
    role: string;
  };
  currentPlan: BillingPlanId;
  canManage: boolean;
  usage: {
    seatsUsed: number;
    issuesUsed: number;
    issueLimit: number;
  };
  plans: BillingPlan[];
  paymentMethods: PaymentMethod[];
  invoices: Invoice[];
}

export default function BillingSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [savingPlan, setSavingPlan] = useState<BillingPlanId | null>(null);
  const [billing, setBilling] = useState<WorkspaceBillingData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/workspaces/current/billing")
      .then(async (res) => {
        if (!res.ok) {
          throw new Error("Failed to load billing data");
        }
        return (await res.json()) as WorkspaceBillingData;
      })
      .then((data) => {
        setBilling(data);
      })
      .catch(() => {
        setErrorMessage("Unable to load billing information.");
      })
      .finally(() => setLoading(false));
  }, []);

  async function updatePlan(plan: BillingPlanId) {
    setSavingPlan(plan);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/workspaces/current/billing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? "Unable to update plan");
      }

      setBilling((await response.json()) as WorkspaceBillingData);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to update plan.",
      );
    } finally {
      setSavingPlan(null);
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-[var(--color-text-tertiary)]">Loading...</div>
    );
  }

  return (
    <div className="max-w-[920px]">
      <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
        Billing
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Manage your plan, payment methods, and invoices for{" "}
        <strong>{billing?.workspace.name}</strong>.
      </p>

      {errorMessage && (
        <p className="mt-4 text-[13px] text-red-400" role="alert">
          {errorMessage}
        </p>
      )}

      {billing && (
        <>
          <section className="mt-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
            <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
              Current plan:{" "}
              {
                billing.plans.find((plan) => plan.id === billing.currentPlan)
                  ?.name
              }
            </h2>
            <div className="mt-4 grid gap-3 text-[13px] text-[var(--color-text-secondary)] sm:grid-cols-3">
              <div>
                <div className="font-medium text-[var(--color-text-primary)]">
                  Seats used
                </div>
                <div>{billing.usage.seatsUsed} active members</div>
              </div>
              <div>
                <div className="font-medium text-[var(--color-text-primary)]">
                  Issues this cycle
                </div>
                <div>
                  {billing.usage.issuesUsed} / {billing.usage.issueLimit}
                </div>
              </div>
              <div>
                <div className="font-medium text-[var(--color-text-primary)]">
                  Admin access
                </div>
                <div>{billing.canManage ? "Billing manager" : "View only"}</div>
              </div>
            </div>
          </section>

          <section className="mt-8">
            <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
              Plans
            </h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {billing.plans.map((plan) => {
                const isCurrentPlan = plan.id === billing.currentPlan;
                return (
                  <article
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5"
                    key={plan.id}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-[15px] font-semibold text-[var(--color-text-primary)]">
                          {plan.name}
                        </h3>
                        <p className="mt-1 text-[13px] text-[var(--color-text-tertiary)]">
                          {plan.description}
                        </p>
                      </div>
                      <div className="text-right text-[13px] font-medium text-[var(--color-text-primary)]">
                        {plan.price}
                      </div>
                    </div>
                    <ul className="mt-4 space-y-1 text-[13px] text-[var(--color-text-secondary)]">
                      {plan.features.map((feature) => (
                        <li key={feature}>• {feature}</li>
                      ))}
                    </ul>
                    <button
                      className="mt-4 rounded-md border border-[var(--color-border)] px-3 py-2 text-[13px] font-medium text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={
                        isCurrentPlan ||
                        !billing.canManage ||
                        savingPlan !== null
                      }
                      onClick={() => updatePlan(plan.id)}
                      type="button"
                    >
                      {isCurrentPlan
                        ? "Current plan"
                        : savingPlan === plan.id
                          ? "Saving..."
                          : "Upgrade / manage"}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="mt-10 border-t border-[var(--color-border)] pt-8">
            <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
              Payment methods
            </h2>
            <div className="mt-3 space-y-2">
              {billing.paymentMethods.map((method) => (
                <div
                  className="rounded-md border border-[var(--color-border)] px-4 py-3 text-[13px] text-[var(--color-text-secondary)]"
                  key={method.id}
                >
                  {method.brand} ending in {method.last4} · expires{" "}
                  {method.expMonth}/{method.expYear}
                  {method.isDefault ? " · Default" : ""}
                </div>
              ))}
            </div>
          </section>

          <section className="mt-10 border-t border-[var(--color-border)] pt-8">
            <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
              Invoices
            </h2>
            <div className="mt-3 divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)]">
              {billing.invoices.map((invoice) => (
                <div
                  className="grid grid-cols-4 gap-3 px-4 py-3 text-[13px] text-[var(--color-text-secondary)]"
                  key={invoice.id}
                >
                  <span>{invoice.number}</span>
                  <span>{invoice.date}</span>
                  <span>{invoice.amount}</span>
                  <span className="capitalize">{invoice.status}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
