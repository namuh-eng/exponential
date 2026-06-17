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
  useParams: () => ({ key: "ENG" }),
}));

vi.mock("@/components/issue-detail-view", () => ({
  IssueDetailView: ({ issueId }: { issueId: string }) => (
    <div data-testid="issue-detail-view">Issue detail for {issueId}</div>
  ),
}));

import TeamTriagePage from "@/app/(app)/team/[key]/triage/page";

function setEditableValue(element: HTMLElement, value: string) {
  element.textContent = value;
  fireEvent.input(element);
}

const mockTriageData = {
  team: { id: "team-1", name: "Engineering", key: "ENG" },
  count: 2,
  createStateId: "s-triage",
  createStateName: "Triage",
  acceptDestinationStates: [
    {
      id: "s-backlog",
      name: "Backlog",
      category: "backlog",
      color: "#999",
      isDefault: true,
    },
  ],
  declineDestinationStates: [
    {
      id: "s-canceled",
      name: "Canceled",
      category: "canceled",
      color: "#999",
      isDefault: true,
    },
  ],
  issues: [
    {
      id: "iss-1",
      identifier: "ENG-1",
      title: "Incoming request 1",
      priority: "medium",
      stateId: "s-triage",
      stateName: "Triage",
      stateColor: "#999",
      creatorId: "user-ashley",
      creatorName: "Ashley",
      creatorImage: null,
      assigneeId: null,
      projectId: null,
      createdAt: "2026-04-25T10:00:00.000Z",
      labels: [],
      labelIds: [],
      sourceContext: { label: "Email", title: "Need help" },
    },
    {
      id: "iss-2",
      identifier: "ENG-2",
      title: "Incoming request 2",
      priority: "high",
      stateId: "s-triage",
      stateName: "Triage",
      stateColor: "#999",
      creatorId: "user-jaeyun",
      creatorName: "Jaeyun",
      creatorImage: null,
      assigneeId: null,
      projectId: null,
      createdAt: "2026-04-25T11:00:00.000Z",
      labels: [],
      labelIds: [],
    },
  ],
};

describe("TeamTriagePage UI", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders loading state then triage issues", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockTriageData,
    } as Response);

    render(<TeamTriagePage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    expect(await screen.findByText("Incoming request 1")).toBeInTheDocument();
    expect(screen.getByText("Incoming request 2")).toBeInTheDocument();

    // Triage count check (look for text that is unique to the count display)
    expect(screen.getAllByText(/issues to triage/i).length).toBeGreaterThan(0);
  });

  it("shows source context for imported triage issues", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockTriageData,
    } as Response);

    render(<TeamTriagePage />);

    expect(await screen.findByText("Email: Need help")).toBeInTheDocument();
  });

  it("opens issue detail by row click and keyboard Enter", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockTriageData,
    } as Response);

    render(<TeamTriagePage />);
    await screen.findByText("Incoming request 2");

    const rows = screen.getAllByTestId("triage-row");
    fireEvent.click(rows[0]);

    expect(rows[0]).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("issue-detail-view")).toHaveTextContent(
      "Issue detail for iss-2",
    );

    fireEvent.keyDown(rows[1], { key: "Enter" });

    expect(rows[1]).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("issue-detail-view")).toHaveTextContent(
      "Issue detail for iss-1",
    );
  });

  it("accepts from the detail pane, removes the selected item, and refreshes the count", async () => {
    const afterAccept = {
      ...mockTriageData,
      count: 1,
      issues: [mockTriageData.issues[0]],
    };
    let triageFetchCount = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      const requestUrl = url.toString();
      if (requestUrl.includes("/api/teams/ENG/triage/iss-2")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        } as Response);
      }

      if (requestUrl.includes("/api/teams/ENG/triage")) {
        triageFetchCount += 1;
        return Promise.resolve({
          ok: true,
          json: async () =>
            triageFetchCount === 1 ? mockTriageData : afterAccept,
        } as Response);
      }

      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });

    render(<TeamTriagePage />);
    await screen.findByText("Incoming request 2");

    fireEvent.click(screen.getAllByTestId("triage-row")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Accept issue",
      }),
    );

    await waitFor(() => {
      expect(screen.queryByTestId("issue-detail-view")).not.toBeInTheDocument();
      expect(screen.queryByText("Incoming request 2")).not.toBeInTheDocument();
    });

    const patchCall = fetchSpy.mock.calls.find(
      (call) =>
        call[0].toString() === "/api/teams/ENG/triage/iss-2" &&
        (call[1] as RequestInit)?.method === "PATCH",
    );
    expect(patchCall).toBeDefined();
    const parsedBody = JSON.parse(
      (patchCall?.[1] as RequestInit)?.body as string,
    );
    expect(parsedBody).toMatchObject({
      action: "accept",
      destinationStateId: "s-backlog",
      confirmed: true,
    });
    expect(screen.getAllByText(/1 issue to triage/i).length).toBeGreaterThan(0);
  });

  it("accepts a triage issue", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      if (
        url.toString().includes("/api/teams/ENG/triage") &&
        !url.toString().includes("/iss-1")
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => mockTriageData,
        } as Response);
      }
      if (url.toString().includes("/api/teams/ENG/triage/iss-1")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });

    render(<TeamTriagePage />);
    await screen.findByText("Incoming request 1");

    // Click Accept button (using aria-label)
    const acceptButtons = screen.getAllByRole("button", {
      name: "Accept issue",
    });
    // ENG-1 is index 1 because of default created-desc sort
    fireEvent.click(acceptButtons[1]);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Accept issue",
      }),
    );

    await waitFor(() => {
      const calls = fetchSpy.mock.calls;
      const patchCall = calls.find((call) =>
        call[0].toString().includes("/api/teams/ENG/triage/iss-1"),
      );
      expect(patchCall).toBeDefined();
      if (patchCall) {
        expect(patchCall[1]).toMatchObject({ method: "PATCH" });
        const parsedBody = JSON.parse(
          (patchCall[1] as RequestInit).body as string,
        );
        expect(parsedBody).toMatchObject({
          action: "accept",
          destinationStateId: "s-backlog",
          confirmed: true,
        });
      }
    });
  });

  it("declines a triage issue", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      if (
        url.toString().includes("/api/teams/ENG/triage") &&
        !url.toString().includes("/iss-2")
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => mockTriageData,
        } as Response);
      }
      if (url.toString().includes("/api/teams/ENG/triage/iss-2")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });

    render(<TeamTriagePage />);
    await screen.findByText("Incoming request 2");

    // Click Decline button
    const declineButtons = screen.getAllByRole("button", {
      name: "Decline issue",
    });
    // ENG-2 is index 0
    fireEvent.click(declineButtons[0]);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Decline issue",
      }),
    );

    await waitFor(() => {
      const calls = fetchSpy.mock.calls;
      const patchCall = calls.find((call) =>
        call[0].toString().includes("/api/teams/ENG/triage/iss-2"),
      );
      expect(patchCall).toBeDefined();
      if (patchCall) {
        expect(patchCall[1]).toMatchObject({
          method: "PATCH",
          body: JSON.stringify({
            action: "decline",
            destinationStateId: "s-canceled",
            confirmed: true,
          }),
        });
      }
    });
  });

  it("bulk accepts with metadata and reports partial errors", async () => {
    const dataWithOptions = {
      ...mockTriageData,
      defaults: {
        acceptDestinationStateId: "s-backlog",
        assigneeId: "user-ada",
        labelIds: ["label-bug"],
        projectId: "project-1",
        cycleId: "cycle-1",
      },
      metadataOptions: {
        labels: [{ id: "label-bug", name: "Bug", color: "#f00" }],
        cycles: [{ id: "cycle-1", name: "Cycle 1", number: 1 }],
        projects: [{ id: "project-1", name: "Website" }],
        projectMilestones: [
          { id: "milestone-1", name: "M1", projectId: "project-1" },
        ],
        members: [{ id: "user-ada", name: "Ada", email: "ada@example.com" }],
      },
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      const requestUrl = url.toString();
      if (requestUrl === "/api/teams/ENG/triage") {
        return Promise.resolve({
          ok: true,
          json: async () => dataWithOptions,
        } as Response);
      }
      if (requestUrl === "/api/teams/ENG/triage/bulk") {
        return Promise.resolve({
          ok: false,
          status: 207,
          json: async () => ({
            updatedCount: 1,
            conflictCount: 1,
            results: [
              { issueId: "iss-2", status: "updated" },
              { issueId: "iss-1", status: "conflict", error: "Wrong team" },
            ],
          }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });

    render(<TeamTriagePage />);
    await screen.findByText("Incoming request 2");

    fireEvent.click(screen.getByLabelText("Select all visible triage issues"));
    fireEvent.click(screen.getByRole("button", { name: "Bulk accept" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByLabelText("Accept assignee")).toHaveValue(
      "user-ada",
    );
    fireEvent.change(within(dialog).getByLabelText("Accept due date"), {
      target: { value: "2026-07-01" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Accept issue" }),
    );

    await waitFor(() => {
      expect(screen.getByText("1 updated, 1 conflicts")).toBeInTheDocument();
    });
    const patchCall = fetchSpy.mock.calls.find(
      ([requestUrl, init]) =>
        requestUrl.toString() === "/api/teams/ENG/triage/bulk" &&
        init?.method === "PATCH",
    );
    expect(patchCall).toBeDefined();
    expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
      action: "accept",
      issueIds: ["iss-2", "iss-1"],
      assigneeId: "user-ada",
      labelIds: ["label-bug"],
      projectId: "project-1",
      cycleId: "cycle-1",
      dueDate: "2026-07-01",
    });
  });

  it("shows empty state when no issues to triage", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ ...mockTriageData, issues: [], count: 0 }),
    } as Response);

    render(<TeamTriagePage />);

    expect(await screen.findByText("No issues to triage")).toBeInTheDocument();
  });

  it("fails closed when triage is enabled without a triage status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mockTriageData,
        issues: [],
        count: 0,
        createStateId: null,
        createStateName: null,
        triageEnabled: true,
      }),
    } as Response);

    render(<TeamTriagePage />);

    expect(
      await screen.findByText("Triage status missing"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create triage issue" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open workflow statuses" }),
    ).toHaveAttribute("href", "/settings/teams/ENG/statuses");
  });

  it("creates from the empty triage page with the triage state id", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const url = input.toString();

        if (url === "/api/teams/ENG/triage") {
          return Promise.resolve({
            ok: true,
            json: async () => ({ ...mockTriageData, issues: [], count: 0 }),
          } as Response);
        }

        if (url === "/api/teams/ENG/create-issue-options") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              team: { id: "team-1", name: "Engineering", key: "ENG" },
              statuses: [
                {
                  id: "s-triage",
                  name: "Triage",
                  category: "triage",
                  color: "#f59e0b",
                },
                {
                  id: "s-backlog",
                  name: "Backlog",
                  category: "backlog",
                  color: "#999",
                },
              ],
              priorities: [{ value: "none", label: "No priority" }],
              assignees: [],
              labels: [],
              projects: [],
              cycles: [],
              estimates: [],
              relationIssues: [],
              dueDatePresets: [],
            }),
          } as Response);
        }

        if (url === "/api/teams/ENG/templates") {
          return Promise.resolve({
            ok: true,
            json: async () => ({ templates: [] }),
          } as Response);
        }

        if (url === "/api/issues" && init?.method === "POST") {
          return Promise.resolve({
            ok: true,
            json: async () => ({ id: "created-issue" }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          json: async () => ({}),
        } as Response);
      });

    render(<TeamTriagePage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Create triage issue" }),
    );

    const titleBox = await screen.findByRole("textbox", {
      name: "Issue title",
    });
    setEditableValue(titleBox, "Needs intake review");
    fireEvent.click(screen.getByText("Create Issue"));

    await waitFor(() => {
      const createCall = fetchSpy.mock.calls.find(
        ([url, init]) => url === "/api/issues" && init?.method === "POST",
      );
      expect(createCall).toBeDefined();
      expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
        title: "Needs intake review",
        stateId: "s-triage",
      });
    });
  });
});
