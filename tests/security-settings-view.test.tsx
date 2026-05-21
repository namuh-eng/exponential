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
      ipRestrictions: [
        {
          range: "203.0.113.0/24",
          description: "Office network",
          enabled: true,
          type: "allow",
        },
      ],
      saml: {
        enabled: false,
        domains: [],
        idpSsoUrl: "",
        entityId: "",
        certificate: "",
        metadataUrl: "",
        lastTestedAt: null,
        status: "not_configured",
        lastError: null,
      },
      scim: {
        enabled: false,
        baseUrl: "http://localhost:3015/api/scim/workspace-1",
        tokens: [],
        lastSyncAt: null,
        status: "disabled",
      },
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
    expect(screen.getByText("IP restrictions")).toBeDefined();
    expect(screen.getByText("203.0.113.0/24")).toBeDefined();
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

  it("marks unsupported workspace management permission controls as coming soon", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockSecurityData,
    });

    render(<SecurityPage />);
    await waitFor(() => screen.getByText("example.com"));

    expect(
      screen.getByText(
        "Coming soon — label management mutations are not implemented in this clone yet.",
      ),
    ).toBeDefined();
    expect(screen.getByLabelText("Manage workspace labels")).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByLabelText("Manage workspace templates")).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByLabelText("Modify agent guidance")).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByLabelText("New user invitations")).toHaveProperty(
      "disabled",
      false,
    );
    expect(screen.getByLabelText("Team creation")).toHaveProperty(
      "disabled",
      false,
    );
    expect(screen.getByLabelText("API key creation")).toHaveProperty(
      "disabled",
      false,
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

  it("adds, toggles, and removes IP restrictions", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockSecurityData,
    });

    render(<SecurityPage />);
    await waitFor(() => screen.getByText("203.0.113.0/24"));

    await userEvent.click(screen.getByLabelText("Add IP restriction"));
    await userEvent.type(
      screen.getByPlaceholderText("203.0.113.0/24"),
      "198.51.100.10/32",
    );
    await userEvent.type(screen.getByPlaceholderText("Office network"), "VPN");
    await userEvent.click(
      screen.getByRole("button", { name: "Add restriction" }),
    );

    expect(fetch).toHaveBeenCalledWith(
      "/api/workspaces/current/security",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"range":"198.51.100.10/32"'),
      }),
    );

    await userEvent.click(screen.getByLabelText("Enable 203.0.113.0/24"));
    expect(fetch).toHaveBeenCalledWith(
      "/api/workspaces/current/security",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"enabled":false'),
      }),
    );

    await userEvent.click(screen.getByLabelText("Remove 203.0.113.0/24"));
    expect(fetch).toHaveBeenCalledWith(
      "/api/workspaces/current/security",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"ipRestrictions":[]'),
      }),
    );
  });

  it("manages SAML and SCIM in app", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => mockSecurityData })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          saml: {
            ...mockSecurityData.security.saml,
            enabled: true,
            domains: ["example.com"],
            idpSsoUrl: "https://idp.example.com/sso",
            entityId: "https://idp.example.com/entity",
            certificate: "CERT",
            status: "configured",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: "scim_secret_once",
          scim: {
            ...mockSecurityData.security.scim,
            enabled: true,
            status: "enabled",
            tokens: [
              {
                id: "token-1",
                name: "SCIM token",
                prefix: "scim_secret",
                createdAt: "2026-05-20T00:00:00.000Z",
                revokedAt: null,
                lastUsedAt: null,
              },
            ],
          },
        }),
      });

    render(<SecurityPage />);
    await waitFor(() => screen.getByText("example.com"));

    await userEvent.click(screen.getByText("SAML & SCIM management"));
    await userEvent.type(
      screen.getByPlaceholderText("https://idp.example.com/sso"),
      "https://idp.example.com/sso",
    );
    await userEvent.type(
      screen.getByPlaceholderText("https://idp.example.com/entity"),
      "https://idp.example.com/entity",
    );
    await userEvent.type(
      screen.getByPlaceholderText("example.com, acme.co"),
      "example.com",
    );
    await userEvent.type(
      screen.getByPlaceholderText("Paste X.509 certificate"),
      "CERT",
    );
    await userEvent.click(screen.getByLabelText("Enable SAML SSO"));
    await userEvent.click(screen.getByRole("button", { name: "Save SAML" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/workspaces/current/security/saml",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"enabled":true'),
      }),
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Generate SCIM token" }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/workspaces/current/security/scim",
      expect.objectContaining({ method: "POST" }),
    );
    await waitFor(() =>
      expect(screen.getByText(/New token \(copy once\)/)).toBeDefined(),
    );
  });
});
