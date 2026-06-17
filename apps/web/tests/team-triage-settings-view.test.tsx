import TeamTriageSettingsPage from "@/app/(app)/settings/teams/[key]/triage/page";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useParams: () => ({ key: "TEAM" }),
}));

const mockTeam = {
  name: "Team Name",
  triageEnabled: true,
  triageAcceptDestinationStateId: "state-backlog",
  triageDeclineDestinationStateId: "state-canceled",
  acceptDestinationStates: [
    { id: "state-backlog", name: "Backlog", category: "backlog" },
    { id: "state-ready", name: "Ready", category: "unstarted" },
  ],
  declineDestinationStates: [
    { id: "state-canceled", name: "Canceled", category: "canceled" },
    { id: "state-duplicate", name: "Duplicate", category: "canceled" },
  ],
  triageDefaultAssigneeId: "user-ada",
  triageDefaultLabelIds: ["label-bug"],
  triageDefaultProjectId: "project-1",
  triageDefaultCycleId: "cycle-1",
  metadataOptions: {
    labels: [{ id: "label-bug", name: "Bug", color: "#f00" }],
    cycles: [{ id: "cycle-1", name: "Cycle 1", number: 1 }],
    projects: [{ id: "project-1", name: "Website" }],
    members: [{ id: "user-ada", name: "Ada", email: "ada@example.com" }],
  },
};

describe("TeamTriageSettingsPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url, options) => {
        if (url === "/api/teams/TEAM/settings" && !options) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ team: mockTeam }),
          });
        }
        if (url === "/api/teams/TEAM/settings" && options?.method === "PATCH") {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                team: { ...mockTeam, ...JSON.parse(options.body as string) },
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

  it("renders loading state then triage settings", async () => {
    render(<TeamTriageSettingsPage />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Triage")).toBeInTheDocument();
    });

    expect(screen.getByLabelText("Enable triage")).toBeInTheDocument();
    expect(screen.getByLabelText("Default accept destination")).toHaveValue(
      "state-backlog",
    );
    expect(screen.getByLabelText("Default decline destination")).toHaveValue(
      "state-canceled",
    );
    expect(screen.getByLabelText("Default triage assignee")).toHaveValue(
      "user-ada",
    );
    expect(screen.getByLabelText("Default triage project")).toHaveValue(
      "project-1",
    );
    expect(screen.getByLabelText("Default triage cycle")).toHaveValue(
      "cycle-1",
    );
    expect(screen.getByLabelText("Default triage label Bug")).toBeChecked();
  });

  it("handles toggling triage and saving", async () => {
    render(<TeamTriageSettingsPage />);
    await waitFor(() => screen.getByLabelText("Enable triage"));

    const toggle = screen.getByLabelText("Enable triage");
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByText("Triage settings updated")).toBeInTheDocument();
    });

    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/teams/TEAM/settings",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ triageEnabled: false }),
      }),
    );
  });

  it("saves accept and decline destination defaults", async () => {
    render(<TeamTriageSettingsPage />);
    await waitFor(() => screen.getByLabelText("Default accept destination"));

    fireEvent.change(screen.getByLabelText("Default accept destination"), {
      target: { value: "state-ready" },
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/teams/TEAM/settings",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            triageAcceptDestinationStateId: "state-ready",
          }),
        }),
      );
    });

    fireEvent.change(screen.getByLabelText("Default decline destination"), {
      target: { value: "state-duplicate" },
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/teams/TEAM/settings",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            triageDeclineDestinationStateId: "state-duplicate",
          }),
        }),
      );
    });
  });

  it("saves routing metadata defaults", async () => {
    render(<TeamTriageSettingsPage />);
    await waitFor(() => screen.getByLabelText("Default triage assignee"));

    fireEvent.change(screen.getByLabelText("Default triage assignee"), {
      target: { value: "" },
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/teams/TEAM/settings",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ triageDefaultAssigneeId: null }),
        }),
      );
    });
  });

  it("shows error message when save fails", async () => {
    vi.mocked(global.fetch).mockImplementation((url, options) => {
      if (url === "/api/teams/TEAM/settings" && options?.method === "PATCH") {
        return Promise.resolve({ ok: false } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ team: mockTeam }),
      } as Response);
    });

    render(<TeamTriageSettingsPage />);
    await waitFor(() => screen.getByLabelText("Enable triage"));

    fireEvent.click(screen.getByLabelText("Enable triage"));

    await waitFor(() => {
      expect(
        screen.getByText("Failed to update triage settings"),
      ).toBeInTheDocument();
    });
  });

  it("shows team not found when API returns null team", async () => {
    vi.mocked(global.fetch).mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ team: null }),
      } as Response),
    );

    render(<TeamTriageSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText("Team not found")).toBeInTheDocument();
    });
  });
});
