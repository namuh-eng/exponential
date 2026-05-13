import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({}),
}));

import { ProjectRow } from "@/components/project-row";
import { ProjectStatusBadge } from "@/components/project-status-badge";
import { ProjectsPage } from "@/components/projects-page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("ProjectRow", () => {
  const defaultProps = {
    name: "Agent Speed Optimization",
    icon: "⚡",
    slug: "agent-speed-optimization",
    status: "started" as const,
    priority: "high" as const,
    health: "No updates" as const,
    lead: { name: "Alice", image: undefined as string | undefined },
    targetDate: null as string | null,
    progress: 75,
  };

  it("renders project name with icon", () => {
    render(<ProjectRow {...defaultProps} />);
    expect(screen.getByText("Agent Speed Optimization")).toBeDefined();
    expect(screen.getByText("⚡")).toBeDefined();
  });

  it("renders health status", () => {
    render(<ProjectRow {...defaultProps} />);
    expect(screen.getByText("No updates")).toBeDefined();
  });

  it("renders lead avatar", () => {
    render(<ProjectRow {...defaultProps} />);
    expect(screen.getByTestId("project-lead")).toBeDefined();
  });

  it("renders progress percentage", () => {
    render(<ProjectRow {...defaultProps} />);
    expect(screen.getByText("75%")).toBeDefined();
  });

  it("renders target date when provided", () => {
    render(<ProjectRow {...defaultProps} targetDate="2026-02-05T00:00:00Z" />);
    expect(screen.getByText("Feb 5")).toBeDefined();
  });

  it("renders empty state when no target date", () => {
    render(<ProjectRow {...defaultProps} targetDate={null} />);
    // Should not crash, just no date shown
    expect(
      screen.queryByText(/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/),
    ).toBeNull();
  });

  it("renders priority icon", () => {
    render(<ProjectRow {...defaultProps} />);
    expect(screen.getByLabelText("High")).toBeDefined();
  });

  it("renders as a clickable link", () => {
    render(<ProjectRow {...defaultProps} />);
    const row = screen.getByTestId("project-row");
    expect(row).toBeDefined();
    expect(row).toHaveAttribute(
      "href",
      "/project/agent-speed-optimization/overview",
    );
  });

  it("renders 0% progress", () => {
    render(<ProjectRow {...defaultProps} progress={0} />);
    expect(screen.getByText("0%")).toBeDefined();
  });

  it("renders 100% progress with completed style", () => {
    render(<ProjectRow {...defaultProps} progress={100} status="completed" />);
    expect(screen.getByText("100%")).toBeDefined();
  });
});

describe("ProjectStatusBadge", () => {
  it("renders planned status", () => {
    render(<ProjectStatusBadge status="planned" />);
    expect(screen.getByText("Planned")).toBeDefined();
  });

  it("renders started status", () => {
    render(<ProjectStatusBadge status="started" />);
    expect(screen.getByText("In Progress")).toBeDefined();
  });

  it("renders completed status", () => {
    render(<ProjectStatusBadge status="completed" />);
    expect(screen.getByText("Completed")).toBeDefined();
  });

  it("renders paused status", () => {
    render(<ProjectStatusBadge status="paused" />);
    expect(screen.getByText("Paused")).toBeDefined();
  });

  it("renders canceled status", () => {
    render(<ProjectStatusBadge status="canceled" />);
    expect(screen.getByText("Canceled")).toBeDefined();
  });
});

describe("ProjectsPage", () => {
  it("filters projects by status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        projects: [
          {
            id: "project-1",
            name: "Alpha",
            icon: "A",
            slug: "alpha",
            status: "planned",
            priority: "none",
            health: "No updates",
            lead: null,
            teams: [],
            targetDate: null,
            progress: 0,
            createdAt: "2026-04-05T00:00:00.000Z",
          },
          {
            id: "project-2",
            name: "Beta",
            icon: "B",
            slug: "beta",
            status: "completed",
            priority: "high",
            health: "No updates",
            lead: null,
            teams: [],
            targetDate: null,
            progress: 100,
            createdAt: "2026-04-06T00:00:00.000Z",
          },
        ],
      }),
    } as Response);

    render(<ProjectsPage />);

    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter projects by status"), {
      target: { value: "completed" },
    });

    await waitFor(() => {
      expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
      expect(screen.getByText("Beta")).toBeInTheDocument();
    });
  });

  it("sorts projects by progress", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        projects: [
          {
            id: "project-1",
            name: "Alpha",
            icon: "A",
            slug: "alpha",
            status: "planned",
            priority: "none",
            health: "No updates",
            lead: null,
            teams: [],
            targetDate: null,
            progress: 10,
            createdAt: "2026-04-05T00:00:00.000Z",
          },
          {
            id: "project-2",
            name: "Beta",
            icon: "B",
            slug: "beta",
            status: "started",
            priority: "high",
            health: "No updates",
            lead: null,
            teams: [],
            targetDate: null,
            progress: 90,
            createdAt: "2026-04-06T00:00:00.000Z",
          },
        ],
      }),
    } as Response);

    render(<ProjectsPage />);

    await screen.findByText("Alpha");
    fireEvent.change(screen.getByLabelText("Sort projects"), {
      target: { value: "progress-desc" },
    });

    await waitFor(() => {
      const rows = screen.getAllByTestId("project-row");
      expect(within(rows[0]).getByText("Beta")).toBeInTheDocument();
      expect(within(rows[1]).getByText("Alpha")).toBeInTheDocument();
    });
  });

  it("toggles the create project form and submits", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((url, init) => {
        if (url === "/api/projects" && init?.method === "POST") {
          return Promise.resolve({
            ok: true,
            json: async () => ({ id: "p3" }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ projects: [] }),
        } as Response);
      });

    render(<ProjectsPage />);

    // Renders empty state first
    const createBtn = await screen.findByRole("button", {
      name: "Create project",
    });
    fireEvent.click(createBtn);

    // Form should appear
    const nameInput = screen.getByPlaceholderText("Project name");
    fireEvent.change(nameInput, { target: { value: "New Project" } });

    const descInput = screen.getByPlaceholderText("Description (optional)");
    fireEvent.change(descInput, { target: { value: "A new description" } });

    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/projects",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            name: "New Project",
            description: "A new description",
          }),
        }),
      );
    });
  });

  it("submits team context from a team-scoped empty projects page", async () => {
    let created = false;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((url, init) => {
        if (url === "/api/teams/ONB/settings") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              team: { id: "team-1", key: "ONB", name: "Onboarding QA Team" },
            }),
          } as Response);
        }

        if (url === "/api/projects" && init?.method === "POST") {
          created = true;
          return Promise.resolve({
            ok: true,
            json: async () => ({
              id: "project-1",
              slug: "onboarding-roadmap",
              teams: [{ id: "team-1", key: "ONB", name: "Onboarding QA Team" }],
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          json: async () => ({
            projects: created
              ? [
                  {
                    id: "project-1",
                    name: "Onboarding roadmap",
                    icon: "O",
                    slug: "onboarding-roadmap",
                    status: "planned",
                    priority: "none",
                    health: "No updates",
                    lead: null,
                    teams: [
                      { id: "team-1", key: "ONB", name: "Onboarding QA Team" },
                    ],
                    targetDate: null,
                    progress: 0,
                    createdAt: "2026-04-05T00:00:00.000Z",
                  },
                ]
              : [],
          }),
        } as Response);
      });

    render(<ProjectsPage initialTeamKey="ONB" />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Create project" }),
    );
    fireEvent.change(screen.getByPlaceholderText("Project name"), {
      target: { value: "Onboarding roadmap" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/projects",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            name: "Onboarding roadmap",
            description: "",
            teamKey: "ONB",
          }),
        }),
      );
    });
    expect(await screen.findByText("Onboarding roadmap")).toBeInTheDocument();
    expect(screen.getByText("1 of 1 projects")).toBeInTheDocument();
  });

  it("renders team-scoped projects and validates the team route", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      if (url === "/api/teams/ONB/settings") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            team: { id: "team-1", key: "ONB", name: "Onboarding QA Team" },
          }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({
          projects: [
            {
              id: "project-1",
              name: "Onboarding roadmap",
              icon: "O",
              slug: "onboarding-roadmap",
              status: "started",
              priority: "high",
              health: "No updates",
              lead: null,
              teams: [{ id: "team-1", key: "ONB", name: "Onboarding QA Team" }],
              targetDate: null,
              progress: 25,
              createdAt: "2026-04-05T00:00:00.000Z",
            },
            {
              id: "project-2",
              name: "Platform roadmap",
              icon: "P",
              slug: "platform-roadmap",
              status: "started",
              priority: "medium",
              health: "No updates",
              lead: null,
              teams: [{ id: "team-2", key: "PLT", name: "Platform" }],
              targetDate: null,
              progress: 50,
              createdAt: "2026-04-06T00:00:00.000Z",
            },
          ],
        }),
      } as Response);
    });

    render(<ProjectsPage initialTeamKey="ONB" />);

    expect(
      await screen.findByText("Onboarding QA Team Projects"),
    ).toBeInTheDocument();
    expect(screen.getByText("Onboarding roadmap")).toBeInTheDocument();
    expect(screen.queryByText("Platform roadmap")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 1 projects")).toBeInTheDocument();
  });

  it("shows the team not found state for unknown team project routes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "Team not found" }),
    } as Response);

    render(<ProjectsPage initialTeamKey="NOPE" />);

    expect(await screen.findByText("Team not found")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The team NOPE doesn't exist or you don't have access to it.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("No projects")).not.toBeInTheDocument();
  });
});
