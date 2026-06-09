import TeamHierarchySettingsPage from "@/app/(app)/settings/teams/[key]/hierarchy/page";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  useParams: () => ({ key: "TEAM" }),
}));

describe("TeamHierarchySettingsPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url, options) => {
        if (url === "/api/teams/TEAM/settings" && !options) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                team: {
                  name: "Team Name",
                  key: "TEAM",
                  parentTeamId: null,
                  parentTeam: null,
                  eligibleParentTeams: [
                    { id: "parent-1", name: "Platform", key: "PLAT" },
                  ],
                  childTeams: [{ id: "child-1", name: "Frontend", key: "FE" }],
                  hierarchyImpact: {
                    rollupTeamCount: 2,
                    filters: ["Issues", "Cycles", "Triage", "Analytics"],
                    teamScopePath: "/foreverbrowsing/teams/TEAM",
                  },
                },
              }),
          });
        }
        if (url === "/api/teams/TEAM/settings" && options?.method === "PATCH") {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                team: {
                  name: "Team Name",
                  key: "TEAM",
                  parentTeamId: JSON.parse(options.body).parentTeamId,
                  parentTeam: { id: "parent-1", name: "Platform", key: "PLAT" },
                  eligibleParentTeams: [
                    { id: "parent-1", name: "Platform", key: "PLAT" },
                  ],
                  childTeams: [{ id: "child-1", name: "Frontend", key: "FE" }],
                  hierarchyImpact: {
                    rollupTeamCount: 2,
                    filters: ["Issues", "Cycles", "Triage", "Analytics"],
                    teamScopePath: "/foreverbrowsing/teams/TEAM",
                  },
                },
              }),
          });
        }
        return Promise.reject(new Error("Unhandled fetch"));
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("lists eligible parent teams and persists the selected parent", async () => {
    render(<TeamHierarchySettingsPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Parent team").length).toBeGreaterThan(0);
    });

    expect(screen.getByText("Hierarchy context")).toBeInTheDocument();
    expect(screen.getByText("Rollup and filter effects")).toBeInTheDocument();
    expect(screen.getByText("Frontend (FE)")).toBeInTheDocument();

    const select = screen.getByRole("combobox");
    expect(select).not.toBeDisabled();
    expect(screen.getByText("Platform (PLAT)")).toBeInTheDocument();

    fireEvent.change(select, { target: { value: "parent-1" } });

    await waitFor(() => {
      expect(screen.getByText("Parent team updated")).toBeInTheDocument();
    });
    expect(select).toHaveValue("parent-1");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/teams/TEAM/settings",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ parentTeamId: "parent-1" }),
      }),
    );
  });
});
