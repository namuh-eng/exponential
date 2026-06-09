import {
  ZAPIER_ACTION_KEYS,
  ZAPIER_TRIGGER_KEYS,
  ZapierActionError,
  createZapierWebhookSignature,
  getZapierManifest,
  sampleForTrigger,
  zapierErrorResponse,
  zapierSessionHasScope,
} from "@/lib/zapier";
import { describe, expect, it } from "vitest";

describe("zapier contract helpers", () => {
  it("exposes requested trigger and action keys in the manifest", () => {
    const manifest = getZapierManifest(
      new Request("https://example.test/api/zapier"),
    );

    expect(manifest.triggers.map((trigger) => trigger.key)).toEqual([
      "new_issue",
      "updated_issue",
      "new_comment",
      "new_project",
      "status_change",
    ]);
    expect(manifest.actions.map((action) => action.key)).toEqual([
      "create_issue",
      "update_issue",
      "create_comment",
      "create_attachment",
      "create_project",
    ]);
    expect(manifest.app.authentication.oauthAuthorizeUrl).toBe(
      "https://example.test/api/oauth/authorize",
    );
    expect(manifest.app.authentication.scopes).toEqual([
      "read",
      "write",
      "issues:read",
      "issues:write",
      "comments:read",
      "comments:write",
      "projects:read",
      "projects:write",
      "webhooks:read",
      "webhooks:write",
    ]);
    expect(ZAPIER_TRIGGER_KEYS).toHaveLength(5);
    expect(ZAPIER_ACTION_KEYS).toHaveLength(5);
  });

  it("returns sample payloads with stable ids for every trigger", () => {
    for (const trigger of ZAPIER_TRIGGER_KEYS) {
      expect(sampleForTrigger(trigger)).toMatchObject({
        id: expect.any(String),
      });
    }
  });

  it("matches general OAuth read and write scopes to Zapier subscopes", () => {
    const session = {
      user: {
        id: "user-1",
        name: "Avery",
        email: "avery@test.com",
        image: null,
      },
      oauthToken: {
        id: "token-1",
        workspaceId: "workspace-1",
        applicationId: "app-1",
        clientId: "client-1",
        scopes: ["issues:read", "write"],
      },
    };

    expect(zapierSessionHasScope(session, "read")).toBe(true);
    expect(zapierSessionHasScope(session, "comments:write")).toBe(true);
    expect(zapierSessionHasScope(session, "webhooks:write")).toBe(true);
    expect(zapierSessionHasScope(session, "unknown:read")).toBe(false);
  });

  it("signs webhook payloads with timestamp-bound HMAC", () => {
    const signature = createZapierWebhookSignature(
      "secret",
      '{"id":"issue_123"}',
      "2026-06-09T12:00:00.000Z",
    );

    expect(signature).toBe(
      "f34464feaa4dc01e9f9a627bb71e6a83c3097f779549b552655c8af3ead40274",
    );
  });

  it("formats action errors as user-readable Zapier errors", async () => {
    const response = zapierErrorResponse(
      new ZapierActionError("Title is required.", { field: "title" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_request",
        message: "Title is required.",
        field: "title",
      },
    });
  });
});
