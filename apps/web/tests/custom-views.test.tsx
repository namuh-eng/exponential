import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { ViewsPage } from "@/components/views-page";

const push = vi.fn();
let searchParams = new URLSearchParams();
let mockWorkspaceSlug: string | undefined;

vi.mock("@/app/(app)/app-shell", () => ({
  useAppShellContext: () =>
    mockWorkspaceSlug ? { workspaceSlug: mockWorkspaceSlug } : null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => searchParams,
  useParams: () => ({ key: "ONB" }),
}));

const mockFetch = vi.fn();
const confirmSpy = vi.fn(() => true);
const storage = new Map<string, string>();

global.fetch = mockFetch;
window.confirm = confirmSpy;

Object.defineProperty(window, "localStorage", {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
      mockWorkspaceSlug = undefined;
    },
  },
  configurable: true,
});

function buildViewsResponse() {
  return {
    teams: [
      { id: "team-1", key: "ONB", name: "Onboarding QA Team" },
      { id: "team-2", key: "PLT", name: "Platform" },
    ],
    views: [
      {
        id: "view-1",
        name: "High priority onboarding",
        layout: "list",
        isPersonal: true,
        owner: { name: "John Doe", image: null },
        teamId: "team-1",
        teamKey: "ONB",
        teamName: "Onboarding QA Team",
        entityType: "issues",
        scope: "team",
        filterState: {
          entityType: "issues",
          scope: "team",
          issueFilters: [
            { type: "priority", operator: "is", values: ["high"] },
          ],
          issueDisplayOptions: {
            groupBy: "assignee",
            subGroupBy: "none",
            orderBy: "updated",
            displayProperties: {
              id: true,
              status: true,
              assignee: true,
              priority: true,
              project: true,
              dueDate: true,
              milestone: false,
              labels: false,
              links: false,
              timeInStatus: false,
              created: true,
              updated: false,
              pullRequests: false,
            },
            showSubIssues: true,
            showTriageIssues: false,
            showEmptyColumns: true,
          },
          projectStatusFilter: "all",
          projectSortBy: "created-desc",
          projectDisplayOptions: {
            groupBy: "status",
            visibleProperties: {
              lead: true,
              team: true,
              targetDate: true,
              progress: true,
              status: true,
            },
          },
        },
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "view-2",
        name: "Project progress",
        layout: "list",
        isPersonal: false,
        owner: { name: "Jane Smith", image: null },
        teamId: null,
        teamKey: null,
        teamName: null,
        entityType: "projects",
        scope: "workspace",
        filterState: {
          entityType: "projects",
          scope: "workspace",
          issueFilters: [],
          issueDisplayOptions: {
            groupBy: "status",
            subGroupBy: "none",
            orderBy: "priority",
            displayProperties: {
              id: true,
              status: true,
              assignee: true,
              priority: true,
              project: true,
              dueDate: true,
              milestone: false,
              labels: true,
              links: false,
              timeInStatus: false,
              created: true,
              updated: false,
              pullRequests: false,
            },
            showSubIssues: true,
            showTriageIssues: false,
            showEmptyColumns: false,
          },
          projectStatusFilter: "started",
          projectSortBy: "progress-desc",
          projectDisplayOptions: {
            groupBy: "team",
            visibleProperties: {
              lead: true,
              team: true,
              targetDate: false,
              progress: true,
              status: true,
            },
          },
        },
        createdAt: "2026-01-02T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
      },
    ],
  };
}

function buildIssuePreviewResponse() {
  return {
    groups: [
      {
        issues: [
          {
            id: "issue-1",
            stateId: "started",
            priority: "high",
            assigneeId: "user-1",
            labelIds: [],
            projectId: null,
            creatorId: "user-1",
            cycleId: null,
            dueDate: null,
            estimate: null,
            teamId: "team-1",
          },
          {
            id: "issue-2",
            stateId: "backlog",
            priority: "low",
            assigneeId: null,
            labelIds: [],
            projectId: null,
            creatorId: "user-1",
            cycleId: null,
            dueDate: null,
            estimate: null,
            teamId: "team-1",
          },
        ],
      },
    ],
    filterOptions: {
      statuses: [
        { id: "started", name: "Started", category: "started", color: "#00f" },
        { id: "backlog", name: "Backlog", category: "backlog", color: "#999" },
      ],
      assignees: [{ id: "user-1", name: "John Doe" }],
      labels: [],
      projects: [],
      creators: [{ id: "user-1", name: "John Doe" }],
      cycles: [],
      estimates: [],
      dueDates: [],
      priorities: [
        { value: "high", label: "High" },
        { value: "low", label: "Low" },
      ],
      teams: [{ id: "team-1", name: "Onboarding QA Team" }],
    },
  };
}

function waitForLoaded() {
  return waitFor(() => {
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });
}

describe("ViewsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams = new URLSearchParams();
    storage.clear();
    mockWorkspaceSlug = undefined;
  });

  afterEach(() => {
    cleanup();
  });

  it("renders issue views by default and switches tabs via router", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => buildViewsResponse(),
    });

    render(<ViewsPage initialTab="issues" />);
    await waitForLoaded();

    expect(screen.getByRole("heading", { name: "Views" })).toBeInTheDocument();
    expect(screen.getByText("High priority onboarding")).toBeInTheDocument();
    expect(screen.queryByText("Project progress")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    expect(push).toHaveBeenCalledWith("/views/projects");
  });

  it("keeps /views canonical when switching tabs on the landing route", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => buildViewsResponse(),
    });

    render(<ViewsPage initialTab="issues" keepCanonicalTabRoute />);
    await waitForLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Projects" }));

    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText("Project progress")).toBeInTheDocument();
    expect(
      screen.queryByText("High priority onboarding"),
    ).not.toBeInTheDocument();
  });

  it("renders /views/all as the canonical all-views landing route", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => buildViewsResponse(),
    });

    const { default: ViewsAllPage } = await import(
      "@/app/(app)/views/all/page"
    );

    render(<ViewsAllPage />);
    await waitForLoaded();

    expect(screen.getByRole("heading", { name: "Views" })).toBeInTheDocument();
    expect(screen.getByText("High priority onboarding")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Projects" }));

    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText("Project progress")).toBeInTheDocument();
  });

  it("shows the empty state when the active tab has no views", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        teams: [{ id: "team-1", key: "ONB", name: "Onboarding QA Team" }],
        views: [],
      }),
    });

    render(<ViewsPage initialTab="issues" />);
    await waitForLoaded();

    expect(screen.getByText("No views")).toBeInTheDocument();
  });

  it("renders only views for the team-scoped route", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => buildViewsResponse(),
    });

    render(<ViewsPage initialTab="issues" initialTeamKey="ONB" />);
    await waitForLoaded();

    expect(screen.getByText("Onboarding QA Team")).toBeInTheDocument();
    expect(screen.getByText("High priority onboarding")).toBeInTheDocument();
    expect(screen.queryByText("Project progress")).not.toBeInTheDocument();
  });

  it("preserves workspace slug for team view tab navigation", async () => {
    mockWorkspaceSlug = "foreverbrowsing";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => buildViewsResponse(),
    });

    render(<ViewsPage initialTab="issues" initialTeamKeyFromRoute />);
    await waitForLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Projects" }));

    expect(push).toHaveBeenCalledWith(
      "/foreverbrowsing/team/ONB/views/projects",
    );
  });

  it("preserves workspace slug when opening saved issue and project views", async () => {
    mockWorkspaceSlug = "foreverbrowsing";
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => buildViewsResponse(),
    });

    render(<ViewsPage initialTab="issues" />);
    await waitForLoaded();

    fireEvent.click(await screen.findByText("High priority onboarding"));
    expect(push).toHaveBeenCalledWith("/foreverbrowsing/team/ONB/all");

    cleanup();
    push.mockClear();

    render(<ViewsPage initialTab="projects" />);
    await waitForLoaded();

    fireEvent.click(await screen.findByText("Project progress"));
    expect(push).toHaveBeenCalledWith("/foreverbrowsing/projects");
  });

  it("shows team not found for unknown team view routes", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => buildViewsResponse(),
    });

    render(<ViewsPage initialTab="issues" initialTeamKey="NOPE" />);
    await waitForLoaded();

    expect(screen.getByText("Team not found")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The team NOPE doesn't exist or you don't have access to it.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("No views")).not.toBeInTheDocument();
  });

  it("creates issue views with captured team filters", async () => {
    window.localStorage.setItem(
      "exponential-filters:team:ONB",
      JSON.stringify([{ type: "status", operator: "is", values: ["started"] }]),
    );
    window.localStorage.setItem(
      "exponential-display-options:team:ONB",
      JSON.stringify({
        groupBy: "assignee",
        subGroupBy: "none",
        orderBy: "updated",
        displayProperties: { labels: false },
        showSubIssues: false,
        showTriageIssues: true,
        showEmptyColumns: true,
      }),
    );

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ teams: buildViewsResponse().teams, views: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => buildIssuePreviewResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          view: buildViewsResponse().views[0],
        }),
      });

    render(<ViewsPage initialTab="issues" />);
    await waitForLoaded();

    fireEvent.click(screen.getAllByRole("button", { name: /create view/i })[0]);
    fireEvent.change(screen.getByPlaceholderText(/view name/i), {
      target: { value: "Filtered Issues" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/views",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"issueFilters":[{"type":"status"'),
        }),
      );
      const postCall = mockFetch.mock.calls.find(
        ([url, options]) =>
          url === "/api/views" &&
          (options as RequestInit | undefined)?.method === "POST",
      );
      expect(postCall).toBeTruthy();
      const body = JSON.parse((postCall?.[1] as RequestInit).body as string);
      expect(body.filterState.issueDisplayOptions).toMatchObject({
        groupBy: "assignee",
        orderBy: "updated",
        showSubIssues: false,
        showTriageIssues: true,
        showEmptyColumns: true,
      });
      expect(
        body.filterState.issueDisplayOptions.displayProperties.labels,
      ).toBe(false);
    });
  });

  it("creates issue views with editable filters, timeline, and display options", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ teams: buildViewsResponse().teams, views: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => buildIssuePreviewResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          view: {
            ...buildViewsResponse().views[0],
            name: "Timeline bugs",
            layout: "timeline",
          },
        }),
      });

    render(<ViewsPage initialTab="issues" />);
    await waitForLoaded();

    fireEvent.click(screen.getAllByRole("button", { name: /create view/i })[0]);
    fireEvent.change(screen.getByPlaceholderText(/view name/i), {
      target: { value: "Timeline bugs" },
    });

    await screen.findByText("2 of 2 matching");
    fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
    fireEvent.click(screen.getByRole("button", { name: /status/i }));
    fireEvent.click(screen.getByRole("button", { name: "Started" }));
    await screen.findByText("1 of 2 matching");

    fireEvent.click(screen.getByRole("button", { name: "timeline" }));
    fireEvent.change(screen.getByLabelText("Select issue group by"), {
      target: { value: "assignee" },
    });
    fireEvent.change(screen.getByLabelText("Select issue order by"), {
      target: { value: "updated" },
    });
    fireEvent.click(screen.getByLabelText("Labels"));
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        ([url, options]) =>
          url === "/api/views" &&
          (options as RequestInit | undefined)?.method === "POST",
      );
      expect(postCall).toBeTruthy();
      const body = JSON.parse((postCall?.[1] as RequestInit).body as string);
      expect(body.layout).toBe("timeline");
      expect(body.filterState.issueFilters).toEqual([
        { type: "status", operator: "is", values: ["started"] },
      ]);
      expect(body.filterState.issueDisplayOptions).toMatchObject({
        groupBy: "assignee",
        orderBy: "updated",
      });
      expect(
        body.filterState.issueDisplayOptions.displayProperties.labels,
      ).toBe(false);
    });
  });

  it("opens issue views by restoring filters and navigating to the team route", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => buildViewsResponse(),
    });

    render(<ViewsPage initialTab="issues" />);
    await waitForLoaded();

    fireEvent.click(await screen.findByText("High priority onboarding"));

    expect(window.localStorage.getItem("exponential-filters:team:ONB")).toBe(
      JSON.stringify([{ type: "priority", operator: "is", values: ["high"] }]),
    );
    expect(
      JSON.parse(
        window.localStorage.getItem("exponential-display-options:team:ONB") ??
          "{}",
      ),
    ).toMatchObject({ groupBy: "assignee", orderBy: "updated" });
    expect(push).toHaveBeenCalledWith("/team/ONB/all");
  });

  it("opens project views by restoring project view state", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => buildViewsResponse(),
    });

    render(<ViewsPage initialTab="projects" />);
    await waitForLoaded();

    fireEvent.click(screen.getByText("Project progress"));

    expect(
      window.localStorage.getItem("exponential-project-view:workspace"),
    ).toBe(
      JSON.stringify({
        statusFilter: "started",
        sortBy: "progress-desc",
        teamId: null,
      }),
    );
    expect(push).toHaveBeenCalledWith("/projects");
  });

  it("edits and deletes saved views", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => buildViewsResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => buildIssuePreviewResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          view: {
            ...buildViewsResponse().views[0],
            name: "Renamed view",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

    render(<ViewsPage initialTab="issues" />);
    await waitForLoaded();

    fireEvent.click(
      screen.getByRole("button", { name: "Edit High priority onboarding" }),
    );
    fireEvent.change(screen.getByPlaceholderText(/view name/i), {
      target: { value: "Renamed view" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/views/view-1",
        expect.objectContaining({ method: "PATCH" }),
      );
    });

    await screen.findByText("Renamed view");
    fireEvent.click(
      screen.getByRole("button", { name: "Delete Renamed view" }),
    );

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith("/api/views/view-1", {
        method: "DELETE",
      });
    });
  });
});

describe("Views API routes", () => {
  it("export the expected handlers", async () => {
    const fs = await import("node:fs");
    const listRoute = fs.readFileSync("src/app/api/views/route.ts", "utf-8");
    const detailRoute = fs.readFileSync(
      "src/app/api/views/[id]/route.ts",
      "utf-8",
    );

    expect(listRoute).toContain("export async function GET");
    expect(listRoute).toContain("export async function POST");
    expect(detailRoute).toContain("export async function GET");
    expect(detailRoute).toContain("export async function PATCH");
    expect(detailRoute).toContain("export async function DELETE");
  });
});
