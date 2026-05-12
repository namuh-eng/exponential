import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import ProjectStatusesPage from "@/app/(app)/settings/project-statuses/page";
import { afterEach, describe, expect, it, vi } from "vitest";

const statusPayload = {
  statuses: [
    {
      value: "planned",
      label: "Planned",
      description:
        "Projects that are proposed or scheduled but not active yet.",
      projectCount: 2,
    },
    {
      value: "in_progress",
      label: "In progress",
      description: "Projects that are actively being worked on.",
      projectCount: 1,
    },
    {
      value: "paused",
      label: "Paused",
      description: "Projects that are temporarily on hold.",
      projectCount: 0,
    },
    {
      value: "completed",
      label: "Completed",
      description: "Projects that have reached their intended outcome.",
      projectCount: 3,
    },
    {
      value: "canceled",
      label: "Canceled",
      description: "Projects that are no longer planned to continue.",
      projectCount: 0,
    },
  ],
  totalProjects: 6,
  readOnly: true,
  customStatusesSupported: false,
};

describe("ProjectStatusesPage component", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("loads and renders default lifecycle statuses with workspace counts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => statusPayload,
      }),
    );

    render(<ProjectStatusesPage />);

    expect(screen.getByText("Loading project statuses...")).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.queryByText("Loading project statuses..."),
      ).not.toBeInTheDocument();
    });

    expect(fetch).toHaveBeenCalledWith("/api/project-statuses");
    expect(screen.getByText("Project statuses")).toBeInTheDocument();
    expect(screen.getByText("Planned")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("in_progress")).toBeInTheDocument();
    expect(
      screen.getByText(
        "6 workspace projects counted across the default lifecycle.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Project statuses are read-only/),
    ).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows an honest empty-project state while still listing lifecycle statuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ...statusPayload,
          totalProjects: 0,
          statuses: statusPayload.statuses.map((status) => ({
            ...status,
            projectCount: 0,
          })),
        }),
      }),
    );

    render(<ProjectStatusesPage />);

    await waitFor(() => screen.getByText("Planned"));

    expect(
      screen.getByText(/No projects in this workspace yet/),
    ).toBeInTheDocument();
    expect(screen.queryByText("No custom statuses")).not.toBeInTheDocument();
    expect(screen.getByText("Canceled")).toBeInTheDocument();
  });

  it("shows an API error without rendering stale counts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "boom" }),
      }),
    );

    render(<ProjectStatusesPage />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Unable to load project statuses.",
      );
    });

    expect(screen.queryByText("Planned")).not.toBeInTheDocument();
  });
});
