import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import BillingSettingsPage from "@/app/(app)/settings/billing/page";
import { afterEach, describe, expect, it } from "vitest";

describe("BillingSettingsPage component", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the billing settings page with empty state", async () => {
    render(<BillingSettingsPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.getByText("Billing")).toBeInTheDocument();
        expect(screen.getByText(/Manage your plan/)).toBeInTheDocument();
        expect(screen.getByText("Free Plan")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });
});
