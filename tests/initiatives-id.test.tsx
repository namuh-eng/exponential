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
let mockedWorkspaceSlug: string | undefined;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useParams: () => ({ id: "init-1" }),
}));

vi.mock("@/app/(app)/app-shell", () => ({
  useAppShellContext: () =>
    mockedWorkspaceSlug ? { workspaceSlug: mockedWorkspaceSlug } : null,
}));

import InitiativeDetailPage from "@/app/(app)/initiatives/[id]/page";

const mockInitiativeData = {
  initiative: {
    id: "init-1",
    name: "Growth",
    description: "Scale things",
    status: "active",
    ownerId: "user-1",
    owner: { id: "user-1", name: "Ashley", image: null },
    teams: [{ id: "team-1", name: "Growth", key: "GRO", icon: "🚀" }],
    startDate: "2026-04-01T00:00:00.000Z",
    targetDate: "2026-09-30T00:00:00.000Z",
    timeframe: "Q3 2026",
    health: "onTrack",
    parentInitiativeId: null,
    parentInitiative: null,
    childInitiatives: [],
    projectCount: 2,
    completedProjectCount: 1,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  },
  projects: [
    {
      id: "proj-1",
      name: "Referrals",
      status: "completed",
      icon: "🚀",
      slug: "referrals",
      completedIssueCount: 10,
      issueCount: 10,
    },
  ],
  availableProjects: [
    {
      id: "proj-2",
      name: "Ads",
      icon: "📢",
      slug: "ads",
      status: "started",
    },
  ],
  workspaceMembers: [{ id: "user-1", name: "Ashley", image: null }],
  workspaceTeams: [{ id: "team-1", name: "Growth", key: "GRO", icon: "🚀" }],
  availableParentInitiatives: [],
  updates: [
    {
      id: "up-1",
      health: "onTrack",
      body: "Doing well",
      actorName: "Ashley",
      actorImage: null,
      createdAt: "2026-04-25T10:00:00.000Z",
    },
  ],
  activity: [
    {
      id: "act-1",
      type: "property_change",
      message: "Status changed from planned to active",
      actorName: "Ashley",
      actorImage: null,
      createdAt: "2026-04-25T09:00:00.000Z",
    },
  ],
};

describe("InitiativeDetailPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockedWorkspaceSlug = undefined;
  });

  it("renders loading state then initiative details", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockInitiativeData,
    } as Response);

    render(<InitiativeDetailPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    expect(await screen.findByText("Growth")).toBeInTheDocument();
    expect(screen.getByText("Scale things")).toBeInTheDocument();
    expect(screen.getByLabelText("Initiative owner")).toHaveValue("user-1");
    expect(screen.getByLabelText("Initiative target date")).toHaveValue(
      "2026-09-30",
    );
    expect(screen.getByText("1 / 2 projects completed")).toBeInTheDocument();
    expect(screen.getByText("Referrals")).toBeInTheDocument();
    expect(screen.getByText("Doing well")).toBeInTheDocument();
    expect(
      screen.getByText("Status changed from planned to active"),
    ).toBeInTheDocument();
  });

  it("links a new project", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockInitiativeData,
    } as Response);

    render(<InitiativeDetailPage />);
    await screen.findByText("Growth");

    fireEvent.change(screen.getByLabelText("Available projects"), {
      target: { value: "proj-2" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Link project" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/initiatives/init-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ addProjectId: "proj-2" }),
        }),
      );
    });
  });

  it("posts a status update", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockInitiativeData,
    } as Response);

    render(<InitiativeDetailPage />);
    await screen.findByText("Growth");

    fireEvent.change(screen.getByLabelText("Initiative update health"), {
      target: { value: "atRisk" },
    });

    fireEvent.change(
      screen.getByPlaceholderText("Post the latest initiative update."),
      {
        target: { value: "Hit a snag" },
      },
    );

    fireEvent.click(screen.getByRole("button", { name: "Post update" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/initiatives/init-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            initiativeUpdate: "Hit a snag",
            updateHealth: "atRisk",
          }),
        }),
      );
    });
  });

  it("sets and clears the parent initiative", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mockInitiativeData,
        availableParentInitiatives: [
          {
            id: "init-parent",
            name: "Company roadmap",
            status: "active",
            parentInitiativeId: null,
          },
        ],
      }),
    } as Response);

    render(<InitiativeDetailPage />);
    await screen.findByText("Growth");

    fireEvent.change(screen.getByLabelText("Parent initiative"), {
      target: { value: "init-parent" },
    });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/initiatives/init-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ parentInitiativeId: "init-parent" }),
        }),
      );
    });

    fetchSpy.mockClear();
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mockInitiativeData,
        initiative: {
          ...mockInitiativeData.initiative,
          parentInitiativeId: "init-parent",
          parentInitiative: {
            id: "init-parent",
            name: "Company roadmap",
            status: "active",
          },
        },
        availableParentInitiatives: [
          {
            id: "init-parent",
            name: "Company roadmap",
            status: "active",
            parentInitiativeId: null,
          },
        ],
      }),
    } as Response);

    render(<InitiativeDetailPage />);
    await screen.findByText("Clear parent");
    fireEvent.click(screen.getByRole("button", { name: "Clear parent" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/initiatives/init-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ parentInitiativeId: null }),
        }),
      );
    });
  });

  it("removes an existing child initiative without navigating", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mockInitiativeData,
        initiative: {
          ...mockInitiativeData.initiative,
          childInitiatives: [
            { id: "init-child", name: "Mobile expansion", status: "planned" },
          ],
        },
      }),
    } as Response);

    render(<InitiativeDetailPage />);
    await screen.findByText("Mobile expansion");

    fireEvent.click(
      screen.getByRole("button", { name: "Remove from initiative" }),
    );

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/initiatives/init-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ removeChildInitiativeId: "init-child" }),
        }),
      );
    });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("deletes the initiative", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockInitiativeData,
    } as Response);

    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<InitiativeDetailPage />);
    await screen.findByText("Growth");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/initiatives/init-1",
        expect.objectContaining({
          method: "DELETE",
        }),
      );
      expect(pushMock).toHaveBeenCalledWith("/initiatives");
    });
  });

  it("returns to the workspace-prefixed initiatives list from workspace detail routes", async () => {
    mockedWorkspaceSlug = "foreverbrowsing";
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockInitiativeData,
    } as Response);

    render(<InitiativeDetailPage />);
    await screen.findByText("Growth");

    fireEvent.click(screen.getByRole("button", { name: "Initiatives" }));

    expect(pushMock).toHaveBeenCalledWith("/foreverbrowsing/initiatives");
  });
});
