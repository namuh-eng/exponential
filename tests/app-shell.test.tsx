import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation
let mockPathname = "/inbox";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: vi.fn() }),
  Link: ({
    children,
    href,
    ...props
  }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { AppShell } from "@/app/(app)/app-shell";
import { Sidebar } from "@/components/sidebar";
import {
  OPEN_COMMAND_PALETTE_EVENT,
  OPEN_CREATE_ISSUE_EVENT,
  OPEN_CREATE_ISSUE_FULLSCREEN_EVENT,
} from "@/lib/command-palette";

const createIssueOptionsResponse = {
  team: { id: "team-1", name: "Eng", key: "ENG" },
  statuses: [
    {
      id: "state-1",
      name: "Backlog",
      category: "backlog",
      color: "#6b6f76",
    },
  ],
  priorities: [{ value: "none", label: "No priority" }],
  assignees: [],
  labels: [],
  projects: [],
};

describe("Sidebar", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders workspace name", () => {
    render(<Sidebar workspaceName="My Workspace" />);
    expect(screen.getByText("My Workspace")).toBeDefined();
  });

  it("renders workspace initials", () => {
    render(<Sidebar workspaceInitials="MW" />);
    expect(screen.getByText("MW")).toBeDefined();
  });

  it("dispatches the command palette open event from search", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    render(<Sidebar workspaceName="My Workspace" />);
    fireEvent.click(screen.getByLabelText("Search"));

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: OPEN_COMMAND_PALETTE_EVENT }),
    );
  });

  it("renders personal navigation links", () => {
    render(<Sidebar />);
    expect(screen.getByText("Inbox")).toBeDefined();
    expect(screen.getByText("My Issues")).toBeDefined();
  });

  it("shows the inbox unread badge when provided", () => {
    render(<Sidebar inboxUnreadCount={3} />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders workspace section with Projects and Views", () => {
    render(<Sidebar />);
    // There should be both workspace-level and team-level Projects/Views
    const projectLinks = screen.getAllByText("Projects");
    expect(projectLinks.length).toBeGreaterThanOrEqual(2);
    const viewLinks = screen.getAllByText("Views");
    expect(viewLinks.length).toBeGreaterThanOrEqual(2);
  });

  it("renders team section with team name", () => {
    render(<Sidebar teamName="Frontend" teamKey="FE" />);
    expect(screen.getByText("Frontend")).toBeDefined();
  });

  it("renders multiple team sections when more than one team exists", () => {
    render(
      <Sidebar
        teams={[
          { id: "team-1", name: "Frontend", key: "FE" },
          { id: "team-2", name: "Platform", key: "PLT" },
        ]}
      />,
    );

    expect(screen.getByText("Frontend")).toBeInTheDocument();
    expect(screen.getByText("Platform")).toBeInTheDocument();
    expect(screen.getAllByText("Triage")).toHaveLength(2);
    expect(screen.getAllByText("Issues")).toHaveLength(2);
  });

  it("renders team sub-navigation items", () => {
    render(<Sidebar teamKey="ENG" />);
    expect(screen.getByText("Triage")).toBeDefined();
    expect(screen.getByText("Issues")).toBeDefined();
  });

  it("links team Projects and Views to team-scoped pages", () => {
    render(<Sidebar teamName="Engineering" teamKey="ENG" />);

    expect(
      screen
        .getAllByRole("link", { name: /Projects/i })
        .some((link) => link.getAttribute("href") === "/team/ENG/projects"),
    ).toBe(true);
    expect(
      screen
        .getAllByRole("link", { name: /Views/i })
        .some((link) => link.getAttribute("href") === "/team/ENG/views"),
    ).toBe(true);
  });

  it("renders Initiatives and Cycles in Try section", () => {
    render(<Sidebar />);
    expect(screen.getByText("Initiatives")).toBeDefined();
    expect(screen.getByText("Cycles")).toBeDefined();
  });

  it("has search button", () => {
    render(<Sidebar />);
    expect(screen.getByLabelText("Search")).toBeDefined();
  });

  it("has create issue button", () => {
    render(<Sidebar />);
    expect(screen.getByLabelText("Create issue")).toBeDefined();
  });

  it("opens the workspace switcher menu", () => {
    render(<Sidebar workspaceName="Acme Inc" workspaceInitials="AC" />);

    fireEvent.click(screen.getByLabelText("Workspace switcher"));

    expect(screen.getByText("Workspace settings")).toBeInTheDocument();
    expect(screen.getAllByText("Acme Inc").length).toBeGreaterThan(0);
  });

  it("has help button", () => {
    render(<Sidebar />);
    expect(screen.getByLabelText("Help")).toBeDefined();
  });

  it("opens the help menu", () => {
    render(<Sidebar />);

    fireEvent.click(screen.getByLabelText("Help"));

    expect(screen.getByText("Docs")).toBeInTheDocument();
    expect(screen.getByText("Keyboard shortcuts")).toBeInTheDocument();
  });

  it("calls onCreateIssue when the sidebar create button is clicked", () => {
    const onCreateIssue = vi.fn();

    render(<Sidebar onCreateIssue={onCreateIssue} />);
    fireEvent.click(screen.getByLabelText("Create issue"));

    expect(onCreateIssue).toHaveBeenCalledTimes(1);
  });

  it("renders More button in workspace section", () => {
    render(<Sidebar />);
    expect(screen.getByText("More")).toBeDefined();
  });

  it("toggles More menu to show Settings, Members, and Teams", () => {
    render(<Sidebar />);
    expect(screen.queryByText("Settings")).toBeNull();

    fireEvent.click(screen.getByText("More"));
    expect(screen.getByText("Settings")).toBeDefined();
    expect(screen.getByText("Members")).toBeDefined();
    expect(screen.getByText("Teams")).toBeDefined();

    expect(screen.getByRole("link", { name: /Members/i })).toHaveAttribute(
      "href",
      "/members",
    );
    expect(screen.getByRole("link", { name: /Teams/i })).toHaveAttribute(
      "href",
      "/teams",
    );

    fireEvent.click(screen.getByText("More"));
    expect(screen.queryByText("Settings")).toBeNull();
  });

  it("renders Workspace section header", () => {
    render(<Sidebar workspaceName="Acme Inc" />);
    expect(screen.getByText("Workspace")).toBeDefined();
  });

  it("toggles team section collapse", () => {
    render(<Sidebar />);
    // Team section should be expanded by default
    expect(screen.getByText("Triage")).toBeDefined();

    // Click "Your teams" header to collapse
    fireEvent.click(screen.getByText("Your teams"));
    expect(screen.queryByText("Triage")).toBeNull();

    // Click again to expand
    fireEvent.click(screen.getByText("Your teams"));
    expect(screen.getByText("Triage")).toBeDefined();
  });

  it("toggles an individual team section without collapsing the others", () => {
    render(
      <Sidebar
        teams={[
          { id: "team-1", name: "Frontend", key: "FE" },
          { id: "team-2", name: "Platform", key: "PLT" },
        ]}
      />,
    );

    fireEvent.click(screen.getByText("Frontend"));

    expect(screen.getAllByText("Triage")).toHaveLength(1);
    expect(screen.getAllByText("Issues")).toHaveLength(1);
    expect(screen.getByText("Platform")).toBeInTheDocument();
  });

  it("links point to correct routes", () => {
    render(<Sidebar teamKey="ENG" />);
    const inboxLink = screen.getByText("Inbox").closest("a");
    expect(inboxLink?.getAttribute("href")).toBe("/inbox");

    const workspaceProjectsLink = screen
      .getAllByText("Projects")[0]
      .closest("a");
    expect(workspaceProjectsLink?.getAttribute("href")).toBe("/projects/all");

    const issuesLink = screen.getByText("Issues").closest("a");
    expect(issuesLink?.getAttribute("href")).toBe("/team/ENG/all");

    fireEvent.click(screen.getByText("More"));
    expect(screen.getByRole("link", { name: /Members/i })).toHaveAttribute(
      "href",
      "/members",
    );
    expect(screen.getByRole("link", { name: /Teams/i })).toHaveAttribute(
      "href",
      "/teams",
    );
  });

  it("uses workspace-prefixed directory links and active state", () => {
    mockPathname = "/foreverbrowsing/teams";
    render(<Sidebar workspaceSlug="foreverbrowsing" teamKey="ENG" />);

    fireEvent.click(screen.getByText("More"));

    expect(screen.getByRole("link", { name: /Members/i })).toHaveAttribute(
      "href",
      "/foreverbrowsing/members",
    );
    const teamsLink = screen.getByRole("link", { name: /Teams/i });
    expect(teamsLink).toHaveAttribute("href", "/foreverbrowsing/teams");
    expect(teamsLink.className).toContain("bg-[var(--color-surface-active)]");
  });

  it("keeps Issues highlighted on URL-addressable team issue list routes", () => {
    for (const tab of ["all", "active", "backlog"]) {
      cleanup();
      mockPathname = `/team/ENG/${tab}`;
      render(<Sidebar teamKey="ENG" />);

      expect(screen.getByText("Issues").closest("a")?.className).toContain(
        "bg-[var(--color-surface-active)]",
      );
    }
  });

  it("keeps Issues highlighted on issue detail routes", () => {
    mockPathname = "/issue/abc-123";

    render(<Sidebar teamKey="ENG" />);

    expect(screen.getByText("Issues").closest("a")?.className).toContain(
      "bg-[var(--color-surface-active)]",
    );
  });

  it("keeps workspace Projects highlighted on project detail routes", () => {
    mockPathname = "/project/roadmap";

    render(<Sidebar teamKey="ENG" />);

    expect(
      screen.getAllByText("Projects")[0].closest("a")?.className,
    ).toContain("bg-[var(--color-surface-active)]");
  });
});

describe("AppShell", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("/api/notifications")) {
        return {
          ok: true,
          json: async () => ({ unreadCount: 2, notifications: [] }),
        } as Response;
      }

      if (url.includes("/api/account/preferences")) {
        return {
          ok: true,
          json: async () => ({ accountPreferences: {} }),
        } as Response;
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });
  });

  afterEach(() => {
    cleanup();
    mockPathname = "/inbox";
    vi.restoreAllMocks();
  });

  it("renders sidebar and content area", async () => {
    render(
      <AppShell
        workspaceName="Test"
        workspaceInitials="TE"
        teamName="Eng"
        teamId="team-1"
        teamKey="ENG"
        teams={[{ id: "team-1", name: "Eng", key: "ENG" }]}
      >
        <div>Content</div>
      </AppShell>,
    );
    expect(screen.getByText("Test")).toBeDefined();
    expect(screen.getByText("Content")).toBeDefined();
    await waitFor(() => {
      expect(screen.getByText("2")).toBeInTheDocument();
    });
  });

  it("renders children in the content area", () => {
    render(
      <AppShell
        workspaceName="WS"
        workspaceInitials="WS"
        teamName="Team"
        teamId="team-1"
        teamKey="T"
        teams={[{ id: "team-1", name: "Team", key: "T" }]}
      >
        <h1>Hello World</h1>
      </AppShell>,
    );
    expect(screen.getByText("Hello World")).toBeDefined();
  });

  it("has rounded content container with correct background", () => {
    const { container } = render(
      <AppShell
        workspaceName="WS"
        workspaceInitials="WS"
        teamName="Team"
        teamId="team-1"
        teamKey="T"
        teams={[{ id: "team-1", name: "Team", key: "T" }]}
      >
        <div>Test</div>
      </AppShell>,
    );
    const contentDiv = container.querySelector(".rounded-xl");
    expect(contentDiv).not.toBeNull();
  });

  it("hides the app sidebar on mobile settings routes", () => {
    mockPathname = "/settings/account/preferences";

    render(
      <AppShell
        workspaceName="WS"
        workspaceInitials="WS"
        teamName="Team"
        teamId="team-1"
        teamKey="T"
        teams={[{ id: "team-1", name: "Team", key: "T" }]}
      >
        <div>Settings</div>
      </AppShell>,
    );

    expect(screen.getByTestId("app-sidebar-shell").className).toContain(
      "hidden md:block",
    );
  });

  it("updates the shell context for the active team route", async () => {
    mockPathname = "/team/QAX2/all";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/notifications")) {
        return {
          ok: true,
          json: async () => ({ unreadCount: 2, notifications: [] }),
        } as Response;
      }

      if (url.includes("/api/account/preferences")) {
        return {
          ok: true,
          json: async () => ({ accountPreferences: {} }),
        } as Response;
      }

      if (url.includes("/api/teams/QAX2/context")) {
        return {
          ok: true,
          json: async () => ({
            workspaceName: "QA Fix 20260407 1644",
            workspaceInitials: "QA",
            teamName: "QA Fix 20260407 1644",
            teamId: "team-id-2",
            teamKey: "QAX2",
            teams: [
              { id: "team-id-1", name: "Onboarding QA Team", key: "QAX" },
              { id: "team-id-2", name: "QA Fix 20260407 1644", key: "QAX2" },
            ],
          }),
        } as Response;
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(
      <AppShell
        workspaceName="Onboarding QA Team"
        workspaceInitials="ON"
        teamName="Onboarding QA Team"
        teamId="team-id-1"
        teamKey="QAX"
        teams={[{ id: "team-id-1", name: "Onboarding QA Team", key: "QAX" }]}
      >
        <div>Content</div>
      </AppShell>,
    );

    await waitFor(() => {
      expect(
        screen.getAllByText("QA Fix 20260407 1644").length,
      ).toBeGreaterThan(0);
    });
  });

  it("opens the global create issue modal on the C shortcut", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/notifications")) {
        return {
          ok: true,
          json: async () => ({ unreadCount: 2, notifications: [] }),
        } as Response;
      }
      if (url.includes("/api/account/preferences")) {
        return {
          ok: true,
          json: async () => ({ accountPreferences: {} }),
        } as Response;
      }
      if (url.includes("/create-issue-options")) {
        return {
          ok: true,
          json: async () => createIssueOptionsResponse,
        } as Response;
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(
      <AppShell
        workspaceName="WS"
        workspaceInitials="WS"
        teamName="Eng"
        teamId="team-1"
        teamKey="ENG"
        teams={[{ id: "team-1", name: "Eng", key: "ENG" }]}
      >
        <div>Content</div>
      </AppShell>,
    );

    fireEvent.keyDown(document, { key: "c" });

    await waitFor(() => {
      expect(screen.getByText("New issue")).toBeInTheDocument();
    });
  });

  it("opens the global create issue modal when the command event fires", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/notifications")) {
        return {
          ok: true,
          json: async () => ({ unreadCount: 2, notifications: [] }),
        } as Response;
      }
      if (url.includes("/api/account/preferences")) {
        return {
          ok: true,
          json: async () => ({ accountPreferences: {} }),
        } as Response;
      }
      if (url.includes("/create-issue-options")) {
        return {
          ok: true,
          json: async () => createIssueOptionsResponse,
        } as Response;
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(
      <AppShell
        workspaceName="WS"
        workspaceInitials="WS"
        teamName="Eng"
        teamId="team-1"
        teamKey="ENG"
        teams={[{ id: "team-1", name: "Eng", key: "ENG" }]}
      >
        <div>Content</div>
      </AppShell>,
    );

    window.dispatchEvent(new CustomEvent("open-create-issue"));

    await waitFor(() => {
      expect(screen.getByText("New issue")).toBeInTheDocument();
    });
  });

  it("opens the compact create issue modal when the regular command event fires", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/notifications")) {
        return {
          ok: true,
          json: async () => ({ unreadCount: 2, notifications: [] }),
        } as Response;
      }
      if (url.includes("/api/account/preferences")) {
        return {
          ok: true,
          json: async () => ({ accountPreferences: {} }),
        } as Response;
      }
      if (url.includes("/create-issue-options")) {
        return {
          ok: true,
          json: async () => createIssueOptionsResponse,
        } as Response;
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(
      <AppShell
        workspaceName="WS"
        workspaceInitials="WS"
        teamName="Eng"
        teamId="team-1"
        teamKey="ENG"
        teams={[{ id: "team-1", name: "Eng", key: "ENG" }]}
      >
        <div>Content</div>
      </AppShell>,
    );

    window.dispatchEvent(new CustomEvent(OPEN_CREATE_ISSUE_EVENT));

    await waitFor(() => {
      expect(screen.getByLabelText("Create issue for Eng")).toBeInTheDocument();
    });
    expect(
      screen.queryByLabelText("Create issue fullscreen for Eng"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("create-issue-composer")).toHaveAttribute(
      "data-variant",
      "modal",
    );
  });

  it("opens the fullscreen create issue composer when the fullscreen command event fires", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/notifications")) {
        return {
          ok: true,
          json: async () => ({ unreadCount: 2, notifications: [] }),
        } as Response;
      }
      if (url.includes("/api/account/preferences")) {
        return {
          ok: true,
          json: async () => ({ accountPreferences: {} }),
        } as Response;
      }
      if (url.includes("/create-issue-options")) {
        return {
          ok: true,
          json: async () => createIssueOptionsResponse,
        } as Response;
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(
      <AppShell
        workspaceName="WS"
        workspaceInitials="WS"
        teamName="Eng"
        teamId="team-1"
        teamKey="ENG"
        teams={[{ id: "team-1", name: "Eng", key: "ENG" }]}
      >
        <div>Content</div>
      </AppShell>,
    );

    window.dispatchEvent(new CustomEvent(OPEN_CREATE_ISSUE_FULLSCREEN_EVENT));

    await waitFor(() => {
      expect(
        screen.getByLabelText("Create issue fullscreen for Eng"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Fullscreen composer")).toBeInTheDocument();
    expect(screen.getByTestId("create-issue-composer")).toHaveAttribute(
      "data-variant",
      "fullscreen",
    );
  });
});
