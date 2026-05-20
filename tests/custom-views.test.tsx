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
          projectStatusFilter: "all",
          projectSortBy: "created-desc",
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
          projectStatusFilter: "started",
          projectSortBy: "progress-desc",
        },
        createdAt: "2026-01-02T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
      },
    ],
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

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ teams: buildViewsResponse().teams, views: [] }),
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
