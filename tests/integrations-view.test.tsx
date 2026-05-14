import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import IntegrationsSettingsPage from "@/app/(app)/settings/integrations/page";
import { afterEach, describe, expect, it } from "vitest";

describe("IntegrationsSettingsPage component", () => {
  afterEach(() => {
    cleanup();
  });

  it("opens an integrations catalog instead of using a no-op action", async () => {
    render(<IntegrationsSettingsPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.getByText("Integrations")).toBeInTheDocument();
        expect(
          screen.getByText(/Connect your workspace with GitHub/),
        ).toBeInTheDocument();
        expect(screen.getByText("No active integrations")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Explore integrations" }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "Explore integrations",
    });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("Slack")).toBeInTheDocument();
  });
});
