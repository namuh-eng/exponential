import { beforeEach, describe, expect, it, vi } from "vitest";

describe("invite tokens", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.stubEnv("BETTER_AUTH_SECRET", "invite-secret");
  });

  it("creates and verifies an invite token", async () => {
    const { createInviteToken, verifyInviteToken } = await import(
      "@/lib/invite-tokens"
    );

    const token = createInviteToken({
      workspaceId: "ws-1",
      email: "Teammate@Example.com",
      role: "admin",
    });

    expect(verifyInviteToken(token)).toEqual({
      workspaceId: "ws-1",
      email: "teammate@example.com",
      role: "admin",
      expiresAt: expect.any(Number),
    });
  });

  it("rejects expired invite tokens", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T00:00:00.000Z"));
    const { createInviteToken, verifyInviteToken } = await import(
      "@/lib/invite-tokens"
    );

    const token = createInviteToken(
      {
        workspaceId: "ws-1",
        email: "teammate@example.com",
        role: "member",
      },
      1,
    );

    vi.setSystemTime(new Date("2026-04-07T00:00:02.000Z"));
    expect(verifyInviteToken(token)).toBeNull();
  });

  it("rejects tampered invite tokens", async () => {
    const { createInviteToken, verifyInviteToken } = await import(
      "@/lib/invite-tokens"
    );

    const token = createInviteToken({
      workspaceId: "ws-1",
      email: "teammate@example.com",
      role: "guest",
    });
    const [payload, signature] = token.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({
        workspaceId: "ws-2",
        email: "teammate@example.com",
        role: "guest",
        expiresAt: Date.now() + 60_000,
      }),
    ).toString("base64url");

    expect(verifyInviteToken(`${tamperedPayload}.${signature}`)).toBeNull();
    expect(verifyInviteToken(`${payload}.invalid-signature`)).toBeNull();
  });
});
