import { useFilters } from "@/hooks/use-filters";
import { act, cleanup, renderHook } from "@testing-library/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  usePathname: vi.fn(),
  useSearchParams: vi.fn(),
}));

describe("useFilters hook", () => {
  const replaceMock = vi.fn();

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("loads filters from URL query parameter", () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams("f=status:is:s-1") as unknown as ReturnType<
        typeof useSearchParams
      > as unknown as ReturnType<typeof useSearchParams>,
    );
    vi.mocked(usePathname).mockReturnValue("/team/ENG/all");
    vi.mocked(useRouter).mockReturnValue({
      replace: replaceMock,
    } as unknown as ReturnType<typeof useRouter>);

    const { result } = renderHook(() => useFilters("test-scope"));

    expect(result.current.filters).toEqual([
      { type: "status", operator: "is", values: ["s-1"] },
    ]);
  });

  it("syncs filter changes to URL and LocalStorage", () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>,
    );
    vi.mocked(usePathname).mockReturnValue("/team/ENG/all");
    vi.mocked(useRouter).mockReturnValue({
      replace: replaceMock,
    } as unknown as ReturnType<typeof useRouter>);

    const { result } = renderHook(() => useFilters("test-scope"));

    act(() => {
      result.current.updateFilters([
        { type: "priority", operator: "is", values: ["high"] },
      ]);
    });

    // Check LocalStorage
    const stored = localStorage.getItem("whetline-filters:test-scope");
    expect(JSON.parse(stored ?? "[]")).toEqual([
      { type: "priority", operator: "is", values: ["high"] },
    ]);

    // Check URL Sync
    expect(replaceMock).toHaveBeenCalledWith(
      "/team/ENG/all?f=priority%3Ais%3Ahigh",
    );
  });

  it("handles multiple filter types and values", () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>,
    );
    vi.mocked(usePathname).mockReturnValue("/team/ENG/all");
    vi.mocked(useRouter).mockReturnValue({
      replace: replaceMock,
    } as unknown as ReturnType<typeof useRouter>);

    const { result } = renderHook(() => useFilters("test-scope"));

    act(() => {
      result.current.updateFilters([
        { type: "status", operator: "is", values: ["s-1", "s-2"] },
        { type: "priority", operator: "isNot", values: ["low"] },
      ]);
    });

    expect(replaceMock).toHaveBeenCalledWith(
      "/team/ENG/all?f=status%3Ais%3As-1%2Cs-2%3Bpriority%3AisNot%3Alow",
    );
  });
});
