import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import ProfilePage from "@/app/(app)/settings/account/profile/page";

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    refresh: refreshMock,
  }),
  usePathname: () => "/settings/account/profile",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

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

function mockSession() {
  mockFetch.mockResolvedValueOnce(
    jsonResponse({
      profile: {
        name: "John Doe",
        email: "john@example.com",
        username: "johnd",
        image: null,
        pronouns: "they/them",
        title: "Product Engineer",
        location: "San Francisco",
        timezone: "America/Los_Angeles",
        showLocalTime: true,
      },
      workspaceAccess: {
        currentWorkspaceId: "workspace-1",
        currentWorkspaceName: "Onboarding QA Team",
      },
    }),
  );
}

function waitForLoaded() {
  return waitFor(() => {
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });
}

describe("Account Profile Page", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Profile heading", async () => {
    mockSession();
    render(<ProfilePage />);
    await waitForLoaded();
    expect(
      screen.getByRole("heading", { name: "Profile" }),
    ).toBeInTheDocument();
  });

  it("renders profile picture section with upload button", async () => {
    mockSession();
    render(<ProfilePage />);
    await waitForLoaded();
    expect(screen.getByText("Profile picture")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Upload photo" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Recommended size: 256x256px")).toBeInTheDocument();
  });

  it("renders email as read-only", async () => {
    mockSession();
    render(<ProfilePage />);
    await waitForLoaded();
    expect(screen.getByText("Email")).toBeInTheDocument();
    const emailInput = screen.getByLabelText("Email") as HTMLInputElement;
    expect(emailInput.value).toBe("john@example.com");
    expect(emailInput).toHaveAttribute("readOnly");
  });

  it("renders editable Full name input", async () => {
    mockSession();
    render(<ProfilePage />);
    await waitForLoaded();
    const nameInput = screen.getByLabelText("Full name") as HTMLInputElement;
    expect(nameInput.value).toBe("John Doe");

    fireEvent.change(nameInput, { target: { value: "Jane Doe" } });
    expect(nameInput.value).toBe("Jane Doe");
  });

  it("renders editable Username input with placeholder", async () => {
    mockSession();
    render(<ProfilePage />);
    await waitForLoaded();
    const usernameInput = screen.getByLabelText("Username") as HTMLInputElement;
    expect(usernameInput.value).toBe("johnd");
    expect(usernameInput).toHaveAttribute(
      "placeholder",
      "One word, like a nickname or first name",
    );
  });

  it("renders editable exponential profile metadata controls", async () => {
    mockSession();
    render(<ProfilePage />);
    await waitForLoaded();

    expect(screen.getByLabelText("Pronouns")).toHaveValue("they/them");
    expect(screen.getByLabelText("Role or title")).toHaveValue(
      "Product Engineer",
    );
    expect(screen.getByLabelText("Location")).toHaveValue("San Francisco");
    expect(screen.getByLabelText("Timezone")).toHaveValue(
      "America/Los_Angeles",
    );
    expect(screen.getByLabelText(/Show my local time/)).toBeChecked();
  });

  it("renders Update button", async () => {
    mockSession();
    render(<ProfilePage />);
    await waitForLoaded();
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
  });

  it("renders Leave workspace button in danger zone", async () => {
    mockSession();
    render(<ProfilePage />);
    await waitForLoaded();
    expect(screen.getByText("Workspace access")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Leave workspace" }),
    ).toBeInTheDocument();
  });

  it("calls update API when Update is clicked", async () => {
    mockSession();
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        profile: {
          name: "John Doe",
          email: "john@example.com",
          username: "johnd",
          image: null,
          pronouns: "she/her",
          title: "Manager",
          location: "New York",
          timezone: "America/New_York",
          showLocalTime: false,
        },
      }),
    );

    render(<ProfilePage />);
    await waitForLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => {
      expect(
        mockFetch.mock.calls.some(([input]) => {
          return (
            requestPath(input as RequestInfo | URL) ===
              "/api/account/profile" &&
            input instanceof Request &&
            input.method === "PATCH"
          );
        }),
      ).toBe(true);
    });
    const [request] = mockFetch.mock.calls.find(([input]) => {
      return (
        requestPath(input as RequestInfo | URL) === "/api/account/profile" &&
        input instanceof Request &&
        input.method === "PATCH"
      );
    }) as [RequestInfo | URL];
    await expect((request as Request).clone().json()).resolves.toMatchObject({
      timezone: "America/Los_Angeles",
    });
  });

  it("opens a leave-workspace confirmation dialog", async () => {
    mockSession();
    render(<ProfilePage />);
    await waitForLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Leave workspace" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Leave workspace?")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Leave workspace" }),
    ).toHaveLength(2);
  });

  it("calls the leave-workspace API after confirmation", async () => {
    mockSession();
    mockFetch.mockResolvedValueOnce(jsonResponse({ redirectTo: "/" }));

    render(<ProfilePage />);
    await waitForLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Leave workspace" }));
    fireEvent.click(
      screen.getAllByRole("button", { name: "Leave workspace" })[1],
    );

    await waitFor(() => {
      expect(
        mockFetch.mock.calls.some(([input]) => {
          return (
            requestPath(input as RequestInfo | URL) ===
              "/api/account/profile/workspace" &&
            input instanceof Request &&
            input.method === "DELETE"
          );
        }),
      ).toBe(true);
    });
    expect(pushMock).toHaveBeenCalledWith("/");
    expect(refreshMock).toHaveBeenCalled();
  });
});
