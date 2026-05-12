import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import IssueTemplatesPage from "@/app/(app)/settings/issue-templates/page";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("IssueTemplatesPage component", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the issue templates page with empty state", async () => {
    render(<IssueTemplatesPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.getByText("Issue templates")).toBeInTheDocument();
        expect(
          screen.getByText(/Create and manage reusable templates/),
        ).toBeInTheDocument();
        expect(screen.getByText("No templates")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });
});
