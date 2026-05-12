import TeamDiscussionSummariesSettingsPage from "@/app/(app)/settings/teams/[key]/discussion-summaries/page";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useParams: () => ({ key: "TEAM" }),
}));

describe("TeamDiscussionSummariesSettingsPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders the discussion summaries settings page", async () => {
    render(<TeamDiscussionSummariesSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Discussion summaries")).toBeInTheDocument();
    });

    const toggle = screen.getByLabelText("Enable discussion summaries");
    expect(toggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });
});
