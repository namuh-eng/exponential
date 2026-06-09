import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/settings/teams/ENG/statuses",
  useParams: () => ({ key: "ENG" }),
}));

const mockStatuses = {
  triage: [
    {
      id: "1",
      name: "Triage",
      issueCount: 68,
      description: "Issue needs to be triaged",
    },
  ],
  backlog: [
    {
      id: "2",
      name: "Backlog",
      issueCount: 6,
      description: null,
      isDefault: true,
    },
    {
      id: "3",
      name: "Spec Needed",
      issueCount: 1,
      description: "More detail is needed",
    },
    {
      id: "4",
      name: "Research Needed",
      issueCount: 2,
      description: "Ticket requires investigation",
    },
  ],
  unstarted: [{ id: "5", name: "Todo", issueCount: 0, description: null }],
  started: [
    {
      id: "6",
      name: "Research In Progress",
      issueCount: 1,
      description: "Active research underway",
    },
    { id: "7", name: "Research in Review", issueCount: 0, description: null },
    { id: "8", name: "Ready for Plan", issueCount: 0, description: null },
    { id: "9", name: "Plan in Progress", issueCount: 0, description: null },
    { id: "10", name: "Plan in Review", issueCount: 1, description: null },
    { id: "11", name: "Ready for Dev", issueCount: 0, description: null },
    { id: "12", name: "In Dev", issueCount: 0, description: null },
    { id: "13", name: "Code Review", issueCount: 3, description: null },
  ],
  completed: [
    { id: "14", name: "Done", issueCount: 25, description: "Task completed" },
  ],
  canceled: [
    { id: "15", name: "Canceled", issueCount: 0, description: null },
    { id: "16", name: "Duplicate", issueCount: 1, description: null },
  ],
};

describe("TeamIssueStatusesPage", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  async function renderPage() {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ statuses: mockStatuses }),
      }),
    );

    const { default: StatusesPage } = await import(
      "@/app/(app)/settings/teams/[key]/statuses/page"
    );
    render(<StatusesPage />);
    await screen.findByText("Issue statuses");
  }

  it("renders page title 'Issue statuses'", async () => {
    await renderPage();
    expect(screen.getByText("Issue statuses")).toBeDefined();
  });

  it("renders description text", async () => {
    await renderPage();
    expect(screen.getByText(/define the workflow/i)).toBeDefined();
  });

  it("renders all 6 category headers", async () => {
    await renderPage();
    // Categories appear in headers and may also appear as status names or select options
    for (const cat of [
      "Triage",
      "Backlog",
      "Unstarted",
      "Started",
      "Completed",
      "Canceled",
    ]) {
      expect(screen.getAllByText(cat).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("renders status names", async () => {
    await renderPage();
    // Some names appear in both status list and duplicate selector
    for (const name of [
      "Spec Needed",
      "Research Needed",
      "Todo",
      "In Dev",
      "Code Review",
      "Done",
    ]) {
      expect(screen.getAllByText(name).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("renders issue counts", async () => {
    await renderPage();
    expect(screen.getByText("68 issues")).toBeDefined();
    expect(screen.getByText("6 issues")).toBeDefined();
    expect(screen.getByText("25 issues")).toBeDefined();
  });

  it("renders 'Default' badge on first Backlog status", async () => {
    await renderPage();
    expect(screen.getByText("Default")).toBeDefined();
  });

  it("renders status descriptions", async () => {
    await renderPage();
    expect(screen.getByText("Issue needs to be triaged")).toBeDefined();
    expect(screen.getByText("Task completed")).toBeDefined();
  });

  it("renders 16 statuses total", async () => {
    await renderPage();
    const statusItems = screen.getAllByTestId("status-item");
    expect(statusItems.length).toBe(16);
  });

  it("renders add buttons for each category", async () => {
    await renderPage();
    const addButtons = screen.getAllByLabelText("Add status");
    expect(addButtons.length).toBe(6);
  });

  it("renders duplicate issue status selector at bottom", async () => {
    await renderPage();
    expect(screen.getByText(/duplicate issue status/i)).toBeDefined();
  });
});
