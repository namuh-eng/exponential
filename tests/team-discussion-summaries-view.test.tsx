import TeamDiscussionSummariesSettingsPage from "@/app/(app)/settings/teams/[key]/discussion-summaries/page";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  useParams: () => ({ key: "TEAM" }),
}));

describe("TeamDiscussionSummariesSettingsPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url, options) => {
        if (url === "/api/teams/TEAM/settings" && !options) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                team: {
                  name: "Team Name",
                  key: "TEAM",
                  discussionSummariesEnabled: false,
                },
              }),
          });
        }
        if (url === "/api/teams/TEAM/settings" && options?.method === "PATCH") {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                team: {
                  name: "Team Name",
                  key: "TEAM",
                  discussionSummariesEnabled: JSON.parse(options.body)
                    .discussionSummariesEnabled,
                },
              }),
          });
        }
        return Promise.reject(new Error("Unhandled fetch"));
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("loads, persists, and reflects discussion summary toggles", async () => {
    render(<TeamDiscussionSummariesSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Discussion summaries")).toBeInTheDocument();
    });

    const toggle = screen.getByLabelText("Enable discussion summaries");
    expect(toggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(
        screen.getByText("Discussion summaries updated"),
      ).toBeInTheDocument();
    });

    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/teams/TEAM/settings",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ discussionSummariesEnabled: true }),
      }),
    );
  });
});
