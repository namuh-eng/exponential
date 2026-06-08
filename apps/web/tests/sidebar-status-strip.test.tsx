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

describe("Sidebar TTY build provenance strip", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders terminal build provenance without unbacked runtime status", () => {
    render(<Sidebar {...baseProps} />);

    const strip = screen.getByTestId("sidebar-status-strip");
    expect(strip).toBeInTheDocument();
    expect(strip).toHaveAttribute("aria-label", "Build provenance");

    const scoped = within(strip);
    expect(scoped.getByText("build")).toBeInTheDocument();
    expect(scoped.getByText("frontend shell")).toBeInTheDocument();
    expect(scoped.getByText("provenance")).toBeInTheDocument();
    expect(scoped.getByText("git:")).toBeInTheDocument();
    expect(strip).toHaveTextContent(/branch:unknown|[A-Za-z0-9/_-]+@/);
    expect(strip).toHaveTextContent(/version:unknown|v\d+\.\d+\.\d+/);
    expect(strip).not.toHaveTextContent("main@a3f10c2");
    expect(strip).not.toHaveTextContent("v0.4.2");
    expect(strip).not.toHaveTextContent("live");
    expect(strip).not.toHaveTextContent("self-hosted");
    expect(strip).not.toHaveTextContent("ELv2");
  });

  it("renders the status strip in a monospace family for the terminal aesthetic", () => {
    render(<Sidebar {...baseProps} />);

    const strip = screen.getByTestId("sidebar-status-strip");
    expect(strip.className).toContain("font-mono");
  });
});
