import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import DocumentsSettingsPage from "@/app/(app)/settings/documents/page";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const documentsPayload = {
  documents: {
    defaultVisibility: "workspace",
    autoLinkProjectDocuments: true,
    templates: [
      {
        id: "template-1",
        name: "Product spec",
        description: "Use for RFCs and launch plans",
      },
    ],
  },
};

describe("DocumentsSettingsPage component", () => {
  beforeEach(() => {
    global.fetch = vi.fn(async (input, init) => {
      if (init?.method === "POST") {
        return new Response(
          JSON.stringify({
            documents: {
              ...documentsPayload.documents,
              templates: [
                {
                  id: "template-2",
                  name: "Decision record",
                  description: "Capture context and trade-offs",
                },
                ...documentsPayload.documents.templates,
              ],
            },
          }),
          { status: 201 },
        );
      }

      if (init?.method === "PATCH") {
        return new Response(
          JSON.stringify({
            documents: {
              ...documentsPayload.documents,
              defaultVisibility: "private",
            },
          }),
          { status: 200 },
        );
      }

      expect(input).toBe("/api/workspaces/current/documents");
      return new Response(JSON.stringify(documentsPayload), { status: 200 });
    }) as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders configurable document settings and existing templates", async () => {
    render(<DocumentsSettingsPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    expect(await screen.findByText("Documents")).toBeInTheDocument();
    expect(
      screen.getByText(/Configure document templates/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Default document visibility")).toHaveValue(
      "workspace",
    );
    expect(screen.getByLabelText(/Auto-link project documents/)).toBeChecked();
    expect(screen.getByText("Product spec")).toBeInTheDocument();
    expect(
      screen.getByText("Use for RFCs and launch plans"),
    ).toBeInTheDocument();
  });

  it("persists workspace document defaults", async () => {
    render(<DocumentsSettingsPage />);
    const visibility = await screen.findByLabelText(
      "Default document visibility",
    );

    fireEvent.change(visibility, { target: { value: "private" } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/workspaces/current/documents",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ defaultVisibility: "private" }),
        }),
      );
      expect(screen.getByRole("status")).toHaveTextContent(
        "Document settings saved.",
      );
    });
  });

  it("creates a document template", async () => {
    render(<DocumentsSettingsPage />);
    await screen.findByText("Product spec");

    fireEvent.change(screen.getByLabelText("Template name"), {
      target: { value: "Decision record" },
    });
    fireEvent.change(screen.getByLabelText("Template description"), {
      target: { value: "Capture context and trade-offs" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create document template" }),
    );

    expect(await screen.findByText("Decision record")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Document template created.",
    );
  });
});
