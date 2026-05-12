import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation
const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
  useParams: () => ({}),
}));

import ProfilePage from "@/app/(app)/settings/account/profile/page";

const mockProfileData = {
  profile: {
    name: "Ashley",
    email: "ashley@test.com",
    username: "ashleyha",
    image: null,
  },
  workspaceAccess: {
    currentWorkspaceId: "ws-1",
    currentWorkspaceName: "Namuh",
  },
};

describe("ProfilePage UI", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders loading state then profile details", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockProfileData,
    } as Response);

    render(<ProfilePage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    expect(await screen.findByText("Profile")).toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).toHaveValue("Ashley");
    expect(screen.getByLabelText("Email")).toHaveValue("ashley@test.com");
    expect(screen.getByLabelText("Username")).toHaveValue("ashleyha");
    expect(screen.getByText(/Remove yourself from Namuh/i)).toBeInTheDocument();
  });

  it("updates profile information", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      if (
        url.toString().includes("/api/account/profile") &&
        !url.toString().includes("workspace")
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            profile: { ...mockProfileData.profile, name: "Ashley Updated" },
          }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });

    render(<ProfilePage />);
    await screen.findByText("Profile");

    const nameInput = screen.getByLabelText("Full name");
    fireEvent.change(nameInput, { target: { value: "Ashley Updated" } });

    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/account/profile",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"name":"Ashley Updated"'),
        }),
      );
    });

    expect(screen.getByText("Profile updated.")).toBeInTheDocument();
  });

  it("opens leave workspace dialog and confirms", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      if (url.toString().includes("/api/account/profile/workspace")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ redirectTo: "/login" }),
        } as Response);
      }
      if (url.toString().includes("/api/account/profile")) {
        return Promise.resolve({
          ok: true,
          json: async () => mockProfileData,
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });

    render(<ProfilePage />);
    await screen.findByText("Profile");

    fireEvent.click(screen.getByRole("button", { name: /Leave workspace/i }));

    // Check dialog content
    expect(screen.getByText("Leave workspace?")).toBeInTheDocument();
    expect(
      screen.getByText(/You will lose access to Namuh/i),
    ).toBeInTheDocument();

    // Find the button inside the dialog
    const confirmButton = screen
      .getAllByRole("button", { name: "Leave workspace" })
      .find((btn) => btn.closest("dialog"));

    if (!confirmButton)
      throw new Error("Could not find confirm button in dialog");
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/account/profile/workspace",
        expect.objectContaining({ method: "DELETE" }),
      );
      expect(pushMock).toHaveBeenCalledWith("/login");
      expect(refreshMock).toHaveBeenCalled();
    });
  });
});
