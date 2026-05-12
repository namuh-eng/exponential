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
import TeamBoardPage from "@/app/(app)/team/[key]/board/page";
import { useParams, useRouter } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useParams: vi.fn(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/team/ENG/board",
  useSearchParams: () => new URLSearchParams(),
}));

describe("TeamBoardPage - Manual Ordering and Persistence", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const mockBoardData = {
    team: { id: "t-1", name: "Engineering", key: "ENG" },
    groups: [
      {
        state: {
          id: "s-1",
          name: "Backlog",
          category: "backlog",
          color: "#000",
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
      {
        state: {
          id: "s-2",
          name: "Todo",
          category: "unstarted",
          color: "#f2c",
        },
        issues: [],
      },
    ],
    filterOptions: {
      statuses: [
        { id: "s-1", name: "Backlog", category: "backlog", color: "#000" },
        { id: "s-2", name: "Todo", category: "unstarted", color: "#f2c" },
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

  it("moves an issue between columns and persists the change", async () => {
    vi.mocked(useParams).mockReturnValue({ key: "ENG" });

    const fetchMock = vi.fn().mockImplementation((url, init) => {
      if (url.includes("/api/teams/ENG/issues")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockBoardData),
        });
      }
      if (url.includes("/api/teams/ENG/display-options")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ displayOptions: null }),
        });
      }
      if (url.includes("/api/issues/i-1") && init?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: "i-1", stateId: "s-2" }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeamBoardPage />);

    // Wait for load
    await waitFor(() =>
      expect(screen.getByText("Engineering")).toBeInTheDocument(),
    );

    const backlogColumn = screen.getByTestId("board-column-s-1");
    const todoColumn = screen.getByTestId("board-column-s-2");
    const card = within(backlogColumn).getByText("Issue 1");
    const cardWrapper = card.closest("[draggable='true']");
    const todoDropZone = screen.getByTestId("board-column-s-2-cards");

    expect(cardWrapper).not.toBeNull();

    // Trigger drag and drop with dataTransfer mock
    const dataTransfer = {
      effectAllowed: "",
      setData: vi.fn(),
      dropEffect: "",
    };

    if (!cardWrapper) {
      throw new Error("Expected draggable card wrapper");
    }

    fireEvent.dragStart(cardWrapper, { dataTransfer });
    fireEvent.dragOver(todoDropZone, { dataTransfer });
    fireEvent.drop(todoDropZone, { dataTransfer });

    // Verify optimistic update and API call
    await waitFor(() => {
      expect(within(todoColumn).getByText("Issue 1")).toBeInTheDocument();
      expect(
        within(backlogColumn).queryByText("Issue 1"),
      ).not.toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/issues/i-1"),
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"stateId":"s-2"'),
      }),
    );
  });
});
