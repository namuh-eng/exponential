import IntegrationsSettingsPage from "@/app/(app)/settings/integrations/page";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

const payload = {
  canManageIntegrations: true,
  allowLocalSlackInstall: true,
  integrations: [
    {
      provider: "github",
      name: "GitHub",
      description: "Sync pull requests, commits, and issue links with Linear.",
      state: {
        status: "configuration_required",
        configurationError: "GitHub OAuth credentials are not configured.",
      },
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
      state: {
        status: "configuration_required",
        configurationError: "Zendesk app credentials are not configured.",
      },
    },
  ],
};

describe("IntegrationsSettingsPage", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads actionable integration cards without placeholder unavailable copy", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => payload });

    render(<IntegrationsSettingsPage />);

    await screen.findByRole("button", { name: "Explore integrations" });
    fireEvent.click(
      screen.getByRole("button", { name: "Explore integrations" }),
    );

    expect(await screen.findByText("GitHub")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
    expect(screen.queryByText(/Setup unavailable/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/not enabled in this workspace clone/i),
    ).not.toBeInTheDocument();
  });

  it("shows Slack configuration errors and supports a local Slack connection", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => payload })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: "Slack OAuth credentials are not configured.",
          allowLocalSlackInstall: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ integration: { status: "connected" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...payload,
          integrations: payload.integrations.map((item) =>
            item.provider === "slack"
              ? {
                  ...item,
                  state: {
                    status: "connected",
                    workspaceName: "Local Slack workspace",
                  },
                }
              : item,
          ),
        }),
      });

    render(<IntegrationsSettingsPage />);
    await screen.findByRole("button", { name: "Explore integrations" });
    fireEvent.click(
      screen.getByRole("button", { name: "Explore integrations" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Slack OAuth credentials are not configured.",
    );
    fireEvent.click(
      screen
        .getAllByRole("button", { name: "Create local Slack connection" })
        .at(-1)!,
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/integrations/slack",
        expect.objectContaining({
          body: JSON.stringify({ localInstall: true }),
        }),
      ),
    );
    expect(
      await screen.findByText(
        "Slack integration connected for this workspace.",
      ),
    ).toBeInTheDocument();
  });
});
