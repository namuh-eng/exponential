import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import TeamCyclesPage from "@/app/(app)/team/[key]/cycles/page";
import { useParams } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useParams: vi.fn(),
}));

describe("TeamCyclesPage interactions", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const mockCyclesData = {
    team: {
      id: "t-1",
      name: "Engineering",
      key: "ENG",
      cyclesEnabled: true,
      cycleStartDay: 1,
      cycleDurationWeeks: 2,
      timezone: "UTC",
    },
    cycles: [
      {
        id: "c-1",
        name: "Cycle 1",
        number: 1,
        teamId: "t-1",
        startDate: "2020-01-01T00:00:00Z",
        endDate: "2020-01-14T23:59:59Z",
        autoRollover: true,
        issueCount: 5,
        completedIssueCount: 2,
      },
    ],
  };

  it("opens the create cycle form and submits a new cycle", async () => {
    vi.mocked(useParams).mockReturnValue({ key: "ENG" });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockCyclesData),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "c-2", number: 2 }), // POST success
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            ...mockCyclesData,
            cycles: [
              ...mockCyclesData.cycles,
              {
                id: "c-2",
                name: "Cycle 2",
                number: 2,
                startDate: "2026-01-01",
                endDate: "2026-01-14",
                issueCount: 0,
                completedIssueCount: 0,
              },
            ],
          }),
      });

    vi.stubGlobal("fetch", fetchMock);

    render(<TeamCyclesPage />);

    await waitFor(() => expect(screen.getByText("Cycles")).toBeInTheDocument());

    // Click New cycle
    fireEvent.click(screen.getByRole("button", { name: /new cycle/i }));

    // Form should be visible
    const nameInput = screen.getByPlaceholderText(/cycle name \(optional\)/i);
    fireEvent.change(nameInput, { target: { value: "Cycle 2" } });

    // Submit form
    fireEvent.click(screen.getByRole("button", { name: /create cycle/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teams/ENG/cycles",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"name":"Cycle 2"'),
        }),
      );
    });

    // Check if form closed and data refreshed
    expect(
      screen.queryByPlaceholderText(/cycle name \(optional\)/i),
    ).not.toBeInTheDocument();
    expect(await screen.findByText("Cycle 2")).toBeInTheDocument();
  });
});
