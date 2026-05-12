import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { IssueDetailView } from "@/components/issue-detail-view";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useParams: vi.fn(),
}));

describe("Issue History and Audit Logging", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  const mockIssueWithComments = {
    id: "i-1",
    identifier: "ENG-1",
    title: "Logged Issue",
    description: "desc",
    priority: "low",
    state: { id: "s-1", name: "Backlog", category: "backlog", color: "#ccc" },
    assignee: null,
    creator: { name: "Ashley" },
    team: { id: "t-1", name: "Engineering", key: "ENG" },
    project: null,
    labels: [],
    comments: [
      {
        id: "c-1",
        body: "Test activity",
        user: { name: "System", image: null },
        createdAt: "2026-04-23T11:00:00.000Z",
        reactions: [],
        attachments: [],
      },
    ],
    subIssues: [],
    createdAt: "2026-04-23T09:00:00.000Z",
    updatedAt: "2026-04-23T10:00:00.000Z",
  };

  it("renders comments in the issue detail activity view", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: string | URL | Request) => {
        const url = input.toString();
        if (url.includes("/history")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ history: [] }),
          });
        }

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockIssueWithComments),
        });
      }),
    );

    render(<IssueDetailView issueId="i-1" />);

    await waitFor(() =>
      expect(screen.getByText("Logged Issue")).toBeInTheDocument(),
    );

    expect(screen.getByText("Test activity")).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
  });

  it("calls the dedicated history route and renders persisted history events", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((input: string | URL | Request) => {
        const url = input.toString();
        if (url.includes("/history")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                history: [
                  {
                    id: "h1",
                    type: "created",
                    metadata: {
                      identifier: "ENG-1",
                      title: "Logged Issue",
                    },
                    actor: {
                      id: "u-1",
                      name: "Ashley",
                      email: "ashley@example.com",
                    },
                    createdAt: "2026-04-23T09:00:00.000Z",
                  },
                  {
                    id: "h2",
                    type: "updated",
                    metadata: { changedFields: ["title", "stateId"] },
                    actor: {
                      id: "u-2",
                      name: "Morgan",
                      email: "morgan@example.com",
                    },
                    createdAt: "2026-04-23T10:00:00.000Z",
                  },
                  {
                    id: "h3",
                    type: "comment_created",
                    metadata: { commentId: "c-1", attachmentCount: 1 },
                    actor: {
                      id: "u-3",
                      name: "System",
                      email: "system@example.com",
                    },
                    createdAt: "2026-04-23T11:00:00.000Z",
                  },
                ],
              }),
          });
        }

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockIssueWithComments),
        });
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<IssueDetailView issueId="i-1" />);

    await waitFor(() =>
      expect(screen.getByText("Logged Issue")).toBeInTheDocument(),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/issues/i-1/history"),
    );
    expect(screen.getByText("Ashley created this issue")).toBeInTheDocument();
    expect(
      screen.getByText("Morgan updated title and status"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("System added a comment with 1 attachment"),
    ).toBeInTheDocument();
    expect(screen.getByText("Test activity")).toBeInTheDocument();
  });

  it("renders legacy fallback events without hiding comments", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: string | URL | Request) => {
        const url = input.toString();
        if (url.includes("/history")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                history: [
                  {
                    id: "legacy-created-i-1",
                    type: "created",
                    metadata: {
                      identifier: "ENG-1",
                      title: "Logged Issue",
                      migrationFallback: true,
                    },
                    actor: null,
                    createdAt: "2026-04-23T09:00:00.000Z",
                  },
                ],
              }),
          });
        }

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockIssueWithComments),
        });
      }),
    );

    render(<IssueDetailView issueId="i-1" />);

    await waitFor(() =>
      expect(screen.getByText("Logged Issue")).toBeInTheDocument(),
    );
    expect(
      screen.getByText("Someone created this issue from legacy data"),
    ).toBeInTheDocument();
    expect(screen.getByText("Test activity")).toBeInTheDocument();
  });

  it("shows a history error while preserving comments", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: string | URL | Request) => {
        const url = input.toString();
        if (url.includes("/history")) {
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({}),
          });
        }

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockIssueWithComments),
        });
      }),
    );

    render(<IssueDetailView issueId="i-1" />);

    await waitFor(() =>
      expect(screen.getByText("Logged Issue")).toBeInTheDocument(),
    );
    expect(
      screen.getByText(
        "Couldn’t load activity history. Comments are still available.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Test activity")).toBeInTheDocument();
  });
});
