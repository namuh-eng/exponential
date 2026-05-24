import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ slug: "agent-speed" }),
}));

import { MilestoneRow } from "@/components/milestone-row";
import { ProjectDetailPage } from "@/components/project-detail-page";
import { ProjectProperties } from "@/components/project-properties";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setEditableValue(element: HTMLElement, value: string) {
  element.textContent = value;
  fireEvent.input(element);
}

describe("ProjectProperties", () => {
  const defaultProps = {
    status: "planned" as const,
    priority: "high" as const,
    lead: null as { id: string; name: string; image?: string | null } | null,
    members: [] as { id: string; name: string; image?: string | null }[],
    startDate: null as string | null,
    targetDate: null as string | null,
    teams: [] as { id: string; name: string; key: string }[],
    labels: [] as { id: string; name: string; color: string }[],
    slackChannel: null as string | null,
    availableMembers: [] as {
      id: string;
      name: string;
      image?: string | null;
    }[],
    availableTeams: [] as { id: string; name: string; key: string }[],
    availableLabels: [] as { id: string; name: string; color: string }[],
  };

  it("renders status property", () => {
    render(<ProjectProperties {...defaultProps} />);
    expect(screen.getByText("Status")).toBeDefined();
    expect(screen.getByText("Planned")).toBeDefined();
  });

  it("renders priority property", () => {
    render(<ProjectProperties {...defaultProps} />);
    expect(screen.getByText("Priority")).toBeDefined();
    expect(screen.getByText("High")).toBeDefined();
  });

  it("renders lead when provided", () => {
    render(
      <ProjectProperties
        {...defaultProps}
        lead={{ id: "user-1", name: "Alice" }}
      />,
    );
    expect(screen.getByText("Lead")).toBeDefined();
    expect(screen.getByText("Alice")).toBeDefined();
  });

  it("shows 'Add lead' when no lead", () => {
    render(<ProjectProperties {...defaultProps} />);
    expect(screen.getByText("Add lead")).toBeDefined();
  });

  it("renders team names", () => {
    render(
      <ProjectProperties
        {...defaultProps}
        teams={[{ id: "team-1", name: "Engineering", key: "ENG" }]}
      />,
    );
    expect(screen.getByText("Teams")).toBeDefined();
    expect(screen.getByText("Engineering")).toBeDefined();
  });

  it("renders dates section", () => {
    render(
      <ProjectProperties
        {...defaultProps}
        startDate="2026-01-01T00:00:00Z"
        targetDate="2026-06-01T00:00:00Z"
      />,
    );
    expect(screen.getByText("Dates")).toBeDefined();
    expect(screen.getByText(/Jan 1/)).toBeDefined();
  });

  it("renders labels", () => {
    render(
      <ProjectProperties
        {...defaultProps}
        labels={[{ id: "label-1", name: "Frontend", color: "#ff0000" }]}
      />,
    );
    expect(screen.getByText("Labels")).toBeDefined();
    expect(screen.getByText("Frontend")).toBeDefined();
  });

  it("shows 'Add label' when no labels", () => {
    render(<ProjectProperties {...defaultProps} />);
    expect(screen.getByText("Add label")).toBeDefined();
  });

  it("renders slack channel when provided", () => {
    render(
      <ProjectProperties {...defaultProps} slackChannel="#project-updates" />,
    );
    expect(screen.getByText("Slack")).toBeDefined();
    expect(screen.getByText("#project-updates")).toBeDefined();
  });
});

describe("MilestoneRow", () => {
  it("renders milestone name", () => {
    render(
      <MilestoneRow
        name="Tier 1: Quick Wins"
        progress={100}
        issueCount={2}
        completedCount={2}
      />,
    );
    expect(screen.getByText("Tier 1: Quick Wins")).toBeDefined();
  });

  it("renders progress percentage", () => {
    render(
      <MilestoneRow
        name="Tier 2"
        progress={50}
        issueCount={4}
        completedCount={2}
      />,
    );
    expect(screen.getByText("50%")).toBeDefined();
  });

  it("renders issue count", () => {
    render(
      <MilestoneRow
        name="Tier 3"
        progress={0}
        issueCount={5}
        completedCount={0}
      />,
    );
    expect(screen.getByText(/of 5/)).toBeDefined();
  });

  it("renders progress bar", () => {
    render(
      <MilestoneRow
        name="Tier 1"
        progress={75}
        issueCount={4}
        completedCount={3}
      />,
    );
    expect(screen.getByTestId("milestone-progress-bar")).toBeDefined();
  });
});

describe("ProjectDetailPage", () => {
  it("opens create issue from an issues group on the project detail page", async () => {
    global.fetch = vi.fn((input) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/api/projects/agent-speed") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              project: {
                id: "project-1",
                name: "Agent Speed",
                description: "Latency work",
                icon: "⚡",
                slug: "agent-speed",
                status: "planned",
                priority: "high",
                startDate: null,
                targetDate: null,
              },
              lead: null,
              members: [],
              teams: [{ id: "team-1", name: "Engineering", key: "ENG" }],
              labels: [],
              availableMembers: [],
              availableTeams: [
                { id: "team-1", name: "Engineering", key: "ENG" },
              ],
              availableLabels: [],
              slackChannel: null,
              resources: [],
              activity: [],
              milestones: [],
              issueGroups: [
                {
                  state: {
                    id: "state-1",
                    name: "Backlog",
                    category: "backlog",
                    color: "#6b7280",
                  },
                  issues: [
                    {
                      id: "issue-1",
                      identifier: "ENG-1",
                      title: "Trim DOM payload",
                      priority: "medium",
                      assignee: null,
                      createdAt: "2026-04-07T00:00:00.000Z",
                      href: "/team/ENG/issue/issue-1",
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
            }),
        });
      }

      if (url === "/api/teams/ENG/create-issue-options") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              team: { id: "team-1", name: "Engineering", key: "ENG" },
              statuses: [
                {
                  id: "state-1",
                  name: "Backlog",
                  category: "backlog",
                  color: "#6b7280",
                },
              ],
              priorities: [{ value: "none", label: "No priority" }],
              assignees: [],
              labels: [],
              projects: [{ id: "project-1", name: "Agent Speed", icon: "⚡" }],
            }),
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    render(<ProjectDetailPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Issues" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add issue" }));

    expect(await screen.findByText("New issue")).toBeDefined();
    expect(screen.getAllByText("Agent Speed").length).toBeGreaterThan(1);
  });

  it("creates the first project issue from the empty issues tab", async () => {
    const projectResponse = {
      project: {
        id: "project-1",
        name: "Agent Speed",
        description: "Latency work",
        icon: "⚡",
        slug: "agent-speed",
        status: "planned",
        priority: "high",
        startDate: null,
        targetDate: null,
      },
      lead: null,
      members: [],
      teams: [{ id: "team-1", name: "Engineering", key: "ENG" }],
      labels: [],
      availableMembers: [],
      availableTeams: [{ id: "team-1", name: "Engineering", key: "ENG" }],
      availableLabels: [],
      slackChannel: null,
      resources: [],
      activity: [],
      milestones: [],
      issueGroups: [],
      progress: {
        total: 0,
        completed: 0,
        percentage: 0,
        assignees: [],
        labels: [],
      },
    };
    const refreshedProjectResponse = {
      ...projectResponse,
      issueGroups: [
        {
          state: {
            id: "state-1",
            name: "Backlog",
            category: "backlog",
            color: "#6b7280",
          },
          issues: [
            {
              id: "issue-2",
              identifier: "ENG-2",
              title: "Plan first project task",
              priority: "none",
              assignee: null,
              createdAt: "2026-04-08T00:00:00.000Z",
              href: "/team/ENG/issue/issue-2",
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
    let projectFetchCount = 0;
    const fetchSpy = vi.fn((input) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/api/projects/agent-speed") {
        projectFetchCount += 1;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve(
              projectFetchCount > 1
                ? refreshedProjectResponse
                : projectResponse,
            ),
        });
      }

      if (url === "/api/teams/ENG/create-issue-options") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              team: { id: "team-1", name: "Engineering", key: "ENG" },
              statuses: [
                {
                  id: "state-1",
                  name: "Backlog",
                  category: "backlog",
                  color: "#6b7280",
                },
              ],
              priorities: [{ value: "none", label: "No priority" }],
              assignees: [],
              labels: [],
              projects: [{ id: "project-1", name: "Agent Speed", icon: "⚡" }],
            }),
        });
      }

      if (url === "/api/issue-templates") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ templates: [] }),
        });
      }

      if (url === "/api/issues") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: "issue-2" }),
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    global.fetch = fetchSpy;

    render(<ProjectDetailPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Issues" }));
    expect(
      await screen.findByText("No issues in this project yet."),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Create issue" }));
    expect(await screen.findByText("New issue")).toBeDefined();
    expect(screen.getAllByText("Agent Speed").length).toBeGreaterThan(1);

    setEditableValue(
      screen.getByRole("textbox", { name: "Issue title" }),
      "Plan first project task",
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
    expect(await screen.findByText("Plan first project task")).toBeDefined();
  });
});
