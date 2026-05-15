import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TeamTriagePage from "@/app/(app)/team/[key]/triage/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ key: "ENG" }),
}));

function makeTriageIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "issue-1",
    identifier: "ENG-42",
    title: "Fix login button alignment",
    stateId: "state-triage",
    stateName: "Triage",
    stateColor: "#f2994a",
    creatorId: "user-1",
    creatorName: "Alice Smith",
    creatorImage: null,
    createdAt: "2026-04-06T10:30:00.000Z",
    priority: "none",
    labelIds: [],
    labels: [],
    assigneeId: null,
    projectId: null,
    ...overrides,
  };
}

function buildTriageResponse(overrides: Record<string, unknown> = {}) {
  return {
    team: { id: "team-1", name: "Engineering", key: "ENG" },
    count: 2,
    createStateId: "state-triage",
    createStateName: "Triage",
    issues: [
      makeTriageIssue({
        id: "issue-1",
        identifier: "ENG-42",
        title: "Fix login button alignment",
        createdAt: "2026-04-07T10:00:00.000Z",
      }),
      makeTriageIssue({
        id: "issue-2",
        identifier: "ENG-43",
        title: "Secondary triage state issue",
        stateId: "state-needs-review",
        stateName: "Needs Review",
        createdAt: "2026-04-07T12:00:00.000Z",
      }),
    ],
    ...overrides,
  };
}

describe("TriageRow", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders issue title", async () => {
    const { TriageRow } = await import("@/components/triage-row");
    render(
      <TriageRow
        issue={makeTriageIssue()}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
      />,
    );
    expect(screen.getByText("Fix login button alignment")).toBeTruthy();
  });

  it("renders issue identifier", async () => {
    const { TriageRow } = await import("@/components/triage-row");
    render(
      <TriageRow
        issue={makeTriageIssue()}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
      />,
    );
    expect(screen.getByText("ENG-42")).toBeTruthy();
  });

  it("renders creator name", async () => {
    const { TriageRow } = await import("@/components/triage-row");
    render(
      <TriageRow
        issue={makeTriageIssue()}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
      />,
    );
    expect(screen.getByText("Alice Smith")).toBeTruthy();
  });

  it("renders relative timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T10:30:00.000Z"));
    const { TriageRow } = await import("@/components/triage-row");
    render(
      <TriageRow
        issue={makeTriageIssue()}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
      />,
    );
    expect(screen.getByText("1d ago")).toBeTruthy();
  });

  it("calls onAccept when accept button clicked", async () => {
    const { TriageRow } = await import("@/components/triage-row");
    const onAccept = vi.fn();
    render(
      <TriageRow
        issue={makeTriageIssue()}
        onAccept={onAccept}
        onDecline={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Accept issue"));
    expect(onAccept).toHaveBeenCalledWith("issue-1");
  });

  it("calls onDecline when decline button clicked", async () => {
    const { TriageRow } = await import("@/components/triage-row");
    const onDecline = vi.fn();
    render(
      <TriageRow
        issue={makeTriageIssue()}
        onAccept={vi.fn()}
        onDecline={onDecline}
      />,
    );
    fireEvent.click(screen.getByLabelText("Decline issue"));
    expect(onDecline).toHaveBeenCalledWith("issue-1");
  });
});

describe("TriageHeader", () => {
  afterEach(cleanup);

  it("renders triage count", async () => {
    const { TriageHeader } = await import("@/components/triage-header");
    render(<TriageHeader count={68} />);
    expect(screen.getByText("68 issues to triage")).toBeTruthy();
  });

  it("renders title", async () => {
    const { TriageHeader } = await import("@/components/triage-header");
    render(<TriageHeader count={5} />);
    expect(screen.getByText("Triage")).toBeTruthy();
  });

  it("renders zero count", async () => {
    const { TriageHeader } = await import("@/components/triage-header");
    render(<TriageHeader count={0} />);
    expect(screen.getByText("0 issues to triage")).toBeTruthy();
  });
});

describe("TeamTriagePage", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    let triageData = buildTriageResponse();

    global.fetch = vi.fn((input, init) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/api/teams/ENG/triage") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(structuredClone(triageData)),
        });
      }

      if (url === "/api/teams/ENG/triage/issue-1" && init?.method === "PATCH") {
        triageData = buildTriageResponse({
          count: 1,
          issues: [triageData.issues[1]],
        });

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: "issue-1" }),
        });
      }

      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    }) as unknown as typeof fetch;
  });

  it("shows create, filter, and sort controls for a populated triage queue", async () => {
    render(<TeamTriagePage />);

    expect(
      await screen.findByText("Secondary triage state issue"),
    ).toBeDefined();
    expect(
      screen.getAllByRole("button", { name: "Create triage issue" }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Add filter" })).toBeDefined();
    expect(
      screen.getByRole("combobox", { name: "Sort triage issues" }),
    ).toBeDefined();
  });

  it("renders issues from multiple triage states", async () => {
    render(<TeamTriagePage />);

    expect(await screen.findByText("Fix login button alignment")).toBeDefined();
    expect(
      await screen.findByText("Secondary triage state issue"),
    ).toBeDefined();
    expect(screen.getAllByText("2 issues to triage")).toHaveLength(2);
  });

  it("refreshes the triage list after accepting an issue", async () => {
    render(<TeamTriagePage />);

    const rows = await screen.findAllByTestId("triage-row");
    fireEvent.click(within(rows[1]).getByLabelText("Accept issue"));

    await waitFor(() => {
      expect(screen.queryByText("Fix login button alignment")).toBeNull();
    });

    expect(screen.getByText("Secondary triage state issue")).toBeDefined();
  });

  it("shows disabled triage state instead of active queue controls", async () => {
    vi.mocked(global.fetch).mockImplementation((input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/teams/ENG/triage") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve(
              buildTriageResponse({
                triageEnabled: false,
                count: 0,
                issues: [],
                createStateId: null,
                createStateName: null,
              }),
            ),
        } as Response);
      }

      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    });

    render(<TeamTriagePage />);

    expect(await screen.findByText("Triage is disabled")).toBeDefined();
    expect(
      screen.getByText(
        "Incoming issues go directly to the team backlog. Enable triage in team settings to review issues here first.",
      ),
    ).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: "Open triage settings" })
        .getAttribute("href"),
    ).toBe("/settings/teams/ENG/triage");
    expect(
      screen.queryByRole("button", { name: "Create triage issue" }),
    ).toBeNull();
  });
});

describe("Triage API route", () => {
  it("filters issues across every triage workflow state", async () => {
    const fs = await import("node:fs");
    const content = fs.readFileSync(
      "src/app/api/teams/[key]/triage/route.ts",
      "utf-8",
    );
    expect(content).toContain("inArray(issue.stateId, triageStateIds)");
  });
});
