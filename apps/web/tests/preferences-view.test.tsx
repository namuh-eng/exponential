import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ACCOUNT_PREFERENCES_CHANGE_EVENT } from "@/lib/account-preferences";
import { useEffect, useState } from "react";
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
    automations: {
      autoAssignment: "off",
      gitBranchFormat: "team-id-title",
      statusTransitions: "manual",
    },
  },
};

function preferencesResponse(
  accountPreferences = mockPreferencesData.accountPreferences,
) {
  return {
    ok: true,
    json: async () => ({ accountPreferences }),
  } as Response;
}

function mockPreferencesFetch() {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (_url, init) => {
      if ((init as RequestInit | undefined)?.method === "PATCH") {
        const body = JSON.parse(String((init as RequestInit).body));
        return preferencesResponse(body.accountPreferences);
      }

      return preferencesResponse();
    });
}

function PreferenceChangeListener() {
  const [changeCount, setChangeCount] = useState(0);

  useEffect(() => {
    const onPreferencesChange = () => setChangeCount((current) => current + 1);

    window.addEventListener(
      ACCOUNT_PREFERENCES_CHANGE_EVENT,
      onPreferencesChange,
    );

    return () => {
      window.removeEventListener(
        ACCOUNT_PREFERENCES_CHANGE_EVENT,
        onPreferencesChange,
      );
    };
  }, []);

  return <div data-testid="preference-change-count">{changeCount}</div>;
}

function renderPreferencesWithShellListener() {
  return render(
    <>
      <PreferenceChangeListener />
      <PreferencesPage />
    </>,
  );
}

function renderPhaseWarningCalls(errorSpy: { mock: { calls: unknown[][] } }) {
  return errorSpy.mock.calls.filter((call) =>
    call.some(
      (argument) =>
        typeof argument === "string" &&
        argument.includes("Cannot update a component") &&
        argument.includes("while rendering a different component"),
    ),
  );
}

describe("PreferencesPage UI", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
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

  it("renders and persists automation preferences", async () => {
    const fetchSpy = mockPreferencesFetch();

    render(<PreferencesPage />);
    await screen.findByText("Automations");

    fireEvent.change(screen.getByLabelText("Auto-assignment"), {
      target: { value: "assign-to-me" },
    });
    fireEvent.change(screen.getByLabelText("Git branch format"), {
      target: { value: "owner/team-id-title" },
    });
    fireEvent.change(screen.getByLabelText("Status transitions"), {
      target: { value: "started" },
    });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/account/preferences",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"autoAssignment":"assign-to-me"'),
        }),
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/account/preferences",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining(
            '"gitBranchFormat":"owner/team-id-title"',
          ),
        }),
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/account/preferences",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"statusTransitions":"started"'),
        }),
      );
    });
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

  it("does not emit render-phase update warnings when preference changes notify the app shell", async () => {
    mockPreferencesFetch();
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    renderPreferencesWithShellListener();
    await screen.findByText("Preferences");

    fireEvent.click(screen.getByRole("button", { name: /Dark/ }));
    fireEvent.click(screen.getByRole("button", { name: /Light/ }));
    fireEvent.click(screen.getByRole("button", { name: /System preference/ }));
    fireEvent.change(screen.getByLabelText("Font size"), {
      target: { value: "large" },
    });
    fireEvent.click(screen.getByLabelText("Use pointer cursors"));
    fireEvent.click(screen.getByLabelText("Customize sidebar"));
    fireEvent.change(screen.getByLabelText("Inbox visibility"), {
      target: { value: "hide" },
    });

    await waitFor(() => {
      expect(screen.getByText("Saved")).toBeInTheDocument();
    });
    expect(
      Number(screen.getByTestId("preference-change-count").textContent),
    ).toBeGreaterThan(0);
    expect(renderPhaseWarningCalls(consoleErrorSpy)).toHaveLength(0);
  });

  it("keeps the latest rapid preference change when older PATCH responses finish later", async () => {
    let releaseFirstPatch: (() => void) | undefined;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if ((init as RequestInit | undefined)?.method !== "PATCH") {
        return preferencesResponse({
          ...mockPreferencesData.accountPreferences,
          theme: "system",
        });
      }

      const body = JSON.parse(String((init as RequestInit).body));
      const preferences = body.accountPreferences;

      if (preferences.theme === "dark") {
        await new Promise<void>((resolve) => {
          releaseFirstPatch = resolve;
        });
      }

      return preferencesResponse(preferences);
    });

    render(<PreferencesPage />);
    await screen.findByText("Preferences");

    fireEvent.click(screen.getByRole("button", { name: /Dark/ }));
    fireEvent.click(screen.getByRole("button", { name: /Light/ }));

    await waitFor(() => {
      expect(screen.getByText("Saved")).toBeInTheDocument();
    });

    releaseFirstPatch?.();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Light/ })).toHaveClass(
        "border-[var(--color-accent)]",
      );
    });
  });
});
