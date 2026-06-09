import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import EmojisSettingsPage from "@/app/(app)/settings/emojis/page";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

describe("EmojisSettingsPage component", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ emojis: [] }),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders the emojis settings page with an upload form and empty state", async () => {
    render(<EmojisSettingsPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.getByText("Custom emojis")).toBeInTheDocument();
        expect(screen.getByText(/Upload custom emojis/)).toBeInTheDocument();
        expect(screen.getByText("No custom emojis")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    const uploadButton = screen.getByRole("button", { name: "Upload emoji" });
    expect(uploadButton).not.toBeDisabled();
  });
});
