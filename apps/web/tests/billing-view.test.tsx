import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import BillingSettingsPage from "@/app/(app)/settings/billing/page";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("BillingSettingsPage component", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          workspace: { id: "ws_1", name: "Acme", role: "admin" },
          currentPlan: "free",
          canManage: true,
          usage: { seatsUsed: 1, issuesUsed: 2, issueLimit: 250 },
          plans: [
            {
              id: "free",
              name: "Free",
              price: "$0",
              description: "For individuals and small trials.",
              features: ["3 members"],
            },
          ],
          paymentMethods: [],
          invoices: [],
        }),
      })),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders the billing settings page with current plan state", async () => {
    render(<BillingSettingsPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Billing")).toBeInTheDocument();
      expect(screen.getByText(/Manage your plan/)).toBeInTheDocument();
      expect(screen.getByText(/Current plan:/)).toBeInTheDocument();
      expect(screen.getByText("Current plan")).toBeInTheDocument();
    });
  });
});
