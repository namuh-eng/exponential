import "@testing-library/jest-dom/vitest";
import InitiativesSettingsPage from "@/app/(app)/settings/initiatives/page";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

describe("InitiativesSettingsPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders editable persisted controls and no read-only placeholder copy", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        initiativesSettings: {
          enabled: true,
          projectRollups: true,
          visibility: "workspace",
          roadmapMode: "all",
        },
        viewerRole: "admin",
        canManage: true,
      }),
    );

    render(<InitiativesSettingsPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Initiatives" }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText("Workspace initiatives")).toBeEnabled();
    expect(screen.getByLabelText("Project rollups")).toBeEnabled();
    expect(screen.getByLabelText("Workspace visibility")).toHaveValue(
      "workspace",
    );
    expect(screen.getByLabelText("Roadmap inclusion")).toHaveValue("all");
    expect(
      screen.queryByText(/read-only|placeholder|clone/i),
    ).not.toBeInTheDocument();
  });

  it("saves changes through the settings API", async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          initiativesSettings: {
            enabled: true,
            projectRollups: true,
            visibility: "workspace",
            roadmapMode: "all",
          },
          viewerRole: "owner",
          canManage: true,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          initiativesSettings: {
            enabled: false,
            projectRollups: true,
            visibility: "workspace",
            roadmapMode: "all",
          },
          viewerRole: "owner",
          canManage: true,
        }),
      );

    render(<InitiativesSettingsPage />);
    const toggle = await screen.findByLabelText("Workspace initiatives");
    await userEvent.click(toggle);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/workspaces/current/initiatives-settings",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ enabled: false }),
        }),
      );
    });
    expect(
      await screen.findByText("Initiative settings saved"),
    ).toBeInTheDocument();
  });

  it("disables controls for unauthorized viewers", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        initiativesSettings: {
          enabled: true,
          projectRollups: true,
          visibility: "workspace",
          roadmapMode: "all",
        },
        viewerRole: "member",
        canManage: false,
      }),
    );

    render(<InitiativesSettingsPage />);

    expect(
      await screen.findByLabelText("Workspace initiatives"),
    ).toBeDisabled();
    expect(
      screen.getByText(/member role can view these settings/i),
    ).toBeInTheDocument();
  });
});
