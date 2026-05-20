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
let paramsMock: Record<string, string> = {};
let shellContextMock = {
  workspaceId: "workspace-1",
  workspaceSlug: "foreverbrowsing",
  workspaceName: "Forever Browsing",
  workspaceInitials: "FB",
  teamName: "Engineering",
  teamId: "team-1",
  teamKey: "ENG",
  teams: [{ id: "team-1", name: "Engineering", key: "ENG" }],
};

vi.mock("next/navigation", () => ({
  useParams: () => paramsMock,
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/app/(app)/app-shell", () => ({
  useAppShellContext: () => shellContextMock,
}));

vi.mock("@/components/contextual-insights", () => ({
  ContextualInsights: () => null,
}));

const cyclesResponse = {
  team: {
    id: "team-1",
    name: "Engineering",
    key: "ENG",
    cyclesEnabled: true,
    cycleStartDay: 1,
    cycleDurationWeeks: 2,
    timezone: "America/Los_Angeles",
  },
  cycles: [
    {
      id: "cycle-1",
      name: "Workspace Cycle",
      number: 7,
      teamId: "team-1",
      startDate: "2026-05-18T00:00:00.000Z",
      endDate: "2026-05-31T00:00:00.000Z",
      autoRollover: true,
      issueCount: 1,
      completedIssueCount: 0,
    },
  ],
};

const cycleDetailResponse = {
  team: { id: "team-1", name: "Engineering", key: "ENG" },
  cycle: {
    id: "cycle-1",
    name: "Workspace Cycle",
    number: 7,
    startDate: "2026-05-18T00:00:00.000Z",
    endDate: "2026-05-31T00:00:00.000Z",
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
          title: "Preserve cycle workspace slug",
          priority: "medium",
          stateId: "state-1",
          assigneeId: null,
          assignee: null,
          labels: [],
          projectId: null,
          dueDate: null,
          createdAt: "2026-05-20T00:00:00.000Z",
        },
      ],
    },
  ],
};

describe("workspace-prefixed cycles pages", () => {
  beforeEach(() => {
    paramsMock = {};
    shellContextMock = {
      workspaceId: "workspace-1",
      workspaceSlug: "foreverbrowsing",
      workspaceName: "Forever Browsing",
      workspaceInitials: "FB",
      teamName: "Engineering",
      teamId: "team-1",
      teamKey: "ENG",
      teams: [{ id: "team-1", name: "Engineering", key: "ENG" }],
    };
    pushMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders /:workspaceSlug/cycles using the active team and emits slug-preserving cycle links", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(cyclesResponse),
        } as Response),
      ),
    );
    const { default: WorkspaceCyclesPage } = await import(
      "@/app/(app)/[workspaceSlug]/cycles/page"
    );

    render(<WorkspaceCyclesPage />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/teams/ENG/cycles");
    });
    const cycleLink = await screen.findByRole("link", {
      name: /workspace cycle/i,
    });
    expect(cycleLink).toHaveAttribute(
      "href",
      "/foreverbrowsing/team/ENG/cycles/cycle-1",
    );
  });

  it("preserves the workspace slug from /:workspaceSlug/team/:key/cycles detail navigation", async () => {
    paramsMock = { key: "ENG", cycleId: "cycle-1" };
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(cycleDetailResponse),
        } as Response),
      ),
    );
    const { default: WorkspaceCycleDetailPage } = await import(
      "@/app/(app)/[workspaceSlug]/team/[key]/cycles/[cycleId]/page"
    );

    render(<WorkspaceCycleDetailPage />);

    const issueLink = await screen.findByRole("link", {
      name: /eng-123 preserve cycle workspace slug/i,
    });
    expect(issueLink).toHaveAttribute(
      "href",
      "/foreverbrowsing/team/ENG/issue/ENG-123",
    );

    fireEvent.click(screen.getByRole("button", { name: /cycles/i }));
    expect(pushMock).toHaveBeenCalledWith("/foreverbrowsing/team/ENG/cycles");
  });
});
