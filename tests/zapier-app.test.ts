import {
  ZAPIER_ACTION_KEYS,
  ZAPIER_TRIGGER_KEYS,
  sampleForTrigger,
} from "@/lib/zapier";
import { describe, expect, it } from "vitest";
import zapierApp from "../apps/zapier";

type TestZ = Parameters<typeof zapierApp.authentication.test>[0];
type TestBundle = Parameters<typeof zapierApp.authentication.test>[1];
type TestRequest = Parameters<TestZ["request"]>[0];
type TestResponse = Awaited<ReturnType<TestZ["request"]>>;

function createZapierHarness(response: TestResponse) {
  const requests: TestRequest[] = [];
  const z: TestZ = {
    request: async (options) => {
      requests.push(options);
      return response;
    },
  };

  return { z, requests };
}

describe("Zapier public app", () => {
  it("exports the backend trigger and action contract", () => {
    expect(Object.keys(zapierApp.triggers)).toEqual([...ZAPIER_TRIGGER_KEYS]);
    expect(Object.keys(zapierApp.creates)).toEqual([...ZAPIER_ACTION_KEYS]);

    for (const triggerKey of ZAPIER_TRIGGER_KEYS) {
      expect(zapierApp.triggers[triggerKey].operation.sample).toEqual(
        sampleForTrigger(triggerKey),
      );
      expect(
        zapierApp.triggers[triggerKey].operation.performSubscribe,
      ).toBeTypeOf("function");
      expect(
        zapierApp.triggers[triggerKey].operation.performUnsubscribe,
      ).toBeTypeOf("function");
    }

    expect(zapierApp.creates.create_attachment.operation.inputFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "fileName", required: true }),
        expect.objectContaining({ key: "contentType", required: true }),
        expect.objectContaining({ key: "size", required: true }),
      ]),
    );
  });

  it("uses Exponential OAuth endpoints for the public auth flow", async () => {
    const authorize = zapierApp.authentication.oauth2Config.authorizeUrl({
      authData: { baseUrl: "https://linear.example.test/" },
    });

    expect(authorize.url).toBe(
      "https://linear.example.test/api/oauth/authorize",
    );
    expect(authorize.params).toMatchObject({
      response_type: "code",
      scope: expect.stringContaining("issues:read"),
    });

    const { z, requests } = createZapierHarness({
      status: 200,
      json: {
        access_token: "lin_oauth_at_test",
        refresh_token: "lin_oauth_rt_test",
      },
    });

    await expect(
      zapierApp.authentication.oauth2Config.getAccessToken(z, {
        authData: { baseUrl: "https://linear.example.test" },
        inputData: {
          code: "lincode_test",
          client_id: "lin_client_test",
          client_secret: "linsec_test",
          redirect_uri: "https://zapier.example.test/callback",
        },
      }),
    ).resolves.toMatchObject({ access_token: "lin_oauth_at_test" });

    expect(requests[0]).toMatchObject({
      url: "https://linear.example.test/api/oauth/token",
      method: "POST",
      body: {
        grant_type: "authorization_code",
        code: "lincode_test",
      },
    });
  });

  it("polls and subscribes triggers with bearer auth", async () => {
    const { z, requests } = createZapierHarness({
      status: 200,
      json: [{ id: "issue-1" }],
    });
    const bundle: TestBundle = {
      authData: {
        baseUrl: "https://linear.example.test",
        access_token: "lin_oauth_at_test",
      },
      inputData: {
        since: "2026-06-09T12:00:00.000Z",
        limit: 10,
      },
      targetUrl: "https://hooks.zapier.test/catch/123",
    };

    await zapierApp.triggers.status_change.operation.perform(z, bundle);
    await zapierApp.triggers.status_change.operation.performSubscribe?.(
      z,
      bundle,
    );

    expect(requests[0]).toMatchObject({
      url: "https://linear.example.test/api/zapier/triggers/status_change",
      method: "GET",
      params: {
        since: "2026-06-09T12:00:00.000Z",
        limit: 10,
      },
      headers: {
        Authorization: "Bearer lin_oauth_at_test",
      },
    });
    expect(requests[1]).toMatchObject({
      url: "https://linear.example.test/api/zapier/hooks/subscribe",
      method: "POST",
      body: {
        trigger: "status_change",
        targetUrl: "https://hooks.zapier.test/catch/123",
      },
    });
  });

  it("turns structured action failures into user-readable Zapier errors", async () => {
    const { z } = createZapierHarness({
      status: 400,
      json: {
        error: {
          code: "invalid_request",
          message: "Title is required.",
          field: "title",
        },
      },
    });

    await expect(
      zapierApp.creates.create_issue.operation.perform(z, {
        authData: {
          baseUrl: "https://linear.example.test",
          api_key: "lin_api_test",
        },
        inputData: { teamKey: "ENG" },
      }),
    ).rejects.toThrow(
      "Title is required. Field: title. Code: invalid_request.",
    );
  });
});
