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
    vi.unstubAllGlobals();
  });

  it("does not hardcode a real GitHub repository or fake star count", async () => {
    vi.stubEnv("NEXT_PUBLIC_EXPONENTIAL_GITHUB_URL", "");
    const { LandingPage } = await import("@/components/landing-page");

    render(await LandingPage());

    expect(screen.queryByRole("link", { name: "github" })).toBeNull();
    expect(screen.getByRole("link", { name: "pricing" })).toHaveAttribute(
      "href",
      "/pricing",
    );
    expect(screen.queryByLabelText("GitHub stars")).toBeNull();
    expect(screen.getByLabelText("Source availability").textContent).toBe(
      "source available",
    );
    expect(document.body.textContent).toContain("$ git clone <your-fork-url>");
    expect(document.body.textContent).not.toContain("github.com/namuh-eng");
    expect(document.body.textContent).not.toContain("14.2k");
  });

  it("shows the configured repository star count from GitHub", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => ({ stargazers_count: 1234 }),
    } as Response);

    vi.stubEnv(
      "NEXT_PUBLIC_EXPONENTIAL_GITHUB_URL",
      "https://github.com/namuh-eng/exponential",
    );
    vi.stubGlobal("fetch", fetchMock);
    const { LandingPage } = await import("@/components/landing-page");

    render(await LandingPage());

    expect(screen.getByRole("link", { name: "github" })).toHaveAttribute(
      "href",
      "https://github.com/namuh-eng/exponential",
    );
    expect(screen.getByLabelText("GitHub stars").textContent).toBe(
      "github stars 1.2k",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/namuh-eng/exponential",
      expect.objectContaining({
        headers: { Accept: "application/vnd.github+json" },
      }),
    );
  });

  it("wires the self-host call to action to the operator guide", async () => {
    vi.stubEnv(
      "NEXT_PUBLIC_EXPONENTIAL_GITHUB_URL",
      "https://github.com/namuh-eng/exponential/tree/main",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue({
        ok: true,
        json: async () => ({ stargazers_count: 4 }),
      } as Response),
    );
    const { LandingPage } = await import("@/components/landing-page");

    render(await LandingPage());

    expect(
      screen.getByRole("link", { name: "open self-host guide" }),
    ).toHaveAttribute(
      "href",
      "https://github.com/namuh-eng/exponential/blob/main/docs/self-hosting.md",
    );
    expect(
      screen.getByRole("link", { name: "view docker compose setup →" }),
    ).toHaveAttribute(
      "href",
      "https://github.com/namuh-eng/exponential/blob/main/docs/self-hosting.md",
    );
  });

  it("does not render GitHub API errors as a star count", async () => {
    vi.stubEnv(
      "NEXT_PUBLIC_EXPONENTIAL_GITHUB_URL",
      "https://github.com/namuh-eng/exponential",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue({
        ok: false,
        json: async () => ({
          message: "Unable to select next GitHub token from pool",
        }),
      } as Response),
    );
    const { LandingPage } = await import("@/components/landing-page");

    render(await LandingPage());

    expect(screen.queryByLabelText("GitHub stars")).toBeNull();
    expect(document.body.textContent).not.toContain(
      "Unable to select next GitHub token from pool",
    );
  });
});
