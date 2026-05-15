import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import TeamAnalyticsPage from "@/app/(app)/team/[key]/analytics/page";
import { useParams } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useParams: vi.fn(),
}));

const mockAnalyticsData = {
  team: { id: "t-1", key: "ENG", name: "Engineering" },
  query: {
    measure: "issue_count",
    slice: "status",
    segment: "none",
    range: "90d",
  },
  controls: {
    measures: [
      { value: "issue_count", label: "Issue count" },
      { value: "effort", label: "Effort" },
    ],
    slices: [
      { value: "status", label: "Status" },
      { value: "project", label: "Project" },
    ],
    segments: [
      { value: "none", label: "No segment" },
      { value: "project", label: "Project" },
    ],
    ranges: [
      { value: "30d", label: "Last 30 days" },
      { value: "90d", label: "Last 90 days" },
    ],
  },
  filters: {
    statuses: ["completed", "started"],
    projects: [{ id: "p-1", name: "Analytics" }],
    teams: [{ id: "t-1", key: "ENG", name: "Engineering" }],
    labels: ["reporting"],
  },
  summary: {
    issueCount: 2,
    completedCount: 1,
    effort: 8,
    velocity: 1,
    period: "Last 90 days",
  },
  chart: {
    title: "Issue count by Status",
    points: [
      { key: "Done", label: "Done", value: 1, issueIds: ["i-1"] },
      { key: "In Progress", label: "In Progress", value: 1, issueIds: ["i-2"] },
    ],
  },
  tableRows: [
    {
      key: "Done",
      label: "Done",
      value: 1,
      issueIds: ["i-1"],
      count: 1,
      completed: 1,
      effort: 3,
    },
    {
      key: "In Progress",
      label: "In Progress",
      value: 1,
      issueIds: ["i-2"],
      count: 1,
      completed: 0,
      effort: 5,
    },
  ],
  cycleMetrics: [
    {
      id: "c-1",
      name: "Cycle 1",
      total: 2,
      completed: 1,
      percentage: 50,
      burndown: [
        { label: "Start", scope: 2, target: 2, started: 0, completed: 0 },
        { label: "Mid", scope: 2, target: 1, started: 1, completed: 1 },
        { label: "Now", scope: 2, target: 0, started: 1, completed: 1 },
      ],
    },
  ],
  emptyState: null as string | null,
  actions: {
    csv: { enabled: true, label: "Export CSV" },
    share: { enabled: true, label: "Copy share link" },
    fullscreen: { enabled: true, label: "Full screen" },
  },
};

describe("TeamAnalyticsPage component", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  function stubFetch(data = mockAnalyticsData) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("renders a Linear-like Insights builder with chart, table, actions, and cycle burndown", async () => {
    vi.mocked(useParams).mockReturnValue({ key: "ENG" });
    stubFetch();

    render(<TeamAnalyticsPage />);

    expect(screen.getByText("Loading analytics...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Linear Insights")).toBeInTheDocument();
      expect(screen.getByLabelText("Measure")).toBeInTheDocument();
      expect(screen.getByLabelText("Slice")).toBeInTheDocument();
      expect(screen.getByLabelText("Segment")).toBeInTheDocument();
      expect(screen.getByLabelText("Status type")).toBeInTheDocument();
      expect(screen.getByLabelText("Project")).toBeInTheDocument();
      expect(screen.getByLabelText("Team")).toBeInTheDocument();
      expect(screen.getByLabelText("Label")).toBeInTheDocument();
      expect(screen.getByText("Issue count by Status")).toBeInTheDocument();
      expect(screen.getByText("Backing table")).toBeInTheDocument();
      expect(screen.getByText("Cycle graph / burndown")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Export CSV" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Copy share link" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Full screen" }),
      ).toBeInTheDocument();
    });
  });

  it("refetches when analytics controls change and highlights chart-backed issue rows", async () => {
    vi.mocked(useParams).mockReturnValue({ key: "ENG" });
    const fetchMock = stubFetch();

    render(<TeamAnalyticsPage />);

    await screen.findByText("Issue count by Status");
    fireEvent.change(screen.getByLabelText("Measure"), {
      target: { value: "effort" },
    });
    fireEvent.change(screen.getByLabelText("Project"), {
      target: { value: "p-1" },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        expect.stringContaining("measure=effort"),
      );
      expect(fetchMock).toHaveBeenLastCalledWith(
        expect.stringContaining("project=p-1"),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /Done/ }));
    expect(
      screen.getByText("Highlighted 1 issues for Done."),
    ).toBeInTheDocument();
  });

  it("exports CSV, shares links, toggles full screen, opens via shortcut, and shows empty states", async () => {
    vi.mocked(useParams).mockReturnValue({ key: "EMPTY" });
    const emptyData = {
      ...mockAnalyticsData,
      tableRows: [],
      chart: { ...mockAnalyticsData.chart, points: [] },
      cycleMetrics: [],
      emptyState: "No issues match these analytics filters.",
    };
    stubFetch(emptyData);
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal("navigator", { clipboard });

    render(<TeamAnalyticsPage />);

    await screen.findByText("No issues match these analytics filters.");
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(
      screen.getByText("Exported Insights CSV for the current filters."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy share link" }));
    await waitFor(() =>
      expect(clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining("measure=issue_count"),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    expect(
      screen.getByRole("button", { name: "Exit full screen" }),
    ).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "I", ctrlKey: true, shiftKey: true });
    expect(
      screen.getByText("Insights panel opened for the current team view."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Enable cycles or assign issues to a cycle/),
    ).toBeInTheDocument();
  });
});
