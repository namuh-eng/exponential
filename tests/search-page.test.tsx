import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import SearchPage from "@/app/(app)/search/page";
import { useSearchParams } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
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
      createdAt: new Date().toISOString(),
    },
  ];

  it("renders search results for a query", async () => {
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
      expect(screen.getByText("Fix search layout")).toBeInTheDocument();
      expect(screen.getByText("ENG-1")).toBeInTheDocument();
    });
  });

  it("shows empty state when no results are found", async () => {
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
