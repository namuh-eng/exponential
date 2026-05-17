import CycleDetailPage from "@/app/(app)/team/[key]/cycles/[cycleId]/page";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ key: "ENG", cycleId: "cycle-1" }),
  useRouter: () => ({ push: pushMock }),
}));

const mockCycleDetailResponse = {
  team: { id: "team-1", name: "Engineering", key: "ENG" },
  cycle: {
    id: "cycle-1",
    name: "Cycle 1",
    number: 1,
    startDate: "2026-05-01",
    endDate: "2026-05-14",
    issueCount: 1,
    completedIssueCount: 0,
  },
  groups: [
    {
      state: {
        id: "state-1",
        name: "In Progress",
        category: "started",
        color: "#f2c94c",
        position: 1,
      },
      issues: [
        {
          id: "issue-1",
          number: 123,
          identifier: "ENG-123",
          title: "Fix cycle row navigation",
          priority: "medium",
          stateId: "state-1",
          assigneeId: null,
          assignee: null,
          labels: [],
          projectId: null,
          dueDate: null,
          createdAt: "2026-05-10T00:00:00.000Z",
        },
      ],
    },
  ],
};

describe("CycleDetailPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockCycleDetailResponse),
        } as Response),
      ),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    pushMock.mockReset();
  });

  it("renders cycle issue rows as links to issue detail", async () => {
    render(<CycleDetailPage />);

    await waitFor(() => {
      expect(screen.getByText("Cycle 1")).toBeInTheDocument();
    });

    const issueLink = screen.getByRole("link", {
      name: /eng-123 fix cycle row navigation/i,
    });

    expect(issueLink).toHaveAttribute("href", "/team/ENG/issue/ENG-123");
  });
});
