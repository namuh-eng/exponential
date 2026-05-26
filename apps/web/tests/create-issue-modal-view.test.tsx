import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CreateIssueModal } from "@/components/create-issue-modal";

const mockOptions = {
  team: { id: "team-1", name: "Engineering", key: "ENG" },
  statuses: [
    { id: "s1", name: "Backlog", category: "backlog", color: "#999" },
    { id: "s2", name: "Todo", category: "unstarted", color: "#888" },
  ],
  priorities: [
    { value: "none", label: "No priority" },
    { value: "urgent", label: "Urgent" },
    { value: "high", label: "High" },
  ],
  assignees: [{ id: "u1", name: "Ashley", image: null }],
  labels: [{ id: "l1", name: "Bug", color: "#f00" }],
  projects: [{ id: "p1", name: "Agent Speed", icon: "⚡" }],
};

describe("CreateIssueModal UI", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    teamKey: "ENG",
    teamName: "Engineering",
    teamId: "team-1",
  };

  it("renders the modal and loads options", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockOptions,
    } as Response);

    render(<CreateIssueModal {...defaultProps} />);

    expect(
      screen.getByLabelText("Create issue for Engineering"),
    ).toBeInTheDocument();
    expect(screen.getByText("New issue")).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/teams/ENG/create-issue-options",
      );
    });
  });

  it("submits a new issue", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockOptions,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "iss-123" }),
      } as Response);

    const onCreatedMock = vi.fn();
    render(<CreateIssueModal {...defaultProps} onCreated={onCreatedMock} />);

    await screen.findByText("Backlog");

    const titleInput = screen.getByLabelText("Issue title");
    titleInput.textContent = "New test issue";
    fireEvent.input(titleInput);

    const descInput = screen.getByLabelText("Issue description");
    descInput.textContent = "A simple description";
    fireEvent.input(descInput);

    fireEvent.click(screen.getByRole("button", { name: "Create Issue" }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/issues",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"title":"New test issue"'),
        }),
      );
    });

    expect(onCreatedMock).toHaveBeenCalled();
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("toggles creating more issues", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockOptions,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "iss-123" }),
      } as Response);

    render(<CreateIssueModal {...defaultProps} />);

    await screen.findByText("Backlog");

    const createMoreCheckbox = screen.getByLabelText("Create more");
    fireEvent.click(createMoreCheckbox);

    const titleInput = screen.getByLabelText("Issue title");
    titleInput.textContent = "Multi issue 1";
    fireEvent.input(titleInput);

    fireEvent.click(screen.getByRole("button", { name: "Create Issue" }));

    await waitFor(() => {
      expect(titleInput.textContent).toBe("");
    });

    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });

  it("selects status and priority from toolbar", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockOptions,
    } as Response);

    render(<CreateIssueModal {...defaultProps} />);

    await screen.findByText("Backlog");

    // Change status
    fireEvent.click(screen.getByRole("button", { name: "Status" }));
    const todoOption = await screen.findByRole("button", { name: "Todo" });
    fireEvent.click(todoOption);
    expect(
      screen.queryByRole("button", { name: "Todo" }),
    ).not.toBeInTheDocument(); // Menu closed
    expect(screen.getByRole("button", { name: "Status" })).toHaveTextContent(
      "Todo",
    );

    // Change priority
    fireEvent.click(screen.getByRole("button", { name: "Priority" }));
    const urgentOption = await screen.findByRole("button", { name: "Urgent" });
    fireEvent.click(urgentOption);
    expect(screen.getByRole("button", { name: "Priority" })).toHaveTextContent(
      "Urgent",
    );
  });
});
