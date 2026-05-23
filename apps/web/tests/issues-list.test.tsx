import { Avatar } from "@/components/avatar";
import { PriorityIcon } from "@/components/icons/priority-icon";
import { StatusIcon } from "@/components/icons/status-icon";
import { IssueRow } from "@/components/issue-row";
import { IssuesGroupHeader } from "@/components/issues-group-header";
import { LabelChip } from "@/components/label-chip";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
});

describe("IssueRow", () => {
  const defaultProps = {
    identifier: "ENG-123",
    title: "Fix login bug",
    priority: 3 as const,
    statusCategory: "started" as const,
    statusColor: "#f2c94c",
    createdAt: "2026-02-15",
  };

  it("renders issue identifier", () => {
    render(<IssueRow {...defaultProps} />);
    expect(screen.getByText("ENG-123")).toBeDefined();
  });

  it("renders issue title", () => {
    render(<IssueRow {...defaultProps} />);
    expect(screen.getByText("Fix login bug")).toBeDefined();
  });

  it("renders priority icon", () => {
    render(<IssueRow {...defaultProps} />);
    const icon = screen.getByRole("img", { name: /medium/i });
    expect(icon).toBeDefined();
  });

  it("renders status icon", () => {
    render(<IssueRow {...defaultProps} />);
    const icon = screen.getByRole("img", { name: /started/i });
    expect(icon).toBeDefined();
  });

  it("renders assignee avatar when provided", () => {
    render(<IssueRow {...defaultProps} assigneeName="John Doe" />);
    expect(screen.getByText("JD")).toBeDefined();
  });

  it("does not render assignee when not provided", () => {
    const { container } = render(<IssueRow {...defaultProps} />);
    expect(container.querySelector("[data-testid='assignee']")).toBeNull();
  });

  it("renders labels when provided", () => {
    render(
      <IssueRow
        {...defaultProps}
        labels={[
          { name: "bug", color: "#ef4444" },
          { name: "frontend", color: "#3b82f6" },
        ]}
      />,
    );
    expect(screen.getByText("bug")).toBeDefined();
    expect(screen.getByText("frontend")).toBeDefined();
  });

  it("renders creation date", () => {
    render(<IssueRow {...defaultProps} />);
    expect(screen.getByText("Feb 15")).toBeDefined();
  });

  it("renders project name when provided", () => {
    render(<IssueRow {...defaultProps} projectName="Roadmap" />);
    expect(screen.getByText("Roadmap")).toBeDefined();
  });

  it("renders as a clickable row", () => {
    render(<IssueRow {...defaultProps} href="/issue/issue-1" />);
    const link = screen.getByRole("link", { name: /eng-123 fix login bug/i });
    expect(link.getAttribute("href")).toBe("/issue/issue-1");
  });
});

describe("IssuesGroupHeader", () => {
  it("renders group name and count", () => {
    render(
      <IssuesGroupHeader
        name="Backlog"
        count={6}
        statusCategory="backlog"
        statusColor="#6b6f76"
      />,
    );
    expect(screen.getByText("Backlog")).toBeDefined();
    expect(screen.getByText("6")).toBeDefined();
  });

  it("renders status icon", () => {
    render(
      <IssuesGroupHeader
        name="In Progress"
        count={3}
        statusCategory="started"
        statusColor="#f2c94c"
      />,
    );
    const icon = screen.getByRole("img", { name: /started/i });
    expect(icon).toBeDefined();
  });

  it("renders add issue button", () => {
    render(
      <IssuesGroupHeader
        name="Backlog"
        count={0}
        statusCategory="backlog"
        statusColor="#6b6f76"
      />,
    );
    const button = screen.getByRole("button", { name: /add issue/i });
    expect(button).toBeDefined();
  });

  it("calls onAddIssue when add issue button is clicked", () => {
    const onAddIssue = vi.fn();
    render(
      <IssuesGroupHeader
        name="Backlog"
        count={0}
        statusCategory="backlog"
        statusColor="#6b6f76"
        onAddIssue={onAddIssue}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add issue/i }));
    expect(onAddIssue).toHaveBeenCalled();
  });
});
