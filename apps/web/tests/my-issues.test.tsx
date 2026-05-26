import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation
const pushMock = vi.fn();
const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ tab: "assigned" }),
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  usePathname: () => "/my-issues/assigned",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/app/(app)/app-shell", () => ({
  useAppShellContext: () => ({ workspaceSlug: "foreverbrowsing" }),
}));

// Must import after mocks
import MyIssuesTabPage from "@/app/(app)/my-issues/[tab]/page";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockFetch(data: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => data,
  });
}

const sampleData = {
  groups: [
    {
      state: {
        id: "s1",
        name: "In Progress",
        category: "started",
        color: "#f2c94c",
        position: 3,
      },
      issues: [
        {
          id: "i1",
          number: 1,
          identifier: "ENG-1",
          title: "Fix auth bug",
          priority: "high",
          stateId: "s1",
          assigneeId: "u1",
          assignee: { name: "Alice" },
          labels: [{ name: "bug", color: "#e53e3e" }],
          labelIds: ["bug"],
          projectId: null,
          projectName: "Platform polish",
          dueDate: null,
          createdAt: "2026-03-01",
          displayAt: "2026-03-04",
          teamKey: "ENG",
        },
      ],
    },
    {
      state: {
        id: "s2",
        name: "Backlog",
        category: "backlog",
        color: "#6b6f76",
        position: 1,
      },
      issues: [
        {
          id: "i2",
          number: 2,
          identifier: "ENG-2",
          title: "Add dark mode",
          priority: "medium",
          stateId: "s2",
          assigneeId: "u1",
          assignee: { name: "Alice" },
          labels: [],
          labelIds: [],
          projectId: null,
          projectName: null,
          dueDate: null,
          createdAt: "2026-03-02",
          teamKey: "ENG",
        },
      ],
    },
  ],
  totalCount: 2,
  filterOptions: {
    statuses: [
      { id: "s1", name: "In Progress", category: "started", color: "#f2c94c" },
      { id: "s2", name: "Backlog", category: "backlog", color: "#6b6f76" },
    ],
    assignees: [{ id: "u1", name: "Alice" }],
    labels: [{ id: "bug", name: "bug", color: "#e53e3e" }],
    priorities: [
      { value: "high", label: "High" },
      { value: "medium", label: "Medium" },
    ],
  },
};

describe("MyIssuesTabPage", () => {
  it("renders My Issues heading", async () => {
    mockFetch(sampleData);
    render(<MyIssuesTabPage />);
    expect(await screen.findByText("My Issues")).toBeDefined();
  });

  it("renders all four tab buttons", async () => {
    mockFetch(sampleData);
    render(<MyIssuesTabPage />);
    // Wait for data to load
    await screen.findByText("ENG-1");
    expect(screen.getByText("Assigned")).toBeDefined();
    expect(screen.getByText("Created")).toBeDefined();
    expect(screen.getByText("Subscribed")).toBeDefined();
    expect(screen.getByText("Activity")).toBeDefined();
  });

  it("shows issue identifiers after loading", async () => {
    mockFetch(sampleData);
    render(<MyIssuesTabPage />);
    expect(await screen.findByText("ENG-1")).toBeDefined();
    expect(screen.getByText("ENG-2")).toBeDefined();
  });

  it("shows issue titles", async () => {
    mockFetch(sampleData);
    render(<MyIssuesTabPage />);
    expect(await screen.findByText("Fix auth bug")).toBeDefined();
    expect(screen.getByText("Add dark mode")).toBeDefined();
  });

  it("links rows with team metadata to the workspace issue detail route", async () => {
    mockFetch(sampleData);
    render(<MyIssuesTabPage />);

    const issueLink = await screen.findByRole("link", {
      name: "ENG-1 Fix auth bug",
    });

    expect(issueLink.getAttribute("href")).toBe(
      "/foreverbrowsing/team/ENG/issue/i1",
    );
  });

  it("does not render a row link when team metadata is missing", async () => {
    mockFetch({
      ...sampleData,
      groups: [
        {
          ...sampleData.groups[0],
          issues: [
            {
              ...sampleData.groups[0].issues[0],
              teamKey: undefined,
            },
          ],
        },
      ],
      totalCount: 1,
    });
    render(<MyIssuesTabPage />);

    expect(await screen.findByText("ENG-1")).toBeDefined();
    expect(
      screen.queryByRole("link", { name: "ENG-1 Fix auth bug" }),
    ).toBeNull();
  });

  it("shows workflow state group headers", async () => {
    mockFetch(sampleData);
    render(<MyIssuesTabPage />);
    await screen.findByText("ENG-1");
    expect(screen.getByText("In Progress")).toBeDefined();
    expect(screen.getByText("Backlog")).toBeDefined();
  });

  it("shows issue count in footer", async () => {
    mockFetch(sampleData);
    render(<MyIssuesTabPage />);
    await screen.findByText("ENG-1");
    // Header count and footer count
    const countElements = screen.getAllByText("2 issues");
    expect(countElements.length).toBeGreaterThanOrEqual(1);
  });

  it("shows labels on issues", async () => {
    mockFetch(sampleData);
    render(<MyIssuesTabPage />);
    await screen.findByText("ENG-1");
    expect(screen.getByText("bug")).toBeDefined();
  });

  it("renders empty state when no issues", async () => {
    mockFetch({
      groups: [],
      totalCount: 0,
      filterOptions: {
        statuses: [],
        assignees: [],
        labels: [],
        priorities: [],
      },
    });
    render(<MyIssuesTabPage />);
    expect(await screen.findByText("No issues assigned")).toBeDefined();
  });

  it("renders display options button", async () => {
    mockFetch(sampleData);
    render(<MyIssuesTabPage />);
    await screen.findByText("ENG-1");
    expect(screen.getByText("Display")).toBeDefined();
  });

  it("renders filter button", async () => {
    mockFetch(sampleData);
    render(<MyIssuesTabPage />);
    await screen.findByText("ENG-1");
    expect(screen.getByText("Add filter")).toBeDefined();
  });

  it("calls fetch with correct tab parameter", async () => {
    mockFetch(sampleData);
    render(<MyIssuesTabPage />);
    await screen.findByText("ENG-1");
    expect(global.fetch).toHaveBeenCalledWith("/api/my-issues?tab=assigned");
  });

  it("navigates to tab when clicking tab button", async () => {
    mockFetch(sampleData);
    render(<MyIssuesTabPage />);
    await screen.findByText("ENG-1");
    const createdTab = screen.getByText("Created");
    createdTab.click();
    expect(pushMock).toHaveBeenCalledWith("/foreverbrowsing/my-issues/created");
  });

  it("shows assignee avatars on issues", async () => {
    mockFetch(sampleData);
    render(<MyIssuesTabPage />);
    await screen.findByText("ENG-1");
    const avatars = screen.getAllByTestId("assignee");
    expect(avatars.length).toBeGreaterThanOrEqual(1);
  });

  it("shows project breadcrumb text when project data is available", async () => {
    mockFetch(sampleData);
    render(<MyIssuesTabPage />);
    expect(await screen.findByText("Platform polish")).toBeDefined();
  });
});

describe("My Issues API route", () => {
  it("selects the most recent workspace membership for the current session", async () => {
    const fs = await import("node:fs");
    const content = fs.readFileSync(
      "tests/legacy-api/my-issues/route.ts",
      "utf-8",
    );
    expect(content).toContain(".orderBy(desc(member.createdAt))");
  });

  it("includes commenter-derived issues for subscribed and activity tabs", async () => {
    const fs = await import("node:fs");
    const content = fs.readFileSync(
      "tests/legacy-api/my-issues/route.ts",
      "utf-8",
    );
    expect(content).toContain("fetchIssuesByCommenter");
    expect(content).toContain("sortIssuesByUpdatedAtDesc");
  });

  it("deduplicates cross-team status filters by grouped status key", async () => {
    const fs = await import("node:fs");
    const content = fs.readFileSync(
      "tests/legacy-api/my-issues/route.ts",
      "utf-8",
    );
    expect(content).toContain("stateId: groupKey");
    expect(content).toContain("statuses: statusOptions");
  });
});
