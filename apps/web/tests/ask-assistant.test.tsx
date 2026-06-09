import { AskAssistant } from "@/components/ask-assistant";
import { OPEN_ASK_LINEAR_EVENT } from "@/lib/command-palette";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("AskAssistant", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          aiSettings: { aiFeaturesEnabled: true, askLinearEnabled: true },
          capabilities: { canUseAgents: true },
        }),
      })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("renders a persistent launcher and opens/closes the assistant", () => {
    render(
      <AskAssistant
        teamKey="ENG"
        workspaceId="ws-1"
        workspaceSlug="foreverbrowsing"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Ask exponential" }),
    ).toBeVisible();
    expect(
      screen.queryByLabelText("Ask exponential assistant"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ask exponential" }));

    expect(screen.getByLabelText("Ask exponential assistant")).toBeVisible();
    expect(screen.getByLabelText("Ask exponential prompt")).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Close Ask exponential" }),
    );

    expect(
      screen.queryByLabelText("Ask exponential assistant"),
    ).not.toBeInTheDocument();
  });

  it("opens from the global command event and dismisses with Escape", async () => {
    render(<AskAssistant teamKey="ENG" workspaceSlug="foreverbrowsing" />);

    fireEvent(window, new CustomEvent(OPEN_ASK_LINEAR_EVENT));

    await waitFor(() =>
      expect(screen.getByLabelText("Ask exponential assistant")).toBeVisible(),
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(
      screen.queryByLabelText("Ask exponential assistant"),
    ).not.toBeInTheDocument();
  });

  it("shows loading then a deterministic workspace-aware response on submit", async () => {
    render(<AskAssistant teamKey="ENG" workspaceSlug="foreverbrowsing" />);

    fireEvent.click(screen.getByRole("button", { name: "Ask exponential" }));
    fireEvent.change(screen.getByLabelText("Ask exponential prompt"), {
      target: { value: "What should I work on?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(screen.getByText("What should I work on?")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Ask exponential is thinking",
    );

    await waitFor(() => {
      expect(
        screen.getByText(/I can help with foreverbrowsing and team ENG/),
      ).toBeVisible();
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not open when workspace AI policy disables Ask exponential", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        aiSettings: { aiFeaturesEnabled: true, askLinearEnabled: false },
        capabilities: { canUseAgents: true },
      }),
    });

    render(<AskAssistant teamKey="ENG" workspaceSlug="foreverbrowsing" />);

    const launcher = screen.getByRole("button", { name: "Ask exponential" });
    await waitFor(() => expect(launcher).toBeDisabled());
    fireEvent.click(launcher);

    expect(
      screen.queryByLabelText("Ask exponential assistant"),
    ).not.toBeInTheDocument();
  });
});
