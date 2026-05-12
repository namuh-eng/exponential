import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import ImportExportPage from "@/app/(app)/settings/import-export/page";
import { afterEach, describe, expect, it } from "vitest";

describe("ImportExportPage component", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the import & export settings page with empty state", async () => {
    render(<ImportExportPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.getByText("Import & export")).toBeInTheDocument();
        expect(
          screen.getByText(/Migrate data from other tools/),
        ).toBeInTheDocument();
        expect(screen.getByText("Data Management")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });
});
