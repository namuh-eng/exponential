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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useParams: () => ({ id: "init-1" }),
}));

import InitiativeDetailPage from "@/app/(app)/initiatives/[id]/page";

const mockInitiativeData = {
  initiative: {
    id: "init-1",
    name: "Growth",
    description: "Scale things",
    status: "active",
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
};

describe("InitiativeDetailPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
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
    expect(screen.getByText("1 / 2 projects completed")).toBeInTheDocument();
    expect(screen.getByText("Referrals")).toBeInTheDocument();
    expect(screen.getByText("Doing well")).toBeInTheDocument();
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
});
