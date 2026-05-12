import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CommandPalette } from "@/components/command-palette";
import { OPEN_COMMAND_PALETTE_EVENT } from "@/lib/command-palette";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

describe("CommandPalette component", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("is hidden by default and opens on Cmd+K", async () => {
    render(<CommandPalette teamKey="ENG" />);

    expect(screen.queryByLabelText("Command palette")).not.toBeInTheDocument();

    // Trigger Cmd+K
    fireEvent.keyDown(document, { key: "k", metaKey: true });

    expect(screen.getByLabelText("Command palette")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/type a command/i)).toBeInTheDocument();
  });

  it("navigates with arrow keys and executes command on Enter", async () => {
    render(<CommandPalette teamKey="ENG" />);
    window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT));

    await waitFor(() =>
      expect(screen.getByLabelText("Command palette")).toBeInTheDocument(),
    );

    const input = screen.getByPlaceholderText(/type a command/i);

    // Initial state: first command should be selected (usually 'Create view' based on code)
    // We can check by looking for the 'bg-[var(--color-accent)]' class
    const buttons = screen.getAllByRole("button");
    expect(buttons[0]).toHaveClass("bg-[var(--color-accent)]");

    // Arrow down to 'Create new issue'
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(buttons[1]).toHaveClass("bg-[var(--color-accent)]");
    expect(buttons[0]).not.toHaveClass("bg-[var(--color-accent)]");

    // Enter to execute 'Create new issue' which dispatches an event
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(dispatchSpy).toHaveBeenCalled();
    expect(screen.queryByLabelText("Command palette")).not.toBeInTheDocument();
  });

  it("searches issues and navigates to result", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            id: "i-1",
            identifier: "ENG-1",
            title: "Search Result Issue",
            priority: "high",
          },
        ]),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CommandPalette teamKey="ENG" workspaceId="ws-1" />);
    window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT));

    await waitFor(() =>
      expect(screen.getByLabelText("Command palette")).toBeInTheDocument(),
    );

    const input = screen.getByPlaceholderText(/type a command/i);
    fireEvent.change(input, { target: { value: "Search Result" } });

    // Wait for debounced search
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("q=Search+Result"),
        expect.any(Object),
      );
    });

    // Check if result appears
    const resultButton = await screen.findByText("Search Result Issue");
    expect(resultButton).toBeInTheDocument();

    // First item should be the search result
    fireEvent.keyDown(input, { key: "Enter" });

    expect(pushMock).toHaveBeenCalledWith("/issue/i-1");
    expect(screen.queryByLabelText("Command palette")).not.toBeInTheDocument();
  });

  it("closes on Escape or backdrop click", async () => {
    render(<CommandPalette teamKey="ENG" />);
    window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT));

    await waitFor(() =>
      expect(screen.getByLabelText("Command palette")).toBeInTheDocument(),
    );

    // Escape
    fireEvent.keyDown(screen.getByPlaceholderText(/type a command/i), {
      key: "Escape",
    });
    await waitFor(() =>
      expect(
        screen.queryByLabelText("Command palette"),
      ).not.toBeInTheDocument(),
    );

    // Re-open
    window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT));
    await waitFor(() =>
      expect(screen.getByLabelText("Command palette")).toBeInTheDocument(),
    );

    // Click backdrop
    const backdrop = screen.getByRole("presentation");
    fireEvent.click(backdrop);
    await waitFor(() =>
      expect(
        screen.queryByLabelText("Command palette"),
      ).not.toBeInTheDocument(),
    );
  });
});
