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
const mockSearchParams = {
  get: (key: string) => {
    if (key === "workspaceId") return "ws-123";
    if (key === "teamKey") return "ABC";
    return null;
  },
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

import InviteTeamPage from "@/app/onboarding/invite/page";

describe("Invite Team page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the page title and description", () => {
    render(<InviteTeamPage />);
    expect(screen.getByText("Invite your team")).toBeDefined();
    expect(screen.getByText(/Invite teammates to collaborate/)).toBeDefined();
  });

  it("disables native browser validation so mixed invite rows can reach the API", () => {
    const { container } = render(<InviteTeamPage />);
    expect(container.querySelector("form")).toHaveProperty("noValidate", true);
  });

  it("renders one email input row by default", () => {
    render(<InviteTeamPage />);
    const emailInputs = screen.getAllByPlaceholderText("teammate@company.com");
    expect(emailInputs).toHaveLength(1);
  });

  it("renders role selector with member as default", () => {
    render(<InviteTeamPage />);
    const selects = screen.getAllByRole("combobox");
    expect(selects).toHaveLength(1);
    expect((selects[0] as HTMLSelectElement).value).toBe("member");
  });

  it("adds another invite row when clicking Add another", () => {
    render(<InviteTeamPage />);
    fireEvent.click(screen.getByText("Add another"));
    const emailInputs = screen.getAllByPlaceholderText("teammate@company.com");
    expect(emailInputs).toHaveLength(2);
  });

  it("removes an invite row when clicking remove button", () => {
    render(<InviteTeamPage />);
    // Add a second row first
    fireEvent.click(screen.getByText("Add another"));
    expect(screen.getAllByPlaceholderText("teammate@company.com")).toHaveLength(
      2,
    );

    // Remove one row
    const removeButtons = screen.getAllByLabelText("Remove invite");
    fireEvent.click(removeButtons[0]);
    expect(screen.getAllByPlaceholderText("teammate@company.com")).toHaveLength(
      1,
    );
  });

  it("does not show remove button when only one row exists", () => {
    render(<InviteTeamPage />);
    expect(screen.queryByLabelText("Remove invite")).toBeNull();
  });

  it("navigates to the invited team when Skip button is clicked", () => {
    render(<InviteTeamPage />);
    fireEvent.click(screen.getByText("Skip for now"));
    expect(mockPush).toHaveBeenCalledWith("/team/ABC/all");
  });

  it("disables Send button when all emails are empty", () => {
    render(<InviteTeamPage />);
    const sendButton = screen.getByRole("button", { name: "Send invitations" });
    expect(sendButton).toHaveProperty("disabled", true);
  });

  it("enables Send button when at least one email is entered", () => {
    render(<InviteTeamPage />);
    const emailInput = screen.getByPlaceholderText("teammate@company.com");
    fireEvent.change(emailInput, { target: { value: "test@example.com" } });

    const sendButton = screen.getByRole("button", { name: "Send invitations" });
    expect(sendButton).toHaveProperty("disabled", false);
  });

  it("submits invites and shows success state", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [{ email: "test@example.com", status: "sent" }],
        }),
    });
    globalThis.fetch = mockFetch;

    render(<InviteTeamPage />);
    fireEvent.change(screen.getByPlaceholderText("teammate@company.com"), {
      target: { value: "test@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invitations" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: "ws-123",
          invites: [{ email: "test@example.com", role: "member" }],
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Invitations sent!")).toBeDefined();
    });
  });

  it("shows per-email failures instead of success when any invite fails", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            { email: "good@example.com", status: "sent" },
            {
              email: "bad@example.com",
              status: "failed",
              error: "Invalid email",
            },
          ],
        }),
    });
    globalThis.fetch = mockFetch;

    render(<InviteTeamPage />);
    fireEvent.change(screen.getByPlaceholderText("teammate@company.com"), {
      target: { value: "good@example.com" },
    });
    fireEvent.click(screen.getByText("Add another"));
    fireEvent.change(
      screen.getAllByPlaceholderText("teammate@company.com")[1],
      {
        target: { value: "bad@example.com" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send invitations" }));

    await waitFor(() => {
      expect(screen.getByText(/bad@example.com: Invalid email/)).toBeDefined();
    });

    expect(screen.queryByText("Invitations sent!")).toBeNull();
  });

  it("displays error message on API failure", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () =>
        Promise.resolve({ error: "You are not a member of this workspace" }),
    });
    globalThis.fetch = mockFetch;

    render(<InviteTeamPage />);
    fireEvent.change(screen.getByPlaceholderText("teammate@company.com"), {
      target: { value: "test@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invitations" }));

    await waitFor(() => {
      expect(
        screen.getByText("You are not a member of this workspace"),
      ).toBeDefined();
    });
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

    render(<InviteTeamPage />);
    fireEvent.change(screen.getByPlaceholderText("teammate@company.com"), {
      target: { value: "test@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invitations" }));

    expect(screen.getByText("Sending...")).toBeDefined();
  });

  it("allows changing the role for an invite", () => {
    render(<InviteTeamPage />);
    const roleSelect = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: "admin" } });
    expect(roleSelect.value).toBe("admin");
  });

  it("renders the Linear logo", () => {
    render(<InviteTeamPage />);
    expect(screen.getByLabelText("Linear logo")).toBeDefined();
  });
});
