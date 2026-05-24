import CycleDetailPage from "@/app/(app)/team/[key]/cycles/[cycleId]/page";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ key: "ENG", cycleId: "cycle-1" }),
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  usePathname: () => "/team/ENG/cycles/cycle-1",
  useSearchParams: () => new URLSearchParams(),
}));

const mockCycleDetailResponse = {
  team: { id: "team-1", name: "Engineering", key: "ENG" },
  cycle: {
    id: "cycle-1",
    name: "Cycle 1",
    number: 1,
    startDate: "2026-05-01",
    endDate: "2026-05-14",
    autoRollover: true,
    issueCount: 1,
    completedIssueCount: 0,
  },
  groups: [
    {
      state: {
        id: "state-1",
        name: "In Progress",
        category: "started",
        color: "#f2c94c",
        position: 1,
      },
      issues: [
        {
          id: "issue-1",
          number: 123,
          identifier: "ENG-123",
          title: "Fix cycle row navigation",
          priority: "medium",
          stateId: "state-1",
          assigneeId: null,
          assignee: null,
          labels: [{ id: "label-1", name: "Bug", color: "#f00" }],
          labelIds: ["label-1"],
          projectId: null,
          projectName: null,
          cycleId: "cycle-1",
          cycleName: "Cycle 1",
          estimate: null,
          dueDate: null,
          createdAt: "2026-05-10T00:00:00.000Z",
        },
      ],
    },
  ],
  filterOptions: {
    statuses: [
      {
        id: "state-1",
        name: "In Progress",
        category: "started",
        color: "#f2c94c",
      },
    ],
    assignees: [],
    labels: [{ id: "label-1", name: "Bug", color: "#f00" }],
    projects: [],
    creators: [],
    cycles: [{ id: "cycle-1", name: "Cycle 1" }],
    estimates: [],
    dueDates: [],
    teams: [{ id: "team-1", name: "Engineering" }],
    priorities: [
      { value: "medium", label: "Medium" },
      { value: "none", label: "No priority" },
    ],
  },
};

const createIssueOptions = {
  team: { id: "team-1", name: "Engineering", key: "ENG" },
  statuses: [
    { id: "state-1", name: "Backlog", category: "backlog", color: "#999" },
  ],
  priorities: [{ value: "none", label: "No priority" }],
  assignees: [],
  labels: [],
  projects: [],
};

function mockJsonResponse(payload: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => payload } as Response;
}

function setEditableValue(element: HTMLElement, value: string) {
  element.textContent = value;
  fireEvent.input(element);
}

describe("CycleDetailPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/teams/ENG/cycles/cycle-1" && !init?.method) {
          return mockJsonResponse(mockCycleDetailResponse);
        }
        if (url === "/api/teams/ENG/display-options") {
          return mockJsonResponse({});
        }
        if (url === "/api/teams/ENG/create-issue-options") {
          return mockJsonResponse(createIssueOptions);
        }
        if (url === "/api/issue-templates?teamKey=ENG") {
          return mockJsonResponse({ templates: [] });
        }
        if (
          url === "/api/teams/ENG/cycles/cycle-1" &&
          init?.method === "PATCH"
        ) {
          return mockJsonResponse({
            ...mockCycleDetailResponse.cycle,
            name: "Renamed cycle",
          });
        }
        if (
          url === "/api/teams/ENG/cycles/cycle-1" &&
          init?.method === "DELETE"
        ) {
          return mockJsonResponse({ success: true });
        }
        if (url === "/api/issues" && init?.method === "POST") {
          return mockJsonResponse({ id: "issue-2" }, true, 201);
        }
        throw new Error(`Unhandled fetch: ${url}`);
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    pushMock.mockReset();
    replaceMock.mockReset();
  });

  it("renders cycle issue rows as links to issue detail", async () => {
    render(<CycleDetailPage />);

    await waitFor(() => {
      expect(screen.getByText("Cycle 1")).toBeInTheDocument();
    });

    const issueLink = screen.getByRole("link", {
      name: /eng-123 fix cycle row navigation/i,
    });

    expect(issueLink).toHaveAttribute("href", "/team/ENG/issue/ENG-123");
  });

  it("renders management, scope, search, filter, and display controls", async () => {
    render(<CycleDetailPage />);

    expect(
      (await screen.findAllByRole("button", { name: "Add issue" }))[0],
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cycle actions" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Search cycle issues" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add filter" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Display options" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Total scope")).toBeInTheDocument();
  });

  it("edits and deletes a cycle through the cycle API", async () => {
    render(<CycleDetailPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Cycle actions" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit cycle" }));
    fireEvent.change(screen.getByLabelText("Cycle name"), {
      target: { value: "Renamed cycle" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/teams/ENG/cycles/cycle-1",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"name":"Renamed cycle"'),
        }),
      );
    });
    expect(await screen.findByText("Renamed cycle")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cycle actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete cycle" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/teams/ENG/cycles/cycle-1",
        expect.objectContaining({ method: "DELETE" }),
      );
      expect(pushMock).toHaveBeenCalledWith("/team/ENG/cycles");
    });
  });

  it("creates a new issue with the current cycle preselected", async () => {
    render(<CycleDetailPage />);

    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Add issue" }))[0],
    );
    expect(await screen.findByLabelText("Cycle Cycle 1")).toBeInTheDocument();

    setEditableValue(
      screen.getByRole("textbox", { name: "Issue title" }),
      "Scoped cycle issue",
    );
    fireEvent.click(screen.getByRole("button", { name: "Create Issue" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/issues",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"cycleId":"cycle-1"'),
        }),
      );
    });
  });
});
