import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
        issueCount: 5,
      },
      {
        id: "l2",
        name: "Internal",
        color: "#00ff00",
        description: null,
        issueCount: 0,
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
    expect(screen.getByText("5 issues")).toBeDefined();
    expect(screen.getByText("Internal")).toBeDefined();
    expect(screen.getByText("0 issues")).toBeDefined();
    expect(screen.getAllByText("Edit")).toHaveLength(2);
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
