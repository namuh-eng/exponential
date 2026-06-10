import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BillingSettingsPage from "../src/app/(app)/settings/billing/page";

describe("BillingSettingsPage component", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  const mockBillingData = {
    workspace: {
      id: "ws_1",
      name: "Acme Corp",
      role: "admin",
    },
    currentPlan: "business",
    canManage: true,
    usage: { seatsUsed: 3, issuesUsed: 42, issueLimit: 250 },
    plans: [
      {
        id: "free",
        name: "Free",
        price: "$0",
        description: "For individuals and small trials.",
        features: ["3 members"],
      },
      {
        id: "business",
        name: "Business",
        price: "$14/user/month",
        description: "Advanced controls for growing organizations.",
        features: ["Unlimited teams"],
      },
    ],
    paymentMethods: [
      {
        id: "pm_1",
        brand: "Visa",
        last4: "4242",
        expMonth: 12,
        expYear: 2030,
        isDefault: true,
      },
    ],
    invoices: [
      {
        id: "inv_1",
        number: "DEV-001",
        date: "2026-05-01",
        amount: "$0.00",
        status: "paid",
      },
    ],
  };

  it("renders loading state then billing plan, usage, payment methods, and invoices", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockBillingData,
    });

    render(<BillingSettingsPage />);

    expect(screen.getByText("Loading...")).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText("Acme Corp")).toBeDefined();
    });

    expect(screen.getByText(/Current plan:/)).toBeDefined();
    expect(screen.getByText("Business")).toBeDefined();
    expect(
      screen.getByText(
        (content) => content.includes("42") && content.includes("250"),
      ),
    ).toBeDefined();
    expect(
      screen.getByText(
        (content) => content.includes("Visa") && content.includes("4242"),
      ),
    ).toBeDefined();
    expect(screen.getByText("DEV-001")).toBeDefined();
  });

  it("persists an upgrade action through the billing API", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => mockBillingData })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockBillingData, currentPlan: "business" }),
      });

    render(<BillingSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Free")).toBeDefined();
    });

    fireEvent.click(screen.getAllByText("Upgrade / manage")[0]);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/workspaces/current/billing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "free" }),
      });
    });
  });

  it("shows error message when fetch fails", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
    });

    render(<BillingSettingsPage />);

    await waitFor(() => {
      expect(
        screen.getByText("Unable to load billing information."),
      ).toBeDefined();
    });
  });
});
