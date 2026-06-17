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

  it("runs the GitHub guided import review and confirmation flow", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/workspaces/current/import-export") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          action?: string;
        };
        if (body.action === "fetch_provider_snapshot") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              import: {
                id: "import-gh-1",
                provider: "github",
                status: "review",
                createdAt: "2026-05-20T12:00:00.000Z",
                message: "GitHub review snapshot fetched with 1 issues.",
              },
              snapshot: {
                totals: { issues: 1, comments: 1, open: 1, closed: 0 },
                repositories: [{ fullName: "namuh-eng/exponential" }],
                issues: [
                  {
                    externalId: "namuh-eng/exponential#7",
                    repository: "namuh-eng/exponential",
                    number: 7,
                    title: "Imported GitHub issue",
                    state: "open",
                    labels: [{ name: "bug" }],
                  },
                ],
              },
            }),
          });
        }
        if (body.action === "confirm_provider_import") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              import: {
                id: "import-gh-1",
                provider: "github",
                status: "completed",
                createdAt: "2026-05-20T12:00:00.000Z",
                message:
                  "GitHub import completed with 1 created, 0 skipped, and 0 failed.",
                importedCount: 1,
                errorCount: 0,
              },
            }),
          });
        }
      }
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
                { id: "state-open", name: "Backlog", category: "backlog" },
                { id: "state-done", name: "Done", category: "done" },
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
    fireEvent.click(screen.getByRole("button", { name: /GitHub/ }));
    fireEvent.change(screen.getByLabelText("GitHub token"), {
      target: { value: "ghp_test" },
    });
    fireEvent.change(screen.getByLabelText("GitHub repositories"), {
      target: { value: "namuh-eng/exponential" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Fetch GitHub issues" }),
    );

    expect(
      await screen.findByText(/Review GitHub snapshot: 1/),
    ).toBeInTheDocument();
    expect(screen.getByText("Imported GitHub issue")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Confirm GitHub import" }),
    );
    expect(
      await screen.findByText(/GitHub import completed with 1 created/),
    ).toBeInTheDocument();
  });

  it("runs the Jira guided importer through preview and confirmation", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (
        url === "/api/workspaces/current/import-export" &&
        init?.method === "POST"
      ) {
        const body = JSON.parse(String(init.body)) as { action: string };
        if (body.action === "configure_jira") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              integrationId: "integration-1",
              displayName: "Jira acme.atlassian.net",
              projects: [{ id: "100", key: "ENG", name: "Engineering" }],
            }),
          });
        }
        if (body.action === "preview_jira_import") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              projects: [{ id: "100", key: "ENG", name: "Engineering" }],
              projectKey: "ENG",
              statusOptions: ["To Do"],
              mapping: { teamId: "team-1", statuses: { "To Do": "state-1" } },
              issues: [
                {
                  id: "10001",
                  key: "ENG-1",
                  title: "Ship importer",
                  status: "To Do",
                  priority: "High",
                  assignee: "Ada",
                  labels: ["migration"],
                  commentCount: 1,
                  sourceUrl: "https://acme.atlassian.net/browse/ENG-1",
                  errors: [],
                },
              ],
            }),
          });
        }
        if (body.action === "start_jira_import") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              import: {
                id: "import-jira-1",
                provider: "jira",
                status: "completed",
                createdAt: "2026-05-20T12:00:00.000Z",
                message:
                  "Jira import completed with 1 created and 0 updated issues.",
                importedCount: 1,
                errorCount: 0,
              },
            }),
          });
        }

        if (body.action === "pause_jira_sync") {
          return Promise.resolve({
            ok: true,
            json: async () => ({ success: true, paused: true }),
          });
        }
      }
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
    fireEvent.click(screen.getByRole("button", { name: /Jira/ }));
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://acme.atlassian.net" },
    });
    fireEvent.change(screen.getByLabelText("Atlassian email"), {
      target: { value: "admin@example.com" },
    });
    fireEvent.change(screen.getByLabelText("API token or PAT"), {
      target: { value: "jira-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect Jira" }));

    expect(await screen.findByText(/Choose a project/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Preview Jira import" }),
    );
    expect(await screen.findByText("ENG-1")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm Jira import" }),
    );

    expect(
      await screen.findByText(/Jira import completed with 1 created/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pause project sync" }));
    expect(
      await screen.findByText("Jira forward sync paused for this project."),
    ).toBeInTheDocument();
  });
});
