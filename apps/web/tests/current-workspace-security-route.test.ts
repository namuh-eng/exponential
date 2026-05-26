import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const resolveRequestWorkspaceIdMock = vi.fn();
const currentWorkspaceLimitMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
const allowedIpHeaders = { "x-forwarded-for": "203.0.113.42" };

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
  resolveRequestWorkspaceId: resolveRequestWorkspaceIdMock,
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

function securityRequest(init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("x-forwarded-for")) {
    headers.set("x-forwarded-for", "203.0.113.42");
  }
  return new Request("https://app.test/settings/security", {
    ...init,
    headers,
  });
}

describe("current workspace security route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    resolveRequestWorkspaceIdMock.mockResolvedValue("workspace-1");
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
    const { GET } = await import(
      "legacy-api/workspaces/current/security/route"
    );

    const response = await GET(securityRequest());

    expect(response.status).toBe(401);
  });

  it("returns 404 when there is no active workspace", async () => {
    resolveRequestWorkspaceIdMock.mockResolvedValue(null);
    const { GET } = await import(
      "legacy-api/workspaces/current/security/route"
    );

    const response = await GET(securityRequest());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "No active workspace found",
    });
  });

  it("returns normalized security settings and invite url", async () => {
    const { GET } = await import(
      "legacy-api/workspaces/current/security/route"
    );

    const response = await GET(securityRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
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
          entityId: "",
          certificate: "",
          metadataUrl: "",
          lastTestedAt: null,
          status: "not_configured",
          lastError: null,
        },
        scim: {
          enabled: false,
          baseUrl: "https://app.test/api/scim/workspace-1",
          tokens: [],
          lastSyncAt: null,
          status: "disabled",
        },
      },
    });
  });

  it("denies security API access from disallowed IPs when restrictions are enabled", async () => {
    const { GET } = await import(
      "legacy-api/workspaces/current/security/route"
    );

    const response = await GET(
      securityRequest({ headers: { "x-forwarded-for": "198.51.100.42" } }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "Workspace access denied by IP restrictions",
      code: "workspace_ip_restricted",
      reason: "ip_not_allowed",
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
    const { GET } = await import(
      "legacy-api/workspaces/current/security/route"
    );

    const response = await GET(securityRequest());

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
      "legacy-api/workspaces/current/security/route"
    );

    const response = await PATCH(
      securityRequest({
        method: "PATCH",
        body: JSON.stringify({ restrictFileUploads: "yes" }),
        headers: { "content-type": "application/json", ...allowedIpHeaders },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Restrict file uploads must be a boolean",
    });
  });

  it("rejects non-list approved email domains", async () => {
    const { PATCH } = await import(
      "legacy-api/workspaces/current/security/route"
    );

    const response = await PATCH(
      securityRequest({
        method: "PATCH",
        body: JSON.stringify({ approvedEmailDomains: "example.com" }),
        headers: { "content-type": "application/json", ...allowedIpHeaders },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Approved email domains must be a list",
    });
  });

  it("rejects invalid IP restriction ranges", async () => {
    const { PATCH } = await import(
      "legacy-api/workspaces/current/security/route"
    );

    const response = await PATCH(
      securityRequest({
        method: "PATCH",
        body: JSON.stringify({
          ipRestrictions: [{ range: "999.0.0.1/33", enabled: true }],
        }),
        headers: { "content-type": "application/json", ...allowedIpHeaders },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "IP restrictions must use valid IP addresses or CIDR ranges",
    });
  });

  it("updates and normalizes security settings", async () => {
    const { PATCH } = await import(
      "legacy-api/workspaces/current/security/route"
    );

    const response = await PATCH(
      securityRequest({
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
        headers: { "content-type": "application/json", ...allowedIpHeaders },
      }),
    );

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inviteLinkEnabled: false,
        inviteLinkToken: "invite-token-1",
        approvedEmailDomains: ["team.example.com"],
        settings: {
          security: {
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
          },
        },
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
      "legacy-api/workspaces/current/security/route"
    );

    const response = await PATCH(
      securityRequest({
        method: "PATCH",
        body: JSON.stringify({ permissions: { invitationsRole: "anyone" } }),
        headers: { "content-type": "application/json", ...allowedIpHeaders },
      }),
    );

    expect(response.status).toBe(403);
    expect(updateSetMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "You do not have permission to manage workspace security",
    });
  });
});
