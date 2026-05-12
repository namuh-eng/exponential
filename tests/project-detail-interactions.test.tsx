import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ProjectDetailPage } from "@/components/project-detail-page";
import { useParams } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useParams: vi.fn(),
}));

describe("ProjectDetailPage interactions", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const mockProjectData = {
    project: {
      id: "p-1",
      name: "Mobile App",
      description: "Building the next gen mobile app",
      icon: "📱",
      slug: "mobile-app",
      status: "planned",
      priority: "high",
      startDate: null,
      targetDate: null,
    },
    lead: { id: "u-1", name: "Ashley" },
    members: [],
    teams: [{ id: "t-1", name: "Engineering", key: "ENG" }],
    labels: [],
    availableMembers: [{ id: "u-1", name: "Ashley" }],
    availableTeams: [{ id: "t-1", name: "Engineering", key: "ENG" }],
    availableLabels: [],
    slackChannel: null,
    resources: [],
    activity: [],
    milestones: [],
    issueGroups: [],
    progress: {
      total: 0,
      completed: 0,
      percentage: 0,
      assignees: [],
      labels: [],
    },
  };

  it("updates project status via the properties modal", async () => {
    vi.mocked(useParams).mockReturnValue({ slug: "mobile-app" });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProjectData),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            ...mockProjectData,
            project: { ...mockProjectData.project, status: "started" },
          }),
      });

    vi.stubGlobal("fetch", fetchMock);

    render(<ProjectDetailPage />);

    await waitFor(() =>
      expect(screen.getByText("Mobile App")).toBeInTheDocument(),
    );

    // Open properties editor
    const editButtons = screen.getAllByRole("button", { name: /edit/i });
    // The properties edit button is in the sidebar (rendered after main content),
    // but typically we can find it by looking for the one within the Properties section if we had test-ids.
    // Based on the DOM output, the second one is usually the properties one if the first is description.
    fireEvent.click(editButtons[1]);

    // Change status to "In Progress" (which maps to 'started')
    const statusSelect = screen.getByLabelText(/status/i);
    fireEvent.change(statusSelect, { target: { value: "started" } });

    // Save
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/mobile-app",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"status":"started"'),
        }),
      );
    });

    // Check if the UI updated (Summary status should be 'Started' or 'In Progress' depending on display)
    // Summary items uses capitalize: project.status.replace(/^./, (char) => char.toUpperCase())
    expect(screen.getByText("Started")).toBeInTheDocument();
  });

  it("adds a new link resource to the project", async () => {
    vi.mocked(useParams).mockReturnValue({ slug: "mobile-app" });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProjectData),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            ...mockProjectData,
            resources: [
              {
                id: "res-1",
                title: "Design Doc",
                type: "link",
                url: "https://figma.com",
                createdAt: new Date().toISOString(),
              },
            ],
          }),
      });

    vi.stubGlobal("fetch", fetchMock);

    render(<ProjectDetailPage />);

    await waitFor(() =>
      expect(screen.getByText("Mobile App")).toBeInTheDocument(),
    );

    // Open resource form
    fireEvent.click(
      screen.getByRole("button", { name: /\+ add document or link/i }),
    );

    // Fill form
    fireEvent.change(screen.getByPlaceholderText(/resource title/i), {
      target: { value: "Design Doc" },
    });
    fireEvent.change(screen.getByPlaceholderText(/https:\/\/\.\.\./i), {
      target: { value: "https://figma.com" },
    });

    // Submit
    fireEvent.click(screen.getByRole("button", { name: /add resource/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/mobile-app",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"title":"Design Doc"'),
        }),
      );
    });

    expect(screen.getByText("Design Doc")).toBeInTheDocument();
    expect(screen.getByText(/Link added/)).toBeInTheDocument();
  });
});
