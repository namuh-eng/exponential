import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import ProjectTemplatesPage from "@/app/(app)/settings/project-templates/page";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

describe("ProjectTemplatesPage component", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation((url) =>
      Promise.resolve({
        ok: true,
        json: async () =>
          url === "/api/project-labels" ? { labels: [] } : { templates: [] },
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders the project templates page with empty state", async () => {
    render(<ProjectTemplatesPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.getByText("Project templates")).toBeInTheDocument();
        expect(
          screen.getByText(/Standardize project structures/),
        ).toBeInTheDocument();
        expect(screen.getByText("No project templates")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it("shows a load error when templates cannot be fetched", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "boom" }),
    });

    render(<ProjectTemplatesPage />);

    expect(
      await screen.findByText("Unable to load project templates."),
    ).toBeInTheDocument();
  });

  it("opens a creation dialog from the empty-state CTA", async () => {
    render(<ProjectTemplatesPage />);

    fireEvent.click(await screen.findByText("Create project template"));

    expect(
      screen.getByRole("dialog", { name: "Create project template" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Template name")).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toBeInTheDocument();
  });

  it("validates, saves, and renders a created project template", async () => {
    fetchMock.mockImplementation((url, init) => {
      if (url === "/api/project-templates" && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            template: {
              id: "template-1",
              name: "Launch plan",
              description: "Milestones and starter tasks",
              settings: {
                status: "started",
                priority: "high",
                milestones: ["Plan", "Build"],
              },
              createdAt: "2026-05-13T00:00:00.000Z",
            },
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () =>
          url === "/api/project-labels" ? { labels: [] } : { templates: [] },
      });
    });

    render(<ProjectTemplatesPage />);

    fireEvent.click(await screen.findByText("Create project template"));
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));

    expect(
      await screen.findByText("Template name is required."),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Template name"), {
      target: { value: "Launch plan" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Milestones and starter tasks" },
    });
    fireEvent.change(screen.getByLabelText("Default status"), {
      target: { value: "started" },
    });
    fireEvent.change(screen.getByLabelText("Default priority"), {
      target: { value: "high" },
    });
    fireEvent.change(screen.getByLabelText("Template milestones"), {
      target: { value: "Plan\nBuild" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));

    expect(await screen.findByText("Launch plan")).toBeInTheDocument();
    expect(
      screen.getByText("Milestones and starter tasks"),
    ).toBeInTheDocument();
    expect(screen.queryByText("No project templates")).not.toBeInTheDocument();
    expect(screen.getByText(/2 milestones/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/project-templates",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"milestones":["Plan","Build"]'),
      }),
    );
  });
  it("keeps the dialog open and shows an error when saving fails", async () => {
    fetchMock.mockImplementation((url, init) => {
      if (url === "/api/project-templates" && init?.method === "POST") {
        return Promise.reject(new Error("offline"));
      }

      return Promise.resolve({
        ok: true,
        json: async () =>
          url === "/api/project-labels" ? { labels: [] } : { templates: [] },
      });
    });

    render(<ProjectTemplatesPage />);

    fireEvent.click(await screen.findByText("Create project template"));
    fireEvent.change(screen.getByLabelText("Template name"), {
      target: { value: "Launch plan" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));

    expect(
      await screen.findByText("Failed to create project template."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Create project template" }),
    ).toBeInTheDocument();
  });

  it("edits, duplicates, and deletes template rows with visible feedback", async () => {
    fetchMock.mockImplementation((url, init) => {
      if (url === "/api/project-templates" && !init) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            templates: [
              {
                id: "template-1",
                name: "Launch plan",
                description: "Original structure",
                settings: { status: "planned", milestones: ["Plan"] },
                createdAt: "2026-05-13T00:00:00.000Z",
              },
            ],
          }),
        });
      }
      if (url === "/api/project-labels") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ labels: [] }),
        });
      }
      if (
        url === "/api/project-templates/template-1" &&
        init?.method === "PATCH"
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            template: {
              id: "template-1",
              name: "Launch plan v2",
              description: "Updated structure",
              settings: { status: "started", milestones: ["Plan", "Build"] },
              createdAt: "2026-05-13T00:00:00.000Z",
            },
          }),
        });
      }
      if (url === "/api/project-templates" && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            template: {
              id: "template-2",
              name: "Launch plan v2 copy",
              description: "Updated structure",
              settings: { status: "started", milestones: ["Plan", "Build"] },
              createdAt: "2026-05-13T00:00:00.000Z",
            },
          }),
        });
      }
      if (
        url === "/api/project-templates/template-1" &&
        init?.method === "DELETE"
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<ProjectTemplatesPage />);

    expect(await screen.findByText("Launch plan")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(
      screen.getByRole("dialog", { name: "Edit project template" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Template name"), {
      target: { value: "Launch plan v2" },
    });
    fireEvent.change(screen.getByLabelText("Template milestones"), {
      target: { value: "Plan\nBuild" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      await screen.findByText("Project template updated."),
    ).toBeInTheDocument();
    expect(screen.getByText("Launch plan v2")).toBeInTheDocument();
    expect(
      screen.getByText("Status: started · 2 milestones"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(
      await screen.findByText("Project template duplicated."),
    ).toBeInTheDocument();
    expect(screen.getByText("Launch plan v2 copy")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[1]);
    expect(
      await screen.findByText("Project template deleted."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Launch plan v2")).not.toBeInTheDocument();
  });
});
