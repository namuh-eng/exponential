import "@testing-library/jest-dom/vitest";
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
        ctaLabel: "Start free",
      },
      {
        id: "business",
        name: "Business",
        price: "$14/user/month",
        description: "Advanced controls for growing organizations.",
        features: ["Unlimited teams"],
        ctaLabel: "Upgrade / manage",
      },
      {
        id: "enterprise_cloud",
        name: "Enterprise Cloud",
        price: "Custom",
        description: "Hosted enterprise controls and support.",
        features: ["SAML/SCIM"],
        ctaLabel: "Contact sales",
        ctaHref: "/signup?intent=enterprise-cloud",
        isCustom: true,
      },
      {
        id: "enterprise_self_hosted",
        name: "Enterprise Self-hosted",
        price: "Custom",
        description: "Commercial self-host license and support.",
        features: ["Deployment guidance"],
        ctaLabel: "Contact sales",
        ctaHref: "/signup?intent=enterprise-self-hosted",
        isCustom: true,
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

    fireEvent.click(screen.getByText("Start free"));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/workspaces/current/billing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "free" }),
      });
    });
  });

  it("renders accessible contact CTAs for custom enterprise plans without PATCH checkout", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockBillingData,
    });

    render(<BillingSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Enterprise Cloud")).toBeDefined();
    });

    const contactLinks = screen.getAllByRole("link", { name: "Contact sales" });
    expect(contactLinks[0]).toHaveAttribute(
      "href",
      "/signup?intent=enterprise-cloud",
    );
    expect(contactLinks[1]).toHaveAttribute(
      "href",
      "/signup?intent=enterprise-self-hosted",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
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
