import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TeamLabelsSettingsPage from "../src/app/(app)/settings/teams/[key]/labels/page";

// Mock useParams
vi.mock("next/navigation", () => ({
  useParams: () => ({ key: "ENG" }),
}));

describe("TeamLabelsSettingsPage component", () => {
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

  const mockLabelsData = {
    labels: [
      { id: "l1", name: "Bug", color: "#ff0000" },
      { id: "l2", name: "Feature", color: "#00ff00" },
    ],
  };

  it("renders loading state then team labels", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (url: string) => {
        if (url.includes("/settings")) {
          return Promise.resolve({
            ok: true,
            json: async () => mockTeamData,
          });
        }
        if (url.includes("/labels")) {
          return Promise.resolve({
            ok: true,
            json: async () => mockLabelsData,
          });
        }
        return Promise.reject(new Error("Unknown URL"));
      },
    );

    render(<TeamLabelsSettingsPage />);

    expect(screen.getByText("Loading...")).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText(/Manage labels available for/i)).toBeDefined();
    });

    expect(screen.getAllByText(/Engineering/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Bug")).toBeDefined();
    expect(screen.getByText("Feature")).toBeDefined();
    expect(screen.getAllByText("Edit")).toHaveLength(2);
  });
});
