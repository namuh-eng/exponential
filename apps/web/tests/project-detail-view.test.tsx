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

let mockParams: { slug: string; workspaceSlug?: string } = {
  slug: "agent-speed",
};

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => mockParams,
}));

import { ProjectDetailPage } from "@/components/project-detail-page";

const mockProjectData = {
  project: {
    id: "project-1",
    name: "Agent Speed",
    description: "Optimize things",
    icon: "⚡",
    slug: "agent-speed",
    status: "started",
    priority: "high",
    startDate: "2026-04-01T00:00:00Z",
    targetDate: "2026-06-01T00:00:00Z",
  },
  lead: { id: "user-1", name: "Ashley", image: null },
  members: [],
  teams: [{ id: "team-1", name: "Engineering", key: "ENG" }],
  labels: [],
  availableMembers: [],
  availableTeams: [{ id: "team-1", name: "Engineering", key: "ENG" }],
  availableLabels: [],
  slackChannel: "#speed",
  resources: [
    {
      id: "res-1",
      title: "Spec",
      type: "link",
      url: "https://test.com",
      createdAt: "2026-04-20T00:00:00Z",
    },
  ],
  activity: [
    {
      id: "act-1",
      title: "Updated project properties",
      type: "properties",
      body: "Changed status to started",
      actorName: "Ashley",
      createdAt: "2026-04-22T00:00:00Z",
    },
  ],
  milestones: [
    {
      id: "mile-1",
      name: "Phase 1",
      issueCount: 5,
      completedCount: 2,
      progress: 40,
    },
  ],
  issueGroups: [
    {
      state: {
        id: "state-1",
        name: "In Progress",
        category: "started",
        color: "#3b82f6",
      },
      issues: [
        {
          id: "iss-1",
          identifier: "ENG-1",
          title: "Optimize SVG",
          priority: "medium",
          assignee: { name: "Ashley" },
          createdAt: "2026-04-23T00:00:00Z",
          href: "/team/ENG/issue/iss-1",
          labels: [],
        },
      ],
    },
  ],
  progress: {
    total: 10,
    completed: 3,
    percentage: 30,
    assignees: [{ name: "Ashley", count: 5 }],
    labels: [],
  },
};

const mockCreateIssueOptions = {
  team: { id: "team-1", name: "Engineering", key: "ENG" },
  statuses: [
    {
      id: "state-1",
      name: "In Progress",
      category: "started",
      color: "#3b82f6",
    },
    {
      id: "state-backlog",
      name: "Backlog",
      category: "backlog",
      color: "#6b7280",
    },
  ],
  priorities: [
    { value: "none", label: "No priority" },
    { value: "medium", label: "Medium" },
  ],
  assignees: [{ id: "user-1", name: "Ashley", image: null }],
  labels: [],
  projects: [{ id: "project-1", name: "Agent Speed", icon: "⚡" }],
};

function setEditableValue(element: HTMLElement, value: string) {
  element.textContent = value;
  fireEvent.input(element);
}

describe("ProjectDetailPage UI", () => {
  afterEach(() => {
    cleanup();
    mockParams = { slug: "agent-speed" };
    window.history.pushState(null, "", "/");
    vi.clearAllMocks();
  });

  it("renders loading state then project details", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockProjectData,
    } as Response);

    render(<ProjectDetailPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    expect(await screen.findByText("Agent Speed")).toBeInTheDocument();
    expect(screen.getByText("Optimize things")).toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();
    expect(screen.getByText("3 of 10 issues completed")).toBeInTheDocument();
    expect(screen.getByText("Phase 1")).toBeInTheDocument();
    expect(screen.getByText("Spec")).toBeInTheDocument();
  });

  it("uses the workspace slug route param for deterministic project API lookup", async () => {
    mockParams = { slug: "agent-speed", workspaceSlug: "foreverbrowsing" };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockProjectData,
    } as Response);

    render(<ProjectDetailPage />);

    expect(await screen.findByText("Agent Speed")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/projects/agent-speed?workspaceSlug=foreverbrowsing",
    );
  });

  it("switches to activity tab", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockProjectData,
    } as Response);

    render(<ProjectDetailPage />);
    await screen.findByText("Agent Speed");

    fireEvent.click(screen.getByRole("button", { name: "Activity" }));

    // Find the Activity title which is a heading inside the content area
    const contentArea = screen
      .getByText("Updated project properties")
      .closest("div[class*='space-y-3']");
    expect(contentArea).not.toBeNull();
    if (contentArea) {
      expect(
        within(contentArea as HTMLElement).getByText(
          "Updated project properties",
        ),
      ).toBeInTheDocument();
      expect(
        within(contentArea as HTMLElement).getByText(
          "Changed status to started",
        ),
      ).toBeInTheDocument();
    }
  });

  it("switches to issues tab", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockProjectData,
    } as Response);

    render(<ProjectDetailPage />);
    await screen.findByText("Agent Speed");

    fireEvent.click(screen.getByRole("button", { name: "Issues" }));

    expect(screen.getByText("Optimize SVG")).toBeInTheDocument();
    expect(screen.getByText("ENG-1")).toBeInTheDocument();
  });

  it("lets empty project issue tabs create the first project issue and refreshes the list", async () => {
    const emptyProjectData = {
      ...mockProjectData,
      issueGroups: [],
      progress: {
        total: 0,
        completed: 0,
        percentage: 0,
        assignees: [],
        labels: [],
      },
    };
    const refreshedProjectData = {
      ...mockProjectData,
      issueGroups: [
        {
          state: {
            id: "state-backlog",
            name: "Backlog",
            category: "backlog",
            color: "#6b7280",
          },
          issues: [
            {
              id: "iss-2",
              identifier: "ENG-2",
              title: "Plan first project issue",
              priority: "none",
              assignee: null,
              createdAt: "2026-04-24T00:00:00Z",
              href: "/team/ENG/issue/iss-2",
              labels: [],
            },
          ],
        },
      ],
      progress: {
        total: 1,
        completed: 0,
        percentage: 0,
        assignees: [],
        labels: [],
      },
    };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);

        if (url === "/api/projects/agent-speed" && !init) {
          return {
            ok: true,
            json: async () =>
              fetchSpy.mock.calls.filter(
                ([calledUrl, calledInit]) =>
                  String(calledUrl) === "/api/projects/agent-speed" &&
                  !calledInit,
              ).length === 1
                ? emptyProjectData
                : refreshedProjectData,
          } as Response;
        }

        if (url === "/api/teams/ENG/create-issue-options") {
          return {
            ok: true,
            json: async () => mockCreateIssueOptions,
          } as Response;
        }

        if (url === "/api/issue-templates?teamKey=ENG") {
          return {
            ok: true,
            json: async () => ({ templates: [] }),
          } as Response;
        }

        if (url === "/api/issues" && init?.method === "POST") {
          return {
            ok: true,
            json: async () => ({ id: "iss-2" }),
          } as Response;
        }

        throw new Error(`Unhandled fetch: ${url}`);
      });

    render(<ProjectDetailPage />);
    await screen.findByText("Agent Speed");

    fireEvent.click(screen.getByRole("button", { name: "Issues" }));

    expect(
      screen.getByText("No issues in this project yet."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create issue" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Project" })).toHaveTextContent(
        "Agent Speed",
      );
    });

    setEditableValue(
      screen.getByRole("textbox", { name: "Issue title" }),
      "Plan first project issue",
    );
    fireEvent.click(screen.getByRole("button", { name: "Create Issue" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/issues",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"projectId":"project-1"'),
        }),
      );
    });
    expect(
      await screen.findByText("Plan first project issue"),
    ).toBeInTheDocument();
    expect(screen.getByText("ENG-2")).toBeInTheDocument();
  });

  it("keeps non-empty issue group add buttons project and state prefilled", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url === "/api/projects/agent-speed") {
        return {
          ok: true,
          json: async () => mockProjectData,
        } as Response;
      }

      if (url === "/api/teams/ENG/create-issue-options") {
        return {
          ok: true,
          json: async () => mockCreateIssueOptions,
        } as Response;
      }

      if (url === "/api/issue-templates?teamKey=ENG") {
        return {
          ok: true,
          json: async () => ({ templates: [] }),
        } as Response;
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<ProjectDetailPage />);
    await screen.findByText("Agent Speed");

    fireEvent.click(screen.getByRole("button", { name: "Issues" }));
    fireEvent.click(screen.getByRole("button", { name: "Add issue" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Status" })).toHaveTextContent(
        "In Progress",
      );
      expect(screen.getByRole("button", { name: "Project" })).toHaveTextContent(
        "Agent Speed",
      );
    });
  });

  it("updates project description", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockProjectData,
    } as Response);

    render(<ProjectDetailPage />);
    await screen.findByText("Agent Speed");

    const descSection = screen.getByText("Description").closest("div");
    expect(descSection).not.toBeNull();
    if (descSection) {
      fireEvent.click(
        within(descSection).getByRole("button", { name: "Edit" }),
      );
    }

    const textarea = screen.getByPlaceholderText(
      "Describe the goal, scope, and current state of this project.",
    );
    fireEvent.change(textarea, { target: { value: "New description" } });

    fireEvent.click(screen.getByRole("button", { name: "Save description" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/projects/agent-speed",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ description: "New description" }),
        }),
      );
    });
  });

  it("adds a link resource", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockProjectData,
    } as Response);

    render(<ProjectDetailPage />);
    await screen.findByText("Agent Speed");

    fireEvent.click(
      screen.getByRole("button", { name: "+ Add document or link" }),
    );

    fireEvent.change(screen.getByPlaceholderText("Resource title"), {
      target: { value: "Design Doc" },
    });
    fireEvent.change(screen.getByPlaceholderText("https://..."), {
      target: { value: "https://figma.com/test" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add resource" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/projects/agent-speed",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            resource: {
              type: "link",
              title: "Design Doc",
              url: "https://figma.com/test",
            },
          }),
        }),
      );
    });
  });

  it("opens and focuses the project update composer from the newUpdate query", async () => {
    window.history.pushState(
      null,
      "",
      "/project/agent-speed/overview?newUpdate=1",
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockProjectData,
    } as Response);

    render(<ProjectDetailPage />);

    const textarea = await screen.findByLabelText("Project update");
    await waitFor(() => expect(textarea).toHaveFocus());
    expect(textarea).toHaveAttribute(
      "placeholder",
      "Share a concise update with progress, blockers, or the next checkpoint.",
    );
  });

  it("posts a project update", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockProjectData,
    } as Response);

    render(<ProjectDetailPage />);
    await screen.findByText("Agent Speed");

    fireEvent.click(
      screen.getByRole("button", { name: /Write .* project update/ }),
    );

    const textarea = screen.getByPlaceholderText(
      "Share a concise update with progress, blockers, or the next checkpoint.",
    );
    fireEvent.change(textarea, { target: { value: "Shipped the MVP!" } });

    fireEvent.click(screen.getByRole("button", { name: "Post update" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/projects/agent-speed",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ projectUpdate: "Shipped the MVP!" }),
        }),
      );
    });
  });
});
