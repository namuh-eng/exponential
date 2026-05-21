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
      stateCategory: "started",
      stateColor: "#000000",
      teamKey: "ENG",
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
        "/foreverbrowsing/team/ENG/issue/ENG-1",
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
});
