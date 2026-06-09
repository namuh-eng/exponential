import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let mockedWorkspaceSlug: string | undefined;

vi.mock("@/app/(app)/app-shell", () => ({
  useAppShellContext: () =>
    mockedWorkspaceSlug ? { workspaceSlug: mockedWorkspaceSlug } : null,
}));

function makeInitiative(overrides: Record<string, unknown> = {}) {
  return {
    id: "init-1",
    name: "Q2 Platform Overhaul",
    description: "Rebuild the core platform for scalability",
    status: "active" as const,
    projectCount: 3,
    completedProjectCount: 1,
    projects: [
      {
        id: "proj-1",
        name: "API Rewrite",
        status: "started",
        icon: "🔧",
        slug: "api-rewrite",
        completedIssueCount: 5,
        issueCount: 12,
      },
      {
        id: "proj-2",
        name: "Auth Migration",
        status: "completed",
        icon: "🔐",
        slug: "auth-migration",
        completedIssueCount: 8,
        issueCount: 8,
      },
    ],
    createdAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

// ─── InitiativeRow ──────────────────────────────────────────────────

describe("InitiativeRow", () => {
  afterEach(() => {
    mockedWorkspaceSlug = undefined;
    cleanup();
  });

  it("renders initiative name", async () => {
    const { InitiativeRow } = await import("@/components/initiative-row");
    render(<InitiativeRow initiative={makeInitiative()} />);
    expect(screen.getByText("Q2 Platform Overhaul")).toBeTruthy();
  });

  it("renders status badge", async () => {
    const { InitiativeRow } = await import("@/components/initiative-row");
    render(<InitiativeRow initiative={makeInitiative({ status: "active" })} />);
    expect(screen.getByText("Active")).toBeTruthy();
  });

  it("renders planned status", async () => {
    const { InitiativeRow } = await import("@/components/initiative-row");
    render(
      <InitiativeRow initiative={makeInitiative({ status: "planned" })} />,
    );
    expect(screen.getByText("Planned")).toBeTruthy();
  });

  it("renders completed status", async () => {
    const { InitiativeRow } = await import("@/components/initiative-row");
    render(
      <InitiativeRow initiative={makeInitiative({ status: "completed" })} />,
    );
    expect(screen.getByText("Completed")).toBeTruthy();
  });

  it("renders project count and progress", async () => {
    const { InitiativeRow } = await import("@/components/initiative-row");
    render(
      <InitiativeRow
        initiative={makeInitiative({
          completedProjectCount: 1,
          projectCount: 3,
        })}
      />,
    );
    expect(screen.getByText("1 / 3 projects")).toBeTruthy();
  });

  it("emits workspace-prefixed detail href when rendered inside a workspace shell", async () => {
    mockedWorkspaceSlug = "foreverbrowsing";
    const { InitiativeRow } = await import("@/components/initiative-row");
    render(<InitiativeRow initiative={makeInitiative()} />);

    expect(screen.getByTestId("initiative-row")).toHaveAttribute(
      "href",
      "/foreverbrowsing/initiatives/init-1",
    );
  });
});

// ─── InitiativeStatusBadge ──────────────────────────────────────────

describe("InitiativeStatusBadge", () => {
  afterEach(cleanup);

  it("renders active with correct styling", async () => {
    const { InitiativeStatusBadge } = await import(
      "@/components/initiative-status-badge"
    );
    render(<InitiativeStatusBadge status="active" />);
    const badge = screen.getByText("Active");
    expect(badge).toBeTruthy();
  });

  it("renders planned status", async () => {
    const { InitiativeStatusBadge } = await import(
      "@/components/initiative-status-badge"
    );
    render(<InitiativeStatusBadge status="planned" />);
    expect(screen.getByText("Planned")).toBeTruthy();
  });

  it("renders completed status", async () => {
    const { InitiativeStatusBadge } = await import(
      "@/components/initiative-status-badge"
    );
    render(<InitiativeStatusBadge status="completed" />);
    expect(screen.getByText("Completed")).toBeTruthy();
  });
});

// ─── InitiativeProjectList ──────────────────────────────────────────

describe("InitiativeProjectList", () => {
  afterEach(cleanup);

  it("renders linked projects with progress", async () => {
    const { InitiativeProjectList } = await import(
      "@/components/initiative-project-list"
    );
    const projects = [
      {
        id: "p1",
        name: "API Rewrite",
        status: "started",
        icon: "🔧",
        slug: "api-rewrite",
        completedIssueCount: 5,
        issueCount: 12,
      },
      {
        id: "p2",
        name: "Auth Migration",
        status: "completed",
        icon: "🔐",
        slug: "auth-migration",
        completedIssueCount: 8,
        issueCount: 8,
      },
    ];
    render(<InitiativeProjectList projects={projects} />);
    expect(screen.getByText("API Rewrite")).toBeTruthy();
    expect(screen.getByText("Auth Migration")).toBeTruthy();
  });

  it("shows empty message when no projects", async () => {
    const { InitiativeProjectList } = await import(
      "@/components/initiative-project-list"
    );
    render(<InitiativeProjectList projects={[]} />);
    expect(screen.getByText("No linked projects")).toBeTruthy();
  });

  it("shows project progress percentage", async () => {
    const { InitiativeProjectList } = await import(
      "@/components/initiative-project-list"
    );
    const projects = [
      {
        id: "p1",
        name: "Test Project",
        status: "started",
        icon: "📦",
        slug: "test-project",
        completedIssueCount: 3,
        issueCount: 6,
      },
    ];
    render(<InitiativeProjectList projects={projects} />);
    expect(screen.getByText("50%")).toBeTruthy();
  });

  it("links to the valid project overview route", async () => {
    const { InitiativeProjectList } = await import(
      "@/components/initiative-project-list"
    );
    const projects = [
      {
        id: "p1",
        name: "Slugged Project",
        status: "started",
        icon: "📦",
        slug: "slugged-project",
        completedIssueCount: 1,
        issueCount: 2,
      },
    ];
    render(<InitiativeProjectList projects={projects} />);
    expect(
      screen
        .getByRole("link", { name: /Slugged Project/i })
        .getAttribute("href"),
    ).toBe("/project/slugged-project/overview");
  });
});
