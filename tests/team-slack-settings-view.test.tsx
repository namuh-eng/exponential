import TeamSlackSettingsPage from "@/app/(app)/settings/teams/[key]/slack-notifications/page";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({ useParams: () => ({ key: "TEAM" }) }));

describe("TeamSlackSettingsPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("connects Slack instead of rendering a no-op button", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          slackConnected: false,
          availableChannels: ["#eng"],
          settings: {
            channelName: null,
            isEnabled: false,
            events: { issueCreated: true },
          },
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          slackConnected: true,
          availableChannels: ["#eng"],
          settings: {
            channelName: null,
            isEnabled: false,
            events: { issueCreated: true },
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeamSlackSettingsPage />);
    await waitFor(() =>
      expect(screen.getByText("Slack is not connected")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect Slack" }));
    await waitFor(() =>
      expect(screen.getByText("Slack channel")).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/integrations/slack",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
