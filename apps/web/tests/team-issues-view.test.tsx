import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation
const pushMock = vi.fn();
const replaceMock = vi.fn();
let mockPathname = "/team/ENG/all";
let mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  useParams: () => ({ key: "ENG" }),
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
}));

import ActiveTeamIssuesPage from "@/app/(app)/team/[key]/active/page";
import TeamIssuesPage from "@/app/(app)/team/[key]/all/page";
import BacklogTeamIssuesPage from "@/app/(app)/team/[key]/backlog/page";

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
    statuses: [
      { id: "s1", name: "Backlog", category: "backlog", color: "#999" },
      { id: "s3", name: "In Progress", category: "started", color: "#3b82f6" },
    ],
    assignees: [{ id: "user-1", name: "Ashley" }],
    labels: [{ id: "label-1", name: "Bug", color: "#e5484d" }],
    projects: [],
    creators: [],
    cycles: [],
    estimates: [],
    dueDates: [],
    priorities: [
      { value: "high", label: "High" },
      { value: "low", label: "Low" },
    ],
  },
};

const tabCountIssuesData = {
  team: { id: "team-1", name: "Engineering", key: "ENG" },
  groups: [
    {
      state: {
        id: "todo",
        name: "Todo",
        category: "unstarted",
        color: "#f59e0b",
      },
      issues: [],
    },
    {
      state: {
        id: "started",
        name: "In Progress",
        category: "started",
        color: "#3b82f6",
      },
      issues: [],
    },
    {
      state: {
        id: "backlog",
        name: "Backlog",
        category: "backlog",
        color: "#999",
      },
      issues: [
        {
          id: "iss-backlog-1",
          identifier: "ENG-10",
          title: "Backlog issue 1",
          priority: "high",
          stateId: "backlog",
          assignee: null,
          labels: [],
          createdAt: "2026-04-20T00:00:00Z",
        },
        {
          id: "iss-backlog-2",
          identifier: "ENG-11",
          title: "Backlog issue 2",
          priority: "medium",
          stateId: "backlog",
          assignee: null,
          labels: [],
          createdAt: "2026-04-21T00:00:00Z",
        },
        {
          id: "iss-backlog-3",
          identifier: "ENG-12",
          title: "Backlog issue 3",
          priority: "low",
          stateId: "backlog",
          assignee: null,
          labels: [],
          createdAt: "2026-04-22T00:00:00Z",
        },
      ],
    },
    {
      state: {
        id: "done",
        name: "Done",
        category: "completed",
        color: "#10b981",
      },
      issues: [
        {
          id: "iss-done-1",
          identifier: "ENG-13",
          title: "Completed issue 1",
          priority: "none",
          stateId: "done",
          assignee: null,
          labels: [],
          createdAt: "2026-04-23T00:00:00Z",
        },
        {
          id: "iss-done-2",
          identifier: "ENG-14",
          title: "Completed issue 2",
          priority: "none",
          stateId: "done",
          assignee: null,
          labels: [],
          createdAt: "2026-04-24T00:00:00Z",
        },
      ],
    },
  ],
  filterOptions: mockIssuesData.filterOptions,
};

describe("TeamIssuesPage UI", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockPathname = "/team/ENG/all";
    mockSearchParams = new URLSearchParams();
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

  it("renders the active route with the Active tab selected and active issues filtered", async () => {
    mockPathname = "/team/ENG/active";
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockIssuesData,
    } as Response);

    render(<ActiveTeamIssuesPage />);
    await screen.findByText("Engineering");

    expect(screen.getByRole("button", { name: "Active" }).className).toContain(
      "bg-[var(--color-surface-active)]",
    );
    expect(screen.getByText("Working on it")).toBeInTheDocument();
    expect(screen.queryByText("Fix bug")).not.toBeInTheDocument();
  });

  it("renders the backlog route with the Backlog tab selected and backlog issues filtered", async () => {
    mockPathname = "/team/ENG/backlog";
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockIssuesData,
    } as Response);

    render(<BacklogTeamIssuesPage />);
    await screen.findByText("Engineering");

    expect(screen.getByRole("button", { name: "Backlog" }).className).toContain(
      "bg-[var(--color-surface-active)]",
    );
    expect(screen.getByText("Fix bug")).toBeInTheDocument();
    expect(screen.queryByText("Working on it")).not.toBeInTheDocument();
  });

  it("shows toolbar and footer counts for the visible all, active, and backlog tabs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => tabCountIssuesData,
    } as Response);

    mockPathname = "/team/ENG/all";
    const { unmount } = render(<TeamIssuesPage />);
    await screen.findByText("Engineering");
    expect(screen.getAllByText("5 issues")).toHaveLength(2);
    unmount();

    mockPathname = "/team/ENG/active";
    render(<ActiveTeamIssuesPage />);
    await screen.findByText("Engineering");
    expect(screen.getAllByText("0 issues")).toHaveLength(2);
    expect(screen.queryByText("5 issues")).not.toBeInTheDocument();
    cleanup();

    mockPathname = "/team/ENG/backlog";
    render(<BacklogTeamIssuesPage />);
    await screen.findByText("Engineering");
    expect(screen.getAllByText("3 issues")).toHaveLength(2);
    expect(screen.queryByText("5 issues")).not.toBeInTheDocument();
  });

  it("changes tab clicks into URL navigation while preserving filters", async () => {
    mockSearchParams = new URLSearchParams("f=priority%3Ais%3Ahigh");
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockIssuesData,
    } as Response);

    render(<TeamIssuesPage />);
    await screen.findByText("Engineering");

    fireEvent.click(screen.getByRole("button", { name: "Active" }));
    expect(pushMock).toHaveBeenCalledWith(
      "/team/ENG/active?f=priority%3Ais%3Ahigh",
    );

    fireEvent.click(screen.getByRole("button", { name: "Backlog" }));
    expect(pushMock).toHaveBeenCalledWith(
      "/team/ENG/backlog?f=priority%3Ais%3Ahigh",
    );
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

  it("selects rows, supports shift range and escape clear without navigation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockIssuesData,
    } as Response);

    render(<TeamIssuesPage />);
    await screen.findByText("Engineering");

    const checkboxes = screen.getAllByTestId("issue-row-checkbox");
    fireEvent.click(checkboxes[0]);

    expect(screen.getByTestId("bulk-action-bar")).toHaveTextContent(
      "1 selected",
    );
    expect(pushMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByTestId("issue-row-checkbox")[1], {
      shiftKey: true,
    });
    expect(screen.getByTestId("bulk-action-bar")).toHaveTextContent(
      "2 selected",
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("bulk-action-bar")).not.toBeInTheDocument();
  });

  it("persists a selected bulk priority update and refreshes the list", async () => {
    const fetchMock = vi.fn((input, init) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/api/teams/ENG/issues") {
        return Promise.resolve({
          ok: true,
          json: async () => mockIssuesData,
        } as Response);
      }

      if (url === "/api/teams/ENG/display-options") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ displayOptions: null }),
        } as Response);
      }

      if (url === "/api/issues/bulk" && init?.method === "PATCH") {
        expect(JSON.parse(String(init.body))).toEqual({
          issueIds: ["iss-1"],
          updates: { priority: "low" },
        });
        return Promise.resolve({
          ok: true,
          json: async () => ({ updatedCount: 1 }),
        } as Response);
      }

      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fetchMock as unknown as typeof fetch,
    );

    render(<TeamIssuesPage />);
    await screen.findByText("Engineering");

    fireEvent.click(screen.getAllByTestId("issue-row-checkbox")[0]);
    fireEvent.change(screen.getByLabelText("Bulk priority"), {
      target: { value: "low" },
    });

    await screen.findByTestId("bulk-action-bar");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/issues/bulk",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(
      fetchMock.mock.calls.filter(([url]) => url === "/api/teams/ENG/issues"),
    ).toHaveLength(2);
  });

  it("shows team not found instead of the empty issue state for invalid team keys", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "Team not found" }),
    } as Response);

    render(<TeamIssuesPage />);

    expect(await screen.findByText("Team not found")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The team ENG doesn't exist or you don't have access to it.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("No issues")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create issue" }),
    ).not.toBeInTheDocument();
  });
});
