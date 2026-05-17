import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TeamMembersSettingsPage from "../src/app/(app)/settings/teams/[key]/members/page";

// Mock useParams
vi.mock("next/navigation", () => ({
  useParams: () => ({ key: "ENG" }),
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

describe("TeamMembersSettingsPage component", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  const mockTeamData = {
    team: {
      name: "Engineering",
      key: "ENG",
    },
  };

  const mockMembersData = {
    members: [
      {
        id: "tm1",
        userId: "u1",
        name: "Ashley",
        email: "ashley@example.com",
        kind: "member",
        role: "admin",
        status: "active",
      },
      {
        id: "tm2",
        userId: "u2",
        name: "Teammate",
        email: "teammate@example.com",
        kind: "member",
        role: "member",
        status: "active",
      },
      {
        id: "inv1",
        kind: "invitation",
        userId: null,
        name: "Pending invite",
        email: "pending@example.com",
        role: "member",
        status: "pending",
      },
    ],
  };

  it("renders loading state then team members", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (url: string) => {
        if (url.includes("/settings")) {
          return Promise.resolve({
            ok: true,
            json: async () => mockTeamData,
          });
        }
        if (url.includes("/members")) {
          return Promise.resolve({
            ok: true,
            json: async () => mockMembersData,
          });
        }
        return Promise.reject(new Error("Unknown URL"));
      },
    );

    render(<TeamMembersSettingsPage />);

    expect(screen.getByText("Loading...")).toBeDefined();

    await waitFor(() => {
      expect(
        screen.getByText(/Manage who has access to the Engineering team/i),
      ).toBeDefined();
    });

    expect(screen.getByText("Ashley")).toBeDefined();
    expect(screen.getByText("ashley@example.com")).toBeDefined();
    expect(screen.getByText("Teammate")).toBeDefined();
    expect(screen.getByText("teammate@example.com")).toBeDefined();

    // Using getAllByText since "member" might match "Add members" and the row role
    expect(screen.getAllByText(/admin/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/member/i).length).toBeGreaterThan(0);
    expect(screen.getByText("pending@example.com")).toBeDefined();
    expect(
      screen.getByRole("button", {
        name: /Resend invitation to pending@example.com/i,
      }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", {
        name: /Cancel invitation to pending@example.com/i,
      }),
    ).toBeDefined();
    expect(screen.getAllByText("Remove")).toHaveLength(2);
  });

  it("filters members and supports inviting an email from the add dialog", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (url: string, init?: RequestInit) => {
        if (url.includes("/settings")) {
          return Promise.resolve({ ok: true, json: async () => mockTeamData });
        }
        if (url === "/api/workspaces/members") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              members: [
                {
                  id: "wm3",
                  kind: "member",
                  userId: "u3",
                  name: "Morgan",
                  email: "morgan@example.com",
                  status: "active",
                },
                {
                  id: "wi2",
                  kind: "invitation",
                  userId: null,
                  name: "Pending invite",
                  email: "candidate@example.com",
                  status: "pending",
                },
              ],
            }),
          });
        }
        if (url.includes("/members") && init?.method === "POST") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              members: [
                ...mockMembersData.members,
                {
                  id: "inv-new",
                  kind: "invitation",
                  userId: null,
                  name: "Pending invite",
                  email: "new@example.com",
                  role: "member",
                  status: "pending",
                },
              ],
            }),
          });
        }
        if (url.includes("/members")) {
          return Promise.resolve({
            ok: true,
            json: async () => mockMembersData,
          });
        }
        return Promise.reject(new Error("Unknown URL"));
      },
    );

    render(<TeamMembersSettingsPage />);
    await waitFor(() => expect(screen.getByText("Ashley")).toBeDefined());

    fireEvent.change(
      screen.getByPlaceholderText("Search by name, email, role, or status"),
      {
        target: { value: "pending" },
      },
    );
    expect(screen.getByText("pending@example.com")).toBeDefined();
    expect(screen.queryByText("ashley@example.com")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add members" }));
    await waitFor(() => expect(screen.getByText("Morgan")).toBeDefined());
    fireEvent.change(screen.getByPlaceholderText("name@company.com"), {
      target: { value: "new@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add or invite" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/teams/ENG/members",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("new@example.com"),
        }),
      );
    });
  });

  it("shows team not found when team data is missing", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (url: string) => {
        if (url.includes("/settings")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ team: null }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ members: [] }),
        });
      },
    );

    render(<TeamMembersSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Team not found")).toBeDefined();
    });
  });
});
