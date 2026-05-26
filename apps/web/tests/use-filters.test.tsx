import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useFilters } from "@/hooks/use-filters";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

describe("useFilters", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();

    Object.defineProperty(window, "localStorage", {
      writable: true,
      value: {
        getItem: vi.fn((key: string) => storage.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
          storage.set(key, value);
        }),
        removeItem: vi.fn((key: string) => {
          storage.delete(key);
        }),
        clear: vi.fn(() => {
          storage.clear();
        }),
      },
    });
  });

  it("persists filters for a scope and restores them for the next mount", () => {
    const { result, unmount } = renderHook(() => useFilters("team-1"));

    act(() => {
      result.current.updateFilters([
        { type: "priority", operator: "is", values: ["high"] },
      ]);
    });

    unmount();

    const { result: nextResult } = renderHook(() => useFilters("team-1"));
    expect(nextResult.current.filters).toEqual([
      { type: "priority", operator: "is", values: ["high"] },
    ]);
  });

  it("isolates filters by scope", () => {
    const { result: scope1 } = renderHook(() => useFilters("team-1"));
    const { result: scope2 } = renderHook(() => useFilters("team-2"));

    act(() => {
      scope1.current.updateFilters([
        { type: "priority", operator: "is", values: ["high"] },
      ]);
    });

    expect(scope2.current.filters).toEqual([]);
  });
});
