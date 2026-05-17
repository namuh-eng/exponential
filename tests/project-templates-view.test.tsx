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
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ templates: [] }),
    });
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
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ templates: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          template: {
            id: "template-1",
            name: "Launch plan",
            description: "Milestones and starter tasks",
            createdAt: "2026-05-13T00:00:00.000Z",
          },
        }),
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
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));

    expect(await screen.findByText("Launch plan")).toBeInTheDocument();
    expect(
      screen.getByText("Milestones and starter tasks"),
    ).toBeInTheDocument();
    expect(screen.queryByText("No project templates")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/project-templates",
      expect.objectContaining({ method: "POST" }),
    );
  });
  it("keeps the dialog open and shows an error when saving fails", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ templates: [] }),
      })
      .mockRejectedValueOnce(new Error("offline"));

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
});
