import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import WorkspaceSettingsPage from "@/app/(app)/settings/workspace/page";

const routerPushMock = vi.fn();
const routerRefreshMock = vi.fn();
const routerReplaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
    refresh: routerRefreshMock,
    replace: routerReplaceMock,
    back: vi.fn(),
  }),
  usePathname: () => "/settings/workspace",
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

class MockFileReader {
  result: string | null = "data:image/png;base64,uploaded-logo";
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;

  readAsDataURL() {
    this.onload?.();
  }
}

vi.stubGlobal("FileReader", MockFileReader);

function mockWorkspace() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      workspace: {
        id: "workspace-1",
        name: "Acme Corp",
        urlSlug: "acme",
        logo: null,
        region: "United States",
        fiscalMonth: "january",
        welcomeMessage: "",
      },
    }),
  });
}

function waitForLoaded() {
  return waitFor(() => {
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });
}

describe("Workspace Settings Page", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    routerPushMock.mockReset();
    routerRefreshMock.mockReset();
    routerReplaceMock.mockReset();
  });

  it("renders Workspace heading", async () => {
    mockWorkspace();
    render(<WorkspaceSettingsPage />);
    await waitForLoaded();
    expect(
      screen.getByRole("heading", { name: "Workspace" }),
    ).toBeInTheDocument();
  });

  it("renders logo upload section", async () => {
    mockWorkspace();
    render(<WorkspaceSettingsPage />);
    await waitForLoaded();
    expect(screen.getByText("Logo")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Upload logo" }),
    ).toBeInTheDocument();
  });

  it("renders editable workspace name", async () => {
    mockWorkspace();
    render(<WorkspaceSettingsPage />);
    await waitForLoaded();
    const nameInput = screen.getByLabelText(
      "Workspace name",
    ) as HTMLInputElement;
    expect(nameInput.value).toBe("Acme Corp");
  });

  it("renders URL slug with prefix", async () => {
    mockWorkspace();
    render(<WorkspaceSettingsPage />);
    await waitForLoaded();
    expect(screen.getByText("exponential.app/")).toBeInTheDocument();
    const urlInput = screen.getByLabelText(
      "Workspace URL slug",
    ) as HTMLInputElement;
    expect(urlInput.value).toBe("acme");
  });

  it("renders Time & region section", async () => {
    mockWorkspace();
    render(<WorkspaceSettingsPage />);
    await waitForLoaded();
    expect(screen.getByText("Time & region")).toBeInTheDocument();
    expect(screen.getByText("First month of fiscal year")).toBeInTheDocument();
    expect(screen.getByText("Region")).toBeInTheDocument();
    expect(screen.getByText("United States")).toBeInTheDocument();
  });

  it("persists workspace name and url slug changes on blur", async () => {
    mockWorkspace();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        workspace: {
          id: "workspace-1",
          name: "Acme QA",
          urlSlug: "acme-qa",
          logo: null,
          region: "United States",
          fiscalMonth: "january",
          welcomeMessage: "",
        },
      }),
    });

    render(<WorkspaceSettingsPage />);
    await waitForLoaded();

    const nameInput = screen.getByLabelText("Workspace name");
    const slugInput = screen.getByLabelText("Workspace URL slug");

    fireEvent.change(nameInput, { target: { value: "Acme QA" } });
    fireEvent.change(slugInput, { target: { value: "acme-qa" } });
    fireEvent.blur(slugInput);

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/current", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Acme QA",
          urlSlug: "acme-qa",
          logo: null,
          fiscalMonth: "january",
          welcomeMessage: "",
        }),
      }),
    );

    expect(screen.getByText("Workspace updated.")).toBeInTheDocument();
    expect(routerReplaceMock).toHaveBeenCalledWith(
      "/acme-qa/settings/workspace",
    );
  });

  it("uploads and persists a workspace logo", async () => {
    mockWorkspace();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        workspace: {
          id: "workspace-1",
          name: "Acme Corp",
          urlSlug: "acme",
          logo: "data:image/png;base64,uploaded-logo",
          region: "United States",
          fiscalMonth: "january",
          welcomeMessage: "",
        },
      }),
    });

    render(<WorkspaceSettingsPage />);
    await waitForLoaded();

    const fileInput = screen.getByLabelText("Upload workspace logo");
    fireEvent.change(fileInput, {
      target: {
        files: [new File(["logo"], "logo.png", { type: "image/png" })],
      },
    });

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/current", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Acme Corp",
          urlSlug: "acme",
          logo: "data:image/png;base64,uploaded-logo",
          fiscalMonth: "january",
          welcomeMessage: "",
        }),
      }),
    );

    expect(screen.getByText("Selected: logo.png")).toBeInTheDocument();
  });

  it("configures and persists the workspace welcome message", async () => {
    mockWorkspace();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        workspace: {
          id: "workspace-1",
          name: "Acme Corp",
          urlSlug: "acme",
          logo: null,
          region: "United States",
          fiscalMonth: "january",
          welcomeMessage: "Welcome aboard",
        },
      }),
    });

    render(<WorkspaceSettingsPage />);
    await waitForLoaded();
    expect(screen.getByText("Welcome message")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Configure" }));
    fireEvent.change(screen.getByLabelText("Welcome message text"), {
      target: { value: "Welcome aboard" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/current", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Acme Corp",
          urlSlug: "acme",
          logo: null,
          fiscalMonth: "january",
          welcomeMessage: "Welcome aboard",
        }),
      }),
    );
    expect(screen.getByText("Welcome aboard")).toBeInTheDocument();
  });

  it("shows inline slug validation and does not save invalid slugs", async () => {
    mockWorkspace();
    render(<WorkspaceSettingsPage />);
    await waitForLoaded();

    const slugInput = screen.getByLabelText("Workspace URL slug");
    fireEvent.change(slugInput, { target: { value: "bad slug!" } });
    fireEvent.blur(slugInput);

    expect(
      screen.getByText(
        "URL slug can only use lowercase letters, numbers, and single hyphens",
      ),
    ).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("renders Danger zone with delete button", async () => {
    mockWorkspace();
    render(<WorkspaceSettingsPage />);
    await waitForLoaded();
    expect(screen.getByText("Danger zone")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete workspace" }),
    ).toBeInTheDocument();
  });

  it("requires confirmation before deleting the workspace", async () => {
    mockWorkspace();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        redirectTo: "/create-workspace",
      }),
    });

    render(<WorkspaceSettingsPage />);
    await waitForLoaded();

    fireEvent.click(
      screen.getAllByRole("button", { name: "Delete workspace" })[0],
    );
    expect(screen.getByText("Delete workspace?")).toBeInTheDocument();

    const confirmButton = screen.getAllByRole("button", {
      name: "Delete workspace",
    })[1];
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Confirm workspace name"), {
      target: { value: "Acme Corp" },
    });
    fireEvent.click(confirmButton);

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/current", {
        method: "DELETE",
      }),
    );

    expect(routerPushMock).toHaveBeenCalledWith("/create-workspace");
    expect(routerRefreshMock).toHaveBeenCalled();
  });
});
