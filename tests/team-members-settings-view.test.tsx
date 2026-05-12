import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
        role: "admin",
      },
      {
        id: "tm2",
        userId: "u2",
        name: "Teammate",
        email: "teammate@example.com",
        role: "member",
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
    expect(screen.getAllByText("Remove")).toHaveLength(2);
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
