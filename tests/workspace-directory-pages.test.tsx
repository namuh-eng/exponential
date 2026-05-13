import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.hoisted(() => vi.fn());
const getWorkspaceMembersDirectoryMock = vi.hoisted(() => vi.fn());
const getWorkspaceTeamsDirectoryMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn());
const notFoundMock = vi.hoisted(() => vi.fn());

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

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  notFound: notFoundMock,
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
          teams: [{ id: "team-1", name: "Engineering", key: "ENG" }],
        },
      ],
    });

    const { default: MembersPage } = await import("@/app/(app)/members/page");

    render(await MembersPage());

    expect(screen.getByRole("heading", { name: "Members" })).toBeVisible();
    expect(screen.getByText("Ada Lovelace")).toBeVisible();
    expect(screen.getByText("Engineering")).toBeVisible();
    expect(getWorkspaceMembersDirectoryMock).toHaveBeenCalledWith("user-1");
  });

  it("renders the authenticated teams directory from workspace data", async () => {
    getWorkspaceTeamsDirectoryMock.mockResolvedValue({
      workspaceId: "workspace-1",
      teams: [
        {
          id: "team-1",
          name: "Engineering",
          key: "ENG",
          icon: null,
          isPrivate: false,
          issueCount: 7,
          memberCount: 3,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    const { default: TeamsPage } = await import("@/app/(app)/teams/page");

    render(await TeamsPage());

    expect(screen.getByRole("heading", { name: "Teams" })).toBeVisible();
    expect(screen.getByText("Engineering")).toBeVisible();
    expect(screen.getByRole("link", { name: /Engineering/i })).toHaveAttribute(
      "href",
      "/team/ENG/all",
    );
    expect(getWorkspaceTeamsDirectoryMock).toHaveBeenCalledWith("user-1");
  });

  it("redirects unauthenticated directory requests to login", async () => {
    getSessionMock.mockResolvedValue(null);
    const { default: MembersPage } = await import("@/app/(app)/members/page");

    await expect(MembersPage()).rejects.toThrow("NEXT_REDIRECT:/login");

    expect(redirectMock).toHaveBeenCalledWith("/login");
    expect(getWorkspaceMembersDirectoryMock).not.toHaveBeenCalled();
  });
});
