import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AppShell } from "@/app/(app)/app-shell";
import { Sidebar } from "@/components/sidebar";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useParams: () => ({ key: "ENG" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

describe("Global Help and Shortcuts logic", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const baseProps = {
    workspaceName: "My Workspace",
    workspaceInitials: "MW",
    teamName: "Team A",
    teamId: "t-a",
    teamKey: "TA",
    teams: [{ id: "t-a", name: "Team A", key: "TA" }],
  };

  it("opens the help menu and subsequently the keyboard shortcuts dialog", async () => {
    render(<Sidebar {...baseProps} />);

    // Initial state: help menu closed
    expect(screen.queryByText("Keyboard shortcuts")).not.toBeInTheDocument();

    // Click help button
    const helpButton = screen.getByLabelText("Help");
    fireEvent.click(helpButton);

    // Menu should open
    const shortcutsButton = await screen.findByRole("button", {
      name: /keyboard shortcuts/i,
    });
    expect(shortcutsButton).toBeInTheDocument();

    // Click keyboard shortcuts
    fireEvent.click(shortcutsButton);

    // Shortcuts dialog should open
    expect(
      await screen.findByRole("heading", { name: "Keyboard shortcuts" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Cmd+K")).toBeInTheDocument();
    expect(screen.getByText("Search")).toBeInTheDocument();
  });

  it("closes the shortcuts dialog when clicking the close button", async () => {
    render(<Sidebar {...baseProps} />);

    // Open flow
    fireEvent.click(screen.getByLabelText("Help"));
    fireEvent.click(
      await screen.findByRole("button", { name: /keyboard shortcuts/i }),
    );

    const dialog = await screen.findByRole("heading", {
      name: "Keyboard shortcuts",
    });
    expect(dialog).toBeInTheDocument();

    // Close
    fireEvent.click(screen.getByLabelText("Close shortcuts"));

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Keyboard shortcuts" }),
      ).not.toBeInTheDocument();
    });
  });

  it("dispatches the create issue event when global 'c' key is pressed", async () => {
    // Mock the options API call that happens when modal opens
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            team: { id: "t-a", name: "Team A", key: "TA" },
            statuses: [
              {
                id: "s-1",
                name: "Backlog",
                category: "backlog",
                color: "#6b6f76",
              },
            ],
            priorities: [],
            assignees: [],
            labels: [],
            projects: [],
          }),
      }),
    );

    render(
      <AppShell {...baseProps} workspaceId="ws-1">
        <div>Content</div>
      </AppShell>,
    );

    // Trigger 'c' key
    fireEvent.keyDown(document, { key: "c" });

    // The modal should open. In CreateIssueModal, "New issue" is a span,
    // and the dialog has an aria-label "Create issue for Team A"
    expect(
      await screen.findByRole("dialog", { name: /create issue for Team A/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("New issue")).toBeInTheDocument();
  });
});
