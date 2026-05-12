import TeamSlackSettingsPage from "@/app/(app)/settings/teams/[key]/slack-notifications/page";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useParams: () => ({ key: "TEAM" }),
}));

describe("TeamSlackSettingsPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders the Slack settings page in disconnected state", async () => {
    render(<TeamSlackSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Slack notifications")).toBeInTheDocument();
    });

    expect(screen.getByText("Slack is not connected")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Connect Slack" }),
    ).toBeInTheDocument();
  });
});
