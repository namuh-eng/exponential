import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Sidebar } from "@/components/sidebar";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation so the Sidebar can render in isolation.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useParams: () => ({ key: "ENG" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const baseProps = {
  workspaceName: "My Workspace",
  workspaceInitials: "MW",
  teamName: "Team A",
  teamId: "t-a",
  teamKey: "TA",
  teams: [{ id: "t-a", name: "Team A", key: "TA" }],
};

describe("Sidebar TTY self-host status strip", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the terminal self-host status signals at the foot of the sidebar", () => {
    render(<Sidebar {...baseProps} />);

    const strip = screen.getByTestId("sidebar-status-strip");
    expect(strip).toBeInTheDocument();
    expect(strip).toHaveAttribute("aria-label", "Self-host status");

    // Open-source / terminal chrome signals from the TTY design.
    const scoped = within(strip);
    expect(scoped.getByText("live")).toBeInTheDocument();
    expect(scoped.getByText("self-hosted")).toBeInTheDocument();
    expect(scoped.getByText("ELv2")).toBeInTheDocument();
    expect(scoped.getByText("git:")).toBeInTheDocument();
    expect(scoped.getByText(/main@a3f10c2/)).toBeInTheDocument();
    expect(scoped.getByText(/^v\d+\.\d+\.\d+$/)).toBeInTheDocument();
  });

  it("renders the status strip in a monospace family for the terminal aesthetic", () => {
    render(<Sidebar {...baseProps} />);

    const strip = screen.getByTestId("sidebar-status-strip");
    expect(strip.className).toContain("font-mono");
  });
});
