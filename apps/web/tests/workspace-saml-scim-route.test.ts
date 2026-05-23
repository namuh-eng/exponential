import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const resolveActiveWorkspaceIdMock = vi.fn();
const currentWorkspaceLimitMock = vi.fn();
const updateSetMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: getSessionMock } },
}));

vi.mock("@/lib/active-workspace", () => ({
  resolveActiveWorkspaceId: resolveActiveWorkspaceIdMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnValue({
        innerJoin: vi
          .fn()
          .mockReturnValue({ limit: currentWorkspaceLimitMock }),
      }),
    })),
    update: vi.fn(() => ({
      set: (...args: unknown[]) => {
        updateSetMock(...args);
        return { where: vi.fn().mockResolvedValue(undefined) };
      },
    })),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

function workspaceRecord(role = "admin") {
  return {
    id: "workspace-1",
    role,
    settings: {
      security: {
        saml: {
          enabled: false,
          domains: [],
          idpSsoUrl: "",
          entityId: "",
          certificate: "",
          metadataUrl: "",
          status: "not_configured",
        },
        scim: {
          enabled: false,
          baseUrl: "http://localhost:3000/api/scim/workspace-1",
          tokens: [],
        },
      },
    },
  };
}

describe("workspace SAML/SCIM routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    resolveActiveWorkspaceIdMock.mockResolvedValue("workspace-1");
  });

  it("prevents non-admin SAML mutation", async () => {
    currentWorkspaceLimitMock.mockResolvedValueOnce([
      workspaceRecord("member"),
    ]);
    const { PATCH } = await import(
      "@/app/api/workspaces/current/security/saml/route"
    );

    const response = await PATCH(
      new Request(
        "http://localhost:3000/api/workspaces/current/security/saml",
        {
          method: "PATCH",
          body: JSON.stringify({ enabled: true }),
        },
      ),
    );

    expect(response.status).toBe(403);
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("saves admin SAML settings and marks test success", async () => {
    currentWorkspaceLimitMock.mockResolvedValueOnce([workspaceRecord()]);
    const { PATCH } = await import(
      "@/app/api/workspaces/current/security/saml/route"
    );

    const response = await PATCH(
      new Request(
        "http://localhost:3000/api/workspaces/current/security/saml",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enabled: true,
            domains: ["Example.com"],
            idpSsoUrl: "https://idp.example.com/sso",
            entityId: "https://idp.example.com/entity",
            certificate: "CERT",
            test: true,
          }),
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          security: expect.objectContaining({
            saml: expect.objectContaining({
              enabled: true,
              domains: ["example.com"],
              status: "verified",
              lastTestedAt: expect.any(String),
            }),
          }),
        }),
      }),
    );
  });

  it("generates hashed SCIM tokens and returns the secret once", async () => {
    currentWorkspaceLimitMock.mockResolvedValueOnce([workspaceRecord()]);
    const { POST } = await import(
      "@/app/api/workspaces/current/security/scim/route"
    );

    const response = await POST(
      new Request(
        "http://localhost:3000/api/workspaces/current/security/scim",
        {
          method: "POST",
          body: JSON.stringify({ name: "Okta" }),
        },
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.token).toMatch(/^scim_/);
    expect(body.scim.tokens[0].tokenHash).toBeUndefined();
    const saved = updateSetMock.mock.calls.at(-1)?.[0] as {
      settings: {
        security: { scim: { tokens: Array<{ tokenHash: string }> } };
      };
    };
    expect(saved.settings.security.scim.tokens[0].tokenHash).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(saved.settings.security.scim.tokens[0].tokenHash).not.toBe(
      body.token,
    );
  });
});
