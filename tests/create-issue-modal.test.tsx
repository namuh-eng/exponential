import { CreateIssueModal } from "@/components/create-issue-modal";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  teamKey: "ENG",
  teamName: "Engineering",
  teamId: "team-1",
  defaultStateId: "state-1",
};

const optionsResponse = {
  team: { id: "team-1", name: "Engineering", key: "ENG" },
  statuses: [
    {
      id: "state-1",
      name: "Backlog",
      category: "backlog",
      color: "#6b6f76",
    },
    {
      id: "state-2",
      name: "In Progress",
      category: "started",
      color: "#f59e0b",
    },
  ],
  priorities: [
    { value: "none", label: "No priority" },
    { value: "high", label: "High" },
  ],
  assignees: [{ id: "user-1", name: "Jaeyun Ha", image: null }],
  labels: [{ id: "label-1", name: "Bug", color: "#ef4444" }],
  projects: [{ id: "project-1", name: "Roadmap", icon: "R" }],
  cycles: [{ id: "cycle-1", name: "Cycle 1", number: 1 }],
  estimates: [{ value: 3, label: "3 points" }],
  relationIssues: [
    { id: "issue-parent", identifier: "ENG-1", title: "Parent task" },
    { id: "issue-related", identifier: "ENG-2", title: "Related task" },
  ],
  dueDatePresets: [
    { value: "today", label: "Today" },
    { value: "tomorrow", label: "Tomorrow" },
    { value: "next-week", label: "Next week" },
    { value: "custom", label: "Custom date" },
  ],
};

function mockJsonResponse(payload: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => payload,
  } as Response;
}

function setEditableValue(element: HTMLElement, value: string) {
  element.textContent = value;
  fireEvent.input(element);
}

describe("CreateIssueModal", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);

      if (url.includes("/create-issue-options")) {
        return mockJsonResponse(optionsResponse);
      }

      if (url === "/api/issue-templates?teamKey=ENG") {
        return mockJsonResponse({
          templates: [
            {
              id: "template-1",
              name: "Bug template",
              description: "Fallback body",
              settings: {
                title: "Templated bug",
                body: "Steps to reproduce",
                defaultPriority: "high",
                defaultStatusName: "In Progress",
                defaultProjectId: "project-1",
              },
            },
          ],
        });
      }

      if (url === "/api/issues" && init?.method === "POST") {
        return mockJsonResponse({ id: "issue-1" }, true, 201);
      }

      if (url === "/api/issues/issue-1/comments" && init?.method === "POST") {
        return mockJsonResponse({ id: "comment-1" }, true, 201);
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders modal when open", async () => {
    render(<CreateIssueModal {...defaultProps} />);

    expect(screen.getByText("New issue")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Assignee" }),
      ).toBeInTheDocument();
    });
  });

  it("does not render when closed", () => {
    render(<CreateIssueModal {...defaultProps} open={false} />);
    expect(screen.queryByText("New issue")).toBeNull();
  });

  it("renders rich text title and description editors", async () => {
    render(<CreateIssueModal {...defaultProps} />);

    await waitFor(() => {
      expect(
        screen.getByRole("textbox", { name: "Issue title" }),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByRole("textbox", { name: "Issue description" }),
    ).toBeInTheDocument();
  });

  it("renders toolbar buttons for status, priority, assignee, project, and labels", async () => {
    render(<CreateIssueModal {...defaultProps} />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Status" }),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", { name: "Priority" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Assignee" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Project" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Labels" })).toBeInTheDocument();
  });

  it("calls onClose when close button clicked", async () => {
    const onClose = vi.fn();
    render(<CreateIssueModal {...defaultProps} onClose={onClose} />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /close/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("disables submit when title is empty", async () => {
    render(<CreateIssueModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Create Issue")).toBeInTheDocument();
    });

    expect(screen.getByText("Create Issue").closest("button")).toBeDisabled();
  });

  it("enables submit when title is entered", async () => {
    render(<CreateIssueModal {...defaultProps} />);

    const titleBox = await screen.findByRole("textbox", {
      name: "Issue title",
    });
    setEditableValue(titleBox, "Fix bug");

    expect(
      screen.getByText("Create Issue").closest("button"),
    ).not.toBeDisabled();
  });

  it("applies an issue template without overwriting user title edits", async () => {
    render(<CreateIssueModal {...defaultProps} />);

    const titleBox = await screen.findByRole("textbox", {
      name: "Issue title",
    });
    setEditableValue(titleBox, "Custom title");

    fireEvent.change(await screen.findByLabelText("Issue template"), {
      target: { value: "template-1" },
    });

    expect(titleBox.textContent).toBe("Custom title");
    expect(
      screen.getByRole("textbox", { name: "Issue description" }).textContent,
    ).toBe("Steps to reproduce");
    expect(screen.getByRole("button", { name: "Priority" })).toHaveTextContent(
      "High",
    );
    expect(screen.getByRole("button", { name: "Status" })).toHaveTextContent(
      "In Progress",
    );
    expect(screen.getByRole("button", { name: "Project" })).toHaveTextContent(
      "Roadmap",
    );
  });

  it("loads team-scoped issue templates for the active team", async () => {
    render(<CreateIssueModal {...defaultProps} />);

    await screen.findByLabelText("Issue template");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/issue-templates?teamKey=ENG",
    );
  });

  it("includes a default cycle when creating from a cycle context", async () => {
    render(
      <CreateIssueModal
        {...defaultProps}
        defaultCycleId="cycle-1"
        defaultCycleName="Cycle 1"
      />,
    );

    expect(await screen.findByLabelText("Cycle Cycle 1")).toBeInTheDocument();

    const titleBox = screen.getByRole("textbox", { name: "Issue title" });
    setEditableValue(titleBox, "Cycle-scoped issue");
    fireEvent.click(screen.getByText("Create Issue"));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/issues",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"cycleId":"cycle-1"'),
        }),
      );
    });
  });

  it("creates an issue with selected assignee, project, labels, and create more", async () => {
    const onCreated = vi.fn();
    render(<CreateIssueModal {...defaultProps} onCreated={onCreated} />);

    const titleBox = await screen.findByRole("textbox", {
      name: "Issue title",
    });
    const descriptionBox = screen.getByRole("textbox", {
      name: "Issue description",
    });
    setEditableValue(titleBox, "QA modal issue");
    setEditableValue(descriptionBox, "Details");

    fireEvent.click(screen.getByRole("button", { name: "Assignee" }));
    fireEvent.click(await screen.findByText("Jaeyun Ha"));

    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    fireEvent.click(await screen.findByText("Roadmap"));

    fireEvent.click(screen.getByRole("button", { name: "Labels" }));
    fireEvent.click(await screen.findByText("Bug"));

    fireEvent.click(screen.getByLabelText("Attach files"));
    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    fireEvent.click(screen.getByLabelText("Create more"));
    fireEvent.click(screen.getByText("Create Issue"));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1);
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/issues",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"title":"QA modal issue"'),
      }),
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/issues/issue-1/comments",
      expect.objectContaining({ method: "POST" }),
    );
    expect(titleBox.textContent).toBe("");
  });

  it("creates an issue with cycle, estimate, due date, template, and relation metadata", async () => {
    render(<CreateIssueModal {...defaultProps} />);

    const titleBox = await screen.findByRole("textbox", {
      name: "Issue title",
    });
    setEditableValue(titleBox, "Metadata issue");

    fireEvent.click(screen.getByRole("button", { name: "Cycle" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cycle 1" }));

    fireEvent.click(screen.getByRole("button", { name: "Estimate" }));
    fireEvent.click(await screen.findByRole("button", { name: "3 points" }));

    fireEvent.click(screen.getByRole("button", { name: "Due date" }));
    fireEvent.change(await screen.findByLabelText("Custom due date"), {
      target: { value: "2026-06-01" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Template" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Bug template" }),
    );

    fireEvent.click(screen.getByLabelText("More actions"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Set parent issue" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /ENG-1 Parent task/ }),
    );

    fireEvent.click(screen.getByLabelText("More actions"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Link related issue" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /ENG-2 Related task/ }),
    );

    fireEvent.click(screen.getByLabelText("More actions"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Subscribe me to updates" }),
    );

    fireEvent.click(screen.getByText("Create Issue"));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/issues",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const createCall = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(
        ([url, init]) => url === "/api/issues" && init?.method === "POST",
      );
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual(
      expect.objectContaining({
        cycleId: "cycle-1",
        estimate: 3,
        dueDate: "2026-06-01",
        parentIssueId: "issue-parent",
        relatedIssueId: "issue-related",
        subscribe: true,
        description: "<p>Steps to reproduce</p>",
        priority: "high",
      }),
    );
  });
});
