import TeamIssueStatusesPage from "@/app/(app)/settings/teams/[key]/statuses/page";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useParams: () => ({ key: "TEAM" }),
}));

// Mock status icon
vi.mock("@/components/icons/status-icon", () => ({
  StatusIcon: () => <div data-testid="status-icon" />,
}));

const mockStatuses = {
  triage: [
    { id: "s1", name: "Triage", issueCount: 5, description: "New issues" },
  ],
  backlog: [{ id: "s2", name: "Backlog", issueCount: 0, description: null }],
  unstarted: [
    {
      id: "s3",
      name: "Todo",
      issueCount: 10,
      description: "Planned",
      isDefault: true,
    },
  ],
  started: [
    { id: "s4", name: "In Progress", issueCount: 2, description: null },
    { id: "s8", name: "Review", issueCount: 0, description: null },
  ],
  completed: [{ id: "s5", name: "Done", issueCount: 100, description: null }],
  canceled: [{ id: "s6", name: "Canceled", issueCount: 1, description: null }],
};

describe("TeamIssueStatusesPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ statuses: mockStatuses }),
        }),
      ),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders loading state then issue statuses", async () => {
    render(<TeamIssueStatusesPage />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Issue statuses")).toBeInTheDocument();
    });

    // Check category headers (using getAll since the name is also used in status items and select)
    expect(screen.getAllByText("Triage").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Backlog").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Unstarted").length).toBeGreaterThan(0);

    // Check status items
    expect(screen.getByText("New issues")).toBeInTheDocument();

    expect(screen.getAllByText("Todo").length).toBeGreaterThan(0);
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.getByText("10 issues")).toBeInTheDocument();
  });

  it("handles empty status list", async () => {
    vi.mocked(global.fetch).mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ statuses: null }),
      } as Response),
    );

    render(<TeamIssueStatusesPage />);
    await waitFor(() => {
      expect(screen.getByText("No statuses found")).toBeInTheDocument();
    });
  });

  it("creates statuses and persists duplicate status changes through the API", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return {
            ok: true,
            json: () =>
              Promise.resolve({
                statuses: {
                  ...mockStatuses,
                  started: [
                    ...mockStatuses.started,
                    {
                      id: "s7",
                      name: "QA Review",
                      issueCount: 0,
                      description: "Ready for QA",
                      color: "#123abc",
                    },
                  ],
                },
                duplicateStatusId: "s6",
              }),
          } as Response;
        }

        if (init?.method === "PATCH") {
          return {
            ok: true,
            json: () =>
              Promise.resolve({
                statuses: mockStatuses,
                duplicateStatusId: "s5",
              }),
          } as Response;
        }

        return {
          ok: true,
          json: () =>
            Promise.resolve({
              statuses: mockStatuses,
              duplicateStatusId: "s6",
            }),
        } as Response;
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<TeamIssueStatusesPage />);
    await screen.findByText("Issue statuses");

    fireEvent.click(screen.getAllByLabelText("Add status")[3]);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "QA Review" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Ready for QA" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => screen.getByText("Status created."));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/teams/TEAM/statuses",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"name":"QA Review"'),
      }),
    );
    expect(screen.getAllByText("QA Review").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "s5" } });
    await waitFor(() => screen.getByText("Duplicate issue status saved."));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/teams/TEAM/statuses",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ duplicateStatusId: "s5" }),
      }),
    );
  });

  it("edits status names and sends persisted reorder payloads", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          return {
            ok: true,
            json: () =>
              Promise.resolve({
                statuses: mockStatuses,
                duplicateStatusId: "s6",
              }),
          } as Response;
        }

        return {
          ok: true,
          json: () =>
            Promise.resolve({
              statuses: mockStatuses,
              duplicateStatusId: "s6",
            }),
        } as Response;
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<TeamIssueStatusesPage />);
    await screen.findByText("Issue statuses");

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Incoming" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => screen.getByText("Status updated."));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/teams/TEAM/statuses",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"name":"Incoming"'),
      }),
    );

    fireEvent.click(screen.getByLabelText("Move Review up"));
    await waitFor(() => screen.getByText("Status order saved."));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/teams/TEAM/statuses",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          reorder: { category: "started", orderedIds: ["s8", "s4"] },
        }),
      }),
    );
  });

  it("renders duplicate issue status selector with all statuses", async () => {
    render(<TeamIssueStatusesPage />);
    await waitFor(() => screen.getByText("Duplicate issue status"));

    const select = screen.getByRole("combobox");
    expect(select).toBeInTheDocument();

    // Check if some statuses from different categories are options
    expect(screen.getByRole("option", { name: "Triage" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Done" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Canceled" }),
    ).toBeInTheDocument();
  });
});
