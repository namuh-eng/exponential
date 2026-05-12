import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import ProjectUpdatesPage from "@/app/(app)/settings/project-updates/page";
import { afterEach, describe, expect, it } from "vitest";

describe("ProjectUpdatesPage component", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the project updates settings page with empty state", async () => {
    render(<ProjectUpdatesPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.getByText("Project updates")).toBeInTheDocument();
        expect(
          screen.getByText(/Manage how project updates are collected/),
        ).toBeInTheDocument();
        expect(
          screen.getByText("No update configurations"),
        ).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });
});
