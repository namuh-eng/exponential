import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

import CreateWorkspacePage from "@/app/create-workspace/page";

describe("Create Workspace page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the page title and description", () => {
    render(<CreateWorkspacePage />);
    expect(screen.getByText("Create your workspace")).toBeDefined();
    expect(
      screen.getByText(/Workspaces are shared environments/),
    ).toBeDefined();
  });

  it("renders workspace name and URL inputs", () => {
    render(<CreateWorkspacePage />);
    expect(screen.getByLabelText("Workspace name")).toBeDefined();
    expect(screen.getByLabelText("Workspace URL")).toBeDefined();
  });

  it("auto-generates URL slug from workspace name", () => {
    render(<CreateWorkspacePage />);
    const nameInput = screen.getByLabelText("Workspace name");
    fireEvent.change(nameInput, { target: { value: "My Cool Team" } });

    const urlInput = screen.getByLabelText("Workspace URL") as HTMLInputElement;
    expect(urlInput.value).toBe("my-cool-team");
  });

  it("sanitizes special characters in auto-generated slug", () => {
    render(<CreateWorkspacePage />);
    const nameInput = screen.getByLabelText("Workspace name");
    fireEvent.change(nameInput, {
      target: { value: "Hello! @World #123" },
    });

    const urlInput = screen.getByLabelText("Workspace URL") as HTMLInputElement;
    expect(urlInput.value).toBe("hello-world-123");
  });

  it("truncates auto-generated slugs to the supported maximum length", () => {
    render(<CreateWorkspacePage />);
    const nameInput = screen.getByLabelText("Workspace name");

    fireEvent.change(nameInput, {
      target: { value: "workspace-".repeat(10) },
    });

    const urlInput = screen.getByLabelText("Workspace URL") as HTMLInputElement;
    expect(urlInput.value).toHaveLength(63);
    expect(urlInput.value).toBe(
      "workspace-workspace-workspace-workspace-workspace-workspace-wor",
    );
  });

  it("allows manual editing of the URL slug", () => {
    render(<CreateWorkspacePage />);
    const urlInput = screen.getByLabelText("Workspace URL");
    fireEvent.change(urlInput, { target: { value: "custom-slug" } });
    expect((urlInput as HTMLInputElement).value).toBe("custom-slug");
  });

  it("renders the Linear logo", () => {
    render(<CreateWorkspacePage />);
    expect(screen.getByLabelText("Linear logo")).toBeDefined();
  });

  it("disables submit button when fields are empty", () => {
    render(<CreateWorkspacePage />);
    const button = screen.getByRole("button", { name: "Create workspace" });
    expect(button).toHaveProperty("disabled", true);
  });

  it("enables submit button when both fields are filled", () => {
    render(<CreateWorkspacePage />);
    fireEvent.change(screen.getByLabelText("Workspace name"), {
      target: { value: "Test Team" },
    });
    const button = screen.getByRole("button", { name: "Create workspace" });
    expect(button).toHaveProperty("disabled", false);
  });

  it("submits the form and redirects on success", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          workspace: { id: "ws-1", urlSlug: "test-team" },
          team: { id: "t-1", key: "TES" },
        }),
    });
    globalThis.fetch = mockFetch;

    render(<CreateWorkspacePage />);
    fireEvent.change(screen.getByLabelText("Workspace name"), {
      target: { value: "Test Team" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Test Team", urlSlug: "test-team" }),
      });
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        "/onboarding/invite?workspaceId=ws-1&teamKey=TES",
      );
    });
  });

  it("displays error message on API failure", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "This URL is already taken" }),
    });
    globalThis.fetch = mockFetch;

    render(<CreateWorkspacePage />);
    fireEvent.change(screen.getByLabelText("Workspace name"), {
      target: { value: "Test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

    await waitFor(() => {
      expect(screen.getByText("This URL is already taken")).toBeDefined();
    });
  });

  it("clears the error message when the user edits the form", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: "This URL is already taken" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            workspace: { id: "ws-1", urlSlug: "updated-workspace" },
            team: { id: "t-1", key: "UPD" },
          }),
      });
    globalThis.fetch = mockFetch;

    render(<CreateWorkspacePage />);
    fireEvent.change(screen.getByLabelText("Workspace name"), {
      target: { value: "Test Workspace" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

    await waitFor(() => {
      expect(screen.getByText("This URL is already taken")).toBeDefined();
    });

    fireEvent.change(screen.getByLabelText("Workspace name"), {
      target: { value: "Updated Workspace" },
    });

    expect(screen.queryByText("This URL is already taken")).toBeNull();
  });

  it("applies browser max lengths that match the API limits", () => {
    render(<CreateWorkspacePage />);

    expect(
      screen.getByLabelText("Workspace name").getAttribute("maxLength"),
    ).toBe("255");
    expect(
      screen.getByLabelText("Workspace URL").getAttribute("maxLength"),
    ).toBe("63");
  });

  it("shows loading state during submission", async () => {
    const mockFetch = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () => resolve({ ok: true, json: () => Promise.resolve({}) }),
            100,
          );
        }),
    );
    globalThis.fetch = mockFetch;

    render(<CreateWorkspacePage />);
    fireEvent.change(screen.getByLabelText("Workspace name"), {
      target: { value: "Test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

    expect(screen.getByText("Creating...")).toBeDefined();
  });

  it("displays the linear.app/ prefix in URL field", () => {
    render(<CreateWorkspacePage />);
    expect(screen.getByText("linear.app/")).toBeDefined();
  });
});
