import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const findAccessibleTeamMock = vi.fn();
const teamLimitMock = vi.fn();
const cyclesOrderByMock = vi.fn();
const completedStatesWhereMock = vi.fn();
const countWhereMock = vi.fn();
const lastCycleLimitMock = vi.fn();
const existingCyclesWhereMock = vi.fn();
const insertReturningMock = vi.fn();
let selectCallCount = 0;

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/lib/teams", () => ({
  findAccessibleTeam: findAccessibleTeamMock,
}));

vi.mock("@/lib/cycle-utils", () => ({
  parseCycleDateInput: vi.fn((val: string) => new Date(val)),
  cycleRangesOverlap: vi.fn(() => false),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn((selection: Record<string, unknown>) => {
      selectCallCount += 1;

      // GET primary team lookup
      if (selection && "timezone" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(teamLimitMock()),
            }),
          }),
        };
      }

      // GET cycles list fetch OR POST existingCycles check (both use no selection)
      if (!selection || Object.keys(selection).length === 0) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                // biome-ignore lint/suspicious/noThenProperty: <explanation>
                then: (resolve: (val: unknown) => void) =>
                  resolve(cyclesOrderByMock()),
              }),
              // biome-ignore lint/suspicious/noThenProperty: <explanation>
              then: (resolve: (val: unknown) => void) =>
                resolve(existingCyclesWhereMock()),
            }),
          }),
        };
      }

      // GET completed states lookup OR GET issue count lookup OR POST lastCycle lookup
      if (
        selection &&
        ("id" in selection || "value" in selection || "number" in selection)
      ) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(lastCycleLimitMock()),
              }),
              // biome-ignore lint/suspicious/noThenProperty: <explanation>
              then: (resolve: (val: unknown) => void) =>
                resolve(countWhereMock()),
              limit: vi.fn().mockResolvedValue(completedStatesWhereMock()),
            }),
          }),
        };
      }

      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        // biome-ignore lint/suspicious/noThenProperty: <explanation>
        then: (resolve: (val: unknown) => void) => resolve([]),
      };
      return chain;
    }),
    insert: vi.fn(() => ({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(insertReturningMock()),
      }),
    })),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("team cycles collection route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    selectCallCount = 0;
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    findAccessibleTeamMock.mockResolvedValue({
      id: "team-1",
      name: "Engineering",
      key: "ENG",
      workspaceId: "workspace-1",
    });
    teamLimitMock.mockReturnValue([
      { id: "team-1", name: "Engineering", key: "ENG" },
    ]);
    cyclesOrderByMock.mockReturnValue([
      {
        id: "cycle-1",
        name: "Cycle 1",
        startDate: new Date("2026-04-01"),
        endDate: new Date("2026-04-14"),
      },
    ]);
    countWhereMock.mockReturnValue([{ value: 3 }]);
    completedStatesWhereMock.mockReturnValue([]);
    lastCycleLimitMock.mockReturnValue([{ number: 1 }]);
    existingCyclesWhereMock.mockReturnValue([]);
    insertReturningMock.mockReturnValue([{ id: "cycle-2", number: 2 }]);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("legacy-api/teams/[key]/cycles/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "ENG" }),
    });

    expect(response.status).toBe(401);
  });

  it("returns team cycles", async () => {
    const { GET } = await import("legacy-api/teams/[key]/cycles/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "ENG" }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.cycles.length).toBe(1);
  });

  it("creates a new cycle", async () => {
    const { POST } = await import("legacy-api/teams/[key]/cycles/route");
    existingCyclesWhereMock.mockReturnValue([]);

    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          name: "Sprint 2",
          startDate: "2026-04-15",
          endDate: "2026-04-28",
        }),
      }),
      { params: Promise.resolve({ key: "ENG" }) },
    );

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.id).toBe("cycle-2");
  });

  it("rejects overlapping cycles", async () => {
    const { cycleRangesOverlap } = await import("@/lib/cycle-utils");
    vi.mocked(cycleRangesOverlap).mockReturnValue(true);
    existingCyclesWhereMock.mockReturnValue([
      {
        id: "cycle-1",
        startDate: new Date("2026-04-01"),
        endDate: new Date("2026-04-14"),
      },
    ]);
    const { POST } = await import("legacy-api/teams/[key]/cycles/route");

    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          name: "Overlap",
          startDate: "2026-04-10",
          endDate: "2026-04-20",
        }),
      }),
      { params: Promise.resolve({ key: "ENG" }) },
    );

    expect(response.status).toBe(409);
  });
});
