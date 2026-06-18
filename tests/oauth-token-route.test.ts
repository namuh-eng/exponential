import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();

vi.mock("@/lib/db/schema", () => ({
  workspace: { id: "workspace.id", settings: "workspace.settings" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((left, right) => ({ left, right })),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({ from: fromMock })),
    update: vi.fn(() => ({
      set: updateSetMock,
    })),
  },
}));

function hashSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

function workspaceSettings() {
  return {
    api: {
      oauthApplications: [
        {
          id: "app-1",
          name: "Zapier",
          clientId: "lin_client_test",
          clientSecretPreview: "linsec_test…",
          clientSecretHash: hashSecret("linsec_test"),
          redirectUrl: "https://zapier.example.test/callback",
          redirectUrls: ["https://zapier.example.test/callback"],
          scopes: ["issues:read", "webhooks:write"],
          createdAt: "2026-06-09T12:00:00.000Z",
          updatedAt: "2026-06-09T12:00:00.000Z",
        },
      ],
      oauthTokens: [
        {
          id: "tok-1",
          tokenHash: hashSecret("lin_oauth_at_old"),
          refreshTokenHash: hashSecret("lin_oauth_rt_old"),
          applicationId: "app-1",
          clientId: "lin_client_test",
          workspaceId: "workspace-1",
          userId: "user-1",
          scopes: ["issues:read", "webhooks:write"],
          revokedAt: null,
          createdAt: "2026-06-09T12:00:00.000Z",
          expiresAt: "2026-06-09T13:00:00.000Z",
        },
      ],
    },
  };
}

describe("OAuth token route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    updateSetMock.mockReturnValue({ where: updateWhereMock });
    updateWhereMock.mockResolvedValue(undefined);
    fromMock.mockResolvedValue([
      { id: "workspace-1", settings: workspaceSettings() },
    ]);
  });

  it("rotates access and refresh tokens for Zapier OAuth refresh grants", async () => {
    const { POST } = await import("@/app/api/oauth/token/route");

    const response = await POST(
      new Request("https://example.test/api/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: "lin_oauth_rt_old",
          client_id: "lin_client_test",
          client_secret: "linsec_test",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      access_token: expect.stringMatching(/^lin_oauth_at_/),
      refresh_token: expect.stringMatching(/^lin_oauth_rt_/),
      token_type: "Bearer",
      expires_in: 3600,
      scope: "issues:read webhooks:write",
    });
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          api: expect.objectContaining({
            oauthTokens: [
              expect.objectContaining({
                id: "tok-1",
                tokenHash: expect.not.stringMatching(
                  hashSecret("lin_oauth_at_old"),
                ),
                refreshTokenHash: expect.not.stringMatching(
                  hashSecret("lin_oauth_rt_old"),
                ),
                scopes: ["issues:read", "webhooks:write"],
              }),
            ],
          }),
        }),
        updatedAt: expect.any(Date),
      }),
    );
  });

  it("rejects invalid refresh tokens without rotating credentials", async () => {
    const { POST } = await import("@/app/api/oauth/token/route");

    const response = await POST(
      new Request("https://example.test/api/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: "lin_oauth_rt_missing",
          client_id: "lin_client_test",
          client_secret: "linsec_test",
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_grant" });
    expect(updateSetMock).not.toHaveBeenCalled();
  });
});
