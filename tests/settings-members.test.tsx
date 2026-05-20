import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import MembersPage from "@/app/(app)/settings/members/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/settings/members",
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

const createObjectURLMock = vi.fn(() => "blob:members");
const revokeObjectURLMock = vi.fn();

Object.defineProperty(global.URL, "createObjectURL", {
  writable: true,
  value: createObjectURLMock,
});

Object.defineProperty(global.URL, "revokeObjectURL", {
  writable: true,
  value: revokeObjectURLMock,
});

function waitForLoaded() {
  return waitFor(() => {
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });
}

const mockMembers: Array<{
  id: string;
  kind: "member" | "invitation";
  userId: string | null;
  name: string;
  email: string;
  image: string | null;
  role: "owner" | "admin" | "member" | "guest";
  status: "active" | "pending";
  teams: string[];
  joinedAt: string;
  lastSeenAt: string | null;
}> = [
  {
    id: "m1",
    kind: "member",
    userId: "user-1",
    name: "Alice Smith",
    email: "alice@acme.com",
    image: null,
    role: "owner",
    status: "active",
    teams: ["Engineering"],
    joinedAt: "2026-01-15T00:00:00Z",
    lastSeenAt: "2026-04-07T10:00:00Z",
  },
  {
    id: "m2",
    kind: "member",
    userId: "user-2",
    name: "Bob Jones",
    email: "bob@acme.com",
    image: null,
    role: "member",
    status: "active",
    teams: ["Design"],
    joinedAt: "2026-02-01T00:00:00Z",
    lastSeenAt: null,
  },
  {
    id: "invite-1",
    kind: "invitation",
    userId: null,
    name: "Pending invite",
    email: "charlie@acme.com",
    image: null,
    role: "guest",
    status: "pending",
    teams: [],
    joinedAt: "2026-03-10T00:00:00Z",
    lastSeenAt: null,
  },
];

function membersResponse(
  members = mockMembers,
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    workspaceId: "workspace-1",
    currentUserId: "current-user",
    viewerRole: "owner",
    members,
    ...overrides,
  };
}

describe("Members Admin Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders members heading, actions, and table data from the members API", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => membersResponse(),
    });

    render(<MembersPage />);
    await waitForLoaded();

    expect(
      screen.getByRole("heading", { name: "Members" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Export CSV" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invite" })).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Teams")).toBeInTheDocument();
    expect(screen.getByText("Joined")).toBeInTheDocument();
    expect(screen.getByText("Last seen")).toBeInTheDocument();
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("alice@acme.com")).toBeInTheDocument();
    expect(screen.getByText("charlie@acme.com")).toBeInTheDocument();
    expect(screen.getByText("Pending invite")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/members");
  });

  it("labels the pending invitation summary count as invited, not application", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => membersResponse(),
    });

    render(<MembersPage />);
    await waitForLoaded();

    expect(
      screen.getByText((_, element) => element?.textContent === "Active 2"),
    ).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent === "Invited 1"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Application")).not.toBeInTheDocument();
  });

  it("uses the members API invite capability for the invite button", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () =>
        membersResponse(mockMembers, {
          viewerRole: "member",
          canInviteMembers: true,
        }),
    });

    render(<MembersPage />);
    await waitForLoaded();

    expect(screen.getByRole("button", { name: "Invite" })).toBeEnabled();

    cleanup();
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () =>
        membersResponse(mockMembers, {
          viewerRole: "admin",
          canInviteMembers: false,
        }),
    });

    render(<MembersPage />);
    await waitForLoaded();

    expect(screen.getByRole("button", { name: "Invite" })).toBeDisabled();
  });

  it("opens the invite modal and submits invitations through the API", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => membersResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{ email: "new@acme.com", status: "sent" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          membersResponse([
            ...mockMembers,
            {
              id: "invite-2",
              kind: "invitation",
              userId: null,
              name: "Pending invite",
              email: "new@acme.com",
              image: null,
              role: "admin",
              status: "pending",
              teams: [],
              joinedAt: "2026-03-11T00:00:00Z",
              lastSeenAt: null,
            },
          ]),
      });

    render(<MembersPage />);
    await waitForLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    expect(
      screen.getByRole("dialog", { name: "Invite members" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("teammate@company.com"), {
      target: { value: "new@acme.com" },
    });
    fireEvent.change(
      screen.getByRole("combobox", { name: "Invitation role 1" }),
      {
        target: { value: "admin" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send invitations" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: "workspace-1",
          invites: [{ email: "new@acme.com", role: "admin" }],
        }),
      });
    });
    await waitFor(() => {
      expect(screen.getByText("Sent 1 invitation.")).toBeInTheDocument();
    });
  });

  it("updates member roles through the members API", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => membersResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          membersResponse([
            mockMembers[0],
            {
              ...mockMembers[1],
              role: "admin",
            },
            mockMembers[2],
          ]),
      });

    render(<MembersPage />);
    await waitForLoaded();

    fireEvent.change(
      screen.getByRole("combobox", { name: "Role for bob@acme.com" }),
      {
        target: { value: "admin" },
      },
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "m2",
          kind: "member",
          role: "admin",
        }),
      });
    });
    await waitFor(() => {
      expect(screen.getByText("Member role updated.")).toBeInTheDocument();
    });
  });

  it("removes active members through the members API", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => membersResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => membersResponse([mockMembers[0], mockMembers[2]]),
      });

    render(<MembersPage />);
    await waitForLoaded();

    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[1]);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/members", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "m2",
          kind: "member",
        }),
      });
    });
    await waitFor(() => {
      expect(
        screen.getByText("Removed Bob Jones from workspace."),
      ).toBeInTheDocument();
    });
  });

  it("resends and revokes pending invitations through the members API", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => membersResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => membersResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => membersResponse([mockMembers[0], mockMembers[1]]),
      });

    render(<MembersPage />);
    await waitForLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Resend" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "invite-1",
          kind: "invitation",
          action: "resend",
        }),
      });
    });
    await waitFor(() => {
      expect(
        screen.getByText("Resent invitation to charlie@acme.com."),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/members", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "invite-1",
          kind: "invitation",
        }),
      });
    });
    await waitFor(() => {
      expect(
        screen.getByText("Revoked invitation to charlie@acme.com."),
      ).toBeInTheDocument();
    });
  });

  it("exports the current member list as CSV", async () => {
    const anchorClickMock = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((
      tagName: string,
    ) => {
      const element = originalCreateElement(tagName);
      if (tagName === "a") {
        Object.defineProperty(element, "click", {
          value: anchorClickMock,
        });
      }
      return element;
    }) as typeof document.createElement);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => membersResponse(),
    });

    render(<MembersPage />);
    await waitForLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(createObjectURLMock).toHaveBeenCalled();
    expect(anchorClickMock).toHaveBeenCalled();
    expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:members");
    expect(screen.getByText("Exported members CSV.")).toBeInTheDocument();
  });

  it("shows empty state when no members are returned", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => membersResponse([], { viewerRole: "member" }),
    });

    render(<MembersPage />);
    await waitForLoaded();

    expect(screen.getByText(/No members yet/)).toBeInTheDocument();
  });
});
