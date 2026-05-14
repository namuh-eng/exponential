import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import {
  OPEN_COMMAND_PALETTE_EVENT,
  OPEN_CREATE_ISSUE_FULLSCREEN_EVENT,
} from "@/lib/command-palette";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/",
}));

// Must import after mocks
import { CommandPalette } from "@/components/command-palette";

describe("CommandPalette", () => {
  beforeEach(() => {
    pushMock.mockReset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("does not render when closed", () => {
    render(<CommandPalette teamKey="ENG" />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens on Cmd+K keyboard shortcut", () => {
    render(<CommandPalette teamKey="ENG" />);

    fireEvent.keyDown(document, { key: "k", metaKey: true });

    expect(screen.getByRole("dialog")).toBeDefined();
    expect(
      screen.getByPlaceholderText("Type a command or search..."),
    ).toBeDefined();
  });

  it("opens on Ctrl+K keyboard shortcut", () => {
    render(<CommandPalette teamKey="ENG" />);

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });

    expect(screen.getByRole("dialog")).toBeDefined();
  });

  it("opens on uppercase Cmd+K keyboard shortcut", () => {
    render(<CommandPalette teamKey="ENG" />);

    fireEvent.keyDown(document, { key: "K", metaKey: true });

    expect(screen.getByRole("dialog")).toBeDefined();
  });

  it("opens on physical KeyK shortcut when key casing varies", () => {
    render(<CommandPalette teamKey="ENG" />);

    fireEvent.keyDown(document, { key: "Dead", code: "KeyK", ctrlKey: true });

    expect(screen.getByRole("dialog")).toBeDefined();
  });

  it("does not open from Cmd/Ctrl+K while typing in editable fields", () => {
    render(
      <>
        <input aria-label="Name input" />
        <textarea aria-label="Description textarea" />
        <select aria-label="Status select">
          <option>Open</option>
        </select>
        <div contentEditable aria-label="Rich editor">
          Rich editor content
          <span data-testid="rich-editor-child">child</span>
        </div>
        <CommandPalette teamKey="ENG" />
      </>,
    );

    fireEvent.keyDown(screen.getByLabelText("Name input"), {
      key: "k",
      ctrlKey: true,
    });
    fireEvent.keyDown(screen.getByLabelText("Description textarea"), {
      key: "k",
      metaKey: true,
    });
    fireEvent.keyDown(screen.getByLabelText("Status select"), {
      key: "K",
      ctrlKey: true,
    });
    fireEvent.keyDown(screen.getByTestId("rich-editor-child"), {
      key: "k",
      metaKey: true,
    });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape key", () => {
    render(<CommandPalette teamKey="ENG" />);

    // Open
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.getByRole("dialog")).toBeDefined();

    // Close
    const input = screen.getByPlaceholderText("Type a command or search...");
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on backdrop click", () => {
    render(<CommandPalette teamKey="ENG" />);

    // Open
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.getByRole("dialog")).toBeDefined();

    // Click backdrop
    const backdrop = document.querySelector('[role="presentation"]');
    expect(backdrop).not.toBeNull();
    if (backdrop) fireEvent.click(backdrop);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows command groups when opened", () => {
    render(<CommandPalette teamKey="ENG" />);

    fireEvent.keyDown(document, { key: "k", metaKey: true });

    expect(screen.getByText("Views")).toBeDefined();
    expect(screen.getByText("Issues")).toBeDefined();
    expect(screen.getByText("Projects")).toBeDefined();
    expect(screen.getByText("Documents")).toBeDefined();
    expect(screen.getByText("Filter")).toBeDefined();
    expect(screen.getByText("Templates")).toBeDefined();
    expect(screen.getByText("Navigation")).toBeDefined();
    expect(screen.getByText("Create new issue")).toBeDefined();
    expect(screen.getByText("Create label")).toBeDefined();
    expect(screen.getByText("Open last issue")).toBeDefined();
  });

  it("filters commands by query", () => {
    render(<CommandPalette teamKey="ENG" />);

    fireEvent.keyDown(document, { key: "k", metaKey: true });

    const input = screen.getByPlaceholderText("Type a command or search...");
    fireEvent.change(input, { target: { value: "inbox" } });

    expect(screen.getByText("Go to Inbox")).toBeDefined();
    expect(screen.queryByText("Create new issue")).toBeNull();
  });

  it("navigates with Enter key on a navigation command", () => {
    render(<CommandPalette teamKey="ENG" />);

    fireEvent.keyDown(document, { key: "k", metaKey: true });

    const input = screen.getByPlaceholderText("Type a command or search...");
    fireEvent.change(input, { target: { value: "inbox" } });

    // Press Enter to select the first result
    fireEvent.keyDown(input, { key: "Enter" });

    expect(pushMock).toHaveBeenCalledWith("/inbox");
  });

  it("opens issue label settings from the Create label command", () => {
    render(<CommandPalette teamKey="ENG" />);

    fireEvent.keyDown(document, { key: "k", metaKey: true });

    const input = screen.getByPlaceholderText("Type a command or search...");
    fireEvent.change(input, { target: { value: "create label" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(pushMock).toHaveBeenCalledWith("/settings/issue-labels");
  });

  it("shows keyboard shortcuts for commands", () => {
    render(<CommandPalette teamKey="ENG" />);

    fireEvent.keyDown(document, { key: "k", metaKey: true });

    // "C" shortcut for Create new issue
    expect(screen.getByText("C")).toBeDefined();
    expect(screen.getByText("Cmd")).toBeDefined();
  });

  it("uses teamKey for team-scoped navigation", () => {
    render(<CommandPalette teamKey="MYTEAM" />);

    fireEvent.keyDown(document, { key: "k", metaKey: true });

    const input = screen.getByPlaceholderText("Type a command or search...");
    fireEvent.change(input, { target: { value: "board" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(pushMock).toHaveBeenCalledWith("/team/MYTEAM/board");
  });

  it("shows empty state when no results match", () => {
    render(<CommandPalette teamKey="ENG" />);

    fireEvent.keyDown(document, { key: "k", metaKey: true });

    const input = screen.getByPlaceholderText("Type a command or search...");
    fireEvent.change(input, {
      target: { value: "xyznonexistentcommand123" },
    });

    expect(screen.getByText(/No results found for/)).toBeDefined();
  });

  it("toggles open/closed with repeated Cmd+K", () => {
    render(<CommandPalette teamKey="ENG" />);

    // Open
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.getByRole("dialog")).toBeDefined();

    // Close
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("supports arrow key navigation", () => {
    render(<CommandPalette teamKey="ENG" />);

    fireEvent.keyDown(document, { key: "k", metaKey: true });

    const input = screen.getByPlaceholderText("Type a command or search...");

    // Arrow down should not throw
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });

    // Component should still be open and functional
    expect(screen.getByRole("dialog")).toBeDefined();
  });

  it("opens from the sidebar event and restores focus when closed", async () => {
    render(
      <>
        <button
          type="button"
          onClick={() =>
            window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT))
          }
        >
          Search trigger
        </button>
        <CommandPalette teamKey="ENG" />
      </>,
    );

    const trigger = screen.getByRole("button", { name: "Search trigger" });
    trigger.focus();
    fireEvent.click(trigger);

    const input = screen.getByPlaceholderText("Type a command or search...");
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });

    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("shows issue search results and opens the selected issue", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: "issue-1",
          identifier: "ONB-4",
          title: "QA feature 004 browser verification",
          priority: "high",
        },
      ],
    } as Response);

    render(<CommandPalette teamKey="ENG" />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });

    const input = screen.getByPlaceholderText("Type a command or search...");
    fireEvent.change(input, { target: { value: "ONB" } });

    await waitFor(
      () => {
        expect(screen.getByText("ONB-4")).toBeInTheDocument();
      },
      { timeout: 1000 },
    );

    fireEvent.keyDown(input, { key: "Enter" });
    expect(pushMock).toHaveBeenCalledWith("/issue/issue-1");
  });

  it("ignores stale issue search responses when typing quickly", async () => {
    vi.useFakeTimers();

    type SearchResponse = Array<{
      id: string;
      identifier: string;
      title: string;
      priority: string;
    }>;

    let resolveFirst:
      | ((value: { ok: boolean; json: () => Promise<SearchResponse> }) => void)
      | undefined;
    let resolveSecond:
      | ((value: { ok: boolean; json: () => Promise<SearchResponse> }) => void)
      | undefined;

    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = new URL(String(input), "http://localhost");
      return new Promise((resolve) => {
        if (url.searchParams.get("q") === "ON") {
          resolveFirst = resolve as typeof resolveFirst;
          return;
        }

        resolveSecond = resolve as typeof resolveSecond;
      }) as Promise<Response>;
    });

    render(<CommandPalette teamKey="ENG" />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });

    const input = screen.getByPlaceholderText("Type a command or search...");

    fireEvent.change(input, { target: { value: "ON" } });
    await vi.advanceTimersByTimeAsync(200);

    fireEvent.change(input, { target: { value: "ONB" } });
    await vi.advanceTimersByTimeAsync(200);

    await act(async () => {
      resolveSecond?.({
        ok: true,
        json: async () => [
          {
            id: "issue-new",
            identifier: "ONB-4",
            title: "Newest result",
            priority: "high",
          },
        ],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("Newest result")).toBeInTheDocument();

    await act(async () => {
      resolveFirst?.({
        ok: true,
        json: async () => [
          {
            id: "issue-old",
            identifier: "ON-1",
            title: "Stale result",
            priority: "low",
          },
        ],
      });
      await Promise.resolve();
    });

    expect(screen.queryByText("Stale result")).toBeNull();
    expect(screen.getByText("Newest result")).toBeDefined();
  });

  it("dispatches the fullscreen create issue event", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    render(<CommandPalette teamKey="ENG" />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });

    const input = screen.getByPlaceholderText("Type a command or search...");
    fireEvent.change(input, { target: { value: "fullscreen" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: OPEN_CREATE_ISSUE_FULLSCREEN_EVENT }),
    );
  });
});
