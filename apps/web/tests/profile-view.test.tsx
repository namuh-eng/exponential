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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestPath(input: RequestInfo | URL) {
  if (input instanceof Request) {
    return new URL(input.url).pathname;
  }
  return new URL(input.toString(), "http://localhost").pathname;
}

const mockProfileData = {
  profile: {
    name: "Ashley",
    email: "ashley@test.com",
    username: "ashleyha",
    image: null,
    pronouns: "they/them",
    title: "Product Engineer",
    location: "San Francisco",
    timezone: "America/Los_Angeles",
    showLocalTime: true,
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
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(mockProfileData),
    );

    render(<ProfilePage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    expect(await screen.findByText("Profile")).toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).toHaveValue("Ashley");
    expect(screen.getByLabelText("Email")).toHaveValue("ashley@test.com");
    expect(screen.getByLabelText("Username")).toHaveValue("ashleyha");
    expect(screen.getByLabelText("Pronouns")).toHaveValue("they/them");
    expect(screen.getByLabelText("Role or title")).toHaveValue(
      "Product Engineer",
    );
    expect(screen.getByLabelText("Location")).toHaveValue("San Francisco");
    expect(screen.getByLabelText("Timezone")).toHaveValue(
      "America/Los_Angeles",
    );
    expect(screen.getByLabelText(/Show my local time/)).toBeChecked();
    expect(screen.getByText(/Remove yourself from Namuh/i)).toBeInTheDocument();
  });

  it("updates profile information", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input) => {
        if (requestPath(input) === "/api/account/profile") {
          return Promise.resolve(
            jsonResponse({
              ...mockProfileData,
              profile: { ...mockProfileData.profile, name: "Ashley Updated" },
            }),
          );
        }
        return Promise.resolve(jsonResponse({}));
      });

    render(<ProfilePage />);
    await screen.findByText("Profile");

    const nameInput = screen.getByLabelText("Full name");
    fireEvent.change(nameInput, { target: { value: "Ashley Updated" } });

    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    const [request] = fetchSpy.mock.calls.find(([input]) => {
      return (
        requestPath(input as RequestInfo | URL) === "/api/account/profile" &&
        input instanceof Request &&
        input.method === "PATCH"
      );
    }) as [RequestInfo | URL];
    expect(request).toBeInstanceOf(Request);
    await expect((request as Request).clone().json()).resolves.toMatchObject({
      name: "Ashley Updated",
    });

    expect(screen.getByText("Profile updated.")).toBeInTheDocument();
  });

  it("opens leave workspace dialog and confirms", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input) => {
        if (requestPath(input) === "/api/account/profile/workspace") {
          return Promise.resolve(jsonResponse({ redirectTo: "/login" }));
        }
        if (requestPath(input) === "/api/account/profile") {
          return Promise.resolve(jsonResponse(mockProfileData));
        }
        return Promise.resolve(jsonResponse({}));
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
      expect(
        fetchSpy.mock.calls.some(([input]) => {
          return (
            requestPath(input as RequestInfo | URL) ===
              "/api/account/profile/workspace" &&
            input instanceof Request &&
            input.method === "DELETE"
          );
        }),
      ).toBe(true);
      expect(pushMock).toHaveBeenCalledWith("/login");
      expect(refreshMock).toHaveBeenCalled();
    });
  });
});
