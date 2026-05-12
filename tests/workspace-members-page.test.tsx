import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MembersPage from "../src/app/(app)/settings/members/page";

// Mock the components used in the page
vi.mock("@/components/avatar", () => ({
  Avatar: ({ name }: { name: string }) => (
    <div data-testid="avatar">{name}</div>
  ),
}));

describe("MembersPage component", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:url"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  const mockMembersData = {
    workspaceId: "ws_123",
    currentUserId: "user_1",
    viewerRole: "owner",
    members: [
      {
        id: "m1",
        kind: "member",
        userId: "user_1",
        name: "Ashley",
        email: "ashley@example.com",
        image: null,
        role: "owner",
        status: "active",
        teams: ["Engineering"],
        joinedAt: "2024-01-01T00:00:00Z",
        lastSeenAt: "2024-04-26T10:00:00Z",
      },
      {
        id: "m2",
        kind: "member",
        userId: "user_2",
        name: "Teammate",
        email: "teammate@example.com",
        image: null,
        role: "member",
        status: "active",
        teams: [],
        joinedAt: "2024-02-01T00:00:00Z",
        lastSeenAt: null,
      },
      {
        id: "m3",
        kind: "invitation",
        userId: null,
        name: "",
        email: "pending@example.com",
        image: null,
        role: "guest",
        status: "pending",
        teams: [],
        joinedAt: "2024-04-20T00:00:00Z",
        lastSeenAt: null,
      },
    ],
  };

  it("renders the members list and summary counts", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockMembersData,
    });

    render(<MembersPage />);

    expect(screen.getByText("Loading...")).toBeDefined();

    await waitFor(() => {
      expect(screen.getAllByText("Ashley").length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText("Teammate").length).toBeGreaterThan(0);
    expect(screen.getAllByText("pending@example.com").length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pending").length).toBeGreaterThan(0);

    // Check counts
    expect(screen.getByText("2")).toBeDefined(); // Active count
    expect(screen.getByText("1")).toBeDefined(); // Pending count
  });

  it("opens the invite dialog and adds/removes rows", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockMembersData,
    });

    render(<MembersPage />);
    await waitFor(() =>
      expect(screen.getAllByText("Ashley").length).toBeGreaterThan(0),
    );

    const inviteButton = screen.getByRole("button", { name: /invite/i });
    await userEvent.click(inviteButton);

    expect(screen.getByText("Invite members")).toBeDefined();

    const addAnotherButton = screen.getByRole("button", {
      name: /add another/i,
    });
    await userEvent.click(addAnotherButton);

    expect(screen.getAllByPlaceholderText("teammate@company.com")).toHaveLength(
      2,
    );

    const removeButtons = screen.getAllByRole("button", {
      name: /remove invite/i,
    });
    await userEvent.click(removeButtons[0]);

    expect(screen.getAllByPlaceholderText("teammate@company.com")).toHaveLength(
      1,
    );
  });

  it("exports members to CSV", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockMembersData,
    });

    const clickMock = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (tagName === "a") {
        const anchor = originalCreateElement("a");
        anchor.click = clickMock;
        return anchor;
      }
      return originalCreateElement(tagName);
    });

    render(<MembersPage />);
    await waitFor(() =>
      expect(screen.getAllByText("Ashley").length).toBeGreaterThan(0),
    );

    const exportButton = screen.getByRole("button", { name: /export csv/i });
    await userEvent.click(exportButton);

    expect(clickMock).toHaveBeenCalled();
    expect(screen.getByText("Exported members CSV.")).toBeDefined();
  });

  it("updates member role", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockMembersData,
    });

    render(<MembersPage />);
    await waitFor(() =>
      expect(screen.getAllByText("Teammate").length).toBeGreaterThan(0),
    );

    const roleSelect = screen.getByLabelText("Role for teammate@example.com");
    await userEvent.selectOptions(roleSelect, "admin");

    expect(fetch).toHaveBeenCalledWith(
      "/api/workspaces/members",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          id: "m2",
          kind: "member",
          role: "admin",
        }),
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("Member role updated.")).toBeDefined();
    });
  });

  it("shows empty state when no members exist", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ...mockMembersData, members: [] }),
    });

    render(<MembersPage />);
    await waitFor(() => {
      expect(
        screen.getByText("No members yet. Invite your team to get started."),
      ).toBeDefined();
    });
  });
});
