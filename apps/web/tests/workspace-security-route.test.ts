import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const resolveActiveWorkspaceIdMock = vi.fn();
const currentWorkspaceLimitMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/lib/active-workspace", () => ({
  resolveActiveWorkspaceId: resolveActiveWorkspaceIdMock,
  resolveRequestWorkspaceId: resolveActiveWorkspaceIdMock,
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
      set: (...args: unknown[]) => {
        updateSetMock(...args);
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

describe("workspace security route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
    });
    resolveActiveWorkspaceIdMock.mockResolvedValue("workspace-1");
  });

  it("returns normalized security settings and persists a missing invite token", async () => {
    currentWorkspaceLimitMock.mockResolvedValueOnce([
      {
        id: "workspace-1",
        settings: {
          security: {
            authentication: {
              google: false,
            },
            permissions: {
              invitationsRole: "anyone",
            },
            restrictFileUploads: true,
            improveAi: false,
            webSearch: false,
            hipaa: true,
            ipRestrictions: [],
          },
        },
        inviteLinkEnabled: true,
        inviteLinkToken: null,
        approvedEmailDomains: ["EXAMPLE.com", " example.com "],
        role: "member",
      },
    ]);

    const { GET } = await import("@/app/api/workspaces/current/security/route");
    const response = await GET(
      new Request("http://localhost:3000/api/workspaces/current/security"),
    );

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inviteLinkToken: expect.stringMatching(/^[a-f0-9]{48}$/),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      security: {
        inviteLinkEnabled: true,
        inviteUrl: expect.stringMatching(
          /^http:\/\/localhost:3000\/accept-invite\?token=[a-f0-9]{48}$/,
        ),
        approvedEmailDomains: ["example.com"],
        authentication: {
          google: false,
          emailPasskey: true,
        },
        permissions: {
          invitationsRole: "anyone",
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
          canCreateApiKeys: false,
          canModifyAgentGuidance: false,
        },
        restrictFileUploads: true,
        improveAi: false,
        webSearch: false,
        hipaa: true,
        ipRestrictions: [],
      },
    });
  });

  it("persists workspace security changes", async () => {
    currentWorkspaceLimitMock.mockResolvedValueOnce([
      {
        id: "workspace-1",
        settings: {
          region: "United States",
        },
        inviteLinkEnabled: true,
        inviteLinkToken: "saved-token",
        approvedEmailDomains: [],
        role: "admin",
      },
    ]);

    const { PATCH } = await import(
      "@/app/api/workspaces/current/security/route"
    );
    const response = await PATCH(
      new Request("http://localhost:3000/api/workspaces/current/security", {
        method: "PATCH",
        body: JSON.stringify({
          inviteLinkEnabled: false,
          approvedEmailDomains: ["Example.com", "@docs.example.com"],
          authentication: {
            google: false,
            emailPasskey: false,
          },
          permissions: {
            invitationsRole: "admins",
            teamCreationRole: "anyone",
          },
          restrictFileUploads: true,
          improveAi: false,
          webSearch: false,
          hipaa: true,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inviteLinkEnabled: false,
        inviteLinkToken: "saved-token",
        approvedEmailDomains: ["example.com", "docs.example.com"],
        settings: {
          region: "United States",
          security: {
            authentication: {
              google: false,
              emailPasskey: false,
            },
            permissions: {
              invitationsRole: "admins",
              teamCreationRole: "anyone",
              labelManagementRole: "members",
              templateManagementRole: "members",
              apiKeyCreationRole: "admins",
              agentGuidanceRole: "admins",
            },
            restrictFileUploads: true,
            improveAi: false,
            webSearch: false,
            hipaa: true,
            ipRestrictions: [],
          },
        },
      }),
    );
    await expect(response.json()).resolves.toEqual({
      security: {
        inviteLinkEnabled: false,
        inviteUrl: "http://localhost:3000/accept-invite?token=saved-token",
        approvedEmailDomains: ["example.com", "docs.example.com"],
        authentication: {
          google: false,
          emailPasskey: false,
        },
        permissions: {
          invitationsRole: "admins",
          teamCreationRole: "anyone",
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
        restrictFileUploads: true,
        improveAi: false,
        webSearch: false,
        hipaa: true,
        ipRestrictions: [],
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
          baseUrl: "http://localhost:3000/api/scim/workspace-1",
          tokens: [],
          lastSyncAt: null,
          status: "disabled",
        },
      },
    });
  });
});
