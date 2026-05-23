import { POST } from "@/app/api/auth/saml/discovery/route";
import { db } from "@/lib/db";
import { workspace } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeDb } from "./_helpers/db-integration";

const MATCH_WS_ID = "13300000-0000-0000-0000-000000000001";
const DISABLED_WS_ID = "13300000-0000-0000-0000-000000000002";
const TEST_WS_IDS = [MATCH_WS_ID, DISABLED_WS_ID];
const SAML_URL = "https://idp.example.com/saml/start";

function post(body: unknown) {
  return POST(
    new Request("http://localhost:3015/api/auth/saml/discovery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describeDb("SAML discovery API route", () => {
  beforeAll(async () => {
    await db.delete(workspace).where(inArray(workspace.id, TEST_WS_IDS));
    await db.insert(workspace).values([
      {
        id: MATCH_WS_ID,
        name: "SAML Workspace",
        urlSlug: "saml-workspace-133",
        settings: {
          saml: {
            enabled: true,
            domains: ["example.com"],
            ssoUrl: SAML_URL,
          },
        },
      },
      {
        id: DISABLED_WS_ID,
        name: "Disabled SAML Workspace",
        urlSlug: "disabled-saml-workspace-133",
        settings: {
          saml: {
            enabled: false,
            domains: ["disabled.example"],
            ssoUrl: "https://idp.example.com/disabled",
          },
        },
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(workspace).where(inArray(workspace.id, TEST_WS_IDS));
  });

  it("returns a validation error for invalid email", async () => {
    const response = await post({ email: "not-an-email" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Enter a valid email address.",
    });
  });

  it("returns Linear's server-backed no-workspace message when no domain matches", async () => {
    const response = await post({ email: "person@missing.example" });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "No SAML SSO enabled workspace could be found.",
    });
  });

  it("returns the configured IdP URL when the email domain matches", async () => {
    const response = await post({
      email: "Person@Example.com",
      isDesktop: false,
      type: "login",
      callbackURL: "http://localhost:3015/issues",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: SAML_URL });
  });

  it("ignores disabled SAML settings", async () => {
    const response = await post({ email: "person@disabled.example" });

    expect(response.status).toBe(404);
  });
});
