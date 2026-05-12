import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ key: "ENG" }),
}));

import TeamTriagePage from "@/app/(app)/team/[key]/triage/page";

const mockTriageData = {
  team: { id: "team-1", name: "Engineering", key: "ENG" },
  count: 2,
  createStateId: "s-triage",
  createStateName: "Triage",
  issues: [
    {
      id: "iss-1",
      identifier: "ENG-1",
      title: "Incoming request 1",
      priority: "medium",
      stateId: "s-triage",
      stateName: "Triage",
      stateColor: "#999",
      creatorName: "Ashley",
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
      creatorName: "Jaeyun",
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

    await waitFor(() => {
      const calls = fetchSpy.mock.calls;
      const patchCall = calls.find((call) =>
        call[0].toString().includes("/api/teams/ENG/triage/iss-1"),
      );
      expect(patchCall).toBeDefined();
      if (patchCall) {
        expect(patchCall[1]).toMatchObject({
          method: "PATCH",
          body: JSON.stringify({ action: "accept" }),
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

    await waitFor(() => {
      const calls = fetchSpy.mock.calls;
      const patchCall = calls.find((call) =>
        call[0].toString().includes("/api/teams/ENG/triage/iss-2"),
      );
      expect(patchCall).toBeDefined();
      if (patchCall) {
        expect(patchCall[1]).toMatchObject({
          method: "PATCH",
          body: JSON.stringify({ action: "decline" }),
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
