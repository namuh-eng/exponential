import { IssueProperties } from "@/components/issue-properties";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
});

describe("IssueProperties", () => {
  const defaultProps = {
    status: {
      id: "state-1",
      name: "Research Needed",
      category: "backlog" as const,
      color: "#6b6f76",
    },
    priority: "medium" as const,
    assignee: { id: "user-1", name: "Jaeyun Ha", image: null },
    labels: [{ id: "1", name: "agent", color: "#6b7280" }],
    project: null,
    options: {
      statuses: [
        {
          id: "state-1",
          name: "Research Needed",
          category: "backlog" as const,
          color: "#6b6f76",
        },
        {
          id: "state-2",
          name: "In Progress",
          category: "started" as const,
          color: "#00f",
        },
      ],
      priorities: [
        { value: "medium" as const, label: "Medium" },
        { value: "high" as const, label: "High" },
      ],
      assignees: [{ id: "user-1", name: "Jaeyun Ha", image: null }],
      labels: [
        { id: "1", name: "agent", color: "#6b7280" },
        { id: "2", name: "bug", color: "#ef4444" },
      ],
      projects: [{ id: "project-1", name: "Chrome Extension", icon: "🌐" }],
      cycles: [{ id: "cycle-1", name: "Cycle 1", number: 1 }],
      estimates: [{ value: 3, label: "3 points" }],
    },
  };

  it("renders status property", () => {
    render(<IssueProperties {...defaultProps} />);
    expect(screen.getByText("Research Needed")).toBeDefined();
  });

  it("renders priority property", () => {
    render(<IssueProperties {...defaultProps} />);
    expect(screen.getByText("Medium")).toBeDefined();
  });

  it("renders assignee name", () => {
    render(<IssueProperties {...defaultProps} />);
    expect(screen.getByText("Jaeyun Ha")).toBeDefined();
  });

  it("renders labels", () => {
    render(<IssueProperties {...defaultProps} />);
    expect(screen.getByText("agent")).toBeDefined();
  });

  it("renders status icon", () => {
    render(<IssueProperties {...defaultProps} />);
    const icon = screen.getByRole("img", { name: /backlog/i });
    expect(icon).toBeDefined();
  });

  it("renders priority icon", () => {
    render(<IssueProperties {...defaultProps} />);
    const icon = screen.getByRole("img", { name: /medium/i });
    expect(icon).toBeDefined();
  });

  it("shows 'No assignee' when assignee is null", () => {
    render(<IssueProperties {...defaultProps} assignee={null} />);
    expect(screen.getByText("No assignee")).toBeDefined();
  });

  it("shows 'Add to project' when project is null", () => {
    render(<IssueProperties {...defaultProps} />);
    expect(screen.getByText("Add to project")).toBeDefined();
  });

  it("renders project name when provided", () => {
    render(
      <IssueProperties
        {...defaultProps}
        project={{ id: "project-1", name: "Chrome Extension", icon: "🌐" }}
      />,
    );
    expect(screen.getByText("Chrome Extension")).toBeDefined();
  });

  it("renders property labels (Status, Priority, Assignee, Labels, Project)", () => {
    render(<IssueProperties {...defaultProps} />);
    expect(screen.getByText("Status")).toBeDefined();
    expect(screen.getByText("Priority")).toBeDefined();
    expect(screen.getByText("Assignee")).toBeDefined();
    expect(screen.getByText("Labels")).toBeDefined();
    expect(screen.getByText("Project")).toBeDefined();
  });

  it("opens editable status selector and emits state updates", async () => {
    const onUpdateIssue = vi.fn();

    render(
      <IssueProperties
        {...defaultProps}
        editable
        onUpdateIssue={onUpdateIssue}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /edit status/i }));
    fireEvent.click(screen.getByRole("button", { name: /in progress/i }));

    await waitFor(() => {
      expect(onUpdateIssue).toHaveBeenCalledWith({ stateId: "state-2" });
    });
  });

  it("opens editable metadata controls for optional fields", () => {
    render(
      <IssueProperties
        {...defaultProps}
        editable
        dueDate={null}
        estimate={null}
        cycle={null}
        onUpdateIssue={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: /edit priority/i }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /edit assignee/i }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: /edit labels/i })).toBeDefined();
    expect(
      screen.getByRole("button", { name: /edit due date/i }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /edit estimate/i }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: /edit cycle/i })).toBeDefined();
    expect(
      screen.getByRole("button", { name: /edit parent issue/i }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: /edit project/i })).toBeDefined();
  });
});
