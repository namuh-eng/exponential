import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TeamCyclesSettingsPage from "../src/app/(app)/settings/teams/[key]/cycles/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ key: "ENG" }),
}));

describe("TeamCyclesSettingsPage component", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  const mockCyclesData = {
    team: {
      name: "Engineering",
      cyclesEnabled: true,
      cycleDurationWeeks: 2,
    },
    cycles: [
      {
        id: "c1",
        name: "Sprint 1",
        number: 1,
        startDate: "2024-01-01T00:00:00Z",
        endDate: "2024-01-14T00:00:00Z",
        issueCount: 10,
        completedIssueCount: 8,
      },
    ],
  };

  it("renders loading state then cycles", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockCyclesData,
    });

    render(<TeamCyclesSettingsPage />);

    expect(screen.getByText("Loading...")).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText("Cycles")).toBeDefined();
    });

    expect(screen.getByText("Sprint 1")).toBeDefined();
    expect(screen.getByText("10 issues")).toBeDefined();
    expect(screen.getByText("8 completed")).toBeDefined();
  });

  it("opens the create form, posts a cycle, and refreshes the list", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockCyclesData, cycles: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "c2", number: 2 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...mockCyclesData,
          cycles: [
            {
              id: "c2",
              name: "Sprint 2",
              number: 2,
              startDate: "2026-06-01T00:00:00Z",
              endDate: "2026-06-14T00:00:00Z",
              issueCount: 0,
              completedIssueCount: 0,
            },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeamCyclesSettingsPage />);

    await screen.findByText("No cycles have been created for this team.");
    fireEvent.click(screen.getByRole("button", { name: /new cycle/i }));

    expect(screen.getByRole("form", { name: /create cycle/i })).toBeDefined();
    fireEvent.change(screen.getByPlaceholderText(/cycle name \(optional\)/i), {
      target: { value: "Sprint 2" },
    });
    fireEvent.change(screen.getByLabelText(/start/i), {
      target: { value: "2026-06-01" },
    });
    fireEvent.change(screen.getByLabelText(/end/i), {
      target: { value: "2026-06-14" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create cycle/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teams/ENG/cycles",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            name: "Sprint 2",
            startDate: "2026-06-01",
            endDate: "2026-06-14",
            autoRollover: true,
          }),
        }),
      );
    });
    expect(await screen.findByText("Sprint 2")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: /create cycle/i })).toBeNull();
  });

  it("shows backend validation errors while keeping the form open", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockCyclesData, cycles: [] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: "Cycle dates overlap with an existing cycle",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeamCyclesSettingsPage />);

    await screen.findByText("No cycles have been created for this team.");
    fireEvent.click(screen.getByRole("button", { name: /new cycle/i }));
    fireEvent.click(screen.getByRole("button", { name: /create cycle/i }));

    expect(
      await screen.findByText("Cycle dates overlap with an existing cycle"),
    ).toBeInTheDocument();
    expect(screen.getByRole("form", { name: /create cycle/i })).toBeDefined();
  });

  it("disables new cycle action when cycles are disabled", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mockCyclesData,
        team: { ...mockCyclesData.team, cyclesEnabled: false },
        cycles: [],
      }),
    });

    render(<TeamCyclesSettingsPage />);

    await waitFor(() => {
      expect(
        screen.getByText(/Cycles are currently disabled for this team/i),
      ).toBeDefined();
    });
    expect(screen.getByRole("button", { name: /new cycle/i })).toBeDisabled();
  });

  it("shows empty state when no cycles exist", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mockCyclesData,
        cycles: [],
      }),
    });

    render(<TeamCyclesSettingsPage />);

    await waitFor(() => {
      expect(
        screen.getByText("No cycles have been created for this team."),
      ).toBeDefined();
    });
  });
});
