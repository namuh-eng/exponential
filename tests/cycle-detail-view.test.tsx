import CycleDetailPage from "@/app/(app)/team/[key]/cycles/[cycleId]/page";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useParams: () => ({ key: "ENG", cycleId: "cycle-1" }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const cycleDetailResponse = {
  team: { id: "team-1", name: "Engineering", key: "ENG" },
  cycle: {
    id: "cycle-1",
    name: "Current Cycle",
    number: 12,
    startDate: "2026-05-01T00:00:00.000Z",
    endDate: "2026-05-15T00:00:00.000Z",
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
          priority: "high",
          stateId: "state-1",
          assigneeId: null,
          assignee: null,
          labels: [],
          projectId: null,
          dueDate: null,
          createdAt: "2026-05-10T00:00:00.000Z",
        },
      ],
    },
  ],
};

describe("CycleDetailPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(cycleDetailResponse),
        }),
      ),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders cycle issue rows as links to team-scoped issue detail pages", async () => {
    render(<CycleDetailPage />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/teams/ENG/cycles/cycle-1",
      );
    });

    const issueRow = await screen.findByRole("link", {
      name: "ENG-123 Fix cycle row navigation",
    });

    expect(issueRow).toHaveAttribute("data-testid", "issue-row");
    expect(issueRow).toHaveAttribute("href", "/team/ENG/issue/ENG-123");
  });
});
