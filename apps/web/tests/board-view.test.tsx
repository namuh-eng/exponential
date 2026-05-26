import { BoardColumn } from "@/components/board-column";
import { defaultDisplayProperties } from "@/components/display-options-panel";
import { IssueCard } from "@/components/issue-card";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
});

describe("IssueCard", () => {
  const defaultProps = {
    identifier: "ENG-116",
    title: "Add JS event listener detection for bare-div interactive elements",
    priority: 3 as const,
    statusCategory: "backlog" as const,
    statusColor: "#6b6f76",
    createdAt: "2026-02-27",
  };

  it("renders issue identifier", () => {
    render(<IssueCard {...defaultProps} />);
    expect(screen.getByText("ENG-116")).toBeDefined();
  });

  it("renders issue title", () => {
    render(<IssueCard {...defaultProps} />);
    expect(
      screen.getByText(
        "Add JS event listener detection for bare-div interactive elements",
      ),
    ).toBeDefined();
  });

  it("renders priority icon", () => {
    render(<IssueCard {...defaultProps} />);
    const icon = screen.getByRole("img", { name: /medium/i });
    expect(icon).toBeDefined();
  });

  it("renders labels when provided", () => {
    render(
      <IssueCard
        {...defaultProps}
        labels={[
          { name: "extension", color: "#f97316" },
          { name: "agent", color: "#6b7280" },
        ]}
      />,
    );
    expect(screen.getByText("extension")).toBeDefined();
    expect(screen.getByText("agent")).toBeDefined();
  });

  it("renders assignee avatar when provided", () => {
    render(<IssueCard {...defaultProps} assigneeName="Jaeyun Ha" />);
    expect(screen.getByText("JH")).toBeDefined();
  });

  it("renders creation date", () => {
    render(<IssueCard {...defaultProps} />);
    expect(screen.getByText("Feb 27")).toBeDefined();
  });

  it("uses the issue href as an accessible card link", () => {
    render(<IssueCard {...defaultProps} href="/team/ENG/issue/ENG-116" />);

    const link = screen.getByRole("link", {
      name: /ENG-116 Add JS event listener detection/i,
    });
    expect(link).toHaveAttribute("href", "/team/ENG/issue/ENG-116");
    expect(link).toHaveAttribute("data-testid", "issue-card");
  });

  it("does not render assignee when not provided", () => {
    const { container } = render(<IssueCard {...defaultProps} />);
    expect(container.querySelector("[data-testid='card-assignee']")).toBeNull();
  });

  it("hides toggled-off metadata", () => {
    render(
      <IssueCard
        {...defaultProps}
        assigneeName="Jaeyun Ha"
        displayProperties={{
          ...defaultDisplayProperties,
          id: false,
          priority: false,
          created: false,
          assignee: false,
        }}
      />,
    );

    expect(screen.queryByText("ENG-116")).toBeNull();
    expect(screen.queryByText("Feb 27")).toBeNull();
    expect(screen.queryByText("JH")).toBeNull();
    expect(screen.queryByRole("img", { name: /medium/i })).toBeNull();
  });

  it("renders project and due date when enabled", () => {
    render(
      <IssueCard
        {...defaultProps}
        projectName="Platform"
        dueDate="2026-03-01T00:00:00.000Z"
        displayProperties={{ ...defaultDisplayProperties }}
      />,
    );

    expect(screen.getByText("Platform")).toBeDefined();
    expect(screen.getByText("Due Mar 1")).toBeDefined();
  });
});

describe("BoardColumn", () => {
  it("renders column header with name and count", () => {
    render(
      <BoardColumn
        name="Backlog"
        count={6}
        statusCategory="backlog"
        statusColor="#6b6f76"
      >
        <div>child</div>
      </BoardColumn>,
    );
    expect(screen.getByText("Backlog")).toBeDefined();
    expect(screen.getByText("6")).toBeDefined();
  });

  it("renders status icon in header", () => {
    render(
      <BoardColumn
        name="In Progress"
        count={3}
        statusCategory="started"
        statusColor="#f2c94c"
      >
        <div>child</div>
      </BoardColumn>,
    );
    const icon = screen.getByRole("img", { name: /started/i });
    expect(icon).toBeDefined();
  });

  it("renders children (issue cards)", () => {
    render(
      <BoardColumn
        name="Backlog"
        count={1}
        statusCategory="backlog"
        statusColor="#6b6f76"
      >
        <div>Issue card content</div>
      </BoardColumn>,
    );
    expect(screen.getByText("Issue card content")).toBeDefined();
  });

  it("renders add issue button", () => {
    render(
      <BoardColumn
        name="Backlog"
        count={0}
        statusCategory="backlog"
        statusColor="#6b6f76"
      >
        <div>empty</div>
      </BoardColumn>,
    );
    const button = screen.getByRole("button", {
      name: /add issue to backlog/i,
    });
    expect(button).toBeDefined();
    expect(button).toBeDisabled();
  });

  it("calls the add issue handler from the column button", () => {
    const onAddIssue = vi.fn();
    render(
      <BoardColumn
        name="Todo"
        count={0}
        statusCategory="unstarted"
        statusColor="#6b6f76"
        onAddIssue={onAddIssue}
      >
        <div>empty</div>
      </BoardColumn>,
    );

    fireEvent.click(screen.getByRole("button", { name: /add issue to todo/i }));
    expect(onAddIssue).toHaveBeenCalledTimes(1);
  });
});
