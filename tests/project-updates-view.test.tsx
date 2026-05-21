import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import ProjectUpdatesPage from "@/app/(app)/settings/project-updates/page";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

const existingConfiguration = {
  id: "updates-1",
  name: "Executive weekly report",
  enabled: true,
  cadence: "weekly",
  dayOfWeek: 5,
  timeOfDay: "09:00",
  timezone: "UTC",
  projectScope: "active",
  statusScope: ["started"],
  shareTargets: ["workspace"],
  slackChannel: null,
  createdAt: "2026-05-20T00:00:00.000Z",
  updatedAt: "2026-05-20T00:00:00.000Z",
};

describe("ProjectUpdatesPage component", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ configurations: [], canManage: true }),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders the project updates settings page with an actionable empty state", async () => {
    render(<ProjectUpdatesPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.getByText("Project updates")).toBeInTheDocument();
        expect(
          screen.getByText(/Manage how project updates are collected/),
        ).toBeInTheDocument();
        expect(
          screen.getByText("No update configurations"),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: "Create update configuration" }),
        ).toBeEnabled();
      },
      { timeout: 2000 },
    );
  });

  it("validates and creates a project update configuration", async () => {
    fetchMock.mockImplementation((url, init) => {
      if (
        url === "/api/project-update-configurations" &&
        init?.method === "POST"
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            configuration: {
              ...existingConfiguration,
              id: "updates-2",
              name: "Friday leadership update",
              shareTargets: ["workspace", "slack"],
              slackChannel: "#project-updates",
            },
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({ configurations: [], canManage: true }),
      });
    });

    render(<ProjectUpdatesPage />);

    fireEvent.click(await screen.findByText("Create update configuration"));
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));

    expect(
      await screen.findByText("Configuration name is required."),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Configuration name"), {
      target: { value: "Friday leadership update" },
    });
    fireEvent.change(screen.getByLabelText("Reminder cadence"), {
      target: { value: "biweekly" },
    });
    fireEvent.click(screen.getByLabelText("Slack channel"));
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));

    expect(
      await screen.findByText("Slack channel is required for Slack reports."),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Slack channel name"), {
      target: { value: "#project-updates" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));

    expect(
      await screen.findByText("Friday leadership update"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Project update configuration created."),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/project-update-configurations",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"cadence":"biweekly"'),
      }),
    );
  });

  it("edits, disables, and deletes a saved configuration", async () => {
    fetchMock.mockImplementation((url, init) => {
      if (url === "/api/project-update-configurations" && !init) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            configurations: [existingConfiguration],
            canManage: true,
          }),
        });
      }
      if (
        url === "/api/project-update-configurations/updates-1" &&
        init?.method === "PATCH"
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            configuration: {
              ...existingConfiguration,
              name: "Monthly exec report",
              enabled: false,
              cadence: "monthly",
            },
          }),
        });
      }
      if (
        url === "/api/project-update-configurations/updates-1" &&
        init?.method === "DELETE"
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<ProjectUpdatesPage />);

    expect(
      await screen.findByText("Executive weekly report"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Configuration name"), {
      target: { value: "Monthly exec report" },
    });
    fireEvent.click(screen.getByLabelText("Enable update reminders"));
    fireEvent.change(screen.getByLabelText("Reminder cadence"), {
      target: { value: "monthly" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      await screen.findByText("Project update configuration updated."),
    ).toBeInTheDocument();
    expect(screen.getByText("Monthly exec report")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(
      await screen.findByText("Project update configuration deleted."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Monthly exec report")).not.toBeInTheDocument();
    expect(screen.getByText("No update configurations")).toBeInTheDocument();
  });
});
