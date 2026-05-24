import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TeamTemplatesSettingsPage from "../src/app/(app)/settings/teams/[key]/templates/page";

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
      key: "ENG",
    },
    templates: [
      {
        id: "t1",
        name: "Bug Report",
        description: "Standard template for bugs",
        settings: {
          body: "Steps to reproduce",
          defaultPriority: "high",
          defaultStatusName: "In Progress",
        },
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

  it("shows a controlled error when the team fetch is not OK", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "Team not found" }),
    });

    render(<TeamTemplatesSettingsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Team not found",
    );
    expect(screen.queryByText("New template")).toBeNull();
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

  it("validates, creates, edits, and deletes a team template", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockTemplatesData, templates: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          template: {
            id: "t2",
            name: "Escalation",
            description: "Escalate customer issues",
            settings: { body: "Escalation details", defaultPriority: "urgent" },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          template: {
            id: "t2",
            name: "Escalation edited",
            description: "Updated escalation details",
            settings: { body: "Updated body", defaultPriority: "high" },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

    render(<TeamTemplatesSettingsPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "New template" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Template name is required.",
    );

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Escalation" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Escalate customer issues" },
    });
    fireEvent.change(screen.getByLabelText("Issue body"), {
      target: { value: "Escalation details" },
    });
    fireEvent.change(screen.getByLabelText("Priority"), {
      target: { value: "urgent" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));

    expect(await screen.findByText("Escalation")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/teams/ENG/templates",
      expect.objectContaining({ method: "POST" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Escalation edited" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Updated escalation details" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));

    expect(await screen.findByText("Escalation edited")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/teams/ENG/templates",
      expect.objectContaining({ method: "PATCH" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.queryByText("Escalation edited")).toBeNull();
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/teams/ENG/templates",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
