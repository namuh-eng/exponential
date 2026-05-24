import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
const redirectMock = vi.fn();
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
  usePathname: () => "/foreverbrowsing/team/ENG/cycles/cycle-1",
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  redirect: redirectMock,
}));

vi.mock("@/app/(app)/app-shell", () => ({
  useAppShellContext: () => shellContextMock,
}));

vi.mock("@/components/contextual-insights", () => ({
  ContextualInsights: () => null,
}));

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
    autoRollover: true,
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
          labelIds: [],
          projectId: null,
          projectName: null,
          cycleId: "cycle-1",
          cycleName: "Workspace Cycle",
          estimate: null,
          dueDate: null,
          createdAt: "2026-05-20T00:00:00.000Z",
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
    labels: [],
    projects: [],
    creators: [],
    cycles: [{ id: "cycle-1", name: "Workspace Cycle" }],
    estimates: [],
    dueDates: [],
    teams: [{ id: "team-1", name: "Engineering" }],
    priorities: [{ value: "medium", label: "Medium" }],
  },
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
    redirectMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("redirects /:workspaceSlug/cycles to the canonical team cycles route", async () => {
    const { default: WorkspaceCyclesPage } = await import(
      "@/app/(app)/[workspaceSlug]/cycles/page"
    );

    await WorkspaceCyclesPage({
      params: Promise.resolve({ workspaceSlug: "foreverbrowsing" }),
    });

    expect(redirectMock).toHaveBeenCalledWith(
      "/foreverbrowsing/team/ENG/cycles",
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
