import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation
const pushMock = vi.fn();
const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  useParams: () => ({ key: "ENG" }),
  usePathname: () => "/team/ENG/all",
  useSearchParams: () => new URLSearchParams(),
}));

import TeamIssuesPage from "@/app/(app)/team/[key]/all/page";

const mockIssuesData = {
  team: { id: "team-1", name: "Engineering", key: "ENG" },
  groups: [
    {
      state: { id: "s1", name: "Backlog", category: "backlog", color: "#999" },
      issues: [
        {
          id: "iss-1",
          identifier: "ENG-1",
          title: "Fix bug",
          priority: "high",
          stateId: "s1",
          assignee: { name: "Ashley" },
          labels: [],
          createdAt: "2026-04-20T00:00:00Z",
        },
      ],
    },
    {
      state: {
        id: "s3",
        name: "In Progress",
        category: "started",
        color: "#3b82f6",
      },
      issues: [
        {
          id: "iss-2",
          identifier: "ENG-2",
          title: "Working on it",
          priority: "medium",
          stateId: "s3",
          assignee: { name: "Ashley" },
          labels: [],
          createdAt: "2026-04-21T00:00:00Z",
        },
      ],
    },
  ],
  filterOptions: {
    statuses: [],
    assignees: [],
    labels: [],
    projects: [],
    creators: [],
    cycles: [],
    estimates: [],
    dueDates: [],
    priorities: [],
  },
};

describe("TeamIssuesPage UI", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders loading state then issue list", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockIssuesData,
    } as Response);

    render(<TeamIssuesPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    expect(await screen.findByText("Engineering")).toBeInTheDocument();
    expect(screen.getByText("Fix bug")).toBeInTheDocument();
    expect(screen.getByText("Working on it")).toBeInTheDocument();

    const countElements = screen.getAllByText(/2 issues/i);
    expect(countElements.length).toBeGreaterThan(0);
  });

  it("switches tabs to filter issues", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockIssuesData,
    } as Response);

    render(<TeamIssuesPage />);
    await screen.findByText("Engineering");

    // All issues tab
    expect(screen.getByText("Fix bug")).toBeInTheDocument();
    expect(screen.getByText("Working on it")).toBeInTheDocument();

    // Active tab (should only show "Working on it")
    fireEvent.click(screen.getByRole("button", { name: "Active" }));
    expect(screen.getByText("Working on it")).toBeInTheDocument();
    expect(screen.queryByText("Fix bug")).not.toBeInTheDocument();

    // Backlog tab (should only show "Fix bug")
    fireEvent.click(screen.getByRole("button", { name: "Backlog" }));
    expect(screen.getByText("Fix bug")).toBeInTheDocument();
    expect(screen.queryByText("Working on it")).not.toBeInTheDocument();
  });

  it("switches to board layout", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockIssuesData,
    } as Response);

    render(<TeamIssuesPage />);
    await screen.findByText("Engineering");

    fireEvent.click(screen.getByRole("button", { name: "Display options" }));

    const boardLayoutButton = screen.getByRole("button", { name: "Board" });
    fireEvent.click(boardLayoutButton);

    expect(pushMock).toHaveBeenCalledWith("/team/ENG/board");
  });
});
