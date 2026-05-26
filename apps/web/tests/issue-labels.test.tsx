import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/settings/issue-labels",
}));

// ─── ColorDot Component ─────────────────────────────────────────────

function ColorDot({ color }: { color: string }) {
  return (
    <span
      data-testid="color-dot"
      className="inline-block h-3 w-3 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

describe("ColorDot", () => {
  afterEach(() => cleanup());

  it("renders with the given color", () => {
    render(<ColorDot color="#e5484d" />);
    const dot = screen.getByTestId("color-dot");
    expect(dot.style.backgroundColor).toBe("rgb(229, 72, 77)");
  });
});

// ─── formatRelativeTime ─────────────────────────────────────────────

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  const now = new Date();
  const d = new Date(dateStr);
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "1 day ago";
  if (diffDays < 7) return `${diffDays} days ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks === 1) return "1 week ago";
  if (diffWeeks < 5) return `${diffWeeks} weeks ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths === 1) return "1 month ago";
  if (diffMonths < 12) return `${diffMonths} months ago`;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

describe("formatRelativeTime", () => {
  afterEach(() => cleanup());

  it("returns dash for null", () => {
    expect(formatRelativeTime(null)).toBe("—");
  });

  it("returns 'Today' for today's date", () => {
    const today = new Date().toISOString();
    expect(formatRelativeTime(today)).toBe("Today");
  });

  it("returns '1 day ago' for yesterday", () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    expect(formatRelativeTime(yesterday)).toBe("1 day ago");
  });

  it("returns 'X days ago' for recent dates", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
    expect(formatRelativeTime(threeDaysAgo)).toBe("3 days ago");
  });

  it("returns weeks for 7+ days", () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString();
    expect(formatRelativeTime(twoWeeksAgo)).toBe("2 weeks ago");
  });
});

// ─── formatCreatedDate ──────────────────────────────────────────────

function formatCreatedDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

describe("formatCreatedDate", () => {
  it("formats date as 'Mon YYYY'", () => {
    expect(formatCreatedDate("2025-09-15T00:00:00Z")).toBe("Sep 2025");
  });

  it("formats another date correctly", () => {
    expect(formatCreatedDate("2025-04-01T00:00:00Z")).toBe("Apr 2025");
  });
});

// ─── IssueLabelsPage integration (mocked fetch) ────────────────────

const mockLabels = [
  {
    id: "3",
    name: "agent",
    color: "#8b5cf6",
    description: null,
    issueCount: 20,
    lastApplied: new Date(Date.now() - 13 * 86400000).toISOString(),
    createdAt: "2025-09-01T00:00:00Z",
  },
  {
    id: "1",
    name: "bug",
    color: "#e5484d",
    description: "Something is broken",
    issueCount: 6,
    lastApplied: new Date(Date.now() - 2 * 86400000).toISOString(),
    createdAt: "2025-04-01T00:00:00Z",
  },
  {
    id: "2",
    name: "frontend",
    color: "#3b82f6",
    description: null,
    issueCount: 8,
    lastApplied: new Date(Date.now() - 26 * 86400000).toISOString(),
    createdAt: "2025-09-15T00:00:00Z",
  },
];

describe("IssueLabelsPage", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  async function renderPage() {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ labels: mockLabels }),
      }),
    );

    const { default: IssueLabelsPage } = await import(
      "@/app/(app)/settings/issue-labels/page"
    );
    render(<IssueLabelsPage />);

    // Wait for loading to finish
    await screen.findByText("bug");
  }

  it("renders page title 'Issue labels'", async () => {
    await renderPage();
    expect(screen.getByText("Issue labels")).toBeDefined();
  });

  it("renders 'New group' and 'New label' buttons", async () => {
    await renderPage();
    expect(screen.getByText("New group")).toBeDefined();
    expect(screen.getByText("New label")).toBeDefined();
  });

  it("renders table headers including Name, Description, Rules, Issues", async () => {
    await renderPage();
    expect(
      screen.getByRole("button", { name: /order by name/i }),
    ).toBeDefined();
    expect(screen.getByText("Description")).toBeDefined();
    expect(screen.getByText("Issues")).toBeDefined();
    expect(screen.getByText("Last applied")).toBeDefined();
    expect(screen.getByText("Created")).toBeDefined();
  });

  it("renders label names from API", async () => {
    await renderPage();
    expect(screen.getByText("bug")).toBeDefined();
    expect(screen.getByText("frontend")).toBeDefined();
    expect(screen.getByText("agent")).toBeDefined();
  });

  it("renders label descriptions", async () => {
    await renderPage();
    expect(screen.getByText("Something is broken")).toBeDefined();
  });

  it("renders issue counts", async () => {
    await renderPage();
    expect(screen.getByText("6")).toBeDefined();
    expect(screen.getByText("8")).toBeDefined();
    expect(screen.getByText("20")).toBeDefined();
  });

  it("renders color dots for each label", async () => {
    await renderPage();
    const dots = screen.getAllByTestId("color-dot");
    expect(dots.length).toBe(3);
  });

  it("renders filter input", async () => {
    await renderPage();
    expect(screen.getByPlaceholderText("Filter by name...")).toBeDefined();
  });

  it("filters labels by name", async () => {
    await renderPage();
    const input = screen.getByPlaceholderText("Filter by name...");
    fireEvent.change(input, { target: { value: "bug" } });
    expect(screen.getByText("bug")).toBeDefined();
    expect(screen.queryByText("frontend")).toBeNull();
    expect(screen.queryByText("agent")).toBeNull();
  });

  it("shows empty state when no labels", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ labels: [] }),
      }),
    );

    const { default: IssueLabelsPage } = await import(
      "@/app/(app)/settings/issue-labels/page"
    );
    render(<IssueLabelsPage />);

    await screen.findByText(/no labels/i);
  });

  it("shows description placeholder for labels without description", async () => {
    await renderPage();
    const placeholders = screen.getAllByText("Add label description...");
    expect(placeholders.length).toBe(2); // frontend and agent have no description
  });

  it("opens create label modal when 'New label' is clicked", async () => {
    await renderPage();
    fireEvent.click(screen.getByText("New label"));
    // Modal has heading "Create label" and a submit button "Create label"
    const createLabels = screen.getAllByText("Create label");
    expect(createLabels.length).toBeGreaterThanOrEqual(1);
    // Check modal heading exists
    expect(screen.getByText("Cancel")).toBeDefined();
    expect(screen.getByPlaceholderText("Label name")).toBeDefined();
    expect(
      screen.getByPlaceholderText("Add label description..."),
    ).toBeDefined();
  });

  it("opens create group modal when 'New group' is clicked", async () => {
    await renderPage();
    fireEvent.click(screen.getByText("New group"));
    const createGroups = screen.getAllByText("Create group");
    expect(createGroups.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByPlaceholderText("Label name")).toBeDefined();
    expect(
      screen.getByPlaceholderText("Add label description..."),
    ).toBeDefined();
  });

  it("toggles name sorting", async () => {
    await renderPage();
    const names = screen
      .getAllByTestId("label-name")
      .map((element) => element.textContent);
    expect(names).toEqual(["agent", "bug", "frontend"]);

    fireEvent.click(screen.getByRole("button", { name: /order by name/i }));

    const reversedNames = screen
      .getAllByTestId("label-name")
      .map((element) => element.textContent);
    expect(reversedNames).toEqual(["frontend", "bug", "agent"]);
  });

  it("deletes a label from the current list", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ labels: mockLabels }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );

    const { default: IssueLabelsPage } = await import(
      "@/app/(app)/settings/issue-labels/page"
    );
    render(<IssueLabelsPage />);

    await screen.findByText("bug");
    fireEvent.click(screen.getByRole("button", { name: "Delete bug" }));

    await waitFor(() => {
      expect(screen.queryByText("bug")).toBeNull();
    });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/labels/1", {
      method: "DELETE",
    });
  });

  it("edits label name, color, and description", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ labels: mockLabels }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ label: { id: "1" } }),
      });

    vi.stubGlobal("fetch", fetchMock);

    const { default: IssueLabelsPage } = await import(
      "@/app/(app)/settings/issue-labels/page"
    );
    render(<IssueLabelsPage />);

    await screen.findByText("bug");
    fireEvent.click(screen.getByRole("button", { name: "Edit bug" }));

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "defect" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "User-visible defect" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Color #3b82f6" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/labels/1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "defect",
          color: "#3b82f6",
          description: "User-visible defect",
          parentLabelId: null,
        }),
      });
    });

    expect(screen.getByText("defect")).toBeDefined();
    expect(screen.getByText("User-visible defect")).toBeDefined();
  });
});
