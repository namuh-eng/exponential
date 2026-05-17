import "@testing-library/jest-dom/vitest";
import SecurityPage from "@/app/(app)/settings/security/page";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function buildSecurity(
  overrides: Partial<ReturnType<typeof defaultSecurity>> = {},
) {
  return {
    ...defaultSecurity(),
    ...overrides,
    authentication: {
      ...defaultSecurity().authentication,
      ...overrides.authentication,
    },
    permissions: {
      ...defaultSecurity().permissions,
      ...overrides.permissions,
    },
    saml: {
      ...defaultSecurity().saml,
      ...overrides.saml,
    },
    scim: {
      ...defaultSecurity().scim,
      ...overrides.scim,
    },
  };
}

type TestSecurity = {
  inviteLinkEnabled: boolean;
  inviteUrl: string;
  approvedEmailDomains: string[];
  authentication: {
    google: boolean;
    emailPasskey: boolean;
  };
  permissions: {
    invitationsRole: "admins" | "members" | "anyone";
    teamCreationRole: "admins" | "members" | "anyone";
    labelManagementRole: "admins" | "members" | "anyone";
    templateManagementRole: "admins" | "members" | "anyone";
    apiKeyCreationRole: "admins" | "members" | "anyone";
    agentGuidanceRole: "admins" | "members" | "anyone";
  };
  restrictFileUploads: boolean;
  improveAi: boolean;
  webSearch: boolean;
  hipaa: boolean;
  ipRestrictions: Array<{
    range: string;
    description: string;
    enabled: boolean;
    type: "allow";
  }>;
  saml: {
    enabled: boolean;
    domains: string[];
    idpSsoUrl: string;
    issuer: string;
    certificate: string;
    metadataUrl: string;
    status: string;
    lastTestedAt: string | null;
    lastError: string | null;
  };
  scim: {
    enabled: boolean;
    baseUrl: string;
    tokenPrefix: string | null;
    tokenCreatedAt: string | null;
    tokenRevokedAt: string | null;
    lastSyncAt: string | null;
    status: string;
    oneTimeToken?: string;
  };
};

function defaultSecurity(): TestSecurity {
  return {
    inviteLinkEnabled: true,
    inviteUrl: "http://localhost:3015/accept-invite?token=invite-token",
    approvedEmailDomains: [] as string[],
    authentication: {
      google: true,
      emailPasskey: true,
    },
    permissions: {
      invitationsRole: "members" as const,
      teamCreationRole: "members" as const,
      labelManagementRole: "members" as const,
      templateManagementRole: "members" as const,
      apiKeyCreationRole: "admins" as const,
      agentGuidanceRole: "admins" as const,
    },
    restrictFileUploads: false,
    improveAi: true,
    webSearch: true,
    hipaa: false,
    ipRestrictions: [],
    saml: {
      enabled: false,
      domains: [],
      idpSsoUrl: "",
      issuer: "",
      certificate: "",
      metadataUrl: "",
      status: "not_configured",
      lastTestedAt: null,
      lastError: null,
    },
    scim: {
      enabled: false,
      baseUrl: "http://localhost:3015/api/scim/v2",
      tokenPrefix: null,
      tokenCreatedAt: null,
      tokenRevokedAt: null,
      lastSyncAt: null,
      status: "not_configured",
    },
  };
}

function mockSecurityLoad(
  overrides: Partial<ReturnType<typeof defaultSecurity>> = {},
) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      security: buildSecurity(overrides),
    }),
  });
}

function mockPatchResponse(
  overrides: Partial<ReturnType<typeof defaultSecurity>>,
) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      security: buildSecurity(overrides),
    }),
  });
}

function waitForLoaded() {
  return waitFor(() => {
    expect(
      screen.queryByText("Loading security settings..."),
    ).not.toBeInTheDocument();
  });
}

describe("Security settings page", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders persisted security settings from the API", async () => {
    mockSecurityLoad({
      approvedEmailDomains: ["acme.com"],
      authentication: { google: false, emailPasskey: true },
    });

    render(<SecurityPage />);
    await waitForLoaded();

    expect(
      screen.getByRole("heading", { name: "Security" }),
    ).toBeInTheDocument();
    expect(screen.getByText("acme.com")).toBeInTheDocument();
    expect(screen.getByText(defaultSecurity().inviteUrl)).toBeInTheDocument();
    expect(screen.getByText("SAML & SCIM")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Generate SCIM token" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Google authentication" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("persists invite link changes through the security API", async () => {
    mockSecurityLoad();
    mockPatchResponse({
      inviteLinkEnabled: false,
    });

    render(<SecurityPage />);
    await waitForLoaded();

    fireEvent.click(
      screen.getByRole("switch", { name: "Enable invite links" }),
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

    const request = mockFetch.mock.calls[1];
    expect(request[0]).toBe("/api/workspaces/current/security");
    expect(request[1]).toMatchObject({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(String(request[1]?.body))).toMatchObject({
      inviteLinkEnabled: false,
    });
    expect(
      screen.queryByText(defaultSecurity().inviteUrl),
    ).not.toBeInTheDocument();
  });

  it("adds an approved email domain through the modal flow", async () => {
    mockSecurityLoad();
    mockPatchResponse({
      approvedEmailDomains: ["example.com"],
    });

    render(<SecurityPage />);
    await waitForLoaded();

    fireEvent.click(screen.getByLabelText("Add approved email domain"));
    fireEvent.change(screen.getByLabelText("Domain"), {
      target: { value: "Example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add domain" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

    const request = mockFetch.mock.calls[1];
    expect(JSON.parse(String(request[1]?.body))).toMatchObject({
      approvedEmailDomains: ["example.com"],
    });
    expect(screen.getByText("example.com")).toBeInTheDocument();
  });

  it("persists workspace management permission changes", async () => {
    mockSecurityLoad();
    mockPatchResponse({
      permissions: {
        ...defaultSecurity().permissions,
        invitationsRole: "anyone",
      },
    });

    render(<SecurityPage />);
    await waitForLoaded();

    fireEvent.change(screen.getByLabelText("New user invitations"), {
      target: { value: "anyone" },
    });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    const request = mockFetch.mock.calls[1];
    expect(JSON.parse(String(request[1]?.body))).toMatchObject({
      permissions: expect.objectContaining({
        invitationsRole: "anyone",
      }),
    });
  });
  it("saves SAML settings through the security API", async () => {
    mockSecurityLoad();
    mockPatchResponse({
      saml: {
        ...defaultSecurity().saml,
        enabled: true,
        domains: ["example.com"],
        idpSsoUrl: "https://idp.example.com/saml",
        status: "tested",
      },
    });

    render(<SecurityPage />);
    await waitForLoaded();

    fireEvent.change(screen.getByLabelText("SAML domains"), {
      target: { value: "Example.com" },
    });
    fireEvent.change(screen.getByLabelText("IdP SSO URL"), {
      target: { value: "https://idp.example.com/saml" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and test SAML" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(mockFetch.mock.calls[1][1]?.body))).toMatchObject({
      saml: expect.objectContaining({
        domains: ["example.com"],
        idpSsoUrl: "https://idp.example.com/saml",
      }),
    });
  });

  it("generates and revokes SCIM tokens through the security API", async () => {
    mockSecurityLoad();
    mockPatchResponse({
      scim: {
        ...defaultSecurity().scim,
        enabled: true,
        tokenPrefix: "scim_abc123",
        status: "active",
        oneTimeToken: "scim_abc123secret",
      },
    });

    render(<SecurityPage />);
    await waitForLoaded();

    fireEvent.click(
      screen.getByRole("button", { name: "Generate SCIM token" }),
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(mockFetch.mock.calls[1][1]?.body))).toMatchObject({
      scim: expect.objectContaining({ action: "generate_token" }),
    });
    expect(screen.getByText(/Copy this SCIM token now/)).toBeInTheDocument();
  });
});
