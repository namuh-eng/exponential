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

describe("Project Resource Management", () => {
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

  it("adds a document resource to the project", async () => {
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
                id: "res-doc-1",
                title: "Project Charter",
                type: "document",
                url: null,
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

    // Switch to Document type - select interaction
    const typeSelect = screen.getByRole("combobox");
    fireEvent.change(typeSelect, { target: { value: "document" } });

    // Fill title
    fireEvent.change(screen.getByPlaceholderText(/resource title/i), {
      target: { value: "Project Charter" },
    });

    // Submit
    fireEvent.click(screen.getByRole("button", { name: /add resource/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/mobile-app",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"type":"document"'),
        }),
      );
    });

    expect(screen.getByText("Project Charter")).toBeInTheDocument();
  });
});
