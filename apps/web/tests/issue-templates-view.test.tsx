import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import IssueTemplatesPage from "@/app/(app)/settings/issue-templates/page";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

describe("IssueTemplatesPage component", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ templates: [] }),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
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

  it("shows a load error when templates cannot be fetched", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "boom" }),
    });

    render(<IssueTemplatesPage />);

    expect(
      await screen.findByText("Unable to load issue templates."),
    ).toBeInTheDocument();
  });

  it("opens a creation dialog from the empty-state CTA", async () => {
    render(<IssueTemplatesPage />);

    fireEvent.click(await screen.findByText("Create template"));

    expect(
      screen.getByRole("dialog", { name: "Create issue template" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Template name")).toBeInTheDocument();
    expect(screen.getByLabelText("Issue description")).toBeInTheDocument();
  });

  it("validates, saves, and renders a created issue template", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ templates: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          template: {
            id: "template-1",
            name: "Bug report",
            description: "Steps to reproduce\nExpected result\nActual result",
            createdAt: "2026-05-13T00:00:00.000Z",
          },
        }),
      });

    render(<IssueTemplatesPage />);

    fireEvent.click(await screen.findByText("Create template"));
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));

    expect(
      await screen.findByText("Template name is required."),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Template name"), {
      target: { value: "Bug report" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));

    expect(
      await screen.findByText("Issue description is required."),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Issue description"), {
      target: { value: "Steps to reproduce\nExpected result\nActual result" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));

    expect(await screen.findByText("Bug report")).toBeInTheDocument();
    expect(screen.getByText(/Steps to reproduce/)).toBeInTheDocument();
    expect(screen.queryByText("No templates")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/issue-templates",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("keeps the dialog open and shows an error when saving fails", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ templates: [] }),
      })
      .mockRejectedValueOnce(new Error("offline"));

    render(<IssueTemplatesPage />);

    fireEvent.click(await screen.findByText("Create template"));
    fireEvent.change(screen.getByLabelText("Template name"), {
      target: { value: "Bug report" },
    });
    fireEvent.change(screen.getByLabelText("Issue description"), {
      target: { value: "Steps to reproduce" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));

    expect(
      await screen.findByText("Failed to create issue template."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Create issue template" }),
    ).toBeInTheDocument();
  });
});
