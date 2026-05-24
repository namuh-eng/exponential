import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import ApplicationsSettingsPage from "@/app/(app)/settings/applications/page";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/app-shell", () => ({
  useAppShellContext: () => ({ workspaceSlug: "foreverbrowsing" }),
}));

const fetchMock = vi.fn();

describe("ApplicationsSettingsPage component", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads a true empty state from the applications API", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ applications: [], canManageApplications: true }),
    });

    render(<ApplicationsSettingsPage />);

    expect(screen.getByText("Loading applications...")).toBeInTheDocument();

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspaces/current/applications",
        expect.any(Object),
      ),
    );
    expect(await screen.findByText("No applications")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Explore integrations" }),
    ).toHaveAttribute("href", "/foreverbrowsing/settings/integrations");
  });

  it("renders application metadata and revokes after confirmation", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          canManageApplications: true,
          applications: [
            {
              id: "grant-1",
              appId: "app-1",
              clientId: "lin_client_123",
              name: "Importer",
              imageUrl: null,
              scopes: ["read", "write"],
              permissionGroups: [
                {
                  label: "Workspace data",
                  descriptions: ["View workspace", "Create workspace data"],
                },
              ],
              webhooksEnabled: true,
              createdAt: "2026-04-01T10:00:00.000Z",
              updatedAt: "2026-04-02T10:00:00.000Z",
              lastUsedAt: null,
              owner: {
                name: "Ada Lovelace",
                email: "ada@example.com",
                image: null,
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

    render(<ApplicationsSettingsPage />);

    expect(await screen.findByText("Importer")).toBeInTheDocument();
    expect(screen.getByText(/Authorized by Ada Lovelace/)).toBeInTheDocument();
    expect(
      screen.getByText(/Workspace data: View workspace/),
    ).toBeInTheDocument();
    expect(screen.getByText("lin_client_123")).toBeInTheDocument();
    expect(screen.getByText("Webhook access enabled")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(
      screen.getByRole("alertdialog", { name: "Confirm revoking Importer" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm revoke" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/workspaces/current/applications/grant-1",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    expect(
      await screen.findByText("Application access revoked."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Importer")).not.toBeInTheDocument();
  });

  it("shows load and revoke failures without dropping the current row", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Forbidden" }),
    });
    const { unmount } = render(<ApplicationsSettingsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
    unmount();

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          canManageApplications: true,
          applications: [
            {
              id: "grant-2",
              appId: "app-2",
              clientId: "lin_2",
              name: "Failing App",
              imageUrl: null,
              scopes: [],
              permissionGroups: [],
              webhooksEnabled: false,
              createdAt: null,
              updatedAt: null,
              lastUsedAt: null,
              owner: { name: null, email: "owner@example.com", image: null },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Application not found" }),
      });
    render(<ApplicationsSettingsPage />);
    expect(await screen.findByText("Failing App")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm revoke" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Application not found",
    );
    expect(screen.getByText("Failing App")).toBeInTheDocument();
  });
});
