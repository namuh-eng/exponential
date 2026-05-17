import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TeamLabelsSettingsPage from "../src/app/(app)/settings/teams/[key]/labels/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ key: "ENG" }),
}));

const mockTeamData = {
  team: {
    id: "team-1",
    name: "Engineering",
    key: "ENG",
  },
};

const mockLabelsData = {
  labels: [
    {
      id: "group-backend",
      name: "Backend",
      color: "#6b6f76",
      description: "Backend taxonomy",
      parentLabelId: null,
      issueCount: 0,
      lastApplied: null,
      createdAt: "2024-01-01T00:00:00Z",
      archivedAt: null,
      teamId: "team-1",
      teamName: "Engineering",
      teamKey: "ENG",
      scope: "team",
    },
    {
      id: "label-api",
      name: "API",
      color: "#ff0000",
      description: null,
      parentLabelId: "group-backend",
      issueCount: 1,
      lastApplied: null,
      createdAt: "2024-01-02T00:00:00Z",
      archivedAt: null,
      teamId: "team-1",
      teamName: "Engineering",
      teamKey: "ENG",
      scope: "team",
    },
  ],
};

describe("TeamLabelsSettingsPage component", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders team label groups and children on the team-scoped label surface", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (url: string) => {
        if (url.includes("/settings")) {
          return Promise.resolve({ ok: true, json: async () => mockTeamData });
        }
        if (url.startsWith("/api/labels?")) {
          return Promise.resolve({
            ok: true,
            json: async () => mockLabelsData,
          });
        }
        return Promise.reject(new Error(`Unknown URL ${url}`));
      },
    );

    render(<TeamLabelsSettingsPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByText(/Manage labels available for Engineering/i),
      ).toBeInTheDocument();
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/labels?scope=team&includeArchived=false&teamId=team-1",
    );
    expect(screen.queryByLabelText("Label scope")).not.toBeInTheDocument();
    expect(screen.getByTestId("label-group-Backend")).toHaveTextContent("API");
    expect(screen.getByTestId("nested-label-row")).toHaveTextContent("API");
  });

  it("creates a child label with the current team id", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (url: string, init?: RequestInit) => {
        if (url.includes("/settings")) {
          return Promise.resolve({ ok: true, json: async () => mockTeamData });
        }
        if (url === "/api/labels" && init?.method === "POST") {
          return Promise.resolve({ ok: true, json: async () => ({}) });
        }
        if (url.startsWith("/api/labels?")) {
          return Promise.resolve({
            ok: true,
            json: async () => mockLabelsData,
          });
        }
        return Promise.reject(new Error(`Unknown URL ${url}`));
      },
    );

    render(<TeamLabelsSettingsPage />);
    await waitFor(() => screen.getByText("Backend"));

    fireEvent.click(
      screen.getByRole("button", { name: "Add label under Backend" }),
    );
    fireEvent.change(screen.getByPlaceholderText("Label name"), {
      target: { value: "GraphQL" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create label" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/labels",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"parentLabelId":"group-backend"'),
        }),
      );
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/labels",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"teamId":"team-1"'),
      }),
    );
  });

  it("edits a team label into a team group", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (url: string, init?: RequestInit) => {
        if (url.includes("/settings")) {
          return Promise.resolve({ ok: true, json: async () => mockTeamData });
        }
        if (url === "/api/labels/label-api" && init?.method === "PATCH") {
          return Promise.resolve({ ok: true, json: async () => ({}) });
        }
        if (url.startsWith("/api/labels?")) {
          return Promise.resolve({
            ok: true,
            json: async () => mockLabelsData,
          });
        }
        return Promise.reject(new Error(`Unknown URL ${url}`));
      },
    );

    render(<TeamLabelsSettingsPage />);
    await waitFor(() => screen.getByText("API"));

    fireEvent.click(screen.getByRole("button", { name: "Edit API" }));
    fireEvent.change(screen.getByLabelText("Group"), {
      target: { value: "group-backend" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/labels/label-api",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"parentLabelId":"group-backend"'),
        }),
      );
    });
  });
});
