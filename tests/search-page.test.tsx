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
      stateName: "In Progress",
      stateCategory: "started",
      stateColor: "#000000",
      assigneeName: "Test User",
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

    expect(screen.getByTestId("issue-row")).toHaveAttribute(
      "href",
      "/issue/ENG-1",
    );
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
