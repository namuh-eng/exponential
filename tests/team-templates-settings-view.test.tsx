import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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

  it("renders a controlled not found state for missing teams", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "Team not found" }),
    });

    render(<TeamTemplatesSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Team not found")).toBeDefined();
    });
    expect(screen.queryByText("This page couldn’t load")).toBeNull();
  });

  it("creates and edits templates without a page reload", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ...mockTemplatesData, templates: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          template: {
            id: "t2",
            name: "Incident",
            description: "Incident body",
            type: "issue",
            settings: { body: "Incident body", defaultPriority: "high" },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          template: {
            id: "t2",
            name: "Incident edited",
            description: "Edited body",
            type: "issue",
            settings: { body: "Edited body", defaultPriority: "medium" },
          },
        }),
      });

    render(<TeamTemplatesSettingsPage />);

    await waitFor(() =>
      expect(
        screen.getByText("No templates have been created for this team."),
      ).toBeDefined(),
    );

    fireEvent.click(screen.getByText("New template"));
    fireEvent.change(screen.getByPlaceholderText("Bug report"), {
      target: { value: "Incident" },
    });
    fireEvent.change(screen.getByPlaceholderText("Template body"), {
      target: { value: "Incident body" },
    });
    fireEvent.click(screen.getByText("Save template"));

    await waitFor(() => expect(screen.getByText("Incident")).toBeDefined());

    fireEvent.click(screen.getByText("Edit"));
    fireEvent.change(screen.getByDisplayValue("Incident"), {
      target: { value: "Incident edited" },
    });
    fireEvent.change(screen.getByPlaceholderText("Template body"), {
      target: { value: "Edited body" },
    });
    fireEvent.click(screen.getByText("Save template"));

    await waitFor(() =>
      expect(screen.getByText("Incident edited")).toBeDefined(),
    );
  });

  it("deletes templates after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockTemplatesData,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

    render(<TeamTemplatesSettingsPage />);

    await waitFor(() => expect(screen.getByText("Bug Report")).toBeDefined());
    fireEvent.click(screen.getByText("Delete"));

    await waitFor(() => expect(screen.queryByText("Bug Report")).toBeNull());
  });
});
