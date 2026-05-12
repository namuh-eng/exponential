import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import DocumentsSettingsPage from "@/app/(app)/settings/documents/page";
import { afterEach, describe, expect, it } from "vitest";

describe("DocumentsSettingsPage component", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the documents settings page with empty state", async () => {
    render(<DocumentsSettingsPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.getByText("Documents")).toBeInTheDocument();
        expect(
          screen.getByText(/Configure document templates/),
        ).toBeInTheDocument();
        expect(screen.getByText("No documents yet")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });
});
