import { readFileSync } from "node:fs";
import { Avatar } from "@/components/avatar";
import { PriorityIcon } from "@/components/icons/priority-icon";
import { StatusIcon } from "@/components/icons/status-icon";
import { LabelChip } from "@/components/label-chip";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => {
  cleanup();
});

describe("PriorityIcon", () => {
  it("renders urgent priority with correct label", () => {
    render(<PriorityIcon priority={1} />);
    const icon = screen.getByRole("img", { name: /urgent/i });
    expect(icon).toBeDefined();
  });

  it("renders high priority with correct label", () => {
    render(<PriorityIcon priority={2} />);
    const icon = screen.getByRole("img", { name: /high/i });
    expect(icon).toBeDefined();
  });

  it("renders medium priority with correct label", () => {
    render(<PriorityIcon priority={3} />);
    const icon = screen.getByRole("img", { name: /medium/i });
    expect(icon).toBeDefined();
  });

  it("renders low priority with correct label", () => {
    render(<PriorityIcon priority={4} />);
    const icon = screen.getByRole("img", { name: /low/i });
    expect(icon).toBeDefined();
  });

  it("renders no priority with correct label", () => {
    render(<PriorityIcon priority={0} />);
    const icon = screen.getByRole("img", { name: /no priority/i });
    expect(icon).toBeDefined();
  });

  it("applies custom size", () => {
    const { container } = render(<PriorityIcon priority={1} size={20} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("20");
    expect(svg?.getAttribute("height")).toBe("20");
  });

  it("applies custom className", () => {
    const { container } = render(
      <PriorityIcon priority={1} className="custom-class" />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.classList.contains("custom-class")).toBe(true);
  });

  it("matches Linear's high priority bar ordering", () => {
    const { container } = render(<PriorityIcon priority={2} />);
    const rects = [...container.querySelectorAll("rect")];

    expect(
      rects.map((rect) => ({
        x: rect.getAttribute("x"),
        y: rect.getAttribute("y"),
        height: rect.getAttribute("height"),
        fillOpacity: rect.getAttribute("fill-opacity"),
      })),
    ).toEqual([
      { x: "1.5", y: "8", height: "6", fillOpacity: null },
      { x: "6.5", y: "5", height: "9", fillOpacity: "1" },
      { x: "11.5", y: "2", height: "12", fillOpacity: "1" },
    ]);
  });

  it("matches Linear's low priority opacity treatment", () => {
    const { container } = render(<PriorityIcon priority={4} />);
    const rects = [...container.querySelectorAll("rect")];

    expect(rects[1]?.getAttribute("fill-opacity")).toBe("0.4");
    expect(rects[2]?.getAttribute("fill-opacity")).toBe("0.4");
  });
});

describe("StatusIcon", () => {
  it("renders backlog status", () => {
    render(<StatusIcon category="backlog" />);
    const icon = screen.getByRole("img", { name: /backlog/i });
    expect(icon).toBeDefined();
  });

  it("renders unstarted status", () => {
    render(<StatusIcon category="unstarted" />);
    const icon = screen.getByRole("img", { name: /unstarted/i });
    expect(icon).toBeDefined();
  });

  it("renders started status", () => {
    render(<StatusIcon category="started" />);
    const icon = screen.getByRole("img", { name: /started/i });
    expect(icon).toBeDefined();
  });

  it("renders completed status", () => {
    render(<StatusIcon category="completed" />);
    const icon = screen.getByRole("img", { name: /completed/i });
    expect(icon).toBeDefined();
  });

  it("renders canceled status", () => {
    render(<StatusIcon category="canceled" />);
    const icon = screen.getByRole("img", { name: /canceled/i });
    expect(icon).toBeDefined();
  });

  it("renders triage status", () => {
    render(<StatusIcon category="triage" />);
    const icon = screen.getByRole("img", { name: /triage/i });
    expect(icon).toBeDefined();
  });

  it("applies custom color", () => {
    const { container } = render(
      <StatusIcon category="started" color="#ff0000" />,
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeDefined();
  });

  it("applies custom size", () => {
    const { container } = render(<StatusIcon category="backlog" size={20} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("20");
    expect(svg?.getAttribute("height")).toBe("20");
  });

  it("uses the Linear backlog symbol path instead of a dashed circle", () => {
    const { container } = render(<StatusIcon category="backlog" />);
    const path = container.querySelector("path");

    expect(path?.getAttribute("d")).toContain("m14.94 8.914");
    expect(container.querySelector("circle")).toBeNull();
  });

  it("uses the Linear triage symbol path", () => {
    const { container } = render(<StatusIcon category="triage" />);
    const path = container.querySelector("path");

    expect(path?.getAttribute("d")).toContain("M8 15A7 7 0 1 0 8 1");
    expect(path?.getAttribute("d")).toContain("L3.174 8.372");
  });
});

describe("Avatar", () => {
  it("renders initials when no image is provided", () => {
    render(<Avatar name="John Doe" />);
    expect(screen.getByText("JD")).toBeDefined();
  });

  it("renders single initial for single name", () => {
    render(<Avatar name="Alice" />);
    expect(screen.getByText("A")).toBeDefined();
  });

  it("renders image when src is provided", () => {
    render(<Avatar name="John Doe" src="/avatar.png" />);
    const img = screen.getByRole("img");
    expect(img).toBeDefined();
  });

  it("falls back to initials when the image fails to load", () => {
    render(<Avatar name="John Doe" src="/missing-avatar.png" />);

    const img = screen.getByRole("img");
    fireEvent.error(img);

    expect(screen.getByText("JD")).toBeDefined();
  });

  it("applies default size of 20px", () => {
    const { container } = render(<Avatar name="Test" />);
    const avatar = container.firstElementChild;
    expect(avatar?.classList.contains("h-5")).toBe(true);
    expect(avatar?.classList.contains("w-5")).toBe(true);
  });

  it("applies small size", () => {
    const { container } = render(<Avatar name="Test" size="sm" />);
    const avatar = container.firstElementChild;
    expect(avatar?.classList.contains("h-4")).toBe(true);
    expect(avatar?.classList.contains("w-4")).toBe(true);
  });

  it("applies large size", () => {
    const { container } = render(<Avatar name="Test" size="lg" />);
    const avatar = container.firstElementChild;
    expect(avatar?.classList.contains("h-8")).toBe(true);
    expect(avatar?.classList.contains("w-8")).toBe(true);
  });

  it("applies custom className", () => {
    const { container } = render(
      <Avatar name="Test" className="custom-class" />,
    );
    const avatar = container.firstElementChild;
    expect(avatar?.classList.contains("custom-class")).toBe(true);
  });
});

describe("LabelChip", () => {
  it("renders label text", () => {
    render(<LabelChip name="bug" color="#ef4444" />);
    expect(screen.getByText("bug")).toBeDefined();
  });

  it("renders colored dot", () => {
    const { container } = render(<LabelChip name="feature" color="#22c55e" />);
    const dot = container.querySelector("[data-testid='label-dot']");
    expect(dot).toBeDefined();
  });

  it("applies custom className", () => {
    const { container } = render(
      <LabelChip name="bug" color="#ef4444" className="custom-class" />,
    );
    const chip = container.firstElementChild;
    expect(chip?.classList.contains("custom-class")).toBe(true);
  });

  it("renders multiple labels side by side", () => {
    render(
      <div>
        <LabelChip name="bug" color="#ef4444" />
        <LabelChip name="frontend" color="#3b82f6" />
      </div>,
    );
    expect(screen.getByText("bug")).toBeDefined();
    expect(screen.getByText("frontend")).toBeDefined();
  });

  it("preserves long label text in the title while truncating the visible chip", () => {
    const longName =
      "platform-foundations-design-token-regression-validation-label";
    const { container } = render(
      <div className="w-24">
        <LabelChip name={longName} color="#3b82f6" />
      </div>,
    );

    const chip = container.querySelector("span[title]");
    const text = chip?.querySelector("span:last-child");

    expect(chip?.getAttribute("title")).toBe(longName);
    expect(text?.classList.contains("truncate")).toBe(true);
  });
});

describe("Design tokens", () => {
  it("defines the product accent through Editorial theme tokens", () => {
    const globalsCss = readFileSync("src/app/globals.css", "utf8");
    const editorialCss = readFileSync("src/app/editorial-theme.css", "utf8");

    expect(editorialCss).toContain("--editorial-accent: oklch(0.56 0.16 32);");
    expect(editorialCss).toContain("--color-accent: var(--editorial-accent);");
    expect(globalsCss).toContain("--auth-prompt: #7180ff;");
  });
});
