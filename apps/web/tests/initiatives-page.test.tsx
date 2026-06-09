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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({}),
}));

import InitiativesPage from "@/app/(app)/initiatives/page";

const mockInitiativesData = {
  initiatives: [
    {
      id: "init-1",
      name: "Active Growth",
      description: "Scale",
      status: "active",
      projectCount: 2,
      completedProjectCount: 1,
      owner: { id: "user-1", name: "Ashley", image: null },
      teams: [{ id: "team-1", name: "Engineering", key: "ENG", icon: "🛠" }],
      targetDate: "2026-09-30T00:00:00.000Z",
      health: "onTrack",
      activeProjectHealthRollup: {
        total: 1,
        withUpdates: 1,
        withoutUpdates: 0,
        paused: 0,
      },
      createdAt: "2026-04-01T00:00:00.000Z",
    },
    {
      id: "init-2",
      name: "Planned Future",
      description: "Next",
      status: "planned",
      projectCount: 0,
      completedProjectCount: 0,
      health: "unknown",
      createdAt: "2026-04-02T00:00:00.000Z",
    },
    {
      id: "init-3",
      name: "Reliability Fixes",
      description: "Stabilize core flows",
      status: "active",
      projectCount: 1,
      completedProjectCount: 0,
      owner: { id: "user-2", name: "Morgan", image: null },
      teams: [{ id: "team-2", name: "Product", key: "PROD", icon: "📦" }],
      targetDate: null,
      health: "atRisk",
      activeProjectHealthRollup: {
        total: 1,
        withUpdates: 0,
        withoutUpdates: 1,
        paused: 0,
      },
      createdAt: "2026-03-01T00:00:00.000Z",
    },
  ],
  workspaceMembers: [
    { id: "user-1", name: "Ashley", image: null },
    { id: "user-2", name: "Morgan", image: null },
  ],
  workspaceTeams: [
    { id: "team-1", name: "Engineering", key: "ENG", icon: "🛠" },
    { id: "team-2", name: "Product", key: "PROD", icon: "📦" },
  ],
};

describe("InitiativesPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("renders active initiatives by default", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockInitiativesData,
    } as Response);

    render(<InitiativesPage />);

    expect(await screen.findByText("Active Growth")).toBeInTheDocument();
    expect(screen.queryByText("Planned Future")).not.toBeInTheDocument();
  });

  it("switches tabs to show planned initiatives", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockInitiativesData,
    } as Response);

    render(<InitiativesPage />);
    await screen.findByText("Active Growth");

    fireEvent.click(screen.getByRole("button", { name: "Planned" }));

    expect(await screen.findByText("Planned Future")).toBeInTheDocument();
    expect(screen.queryByText("Active Growth")).not.toBeInTheDocument();
  });

  it("renders toolbar controls and filters initiatives with shareable URL state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockInitiativesData,
    } as Response);

    render(<InitiativesPage />);
    expect(
      await screen.findByLabelText("Search initiatives"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by owner")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by team")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by health")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by target date")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Filter by active project state"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Sort initiatives")).toBeInTheDocument();
    expect(screen.getByLabelText("Group initiatives")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search initiatives"), {
      target: { value: "reliability" },
    });
    fireEvent.change(screen.getByLabelText("Filter by owner"), {
      target: { value: "user-2" },
    });
    fireEvent.change(screen.getByLabelText("Filter by team"), {
      target: { value: "team-2" },
    });
    fireEvent.change(screen.getByLabelText("Filter by health"), {
      target: { value: "atRisk" },
    });
    fireEvent.change(screen.getByLabelText("Filter by active project state"), {
      target: { value: "needsUpdate" },
    });

    expect(screen.getByText("Reliability Fixes")).toBeInTheDocument();
    expect(screen.queryByText("Active Growth")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(window.location.search).toContain("q=reliability"),
    );
    expect(window.location.search).toContain("owner=user-2");
    expect(window.location.search).toContain("team=team-2");
    expect(window.location.search).toContain("health=atRisk");
    expect(window.location.search).toContain("projects=needsUpdate");
  });

  it("hydrates scoped initiative display state from the URL", async () => {
    window.history.replaceState(
      null,
      "",
      "/foreverbrowsing/initiatives?status=planned&q=future&sort=health&group=health",
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockInitiativesData,
    } as Response);

    render(<InitiativesPage />);

    expect(await screen.findByText("Planned Future")).toBeInTheDocument();
    expect(screen.queryByText("Active Growth")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Search initiatives")).toHaveValue("future");
    expect(screen.getByLabelText("Sort initiatives")).toHaveValue("health");
    expect(screen.getByLabelText("Group initiatives")).toHaveValue("health");
    expect(
      screen.getByLabelText("Unknown initiatives group"),
    ).toBeInTheDocument();
  });

  it("creates a new initiative", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockInitiativesData,
    } as Response);

    render(<InitiativesPage />);
    await screen.findByText("Active Growth");

    fireEvent.click(screen.getByRole("button", { name: /New initiative/ }));

    fireEvent.change(screen.getByPlaceholderText("Initiative name"), {
      target: { value: "Super Growth" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("Summary or initiative document (optional)"),
      {
        target: { value: "More scale" },
      },
    );

    fireEvent.click(screen.getByRole("button", { name: "Create initiative" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/initiatives",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            name: "Super Growth",
            description: "More scale",
            status: "active",
            ownerId: undefined,
            teamIds: [],
            targetDate: undefined,
            health: "unknown",
          }),
        }),
      );
    });
  });

  it("shows empty state when no initiatives match", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ initiatives: [] }),
    } as Response);

    render(<InitiativesPage />);

    expect(await screen.findByText("No initiatives")).toBeInTheDocument();
  });
});
