import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import ApplicationsSettingsPage from "@/app/(app)/settings/applications/page";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/app-shell", () => ({
  useAppShellContext: () => ({ workspaceSlug: "foreverbrowsing" }),
}));

describe("ApplicationsSettingsPage component", () => {
  afterEach(() => {
    cleanup();
  });

  it("links the empty CTA to the slug-prefixed integrations settings page", async () => {
    render(<ApplicationsSettingsPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.getByText("Applications")).toBeInTheDocument();
        expect(
          screen.getByText(/Manage third-party applications/),
        ).toBeInTheDocument();
        expect(screen.getByText("No applications")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    expect(
      screen.getByRole("link", { name: "Explore integrations" }),
    ).toHaveAttribute("href", "/foreverbrowsing/settings/integrations");
  });
});
