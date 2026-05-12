import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import AsksSettingsPage from "@/app/(app)/settings/asks/page";
import { afterEach, describe, expect, it } from "vitest";

describe("AsksSettingsPage component", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the asks settings page with empty state", async () => {
    render(<AsksSettingsPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.getByText("Asks")).toBeInTheDocument();
        expect(
          screen.getByText(/Manage internal requests/),
        ).toBeInTheDocument();
        expect(screen.getByText("No asks configured")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });
});
