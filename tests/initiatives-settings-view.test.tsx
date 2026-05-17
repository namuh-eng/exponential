import "@testing-library/jest-dom/vitest";
import InitiativesSettingsPage from "@/app/(app)/settings/initiatives/page";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

describe("InitiativesSettingsPage", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        initiativesSettings: {
          enabled: true,
          projectRollups: true,
          visibility: "workspace",
          roadmapMode: "all",
        },
        viewerRole: "admin",
        canManage: true,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders persisted initiative controls instead of placeholder copy", async () => {
    render(<InitiativesSettingsPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Initiatives" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Workspace initiatives"),
    ).toBeInTheDocument();
    expect(screen.getByText("Project rollups")).toBeInTheDocument();
    expect(screen.getByText("Workspace visibility")).toBeInTheDocument();
    expect(screen.getByText("Roadmap inclusion")).toBeInTheDocument();
    expect(
      screen.queryByText(/intentionally read-only/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/placeholder/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
  });

  it("saves changes and keeps the server response selected", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          initiativesSettings: {
            enabled: true,
            projectRollups: true,
            visibility: "workspace",
            roadmapMode: "all",
          },
          viewerRole: "admin",
          canManage: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          initiativesSettings: {
            enabled: false,
            projectRollups: true,
            visibility: "workspace",
            roadmapMode: "all",
          },
          viewerRole: "admin",
          canManage: true,
        }),
      });

    const user = userEvent.setup();
    render(<InitiativesSettingsPage />);

    const toggles = await screen.findAllByRole("checkbox");
    await user.click(toggles[0]);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/workspaces/current/initiatives-settings",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ enabled: false }),
        }),
      ),
    );
    expect(
      await screen.findByText("Initiative settings saved"),
    ).toBeInTheDocument();
    expect(toggles[0]).not.toBeChecked();
  });

  it("disables controls for unauthorized viewers", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        initiativesSettings: {
          enabled: true,
          projectRollups: true,
          visibility: "workspace",
          roadmapMode: "all",
        },
        viewerRole: "member",
        canManage: false,
      }),
    });

    render(<InitiativesSettingsPage />);

    const toggles = await screen.findAllByRole("checkbox");
    expect(toggles[0]).toBeDisabled();
    expect(
      screen.getByText(/can view these settings but cannot change them/i),
    ).toBeInTheDocument();
  });
});
