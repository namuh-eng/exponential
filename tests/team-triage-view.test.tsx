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

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/teams/ENG/triage/iss-2",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          action: "accept",
          destinationStateId: "s-backlog",
          confirmed: true,
        }),
      }),
    );
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
        expect(patchCall[1]).toMatchObject({
          method: "PATCH",
          body: JSON.stringify({
            action: "accept",
            destinationStateId: "s-backlog",
            confirmed: true,
          }),
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

  it("shows empty state when no issues to triage", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ ...mockTriageData, issues: [], count: 0 }),
    } as Response);

    render(<TeamTriagePage />);

    expect(await screen.findByText("No issues to triage")).toBeInTheDocument();
  });
});
