import {
  DisplayOptionsPanel,
  type DisplayOptionsPanelProps,
  defaultDisplayProperties,
} from "@/components/display-options-panel";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
});

const defaultProps: DisplayOptionsPanelProps = {
  open: true,
  onClose: vi.fn(),
  layout: "list",
  onLayoutChange: vi.fn(),
  groupBy: "status",
  onGroupByChange: vi.fn(),
  subGroupBy: "none",
  onSubGroupByChange: vi.fn(),
  orderBy: "priority",
  onOrderByChange: vi.fn(),
  displayProperties: { ...defaultDisplayProperties },
  onDisplayPropertyToggle: vi.fn(),
  showSubIssues: true,
  onShowSubIssuesToggle: vi.fn(),
  showTriageIssues: false,
  onShowTriageIssuesToggle: vi.fn(),
  showEmptyColumns: false,
  onShowEmptyColumnsToggle: vi.fn(),
  onReset: vi.fn(),
  onSaveAsDefault: vi.fn(),
};

describe("DisplayOptionsPanel", () => {
  it("renders when open", () => {
    render(<DisplayOptionsPanel {...defaultProps} />);
    expect(screen.getByText("Grouping")).toBeDefined();
  });

  it("does not render when closed", () => {
    render(<DisplayOptionsPanel {...defaultProps} open={false} />);
    expect(screen.queryByText("Grouping")).toBeNull();
  });

  it("renders List and Board layout tabs", () => {
    render(<DisplayOptionsPanel {...defaultProps} />);
    expect(screen.getByText("List")).toBeDefined();
    expect(screen.getByText("Board")).toBeDefined();
  });

  it("highlights active layout", () => {
    render(<DisplayOptionsPanel {...defaultProps} />);
    const listBtn = screen.getByText("List").closest("button");
    expect(listBtn?.className).toContain("bg-");
  });

  it("calls onLayoutChange when switching layout", () => {
    const onLayoutChange = vi.fn();
    render(
      <DisplayOptionsPanel {...defaultProps} onLayoutChange={onLayoutChange} />,
    );
    fireEvent.click(screen.getByText("Board"));
    expect(onLayoutChange).toHaveBeenCalledWith("board");
  });

  it("renders grouping selector showing current value", () => {
    render(<DisplayOptionsPanel {...defaultProps} groupBy="status" />);
    const selector = screen.getByTestId("grouping-select");
    expect(selector.textContent).toBe("Status");
  });

  it("calls onGroupByChange when grouping option is selected", () => {
    const onGroupByChange = vi.fn();
    render(
      <DisplayOptionsPanel
        {...defaultProps}
        onGroupByChange={onGroupByChange}
      />,
    );
    fireEvent.click(screen.getByTestId("grouping-select"));
    // "Label" is unique to the groupBy dropdown (not in properties or ordering)
    fireEvent.click(screen.getByText("Label"));
    expect(onGroupByChange).toHaveBeenCalledWith("label");
  });

  it("renders sub-group selector", () => {
    render(<DisplayOptionsPanel {...defaultProps} />);
    expect(screen.getByText("Sub-group")).toBeDefined();
    expect(screen.getByTestId("subgroup-select")).toBeDefined();
  });

  it("calls onSubGroupByChange when sub-group option is selected", () => {
    const onSubGroupByChange = vi.fn();
    render(
      <DisplayOptionsPanel
        {...defaultProps}
        onSubGroupByChange={onSubGroupByChange}
      />,
    );
    fireEvent.click(screen.getByTestId("subgroup-select"));
    const menu = screen.getByTestId("subgroup-select-menu");
    fireEvent.click(within(menu).getByText("Status"));
    expect(onSubGroupByChange).toHaveBeenCalledWith("status");
  });

  it("renders ordering selector showing current value", () => {
    render(<DisplayOptionsPanel {...defaultProps} orderBy="priority" />);
    const selector = screen.getByTestId("ordering-select");
    expect(selector.textContent).toBe("Priority");
  });

  it("calls onOrderByChange when ordering option is selected", () => {
    const onOrderByChange = vi.fn();
    render(
      <DisplayOptionsPanel
        {...defaultProps}
        onOrderByChange={onOrderByChange}
      />,
    );
    fireEvent.click(screen.getByTestId("ordering-select"));
    // "Manual" is unique to the ordering dropdown
    fireEvent.click(screen.getByText("Manual"));
    expect(onOrderByChange).toHaveBeenCalledWith("manual");
  });

  it("renders display property chips", () => {
    render(<DisplayOptionsPanel {...defaultProps} />);
    expect(screen.getByText("ID")).toBeDefined();
    expect(screen.getByText("Assignee")).toBeDefined();
    expect(screen.getByText("Labels")).toBeDefined();
    expect(screen.getByText("Project")).toBeDefined();
    expect(screen.getByText("Due date")).toBeDefined();
    expect(screen.getByText("Milestone")).toBeDefined();
    expect(screen.getByText("Time in status")).toBeDefined();
    expect(screen.getByText("Pull requests")).toBeDefined();
  });

  it("calls onDisplayPropertyToggle when clicking a property", () => {
    const onToggle = vi.fn();
    render(
      <DisplayOptionsPanel
        {...defaultProps}
        onDisplayPropertyToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByTestId("property-project"));
    expect(onToggle).toHaveBeenCalledWith("project");
  });

  it("renders Show sub-issues toggle", () => {
    render(<DisplayOptionsPanel {...defaultProps} />);
    expect(screen.getByText("Show sub-issues")).toBeDefined();
  });

  it("renders Show triage issues toggle", () => {
    render(<DisplayOptionsPanel {...defaultProps} />);
    expect(screen.getByText("Show triage issues")).toBeDefined();
  });

  it("renders Board options section with Show empty columns", () => {
    render(<DisplayOptionsPanel {...defaultProps} />);
    expect(screen.getByText("Board options")).toBeDefined();
    expect(screen.getByText("Show empty columns")).toBeDefined();
  });

  it("renders Reset button and calls onReset", () => {
    const onReset = vi.fn();
    render(<DisplayOptionsPanel {...defaultProps} onReset={onReset} />);
    fireEvent.click(screen.getByText("Reset"));
    expect(onReset).toHaveBeenCalled();
  });

  it("renders Set default button and calls onSaveAsDefault", () => {
    const onSaveAsDefault = vi.fn();
    render(
      <DisplayOptionsPanel
        {...defaultProps}
        onSaveAsDefault={onSaveAsDefault}
      />,
    );
    fireEvent.click(screen.getByText("Set default for everyone"));
    expect(onSaveAsDefault).toHaveBeenCalled();
  });

  it("calls onClose when clicking outside the panel", () => {
    const onClose = vi.fn();
    render(<DisplayOptionsPanel {...defaultProps} onClose={onClose} />);

    fireEvent.mouseDown(document.body);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps only one inline menu open at a time", () => {
    render(<DisplayOptionsPanel {...defaultProps} />);

    fireEvent.click(screen.getByTestId("grouping-select"));
    expect(screen.getByTestId("grouping-select-menu")).toBeDefined();

    fireEvent.click(screen.getByTestId("subgroup-select"));

    expect(screen.queryByTestId("grouping-select-menu")).toBeNull();
    expect(screen.getByTestId("subgroup-select-menu")).toBeDefined();
  });
});

describe("defaultDisplayProperties", () => {
  it("has expected enabled properties", () => {
    expect(defaultDisplayProperties.id).toBe(true);
    expect(defaultDisplayProperties.status).toBe(true);
    expect(defaultDisplayProperties.assignee).toBe(true);
    expect(defaultDisplayProperties.priority).toBe(true);
    expect(defaultDisplayProperties.project).toBe(true);
    expect(defaultDisplayProperties.labels).toBe(true);
    expect(defaultDisplayProperties.dueDate).toBe(true);
    expect(defaultDisplayProperties.created).toBe(true);
  });

  it("has expected disabled properties", () => {
    expect(defaultDisplayProperties.timeInStatus).toBe(false);
    expect(defaultDisplayProperties.pullRequests).toBe(false);
    expect(defaultDisplayProperties.links).toBe(false);
    expect(defaultDisplayProperties.updated).toBe(false);
    expect(defaultDisplayProperties.milestone).toBe(false);
  });
});
