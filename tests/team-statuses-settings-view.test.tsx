import TeamIssueStatusesPage from "@/app/(app)/settings/teams/[key]/statuses/page";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useParams: () => ({ key: "TEAM" }),
}));

// Mock status icon
vi.mock("@/components/icons/status-icon", () => ({
  StatusIcon: () => <div data-testid="status-icon" />,
}));

const mockStatuses = {
  triage: [
    { id: "s1", name: "Triage", issueCount: 5, description: "New issues" },
  ],
  backlog: [{ id: "s2", name: "Backlog", issueCount: 0, description: null }],
  unstarted: [
    {
      id: "s3",
      name: "Todo",
      issueCount: 10,
      description: "Planned",
      isDefault: true,
    },
  ],
  started: [
    { id: "s4", name: "In Progress", issueCount: 2, description: null },
  ],
  completed: [{ id: "s5", name: "Done", issueCount: 100, description: null }],
  canceled: [{ id: "s6", name: "Canceled", issueCount: 1, description: null }],
};

describe("TeamIssueStatusesPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ statuses: mockStatuses }),
        }),
      ),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders loading state then issue statuses", async () => {
    render(<TeamIssueStatusesPage />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Issue statuses")).toBeInTheDocument();
    });

    // Check category headers (using getAll since the name is also used in status items and select)
    expect(screen.getAllByText("Triage").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Backlog").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Unstarted").length).toBeGreaterThan(0);

    // Check status items
    expect(screen.getByText("New issues")).toBeInTheDocument();

    expect(screen.getAllByText("Todo").length).toBeGreaterThan(0);
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.getByText("10 issues")).toBeInTheDocument();
  });

  it("handles empty status list", async () => {
    vi.mocked(global.fetch).mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ statuses: null }),
      } as Response),
    );

    render(<TeamIssueStatusesPage />);
    await waitFor(() => {
      expect(screen.getByText("No statuses found")).toBeInTheDocument();
    });
  });

  it("renders duplicate issue status selector with all statuses", async () => {
    render(<TeamIssueStatusesPage />);
    await waitFor(() => screen.getByText("Duplicate issue status"));

    const select = screen.getByRole("combobox");
    expect(select).toBeInTheDocument();

    // Check if some statuses from different categories are options
    expect(screen.getByRole("option", { name: "Triage" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Done" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Canceled" }),
    ).toBeInTheDocument();
  });
});
