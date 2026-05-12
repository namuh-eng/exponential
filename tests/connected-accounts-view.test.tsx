import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import ConnectedAccountsPage from "@/app/(app)/settings/account/connected/page";
import { afterEach, describe, expect, it } from "vitest";

describe("ConnectedAccountsPage component", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the connected accounts settings page with empty state", async () => {
    render(<ConnectedAccountsPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.getByText("Connected accounts")).toBeInTheDocument();
        expect(
          screen.getByText(/Manage your social logins/),
        ).toBeInTheDocument();
        expect(screen.getByText("No connected accounts")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });
});
