import { beforeEach, describe, expect, it, vi } from "vitest";

const getZapierContextMock = vi.fn();
const pollZapierTriggerMock = vi.fn();
const runZapierActionMock = vi.fn();
const subscribeZapierHookMock = vi.fn();

vi.mock("@/lib/zapier", () => {
  return {
    ZAPIER_ACTION_KEYS: [
      "create_issue",
      "update_issue",
      "create_comment",
      "create_attachment",
      "create_project",
    ],
    ZAPIER_TRIGGER_KEYS: [
      "new_issue",
      "updated_issue",
      "new_comment",
      "new_project",
      "status_change",
    ],
    getZapierContext: getZapierContextMock,
    pollZapierTrigger: pollZapierTriggerMock,
    runZapierAction: runZapierActionMock,
    subscribeZapierHook: subscribeZapierHookMock,
    zapierErrorResponse: (error: unknown) =>
      Response.json(
        {
          error: {
            code: "internal_error",
            message:
              error instanceof Error ? error.message : "Zapier request failed.",
          },
        },
        { status: 500 },
      ),
  };
});

describe("zapier route handlers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getZapierContextMock.mockResolvedValue({
      context: {
        user: { id: "user-1", name: "Avery", email: "avery@test.com" },
        workspaceId: "workspace-1",
        session: {
          user: { id: "user-1", name: "Avery", email: "avery@test.com" },
        },
      },
      response: null,
    });
  });

  it("verifies Zapier auth against the selected workspace", async () => {
    const { GET } = await import("@/app/api/zapier/auth/test/route");

    const response = await GET(
      new Request("https://example.test/api/zapier/auth/test"),
    );

    expect(getZapierContextMock).toHaveBeenCalledWith(expect.any(Request));
    expect(getZapierContextMock.mock.calls[0][1]).toBeUndefined();
    await expect(response.json()).resolves.toEqual({
      id: "user-1",
      name: "Avery",
      email: "avery@test.com",
      workspaceId: "workspace-1",
    });
  });

  it("polls a supported trigger and rejects unknown trigger keys", async () => {
    pollZapierTriggerMock.mockResolvedValue([{ id: "issue-1" }]);
    const { GET } = await import("@/app/api/zapier/triggers/[trigger]/route");

    const response = await GET(
      new Request("https://example.test/api/zapier/triggers/new_issue"),
      { params: Promise.resolve({ trigger: "new_issue" }) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([{ id: "issue-1" }]);

    const missing = await GET(
      new Request("https://example.test/api/zapier/triggers/nope"),
      { params: Promise.resolve({ trigger: "nope" }) },
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({
      error: { code: "unknown_trigger" },
    });
  });

  it("runs supported actions with structured failures for unknown actions", async () => {
    runZapierActionMock.mockResolvedValue({ id: "issue-1" });
    const { POST } = await import("@/app/api/zapier/actions/[action]/route");

    const response = await POST(
      new Request("https://example.test/api/zapier/actions/create_issue", {
        method: "POST",
        body: JSON.stringify({ title: "From Zapier", teamKey: "ENG" }),
      }),
      { params: Promise.resolve({ action: "create_issue" }) },
    );
    expect(response.status).toBe(201);
    expect(runZapierActionMock).toHaveBeenCalledWith(
      "create_issue",
      expect.any(Object),
      { title: "From Zapier", teamKey: "ENG" },
    );

    const missing = await POST(
      new Request("https://example.test/api/zapier/actions/nope", {
        method: "POST",
      }),
      { params: Promise.resolve({ action: "nope" }) },
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({
      error: { code: "unknown_action" },
    });
  });

  it("registers Zapier webhook subscriptions with webhook scope", async () => {
    subscribeZapierHookMock.mockResolvedValue({ id: "webhook-1" });
    const { POST } = await import("@/app/api/zapier/hooks/subscribe/route");

    const response = await POST(
      new Request("https://example.test/api/zapier/hooks/subscribe", {
        method: "POST",
        body: JSON.stringify({
          trigger: "new_issue",
          targetUrl: "https://hooks.zapier.test/catch/1",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(getZapierContextMock).toHaveBeenCalledWith(
      expect.any(Request),
      "webhooks:write",
    );
    await expect(response.json()).resolves.toEqual({ id: "webhook-1" });
  });
});
