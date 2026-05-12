import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SecurityPage from "../src/app/(app)/settings/security/page";

describe("SecurityPage component", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  const mockSecurityData = {
    security: {
      inviteLinkEnabled: true,
      inviteUrl: "https://linear.app/i/abc-123",
      approvedEmailDomains: ["example.com"],
      authentication: {
        google: true,
        emailPasskey: true,
      },
      permissions: {
        invitationsRole: "admins",
        teamCreationRole: "members",
        labelManagementRole: "admins",
        templateManagementRole: "admins",
        apiKeyCreationRole: "admins",
        agentGuidanceRole: "admins",
      },
      restrictFileUploads: false,
      improveAi: true,
      webSearch: true,
      hipaa: false,
    },
  };

  it("renders security settings and toggle states", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockSecurityData,
    });

    render(<SecurityPage />);

    expect(screen.getByText("Loading security settings...")).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText("https://linear.app/i/abc-123")).toBeDefined();
    });

    expect(screen.getByText("example.com")).toBeDefined();
    expect(
      screen.getByLabelText("Enable invite links").getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen
        .getByLabelText("Google authentication")
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("updates invite link toggle", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockSecurityData,
    });

    render(<SecurityPage />);
    await waitFor(() => screen.getByText("example.com"));

    const toggle = screen.getByLabelText("Enable invite links");
    fireEvent.click(toggle);

    expect(fetch).toHaveBeenCalledWith(
      "/api/workspaces/current/security",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"inviteLinkEnabled":false'),
      }),
    );
  });

  it("adds and removes approved domains", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockSecurityData,
    });

    render(<SecurityPage />);
    await waitFor(() => screen.getByText("example.com"));

    // Add domain
    await userEvent.click(screen.getByLabelText("Add approved email domain"));
    const input = screen.getByPlaceholderText("example.com");
    await userEvent.type(input, "newdomain.com");
    await userEvent.click(screen.getByRole("button", { name: "Add domain" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/workspaces/current/security",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining(
          '"approvedEmailDomains":["example.com","newdomain.com"]',
        ),
      }),
    );

    // Remove domain
    const removeButton = screen.getByLabelText("Remove example.com");
    fireEvent.click(removeButton);

    expect(fetch).toHaveBeenCalledWith(
      "/api/workspaces/current/security",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"approvedEmailDomains":[]'),
      }),
    );
  });

  it("updates permission levels", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockSecurityData,
    });

    render(<SecurityPage />);
    await waitFor(() => screen.getByText("example.com"));

    const select = screen.getByLabelText("Team creation");
    await userEvent.selectOptions(select, "admins");

    expect(fetch).toHaveBeenCalledWith(
      "/api/workspaces/current/security",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"teamCreationRole":"admins"'),
      }),
    );
  });

  it("copies invite link to clipboard", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockSecurityData,
    });

    render(<SecurityPage />);
    await waitFor(() => screen.getByText("example.com"));

    const copyButton = screen.getByRole("button", { name: /copy/i });
    fireEvent.click(copyButton);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "https://linear.app/i/abc-123",
    );
    await waitFor(() => {
      expect(screen.getByText("Copied!")).toBeDefined();
    });
  });
});
