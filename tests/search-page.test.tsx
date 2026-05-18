import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import SearchPage from "@/app/(app)/search/page";
import { useSearchParams } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: vi.fn(),
  useRouter: () => ({ push: vi.fn() }),
}));

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
      expect(screen.getByTestId("issue-row")).toHaveAttribute(
        "href",
        "/foreverbrowsing/issue/ENG-1",
      );
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

  it("shows an error when the API omits required row metadata", async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams("q=Fix") as unknown as ReturnType<
        typeof useSearchParams
      >,
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              id: "i-1",
              identifier: "ENG-1",
              title: "Fix search layout",
              priority: "high",
            },
          ]),
      }),
    );

    render(<SearchPage />);

    await waitFor(() => {
      expect(
        screen.getByText(/missing required issue metadata/),
      ).toBeInTheDocument();
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
        json: () => Promise.resolve({ error: "nope" }),
      }),
    );

    render(<SearchPage />);

    await waitFor(() => {
      expect(screen.getByText(/Search failed/)).toBeInTheDocument();
    });
  });
});
