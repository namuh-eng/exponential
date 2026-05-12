import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({}),
}));

import PreferencesPage from "@/app/(app)/settings/account/preferences/page";

const mockPreferencesData = {
  accountPreferences: {
    theme: "dark",
    fontSize: "default",
    displayNames: "full",
    defaultHomeView: "inbox",
    convertEmoticons: true,
    pointerCursors: false,
    firstDayOfWeek: "monday",
    sidebarBadgeStyle: "count",
    sidebarVisibility: {
      inbox: true,
      myIssues: true,
      projects: true,
      views: true,
      initiatives: true,
      cycles: true,
    },
    openInDesktopApp: true,
    sendCommentShortcut: "cmd-enter",
  },
};

describe("PreferencesPage UI", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders preferences and updates a toggle", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      if (url.toString().includes("/api/account/preferences")) {
        return Promise.resolve({
          ok: true,
          json: async () => mockPreferencesData,
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });

    render(<PreferencesPage />);

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText("Preferences")).toBeInTheDocument();
    });

    const pointerToggle = screen.getByLabelText("Use pointer cursors");
    expect(pointerToggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(pointerToggle);

    await waitFor(() => {
      expect(pointerToggle).toHaveAttribute("aria-checked", "true");
    });
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("updates a select preference", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      if (url.toString().includes("/api/account/preferences")) {
        return Promise.resolve({
          ok: true,
          json: async () => mockPreferencesData,
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });

    render(<PreferencesPage />);
    await screen.findByText("Preferences");

    const homeViewSelect = screen.getByLabelText("Default home view");
    fireEvent.change(homeViewSelect, { target: { value: "my-issues" } });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/account/preferences",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"defaultHomeView":"my-issues"'),
        }),
      );
    });
  });

  it("opens and interacts with sidebar customization modal", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockPreferencesData,
    } as Response);

    render(<PreferencesPage />);
    await screen.findByText("Preferences");

    fireEvent.click(screen.getByLabelText("Customize sidebar"));

    expect(screen.getByText("Customize sidebar")).toBeInTheDocument();

    const inboxVisibility = screen.getByLabelText("Inbox visibility");
    expect(inboxVisibility).toHaveValue("show");

    fireEvent.change(inboxVisibility, { target: { value: "hide" } });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/account/preferences",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"inbox":false'),
        }),
      );
    });

    fireEvent.click(screen.getByLabelText("Close modal dialog"));
    expect(screen.queryByText("Customize sidebar")).not.toBeInTheDocument();
  });

  it("changes theme", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockPreferencesData,
    } as Response);

    render(<PreferencesPage />);
    await screen.findByText("Preferences");

    const lightThemeCard = screen.getByRole("button", { name: /Light/ });
    fireEvent.click(lightThemeCard);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/account/preferences",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"theme":"light"'),
        }),
      );
    });
  });
});
