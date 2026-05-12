import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ key: "ENG", id: "iss-1" }),
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
  labels: [{ name: "bug", color: "#f00" }],
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
  });

  it("renders loading state then issue details", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockIssueDetail,
    } as Response);

    render(<IssueDetailView issueId="iss-1" />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    expect(await screen.findByText("A bug to fix")).toBeInTheDocument();
    expect(screen.getByText("The description")).toBeInTheDocument();

    // Identifier check
    expect(screen.getAllByText(/ENG-1/i).length).toBeGreaterThan(0);

    expect(screen.getByText("Engineering")).toBeInTheDocument();

    // Status check
    expect(screen.getAllByText(/In Progress/i).length).toBeGreaterThan(0);

    expect(screen.getByText("First comment")).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
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
});
