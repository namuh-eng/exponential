import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AppShell } from "@/app/(app)/app-shell";
import { usePathname } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

describe("AppShell context switching", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const baseProps = {
    workspaceName: "My Workspace",
    workspaceInitials: "MW",
    teamName: "Team A",
    teamId: "t-a",
    teamKey: "TA",
    teams: [
      { id: "t-a", name: "Team A", key: "TA" },
      { id: "t-b", name: "Team B", key: "TB" },
    ],
  };

  it("switches context when navigating between teams", async () => {
    // Initial path: Team A
    vi.mocked(usePathname).mockReturnValue("/team/TA/all");

    const fetchMock = vi.fn().mockImplementation((url) => {
      if (url.includes("/api/teams/TB/context")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              workspaceId: "ws-1",
              workspaceName: "My Workspace",
              workspaceInitials: "MW",
              teamId: "t-b",
              teamName: "Team B",
              teamKey: "TB",
              teams: baseProps.teams,
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <AppShell {...baseProps}>
        <div data-testid="child">Content</div>
      </AppShell>,
    );

    // Initial check (from props)
    expect(screen.getByText("Team A")).toBeInTheDocument();

    // Navigate to Team B
    vi.mocked(usePathname).mockReturnValue("/team/TB/all");
    rerender(
      <AppShell {...baseProps}>
        <div data-testid="child">Content</div>
      </AppShell>,
    );

    // Wait for context fetch and update
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/teams/TB/context"),
      );
    });

    await waitFor(() => {
      expect(screen.getByText("Team B")).toBeInTheDocument();
    });
  });

  it("handles navigation to settings and back correctly", async () => {
    vi.mocked(usePathname).mockReturnValue("/team/TA/all");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }),
    );

    const { rerender } = render(
      <AppShell {...baseProps}>
        <div data-testid="child">Content</div>
      </AppShell>,
    );

    expect(screen.getByText("Team A")).toBeInTheDocument();

    // Navigate to general settings
    vi.mocked(usePathname).mockReturnValue("/settings/account/preferences");
    rerender(
      <AppShell {...baseProps}>
        <div data-testid="child">Content</div>
      </AppShell>,
    );

    // Sidebar should still be visible in desktop (default state)
    expect(screen.getByTestId("app-sidebar-shell")).toBeVisible();
  });
});
