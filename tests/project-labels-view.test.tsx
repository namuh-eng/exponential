import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProjectLabelsPage from "../src/app/(app)/settings/project-labels/page";

describe("ProjectLabelsPage component", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  const mockLabelsData = {
    labels: [
      {
        id: "l1",
        name: "Roadmap",
        color: "#ff0000",
        description: "Strategic initiatives",
        projectCount: 5,
      },
      {
        id: "l2",
        name: "Internal",
        color: "#00ff00",
        description: null,
        projectCount: 0,
      },
    ],
  };

  it("renders loading state then project labels", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockLabelsData,
    });

    render(<ProjectLabelsPage />);

    expect(screen.getByText("Loading...")).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText("Roadmap")).toBeDefined();
    });

    expect(screen.getByText("Strategic initiatives")).toBeDefined();
    expect(screen.getByText("5 projects")).toBeDefined();
    expect(screen.getByText("Internal")).toBeDefined();
    expect(screen.getByText("0 projects")).toBeDefined();
    expect(screen.getAllByText("Edit")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Delete Roadmap" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Delete Internal" }),
    ).toBeDefined();
  });

  it("shows empty state when no labels exist", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ labels: [] }),
    });

    render(<ProjectLabelsPage />);

    await waitFor(() => {
      expect(screen.getByText("No project labels")).toBeDefined();
    });
  });

  it("opens create modal from the toolbar and posts a new project label", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockLabelsData,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ label: { id: "l3" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          labels: [
            ...mockLabelsData.labels,
            {
              id: "l3",
              name: "Customer facing",
              color: "#3b82f6",
              description: "Visible roadmap",
              projectCount: 0,
            },
          ],
        }),
      });

    render(<ProjectLabelsPage />);
    await waitFor(() => screen.getByText("Roadmap"));

    fireEvent.click(screen.getByRole("button", { name: "Create label" }));
    expect(
      screen.getByRole("heading", { name: "Create project label" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Project label name"), {
      target: { value: "Customer facing" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("Add project label description..."),
      {
        target: { value: "Visible roadmap" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Color #3b82f6" }));
    const createButtons = screen.getAllByRole("button", {
      name: "Create label",
    });
    fireEvent.click(createButtons[createButtons.length - 1]);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/project-labels",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"name":"Customer facing"'),
        }),
      );
    });
    expect(await screen.findByText("Customer facing")).toBeInTheDocument();
  });

  it("opens create modal from empty state action", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ labels: [] }),
    });

    render(<ProjectLabelsPage />);
    await waitFor(() => screen.getByText("No project labels"));

    fireEvent.click(
      screen.getByRole("button", { name: "Create project label" }),
    );

    expect(
      screen.getByRole("heading", { name: "Create project label" }),
    ).toBeInTheDocument();
  });

  it("edits an existing project label", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockLabelsData,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ label: { id: "l1" } }),
      });

    render(<ProjectLabelsPage />);
    await waitFor(() => screen.getByText("Roadmap"));

    fireEvent.click(screen.getByRole("button", { name: "Edit Roadmap" }));
    expect(
      screen.getByRole("heading", { name: "Edit project label" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Project label name"), {
      target: { value: "Roadmap updated" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("Add project label description..."),
      {
        target: { value: "Updated description" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/project-labels/l1",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"name":"Roadmap updated"'),
        }),
      );
    });
    expect(screen.getByText("Roadmap updated")).toBeInTheDocument();
    expect(screen.getByText("Updated description")).toBeInTheDocument();
  });

  it("cancels project label deletion without changing the row", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockLabelsData,
    });

    render(<ProjectLabelsPage />);
    await waitFor(() => screen.getByText("Roadmap"));

    fireEvent.click(screen.getByRole("button", { name: "Delete Roadmap" }));

    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      'Delete the project label "Roadmap"?',
    );
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "remove it from all projects",
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByText("Roadmap")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("deletes a project label after confirmation without reloading", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockLabelsData,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

    render(<ProjectLabelsPage />);
    await waitFor(() => screen.getByText("Roadmap"));

    fireEvent.click(screen.getByRole("button", { name: "Delete Roadmap" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete label" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/project-labels/l1", {
        method: "DELETE",
      });
    });
    expect(screen.queryByText("Roadmap")).not.toBeInTheDocument();
    expect(screen.getByText("Internal")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps the project label visible and shows an error when deletion fails", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockLabelsData,
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Project label not found" }),
      });

    render(<ProjectLabelsPage />);
    await waitFor(() => screen.getByText("Roadmap"));

    fireEvent.click(screen.getByRole("button", { name: "Delete Roadmap" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete label" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Unable to delete project label. Project label not found",
        ),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Roadmap")).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("shows error message when fetch fails", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
    });

    render(<ProjectLabelsPage />);

    await waitFor(() => {
      expect(screen.getByText("Unable to load project labels.")).toBeDefined();
    });
  });
});
