import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import InboxPage from "@/app/(app)/inbox/page";
import InitiativesPage from "@/app/(app)/initiatives/page";
import MyIssuesTabPage from "@/app/(app)/my-issues/[tab]/page";
import ProjectsPage from "@/app/(app)/projects/page";
import TeamIssuesPage from "@/app/(app)/team/[key]/all/page";
import TeamBoardPage from "@/app/(app)/team/[key]/board/page";
import TeamCyclesPage from "@/app/(app)/team/[key]/cycles/page";
import TeamTriagePage from "@/app/(app)/team/[key]/triage/page";
import { EmptyState } from "@/components/empty-state";

vi.mock("next/navigation", () => ({
  usePathname: () => "/team/ENG/all",
  useParams: () => ({ key: "ENG" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const createIssueOptionsResponse = {
  team: { id: "team-1", name: "Engineering", key: "ENG" },
  statuses: [
    {
      id: "state-1",
      name: "Backlog",
      category: "backlog",
      color: "#6b6f76",
    },
  ],
  priorities: [{ value: "none", label: "No priority" }],
  assignees: [],
  labels: [],
  projects: [],
};

function setEditableValue(element: HTMLElement, value: string) {
  element.textContent = value;
  fireEvent.input(element);
}

describe("EmptyState component", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders title", () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.getByText("Nothing here")).toBeDefined();
  });

  it("renders description when provided", () => {
    render(<EmptyState title="Empty" description="No items found" />);
    expect(screen.getByText("No items found")).toBeDefined();
  });

  it("does not render description when not provided", () => {
    render(<EmptyState title="Empty" />);
    expect(screen.queryByText("No items found")).toBeNull();
  });

  it("renders icon when provided", () => {
    render(
      <EmptyState
        title="Empty"
        icon={<span data-testid="test-icon">icon</span>}
      />,
    );
    expect(screen.getByTestId("test-icon")).toBeDefined();
  });

  it("renders action button when onClick provided", () => {
    const onClick = vi.fn();
    render(<EmptyState title="Empty" action={{ label: "Create", onClick }} />);
    const button = screen.getByRole("button", { name: "Create" });
    expect(button).toBeDefined();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalled();
  });

  it("renders action link when href provided", () => {
    render(
      <EmptyState
        title="Empty"
        action={{ label: "Go to settings", href: "/settings" }}
      />,
    );
    const link = screen.getByRole("link", { name: "Go to settings" });
    expect(link).toBeDefined();
    expect(link.getAttribute("href")).toBe("/settings");
  });
});

describe("Empty state pages", () => {
  afterEach(() => {
    cleanup();
  });

  it("Team Issues page shows 'No issues' with create CTA", async () => {
    global.fetch = vi.fn((input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/create-issue-options")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(createIssueOptionsResponse),
        });
      }

      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            team: { id: "1", name: "Engineering", key: "ENG" },
            groups: [],
          }),
      });
    }) as unknown as typeof fetch;
    render(<TeamIssuesPage />);
    expect(
      await screen.findByText("No issues", {}, { timeout: 2000 }),
    ).toBeDefined();
    expect(screen.getByText("Create issue")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Create issue" }));
    expect(await screen.findByText("New issue")).toBeDefined();
    expect(screen.getByRole("textbox", { name: "Issue title" })).toBeDefined();
  });

  it("Team Issues page recovers from empty state after creating the first issue", async () => {
    let issueCreated = false;
    global.fetch = vi.fn((input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/create-issue-options")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(createIssueOptionsResponse),
        });
      }
      if (url === "/api/issues" && init?.method === "POST") {
        issueCreated = true;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: "issue-1" }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            team: { id: "team-1", name: "Engineering", key: "ENG" },
            groups: issueCreated
              ? [
                  {
                    state: {
                      id: "state-1",
                      name: "Backlog",
                      category: "backlog",
                      color: "#6b6f76",
                      position: 1,
                    },
                    issues: [
                      {
                        id: "issue-1",
                        number: 1,
                        identifier: "ENG-1",
                        title: "First issue",
                        priority: "none",
                        stateId: "state-1",
                        assigneeId: null,
                        assignee: null,
                        labels: [],
                        labelIds: [],
                        projectId: null,
                        dueDate: null,
                        createdAt: "2026-04-07T00:00:00.000Z",
                      },
                    ],
                  },
                ]
              : [],
            filterOptions: {
              statuses: [],
              assignees: [],
              labels: [],
              priorities: [],
            },
          }),
      });
    }) as unknown as typeof fetch;

    render(<TeamIssuesPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Create issue" }),
    );
    setEditableValue(
      screen.getByRole("textbox", { name: "Issue title" }),
      "First issue",
    );
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Create Issue" }),
      ).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Issue" }));

    await waitFor(() => {
      expect(screen.getByText("ENG-1")).toBeDefined();
      expect(screen.getByText("First issue")).toBeDefined();
    });
  });

  it("Team Issues page renders issue detail links and project names for populated groups", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          team: { id: "team-1", name: "Engineering", key: "ENG" },
          groups: [
            {
              state: {
                id: "state-1",
                name: "Backlog",
                category: "backlog",
                color: "#6b6f76",
                position: 1,
              },
              issues: [
                {
                  id: "issue-1",
                  number: 1,
                  identifier: "ENG-1",
                  title: "Linked issue",
                  priority: "high",
                  stateId: "state-1",
                  assigneeId: "user-1",
                  assignee: { name: "Jane Doe" },
                  labels: [{ name: "bug", color: "#ef4444" }],
                  labelIds: ["bug"],
                  projectId: "project-1",
                  projectName: "Roadmap",
                  dueDate: null,
                  createdAt: "2026-04-07T00:00:00.000Z",
                },
              ],
            },
          ],
          filterOptions: {
            statuses: [],
            assignees: [],
            labels: [],
            priorities: [],
          },
        }),
    });

    const { container } = render(<TeamIssuesPage />);

    await waitFor(() => {
      expect(screen.getByText("Roadmap")).toBeDefined();
      expect(
        container.querySelector("a[href='/team/ENG/issue/issue-1']"),
      ).toBeTruthy();
    });
  });

  it("Team Issues page opens the create modal from a group header add button", async () => {
    global.fetch = vi.fn((input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/create-issue-options")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(createIssueOptionsResponse),
        });
      }

      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            team: { id: "team-1", name: "Engineering", key: "ENG" },
            groups: [
              {
                state: {
                  id: "state-1",
                  name: "Backlog",
                  category: "backlog",
                  color: "#6b6f76",
                  position: 1,
                },
                issues: [
                  {
                    id: "issue-1",
                    number: 1,
                    identifier: "ENG-1",
                    title: "First issue",
                    priority: "none",
                    stateId: "state-1",
                    assigneeId: null,
                    assignee: null,
                    labels: [],
                    labelIds: [],
                    projectId: null,
                    projectName: null,
                    dueDate: null,
                    createdAt: "2026-04-07T00:00:00.000Z",
                  },
                ],
              },
            ],
            filterOptions: {
              statuses: [],
              assignees: [],
              labels: [],
              priorities: [],
            },
          }),
      });
    }) as unknown as typeof fetch;

    render(<TeamIssuesPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Add issue" }));

    const dialog = await screen.findByRole("dialog", {
      name: /create issue for engineering/i,
    });
    expect(within(dialog).getByText("Backlog")).toBeDefined();
    expect(
      within(dialog).getByRole("textbox", { name: "Issue title" }),
    ).toBeDefined();
  });

  it("Team Board page shows 'No issues' with create CTA", async () => {
    global.fetch = vi.fn((input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/create-issue-options")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(createIssueOptionsResponse),
        });
      }

      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            team: { id: "1", name: "Engineering", key: "ENG" },
            groups: [],
          }),
      });
    }) as unknown as typeof fetch;
    render(<TeamBoardPage />);
    expect(
      await screen.findByText("No issues", {}, { timeout: 2000 }),
    ).toBeDefined();
    expect(screen.getByText("Create issue")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Create issue" }));
    expect(await screen.findByText("New issue")).toBeDefined();
    expect(screen.getByRole("textbox", { name: "Issue title" })).toBeDefined();
  });

  it("Team Board page recovers from empty state after creating the first issue", async () => {
    let issueCreated = false;
    global.fetch = vi.fn((input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/create-issue-options")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(createIssueOptionsResponse),
        });
      }
      if (url === "/api/issues" && init?.method === "POST") {
        issueCreated = true;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: "issue-1" }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            team: { id: "team-1", name: "Engineering", key: "ENG" },
            groups: issueCreated
              ? [
                  {
                    state: {
                      id: "state-1",
                      name: "Backlog",
                      category: "backlog",
                      color: "#6b6f76",
                    },
                    issues: [
                      {
                        id: "issue-1",
                        identifier: "ENG-1",
                        title: "First board issue",
                        priority: "none",
                        stateId: "state-1",
                        assigneeId: null,
                        assignee: null,
                        labels: [],
                        labelIds: [],
                        projectId: null,
                        createdAt: "2026-04-07T00:00:00.000Z",
                      },
                    ],
                  },
                ]
              : [],
            filterOptions: {
              statuses: [],
              assignees: [],
              labels: [],
              priorities: [],
            },
          }),
      });
    }) as unknown as typeof fetch;

    render(<TeamBoardPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Create issue" }),
    );
    setEditableValue(
      screen.getByRole("textbox", { name: "Issue title" }),
      "First board issue",
    );
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Create Issue" }),
      ).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Issue" }));

    await waitFor(() => {
      expect(screen.getByText("ENG-1")).toBeDefined();
      expect(screen.getByText("First board issue")).toBeDefined();
    });
  });

  it("Team Cycles page shows 'No active cycle'", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          team: { id: "1", name: "Engineering", key: "ENG" },
          cycles: [],
        }),
    }) as unknown as typeof fetch;
    render(<TeamCyclesPage />);
    expect(
      await screen.findByText("No active cycle", {}, { timeout: 2000 }),
    ).toBeDefined();
  });

  it("Team Triage page shows 'No issues to triage'", async () => {
    global.fetch = vi.fn((input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/create-issue-options")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(createIssueOptionsResponse),
        });
      }

      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            team: { id: "1", name: "Engineering", key: "ENG" },
            issues: [],
            count: 0,
          }),
      });
    }) as unknown as typeof fetch;
    render(<TeamTriagePage />);
    expect(
      await screen.findByText("No issues to triage", {}, { timeout: 2000 }),
    ).toBeDefined();
    expect(screen.getByText("Create triage issue")).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: "Create triage issue" }),
    );
    expect(await screen.findByText("New issue")).toBeDefined();
    expect(screen.getByRole("textbox", { name: "Issue title" })).toBeDefined();
  });

  it("Projects page shows 'No projects' with create CTA", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ projects: [] }),
    });
    render(<ProjectsPage />);
    expect(
      await screen.findByText("No projects", {}, { timeout: 2000 }),
    ).toBeDefined();
    expect(screen.getByText("Create project")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    expect(await screen.findByPlaceholderText("Project name")).toBeDefined();
  });

  it("Inbox page shows 'You're all caught up'", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ notifications: [] }),
    }) as unknown as typeof fetch;
    render(<InboxPage />);
    expect(
      await screen.findByText("You're all caught up", {}, { timeout: 2000 }),
    ).toBeDefined();
  });

  it("My Issues page shows 'No issues assigned'", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          groups: [],
          totalCount: 0,
          filterOptions: {
            statuses: [],
            assignees: [],
            labels: [],
            priorities: [],
          },
        }),
    }) as unknown as typeof fetch;
    render(<MyIssuesTabPage />);
    expect(
      await screen.findByText("No issues assigned", {}, { timeout: 2000 }),
    ).toBeDefined();
  });

  it("Initiatives page shows 'No initiatives'", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ initiatives: [] }),
    }) as unknown as typeof fetch;
    render(<InitiativesPage />);
    expect(
      await screen.findByText("No initiatives", {}, { timeout: 2000 }),
    ).toBeDefined();
  });
});
