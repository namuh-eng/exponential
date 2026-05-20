import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ─── Cycle helpers ──────────────────────────────────────────────────

function makeCycle(overrides: Record<string, unknown> = {}) {
  return {
    id: "cycle-1",
    name: null,
    number: 1,
    teamId: "team-1",
    startDate: "2026-03-30T00:00:00.000Z",
    endDate: "2026-04-13T00:00:00.000Z",
    autoRollover: true,
    createdAt: "2026-03-30T00:00:00.000Z",
    updatedAt: "2026-03-30T00:00:00.000Z",
    issueCount: 10,
    completedIssueCount: 4,
    ...overrides,
  };
}

// ─── CycleProgressBar ───────────────────────────────────────────────

describe("CycleProgressBar", () => {
  afterEach(cleanup);

  it("renders progress percentage", async () => {
    const { CycleProgressBar } = await import(
      "@/components/cycle-progress-bar"
    );
    render(<CycleProgressBar completed={4} total={10} />);
    expect(screen.getByText("40%")).toBeTruthy();
  });

  it("renders 0% when no issues", async () => {
    const { CycleProgressBar } = await import(
      "@/components/cycle-progress-bar"
    );
    render(<CycleProgressBar completed={0} total={0} />);
    expect(screen.getByText("0%")).toBeTruthy();
  });

  it("renders 100% when all complete", async () => {
    const { CycleProgressBar } = await import(
      "@/components/cycle-progress-bar"
    );
    render(<CycleProgressBar completed={5} total={5} />);
    expect(screen.getByText("100%")).toBeTruthy();
  });

  it("shows issue count text", async () => {
    const { CycleProgressBar } = await import(
      "@/components/cycle-progress-bar"
    );
    render(<CycleProgressBar completed={3} total={8} />);
    expect(screen.getByText("3 / 8 issues")).toBeTruthy();
  });
});

// ─── CycleRow ───────────────────────────────────────────────────────

describe("CycleRow", () => {
  afterEach(cleanup);

  it("renders cycle number as name when no custom name", async () => {
    const { CycleRow } = await import("@/components/cycle-row");
    const cycle = makeCycle({ name: null, number: 3 });
    render(<CycleRow cycle={cycle} teamKey="ENG" />);
    expect(screen.getByText("Cycle 3")).toBeTruthy();
  });

  it("renders custom name when provided", async () => {
    const { CycleRow } = await import("@/components/cycle-row");
    const cycle = makeCycle({ name: "Sprint Alpha" });
    render(<CycleRow cycle={cycle} teamKey="ENG" />);
    expect(screen.getByText("Sprint Alpha")).toBeTruthy();
  });

  it("renders date range", async () => {
    const { CycleRow } = await import("@/components/cycle-row");
    const cycle = makeCycle({
      startDate: "2026-03-30T00:00:00.000Z",
      endDate: "2026-04-13T00:00:00.000Z",
    });
    render(<CycleRow cycle={cycle} teamKey="ENG" />);
    expect(screen.getByText(/Mar 30/)).toBeTruthy();
    expect(screen.getByText(/Apr 13/)).toBeTruthy();
  });

  it("renders progress bar", async () => {
    const { CycleRow } = await import("@/components/cycle-row");
    const cycle = makeCycle({ completedIssueCount: 4, issueCount: 10 });
    render(<CycleRow cycle={cycle} teamKey="ENG" />);
    expect(screen.getByText("40%")).toBeTruthy();
  });

  it("shows issue count", async () => {
    const { CycleRow } = await import("@/components/cycle-row");
    const cycle = makeCycle({ issueCount: 10 });
    render(<CycleRow cycle={cycle} teamKey="ENG" />);
    expect(screen.getByText(/10/)).toBeTruthy();
  });

  it("preserves workspace slug in cycle detail links when provided", async () => {
    const { CycleRow } = await import("@/components/cycle-row");
    render(
      <CycleRow
        cycle={makeCycle({ id: "cycle-1" })}
        teamKey="ENG"
        workspaceSlug="foreverbrowsing"
      />,
    );

    expect(screen.getByTestId("cycle-row").getAttribute("href")).toBe(
      "/foreverbrowsing/team/ENG/cycles/cycle-1",
    );
  });
});

// ─── CycleSection ───────────────────────────────────────────────────

describe("CycleSection", () => {
  afterEach(cleanup);

  it("renders section title", async () => {
    const { CycleSection } = await import("@/components/cycle-section");
    render(
      <CycleSection
        title="Current Cycle"
        cycles={[makeCycle()]}
        teamKey="ENG"
      />,
    );
    expect(screen.getByText("Current Cycle")).toBeTruthy();
  });

  it("renders multiple cycles", async () => {
    const { CycleSection } = await import("@/components/cycle-section");
    const cycles = [
      makeCycle({ id: "c1", number: 1 }),
      makeCycle({ id: "c2", number: 2 }),
    ];
    render(<CycleSection title="Upcoming" cycles={cycles} teamKey="ENG" />);
    expect(screen.getByText("Cycle 1")).toBeTruthy();
    expect(screen.getByText("Cycle 2")).toBeTruthy();
  });

  it("does not render when cycles array is empty", async () => {
    const { CycleSection } = await import("@/components/cycle-section");
    const { container } = render(
      <CycleSection title="Past" cycles={[]} teamKey="ENG" />,
    );
    expect(container.innerHTML).toBe("");
  });
});

// ─── Cycle date categorization ──────────────────────────────────────

describe("categorizeCycles", () => {
  it("categorizes current, upcoming, and past cycles", async () => {
    const { categorizeCycles } = await import("@/lib/cycle-utils");
    const now = new Date("2026-04-07T12:00:00.000Z");
    const cycles = [
      makeCycle({
        id: "current",
        startDate: "2026-04-01T00:00:00.000Z",
        endDate: "2026-04-14T00:00:00.000Z",
      }),
      makeCycle({
        id: "upcoming",
        startDate: "2026-04-15T00:00:00.000Z",
        endDate: "2026-04-28T00:00:00.000Z",
      }),
      makeCycle({
        id: "past",
        startDate: "2026-03-15T00:00:00.000Z",
        endDate: "2026-03-28T00:00:00.000Z",
      }),
    ];
    const result = categorizeCycles(cycles, now);
    expect(result.current?.id).toBe("current");
    expect(result.upcoming.length).toBe(1);
    expect(result.upcoming[0].id).toBe("upcoming");
    expect(result.past.length).toBe(1);
    expect(result.past[0].id).toBe("past");
  });

  it("returns null current when no active cycle", async () => {
    const { categorizeCycles } = await import("@/lib/cycle-utils");
    const now = new Date("2026-04-07T12:00:00.000Z");
    const cycles = [
      makeCycle({
        id: "past",
        startDate: "2026-03-01T00:00:00.000Z",
        endDate: "2026-03-14T00:00:00.000Z",
      }),
    ];
    const result = categorizeCycles(cycles, now);
    expect(result.current).toBeNull();
    expect(result.past.length).toBe(1);
  });

  it("uses the provided team timezone when determining the active cycle", async () => {
    const { categorizeCycles } = await import("@/lib/cycle-utils");
    const now = new Date("2026-04-08T02:15:00+09:00");
    const cycles = [
      makeCycle({
        id: "current-la",
        startDate: "2026-03-18T00:00:00.000Z",
        endDate: "2026-04-07T00:00:00.000Z",
      }),
      makeCycle({
        id: "upcoming-la",
        startDate: "2026-04-08T00:00:00.000Z",
        endDate: "2026-04-28T00:00:00.000Z",
      }),
    ];

    const result = categorizeCycles(cycles, now, "America/Los_Angeles");
    expect(result.current?.id).toBe("current-la");
    expect(result.upcoming[0]?.id).toBe("upcoming-la");
  });
});

// ─── formatCycleDate ────────────────────────────────────────────────

describe("formatCycleDate", () => {
  it("formats date as short month + day", async () => {
    const { formatCycleDate } = await import("@/lib/cycle-utils");
    expect(formatCycleDate("2026-04-07T00:00:00.000Z")).toBe("Apr 7");
  });

  it("formats date in different month", async () => {
    const { formatCycleDate } = await import("@/lib/cycle-utils");
    expect(formatCycleDate("2026-01-15T00:00:00.000Z")).toBe("Jan 15");
  });
});

describe("getDateInputValue", () => {
  it("returns the requested timezone calendar date instead of the UTC date", async () => {
    const { getDateInputValue } = await import("@/lib/cycle-utils");
    const kstDate = new Date("2026-04-08T02:06:37+09:00");
    expect(getDateInputValue(kstDate, "Asia/Seoul")).toBe("2026-04-08");
  });
});

describe("cycleRangesOverlap", () => {
  it("returns true when cycle ranges overlap", async () => {
    const { cycleRangesOverlap } = await import("@/lib/cycle-utils");

    expect(
      cycleRangesOverlap(
        new Date("2026-04-01T00:00:00.000Z"),
        new Date("2026-04-14T00:00:00.000Z"),
        new Date("2026-04-10T00:00:00.000Z"),
        new Date("2026-04-21T00:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("returns false when cycle ranges only touch at the boundary", async () => {
    const { cycleRangesOverlap } = await import("@/lib/cycle-utils");

    expect(
      cycleRangesOverlap(
        new Date("2026-04-01T00:00:00.000Z"),
        new Date("2026-04-14T00:00:00.000Z"),
        new Date("2026-04-15T00:00:00.000Z"),
        new Date("2026-04-28T00:00:00.000Z"),
      ),
    ).toBe(false);
  });
});
