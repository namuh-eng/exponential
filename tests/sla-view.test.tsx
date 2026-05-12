import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import SLAPage from "@/app/(app)/settings/sla/page";
import { afterEach, describe, expect, it } from "vitest";

describe("SLAPage component", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the SLA settings page with empty state", async () => {
    render(<SLAPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.getByText("SLAs")).toBeInTheDocument();
        expect(
          screen.getByText(/Set service level agreements/),
        ).toBeInTheDocument();
        expect(screen.getByText("No SLAs")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });
});
