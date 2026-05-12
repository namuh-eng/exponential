import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ key: "ENG" }),
}));

import TeamIssueStatusesPage from "@/app/(app)/settings/teams/[key]/statuses/page";

const mockStatusesData = {
  statuses: {
    triage: [],
    backlog: [
      {
        id: "s1",
        name: "Backlog",
        issueCount: 5,
        description: "Planned work",
        isDefault: true,
      },
    ],
    unstarted: [
      { id: "s2", name: "Todo", issueCount: 2, description: "Ready to start" },
    ],
    started: [
      { id: "s3", name: "In Progress", issueCount: 1, description: "Working" },
    ],
    completed: [
      { id: "s4", name: "Done", issueCount: 10, description: "Finished" },
    ],
    canceled: [
      { id: "s5", name: "Canceled", issueCount: 0, description: "Abandoned" },
    ],
  },
};

describe("TeamIssueStatusesPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders loading state then status list", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockStatusesData,
    } as Response);

    render(<TeamIssueStatusesPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    const statusItems = await screen.findAllByTestId("status-item");

    const backlogRow = statusItems.find((el) =>
      within(el).queryByText("Backlog"),
    );
    expect(backlogRow).toBeDefined();
    if (backlogRow) {
      expect(within(backlogRow).getByText("5 issues")).toBeInTheDocument();
      expect(within(backlogRow).getByText("Planned work")).toBeInTheDocument();
      expect(within(backlogRow).getByText("Default")).toBeInTheDocument();
    }

    expect(statusItems.some((el) => within(el).queryByText("Todo"))).toBe(true);
    expect(
      statusItems.some((el) => within(el).queryByText("In Progress")),
    ).toBe(true);
    expect(statusItems.some((el) => within(el).queryByText("Done"))).toBe(true);
    expect(statusItems.some((el) => within(el).queryByText("Canceled"))).toBe(
      true,
    );
  });

  it("shows category headers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockStatusesData,
    } as Response);

    render(<TeamIssueStatusesPage />);

    // Triage is empty but header should be there
    expect(await screen.findByText("Triage")).toBeInTheDocument();
    expect(screen.getByText("Unstarted")).toBeInTheDocument();
    expect(screen.getByText("Started")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });
});
