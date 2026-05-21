import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));

describe("public homepage route", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a public marketing page with local auth CTAs instead of login form", async () => {
    const { default: Homepage } = await import("@/app/homepage/page");

    render(<Homepage />);

    expect(
      screen.getByRole("heading", {
        name: "Purpose-built for planning and building products",
      }),
    ).toBeDefined();
    expect(
      screen.queryByRole("heading", { name: "Log in to Linear" }),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "Start building" }).getAttribute("href"),
    ).toBe("/signup");
    expect(
      screen
        .getAllByRole("link", { name: "Log in" })
        .every((link) => link.getAttribute("href") === "/login"),
    ).toBe(true);
  });
});
