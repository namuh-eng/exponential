import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

  const mockWorkspaceData = {
    workspace: {
      id: "ws_1",
      name: "Acme Corp",
      plan: "standard",
    },
  };

  it("renders loading state then billing info", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockWorkspaceData,
    });

    render(<BillingSettingsPage />);

    expect(screen.getByText("Loading...")).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText("Acme Corp")).toBeDefined();
    });

    expect(screen.getByText("Standard Plan")).toBeDefined();
    expect(
      screen.getByText("Advanced features for small teams."),
    ).toBeDefined();
    expect(screen.getByText("Payment methods")).toBeDefined();
    expect(screen.getByText("Invoices")).toBeDefined();
  });

  it("shows free plan by default", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        workspace: { ...mockWorkspaceData.workspace, plan: "free" },
      }),
    });

    render(<BillingSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Free Plan")).toBeDefined();
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
