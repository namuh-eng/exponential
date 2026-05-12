import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import ProjectTemplatesPage from "@/app/(app)/settings/project-templates/page";
import { afterEach, describe, expect, it } from "vitest";

describe("ProjectTemplatesPage component", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the project templates page with empty state", async () => {
    render(<ProjectTemplatesPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.getByText("Project templates")).toBeInTheDocument();
        expect(
          screen.getByText(/Standardize project structures/),
        ).toBeInTheDocument();
        expect(screen.getByText("No project templates")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });
});
