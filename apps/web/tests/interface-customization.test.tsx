import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import AccountPreferencesPage from "@/app/(app)/settings/account/preferences/page";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("Theme and Interface Customization", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    localStorage.clear();
    document.documentElement.className = "";
    delete document.documentElement.dataset.theme;
  });

  const mockPreferences = {
    accountPreferences: {
      theme: "light",
      fontSize: "default",
      pointerCursors: false,
    },
  };

  it("applies theme change instantly to the document element", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPreferences),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

    vi.stubGlobal("fetch", fetchMock);

    render(<AccountPreferencesPage />);

    // Wait for initial load
    await waitFor(() =>
      expect(screen.getByText("Preferences")).toBeInTheDocument(),
    );

    // Switch to Dark theme
    const darkButton = screen.getByRole("button", { name: /dark/i });
    fireEvent.click(darkButton);

    // Verify document state
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");

    // Verify persistence call
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/account/preferences",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"theme":"dark"'),
        }),
      );
    });
  });

  it("toggles pointer cursors and updates dataset", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPreferences),
      }),
    );

    render(<AccountPreferencesPage />);
    await waitFor(() =>
      expect(screen.getByText("Preferences")).toBeInTheDocument(),
    );

    const toggle = screen.getByRole("switch", { name: /pointer cursors/i });
    fireEvent.click(toggle);

    expect(document.documentElement.dataset.pointerCursors).toBe("true");
  });
});
