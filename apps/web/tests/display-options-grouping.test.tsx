import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import TeamIssuesPage from "@/app/(app)/team/[key]/all/page";
import { useParams, useRouter } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useParams: vi.fn(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/team/ENG/all",
  useSearchParams: () => new URLSearchParams(),
}));

describe("DisplayOptions grouping and persistence", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const mockIssuesData = {
    team: { id: "t-1", name: "Engineering", key: "ENG" },
    groups: [
      {
        state: {
          id: "s-1",
          name: "Backlog",
          category: "backlog",
          color: "#000",
          position: 1,
        },
        issues: [
          {
            id: "i-1",
            identifier: "ENG-1",
            title: "Issue 1",
            priority: "high",
            stateId: "s-1",
            createdAt: new Date().toISOString(),
          },
        ],
      },
    ],
    filterOptions: {
      statuses: [
        { id: "s-1", name: "Backlog", category: "backlog", color: "#000" },
      ],
      priorities: [{ value: "high", label: "High" }],
      assignees: [],
      labels: [],
      projects: [],
      creators: [],
      cycles: [],
      estimates: [],
      dueDates: [],
    },
  };

  it("updates and saves display options via the panel", async () => {
    vi.mocked(useParams).mockReturnValue({ key: "ENG" });

    const fetchMock = vi.fn().mockImplementation((url, init) => {
      if (url.includes("/api/teams/ENG/issues")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockIssuesData),
        });
      }
      if (url.includes("/api/teams/ENG/display-options")) {
        if (init?.method === "PUT") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ displayOptions: null }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeamIssuesPage />);

    // Wait for load
    await waitFor(() =>
      expect(screen.getByText("Engineering")).toBeInTheDocument(),
    );

    // Open display options
    fireEvent.click(screen.getByRole("button", { name: /display/i }));

    // Change grouping to Priority
    const groupingSelect = screen.getByTestId("grouping-select");
    fireEvent.click(groupingSelect);

    // There are multiple "Priority" buttons (one for ordering, one for props).
    // We want the one inside the grouping menu.
    const groupingMenu = screen.getByTestId("grouping-select-menu");
    const priorityOption = within(groupingMenu).getByRole("button", {
      name: "Priority",
    });
    fireEvent.click(priorityOption);

    // Click 'Set default for everyone' (Save)
    fireEvent.click(
      screen.getByRole("button", { name: /set default for everyone/i }),
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/teams/ENG/display-options"),
        expect.objectContaining({
          method: "PUT",
          body: expect.stringContaining('"groupBy":"priority"'),
        }),
      );
    });
  });
});
