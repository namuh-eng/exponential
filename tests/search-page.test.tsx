import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import SearchPage from "@/app/(app)/search/page";
import { usePathname, useSearchParams } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
  useSearchParams: vi.fn(),
  useRouter: () => ({ push: vi.fn() }),
}));

// The search page reads the active workspace slug from the app shell context
// and uses it to build issue-row hrefs via `withWorkspaceSlug`. Default to
// the foreverbrowsing workspace so the "renders results" assertion picks up
// the workspace-prefixed URL; tests for empty/error states don't care about
// hrefs, so the default is harmless there.
vi.mock("@/app/(app)/app-shell", () => ({
  useAppShellContext: () => ({ workspaceSlug: "foreverbrowsing" }),
}));

describe("SearchPage component", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const mockResults = [
    {
      id: "i-1",
      identifier: "ENG-1",
      title: "Fix search layout",
      priority: "high",
      stateName: "In Progress",
      stateCategory: "started",
      stateColor: "#000000",
      assigneeName: "Test User",
      createdAt: new Date().toISOString(),
    },
  ];

  it("renders search results for a query", async () => {
    vi.mocked(usePathname).mockReturnValue("/foreverbrowsing/search");
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams("q=Fix") as unknown as ReturnType<
        typeof useSearchParams
      > as unknown as ReturnType<typeof useSearchParams>,
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResults),
      }),
    );

    render(<SearchPage />);

    expect(screen.getByText(/Search results for "Fix"/)).toBeInTheDocument();

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/issues/search?q=Fix");
      expect(screen.getByText("Fix search layout")).toBeInTheDocument();
      expect(screen.getByText("ENG-1")).toBeInTheDocument();
      expect(screen.getByTestId("issue-row")).toHaveAttribute(
        "href",
        "/foreverbrowsing/issue/ENG-1",
      );
    });
  });

  it("shows empty state when no results are found", async () => {
    vi.mocked(usePathname).mockReturnValue("/search");
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams("q=nonexistent") as unknown as ReturnType<
        typeof useSearchParams
      > as unknown as ReturnType<typeof useSearchParams>,
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      }),
    );

    render(<SearchPage />);

    await waitFor(() => {
      expect(
        screen.getByText(/No issues found matching your search/),
      ).toBeInTheDocument();
    });
  });

  it("shows an error instead of rendering rows with missing metadata", async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams("q=broken") as unknown as ReturnType<
        typeof useSearchParams
      >,
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: "i-1", identifier: "ENG-1", title: "Incomplete row" },
          ]),
      }),
    );

    render(<SearchPage />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Search results could not be loaded/,
      );
    });
    expect(screen.queryByTestId("issue-row")).not.toBeInTheDocument();
  });

  it("shows an error when the search API fails", async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams("q=Fix") as unknown as ReturnType<
        typeof useSearchParams
      >,
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "boom" }),
      }),
    );

    render(<SearchPage />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Search results could not be loaded/,
      );
    });
  });
});
