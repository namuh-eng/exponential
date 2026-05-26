import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.hoisted(() => vi.fn());
const getWorkspaceMembersDirectoryMock = vi.hoisted(() => vi.fn());
const getWorkspaceTeamsDirectoryMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn());
const notFoundMock = vi.hoisted(() => vi.fn());
const appShellContextMock = vi.hoisted(() => ({
  current: { workspaceSlug: "foreverbrowsing" } as {
    workspaceSlug: string;
  } | null,
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/lib/workspace-directory", () => ({
  getWorkspaceMembersDirectory: getWorkspaceMembersDirectoryMock,
  getWorkspaceTeamsDirectory: getWorkspaceTeamsDirectoryMock,
}));

vi.mock("@/app/(app)/app-shell", () => ({
  useAppShellContext: () => appShellContextMock.current,
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  notFound: notFoundMock,
}));

// NOTE: there used to be a second `vi.mock("@/app/(app)/app-shell", …)` here
// that hard-coded `{ workspaceSlug: "foreverbrowsing" }`. Vitest lets the
// later mock win, which silently broke the "no workspace context" test —
// setting `appShellContextMock.current = null` had no effect. Removed.

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

function requestPath(input: RequestInfo | URL) {
  if (input instanceof Request) {
    return new URL(input.url).pathname;
  }
  return new URL(input.toString(), "http://localhost").pathname;
}

describe("workspace directory routes", () => {
  beforeEach(() => {
    cleanup();
    vi.resetModules();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    redirectMock.mockImplementation((path: string) => {
      throw new Error(`NEXT_REDIRECT:${path}`);
    });
    notFoundMock.mockImplementation(() => {
      throw new Error("NEXT_NOT_FOUND");
    });
    appShellContextMock.current = { workspaceSlug: "foreverbrowsing" };
  });

  it("renders the authenticated members directory from workspace data", async () => {
    getWorkspaceMembersDirectoryMock.mockResolvedValue({
      workspaceId: "workspace-1",
      members: [
        {
          id: "member-1",
          userId: "user-1",
          name: "Ada Lovelace",
          email: "ada@example.com",
          image: null,
          role: "owner",
          joinedAt: "2026-01-01T00:00:00.000Z",
          pronouns: "she/her",
          title: "Analytical Engine Lead",
          location: "London",
          timezone: "Europe/London",
          showLocalTime: true,
          teams: [{ id: "team-1", name: "Engineering", key: "ENG" }],
        },
      ],
    });

    const { default: MembersPage } = await import("@/app/(app)/members/page");

    render(await MembersPage());

    expect(screen.getByRole("heading", { name: "Members" })).toBeVisible();
    expect(screen.getByText("Ada Lovelace")).toBeVisible();
    expect(screen.getAllByText("Engineering").length).toBeGreaterThan(0);
    expect(getWorkspaceMembersDirectoryMock).toHaveBeenCalledWith("user-1");
  });

  it("searches, filters, and opens member profile details", async () => {
    getWorkspaceMembersDirectoryMock.mockResolvedValue({
      workspaceId: "workspace-1",
      members: [
        {
          id: "member-1",
          userId: "user-1",
          name: "Ada Lovelace",
          email: "ada@example.com",
          image: null,
          role: "owner",
          joinedAt: "2026-01-01T00:00:00.000Z",
          pronouns: "she/her",
          title: "Analytical Engine Lead",
          location: "London",
          timezone: "Europe/London",
          showLocalTime: true,
          teams: [{ id: "team-1", name: "Engineering", key: "ENG" }],
        },
        {
          id: "member-2",
          userId: "user-2",
          name: "Grace Hopper",
          email: "grace@example.com",
          image: null,
          role: "admin",
          joinedAt: "2026-02-01T00:00:00.000Z",
          pronouns: "she/her",
          title: "Compiler Engineer",
          location: "Arlington",
          timezone: "America/New_York",
          showLocalTime: false,
          teams: [{ id: "team-2", name: "Platform", key: "PLT" }],
        },
      ],
    });

    const { default: MembersPage } = await import("@/app/(app)/members/page");

    render(await MembersPage());

    const search = screen.getByLabelText("Search members");
    fireEvent.change(search, { target: { value: "grace@example.com" } });

    expect(screen.getByText("Grace Hopper")).toBeVisible();
    expect(screen.queryByText("Ada Lovelace")).toBeNull();
    expect(screen.getByText("2 members")).toBeVisible();

    fireEvent.change(search, { target: { value: "missing" } });
    expect(
      screen.getByText("No members match your search or filters."),
    ).toBeVisible();

    fireEvent.change(search, { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Role"), {
      target: { value: "owner" },
    });
    expect(screen.getByText("Ada Lovelace")).toBeVisible();
    expect(screen.queryByText("Grace Hopper")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: /Open profile for Ada Lovelace/ }),
    );

    expect(screen.getByRole("dialog", { name: "Ada Lovelace" })).toBeVisible();
    expect(screen.getAllByText("ada@example.com").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Owner").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Analytical Engine Lead").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("she/her")).toBeVisible();
    expect(screen.getByText("London")).toBeVisible();
    expect(screen.getByText(/GMT|BST/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Engineering" })).toHaveAttribute(
      "href",
      "/team/ENG/all",
    );
    expect(
      screen.getByRole("link", { name: "Manage members" }),
    ).toHaveAttribute("href", "/settings/members");
  });

  it("renders the authenticated teams directory from workspace data", async () => {
    getWorkspaceTeamsDirectoryMock.mockResolvedValue({
      workspaceId: "workspace-1",
      viewerRole: "admin",
      canManageTeams: true,
      teams: [
        {
          id: "team-1",
          name: "Engineering",
          key: "ENG",
          icon: null,
          isPrivate: false,
          issueCount: 7,
          memberCount: 3,
          currentUserIsMember: true,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    const { default: TeamsPage } = await import("@/app/(app)/teams/page");

    render(await TeamsPage());

    expect(screen.getByRole("heading", { name: "Teams" })).toBeVisible();
    expect(screen.getByText("Engineering")).toBeVisible();
    expect(screen.getByRole("link", { name: /View issues/i })).toHaveAttribute(
      "href",
      "/foreverbrowsing/team/ENG/all",
    );
    expect(screen.getByRole("link", { name: /Settings/i })).toHaveAttribute(
      "href",
      "/foreverbrowsing/settings/teams/ENG",
    );
    expect(screen.getByRole("button", { name: "New team" })).toBeVisible();
    expect(getWorkspaceTeamsDirectoryMock).toHaveBeenCalledWith("user-1");
  });

  it("keeps teams directory card links root-scoped without a workspace context", async () => {
    appShellContextMock.current = null;

    const { WorkspaceTeamsDirectory } = await import(
      "@/components/workspace-teams-directory"
    );

    render(
      <WorkspaceTeamsDirectory
        canManageTeams={true}
        teams={[
          {
            id: "team-1",
            name: "Engineering",
            key: "ENG",
            icon: null,
            isPrivate: false,
            issueCount: 7,
            memberCount: 3,
            currentUserIsMember: true,
            parentTeamId: null,
            retiredAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ]}
        viewerRole="admin"
      />,
    );

    expect(screen.getByRole("link", { name: /View issues/i })).toHaveAttribute(
      "href",
      "/team/ENG/all",
    );
    expect(screen.getByRole("link", { name: /Settings/i })).toHaveAttribute(
      "href",
      "/settings/teams/ENG",
    );
  });

  it("filters the teams directory by search and access", async () => {
    getWorkspaceTeamsDirectoryMock.mockResolvedValue({
      workspaceId: "workspace-1",
      viewerRole: "member",
      canManageTeams: false,
      teams: [
        {
          id: "team-1",
          name: "Engineering",
          key: "ENG",
          icon: null,
          isPrivate: false,
          issueCount: 7,
          memberCount: 3,
          currentUserIsMember: true,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "team-2",
          name: "Secret Ops",
          key: "SEC",
          icon: null,
          isPrivate: true,
          issueCount: 1,
          memberCount: 1,
          currentUserIsMember: false,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    const { default: TeamsPage } = await import("@/app/(app)/teams/page");

    render(await TeamsPage());

    expect(screen.queryByRole("button", { name: "New team" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Search teams"), {
      target: { value: "secret" },
    });

    expect(screen.getByText("Secret Ops")).toBeVisible();
    expect(screen.queryByText("Engineering")).toBeNull();

    fireEvent.change(screen.getByLabelText("Filter"), {
      target: { value: "member" },
    });

    expect(
      screen.getByText("No teams match your search or filters."),
    ).toBeVisible();
  });

  it("creates a team from the directory modal and adds it to the list", async () => {
    getWorkspaceTeamsDirectoryMock.mockResolvedValue({
      workspaceId: "workspace-1",
      viewerRole: "owner",
      canManageTeams: true,
      teams: [],
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          team: {
            id: "team-3",
            name: "Support",
            key: "SUP",
            icon: null,
            isPrivate: true,
            issueCount: 0,
            memberCount: 1,
            currentUserIsMember: true,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );

    const { default: TeamsPage } = await import("@/app/(app)/teams/page");

    render(await TeamsPage());
    fireEvent.click(screen.getByRole("button", { name: "New team" }));
    fireEvent.change(screen.getByLabelText("Team name"), {
      target: { value: "Support" },
    });
    fireEvent.change(screen.getByPlaceholderText("ENG"), {
      target: { value: "sup" },
    });
    fireEvent.click(screen.getByLabelText("Private team"));
    fireEvent.click(screen.getByRole("button", { name: "Create team" }));

    await waitFor(() => expect(screen.getByText("Support")).toBeVisible());
    expect(fetchMock).toHaveBeenCalled();
    const [request, init] = fetchMock.mock.calls[0] as [
      RequestInfo | URL,
      RequestInit?,
    ];
    expect(requestPath(request)).toBe("/api/teams");
    expect(request instanceof Request ? request.method : init?.method).toBe(
      "POST",
    );
    if (request instanceof Request) {
      await expect(request.clone().json()).resolves.toEqual({
        name: "Support",
        key: "SUP",
        isPrivate: true,
      });
    } else {
      expect(init?.body).toBe(
        JSON.stringify({ name: "Support", key: "SUP", isPrivate: true }),
      );
    }
    fetchMock.mockRestore();
  });

  it("redirects unauthenticated directory requests to login", async () => {
    getSessionMock.mockResolvedValue(null);
    const { default: MembersPage } = await import("@/app/(app)/members/page");

    await expect(MembersPage()).rejects.toThrow("NEXT_REDIRECT:/login");

    expect(redirectMock).toHaveBeenCalledWith("/login");
    expect(getWorkspaceMembersDirectoryMock).not.toHaveBeenCalled();
  });
});
