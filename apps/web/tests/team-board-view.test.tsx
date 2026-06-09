import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation
const pushMock = vi.fn();
const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  useParams: () => ({ key: "ENG" }),
  usePathname: () => "/team/ENG/board",
  useSearchParams: () => new URLSearchParams(),
}));

import TeamBoardPage from "@/app/(app)/team/[key]/board/page";

const mockBoardData = {
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
      state: { id: "s2", name: "Todo", category: "unstarted", color: "#888" },
      issues: [],
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

describe("TeamBoardPage UI", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders loading state then board columns", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockBoardData,
    } as Response);

    render(<TeamBoardPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    expect(await screen.findByText("Engineering")).toBeInTheDocument();
    expect(screen.getByText("Backlog")).toBeInTheDocument();
    expect(screen.getByText("Fix bug")).toBeInTheDocument();
    expect(screen.getByText("ENG-1")).toBeInTheDocument();
  });

  it("switches to list layout", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockBoardData,
    } as Response);

    render(<TeamBoardPage />);
    await screen.findByText("Engineering");

    fireEvent.click(screen.getByRole("button", { name: "Display options" }));

    const listLayoutButton = screen.getByRole("button", { name: "List" });
    fireEvent.click(listLayoutButton);

    expect(pushMock).toHaveBeenCalledWith("/team/ENG/all");
  });

  it("shows empty state when team has no issues", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ ...mockBoardData, groups: [] }),
    } as Response);

    render(<TeamBoardPage />);

    expect(await screen.findByText("No issues")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create issue" }),
    ).toBeInTheDocument();
  });
});
