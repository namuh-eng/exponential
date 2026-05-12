import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TeamTemplatesSettingsPage from "../src/app/(app)/settings/teams/[key]/templates/page";

// Mock useParams
vi.mock("next/navigation", () => ({
  useParams: () => ({ key: "ENG" }),
}));

describe("TeamTemplatesSettingsPage component", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  const mockTemplatesData = {
    team: {
      name: "Engineering",
    },
    templates: [
      {
        id: "t1",
        name: "Bug Report",
        description: "Standard template for bugs",
      },
    ],
  };

  it("renders loading state then team templates", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockTemplatesData,
    });

    render(<TeamTemplatesSettingsPage />);

    expect(screen.getByText("Loading...")).toBeDefined();

    await waitFor(() => {
      expect(
        screen.getByText(/Create reusable templates for issues/i),
      ).toBeDefined();
    });

    expect(screen.getAllByText(/Engineering/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Bug Report")).toBeDefined();
    expect(screen.getByText("Standard template for bugs")).toBeDefined();
    expect(screen.getByText("Edit")).toBeDefined();
  });

  it("shows empty state when no templates exist", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mockTemplatesData,
        templates: [],
      }),
    });

    render(<TeamTemplatesSettingsPage />);

    await waitFor(() => {
      expect(
        screen.getByText("No templates have been created for this team."),
      ).toBeDefined();
    });
  });
});
