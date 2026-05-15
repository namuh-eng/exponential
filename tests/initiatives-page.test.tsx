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
      createdAt: "2026-04-02T00:00:00.000Z",
    },
  ],
  workspaceMembers: [{ id: "user-1", name: "Ashley", image: null }],
  workspaceTeams: [
    { id: "team-1", name: "Engineering", key: "ENG", icon: "🛠" },
  ],
};

describe("InitiativesPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
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
