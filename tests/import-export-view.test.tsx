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
        teams: [
          {
            id: "team-1",
            key: "ENG",
            name: "Engineering",
            states: [{ id: "state-1", name: "Backlog", category: "unstarted" }],
          },
        ],
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
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/workspaces/exports" && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            export: {
              id: "export-1",
              status: "completed",
              createdAt: "2026-05-20T12:00:00.000Z",
              downloadUrl:
                "/api/workspaces/current/import-export/exports/export-1/download",
            },
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ exports: [], imports: [], teams: [] }),
      });
    });

    render(<ImportExportPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Request export" }),
    );

    expect(
      await screen.findByText("Workspace export is ready to download."),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("link", { name: "Download" }),
    ).toHaveAttribute(
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
    const csvContent =
      "title,description,priority,team\nImported issue,Body,high,ENG";

    // Polyfill Blob/File .text() for jsdom environments that lack it
    if (!Blob.prototype.text) {
      Object.defineProperty(Blob.prototype, "text", {
        configurable: true,
        value() {
          return Promise.resolve(csvContent);
        },
      });
    } else {
      vi.spyOn(Blob.prototype, "text").mockResolvedValue(csvContent);
    }

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/workspaces/imports/preview") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            preview: [
              {
                rowNumber: 2,
                values: { title: "Imported issue" },
                errors: [],
              },
            ],
          }),
        });
      }
      if (url === "/api/workspaces/imports" && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            import: {
              id: "import-1",
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
      }
      // Default: initial load and modal teams fetch
      return Promise.resolve({
        ok: true,
        json: async () => ({
          exports: [],
          imports: [],
          teams: [
            {
              id: "team-1",
              key: "ENG",
              name: "Engineering",
              states: [
                { id: "state-1", name: "Backlog", category: "unstarted" },
              ],
            },
          ],
        }),
      });
    });

    render(<ImportExportPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Start import" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /CSV/ }));

    const input = screen.getByLabelText("CSV file") as HTMLInputElement;
    const file = new File([csvContent], "issues.csv", { type: "text/csv" });
    fireEvent.change(input, { target: { files: [file] } });

    // After mapping step, click "Preview validation"
    fireEvent.click(
      await screen.findByRole("button", { name: "Preview validation" }),
    );

    // Source renders count split across text nodes; match by container text content
    await waitFor(() => {
      const preview = document.querySelector("p");
      const found = Array.from(document.querySelectorAll("p")).some((el) =>
        el.textContent?.replace(/\s+/g, " ").includes("1 valid"),
      );
      expect(found).toBe(true);
    });
    fireEvent.click(screen.getByRole("button", { name: "Start import job" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspaces/imports",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });
});
