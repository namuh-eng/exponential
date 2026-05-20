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

import TeamBoardPage from "@/app/(app)/team/[key]/board/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ key: "ENG" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/team/ENG/board",
  useSearchParams: () => new URLSearchParams(),
}));

function buildBoardResponse() {
  return {
    team: { id: "team-1", name: "Engineering", key: "ENG" },
    groups: [
      {
        state: {
          id: "state-backlog",
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
            stateId: "state-backlog",
            assigneeId: null,
            assignee: null,
            labels: [],
            labelIds: [],
            projectId: null,
            createdAt: "2026-04-07T00:00:00.000Z",
          },
        ],
      },
      {
        state: {
          id: "state-todo",
          name: "Todo",
          category: "unstarted",
          color: "#f2c94c",
        },
        issues: [],
      },
    ],
    filterOptions: {
      statuses: [],
      assignees: [],
      labels: [],
      priorities: [],
    },
  };
}

describe("TeamBoardPage", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    let boardData = buildBoardResponse();

    global.fetch = vi.fn((input, init) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/api/teams/ENG/display-options") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ displayOptions: null }),
        });
      }

      if (url === "/api/teams/ENG/issues") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(structuredClone(boardData)),
        });
      }

      if (url === "/api/teams/ENG/create-issue-options") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              team: boardData.team,
              statuses: boardData.groups.map((group) => group.state),
              priorities: [{ value: "none", label: "No priority" }],
              assignees: [],
              labels: [],
              projects: [],
            }),
        });
      }

      if (url === "/api/issue-templates") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ templates: [] }),
        });
      }

      if (url === "/api/issues" && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        expect(body).toEqual(
          expect.objectContaining({
            title: "New todo issue",
            teamId: "team-1",
            stateId: "state-todo",
          }),
        );

        boardData = {
          ...boardData,
          groups: boardData.groups.map((group) =>
            group.state.id === "state-todo"
              ? {
                  ...group,
                  issues: [
                    ...group.issues,
                    {
                      id: "issue-2",
                      identifier: "ENG-2",
                      title: "New todo issue",
                      priority: "none",
                      stateId: "state-todo",
                      assigneeId: null,
                      assignee: null,
                      labels: [],
                      labelIds: [],
                      projectId: null,
                      createdAt: "2026-04-08T00:00:00.000Z",
                    },
                  ],
                }
              : group,
          ),
        };

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: "issue-2" }),
        });
      }

      if (url === "/api/issues/issue-1" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        expect(body).toEqual({ stateId: "state-todo" });

        const movedIssue = boardData.groups[0].issues[0];
        boardData = {
          ...boardData,
          groups: [
            {
              ...boardData.groups[0],
              issues: [],
            },
            {
              ...boardData.groups[1],
              issues: [{ ...movedIssue, stateId: "state-todo" }],
            },
          ],
        };

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: "issue-1" }),
        });
      }

      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    }) as unknown as typeof fetch;
  });

  it("moves an issue to another column with drag and drop", async () => {
    render(<TeamBoardPage />);

    const backlogColumn = await screen.findByTestId(
      "board-column-state-backlog",
    );
    const todoColumn = await screen.findByTestId("board-column-state-todo");
    const card = within(backlogColumn).getByText("First board issue");
    const cardWrapper = card.closest("[data-testid='issue-card']");
    const todoDropZone = screen.getByTestId("board-column-state-todo-cards");

    expect(cardWrapper).not.toBeNull();

    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
    };

    fireEvent.dragStart(cardWrapper as HTMLElement, { dataTransfer });
    fireEvent.dragOver(todoDropZone, { dataTransfer });
    fireEvent.drop(todoDropZone, { dataTransfer });

    await waitFor(() => {
      expect(
        within(screen.getByTestId("board-column-state-todo")).getByText(
          "First board issue",
        ),
      ).toBeDefined();
    });

    expect(within(todoColumn).getByText("First board issue")).toBeDefined();
    expect(within(backlogColumn).queryByText("First board issue")).toBeNull();
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/issues/issue-1",
      expect.objectContaining({
        method: "PATCH",
      }),
    );
  });

  it("updates board cards when display properties are toggled", async () => {
    render(<TeamBoardPage />);

    expect(await screen.findByText("ENG-1")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /display options/i }));
    fireEvent.click(screen.getByTestId("property-id"));

    await waitFor(() => {
      expect(screen.queryByText("ENG-1")).toBeNull();
    });
  });

  it("opens the create issue modal from a column and creates in that status", async () => {
    render(<TeamBoardPage />);

    const todoColumn = await screen.findByTestId("board-column-state-todo");
    fireEvent.click(
      within(todoColumn).getByRole("button", { name: /add issue to todo/i }),
    );

    expect(await screen.findByTestId("create-issue-composer")).toBeDefined();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Status" })).toHaveTextContent(
        "Todo",
      );
    });

    const titleInput = screen.getByRole("textbox", { name: "Issue title" });
    titleInput.textContent = "New todo issue";
    fireEvent.input(titleInput);
    fireEvent.click(screen.getByRole("button", { name: "Create Issue" }));

    await waitFor(() => {
      expect(
        within(screen.getByTestId("board-column-state-todo")).getByText(
          "New todo issue",
        ),
      ).toBeDefined();
    });
  });

  it("renders board cards as links to issue detail", async () => {
    render(<TeamBoardPage />);

    const link = await screen.findByRole("link", {
      name: /ENG-1 First board issue/i,
    });
    expect(link).toHaveAttribute("href", "/team/ENG/issue/ENG-1");
  });
});
