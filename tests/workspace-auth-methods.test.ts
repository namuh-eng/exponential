import { POST as authPOST } from "@/app/api/auth/[...all]/route";
import { GET as capabilitiesGET } from "@/app/api/auth/provider-capabilities/route";
import { db } from "@/lib/db";
import { member, user, workspace } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeDb } from "./_helpers/db-integration";

const WORKSPACE_ID = "21000000-0000-0000-0000-000000000001";
const USER_ID = "21000000-0000-0000-0000-000000000002";
const WORKSPACE_SLUG = "auth-methods-off";
const EMAIL = "auth-methods-member@example.com";

async function cleanup() {
  await db.delete(member).where(eq(member.workspaceId, WORKSPACE_ID));
  await db.delete(workspace).where(eq(workspace.id, WORKSPACE_ID));
  await db.delete(user).where(eq(user.id, USER_ID));
}

describeDb("workspace-scoped auth method enforcement", () => {
  beforeAll(async () => {
    await cleanup();
    await db.insert(user).values({
      id: USER_ID,
      name: "Auth Methods Member",
      email: EMAIL,
    });
    await db.insert(workspace).values({
      id: WORKSPACE_ID,
      name: "Auth Methods Off",
      urlSlug: WORKSPACE_SLUG,
      settings: {
        security: {
          authentication: { google: false, emailPasskey: false },
        },
      },
    });
    await db.insert(member).values({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      role: "member",
    });
  });

  afterAll(cleanup);

  it("hides disabled methods in provider capabilities for workspace callbacks", async () => {
    const response = await capabilitiesGET(
      new Request(
        `http://localhost:3015/api/auth/provider-capabilities?callbackUrl=/${WORKSPACE_SLUG}/inbox`,
      ),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.providers.google.configured).toBe(false);
    expect(data.providers.googleAllowed).toBe(false);
    expect(data.providers.emailPasskey).toBe(false);
    expect(data.providers.passkey).toBe(false);
  });

  it("rejects direct Google and magic-link auth calls for disabled workspace callbacks", async () => {
    const googleResponse = await authPOST(
      new Request("http://localhost:3015/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "google",
          callbackURL: `http://localhost:3015/${WORKSPACE_SLUG}/inbox`,
        }),
      }),
    );
    expect(googleResponse.status).toBe(403);
    await expect(googleResponse.json()).resolves.toMatchObject({
      code: "WORKSPACE_AUTH_METHOD_DISABLED",
    });

    const magicLinkResponse = await authPOST(
      new Request("http://localhost:3015/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: EMAIL,
          callbackURL: `http://localhost:3015/${WORKSPACE_SLUG}/inbox`,
        }),
      }),
    );
    expect(magicLinkResponse.status).toBe(403);
    await expect(magicLinkResponse.json()).resolves.toMatchObject({
      code: "WORKSPACE_AUTH_METHOD_DISABLED",
    });
  });
});
