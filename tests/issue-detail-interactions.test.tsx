import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { IssueDetailView } from "@/components/issue-detail-view";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: vi.fn(),
}));

describe("IssueDetailView interactions", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const mockIssueData = {
    id: "i-1",
    identifier: "ENG-1",
    title: "Initial Issue",
    description: "<p>Standard description</p>",
    priority: "high",
    state: {
      id: "s-1",
      name: "In Progress",
      category: "started",
      color: "#000000",
    },
    assignee: { name: "Ashley", image: null },
    creator: { name: "Ashley", image: null },
    team: { id: "t-1", name: "Engineering", key: "ENG" },
    project: null,
    labels: [],
    reactions: [],
    comments: [
      {
        id: "c-1",
        body: "First comment",
        user: { name: "Jaeyun", image: null },
        createdAt: "2026-04-20T10:00:00Z",
        reactions: [],
        attachments: [],
      },
    ],
    subIssues: [],
    createdAt: "2026-04-20T09:00:00Z",
    updatedAt: "2026-04-20T09:00:00Z",
  };

  const emptyHistoryResponse = {
    ok: true,
    json: () => Promise.resolve({ history: [] }),
  };

  it("updates issue title via contentEditable blur", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((input: string | URL | Request) => {
        const url = input.toString();
        if (url.includes("/history")) {
          return Promise.resolve(emptyHistoryResponse);
        }

        if (url === "/api/issues/i-1" && typeof input === "string") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockIssueData),
          });
        }

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockIssueData),
        });
      });

    vi.stubGlobal("fetch", fetchMock);

    render(<IssueDetailView issueId="i-1" />);

    await waitFor(() =>
      expect(screen.getByText("Initial Issue")).toBeInTheDocument(),
    );

    const titleEl = screen.getByLabelText("Issue title");
    titleEl.textContent = "Updated Title";
    fireEvent.blur(titleEl);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/issues/i-1",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"title":"Updated Title"'),
        }),
      );
    });
  });

  it("adds a reaction to a comment", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((input: string | URL | Request) => {
        const url = input.toString();
        if (url.includes("/history")) {
          return Promise.resolve(emptyHistoryResponse);
        }

        if (url.includes("/reactions")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([{ emoji: "👍", count: 1, reacted: true }]),
          });
        }

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockIssueData),
        });
      });

    vi.stubGlobal("fetch", fetchMock);

    render(<IssueDetailView issueId="i-1" />);

    await waitFor(() =>
      expect(screen.getByText("First comment")).toBeInTheDocument(),
    );

    // Click the 👍 quick reaction button
    const reactButton = screen.getByLabelText("React with 👍");
    fireEvent.click(reactButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/comments/c-1/reactions",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ emoji: "👍" }),
        }),
      );
    });

    expect(await screen.findByText("1")).toBeInTheDocument();
  });

  it("persists issue-level reaction toggles", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((input: string | URL | Request) => {
        const url = input.toString();
        if (url.includes("/history")) {
          return Promise.resolve(emptyHistoryResponse);
        }

        if (url === "/api/issues/i-1/reactions") {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([{ emoji: "👍", count: 1, reactedByMe: true }]),
          });
        }

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockIssueData),
        });
      });

    vi.stubGlobal("fetch", fetchMock);

    render(<IssueDetailView issueId="i-1" />);

    await waitFor(() =>
      expect(screen.getByText("Initial Issue")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByLabelText("Issue reaction 👍"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/issues/i-1/reactions",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ emoji: "👍" }),
        }),
      );
    });

    expect(await screen.findByText("👍 reaction saved.")).toBeInTheDocument();
    expect(screen.getByLabelText("Issue reaction 👍 selected")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("submits a new comment", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((input: string | URL | Request) => {
        const url = input.toString();
        if (url.includes("/history")) {
          return Promise.resolve(emptyHistoryResponse);
        }

        if (url.includes("/comments")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                id: "c-2",
                body: "New reply",
                user: { name: "Ashley", image: null },
                createdAt: new Date().toISOString(),
                reactions: [],
                attachments: [],
              }),
          });
        }

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockIssueData),
        });
      });

    vi.stubGlobal("fetch", fetchMock);

    render(<IssueDetailView issueId="i-1" />);

    await waitFor(() =>
      expect(
        screen.getByPlaceholderText(/leave a comment/i),
      ).toBeInTheDocument(),
    );

    const textarea = screen.getByPlaceholderText(/leave a comment/i);
    fireEvent.change(textarea, { target: { value: "New reply" } });

    fireEvent.click(screen.getByRole("button", { name: /comment/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/issues/i-1/comments",
        expect.any(Object),
      );
    });

    expect(await screen.findByText("New reply")).toBeInTheDocument();
  });
});
