import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import App, {
  createIssue,
  performSubscribe,
  performUnsubscribe,
  performWebhook,
  triggerDefinitions,
  verifyWebhookSignature,
} from "./index.js";

type RequestRecord = {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
};

type FakeResponse = {
  status: number;
  json: unknown;
};

function fakeZ(response: FakeResponse) {
  const requests: RequestRecord[] = [];
  return {
    requests,
    z: {
      request: async (options: RequestRecord): Promise<FakeResponse> => {
        requests.push(options);
        return response;
      },
    },
  };
}

function definition(key: string) {
  const found = triggerDefinitions.find((item) => item.key === key);
  if (!found) throw new Error(`missing trigger ${key}`);
  return found;
}

describe("Zapier app contract", () => {
  it("declares OAuth auth, triggers, and actions", () => {
    expect(App.authentication.type).toBe("oauth2");
    expect(Object.keys(App.triggers)).toEqual([
      "new_issue",
      "updated_issue",
      "issue_status_changed",
      "new_comment",
      "new_project",
    ]);
    expect(Object.keys(App.creates)).toEqual([
      "create_issue",
      "update_issue",
      "create_comment",
      "create_project",
      "create_attachment",
    ]);
  });

  it("subscribes and unsubscribes webhook-backed triggers through the public API", async () => {
    const { z, requests } = fakeZ({
      status: 200,
      json: { createdCredential: { id: "wh_123", secret: "whsec_test" } },
    });

    const subscribed = await performSubscribe(definition("new_issue"))(z, {
      authData: {
        access_token: "lin_oauth_at_test",
        baseUrl: "https://issues.example.com/api",
      },
      targetUrl: "https://hooks.zapier.com/hooks/catch/1/abc",
    });

    expect(subscribed).toEqual({
      id: "wh_123",
      secret: "whsec_test",
      event: "issue.created",
    });
    expect(requests[0]).toMatchObject({
      url: "https://issues.example.com/api/workspaces/current/api",
      method: "POST",
      body: {
        action: "createWebhook",
        events: ["issue.created"],
        url: "https://hooks.zapier.com/hooks/catch/1/abc",
      },
    });

    await performUnsubscribe(z, {
      authData: {
        access_token: "lin_oauth_at_test",
        baseUrl: "https://issues.example.com/api",
      },
      subscribeData: { id: "wh_123" },
    });

    expect(requests[1]?.body).toEqual({
      action: "deleteWebhook",
      id: "wh_123",
    });
  });

  it("verifies signed webhook deliveries", async () => {
    const rawBody = JSON.stringify({
      type: "issue.status_changed",
      data: { id: "evt_1", issue: { id: "issue_1" } },
    });
    const signature = `sha256=${createHmac("sha256", "whsec_test").update(rawBody).digest("hex")}`;

    expect(verifyWebhookSignature("whsec_test", rawBody, signature)).toBe(true);

    const rows = await performWebhook(definition("issue_status_changed"))(
      { request: async () => ({ status: 200, json: {} }) },
      {
        subscribeData: { secret: "whsec_test" },
        cleanedRequest: {
          rawBody,
          json: JSON.parse(rawBody) as Record<string, unknown>,
          headers: { "X-Exponential-Signature": signature },
        },
      },
    );

    expect(rows).toEqual([{ id: "evt_1", issue: { id: "issue_1" } }]);
  });

  it("posts actions with bearer auth and user-readable failures", async () => {
    const { z, requests } = fakeZ({
      status: 201,
      json: { id: "issue_1", title: "Created from Zapier" },
    });

    await createIssue(z, {
      authData: {
        apiKey: "pat_test",
        baseUrl: "https://issues.example.com/api",
      },
      inputData: {
        title: "Created from Zapier",
        team_id: "team_1",
        priority: "high",
      },
    });

    expect(requests[0]).toMatchObject({
      url: "https://issues.example.com/api/issues",
      method: "POST",
      headers: { Authorization: "Bearer pat_test" },
      body: {
        title: "Created from Zapier",
        team_id: "team_1",
        priority: "high",
      },
    });

    const failing = fakeZ({
      status: 400,
      json: { title: "Invalid title", detail: "Title is required." },
    });
    await expect(
      createIssue(failing.z, {
        authData: { apiKey: "pat_test" },
        inputData: { title: "Created from Zapier", team_id: "team_1" },
      }),
    ).rejects.toThrow("Invalid title: Title is required.");
  });
});
