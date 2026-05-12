import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import InitiativesPage from "@/app/(app)/initiatives/page";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockInitiatives = [
  {
    id: "init-1",
    name: "Core Overhaul",
    description: "Rebuild the core",
    status: "active",
    projectCount: 2,
    completedProjectCount: 0,
    createdAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "init-2",
    name: "Mobile App",
    description: null,
    status: "planned",
    projectCount: 1,
    completedProjectCount: 0,
    createdAt: "2024-02-01T00:00:00Z",
  },
];

describe("InitiativesPage component", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders loading state then initiative list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ initiatives: mockInitiatives }),
      }),
    );

    render(<InitiativesPage />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Core Overhaul")).toBeInTheDocument();
    expect(screen.queryByText("Mobile App")).not.toBeInTheDocument(); // different tab
  });

  it("switches tabs to show planned initiatives", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ initiatives: mockInitiatives }),
      }),
    );

    render(<InitiativesPage />);
    await waitFor(() => screen.getByText("Core Overhaul"));

    fireEvent.click(screen.getByText("Planned"));

    await waitFor(() => {
      expect(screen.getByText("Mobile App")).toBeInTheDocument();
      expect(screen.queryByText("Core Overhaul")).not.toBeInTheDocument();
    });
  });

  it("opens create form and submits new initiative", async () => {
    const fetchMock = vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ initiatives: mockInitiatives }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            initiatives: [
              ...mockInitiatives,
              {
                id: "init-3",
                name: "New Feature",
                status: "active",
                projectCount: 0,
                completedProjectCount: 0,
                createdAt: new Date().toISOString(),
              },
            ],
          }),
        }),
    );

    render(<InitiativesPage />);
    await waitFor(() => screen.getByText("Core Overhaul"));

    fireEvent.click(screen.getByText("New initiative"));
    expect(screen.getByPlaceholderText("Initiative name")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Initiative name"), {
      target: { value: "New Feature" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create initiative" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/initiatives",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"name":"New Feature"'),
        }),
      );
    });

    await waitFor(() => screen.getByText("New Feature"));
  });

  it("handles keyboard shortcut N then I to open create form", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ initiatives: [] }),
      }),
    );

    render(<InitiativesPage />);
    await waitFor(() => screen.getByText("Initiatives"));

    fireEvent.keyDown(document, { key: "n" });
    fireEvent.keyDown(document, { key: "i" });

    expect(screen.getByPlaceholderText("Initiative name")).toBeInTheDocument();
  });
});
