import { AskLinearAssistant } from "@/components/ask-linear-assistant";
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

describe("AskLinearAssistant", () => {
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
      <AskLinearAssistant
        teamKey="ENG"
        workspaceId="ws-1"
        workspaceSlug="foreverbrowsing"
      />,
    );

    expect(screen.getByRole("button", { name: "Ask Linear" })).toBeVisible();
    expect(
      screen.queryByLabelText("Ask Linear assistant"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ask Linear" }));

    expect(screen.getByLabelText("Ask Linear assistant")).toBeVisible();
    expect(screen.getByLabelText("Ask Linear prompt")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Close Ask Linear" }));

    expect(
      screen.queryByLabelText("Ask Linear assistant"),
    ).not.toBeInTheDocument();
  });

  it("opens from the global command event and dismisses with Escape", async () => {
    render(
      <AskLinearAssistant teamKey="ENG" workspaceSlug="foreverbrowsing" />,
    );

    fireEvent(window, new CustomEvent(OPEN_ASK_LINEAR_EVENT));

    await waitFor(() =>
      expect(screen.getByLabelText("Ask Linear assistant")).toBeVisible(),
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(
      screen.queryByLabelText("Ask Linear assistant"),
    ).not.toBeInTheDocument();
  });

  it("shows loading then a deterministic workspace-aware response on submit", async () => {
    render(
      <AskLinearAssistant teamKey="ENG" workspaceSlug="foreverbrowsing" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ask Linear" }));
    fireEvent.change(screen.getByLabelText("Ask Linear prompt"), {
      target: { value: "What should I work on?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(screen.getByText("What should I work on?")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Ask Linear is thinking",
    );

    await waitFor(() => {
      expect(
        screen.getByText(/I can help with foreverbrowsing and team ENG/),
      ).toBeVisible();
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not open when workspace AI policy disables Ask Linear", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        aiSettings: { aiFeaturesEnabled: true, askLinearEnabled: false },
        capabilities: { canUseAgents: true },
      }),
    });

    render(
      <AskLinearAssistant teamKey="ENG" workspaceSlug="foreverbrowsing" />,
    );

    const launcher = screen.getByRole("button", { name: "Ask Linear" });
    await waitFor(() => expect(launcher).toBeDisabled());
    fireEvent.click(launcher);

    expect(
      screen.queryByLabelText("Ask Linear assistant"),
    ).not.toBeInTheDocument();
  });
});
