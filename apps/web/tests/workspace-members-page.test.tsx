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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestPath(input: RequestInfo | URL) {
  if (input instanceof Request) {
    return new URL(input.url).pathname;
  }
  return new URL(input.toString(), "http://localhost").pathname;
}

async function requestJson(input: RequestInfo | URL, init?: RequestInit) {
  if (input instanceof Request) {
    return input.clone().json();
  }
  return JSON.parse(`${init?.body ?? "{}"}`) as unknown;
}

describe("MembersPage component", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    Object.defineProperty(global.URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:url"),
    });
    Object.defineProperty(global.URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
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

  function mockMembersApi(data: typeof mockMembersData = mockMembersData) {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.resolve(jsonResponse(data)),
    );
  }

  async function expectApiCall(method: string, body: unknown) {
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as [
      RequestInfo | URL,
      RequestInit?,
    ][];
    const call = [...calls].reverse().find(([input, init]) => {
      const requestMethod =
        input instanceof Request ? input.method : init?.method;
      return (
        requestPath(input) === "/api/workspaces/members" &&
        requestMethod === method
      );
    });
    expect(call).toBeDefined();
    const [input, init] = call as [RequestInfo | URL, RequestInit?];
    await expect(requestJson(input, init)).resolves.toEqual(body);
  }

  it("renders the members list and summary counts", async () => {
    mockMembersApi();

    render(<MembersPage />);

    expect(screen.getByText("Loading...")).toBeDefined();

    await waitFor(() => {
      expect(screen.getAllByText("Ashley").length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText("Teammate").length).toBeGreaterThan(0);
    expect(screen.getAllByText("pending@example.com").length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getByText((_, element) => element?.textContent === "Active 2"),
    ).toBeDefined();
    expect(
      screen.getByText((_, element) => element?.textContent === "Invited 1"),
    ).toBeDefined();
    expect(screen.queryByText("Application")).toBeNull();
  });

  it("opens the invite dialog and adds/removes rows", async () => {
    mockMembersApi();

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
    mockMembersApi();

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
    mockMembersApi();

    render(<MembersPage />);
    await waitFor(() =>
      expect(screen.getAllByText("Teammate").length).toBeGreaterThan(0),
    );

    const roleSelect = screen.getByLabelText("Role for teammate@example.com");
    await userEvent.selectOptions(roleSelect, "admin");

    await expectApiCall("PATCH", {
      id: "m2",
      kind: "member",
      role: "admin",
    });

    await waitFor(() => {
      expect(screen.getByText("Member role updated.")).toBeDefined();
    });
  });

  it("shows member and invitation actions and calls remove/revoke/resend APIs", async () => {
    mockMembersApi();

    render(<MembersPage />);
    await waitFor(() =>
      expect(screen.getAllByText("Teammate").length).toBeGreaterThan(0),
    );

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await expectApiCall("DELETE", { id: "m2", kind: "member" });

    await userEvent.click(screen.getByRole("button", { name: "Resend" }));
    await expectApiCall("PATCH", {
      id: "m3",
      kind: "invitation",
      action: "resend",
    });

    await userEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await expectApiCall("DELETE", { id: "m3", kind: "invitation" });
  });

  it("shows empty state when no members exist", async () => {
    mockMembersApi({ ...mockMembersData, members: [] });

    render(<MembersPage />);
    await waitFor(() => {
      expect(
        screen.getByText("No members yet. Invite your team to get started."),
      ).toBeDefined();
    });
  });
});
