import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import PulseSettingsPage from "@/app/(app)/settings/pulse/page";
import { afterEach, describe, expect, it } from "vitest";

describe("PulseSettingsPage component", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the pulse settings page with empty state", async () => {
    render(<PulseSettingsPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.getByText("Pulse")).toBeInTheDocument();
        expect(screen.getByText(/Visualize team activity/)).toBeInTheDocument();
        expect(screen.getByText("Pulse is ready")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });
});
