import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import IntegrationsSettingsPage from "@/app/(app)/settings/integrations/page";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

const integrationsPayload = {
  canManageIntegrations: true,
  allowLocalSlackInstall: true,
  integrations: [
    {
      provider: "github",
      name: "GitHub",
      description: "Sync pull requests, commits, and issue links with Linear.",
      state: { status: "configuration_required" },
    },
    {
      provider: "slack",
      name: "Slack",
      description: "Send issue updates and create issues from Slack messages.",
      state: { status: "configuration_required" },
    },
    {
      provider: "zendesk",
      name: "Zendesk",
      description:
        "Connect support tickets to product work and customer requests.",
      state: { status: "configuration_required" },
    },
  ],
};

describe("IntegrationsSettingsPage component", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => integrationsPayload,
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
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
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
    expect(screen.queryByText(/Setup unavailable/i)).not.toBeInTheDocument();
  });
});
