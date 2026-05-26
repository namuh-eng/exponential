import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import ProjectUpdatesPage from "@/app/(app)/settings/project-updates/page";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createdConfiguration = {
  id: "update-1",
  name: "Weekly reports",
  enabled: true,
  cadence: "weekly",
  dueDay: "friday",
  dueTime: "09:00",
  timezone: "UTC",
  scope: "active_projects",
  projectIds: [],
  reportingTarget: "workspace",
  shareTarget: "",
  createdAt: "2026-05-18T00:00:00.000Z",
  updatedAt: "2026-05-18T00:00:00.000Z",
};

function mockFetchSequence(responses: unknown[]) {
  const fetchMock = vi.fn();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => response,
    });
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("ProjectUpdatesPage component", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders empty state and creates a project update configuration", async () => {
    const fetchMock = mockFetchSequence([
      { configurations: [] },
      { configuration: createdConfiguration },
    ]);

    render(<ProjectUpdatesPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(
      await screen.findByText("No update configurations"),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Create update configuration" }),
    );
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "Weekly reports");
    await userEvent.click(
      screen.getByRole("button", { name: "Create configuration" }),
    );

    expect(await screen.findByText("Weekly reports")).toBeInTheDocument();
    expect(
      screen.getByText("Project update settings saved."),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/project-updates",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("edits, disables, and deletes an existing configuration", async () => {
    const editedConfiguration = {
      ...createdConfiguration,
      name: "Edited project reports",
      cadence: "biweekly",
    };
    const disabledConfiguration = { ...editedConfiguration, enabled: false };
    mockFetchSequence([
      { configurations: [createdConfiguration] },
      { configuration: editedConfiguration },
      { configuration: disabledConfiguration },
      { success: true },
    ]);

    render(<ProjectUpdatesPage />);

    expect(await screen.findByText("Weekly reports")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(
      screen.getByLabelText("Name"),
      "Edited project reports",
    );
    await userEvent.selectOptions(screen.getByLabelText("Cadence"), "biweekly");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      await screen.findByText("Edited project reports"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Every two weeks/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Disable" }));
    expect(await screen.findByText("Disabled")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(
        screen.queryByText("Edited project reports"),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText("No update configurations")).toBeInTheDocument();
  });

  it("shows validation errors from the API", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ configurations: [] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: "Due time must use 24-hour HH:MM format" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProjectUpdatesPage />);

    expect(
      await screen.findByText("No update configurations"),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Create update configuration" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Create configuration" }),
    );

    expect(
      await screen.findByText("Due time must use 24-hour HH:MM format"),
    ).toBeInTheDocument();
  });
});
