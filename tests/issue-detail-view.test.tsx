import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
const appShellContextMock = vi.hoisted(() => ({
  workspaceSlug: undefined as string | undefined,
}));

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useParams: () => ({ key: "ENG", id: "iss-1" }),
}));

vi.mock("@/app/(app)/app-shell", () => ({
  useAppShellContext: () => ({
    workspaceSlug: appShellContextMock.workspaceSlug,
  }),
}));

import { IssueDetailView } from "@/components/issue-detail-view";

const mockIssueDetail = {
  id: "iss-1",
  identifier: "ENG-1",
  title: "A bug to fix",
  description: "<p>The description</p>",
  priority: "high",
  state: {
    id: "s1",
    name: "In Progress",
    category: "started",
    color: "#3b82f6",
  },
  assignee: { name: "Ashley", image: null },
  creator: { name: "Jaeyun", image: null },
  team: { id: "team-1", name: "Engineering", key: "ENG" },
  project: { id: "p1", name: "Agent Speed", icon: "⚡" },
  dueDate: "2026-04-30T00:00:00.000Z",
  estimate: 3,
  cycle: { id: "cycle-1", name: "Cycle 42", number: 42 },
  parentIssue: { id: "iss-0", identifier: "ENG-0", title: "Parent task" },
  relations: [
    {
      id: "rel-1",
      type: "blocks",
      issue: { id: "iss-2", identifier: "ENG-2", title: "Blocked task" },
    },
  ],
  labels: [{ name: "bug", color: "#f00" }],
  reactions: [],
  discussionSummary: {
    enabled: true,
    text: `• Overview: Ashley and Morgan discussed the rollout.
• Decision/status: Ashley: We decided to ship the API path.
• Next steps: Morgan: Next Morgan will verify the migration.`,
    generatedAt: "2026-05-15T10:00:00.000Z",
    sourceCommentCount: 2,
  },
  comments: [
    {
      id: "c1",
      body: "First comment",
      user: { name: "Ashley", image: null },
      createdAt: "2026-04-25T10:00:00Z",
      reactions: [],
      attachments: [],
    },
  ],
  subIssues: [],
  createdAt: "2026-04-25T09:00:00Z",
  updatedAt: "2026-04-25T09:30:00Z",
};

describe("IssueDetailView UI", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    appShellContextMock.workspaceSlug = undefined;
    vi.unstubAllGlobals();
  });

  it("renders loading state then issue details", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockIssueDetail,
    } as Response);

    render(<IssueDetailView issueId="iss-1" />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    expect(await screen.findByText("A bug to fix")).toBeInTheDocument();
    expect(await screen.findByText("The description")).toBeInTheDocument();

    // Identifier check
    expect(screen.getAllByText(/ENG-1/i).length).toBeGreaterThan(0);

    expect(screen.getByText("Engineering")).toBeInTheDocument();

    // Status check
    expect(screen.getAllByText(/In Progress/i).length).toBeGreaterThan(0);

    expect(screen.getByLabelText("Discussion summary")).toBeInTheDocument();
    expect(screen.getByText(/Decision\/status: Ashley/)).toBeInTheDocument();
    expect(
      screen.queryByText(/\d+ comment from \d+ participant/),
    ).not.toBeInTheDocument();
    expect(screen.getByText("First comment")).toBeInTheDocument();
  });

  it("renders Linear-like planning fields, relations, issue reactions, and actions", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockIssueDetail,
    } as Response);

    render(<IssueDetailView issueId="iss-1" />);
    await screen.findByText("A bug to fix");

    expect(screen.getByText("Due date")).toBeInTheDocument();
    expect(screen.getByText("Apr 30, 2026")).toBeInTheDocument();
    expect(screen.getByText("Estimate")).toBeInTheDocument();
    expect(screen.getByText("3 points")).toBeInTheDocument();
    expect(screen.getByText("Cycle")).toBeInTheDocument();
    expect(screen.getByText("Cycle 42")).toBeInTheDocument();
    expect(screen.getByText("Parent issue")).toBeInTheDocument();
    expect(screen.getByText("ENG-0 · Parent task")).toBeInTheDocument();
    expect(screen.getByText("Relations")).toBeInTheDocument();
    expect(screen.getByText("Blocks")).toBeInTheDocument();
    expect(screen.getByText("ENG-2 · Blocked task")).toBeInTheDocument();
    expect(screen.getByText("Blocked by")).toBeInTheDocument();
    expect(screen.getByText("Duplicate")).toBeInTheDocument();
    expect(screen.getByText("Related")).toBeInTheDocument();
    expect(screen.getByText("Issue reactions")).toBeInTheDocument();
    expect(screen.getByLabelText("Issue-level reactions")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Archive" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Delete" }),
    ).toBeInTheDocument();
  });

  it("updates issue title on blur", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockIssueDetail,
    } as Response);

    render(<IssueDetailView issueId="iss-1" />);
    const titleElement = await screen.findByText("A bug to fix");

    titleElement.textContent = "Improved Title";
    fireEvent.blur(titleElement);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/issues/iss-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ title: "Improved Title" }),
        }),
      );
    });
  });

  it("submits a new comment", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      if (
        url.toString().includes("/api/issues/iss-1") &&
        !url.toString().includes("comments")
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => mockIssueDetail,
        } as Response);
      }
      if (url.toString().includes("/api/issues/iss-1/comments")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "c2",
            body: "New comment text",
            user: { name: "Ashley", image: null },
            createdAt: new Date().toISOString(),
            reactions: [],
            attachments: [],
          }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });

    render(<IssueDetailView issueId="iss-1" />);
    await screen.findByText("A bug to fix");

    const textarea = screen.getByPlaceholderText("Leave a comment...");
    fireEvent.change(textarea, { target: { value: "New comment text" } });

    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() => {
      const calls = fetchSpy.mock.calls;
      const commentCall = calls.find((call) =>
        call[0].toString().includes("/api/issues/iss-1/comments"),
      );
      expect(commentCall).toBeDefined();
      if (commentCall) {
        const requestInit = commentCall[1] as RequestInit & { body: FormData };
        expect(requestInit.method).toBe("POST");
        expect(requestInit.body.get("body")).toBe("New comment text");
      }
    });

    expect(await screen.findByText("New comment text")).toBeInTheDocument();
  });

  it("submits selected attachments with a comment", async () => {
    const uploadedFile = new File(["quarterly notes"], "notes.txt", {
      type: "text/plain",
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      if (
        url.toString().includes("/api/issues/iss-1") &&
        !url.toString().includes("comments")
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => mockIssueDetail,
        } as Response);
      }
      if (url.toString().includes("/api/issues/iss-1/comments")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "c2",
            body: "See attached",
            user: { name: "Ashley", image: null },
            createdAt: new Date().toISOString(),
            reactions: [],
            attachments: [
              {
                id: "att-1",
                fileName: "notes.txt",
                contentType: "text/plain",
                size: uploadedFile.size,
                downloadUrl: "https://example.com/notes.txt",
              },
            ],
          }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });

    render(<IssueDetailView issueId="iss-1" />);
    await screen.findByText("A bug to fix");

    fireEvent.change(screen.getByPlaceholderText("Leave a comment..."), {
      target: { value: "See attached" },
    });
    fireEvent.change(screen.getByLabelText("Add attachments"), {
      target: { files: [uploadedFile] },
    });

    expect(screen.getByText("notes.txt")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() => {
      const commentCall = fetchSpy.mock.calls.find((call) =>
        call[0].toString().includes("/api/issues/iss-1/comments"),
      );
      expect(commentCall).toBeDefined();
      if (commentCall) {
        const requestInit = commentCall[1] as RequestInit & { body: FormData };
        expect(requestInit.body.get("body")).toBe("See attached");
        expect(requestInit.body.getAll("attachments")).toEqual([uploadedFile]);
      }
    });

    expect(await screen.findByText("See attached")).toBeInTheDocument();
    expect(screen.getAllByText("notes.txt").length).toBeGreaterThan(0);
  });

  it("opens searchable member mention picker, inserts canonical token, and renders posted mention chip", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      const href = url.toString();
      if (href.includes("/api/workspaces/members")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            members: [
              {
                userId: "sam-1",
                name: "Sam Lee",
                email: "sam.one@example.com",
                image: null,
                status: "active",
              },
              {
                userId: "sam-2",
                name: "Sam Lee",
                email: "sam.two@example.com",
                image: null,
                status: "active",
              },
              {
                userId: "ashley-1",
                name: "Ashley Ha",
                email: "ashley@example.com",
                image: null,
                status: "active",
              },
            ],
          }),
        } as Response);
      }

      if (href.includes("/api/issues/iss-1/comments")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "c-mentioned",
            body: "Please review @[Sam Lee](user:sam-2)",
            user: { name: "Ashley", image: null },
            createdAt: new Date().toISOString(),
            reactions: [],
            attachments: [],
          }),
        } as Response);
      }

      if (href.includes("/history")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ history: [] }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () => mockIssueDetail,
      } as Response);
    });

    render(<IssueDetailView issueId="iss-1" />);
    await screen.findByText("A bug to fix");

    const textarea = screen.getByPlaceholderText("Leave a comment...");
    fireEvent.change(textarea, { target: { value: "Please review @sam" } });

    const picker = await screen.findByRole("menu", {
      name: "Mention members",
    });
    expect(picker).toBeInTheDocument();
    expect(screen.getByText("sam.two@example.com")).toBeInTheDocument();

    fireEvent.click(screen.getByText("sam.two@example.com"));

    expect(await screen.findByLabelText("Selected mentions")).toHaveTextContent(
      "@Sam Lee",
    );
    expect(textarea).toHaveValue("Please review @[Sam Lee](user:sam-2) ");

    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() => {
      const commentCall = fetchSpy.mock.calls.find((call) =>
        call[0].toString().includes("/api/issues/iss-1/comments"),
      );
      expect(commentCall).toBeDefined();
      if (commentCall) {
        const requestInit = commentCall[1] as RequestInit & { body: FormData };
        expect(requestInit.body.get("body")).toBe(
          "Please review @[Sam Lee](user:sam-2)",
        );
        expect(requestInit.body.get("mentionedUserIds")).toBe(
          JSON.stringify(["sam-2"]),
        );
      }
    });

    expect(await screen.findByText("@Sam Lee")).toBeInTheDocument();
  });

  it("supports keyboard navigation and Escape dismissal for mention picker", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      const href = url.toString();
      if (href.includes("/api/workspaces/members")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            members: [
              {
                userId: "ashley-1",
                name: "Ashley Ha",
                email: "ashley@example.com",
                image: null,
                status: "active",
              },
              {
                userId: "morgan-1",
                name: "Morgan",
                email: "morgan@example.com",
                image: null,
                status: "active",
              },
            ],
          }),
        } as Response);
      }

      if (href.includes("/history")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ history: [] }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () => mockIssueDetail,
      } as Response);
    });

    render(<IssueDetailView issueId="iss-1" />);
    await screen.findByText("A bug to fix");

    const textarea = screen.getByPlaceholderText("Leave a comment...");
    fireEvent.click(screen.getByRole("button", { name: "Mention" }));
    expect(
      await screen.findByRole("menu", { name: "Mention members" }),
    ).toBeInTheDocument();

    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(textarea).toHaveValue("@[Morgan](user:morgan-1) ");

    fireEvent.change(textarea, { target: { value: "@" } });
    expect(
      await screen.findByRole("menu", { name: "Mention members" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(textarea, { key: "Escape" });
    await waitFor(() => {
      expect(
        screen.queryByRole("menu", { name: "Mention members" }),
      ).not.toBeInTheDocument();
    });
  });

  it("applies rich text toolbar commands to the description", async () => {
    const execCommandSpy = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommandSpy,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockIssueDetail,
    } as Response);

    render(<IssueDetailView issueId="iss-1" />);
    await screen.findByText("A bug to fix");

    fireEvent.click(screen.getAllByRole("button", { name: "Bold" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Bullet list" }));
    fireEvent.click(screen.getByRole("button", { name: "Quote" }));

    expect(execCommandSpy).toHaveBeenCalledWith("bold", false, undefined);
    expect(execCommandSpy).toHaveBeenCalledWith(
      "insertUnorderedList",
      false,
      undefined,
    );
    expect(execCommandSpy).toHaveBeenCalledWith(
      "formatBlock",
      false,
      "blockquote",
    );
  });

  it("links sub-issues through unprefixed identifier routes without a workspace", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mockIssueDetail,
        subIssues: [
          {
            id: "7d4f6319-e56f-48dd-9731-b3d735a43b38",
            identifier: "ENG-124",
            title: "Unprefixed child task",
            priority: "low",
            state: null,
          },
        ],
      }),
    } as Response);

    render(<IssueDetailView issueId="ENG-1" />);

    await screen.findByText("ENG-124");
    const subIssueLink = screen.getByText("Unprefixed child task").closest("a");
    expect(subIssueLink).toHaveAttribute("href", "/team/ENG/issue/ENG-124");
  });

  it("links sub-issues through workspace-aware identifier routes", async () => {
    appShellContextMock.workspaceSlug = "foreverbrowsing";
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mockIssueDetail,
        subIssues: [
          {
            id: "5efda6f1-6ac0-45f8-b383-a4f3bb872a8d",
            identifier: "ENG-123",
            title: "Child task",
            priority: "medium",
            state: {
              name: "Todo",
              category: "unstarted",
              color: "#999999",
            },
          },
        ],
      }),
    } as Response);

    render(<IssueDetailView issueId="ENG-1" />);

    await screen.findByText("ENG-123");
    const subIssueLink = screen.getByText("Child task").closest("a");
    expect(subIssueLink).not.toBeNull();
    expect(subIssueLink).toHaveAttribute(
      "href",
      "/foreverbrowsing/team/ENG/issue/ENG-123",
    );
    expect(subIssueLink).not.toHaveAttribute(
      "href",
      expect.stringContaining("5efda6f1-6ac0-45f8-b383-a4f3bb872a8d"),
    );
  });

  it("toggles sub-issue form and submits", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockIssueDetail,
    } as Response);

    render(<IssueDetailView issueId="iss-1" />);
    await screen.findByText("A bug to fix");

    fireEvent.click(screen.getByRole("button", { name: "Create sub-issue" }));

    const input = screen.getByPlaceholderText("Sub-issue title");
    fireEvent.change(input, { target: { value: "Child task" } });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/issues",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"title":"Child task"'),
        }),
      );
    });
  });

  it("archives from the actions menu with confirmation and visible feedback", async () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      if (url.toString().includes("/api/issues/iss-1/history")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ history: [] }),
        } as Response);
      }
      if (url.toString() === "/api/issues/iss-1") {
        return Promise.resolve({
          ok: true,
          json: async () => mockIssueDetail,
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ ...mockIssueDetail, archivedAt: new Date() }),
      } as Response);
    });

    render(<IssueDetailView issueId="iss-1" />);
    await screen.findByText("A bug to fix");

    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/issues/iss-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ archive: true }),
        }),
      );
    });
    expect(
      await screen.findByText("Issue archived and hidden from active lists."),
    ).toBeInTheDocument();
  });

  it("does not archive when confirmation is cancelled", async () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => false),
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockIssueDetail,
    } as Response);

    render(<IssueDetailView issueId="iss-1" />);
    await screen.findByText("A bug to fix");

    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));

    await waitFor(() => {
      expect(fetchSpy).not.toHaveBeenCalledWith(
        "/api/issues/iss-1",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
  });

  it("requires delete confirmation before mutation and navigates after success", async () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      if (url.toString().includes("/api/issues/iss-1/history")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ history: [] }),
        } as Response);
      }
      if (url.toString() === "/api/issues/iss-1") {
        return Promise.resolve({
          ok: true,
          json: async () => mockIssueDetail,
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);
    });

    render(<IssueDetailView issueId="iss-1" />);
    await screen.findByText("A bug to fix");

    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/issues/iss-1",
        expect.objectContaining({ method: "DELETE" }),
      );
      expect(pushMock).toHaveBeenCalledWith("/team/ENG/all");
    });
  });
});

describe("IssueDetailView collaboration controls", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders and persists issue subscription toggles", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      const href = url.toString();
      if (href.endsWith("/subscription")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ subscribed: true, watcherCount: 1 }),
        } as Response);
      }

      if (href.includes("/history")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ history: [] }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({
          ...mockIssueDetail,
          subscription: { subscribed: false, watcherCount: 0 },
        }),
      } as Response);
    });

    render(<IssueDetailView issueId="iss-1" />);
    await screen.findByText("A bug to fix");

    fireEvent.click(
      screen.getByRole("button", { name: "Subscribe to issue notifications" }),
    );

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith("/api/issues/ENG-1/subscription", {
        method: "POST",
      });
    });
    expect(
      await screen.findByRole("button", {
        name: "Unsubscribe from issue notifications",
      }),
    ).toHaveTextContent("Subscribed · 1");
  });

  it("exposes richer comment composer, emoji picker, and comment actions", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      const href = url.toString();
      if (href.includes("/reactions")) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ emoji: "🔥", count: 1, reacted: true }],
        } as Response);
      }
      if (href.includes("/history")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ history: [] }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          ...mockIssueDetail,
          subscription: { subscribed: false, watcherCount: 0 },
        }),
      } as Response);
    });

    render(<IssueDetailView issueId="iss-1" />);
    await screen.findByText("A bug to fix");

    expect(
      screen.getByLabelText("Comment composer toolbar"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Format bold"));
    expect(screen.getByPlaceholderText("Leave a comment...")).toHaveValue(
      "**text**",
    );

    fireEvent.click(screen.getByLabelText("Open reaction picker"));
    fireEvent.click(screen.getByRole("menuitem", { name: "React with 🔥" }));
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/comments/c1/reactions",
        expect.objectContaining({ body: JSON.stringify({ emoji: "🔥" }) }),
      );
    });

    fireEvent.click(screen.getByLabelText("More actions"));
    expect(
      screen.getByRole("menuitem", { name: "Copy link" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Delete" }),
    ).toBeInTheDocument();
  });

  it("supports issue reactions outside the quick four via picker", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      const href = url.toString();
      if (href.endsWith("/reactions")) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ emoji: "🔥", count: 1, reactedByMe: true }],
        } as Response);
      }
      if (href.includes("/history")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ history: [] }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          ...mockIssueDetail,
          subscription: { subscribed: false, watcherCount: 0 },
        }),
      } as Response);
    });

    render(<IssueDetailView issueId="iss-1" />);
    await screen.findByText("A bug to fix");

    fireEvent.click(screen.getByLabelText("Open issue reaction picker"));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Issue reaction 🔥" }),
    );

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/issues/iss-1/reactions",
        expect.objectContaining({ body: JSON.stringify({ emoji: "🔥" }) }),
      );
    });
  });

  it("hides the summary card when summaries are disabled", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mockIssueDetail,
        discussionSummary: { enabled: false, text: null },
      }),
    } as Response);

    render(<IssueDetailView issueId="iss-1" />);

    await screen.findByText("A bug to fix");
    expect(
      screen.queryByLabelText("Discussion summary"),
    ).not.toBeInTheDocument();
  });

  it("renders an honest empty state instead of an AI placeholder", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mockIssueDetail,
        discussionSummary: {
          enabled: true,
          text: null,
          generatedAt: null,
          sourceCommentCount: 0,
        },
        comments: [],
      }),
    } as Response);

    render(<IssueDetailView issueId="iss-1" />);

    expect(
      await screen.findByLabelText("Discussion summary"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Add at least two comments to generate an AI summary/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No comments have been added yet."),
    ).not.toBeInTheDocument();
  });

  it("shows a generate retry affordance when summary generation fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mockIssueDetail,
        discussionSummary: {
          enabled: true,
          text: null,
          generatedAt: null,
          sourceCommentCount: 2,
          status: "failed",
          error: "Discussion summary could not be generated. Try refreshing.",
        },
        comments: [
          ...mockIssueDetail.comments,
          {
            id: "c2",
            body: "Second comment",
            user: { name: "Morgan", image: null },
            createdAt: "2026-04-25T10:05:00Z",
            reactions: [],
            attachments: [],
          },
        ],
      }),
    } as Response);

    render(<IssueDetailView issueId="iss-1" />);

    expect(
      await screen.findByText(
        "Discussion summary could not be generated. Try refreshing.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Generate" }),
    ).toBeInTheDocument();
  });
});
