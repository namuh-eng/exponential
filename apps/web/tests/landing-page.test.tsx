import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));

describe("landing page", () => {
  afterEach(() => {
    cleanup();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("does not hardcode a real GitHub repository or fake star count", async () => {
    vi.stubEnv("NEXT_PUBLIC_EXPONENTIAL_GITHUB_URL", "");
    const { LandingPage } = await import("@/components/landing-page");

    render(<LandingPage />);

    expect(screen.queryByRole("link", { name: "github" })).toBeNull();
    expect(screen.queryByLabelText("GitHub stars")).toBeNull();
    expect(screen.getByLabelText("Source availability").textContent).toBe(
      "source available",
    );
    expect(document.body.textContent).toContain("$ git clone <your-fork-url>");
    expect(document.body.textContent).not.toContain("github.com/namuh-eng");
    expect(document.body.textContent).not.toContain("14.2k");
  });
});
