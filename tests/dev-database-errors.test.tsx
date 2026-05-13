import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const dbSelectMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: dbSelectMock,
  },
}));

vi.mock("@/lib/approved-domain-auto-join", () => ({
  autoJoinWorkspaceForApprovedDomain: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({ get: vi.fn() })),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
}));

vi.mock("@/app/(app)/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

describe("dev database outage handling", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("renders an actionable setup error instead of throwing the protected route crash when Postgres is unavailable", async () => {
    const error = Object.assign(
      new Error("connect ECONNREFUSED 127.0.0.1:5432"),
      { code: "ECONNREFUSED" },
    );
    getSessionMock.mockRejectedValue(error);

    const { default: AppLayout } = await import("@/app/(app)/layout");
    const ui = await AppLayout({ children: <div>settings page</div> });

    render(ui);

    expect(
      screen.getByText("Local database is unavailable"),
    ).toBeInTheDocument();
    expect(screen.getByText(/make dev-services/)).toBeInTheDocument();
    expect(screen.getByText(/npm run db:push/)).toBeInTheDocument();
    expect(screen.queryByText("settings page")).not.toBeInTheDocument();
  });

  it("renders the setup error when a cached session exists but workspace lookup cannot reach Postgres", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });
    dbSelectMock.mockImplementation(() => {
      throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
        code: "ECONNREFUSED",
      });
    });

    const { default: AppLayout } = await import("@/app/(app)/layout");
    const ui = await AppLayout({ children: <div>settings page</div> });

    render(ui);

    expect(
      screen.getByText("Local database is unavailable"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("app-shell")).not.toBeInTheDocument();
  });

  it("classifies common Postgres connection failures as database bootstrap errors", async () => {
    const { isDatabaseBootstrapError } = await import(
      "@/lib/dev-database-error"
    );

    expect(
      isDatabaseBootstrapError(
        Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
          code: "ECONNREFUSED",
        }),
      ),
    ).toBe(true);
    expect(
      isDatabaseBootstrapError(
        new Error("password authentication failed for user"),
      ),
    ).toBe(true);
    expect(
      isDatabaseBootstrapError(new Error("ordinary application bug")),
    ).toBe(false);
  });
});
