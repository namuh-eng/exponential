import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const resolveActiveWorkspaceIdMock = vi.fn();
const currentWorkspaceLimitMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();

  return {
    ...actual,
    randomBytes: vi.fn((size: number) => ({
      toString: () => "b".repeat(size * 2),
    })),
  };
});

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/lib/active-workspace", () => ({
  resolveActiveWorkspaceId: resolveActiveWorkspaceIdMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          limit: currentWorkspaceLimitMock,
        }),
      }),
    })),
    update: vi.fn(() => ({
      set: (...setArgs: unknown[]) => {
        updateSetMock(...setArgs);
        return {
          where: (...whereArgs: unknown[]) => {
            updateWhereMock(...whereArgs);
            return Promise.resolve();
          },
        };
      },
    })),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("current workspace security route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    resolveActiveWorkspaceIdMock.mockResolvedValue("workspace-1");
    currentWorkspaceLimitMock.mockResolvedValue([
      {
        id: "workspace-1",
        settings: {
          security: {
            authentication: { google: false, emailPasskey: true },
            permissions: { apiKeyCreationRole: "admins" },
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
          },
        },
        inviteLinkEnabled: true,
        inviteLinkToken: "invite-token-1",
        approvedEmailDomains: ["TEAM@EXAMPLE.COM", "bad domain"],
        role: "admin",
      },
    ]);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/workspaces/current/security/route");

    const response = await GET(
      new Request("https://app.test/settings/security"),
    );

    expect(response.status).toBe(401);
  });

  it("returns 404 when there is no active workspace", async () => {
    resolveActiveWorkspaceIdMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/workspaces/current/security/route");

    const response = await GET(
      new Request("https://app.test/settings/security"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "No active workspace found",
    });
  });

  it("returns normalized security settings and invite url", async () => {
    const { GET } = await import("@/app/api/workspaces/current/security/route");

    const response = await GET(
      new Request("https://app.test/settings/security"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      security: {
        inviteLinkEnabled: true,
        inviteUrl: "https://app.test/accept-invite?token=invite-token-1",
        approvedEmailDomains: [],
        authentication: {
          google: false,
          emailPasskey: true,
        },
        permissions: {
          invitationsRole: "members",
          teamCreationRole: "members",
          labelManagementRole: "members",
          templateManagementRole: "members",
          apiKeyCreationRole: "admins",
          agentGuidanceRole: "admins",
        },
        capabilities: {
          canInviteMembers: true,
          canCreateTeams: true,
          canManageWorkspaceLabels: false,
          canManageWorkspaceTemplates: false,
          canCreateApiKeys: true,
          canModifyAgentGuidance: false,
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
          status: "not_configured",
        },
        scim: {
          enabled: false,
          baseUrl: "https://app.test/api/scim/v2",
          status: "disabled",
          tokenPrefix: null,
        },
      },
    });
  });

  it("creates an invite token when one is missing", async () => {
    currentWorkspaceLimitMock.mockResolvedValue([
      {
        id: "workspace-1",
        settings: {},
        inviteLinkEnabled: true,
        inviteLinkToken: null,
        approvedEmailDomains: [],
        role: "admin",
      },
    ]);
    const { GET } = await import("@/app/api/workspaces/current/security/route");

    const response = await GET(
      new Request("https://app.test/settings/security"),
    );

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inviteLinkToken: expect.any(String),
        updatedAt: expect.any(Date),
      }),
    );
  });

  it("rejects invalid patch booleans", async () => {
    const { PATCH } = await import(
      "@/app/api/workspaces/current/security/route"
    );

    const response = await PATCH(
      new Request("https://app.test/settings/security", {
        method: "PATCH",
        body: JSON.stringify({ restrictFileUploads: "yes" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Restrict file uploads must be a boolean",
    });
  });

  it("rejects non-list approved email domains", async () => {
    const { PATCH } = await import(
      "@/app/api/workspaces/current/security/route"
    );

    const response = await PATCH(
      new Request("https://app.test/settings/security", {
        method: "PATCH",
        body: JSON.stringify({ approvedEmailDomains: "example.com" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Approved email domains must be a list",
    });
  });

  it("rejects invalid IP restriction ranges", async () => {
    const { PATCH } = await import(
      "@/app/api/workspaces/current/security/route"
    );

    const response = await PATCH(
      new Request("https://app.test/settings/security", {
        method: "PATCH",
        body: JSON.stringify({
          ipRestrictions: [{ range: "999.0.0.1/33", enabled: true }],
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "IP restrictions must use valid IP addresses or CIDR ranges",
    });
  });

  it("updates and normalizes security settings", async () => {
    const { PATCH } = await import(
      "@/app/api/workspaces/current/security/route"
    );

    const response = await PATCH(
      new Request("https://app.test/settings/security", {
        method: "PATCH",
        body: JSON.stringify({
          inviteLinkEnabled: false,
          approvedEmailDomains: [
            "@Team.Example.com",
            "ops@example.com",
            "ops@example.com",
          ],
          authentication: { google: true },
          permissions: { teamCreationRole: "admins" },
          restrictFileUploads: true,
          improveAi: false,
          webSearch: false,
          hipaa: true,
          ipRestrictions: [
            {
              range: "198.51.100.10/32",
              description: "VPN",
              enabled: true,
              type: "allow",
            },
          ],
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inviteLinkEnabled: false,
        inviteLinkToken: "invite-token-1",
        approvedEmailDomains: ["team.example.com"],
        settings: expect.objectContaining({
          security: expect.objectContaining({
            authentication: { google: true, emailPasskey: true },
            permissions: {
              invitationsRole: "members",
              teamCreationRole: "admins",
              labelManagementRole: "members",
              templateManagementRole: "members",
              apiKeyCreationRole: "admins",
              agentGuidanceRole: "admins",
            },
            restrictFileUploads: true,
            improveAi: false,
            webSearch: false,
            hipaa: true,
            ipRestrictions: [
              {
                range: "198.51.100.10/32",
                description: "VPN",
                enabled: true,
                type: "allow",
              },
            ],
          }),
        }),
        updatedAt: expect.any(Date),
      }),
    );
    expect(updateWhereMock).toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      security: {
        inviteLinkEnabled: false,
        approvedEmailDomains: ["team.example.com"],
        authentication: { google: true, emailPasskey: true },
        permissions: {
          teamCreationRole: "admins",
          apiKeyCreationRole: "admins",
        },
        capabilities: {
          canInviteMembers: true,
          canCreateTeams: true,
          canManageWorkspaceLabels: false,
          canManageWorkspaceTemplates: false,
          canCreateApiKeys: true,
          canModifyAgentGuidance: false,
        },
        restrictFileUploads: true,
        improveAi: false,
        webSearch: false,
        hipaa: true,
        ipRestrictions: [
          {
            range: "198.51.100.10/32",
            description: "VPN",
            enabled: true,
            type: "allow",
          },
        ],
      },
    });
  });

  it("persists SAML settings and exposes legacy discovery aliases", async () => {
    const { PATCH } = await import(
      "@/app/api/workspaces/current/security/route"
    );

    const response = await PATCH(
      new Request("https://app.test/settings/security", {
        method: "PATCH",
        body: JSON.stringify({
          saml: {
            enabled: true,
            domains: ["Example.com"],
            idpSsoUrl: "https://idp.example.com/saml",
            issuer: "https://idp.example.com/entity",
            metadataUrl: "https://idp.example.com/metadata",
          },
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          security: expect.objectContaining({
            saml: expect.objectContaining({
              enabled: true,
              domains: ["example.com"],
              idpSsoUrl: "https://idp.example.com/saml",
              status: "tested",
            }),
          }),
          saml: expect.objectContaining({
            enabled: true,
            domains: ["example.com"],
            idpSsoUrl: "https://idp.example.com/saml",
          }),
          sso: {
            enabled: true,
            domains: ["example.com"],
            ssoUrl: "https://idp.example.com/saml",
          },
        }),
      }),
    );
  });

  it("generates and revokes SCIM token metadata without returning stored hashes", async () => {
    const { PATCH } = await import(
      "@/app/api/workspaces/current/security/route"
    );

    const generate = await PATCH(
      new Request("https://app.test/settings/security", {
        method: "PATCH",
        body: JSON.stringify({ scim: { action: "generate_token" } }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(generate.status).toBe(200);
    const generated = await generate.json();
    expect(generated.security.scim.oneTimeToken).toMatch(/^scim_/);
    expect(generated.security.scim.tokenPrefix).toMatch(/^scim_/);
    expect(JSON.stringify(generated)).not.toContain("tokenHash");
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          security: expect.objectContaining({
            scim: expect.objectContaining({
              enabled: true,
              status: "active",
              tokenHash: expect.any(String),
            }),
          }),
        }),
      }),
    );

    currentWorkspaceLimitMock.mockResolvedValueOnce([
      {
        id: "workspace-1",
        settings: {
          security: {
            scim: {
              enabled: true,
              tokenPrefix: generated.security.scim.tokenPrefix,
              tokenHash: "stored-hash",
              status: "active",
            },
          },
        },
        inviteLinkEnabled: true,
        inviteLinkToken: "invite-token-1",
        approvedEmailDomains: [],
        role: "admin",
      },
    ]);

    const revoke = await PATCH(
      new Request("https://app.test/settings/security", {
        method: "PATCH",
        body: JSON.stringify({ scim: { action: "revoke_token" } }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(revoke.status).toBe(200);
    expect(await revoke.json()).toMatchObject({
      security: { scim: { enabled: false, status: "revoked" } },
    });
  });

  it("blocks non-admin members from mutating workspace security policy", async () => {
    currentWorkspaceLimitMock.mockResolvedValue([
      {
        id: "workspace-1",
        settings: {},
        inviteLinkEnabled: true,
        inviteLinkToken: "invite-token-1",
        approvedEmailDomains: [],
        role: "member",
      },
    ]);
    const { PATCH } = await import(
      "@/app/api/workspaces/current/security/route"
    );

    const response = await PATCH(
      new Request("https://app.test/settings/security", {
        method: "PATCH",
        body: JSON.stringify({ permissions: { invitationsRole: "anyone" } }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(403);
    expect(updateSetMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "You do not have permission to manage workspace security",
    });
  });
});
