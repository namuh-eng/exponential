import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import ImportExportPage from "@/app/(app)/settings/import-export/page";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

describe("ImportExportPage component", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        teams: [{ id: "team-1", key: "ENG", name: "Engineering" }],
        imports: [],
        exports: [],
      }),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders actionable import and export controls", async () => {
    render(<ImportExportPage />);

    expect(
      screen.getByText("Loading import/export settings..."),
    ).toBeInTheDocument();

    expect(await screen.findByText("Import & export")).toBeInTheDocument();
    expect(
      screen.getByText(/Move workspace data in and out/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start import" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Request export" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/not implemented/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
  });

  it("requests an export and shows the download from history", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          teams: [{ id: "team-1", key: "ENG", name: "Engineering" }],
          imports: [],
          exports: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          export: {
            id: "export-1",
            type: "export",
            status: "completed",
            createdAt: "2026-05-20T12:00:00.000Z",
            message: "Workspace export completed with 2 issues.",
            rowCount: 2,
            downloadUrl:
              "/api/workspaces/current/import-export/exports/export-1/download",
          },
        }),
      });

    render(<ImportExportPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Request export" }),
    );

    expect(
      await screen.findAllByText("Workspace export completed with 2 issues."),
    ).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      "/api/workspaces/current/import-export/exports/export-1/download",
    );
  });

  it("opens provider picker with CSV, GitHub, and Jira as actionable options", async () => {
    render(<ImportExportPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Start import" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Start import" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /CSV/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /GitHub/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Jira/ })).toBeEnabled();
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
  });

  it("previews CSV validation and starts an import job", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          teams: [{ id: "team-1", key: "ENG", name: "Engineering" }],
          imports: [],
          exports: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          mapping: {
            title: "title",
            description: "description",
            priority: "priority",
            teamKey: "team",
          },
          preview: {
            headers: ["title", "description", "priority", "team"],
            rowCount: 1,
            validCount: 1,
            errorCount: 0,
            rows: [
              { rowNumber: 2, values: { title: "Imported issue" }, errors: [] },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          import: {
            id: "import-1",
            type: "import",
            provider: "csv",
            status: "completed",
            createdAt: "2026-05-20T12:00:00.000Z",
            message: "CSV import completed with 1 issues created.",
            rowCount: 1,
            importedCount: 1,
            errorCount: 0,
          },
        }),
      });

    render(<ImportExportPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Start import" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /CSV/ }));

    const input = screen.getByLabelText("CSV file") as HTMLInputElement;
    const file = new File(
      ["title,description,priority,team\nImported issue,Body,high,ENG"],
      "issues.csv",
      { type: "text/csv" },
    );
    fireEvent.change(input, { target: { files: [file] } });

    expect(
      await screen.findByText("Preview: 1 valid, 0 with errors, 1 total"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start import job" }));

    expect(
      await screen.findAllByText("CSV import completed with 1 issues created."),
    ).toHaveLength(2);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/workspaces/current/import-export",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });
});
